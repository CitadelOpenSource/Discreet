// citadel_automod.rs — Server-level AutoMod rule engine.
//
// Evaluates messages against per-server moderation rules stored as JSONB
// in the automod_configs table. Rules run in-process with zero external
// dependencies — no HTTP calls, no ML models, just fast string checks.
//
// Usage:
//   let config = load_automod_config(&db, server_id).await;
//   match check_message(&config, &message_text) {
//       AutoModAction::Allow => { /* send normally */ }
//       AutoModAction::Warn(reason) => { /* flag for review */ }
//       AutoModAction::Delete(reason) => { /* block the message */ }
//   }

use axum::{extract::{Path, State, Json}, response::IntoResponse};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

// ─── Configuration ──────────────────────────────────────────────────────

/// Per-server AutoMod configuration, stored as JSONB in `automod_configs.config`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoModConfig {
    #[serde(default)]
    pub enabled: bool,

    /// Words/phrases that trigger deletion (matched case-insensitively).
    #[serde(default)]
    pub bad_words: Vec<String>,

    /// Messages per minute from a single user before flagging as spam.
    #[serde(default = "default_spam_threshold")]
    pub spam_threshold_per_minute: u32,

    /// Block Discord/Slack/etc. invite links.
    #[serde(default)]
    pub block_invites: bool,

    /// Block all external links (http/https URLs).
    #[serde(default)]
    pub block_links: bool,

    /// Maximum @mentions in a single message before flagging.
    #[serde(default = "default_max_mentions")]
    pub max_mentions: u32,

    /// Maximum percentage of uppercase characters (0.0–1.0) before flagging.
    #[serde(default = "default_max_caps_percent")]
    pub max_caps_percent: f32,
}

fn default_spam_threshold() -> u32 { 5 }
fn default_max_mentions() -> u32 { 10 }
fn default_max_caps_percent() -> f32 { 0.8 }

impl Default for AutoModConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bad_words: Vec::new(),
            spam_threshold_per_minute: default_spam_threshold(),
            block_invites: false,
            block_links: false,
            max_mentions: default_max_mentions(),
            max_caps_percent: default_max_caps_percent(),
        }
    }
}

// ─── Action ─────────────────────────────────────────────────────────────

/// The result of running a message through the AutoMod engine.
#[derive(Debug, Clone, PartialEq)]
pub enum AutoModAction {
    /// Message passes all checks.
    Allow,
    /// Message is borderline — flag for moderator review.
    Warn(String),
    /// Message should be blocked and deleted.
    Delete(String),
}

// ─── Rule Engine ────────────────────────────────────────────────────────

/// Evaluate a message against the AutoMod rules.
///
/// Returns the most severe action triggered. Checks run in order:
/// bad words → invite links → all links → mention spam → caps spam.
///
/// If `nsfw` is true the bad-words check is skipped (NSFW channels
/// are expected to contain adult language) but structural rules
/// (invite spam, mention spam, caps) still apply.
pub fn check_message(config: &AutoModConfig, message: &str, nsfw: bool) -> AutoModAction {
    if !config.enabled {
        return AutoModAction::Allow;
    }

    let lower = message.to_lowercase();

    // ── Bad words (case-insensitive substring match) ─────────────────────
    // Skipped in NSFW channels.
    if !nsfw {
        for word in &config.bad_words {
            if !word.is_empty() && lower.contains(&word.to_lowercase()) {
                return AutoModAction::Delete(format!("Blocked word detected: {word}"));
            }
        }
    }

    // ── Invite links ────────────────────────────────────────────────────
    if config.block_invites {
        let invite_patterns = [
            "discord.gg/",
            "discord.com/invite/",
            "discordapp.com/invite/",
            "invite.gg/",
            "slack.com/join/",
            "t.me/",
            "telegram.me/",
        ];
        for pattern in &invite_patterns {
            if lower.contains(pattern) {
                return AutoModAction::Delete("Invite links are not allowed".into());
            }
        }
    }

    // ── All external links ──────────────────────────────────────────────
    if config.block_links {
        if lower.contains("http://") || lower.contains("https://") {
            return AutoModAction::Delete("External links are not allowed".into());
        }
    }

    // ── Mention spam ────────────────────────────────────────────────────
    let mention_count = message.matches('@').count() as u32;
    if mention_count > config.max_mentions {
        return AutoModAction::Delete(format!(
            "Too many mentions ({mention_count}, max {})",
            config.max_mentions
        ));
    }

    // ── Excessive caps (warn, don't delete) ─────────────────────────────
    let alpha_chars: Vec<char> = message.chars().filter(|c| c.is_alphabetic()).collect();
    if alpha_chars.len() >= 10 {
        let upper_count = alpha_chars.iter().filter(|c| c.is_uppercase()).count();
        let caps_ratio = upper_count as f32 / alpha_chars.len() as f32;
        if caps_ratio > config.max_caps_percent {
            return AutoModAction::Warn(format!(
                "Excessive caps ({:.0}%, max {:.0}%)",
                caps_ratio * 100.0,
                config.max_caps_percent * 100.0
            ));
        }
    }

    AutoModAction::Allow
}

