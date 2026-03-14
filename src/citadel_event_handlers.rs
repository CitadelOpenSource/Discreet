// citadel_event_handlers.rs — Server events with RSVP, reminders, and enhanced fields.
//
// Endpoints:
//   GET    /api/v1/servers/:server_id/events           — List events
//   POST   /api/v1/servers/:server_id/events           — Create event
//   PUT    /api/v1/events/:event_id                    — Update event (enhanced)
//   DELETE /api/v1/events/:event_id                    — Delete event
//   POST   /api/v1/events/:event_id/rsvp               — RSVP to event
//   GET    /api/v1/events/:event_id/rsvps              — List attendees with counts
//   POST   /api/v1/events/:event_id/remind             — Manual reminder to accepted attendees

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
    pub reminder_minutes: Option<Vec<i32>>,
    pub recurring_rule: Option<String>,
    pub voice_channel_id: Option<Uuid>,
    pub max_attendees: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub reminder_minutes: Option<Vec<i32>>,
    pub recurring_rule: Option<String>,
    pub voice_channel_id: Option<Uuid>,
    pub invite_code: Option<String>,
    pub max_attendees: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct RsvpRequest {
    pub status: String, // "accepted", "declined", "tentative"
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
    pub accepted_count: i64,
    pub tentative_count: i64,
    pub created_at: String,
    pub reminder_minutes: Option<Vec<i32>>,
    pub recurring_rule: Option<String>,
    pub voice_channel_id: Option<Uuid>,
    pub invite_code: Option<String>,
    pub max_attendees: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct RsvpInfo {
    pub user_id: Uuid,
    pub username: String,
    pub status: String,
    pub responded_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RsvpListResponse {
    pub attendees: Vec<RsvpInfo>,
    pub accepted_count: i64,
    pub declined_count: i64,
    pub tentative_count: i64,
}

pub async fn list_events(
    _auth: AuthUser, State(state): State<Arc<AppState>>, Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"SELECT e.id, e.server_id, e.channel_id, e.creator_id, u.username as creator_username,
           e.title, e.description, e.location, e.start_time, e.end_time, e.created_at,
           e.reminder_minutes, e.recurring_rule, e.voice_channel_id, e.invite_code, e.max_attendees,
           (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'accepted') as "accepted_count!",
           (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'tentative') as "tentative_count!"
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
        accepted_count: r.accepted_count, tentative_count: r.tentative_count,
        created_at: r.created_at.to_rfc3339(),
        reminder_minutes: r.reminder_minutes.clone(),
        recurring_rule: r.recurring_rule.clone(),
        voice_channel_id: r.voice_channel_id,
        invite_code: r.invite_code.clone(),
        max_attendees: r.max_attendees,
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
        "INSERT INTO server_events (server_id, creator_id, title, description, location, start_time, end_time, channel_id, reminder_minutes, recurring_rule, voice_channel_id, max_attendees)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, created_at",
        server_id, auth.user_id, title, req.description, req.location, start, end, req.channel_id,
        req.reminder_minutes.as_deref(), req.recurring_rule, req.voice_channel_id, req.max_attendees,
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
    if let Some(ref s) = req.end_time {
        let et = s.parse::<chrono::DateTime<chrono::Utc>>().map_err(|_| AppError::BadRequest("Invalid end_time".into()))?;
        sqlx::query!("UPDATE server_events SET end_time = $1 WHERE id = $2", et, event_id).execute(&state.db).await?;
    }
    if let Some(ref rm) = req.reminder_minutes {
        sqlx::query!("UPDATE server_events SET reminder_minutes = $1 WHERE id = $2", rm.as_slice(), event_id).execute(&state.db).await?;
    }
    if let Some(ref rr) = req.recurring_rule {
        sqlx::query!("UPDATE server_events SET recurring_rule = $1 WHERE id = $2", rr, event_id).execute(&state.db).await?;
    }
    if let Some(vc) = req.voice_channel_id {
        sqlx::query!("UPDATE server_events SET voice_channel_id = $1 WHERE id = $2", vc, event_id).execute(&state.db).await?;
    }
    if let Some(ref ic) = req.invite_code {
        sqlx::query!("UPDATE server_events SET invite_code = $1 WHERE id = $2", ic, event_id).execute(&state.db).await?;
    }
    if let Some(ma) = req.max_attendees {
        sqlx::query!("UPDATE server_events SET max_attendees = $1 WHERE id = $2", ma, event_id).execute(&state.db).await?;
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
    if !["accepted","declined","tentative"].contains(&req.status.as_str()) {
        return Err(AppError::BadRequest("Status must be accepted, declined, or tentative".into()));
    }
    // Enforce max_attendees for accepted RSVPs.
    if req.status == "accepted" {
        let evt = sqlx::query!("SELECT max_attendees FROM server_events WHERE id = $1", event_id)
            .fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Event not found".into()))?;
        if let Some(max) = evt.max_attendees {
            let current = sqlx::query_scalar!(
                r#"SELECT COUNT(*) as "cnt!" FROM event_rsvps WHERE event_id = $1 AND status = 'accepted' AND user_id != $2"#,
                event_id, auth.user_id,
            ).fetch_one(&state.db).await?;
            if current >= max as i64 {
                return Err(AppError::BadRequest("Event is at capacity".into()));
            }
        }
    }
    sqlx::query!(
        "INSERT INTO event_rsvps (event_id, user_id, status, responded_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3, responded_at = NOW()",
        event_id, auth.user_id, req.status,
    ).execute(&state.db).await?;

    // When a user accepts, create event_reminders rows from the event's reminder_minutes.
    if req.status == "accepted" {
        let evt = sqlx::query!(
            "SELECT start_time, reminder_minutes FROM server_events WHERE id = $1", event_id,
        ).fetch_optional(&state.db).await?;
        if let Some(evt) = evt {
            if let Some(ref mins) = evt.reminder_minutes {
                // Clear any existing reminders for this user+event, then re-insert.
                sqlx::query!(
                    "DELETE FROM event_reminders WHERE event_id = $1 AND user_id = $2",
                    event_id, auth.user_id,
                ).execute(&state.db).await?;
                for &m in mins {
                    let remind_at = evt.start_time - chrono::Duration::minutes(m as i64);
                    if remind_at > chrono::Utc::now() {
                        sqlx::query!(
                            "INSERT INTO event_reminders (event_id, user_id, remind_at) VALUES ($1, $2, $3)",
                            event_id, auth.user_id, remind_at,
                        ).execute(&state.db).await?;
                    }
                }
            }
        }
    } else {
        // If user declines/tentative, remove their pending reminders.
        sqlx::query!(
            "DELETE FROM event_reminders WHERE event_id = $1 AND user_id = $2 AND NOT sent",
            event_id, auth.user_id,
        ).execute(&state.db).await?;
    }

    Ok(Json(serde_json::json!({ "status": req.status })))
}

/// GET /events/:event_id/rsvps — List attendees with status counts.
/// Requires the caller to be a member of the event's server.
pub async fn list_rsvps(
    auth: AuthUser, State(state): State<Arc<AppState>>, Path(event_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Verify the user is a member of the server that owns this event.
    let evt = sqlx::query!("SELECT server_id FROM server_events WHERE id = $1", event_id)
        .fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Event not found".into()))?;
    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2) as "ok!""#,
        evt.server_id, auth.user_id,
    ).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden("Not a member of this server".into())); }
    let rows = sqlx::query!(
        r#"SELECT r.user_id, u.username, r.status, r.responded_at
           FROM event_rsvps r JOIN users u ON u.id = r.user_id
           WHERE r.event_id = $1 ORDER BY r.responded_at ASC"#,
        event_id,
    ).fetch_all(&state.db).await?;

    let attendees: Vec<RsvpInfo> = rows.iter().map(|r| RsvpInfo {
        user_id: r.user_id,
        username: r.username.clone(),
        status: r.status.clone(),
        responded_at: r.responded_at.map(|t| t.to_rfc3339()),
    }).collect();

    let accepted = attendees.iter().filter(|a| a.status == "accepted").count() as i64;
    let declined = attendees.iter().filter(|a| a.status == "declined").count() as i64;
    let tentative = attendees.iter().filter(|a| a.status == "tentative").count() as i64;

    Ok(Json(RsvpListResponse { attendees, accepted_count: accepted, declined_count: declined, tentative_count: tentative }))
}

