// citadel_agent_handlers.rs — HTTP handlers for the AI Agent lifecycle.
//
// Endpoints:
//   POST /api/v1/agents/search          — Search existing or auto-spawn
//   GET  /api/v1/agents/spawn/:id/status — Poll spawn progress
//   GET  /api/v1/servers/:id/agents      — List agents on a server
//
// All handlers return Result<_, AppError>. No panics.

use axum::{
    extract::{Path, State, Json},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_agent_types::{
    AgentSpecialization, AgentRuntimeConfig, SpawnEngine,
    SafetyConfig, LLMBackend, KeyPair,
};
use crate::citadel_auth::AuthUser;
use crate::citadel_config::Config;
use crate::citadel_error::AppError;
use crate::citadel_permissions::{
    require_permission,
    PERM_USE_AGENTS,
};
use crate::citadel_state::AppState;

// ─── Request / Response Types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AgentSearchRequest {
    pub query: String,
    pub server_id: Uuid,
    #[serde(default = "default_true")]
    pub auto_spawn: bool,
}

fn default_true() -> bool { true }

#[derive(Debug, Serialize)]
pub struct AgentSearchResponse {
    pub existing: bool,
    pub channel: Option<AgentChannelInfo>,
    pub spawn: Option<SpawnRequestInfo>,
    pub suggestions: Vec<AgentChannelInfo>,
}

#[derive(Debug, Clone, Serialize)]  // Clone required for suggestions[1..].to_vec()
pub struct AgentChannelInfo {
    pub channel_id: Uuid,
    pub channel_name: String,
    pub agent: AgentSummary,
    pub topic: String,
    pub member_count: u32,
    pub mls_epoch: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentSummary {
    pub agent_id: Uuid,
    pub display_name: String,
    pub specialization: String,
    pub status: String,
    pub fingerprint: String,
}

#[derive(Debug, Serialize)]
pub struct SpawnRequestInfo {
    pub request_id: Uuid,
    pub status: String,
    pub inferred_specialization: String,
    pub confidence: f64,
    pub estimated_ready_secs: u32,
}

// ─── POST /agents/search ────────────────────────────────────────────────
//
// Core endpoint. Flow:
//   1. User searches (e.g., "immigration lawyer")
//   2. Check existing agent channels on this server
//   3. Match found → return it
//   4. No match + auto_spawn=true → spawn pipeline (async)
//   5. Return spawn request ID for polling

pub async fn search_or_spawn(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<AgentSearchRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Require permission to use AI agents within this server.
    require_permission(&state, req.server_id, auth.user_id, PERM_USE_AGENTS).await?;

    // Search existing agent channels (full-text on topic + display name).
    let rows = sqlx::query!(
        r#"
        SELECT ac.channel_id, ac.topic, ac.member_count,
               a.id as agent_id, a.display_name, a.specialization,
               a.status, a.fingerprint, ac.created_at
        FROM agent_channels ac
        JOIN agents a ON ac.agent_id = a.id
        WHERE ac.server_id = $1
          AND ac.archived = false
          AND (
            ac.topic ILIKE '%' || $2 || '%'
            OR a.display_name ILIKE '%' || $2 || '%'
          )
        ORDER BY ac.created_at DESC
        LIMIT 10
        "#,
        req.server_id,
        req.query,
    )
    .fetch_all(&state.db)
    .await?;

    if !rows.is_empty() {
        let suggestions: Vec<AgentChannelInfo> = rows
            .iter()
            .map(|r| AgentChannelInfo {
                channel_id: r.channel_id,
                channel_name: format!("ai-{}", r.topic.to_lowercase().replace(' ', "-")),
                agent: AgentSummary {
                    agent_id: r.agent_id,
                    display_name: r.display_name.clone(),
                    specialization: r.specialization.to_string(),
                    status: r.status.clone(),
                    fingerprint: r.fingerprint.clone(),
                },
                topic: r.topic.clone(),
                member_count: r.member_count as u32,
                mls_epoch: 0,
                created_at: r.created_at.to_rfc3339(),
            })
            .collect();

        return Ok(Json(AgentSearchResponse {
            existing: true,
            channel: suggestions.first().cloned(),
            spawn: None,
            suggestions: suggestions.into_iter().skip(1).collect(),
        }));
    }

    // No match — auto-spawn if enabled.
    if !req.auto_spawn {
        return Ok(Json(AgentSearchResponse {
            existing: false,
            channel: None,
            spawn: None,
            suggestions: vec![],
        }));
    }

    // Rate-limit: one spawn per 30 seconds per user.
    let recent = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM agent_spawn_log
         WHERE requesting_user_id = $1 AND created_at > NOW() - INTERVAL '30 seconds'",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if recent.unwrap_or(0) > 0 {
        return Err(AppError::RateLimited(
            "Wait 30 seconds between agent spawn requests".into(),
        ));
    }

