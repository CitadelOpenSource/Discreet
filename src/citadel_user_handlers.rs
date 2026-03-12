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

#[derive(Debug, Deserialize)]
pub struct DeleteAccountRequest {
    /// The user's current password — required to confirm the destructive action.
    pub password: String,
}

/// Permanently delete the authenticated user's account (GDPR Article 17).
///
/// Password confirmation is required. The deletion order is:
///   1. Verify password against stored Argon2id hash
///   2. Soft-delete all messages (zero the ciphertext, set deleted=true)
///   3. Delete AI agent memory rows (episodic facts + context summaries)
///   4. Delete developer tokens
///   5. Revoke and delete all sessions (DB + Redis)
///   6. Delete owned servers (cascades channels/messages)
///   7. Remove server memberships and roles
///   8. Remove friendships
///   9. Remove DM channels and group DM memberships
///  10. Remove ancillary rows (email tokens, event RSVPs)
///  11. Delete the user record
pub async fn delete_account(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<DeleteAccountRequest>,
) -> Result<impl IntoResponse, AppError> {
    let uid = auth.user_id;

    // ── 1. Verify password ────────────────────────────────────────────────
    let stored_hash = sqlx::query_scalar!(
        "SELECT password_hash FROM users WHERE id = $1",
        uid,
    )
    .fetch_one(&state.db)
    .await?;

    if !crate::citadel_auth_handlers::verify_password_pub(&req.password, &stored_hash)? {
        return Err(AppError::Unauthorized("Incorrect password".into()));
    }

    // ── 2. Soft-delete all messages by this user ──────────────────────────
    // We zero the ciphertext rather than hard-deleting to preserve message
    // threading (reply_to_id chains) for other participants.
    sqlx::query!(
        r#"UPDATE messages
           SET deleted = TRUE, content_ciphertext = '\x00', edited_at = NOW()
           WHERE author_id = $1 AND deleted = FALSE"#,
        uid,
    )
    .execute(&state.db)
    .await?;

    // ── 3. Delete AI agent memory rows ───────────────────────────────────
    sqlx::query!(
        "DELETE FROM agent_episodic_facts WHERE agent_id = $1",
        uid,
    )
    .execute(&state.db)
    .await.ok(); // table may not exist on older deployments

    sqlx::query!(
        "DELETE FROM agent_context_summaries WHERE bot_user_id = $1",
        uid,
    )
    .execute(&state.db)
    .await.ok();

    // ── 4. Delete developer tokens ────────────────────────────────────────
    // (also covered by ON DELETE CASCADE on dev_tokens.user_id, belt+suspenders)
    sqlx::query!("DELETE FROM dev_tokens WHERE user_id = $1", uid)
        .execute(&state.db)
        .await.ok();

    // ── 5. Revoke sessions — DB + Redis ──────────────────────────────────
    // Collect active session IDs first so we can write them to Redis,
    // ensuring any still-valid JWTs are immediately rejected by the auth layer.
    let active_session_ids: Vec<Uuid> = sqlx::query_scalar!(
        "SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()",
        uid,
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if !active_session_ids.is_empty() {
        let revoked_key = format!("revoked_sessions:{}", uid);
        let mut redis_conn = state.redis.clone();
        for sid in &active_session_ids {
            let _: Result<i64, _> = redis::cmd("SADD")
                .arg(&revoked_key)
                .arg(sid.to_string())
                .query_async(&mut redis_conn)
                .await;
        }
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&revoked_key)
            .arg(86_400i64)
            .query_async(&mut redis_conn)
            .await;
    }

    sqlx::query!("DELETE FROM sessions WHERE user_id = $1", uid)
        .execute(&state.db)
        .await?;

    // ── 6. Delete owned servers (cascade handles channels/messages) ───────
    let owned = sqlx::query_scalar!("SELECT id FROM servers WHERE owner_id = $1", uid)
        .fetch_all(&state.db)
        .await?;
    for srv_id in &owned {
        sqlx::query!("DELETE FROM servers WHERE id = $1", srv_id)
            .execute(&state.db)
            .await?;
    }

    // ── 7. Remove server memberships and role assignments ─────────────────
    sqlx::query!("DELETE FROM server_members WHERE user_id = $1", uid)
        .execute(&state.db)
        .await?;
    sqlx::query!("DELETE FROM member_roles WHERE user_id = $1", uid)
        .execute(&state.db)
        .await?;

    // ── 8. Remove friend connections ──────────────────────────────────────
    sqlx::query!("DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1", uid)
        .execute(&state.db)
        .await?;

    // ── 9. Remove DM channels and group DM memberships ────────────────────
    sqlx::query!("DELETE FROM dm_channels WHERE user_a = $1 OR user_b = $1", uid)
        .execute(&state.db)
        .await?;
    sqlx::query!("DELETE FROM group_dm_members WHERE user_id = $1", uid)
        .execute(&state.db)
        .await.ok();

    // ── 10. Remove ancillary rows (best-effort; tables may not exist) ─────
    sqlx::query!("DELETE FROM email_tokens WHERE user_id = $1", uid)
        .execute(&state.db)
        .await.ok();
    sqlx::query!("DELETE FROM event_rsvps WHERE user_id = $1", uid)
        .execute(&state.db)
        .await.ok();

    // ── 11. Tombstone the UUID to prevent cryptographic key reuse ────────
    sqlx::query!(
        "INSERT INTO deleted_user_ids (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        uid,
    )
    .execute(&state.db)
    .await?;

    // ── 12. Delete the user record ────────────────────────────────────────
    sqlx::query!("DELETE FROM users WHERE id = $1", uid)
        .execute(&state.db)
        .await?;

    tracing::warn!(user_id = %uid, "Account permanently deleted (GDPR Article 17)");

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

// ─── GET /api/v1/users/@me/settings ───────────────────────────────────

#[derive(serde::Serialize)]
pub struct UserSettingsResponse {
    pub locale: String,
    pub theme: String,
    pub notifications_enabled: bool,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateUserSettingsRequest {
    pub locale: Option<String>,
    pub theme: Option<String>,
    pub notifications_enabled: Option<bool>,
}

pub async fn get_user_settings(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        "SELECT locale, theme, notifications_enabled
         FROM user_settings WHERE user_id = $1",
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?;

    let resp = match row {
        Some(r) => UserSettingsResponse {
            locale:                r.locale,
            theme:                 r.theme,
            notifications_enabled: r.notifications_enabled,
        },
        None => UserSettingsResponse {
            locale:                "en".into(),
            theme:                 "dark".into(),
            notifications_enabled: true,
        },
    };

    Ok(Json(resp))
}

// ─── PUT /api/v1/users/@me/settings ───────────────────────────────────

pub async fn update_user_settings(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateUserSettingsRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Validate locale if provided (2–10 chars, letters + optional hyphen/underscore)
    if let Some(ref locale) = req.locale {
        if locale.len() < 2 || locale.len() > 10 {
            return Err(AppError::BadRequest("locale must be 2–10 characters".into()));
        }
    }

    sqlx::query!(
        r#"INSERT INTO user_settings (user_id, locale, theme, notifications_enabled)
           VALUES ($1,
               COALESCE($2, 'en'),
               COALESCE($3, 'dark'),
               COALESCE($4, TRUE))
           ON CONFLICT (user_id) DO UPDATE SET
               locale                = COALESCE($2, user_settings.locale),
               theme                 = COALESCE($3, user_settings.theme),
               notifications_enabled = COALESCE($4, user_settings.notifications_enabled),
               updated_at            = NOW()"#,
        auth.user_id,
        req.locale,
        req.theme,
        req.notifications_enabled,
    )
    .execute(&state.db)
    .await?;

    // Re-query and return the current state
    let row = sqlx::query!(
        "SELECT locale, theme, notifications_enabled
         FROM user_settings WHERE user_id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(UserSettingsResponse {
        locale:                row.locale,
        theme:                 row.theme,
        notifications_enabled: row.notifications_enabled,
    }))
}

// ─── Route Registration ────────────────────────────────────────────────

pub fn user_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/users/@me", get(get_me).patch(update_me).delete(delete_account))
        .route("/users/@me/password", post(change_password))
        .route("/users/@me/settings", get(get_user_settings).put(update_user_settings))
        .route("/users/@me/servers", get(list_my_servers))
        .route("/users/:id", get(get_user))
        .route("/users/:id/shared-servers", get(get_shared_servers))
}
