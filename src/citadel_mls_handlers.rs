// citadel_mls_handlers.rs — MLS Key Distribution Service
//
// Handles the server-side relay for MLS protocol messages:
//   POST   /api/v1/key-packages              — Upload KeyPackages (batch)
//   GET    /api/v1/key-packages/:user_id     — Claim a KeyPackage (atomic)
//   POST   /api/v1/channels/:id/mls/commit   — Submit MLS Commit
//   POST   /api/v1/channels/:id/mls/welcome  — Relay Welcome to new member
//   GET    /api/v1/channels/:id/mls/info     — Get group metadata
//   POST   /api/v1/identity-keys             — Upload identity public keys
//
// The server NEVER decrypts anything. It relays opaque blobs between clients.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

// ── Request/Response Types ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UploadKeyPackagesRequest {
    /// Base64-encoded MLS KeyPackages
    pub key_packages: Vec<String>,
}

#[derive(Serialize)]
pub struct UploadKeyPackagesResponse {
    pub uploaded: usize,
}

#[derive(Serialize)]
pub struct ClaimKeyPackageResponse {
    /// Base64-encoded MLS KeyPackage
    pub key_package: String,
    pub key_package_id: Uuid,
}

#[derive(Deserialize)]
pub struct SubmitCommitRequest {
    /// Base64-encoded MLS Commit message
    pub commit: String,
    pub epoch: i64,
}

#[derive(Deserialize)]
pub struct RelayWelcomeRequest {
    /// Base64-encoded MLS Welcome message
    pub welcome: String,
    /// User ID of the new member
    pub target_user_id: Uuid,
}

#[derive(Deserialize)]
pub struct UploadIdentityKeyRequest {
    /// Base64-encoded Ed25519 public signing key
    pub signing_key: String,
    /// Base64-encoded X25519 public identity key
    pub identity_key: String,
    /// Device identifier (default: "primary")
    pub device_id: Option<String>,
}

#[derive(Serialize)]
pub struct MlsChannelInfo {
    pub channel_id: Uuid,
    pub mls_version: i32,
    pub mls_epoch: i64,
    pub pending_welcomes: i64,
}

// ── POST /api/v1/key-packages ───────────────────────────────────────────

pub async fn upload_key_packages(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UploadKeyPackagesRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.key_packages.is_empty() {
        return Err(AppError::BadRequest("No KeyPackages provided".into()));
    }
    if req.key_packages.len() > 100 {
        return Err(AppError::BadRequest("Maximum 100 KeyPackages per upload".into()));
    }

    let mut count = 0;
    for kp_b64 in &req.key_packages {
        let kp_bytes = base64_decode(kp_b64)?;
        sqlx::query!(
            "INSERT INTO key_packages (user_id, key_package) VALUES ($1, $2)",
            auth.user_id,
            &kp_bytes,
        )
        .execute(&state.db)
        .await?;
        count += 1;
    }

    tracing::info!(
        user_id = %auth.user_id,
        count = count,
        "KeyPackages uploaded"
    );

    Ok((StatusCode::CREATED, Json(UploadKeyPackagesResponse { uploaded: count })))
}

// ── GET /api/v1/key-packages/:user_id ───────────────────────────────────