    // Classify the query.
    let engine = SpawnEngine::default();
    let (specialization, confidence) = engine.analyze_query(&req.query);

    if confidence < engine.spawn_threshold {
        return Err(AppError::BadRequest(format!(
            "Could not determine a specialization from '{}'. \
             Try something specific like 'immigration lawyer' or 'python developer'.",
            req.query
        )));
    }

    // Record the spawn request.
    let spawn_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO agent_spawn_log
            (id, requesting_user_id, server_id, query, inferred_specialization, confidence, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'provisioning')",
        spawn_id,
        auth.user_id,
        req.server_id,
        req.query,
        serde_json::to_value(&specialization)?,
        confidence,
    )
    .execute(&state.db)
    .await?;

    // Clone what the background task needs BEFORE moving into the closure.
    let bg_state = state.clone();
    let bg_query = req.query.clone();
    let bg_server = req.server_id;
    let bg_spec = specialization.clone();

    tokio::spawn(async move {
        if let Err(e) = execute_spawn_pipeline(
            &bg_state, spawn_id, bg_server, bg_query, bg_spec,
        ).await {
            tracing::error!(spawn_id = %spawn_id, "Agent spawn failed: {e}");
            let _ = sqlx::query!(
                "UPDATE agent_spawn_log SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2",
                e.to_string(),
                spawn_id,
            )
            .execute(&bg_state.db)
            .await;
        }
    });

    Ok(Json(AgentSearchResponse {
        existing: false,
        channel: None,
        spawn: Some(SpawnRequestInfo {
            request_id: spawn_id,
            status: "provisioning".into(),
            inferred_specialization: format!("{:?}", specialization),
            confidence,
            estimated_ready_secs: 8,
        }),
        suggestions: vec![],
    }))
}

// ─── Spawn Pipeline (background task) ───────────────────────────────────

async fn execute_spawn_pipeline(
    state: &AppState,
    spawn_id: Uuid,
    server_id: Uuid,
    topic: String,
    specialization: AgentSpecialization,
) -> Result<(), AppError> {
    // Step 1: Generate identity keys.
    set_spawn_status(state, spawn_id, "generating_keys").await?;
    let agent_id = Uuid::new_v4();
    let (id_keys, ka_keys) = generate_agent_keys()?;
    let fingerprint = compute_fingerprint(&id_keys.public);
    let display_name = make_agent_name(&specialization, &topic);

    // Step 2: Persist agent record.
    set_spawn_status(state, spawn_id, "provisioning").await?;
    let runtime_cfg = build_runtime_config(&specialization, &state.config);
    let safety_cfg = build_safety_config(&specialization);

    sqlx::query!(
        "INSERT INTO agents
            (id, display_name, specialization, status, identity_public_key,
             key_agreement_public_key, fingerprint, runtime_config, safety_config)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8)",
        agent_id,
        display_name,
        serde_json::to_value(&specialization)?,
        &id_keys.public,
        &ka_keys.public,
        &fingerprint,
        serde_json::to_value(&runtime_cfg)?,
        serde_json::to_value(&safety_cfg)?,
    )
    .execute(&state.db)
    .await?;

    // Step 3: Upload MLS KeyPackages.
    set_spawn_status(state, spawn_id, "uploading_key_packages").await?;
    let packages = generate_key_packages(&id_keys, &ka_keys, 100)?;
    for kp in &packages {
        sqlx::query!(
            "INSERT INTO agent_key_packages (agent_id, key_package) VALUES ($1, $2)",
            agent_id, kp,
        )
        .execute(&state.db)
        .await?;
    }

    // Step 4: Create channel.
    let channel_id = Uuid::new_v4();
    let channel_name = make_channel_slug(&topic);
    sqlx::query!(
        "INSERT INTO channels (id, server_id, name, channel_type, topic)
         VALUES ($1, $2, $3, 'text', $4)",
        channel_id, server_id, channel_name, topic,
    )
    .execute(&state.db)
    .await?;

    // Step 5: Initialize MLS group and add agent.
    set_spawn_status(state, spawn_id, "joining_group").await?;
    let mls_group_id = init_mls_group(state, channel_id, agent_id, &id_keys, &ka_keys).await?;

    // Step 6: Bind agent to channel.
    sqlx::query!(
        "INSERT INTO agent_channels (agent_id, channel_id, server_id, mls_group_id, topic)
         VALUES ($1, $2, $3, $4, $5)",
        agent_id, channel_id, server_id, &mls_group_id, topic,
    )
    .execute(&state.db)
    .await?;

    // Step 7: Mark complete.
    sqlx::query!(
        "UPDATE agent_spawn_log
         SET status = 'ready', agent_id = $1, channel_id = $2, completed_at = NOW()
         WHERE id = $3",
        agent_id, channel_id, spawn_id,
    )
    .execute(&state.db)
    .await?;

    state.ws_broadcast(server_id, serde_json::json!({
        "type": "agent_channel_created",
        "channel_id": channel_id,
        "agent": { "id": agent_id, "display_name": display_name },
        "topic": topic,
    })).await;

    tracing::info!(
        agent_id = %agent_id, channel_id = %channel_id,
        "Agent spawned: {} ({:?})", display_name, specialization
    );
    Ok(())
}

