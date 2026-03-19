// discreet_platform_settings.rs — Global platform kill switches.
//
// Endpoints:
//   GET  /api/v1/admin/settings  — Read all platform settings (admin/dev only).
//   PUT  /api/v1/admin/settings  — Update one or more settings (admin/dev only).
//
// Settings are cached in Redis with a 30-second TTL so handlers can check
// kill switches without hitting the database on every request.

use std::sync::Arc;

use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::discreet_error::AppError;
use crate::discreet_platform_admin_handlers::require_staff_role;
use crate::discreet_platform_permissions::PlatformUser;
use crate::discreet_state::AppState;

const REDIS_KEY: &str = "platform_settings";
const REDIS_TTL_SECS: u64 = 30;

/// All known platform settings with their typed values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformSettings {
    pub registrations_enabled: bool,
    pub logins_enabled: bool,
    pub guest_access_enabled: bool,
    pub ai_bots_enabled: bool,
    pub maintenance_mode: bool,
    pub maintenance_message: String,
    /// Global model override — when non-empty, all bots use this model instead of per-bot config.
    /// Values: "claude-haiku", "claude-sonnet", "ollama-local", or "" (per-bot default).
    pub ai_global_model: String,
    /// Global AI rate limit in messages per minute (0 = unlimited).
    pub ai_rate_limit_per_minute: u32,
    /// Emergency AI kill switch — immediately stops all bot responses.
    pub ai_emergency_stop: bool,
    /// Global default message retention in days (0 = forever).
    pub default_retention_days: u32,
    /// Global disappearing messages default: "off", "24h", "7d", "30d".
    pub global_disappearing_default: String,
    /// Official server ID — new users auto-join this server on registration.
    /// Empty string means disabled.
    pub official_server_id: String,
    /// Whether disappearing messages (TTL) feature is enabled platform-wide.
    /// When false, TTL PUT endpoints return 403 and background cleanup skips.
    pub disappearing_messages_enabled: bool,
    /// Email address to receive admin security alerts. Empty = disabled.
    pub admin_alert_email: String,
}

impl Default for PlatformSettings {
    fn default() -> Self {
        Self {
            registrations_enabled: true,
            logins_enabled: true,
            guest_access_enabled: true,
            ai_bots_enabled: true,
            maintenance_mode: false,
            maintenance_message: "The platform is undergoing scheduled maintenance. Please try again shortly.".into(),
            ai_global_model: String::new(),
            ai_rate_limit_per_minute: 0,
            ai_emergency_stop: false,
            default_retention_days: 0,
            global_disappearing_default: "off".into(),
            official_server_id: String::new(),
            disappearing_messages_enabled: true,
            admin_alert_email: String::new(),
        }
    }
}

// ─── Cached reader (used by handlers across the codebase) ───────────────────

