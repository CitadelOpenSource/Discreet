// citadel_user_handlers.rs — User profile endpoints.
//
// Every authenticated user can view and update their own profile.
// Other users' public profiles are visible to server co-members.
//
// Endpoints:
//   GET   /api/v1/users/@me              — Get own profile
//   PATCH /api/v1/users/@me              — Update own profile
//   GET   /api/v1/users/{id}             — Get another user's public profile
//   GET   /api/v1/users/@me/servers      — List servers the current user is in

use axum::{
    body::Body,
    extract::{Path, State, Json},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::AuthUser;
use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

// ─── Response Types ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct UserProfile {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: String,
    pub account_tier: String,
    pub is_guest: bool,
}

#[derive(Debug, Serialize)]
pub struct PublicUserProfile {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    /// The user's current password for verification.
    pub current_password: String,
    /// The desired new password.
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct ChangePasswordResponse {
    /// Fresh access token for the calling session (all others have been revoked).
    pub access_token: String,
    /// Fresh refresh token paired with the new session.
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Serialize)]
pub struct UserServerInfo {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub member_tab_label: String,
    pub owner_id: Uuid,
    pub joined_at: String,
    pub member_count: i64,
}

// ─── GET /api/v1/users/@me ─────────────────────────────────────────────

pub async fn get_me(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, avatar_url, created_at, account_tier, is_guest
         FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(UserProfile {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        avatar_url: user.avatar_url,
        created_at: user.created_at.to_rfc3339(),
        account_tier: user.account_tier.clone(),
        is_guest: user.is_guest,
    }))
}

// ─── PATCH /api/v1/users/@me ───────────────────────────────────────────

pub async fn update_me(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate display_name length.
    if let Some(ref name) = req.display_name {
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::BadRequest(
                "Display name must be 1-64 characters".into(),
            ));
        }
    }

    // Validate avatar_url length.
    if let Some(ref url) = req.avatar_url {
        if url.len() > 2048 {
            return Err(AppError::BadRequest(
                "Avatar URL too long (max 2048 chars)".into(),
            ));
        }
    }

    // Update only provided fields.
    if let Some(ref display_name) = req.display_name {
        sqlx::query!(
            "UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2",
            display_name,
            auth.user_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref avatar_url) = req.avatar_url {
        sqlx::query!(
            "UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2",
            avatar_url,
            auth.user_id,
        )
        .execute(&state.db)
        .await?;
    }

    // Return updated profile.
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, avatar_url, created_at, account_tier, is_guest
         FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(UserProfile {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        avatar_url: user.avatar_url,
        created_at: user.created_at.to_rfc3339(),
        account_tier: user.account_tier.clone(),
        is_guest: user.is_guest,
    }))
}

// ─── GET /api/v1/users/{id} ────────────────────────────────────────────

/// Returns another user's public profile. Only shows limited info.
/// Requires that the requesting user shares at least one server with the target.
pub async fn get_user(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // If requesting own profile, redirect logic to get_me.
    if user_id == auth.user_id {
        let user = sqlx::query!(
            "SELECT id, username, display_name, email, avatar_url, created_at
             FROM users WHERE id = $1",
            auth.user_id,
        )
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

        return Ok(Json(serde_json::json!({
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "created_at": user.created_at.to_rfc3339(),
        })));
    }

    // Check that the two users share at least one server.
    let shares_server = sqlx::query_scalar!(
        "SELECT EXISTS(
            SELECT 1 FROM server_members a
            INNER JOIN server_members b ON a.server_id = b.server_id
            WHERE a.user_id = $1 AND b.user_id = $2
        )",
        auth.user_id,
        user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !shares_server.unwrap_or(false) {
        return Err(AppError::NotFound("User not found".into()));
    }

    let user = sqlx::query!(
        "SELECT id, username, display_name, avatar_url
         FROM users WHERE id = $1",
        user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(serde_json::json!({
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
    })))
}

// ─── GET /api/v1/users/@me/servers ─────────────────────────────────────

/// List all servers the current user is a member of, with member counts.
pub async fn list_my_servers(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT s.id, s.name, s.description, s.icon_url, s.member_tab_label, s.owner_id,
                sm.joined_at,
                (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) AS member_count
         FROM servers s
         INNER JOIN server_members sm ON sm.server_id = s.id
         WHERE sm.user_id = $1
         ORDER BY sm.joined_at DESC",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let servers: Vec<UserServerInfo> = rows
        .into_iter()
        .map(|r| UserServerInfo {
            id: r.id,
            name: r.name,
            description: r.description,
            icon_url: r.icon_url,
            member_tab_label: r.member_tab_label,
            owner_id: r.owner_id,
            joined_at: r.joined_at.to_rfc3339(),
            member_count: r.member_count.unwrap_or(0),
        })
        .collect();

    Ok(Json(serde_json::json!({ "servers": servers })))
}

