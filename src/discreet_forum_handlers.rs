// discreet_forum_handlers.rs — Forum channels with threaded discussions.
//
// Forum channels display threads (like Reddit forums) instead of
// a flat message stream. Each thread has a title, optional tags,
// and its own encrypted message history.
//
// Endpoints:
//   GET    /api/v1/channels/:channel_id/threads         — List threads
//   POST   /api/v1/channels/:channel_id/threads         — Create thread
//   GET    /api/v1/threads/:thread_id                   — Get thread detail
//   PATCH  /api/v1/threads/:thread_id                   — Update thread (pin/lock/tags)
//   DELETE /api/v1/threads/:thread_id                   — Delete thread
//   GET    /api/v1/threads/:thread_id/messages          — Get thread messages
//   POST   /api/v1/threads/:thread_id/messages          — Post to thread

use axum::{
    extract::{Path, Query, State, Json},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ─── Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateThreadRequest {
    pub title: String,
    pub content_ciphertext: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateThreadRequest {
    pub pinned: Option<bool>,
    pub locked: Option<bool>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct PostMessageRequest {
    pub content_ciphertext: String,
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ThreadInfo {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub title: String,
    pub pinned: bool,
    pub locked: bool,
    pub tags: Vec<String>,
    pub message_count: i32,
    pub last_message_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ThreadMessage {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub content_ciphertext: String,
    pub reply_to_id: Option<Uuid>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub limit: Option<i64>,
    pub before: Option<String>,
}

// ─── GET /channels/:channel_id/threads ─────────────────────────────────

pub async fn list_threads(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let limit = params.limit.unwrap_or(50).min(100);

    let rows = sqlx::query!(
        r#"SELECT t.id, t.channel_id, t.author_id, u.username as author_username,
           t.title, t.pinned, t.locked, t.tags, t.message_count, t.last_message_at, t.created_at
           FROM forum_threads t
           JOIN users u ON u.id = t.author_id
           WHERE t.channel_id = $1
           ORDER BY t.pinned DESC, t.last_message_at DESC NULLS LAST, t.created_at DESC
           LIMIT $2"#,
        channel_id, limit,
    )
    .fetch_all(&state.db)
    .await?;

    let threads: Vec<ThreadInfo> = rows.iter().map(|r| ThreadInfo {
        id: r.id, channel_id: r.channel_id, author_id: r.author_id,
        author_username: r.author_username.clone(), title: r.title.clone(),
        pinned: r.pinned, locked: r.locked,
        tags: r.tags.clone().unwrap_or_default(),
        message_count: r.message_count,
        last_message_at: r.last_message_at.map(|t| t.to_rfc3339()),
        created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(threads))
}

// ─── POST /channels/:channel_id/threads ────────────────────────────────

pub async fn create_thread(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<CreateThreadRequest>,
) -> Result<impl IntoResponse, AppError> {
    let title = req.title.trim();
    if title.is_empty() || title.len() > 200 {
        return Err(AppError::BadRequest("Title must be 1-200 characters".into()));
    }

    // Verify channel is a forum type
    let channel = sqlx::query!(
        "SELECT server_id, channel_type FROM channels WHERE id = $1",
        channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    if channel.channel_type != "forum" {
        return Err(AppError::BadRequest("This channel is not a forum channel".into()));
    }

    let tags = req.tags.unwrap_or_default();

    // Create thread
    let thread = sqlx::query!(
        "INSERT INTO forum_threads (channel_id, author_id, title, tags, message_count, last_message_at)
         VALUES ($1, $2, $3, $4, 1, NOW()) RETURNING id, created_at",
        channel_id, auth.user_id, title, &tags,
    )
    .fetch_one(&state.db)
    .await?;

    // Create first message (the thread body)
    let ct = decode_base64(&req.content_ciphertext)?;
    sqlx::query!(
        "INSERT INTO thread_messages (thread_id, author_id, content_ciphertext) VALUES ($1, $2, $3)",
        thread.id, auth.user_id, ct,
    )
    .execute(&state.db)
    .await?;

    // Broadcast new thread
    state.ws_broadcast(channel.server_id, serde_json::json!({
        "type": "thread_create",
        "channel_id": channel_id,
        "thread_id": thread.id,
        "title": title,
        "author_id": auth.user_id,
    })).await;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": thread.id,
        "channel_id": channel_id,
        "title": title,
        "created_at": thread.created_at.to_rfc3339(),
    }))))
}

// ─── GET /threads/:thread_id ───────────────────────────────────────────

pub async fn get_thread(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(thread_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        r#"SELECT t.id, t.channel_id, t.author_id, u.username as author_username,
           t.title, t.pinned, t.locked, t.tags, t.message_count, t.last_message_at, t.created_at
           FROM forum_threads t JOIN users u ON u.id = t.author_id
           WHERE t.id = $1"#,
        thread_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    Ok(Json(ThreadInfo {
        id: row.id, channel_id: row.channel_id, author_id: row.author_id,
        author_username: row.author_username.clone(), title: row.title.clone(),
        pinned: row.pinned, locked: row.locked,
        tags: row.tags.clone().unwrap_or_default(),
        message_count: row.message_count,
        last_message_at: row.last_message_at.map(|t| t.to_rfc3339()),
        created_at: row.created_at.to_rfc3339(),
    }))
}

// ─── PATCH /threads/:thread_id ─────────────────────────────────────────

pub async fn update_thread(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(thread_id): Path<Uuid>,
    Json(req): Json<UpdateThreadRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Get thread's channel to check server ownership
    let thread = sqlx::query!(
        "SELECT channel_id, author_id FROM forum_threads WHERE id = $1",
        thread_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    let channel = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", thread.channel_id)
        .fetch_one(&state.db).await?;

    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        channel.server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);

    let is_author = thread.author_id == auth.user_id;
    if !is_owner && !is_author {
        return Err(AppError::Forbidden("Only thread author or server owner can update".into()));
    }

    if let Some(pinned) = req.pinned {
        sqlx::query!("UPDATE forum_threads SET pinned = $1 WHERE id = $2", pinned, thread_id)
            .execute(&state.db).await?;
    }
    if let Some(locked) = req.locked {
        sqlx::query!("UPDATE forum_threads SET locked = $1 WHERE id = $2", locked, thread_id)
            .execute(&state.db).await?;
    }
    if let Some(ref tags) = req.tags {
        sqlx::query!("UPDATE forum_threads SET tags = $1 WHERE id = $2", tags, thread_id)
            .execute(&state.db).await?;
    }

    Ok(Json(serde_json::json!({ "message": "Thread updated" })))
}

// ─── DELETE /threads/:thread_id ────────────────────────────────────────

pub async fn delete_thread(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(thread_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let thread = sqlx::query!(
        "SELECT channel_id, author_id FROM forum_threads WHERE id = $1",
        thread_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    let channel = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", thread.channel_id)
        .fetch_one(&state.db).await?;

    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        channel.server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);

    if !is_owner && thread.author_id != auth.user_id {
        return Err(AppError::Forbidden("Only thread author or server owner can delete".into()));
    }

    sqlx::query!("DELETE FROM forum_threads WHERE id = $1", thread_id)
        .execute(&state.db).await?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── GET /threads/:thread_id/messages ──────────────────────────────────

pub async fn list_thread_messages(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(thread_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let limit = params.limit.unwrap_or(50).min(100);

    let rows = sqlx::query!(
        r#"SELECT m.id, m.thread_id, m.author_id, u.username as author_username,
           encode(m.content_ciphertext, 'base64') as "content_ciphertext!",
           m.reply_to_id, m.created_at
           FROM thread_messages m JOIN users u ON u.id = m.author_id
           WHERE m.thread_id = $1 AND m.deleted = FALSE
           ORDER BY m.created_at ASC
           LIMIT $2"#,
        thread_id, limit,
    )
    .fetch_all(&state.db)
    .await?;

    let messages: Vec<ThreadMessage> = rows.iter().map(|r| ThreadMessage {
        id: r.id, thread_id: r.thread_id, author_id: r.author_id,
        author_username: r.author_username.clone(),
        content_ciphertext: r.content_ciphertext.clone(),
        reply_to_id: r.reply_to_id, created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(messages))
}

// ─── POST /threads/:thread_id/messages ─────────────────────────────────

pub async fn post_thread_message(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(thread_id): Path<Uuid>,
    Json(req): Json<PostMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Check thread exists and isn't locked
    let thread = sqlx::query!(
        "SELECT channel_id, locked FROM forum_threads WHERE id = $1",
        thread_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Thread not found".into()))?;

    if thread.locked {
        return Err(AppError::BadRequest("This thread is locked".into()));
    }

    let ct = decode_base64(&req.content_ciphertext)?;

    let msg = sqlx::query!(
        "INSERT INTO thread_messages (thread_id, author_id, content_ciphertext, reply_to_id)
         VALUES ($1, $2, $3, $4) RETURNING id, created_at",
        thread_id, auth.user_id, ct, req.reply_to_id,
    )
    .fetch_one(&state.db)
    .await?;

    // Update thread stats
    sqlx::query!(
        "UPDATE forum_threads SET message_count = message_count + 1, last_message_at = $1 WHERE id = $2",
        msg.created_at, thread_id,
    )
    .execute(&state.db)
    .await?;

    // Broadcast
    let channel = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", thread.channel_id)
        .fetch_one(&state.db).await?;

    state.ws_broadcast(channel.server_id, serde_json::json!({
        "type": "thread_message",
        "thread_id": thread_id,
        "channel_id": thread.channel_id,
        "message_id": msg.id,
        "author_id": auth.user_id,
    })).await;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": msg.id,
        "thread_id": thread_id,
        "created_at": msg.created_at.to_rfc3339(),
    }))))
}

// ─── Helpers ───────────────────────────────────────────────────────────

fn decode_base64(s: &str) -> Result<Vec<u8>, AppError> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| AppError::BadRequest("Invalid base64".into()))
}