/// Load platform settings, hitting Redis cache first, then falling back to DB.
pub async fn get_platform_settings(state: &AppState) -> Result<PlatformSettings, AppError> {
    // 1. Try Redis cache.
    let mut redis = state.redis.clone();
    let cached: Option<String> = redis::cmd("GET")
        .arg(REDIS_KEY)
        .query_async(&mut redis)
        .await
        .unwrap_or(None);

    if let Some(json_str) = cached {
        if let Ok(settings) = serde_json::from_str::<PlatformSettings>(&json_str) {
            return Ok(settings);
        }
    }

    // 2. Load from DB.
    let rows = sqlx::query!(
        "SELECT key, value FROM platform_settings"
    )
    .fetch_all(&state.db)
    .await?;

    let mut settings = PlatformSettings::default();
    for row in &rows {
        let k = row.key.as_str();
        let v = &row.value;
        match k {
            "registrations_enabled" => {
                settings.registrations_enabled = v.as_bool().unwrap_or(true);
            }
            "logins_enabled" => {
                settings.logins_enabled = v.as_bool().unwrap_or(true);
            }
            "guest_access_enabled" => {
                settings.guest_access_enabled = v.as_bool().unwrap_or(true);
            }
            "ai_bots_enabled" => {
                settings.ai_bots_enabled = v.as_bool().unwrap_or(true);
            }
            "maintenance_mode" => {
                settings.maintenance_mode = v.as_bool().unwrap_or(false);
            }
            "maintenance_message" => {
                settings.maintenance_message = v.as_str().unwrap_or("").to_string();
            }
            "ai_global_model" => {
                settings.ai_global_model = v.as_str().unwrap_or("").to_string();
            }
            "ai_rate_limit_per_minute" => {
                settings.ai_rate_limit_per_minute = v.as_u64().unwrap_or(0) as u32;
            }
            "ai_emergency_stop" => {
                settings.ai_emergency_stop = v.as_bool().unwrap_or(false);
            }
            "default_retention_days" => {
                settings.default_retention_days = v.as_u64().unwrap_or(0) as u32;
            }
            "global_disappearing_default" => {
                settings.global_disappearing_default = v.as_str().unwrap_or("off").to_string();
            }
            "official_server_id" => {
                settings.official_server_id = v.as_str().unwrap_or("").to_string();
            }
            "disappearing_messages_enabled" => {
                settings.disappearing_messages_enabled = v.as_bool().unwrap_or(true);
            }
            "admin_alert_email" => {
                settings.admin_alert_email = v.as_str().unwrap_or("").to_string();
            }
            _ => {}
        }
    }

    // 3. Cache in Redis with TTL.
    if let Ok(json_str) = serde_json::to_string(&settings) {
        let _: Result<(), _> = redis::cmd("SET")
            .arg(REDIS_KEY)
            .arg(&json_str)
            .arg("EX")
            .arg(REDIS_TTL_SECS)
            .query_async(&mut redis)
            .await;
    }

    Ok(settings)
}

// ─── GET /api/v1/admin/settings ─────────────────────────────────────────────

pub async fn get_settings(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    let settings = get_platform_settings(&state).await?;
    Ok(Json(json!(settings)))
}

// ─── PUT /api/v1/admin/settings ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registrations_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logins_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guest_access_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_bots_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maintenance_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maintenance_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_global_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_rate_limit_per_minute: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_emergency_stop: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_retention_days: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub global_disappearing_default: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub official_server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disappearing_messages_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admin_alert_email: Option<String>,
}

pub async fn update_settings(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    // Upsert each provided field.
    let updates: Vec<(&str, serde_json::Value)> = [
        req.registrations_enabled.map(|v| ("registrations_enabled", json!(v))),
        req.logins_enabled.map(|v| ("logins_enabled", json!(v))),
        req.guest_access_enabled.map(|v| ("guest_access_enabled", json!(v))),
        req.ai_bots_enabled.map(|v| ("ai_bots_enabled", json!(v))),
        req.maintenance_mode.map(|v| ("maintenance_mode", json!(v))),
        req.maintenance_message.as_ref().map(|v| ("maintenance_message", json!(v))),
        req.ai_global_model.as_ref().map(|v| ("ai_global_model", json!(v))),
        req.ai_rate_limit_per_minute.map(|v| ("ai_rate_limit_per_minute", json!(v))),
        req.ai_emergency_stop.map(|v| ("ai_emergency_stop", json!(v))),
        req.default_retention_days.map(|v| ("default_retention_days", json!(v))),
        req.global_disappearing_default.as_ref().map(|v| ("global_disappearing_default", json!(v))),
        req.official_server_id.as_ref().map(|v| ("official_server_id", json!(v))),
        req.disappearing_messages_enabled.map(|v| ("disappearing_messages_enabled", json!(v))),
        req.admin_alert_email.as_ref().map(|v| ("admin_alert_email", json!(v))),
    ]
    .into_iter()
    .flatten()
    .collect();

    if updates.is_empty() {
        return Err(AppError::BadRequest("No settings provided".into()));
    }

    for (key, value) in &updates {
        sqlx::query!(
            "INSERT INTO platform_settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = $2",
            *key,
            value,
        )
        .execute(&state.db)
        .await?;
    }

    // Invalidate Redis cache so next read picks up changes immediately.
    let mut redis = state.redis.clone();
    let _: Result<(), _> = redis::cmd("DEL")
        .arg(REDIS_KEY)
        .query_async(&mut redis)
        .await;

    // Return updated settings.
    let settings = get_platform_settings(&state).await?;
    Ok(Json(json!(settings)))
}
