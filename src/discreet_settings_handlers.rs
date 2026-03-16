use axum::{extract::{Json, Path, State}, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

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
    pub timezone: String,
    pub show_read_receipts: bool,
    pub show_typing_indicator: bool,
    pub show_link_previews: bool,
    pub dnd_enabled: bool,
    pub dnd_start: String,
    pub dnd_end: String,
    pub dnd_days: String,
    pub sound_dm: String,
    pub sound_server: String,
    pub sound_mention: String,
    pub message_density: String,
    pub chat_font_size: i32,
    pub default_status: String,
    pub suppress_all_everyone: bool,
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
    pub timezone: Option<String>,
    pub show_read_receipts: Option<bool>,
    pub show_typing_indicator: Option<bool>,
    pub show_link_previews: Option<bool>,
    pub dnd_enabled: Option<bool>,
    pub dnd_start: Option<String>,
    pub dnd_end: Option<String>,
    pub dnd_days: Option<String>,
    pub sound_dm: Option<String>,
    pub sound_server: Option<String>,
    pub sound_mention: Option<String>,
    pub message_density: Option<String>,
    pub chat_font_size: Option<i32>,
    pub default_status: Option<String>,
    pub suppress_all_everyone: Option<bool>,
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
        "SELECT user_id, theme, font_size, compact_mode, show_embeds, dm_privacy, friend_request_privacy, notification_level, show_shared_servers, timezone, show_read_receipts, show_typing_indicator, show_link_previews, dnd_enabled, dnd_start, dnd_end, dnd_days, sound_dm, sound_server, sound_mention, message_density, chat_font_size, default_status, suppress_all_everyone, updated_at
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
        timezone: row.timezone,
        show_read_receipts: row.show_read_receipts,
        show_typing_indicator: row.show_typing_indicator,
        show_link_previews: row.show_link_previews,
        dnd_enabled: row.dnd_enabled,
        dnd_start: row.dnd_start,
        dnd_end: row.dnd_end,
        dnd_days: row.dnd_days,
        sound_dm: row.sound_dm,
        sound_server: row.sound_server,
        sound_mention: row.sound_mention,
        message_density: row.message_density,
        chat_font_size: row.chat_font_size,
        default_status: row.default_status,
        suppress_all_everyone: row.suppress_all_everyone,
        updated_at: row.updated_at.to_rfc3339(),
    }))
}

pub async fn patch_my_settings(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateUserSettingsRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate string inputs
    if let Some(ref tz) = req.timezone {
        if tz.len() > 64 || tz.chars().any(|c| c.is_control()) {
            return Err(AppError::BadRequest("Invalid timezone value".into()));
        }
    }
    if let Some(ref theme) = req.theme {
        if !matches!(theme.as_str(), "dark" | "light" | "onyx" | "midnight") {
            return Err(AppError::BadRequest("Theme must be dark, light, onyx, or midnight".into()));
        }
    }
    if let Some(ref fs) = req.font_size {
        if !matches!(fs.as_str(), "small" | "medium" | "large" | "xl") {
            return Err(AppError::BadRequest("Font size must be small, medium, large, or xl".into()));
        }
    }
    if let Some(ref density) = req.message_density {
        if !matches!(density.as_str(), "comfortable" | "compact" | "cozy") {
            return Err(AppError::BadRequest("Message density must be comfortable, compact, or cozy".into()));
        }
    }
    if let Some(cfs) = req.chat_font_size {
        if !(12..=20).contains(&cfs) {
            return Err(AppError::BadRequest("Chat font size must be 12-20".into()));
        }
    }

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
             timezone = COALESCE($9, timezone),
             show_read_receipts = COALESCE($10, show_read_receipts),
             show_typing_indicator = COALESCE($11, show_typing_indicator),
             show_link_previews = COALESCE($12, show_link_previews),
             dnd_enabled = COALESCE($13, dnd_enabled),
             dnd_start = COALESCE($14, dnd_start),
             dnd_end = COALESCE($15, dnd_end),
             dnd_days = COALESCE($16, dnd_days),
             sound_dm = COALESCE($17, sound_dm),
             sound_server = COALESCE($18, sound_server),
             sound_mention = COALESCE($19, sound_mention),
             message_density = COALESCE($20, message_density),
             chat_font_size = COALESCE($21, chat_font_size),
             default_status = COALESCE($22, default_status),
             suppress_all_everyone = COALESCE($23, suppress_all_everyone),
             updated_at = NOW()
         WHERE user_id = $24
         RETURNING user_id, theme, font_size, compact_mode, show_embeds, dm_privacy, friend_request_privacy, notification_level, show_shared_servers, timezone, show_read_receipts, show_typing_indicator, show_link_previews, dnd_enabled, dnd_start, dnd_end, dnd_days, sound_dm, sound_server, sound_mention, message_density, chat_font_size, default_status, suppress_all_everyone, updated_at",
        req.theme,
        req.font_size,
        req.compact_mode,
        req.show_embeds,
        req.dm_privacy,
        req.friend_request_privacy,
        req.notification_level,
        req.show_shared_servers,
        req.timezone,
        req.show_read_receipts,
        req.show_typing_indicator,
        req.show_link_previews,
        req.dnd_enabled,
        req.dnd_start,
        req.dnd_end,
        req.dnd_days,
        req.sound_dm,
        req.sound_server,
        req.sound_mention,
        req.message_density,
        req.chat_font_size,
        req.default_status,
        req.suppress_all_everyone,
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
        timezone: row.timezone,
        show_read_receipts: row.show_read_receipts,
        show_typing_indicator: row.show_typing_indicator,
        show_link_previews: row.show_link_previews,
        dnd_enabled: row.dnd_enabled,
        dnd_start: row.dnd_start,
        dnd_end: row.dnd_end,
        dnd_days: row.dnd_days,
        sound_dm: row.sound_dm,
        sound_server: row.sound_server,
        sound_mention: row.sound_mention,
        message_density: row.message_density,
        chat_font_size: row.chat_font_size,
        default_status: row.default_status,
        suppress_all_everyone: row.suppress_all_everyone,
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

#[derive(Debug, Deserialize)]
pub struct SetTimezoneRequest {
    pub timezone: String,
}

/// POST /settings/timezone — save the user's IANA timezone.
pub async fn set_timezone(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<SetTimezoneRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.timezone.len() > 64 || req.timezone.chars().any(|c| c.is_control()) {
        return Err(AppError::BadRequest("Invalid timezone value".into()));
    }

    sqlx::query!(
        "INSERT INTO user_settings (user_id, timezone) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET timezone = $2, updated_at = NOW()",
        auth.user_id,
        req.timezone,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "timezone": req.timezone })))
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