// ─── GET /api/v1/users/{id}/shared-servers ────────────────────────────

/// Returns the list of servers that the current user and the target user
/// both belong to. Respects the target user's `show_shared_servers` privacy setting.
pub async fn get_shared_servers(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // If same user, return empty
    if user_id == auth.user_id {
        return Ok(Json(serde_json::json!([])));
    }

    // Check target user's privacy setting
    let privacy_ok: Option<bool> = sqlx::query_scalar!(
        "SELECT COALESCE(
            (SELECT show_shared_servers FROM user_settings WHERE user_id = $1),
            true
        )",
        user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !privacy_ok.unwrap_or(true) {
        // Target user has opted out of sharing server info
        return Ok(Json(serde_json::json!([])));
    }

    // Find shared servers
    let rows = sqlx::query!(
        "SELECT s.id, s.name, s.icon_url
         FROM servers s
         WHERE s.id IN (
             SELECT a.server_id FROM server_members a
             INNER JOIN server_members b ON a.server_id = b.server_id
             WHERE a.user_id = $1 AND b.user_id = $2
         )
         ORDER BY s.name",
        auth.user_id,
        user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = rows.into_iter().map(|r| {
        serde_json::json!({
            "id": r.id,
            "name": r.name,
            "icon_url": r.icon_url,
        })
    }).collect();

    Ok(Json(serde_json::json!(result)))
}

// ─── DELETE /api/v1/users/@me ──────────────────────────────────────────

/// Permanently delete the authenticated user's account.
/// This is IRREVERSIBLE. Removes all user data, server memberships,
/// DMs, friend connections, and messages.
pub async fn delete_account(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let uid = auth.user_id;

    // Transfer or delete owned servers
    let owned = sqlx::query!("SELECT id FROM servers WHERE owner_id = $1", uid)
        .fetch_all(&state.db).await?;
    for srv in &owned {
        // Delete servers the user owns (cascade handles channels, messages, etc.)
        sqlx::query!("DELETE FROM servers WHERE id = $1", srv.id)
            .execute(&state.db).await?;
    }

    // Remove from all servers
    sqlx::query!("DELETE FROM server_members WHERE user_id = $1", uid)
        .execute(&state.db).await?;
    sqlx::query!("DELETE FROM member_roles WHERE user_id = $1", uid)
        .execute(&state.db).await?;

    // Remove friend connections
    sqlx::query!("DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1", uid)
        .execute(&state.db).await?;

    // Remove DMs and group DM memberships
    sqlx::query!("DELETE FROM dm_channels WHERE user_a = $1 OR user_b = $1", uid)
        .execute(&state.db).await?;
    sqlx::query!("DELETE FROM group_dm_members WHERE user_id = $1", uid)
        .execute(&state.db).await.ok();

    // Remove email tokens, event RSVPs (tables may not exist yet)
    sqlx::query!("DELETE FROM email_tokens WHERE user_id = $1", uid)
        .execute(&state.db).await.ok();
    sqlx::query!("DELETE FROM event_rsvps WHERE user_id = $1", uid)
        .execute(&state.db).await.ok();

    // Delete the user record itself
    sqlx::query!("DELETE FROM users WHERE id = $1", uid)
        .execute(&state.db).await?;

    tracing::warn!(user_id = %uid, "Account permanently deleted");

    Ok(StatusCode::NO_CONTENT)
}

// ─── GET /api/v1/users/@me/export ─────────────────────────────────────
//
// GDPR Article 20 — data portability export.
// Returns a JSON file containing the complete personal data set for the
// authenticated user: profile, server memberships with roles, DM conversations,
// friends, blocked users, and preferences.
//
// Response headers:
//   Content-Type:        application/json
//   Content-Disposition: attachment; filename="discreet-data-export.json"

pub async fn export_my_data(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<Response, AppError> {
    let uid = auth.user_id;

    // ── 1. Profile ───────────────────────────────────────────────────────
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, avatar_url, created_at
         FROM users WHERE id = $1",
        uid,
    )
    .fetch_one(&state.db)
    .await?;

    // ── 2. Server memberships with assigned roles ─────────────────────────
    // One row per (server × role) pair; servers with no roles produce a single
    // row with role_name = NULL.
    let membership_rows = sqlx::query!(
        r#"SELECT s.id as server_id, s.name as server_name, sm.joined_at,
                  r.name as "role_name?"
           FROM server_members sm
           JOIN servers s ON s.id = sm.server_id
           LEFT JOIN member_roles mr
                  ON mr.server_id = sm.server_id AND mr.user_id = sm.user_id
           LEFT JOIN roles r ON r.id = mr.role_id
           WHERE sm.user_id = $1
           ORDER BY sm.joined_at DESC, r.position"#,
        uid,
    )
    .fetch_all(&state.db)
    .await?;

    // Aggregate roles per server, preserving join order.
    let mut servers_export: Vec<serde_json::Value> = Vec::new();
    for row in membership_rows {
        if let Some(entry) = servers_export
            .iter_mut()
            .find(|e| e["server_id"] == row.server_id.to_string())
        {
            if let Some(role_name) = row.role_name {
                entry["roles"].as_array_mut().unwrap().push(role_name.into());
            }
        } else {
            let roles: Vec<serde_json::Value> = row
                .role_name
                .map(|n| vec![n.into()])
                .unwrap_or_default();
            servers_export.push(serde_json::json!({
                "server_id":   row.server_id,
                "server_name": row.server_name,
                "joined_at":   row.joined_at.to_rfc3339(),
                "roles":       roles,
            }));
        }
    }

    // ── 3. Direct-message conversations ──────────────────────────────────
    let dm_rows = sqlx::query!(
        r#"SELECT dc.id as channel_id, dc.created_at,
                  u.username as other_username
           FROM dm_channels dc
           JOIN users u ON u.id = CASE
               WHEN dc.user_a = $1 THEN dc.user_b
               ELSE dc.user_a
           END
           WHERE dc.user_a = $1 OR dc.user_b = $1
           ORDER BY dc.created_at DESC"#,
        uid,
    )
    .fetch_all(&state.db)
    .await?;

    let dms_export: Vec<serde_json::Value> = dm_rows
        .into_iter()
        .map(|r| serde_json::json!({
            "channel_id":     r.channel_id,
            "other_username": r.other_username,
            "created_at":     r.created_at.to_rfc3339(),
        }))
        .collect();

    // ── 4. Friends (accepted) ─────────────────────────────────────────────
    let friend_rows = sqlx::query!(
        r#"SELECT u.username, f.created_at as friend_since
           FROM friendships f
           JOIN users u ON u.id = CASE
               WHEN f.user_id = $1 THEN f.friend_id
               ELSE f.user_id
           END
           WHERE f.status = 'accepted'
             AND (f.user_id = $1 OR f.friend_id = $1)
           ORDER BY u.username"#,
        uid,
    )
    .fetch_all(&state.db)
    .await?;

    let friends_export: Vec<serde_json::Value> = friend_rows
        .into_iter()
        .map(|r| serde_json::json!({
            "username":     r.username,
            "friend_since": r.friend_since.to_rfc3339(),
        }))
        .collect();

    // ── 5. Blocked users ──────────────────────────────────────────────────
    let block_rows = sqlx::query!(
        "SELECT u.username, f.created_at as blocked_at
         FROM friendships f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1 AND f.status = 'blocked'
         ORDER BY u.username",
        uid,
    )
    .fetch_all(&state.db)
    .await?;

    let blocked_export: Vec<serde_json::Value> = block_rows
        .into_iter()
        .map(|r| serde_json::json!({
            "username":   r.username,
            "blocked_at": r.blocked_at.to_rfc3339(),
        }))
        .collect();

    // ── 6. User settings ──────────────────────────────────────────────────
    let settings_export = sqlx::query!(
        "SELECT theme, font_size, compact_mode, show_embeds, dm_privacy,
                friend_request_privacy, notification_level, show_shared_servers,
                updated_at
         FROM user_settings WHERE user_id = $1",
        uid,
    )
    .fetch_optional(&state.db)
    .await?
    .map(|r| serde_json::json!({
        "theme":                   r.theme,
        "font_size":               r.font_size,
        "compact_mode":            r.compact_mode,
        "show_embeds":             r.show_embeds,
        "dm_privacy":              r.dm_privacy,
        "friend_request_privacy":  r.friend_request_privacy,
        "notification_level":      r.notification_level,
        "show_shared_servers":     r.show_shared_servers,
        "updated_at":              r.updated_at.to_rfc3339(),
    }))
    .unwrap_or(serde_json::json!(null));

    // ── Assemble export document ──────────────────────────────────────────
    let export = serde_json::json!({
        "export_version": 1,
        "generated_at":   chrono::Utc::now().to_rfc3339(),
        "profile": {
            "id":           user.id,
            "username":     user.username,
            "display_name": user.display_name,
            "email":        user.email,
            "avatar_url":   user.avatar_url,
            "created_at":   user.created_at.to_rfc3339(),
        },
        "servers":       servers_export,
        "dm_channels":   dms_export,
        "friends":       friends_export,
        "blocked_users": blocked_export,
        "settings":      settings_export,
    });

    tracing::info!(user_id = %uid, "GDPR data export generated");

    let json_bytes = serde_json::to_vec_pretty(&export)?;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static("application/json"))
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename=\"discreet-data-export.json\""),
        )
        .body(Body::from(json_bytes))
        .map_err(|e| AppError::Internal(format!("Response build error: {e}")))?;

    Ok(response)
}

