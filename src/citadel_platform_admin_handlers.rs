// citadel_platform_admin_handlers.rs — Platform identity and admin stat endpoints.
//
// Endpoints:
//   GET  /api/v1/platform/me                  — Current user's platform profile + permissions.
//   GET  /api/v1/admin/stats                  — Aggregate platform stats (ACCESS_ADMIN_DASHBOARD).
//   GET  /api/v1/admin/users                  — Paginated user list (ACCESS_ADMIN_DASHBOARD).
//   GET  /api/v1/admin/registrations          — Daily registration counts, last 30 days
//                                               (VIEW_PLATFORM_STATS).
//   POST /api/v1/admin/users/:id/role         — Set a user's account_tier and/or platform_role
//                                               (ACCESS_ADMIN_DASHBOARD + MANAGE_USERS).
//   POST /api/v1/admin/generate-dev-accounts  — Bulk-create dev_NNN test accounts with
//                                               random passwords shown once (MANAGE_USERS).
//   POST /api/v1/admin/users/:id/ban          — Ban user account, optionally IP ban (MANAGE_USERS).
//   DELETE /api/v1/admin/users/:id/ban        — Unban user account, remove IP bans (MANAGE_USERS).
//
// Guards:
//   require_staff_role           — In-memory check: platform_role must be admin or dev.
//   require_platform_permission  — DB check: role must have the named permission.
//
// All handlers use PlatformUser (not AuthUser) so account_tier, platform_role,
// badge_type, and email_verified are already loaded before the handler runs.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Json,
};
use rand::Rng;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::citadel_error::AppError;
use crate::citadel_platform_permissions::{check_platform_permission, PlatformRole, PlatformUser};
use crate::citadel_state::AppState;
use chrono::Utc;

// ─── Serde helper — double Option ────────────────────────────────────────────
//
// Distinguishes three states for nullable request fields:
//   Field absent           → outer None  (don't touch the column)
//   Field present as null  → Some(None)  (clear the column to NULL)
//   Field present as value → Some(Some(v))
//
// Used for `platform_role` which is nullable in the DB.
// Apply with: #[serde(default, deserialize_with = "deserialize_double_option")]
fn deserialize_double_option<'de, D>(d: D) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

// ─── Role guard ───────────────────────────────────────────────────────────────

/// Returns `Ok(())` if the caller holds the `admin` or `dev` platform_role,
/// or `Err(AppError::Forbidden)` if not.
///
/// This check is in-memory (no DB query) because `PlatformUser` loads
/// `platform_role` during extraction. It is the primary gate for all
/// `/admin/*` and `/dev/*` routes.
pub fn require_staff_role(caller: &PlatformUser) -> Result<(), AppError> {
    match caller.platform_role {
        Some(PlatformRole::Admin) | Some(PlatformRole::Dev) => Ok(()),
        _ => Err(AppError::Forbidden(
            "Requires admin or dev platform role".into(),
        )),
    }
}

// ─── Permission guard ─────────────────────────────────────────────────────────

/// Returns `Ok(())` if the user's `platform_role` grants `permission_name`,
/// or `Err(AppError::Forbidden)` if not.
///
/// Delegates to `check_platform_permission`; DB errors also produce Forbidden
/// so that internal failures do not silently grant access.
pub async fn require_platform_permission(
    pool: &PgPool,
    user_id: Uuid,
    permission_name: &str,
) -> Result<(), AppError> {
    if check_platform_permission(pool, user_id, permission_name).await {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "Requires the {permission_name} platform permission"
        )))
    }
}

// ─── GET /platform/me ────────────────────────────────────────────────────────

