// discreet_discovery_handlers.rs — Server discovery / explore.
//
// Public servers can be browsed without an invite. Think competitor
// server discovery but for E2EE communities.
//
// Endpoints:
//   GET  /api/v1/discover              — Browse public servers
//   POST /api/v1/servers/:id/publish   — Make server public
//   POST /api/v1/servers/:id/unpublish — Make server private

use axum::{extract::{Path, Query, State, Json}, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

#[derive(Debug, Deserialize)]
pub struct DiscoverQuery {
    pub category: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PublishRequest {
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct PublicServer {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub member_count: i32,
    pub created_at: String,
}

// ─── GET /discover ─────────────────────────────────────────────────────

pub async fn discover_servers(
    _auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Query(q): Query<DiscoverQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = q.limit.unwrap_or(50).min(100);

    let servers = if let Some(ref search) = q.search {
        let pattern = format!("%{}%", search.to_lowercase());
        sqlx::query_as!(
            PublicServerRow,
            r#"SELECT id, name, description, icon_url, banner_url, category, tags, member_count, created_at
               FROM servers WHERE is_public = TRUE AND (LOWER(name) LIKE $1 OR LOWER(description) LIKE $1)
               ORDER BY featured DESC, member_count DESC LIMIT $2"#,
            pattern, limit,
        ).fetch_all(&state.db).await?
    } else if let Some(ref cat) = q.category {
        sqlx::query_as!(
            PublicServerRow,
            r#"SELECT id, name, description, icon_url, banner_url, category, tags, member_count, created_at
               FROM servers WHERE is_public = TRUE AND category = $1
               ORDER BY featured DESC, member_count DESC LIMIT $2"#,
            cat, limit,
        ).fetch_all(&state.db).await?
    } else {
        sqlx::query_as!(
            PublicServerRow,
            r#"SELECT id, name, description, icon_url, banner_url, category, tags, member_count, created_at
               FROM servers WHERE is_public = TRUE
               ORDER BY featured DESC, member_count DESC LIMIT $1"#,
            limit,
        ).fetch_all(&state.db).await?
    };

    let result: Vec<PublicServer> = servers.iter().map(|s| PublicServer {
        id: s.id, name: s.name.clone(),
        description: s.description.clone(), icon_url: s.icon_url.clone(),
        banner_url: s.banner_url.clone(), category: s.category.clone(),
        tags: s.tags.clone().unwrap_or_default(), member_count: s.member_count,
        created_at: s.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(result))
}

// ─── POST /servers/:id/publish ─────────────────────────────────────────

pub async fn publish_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<PublishRequest>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only the server owner can publish".into()));
    }

    // Update member count
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM server_members WHERE server_id = $1",
        server_id,
    ).fetch_one(&state.db).await?.unwrap_or(0);

    let tags = req.tags.unwrap_or_default();

    sqlx::query!(
        "UPDATE servers SET is_public = TRUE, category = $1, tags = $2, member_count = $3 WHERE id = $4",
        req.category, &tags, count as i32, server_id,
    ).execute(&state.db).await?;

    Ok(Json(serde_json::json!({ "message": "Server published to discovery" })))
}

// ─── POST /servers/:id/unpublish ───────────────────────────────────────

pub async fn unpublish_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, auth.user_id,
    ).fetch_one(&state.db).await?.unwrap_or(false);

    if !is_owner {
        return Err(AppError::Forbidden("Only the server owner can unpublish".into()));
    }

    sqlx::query!("UPDATE servers SET is_public = FALSE WHERE id = $1", server_id)
        .execute(&state.db).await?;

    Ok(Json(serde_json::json!({ "message": "Server removed from discovery" })))
}

// ─── Internal Row Type ─────────────────────────────────────────────────

struct PublicServerRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    icon_url: Option<String>,
    banner_url: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
    member_count: i32,
    created_at: chrono::DateTime<chrono::Utc>,
}
