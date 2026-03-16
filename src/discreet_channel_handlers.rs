// discreet_channel_handlers.rs — Channel CRUD within servers.
//
// Channels live inside servers. Types: text, voice, announcement.
// Each channel has an optional MLS group for E2EE.
//
// Endpoints:
//   POST   /servers/:server_id/channels           — Create channel
//   GET    /servers/:server_id/channels           — List channels
//   GET    /channels/:id                          — Get channel details
//   PATCH  /channels/:id                          — Update channel
//   DELETE /channels/:id                          — Delete channel

use axum::{
    extract::{Path, State, Json},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_audit::{log_action, AuditEntry};
use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{
    require_permission,
    PERM_MANAGE_CHANNELS,
    PERM_VIEW_CHANNEL,
};
use crate::discreet_state::AppState;

// ─── Request Types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    /// Channel name, 1-128 chars.
    pub name: String,
    /// Optional topic / description.
    pub topic: Option<String>,
    /// "text" (default), "voice", or "announcement".
    #[serde(default = "default_channel_type")]
    pub channel_type: String,
    /// Optional category to place channel in.
    pub category_id: Option<Uuid>,
    /// Mark channel as NSFW (skips bad-word filter in AutoMod).
    #[serde(default)]
    pub nsfw: bool,
}

fn default_channel_type() -> String { "text".into() }

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub position: Option<i32>,
    pub locked: Option<bool>,
    pub min_role_position: Option<i32>,
    pub slowmode_seconds: Option<i32>,
    pub nsfw: Option<bool>,
    pub message_ttl_seconds: Option<i64>,
    pub message_retention_days: Option<Option<i32>>,
    pub disappearing_messages: Option<Option<String>>,
    pub ai_model_override: Option<Option<String>>,
    pub thread_auto_archive_days: Option<i32>,
    pub read_only: Option<bool>,
}

// ─── Response Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ChannelInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub topic: Option<String>,
    pub channel_type: String,
    pub position: i32,
    pub locked: bool,
    pub min_role_position: i32,
    pub slowmode_seconds: i32,
    pub nsfw: bool,
    pub message_ttl_seconds: i64,
    pub message_retention_days: Option<i32>,
    pub disappearing_messages: Option<String>,
    pub ai_model_override: Option<String>,
    pub thread_auto_archive_days: i32,
    pub read_only: bool,
    pub created_at: String,
}

// ─── POST /servers/:server_id/channels ──────────────────────────────────

pub async fn create_channel(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateChannelRequest>,
) -> Result<impl IntoResponse, AppError> {
    // MANAGE_CHANNELS required.
    require_permission(&state, server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    // Validate name.
    let name = normalize_channel_name(&req.name);
    crate::discreet_input_validation::validate_channel_name(&name)?;

    // Validate channel type.
    let valid_types = ["text", "voice", "announcement"];
    if !valid_types.contains(&req.channel_type.as_str()) {
        return Err(AppError::BadRequest(
            format!("Channel type must be one of: {}", valid_types.join(", "))
        ));
    }

    // Get next position.
    let max_pos = sqlx::query_scalar!(
        "SELECT COALESCE(MAX(position), -1) FROM channels WHERE server_id = $1",
        server_id,
    )
    .fetch_one(&state.db)
    .await?;

    let position = max_pos.unwrap_or(-1) + 1;

    let channel_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO channels (id, server_id, name, topic, channel_type, position, nsfw)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        channel_id,
        server_id,
        name,
        req.topic,
        req.channel_type,
        position,
        req.nsfw,
    )
    .execute(&state.db)
    .await?;

    // Update server last_activity_at.
    let _ = sqlx::query!(
        "UPDATE servers SET last_activity_at = NOW() WHERE id = $1",
        server_id,
    )
    .execute(&state.db)
    .await;

    tracing::info!(
        channel_id = %channel_id,
        server_id = %server_id,
        name = %name,
        "Channel created"
    );

    log_action(
        &state.db,
        AuditEntry {
            server_id,
            actor_id: auth.user_id,
            action: "CHANNEL_CREATE",
            target_type: Some("channel"),
            target_id: Some(channel_id),
            changes: None,
            reason: None,
        },
    )
    .await
    .ok();

    Ok((StatusCode::CREATED, Json(ChannelInfo {
        id: channel_id,
        server_id,
        name,
        topic: req.topic,
        channel_type: req.channel_type,
        position,
        locked: false,
        min_role_position: 0,
        slowmode_seconds: 0,
        nsfw: req.nsfw,
        message_ttl_seconds: 0,
        message_retention_days: None,
        disappearing_messages: None,
        ai_model_override: None,
        thread_auto_archive_days: 7,
        read_only: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    })))
}

