// discreet_playbook_handlers.rs — Playbooks with step tracking.
//
// Playbooks are reusable checklists (onboarding, incident response, deploys).
// Each step can be assigned to a user and marked complete, which posts a
// notification message in the server's first text channel.
//
// Endpoints:
//   POST   /api/v1/servers/:server_id/playbooks           — Create a playbook
//   GET    /api/v1/servers/:server_id/playbooks            — List playbooks
//   GET    /api/v1/playbooks/:id                           — Get playbook with steps
//   DELETE /api/v1/playbooks/:id                           — Delete a playbook
//   POST   /api/v1/playbooks/:id/steps                    — Add a step
//   PATCH  /api/v1/playbooks/:id/steps/:step_id/complete  — Mark step complete

use axum::{extract::{Path, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

// ─── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreatePlaybookRequest {
    pub name: String,
    pub description: Option<String>,
    /// Optional initial steps to create alongside the playbook.
    pub steps: Option<Vec<CreateStepRequest>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateStepRequest {
    pub title: String,
    pub assignee_id: Option<Uuid>,
    pub position: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct PlaybookResponse {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub description: String,
    pub created_by: Uuid,
    pub created_at: String,
    pub steps: Vec<StepResponse>,
    pub progress: PlaybookProgress,
}

#[derive(Debug, Serialize)]
pub struct StepResponse {
    pub id: Uuid,
    pub position: i32,
    pub title: String,
    pub assignee_id: Option<Uuid>,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub completed_by: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct PlaybookProgress {
    pub total: i64,
    pub completed: i64,
    pub percent: i64,
}

// ─── Helpers ────────────────────────────────────────────────────────────

async fn require_membership(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2) as "exists!""#,
        server_id, user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_member {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }
    Ok(())
}

async fn load_steps(db: &sqlx::PgPool, playbook_id: Uuid) -> Result<Vec<StepResponse>, AppError> {
    let rows = sqlx::query!(
        "SELECT id, position, title, assignee_id, completed, completed_at, completed_by
         FROM playbook_steps WHERE playbook_id = $1 ORDER BY position, created_at",
        playbook_id,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|r| StepResponse {
        id: r.id,
        position: r.position,
        title: r.title,
        assignee_id: r.assignee_id,
        completed: r.completed,
        completed_at: r.completed_at.map(|ts| ts.to_rfc3339()),
        completed_by: r.completed_by,
    }).collect())
}

fn calc_progress(steps: &[StepResponse]) -> PlaybookProgress {
    let total = steps.len() as i64;
    let completed = steps.iter().filter(|s| s.completed).count() as i64;
    let percent = if total > 0 { (completed * 100) / total } else { 0 };
    PlaybookProgress { total, completed, percent }
}

/// Post a system message to the server's first text channel.
async fn post_completion_message(
    db: &sqlx::PgPool,
    state: &Arc<AppState>,
    server_id: Uuid,
    message: &str,
) {
    // Find the first text channel in the server
    let channel_id = sqlx::query_scalar!(
        "SELECT id FROM channels WHERE server_id = $1 AND channel_type = 'text' ORDER BY position, created_at LIMIT 1",
        server_id,
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let Some(channel_id) = channel_id else { return };

    let message_id = Uuid::new_v4();
    let content_bytes = message.as_bytes().to_vec();

    let _ = sqlx::query!(
        "INSERT INTO messages (id, channel_id, author_id, content_ciphertext, mls_epoch)
         VALUES ($1, $2, $3, $4, $5)",
        message_id, channel_id, Uuid::nil(), &content_bytes, 0_i64,
    )
    .execute(db)
    .await;

    state.ws_broadcast(server_id, serde_json::json!({
        "type": "message_create",
        "channel_id": channel_id,
        "message_id": message_id,
        "author_id": Uuid::nil(),
        "content": message,
        "is_system": true,
    })).await;
}

// ─── POST /servers/:server_id/playbooks ─────────────────────────────────

pub async fn create_playbook(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreatePlaybookRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 200 {
        return Err(AppError::BadRequest("Playbook name must be 1-200 characters".into()));
    }
    let description = req.description.unwrap_or_default();
    if description.len() > 2000 {
        return Err(AppError::BadRequest("Description must be 2,000 characters or fewer".into()));
    }

    let row = sqlx::query!(
        "INSERT INTO playbooks (server_id, name, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id, created_at",
        server_id, name, description, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    // Create initial steps if provided
    let mut steps: Vec<StepResponse> = Vec::new();
    if let Some(initial_steps) = req.steps {
        for (i, step) in initial_steps.iter().enumerate() {
            let title = step.title.trim().to_string();
            if title.is_empty() || title.len() > 500 {
                continue;
            }
            let pos = step.position.unwrap_or(i as i32);
            let sr = sqlx::query!(
                "INSERT INTO playbook_steps (playbook_id, position, title, assignee_id)
                 VALUES ($1, $2, $3, $4) RETURNING id, created_at",
                row.id, pos, title, step.assignee_id,
            )
            .fetch_one(&state.db)
            .await?;

            steps.push(StepResponse {
                id: sr.id,
                position: pos,
                title,
                assignee_id: step.assignee_id,
                completed: false,
                completed_at: None,
                completed_by: None,
            });
        }
    }

    let progress = calc_progress(&steps);

    Ok((StatusCode::CREATED, Json(PlaybookResponse {
        id: row.id,
        server_id,
        name,
        description,
        created_by: auth.user_id,
        created_at: row.created_at.to_rfc3339(),
        steps,
        progress,
    })))
}

// ─── GET /servers/:server_id/playbooks ──────────────────────────────────

pub async fn list_playbooks(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    let rows = sqlx::query!(
        "SELECT id, server_id, name, description, created_by, created_at
         FROM playbooks WHERE server_id = $1 ORDER BY created_at DESC",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<PlaybookResponse> = Vec::new();
    for r in &rows {
        let steps = load_steps(&state.db, r.id).await?;
        let progress = calc_progress(&steps);
        result.push(PlaybookResponse {
            id: r.id,
            server_id: r.server_id,
            name: r.name.clone(),
            description: r.description.clone(),
            created_by: r.created_by,
            created_at: r.created_at.to_rfc3339(),
            steps,
            progress,
        });
    }

    Ok(Json(result))
}

// ─── GET /playbooks/:id ─────────────────────────────────────────────────

pub async fn get_playbook(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(playbook_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let pb = sqlx::query!(
        "SELECT id, server_id, name, description, created_by, created_at
         FROM playbooks WHERE id = $1",
        playbook_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Playbook not found".into()))?;

    require_membership(&state, pb.server_id, auth.user_id).await?;

    let steps = load_steps(&state.db, pb.id).await?;
    let progress = calc_progress(&steps);

    Ok(Json(PlaybookResponse {
        id: pb.id,
        server_id: pb.server_id,
        name: pb.name,
        description: pb.description.clone(),
        created_by: pb.created_by,
        created_at: pb.created_at.to_rfc3339(),
        steps,
        progress,
    }))
}

// ─── DELETE /playbooks/:id ──────────────────────────────────────────────

pub async fn delete_playbook(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(playbook_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let pb = sqlx::query!(
        "SELECT server_id, created_by FROM playbooks WHERE id = $1",
        playbook_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Playbook not found".into()))?;

    // Only creator or server owner can delete
    let is_owner = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2) as "exists!""#,
        pb.server_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if pb.created_by != auth.user_id && !is_owner {
        return Err(AppError::Forbidden("Only the creator or server owner can delete this playbook".into()));
    }

    sqlx::query!("DELETE FROM playbooks WHERE id = $1", playbook_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /playbooks/:id/steps ──────────────────────────────────────────

pub async fn add_step(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(playbook_id): Path<Uuid>,
    Json(req): Json<CreateStepRequest>,
) -> Result<impl IntoResponse, AppError> {
    let pb = sqlx::query!(
        "SELECT server_id FROM playbooks WHERE id = $1",
        playbook_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Playbook not found".into()))?;

    require_membership(&state, pb.server_id, auth.user_id).await?;

    let title = req.title.trim().to_string();
    if title.is_empty() || title.len() > 500 {
        return Err(AppError::BadRequest("Step title must be 1-500 characters".into()));
    }

    // Auto-position: next after the last step
    let max_pos = sqlx::query_scalar!(
        r#"SELECT COALESCE(MAX(position), -1) as "max!" FROM playbook_steps WHERE playbook_id = $1"#,
        playbook_id,
    )
    .fetch_one(&state.db)
    .await?;

    let position = req.position.unwrap_or(max_pos + 1);

    let row = sqlx::query!(
        "INSERT INTO playbook_steps (playbook_id, position, title, assignee_id)
         VALUES ($1, $2, $3, $4) RETURNING id",
        playbook_id, position, title, req.assignee_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(StepResponse {
        id: row.id,
        position,
        title,
        assignee_id: req.assignee_id,
        completed: false,
        completed_at: None,
        completed_by: None,
    })))
}

// ─── PATCH /playbooks/:id/steps/:step_id/complete ───────────────────────

pub async fn complete_step(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((playbook_id, step_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let pb = sqlx::query!(
        "SELECT server_id, name FROM playbooks WHERE id = $1",
        playbook_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Playbook not found".into()))?;

    require_membership(&state, pb.server_id, auth.user_id).await?;

    // Toggle completion: if already completed, uncomplete; otherwise complete.
    let step = sqlx::query!(
        "SELECT id, title, completed FROM playbook_steps WHERE id = $1 AND playbook_id = $2",
        step_id, playbook_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Step not found".into()))?;

    let now_completed = !step.completed;

    if now_completed {
        sqlx::query!(
            "UPDATE playbook_steps SET completed = TRUE, completed_at = NOW(), completed_by = $1 WHERE id = $2",
            auth.user_id, step_id,
        )
        .execute(&state.db)
        .await?;

        // Get username for the notification message
        let username = sqlx::query_scalar!(
            "SELECT username FROM users WHERE id = $1",
            auth.user_id,
        )
        .fetch_optional(&state.db)
        .await?
        .unwrap_or_else(|| "Someone".to_string());

        // Post completion message
        let msg = format!("[Complete] @{} finished step: {} in {}", username, step.title, pb.name);
        post_completion_message(&state.db, &state, pb.server_id, &msg).await;
    } else {
        sqlx::query!(
            "UPDATE playbook_steps SET completed = FALSE, completed_at = NULL, completed_by = NULL WHERE id = $1",
            step_id,
        )
        .execute(&state.db)
        .await?;
    }

    // Return updated progress
    let steps = load_steps(&state.db, playbook_id).await?;
    let progress = calc_progress(&steps);

    Ok(Json(serde_json::json!({
        "step_id": step_id,
        "completed": now_completed,
        "progress": progress,
    })))
}
