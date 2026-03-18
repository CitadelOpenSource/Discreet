// discreet_voice_handlers.rs — Voice message upload and encryption.
//
// Accepts multipart Opus/OGG audio, encrypts at rest with a per-channel
// HKDF-derived AES-256-GCM key, writes to uploads/{channel_id}/, and
// creates a message row with voice_duration_ms and voice_waveform.
//
// Endpoints:
//   POST /api/v1/channels/:channel_id/voice — Upload a voice message.
//
// Rate limit: 10 voice messages per hour per user (Redis, fail-closed).

use std::sync::Arc;

use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::json;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, PERM_ATTACH_FILES, PERM_SEND_MESSAGES};
use crate::discreet_state::AppState;

/// Maximum voice file size: 5 MB.
const MAX_VOICE_SIZE: usize = 5 * 1024 * 1024;

/// Maximum voice duration: 2 minutes (120 000 ms).
const MAX_VOICE_DURATION_MS: i32 = 120_000;

/// Rate limit: 10 voice messages per hour per user.
const VOICE_RATE_LIMIT: i64 = 10;

/// Rate limit sliding window: 1 hour.
const VOICE_RATE_WINDOW_SECS: i64 = 3600;

/// Allowed MIME types for voice uploads.
const ALLOWED_VOICE_MIME: &[&str] = &["audio/opus", "audio/ogg"];

// ─── POST /channels/:channel_id/voice ──────────────────────────────────

