// discreet_export_handlers.rs — Data export as streamed ZIP archives.
//
// Endpoints:
//   GET /api/v1/users/@me/export-zip     — All user messages + voice files as ZIP.
//   GET /api/v1/channels/:id/export      — Single channel export (admin only).
//
// ZIP layout:
//   channels/{channel_name}/messages.json   — Array of message objects
//   channels/{channel_name}/voice/{id}.opus — Decrypted voice attachments
//
// Messages include: id, author, text (ciphertext base64), reactions,
// timestamps, voice_duration_ms. Deleted/disappeared messages are skipped.
//
// Rate limit: 1 export per hour per user (Redis, fail-closed).

use std::io::{Cursor, Write};
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use serde_json::json;
use uuid::Uuid;
use zip::write::{FileOptions, ZipWriter};

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, PERM_MANAGE_CHANNELS};
use crate::discreet_state::AppState;

/// Row type for channel message export queries (both branches must return the same type).
#[derive(sqlx::FromRow)]
struct MessageRow {
    id: Uuid,
    author_id: Uuid,
    content_ciphertext: Vec<u8>,
    created_at: DateTime<Utc>,
    edited_at: Option<DateTime<Utc>>,
    reply_to_id: Option<Uuid>,
    voice_duration_ms: Option<i32>,
    author_username: String,
}

/// Row type for reaction queries.
#[derive(sqlx::FromRow)]
struct ReactionRow {
    message_id: Uuid,
    emoji: String,
    username: String,
}

/// Rate limit: 1 export per hour per user.
const EXPORT_RATE_LIMIT: i64 = 1;
const EXPORT_RATE_WINDOW: i64 = 3600;

// ─── Rate limit helper ──────────────────────────────────────────────────

async fn enforce_export_rate(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    let rate_key = format!("data_export:{user_id}");
    let mut redis_conn = state.redis.clone();

    let count: i64 = crate::discreet_error::redis_or_503(
        redis::cmd("INCR")
            .arg(&rate_key)
            .query_async::<Option<i64>>(&mut redis_conn)
            .await,
    )?
    .unwrap_or(1);

    if count == 1 {
        let expire_result: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(EXPORT_RATE_WINDOW)
            .query_async(&mut redis_conn)
            .await;
        if let Err(e) = expire_result {
            tracing::debug!("export rate limit EXPIRE failed: {e}");
        }
    }

    if count > EXPORT_RATE_LIMIT {
        return Err(AppError::RateLimited(
            "Data export limited to 1 per hour. Please try again later.".into(),
        ));
    }

    Ok(())
}

// ─── Voice decryption (mirrors discreet_voice_handlers) ─────────────────

fn decrypt_voice_file(
    encrypted: &[u8],
    channel_id: Uuid,
    config: &crate::discreet_config::Config,
) -> Result<Vec<u8>, AppError> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
    use hkdf::Hkdf;
    use sha2::{Digest, Sha256};

    if encrypted.len() < 13 {
        return Err(AppError::Internal("Encrypted voice data too short".into()));
    }

    let master = Sha256::digest(config.jwt_secret.as_bytes());
    let hk = Hkdf::<Sha256>::new(Some(b"discreet-voice-v1"), &master);
    let mut key = [0u8; 32];
    hk.expand(channel_id.as_bytes(), &mut key)
        .map_err(|e| AppError::Internal(format!("HKDF expand failed: {e}")))?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("AES key init failed: {e}")))?;

    let nonce = Nonce::from_slice(&encrypted[..12]);
    cipher
        .decrypt(nonce, &encrypted[12..])
        .map_err(|e| AppError::Internal(format!("Voice decryption failed: {e}")))
}

// ─── Write channel messages + voice to ZIP ──────────────────────────────