/// Returns the calling user's full platform identity:
///   - account_tier   (e.g. "unverified", "verified", "premium")
///   - platform_role  (e.g. "admin", "dev", or null for ordinary users)
///   - badge_type     (e.g. "shield", "gem", "wrench", "crown", or null)
///   - email_verified (bool)
///   - permissions    (array of permission name strings granted by their platform_role)
///
/// `permissions` is empty for users with no platform_role (the common case).
pub async fn platform_me(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    // Fetch the permission names for the caller's platform_role.
    // Short-circuit to an empty list when platform_role is NULL.
    let permissions: Vec<String> = match &caller.platform_role {
        None => vec![],
        Some(role) => {
            sqlx::query_scalar!(
                r#"SELECT pp.name
                   FROM platform_role_permissions prp
                   JOIN platform_permissions pp ON pp.id = prp.permission_id
                   WHERE prp.role_name = $1
                   ORDER BY pp.bit_flag"#,
                role.to_string(),
            )
            .fetch_all(&state.db)
            .await?
        }
    };

    Ok(Json(json!({
        "account_tier":   caller.account_tier.to_string(),
        "platform_role":  caller.platform_role.map(|r| r.to_string()),
        "badge_type":     caller.badge_type,
        "email_verified": caller.email_verified,
        "permissions":    permissions,
    })))
}

// ─── GET /admin/stats ─────────────────────────────────────────────────────────

/// Returns aggregate platform statistics. Requires ACCESS_ADMIN_DASHBOARD.
///
/// All nine counts are fetched concurrently with `tokio::try_join!` to keep
/// response latency near the slowest single query rather than their sum.
///
/// Fields:
///   total_users         — non-bot users in the users table
///   verified_users      — non-bot users with account_tier = 'verified'
///   guest_users         — users with account_tier = 'guest'
///   total_servers       — server rows
///   total_messages      — non-deleted message rows
///   total_channels      — channel rows
///   active_users_24h    — non-bot users whose last_active_at is within 24 h
///   registrations_today — non-bot users created since midnight UTC
///   total_bot_configs   — rows in server_bots (AI bot integrations per server)
pub async fn admin_stats(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    require_platform_permission(&state.db, caller.user_id, "ACCESS_ADMIN_DASHBOARD").await?;

    let (
        total_users,
        verified_users,
        guest_users,
        total_servers,
        total_messages,
        total_channels,
        active_users_24h,
        registrations_today,
        total_bot_configs,
    ) = tokio::try_join!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM users WHERE is_bot = FALSE"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM users WHERE account_tier = 'verified' AND is_bot = FALSE"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM users WHERE account_tier = 'guest'"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM servers"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM messages WHERE deleted = FALSE"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM channels"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM users
             WHERE is_bot = FALSE
               AND last_active_at > NOW() - INTERVAL '24 hours'"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM users
             WHERE is_bot = FALSE
               AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')"
        )
        .fetch_one(&state.db),

        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM server_bots"
        )
        .fetch_one(&state.db),
    )?;

    Ok(Json(json!({
        "total_users":         total_users.unwrap_or(0),
        "verified_users":      verified_users.unwrap_or(0),
        "guest_users":         guest_users.unwrap_or(0),
        "total_servers":       total_servers.unwrap_or(0),
        "total_messages":      total_messages.unwrap_or(0),
        "total_channels":      total_channels.unwrap_or(0),
        "active_users_24h":    active_users_24h.unwrap_or(0),
        "registrations_today": registrations_today.unwrap_or(0),
        "total_bot_configs":   total_bot_configs.unwrap_or(0),
    })))
}

// ─── POST /admin/users/:user_id/role ─────────────────────────────────────────

const VALID_ROLES: &[&str] = &["admin", "dev", "premium", "verified", "unverified", "guest"];

#[derive(Debug, Deserialize)]
pub struct SetUserRoleRequest {
    /// New platform_role value. Absent = don't change. null = clear to NULL.
    /// Must be one of the VALID_ROLES strings if provided.
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub platform_role: Option<Option<String>>,

    /// New account_tier value. Absent = don't change.
    /// Must be one of the VALID_ROLES strings if provided (account_tier is NOT NULL).
    pub account_tier: Option<String>,
}

/// Maps a platform_role string to its automatic badge_type.
/// Returns None for roles that carry no badge (unverified, guest, NULL).
fn badge_for_role(role: Option<&str>) -> Option<&'static str> {
    match role {
        Some("admin")    => Some("crown"),
        Some("dev")      => Some("wrench"),
        Some("premium")  => Some("gem"),
        Some("verified") => Some("shield"),
        _                => None,
    }
}

