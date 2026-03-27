// discreet_dm_handlers.rs — Zero-knowledge direct messages.
//
// ZERO-KNOWLEDGE DESIGN:
// DM messages are encrypted client-side using X3DH + Double Ratchet (end-to-end encrypted).
// The server stores only ciphertext. It cannot read, search, or moderate DMs.
//
// DM channels are between exactly two users. The schema enforces user_a < user_b
// to prevent duplicate channels for the same pair.
//
// Endpoints:
//   POST   /api/v1/dms                        — Create or get DM channel with a user
//   GET    /api/v1/dms                        — List all DM channels
//   GET    /api/v1/dms/:id/messages          — Get DM message history
//   POST   /api/v1/dms/:id/messages          — Send encrypted DM

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ─── Request / Response Types ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateDmRequest {
    /// The other user's ID.
    pub recipient_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct DmChannelInfo {
    pub id: Uuid,
    pub other_user_id: Uuid,
    pub other_username: String,
    pub other_display_name: Option<String>,
    pub other_avatar_url: Option<String>,
    pub other_is_bot: bool,
    pub created_at: String,
    /// Most recent message timestamp (for sorting).
    pub last_message_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendDmRequest {
    /// E2EE ciphertext (X3DH + Double Ratchet), base64-encoded.
    /// The server CANNOT read this.
    pub content_ciphertext: String,
}

#[derive(Debug, Serialize)]
pub struct DmMessageInfo {
    pub id: Uuid,
    pub dm_channel_id: Uuid,
    pub sender_id: Uuid,
    /// Base64-encoded E2EE ciphertext (X3DH + Double Ratchet).
    pub content_ciphertext: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
    pub before: Option<Uuid>,
}

fn default_limit() -> i64 {
    50
}

// ─── POST /api/v1/dms ─────────────────────────────────────────────────

/// Create (or return existing) DM channel with another user.
pub async fn create_dm(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateDmRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.recipient_id == auth.user_id {
        return Err(AppError::BadRequest("Cannot DM yourself".into()));
    }

    // Verify recipient exists.
    let recipient_exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)",
        req.recipient_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !recipient_exists.unwrap_or(false) {
        return Err(AppError::NotFound("User not found".into()));
    }

    // The schema enforces user_a < user_b to prevent duplicates.
    let (user_a, user_b) = if auth.user_id < req.recipient_id {
        (auth.user_id, req.recipient_id)
    } else {
        (req.recipient_id, auth.user_id)
    };

    // Try to find existing DM channel.
    let existing = sqlx::query!(
        "SELECT id, created_at FROM dm_channels
         WHERE user_a = $1 AND user_b = $2",
        user_a,
        user_b,
    )
    .fetch_optional(&state.db)
    .await?;

    let (channel_id, created_at, is_new) = if let Some(ch) = existing {
        (ch.id, ch.created_at, false)
    } else {
        // Create new DM channel.
        let new_id = Uuid::new_v4();
        let row = sqlx::query!(
            "INSERT INTO dm_channels (id, user_a, user_b)
             VALUES ($1, $2, $3)
             RETURNING created_at",
            new_id,
            user_a,
            user_b,
        )
        .fetch_one(&state.db)
        .await?;
        (new_id, row.created_at, true)
    };

    // Fetch recipient info for the response.
    let recipient = sqlx::query!(
        "SELECT username, display_name, avatar_url, is_bot FROM users WHERE id = $1",
        req.recipient_id,
    )
    .fetch_one(&state.db)
    .await?;

    let status = if is_new {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };

    Ok((
        status,
        Json(DmChannelInfo {
            id: channel_id,
            other_user_id: req.recipient_id,
            other_username: recipient.username,
            other_display_name: recipient.display_name,
            other_avatar_url: recipient.avatar_url,
            other_is_bot: recipient.is_bot,
            created_at: created_at.to_rfc3339(),
            last_message_at: None,
        }),
    ))
}

// ─── GET /api/v1/dms ───────────────────────────────────────────────────

/// List all DM channels for the current user, sorted by most recent message.
pub async fn list_dms(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT
            dc.id,
            dc.user_a,
            dc.user_b,
            dc.created_at,
            (SELECT MAX(dm.created_at) FROM dm_messages dm WHERE dm.dm_channel_id = dc.id)
                AS last_message_at
         FROM dm_channels dc
         WHERE dc.user_a = $1 OR dc.user_b = $1
         ORDER BY COALESCE(
            (SELECT MAX(dm.created_at) FROM dm_messages dm WHERE dm.dm_channel_id = dc.id),
            dc.created_at
         ) DESC",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let mut channels = Vec::with_capacity(rows.len());

    for r in rows {
        // The "other" user is whichever one isn't auth.user_id.
        let other_id = if r.user_a == auth.user_id {
            r.user_b
        } else {
            r.user_a
        };

        let other = sqlx::query!(
            "SELECT username, display_name, avatar_url, is_bot FROM users WHERE id = $1",
            other_id,
        )
        .fetch_one(&state.db)
        .await?;

        channels.push(DmChannelInfo {
            id: r.id,
            other_user_id: other_id,
            other_username: other.username,
            other_display_name: other.display_name,
            other_avatar_url: other.avatar_url,
            other_is_bot: other.is_bot,
            created_at: r.created_at.to_rfc3339(),
            last_message_at: r.last_message_at.map(|t| t.to_rfc3339()),
        });
    }

    Ok(Json(serde_json::json!({ "channels": channels })))
}

// ─── POST /api/v1/dms/:id/messages ────────────────────────────────────

/// Send an encrypted DM. The server stores only ciphertext.
pub async fn send_dm(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(dm_channel_id): Path<Uuid>,
    Json(req): Json<SendDmRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.content_ciphertext.is_empty() {
        return Err(AppError::BadRequest(
            "Message ciphertext cannot be empty".into(),
        ));
    }

    // Verify the user is a participant in this DM channel.
    let channel = sqlx::query!(
        "SELECT user_a, user_b FROM dm_channels WHERE id = $1",
        dm_channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("DM channel not found".into()))?;

    if channel.user_a != auth.user_id && channel.user_b != auth.user_id {
        return Err(AppError::Forbidden("Not a participant in this DM".into()));
    }

    // Decode base64 to bytes for storage.
    let ciphertext_bytes = decode_base64(&req.content_ciphertext)?;

    if ciphertext_bytes.len() > 262_144 {
        return Err(AppError::BadRequest("Message exceeds 256KB limit".into()));
    }

    let message_id = Uuid::new_v4();
    let row = sqlx::query!(
        "INSERT INTO dm_messages (id, dm_channel_id, sender_id, content_ciphertext)
         VALUES ($1, $2, $3, $4)
         RETURNING created_at",
        message_id,
        dm_channel_id,
        auth.user_id,
        &ciphertext_bytes,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(
        dm_channel_id = %dm_channel_id,
        sender_id = %auth.user_id,
        "Encrypted DM sent"
    );

    Ok((
        StatusCode::CREATED,
        Json(DmMessageInfo {
            id: message_id,
            dm_channel_id,
            sender_id: auth.user_id,
            content_ciphertext: req.content_ciphertext,
            created_at: row.created_at.to_rfc3339(),
        }),
    ))
}

// ─── GET /api/v1/dms/:id/messages ─────────────────────────────────────

/// Get DM message history (paginated). Returns encrypted ciphertext.
pub async fn get_dm_messages(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(dm_channel_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    // Verify participation.
    let channel = sqlx::query!(
        "SELECT user_a, user_b FROM dm_channels WHERE id = $1",
        dm_channel_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("DM channel not found".into()))?;

    if channel.user_a != auth.user_id && channel.user_b != auth.user_id {
        return Err(AppError::Forbidden("Not a participant in this DM".into()));
    }

    let limit = params.limit.clamp(1, 100);

    let messages: Vec<DmMessageInfo> = if let Some(before_id) = params.before {
        sqlx::query!(
            "SELECT id, dm_channel_id, sender_id, content_ciphertext, created_at
             FROM dm_messages
             WHERE dm_channel_id = $1
               AND created_at < (SELECT created_at FROM dm_messages WHERE id = $2)
             ORDER BY created_at DESC
             LIMIT $3",
            dm_channel_id,
            before_id,
            limit,
        )
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|r| DmMessageInfo {
            id: r.id,
            dm_channel_id: r.dm_channel_id,
            sender_id: r.sender_id,
            content_ciphertext: encode_base64(&r.content_ciphertext),
            created_at: r.created_at.to_rfc3339(),
        })
        .collect()
    } else {
        sqlx::query!(
            "SELECT id, dm_channel_id, sender_id, content_ciphertext, created_at
             FROM dm_messages
             WHERE dm_channel_id = $1
             ORDER BY created_at DESC
             LIMIT $2",
            dm_channel_id,
            limit,
        )
        .fetch_all(&state.db)
        .await?
        .into_iter()
        .map(|r| DmMessageInfo {
            id: r.id,
            dm_channel_id: r.dm_channel_id,
            sender_id: r.sender_id,
            content_ciphertext: encode_base64(&r.content_ciphertext),
            created_at: r.created_at.to_rfc3339(),
        })
        .collect()
    };

    Ok(Json(messages))
}

// ─── Helpers ───────────────────────────────────────────────────────────

fn decode_base64(input: &str) -> Result<Vec<u8>, AppError> {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine;
    URL_SAFE_NO_PAD
        .decode(input)
        .or_else(|_| STANDARD.decode(input))
        .map_err(|e| AppError::BadRequest(format!("Invalid base64: {e}")))
}

fn encode_base64(data: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(data)
}

// ─── Route Registration ────────────────────────────────────────────────

pub fn dm_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/dms", post(create_dm))
        .route("/dms", get(list_dms))
        .route("/dms/:id/messages", post(send_dm))
        .route("/dms/:id/messages", get(get_dm_messages))
}
