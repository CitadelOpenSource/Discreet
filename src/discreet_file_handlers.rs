// discreet_file_handlers.rs — Encrypted file blob upload/download.
//
// ZERO-KNOWLEDGE DESIGN:
// Files are encrypted client-side. The server stores only the opaque blob.
// The encryption key is embedded inside MLS message ciphertext, so
// only channel members can decrypt the file.
//
// Upload pipeline:
//   1. Decode base64 body.
//   2. Validate size (≤ MAX_FILE_SIZE), MIME allowlist, sanitize filename.
//   3. NOTE: Magic-byte validation is skipped — blobs are pre-encrypted
//      ciphertext, not raw file data. `magic_bytes_match` is provided for
//      any future plaintext upload path.
//
// Endpoints:
//   POST /api/v1/channels/:channel_id/files   — Upload encrypted blob
//   GET  /api/v1/files/:id                    — Download encrypted blob

use axum::{
    extract::{Path, State, Json},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

/// Maximum accepted decoded blob size: 25 MiB.
const MAX_FILE_SIZE: usize = 25 * 1024 * 1024;

/// MIME types accepted for upload. Anything else is rejected with 400.
const ALLOWED_MIME_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "audio/mpeg",
    "audio/ogg",
    "application/pdf",
    "text/plain",
    "application/zip",
];