// ─── Database ───────────────────────────────────────────────────────────

/// Load the AutoMod config for a server.
/// Returns the default (disabled) config if none is stored.
pub async fn load_automod_config(db: &PgPool, server_id: Uuid) -> AutoModConfig {
    let row = sqlx::query_scalar!(
        r#"SELECT config AS "config!: serde_json::Value" FROM automod_configs WHERE server_id = $1"#,
        server_id,
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    match row {
        Some(val) => serde_json::from_value(val).unwrap_or_default(),
        None => AutoModConfig::default(),
    }
}

/// Save an AutoMod config for a server (upsert).
pub async fn save_automod_config(
    db: &PgPool,
    server_id: Uuid,
    config: &AutoModConfig,
) -> Result<(), sqlx::Error> {
    let json = serde_json::to_value(config).unwrap_or_default();
    sqlx::query!(
        "INSERT INTO automod_configs (server_id, config, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (server_id) DO UPDATE SET config = $2, updated_at = NOW()",
        server_id,
        json,
    )
    .execute(db)
    .await?;
    Ok(())
}

// ─── HTTP Handlers ──────────────────────────────────────────────────────

/// GET /api/v1/servers/:server_id/automod
/// Returns the AutoMod config for this server (defaults if none stored).
/// Any server member can read the config.
pub async fn get_automod_config(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Verify membership.
    let is_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_member {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let config = load_automod_config(&state.db, server_id).await;
    Ok(Json(config))
}

/// PUT /api/v1/servers/:server_id/automod
/// Update the AutoMod config. Requires server ownership.
pub async fn update_automod_config(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(config): Json<AutoModConfig>,
) -> Result<impl IntoResponse, AppError> {
    // Only owner can update automod.
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only the server owner can update AutoMod settings".into()));
    }

    save_automod_config(&state.db, server_id, &config)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to save automod config: {e}")))?;

    tracing::info!(server_id = %server_id, admin = %auth.user_id, "AutoMod config updated");

    Ok(Json(serde_json::json!({ "message": "AutoMod config saved" })))
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_config() -> AutoModConfig {
        AutoModConfig {
            enabled: true,
            ..Default::default()
        }
    }

    #[test]
    fn test_disabled_allows_everything() {
        let config = AutoModConfig::default(); // enabled: false
        assert_eq!(check_message(&config, "any bad stuff", false), AutoModAction::Allow);
    }

    #[test]
    fn test_bad_word_case_insensitive() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        assert!(matches!(
            check_message(&config, "This has BADWORD in it", false),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_bad_word_no_match() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        assert_eq!(check_message(&config, "This is fine", false), AutoModAction::Allow);
    }

    #[test]
    fn test_invite_links_blocked() {
        let mut config = enabled_config();
        config.block_invites = true;
        assert!(matches!(
            check_message(&config, "Join us at discord.gg/abc123", false),
            AutoModAction::Delete(_)
        ));
        assert!(matches!(
            check_message(&config, "Check t.me/somechannel", false),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_invite_links_allowed_when_disabled() {
        let config = enabled_config();
        assert_eq!(
            check_message(&config, "Join discord.gg/abc123", false),
            AutoModAction::Allow
        );
    }

    #[test]
    fn test_external_links_blocked() {
        let mut config = enabled_config();
        config.block_links = true;
        assert!(matches!(
            check_message(&config, "Check https://example.com", false),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_mention_spam() {
        let mut config = enabled_config();
        config.max_mentions = 3;
        assert!(matches!(
            check_message(&config, "@one @two @three @four", false),
            AutoModAction::Delete(_)
        ));
        assert_eq!(
            check_message(&config, "@one @two @three", false),
            AutoModAction::Allow
        );
    }

    #[test]
    fn test_caps_warning() {
        let mut config = enabled_config();
        config.max_caps_percent = 0.8;
        assert!(matches!(
            check_message(&config, "THIS IS ALL CAPS MESSAGE HERE", false),
            AutoModAction::Warn(_)
        ));
    }

    #[test]
    fn test_caps_short_messages_ignored() {
        let mut config = enabled_config();
        config.max_caps_percent = 0.8;
        // Less than 10 alpha chars — skip caps check
        assert_eq!(check_message(&config, "OK SURE", false), AutoModAction::Allow);
    }

    #[test]
    fn test_nsfw_skips_bad_words() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        // NSFW channel: bad words allowed
        assert_eq!(
            check_message(&config, "This has badword", true),
            AutoModAction::Allow
        );
        // But mention spam still applies in NSFW
        config.max_mentions = 2;
        assert!(matches!(
            check_message(&config, "@a @b @c", true),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_default_config_values() {
        let config = AutoModConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.spam_threshold_per_minute, 5);
        assert_eq!(config.max_mentions, 10);
        assert!((config.max_caps_percent - 0.8).abs() < f32::EPSILON);
    }
}
