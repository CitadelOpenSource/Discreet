// citadel_role_handlers.rs — Role CRUD and role assignment.
//
// Roles are server-scoped. Each server gets an implicit `@everyone` role
// at position 0 (created in server_handlers::create_server).
//
// Endpoints:
//   POST   /api/v1/servers/:server_id/roles                               — Create role
//   GET    /api/v1/servers/:server_id/roles                               — List roles
//   PATCH  /api/v1/roles/:role_id                                         — Update role
//   DELETE /api/v1/roles/:role_id                                         — Delete role
//   PUT    /api/v1/servers/:sid/members/:uid/roles/:rid                   — Assign role
//   DELETE /api/v1/servers/:sid/members/:uid/roles/:rid                   — Unassign role
//   GET    /api/v1/servers/:sid/members/:uid/roles                        — List member roles

use axum::{
    extract::{Path, State, Json},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_audit::log_action;
use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_permissions::{require_permission, Permission};
use crate::citadel_state::AppState;

// ─── Request Types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    pub color: Option<String>,
    pub permissions: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub color: Option<String>,
    pub permissions: Option<i64>,
    pub position: Option<i32>,
}

// ─── Response Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct RoleInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub permissions: i64,
    pub position: i32,
    pub created_at: String,
}

// ─── POST /api/v1/servers/:server_id/roles ──────────────────────────────

pub async fn create_role(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateRoleRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_ROLES).await?;

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::BadRequest("Role name must be 1-64 characters".into()));
    }

    // Validate color if provided (hex like #FF5733).
    if let Some(ref color) = req.color {
        if !color.starts_with('#') || color.len() != 7 {
            return Err(AppError::BadRequest("Color must be hex format (#RRGGBB)".into()));
        }
    }

    // Next position.
    let max_pos = sqlx::query_scalar!(
        "SELECT COALESCE(MAX(position), 0) FROM roles WHERE server_id = $1",
        server_id,
    )
    .fetch_one(&state.db)
    .await?;

    let position = max_pos.unwrap_or(0) + 1;
    let permissions = req.permissions.unwrap_or(0);
    let role_id = Uuid::new_v4();

    sqlx::query!(
        "INSERT INTO roles (id, server_id, name, color, permissions, position)
         VALUES ($1, $2, $3, $4, $5, $6)",
        role_id, server_id, name, req.color, permissions, position,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(role_id = %role_id, server_id = %server_id, name = %name, "Role created");

    log_action(
        &state.db,
        server_id,
        auth.user_id,
        "ROLE_CREATE",
        Some("role"),
        Some(role_id),
        None,
        None,
    )
    .await
    .ok();

    Ok((StatusCode::CREATED, Json(RoleInfo {
        id: role_id,
        server_id,
        name,
        color: req.color,
        permissions,
        position,
        created_at: chrono::Utc::now().to_rfc3339(),
    })))
}

// ─── GET /api/v1/servers/:server_id/roles ───────────────────────────────

pub async fn list_roles(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Any member can see roles.
    require_membership(&state, server_id, auth.user_id).await?;

    let rows = sqlx::query!(
        "SELECT id, server_id, name, color, permissions, position, created_at
         FROM roles WHERE server_id = $1 ORDER BY position",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let roles: Vec<RoleInfo> = rows.into_iter().map(|r| RoleInfo {
        id: r.id,
        server_id: r.server_id,
        name: r.name,
        color: r.color,
        permissions: r.permissions,
        position: r.position,
        created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(roles))
}

// ─── PATCH /api/v1/roles/:role_id ──────────────────────────────────────

pub async fn update_role(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(role_id): Path<Uuid>,
    Json(req): Json<UpdateRoleRequest>,
) -> Result<impl IntoResponse, AppError> {
    let role = sqlx::query!(
        "SELECT server_id, position FROM roles WHERE id = $1",
        role_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Role not found".into()))?;

    require_permission(&state, role.server_id, auth.user_id, Permission::MANAGE_ROLES).await?;

    // Can't modify the @everyone role's name.
    if role.position == 0 {
        if req.name.is_some() {
            return Err(AppError::BadRequest("Cannot rename the @everyone role".into()));
        }
    }

    if let Some(ref name) = req.name {
        let name = name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::BadRequest("Role name must be 1-64 characters".into()));
        }
        sqlx::query!("UPDATE roles SET name = $1 WHERE id = $2", name, role_id)
            .execute(&state.db).await?;
    }
    if let Some(ref color) = req.color {
        sqlx::query!("UPDATE roles SET color = $1 WHERE id = $2", color, role_id)
            .execute(&state.db).await?;
    }
    if let Some(permissions) = req.permissions {
        sqlx::query!("UPDATE roles SET permissions = $1 WHERE id = $2", permissions, role_id)
            .execute(&state.db).await?;
    }
    if let Some(position) = req.position {
        if position == 0 && role.position != 0 {
            return Err(AppError::BadRequest("Position 0 is reserved for @everyone".into()));
        }
        sqlx::query!("UPDATE roles SET position = $1 WHERE id = $2", position, role_id)
            .execute(&state.db).await?;
    }

    let updated = sqlx::query!(
        "SELECT id, server_id, name, color, permissions, position, created_at
         FROM roles WHERE id = $1", role_id,
    )
    .fetch_one(&state.db).await?;

    log_action(
        &state.db,
        updated.server_id,
        auth.user_id,
        "ROLE_UPDATE",
        Some("role"),
        Some(role_id),
        None,
        None,
    )
    .await
    .ok();

    Ok(Json(RoleInfo {
        id: updated.id,
        server_id: updated.server_id,
        name: updated.name,
        color: updated.color,
        permissions: updated.permissions,
        position: updated.position,
        created_at: updated.created_at.to_rfc3339(),
    }))
}

