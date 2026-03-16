// discreet_group_dm_handlers.rs — Zero-knowledge group direct messages.
//
// ZERO-KNOWLEDGE DESIGN:
// Group DM messages are encrypted client-side. Server stores only ciphertext.
//
// Group DMs can have 2-10 members with an optional name/icon.
// The creator is the owner and can add/remove members.
//
// Endpoints:
//   POST   /api/v1/group-dms                     — Create group DM
//   GET    /api/v1/group-dms                     — List my group DMs
//   GET    /api/v1/group-dms/:id/messages        — Get message history
//   POST   /api/v1/group-dms/:id/messages        — Send encrypted message
//   POST   /api/v1/group-dms/:id/members         — Add member
//   DELETE /api/v1/group-dms/:id/members/:uid     — Remove member / leave
//   PATCH  /api/v1/group-dms/:id                  — Update name/icon

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
pub struct CreateGroupDmRequest {
    pub name: Option<String>,
    pub member_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub user_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct SendGroupDmRequest {
    pub content_ciphertext: String,
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupDmRequest {
    pub name: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GroupDmInfo {
    pub id: Uuid,
    pub name: Option<String>,
    pub owner_id: Uuid,
    pub icon_url: Option<String>,
    pub members: Vec<GroupDmMemberInfo>,
    pub created_at: String,
    pub last_message_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GroupDmMemberInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GroupDmMessageInfo {
    pub id: Uuid,
    pub group_dm_id: Uuid,
    pub sender_id: Uuid,
    pub sender_username: String,
    pub content_ciphertext: String,
    pub reply_to_id: Option<Uuid>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub limit: Option<i64>,
    pub before: Option<String>,
}

// ─── POST /api/v1/group-dms ───────────────────────────────────────────

pub async fn create_group_dm(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<CreateGroupDmRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.member_ids.is_empty() {
        return Err(AppError::BadRequest("Must include at least one other member".into()));
    }
    if req.member_ids.len() > 9 {
        return Err(AppError::BadRequest("Group DMs can have at most 10 members".into()));
    }
    if req.member_ids.contains(&auth.user_id) {
        return Err(AppError::BadRequest("Don't include yourself in member_ids".into()));
    }

    let name = req.name.as_deref().map(|n| n.trim()).filter(|n| !n.is_empty());

    let group = sqlx::query!(
        "INSERT INTO group_dm_channels (name, owner_id) VALUES ($1, $2) RETURNING id, created_at",
        name,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    // Add creator as member.
    sqlx::query!(
        "INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2)",
        group.id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Add other members.
    for uid in &req.member_ids {
        sqlx::query!(
            "INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            group.id,
            uid,
        )
        .execute(&state.db)
        .await?;
    }

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": group.id,
        "name": name,
        "owner_id": auth.user_id,
        "created_at": group.created_at.to_rfc3339(),
    }))))
}

// ─── GET /api/v1/group-dms ────────────────────────────────────────────

pub async fn list_group_dms(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"SELECT g.id, g.name, g.owner_id, g.icon_url, g.created_at,
           (SELECT MAX(m.created_at) FROM group_dm_messages m WHERE m.group_dm_id = g.id) as last_message_at
           FROM group_dm_channels g
           JOIN group_dm_members gm ON gm.group_dm_id = g.id
           WHERE gm.user_id = $1
           ORDER BY COALESCE((SELECT MAX(m.created_at) FROM group_dm_messages m WHERE m.group_dm_id = g.id), g.created_at) DESC"#,
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let mut result = Vec::new();
    for row in rows {
        let members = sqlx::query!(
            r#"SELECT u.id as user_id, u.username, u.display_name, u.avatar_url
               FROM group_dm_members gm
               JOIN users u ON u.id = gm.user_id
               WHERE gm.group_dm_id = $1"#,
            row.id,
        )
        .fetch_all(&state.db)
        .await?;

        result.push(GroupDmInfo {
            id: row.id,
            name: row.name,
            owner_id: row.owner_id,
            icon_url: row.icon_url,
            members: members.iter().map(|m| GroupDmMemberInfo {
                user_id: m.user_id,
                username: m.username.clone(),
                display_name: m.display_name.clone(),
                avatar_url: m.avatar_url.clone(),
            }).collect(),
            created_at: row.created_at.to_rfc3339(),
            last_message_at: row.last_message_at.map(|t| t.to_rfc3339()),
        });
    }

    Ok(Json(result))
}

// ─── POST /api/v1/group-dms/:id/messages ──────────────────────────────

pub async fn send_group_dm(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
    Json(req): Json<SendGroupDmRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Verify membership.
    let is_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE group_dm_id = $1 AND user_id = $2)",
        group_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_member.unwrap_or(false) {
        return Err(AppError::Forbidden("Not a member of this group DM".into()));
    }

