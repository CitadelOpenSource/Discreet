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

use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;

use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
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

/// Maximum channel name length (group_dm_channels.name is VARCHAR(100)).
const MAX_CHANNEL_NAME: usize = 100;

/// How often to flush imported_count to the database.
const PROGRESS_FLUSH_INTERVAL: i32 = 100;

/// Returns the file extension for the given import source (without dot),
/// or `None` if the source is not recognized.
fn source_extension(source: &str) -> Option<&'static str> {
    match source {
        "signal" | "whatsapp" => Some("zip"),
        "imessage" => Some("db"),
        "android_sms" => Some("xml"),
        _ => None,
    }
}

/// Truncate a string to `max` characters, appending "..." if truncated.
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max.saturating_sub(3)).collect();
        format!("{truncated}...")
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
    let ext = source_extension(&source).ok_or_else(|| {
        AppError::BadRequest(
            "Invalid source. Must be one of: signal, whatsapp, imessage, android_sms".into(),
        )
    })?;

    // ── Validate file extension ──────────────────────────────────────────
    let fname = file_name
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("File must have a filename".into()))?;

    let expected_ext_dot = format!(".{ext}");
    if !fname.to_lowercase().ends_with(&expected_ext_dot) {
        return Err(AppError::BadRequest(format!(
            "File for {source} import must have a {expected_ext_dot} extension"
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
    let user_id = auth.user_id;
    tokio::spawn(async move {
        process_import_job(db, job_id, user_id, source, file_path).await;
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

// ─── Signal Export JSON Types ───────────────────────────────────────────

/// Top-level Signal backup structure (from signal-export / Signal Desktop JSON).
#[derive(Debug, Deserialize)]
struct SignalBackup {
    #[serde(default)]
    conversations: Vec<SignalConversation>,
}

/// A single Signal conversation (1:1 or group).
#[derive(Debug, Deserialize)]
struct SignalConversation {
    name: Option<String>,
    phone: Option<String>,
    #[serde(rename = "type")]
    conversation_type: Option<String>,
    #[serde(default)]
    messages: Vec<SignalMessage>,
}

/// A single message within a Signal conversation.
#[derive(Debug, Deserialize)]
struct SignalMessage {
    sender: Option<String>,
    #[serde(alias = "senderName")]
    sender_name: Option<String>,
    timestamp: Option<i64>,
    body: Option<String>,
    #[serde(rename = "type")]
    _message_type: Option<String>,
    #[serde(default)]
    attachments: Vec<SignalAttachment>,
    #[serde(default)]
    reactions: Vec<serde_json::Value>,
    sticker: Option<serde_json::Value>,
}

/// An attachment reference in a Signal message.
#[derive(Debug, Deserialize)]
struct SignalAttachment {
    #[serde(alias = "fileName")]
    file_name: Option<String>,
    #[serde(alias = "contentType")]
    content_type: Option<String>,
}

// ─── Imported Message Content ───────────────────────────────────────────

/// JSON structure stored in content_ciphertext for imported messages.
/// The client reads is_imported=true and parses this as plaintext JSON
/// instead of attempting E2EE decryption.
#[derive(Serialize)]
struct ImportedContent {
    from: String,
    body: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<String>,
}

// ─── Background Processing ──────────────────────────────────────────────

/// Process an import job in the background.
///
/// Marks the job as `processing`, dispatches to the source-specific parser,
/// and records the final status (`completed` or `failed`).
async fn process_import_job(
    db: sqlx::PgPool,
    job_id: Uuid,
    user_id: Uuid,
    source: String,
    file_path: String,
) {
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

    let result = match source.as_str() {
        "signal" => parse_signal_export(&db, job_id, user_id, &file_path).await,
        "whatsapp" => parse_whatsapp_export(&db, job_id, user_id, &file_path).await,
        "imessage" => parse_imessage_export(&db, job_id, user_id, &file_path).await,
        "android_sms" => parse_android_sms_export(&db, job_id, user_id, &file_path).await,
        other => Err(format!("{other} parser not yet implemented")),
    };

    match result {
        Ok(()) => {
            tracing::info!(job_id = %job_id, source = %source, "Import completed");
        }
        Err(msg) => {
            tracing::error!(job_id = %job_id, source = %source, error = %msg, "Import failed");
            if let Err(db_err) = sqlx::query!(
                "UPDATE import_jobs SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1",
                job_id,
                msg,
            )
            .execute(&db)
            .await
            {
                tracing::error!(job_id = %job_id, "Failed to write failure status to DB: {db_err}");
            }
        }
    }
}

// ─── Signal Parser ──────────────────────────────────────────────────────

/// Parse a Signal export ZIP and import conversations into group DM channels.
///
/// Each Signal conversation (1:1 or group) becomes a `group_dm_channel`
/// owned by the importing user. Messages are stored as plaintext JSON in
/// `content_ciphertext` with `is_imported = TRUE`. The original sender
/// name, body, and attachment references are preserved in the JSON content.
///
/// Group DM channels are used for all imports because `dm_channels` requires
/// both participants to be registered Discreet users, while Signal contacts
/// are identified by phone number and may not have accounts.
async fn parse_signal_export(
    db: &sqlx::PgPool,
    job_id: Uuid,
    user_id: Uuid,
    file_path: &str,
) -> Result<(), String> {
    // ── Read and extract ZIP ─────────────────────────────────────────────
    let file_data = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("Failed to read import file: {e}"))?;

    let cursor = std::io::Cursor::new(file_data);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Invalid ZIP file: {e}"))?;

    // ── Scan for signal_backup.json or signal.db ─────────────────────────
    let mut json_content: Option<String> = None;
    let mut found_db = false;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("ZIP entry error: {e}"))?;
        let name = entry.name().to_string();

        if name == "signal_backup.json" || name.ends_with("/signal_backup.json") {
            let mut buf = String::new();
            entry
                .read_to_string(&mut buf)
                .map_err(|e| format!("Failed to read signal_backup.json: {e}"))?;
            json_content = Some(buf);
            break;
        }
        if name == "signal.db" || name.ends_with("/signal.db") {
            found_db = true;
        }
    }

    // Free ZIP memory before the long-running INSERT loop.
    drop(archive);

    let json_str = match json_content {
        Some(s) => s,
        None if found_db => {
            return Err(
                "Found signal.db but SQLite import is not yet supported. \
                 Please export as JSON using signal-export or similar tool."
                    .into(),
            );
        }
        None => {
            return Err(
                "ZIP does not contain signal_backup.json or signal.db".into(),
            );
        }
    };

    // ── Parse JSON ───────────────────────────────────────────────────────
    let backup: SignalBackup = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse signal_backup.json: {e}"))?;

    if backup.conversations.is_empty() {
        return Err("No conversations found in signal_backup.json".into());
    }

    // ── Count total messages ─────────────────────────────────────────────
    let total_messages: i32 = backup
        .conversations
        .iter()
        .map(|c| c.messages.len() as i32)
        .sum();

    sqlx::query!(
        "UPDATE import_jobs SET total_messages = $2 WHERE id = $1",
        job_id,
        total_messages,
    )
    .execute(db)
    .await
    .map_err(|e| format!("DB error updating total_messages: {e}"))?;

    // ── Process each conversation ────────────────────────────────────────
    let mut imported_count: i32 = 0;
    let mut skipped_stickers: i32 = 0;
    let mut skipped_reactions: i32 = 0;
    let mut skipped_empty: i32 = 0;

    for conv in &backup.conversations {
        if conv.messages.is_empty() {
            continue;
        }

        // Determine conversation display name.
        let conv_name = conv
            .name
            .as_deref()
            .or(conv.phone.as_deref())
            .unwrap_or("Unknown Contact");

        let is_group = conv.conversation_type.as_deref() == Some("group");
        let label = if is_group {
            format!("[Signal Group] {conv_name}")
        } else {
            format!("[Signal] {conv_name}")
        };
        let channel_name = truncate_chars(&label, MAX_CHANNEL_NAME);

        // Create a group_dm_channel for this conversation.
        let group = sqlx::query!(
            "INSERT INTO group_dm_channels (name, owner_id) VALUES ($1, $2) RETURNING id",
            channel_name,
            user_id,
        )
        .fetch_one(db)
        .await
        .map_err(|e| format!("Failed to create import channel '{channel_name}': {e}"))?;

        let group_dm_id = group.id;

        // Add importing user as sole member.
        sqlx::query!(
            "INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2)",
            group_dm_id,
            user_id,
        )
        .execute(db)
        .await
        .map_err(|e| format!("Failed to add member to import channel: {e}"))?;

        // ── Insert messages for this conversation ────────────────────────
        for msg in &conv.messages {
            let body = msg.body.as_deref().unwrap_or("");
            let has_attachments = !msg.attachments.is_empty();

            // Skip sticker-only messages (no body text).
            if msg.sticker.is_some() && body.is_empty() {
                skipped_stickers += 1;
                continue;
            }

            // Skip messages with no body and no attachments.
            if body.is_empty() && !has_attachments {
                skipped_empty += 1;
                continue;
            }

            // Count skipped reactions (message is still imported, reaction
            // data is not because it references other messages).
            if !msg.reactions.is_empty() {
                skipped_reactions += msg.reactions.len() as i32;
            }

            // Build sender display name.
            let sender_display = msg
                .sender_name
                .as_deref()
                .or(msg.sender.as_deref())
                .unwrap_or("Unknown");

            // Collect attachment filenames.
            let attachment_names: Vec<String> = msg
                .attachments
                .iter()
                .filter_map(|a| {
                    a.file_name.clone().or_else(|| {
                        a.content_type.as_ref().map(|ct| {
                            format!(
                                "attachment.{}",
                                ct.split('/').next_back().unwrap_or("bin")
                            )
                        })
                    })
                })
                .collect();

            // Build content JSON stored in content_ciphertext.
            let content = ImportedContent {
                from: sender_display.to_string(),
                body: if body.is_empty() && has_attachments {
                    "[attachment]".to_string()
                } else {
                    body.to_string()
                },
                attachments: attachment_names,
            };

            let content_bytes = serde_json::to_vec(&content)
                .map_err(|e| format!("JSON serialization error: {e}"))?;

            // Convert millisecond timestamp, fall back to now().
            let ts_ms = msg.timestamp.unwrap_or(0);
            let created_at: DateTime<Utc> = Utc
                .timestamp_millis_opt(ts_ms)
                .single()
                .unwrap_or_else(Utc::now);

            // Insert imported message.
            sqlx::query!(
                "INSERT INTO group_dm_messages \
                     (group_dm_id, sender_id, content_ciphertext, is_imported, created_at) \
                 VALUES ($1, $2, $3, TRUE, $4)",
                group_dm_id,
                user_id,
                content_bytes,
                created_at,
            )
            .execute(db)
            .await
            .map_err(|e| format!("Failed to insert imported message: {e}"))?;

            imported_count += 1;

            // Flush progress to DB periodically.
            if imported_count % PROGRESS_FLUSH_INTERVAL == 0 {
                let _ = sqlx::query!(
                    "UPDATE import_jobs SET imported_count = $2 WHERE id = $1",
                    job_id,
                    imported_count,
                )
                .execute(db)
                .await;
            }
        }
    }

    // ── Log skipped items ────────────────────────────────────────────────
    if skipped_stickers > 0 {
        tracing::warn!(
            job_id = %job_id,
            count = skipped_stickers,
            "Skipped sticker-only messages (unsupported)"
        );
    }
    if skipped_reactions > 0 {
        tracing::warn!(
            job_id = %job_id,
            count = skipped_reactions,
            "Skipped reactions (unsupported)"
        );
    }
    if skipped_empty > 0 {
        tracing::warn!(
            job_id = %job_id,
            count = skipped_empty,
            "Skipped empty messages (no body or attachments)"
        );
    }

    // ── Mark completed ───────────────────────────────────────────────────
    sqlx::query!(
        "UPDATE import_jobs SET status = 'completed', imported_count = $2, completed_at = now() WHERE id = $1",
        job_id,
        imported_count,
    )
    .execute(db)
    .await
    .map_err(|e| format!("Failed to mark import as completed: {e}"))?;

    tracing::info!(
        job_id = %job_id,
        total = total_messages,
        imported = imported_count,
        skipped_stickers,
        skipped_empty,
        "Signal import completed"
    );

    Ok(())
}

// ─── WhatsApp Parser ────────────────────────────────────────────────────

/// Regex for WhatsApp message lines with a sender.
///
/// Matches both bracketed `[DD/MM/YYYY, HH:MM:SS] Sender: Message`
/// and unbracketed `DD/MM/YYYY, HH:MM - Sender: Message` formats,
/// with optional seconds and AM/PM.
const WHATSAPP_MSG_PATTERN: &str =
    r"^\[?(\d{1,2}/\d{1,2}/\d{2,4}),?\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]?\s?[-–]?\s?(.+?):\s(.*)";

/// Regex for any line starting with a WhatsApp-style timestamp.
/// Used to identify system messages (timestamp present but no `Sender: ` pattern).
const WHATSAPP_TS_PREFIX: &str = r"^\[?\d{1,2}/\d{1,2}/\d{2,4},?\s\d{1,2}:\d{2}";

/// A parsed WhatsApp message.
struct WhatsAppParsedMsg {
    sender: String,
    body: String,
    timestamp: DateTime<Utc>,
}

/// Parse a WhatsApp export ZIP and import conversations into group DM channels.
///
/// WhatsApp exports contain `.txt` files (one per conversation) with lines
/// in the format `[DD/MM/YYYY, HH:MM:SS] Sender: Message`. Each conversation
/// becomes a `group_dm_channel` owned by the importing user. Media files in
/// the `media/` directory are logged but not imported (tracked for post-launch).
async fn parse_whatsapp_export(
    db: &sqlx::PgPool,
    job_id: Uuid,
    user_id: Uuid,
    file_path: &str,
) -> Result<(), String> {
    // ── Read and extract ZIP ─────────────────────────────────────────────
    let file_data = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("Failed to read import file: {e}"))?;

    let cursor = std::io::Cursor::new(file_data);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Invalid ZIP file: {e}"))?;

    // ── Collect chat .txt files and count media files ────────────────────
    let mut chat_files: Vec<(String, String)> = Vec::new();
    let mut media_file_count: i32 = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("ZIP entry error: {e}"))?;
        let name = entry.name().to_string();

        if entry.is_dir() {
            continue;
        }

        if name.starts_with("media/") || name.contains("/media/") {
            media_file_count += 1;
            continue;
        }

        if name.ends_with(".txt") {
            let mut content = String::new();
            entry
                .read_to_string(&mut content)
                .map_err(|e| format!("Failed to read {name}: {e}"))?;
            if !content.is_empty() {
                chat_files.push((name, content));
            }
        }
    }

    // Free ZIP memory before the long-running INSERT loop.
    drop(archive);

    if chat_files.is_empty() {
        return Err("ZIP does not contain any WhatsApp chat .txt files".into());
    }

    // ── Compile regexes ──────────────────────────────────────────────────
    let msg_re = regex_lite::Regex::new(WHATSAPP_MSG_PATTERN)
        .map_err(|e| format!("Regex compile error: {e}"))?;
    let ts_re = regex_lite::Regex::new(WHATSAPP_TS_PREFIX)
        .map_err(|e| format!("Regex compile error: {e}"))?;

    // ── Parse all chat files, then derive total from results ────────────
    let mut parsed_chats: Vec<(String, Vec<WhatsAppParsedMsg>)> = Vec::new();
    let mut skipped_system: i32 = 0;
    let mut total_messages: i32 = 0;

    for (filename, content) in &chat_files {
        let conv_name = extract_whatsapp_contact(filename);
        let channel_name = truncate_chars(
            &format!("[WhatsApp] {conv_name}"),
            MAX_CHANNEL_NAME,
        );

        let day_first = detect_whatsapp_date_order(&msg_re, content);
        let (messages, sys_count) =
            parse_whatsapp_chat_lines(&msg_re, &ts_re, content, day_first);
        skipped_system += sys_count;
        total_messages += messages.len() as i32;

        if !messages.is_empty() {
            parsed_chats.push((channel_name, messages));
        }
    }

    sqlx::query!(
        "UPDATE import_jobs SET total_messages = $2 WHERE id = $1",
        job_id,
        total_messages,
    )
    .execute(db)
    .await
    .map_err(|e| format!("DB error updating total_messages: {e}"))?;

    // ── Process each parsed conversation ─────────────────────────────────
    let mut imported_count: i32 = 0;

    for (channel_name, messages) in &parsed_chats {
        // Create group_dm_channel for this conversation.
        let group = sqlx::query!(
            "INSERT INTO group_dm_channels (name, owner_id) VALUES ($1, $2) RETURNING id",
            channel_name,
            user_id,
        )
        .fetch_one(db)
        .await
        .map_err(|e| format!("Failed to create import channel '{channel_name}': {e}"))?;

        let group_dm_id = group.id;

        sqlx::query!(
            "INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2)",
            group_dm_id,
            user_id,
        )
        .execute(db)
        .await
        .map_err(|e| format!("Failed to add member to import channel: {e}"))?;

        // ── Insert messages ──────────────────────────────────────────────
        for msg in messages {
            let imported = ImportedContent {
                from: msg.sender.clone(),
                body: msg.body.clone(),
                attachments: Vec::new(),
            };

            let content_bytes = serde_json::to_vec(&imported)
                .map_err(|e| format!("JSON serialization error: {e}"))?;

            sqlx::query!(
                "INSERT INTO group_dm_messages \
                     (group_dm_id, sender_id, content_ciphertext, is_imported, created_at) \
                 VALUES ($1, $2, $3, TRUE, $4)",
                group_dm_id,
                user_id,
                content_bytes,
                msg.timestamp,
            )
            .execute(db)
            .await
            .map_err(|e| format!("Failed to insert imported message: {e}"))?;

            imported_count += 1;

            if imported_count % PROGRESS_FLUSH_INTERVAL == 0 {
                let _ = sqlx::query!(
                    "UPDATE import_jobs SET imported_count = $2 WHERE id = $1",
                    job_id,
                    imported_count,
                )
                .execute(db)
                .await;
            }
        }
    }

    // ── Log diagnostics ──────────────────────────────────────────────────
    if skipped_system > 0 {
        tracing::warn!(
            job_id = %job_id,
            count = skipped_system,
            "Skipped WhatsApp system messages"
        );
    }
    if media_file_count > 0 {
        tracing::warn!(
            job_id = %job_id,
            count = media_file_count,
            "Media files present in ZIP but not imported (post-launch)"
        );
    }

    // ── Mark completed ───────────────────────────────────────────────────
    sqlx::query!(
        "UPDATE import_jobs SET status = 'completed', imported_count = $2, completed_at = now() WHERE id = $1",
        job_id,
        imported_count,
    )
    .execute(db)
    .await
    .map_err(|e| format!("Failed to mark import as completed: {e}"))?;

    tracing::info!(
        job_id = %job_id,
        conversations = parsed_chats.len(),
        imported = imported_count,
        skipped_system,
        media_file_count,
        "WhatsApp import completed"
    );

    Ok(())
}

