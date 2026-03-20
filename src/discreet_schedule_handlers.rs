// discreet_schedule_handlers.rs — Scheduled (deferred) message delivery.
//
// Allows users to schedule messages for future sending. A background worker
// polls every 30 seconds and delivers messages whose send_at has passed.
//
// Endpoints:
//   POST   /api/v1/channels/:channel_id/schedule   — Schedule a message
//   GET    /api/v1/channels/:channel_id/scheduled   — List user's scheduled messages
//   DELETE /api/v1/scheduled/:id                    — Cancel a pending message
//
// Worker:
//   run_schedule_worker(db) — Background loop that delivers due messages.

use std::sync::Arc;

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use base64::Engine;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, Permission};
use crate::discreet_state::AppState;

/// Maximum pending scheduled messages per user.
const MAX_PENDING_PER_USER: i64 = 50;

/// Maximum how far in the future a message can be scheduled (30 days).
const MAX_SCHEDULE_AHEAD_SECS: i64 = 30 * 24 * 3600;

// ─── Request Types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ScheduleMessageRequest {
    pub content_ciphertext: String,
    #[serde(default)]
    pub mls_epoch: i32,
    pub send_at: DateTime<Utc>,
}

// ─── POST /channels/:channel_id/schedule ────────────────────────────────

/// Schedule a message for future delivery.
pub async fn create_scheduled_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<ScheduleMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    // ── Verify channel exists and user has send permission ───────────────
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, Permission::SEND_MESSAGES).await?;

    // ── Validate send_at is in the future ────────────────────────────────
    let now = Utc::now();
    if req.send_at <= now {
        return Err(AppError::BadRequest(
            "send_at must be in the future".into(),
        ));
    }

    let max_ahead = chrono::Duration::seconds(MAX_SCHEDULE_AHEAD_SECS);
    if req.send_at > now + max_ahead {
        return Err(AppError::BadRequest(
            "Cannot schedule more than 30 days in advance".into(),
        ));
    }

    // ── Validate content is not empty ────────────────────────────────────
    if req.content_ciphertext.is_empty() {
        return Err(AppError::BadRequest(
            "content_ciphertext cannot be empty".into(),
        ));
    }
    if req.content_ciphertext.len() > 262_144 {
        return Err(AppError::BadRequest(
            "content_ciphertext exceeds 256KB limit".into(),
        ));
    }

    // ── Enforce per-user pending limit ───────────────────────────────────
    let pending_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM scheduled_messages WHERE user_id = $1 AND status = 'pending'",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    if pending_count >= MAX_PENDING_PER_USER {
        return Err(AppError::BadRequest(
            format!("Maximum {} pending scheduled messages", MAX_PENDING_PER_USER),
        ));
    }

    // ── Insert scheduled message ─────────────────────────────────────────
    let row = sqlx::query!(
        "INSERT INTO scheduled_messages (user_id, channel_id, content_ciphertext, mls_epoch, send_at) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING id, created_at",
        auth.user_id,
        channel_id,
        req.content_ciphertext,
        req.mls_epoch,
        req.send_at,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(
        scheduled_id = %row.id,
        user_id = %auth.user_id,
        channel_id = %channel_id,
        send_at = %req.send_at,
        "Scheduled message created"
    );

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": row.id,
            "channel_id": channel_id,
            "send_at": req.send_at.to_rfc3339(),
            "status": "pending",
            "created_at": row.created_at.map(|t| t.to_rfc3339()),
        })),
    ))
}

// ─── GET /channels/:channel_id/scheduled ────────────────────────────────

/// List the current user's scheduled messages for a channel.
pub async fn list_scheduled_messages(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT id, content_ciphertext, mls_epoch, send_at, status, created_at \
         FROM scheduled_messages \
         WHERE user_id = $1 AND channel_id = $2 \
         ORDER BY send_at ASC",
        auth.user_id,
        channel_id,
    )
    .fetch_all(&state.db)
    .await?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "channel_id": channel_id,
                "content_ciphertext": r.content_ciphertext,
                "mls_epoch": r.mls_epoch,
                "send_at": r.send_at.to_rfc3339(),
                "status": r.status,
                "created_at": r.created_at.map(|t| t.to_rfc3339()),
            })
        })
        .collect();

    Ok(Json(json!(items)))
}

