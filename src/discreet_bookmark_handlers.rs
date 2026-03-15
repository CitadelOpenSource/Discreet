// discreet_bookmark_handlers.rs — Message bookmark CRUD.
//
// Endpoints:
//   POST   /api/v1/bookmarks            — Save a bookmark
//   GET    /api/v1/bookmarks            — List bookmarks with message content
//   DELETE /api/v1/bookmarks/:message_id — Remove a bookmark

use axum::{extract::{Path, Query, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{citadel_auth::AuthUser, citadel_error::AppError, citadel_state::AppState};

#[derive(Debug, Deserialize)]
pub struct CreateBookmarkRequest {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListBookmarksParams {
    pub limit: Option<i64>,
    pub before: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BookmarkResponse {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub note: String,
    pub created_at: String,
    pub message_content: Option<String>,
    pub message_author_id: Option<Uuid>,
    pub message_created_at: Option<String>,
}

/// Row type shared by both paginated query branches.
#[derive(sqlx::FromRow)]
struct BookmarkRow {
    message_id: Uuid,
    channel_id: Uuid,
    server_id: Uuid,
    note: String,
    created_at: chrono::DateTime<chrono::Utc>,
    message_content: Option<Vec<u8>>,
    message_author_id: Option<Uuid>,
    message_created_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// POST /bookmarks — save a message bookmark.
pub async fn create_bookmark(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateBookmarkRequest>,
) -> Result<impl IntoResponse, AppError> {
    let note = req.note.unwrap_or_default();
    if note.len() > 500 {
        return Err(AppError::BadRequest("Note must be 500 characters or fewer".into()));
    }

    sqlx::query!(
        "INSERT INTO user_bookmarks (user_id, message_id, channel_id, server_id, note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, message_id) DO UPDATE SET note = $5",
        auth.user_id,
        req.message_id,
        req.channel_id,
        req.server_id,
        note,
    )
    .execute(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "message_id": req.message_id,
        "bookmarked": true,
    }))))
}

/// GET /bookmarks — list bookmarks with joined message content, newest first.
pub async fn list_bookmarks(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListBookmarksParams>,
) -> Result<impl IntoResponse, AppError> {
    let limit = params.limit.unwrap_or(50).min(100);

    let rows: Vec<BookmarkRow> = if let Some(ref before) = params.before {
        let before_ts = before.parse::<chrono::DateTime<chrono::Utc>>()
            .map_err(|_| AppError::BadRequest("Invalid 'before' timestamp".into()))?;
        sqlx::query_as!(
            BookmarkRow,
            r#"SELECT b.message_id, b.channel_id, b.server_id, b.note, b.created_at,
                      m.content_ciphertext as "message_content?",
                      m.author_id as "message_author_id?",
                      m.created_at as "message_created_at?"
               FROM user_bookmarks b
               LEFT JOIN messages m ON m.id = b.message_id
               WHERE b.user_id = $1 AND b.created_at < $2
               ORDER BY b.created_at DESC
               LIMIT $3"#,
            auth.user_id,
            before_ts,
            limit,
        )
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as!(
            BookmarkRow,
            r#"SELECT b.message_id, b.channel_id, b.server_id, b.note, b.created_at,
                      m.content_ciphertext as "message_content?",
                      m.author_id as "message_author_id?",
                      m.created_at as "message_created_at?"
               FROM user_bookmarks b
               LEFT JOIN messages m ON m.id = b.message_id
               WHERE b.user_id = $1
               ORDER BY b.created_at DESC
               LIMIT $2"#,
            auth.user_id,
            limit,
        )
        .fetch_all(&state.db)
        .await?
    };

    let items: Vec<BookmarkResponse> = rows.into_iter().map(|r| BookmarkResponse {
        message_id: r.message_id,
        channel_id: r.channel_id,
        server_id: r.server_id,
        note: r.note,
        created_at: r.created_at.to_rfc3339(),
        message_content: r.message_content.as_ref().map(|b| String::from_utf8_lossy(b).to_string()),
        message_author_id: r.message_author_id,
        message_created_at: r.message_created_at.map(|ts: chrono::DateTime<chrono::Utc>| ts.to_rfc3339()),
    }).collect();

    Ok(Json(items))
}

/// DELETE /bookmarks/:message_id — remove a bookmark.
pub async fn delete_bookmark(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(message_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "DELETE FROM user_bookmarks WHERE user_id = $1 AND message_id = $2",
        auth.user_id,
        message_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Bookmark not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