// ─── GET /agents/spawn/:id/status ───────────────────────────────────────

pub async fn get_spawn_status(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(spawn_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        "SELECT id, status, inferred_specialization, confidence,
                agent_id, channel_id, error_message, created_at, completed_at
         FROM agent_spawn_log
         WHERE id = $1 AND requesting_user_id = $2",
        spawn_id, auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound("Spawn request not found".into()))?;

    Ok(Json(serde_json::json!({
        "id": row.id,
        "status": row.status,
        "specialization": row.inferred_specialization,
        "confidence": row.confidence,
        "agent_id": row.agent_id,
        "channel_id": row.channel_id,
        "error": row.error_message,
        "created_at": row.created_at,
        "completed_at": row.completed_at,
    })))
}

// ─── GET /servers/:id/agents ────────────────────────────────────────────

pub async fn list_agents(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT a.id, a.display_name, a.specialization, a.status, a.fingerprint,
                a.created_at, COUNT(ac.channel_id) as channel_count
         FROM agents a
         JOIN agent_channels ac ON a.id = ac.agent_id
         WHERE ac.server_id = $1 AND ac.archived = false
         GROUP BY a.id
         ORDER BY a.created_at DESC",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let agents: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "id": r.id,
        "display_name": r.display_name,
        "specialization": r.specialization,
        "status": r.status,
        "fingerprint": r.fingerprint,
        "created_at": r.created_at,
        "channel_count": r.channel_count,
    })).collect();

    Ok(Json(agents))
}

// ─── Helper: Spawn Status ───────────────────────────────────────────────

async fn set_spawn_status(state: &AppState, id: Uuid, status: &str) -> Result<(), AppError> {
    sqlx::query!("UPDATE agent_spawn_log SET status = $1 WHERE id = $2", status, id)
        .execute(&state.db)
        .await?;
    Ok(())
}

// ─── Naming Helpers ─────────────────────────────────────────────────────

fn make_agent_name(spec: &AgentSpecialization, topic: &str) -> String {
    let prefix = match spec {
        AgentSpecialization::Legal { .. }        => "Citadel Legal",
        AgentSpecialization::Medical { .. }      => "Citadel Health",
        AgentSpecialization::Security { .. }     => "Citadel Security",
        AgentSpecialization::Engineering { .. }  => "Citadel Dev",
        AgentSpecialization::Financial { .. }    => "Citadel Finance",
        AgentSpecialization::Research { .. }     => "Citadel Research",
        AgentSpecialization::Creative { .. }     => "Citadel Creative",
        AgentSpecialization::Translation { .. }  => "Citadel Translator",
        AgentSpecialization::General             => "Citadel Assistant",
        AgentSpecialization::Custom { name, .. } => return format!("Citadel {name} — {topic}"),
    };
    format!("{prefix} — {topic}")
}