async fn write_channel_to_zip(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    db: &sqlx::PgPool,
    config: &crate::discreet_config::Config,
    channel_id: Uuid,
    channel_name: &str,
    author_filter: Option<Uuid>,
) -> Result<(), AppError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    // Both branches return Vec<MessageRow> thanks to query_as!.
    let messages: Vec<MessageRow> = if let Some(uid) = author_filter {
        sqlx::query_as!(
            MessageRow,
            r#"SELECT m.id, m.author_id, m.content_ciphertext, m.created_at,
                      m.edited_at, m.reply_to_id, m.voice_duration_ms,
                      u.username as author_username
               FROM messages m
               JOIN users u ON u.id = m.author_id
               WHERE m.channel_id = $1
                 AND m.author_id = $2
                 AND m.deleted = FALSE
               ORDER BY m.created_at ASC"#,
            channel_id,
            uid,
        )
        .fetch_all(db)
        .await?
    } else {
        sqlx::query_as!(
            MessageRow,
            r#"SELECT m.id, m.author_id, m.content_ciphertext, m.created_at,
                      m.edited_at, m.reply_to_id, m.voice_duration_ms,
                      u.username as author_username
               FROM messages m
               JOIN users u ON u.id = m.author_id
               WHERE m.channel_id = $1
                 AND m.deleted = FALSE
               ORDER BY m.created_at ASC"#,
            channel_id,
        )
        .fetch_all(db)
        .await?
    };

    let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();

    // Batch-load reactions for these messages
    let reactions: Vec<ReactionRow> = if !msg_ids.is_empty() {
        sqlx::query_as!(
            ReactionRow,
            r#"SELECT mr.message_id, mr.emoji, u.username
               FROM message_reactions mr
               JOIN users u ON u.id = mr.user_id
               WHERE mr.message_id = ANY($1)
               ORDER BY mr.created_at ASC"#,
            &msg_ids,
        )
        .fetch_all(db)
        .await?
    } else {
        vec![]
    };

    // Group reactions by message_id
    let mut reaction_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> =
        std::collections::HashMap::new();
    for r in &reactions {
        reaction_map
            .entry(r.message_id)
            .or_default()
            .push(json!({ "emoji": r.emoji, "user": r.username }));
    }

    // Build JSON array
    let safe_name = channel_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    let dir = format!("channels/{safe_name}");

    let mut msg_json: Vec<serde_json::Value> = Vec::with_capacity(messages.len());
    let mut voice_ids: Vec<(Uuid, i32)> = Vec::new();

    for m in &messages {
        let ct_b64 = STANDARD.encode(&m.content_ciphertext);
        let mut obj = json!({
            "id": m.id,
            "author": m.author_username,
            "author_id": m.author_id,
            "content_ciphertext": ct_b64,
            "created_at": m.created_at.to_rfc3339(),
        });
        if let Some(edited) = m.edited_at {
            obj["edited_at"] = json!(edited.to_rfc3339());
        }
        if let Some(reply_id) = m.reply_to_id {
            obj["reply_to_id"] = json!(reply_id);
        }
        if let Some(dur) = m.voice_duration_ms {
            obj["voice_duration_ms"] = json!(dur);
            obj["voice_file"] = json!(format!("voice/{}.opus", m.id));
            voice_ids.push((m.id, dur));
        }
        if let Some(rxns) = reaction_map.get(&m.id) {
            obj["reactions"] = json!(rxns);
        }
        msg_json.push(obj);
    }

    // Write messages.json
    let opts: FileOptions<()> = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let json_bytes = serde_json::to_vec_pretty(&msg_json)
        .map_err(|e| AppError::Internal(format!("JSON serialization error: {e}")))?;

    zip.start_file(format!("{dir}/messages.json"), opts)
        .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
    zip.write_all(&json_bytes)
        .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;

    // Write voice files
    for (msg_id, _dur) in &voice_ids {
        let file_path = format!("uploads/{channel_id}/{msg_id}.enc");
        if let Ok(encrypted) = tokio::fs::read(&file_path).await {
            if let Ok(audio) = decrypt_voice_file(&encrypted, channel_id, config) {
                zip.start_file(format!("{dir}/voice/{msg_id}.opus"), opts)
                    .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
                zip.write_all(&audio)
                    .map_err(|e| AppError::Internal(format!("ZIP write error: {e}")))?;
            }
        }
    }

    Ok(())
}

// ─── GET /users/@me/export-zip ──────────────────────────────────────────