// ─── DELETE /scheduled/:id ──────────────────────────────────────────────

/// Cancel a pending scheduled message. Only the owner can cancel, and
/// only if the message is still in `pending` status.
pub async fn cancel_scheduled_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(scheduled_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "DELETE FROM scheduled_messages \
         WHERE id = $1 AND user_id = $2 AND status = 'pending'",
        scheduled_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "Scheduled message not found, not owned by you, or already sent".into(),
        ));
    }

    tracing::info!(
        scheduled_id = %scheduled_id,
        user_id = %auth.user_id,
        "Scheduled message cancelled"
    );

    Ok(StatusCode::NO_CONTENT)
}

// ─── Background Worker ──────────────────────────────────────────────────

/// Background loop that delivers due scheduled messages every 30 seconds.
///
/// For each pending message whose `send_at` has passed:
/// 1. Decode the base64 content_ciphertext to bytes
/// 2. Insert into the `messages` table
/// 3. Update status to `sent`
///
/// Failed deliveries are marked `failed` with a logged error. The worker
/// never panics — individual message failures do not affect other messages.
pub async fn run_schedule_worker(db: sqlx::PgPool) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    loop {
        interval.tick().await;

        let due = match sqlx::query!(
            "SELECT id, user_id, channel_id, content_ciphertext, mls_epoch \
             FROM scheduled_messages \
             WHERE status = 'pending' AND send_at <= now() \
             ORDER BY send_at ASC \
             LIMIT 100",
        )
        .fetch_all(&db)
        .await
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::error!("Schedule worker query failed: {e}");
                continue;
            }
        };

        if due.is_empty() {
            continue;
        }

        tracing::debug!(count = due.len(), "Schedule worker found due messages");

        for msg in &due {
            // Decode base64 ciphertext to bytes for the messages table.
            let ciphertext_bytes = match base64::engine::general_purpose::STANDARD
                .decode(&msg.content_ciphertext)
            {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!(
                        scheduled_id = %msg.id,
                        "Failed to decode scheduled message ciphertext: {e}"
                    );
                    mark_failed(&db, msg.id).await;
                    continue;
                }
            };

            let message_id = Uuid::new_v4();
            let mls_epoch = i64::from(msg.mls_epoch.unwrap_or(0));
            let mentions_json = serde_json::json!([]);

            // Insert into the messages table.
            if let Err(e) = sqlx::query!(
                "INSERT INTO messages \
                     (id, channel_id, author_id, content_ciphertext, mls_epoch, \
                      mentioned_user_ids) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
                message_id,
                msg.channel_id,
                msg.user_id,
                ciphertext_bytes,
                mls_epoch,
                mentions_json,
            )
            .execute(&db)
            .await
            {
                tracing::error!(
                    scheduled_id = %msg.id,
                    "Failed to insert scheduled message: {e}"
                );
                mark_failed(&db, msg.id).await;
                continue;
            }

            // Mark as sent.
            if let Err(e) = sqlx::query!(
                "UPDATE scheduled_messages SET status = 'sent' WHERE id = $1",
                msg.id,
            )
            .execute(&db)
            .await
            {
                tracing::error!(
                    scheduled_id = %msg.id,
                    "Failed to mark scheduled message as sent: {e}"
                );
            }

            tracing::info!(
                scheduled_id = %msg.id,
                message_id = %message_id,
                channel_id = %msg.channel_id,
                "Delivered scheduled message"
            );
        }
    }
}

/// Mark a scheduled message as failed.
async fn mark_failed(db: &sqlx::PgPool, id: Uuid) {
    if let Err(e) = sqlx::query!(
        "UPDATE scheduled_messages SET status = 'failed' WHERE id = $1",
        id,
    )
    .execute(db)
    .await
    {
        tracing::error!(scheduled_id = %id, "Failed to mark scheduled message as failed: {e}");
    }
}
