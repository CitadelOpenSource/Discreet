// discreet_turn.rs — TURN ephemeral credential generation.
//
// GET /api/v1/voice/turn-credentials
//   Returns short-lived TURN credentials for WebRTC peer connections.
//   Uses HMAC-SHA1 of "expiry_timestamp:user_id" with TURN_SECRET
//   (the standard CoTURN ephemeral credential mechanism).
//
//   If TURN_SECRET is not configured, returns { urls: [] } so callers
//   fall back to STUN-only mode.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha1::Sha1;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

type HmacSha1 = Hmac<Sha1>;

/// Default credential TTL: 24 hours.
const DEFAULT_TTL: u64 = 86400;

/// GET /api/v1/voice/turn-credentials
///
/// Returns TURN server credentials for authenticated users.
/// Credential format follows the CoTURN ephemeral credential mechanism:
///   username   = "{expiry_unix_timestamp}:{user_id}"
///   credential = Base64(HMAC-SHA1(username, TURN_SECRET))
///
/// Env vars:
///   TURN_SECRET — shared secret (must match CoTURN's `static-auth-secret`)
///   TURN_URLS   — comma-separated server URLs (e.g., "turn:turn.example.com:3478")
///   TURN_TTL    — credential lifetime in seconds (default: 86400 = 24 h)
///
/// If TURN_SECRET or TURN_URLS is missing/empty, returns `{ urls: [] }`.
pub async fn turn_credentials(
    auth: AuthUser,
    State(_state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let turn_secret = match std::env::var("TURN_SECRET") {
        Ok(s) if !s.is_empty() => s,
        _ => return Ok(Json(serde_json::json!({ "urls": [] }))),
    };

    // Build URL list: prefer TURN_URLS if set, otherwise derive from TURN_HOST.
    let mut urls: Vec<String> = std::env::var("TURN_URLS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // If no TURN_URLS, derive from TURN_HOST (simpler config for single-server setups).
    if urls.is_empty() {
        if let Ok(host) = std::env::var("TURN_HOST") {
            if !host.is_empty() {
                urls.push(format!("turn:{host}:3478?transport=udp"));
                urls.push(format!("turn:{host}:3478?transport=tcp"));
                urls.push(format!("turns:{host}:5349?transport=tcp"));
            }
        }
    }

    // Always include a free STUN fallback so calls work even without TURN.
    let mut all_urls = vec![
        "stun:stun.l.google.com:19302".to_string(),
    ];
    all_urls.extend(urls);

    // If no TURN servers configured (only STUN), return without credentials.
    if all_urls.len() <= 1 {
        return Ok(Json(serde_json::json!({ "urls": all_urls, "ttl": 0 })));
    }

    let ttl: u64 = std::env::var("TURN_TTL")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_TTL);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| AppError::Internal(format!("System clock error: {e}")))?;
    let expiry = now.as_secs() + ttl;
    let username = format!("{}:{}", expiry, auth.user_id);

    let mut mac = HmacSha1::new_from_slice(turn_secret.as_bytes())
        .map_err(|e| AppError::Internal(format!("HMAC key error: {e}")))?;
    mac.update(username.as_bytes());
    let credential = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());

    Ok(Json(serde_json::json!({
        "urls": all_urls,
        "username": username,
        "credential": credential,
        "ttl": ttl,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hmac_sha1_deterministic() {
        let secret = "test_secret_key";
        let username = "1700000000:550e8400-e29b-41d4-a716-446655440000";

        let mut mac1 = HmacSha1::new_from_slice(secret.as_bytes()).unwrap();
        mac1.update(username.as_bytes());
        let cred1 = base64::engine::general_purpose::STANDARD.encode(mac1.finalize().into_bytes());

        let mut mac2 = HmacSha1::new_from_slice(secret.as_bytes()).unwrap();
        mac2.update(username.as_bytes());
        let cred2 = base64::engine::general_purpose::STANDARD.encode(mac2.finalize().into_bytes());

        assert_eq!(cred1, cred2, "HMAC-SHA1 must be deterministic");
        assert!(!cred1.is_empty());
    }

    #[test]
    fn test_hmac_sha1_different_secrets_differ() {
        let username = b"1700000000:some-user-id";

        let mut mac1 = HmacSha1::new_from_slice(b"secret_a").unwrap();
        mac1.update(username);
        let cred1 = base64::engine::general_purpose::STANDARD.encode(mac1.finalize().into_bytes());

        let mut mac2 = HmacSha1::new_from_slice(b"secret_b").unwrap();
        mac2.update(username);
        let cred2 = base64::engine::general_purpose::STANDARD.encode(mac2.finalize().into_bytes());

        assert_ne!(cred1, cred2, "Different secrets must produce different credentials");
    }

    #[test]
    fn test_hmac_sha1_different_users_differ() {
        let secret = b"shared_turn_secret";

        let mut mac1 = HmacSha1::new_from_slice(secret).unwrap();
        mac1.update(b"1700000000:user-a");
        let cred1 = base64::engine::general_purpose::STANDARD.encode(mac1.finalize().into_bytes());

        let mut mac2 = HmacSha1::new_from_slice(secret).unwrap();
        mac2.update(b"1700000000:user-b");
        let cred2 = base64::engine::general_purpose::STANDARD.encode(mac2.finalize().into_bytes());

        assert_ne!(cred1, cred2, "Different usernames must produce different credentials");
    }
}
