// discreet_ack_handlers.rs — Message acknowledgement endpoints.
//
// Endpoints:
//   POST /api/v1/messages/:id/ack       — Acknowledge a message
//   GET  /api/v1/messages/:id/acks      — List acknowledgements + count

use axum::{extract::{Path, State, Json}, response::IntoResponse};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;
use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

#[derive(Debug, Serialize)]
pub struct AckStatusResponse {
    pub message_id: Uuid,
    pub ack_count: i64,
    pub member_count: i64,
    pub acked_by: Vec<Uuid>,
}

/// POST /messages/:id/ack — acknowledge a message.
pub async fn ack_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(message_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Verify the message exists and get its server for broadcasting
    let msg = sqlx::query!(
        "SELECT m.id, m.channel_id, m.priority, c.server_id
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = $1",
        message_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    // Insert acknowledgement (idempotent)
    sqlx::query!(
        "INSERT INTO message_acknowledgements (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING",
        message_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Get updated counts
    let ack_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM message_acknowledgements WHERE message_id = $1"#,
        message_id,
    )
    .fetch_one(&state.db)
    .await?;

    let member_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM server_members WHERE server_id = $1"#,
        msg.server_id,
    )
    .fetch_one(&state.db)
    .await?;

    // Broadcast ack update to all clients
    state.ws_broadcast(msg.server_id, serde_json::json!({
        "type": "message_ack",
        "message_id": message_id,
        "user_id": auth.user_id,
        "ack_count": ack_count,
        "member_count": member_count,
    })).await;

    Ok(Json(serde_json::json!({
        "message_id": message_id,
        "ack_count": ack_count,
        "member_count": member_count,
    })))
}

/// GET /messages/:id/acks — get acknowledgement status.
pub async fn get_acks(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(message_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Verify message exists and user has access
    let msg = sqlx::query!(
        "SELECT m.id, c.server_id
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.id = $1",
        message_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2) as "exists!""#,
        msg.server_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_member {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }

    let acked_by: Vec<Uuid> = sqlx::query_scalar!(
        "SELECT user_id FROM message_acknowledgements WHERE message_id = $1 ORDER BY acked_at",
        message_id,
    )
    .fetch_all(&state.db)
    .await?;

    let member_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM server_members WHERE server_id = $1"#,
        msg.server_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(AckStatusResponse {
        message_id,
        ack_count: acked_by.len() as i64,
        member_count,
        acked_by,
    }))
}
