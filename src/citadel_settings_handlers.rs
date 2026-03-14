use axum::{extract::{Json, Path, State}, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

#[derive(Debug, Serialize)]
pub struct UserSettingsResponse {
    pub user_id: Uuid,
    pub theme: String,
    pub font_size: String,
    pub compact_mode: bool,
    pub show_embeds: bool,
    pub dm_privacy: String,
    pub friend_request_privacy: String,
    pub notification_level: String,
    pub show_shared_servers: bool,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserSettingsRequest {
    pub theme: Option<String>,
    pub font_size: Option<String>,
    pub compact_mode: Option<bool>,
    pub show_embeds: Option<bool>,
    pub dm_privacy: Option<String>,
    pub friend_request_privacy: Option<String>,
    pub notification_level: Option<String>,
    pub show_shared_servers: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ServerNotificationSettingsResponse {
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub muted: bool,
    pub mute_until: Option<String>,
    pub level: String,
    pub suppress_everyone: bool,
    pub event_reminders: bool,
    pub email_reminders: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerNotificationSettingsRequest {
    pub muted: Option<bool>,
    pub mute_until: Option<chrono::DateTime<chrono::Utc>>,
    pub level: Option<String>,
    pub suppress_everyone: Option<bool>,
    pub event_reminders: Option<bool>,
    pub email_reminders: Option<bool>,
}

pub async fn get_my_settings(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!(
        "INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query!(
        "SELECT user_id, theme, font_size, compact_mode, show_embeds, dm_privacy, friend_request_privacy, notification_level, show_shared_servers, updated_at
         FROM user_settings WHERE user_id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(UserSettingsResponse {
        user_id: row.user_id,
        theme: row.theme,
        font_size: row.font_size,
        compact_mode: row.compact_mode,
        show_embeds: row.show_embeds,
        dm_privacy: row.dm_privacy,
        friend_request_privacy: row.friend_request_privacy,
        notification_level: row.notification_level,
        show_shared_servers: row.show_shared_servers,
        updated_at: row.updated_at.to_rfc3339(),
    }))
}

pub async fn patch_my_settings(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateUserSettingsRequest>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!(
        "INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query!(
        "UPDATE user_settings
         SET theme = COALESCE($1, theme),
             font_size = COALESCE($2, font_size),
             compact_mode = COALESCE($3, compact_mode),
             show_embeds = COALESCE($4, show_embeds),
             dm_privacy = COALESCE($5, dm_privacy),
             friend_request_privacy = COALESCE($6, friend_request_privacy),
             notification_level = COALESCE($7, notification_level),
             show_shared_servers = COALESCE($8, show_shared_servers),
             updated_at = NOW()
         WHERE user_id = $9
         RETURNING user_id, theme, font_size, compact_mode, show_embeds, dm_privacy, friend_request_privacy, notification_level, show_shared_servers, updated_at",
        req.theme,
        req.font_size,
        req.compact_mode,
        req.show_embeds,
        req.dm_privacy,
        req.friend_request_privacy,
        req.notification_level,
        req.show_shared_servers,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(UserSettingsResponse {
        user_id: row.user_id,
        theme: row.theme,
        font_size: row.font_size,
        compact_mode: row.compact_mode,
        show_embeds: row.show_embeds,
        dm_privacy: row.dm_privacy,
        friend_request_privacy: row.friend_request_privacy,
        notification_level: row.notification_level,
        show_shared_servers: row.show_shared_servers,
        updated_at: row.updated_at.to_rfc3339(),
    }))
}

pub async fn get_server_notification_settings(
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    ensure_server_membership(&state, auth.user_id, server_id).await?;

    sqlx::query!(
        "INSERT INTO server_notification_settings (user_id, server_id) VALUES ($1, $2)
         ON CONFLICT (user_id, server_id) DO NOTHING",
        auth.user_id,
        server_id,
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query!(
        "SELECT user_id, server_id, muted, mute_until, level, suppress_everyone, event_reminders, email_reminders
         FROM server_notification_settings
         WHERE user_id = $1 AND server_id = $2",
        auth.user_id,
        server_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ServerNotificationSettingsResponse {
        user_id: row.user_id,
        server_id: row.server_id,
        muted: row.muted,
        mute_until: row.mute_until.map(|ts: chrono::DateTime<chrono::Utc>| ts.to_rfc3339()),
        level: row.level,
        suppress_everyone: row.suppress_everyone,
        event_reminders: row.event_reminders,
        email_reminders: row.email_reminders,
    }))
}

pub async fn patch_server_notification_settings(
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateServerNotificationSettingsRequest>,
) -> Result<impl IntoResponse, AppError> {
    ensure_server_membership(&state, auth.user_id, server_id).await?;

    sqlx::query!(
        "INSERT INTO server_notification_settings (user_id, server_id) VALUES ($1, $2)
         ON CONFLICT (user_id, server_id) DO NOTHING",
        auth.user_id,
        server_id,
    )
    .execute(&state.db)
    .await?;

    let row = sqlx::query!(
        "UPDATE server_notification_settings
         SET muted = COALESCE($1, muted),
             mute_until = COALESCE($2, mute_until),
             level = COALESCE($3, level),
             suppress_everyone = COALESCE($4, suppress_everyone),
             event_reminders = COALESCE($5, event_reminders),
             email_reminders = COALESCE($6, email_reminders)
         WHERE user_id = $7 AND server_id = $8
         RETURNING user_id, server_id, muted, mute_until, level, suppress_everyone, event_reminders, email_reminders",
        req.muted,
        req.mute_until,
        req.level,
        req.suppress_everyone,
        req.event_reminders,
        req.email_reminders,
        auth.user_id,
        server_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ServerNotificationSettingsResponse {
        user_id: row.user_id,
        server_id: row.server_id,
        muted: row.muted,
        mute_until: row.mute_until.map(|ts: chrono::DateTime<chrono::Utc>| ts.to_rfc3339()),
        level: row.level,
        suppress_everyone: row.suppress_everyone,
        event_reminders: row.event_reminders,
        email_reminders: row.email_reminders,
    }))
}

async fn ensure_server_membership(
    state: &Arc<AppState>,
    user_id: Uuid,
    server_id: Uuid,
) -> Result<(), AppError> {
    let row = sqlx::query!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE user_id = $1 AND server_id = $2) as \"is_member!\"",
        user_id,
        server_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !row.is_member {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    Ok(())
}
