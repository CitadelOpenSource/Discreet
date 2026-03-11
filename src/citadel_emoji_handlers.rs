// citadel_emoji_handlers.rs — Custom per-server emoji.
//
// Server owners/admins upload emoji images. Members use :name: syntax in messages.
// Emoji images stored as base64 data URLs in the database (alpha).
// Future: object storage backend for emoji images.
//
// Endpoints:
//   GET    /api/v1/servers/:server_id/emojis       — List server emojis
//   POST   /api/v1/servers/:server_id/emojis       — Upload emoji
//   DELETE /api/v1/servers/:server_id/emojis/:id    — Delete emoji

use axum::{
    extract::{Path, State, Json},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

#[derive(Debug, Deserialize)]
pub struct UploadEmojiRequest {
    pub name: String,
    /// Base64-encoded image data (PNG/GIF, max 256KB)
    pub image_data: String,
    pub animated: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct EmojiInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub image_url: String,
    pub uploaded_by: Uuid,
    pub animated: bool,
    pub created_at: String,
}

// ─── GET /api/v1/servers/:server_id/emojis ───────────────────────────

pub async fn list_emojis(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT id, server_id, name, image_url, uploaded_by, animated, created_at
         FROM custom_emojis WHERE server_id = $1 ORDER BY name",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let emojis: Vec<EmojiInfo> = rows.iter().map(|r| EmojiInfo {
        id: r.id, server_id: r.server_id, name: r.name.clone(),
        image_url: r.image_url.clone(), uploaded_by: r.uploaded_by,
        animated: r.animated, created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(emojis))
}

// ─── POST /api/v1/servers/:server_id/emojis ──────────────────────────

pub async fn upload_emoji(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<UploadEmojiRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate name
    let name = req.name.trim().to_lowercase().replace(' ', "_");
    if name.is_empty() || name.len() > 32 {
        return Err(AppError::BadRequest("Emoji name must be 1-32 characters".into()));
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err(AppError::BadRequest("Emoji name can only contain letters, numbers, and underscores".into()));
    }

    // Check server ownership or MANAGE_SERVER permission
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only the server owner can upload emoji".into()));
    }

    // Validate image data size (256KB max as base64)
    if req.image_data.len() > 256 * 1024 {
        return Err(AppError::BadRequest("Emoji image must be under 256KB".into()));
    }

    // Check emoji limit (50 per server for free tier)
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM custom_emojis WHERE server_id = $1",
        server_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    if count >= 50 {
        return Err(AppError::BadRequest("Server emoji limit reached (50)".into()));
    }

    // Store as data URL
    let image_url = if req.image_data.starts_with("data:") {
        req.image_data.clone()
    } else {
        format!("data:image/png;base64,{}", req.image_data)
    };

    let animated = req.animated.unwrap_or(false);

    let emoji = sqlx::query!(
        "INSERT INTO custom_emojis (server_id, name, image_url, uploaded_by, animated)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at",
        server_id, name, image_url, auth.user_id, animated,
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(EmojiInfo {
        id: emoji.id, server_id, name, image_url,
        uploaded_by: auth.user_id, animated,
        created_at: emoji.created_at.to_rfc3339(),
    })))
}

// ─── DELETE /api/v1/servers/:server_id/emojis/:id ────────────────────

pub async fn delete_emoji(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, emoji_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only the server owner can delete emoji".into()));
    }

    sqlx::query!(
        "DELETE FROM custom_emojis WHERE id = $1 AND server_id = $2",
        emoji_id, server_id,
    )
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