fn make_channel_slug(topic: &str) -> String {
    let slug: String = topic.to_lowercase().chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { '-' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    format!("ai-{slug}")
}

// ─── Config Builders ────────────────────────────────────────────────────

fn build_runtime_config(spec: &AgentSpecialization, config: &Config) -> AgentRuntimeConfig {
    let model_id = match spec {
        AgentSpecialization::Legal { .. }
        | AgentSpecialization::Medical { .. }
        | AgentSpecialization::Financial { .. } => "llama-3.1-70b-instruct",
        AgentSpecialization::Engineering { .. }
        | AgentSpecialization::Security { .. } => "codestral-22b",
        _ => "llama-3.1-8b-instruct",
    };

    AgentRuntimeConfig {
        backend: LLMBackend::CitadelCloud {
            endpoint: config.agent_llm_endpoint.clone().unwrap_or_default(),
            api_version: "v1".into(),
        },
        model_id: model_id.into(),
        temperature: 0.7,
        max_context_tokens: 8192,
        system_prompt: make_system_prompt(spec),
        rag_enabled: matches!(
            spec,
            AgentSpecialization::Legal { .. }
            | AgentSpecialization::Medical { .. }
            | AgentSpecialization::Security { .. }
        ),
        rag_store_id: None,
    }
}

fn build_safety_config(spec: &AgentSpecialization) -> SafetyConfig {
    let mut cfg = SafetyConfig::default();
    match spec {
        AgentSpecialization::Legal { .. } => {
            cfg.disclaimer = Some("This is legal information, not legal advice.".into());
        }
        AgentSpecialization::Medical { .. } => {
            cfg.disclaimer = Some("This is health information, not medical advice.".into());
            cfg.blocked_topics.push("prescription_dosages".into());
        }
        AgentSpecialization::Security { .. } => {
            cfg.code_execution_enabled = true;
            cfg.web_search_enabled = true;
        }
        AgentSpecialization::Engineering { .. } => {
            cfg.code_execution_enabled = true;
            cfg.max_response_tokens = 8192;
        }
        _ => {}
    }
    cfg
}

fn make_system_prompt(spec: &AgentSpecialization) -> String {
    match spec {
        AgentSpecialization::Legal { jurisdiction } => format!(
            "You are a legal information specialist within Citadel, an E2EE platform. \
             You provide accurate legal information{}. \
             Never provide specific legal advice. Always recommend consulting an attorney.",
            jurisdiction.as_deref().map_or(String::new(), |j| format!(" focused on {j} law"))
        ),
        AgentSpecialization::Security { focus } => format!(
            "You are a cybersecurity specialist within Citadel, focused on {focus:?}. \
             You help analyze threats and review security configurations. \
             Discuss offensive techniques only for defensive awareness."
        ),
        AgentSpecialization::Engineering { languages } => {
            let lang_note = if languages.is_empty() {
                String::new()
            } else {
                format!(", with expertise in {}", languages.join(", "))
            };
            format!(
                "You are a software engineering specialist within Citadel. \
                 You provide code reviews, architecture guidance, and debugging help{lang_note}."
            )
        }
        _ => "You are a helpful AI assistant within Citadel, an E2EE platform. \
              The server cannot read our messages.".into(),
    }
}

// ─── Crypto Stubs ───────────────────────────────────────────────────────
//
// These return placeholder values for the alpha. Each is tracked by a
// GitHub issue number. In production, they use ed25519-dalek, x25519-dalek,
// and openmls crates respectively.

/// Generate Ed25519 (signing) + X25519 (key agreement) keypairs.
/// Tracked: https://github.com/CitadelOpenSource/Discreet/issues/1
fn generate_agent_keys() -> Result<(KeyPair, KeyPair), AppError> {
    // Alpha stub: 32-byte random keys for structural testing.
    use rand::RngCore;
    let mut rng = rand::thread_rng();

    let mut id_pub = vec![0u8; 32];
    let mut id_sec = vec![0u8; 64];
    let mut ka_pub = vec![0u8; 32];
    let mut ka_sec = vec![0u8; 32];
    rng.fill_bytes(&mut id_pub);
    rng.fill_bytes(&mut id_sec);
    rng.fill_bytes(&mut ka_pub);
    rng.fill_bytes(&mut ka_sec);

    Ok((
        KeyPair { public: id_pub, secret: id_sec },
        KeyPair { public: ka_pub, secret: ka_sec },
    ))
}

/// SHA-256 fingerprint of a public key, formatted as colon-separated hex.
/// Tracked: https://github.com/CitadelOpenSource/Discreet/issues/2
fn compute_fingerprint(public_key: &[u8]) -> String {
    use sha2::{Sha256, Digest};
    let hash = Sha256::digest(public_key);
    hash.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":")
}

/// Generate MLS KeyPackages for an agent.
/// Tracked: https://github.com/CitadelOpenSource/Discreet/issues/3
fn generate_key_packages(
    _identity: &KeyPair,
    _key_agreement: &KeyPair,
    count: u32,
) -> Result<Vec<Vec<u8>>, AppError> {
    // Alpha stub: generate empty placeholder packages.
    Ok((0..count).map(|i| format!("kp-placeholder-{i}").into_bytes()).collect())
}

/// Initialize an MLS group and add the agent as first member.
/// Tracked: https://github.com/CitadelOpenSource/Discreet/issues/4
async fn init_mls_group(
    _state: &AppState,
    _channel_id: Uuid,
    _agent_id: Uuid,
    _identity: &KeyPair,
    _key_agreement: &KeyPair,
) -> Result<Vec<u8>, AppError> {
    // Alpha stub: return a random group ID.
    Ok(Uuid::new_v4().as_bytes().to_vec())
}

// ─── Route Registration ─────────────────────────────────────────────────

/// Construct the agent sub-router. Merged into the main router by citadel_router.rs.
pub fn agent_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/agents/search", post(search_or_spawn))
        .route("/agents/spawn/{id}/status", get(get_spawn_status))
        .route("/servers/{id}/agents", get(list_agents))
}
