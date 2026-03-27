// discreet_soundboard_handlers.rs — Server soundboard system.
//
// Short audio clips (≤500KB, ~10 seconds) that can be played in voice channels.
// Push-to-play sound effects for voice channels.
//
// Endpoints:
//   GET    /api/v1/servers/:server_id/soundboard        — List clips
//   POST   /api/v1/servers/:server_id/soundboard        — Upload clip
//   DELETE /api/v1/servers/:server_id/soundboard/:id     — Delete clip
//   POST   /api/v1/servers/:server_id/soundboard/:id/play — Increment play count + WS broadcast

use axum::{extract::{Path, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

#[derive(Debug, Deserialize)]
pub struct UploadClipRequest {
    pub name: String,
    pub audio_data: String,
    pub emoji: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ClipInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub audio_data: String,
    pub emoji: Option<String>,
    pub uploaded_by: Uuid,
    pub play_count: i32,
}

pub async fn list_clips(
    _auth: AuthUser, State(state): State<Arc<AppState>>, Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT id, server_id, name, audio_data, emoji, uploaded_by, play_count FROM soundboard_clips WHERE server_id = $1 ORDER BY name",
        server_id,
    ).fetch_all(&state.db).await?;
    let clips: Vec<ClipInfo> = rows.iter().map(|r| ClipInfo {
        id: r.id, server_id: r.server_id, name: r.name.clone(),
        audio_data: r.audio_data.clone(), emoji: r.emoji.clone(),
        uploaded_by: r.uploaded_by, play_count: r.play_count,
    }).collect();
    Ok(Json(clips))
}

pub async fn upload_clip(
    auth: AuthUser, State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>, Json(req): Json<UploadClipRequest>,
) -> Result<impl IntoResponse, AppError> {
    let name = req.name.trim().to_lowercase().replace(' ', "_");
    if name.is_empty() || name.len() > 32 { return Err(AppError::BadRequest("Name 1-32 chars".into())); }
    if req.audio_data.len() > 500 * 1024 { return Err(AppError::BadRequest("Audio must be under 500KB (~10 seconds)".into())); }

    let count = sqlx::query_scalar!("SELECT COUNT(*) FROM soundboard_clips WHERE server_id = $1", server_id)
        .fetch_one(&state.db).await?.unwrap_or(0);
    if count >= 50 { return Err(AppError::BadRequest("Soundboard limit: 50 clips per server".into())); }

    let clip = sqlx::query!(
        "INSERT INTO soundboard_clips (server_id, name, audio_data, emoji, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        server_id, name, req.audio_data, req.emoji, auth.user_id,
    ).fetch_one(&state.db).await?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({ "id": clip.id, "name": name }))))
}

pub async fn delete_clip(
    auth: AuthUser, State(state): State<Arc<AppState>>, Path((server_id, clip_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);
    if !is_owner { return Err(AppError::Forbidden("Only server owner".into())); }
    sqlx::query!("DELETE FROM soundboard_clips WHERE id = $1 AND server_id = $2", clip_id, server_id)
        .execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn play_clip(
    auth: AuthUser, State(state): State<Arc<AppState>>, Path((server_id, clip_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!("UPDATE soundboard_clips SET play_count = play_count + 1 WHERE id = $1", clip_id)
        .execute(&state.db).await?;

    // Broadcast to voice channel so all clients can play the sound
    state.ws_broadcast(server_id, serde_json::json!({
        "type": "soundboard_play",
        "clip_id": clip_id,
        "user_id": auth.user_id,
        "server_id": server_id,
    })).await;

    Ok(Json(serde_json::json!({ "played": true })))
}
