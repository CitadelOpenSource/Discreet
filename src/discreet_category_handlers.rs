// discreet_category_handlers.rs — community-style channel categories.
//
// Categories are server-scoped and used to visually group channels.
//
// Endpoints:
//   POST   /api/v1/servers/:server_id/categories                 — Create category
//   GET    /api/v1/servers/:server_id/categories                 — List categories with channels
//   PATCH  /api/v1/servers/:server_id/categories/:id             — Update category
//   DELETE /api/v1/servers/:server_id/categories/:id             — Delete category
//   PATCH  /api/v1/servers/:server_id/channels/:id/move          — Move channel to category

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_permissions::{require_permission, PERM_MANAGE_CHANNELS, PERM_VIEW_CHANNEL};
use crate::discreet_state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub position: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCategoryRequest {
    pub name: Option<String>,
    pub position: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct MoveChannelRequest {
    pub category_id: Option<Uuid>,
    pub position: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct ChannelCategoryInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub position: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct CategoryChannelInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub category_id: Option<Uuid>,
    pub name: String,
    pub topic: Option<String>,
    pub channel_type: String,
    pub position: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct CategoryWithChannels {
    pub category: ChannelCategoryInfo,
    pub channels: Vec<CategoryChannelInfo>,
}

#[derive(Debug, Serialize)]
pub struct CategoriesListResponse {
    pub categories: Vec<CategoryWithChannels>,
    pub uncategorized_channels: Vec<CategoryChannelInfo>,
}

pub async fn create_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 128 {
        return Err(AppError::BadRequest(
            "Category name must be 1-128 characters".into(),
        ));
    }

    let position = if let Some(position) = req.position {
        position
    } else {
        let max_pos = sqlx::query_scalar!(
            "SELECT COALESCE(MAX(position), -1) FROM channel_categories WHERE server_id = $1",
            server_id,
        )
        .fetch_one(&state.db)
        .await?;

        max_pos.unwrap_or(-1) + 1
    };

    let category_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO channel_categories (id, server_id, name, position)
         VALUES ($1, $2, $3, $4)",
        category_id,
        server_id,
        name,
        position,
    )
    .execute(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(ChannelCategoryInfo {
            id: category_id,
            server_id,
            name,
            position,
            created_at: chrono::Utc::now().to_rfc3339(),
        }),
    ))
}

pub async fn list_categories(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, PERM_VIEW_CHANNEL).await?;

    let category_rows = sqlx::query!(
        "SELECT id, server_id, name, position, created_at
         FROM channel_categories
         WHERE server_id = $1
         ORDER BY position, created_at",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let channel_rows = sqlx::query!(
        "SELECT id, server_id, category_id, name, topic, channel_type, position, created_at
         FROM channels
         WHERE server_id = $1
         ORDER BY category_id NULLS LAST, position, created_at",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let mut channel_map: HashMap<Uuid, Vec<CategoryChannelInfo>> = HashMap::new();
    let mut uncategorized_channels = Vec::new();

    for row in channel_rows {
        let channel = CategoryChannelInfo {
            id: row.id,
            server_id: row.server_id,
            category_id: row.category_id,
            name: row.name,
            topic: row.topic,
            channel_type: row.channel_type,
            position: row.position,
            created_at: row.created_at.to_rfc3339(),
        };

        if let Some(category_id) = row.category_id {
            channel_map.entry(category_id).or_default().push(channel);
        } else {
            uncategorized_channels.push(channel);
        }
    }

    let categories = category_rows
        .into_iter()
        .map(|row| CategoryWithChannels {
            category: ChannelCategoryInfo {
                id: row.id,
                server_id: row.server_id,
                name: row.name,
                position: row.position,
                created_at: row.created_at.to_rfc3339(),
            },
            channels: channel_map.remove(&row.id).unwrap_or_default(),
        })
        .collect();

    Ok(Json(CategoriesListResponse {
        categories,
        uncategorized_channels,
    }))
}

pub async fn update_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, category_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateCategoryRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    let existing = sqlx::query!(
        "SELECT id FROM channel_categories WHERE id = $1 AND server_id = $2",
        category_id,
        server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Category not found".into()))?;

    if let Some(ref name) = req.name {
        let name = name.trim();
        if name.is_empty() || name.len() > 128 {
            return Err(AppError::BadRequest(
                "Category name must be 1-128 characters".into(),
            ));
        }
        sqlx::query!(
            "UPDATE channel_categories SET name = $1 WHERE id = $2",
            name,
            existing.id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(position) = req.position {
        sqlx::query!(
            "UPDATE channel_categories SET position = $1 WHERE id = $2",
            position,
            existing.id,
        )
        .execute(&state.db)
        .await?;
    }

    let updated = sqlx::query!(
        "SELECT id, server_id, name, position, created_at
         FROM channel_categories
         WHERE id = $1",
        existing.id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ChannelCategoryInfo {
        id: updated.id,
        server_id: updated.server_id,
        name: updated.name,
        position: updated.position,
        created_at: updated.created_at.to_rfc3339(),
    }))
}

pub async fn delete_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, category_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    let deleted = sqlx::query!(
        "DELETE FROM channel_categories
         WHERE id = $1 AND server_id = $2
         RETURNING id",
        category_id,
        server_id,
    )
    .fetch_optional(&state.db)
    .await?;

    if deleted.is_none() {
        return Err(AppError::NotFound("Category not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn move_channel_to_category(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<MoveChannelRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_permission(&state, server_id, auth.user_id, PERM_MANAGE_CHANNELS).await?;

    let channel = sqlx::query!(
        "SELECT id FROM channels WHERE id = $1 AND server_id = $2",
        channel_id,
        server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    if let Some(category_id) = req.category_id {
        let category_exists = sqlx::query_scalar!(
            "SELECT EXISTS(
                SELECT 1 FROM channel_categories
                WHERE id = $1 AND server_id = $2
            )",
            category_id,
            server_id,
        )
        .fetch_one(&state.db)
        .await?
        .unwrap_or(false);

        if !category_exists {
            return Err(AppError::NotFound("Category not found".into()));
        }
    }

    let position = if let Some(position) = req.position {
        position
    } else {
        let max_pos = sqlx::query_scalar!(
            "SELECT COALESCE(MAX(position), -1)
             FROM channels
             WHERE server_id = $1
               AND ((category_id IS NULL AND $2::uuid IS NULL) OR category_id = $2)",
            server_id,
            req.category_id,
        )
        .fetch_one(&state.db)
        .await?;

        max_pos.unwrap_or(-1) + 1
    };

    sqlx::query!(
        "UPDATE channels
         SET category_id = $1, position = $2, updated_at = NOW()
         WHERE id = $3",
        req.category_id,
        position,
        channel.id,
    )
    .execute(&state.db)
    .await?;

    let updated = sqlx::query!(
        "SELECT id, server_id, category_id, name, topic, channel_type, position, created_at
         FROM channels
         WHERE id = $1",
        channel.id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(CategoryChannelInfo {
        id: updated.id,
        server_id: updated.server_id,
        category_id: updated.category_id,
        name: updated.name,
        topic: updated.topic,
        channel_type: updated.channel_type,
        position: updated.position,
        created_at: updated.created_at.to_rfc3339(),
    }))
}
