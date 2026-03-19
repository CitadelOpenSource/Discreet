// discreet_disappearing_handlers.rs — Disappearing messages TTL management.
//
// Endpoints:
//   PUT /api/v1/channels/:channel_id/ttl      — Set channel message TTL (admin only).
//   PUT /api/v1/conversations/:dm_id/ttl      — Set DM message TTL (either participant).
//
// Enterprise toggle:
//   platform_settings.disappearing_messages_enabled (default true).
//   When false, both PUT endpoints return 403 and the cleanup loop skips.
//
// Data retention coexistence:
//   If default_retention_days > 0, messages younger than that retention
//   period are NEVER deleted by TTL cleanup, even if their TTL has expired.
//   Retention overrides disappearing.
//
// Background cleanup (spawned at server start):
//   Every 60 seconds, soft-deletes messages that have been read (acknowledged)
//   and whose acked_at + ttl_seconds < now, respecting the above guards.

use std::sync::Arc;

use axum::{
    extract::{Json, Path, State},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, PERM_MANAGE_CHANNELS};
use crate::discreet_platform_settings::get_platform_settings;
use crate::discreet_state::AppState;

/// Row type for voice message expiry queries (both branches must return the same type).
#[derive(sqlx::FromRow)]
struct VoiceRow {
    id: Uuid,
    channel_id: Uuid,
}

/// Allowed TTL values: null (off), 1 hour, 1 day, 7 days, 30 days.
const ALLOWED_TTLS: &[i32] = &[3600, 86400, 604800, 2592000];

const FEATURE_DISABLED_MSG: &str =
    "Disappearing messages are disabled by the platform administrator";

#[derive(Debug, Deserialize)]
pub struct SetTtlRequest {
    /// TTL in seconds, or null to disable.
    pub ttl_seconds: Option<i32>,
}

// ─── PUT /channels/:channel_id/ttl ─────────────────────────────────────

/// Set the disappearing-message TTL for a server channel.
/// Requires MANAGE_CHANNELS permission. Allowed values: null, 3600, 86400,
/// 604800, 2592000. Returns 403 if the platform toggle is off.
pub async fn set_channel_ttl(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SetTtlRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Platform toggle check
    let settings = get_platform_settings(&state).await?;
    if !settings.disappearing_messages_enabled {
        return Err(AppError::Forbidden(FEATURE_DISABLED_MSG.into()));
    }

    // Validate TTL value
    if let Some(ttl) = req.ttl_seconds {
        if !ALLOWED_TTLS.contains(&ttl) {
            return Err(AppError::BadRequest(format!(
                "ttl_seconds must be null or one of: {}",
                ALLOWED_TTLS.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(", ")
            )));
        }
    }

    // Look up channel and verify permission
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    // Update TTL
    sqlx::query!(
        "UPDATE channels SET ttl_seconds = $1 WHERE id = $2",
        req.ttl_seconds,
        channel_id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        user_id = %auth.user_id,
        channel_id = %channel_id,
        ttl_seconds = ?req.ttl_seconds,
        "Channel TTL updated"
    );

    // Broadcast so connected clients update their UI
    state
        .ws_broadcast(
            channel.server_id,
            json!({
                "type": "channel_update",
                "channel_id": channel_id,
                "ttl_seconds": req.ttl_seconds,
            }),
        )
        .await;

    Ok(Json(json!({
        "channel_id": channel_id,
        "ttl_seconds": req.ttl_seconds,
    })))
}

// ─── PUT /conversations/:dm_id/ttl ─────────────────────────────────────

