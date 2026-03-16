// discreet_notification_handlers.rs — Notification inbox with WebSocket unread count.
//
// Endpoints:
//   GET    /api/v1/notifications                — Paginated list (unread first)
//   GET    /api/v1/notifications/unread-count   — Unread count
//   PATCH  /api/v1/notifications/:id/read       — Mark one read
//   POST   /api/v1/notifications/read-all       — Mark all read

use axum::{extract::{Path, Query, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

#[derive(Debug, Serialize)]
pub struct NotificationInfo {
    pub id: Uuid,
    pub r#type: String,
    pub title: String,
    pub body: Option<String>,
    pub action_url: Option<String>,
    pub read: bool,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub limit: Option<i64>,
    pub before: Option<Uuid>,
}

/// Row type shared by both paginated query branches.
#[derive(sqlx::FromRow)]
struct NotificationRow {
    id: Uuid,
    r#type: String,
    title: String,
    body: Option<String>,
    action_url: Option<String>,
    read: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// GET /notifications — Paginated, unread-first, newest-first.
pub async fn list_notifications(
    auth: AuthUser, State(state): State<Arc<AppState>>,
    Query(params): Query<ListParams>,
) -> Result<impl IntoResponse, AppError> {
    let limit = params.limit.unwrap_or(50).min(100);

    let rows: Vec<NotificationRow> = if let Some(before_id) = params.before {
        sqlx::query_as!(
            NotificationRow,
            r#"SELECT id, type, title, body, action_url, read, created_at
               FROM notifications
               WHERE user_id = $1
                 AND (read, created_at, id) > (
                     SELECT read, created_at, id FROM notifications WHERE id = $2
                 )
               ORDER BY read ASC, created_at DESC
               LIMIT $3"#,
            auth.user_id, before_id, limit,
        ).fetch_all(&state.db).await?
    } else {
        sqlx::query_as!(
            NotificationRow,
            r#"SELECT id, type, title, body, action_url, read, created_at
               FROM notifications
               WHERE user_id = $1
               ORDER BY read ASC, created_at DESC
               LIMIT $2"#,
            auth.user_id, limit,
        ).fetch_all(&state.db).await?
    };

    let items: Vec<NotificationInfo> = rows.iter().map(|r| NotificationInfo {
        id: r.id,
        r#type: r.r#type.clone(),
        title: r.title.clone(),
        body: r.body.clone(),
        action_url: r.action_url.clone(),
        read: r.read,
        created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(items))
}

/// GET /notifications/unread-count
pub async fn unread_count(
    auth: AuthUser, State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM notifications WHERE user_id = $1 AND NOT read"#,
        auth.user_id,
    ).fetch_one(&state.db).await?;

    Ok(Json(serde_json::json!({ "unread_count": count })))
}

/// PATCH /notifications/:id/read
pub async fn mark_read(
    auth: AuthUser, State(state): State<Arc<AppState>>,
    Path(notification_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2 AND NOT read",
        notification_id, auth.user_id,
    ).execute(&state.db).await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Notification not found or already read".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// POST /notifications/read-all
pub async fn mark_all_read(
    auth: AuthUser, State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "UPDATE notifications SET read = TRUE WHERE user_id = $1 AND NOT read",
        auth.user_id,
    ).execute(&state.db).await?;

    Ok(Json(serde_json::json!({ "marked": result.rows_affected() })))
}

/// Parameters for creating a notification, avoiding too many function arguments.
pub struct CreateNotification {
    pub user_id: Uuid,
    pub notification_type: String,
    pub title: String,
    pub body: Option<String>,
    pub action_url: Option<String>,
    pub server_id: Option<Uuid>,
}

/// Insert a notification and broadcast the new unread count via WebSocket.
/// Called from other handlers (event reminders, mentions, system alerts, etc.).
pub async fn create_notification(
    db: &sqlx::PgPool,
    state: &AppState,
    notif: CreateNotification,
) -> Result<Uuid, AppError> {
    let body_ref = notif.body.as_deref();
    let action_url_ref = notif.action_url.as_deref();
    let row = sqlx::query!(
        "INSERT INTO notifications (user_id, type, title, body, action_url)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
        notif.user_id, notif.notification_type, notif.title, body_ref, action_url_ref,
    ).fetch_one(db).await?;

    // Get updated unread count and broadcast.
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM notifications WHERE user_id = $1 AND NOT read"#,
        notif.user_id,
    ).fetch_one(db).await.unwrap_or(0);

    // Broadcast to all servers the user is a member of, or a specific server if known.
    if let Some(sid) = notif.server_id {
        state.ws_broadcast(sid, serde_json::json!({
            "type": "notification_new",
            "target_user_ids": [notif.user_id],
            "unread_count": count,
            "notification_id": row.id,
            "notification_type": notif.notification_type,
            "title": notif.title,
        })).await;
    }

    Ok(row.id)
}
