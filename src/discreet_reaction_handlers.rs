// discreet_reaction_handlers.rs — Message reaction management.
//
// Endpoints:
//   PUT    /channels/{id}/messages/{msg_id}/reactions/{emoji}  — Add reaction
//   DELETE /channels/{id}/messages/{msg_id}/reactions/{emoji}  — Remove own reaction
//   GET    /channels/{id}/messages/{msg_id}/reactions          — List reactions
//
// Design notes:
//   - Reactions are NOT encrypted. They're metadata (like read receipts).
//   - Each user can add each emoji once per message.
//   - Emoji is stored as a UTF-8 string (Unicode emoji, e.g., "👍").
//   - All reaction changes broadcast WebSocket events.

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{delete, get, put},
    Json, Router,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ── Response types ──────────────────────────────────────────────────────

/// Aggregated reaction: emoji + count + whether the current user reacted.
#[derive(Debug, Serialize)]
pub struct ReactionSummary {
    pub emoji: String,
    pub count: i64,
    pub me: bool,
    pub users: Vec<Uuid>,
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Verify that the user is a member of the server that owns this channel,
/// and return the server_id for WebSocket broadcast.
async fn verify_channel_access(
    db: &sqlx::PgPool,
    channel_id: Uuid,
    user_id: Uuid,
) -> Result<Uuid, AppError> {
    let row = sqlx::query!(
        "SELECT c.server_id
         FROM channels c
         JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $2
         WHERE c.id = $1",
        channel_id,
        user_id,
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this channel's server".into()))?;

    Ok(row.server_id)
}

/// Verify a message exists in this channel.
async fn verify_message(
    db: &sqlx::PgPool,
    channel_id: Uuid,
    message_id: Uuid,
) -> Result<(), AppError> {
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2 AND NOT deleted)",
        message_id,
        channel_id,
    )
    .fetch_one(db)
    .await?
    .unwrap_or(false);

    if !exists {
        return Err(AppError::NotFound("Message not found".into()));
    }
    Ok(())
}

// ── Handlers ────────────────────────────────────────────────────────────

/// PUT /channels/{id}/messages/{msg_id}/reactions/{emoji}
///
/// Add a reaction. Idempotent — re-adding the same emoji is a no-op (200).
pub async fn add_reaction(
    auth: AuthUser,
    Path((channel_id, message_id, emoji)): Path<(Uuid, Uuid, String)>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    // Validate emoji length (prevent abuse).
    if emoji.is_empty() || emoji.len() > 32 {
        return Err(AppError::BadRequest("Invalid emoji".into()));
    }

    // Rate limit: 5 reactions per user per message per 10 seconds.
    let rate_key = format!("react_rl:{}:{}", auth.user_id, message_id);
    let mut redis_conn = state.redis.clone();
    let count: i64 = crate::discreet_error::redis_or_503(
        redis::cmd("INCR")
            .arg(&rate_key)
            .query_async(&mut redis_conn)
            .await
    )?;
    if count == 1 {
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(10i64)
            .query_async(&mut redis_conn)
            .await;
    }
    if count > 5 {
        return Err(AppError::RateLimited("Too many reactions — slow down".into()));
    }

    let server_id = verify_channel_access(&state.db, channel_id, auth.user_id).await?;
    verify_message(&state.db, channel_id, message_id).await?;

    // Upsert — ON CONFLICT DO NOTHING makes this idempotent.
    sqlx::query!(
        "INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING",
        message_id,
        auth.user_id,
        emoji,
    )
    .execute(&state.db)
    .await?;

    // Broadcast.
    state.ws_broadcast(server_id, serde_json::json!({
        "type": "REACTION_ADD",
        "channel_id": channel_id,
        "message_id": message_id,
        "user_id": auth.user_id,
        "emoji": emoji,
    })).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// DELETE /channels/{id}/messages/{msg_id}/reactions/{emoji}
///
/// Remove own reaction.
pub async fn remove_reaction(
    auth: AuthUser,
    Path((channel_id, message_id, emoji)): Path<(Uuid, Uuid, String)>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let server_id = verify_channel_access(&state.db, channel_id, auth.user_id).await?;

    let result = sqlx::query!(
        "DELETE FROM message_reactions
         WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
        message_id,
        auth.user_id,
        emoji,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Reaction not found".into()));
    }

    state.ws_broadcast(server_id, serde_json::json!({
        "type": "REACTION_REMOVE",
        "channel_id": channel_id,
        "message_id": message_id,
        "user_id": auth.user_id,
        "emoji": emoji,
    })).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /channels/{id}/messages/{msg_id}/reactions
///
/// Returns aggregated reactions: [ { emoji, count, me, users } ]
pub async fn list_reactions(
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    verify_channel_access(&state.db, channel_id, auth.user_id).await?;
    verify_message(&state.db, channel_id, message_id).await?;

    // Fetch all reactions for this message.
    let rows = sqlx::query!(
        "SELECT user_id, emoji FROM message_reactions
         WHERE message_id = $1
         ORDER BY created_at ASC",
        message_id,
    )
    .fetch_all(&state.db)
    .await?;

    // Aggregate by emoji.
    let mut groups: HashMap<String, Vec<Uuid>> = HashMap::new();
    for row in &rows {
        groups
            .entry(row.emoji.clone())
            .or_default()
            .push(row.user_id);
    }

    let summaries: Vec<ReactionSummary> = groups
        .into_iter()
        .map(|(emoji, users)| {
            let me = users.contains(&auth.user_id);
            let count = users.len() as i64;
            ReactionSummary { emoji, count, me, users }
        })
        .collect();

    Ok(Json(summaries))
}

// ── Routes ──────────────────────────────────────────────────────────────

pub fn reaction_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/channels/{channel_id}/messages/{msg_id}/reactions/{emoji}",
            put(add_reaction),
        )
        .route(
            "/channels/{channel_id}/messages/{msg_id}/reactions/{emoji}",
            delete(remove_reaction),
        )
        .route(
            "/channels/{channel_id}/messages/{msg_id}/reactions",
            get(list_reactions),
        )
}