/// Export all of the calling user's messages across all channels as a ZIP.
/// Includes voice attachments as decrypted .opus files.
/// Rate limited to 1 export per hour.
pub async fn export_user_zip(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<Response, AppError> {
    enforce_export_rate(&state, auth.user_id).await?;

    // Find all channels where the user has sent messages
    let channels = sqlx::query!(
        r#"SELECT DISTINCT c.id, c.name
           FROM messages m
           JOIN channels c ON c.id = m.channel_id
           WHERE m.author_id = $1 AND m.deleted = FALSE
           ORDER BY c.name"#,
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    // Also get DM channels
    let dm_channels = sqlx::query!(
        r#"SELECT dc.id, u.username as other_username
           FROM dm_channels dc
           JOIN users u ON u.id = CASE
               WHEN dc.user_a = $1 THEN dc.user_b
               ELSE dc.user_a
           END
           WHERE dc.user_a = $1 OR dc.user_b = $1"#,
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let buf = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buf);

    // Server channels (only user's own messages)
    for ch in &channels {
        write_channel_to_zip(
            &mut zip,
            &state.db,
            &state.config,
            ch.id,
            &ch.name,
            Some(auth.user_id),
        )
        .await?;
    }

    // DM messages
    for dm in &dm_channels {
        let dm_name = format!("dm-{}", dm.other_username);
        // DM messages are in a separate table
        let dm_msgs = sqlx::query!(
            r#"SELECT dm.id, dm.sender_id, dm.content_ciphertext, dm.created_at,
                      u.username as author_username
               FROM dm_messages dm
               JOIN users u ON u.id = dm.sender_id
               WHERE dm.dm_channel_id = $1
                 AND dm.sender_id = $2
                 AND dm.content_ciphertext != '\x00'
               ORDER BY dm.created_at ASC"#,
            dm.id,
            auth.user_id,
        )
        .fetch_all(&state.db)
        .await?;

        if dm_msgs.is_empty() {
            continue;
        }

        let msg_json: Vec<serde_json::Value> = dm_msgs
            .iter()
            .map(|m| {
                use base64::engine::general_purpose::STANDARD;
                use base64::Engine;
                json!({
                    "id": m.id,
                    "author": m.author_username,
                    "author_id": m.sender_id,
                    "content_ciphertext": STANDARD.encode(&m.content_ciphertext),
                    "created_at": m.created_at.to_rfc3339(),
                })
            })
            .collect();

        let safe_name = dm_name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>();

        let opts: FileOptions<()> = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let json_bytes = serde_json::to_vec_pretty(&msg_json)
            .map_err(|e| AppError::Internal(format!("JSON error: {e}")))?;

        zip.start_file(format!("dms/{safe_name}/messages.json"), opts)
            .map_err(|e| AppError::Internal(format!("ZIP error: {e}")))?;
        zip.write_all(&json_bytes)
            .map_err(|e| AppError::Internal(format!("ZIP error: {e}")))?;
    }

    let finished = zip.finish()
        .map_err(|e| AppError::Internal(format!("ZIP finalize error: {e}")))?;
    let zip_bytes = finished.into_inner();

    tracing::info!(
        user_id = %auth.user_id,
        size_bytes = zip_bytes.len(),
        "User data ZIP export generated"
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"))
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename=\"discreet-export.zip\""),
        )
        .header(header::TRANSFER_ENCODING, HeaderValue::from_static("chunked"))
        .body(Body::from(zip_bytes))
        .map_err(|e| AppError::Internal(format!("Response build error: {e}")))
}

// ─── GET /channels/:channel_id/export ───────────────────────────────────

/// Export an entire channel's message history as a ZIP. Admin only.
/// Includes all authors' messages + voice files.
pub async fn export_channel_zip(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
) -> Result<Response, AppError> {
    // Verify channel exists and get server_id for permission check
    let channel = sqlx::query!(
        "SELECT c.name, c.server_id FROM channels c WHERE c.id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_permission(&state, channel.server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;
    enforce_export_rate(&state, auth.user_id).await?;

    let buf = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(buf);

    write_channel_to_zip(
        &mut zip,
        &state.db,
        &state.config,
        channel_id,
        &channel.name,
        None, // all authors
    )
    .await?;

    let finished = zip.finish()
        .map_err(|e| AppError::Internal(format!("ZIP finalize error: {e}")))?;
    let zip_bytes = finished.into_inner();

    tracing::info!(
        user_id = %auth.user_id,
        channel_id = %channel_id,
        channel_name = %channel.name,
        size_bytes = zip_bytes.len(),
        "Channel ZIP export generated"
    );

    let filename = format!(
        "attachment; filename=\"discreet-channel-{}.zip\"",
        channel.name.chars().filter(|c| c.is_alphanumeric() || *c == '-').collect::<String>()
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"))
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&filename).unwrap_or_else(|_| {
                HeaderValue::from_static("attachment; filename=\"discreet-channel-export.zip\"")
            }),
        )
        .header(header::TRANSFER_ENCODING, HeaderValue::from_static("chunked"))
        .body(Body::from(zip_bytes))
        .map_err(|e| AppError::Internal(format!("Response build error: {e}")))
}