// ─── DELETE /api/v1/roles/:role_id ─────────────────────────────────────

pub async fn delete_role(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(role_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let role = sqlx::query!(
        "SELECT server_id, position FROM roles WHERE id = $1",
        role_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Role not found".into()))?;

    require_permission(&state, role.server_id, auth.user_id, Permission::MANAGE_ROLES).await?;

    // Can't delete @everyone.
    if role.position == 0 {
        return Err(AppError::BadRequest("Cannot delete the @everyone role".into()));
    }

    // CASCADE removes member_roles assignments.
    sqlx::query!("DELETE FROM roles WHERE id = $1", role_id)
        .execute(&state.db).await?;

    log_action(
        &state.db,
        role.server_id,
        auth.user_id,
        "ROLE_DELETE",
        Some("role"),
        Some(role_id),
        None,
        None,
    )
    .await
    .ok();

    Ok(StatusCode::NO_CONTENT)
}

// ─── PUT /api/v1/servers/:sid/members/:uid/roles/:rid ──────────────────

pub async fn assign_role(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_ROLES).await?;

    // Verify user is a member.
    require_membership(&state, server_id, user_id).await?;

    // Verify role belongs to this server and get its position.
    let target_role = sqlx::query!(
        "SELECT id, position FROM roles WHERE id = $1 AND server_id = $2",
        role_id, server_id,
    )
    .fetch_optional(&state.db).await?
    .ok_or_else(|| AppError::NotFound("Role not found on this server".into()))?;

    // Hierarchy enforcement: assigner must have a role higher than the role being assigned
    // (unless they are the server owner, who can always assign any role)
    let is_owner = sqlx::query_scalar!(
        "SELECT owner_id FROM servers WHERE id = $1",
        server_id,
    ).fetch_one(&state.db).await? == auth.user_id;

    if !is_owner {
        let assigner_max_pos = sqlx::query_scalar!(
            "SELECT COALESCE(MAX(r.position), 0) FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.server_id = $1 AND mr.user_id = $2",
            server_id, auth.user_id,
        ).fetch_one(&state.db).await?.unwrap_or(0);

        if assigner_max_pos <= target_role.position {
            return Err(AppError::Forbidden(
                "Cannot assign a role equal to or above your highest role".into()
            ));
        }
    }

    // Upsert (ignore if already assigned).
    sqlx::query!(
        "INSERT INTO member_roles (server_id, user_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (server_id, user_id, role_id) DO NOTHING",
        server_id, user_id, role_id,
    )
    .execute(&state.db).await?;

    let _ = log_action(
        &state.db, server_id, auth.user_id, "ASSIGN_ROLE",
        Some("member"), Some(user_id),
        Some(serde_json::json!({ "role_id": role_id })), None,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ─── DELETE /api/v1/servers/:sid/members/:uid/roles/:rid ───────────────

pub async fn unassign_role(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, Permission::MANAGE_ROLES).await?;

    let result = sqlx::query!(
        "DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2 AND role_id = $3",
        server_id, user_id, role_id,
    )
    .execute(&state.db).await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Role assignment not found".into()));
    }

    let _ = log_action(
        &state.db, server_id, auth.user_id, "UNASSIGN_ROLE",
        Some("member"), Some(user_id),
        Some(serde_json::json!({ "role_id": role_id })), None,
    ).await;

    Ok(StatusCode::NO_CONTENT)
}

// ─── GET /api/v1/servers/:sid/members/:uid/roles ───────────────────────

pub async fn list_member_roles(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    let rows = sqlx::query!(
        "SELECT r.id, r.server_id, r.name, r.color, r.permissions, r.position, r.created_at
         FROM member_roles mr
         INNER JOIN roles r ON r.id = mr.role_id
         WHERE mr.server_id = $1 AND mr.user_id = $2
         ORDER BY r.position",
        server_id, user_id,
    )
    .fetch_all(&state.db).await?;

    let roles: Vec<RoleInfo> = rows.into_iter().map(|r| RoleInfo {
        id: r.id,
        server_id: r.server_id,
        name: r.name,
        color: r.color,
        permissions: r.permissions,
        position: r.position,
        created_at: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(roles))
}

// ─── Helpers ────────────────────────────────────────────────────────────

async fn require_membership(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<(), AppError> {
    let ok = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server_id, user_id,
    )
    .fetch_one(&state.db).await?;
    if !ok.unwrap_or(false) {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }
    Ok(())
}

// ─── Route Registration ─────────────────────────────────────────────────

pub fn role_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, post, patch, put, delete};
    axum::Router::new()
        .route("/servers/{id}/roles", post(create_role))
        .route("/servers/{id}/roles", get(list_roles))
        .route("/roles/{role_id}", patch(update_role))
        .route("/roles/{role_id}", delete(delete_role))
        .route("/servers/{id}/members/{user_id}/roles/{role_id}", put(assign_role))
        .route("/servers/{id}/members/{user_id}/roles/{role_id}", delete(unassign_role))
        .route("/servers/{id}/members/{user_id}/roles", get(list_member_roles))
}
