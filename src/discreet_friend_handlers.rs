// discreet_friend_handlers.rs — Friends system for Discreet.
//
// Endpoints:
//   POST /friends/request           — Send friend request (by username)
//   GET  /friends                   — List accepted friends
//   GET  /friends/requests          — List pending incoming requests
//   GET  /friends/outgoing          — List pending outgoing requests
//   POST /friends/:id/accept        — Accept a friend request
//   POST /friends/:id/decline       — Decline a friend request
//   DELETE /friends/:id             — Remove a friend
//   POST /users/:id/block           — Block a user
//   DELETE /users/:id/block         — Unblock a user
//   GET /users/search               — Search users by username

use std::sync::Arc;
use axum::{extract::{Path, Query, State}, response::IntoResponse, Json};
use hyper::StatusCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ── Request/Response Types ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct FriendRequestBody {
    pub username: String,
}

#[derive(Deserialize)]
pub struct UserSearchQuery {
    pub q: String,
}

#[derive(Serialize)]
pub struct FriendInfo {
    pub friendship_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub status: String,
    pub since: String,
}

#[derive(Serialize)]
pub struct UserSearchResult {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

// ── POST /friends/request ───────────────────────────────────────────────

pub async fn send_friend_request(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<FriendRequestBody>,
) -> Result<impl IntoResponse, AppError> {
    // Guests cannot send friend requests.
    let is_guest = sqlx::query_scalar!(
        "SELECT is_guest FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if is_guest {
        return Err(AppError::Forbidden("Guests cannot send friend requests. Register an account first (Settings → Profile → Upgrade).".into()));
    }

    let username = req.username.trim().to_lowercase();
    if username.is_empty() {
        return Err(AppError::BadRequest("Username cannot be empty".into()));
    }

    // Find target user.
    let target = sqlx::query!(
        "SELECT id FROM users WHERE LOWER(username) = $1",
        username,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    if target.id == auth.user_id {
        return Err(AppError::BadRequest("Cannot friend yourself".into()));
    }

    // Check if a friendship/block already exists in either direction.
    let existing = sqlx::query!(
        "SELECT id, status, user_id, friend_id FROM friendships
         WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
        auth.user_id,
        target.id,
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some(row) = existing {
        return match row.status.as_str() {
            "accepted" => Err(AppError::BadRequest("Already friends".into())),
            "pending" if row.user_id == auth.user_id => {
                Err(AppError::BadRequest("Request already sent".into()))
            }
            "pending" => {
                // They already sent us a request — auto-accept!
                sqlx::query!(
                    "UPDATE friendships SET status = 'accepted', updated_at = now() WHERE id = $1",
                    row.id,
                )
                .execute(&state.db)
                .await?;
                Ok((StatusCode::OK, Json(serde_json::json!({
                    "message": "Friend request accepted (they had already sent you one)",
                    "status": "accepted"
                }))))
            }
            "blocked" if row.user_id == target.id => {
                Err(AppError::BadRequest("Cannot send request to this user".into()))
            }
            "blocked" => {
                Err(AppError::BadRequest("You have this user blocked. Unblock first.".into()))
            }
            _ => Err(AppError::BadRequest("Unexpected friendship state".into())),
        };
    }

    // Create new pending request.
    let id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO friendships (id, user_id, friend_id, status)
         VALUES ($1, $2, $3, 'pending')",
        id,
        auth.user_id,
        target.id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        from = %auth.user_id,
        to = %target.id,
        "Friend request sent"
    );

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "message": "Friend request sent",
        "friendship_id": id,
        "status": "pending"
    }))))
}

// ── GET /friends ────────────────────────────────────────────────────────

