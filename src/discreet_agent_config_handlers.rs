// discreet_agent_config_handlers.rs — CRUD endpoints for agent configurations.
//
// Endpoints:
//   POST   /api/v1/servers/:server_id/agents             — Create agent config.
//   GET    /api/v1/servers/:server_id/agents             — List agent configs.
//   PUT    /api/v1/servers/:server_id/agents/:agent_id   — Update agent config.
//   DELETE /api/v1/servers/:server_id/agents/:agent_id   — Delete agent config.
//
// All endpoints require MANAGE_SERVER permission on the server.
// API keys are encrypted with AES-256-GCM (HKDF salt=discreet-agent-v1)
// before storage. Response never includes raw keys — uses has_api_key boolean.
// Rate limit: 20 requests per minute per user.

use std::sync::Arc;

use axum::{
    extract::{Json, Path, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, Permission};
use crate::discreet_state::AppState;

/// Rate limit: 20 requests per minute per user.
const RATE_LIMIT: i64 = 20;
const RATE_WINDOW: i64 = 60;

// ─── Request / Response types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateAgentRequest {
    pub name: String,
    pub provider_type: String,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub endpoint_url: Option<String>,
    pub system_prompt: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentRequest {
    pub name: Option<String>,
    pub provider_type: Option<String>,
    pub model: Option<String>,
    /// If present and non-null, re-encrypt and update. If absent, keep existing.
    pub api_key: Option<Option<String>>,
    pub endpoint_url: Option<String>,
    pub system_prompt: Option<String>,
    pub max_tokens: Option<i32>,
    pub temperature: Option<f32>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
struct AgentConfigResponse {
    id: Uuid,
    server_id: Uuid,
    name: String,
    provider_type: String,
    model: Option<String>,
    has_api_key: bool,
    endpoint_url: Option<String>,
    system_prompt: Option<String>,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
    enabled: bool,
    created_by: Option<Uuid>,
    created_at: String,
}

// ─── Rate limit helper ──────────────────────────────────────────────────

async fn enforce_rate(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let rate_key = format!("agent_cfg:{user_id}");
    let mut redis_conn = state.redis.clone();

    let count: i64 = crate::discreet_error::redis_or_503(
        redis::cmd("INCR")
            .arg(&rate_key)
            .query_async::<Option<i64>>(&mut redis_conn)
            .await,
    )?
    .unwrap_or(1);

    if count == 1 {
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(RATE_WINDOW)
            .query_async(&mut redis_conn)
            .await;
    }

    if count > RATE_LIMIT {
        return Err(AppError::RateLimited(
            "Too many agent config requests. Limit is 20 per minute.".into(),
        ));
    }

    Ok(())
}

// ─── Encryption helper ──────────────────────────────────────────────────

/// Encrypt an API key and return the combined bytes (nonce + ciphertext).
/// Stored as a single BYTEA column: [nonce(12) | commitment(32) | ciphertext].
fn encrypt_key(api_key: &str, config: &crate::discreet_config::Config, agent_id: Uuid) -> Result<Vec<u8>, AppError> {
    let (ciphertext_with_commit, nonce) = crate::discreet_agent_config::encrypt_api_key(
        api_key,
        config.agent_key_secret.as_bytes(),
        &agent_id,
    )
    .map_err(|e| AppError::Internal(format!("API key encryption failed: {e}")))?;

    // Store as [nonce(12) | ciphertext_with_commitment]
    let mut blob = Vec::with_capacity(nonce.len() + ciphertext_with_commit.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext_with_commit);
    Ok(blob)
}

/// Allowed provider types.
const VALID_PROVIDERS: &[&str] = &["openai", "anthropic", "openjarvis", "ollama", "vllm", "custom"];

// ─── POST /servers/:server_id/agents ────────────────────────────────────

/// Create a new agent configuration for a server.
pub async fn create_agent(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateAgentRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_SERVER).await?;
    enforce_rate(&state, auth.user_id).await?;

    // Validate
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest("name must be 1-100 characters".into()));
    }
    if !VALID_PROVIDERS.contains(&req.provider_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "provider_type must be one of: {}", VALID_PROVIDERS.join(", ")
        )));
    }

    let agent_id = Uuid::new_v4();

    // Encrypt API key if provided
    let encrypted_key: Option<Vec<u8>> = match req.api_key {
        Some(ref key) if !key.is_empty() => Some(encrypt_key(key, &state.config, agent_id)?),
        _ => None,
    };

    let model = req.model.as_deref().unwrap_or("");
    let endpoint_url = req.endpoint_url.as_deref().unwrap_or("");
    let system_prompt = req.system_prompt.as_deref()
        .unwrap_or("You are a helpful assistant in the Discreet messaging platform.");
    let max_tokens = req.max_tokens.unwrap_or(1000);
    let temperature = req.temperature.unwrap_or(0.7);

    let row = sqlx::query!(
        r#"INSERT INTO agent_configs (id, server_id, name, provider_type, model, encrypted_api_key, endpoint_url, system_prompt, max_tokens, temperature, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING created_at"#,
        agent_id,
        server_id,
        name,
        req.provider_type,
        model,
        encrypted_key.as_deref(),
        endpoint_url,
        system_prompt,
        max_tokens,
        temperature as f32,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(
        user_id = %auth.user_id,
        server_id = %server_id,
        agent_id = %agent_id,
        provider = %req.provider_type,
        "Agent config created"
    );

    Ok((
        axum::http::StatusCode::CREATED,
        Json(AgentConfigResponse {
            id: agent_id,
            server_id,
            name,
            provider_type: req.provider_type,
            model: Some(model.to_string()),
            has_api_key: encrypted_key.is_some(),
            endpoint_url: Some(endpoint_url.to_string()),
            system_prompt: Some(system_prompt.to_string()),
            max_tokens: Some(max_tokens),
            temperature: Some(temperature),
            enabled: true,
            created_by: Some(auth.user_id),
            created_at: row.created_at.to_rfc3339(),
        }),
    ))
}

