// citadel_dev_token_handlers.rs — Developer API token management.
//
// Allows authenticated users to generate long-lived API tokens for
// programmatic access. Tokens use a "dsk_" prefix for easy identification.
//
// SECURITY MODEL:
//   - A cryptographically random 32-byte token is generated with rand::thread_rng
//   - SHA-256 of the raw token is stored in dev_tokens.token_hash
//   - The plaintext token is returned ONCE in the creation response and never stored
//   - The first 8 chars ("dsk_XXXX") are stored as token_prefix for UI display
//
// Endpoints:
//   POST   /api/v1/dev/tokens       — Create a new token
//   GET    /api/v1/dev/tokens       — List all tokens for the caller
//   DELETE /api/v1/dev/tokens/:id   — Revoke a token

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_error::AppError;
use crate::citadel_platform_admin_handlers::require_staff_role;
use crate::citadel_platform_permissions::PlatformUser;
use crate::citadel_state::AppState;

// ─── Request / Response Types ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateTokenRequest {
    /// Human-readable label for this token (e.g. "CI pipeline", "Home server").
    pub name: String,
    /// Optional list of permission scopes. Empty = full account access.
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Optional RFC-3339 expiry. None = never expires.
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
pub struct TokenCreatedResponse {
    pub id: Uuid,
    pub token: String, // full plaintext — shown ONCE
    pub token_prefix: String,
    pub name: String,
    pub permissions: Vec<String>,
    pub created_at: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TokenSummary {
    pub id: Uuid,
    pub token_prefix: String,
    pub name: String,
    pub permissions: serde_json::Value,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub revoked: bool,
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/// Generate a `dsk_`-prefixed token from 32 random bytes encoded as hex.
/// Returns `(full_token, token_prefix, token_hash)`.
fn generate_token() -> (String, String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill(&mut bytes);
    let raw_hex = hex::encode(bytes);
    let full_token = format!("dsk_{raw_hex}");

    // Prefix = first 8 chars (includes "dsk_" + 4 hex chars)
    let token_prefix: String = full_token.chars().take(8).collect();

    // Hash the full token for storage
    let mut hasher = Sha256::new();
    hasher.update(full_token.as_bytes());
    let token_hash = hex::encode(hasher.finalize());

    (full_token, token_prefix, token_hash)
}

// ─── POST /dev/tokens ────────────────────────────────────────────────────

pub async fn create_token(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTokenRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest("Token name must be 1–100 characters".into()));
    }

    let permissions = serde_json::to_value(&req.permissions)
        .unwrap_or(serde_json::Value::Array(vec![]));

    let (full_token, token_prefix, token_hash) = generate_token();
    let id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO dev_tokens
               (id, user_id, token_hash, token_prefix, name, permissions, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        id,
        caller.user_id,
        token_hash,
        token_prefix,
        name,
        permissions,
        req.expires_at,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        user_id  = %caller.user_id,
        token_id = %id,
        prefix   = %token_prefix,
        "Developer API token created"
    );

    Ok((
        StatusCode::CREATED,
        Json(TokenCreatedResponse {
            id,
            token: full_token,
            token_prefix,
            name,
            permissions: req.permissions,
            created_at: chrono::Utc::now().to_rfc3339(),
            expires_at: req.expires_at.map(|t| t.to_rfc3339()),
        }),
    ))
}

// ─── GET /dev/tokens ─────────────────────────────────────────────────────

pub async fn list_tokens(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    let rows = sqlx::query!(
        r#"SELECT id, token_prefix, name, permissions, created_at, expires_at, revoked_at
           FROM dev_tokens
           WHERE user_id = $1
           ORDER BY created_at DESC"#,
        caller.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let tokens: Vec<TokenSummary> = rows
        .into_iter()
        .map(|r| TokenSummary {
            id: r.id,
            token_prefix: r.token_prefix,
            name: r.name,
            permissions: r.permissions.clone(),
            created_at: r.created_at.to_rfc3339(),
            expires_at: r.expires_at.map(|t| t.to_rfc3339()),
            revoked: r.revoked_at.is_some(),
        })
        .collect();

    Ok(Json(tokens))
}

// ─── DELETE /dev/tokens/:id ──────────────────────────────────────────────

pub async fn revoke_token(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(token_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    let result = sqlx::query!(
        r#"UPDATE dev_tokens
           SET revoked_at = NOW()
           WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL"#,
        token_id,
        caller.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Token not found or already revoked".into()));
    }

    tracing::info!(
        user_id  = %caller.user_id,
        token_id = %token_id,
        "Developer API token revoked"
    );

    Ok(StatusCode::NO_CONTENT)
}
