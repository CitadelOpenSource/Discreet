use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_permissions::{require_permission, PERM_MANAGE_MESSAGES, PERM_VIEW_CHANNEL};
use crate::citadel_state::AppState;

const MAX_PINS_PER_CHANNEL: i64 = 50;

#[derive(Debug, Serialize)]
pub struct PinnedMessageInfo {
    pub id: Uuid,
    pub content_ciphertext: String,
    pub author_id: Uuid,
    pub created_at: String,
    pub pinned_by: Uuid,
    pub pinned_at: String,
}

async fn verify_channel_in_server(
    db: &sqlx::PgPool,
    server_id: Uuid,
    channel_id: Uuid,
) -> Result<(), AppError> {
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND server_id = $2)",
        channel_id,
        server_id,
    )
    .fetch_one(db)
    .await?
    .unwrap_or(false);

    if !exists {
        return Err(AppError::NotFound("Channel not found in server".into()));
    }

    Ok(())
}

pub async fn pin_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    verify_channel_in_server(&state.db, server_id, channel_id).await?;
    require_permission(&state, server_id, auth.user_id, PERM_MANAGE_MESSAGES).await?;

    let message_exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2 AND NOT deleted)",
        message_id,
        channel_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !message_exists {
        return Err(AppError::NotFound("Message not found".into()));
    }

    let pin_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM pinned_messages WHERE channel_id = $1",
        channel_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    if pin_count >= MAX_PINS_PER_CHANNEL {
        return Err(AppError::BadRequest(
            "Channel already has maximum of 50 pinned messages".into(),
        ));
    }

    let result = sqlx::query!(
        "INSERT INTO pinned_messages (channel_id, message_id, pinned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, message_id) DO NOTHING",
        channel_id,
        message_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::Conflict("Message is already pinned".into()));
    }

    state
        .ws_broadcast(
            server_id,
            serde_json::json!({
                "type": "message_pin",
                "channel_id": channel_id,
                "message_id": message_id,
                "pinned_by": auth.user_id,
            }),
        )
        .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn unpin_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    verify_channel_in_server(&state.db, server_id, channel_id).await?;
    require_permission(&state, server_id, auth.user_id, PERM_MANAGE_MESSAGES).await?;

    let result = sqlx::query!(
        "DELETE FROM pinned_messages WHERE channel_id = $1 AND message_id = $2",
        channel_id,
        message_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Pinned message not found".into()));
    }

    state
        .ws_broadcast(
            server_id,
            serde_json::json!({
                "type": "message_unpin",
                "channel_id": channel_id,
                "message_id": message_id,
                "unpinned_by": auth.user_id,
            }),
        )
        .await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_pinned_messages(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    verify_channel_in_server(&state.db, server_id, channel_id).await?;
    require_permission(&state, server_id, auth.user_id, PERM_VIEW_CHANNEL).await?;

    let rows = sqlx::query!(
        "SELECT m.id, m.content_ciphertext, m.author_id, m.created_at, p.pinned_by, p.pinned_at
         FROM pinned_messages p
         JOIN messages m ON m.id = p.message_id
         WHERE p.channel_id = $1
         ORDER BY p.pinned_at DESC
         LIMIT 50",
        channel_id,
    )
    .fetch_all(&state.db)
    .await?;

    let pins: Vec<PinnedMessageInfo> = rows
        .into_iter()
        .map(|r| PinnedMessageInfo {
            id: r.id,
            content_ciphertext: encode_base64(&r.content_ciphertext),
            author_id: r.author_id,
            created_at: r.created_at.to_rfc3339(),
            pinned_by: r.pinned_by,
            pinned_at: r.pinned_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(pins))
}

fn encode_base64(data: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(data)
}