/// Promote or demote a user's platform role and/or account tier.
///
/// Requires both ACCESS_ADMIN_DASHBOARD and MANAGE_USERS platform permissions.
///
/// Request body fields are all optional — omit a field to leave it unchanged:
///   platform_role  — nullable; send null to clear the staff designation
///   account_tier   — non-nullable; must be a valid tier string if present
///
/// badge_type is derived automatically from the new platform_role and is
/// never accepted as an input field.
///
/// Returns the updated user row: id, username, account_tier, platform_role,
/// badge_type, email_verified.
pub async fn set_user_role(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(target_id): Path<Uuid>,
    Json(req): Json<SetUserRoleRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    // Both permissions are required.
    require_platform_permission(&state.db, caller.user_id, "ACCESS_ADMIN_DASHBOARD").await?;
    require_platform_permission(&state.db, caller.user_id, "MANAGE_USERS").await?;

    // Validate account_tier if provided.
    if let Some(ref tier) = req.account_tier {
        if !VALID_ROLES.contains(&tier.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Invalid account_tier '{tier}'. Must be one of: {}",
                VALID_ROLES.join(", ")
            )));
        }
    }

    // Validate platform_role string if provided as a non-null value.
    if let Some(Some(ref role)) = req.platform_role {
        if !VALID_ROLES.contains(&role.as_str()) {
            return Err(AppError::BadRequest(format!(
                "Invalid platform_role '{role}'. Must be one of: {} or null",
                VALID_ROLES.join(", ")
            )));
        }
    }

    // Confirm the target user exists.
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND is_bot = FALSE)",
        target_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if !exists {
        return Err(AppError::NotFound("User not found".into()));
    }

    // Apply platform_role + badge_type update if the field was present in the request.
    if let Some(new_role) = req.platform_role {
        let role_str = new_role.as_deref();           // Option<&str>: None = NULL, Some(s) = value
        let badge    = badge_for_role(role_str);       // Option<&str>: derived automatically

        sqlx::query!(
            "UPDATE users SET platform_role = $1, badge_type = $2 WHERE id = $3",
            role_str,
            badge,
            target_id,
        )
        .execute(&state.db)
        .await?;
    }

    // Apply account_tier update if the field was present in the request.
    if let Some(ref new_tier) = req.account_tier {
        sqlx::query!(
            "UPDATE users SET account_tier = $1 WHERE id = $2",
            new_tier,
            target_id,
        )
        .execute(&state.db)
        .await?;
    }

    // Invalidate cached user state so changes take effect immediately.
    crate::citadel_auth::invalidate_user_cache(&state, target_id).await;

    // Fetch and return the updated profile.
    let row = sqlx::query!(
        r#"SELECT id, username, account_tier, platform_role, badge_type, email_verified
           FROM users
           WHERE id = $1"#,
        target_id,
    )
    .fetch_one(&state.db)
    .await?;

    tracing::info!(
        admin_id  = %caller.user_id,
        target_id = %target_id,
        account_tier  = ?req.account_tier,
        "Admin updated user role",
    );

    Ok(Json(json!({
        "id":             row.id,
        "username":       row.username,
        "account_tier":   row.account_tier,
        "platform_role":  row.platform_role,
        "badge_type":     row.badge_type,
        "email_verified": row.email_verified,
    })))
}

// ─── POST /admin/generate-dev-accounts ───────────────────────────────────────

fn default_count() -> u32 { 10 }

