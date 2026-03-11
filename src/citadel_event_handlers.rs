// citadel_event_handlers.rs — Server events with RSVP.
//
// Endpoints:
//   GET    /api/v1/servers/:server_id/events           — List events
//   POST   /api/v1/servers/:server_id/events           — Create event
//   PATCH  /api/v1/events/:event_id                    — Update event
//   DELETE /api/v1/events/:event_id                    — Delete event
//   POST   /api/v1/events/:event_id/rsvp               — RSVP to event

use axum::{extract::{Path, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{citadel_auth::AuthUser, citadel_error::AppError, citadel_state::AppState};

#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub channel_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RsvpRequest {
    pub status: String, // "going", "interested", "not_going"
}

#[derive(Debug, Serialize)]
pub struct EventInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub creator_id: Uuid,
    pub creator_username: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub going_count: i64,
    pub interested_count: i64,
    pub created_at: String,
}

pub async fn list_events(
    _auth: AuthUser, State(state): State<Arc<AppState>>, Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"SELECT e.id, e.server_id, e.channel_id, e.creator_id, u.username as creator_username,
           e.title, e.description, e.location, e.start_time, e.end_time, e.created_at,
           (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') as "going_count!",
           (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') as "interested_count!"
           FROM server_events e JOIN users u ON u.id = e.creator_id
           WHERE e.server_id = $1 ORDER BY e.start_time ASC"#,
        server_id,
    ).fetch_all(&state.db).await?;

    let events: Vec<EventInfo> = rows.iter().map(|r| EventInfo {
        id: r.id, server_id: r.server_id, channel_id: r.channel_id,
        creator_id: r.creator_id, creator_username: r.creator_username.clone(),
        title: r.title.clone(), description: r.description.clone(),
        location: r.location.clone(), start_time: r.start_time.to_rfc3339(),
        end_time: r.end_time.map(|t| t.to_rfc3339()),
        going_count: r.going_count, interested_count: r.interested_count,
        created_at: r.created_at.to_rfc3339(),
    }).collect();
    Ok(Json(events))
}

pub async fn create_event(
    auth: AuthUser, State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>, Json(req): Json<CreateEventRequest>,
) -> Result<impl IntoResponse, AppError> {
    let title = req.title.trim();
    if title.is_empty() || title.len() > 200 {
        return Err(AppError::BadRequest("Title must be 1-200 characters".into()));
    }
    let start = req.start_time.parse::<chrono::DateTime<chrono::Utc>>()
        .map_err(|_| AppError::BadRequest("Invalid start_time".into()))?;
    let end = req.end_time.as_ref().map(|t| t.parse::<chrono::DateTime<chrono::Utc>>())
        .transpose().map_err(|_| AppError::BadRequest("Invalid end_time".into()))?;

    let evt = sqlx::query!(
        "INSERT INTO server_events (server_id, creator_id, title, description, location, start_time, end_time, channel_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at",
        server_id, auth.user_id, title, req.description, req.location, start, end, req.channel_id,
    ).fetch_one(&state.db).await?;

    state.ws_broadcast(server_id, serde_json::json!({
        "type": "event_create", "server_id": server_id, "event_id": evt.id, "title": title,
    })).await;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": evt.id, "title": title, "start_time": start.to_rfc3339(), "created_at": evt.created_at.to_rfc3339(),
    }))))
}

pub async fn update_event(
    auth: AuthUser, State(state): State<Arc<AppState>>,
    Path(event_id): Path<Uuid>, Json(req): Json<UpdateEventRequest>,
) -> Result<impl IntoResponse, AppError> {
    let evt = sqlx::query!("SELECT creator_id, server_id FROM server_events WHERE id = $1", event_id)
        .fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Event not found".into()))?;
    if evt.creator_id != auth.user_id {
        let is_owner = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
            evt.server_id, auth.user_id).fetch_one(&state.db).await?.unwrap_or(false);
        if !is_owner { return Err(AppError::Forbidden("Only creator or server owner".into())); }
    }
    if let Some(ref t) = req.title { sqlx::query!("UPDATE server_events SET title = $1 WHERE id = $2", t, event_id).execute(&state.db).await?; }
    if let Some(ref d) = req.description { sqlx::query!("UPDATE server_events SET description = $1 WHERE id = $2", d, event_id).execute(&state.db).await?; }
    if let Some(ref s) = req.start_time {
        let st = s.parse::<chrono::DateTime<chrono::Utc>>().map_err(|_| AppError::BadRequest("Invalid time".into()))?;
        sqlx::query!("UPDATE server_events SET start_time = $1 WHERE id = $2", st, event_id).execute(&state.db).await?;
    }
    Ok(Json(serde_json::json!({ "message": "Event updated" })))
}

pub async fn delete_event(
    auth: AuthUser, State(state): State<Arc<AppState>>, Path(event_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let evt = sqlx::query!("SELECT creator_id, server_id FROM server_events WHERE id = $1", event_id)
        .fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Event not found".into()))?;
    if evt.creator_id != auth.user_id {
        let is_owner = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
            evt.server_id, auth.user_id).fetch_one(&state.db).await?.unwrap_or(false);
        if !is_owner { return Err(AppError::Forbidden("Only creator or server owner".into())); }
    }
    sqlx::query!("DELETE FROM server_events WHERE id = $1", event_id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn rsvp_event(
    auth: AuthUser, State(state): State<Arc<AppState>>,
    Path(event_id): Path<Uuid>, Json(req): Json<RsvpRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !["going","interested","not_going"].contains(&req.status.as_str()) {
        return Err(AppError::BadRequest("Status must be going, interested, or not_going".into()));
    }
    sqlx::query!(
        "INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, $3)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3",
        event_id, auth.user_id, req.status,
    ).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "status": req.status })))
}
