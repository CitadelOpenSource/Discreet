// discreet_automod.rs — Server-level AutoMod rule engine.
//
// Evaluates messages against per-server moderation rules stored as JSONB
// in the automod_configs table. Rules run in-process with zero external
// dependencies — no HTTP calls, no ML models, just fast string checks.
//
// Usage:
//   let config = load_automod_config(&db, server_id).await;
//   match check_message(&config, &message_text, false, Some("myinstance.com")) {
//       AutoModAction::Allow => { /* send normally */ }
//       AutoModAction::Warn(reason) => { /* flag for review */ }
//       AutoModAction::Delete(reason) => { /* block the message */ }
//   }

use axum::{extract::{Path, State, Json}, response::IntoResponse};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

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

    /// Block external platform invite links.
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

// ─── Sanitization ───────────────────────────────────────────────────────

/// Strip zero-width and invisible characters used to bypass word filters.
/// Also URL-decode the input so %62%61%64 doesn't evade "bad" word checks.
fn sanitize_for_scan(input: &str) -> String {
    // Step 1: Strip zero-width / invisible characters
    let stripped: String = input.chars().filter(|c| !matches!(c,
        '\u{200B}' | // zero-width space
        '\u{200C}' | // zero-width non-joiner
        '\u{200D}' | // zero-width joiner
        '\u{FEFF}' | // byte order mark / zero-width no-break space
        '\u{00AD}' | // soft hyphen
        '\u{200E}' | // left-to-right mark
        '\u{200F}'   // right-to-left mark
    )).collect();

    // Step 2: URL-decode (single pass — handles %XX encoding)
    let mut decoded = String::with_capacity(stripped.len());
    let bytes = stripped.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                hex_val(bytes[i + 1]),
                hex_val(bytes[i + 2]),
            ) {
                decoded.push((hi << 4 | lo) as char);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i] as char);
        i += 1;
    }
    decoded
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// URL shortener domains that obscure the actual destination.
const SHORTENER_DOMAINS: &[&str] = &[
    "bit.ly", "t.co", "tinyurl.com", "goo.gl", "is.gd", "rb.gy",
    "ow.ly", "buff.ly", "adf.ly", "cutt.ly", "shorturl.at",
];

// ─── Rule Engine ────────────────────────────────────────────────────────

