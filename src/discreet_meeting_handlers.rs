// discreet_meeting_handlers.rs — Zoom-style meeting rooms with join codes.
//
// Any user can create a meeting room and get a 6-digit code.
// Anyone (including guests) can join via that code from the login screen.
// Meetings are E2EE voice channels with optional password protection.
//
// Endpoints:
//   POST   /api/v1/meetings              — Create meeting room → returns code
//   GET    /api/v1/meetings/:code         — Get meeting info (public, no auth needed for basic info)
//   POST   /api/v1/meetings/:code/join    — Join meeting (validates password if set)
//   DELETE /api/v1/meetings/:code         — End meeting (host only)
//   GET    /api/v1/meetings               — List user's active meetings

use axum::{extract::{Path, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

#[derive(Debug, Deserialize)]
pub struct CreateMeetingRequest {
    pub title: Option<String>,
    pub password: Option<String>,
    pub max_participants: Option<i32>,
    pub allow_guests: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct JoinMeetingRequest {
    pub password: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MeetingInfo {
    pub id: Uuid,
    pub code: String,
    pub title: String,
    pub host_id: Uuid,
    pub is_active: bool,
    pub has_password: bool,
    pub allow_guests: bool,
    pub max_participants: i32,
    pub created_at: String,
}

fn generate_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(100000..=999999))
}

// ─── POST /meetings ────────────────────────────────────────────────────

pub async fn create_meeting(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateMeetingRequest>,
) -> Result<impl IntoResponse, AppError> {
    let code = generate_code();
    let title = req.title.unwrap_or_else(|| "Meeting".into());
    let max_p = req.max_participants.unwrap_or(50).min(100);
    let allow_guests = req.allow_guests.unwrap_or(true);

    let pw_hash = if let Some(ref pw) = req.password {
        Some(crate::discreet_auth_handlers::hash_password(pw)?)
    } else {
        None
    };

    let meeting = sqlx::query!(
        "INSERT INTO meeting_rooms (code, host_id, title, password_hash, max_participants, allow_guests)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at",
        code, auth.user_id, title, pw_hash, max_p, allow_guests,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(meeting_id = %meeting.id, code = %code, host = %auth.user_id, "Meeting created");

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": meeting.id,
        "code": code,
        "title": title,
        "has_password": req.password.is_some(),
        "allow_guests": allow_guests,
        "max_participants": max_p,
        "created_at": meeting.created_at.to_rfc3339(),
    }))))
}

// ─── GET /meetings/:code ───────────────────────────────────────────────
// Public — no auth required (so guests can see meeting info before joining)

pub async fn get_meeting_info(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let m = sqlx::query!(
        "SELECT id, code, title, host_id, is_active, password_hash IS NOT NULL as \"has_password!\",
         allow_guests, max_participants, created_at
         FROM meeting_rooms WHERE code = $1 AND is_active = TRUE AND expires_at > NOW()",
        code,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Meeting not found or expired".into()))?;

    Ok(Json(MeetingInfo {
        id: m.id, code: m.code.clone(), title: m.title.clone(),
        host_id: m.host_id, is_active: m.is_active,
        has_password: m.has_password,
        allow_guests: m.allow_guests,
        max_participants: m.max_participants.unwrap_or(50),
        created_at: m.created_at.to_rfc3339(),
    }))
}

// ─── POST /meetings/:code/join ─────────────────────────────────────────

pub async fn join_meeting(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
    Json(req): Json<JoinMeetingRequest>,
) -> Result<impl IntoResponse, AppError> {
    let m = sqlx::query!(
        "SELECT id, host_id, password_hash, allow_guests, is_active
         FROM meeting_rooms WHERE code = $1 AND is_active = TRUE AND expires_at > NOW()",
        code,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Meeting not found or expired".into()))?;

    // Check guest access
    let is_guest = sqlx::query_scalar!(
        "SELECT is_guest FROM users WHERE id = $1",
        auth.user_id,
    ).fetch_one(&state.db).await?;

    if is_guest && !m.allow_guests {
        return Err(AppError::Forbidden("This meeting does not allow guest accounts".into()));
    }

    // Check password
    if let Some(ref hash) = m.password_hash {
        let pw = req.password.as_deref().unwrap_or("");
        if !crate::discreet_auth_handlers::verify_password_pub(pw, hash)? {
            return Err(AppError::Unauthorized("Incorrect meeting password".into()));
        }
    }

    // Broadcast join event
    state.ws_broadcast(m.id, serde_json::json!({
        "type": "meeting_join",
        "meeting_id": m.id,
        "user_id": auth.user_id,
    })).await;

    Ok(Json(serde_json::json!({
        "meeting_id": m.id,
        "joined": true,
        "message": "Connected to meeting. Join the voice channel to start talking.",
    })))
}

// ─── DELETE /meetings/:code ────────────────────────────────────────────

pub async fn end_meeting(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let m = sqlx::query!(
        "SELECT id, host_id FROM meeting_rooms WHERE code = $1 AND is_active = TRUE",
        code,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Meeting not found".into()))?;

    if m.host_id != auth.user_id {
        return Err(AppError::Forbidden("Only the host can end the meeting".into()));
    }

    sqlx::query!("UPDATE meeting_rooms SET is_active = FALSE WHERE id = $1", m.id)
        .execute(&state.db).await?;

    state.ws_broadcast(m.id, serde_json::json!({
        "type": "meeting_end", "meeting_id": m.id,
    })).await;

    Ok(StatusCode::NO_CONTENT)
}

// ─── GET /meetings ─────────────────────────────────────────────────────

pub async fn list_my_meetings(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT id, code, title, is_active, password_hash IS NOT NULL as \"has_password!\",
         allow_guests, max_participants, created_at
         FROM meeting_rooms WHERE host_id = $1 AND is_active = TRUE AND expires_at > NOW()
         ORDER BY created_at DESC",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let meetings: Vec<serde_json::Value> = rows.iter().map(|m| serde_json::json!({
        "id": m.id, "code": m.code, "title": m.title,
        "has_password": m.has_password, "allow_guests": m.allow_guests,
        "max_participants": m.max_participants, "created_at": m.created_at.to_rfc3339(),
    })).collect();

    Ok(Json(meetings))
}