#[derive(Debug, Deserialize)]
pub struct GenerateDevAccountsRequest {
    /// Number of accounts to create. Clamped to 1–100. Defaults to 10.
    #[serde(default = "default_count")]
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct DevAccountCreated {
    pub username: String,
    /// Plaintext password — shown once and never stored. Save immediately.
    pub password: String,
}

/// Bulk-create `dev_NNN` test accounts. Requires MANAGE_USERS permission.
///
/// Usernames are `dev_NNNN` (4-digit zero-padded), sequenced from the
/// current highest existing `dev_NNNN` account so repeated calls never collide.
///
/// Passwords are 16 random alphanumeric characters (≈95 bits of entropy).
/// They are hashed with Argon2id before storage. The plaintext is returned
/// **once** in this response and is not recoverable afterwards.
///
/// Each account is created with:
///   account_tier = 'unverified'
///   platform_role = 'dev'
///   badge_type    = 'wrench'
pub async fn generate_dev_accounts(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<GenerateDevAccountsRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    require_platform_permission(&state.db, caller.user_id, "MANAGE_USERS").await?;

    if req.count == 0 || req.count > 100 {
        return Err(AppError::BadRequest(
            "count must be between 1 and 100".into(),
        ));
    }

    // Find the highest existing dev_NNNN suffix so new names don't collide.
    // SUBSTRING(username FROM 5) strips the leading "dev_".
    let max_existing: i32 = sqlx::query_scalar!(
        r#"SELECT COALESCE(
               MAX(CAST(SUBSTRING(username FROM 5) AS INTEGER)),
               0
           )
           FROM users
           WHERE username ~ '^dev_[0-9]+$'"#
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    let mut created: Vec<DevAccountCreated> = Vec::with_capacity(req.count as usize);

    for i in 0..req.count {
        let num = max_existing + i as i32 + 1;
        let username = format!("dev_{num:04}");

        // 16-char alphanumeric password — sufficient entropy, human-typeable.
        let password: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();

        let password_hash = crate::citadel_auth_handlers::hash_password(&password)?;
        let id = Uuid::new_v4();

        sqlx::query!(
            r#"INSERT INTO users
                   (id, username, display_name, password_hash, account_tier, platform_role, badge_type)
               VALUES ($1, $2, $3, $4, 'unverified', 'dev', 'wrench')"#,
            id,
            username,
            username,   // display_name defaults to username for dev accounts
            password_hash,
        )
        .execute(&state.db)
        .await?;

        created.push(DevAccountCreated { username, password });
    }

    tracing::info!(
        admin_id = %caller.user_id,
        count    = req.count,
        first    = %created.first().map(|a| a.username.as_str()).unwrap_or(""),
        last     = %created.last().map(|a| a.username.as_str()).unwrap_or(""),
        "Dev accounts generated — passwords shown once",
    );

    Ok((axum::http::StatusCode::CREATED, Json(created)))
}

// ─── GET /admin/users ─────────────────────────────────────────────────────────

fn default_page() -> i64 { 1 }
fn default_per_page() -> i64 { 50 }

#[derive(Debug, Deserialize)]
pub struct UserListQuery {
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_per_page")]
    pub per_page: i64,
}

/// Paginated list of all users. Requires ACCESS_ADMIN_DASHBOARD.
///
/// Query params:
///   page      — 1-based page number (default: 1)
///   per_page  — rows per page, clamped to 1–200 (default: 50)
///
/// Response:
///   { users: [...], total: N, page: N, per_page: N, total_pages: N }
pub async fn list_users(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Query(q): Query<UserListQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    require_platform_permission(&state.db, caller.user_id, "ACCESS_ADMIN_DASHBOARD").await?;

    let per_page = q.per_page.clamp(1, 200);
    let page     = q.page.max(1);
    let offset   = (page - 1) * per_page;

    let total: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db)
        .await?
        .unwrap_or(0);

    let rows = sqlx::query!(
        r#"SELECT id,
                  username,
                  display_name,
                  account_tier,
                  platform_role,
                  badge_type,
                  email_verified,
                  is_bot,
                  created_at
           FROM users
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2"#,
        per_page,
        offset,
    )
    .fetch_all(&state.db)
    .await?;

    let users: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| json!({
            "id":             r.id,
            "username":       r.username,
            "display_name":   r.display_name,
            "account_tier":   r.account_tier,
            "platform_role":  r.platform_role,
            "badge_type":     r.badge_type,
            "email_verified": r.email_verified,
            "is_bot":         r.is_bot,
            "created_at":     r.created_at.to_rfc3339(),
        }))
        .collect();

    let total_pages = (total + per_page - 1) / per_page;

    Ok(Json(json!({
        "users":       users,
        "total":       total,
        "page":        page,
        "per_page":    per_page,
        "total_pages": total_pages,
    })))
}

