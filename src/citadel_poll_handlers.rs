// citadel_poll_handlers.rs — Native polls/voting in channels.
//
// Users create polls with 2-10 options. Members vote.
// Supports: multiple choice, anonymous voting, timed expiry.
//
// Endpoints:
//   POST   /api/v1/channels/:id/polls     — Create poll
//   GET    /api/v1/channels/:id/polls     — List polls in channel
//   POST   /api/v1/polls/:id/vote         — Vote on a poll
//   DELETE /api/v1/polls/:id              — Delete poll (creator or owner)
//   GET    /api/v1/polls/:id              — Get poll with results

use axum::{extract::{Path, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{citadel_auth::AuthUser, citadel_error::AppError, citadel_state::AppState};

#[derive(Debug, Deserialize)]
pub struct CreatePollRequest {
    pub question: String,
    pub options: Vec<String>,
    pub allow_multiple: Option<bool>,
    pub anonymous: Option<bool>,
    pub duration_minutes: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct VoteRequest {
    pub option_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct PollInfo {
    pub id: Uuid,
    pub question: String,
    pub options: Vec<PollOptionInfo>,
    pub allow_multiple: bool,
    pub anonymous: bool,
    pub total_votes: i64,
    pub my_votes: Vec<Uuid>,
    pub creator_id: Uuid,
    pub expires_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct PollOptionInfo {
    pub id: Uuid,
    pub label: String,
    pub votes: i64,
    pub percentage: f64,
}

// ─── POST /channels/:id/polls ──────────────────────────────────────────

pub async fn create_poll(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<CreatePollRequest>,
) -> Result<impl IntoResponse, AppError> {
    let q = req.question.trim();
    if q.is_empty() || q.len() > 300 {
        return Err(AppError::BadRequest("Question must be 1-300 characters".into()));
    }
    if req.options.len() < 2 || req.options.len() > 10 {
        return Err(AppError::BadRequest("Polls need 2-10 options".into()));
    }

    let expires = req.duration_minutes.map(|m| chrono::Utc::now() + chrono::Duration::minutes(m));

    let poll = sqlx::query!(
        "INSERT INTO polls (channel_id, creator_id, question, allow_multiple, anonymous, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        channel_id, auth.user_id, q,
        req.allow_multiple.unwrap_or(false),
        req.anonymous.unwrap_or(false),
        expires,
    ).fetch_one(&state.db).await?;

    for (i, label) in req.options.iter().enumerate() {
        let l = label.trim();
        if l.is_empty() || l.len() > 100 { continue; }
        sqlx::query!(
            "INSERT INTO poll_options (poll_id, label, position) VALUES ($1, $2, $3)",
            poll.id, l, i as i32,
        ).execute(&state.db).await?;
    }

    // Get server_id for WS broadcast
    let ch = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", channel_id)
        .fetch_optional(&state.db).await?;
    if let Some(ch) = ch {
        state.ws_broadcast(ch.server_id, serde_json::json!({
            "type": "poll_create", "channel_id": channel_id, "poll_id": poll.id, "question": q,
        })).await;
    }

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": poll.id, "question": q, "options_count": req.options.len(),
    }))))
}

// ─── GET /channels/:id/polls ───────────────────────────────────────────

pub async fn list_polls(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let polls = sqlx::query!(
        "SELECT id, question, allow_multiple, anonymous, creator_id, expires_at, created_at
         FROM polls WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 20",
        channel_id,
    ).fetch_all(&state.db).await?;

    let mut result = Vec::new();
    for p in &polls {
        let info = build_poll_info(&state, PollBuildParams {
            poll_id: p.id, user_id: auth.user_id, question: p.question.clone(),
            allow_multiple: p.allow_multiple, anonymous: p.anonymous, creator_id: p.creator_id,
            expires_at: p.expires_at.map(|t| t.to_rfc3339()), created_at: p.created_at.to_rfc3339(),
        }).await?;
        result.push(info);
    }

    Ok(Json(result))
}

// ─── GET /polls/:id ────────────────────────────────────────────────────