// ─── Request / Response Types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UploadFileRequest {
    /// Base64-encoded encrypted file blob.
    pub encrypted_blob: String,
    /// Original filename for display.
    pub filename: Option<String>,
    /// Optional MIME type hint (e.g. "image/png"). NOT trusted for security.
    pub mime_type_hint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadFileResponse {
    pub id: Uuid,
    pub filename: Option<String>,
    pub size_bytes: i64,
    pub mime_type_hint: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct DownloadFileResponse {
    pub id: Uuid,
    pub encrypted_blob: String,
    pub filename: Option<String>,
    pub size_bytes: i64,
    pub mime_type_hint: Option<String>,
    pub created_at: String,
}

// ─── POST /api/v1/channels/:channel_id/files ────────────────────────────

pub async fn upload_file_blob(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<UploadFileRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Decode base64, then validate size / MIME allowlist / filename.
    let blob_bytes = decode_base64(&req.encrypted_blob)?;

    if blob_bytes.is_empty() {
        return Err(AppError::BadRequest("File blob cannot be empty".into()));
    }

    // Hard limit from config (MAX_UPLOAD_BYTES env, default 25 MB).
    if blob_bytes.len() > state.config.max_upload_bytes {
        return Err(AppError::PayloadTooLarge(format!(
            "File exceeds {}MB upload limit",
            state.config.max_upload_bytes / (1024 * 1024)
        )));
    }

    // Tier limit: upload size.
    let uploader_tier = sqlx::query_scalar!(
        "SELECT account_tier FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;
    crate::discreet_tier_limits::check_upload_size(blob_bytes.len(), &uploader_tier)?;
    let clean_filename = validate_blob_upload(
        &blob_bytes,
        req.filename.as_deref(),
        req.mime_type_hint.as_deref(),
    )?;

    // Verify channel exists and user is a member of the owning server.
    let channel = sqlx::query!(
        "SELECT server_id FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    require_membership(&state, channel.server_id, auth.user_id).await?;

    // Store encrypted blob.
    let file_id = Uuid::new_v4();
    let size = blob_bytes.len() as i64;

    sqlx::query!(
        "INSERT INTO file_blobs (id, uploader_id, encrypted_blob, size_bytes, mime_type_hint, filename, channel_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        file_id,
        auth.user_id,
        &blob_bytes,
        size,
        req.mime_type_hint,
        clean_filename,
        channel_id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        file_id = %file_id,
        channel_id = %channel_id,
        size_bytes = size,
        "Encrypted file blob uploaded"
    );

    Ok((StatusCode::CREATED, Json(UploadFileResponse {
        id: file_id,
        filename: req.filename,
        size_bytes: size,
        mime_type_hint: req.mime_type_hint,
        created_at: chrono::Utc::now().to_rfc3339(),
    })))
}

// ─── GET /api/v1/files/:id ──────────────────────────────────────────────

pub async fn download_file_blob(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(file_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Fetch the blob. Access control is lightweight for alpha:
    // any authenticated user can download if they have the file ID.
    // True access control is E2EE: you need the decryption key
    // (embedded in the MLS message) to make sense of the blob.
    let file = sqlx::query!(
        "SELECT id, encrypted_blob, size_bytes, mime_type_hint, filename, created_at
         FROM file_blobs WHERE id = $1 AND deleted = FALSE",
        file_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".into()))?;

    Ok(Json(DownloadFileResponse {
        id: file.id,
        encrypted_blob: encode_base64(&file.encrypted_blob),
        filename: file.filename,
        size_bytes: file.size_bytes,
        mime_type_hint: file.mime_type_hint,
        created_at: file.created_at.to_rfc3339(),
    }))
}

// ─── POST /api/v1/dms/:dm_id/files ──────────────────────────────────────

/// Upload a file attachment in a DM conversation.
pub async fn upload_dm_file(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(dm_id): Path<Uuid>,
    Json(req): Json<UploadFileRequest>,
) -> Result<impl IntoResponse, AppError> {
    let blob_bytes = decode_base64(&req.encrypted_blob)?;
    if blob_bytes.is_empty() { return Err(AppError::BadRequest("File blob cannot be empty".into())); }
    let clean_filename = validate_blob_upload(
        &blob_bytes,
        req.filename.as_deref(),
        req.mime_type_hint.as_deref(),
    )?;

    // Verify DM membership.
    let dm = sqlx::query!(
        "SELECT id FROM dm_channels WHERE id = $1 AND (user_a = $2 OR user_b = $2)",
        dm_id, auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Forbidden("Not a member of this DM".into()))?;

    let file_id = Uuid::new_v4();
    let size = blob_bytes.len() as i64;

    sqlx::query!(
        "INSERT INTO file_blobs (id, uploader_id, encrypted_blob, size_bytes, mime_type_hint, filename, dm_channel_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        file_id, auth.user_id, &blob_bytes, size, req.mime_type_hint, clean_filename, dm.id,
    )
    .execute(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(UploadFileResponse {
        id: file_id, filename: req.filename, size_bytes: size,
        mime_type_hint: req.mime_type_hint, created_at: chrono::Utc::now().to_rfc3339(),
    })))
}

// ─── DELETE /api/v1/files/:id ───────────────────────────────────────────

/// Soft-delete a file. Only the uploader or server owner can delete.
pub async fn delete_file(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(file_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let file = sqlx::query!(
        "SELECT uploader_id, channel_id FROM file_blobs WHERE id = $1 AND deleted = FALSE",
        file_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("File not found".into()))?;

    let is_uploader = file.uploader_id == auth.user_id;
    if !is_uploader {
        // Check if server owner via channel
        if let Some(cid) = file.channel_id {
            let ch = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", cid)
                .fetch_optional(&state.db).await?;
            if let Some(ch) = ch {
                let is_owner = sqlx::query_scalar!(
                    "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
                    ch.server_id, auth.user_id,
                ).fetch_one(&state.db).await?.unwrap_or(false);
                if !is_owner {
                    return Err(AppError::Forbidden("Only the uploader or server owner can delete files".into()));
                }
            }
        } else {
            return Err(AppError::Forbidden("Only the uploader can delete DM files".into()));
        }
    }

    // Soft delete: wipe blob data to free storage, mark deleted
    sqlx::query!(
        "UPDATE file_blobs SET deleted = TRUE, encrypted_blob = '\\x00' WHERE id = $1",
        file_id,
    )
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Validate an upload: size limit, MIME allowlist, and sanitize filename.
///
/// Magic-byte validation is intentionally NOT performed here because blobs
/// are pre-encrypted client-side (E2EE design) — the bytes the server
/// receives are opaque ciphertext.  Use `magic_bytes_match` directly for
/// any future plaintext upload path.
fn validate_blob_upload(
    blob: &[u8],
    filename: Option<&str>,
    mime_type_hint: Option<&str>,
) -> Result<Option<String>, AppError> {
    // (1) Size check → 413 Payload Too Large.
    if blob.len() > MAX_FILE_SIZE {
        return Err(AppError::PayloadTooLarge(format!(
            "File exceeds the {} MiB limit", MAX_FILE_SIZE / (1024 * 1024)
        )));
    }

    // (2) MIME type allowlist → 400 Bad Request.
    if let Some(mime) = mime_type_hint {
        let mime_base = mime.split(';').next().unwrap_or(mime).trim();
        if !ALLOWED_MIME_TYPES.contains(&mime_base) {
            return Err(AppError::BadRequest(format!(
                "File type not allowed: {mime_base}"
            )));
        }
    }

    // (4) Filename sanitization: strip path separators, null bytes, cap at 255 chars.
    let clean = filename.map(sanitize_filename);

    Ok(clean)
}

/// Returns `true` when the leading bytes of `data` are consistent with
/// `mime_type`.  Only a subset of well-known signatures is checked; all
/// other types return `true` unconditionally.
///
/// Not called from E2EE upload handlers (pre-encrypted ciphertext has no
/// predictable magic bytes).  Provided for plaintext upload paths.
#[allow(dead_code)]
fn magic_bytes_match(data: &[u8], mime_type: &str) -> bool {
    match mime_type {
        "image/png"       => data.starts_with(&[0x89, 0x50, 0x4E, 0x47]),
        "image/jpeg"      => data.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif"       => data.starts_with(&[0x47, 0x49, 0x46]),
        "application/pdf" => data.starts_with(&[0x25, 0x50, 0x44, 0x46]),
        "application/zip" => data.starts_with(&[0x50, 0x4B]),
        // No magic-byte signature defined for this type; allow it through.
        _ => true,
    }
}

/// Strip path separators (`/`, `\`) and null bytes from a filename, then
/// cap at 255 Unicode scalar values.
fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .filter(|&c| c != '/' && c != '\\' && c != '\0')
        .collect();
    let s = s.trim().to_string();
    if s.chars().count() > 255 {
        s.chars().take(255).collect()
    } else {
        s
    }
}

fn decode_base64(input: &str) -> Result<Vec<u8>, AppError> {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine;
    URL_SAFE_NO_PAD.decode(input)
        .or_else(|_| STANDARD.decode(input))
        .map_err(|e| AppError::BadRequest(format!("Invalid base64: {e}")))
}

fn encode_base64(data: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(data)
}

async fn require_membership(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<(), AppError> {
    let ok = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server_id, user_id,
    )
    .fetch_one(&state.db).await?;
    if !ok.unwrap_or(false) {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }
    Ok(())
}

// ─── Route Registration ─────────────────────────────────────────────────

pub fn file_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{delete, get, post};
    axum::Router::new()
        .route("/channels/{channel_id}/files", post(upload_file_blob))
        .route("/dms/{dm_id}/files", post(upload_dm_file))
        .route("/files/{id}", get(download_file_blob))
        .route("/files/{id}", delete(delete_file))
}