    let ct = base64_decode(&req.content_ciphertext)?;

    let msg = sqlx::query!(
        "INSERT INTO group_dm_messages (group_dm_id, sender_id, content_ciphertext, reply_to_id) VALUES ($1, $2, $3, $4) RETURNING id, created_at",
        group_id,
        auth.user_id,
        ct,
        req.reply_to_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": msg.id,
        "group_dm_id": group_id,
        "sender_id": auth.user_id,
        "created_at": msg.created_at.to_rfc3339(),
    }))))
}

// ─── GET /api/v1/group-dms/:id/messages ───────────────────────────────

pub async fn get_group_dm_messages(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> Result<impl IntoResponse, AppError> {
    let is_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE group_dm_id = $1 AND user_id = $2)",
        group_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_member.unwrap_or(false) {
        return Err(AppError::Forbidden("Not a member of this group DM".into()));
    }

    let limit = params.limit.unwrap_or(50).min(100);

    let result: Vec<GroupDmMessageInfo> = if let Some(ref before) = params.before {
        let before_ts = before.parse::<chrono::DateTime<chrono::Utc>>()
            .map_err(|_| AppError::BadRequest("Invalid before timestamp".into()))?;
        sqlx::query!(
            r#"SELECT m.id, m.group_dm_id, m.sender_id, u.username as sender_username,
               encode(m.content_ciphertext, 'base64') as "content_ciphertext!",
               m.reply_to_id, m.created_at
               FROM group_dm_messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.group_dm_id = $1 AND m.created_at < $2
               ORDER BY m.created_at DESC
               LIMIT $3"#,
            group_id,
            before_ts,
            limit,
        )
        .fetch_all(&state.db)
        .await?
        .iter()
        .map(|m| GroupDmMessageInfo {
            id: m.id, group_dm_id: m.group_dm_id, sender_id: m.sender_id,
            sender_username: m.sender_username.clone(),
            content_ciphertext: m.content_ciphertext.clone(),
            reply_to_id: m.reply_to_id, created_at: m.created_at.to_rfc3339(),
        })
        .collect()
    } else {
        sqlx::query!(
            r#"SELECT m.id, m.group_dm_id, m.sender_id, u.username as sender_username,
               encode(m.content_ciphertext, 'base64') as "content_ciphertext!",
               m.reply_to_id, m.created_at
               FROM group_dm_messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.group_dm_id = $1
               ORDER BY m.created_at DESC
               LIMIT $2"#,
            group_id,
            limit,
        )
        .fetch_all(&state.db)
        .await?
        .iter()
        .map(|m| GroupDmMessageInfo {
            id: m.id, group_dm_id: m.group_dm_id, sender_id: m.sender_id,
            sender_username: m.sender_username.clone(),
            content_ciphertext: m.content_ciphertext.clone(),
            reply_to_id: m.reply_to_id, created_at: m.created_at.to_rfc3339(),
        })
        .collect()
    };

    Ok(Json(result))
}

// ─── POST /api/v1/group-dms/:id/members ───────────────────────────────