pub async fn list_friends(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        r#"SELECT f.id as friendship_id, f.created_at,
           CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END as "friend_id!",
           u.username, u.display_name, u.avatar_url
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
         WHERE f.status = 'accepted'
           AND (f.user_id = $1 OR f.friend_id = $1)
         ORDER BY u.username"#,
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let friends: Vec<FriendInfo> = rows.into_iter().map(|r| FriendInfo {
        friendship_id: r.friendship_id,
        user_id: r.friend_id,
        username: r.username,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        status: "accepted".into(),
        since: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(friends))
}

// ── GET /friends/requests ───────────────────────────────────────────────

pub async fn list_incoming_requests(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT f.id as friendship_id, f.user_id, f.created_at,
           u.username, u.display_name, u.avatar_url
         FROM friendships f
         JOIN users u ON u.id = f.user_id
         WHERE f.friend_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let requests: Vec<FriendInfo> = rows.into_iter().map(|r| FriendInfo {
        friendship_id: r.friendship_id,
        user_id: r.user_id,
        username: r.username,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        status: "pending".into(),
        since: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(requests))
}

// ── GET /friends/outgoing ───────────────────────────────────────────────

pub async fn list_outgoing_requests(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT f.id as friendship_id, f.friend_id, f.created_at,
           u.username, u.display_name, u.avatar_url
         FROM friendships f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let requests: Vec<FriendInfo> = rows.into_iter().map(|r| FriendInfo {
        friendship_id: r.friendship_id,
        user_id: r.friend_id,
        username: r.username,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        status: "pending_outgoing".into(),
        since: r.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(requests))
}

// ── POST /friends/:id/accept ────────────────────────────────────────────

pub async fn accept_friend_request(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(friendship_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "UPDATE friendships SET status = 'accepted', updated_at = now()
         WHERE id = $1 AND friend_id = $2 AND status = 'pending'",
        friendship_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("No pending request found".into()));
    }

    Ok(Json(serde_json::json!({ "message": "Friend request accepted" })))
}

// ── POST /friends/:id/decline ───────────────────────────────────────────

pub async fn decline_friend_request(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(friendship_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "DELETE FROM friendships
         WHERE id = $1 AND friend_id = $2 AND status = 'pending'",
        friendship_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("No pending request found".into()));
    }

    Ok(Json(serde_json::json!({ "message": "Friend request declined" })))
}

// ── DELETE /friends/:id ─────────────────────────────────────────────────

pub async fn remove_friend(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(friendship_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "DELETE FROM friendships
         WHERE id = $1 AND status = 'accepted'
           AND (user_id = $2 OR friend_id = $2)",
        friendship_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Friendship not found".into()));
    }

    Ok(Json(serde_json::json!({ "message": "Friend removed" })))
}

// ── POST /users/:id/block ───────────────────────────────────────────────

pub async fn block_user(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(target_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    if target_id == auth.user_id {
        return Err(AppError::BadRequest("Cannot block yourself".into()));
    }

    // Remove any existing friendship first.
    sqlx::query!(
        "DELETE FROM friendships
         WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
        auth.user_id,
        target_id,
    )
    .execute(&state.db)
    .await?;

    // Create block entry.
    sqlx::query!(
        "INSERT INTO friendships (id, user_id, friend_id, status)
         VALUES ($1, $2, $3, 'blocked')
         ON CONFLICT (user_id, friend_id) DO UPDATE SET status = 'blocked', updated_at = now()",
        Uuid::new_v4(),
        auth.user_id,
        target_id,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "message": "User blocked" })))
}

// ── DELETE /users/:id/block ─────────────────────────────────────────────

pub async fn unblock_user(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(target_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    let result = sqlx::query!(
        "DELETE FROM friendships
         WHERE user_id = $1 AND friend_id = $2 AND status = 'blocked'",
        auth.user_id,
        target_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Block not found".into()));
    }

    Ok(Json(serde_json::json!({ "message": "User unblocked" })))
}

// ── GET /users/search?q=... ─────────────────────────────────────────────

pub async fn search_users(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<UserSearchQuery>,
) -> Result<impl IntoResponse, AppError> {
    let q = params.q.trim().to_lowercase();
    if q.is_empty() || q.len() < 2 {
        return Err(AppError::BadRequest("Search query must be at least 2 characters".into()));
    }

    let pattern = format!("%{}%", q);
    let rows = sqlx::query!(
        "SELECT id, username, display_name, avatar_url
         FROM users
         WHERE LOWER(username) LIKE $1 AND id != $2
         ORDER BY username
         LIMIT 20",
        pattern,
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let results: Vec<UserSearchResult> = rows.into_iter().map(|r| UserSearchResult {
        id: r.id,
        username: r.username,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
    }).collect();

    Ok(Json(results))
}