// ─── WhatsApp Helpers ───────────────────────────────────────────────────

/// Extract the contact or group name from a WhatsApp export filename.
///
/// Common patterns:
///   "WhatsApp Chat - John Doe.txt" → "John Doe"
///   "WhatsApp Chat with John.txt"  → "John"
///   "_chat.txt"                    → "Unknown Chat"
fn extract_whatsapp_contact(filename: &str) -> String {
    let basename = filename
        .rsplit('/')
        .next()
        .unwrap_or(filename)
        .trim_end_matches(".txt");

    if basename == "_chat" || basename.is_empty() {
        return "Unknown Chat".to_string();
    }

    if let Some(after) = basename.strip_prefix("WhatsApp Chat - ") {
        if !after.is_empty() {
            return after.to_string();
        }
    }
    if let Some(after) = basename.strip_prefix("WhatsApp Chat with ") {
        if !after.is_empty() {
            return after.to_string();
        }
    }

    basename.to_string()
}

/// Auto-detect whether dates in the file use DD/MM (day-first) or MM/DD
/// (month-first) by scanning the first 200 timestamp lines.
///
/// If the first number in any date exceeds 12, it must be a day → DD/MM.
/// If the second number exceeds 12, it must be a day → MM/DD.
/// Default: DD/MM (more common globally).
fn detect_whatsapp_date_order(msg_re: &regex_lite::Regex, content: &str) -> bool {
    for line in content.lines().take(200) {
        if let Some(caps) = msg_re.captures(line) {
            if let Some(date_match) = caps.get(1) {
                let parts: Vec<&str> = date_match.as_str().split('/').collect();
                if parts.len() >= 2 {
                    let first: u32 = parts[0].parse().unwrap_or(0);
                    let second: u32 = parts[1].parse().unwrap_or(0);
                    if first > 12 {
                        return true;
                    }
                    if second > 12 {
                        return false;
                    }
                }
            }
        }
    }
    true
}