/// Evaluate a message against the AutoMod rules.
///
/// Returns the most severe action triggered. Checks run in order:
/// bad words → invite links → shortener links → all links → mention spam → caps spam.
///
/// Input is sanitized before scanning: zero-width characters are stripped
/// and URL-encoded sequences are decoded. This prevents bypass attacks
/// like "b%61dword" or "bad\u{200B}word".
///
/// If `nsfw` is true the bad-words check is skipped (NSFW channels
/// are expected to contain adult language) but structural rules
/// (invite spam, mention spam, caps) still apply.
///
/// `instance_domain` is the current instance's domain (e.g. "discreet.chat").
/// When provided, invite links pointing to the same instance are allowed
/// while invite links to *other* Discreet instances are blocked.
pub fn check_message(config: &AutoModConfig, message: &str, nsfw: bool, instance_domain: Option<&str>) -> AutoModAction {
    if !config.enabled {
        return AutoModAction::Allow;
    }

    let sanitized = sanitize_for_scan(message);
    let lower = sanitized.to_lowercase();

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
        // External platform invite patterns — always blocked
        let invite_patterns = [
            "discord.gg/",
            "discord.com/invite/",
            "discordapp.com/invite/",
            "invite.gg/",
            "slack.com/join/",
            "t.me/",
            "telegram.me/",
            "signal.group/",
        ];
        for pattern in &invite_patterns {
            if lower.contains(pattern) {
                return AutoModAction::Delete("External invite links are not allowed".into());
            }
        }

        // Block /invite/ URLs from different Discreet instances
        if let Some(domain) = instance_domain {
            // Simple pattern match — find /invite/ URLs and check the host
            let domain_lower = domain.to_lowercase();
            let search = &lower;
            let mut pos = 0;
            while let Some(idx) = search[pos..].find("/invite/") {
                let abs = pos + idx;
                // Walk backwards to find the host in https://HOST/invite/
                if let Some(proto_end) = search[..abs].rfind("://") {
                    let host = &search[proto_end + 3..abs];
                    if !host.is_empty() && !host.contains(' ') && host != domain_lower {
                        return AutoModAction::Delete("Invite links from other instances are not allowed".into());
                    }
                }
                pos = abs + 8; // skip past "/invite/"
            }
        }
    }

    // ── URL shortener domains (always blocked when invites or links are blocked) ──
    if config.block_invites || config.block_links {
        for domain in SHORTENER_DOMAINS {
            if lower.contains(domain) {
                return AutoModAction::Delete(format!(
                    "URL shortener links are not allowed ({})", domain
                ));
            }
        }
    }

    // ── All external links ──────────────────────────────────────────────
    if config.block_links && (lower.contains("http://") || lower.contains("https://")) {
        return AutoModAction::Delete("External links are not allowed".into());
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
        assert_eq!(check_message(&config, "any bad stuff", false, None), AutoModAction::Allow);
    }

    #[test]
    fn test_bad_word_case_insensitive() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        assert!(matches!(
            check_message(&config, "This has BADWORD in it", false, None),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_bad_word_no_match() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        assert_eq!(check_message(&config, "This is fine", false, None), AutoModAction::Allow);
    }

    #[test]
    fn test_invite_links_blocked() {
        let mut config = enabled_config();
        config.block_invites = true;
        assert!(matches!(
            check_message(&config, "Join us at discord.gg/abc123", false, None),
            AutoModAction::Delete(_)
        ));
        assert!(matches!(
            check_message(&config, "Check t.me/somechannel", false, None),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_invite_links_allowed_when_disabled() {
        let config = enabled_config();
        assert_eq!(
            check_message(&config, "Join discord.gg/abc123", false, None),
            AutoModAction::Allow
        );
    }

    #[test]
    fn test_external_links_blocked() {
        let mut config = enabled_config();
        config.block_links = true;
        assert!(matches!(
            check_message(&config, "Check https://example.com", false, None),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_mention_spam() {
        let mut config = enabled_config();
        config.max_mentions = 3;
        assert!(matches!(
            check_message(&config, "@one @two @three @four", false, None),
            AutoModAction::Delete(_)
        ));
        assert_eq!(
            check_message(&config, "@one @two @three", false, None),
            AutoModAction::Allow
        );
    }

    #[test]
    fn test_caps_warning() {
        let mut config = enabled_config();
        config.max_caps_percent = 0.8;
        assert!(matches!(
            check_message(&config, "THIS IS ALL CAPS MESSAGE HERE", false, None),
            AutoModAction::Warn(_)
        ));
    }

    #[test]
    fn test_caps_short_messages_ignored() {
        let mut config = enabled_config();
        config.max_caps_percent = 0.8;
        // Less than 10 alpha chars — skip caps check
        assert_eq!(check_message(&config, "OK SURE", false, None), AutoModAction::Allow);
    }

    #[test]
    fn test_nsfw_skips_bad_words() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        // NSFW channel: bad words allowed
        assert_eq!(
            check_message(&config, "This has badword", true, None),
            AutoModAction::Allow
        );
        // But mention spam still applies in NSFW
        config.max_mentions = 2;
        assert!(matches!(
            check_message(&config, "@a @b @c", true, None),
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

    #[test]
    fn test_signal_group_blocked() {
        let mut config = enabled_config();
        config.block_invites = true;
        assert!(matches!(
            check_message(&config, "Join signal.group/#abc", false, None),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_same_instance_invite_allowed() {
        let mut config = enabled_config();
        config.block_invites = true;
        assert_eq!(
            check_message(&config, "Join https://myinstance.com/invite/abc123", false, Some("myinstance.com")),
            AutoModAction::Allow
        );
    }

    #[test]
    fn test_different_instance_invite_blocked() {
        let mut config = enabled_config();
        config.block_invites = true;
        assert!(matches!(
            check_message(&config, "Join https://other.com/invite/abc123", false, Some("myinstance.com")),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_zero_width_bypass_blocked() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        // Zero-width spaces inserted between characters: "bad\u{200B}word"
        let bypass = "bad\u{200B}word";
        assert!(matches!(
            check_message(&config, bypass, false, None),
            AutoModAction::Delete(_)
        ));
        // Zero-width joiner: "b\u{200D}a\u{200D}d\u{200D}w\u{200D}o\u{200D}r\u{200D}d"
        let bypass2 = "b\u{200D}a\u{200D}dw\u{200D}ord";
        assert!(matches!(
            check_message(&config, bypass2, false, None),
            AutoModAction::Delete(_)
        ));
        // Soft hyphen: "bad\u{00AD}word"
        let bypass3 = "bad\u{00AD}word";
        assert!(matches!(
            check_message(&config, bypass3, false, None),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_url_encoded_bypass_blocked() {
        let mut config = enabled_config();
        config.bad_words = vec!["badword".into()];
        // URL-encoded: "b%61dword" = "badword"
        assert!(matches!(
            check_message(&config, "b%61dword", false, None),
            AutoModAction::Delete(_)
        ));
        // Full URL-encode: "%62%61%64%77%6f%72%64" = "badword"
        assert!(matches!(
            check_message(&config, "%62%61%64%77%6f%72%64", false, None),
            AutoModAction::Delete(_)
        ));
    }

    #[test]
    fn test_url_shortener_blocked() {
        let mut config = enabled_config();
        config.block_invites = true;
        // Shortener links blocked when invites are blocked
        assert!(matches!(
            check_message(&config, "Check https://bit.ly/abc123", false, None),
            AutoModAction::Delete(_)
        ));
        assert!(matches!(
            check_message(&config, "See t.co/xyz", false, None),
            AutoModAction::Delete(_)
        ));
        assert!(matches!(
            check_message(&config, "Visit tinyurl.com/short", false, None),
            AutoModAction::Delete(_)
        ));
        // Not blocked when invites AND links are both disabled
        let config2 = enabled_config();
        assert_eq!(
            check_message(&config2, "Check https://bit.ly/abc123", false, None),
            AutoModAction::Allow
        );
    }
}
