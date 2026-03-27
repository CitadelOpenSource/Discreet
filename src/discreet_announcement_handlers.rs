// discreet_announcement_handlers.rs — Platform admin announcements.
//
// Endpoints:
//   POST /api/v1/admin/announcements  — Create announcement (admin only, 1 per 5 min)
//   GET  /api/v1/admin/announcements  — List announcement history (admin only)
//
// Announcements are broadcast via WebSocket as type "system_announcement".
// Target "all" broadcasts to every connected server bus.
// Target "server:{uuid}" broadcasts to a specific server.

use std::sync::Arc;

use axum::extract::{Json, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::discreet_error::AppError;
use crate::discreet_platform_admin_handlers::require_staff_role;
use crate::discreet_platform_permissions::PlatformUser;
use crate::discreet_state::AppState;

// ─── Request types ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateAnnouncementRequest {
    pub content: String,
    /// "all" or "server:{uuid}"
    #[serde(default = "default_target")]
    pub target: String,
}

fn default_target() -> String {
    "all".into()
}

// ─── POST /api/v1/admin/announcements ───────────────────────────────────────

pub async fn create_announcement(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateAnnouncementRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    // Validate content.
    let content = req.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::BadRequest("Announcement content cannot be empty".into()));
    }
    if content.len() > 2000 {
        return Err(AppError::BadRequest("Announcement content must be 2000 characters or fewer".into()));
    }

    // Validate target.
    let target = req.target.trim().to_lowercase();
    let target_server_id: Option<Uuid> = if target == "all" {
        None
    } else if let Some(sid) = target.strip_prefix("server:") {
        Some(Uuid::parse_str(sid).map_err(|_| AppError::BadRequest("Invalid server UUID in target".into()))?)
    } else {
        return Err(AppError::BadRequest("Target must be 'all' or 'server:{uuid}'".into()));
    };

    // Rate limit: 1 announcement per admin per 5 minutes (Redis).
    let rate_key = format!("announce_rate:{}", caller.user_id);
    let mut redis = state.redis.clone();

    let exists: bool = crate::discreet_error::redis_or_503(
        redis::cmd("EXISTS")
            .arg(&rate_key)
            .query_async(&mut redis)
            .await,
    )?;

    if exists {
        return Err(AppError::RateLimited(
            "You can only send one announcement every 5 minutes".into(),
        ));
    }

    // Set rate limit key with 5-minute TTL.
    let _: String = crate::discreet_error::redis_or_503(
        redis::cmd("SET")
            .arg(&rate_key)
            .arg("1")
            .arg("EX")
            .arg(300_i64)
            .query_async(&mut redis)
            .await,
    )?;

    // Store in database.
    let row = sqlx::query!(
        "INSERT INTO admin_announcements (author_id, content, target)
         VALUES ($1, $2, $3)
         RETURNING id, created_at",
        caller.user_id,
        content,
        target,
    )
    .fetch_one(&state.db)
    .await?;

    let payload = json!({
        "type": "system_announcement",
        "id": row.id,
        "content": content,
        "author_id": caller.user_id,
        "target": target,
        "created_at": row.created_at.to_rfc3339(),
    });

    // Broadcast via WebSocket.
    match target_server_id {
        Some(sid) => {
            state.ws_broadcast(sid, payload.clone()).await;
        }
        None => {
            // Broadcast to all active server buses.
            let buses = state.ws_buses.read().await;
            for (sid, _) in buses.iter() {
                state.ws_broadcast(*sid, payload.clone()).await;
            }
        }
    }

    tracing::info!(
        admin = %caller.user_id,
        target = %target,
        announcement_id = %row.id,
        "ADMIN_ANNOUNCEMENT_SENT"
    );

    Ok(Json(json!({
        "id": row.id,
        "content": content,
        "target": target,
        "created_at": row.created_at.to_rfc3339(),
    })))
}

// ─── GET /api/v1/admin/announcements ────────────────────────────────────────

pub async fn list_announcements(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    let rows = sqlx::query!(
        "SELECT a.id, a.content, a.target, a.created_at, u.username AS author_name
         FROM admin_announcements a
         JOIN users u ON u.id = a.author_id
         ORDER BY a.created_at DESC
         LIMIT 100",
    )
    .fetch_all(&state.db)
    .await?;

    let announcements: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| json!({
            "id": r.id,
            "content": r.content,
            "target": r.target,
            "author_name": r.author_name,
            "created_at": r.created_at.to_rfc3339(),
        }))
        .collect();

    Ok(Json(announcements))
}