// ─── GET /admin/registrations ─────────────────────────────────────────────────

/// Daily registration counts for the last 30 days. Requires VIEW_PLATFORM_STATS.
///
/// Returns an array of `{ date: "YYYY-MM-DD", count: N }` objects ordered
/// oldest-first, covering every calendar day in the window (days with no
/// registrations are omitted — the client should fill gaps with 0).
pub async fn registration_trend(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    require_platform_permission(&state.db, caller.user_id, "VIEW_PLATFORM_STATS").await?;

    let rows = sqlx::query!(
        r#"SELECT DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')::date AS "day!: chrono::NaiveDate",
                  COUNT(*) AS "count!: i64"
           FROM users
           WHERE is_bot = FALSE
             AND created_at >= NOW() - INTERVAL '30 days'
           GROUP BY 1
           ORDER BY 1"#
    )
    .fetch_all(&state.db)
    .await?;

    let trend: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| json!({
            "date":  r.day.to_string(),   // "YYYY-MM-DD"
            "count": r.count,
        }))
        .collect();

    Ok(Json(trend))
}

// ─── POST /api/v1/admin/users/:user_id/ban ──────────────────────────────────
//
// Ban a user account. Optionally ban their IP address too.
// Sets banned_at, ban_reason, ban_expires_at on the user row,
// deletes all active sessions, and optionally inserts an IP ban.

#[derive(Debug, Deserialize)]
pub struct BanUserRequest {
    pub reason: String,
    pub duration_hours: Option<i64>,
    #[serde(default)]
    pub ip_ban: bool,
}