pub async fn claim_key_package(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(target_user_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Atomically claim an unclaimed KeyPackage (FOR UPDATE SKIP LOCKED)
    let row = sqlx::query!(
        "UPDATE key_packages SET claimed = TRUE, claimed_by = $1, claimed_at = NOW()
         WHERE id = (
             SELECT id FROM key_packages
             WHERE user_id = $2 AND claimed = FALSE
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id, key_package",
        auth.user_id,
        target_user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(
        format!("No available KeyPackages for user {}", target_user_id)
    ))?;

    tracing::info!(
        claimer = %auth.user_id,
        target = %target_user_id,
        kp_id = %row.id,
        "KeyPackage claimed"
    );

    Ok(Json(ClaimKeyPackageResponse {
        key_package: base64_encode(&row.key_package),
        key_package_id: row.id,
    }))
}

// ── POST /api/v1/channels/:id/mls/commit ────────────────────────────────

pub async fn submit_commit(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SubmitCommitRequest>,
) -> Result<impl IntoResponse, AppError> {
    let commit_bytes = base64_decode(&req.commit)?;

    // Store the commit for offline members
    sqlx::query!(
        "INSERT INTO mls_commits (channel_id, author_id, commit_data, epoch)
         VALUES ($1, $2, $3, $4)",
        channel_id,
        auth.user_id,
        &commit_bytes,
        req.epoch,
    )
    .execute(&state.db)
    .await?;

    // Update the channel's MLS epoch
    sqlx::query!(
        "UPDATE channels SET mls_epoch = $1, mls_version = 1, updated_at = NOW()
         WHERE id = $2",
        req.epoch,
        channel_id,
    )
    .execute(&state.db)
    .await?;

    // Broadcast the commit via WebSocket to all channel members
    // (They need to process it to update their local group state)
    let ws_msg = serde_json::json!({
        "type": "mls_commit",
        "channel_id": channel_id,
        "author_id": auth.user_id,
        "commit": req.commit,
        "epoch": req.epoch,
    });

    if let Some(tx) = state.ws_buses.read().await.get(&channel_id) {
        let _ = tx.send(ws_msg.to_string());
    }

    tracing::info!(
        channel = %channel_id,
        author = %auth.user_id,
        epoch = req.epoch,
        "MLS Commit submitted"
    );

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /api/v1/channels/:id/mls/welcome ───────────────────────────────

pub async fn relay_welcome(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<RelayWelcomeRequest>,
) -> Result<impl IntoResponse, AppError> {
    let welcome_bytes = base64_decode(&req.welcome)?;

    // Store the Welcome for the target user
    sqlx::query!(
        "INSERT INTO mls_welcomes (channel_id, target_id, welcome)
         VALUES ($1, $2, $3)",
        channel_id,
        req.target_user_id,
        &welcome_bytes,
    )
    .execute(&state.db)
    .await?;

    // Notify the target user via WebSocket (if online)
    let ws_msg = serde_json::json!({
        "type": "mls_welcome",
        "channel_id": channel_id,
        "from_user_id": auth.user_id,
        "welcome": req.welcome,
    });

    // Send directly to the target user's WS connection
    // (This would use a user-specific WS channel in production)
    if let Some(tx) = state.ws_buses.read().await.get(&channel_id) {
        let _ = tx.send(ws_msg.to_string());
    }

    tracing::info!(
        channel = %channel_id,
        from = %auth.user_id,
        target = %req.target_user_id,
        "MLS Welcome relayed"
    );

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /api/v1/channels/:id/mls/info ───────────────────────────────────

pub async fn mls_channel_info(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let channel = sqlx::query!(
        "SELECT mls_version, mls_epoch FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    let pending = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM mls_welcomes WHERE channel_id = $1 AND target_id = $2 AND processed = FALSE",
        channel_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    Ok(Json(MlsChannelInfo {
        channel_id,
        mls_version: channel.mls_version,
        mls_epoch: channel.mls_epoch,
        pending_welcomes: pending,
    }))
}

// ── POST /api/v1/identity-keys ──────────────────────────────────────────

pub async fn upload_identity_key(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UploadIdentityKeyRequest>,
) -> Result<impl IntoResponse, AppError> {
    let signing_key = base64_decode(&req.signing_key)?;
    let identity_key = base64_decode(&req.identity_key)?;
    let device_id = req.device_id.unwrap_or_else(|| "primary".to_string());

    sqlx::query!(
        "INSERT INTO identity_keys (user_id, device_id, signing_key, identity_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, device_id) DO UPDATE SET
            signing_key = EXCLUDED.signing_key,
            identity_key = EXCLUDED.identity_key,
            uploaded_at = NOW()",
        auth.user_id,
        device_id,
        &signing_key,
        &identity_key,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        user_id = %auth.user_id,
        device = %device_id,
        "Identity key uploaded"
    );

    Ok(StatusCode::NO_CONTENT)
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn base64_decode(s: &str) -> Result<Vec<u8>, AppError> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| AppError::BadRequest(format!("Invalid base64: {e}")))
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

// ── Route Registration ──────────────────────────────────────────────────

pub fn mls_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/key-packages", post(upload_key_packages))
        .route("/key-packages/{user_id}", get(claim_key_package))
        .route("/channels/{channel_id}/mls/commit", post(submit_commit))
        .route("/channels/{channel_id}/mls/welcome", post(relay_welcome))
        .route("/channels/{channel_id}/mls/info", get(mls_channel_info))
        .route("/identity-keys", post(upload_identity_key))
}
