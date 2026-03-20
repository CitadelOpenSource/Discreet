// discreet_import_handlers.rs — Message import job management.
//
// Accepts multipart uploads of chat export files from Signal, WhatsApp,
// iMessage, and Android SMS. Creates a background import job and returns
// the job ID for progress polling.
//
// Endpoints:
//   POST /api/v1/users/@me/import       — Upload an import file and start a job.
//   GET  /api/v1/users/@me/import/:id   — Check import job status and progress.
//
// Rate limit: 5 imports per hour per user (Redis, fail-closed).

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
use crate::discreet_state::AppState;

/// Maximum import file size: 100 MB.
const MAX_IMPORT_SIZE: usize = 100 * 1024 * 1024;

/// Rate limit: 5 imports per hour per user.
const IMPORT_RATE_LIMIT: i64 = 5;

/// Rate limit sliding window: 1 hour (3600 seconds).
const IMPORT_RATE_WINDOW_SECS: i64 = 3600;

/// Returns the required file extension for the given import source,
/// or `None` if the source is not recognized.
fn required_extension(source: &str) -> Option<&'static str> {
    match source {
        "signal" | "whatsapp" => Some(".zip"),
        "imessage" => Some(".db"),
        "android_sms" => Some(".xml"),
        _ => None,
    }
}

/// Returns the file extension used when storing the import file on disk.
fn storage_extension(source: &str) -> &'static str {
    match source {
        "signal" | "whatsapp" => "zip",
        "imessage" => "db",
        "android_sms" => "xml",
        _ => "bin",
    }
}

// ─── POST /users/@me/import ─────────────────────────────────────────────

/// Upload an import file and start a background import job.
///
/// Multipart fields:
///   source — Import source: signal, whatsapp, imessage, android_sms (required)
///   file   — The export file (required, max 100 MB)
pub async fn create_import_job(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    // ── Rate limit: 5 per hour per user (fail-closed) ────────────────────
    let rate_key = format!("import_job:{}", auth.user_id);
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
            .arg(IMPORT_RATE_WINDOW_SECS)
            .query_async(&mut redis_conn)
            .await;
        if let Err(e) = expire_result {
            tracing::debug!("import rate limit EXPIRE failed: {e}");
        }
    }

    if count > IMPORT_RATE_LIMIT {
        return Err(AppError::RateLimited(
            "Too many import requests. Limit is 5 per hour.".into(),
        ));
    }

    // ── Parse multipart fields ───────────────────────────────────────────
    let mut source: Option<String> = None;
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "source" => {
                source = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| {
                            AppError::BadRequest(format!("Failed to read source: {e}"))
                        })?,
                );
            }
            "file" => {
                file_name = field.file_name().map(|s| s.to_string());
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| {
                        AppError::BadRequest(format!("Failed to read file: {e}"))
                    })?;
                file_bytes = Some(bytes.to_vec());
            }
            _ => { /* skip unknown fields */ }
        }
    }

    // ── Validate required fields ─────────────────────────────────────────
    let source =
        source.ok_or_else(|| AppError::BadRequest("source field is required".into()))?;
    let file_data =
        file_bytes.ok_or_else(|| AppError::BadRequest("file field is required".into()))?;

    // ── Validate source ──────────────────────────────────────────────────
    let expected_ext = required_extension(&source).ok_or_else(|| {
        AppError::BadRequest(
            "Invalid source. Must be one of: signal, whatsapp, imessage, android_sms".into(),
        )
    })?;

    // ── Validate file extension ──────────────────────────────────────────
    let fname = file_name
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("File must have a filename".into()))?;

    if !fname.to_lowercase().ends_with(expected_ext) {
        return Err(AppError::BadRequest(format!(
            "File for {source} import must have a {expected_ext} extension"
        )));
    }

    // ── Validate file size ───────────────────────────────────────────────
    if file_data.is_empty() {
        return Err(AppError::BadRequest("Import file cannot be empty".into()));
    }
    if file_data.len() > MAX_IMPORT_SIZE {
        return Err(AppError::PayloadTooLarge(
            "Import file exceeds the 100 MB limit".into(),
        ));
    }

    // ── Write file to disk ───────────────────────────────────────────────
    let job_id = Uuid::new_v4();
    let ext = storage_extension(&source);
    let upload_dir = "uploads/imports";
    tokio::fs::create_dir_all(upload_dir)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create import directory: {e}")))?;

    let file_path = format!("{upload_dir}/{job_id}.{ext}");
    tokio::fs::write(&file_path, &file_data)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write import file: {e}")))?;

    // ── Create import_jobs row ───────────────────────────────────────────
    sqlx::query!(
        "INSERT INTO import_jobs (id, user_id, source) VALUES ($1, $2, $3)",
        job_id,
        auth.user_id,
        source,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        user_id = %auth.user_id,
        job_id = %job_id,
        source = %source,
        file_size = file_data.len(),
        "Import job created"
    );

    // ── Spawn background processing task ─────────────────────────────────
    let db = state.db.clone();
    tokio::spawn(async move {
        process_import_job(db, job_id, source, file_path).await;
    });

    Ok((StatusCode::CREATED, Json(json!({ "id": job_id }))))
}

// ─── GET /users/@me/import/:id ──────────────────────────────────────────

/// Retrieve the status and progress of an import job.
pub async fn get_import_job(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        r#"SELECT id, source, status, total_messages, imported_count,
                  error_message, created_at, completed_at
           FROM import_jobs
           WHERE id = $1 AND user_id = $2"#,
        job_id,
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Import job not found".into()))?;

    Ok(Json(json!({
        "id": row.id,
        "source": row.source,
        "status": row.status.as_deref().unwrap_or("pending"),
        "total_messages": row.total_messages.unwrap_or(0),
        "imported_count": row.imported_count.unwrap_or(0),
        "error_message": row.error_message,
        "created_at": row.created_at.map(|t| t.to_rfc3339()),
        "completed_at": row.completed_at.map(|t| t.to_rfc3339()),
    })))
}

// ─── Background processing ──────────────────────────────────────────────

/// Process an import job in the background.
///
/// Updates status to `processing`, runs the source-specific parser, and
/// marks the job `completed` or `failed` when done. Source-specific
/// parsers (Signal protobuf, WhatsApp zip, iMessage SQLite, Android XML)
/// will be implemented in subsequent waves.
async fn process_import_job(db: sqlx::PgPool, job_id: Uuid, source: String, _file_path: String) {
    if let Err(e) = sqlx::query!(
        "UPDATE import_jobs SET status = 'processing' WHERE id = $1",
        job_id,
    )
    .execute(&db)
    .await
    {
        tracing::error!(job_id = %job_id, "Failed to mark import as processing: {e}");
        return;
    }

    tracing::info!(job_id = %job_id, source = %source, "Import processing started");

    if let Err(e) = sqlx::query!(
        "UPDATE import_jobs SET status = 'completed', completed_at = now() WHERE id = $1",
        job_id,
    )
    .execute(&db)
    .await
    {
        tracing::error!(job_id = %job_id, "Failed to mark import as completed: {e}");
        return;
    }

    tracing::info!(job_id = %job_id, source = %source, "Import completed");
}
