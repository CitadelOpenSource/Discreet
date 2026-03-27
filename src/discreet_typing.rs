// discreet_typing.rs — Typing indicator events.
//
// Endpoints:
//   POST /channels/{id}/typing — Signal that the user is typing
//
// This triggers a WebSocket broadcast to all members in the channel's server,
// EXCLUDING users who have blocked the sender (privacy requirement).
// No database persistence — typing indicators are ephemeral.
//
// Clients should:
//   - Call this endpoint when the user starts typing
//   - Stop displaying the indicator after 8 seconds of no events
//   - Rate-limit themselves to 1 call per 3 seconds
//   - Server enforces per-user cooldown to prevent spam

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::post,
    Router,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

pub async fn broadcast_typing_start(
    state: &Arc<AppState>,
    user_id: Uuid,
    channel_id: Uuid,
    expected_server_id: Option<Uuid>,
) -> Result<(), AppError> {
    // Check if the user has typing indicators enabled (privacy preference).
    let typing_enabled = sqlx::query_scalar!(
        r#"SELECT show_typing_indicator as "show_typing_indicator!" FROM user_settings WHERE user_id = $1"#,
        user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .unwrap_or(false);

    if !typing_enabled {
        // User has opted out of typing indicators — silently succeed.
        return Ok(());
    }

    // Verify membership and fetch server + username for payload.
    let row = sqlx::query!(
        "SELECT c.server_id, u.username
         FROM channels c
         JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $2
         JOIN users u ON u.id = $2
         WHERE c.id = $1",
        channel_id,
        user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this channel's server".into()))?;

    if let Some(server_id) = expected_server_id {
        if row.server_id != server_id {
            return Err(AppError::Forbidden(
                "Channel is not in this WebSocket server".into(),
            ));
        }
    }

    // Check cooldown.
    if !state.typing_cooldown.check_and_update(user_id, channel_id).await {
        return Ok(());
    }

    // Fetch user IDs who have blocked the sender — they must NOT see the
    // typing indicator (privacy requirement).
    let blocked_by: Vec<Uuid> = sqlx::query_scalar!(
        "SELECT user_id FROM friendships WHERE friend_id = $1 AND status = 'blocked'",
        user_id,
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Broadcast to all WebSocket clients in this server, excluding blockers.
    state.ws_broadcast_filtered(row.server_id, serde_json::json!({
        "type": "TYPING_START",
        "channel_id": channel_id,
        "user_id": user_id,
        "username": row.username,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }), &blocked_by).await;

    Ok(())
}

/// Minimum interval between typing events per (user, channel) pair.
const TYPING_COOLDOWN: Duration = Duration::from_secs(3);

/// In-memory cooldown tracker.
/// Key: (user_id, channel_id) → last typing event timestamp.
pub struct TypingCooldown {
    entries: RwLock<HashMap<(Uuid, Uuid), Instant>>,
}

impl Default for TypingCooldown {
    fn default() -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
        }
    }
}

impl TypingCooldown {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true if the user may send a typing event (cooldown elapsed).
    pub async fn check_and_update(&self, user_id: Uuid, channel_id: Uuid) -> bool {
        let now = Instant::now();
        let key = (user_id, channel_id);

        // Fast check with read lock.
        {
            let entries = self.entries.read().await;
            if let Some(&last) = entries.get(&key) {
                if now.duration_since(last) < TYPING_COOLDOWN {
                    return false;
                }
            }
        }

        // Update with write lock.
        let mut entries = self.entries.write().await;
        entries.insert(key, now);
        true
    }

    /// Remove stale entries older than 30 seconds.
    pub async fn cleanup(&self) {
        let now = Instant::now();
        let mut entries = self.entries.write().await;
        entries.retain(|_, &mut last| now.duration_since(last) < Duration::from_secs(30));
    }
}

/// POST /channels/{id}/typing
///
/// Broadcasts a TYPING_START event to the channel's server.
/// Returns 204 on success, 429 if rate limited.
pub async fn start_typing(
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    // Silently succeed on cooldown or after successful broadcast.
    broadcast_typing_start(&state, auth.user_id, channel_id, None).await?;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub fn typing_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/channels/{channel_id}/typing", post(start_typing))
}