pub async fn add_group_dm_member(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
    Json(req): Json<AddMemberRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Only owner can add members.
    let owner_id = sqlx::query_scalar!(
        "SELECT owner_id FROM group_dm_channels WHERE id = $1",
        group_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Group DM not found".into()))?;

    if owner_id != auth.user_id {
        return Err(AppError::Forbidden("Only the owner can add members".into()));
    }

    // Check member count.
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM group_dm_members WHERE group_dm_id = $1",
        group_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    if count >= 10 {
        return Err(AppError::BadRequest("Group DM is full (max 10 members)".into()));
    }

    sqlx::query!(
        "INSERT INTO group_dm_members (group_dm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        group_id,
        req.user_id,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "message": "Member added" })))
}

// ─── DELETE /api/v1/group-dms/:id/members/:uid ────────────────────────

pub async fn remove_group_dm_member(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path((group_id, target_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, AppError> {
    let owner_id = sqlx::query_scalar!(
        "SELECT owner_id FROM group_dm_channels WHERE id = $1",
        group_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Group DM not found".into()))?;

    // Owner can remove anyone. Non-owners can only remove themselves (leave).
    if target_id != auth.user_id && owner_id != auth.user_id {
        return Err(AppError::Forbidden("Only the owner can remove other members".into()));
    }

    sqlx::query!(
        "DELETE FROM group_dm_members WHERE group_dm_id = $1 AND user_id = $2",
        group_id,
        target_id,
    )
    .execute(&state.db)
    .await?;

    // If owner leaves, transfer to next member or delete group.
    if target_id == owner_id {
        let next = sqlx::query_scalar!(
            "SELECT user_id FROM group_dm_members WHERE group_dm_id = $1 ORDER BY joined_at LIMIT 1",
            group_id,
        )
        .fetch_optional(&state.db)
        .await?;

        match next {
            Some(new_owner) => {
                sqlx::query!(
                    "UPDATE group_dm_channels SET owner_id = $1 WHERE id = $2",
                    new_owner,
                    group_id,
                )
                .execute(&state.db)
                .await?;
            }
            None => {
                // No members left — delete the group.
                sqlx::query!("DELETE FROM group_dm_channels WHERE id = $1", group_id)
                    .execute(&state.db)
                    .await?;
            }
        }
    }

    Ok(Json(serde_json::json!({ "message": "Member removed" })))
}

// ─── PATCH /api/v1/group-dms/:id ──────────────────────────────────────

pub async fn update_group_dm(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Path(group_id): Path<Uuid>,
    Json(req): Json<UpdateGroupDmRequest>,
) -> Result<impl IntoResponse, AppError> {
    let owner_id = sqlx::query_scalar!(
        "SELECT owner_id FROM group_dm_channels WHERE id = $1",
        group_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Group DM not found".into()))?;

    if owner_id != auth.user_id {
        return Err(AppError::Forbidden("Only the owner can update this group DM".into()));
    }

    if let Some(ref name) = req.name {
        let trimmed = name.trim();
        if trimmed.len() > 100 {
            return Err(AppError::BadRequest("Name too long (max 100 chars)".into()));
        }
        sqlx::query!(
            "UPDATE group_dm_channels SET name = $1 WHERE id = $2",
            if trimmed.is_empty() { None } else { Some(trimmed) },
            group_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref icon_url) = req.icon_url {
        sqlx::query!(
            "UPDATE group_dm_channels SET icon_url = $1 WHERE id = $2",
            if icon_url.is_empty() { None } else { Some(icon_url.as_str()) },
            group_id,
        )
        .execute(&state.db)
        .await?;
    }

    Ok(Json(serde_json::json!({ "message": "Group DM updated" })))
}

// ─── Helpers ──────────────────────────────────────────────────────────

fn base64_decode(s: &str) -> Result<Vec<u8>, AppError> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| AppError::BadRequest("Invalid base64".into()))
}