/// Parse a WhatsApp date + time string into a UTC timestamp.
///
/// Handles DD/MM/YYYY or MM/DD/YYYY, 24-hour or 12-hour (AM/PM),
/// 2-digit or 4-digit years.
fn parse_whatsapp_timestamp(
    date_str: &str,
    time_str: &str,
    day_first: bool,
) -> DateTime<Utc> {
    let parts: Vec<&str> = date_str.split('/').collect();
    if parts.len() < 3 {
        return Utc::now();
    }

    let (day, month) = if day_first {
        (
            parts[0].parse::<u32>().unwrap_or(1),
            parts[1].parse::<u32>().unwrap_or(1),
        )
    } else {
        (
            parts[1].parse::<u32>().unwrap_or(1),
            parts[0].parse::<u32>().unwrap_or(1),
        )
    };

    let mut year: i32 = parts[2].parse().unwrap_or(2024);
    if year < 100 {
        year += 2000;
    }

    // Parse time with optional seconds and AM/PM.
    let time_lower = time_str.trim().to_ascii_lowercase();
    let is_pm = time_lower.ends_with("pm");
    let is_am = time_lower.ends_with("am");
    let time_digits = time_str
        .trim()
        .trim_end_matches(|c: char| c.is_ascii_alphabetic() || c == ' ');

    let tp: Vec<&str> = time_digits.split(':').collect();
    let mut hour: u32 = tp.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minute: u32 = tp.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let second: u32 = tp.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);

    if is_pm && hour < 12 {
        hour += 12;
    }
    if is_am && hour == 12 {
        hour = 0;
    }

    Utc.with_ymd_and_hms(year, month, day, hour, minute, second)
        .single()
        .unwrap_or_else(Utc::now)
}

