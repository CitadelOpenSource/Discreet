// discreet_scheduled_task_handlers.rs — Scheduled task CRUD.
//
// Endpoints:
//   POST   /api/v1/servers/:server_id/tasks           — Create a task
//   GET    /api/v1/servers/:server_id/tasks           — List tasks
//   DELETE /api/v1/tasks/:id                          — Delete a task
//   PATCH  /api/v1/tasks/:id/toggle                   — Enable/disable a task

use axum::{extract::{Path, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

// ─── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub channel_id: Option<Uuid>,
    pub task_type: String,
    pub config: Option<serde_json::Value>,
    pub cron_expr: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub created_by: Uuid,
    pub task_type: String,
    pub config: serde_json::Value,
    pub cron_expr: String,
    pub next_run: Option<String>,
    pub last_run: Option<String>,
    pub enabled: bool,
    pub created_at: String,
}

/// Row type shared by both list queries.
#[derive(sqlx::FromRow)]
struct TaskRow {
    id: Uuid,
    server_id: Uuid,
    channel_id: Option<Uuid>,
    created_by: Uuid,
    task_type: String,
    config: serde_json::Value,
    cron_expr: String,
    next_run: Option<chrono::DateTime<chrono::Utc>>,
    last_run: Option<chrono::DateTime<chrono::Utc>>,
    enabled: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn row_to_response(r: &TaskRow) -> TaskResponse {
    TaskResponse {
        id: r.id,
        server_id: r.server_id,
        channel_id: r.channel_id,
        created_by: r.created_by,
        task_type: r.task_type.clone(),
        config: r.config.clone(),
        cron_expr: r.cron_expr.clone(),
        next_run: r.next_run.map(|ts| ts.to_rfc3339()),
        last_run: r.last_run.map(|ts| ts.to_rfc3339()),
        enabled: r.enabled,
        created_at: r.created_at.to_rfc3339(),
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Validate a cron expression (5-field: min hour dom month dow).
/// Accepts "*" and numeric values; rejects obvious garbage.
fn validate_cron(expr: &str) -> Result<(), AppError> {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(AppError::BadRequest(
            "cron_expr must have 5 fields: minute hour day-of-month month day-of-week".into(),
        ));
    }
    for (i, field) in fields.iter().enumerate() {
        let max = [59, 23, 31, 12, 6][i];
        // Allow *, */N, N, N-N, N,N,...
        for part in field.split(',') {
            let part = part.trim();
            if part == "*" {
                continue;
            }
            if let Some(step) = part.strip_prefix("*/") {
                let n: u32 = step.parse().map_err(|_| {
                    AppError::BadRequest(format!("Invalid cron step: {part}"))
                })?;
                if n == 0 || n > max {
                    return Err(AppError::BadRequest(format!("Cron step out of range: {part}")));
                }
                continue;
            }
            if part.contains('-') {
                let bounds: Vec<&str> = part.split('-').collect();
                if bounds.len() != 2 {
                    return Err(AppError::BadRequest(format!("Invalid cron range: {part}")));
                }
                let _lo: u32 = bounds[0].parse().map_err(|_| AppError::BadRequest(format!("Invalid cron value: {part}")))?;
                let _hi: u32 = bounds[1].parse().map_err(|_| AppError::BadRequest(format!("Invalid cron value: {part}")))?;
                continue;
            }
            let n: u32 = part.parse().map_err(|_| {
                AppError::BadRequest(format!("Invalid cron value: {part}"))
            })?;
            if n > max {
                return Err(AppError::BadRequest(format!("Cron value {n} out of range (max {max})")));
            }
        }
    }
    Ok(())
}

const VALID_TASK_TYPES: &[&str] = &[
    "announcement",
    "poll",
    "purge",
    "reminder",
    "backup",
    "role_rotate",
    "channel_monitor",
];

async fn require_membership(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2) as "exists!""#,
        server_id,
        user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_member {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }
    Ok(())
}

// ─── POST /servers/:server_id/tasks ─────────────────────────────────────

/// Create a scheduled task for a server.
pub async fn create_task(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateTaskRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    // Validate task_type
    if !VALID_TASK_TYPES.contains(&req.task_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "task_type must be one of: {}",
            VALID_TASK_TYPES.join(", ")
        )));
    }

    // Validate cron expression
    validate_cron(&req.cron_expr)?;

    // Validate config size
    let config = req.config.unwrap_or(serde_json::json!({}));
    let config_str = config.to_string();
    if config_str.len() > 8192 {
        return Err(AppError::BadRequest("Task config must be under 8KB".into()));
    }

    // Validate channel belongs to server (if provided)
    if let Some(cid) = req.channel_id {
        let exists = sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND server_id = $2) as "exists!""#,
            cid, server_id,
        )
        .fetch_one(&state.db)
        .await?;

        if !exists {
            return Err(AppError::BadRequest("Channel not found in this server".into()));
        }
    }

    let enabled = req.enabled.unwrap_or(true);

    let row = sqlx::query!(
        "INSERT INTO scheduled_tasks (server_id, channel_id, created_by, task_type, config, cron_expr, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at",
        server_id,
        req.channel_id,
        auth.user_id,
        req.task_type,
        config,
        req.cron_expr,
        enabled,
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(TaskResponse {
        id: row.id,
        server_id,
        channel_id: req.channel_id,
        created_by: auth.user_id,
        task_type: req.task_type,
        config,
        cron_expr: req.cron_expr,
        next_run: None,
        last_run: None,
        enabled,
        created_at: row.created_at.to_rfc3339(),
    })))
}

// ─── GET /servers/:server_id/tasks ──────────────────────────────────────

/// List all scheduled tasks for a server.
pub async fn list_tasks(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    let rows = sqlx::query_as!(
        TaskRow,
        "SELECT id, server_id, channel_id, created_by, task_type, config, cron_expr, next_run, last_run, enabled, created_at
         FROM scheduled_tasks
         WHERE server_id = $1
         ORDER BY created_at DESC",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let items: Vec<TaskResponse> = rows.iter().map(row_to_response).collect();
    Ok(Json(items))
}

// ─── DELETE /tasks/:id ──────────────────────────────────────────────────

/// Delete a scheduled task. Only the creator or server owner can delete.
pub async fn delete_task(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let task = sqlx::query!(
        "SELECT id, server_id, created_by FROM scheduled_tasks WHERE id = $1",
        task_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Task not found".into()))?;

    // Only the creator or the server owner can delete
    let is_owner = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2) as "exists!""#,
        task.server_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if task.created_by != auth.user_id && !is_owner {
        return Err(AppError::Forbidden("Only the task creator or server owner can delete this task".into()));
    }

    sqlx::query!("DELETE FROM scheduled_tasks WHERE id = $1", task_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── PATCH /tasks/:id/toggle ────────────────────────────────────────────

/// Toggle a task's enabled state.
pub async fn toggle_task(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let task = sqlx::query!(
        "SELECT id, server_id, created_by FROM scheduled_tasks WHERE id = $1",
        task_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Task not found".into()))?;

    // Verify membership
    require_membership(&state, task.server_id, auth.user_id).await?;

    let row = sqlx::query!(
        "UPDATE scheduled_tasks SET enabled = NOT enabled WHERE id = $1 RETURNING enabled",
        task_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "id": task_id,
        "enabled": row.enabled,
    })))
}