pub async fn ban_user(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(target_id): Path<Uuid>,
    Json(req): Json<BanUserRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    require_platform_permission(&state.db, caller.user_id, "MANAGE_USERS").await?;

    // Prevent banning yourself.
    if target_id == caller.user_id {
        return Err(AppError::BadRequest("Cannot ban your own account".into()));
    }

    // Check target exists.
    let target = sqlx::query!(
        "SELECT id, platform_role FROM users WHERE id = $1",
        target_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    // Prevent banning other admins/devs.
    if let Some(ref role) = target.platform_role {
        if role == "admin" || role == "dev" {
            return Err(AppError::Forbidden("Cannot ban staff accounts".into()));
        }
    }

    let ban_expires = req.duration_hours.map(|h| Utc::now() + chrono::Duration::hours(h));

    // Set ban columns on user.
    sqlx::query!(
        "UPDATE users SET banned_at = NOW(), ban_reason = $1, ban_expires_at = $2 WHERE id = $3",
        req.reason,
        ban_expires,
        target_id,
    )
    .execute(&state.db)
    .await?;

    // Delete all sessions to force immediate logout.
    sqlx::query!("DELETE FROM sessions WHERE user_id = $1", target_id)
        .execute(&state.db)
        .await?;

    // Revoke sessions in Redis so in-flight JWTs are rejected.
    let mut redis_conn = state.redis.clone();
    // Set a blanket revocation flag (checked by auth middleware).
    let _: Result<String, _> = redis::cmd("SET")
        .arg(format!("banned:{}", target_id))
        .arg("1")
        .arg("EX")
        .arg(if let Some(h) = req.duration_hours { h * 3600 } else { 86400 * 365 })
        .query_async(&mut redis_conn)
        .await;

    // Optional IP ban.
    if req.ip_ban {
        // Get the user's most recent session IP (cast INET → TEXT).
        let recent_ip = sqlx::query_scalar!(
            "SELECT ip_address::text FROM sessions WHERE user_id = $1 AND ip_address IS NOT NULL ORDER BY created_at DESC LIMIT 1",
            target_id,
        )
        .fetch_optional(&state.db)
        .await?
        .flatten();

        if let Some(ip_str) = recent_ip {
            sqlx::query!(
                "INSERT INTO platform_ip_bans (ip_address, reason, banned_by, expires_at) VALUES ($1, $2, $3, $4)",
                ip_str,
                req.reason,
                caller.user_id,
                ban_expires,
            )
            .execute(&state.db)
            .await?;
            tracing::warn!(
                admin = %caller.user_id,
                target = %target_id,
                ip = %ip_str,
                "IP ban applied"
            );
        }
    }

    tracing::warn!(
        admin = %caller.user_id,
        target = %target_id,
        reason = %req.reason,
        duration_hours = ?req.duration_hours,
        ip_ban = req.ip_ban,
        "User banned"
    );

    Ok(Json(json!({ "message": "User banned", "banned_at": Utc::now().to_rfc3339() })))
}

// ─── DELETE /api/v1/admin/users/:user_id/ban ─────────────────────────────────
//
// Unban a user. Clears ban columns and removes any IP bans associated
// with the user's recent session IPs.

pub async fn unban_user(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(target_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_staff_role(&caller)?;
    require_platform_permission(&state.db, caller.user_id, "MANAGE_USERS").await?;

    // Clear ban columns.
    sqlx::query!(
        "UPDATE users SET banned_at = NULL, ban_reason = NULL, ban_expires_at = NULL WHERE id = $1",
        target_id,
    )
    .execute(&state.db)
    .await?;

    // Remove Redis ban flag.
    let mut redis_conn = state.redis.clone();
    let _: Result<i64, _> = redis::cmd("DEL")
        .arg(format!("banned:{}", target_id))
        .query_async(&mut redis_conn)
        .await;

    // Remove IP bans that were created for this user's IPs.
    // Find their session IPs and delete matching IP ban rows.
    let session_ips: Vec<Option<String>> = sqlx::query_scalar!(
        "SELECT DISTINCT ip_address::text FROM sessions WHERE user_id = $1",
        target_id,
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for ip in session_ips.iter().flatten() {
        sqlx::query!(
            "DELETE FROM platform_ip_bans WHERE ip_address = $1",
            ip,
        )
        .execute(&state.db)
        .await
        .ok();
    }

    tracing::info!(
        admin = %caller.user_id,
        target = %target_id,
        "User unbanned"
    );

    Ok(Json(json!({ "message": "User unbanned" })))
}

// ─── POST /admin/export — Compliance data export ────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct ComplianceExportRequest {
    pub server_id: Uuid,
    pub start_date: chrono::DateTime<chrono::Utc>,
    pub end_date: chrono::DateTime<chrono::Utc>,
    pub format: String,
}

/// Compliance export for platform admins only. Returns encrypted ciphertext —
/// the admin CANNOT read plaintext message content (zero-knowledge).
/// Rate limited to 1 export per hour. Audit-logged.
pub async fn compliance_export(
    caller: PlatformUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<ComplianceExportRequest>,
) -> Result<impl IntoResponse, AppError> {
    // ADMIN ONLY — not dev, not server owners
    if caller.platform_role != Some(PlatformRole::Admin) {
        return Err(AppError::Forbidden("Compliance export requires platform admin role".into()));
    }

    if !matches!(req.format.as_str(), "json" | "csv") {
        return Err(AppError::BadRequest("Format must be 'json' or 'csv'".into()));
    }

    // Rate limit: 1 export per hour
    let rate_key = format!("compliance_export:{}", caller.user_id);
    let mut redis_conn = state.redis.clone();
    let count: i64 = crate::citadel_error::redis_or_503(redis::cmd("INCR").arg(&rate_key).query_async(&mut redis_conn).await)?;
    if count == 1 {
        let _: Result<bool, _> = redis::cmd("EXPIRE").arg(&rate_key).arg(3600i64).query_async(&mut redis_conn).await;
    }
    if count > 1 {
        return Err(AppError::RateLimited("Compliance export is limited to 1 per hour".into()));
    }

    // Audit log the export
    let _ = crate::citadel_audit::log_action(
        &state.db,
        crate::citadel_audit::AuditEntry {
            server_id: req.server_id,
            actor_id: caller.user_id,
            action: "COMPLIANCE_EXPORT",
            target_type: Some("server"),
            target_id: Some(req.server_id),
            changes: Some(serde_json::json!({
                "start_date": req.start_date.to_rfc3339(),
                "end_date": req.end_date.to_rfc3339(),
                "format": req.format,
            })),
            reason: Some("Platform admin compliance export"),
        },
    ).await;

    // Query messages — returns CIPHERTEXT only (admin cannot read plaintext)
    let messages = sqlx::query!(
        r#"SELECT m.id, m.channel_id, m.author_id, m.content_ciphertext,
                  m.created_at, m.mls_epoch,
                  c.name as channel_name,
                  u.username as author_username
           FROM messages m
           JOIN channels c ON c.id = m.channel_id
           JOIN users u ON u.id = m.author_id
           WHERE c.server_id = $1
             AND m.created_at >= $2
             AND m.created_at <= $3
           ORDER BY m.created_at
           LIMIT 10000"#,
        req.server_id,
        req.start_date,
        req.end_date,
    )
    .fetch_all(&state.db)
    .await?;

    // Query members
    let members = sqlx::query!(
        "SELECT u.id as user_id, u.username, u.display_name, sm.joined_at
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id = $1
         ORDER BY sm.joined_at",
        req.server_id,
    )
    .fetch_all(&state.db)
    .await?;

    // Query audit log entries in date range
    let audit = sqlx::query!(
        "SELECT id, actor_id, action, target_type, reason, created_at
         FROM audit_log
         WHERE server_id = $1
           AND created_at >= $2
           AND created_at <= $3
         ORDER BY created_at
         LIMIT 5000",
        req.server_id,
        req.start_date,
        req.end_date,
    )
    .fetch_all(&state.db)
    .await?;

    if req.format == "csv" {
        let mut csv = String::from("message_id,author_username,channel_name,timestamp,mls_epoch,ciphertext_hex\n");
        for m in &messages {
            let hex = hex::encode(&m.content_ciphertext);
            csv.push_str(&format!(
                "{},{},{},{},{},{}\n",
                m.id, m.author_username, m.channel_name, m.created_at.to_rfc3339(), m.mls_epoch, hex
            ));
        }
        Ok(Json(serde_json::json!({
            "format": "csv",
            "server_id": req.server_id,
            "message_count": messages.len(),
            "member_count": members.len(),
            "audit_count": audit.len(),
            "messages_csv": csv,
            "exported_at": chrono::Utc::now().to_rfc3339(),
            "exported_by": caller.user_id,
            "notice": "Message content is encrypted ciphertext. Only channel members with the decryption key can read the plaintext.",
        })))
    } else {
        let msg_json: Vec<serde_json::Value> = messages.iter().map(|m| {
            serde_json::json!({
                "message_id": m.id,
                "author_username": m.author_username,
                "channel_name": m.channel_name,
                "timestamp": m.created_at.to_rfc3339(),
                "mls_epoch": m.mls_epoch,
                "ciphertext_hex": hex::encode(&m.content_ciphertext),
            })
        }).collect();

        let mem_json: Vec<serde_json::Value> = members.iter().map(|m| {
            serde_json::json!({
                "user_id": m.user_id,
                "username": m.username,
                "display_name": m.display_name,
                "joined_at": m.joined_at.to_rfc3339(),
            })
        }).collect();

        let aud_json: Vec<serde_json::Value> = audit.iter().map(|a| {
            serde_json::json!({
                "id": a.id,
                "actor_id": a.actor_id,
                "action": a.action,
                "target_type": a.target_type,
                "reason": a.reason,
                "timestamp": a.created_at.to_rfc3339(),
            })
        }).collect();

        Ok(Json(serde_json::json!({
            "format": "json",
            "server_id": req.server_id,
            "exported_at": chrono::Utc::now().to_rfc3339(),
            "exported_by": caller.user_id,
            "notice": "Message content is encrypted ciphertext. Only channel members with the decryption key can read the plaintext.",
            "messages": msg_json,
            "members": mem_json,
            "audit_log": aud_json,
        })))
    }
}