/// Parse all messages from a WhatsApp chat `.txt` file.
///
/// Returns `(messages, system_message_count)`. Multi-line messages
/// (continuation lines without a timestamp prefix) are merged into the
/// previous message body. Timestamped lines without a `Sender: ` pattern
/// are counted as system messages and skipped.
fn parse_whatsapp_chat_lines(
    msg_re: &regex_lite::Regex,
    ts_re: &regex_lite::Regex,
    content: &str,
    day_first: bool,
) -> (Vec<WhatsAppParsedMsg>, i32) {
    let mut messages: Vec<WhatsAppParsedMsg> = Vec::new();
    let mut system_count: i32 = 0;

    for line in content.lines() {
        if let Some(caps) = msg_re.captures(line) {
            let date_str = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let time_str = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let sender = caps.get(3).map(|m| m.as_str()).unwrap_or("").to_string();
            let body = caps.get(4).map(|m| m.as_str()).unwrap_or("").to_string();

            messages.push(WhatsAppParsedMsg {
                sender,
                body,
                timestamp: parse_whatsapp_timestamp(date_str, time_str, day_first),
            });
        } else if ts_re.is_match(line) {
            // Timestamped line without "Sender: " pattern → system message.
            system_count += 1;
        } else if !line.trim().is_empty() {
            // Continuation of previous multi-line message.
            if let Some(last) = messages.last_mut() {
                last.body.push('\n');
                last.body.push_str(line);
            }
        }
    }

    (messages, system_count)
}