/// Set the disappearing-message TTL for a DM conversation.
/// Either participant can set or clear the timer.
/// Records who set it and when. Returns 403 if the platform toggle is off.
pub async fn set_conversation_ttl(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(dm_id): Path<Uuid>,
    Json(req): Json<SetTtlRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Platform toggle check
    let settings = get_platform_settings(&state).await?;
    if !settings.disappearing_messages_enabled {
        return Err(AppError::Forbidden(FEATURE_DISABLED_MSG.into()));
    }

    // Validate TTL value
    if let Some(ttl) = req.ttl_seconds {
        if !ALLOWED_TTLS.contains(&ttl) {
            return Err(AppError::BadRequest(format!(
                "ttl_seconds must be null or one of: {}",
                ALLOWED_TTLS.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(", ")
            )));
        }
    }

    // Verify caller is a participant
    let dm = sqlx::query!(
        "SELECT user_a, user_b FROM dm_channels WHERE id = $1",
        dm_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Conversation not found".into()))?;

    if dm.user_a != auth.user_id && dm.user_b != auth.user_id {
        return Err(AppError::Forbidden("Not a participant in this conversation".into()));
    }

    // Update TTL with attribution
    sqlx::query!(
        "UPDATE dm_channels SET ttl_seconds = $1, ttl_set_by = $2, ttl_set_at = NOW()
         WHERE id = $3",
        req.ttl_seconds,
        auth.user_id,
        dm_id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        user_id = %auth.user_id,
        dm_id = %dm_id,
        ttl_seconds = ?req.ttl_seconds,
        "Conversation TTL updated"
    );

    Ok(Json(json!({
        "dm_id": dm_id,
        "ttl_seconds": req.ttl_seconds,
        "ttl_set_by": auth.user_id,
    })))
}

// ─── Background cleanup task ────────────────────────────────────────────

/// Runs every 60 seconds. Soft-deletes messages that:
///   - belong to a channel or DM with ttl_seconds set
///   - have been read (acknowledged in message_acknowledgements)
///   - acked_at + ttl_seconds < now
///
/// Guards:
///   - Skips entirely if disappearing_messages_enabled is false.
///   - If default_retention_days > 0, messages younger than the retention
///     period are never deleted (retention overrides disappearing).
///
/// Soft-delete wipes ciphertext so content is irrecoverable.
pub async fn disappearing_cleanup_loop(db: PgPool, redis: redis::aio::ConnectionManager) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;

        // ── Check platform toggle ───────────────────────────────────────
        let settings = {
            let mut r = redis.clone();
            let cached: Option<String> = redis::cmd("GET")
                .arg("platform_settings")
                .query_async(&mut r)
                .await
                .unwrap_or(None);
            cached.and_then(|s| serde_json::from_str::<crate::discreet_platform_settings::PlatformSettings>(&s).ok())
                .unwrap_or_default()
        };

        if !settings.disappearing_messages_enabled {
            continue;
        }

        // ── Retention floor ─────────────────────────────────────────────
        // If data retention is configured, messages younger than the
        // retention period are protected from TTL deletion.
        let retention_days = settings.default_retention_days as i32;

        // 1) Channel messages: find expired voice messages first (for disk cleanup),
        //    then soft-delete all expired messages.
        let expired_voice: Result<Vec<VoiceRow>, sqlx::Error> = if retention_days > 0 {
            sqlx::query_as!(
                VoiceRow,
                r#"SELECT m.id, m.channel_id
                   FROM messages m
                   JOIN channels c ON c.id = m.channel_id
                   JOIN message_acknowledgements ma ON ma.message_id = m.id
                   WHERE m.deleted = FALSE
                     AND m.voice_duration_ms IS NOT NULL
                     AND c.ttl_seconds IS NOT NULL
                     AND ma.acked_at + make_interval(secs => c.ttl_seconds) < NOW()
                     AND m.created_at < NOW() - make_interval(days => $1)"#,
                retention_days,
            )
            .fetch_all(&db)
            .await
        } else {
            sqlx::query_as!(
                VoiceRow,
                r#"SELECT m.id, m.channel_id
                   FROM messages m
                   JOIN channels c ON c.id = m.channel_id
                   JOIN message_acknowledgements ma ON ma.message_id = m.id
                   WHERE m.deleted = FALSE
                     AND m.voice_duration_ms IS NOT NULL
                     AND c.ttl_seconds IS NOT NULL
                     AND ma.acked_at + make_interval(secs => c.ttl_seconds) < NOW()"#,
            )
            .fetch_all(&db)
            .await
        };

        // Delete voice files from disk
        if let Ok(ref rows) = expired_voice {
            for row in rows {
                let path = format!("uploads/{}/{}.enc", row.channel_id, row.id);
                if let Err(e) = tokio::fs::remove_file(&path).await {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        tracing::debug!("Failed to remove voice file {path}: {e}");
                    }
                }
            }
            if !rows.is_empty() {
                tracing::info!("Disappearing: removed {} voice files from disk", rows.len());
            }
        }

        let channel_result = if retention_days > 0 {
            sqlx::query!(
                "UPDATE messages SET deleted = TRUE, content_ciphertext = '\\x00', edited_at = NOW()
                 WHERE deleted = FALSE
                   AND id IN (
                       SELECT m.id FROM messages m
                       JOIN channels c ON c.id = m.channel_id
                       JOIN message_acknowledgements ma ON ma.message_id = m.id
                       WHERE c.ttl_seconds IS NOT NULL
                         AND ma.acked_at + make_interval(secs => c.ttl_seconds) < NOW()
                         AND m.created_at < NOW() - make_interval(days => $1)
                   )",
                retention_days,
            )
            .execute(&db)
            .await
        } else {
            sqlx::query!(
                "UPDATE messages SET deleted = TRUE, content_ciphertext = '\\x00', edited_at = NOW()
                 WHERE deleted = FALSE
                   AND id IN (
                       SELECT m.id FROM messages m
                       JOIN channels c ON c.id = m.channel_id
                       JOIN message_acknowledgements ma ON ma.message_id = m.id
                       WHERE c.ttl_seconds IS NOT NULL
                         AND ma.acked_at + make_interval(secs => c.ttl_seconds) < NOW()
                   )"
            )
            .execute(&db)
            .await
        };
        match channel_result {
            Ok(r) => {
                if r.rows_affected() > 0 {
                    tracing::info!("Disappearing (channels): soft-deleted {} read messages", r.rows_affected());
                }
            }
            Err(e) => tracing::warn!("Disappearing channel cleanup error: {e}"),
        }

        // 2) DM messages: read + TTL expired + outside retention floor
        let dm_result = if retention_days > 0 {
            sqlx::query!(
                "UPDATE dm_messages SET content_ciphertext = '\\x00'
                 WHERE id IN (
                     SELECT dm.id FROM dm_messages dm
                     JOIN dm_channels dc ON dc.id = dm.dm_channel_id
                     JOIN message_acknowledgements ma ON ma.message_id = dm.id
                     WHERE dc.ttl_seconds IS NOT NULL
                       AND ma.acked_at + make_interval(secs => dc.ttl_seconds) < NOW()
                       AND dm.content_ciphertext != '\\x00'
                       AND dm.created_at < NOW() - make_interval(days => $1)
                 )",
                retention_days,
            )
            .execute(&db)
            .await
        } else {
            sqlx::query!(
                "UPDATE dm_messages SET content_ciphertext = '\\x00'
                 WHERE id IN (
                     SELECT dm.id FROM dm_messages dm
                     JOIN dm_channels dc ON dc.id = dm.dm_channel_id
                     JOIN message_acknowledgements ma ON ma.message_id = dm.id
                     WHERE dc.ttl_seconds IS NOT NULL
                       AND ma.acked_at + make_interval(secs => dc.ttl_seconds) < NOW()
                       AND dm.content_ciphertext != '\\x00'
                 )"
            )
            .execute(&db)
            .await
        };
        match dm_result {
            Ok(r) => {
                if r.rows_affected() > 0 {
                    tracing::info!("Disappearing (DMs): wiped {} read messages", r.rows_affected());
                }
            }
            Err(e) => tracing::warn!("Disappearing DM cleanup error: {e}"),
        }
    }
}