pub async fn get_poll(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(poll_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let p = sqlx::query!(
        "SELECT id, question, allow_multiple, anonymous, creator_id, expires_at, created_at
         FROM polls WHERE id = $1",
        poll_id,
    ).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Poll not found".into()))?;

    let info = build_poll_info(&state, PollBuildParams {
        poll_id: p.id, user_id: auth.user_id, question: p.question.clone(),
        allow_multiple: p.allow_multiple, anonymous: p.anonymous, creator_id: p.creator_id,
        expires_at: p.expires_at.map(|t| t.to_rfc3339()), created_at: p.created_at.to_rfc3339(),
    }).await?;

    Ok(Json(info))
}

// ─── POST /polls/:id/vote ──────────────────────────────────────────────

pub async fn vote_poll(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(poll_id): Path<Uuid>,
    Json(req): Json<VoteRequest>,
) -> Result<impl IntoResponse, AppError> {
    let p = sqlx::query!(
        "SELECT allow_multiple, expires_at FROM polls WHERE id = $1",
        poll_id,
    ).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Poll not found".into()))?;

    // Check expiry
    if let Some(exp) = p.expires_at {
        if exp < chrono::Utc::now() {
            return Err(AppError::BadRequest("This poll has expired".into()));
        }
    }

    if req.option_ids.is_empty() {
        return Err(AppError::BadRequest("Select at least one option".into()));
    }
    if !p.allow_multiple && req.option_ids.len() > 1 {
        return Err(AppError::BadRequest("This poll only allows one vote".into()));
    }

    // Remove previous votes
    sqlx::query!("DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2", poll_id, auth.user_id)
        .execute(&state.db).await?;

    // Cast new votes
    for oid in &req.option_ids {
        sqlx::query!(
            "INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            poll_id, oid, auth.user_id,
        ).execute(&state.db).await?;
    }

    Ok(Json(serde_json::json!({ "voted": true, "options": req.option_ids.len() })))
}

// ─── DELETE /polls/:id ─────────────────────────────────────────────────

pub async fn delete_poll(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(poll_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let p = sqlx::query!("SELECT creator_id, channel_id FROM polls WHERE id = $1", poll_id)
        .fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Poll not found".into()))?;

    if p.creator_id != auth.user_id {
        // Check if server owner
        let ch = sqlx::query!("SELECT server_id FROM channels WHERE id = $1", p.channel_id)
            .fetch_optional(&state.db).await?;
        if let Some(ch) = ch {
            let is_owner = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
                ch.server_id, auth.user_id,
            ).fetch_one(&state.db).await?.unwrap_or(false);
            if !is_owner { return Err(AppError::Forbidden("Only creator or server owner".into())); }
        }
    }

    sqlx::query!("DELETE FROM polls WHERE id = $1", poll_id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Helper ────────────────────────────────────────────────────────────

struct PollBuildParams {
    poll_id: Uuid,
    user_id: Uuid,
    question: String,
    allow_multiple: bool,
    anonymous: bool,
    creator_id: Uuid,
    expires_at: Option<String>,
    created_at: String,
}

async fn build_poll_info(
    state: &AppState, params: PollBuildParams,
) -> Result<PollInfo, AppError> {
    let opts = sqlx::query!(
        "SELECT o.id, o.label, o.position,
         (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) as \"votes!\"
         FROM poll_options o WHERE o.poll_id = $1 ORDER BY o.position",
        params.poll_id,
    ).fetch_all(&state.db).await?;

    let total: i64 = opts.iter().map(|o| o.votes).sum();

    let my_votes = sqlx::query_scalar!(
        "SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2",
        params.poll_id, params.user_id,
    ).fetch_all(&state.db).await?;

    let options: Vec<PollOptionInfo> = opts.iter().map(|o| PollOptionInfo {
        id: o.id, label: o.label.clone(),
        votes: o.votes,
        percentage: if total > 0 { (o.votes as f64 / total as f64) * 100.0 } else { 0.0 },
    }).collect();

    Ok(PollInfo {
        id: params.poll_id, question: params.question, options,
        allow_multiple: params.allow_multiple, anonymous: params.anonymous,
        total_votes: total, my_votes, creator_id: params.creator_id,
        expires_at: params.expires_at, created_at: params.created_at,
    })
}