/// POST /events/:event_id/remind — Send manual reminder to accepted attendees via WebSocket.
pub async fn remind_event(
    auth: AuthUser, State(state): State<Arc<AppState>>, Path(event_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let evt = sqlx::query!("SELECT creator_id, server_id, title, start_time, voice_channel_id, invite_code FROM server_events WHERE id = $1", event_id)
        .fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Event not found".into()))?;
    if evt.creator_id != auth.user_id {
        let is_owner = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
            evt.server_id, auth.user_id).fetch_one(&state.db).await?.unwrap_or(false);
        if !is_owner { return Err(AppError::Forbidden("Only creator or server owner".into())); }
    }

    let accepted_ids = sqlx::query_scalar!(
        r#"SELECT user_id as "user_id!" FROM event_rsvps WHERE event_id = $1 AND status = 'accepted'"#,
        event_id,
    ).fetch_all(&state.db).await?;

    state.ws_broadcast(evt.server_id, serde_json::json!({
        "type": "event_reminder",
        "event_id": event_id,
        "server_id": evt.server_id,
        "title": evt.title,
        "start_time": evt.start_time.to_rfc3339(),
        "voice_channel_id": evt.voice_channel_id,
        "invite_code": evt.invite_code,
        "target_user_ids": accepted_ids,
    })).await;

    Ok(Json(serde_json::json!({ "reminded": accepted_ids.len() })))
}

