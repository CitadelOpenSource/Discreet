// citadel_ban_handlers.rs — Server ban management.
//
// Endpoints:
//   POST   /servers/{id}/bans           — Ban a member (requires BAN_MEMBERS)
//   DELETE /servers/{id}/bans/{user_id}  — Unban a user (requires BAN_MEMBERS)
//   GET    /servers/{id}/bans           — List banned users (requires BAN_MEMBERS)
//
// Banning a user:
//   1. Verifies the caller has BAN_MEMBERS permission
//   2. Prevents banning the server owner
//   3. Removes the user from server_members (+ role assignments) in a transaction
//   4. Inserts a record into server_bans
//   5. Broadcasts a MEMBER_BANNED WebSocket event
//
// Banned users cannot rejoin via invite until unbanned.

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_audit::log_action;
use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_permissions::{require_permission, Permission};
use crate::citadel_state::AppState;

// ── Request / Response types ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BanRequest {
    pub user_id: Uuid,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BanEntry {
    pub id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub banned_by: Uuid,
    pub reason: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

// ── Handlers ────────────────────────────────────────────────────────────

/// POST /servers/{id}/bans — Ban a member from the server.
pub async fn ban_member(
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<BanRequest>,
) -> Result<impl IntoResponse, AppError> {
    // 1. Caller must have BAN_MEMBERS permission.
    require_permission(&state, server_id, auth.user_id, Permission::BAN_MEMBERS).await?;

    // 2. Cannot ban the server owner.
    let is_target_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id,
        req.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if is_target_owner {
        return Err(AppError::BadRequest("Cannot ban the server owner".into()));
    }

    // 3. Target must be a member.
    let is_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server_id,
        req.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_member {
        return Err(AppError::NotFound("User is not a member of this server".into()));
    }

    // 4. Check if already banned.
    let already_banned = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_bans WHERE server_id = $1 AND user_id = $2)",
        server_id,
        req.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if already_banned {
        return Err(AppError::Conflict("User is already banned".into()));
    }

    let ban_id = Uuid::new_v4();
    let reason_text = req.reason.as_deref();

    // 5. Remove from members + insert ban in a transaction.
    let mut tx = state.db.begin().await?;

    // Remove all role assignments for this user in this server.
    sqlx::query!(
        "DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2",
        server_id,
        req.user_id,
    )
    .execute(&mut *tx)
    .await?;

    // Remove membership.
    sqlx::query!(
        "DELETE FROM server_members WHERE server_id = $1 AND user_id = $2",
        server_id,
        req.user_id,
    )
    .execute(&mut *tx)
    .await?;

    // Insert ban record.
    sqlx::query!(
        "INSERT INTO server_bans (id, server_id, user_id, banned_by, reason)
         VALUES ($1, $2, $3, $4, $5)",
        ban_id,
        server_id,
        req.user_id,
        auth.user_id,
        reason_text,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    log_action(
        &state.db,
        server_id,
        auth.user_id,
        "MEMBER_BAN",
        Some("user"),
        Some(req.user_id),
        None,
        reason_text,
    )
    .await
    .ok();

    // 6. Broadcast event to all connected clients.
    state.ws_broadcast(server_id, serde_json::json!({
        "type": "MEMBER_BANNED",
        "server_id": server_id,
        "user_id": req.user_id,
        "banned_by": auth.user_id,
    })).await;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(serde_json::json!({
            "id": ban_id,
            "server_id": server_id,
            "user_id": req.user_id,
            "banned_by": auth.user_id,
            "reason": reason_text,
        })),
    ))
}

/// DELETE /servers/{id}/bans/{user_id} — Unban a user.
pub async fn unban_member(
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::BAN_MEMBERS).await?;

    let result = sqlx::query!(
        "DELETE FROM server_bans WHERE server_id = $1 AND user_id = $2",
        server_id,
        user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("User is not banned".into()));
    }

    log_action(
        &state.db,
        server_id,
        auth.user_id,
        "MEMBER_UNBAN",
        Some("user"),
        Some(user_id),
        None,
        None,
    )
    .await
    .ok();

    state.ws_broadcast(server_id, serde_json::json!({
        "type": "MEMBER_UNBANNED",
        "server_id": server_id,
        "user_id": user_id,
        "unbanned_by": auth.user_id,
    })).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /servers/{id}/bans — List all banned users.
pub async fn list_bans(
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::BAN_MEMBERS).await?;

    let bans = sqlx::query_as!(
        BanEntry,
        "SELECT sb.id, sb.user_id, u.username, sb.banned_by, sb.reason, sb.created_at
         FROM server_bans sb
         JOIN users u ON u.id = sb.user_id
         WHERE sb.server_id = $1
         ORDER BY sb.created_at DESC",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(bans))
}

// ── Routes ──────────────────────────────────────────────────────────────

pub fn ban_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/servers/{id}/bans", post(ban_member))
        .route("/servers/{id}/bans", get(list_bans))
        .route("/servers/{id}/bans/{user_id}", delete(unban_member))
}
