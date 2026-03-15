// discreet_channel_category_handlers.rs — User-level channel categories (custom folders).
//
// Endpoints:
//   GET    /api/v1/servers/:server_id/channel-categories       — List user's categories
//   POST   /api/v1/servers/:server_id/channel-categories       — Create a category
//   PATCH  /api/v1/channel-categories/:id                      — Rename / reposition / toggle
//   DELETE /api/v1/channel-categories/:id                      — Delete a category
//   PUT    /api/v1/channel-categories/:id/channels/:channel_id — Add channel to category
//   DELETE /api/v1/channel-categories/:id/channels/:channel_id — Remove channel from category

use axum::{extract::{Path, State, Json}, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use crate::{citadel_auth::AuthUser, citadel_error::AppError, citadel_state::AppState};

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub position: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCategoryRequest {
    pub name: Option<String>,
    pub position: Option<i32>,
    pub collapsed: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct CategoryResponse {
    pub id: Uuid,
    pub name: String,
    pub position: i32,
    pub collapsed: bool,
    pub channel_ids: Vec<Uuid>,
}

/// GET /servers/:server_id/channel-categories
pub async fn list_categories(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let cats = sqlx::query!(
        "SELECT id, name, position, collapsed FROM channel_categories
         WHERE user_id = $1 AND server_id = $2
         ORDER BY position, created_at",
        auth.user_id,
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let mut result: Vec<CategoryResponse> = Vec::new();
    for cat in &cats {
        let channel_ids: Vec<Uuid> = sqlx::query_scalar!(
            "SELECT channel_id FROM channel_category_items
             WHERE category_id = $1
             ORDER BY position",
            cat.id,
        )
        .fetch_all(&state.db)
        .await?;

        result.push(CategoryResponse {
            id: cat.id,
            name: cat.name.clone(),
            position: cat.position,
            collapsed: cat.collapsed,
            channel_ids,
        });
    }

    Ok(Json(result))
}

/// POST /servers/:server_id/channel-categories
pub async fn create_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<impl IntoResponse, AppError> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 64 {
        return Err(AppError::BadRequest("Category name must be 1-64 characters".into()));
    }

    let position = req.position.unwrap_or(0);

    let row = sqlx::query!(
        "INSERT INTO channel_categories (user_id, server_id, name, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
        auth.user_id,
        server_id,
        name,
        position,
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(CategoryResponse {
        id: row.id,
        name,
        position,
        collapsed: false,
        channel_ids: vec![],
    })))
}

/// PATCH /channel-categories/:id
pub async fn update_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(cat_id): Path<Uuid>,
    Json(req): Json<UpdateCategoryRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Verify ownership
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM channel_categories WHERE id = $1 AND user_id = $2) as "exists!""#,
        cat_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !exists {
        return Err(AppError::NotFound("Category not found".into()));
    }

    if let Some(ref name) = req.name {
        let name = name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::BadRequest("Category name must be 1-64 characters".into()));
        }
        sqlx::query!("UPDATE channel_categories SET name = $1 WHERE id = $2", name, cat_id)
            .execute(&state.db).await?;
    }
    if let Some(pos) = req.position {
        sqlx::query!("UPDATE channel_categories SET position = $1 WHERE id = $2", pos, cat_id)
            .execute(&state.db).await?;
    }
    if let Some(collapsed) = req.collapsed {
        sqlx::query!("UPDATE channel_categories SET collapsed = $1 WHERE id = $2", collapsed, cat_id)
            .execute(&state.db).await?;
    }

    Ok(Json(serde_json::json!({ "id": cat_id, "updated": true })))
}

/// DELETE /channel-categories/:id
pub async fn delete_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(cat_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "DELETE FROM channel_categories WHERE id = $1 AND user_id = $2",
        cat_id, auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Category not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /channel-categories/:id/channels/:channel_id
pub async fn add_channel_to_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((cat_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    // Verify category belongs to user
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM channel_categories WHERE id = $1 AND user_id = $2) as "exists!""#,
        cat_id, auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !exists {
        return Err(AppError::NotFound("Category not found".into()));
    }

    // Remove from any other category this user has (a channel can only be in one user-category)
    sqlx::query!(
        "DELETE FROM channel_category_items WHERE channel_id = $1
         AND category_id IN (SELECT id FROM channel_categories WHERE user_id = $2)",
        channel_id, auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Get next position
    let max_pos = sqlx::query_scalar!(
        r#"SELECT COALESCE(MAX(position), 0) as "max!" FROM channel_category_items WHERE category_id = $1"#,
        cat_id,
    )
    .fetch_one(&state.db)
    .await?;

    sqlx::query!(
        "INSERT INTO channel_category_items (category_id, channel_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (category_id, channel_id) DO UPDATE SET position = $3",
        cat_id, channel_id, max_pos + 1,
    )
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /channel-categories/:id/channels/:channel_id
pub async fn remove_channel_from_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((cat_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!(
        "DELETE FROM channel_category_items
         WHERE category_id = $1 AND channel_id = $2
           AND category_id IN (SELECT id FROM channel_categories WHERE user_id = $3)",
        cat_id, channel_id, auth.user_id,
    )
    .execute(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