// ─── GET /servers/:server_id/channels ───────────────────────────────────

pub async fn list_channels(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, PERM_VIEW_CHANNEL).await?;

    let rows = sqlx::query!(
        "SELECT id, server_id, name, topic, channel_type, position,
                locked, min_role_position, slowmode_seconds, nsfw, message_ttl_seconds,
                message_retention_days, disappearing_messages, ai_model_override, thread_auto_archive_days, read_only, created_at
         FROM channels
         WHERE server_id = $1
         ORDER BY position, created_at",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let channels: Vec<ChannelInfo> = rows
        .into_iter()
        .map(|r| ChannelInfo {
            id: r.id,
            server_id: r.server_id,
            name: r.name,
            topic: r.topic,
            channel_type: r.channel_type,
            position: r.position,
            locked: r.locked,
            min_role_position: r.min_role_position,
            slowmode_seconds: r.slowmode_seconds,
            nsfw: r.nsfw,
            message_ttl_seconds: r.message_ttl_seconds,
            message_retention_days: r.message_retention_days,
            disappearing_messages: r.disappearing_messages.clone(),
            ai_model_override: r.ai_model_override,
            thread_auto_archive_days: r.thread_auto_archive_days,
            read_only: r.read_only,
            created_at: r.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(channels))
}

// ─── GET /channels/:id ─────────────────────────────────────────────────

pub async fn get_channel(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let channel = sqlx::query!(
        "SELECT id, server_id, name, topic, channel_type, position,
                locked, min_role_position, slowmode_seconds, nsfw, message_ttl_seconds,
                message_retention_days, disappearing_messages, ai_model_override, thread_auto_archive_days, read_only, created_at
         FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    // Must be allowed to view channels in this server.
    require_permission(&state, channel.server_id, auth.user_id, PERM_VIEW_CHANNEL).await?;

    Ok(Json(ChannelInfo {
        id: channel.id,
        server_id: channel.server_id,
        name: channel.name,
        topic: channel.topic,
        channel_type: channel.channel_type,
        position: channel.position,
        locked: channel.locked,
        min_role_position: channel.min_role_position,
        slowmode_seconds: channel.slowmode_seconds,
        nsfw: channel.nsfw,
        message_ttl_seconds: channel.message_ttl_seconds,
        message_retention_days: channel.message_retention_days,
        disappearing_messages: channel.disappearing_messages,
        ai_model_override: channel.ai_model_override,
        thread_auto_archive_days: channel.thread_auto_archive_days,
        read_only: channel.read_only,
        created_at: channel.created_at.to_rfc3339(),
    }))
}

// ─── PATCH /channels/:id ───────────────────────────────────────────────

pub async fn update_channel(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<UpdateChannelRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Look up channel to get server_id.
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    if let Some(ref name) = req.name {
        let name = normalize_channel_name(name);
        crate::discreet_input_validation::validate_channel_name(&name)?;
        sqlx::query!(
            "UPDATE channels SET name = $1, updated_at = NOW() WHERE id = $2",
            name, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref topic) = req.topic {
        sqlx::query!(
            "UPDATE channels SET topic = $1, updated_at = NOW() WHERE id = $2",
            topic, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(position) = req.position {
        sqlx::query!(
            "UPDATE channels SET position = $1, updated_at = NOW() WHERE id = $2",
            position, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(locked) = req.locked {
        sqlx::query!(
            "UPDATE channels SET locked = $1, updated_at = NOW() WHERE id = $2",
            locked, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(min_role_position) = req.min_role_position {
        sqlx::query!(
            "UPDATE channels SET min_role_position = $1, updated_at = NOW() WHERE id = $2",
            min_role_position, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(slowmode_seconds) = req.slowmode_seconds {
        sqlx::query!(
            "UPDATE channels SET slowmode_seconds = $1, updated_at = NOW() WHERE id = $2",
            slowmode_seconds, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(nsfw) = req.nsfw {
        sqlx::query!(
            "UPDATE channels SET nsfw = $1, updated_at = NOW() WHERE id = $2",
            nsfw, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(message_ttl_seconds) = req.message_ttl_seconds {
        sqlx::query!(
            "UPDATE channels SET message_ttl_seconds = $1, updated_at = NOW() WHERE id = $2",
            message_ttl_seconds, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref retention) = req.message_retention_days {
        sqlx::query!(
            "UPDATE channels SET message_retention_days = $1, updated_at = NOW() WHERE id = $2",
            *retention, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref disappearing) = req.disappearing_messages {
        sqlx::query!(
            "UPDATE channels SET disappearing_messages = $1, updated_at = NOW() WHERE id = $2",
            disappearing.as_deref() as Option<&str>, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref ai_model) = req.ai_model_override {
        sqlx::query!(
            "UPDATE channels SET ai_model_override = $1, updated_at = NOW() WHERE id = $2",
            ai_model.as_deref() as Option<&str>, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(read_only) = req.read_only {
        sqlx::query!(
            "UPDATE channels SET read_only = $1, updated_at = NOW() WHERE id = $2",
            read_only, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(days) = req.thread_auto_archive_days {
        sqlx::query!(
            "UPDATE channels SET thread_auto_archive_days = $1, updated_at = NOW() WHERE id = $2",
            days, channel_id,
        )
        .execute(&state.db)
        .await?;
    }

    // Audit log
    let changes = serde_json::json!({
        "name": req.name, "topic": req.topic.is_some(),
        "locked": req.locked, "min_role_position": req.min_role_position,
        "slowmode_seconds": req.slowmode_seconds, "nsfw": req.nsfw,
        "message_ttl_seconds": req.message_ttl_seconds, "position": req.position,
        "message_retention_days": req.message_retention_days,
        "disappearing_messages": req.disappearing_messages,
        "ai_model_override": req.ai_model_override,
    });
    let _ = log_action(
        &state.db,
        AuditEntry {
            server_id: channel.server_id,
            actor_id: auth.user_id,
            action: "UPDATE_CHANNEL",
            target_type: Some("channel"),
            target_id: Some(channel_id),
            changes: Some(changes),
            reason: None,
        },
    )
    .await;

    // Return updated channel.
    let updated = sqlx::query!(
        "SELECT id, server_id, name, topic, channel_type, position,
                locked, min_role_position, slowmode_seconds, nsfw, message_ttl_seconds,
                message_retention_days, disappearing_messages, ai_model_override, thread_auto_archive_days, read_only, created_at
         FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ChannelInfo {
        id: updated.id,
        server_id: updated.server_id,
        name: updated.name,
        topic: updated.topic,
        channel_type: updated.channel_type,
        position: updated.position,
        locked: updated.locked,
        min_role_position: updated.min_role_position,
        slowmode_seconds: updated.slowmode_seconds,
        nsfw: updated.nsfw,
        message_ttl_seconds: updated.message_ttl_seconds,
        message_retention_days: updated.message_retention_days,
        disappearing_messages: updated.disappearing_messages,
        ai_model_override: updated.ai_model_override,
        thread_auto_archive_days: updated.thread_auto_archive_days,
        read_only: updated.read_only,
        created_at: updated.created_at.to_rfc3339(),
    }))
}

// ─── DELETE /channels/:id ──────────────────────────────────────────────

pub async fn delete_channel(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let channel = sqlx::query!(
        "SELECT server_id, name FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    // Don't allow deleting the last channel.
    let channel_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM channels WHERE server_id = $1",
        channel.server_id,
    )
    .fetch_one(&state.db)
    .await?;

    if channel_count.unwrap_or(0) <= 1 {
        return Err(AppError::BadRequest(
            "Cannot delete the last channel in a server".into()
        ));
    }

    // CASCADE deletes messages in this channel.
    sqlx::query!("DELETE FROM channels WHERE id = $1", channel_id)
        .execute(&state.db)
        .await?;

    tracing::info!(
        channel_id = %channel_id,
        server_id = %channel.server_id,
        name = %channel.name,
        "Channel deleted"
    );

    log_action(
        &state.db,
        AuditEntry {
            server_id: channel.server_id,
            actor_id: auth.user_id,
            action: "CHANNEL_DELETE",
            target_type: Some("channel"),
            target_id: Some(channel_id),
            changes: None,
            reason: None,
        },
    )
    .await
    .ok();

    Ok(StatusCode::NO_CONTENT)
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Normalize a channel name: lowercase, replace spaces with hyphens, strip non-alphanumeric.
fn normalize_channel_name(name: &str) -> String {
    name.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c == ' ' { '-' } else { c })
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

// ─── Route Registration ─────────────────────────────────────────────────

pub fn channel_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, post, patch, delete};
    axum::Router::new()
        .route("/servers/{id}/channels", post(create_channel))
        .route("/servers/{id}/channels", get(list_channels))
        .route("/channels/{channel_id}", get(get_channel))
        .route("/channels/{channel_id}", patch(update_channel))
        .route("/channels/{channel_id}", delete(delete_channel))
}
