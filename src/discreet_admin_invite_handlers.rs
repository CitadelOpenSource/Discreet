// discreet_admin_invite_handlers.rs — Admin invite code management.
//
// Endpoints:
//   POST   /api/v1/admin/invites      — Create an invite code (admin only)
//   GET    /api/v1/admin/invites      — List all invite codes (admin only)
//   DELETE /api/v1/admin/invites/:id  — Revoke an invite code (admin only)
//
// Registration checks invite_code when platform setting require_invite is true.

use std::sync::Arc;

use axum::extract::{Json, Path, State};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::discreet_error::AppError;
use crate::discreet_platform_admin_handlers::require_staff_role;
use crate::discreet_platform_permissions::PlatformUser;
use crate::discreet_state::AppState;

// ─── Request / Response types ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    #[serde(default = "default_max_uses")]
    pub max_uses: i32,
    pub expires_at: Option<String>,
}

fn default_max_uses() -> i32 { 10 }

#[derive(Debug, Serialize)]
pub struct InviteResponse {
    pub id: Uuid,
    pub code: String,
    pub created_by: Uuid,
    pub max_uses: i32,
    pub uses: i32,
    pub expires_at: Option<String>,
    pub created_at: String,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Generate a random 8-character alphanumeric invite code.
fn generate_invite_code() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..8).map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char).collect()
}

/// Validate and consume an invite code during registration.
/// Returns Ok(()) if the code is valid, or Err if invalid/expired/exhausted.
pub async fn validate_and_consume_invite(
    db: &sqlx::PgPool,
    code: &str,
) -> Result<(), AppError> {
    let code_upper = code.trim().to_uppercase();

    let invite = sqlx::query!(
        "SELECT id, max_uses, uses, expires_at FROM admin_invites WHERE code = $1",
        code_upper,
    )
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Invalid invite code".into()))?;

    if invite.uses >= invite.max_uses {
        return Err(AppError::BadRequest("Invite code has been fully used".into()));
    }

    if let Some(expires) = invite.expires_at {
        if chrono::Utc::now() > expires {
            return Err(AppError::BadRequest("Invite code has expired".into()));
        }
    }

    // Atomically increment usage count.
    sqlx::query!(
        "UPDATE admin_invites SET uses = uses + 1 WHERE id = $1 AND uses < max_uses",
        invite.id,
    )
    .execute(db)
    .await?;

    Ok(())
}

// ─── POST /api/v1/admin/invites ─────────────────────────────────────────────

pub async fn create_invite(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateInviteRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    if req.max_uses < 1 || req.max_uses > 10000 {
        return Err(AppError::BadRequest("max_uses must be between 1 and 10000".into()));
    }

    let expires_at: Option<chrono::DateTime<chrono::Utc>> = match req.expires_at {
        Some(ref s) => Some(
            chrono::DateTime::parse_from_rfc3339(s)
                .map_err(|_| AppError::BadRequest("Invalid expires_at format. Use ISO 8601.".into()))?
                .with_timezone(&chrono::Utc),
        ),
        None => None,
    };

    let code = generate_invite_code();

    let row = sqlx::query!(
        "INSERT INTO admin_invites (code, created_by, max_uses, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at",
        code,
        caller.user_id,
        req.max_uses,
        expires_at,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(
        admin = %caller.user_id,
        code = %code,
        max_uses = req.max_uses,
        "ADMIN_INVITE_CREATED"
    );

    Ok(Json(json!({
        "id": row.id,
        "code": code,
        "max_uses": req.max_uses,
        "uses": 0,
        "expires_at": expires_at.map(|t| t.to_rfc3339()),
        "created_at": row.created_at.to_rfc3339(),
    })))
}

// ─── GET /api/v1/admin/invites ──────────────────────────────────────────────

pub async fn list_invites(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    let rows = sqlx::query!(
        "SELECT id, code, created_by, max_uses, uses, expires_at, created_at
         FROM admin_invites
         ORDER BY created_at DESC
         LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;

    let invites: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| json!({
            "id": r.id,
            "code": r.code,
            "created_by": r.created_by,
            "max_uses": r.max_uses,
            "uses": r.uses,
            "expires_at": r.expires_at.map(|t| t.to_rfc3339()),
            "created_at": r.created_at.to_rfc3339(),
        }))
        .collect();

    Ok(Json(invites))
}

// ─── DELETE /api/v1/admin/invites/:id ───────────────────────────────────────

pub async fn delete_invite(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(invite_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;

    let result = sqlx::query!(
        "DELETE FROM admin_invites WHERE id = $1",
        invite_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Invite not found".into()));
    }

    tracing::info!(admin = %caller.user_id, invite_id = %invite_id, "ADMIN_INVITE_REVOKED");

    Ok(Json(json!({ "deleted": true })))
}