// ─── iMessage Parser ────────────────────────────────────────────────────

/// Core Data epoch offset: seconds between Unix epoch (1970-01-01) and
/// Core Data epoch (2001-01-01).
const CORE_DATA_EPOCH_OFFSET: i64 = 978_307_200;

/// Convert an iMessage Core Data timestamp to UTC.
///
/// macOS 10.13+ stores nanoseconds since 2001-01-01; older versions use
/// seconds. Heuristic: values above 1 trillion are nanoseconds.
fn core_data_to_utc(date: i64) -> DateTime<Utc> {
    let unix_secs = if date > 1_000_000_000_000 {
        (date / 1_000_000_000) + CORE_DATA_EPOCH_OFFSET
    } else {
        date + CORE_DATA_EPOCH_OFFSET
    };
    Utc.timestamp_opt(unix_secs, 0)
        .single()
        .unwrap_or_else(Utc::now)
}

/// A pre-serialized iMessage ready for async PostgreSQL insertion.
/// Produced inside `spawn_blocking` so rusqlite never crosses an await point.
struct PreparedImessageMsg {
    chat_id: String,
    chat_name: String,
    content_bytes: Vec<u8>,
    created_at: DateTime<Utc>,
}

/// Parse an iMessage `chat.db` SQLite file and import conversations into
/// group DM channels.
///
/// All rusqlite operations run inside `spawn_blocking` to avoid Send errors.
/// The blocking closure reads the SQLite file, serializes every message to
/// JSON bytes, and returns a `Vec<PreparedImessageMsg>`. The async half
/// then groups by conversation and inserts into PostgreSQL.
async fn parse_imessage_export(
    db: &sqlx::PgPool,
    job_id: Uuid,
    user_id: Uuid,
    file_path: &str,
) -> Result<(), String> {
    // ── Phase 1: read everything from SQLite on a blocking thread ────────
    let path = file_path.to_string();
    let prepared = tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| format!("Failed to open iMessage database: {e}"))?;

        // Build attachment lookup: message ROWID → [filename].
        let mut attachment_map: HashMap<i64, Vec<String>> = HashMap::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT maj.message_id, a.filename, a.mime_type \
                     FROM message_attachment_join maj \
                     JOIN attachment a ON maj.attachment_id = a.ROWID",
                )
                .map_err(|e| format!("SQLite attachment query error: {e}"))?;

            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .map_err(|e| format!("SQLite attachment query error: {e}"))?;

            for row in rows {
                let (msg_id, filename, mime_type) =
                    row.map_err(|e| format!("SQLite attachment row error: {e}"))?;
                let display = filename
                    .or_else(|| {
                        mime_type.map(|m| {
                            format!(
                                "attachment.{}",
                                m.split('/').next_back().unwrap_or("bin")
                            )
                        })
                    })
                    .unwrap_or_else(|| "attachment".to_string());
                attachment_map.entry(msg_id).or_default().push(display);
            }
        }

        // Query all messages with handle and chat info.
        struct RawMsg {
            rowid: i64,
            text: Option<String>,
            date: i64,
            is_from_me: bool,
            sender: String,
            chat_name: String,
            chat_id: String,
        }

        let mut stmt = conn
            .prepare(
                "SELECT m.ROWID, m.text, m.date, m.is_from_me, \
                        COALESCE(h.id, '') AS sender_id, \
                        COALESCE(c.display_name, '') AS chat_name, \
                        COALESCE(c.chat_identifier, COALESCE(h.id, 'unknown')) AS chat_id \
                 FROM message m \
                 LEFT JOIN handle h ON m.handle_id = h.ROWID \
                 LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID \
                 LEFT JOIN chat c ON cmj.chat_id = c.ROWID \
                 ORDER BY m.date ASC",
            )
            .map_err(|e| format!("SQLite message query error: {e}"))?;

        let raw_messages: Vec<RawMsg> = stmt
            .query_map([], |row| {
                Ok(RawMsg {
                    rowid: row.get(0)?,
                    text: row.get(1)?,
                    date: row.get(2)?,
                    is_from_me: row.get::<_, i32>(3)? != 0,
                    sender: row.get(4)?,
                    chat_name: row.get(5)?,
                    chat_id: row.get(6)?,
                })
            })
            .map_err(|e| format!("SQLite message query error: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("SQLite message row error: {e}"))?;

        if raw_messages.is_empty() {
            return Err("No messages found in iMessage database".into());
        }

        // Pre-serialize every message to JSON bytes so the async side
        // only needs to do PostgreSQL inserts.
        let mut out: Vec<PreparedImessageMsg> = Vec::with_capacity(raw_messages.len());
        for msg in &raw_messages {
            let text = msg.text.as_deref().unwrap_or("");
            let msg_attachments = attachment_map
                .get(&msg.rowid)
                .cloned()
                .unwrap_or_default();

            if text.is_empty() && msg_attachments.is_empty() {
                continue;
            }

            let sender_display = if msg.is_from_me {
                "Me".to_string()
            } else if msg.sender.is_empty() {
                "Unknown".to_string()
            } else {
                msg.sender.clone()
            };

            let content = ImportedContent {
                from: sender_display,
                body: if text.is_empty() {
                    "[attachment]".to_string()
                } else {
                    text.to_string()
                },
                attachments: msg_attachments,
            };

            let content_bytes = serde_json::to_vec(&content)
                .map_err(|e| format!("JSON serialization error: {e}"))?;

            out.push(PreparedImessageMsg {
                chat_id: msg.chat_id.clone(),
                chat_name: msg.chat_name.clone(),
                content_bytes,
                created_at: core_data_to_utc(msg.date),
            });
        }

        Ok::<Vec<PreparedImessageMsg>, String>(out)
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {e}"))??;

    if prepared.is_empty() {
        return Err("No importable messages found in iMessage database".into());
    }

    // ── Phase 2: group by conversation and insert into PostgreSQL ────────
    let mut conversations: HashMap<String, (String, Vec<&PreparedImessageMsg>)> = HashMap::new();
    for msg in &prepared {
        let entry = conversations
            .entry(msg.chat_id.clone())
            .or_insert_with(|| (msg.chat_name.clone(), Vec::new()));
        if entry.0.is_empty() && !msg.chat_name.is_empty() {
            entry.0.clone_from(&msg.chat_name);
        }
        entry.1.push(msg);
    }

    let total_messages = prepared.len() as i32;
    sqlx::query!(
        "UPDATE import_jobs SET total_messages = $2 WHERE id = $1",
        job_id,
        total_messages,
    )
    .execute(db)
    .await
    .map_err(|e| format!("DB error updating total_messages: {e}"))?;

    let mut imported_count: i32 = 0;

    for (chat_id, (chat_name, messages)) in &conversations {
        let display_name = if chat_name.is_empty() {
            chat_id.as_str()
        } else {
            chat_name.as_str()
        };
        let channel_name = truncate_chars(
            &format!("[iMessage] {display_name}"),
            MAX_CHANNEL_NAME,
        );

        let group = sqlx::query!(
            "INSERT INTO group_dm_channels (name, owner_id) VALUES ($1, $2) RETURNING id",
            channel_name,
            user_id,
        )
        .fetch_one(db)
        .await
        .map_err(|e| format!("Failed to create import channel '{channel_name}': {e}"))?;

        let group_dm_id = group.id;

        sqlx::query!(
            "INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2)",
            group_dm_id,
            user_id,
        )
        .execute(db)
        .await
        .map_err(|e| format!("Failed to add member to import channel: {e}"))?;

        for msg in messages {
            sqlx::query!(
                "INSERT INTO group_dm_messages \
                     (group_dm_id, sender_id, content_ciphertext, is_imported, created_at) \
                 VALUES ($1, $2, $3, TRUE, $4)",
                group_dm_id,
                user_id,
                msg.content_bytes,
                msg.created_at,
            )
            .execute(db)
            .await
            .map_err(|e| format!("Failed to insert imported message: {e}"))?;

            imported_count += 1;

            if imported_count % PROGRESS_FLUSH_INTERVAL == 0 {
                let _ = sqlx::query!(
                    "UPDATE import_jobs SET imported_count = $2 WHERE id = $1",
                    job_id,
                    imported_count,
                )
                .execute(db)
                .await;
            }
        }
    }

    // ── Mark completed ───────────────────────────────────────────────────
    sqlx::query!(
        "UPDATE import_jobs SET status = 'completed', imported_count = $2, completed_at = now() WHERE id = $1",
        job_id,
        imported_count,
    )
    .execute(db)
    .await
    .map_err(|e| format!("Failed to mark import as completed: {e}"))?;

    tracing::info!(
        job_id = %job_id,
        conversations = conversations.len(),
        imported = imported_count,
        "iMessage import completed"
    );

    Ok(())
}

// ─── Android SMS Parser ─────────────────────────────────────────────────

/// Parse an Android SMS Backup & Restore XML file and import messages into
/// group DM channels.
///
/// Each `<sms>` element has attributes: `address` (phone), `date` (Unix ms),
/// `type` (1=received, 2=sent), `body`, and optional `contact_name`.
/// Messages are grouped by phone number, one `group_dm_channel` per contact.
async fn parse_android_sms_export(
    db: &sqlx::PgPool,
    job_id: Uuid,
    user_id: Uuid,
    file_path: &str,
) -> Result<(), String> {
    // ── Read XML file ────────────────────────────────────────────────────
    let xml_content = tokio::fs::read_to_string(file_path)
        .await
        .map_err(|e| format!("Failed to read SMS XML file: {e}"))?;

    // ── Parse all <sms> elements ─────────────────────────────────────────
    struct SmsRecord {
        address: String,
        contact_name: String,
        date_ms: i64,
        sms_type: i32,
        body: String,
    }

    let mut records: Vec<SmsRecord> = Vec::new();
    let mut reader = quick_xml::Reader::from_str(&xml_content);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Empty(ref e))
                if e.name().as_ref() == b"sms" =>
            {
                let mut address = String::new();
                let mut contact_name = String::new();
                let mut date_ms: i64 = 0;
                let mut sms_type: i32 = 0;
                let mut body = String::new();

                for attr_result in e.attributes() {
                    let attr = attr_result
                        .map_err(|e| format!("XML attribute error: {e}"))?;
                    let val = std::str::from_utf8(&attr.value)
                        .map_err(|e| format!("Invalid UTF-8 in XML: {e}"))?;

                    match attr.key.as_ref() {
                        b"address" => address = val.to_string(),
                        b"contact_name" => contact_name = val.to_string(),
                        b"date" => date_ms = val.parse().unwrap_or(0),
                        b"type" => sms_type = val.parse().unwrap_or(0),
                        b"body" => {
                            body = quick_xml::escape::unescape(val)
                                .map(|c| c.into_owned())
                                .unwrap_or_else(|_| val.to_string());
                        }
                        _ => {}
                    }
                }

                if !address.is_empty() {
                    records.push(SmsRecord {
                        address,
                        contact_name,
                        date_ms,
                        sms_type,
                        body,
                    });
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => {
                return Err(format!(
                    "XML parse error at position {}: {e}",
                    reader.error_position()
                ));
            }
            _ => {}
        }
        buf.clear();
    }

    if records.is_empty() {
        return Err("No SMS messages found in XML file".into());
    }

    let total_messages = records.len() as i32;
    sqlx::query!(
        "UPDATE import_jobs SET total_messages = $2 WHERE id = $1",
        job_id,
        total_messages,
    )
    .execute(db)
    .await
    .map_err(|e| format!("DB error updating total_messages: {e}"))?;

    // ── Group by phone number ────────────────────────────────────────────
    // key: phone number, value: (best contact name, messages)
    let mut by_phone: HashMap<String, (String, Vec<&SmsRecord>)> = HashMap::new();
    for record in &records {
        let entry = by_phone
            .entry(record.address.clone())
            .or_insert_with(|| {
                let name = if record.contact_name.is_empty() {
                    record.address.clone()
                } else {
                    record.contact_name.clone()
                };
                (name, Vec::new())
            });
        // Prefer a non-empty contact name from any record.
        if entry.0 == record.address && !record.contact_name.is_empty() {
            entry.0.clone_from(&record.contact_name);
        }
        entry.1.push(record);
    }

    // ── Process each conversation ────────────────────────────────────────
    let mut imported_count: i32 = 0;

    for (phone, (contact_name, messages)) in &by_phone {
        let display = if contact_name == phone {
            phone.clone()
        } else {
            format!("{contact_name} ({phone})")
        };
        let channel_name = truncate_chars(
            &format!("[SMS] {display}"),
            MAX_CHANNEL_NAME,
        );

        let group = sqlx::query!(
            "INSERT INTO group_dm_channels (name, owner_id) VALUES ($1, $2) RETURNING id",
            channel_name,
            user_id,
        )
        .fetch_one(db)
        .await
        .map_err(|e| format!("Failed to create import channel '{channel_name}': {e}"))?;

        let group_dm_id = group.id;

        sqlx::query!(
            "INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2)",
            group_dm_id,
            user_id,
        )
        .execute(db)
        .await
        .map_err(|e| format!("Failed to add member to import channel: {e}"))?;

        for sms in messages {
            if sms.body.is_empty() {
                continue;
            }

            let from = if sms.sms_type == 2 {
                "Me".to_string()
            } else if !sms.contact_name.is_empty() {
                sms.contact_name.clone()
            } else {
                sms.address.clone()
            };

            let content = ImportedContent {
                from,
                body: sms.body.clone(),
                attachments: Vec::new(),
            };

            let content_bytes = serde_json::to_vec(&content)
                .map_err(|e| format!("JSON serialization error: {e}"))?;

            let created_at: DateTime<Utc> = Utc
                .timestamp_millis_opt(sms.date_ms)
                .single()
                .unwrap_or_else(Utc::now);

            sqlx::query!(
                "INSERT INTO group_dm_messages \
                     (group_dm_id, sender_id, content_ciphertext, is_imported, created_at) \
                 VALUES ($1, $2, $3, TRUE, $4)",
                group_dm_id,
                user_id,
                content_bytes,
                created_at,
            )
            .execute(db)
            .await
            .map_err(|e| format!("Failed to insert imported message: {e}"))?;

            imported_count += 1;

            if imported_count % PROGRESS_FLUSH_INTERVAL == 0 {
                let _ = sqlx::query!(
                    "UPDATE import_jobs SET imported_count = $2 WHERE id = $1",
                    job_id,
                    imported_count,
                )
                .execute(db)
                .await;
            }
        }
    }

    // ── Mark completed ───────────────────────────────────────────────────
    sqlx::query!(
        "UPDATE import_jobs SET status = 'completed', imported_count = $2, completed_at = now() WHERE id = $1",
        job_id,
        imported_count,
    )
    .execute(db)
    .await
    .map_err(|e| format!("Failed to mark import as completed: {e}"))?;

    tracing::info!(
        job_id = %job_id,
        conversations = by_phone.len(),
        imported = imported_count,
        "Android SMS import completed"
    );

    Ok(())
}