/// Background task: process pending event reminders every 60 seconds.
/// Queries event_reminders WHERE remind_at <= NOW() AND NOT sent,
/// persists to notifications table, broadcasts WS, and marks sent.
pub async fn reminder_dispatcher(db: sqlx::PgPool, state: Arc<AppState>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        interval.tick().await;

        // Mark pending reminders as sent atomically to prevent duplicate dispatch.
        let pending = match sqlx::query!(
            r#"UPDATE event_reminders SET sent = TRUE
               WHERE id IN (
                   SELECT er.id FROM event_reminders er
                   WHERE er.remind_at <= NOW() AND NOT er.sent
                   LIMIT 200
               )
               RETURNING id, event_id, user_id"#,
        ).fetch_all(&db).await {
            Ok(rows) => rows,
            Err(e) => { tracing::warn!("Event reminder query error: {}", e); continue; }
        };

        if pending.is_empty() { continue; }

        for row in &pending {
            // Fetch event details for the notification.
            let evt = match sqlx::query!(
                "SELECT server_id, title, start_time, voice_channel_id, invite_code FROM server_events WHERE id = $1",
                row.event_id,
            ).fetch_optional(&db).await {
                Ok(Some(e)) => e,
                _ => continue,
            };

            // Persist to notifications table so it appears in the bell inbox.
            let body = format!("Starts at {}", evt.start_time.format("%H:%M"));
            let _ = crate::citadel_notification_handlers::create_notification(
                &db, &state, crate::citadel_notification_handlers::CreateNotification {
                    user_id: row.user_id,
                    notification_type: "event_reminder".to_string(),
                    title: evt.title.clone(),
                    body: Some(body.clone()),
                    action_url: None,
                    server_id: Some(evt.server_id),
                },
            ).await;

            // Also broadcast the rich WS event for real-time clients with smart join data.
            state.ws_broadcast(evt.server_id, serde_json::json!({
                "type": "event_reminder",
                "event_id": row.event_id,
                "server_id": evt.server_id,
                "title": evt.title,
                "start_time": evt.start_time.to_rfc3339(),
                "voice_channel_id": evt.voice_channel_id,
                "invite_code": evt.invite_code,
                "target_user_ids": [row.user_id],
            })).await;
        }

        tracing::info!("Dispatched {} event reminders", pending.len());
    }
}