// ─── GET /servers/:server_id/agents ─────────────────────────────────────

/// List all agent configs for a server (without raw API keys).
pub async fn list_agents(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_SERVER).await?;
    enforce_rate(&state, auth.user_id).await?;

    let rows = sqlx::query!(
        r#"SELECT id, server_id, name, provider_type, model, encrypted_api_key IS NOT NULL as "has_api_key!",
                  endpoint_url, system_prompt, max_tokens, temperature, enabled, created_by, created_at
           FROM agent_configs
           WHERE server_id = $1
           ORDER BY created_at ASC"#,
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let agents: Vec<AgentConfigResponse> = rows.iter().map(|r| AgentConfigResponse {
        id: r.id,
        server_id: r.server_id,
        name: r.name.clone(),
        provider_type: r.provider_type.clone(),
        model: r.model.clone(),
        has_api_key: r.has_api_key,
        endpoint_url: r.endpoint_url.clone(),
        system_prompt: r.system_prompt.clone(),
        max_tokens: r.max_tokens,
        temperature: r.temperature,
        enabled: r.enabled.unwrap_or(true),
        created_by: r.created_by,
        created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(json!({ "agents": agents })))
}

// ─── PUT /servers/:server_id/agents/:agent_id ───────────────────────────

/// Update an agent configuration. Fields not provided are left unchanged.
/// If api_key is provided (non-null), re-encrypt and update.
pub async fn update_agent(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, agent_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateAgentRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_SERVER).await?;
    enforce_rate(&state, auth.user_id).await?;

    // Verify the agent belongs to this server
    let existing = sqlx::query!(
        "SELECT id FROM agent_configs WHERE id = $1 AND server_id = $2",
        agent_id, server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Agent config not found".into()))?;

    // Validate provider_type if changing
    if let Some(ref pt) = req.provider_type {
        if !VALID_PROVIDERS.contains(&pt.as_str()) {
            return Err(AppError::BadRequest(format!(
                "provider_type must be one of: {}", VALID_PROVIDERS.join(", ")
            )));
        }
    }

    // Validate name if changing
    if let Some(ref name) = req.name {
        let name = name.trim();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::BadRequest("name must be 1-100 characters".into()));
        }
    }

    // Handle API key update
    if let Some(Some(ref key)) = req.api_key {
        if !key.is_empty() {
            let encrypted = encrypt_key(key, &state.config, existing.id)?;
            sqlx::query!(
                "UPDATE agent_configs SET encrypted_api_key = $1 WHERE id = $2",
                &encrypted, agent_id,
            )
            .execute(&state.db)
            .await?;
        }
    }

    // Update other fields
    if let Some(ref name) = req.name {
        sqlx::query!("UPDATE agent_configs SET name = $1 WHERE id = $2", name.trim(), agent_id)
            .execute(&state.db).await?;
    }
    if let Some(ref pt) = req.provider_type {
        sqlx::query!("UPDATE agent_configs SET provider_type = $1 WHERE id = $2", pt, agent_id)
            .execute(&state.db).await?;
    }
    if let Some(ref model) = req.model {
        sqlx::query!("UPDATE agent_configs SET model = $1 WHERE id = $2", model, agent_id)
            .execute(&state.db).await?;
    }
    if let Some(ref url) = req.endpoint_url {
        sqlx::query!("UPDATE agent_configs SET endpoint_url = $1 WHERE id = $2", url, agent_id)
            .execute(&state.db).await?;
    }
    if let Some(ref sp) = req.system_prompt {
        sqlx::query!("UPDATE agent_configs SET system_prompt = $1 WHERE id = $2", sp, agent_id)
            .execute(&state.db).await?;
    }
    if let Some(mt) = req.max_tokens {
        sqlx::query!("UPDATE agent_configs SET max_tokens = $1 WHERE id = $2", mt, agent_id)
            .execute(&state.db).await?;
    }
    if let Some(temp) = req.temperature {
        sqlx::query!("UPDATE agent_configs SET temperature = $1 WHERE id = $2", temp, agent_id)
            .execute(&state.db).await?;
    }
    if let Some(enabled) = req.enabled {
        sqlx::query!("UPDATE agent_configs SET enabled = $1 WHERE id = $2", enabled, agent_id)
            .execute(&state.db).await?;
    }

    // Fetch and return updated config
    let r = sqlx::query!(
        r#"SELECT id, server_id, name, provider_type, model, encrypted_api_key IS NOT NULL as "has_api_key!",
                  endpoint_url, system_prompt, max_tokens, temperature, enabled, created_by, created_at
           FROM agent_configs WHERE id = $1"#,
        agent_id,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(user_id = %auth.user_id, agent_id = %agent_id, "Agent config updated");

    Ok(Json(AgentConfigResponse {
        id: r.id,
        server_id: r.server_id,
        name: r.name,
        provider_type: r.provider_type,
        model: r.model,
        has_api_key: r.has_api_key,
        endpoint_url: r.endpoint_url,
        system_prompt: r.system_prompt,
        max_tokens: r.max_tokens,
        temperature: r.temperature,
        enabled: r.enabled.unwrap_or(true),
        created_by: r.created_by,
        created_at: r.created_at.to_rfc3339(),
    }))
}

// ─── DELETE /servers/:server_id/agents/:agent_id ────────────────────────

/// Delete an agent configuration.
pub async fn delete_agent(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, agent_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_SERVER).await?;
    enforce_rate(&state, auth.user_id).await?;

    let result = sqlx::query!(
        "DELETE FROM agent_configs WHERE id = $1 AND server_id = $2",
        agent_id, server_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Agent config not found".into()));
    }

    tracing::info!(user_id = %auth.user_id, agent_id = %agent_id, "Agent config deleted");

    Ok(axum::http::StatusCode::NO_CONTENT)
}