// ─── POST /api/v1/users/@me/password ──────────────────────────────────
//
// Change the caller's password.
//
// On success:
//   1. All active sessions (including the current one) are revoked in the DB.
//   2. Their session IDs are written to the Redis SET "revoked_sessions:{user_id}"
//      with a 24-hour TTL so that any still-valid JWTs are immediately rejected
//      by the auth middleware even before the DB is checked.
//   3. A brand-new session (new session_id) is created for the calling client.
//   4. The new access_token + refresh_token are returned so the caller
//      stays logged in seamlessly.

pub async fn change_password(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<impl IntoResponse, AppError> {
    use crate::citadel_auth_handlers::{
        create_session, hash_password, validate_password_pub, verify_password_pub,
    };

    // Fetch current password hash.
    let user = sqlx::query!(
        "SELECT password_hash FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    // (1) Verify the current password before accepting the change.
    if !verify_password_pub(&req.current_password, &user.password_hash)? {
        return Err(AppError::Unauthorized("Current password is incorrect".into()));
    }

    // Validate and hash the new password.
    validate_password_pub(&req.new_password)?;
    let new_hash = hash_password(&req.new_password)?;

    // Persist the new hash.
    sqlx::query!(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        new_hash,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Collect every active session ID for this user so we can blacklist them.
    let old_session_ids: Vec<Uuid> = sqlx::query_scalar!(
        "SELECT id FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    // (2) Revoke all sessions in the DB in one shot.
    sqlx::query!(
        "UPDATE sessions SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL",
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // (2) Write all old session IDs into the Redis revocation SET.
    //     TTL = 86 400 s (24 h) — matches the maximum JWT lifetime so no
    //     old token can survive the blacklist expiry.
    if !old_session_ids.is_empty() {
        let revoked_key = format!("revoked_sessions:{}", auth.user_id);
        let mut redis_conn = state.redis.clone();

        for sid in &old_session_ids {
            let _: Result<i64, _> = redis::cmd("SADD")
                .arg(&revoked_key)
                .arg(sid.to_string())
                .query_async(&mut redis_conn)
                .await;
        }
        // (Re)set the TTL each time so it stays alive for a full 24 hours
        // from the most recent password change.
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&revoked_key)
            .arg(86400_i64)
            .query_async(&mut redis_conn)
            .await;
    }

    // (4) Create a fresh session for the calling client so they stay logged in.
    let (access_token, refresh_token, _new_session_id) =
        create_session(&state, auth.user_id, None).await?;

    tracing::info!(
        user_id     = %auth.user_id,
        revoked_n   = old_session_ids.len(),
        "Password changed; all old sessions revoked, fresh session issued"
    );

    Ok(Json(ChangePasswordResponse {
        access_token,
        refresh_token,
        expires_in: state.config.jwt_expiry_secs,
    }))
}

// ─── Route Registration ────────────────────────────────────────────────

pub fn user_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, patch, post, delete};
    axum::Router::new()
        .route("/users/@me", get(get_me))
        .route("/users/@me", patch(update_me))
        .route("/users/@me", delete(delete_account))
        .route("/users/@me/password", post(change_password))
        .route("/users/@me/servers", get(list_my_servers))
        .route("/users/{id}", get(get_user))
        .route("/users/{id}/shared-servers", get(get_shared_servers))
}