/// Upload a voice message as multipart form data.
///
/// Multipart fields:
///   audio              — Opus/OGG audio file (required, max 5 MB)
///   duration_ms        — Audio duration in milliseconds (required, max 120 000)
///   content_ciphertext — Base64-encoded MLS ciphertext for the message (required)
///   mls_epoch          — MLS epoch number (required)
///   waveform           — Base64-encoded waveform preview bytes (optional)
///
/// The audio is encrypted at rest with a per-channel HKDF-derived AES-256-GCM
/// key and written to `uploads/{channel_id}/{message_id}.enc`. The nonce is
/// prepended to the ciphertext (first 12 bytes).
pub async fn send_voice_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    // ── Rate limit: 10 per hour per user (fail-closed) ──────────────────
    let rate_key = format!("voice_msg:{}", auth.user_id);
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
            .arg(VOICE_RATE_WINDOW_SECS)
            .query_async(&mut redis_conn)
            .await;
        if let Err(e) = expire_result {
            tracing::debug!("voice rate limit EXPIRE failed: {e}");
        }
    }

    if count > VOICE_RATE_LIMIT {
        return Err(AppError::RateLimited(
            "Too many voice messages. Limit is 10 per hour.".into(),
        ));
    }

    // ── Parse multipart fields ──────────────────────────────────────────
    let mut audio_bytes: Option<Vec<u8>> = None;
    let mut audio_mime: Option<String> = None;
    let mut duration_ms: Option<i32> = None;
    let mut content_ciphertext: Option<String> = None;
    let mut mls_epoch: Option<i64> = None;
    let mut waveform_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart parse error: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "audio" => {
                audio_mime = field.content_type().map(|s| s.to_string());
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read audio: {e}")))?;
                audio_bytes = Some(bytes.to_vec());
            }
            "duration_ms" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read duration_ms: {e}")))?;
                duration_ms = Some(
                    text.parse::<i32>()
                        .map_err(|_| AppError::BadRequest("duration_ms must be an integer".into()))?,
                );
            }
            "content_ciphertext" => {
                content_ciphertext = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| {
                            AppError::BadRequest(format!("Failed to read content_ciphertext: {e}"))
                        })?,
                );
            }
            "mls_epoch" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read mls_epoch: {e}")))?;
                mls_epoch = Some(
                    text.parse::<i64>()
                        .map_err(|_| AppError::BadRequest("mls_epoch must be an integer".into()))?,
                );
            }
            "waveform" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read waveform: {e}")))?;
                waveform_bytes = Some(decode_base64(&text)?);
            }
            _ => { /* skip unknown fields */ }
        }
    }

    // ── Validate required fields ────────────────────────────────────────
    let audio =
        audio_bytes.ok_or_else(|| AppError::BadRequest("audio field is required".into()))?;
    let dur =
        duration_ms.ok_or_else(|| AppError::BadRequest("duration_ms field is required".into()))?;
    let ciphertext_b64 = content_ciphertext
        .ok_or_else(|| AppError::BadRequest("content_ciphertext field is required".into()))?;
    let epoch =
        mls_epoch.ok_or_else(|| AppError::BadRequest("mls_epoch field is required".into()))?;

    // ── Validate MIME type ──────────────────────────────────────────────
    let mime = audio_mime
        .as_deref()
        .map(|m| m.split(';').next().unwrap_or(m).trim())
        .unwrap_or("");
    if !ALLOWED_VOICE_MIME.contains(&mime) {
        return Err(AppError::BadRequest(format!(
            "Invalid audio type: {mime}. Allowed: audio/opus, audio/ogg"
        )));
    }

    // ── Validate audio size ─────────────────────────────────────────────
    if audio.is_empty() {
        return Err(AppError::BadRequest("Audio data cannot be empty".into()));
    }
    if audio.len() > MAX_VOICE_SIZE {
        return Err(AppError::PayloadTooLarge(
            "Voice message exceeds the 5 MB limit".into(),
        ));
    }

    // ── Validate duration ───────────────────────────────────────────────
    if dur <= 0 {
        return Err(AppError::BadRequest(
            "duration_ms must be positive".into(),
        ));
    }
    if dur > MAX_VOICE_DURATION_MS {
        return Err(AppError::BadRequest(format!(
            "Voice message exceeds the {} second limit",
            MAX_VOICE_DURATION_MS / 1000
        )));
    }

    // ── Decode and validate ciphertext ──────────────────────────────────
    let ciphertext_bytes = decode_base64(&ciphertext_b64)?;
    if ciphertext_bytes.is_empty() {
        return Err(AppError::BadRequest(
            "content_ciphertext cannot be empty".into(),
        ));
    }
    if ciphertext_bytes.len() > 262_144 {
        return Err(AppError::BadRequest(
            "content_ciphertext exceeds 256KB limit".into(),
        ));
    }

    // ── Channel lookup + permission checks ──────────────────────────────
    let channel = sqlx::query!(
        "SELECT c.server_id, s.is_archived
         FROM channels c
         JOIN servers s ON s.id = c.server_id
         WHERE c.id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    if channel.is_archived {
        return Err(AppError::Forbidden(
            "This server is archived and read-only".into(),
        ));
    }

    require_permission(&state, channel.server_id, auth.user_id, PERM_SEND_MESSAGES).await?;
    require_permission(&state, channel.server_id, auth.user_id, PERM_ATTACH_FILES).await?;

    // ── Encrypt audio with HKDF-derived AES-256-GCM key ─────────────────
    let encrypted_audio = encrypt_voice_blob(&audio, channel_id, &state.config)?;

    // ── Write encrypted blob to disk ────────────────────────────────────
    let message_id = Uuid::new_v4();
    let upload_dir = format!("uploads/{channel_id}");
    tokio::fs::create_dir_all(&upload_dir)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create upload directory: {e}")))?;

    let file_path = format!("{upload_dir}/{message_id}.enc");
    tokio::fs::write(&file_path, &encrypted_audio)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write voice file: {e}")))?;

    // ── Insert message row ──────────────────────────────────────────────
    sqlx::query!(
        "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch,
         voice_duration_ms, voice_waveform)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        message_id,
        channel_id,
        auth.user_id,
        &ciphertext_bytes,
        epoch,
        dur,
        waveform_bytes.as_deref(),
    )
    .execute(&state.db)
    .await?;

    // ── Update server activity ──────────────────────────────────────────
    let activity_result = sqlx::query!(
        "UPDATE servers SET last_activity_at = NOW() WHERE id = $1",
        channel.server_id,
    )
    .execute(&state.db)
    .await;
    if let Err(e) = activity_result {
        tracing::debug!("Failed to update server last_activity_at: {e}");
    }

    // ── Broadcast WebSocket event ───────────────────────────────────────
    state
        .ws_broadcast(
            channel.server_id,
            json!({
                "type": "message_create",
                "channel_id": channel_id,
                "message_id": message_id,
                "author_id": auth.user_id,
                "voice_duration_ms": dur,
            }),
        )
        .await;

    tracing::info!(
        user_id = %auth.user_id,
        channel_id = %channel_id,
        message_id = %message_id,
        duration_ms = dur,
        size_bytes = audio.len(),
        "Voice message uploaded"
    );

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": message_id,
            "duration_ms": dur,
        })),
    ))
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Derive a per-channel AES-256-GCM key using HKDF-SHA256 and encrypt the
/// voice blob. Returns `nonce (12 bytes) || ciphertext`.
///
/// Key derivation:
///   ikm  = SHA-256(JWT_SECRET)
///   salt = "discreet-voice-v1"
///   info = channel_id (16 bytes)
///   key  = HKDF-Expand(ikm, salt, info) → 32 bytes
fn encrypt_voice_blob(
    plaintext: &[u8],
    channel_id: Uuid,
    config: &crate::discreet_config::Config,
) -> Result<Vec<u8>, AppError> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
    use hkdf::Hkdf;
    use rand::RngCore;
    use sha2::{Digest, Sha256};

    // Derive per-channel key from server secret.
    let master = Sha256::digest(config.jwt_secret.as_bytes());
    let hk = Hkdf::<Sha256>::new(Some(b"discreet-voice-v1"), &master);
    let mut key = [0u8; 32];
    hk.expand(channel_id.as_bytes(), &mut key)
        .map_err(|e| AppError::Internal(format!("HKDF expand failed: {e}")))?;

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Internal(format!("AES key init failed: {e}")))?;

    // Random 96-bit nonce.
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Internal(format!("Voice encryption failed: {e}")))?;

    // Prepend nonce to ciphertext for storage.
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Decode base64 (URL-safe or standard).
fn decode_base64(input: &str) -> Result<Vec<u8>, AppError> {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine;
    URL_SAFE_NO_PAD
        .decode(input)
        .or_else(|_| STANDARD.decode(input))
        .map_err(|e| AppError::BadRequest(format!("Invalid base64: {e}")))
}
