// citadel_server_handlers.rs — Server (community) CRUD and membership.
//
// "Servers" in Citadel are communities (like community servers).
// Zero-knowledge: the server stores names/descriptions but never message content.
//
// Endpoints:
//   POST   /servers                         — Create a new server
//   GET    /servers                         — List servers the user belongs to
//   GET    /servers/:id                     — Get server details
//   PATCH  /servers/:id                     — Update server (owner only)
//   DELETE /servers/:id                     — Delete server (owner only)
//   POST   /servers/:id/join               — Join via invite code
//   POST   /servers/:id/leave              — Leave a server
//   GET    /servers/:id/members            — List server members
//   POST   /servers/:id/invites            — Create an invite
//   GET    /servers/:id/invites            — List active invites (owner/admin)

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_audit;
use crate::citadel_auth::AuthUser;
use crate::citadel_automod::{AutoModConfig, save_automod_config};
use crate::citadel_error::AppError;
use crate::citadel_permissions::Permission;
use crate::citadel_state::AppState;

// ─── Request Types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    /// Server name, 1-128 chars.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional icon URL.
    pub icon_url: Option<String>,
    /// Enable AutoMod with sensible defaults (default: true).
    #[serde(default = "default_true")]
    pub enable_automod: bool,
}

fn default_true() -> bool { true }

#[derive(Debug, Deserialize)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub default_notification_level: Option<String>,
    pub verification_level: Option<i32>,
    pub explicit_content_filter: Option<i32>,
    pub system_channel_id: Option<Uuid>,
    pub member_tab_label: Option<String>,
    pub slash_commands_enabled: Option<bool>,
    pub message_retention_days: Option<Option<i32>>,
    pub disappearing_messages_default: Option<Option<String>>,
    pub mention_everyone_role: Option<String>,
    pub mention_here_role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SetVanityCodeRequest {
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct JoinServerRequest {
    /// Invite code to join with.
    pub invite_code: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    /// Max number of uses (None = unlimited).
    pub max_uses: Option<i32>,
    /// Invite lifetime in seconds from now.
    /// Defaults to 604 800 (7 days) when omitted.
    /// Pass 0 explicitly to create a permanent (no-expiry) invite.
    pub max_age_seconds: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ListMembersQuery {
    /// Pagination: number of members per page (default 100, max 500).
    #[serde(default = "default_limit")]
    pub limit: i64,
    /// Pagination: offset.
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    100
}

// ─── Response Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ServerInfo {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub default_notification_level: String,
    pub verification_level: i32,
    pub explicit_content_filter: i32,
    pub system_channel_id: Option<Uuid>,
    pub vanity_code: Option<String>,
    pub member_tab_label: String,
    pub slash_commands_enabled: bool,
    pub message_retention_days: Option<i32>,
    pub disappearing_messages_default: Option<String>,
    pub last_activity_at: Option<String>,
    pub is_archived: bool,
    pub archived_at: Option<String>,
    pub scheduled_deletion_at: Option<String>,
    pub owner_id: Uuid,
    pub member_count: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct MemberInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub nickname: Option<String>,
    pub is_bot: bool,
    pub joined_at: String,
    pub notification_level: String,
    pub visibility_override: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InviteInfo {
    pub id: Uuid,
    pub code: String,
    pub created_by: Uuid,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub expires_at: Option<String>,
    pub created_at: String,
}


#[derive(Debug, Serialize)]
pub struct InviteResolutionInfo {
    pub server_id: Uuid,
    pub server_name: String,
    pub member_count: i64,
    pub icon_url: Option<String>,
}

// ─── POST /servers ──────────────────────────────────────────────────────

pub async fn create_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateServerRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Guests cannot create servers — must register first.
    let is_guest: bool = sqlx::query_scalar!(
        "SELECT is_guest FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if is_guest {
        return Err(AppError::Forbidden(
            "Guests cannot create servers. Register an account first (Settings → Profile → Upgrade).".into(),
        ));
    }

    // Tier limit: max servers per user.
    let user_tier = sqlx::query_scalar!(
        "SELECT account_tier FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;
    crate::discreet_tier_limits::check_server_create(&state.db, auth.user_id, &user_tier).await?;

    // Validate name.
    let name = req.name.trim().to_string();
    crate::discreet_input_validation::validate_server_name(&name)?;

    // Guard: prevent duplicate server creation (same name, same owner, within 10 seconds)
    let recent_dup = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE owner_id = $1 AND name = $2 AND created_at > NOW() - INTERVAL '10 seconds')",
        auth.user_id, name,
    )
    .fetch_one(&state.db)
    .await?;

    if recent_dup.unwrap_or(false) {
        return Err(AppError::BadRequest(
            "A server with this name was just created. Please wait a moment.".into(),
        ));
    }

    let server_id = Uuid::new_v4();

    // Create server.
    sqlx::query!(
        "INSERT INTO servers (id, name, description, icon_url, owner_id)
         VALUES ($1, $2, $3, $4, $5)",
        server_id,
        name,
        req.description,
        req.icon_url,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Auto-join owner as first member.
    sqlx::query!(
        "INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)",
        server_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Auto-create a #welcome text channel.
    let welcome_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO channels (id, server_id, name, channel_type, position)
         VALUES ($1, $2, 'welcome', 'text', 0)",
        welcome_id,
        server_id,
    )
    .execute(&state.db)
    .await?;

    // Auto-create a #general text channel.
    let channel_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO channels (id, server_id, name, channel_type, position)
         VALUES ($1, $2, 'general', 'text', 1)",
        channel_id,
        server_id,
    )
    .execute(&state.db)
    .await?;

    sqlx::query!(
        "UPDATE servers SET system_channel_id = $1, updated_at = NOW() WHERE id = $2",
        channel_id,
        server_id,
    )
    .execute(&state.db)
    .await?;

    // Auto-create the implicit @everyone role (position 0) with sensible defaults.
    sqlx::query!(
        "INSERT INTO roles (server_id, name, permissions, position)
         VALUES ($1, '@everyone', $2, 0)",
        server_id,
        Permission::EVERYONE_DEFAULT,
    )
    .execute(&state.db)
    .await?;

    // Auto-create preset hierarchy roles: Member (10), Veteran Member (25), Moderator (50)
    // Member: base permissions + can create invites
    let member_perms: i64 = Permission::VIEW_CHANNELS | Permission::SEND_MESSAGES
        | Permission::READ_HISTORY | Permission::ATTACH_FILES
        | Permission::CREATE_INVITES | Permission::CHANGE_NICKNAME
        | Permission::CONNECT_VOICE | Permission::SPEAK
        | Permission::SPAWN_AI;
    sqlx::query!(
        "INSERT INTO roles (server_id, name, color, permissions, position)
         VALUES ($1, 'Member', '#43b581', $2, 10)",
        server_id,
        member_perms,
    )
    .execute(&state.db)
    .await?;

    // Veteran Member: member perms + manage nicknames + priority speaker
    let veteran_perms: i64 = member_perms
        | Permission::MANAGE_NICKNAMES
        | Permission::PRIORITY_SPEAKER
        | Permission::MANAGE_INVITES;
    sqlx::query!(
        "INSERT INTO roles (server_id, name, color, permissions, position)
         VALUES ($1, 'Veteran', '#faa61a', $2, 25)",
        server_id,
        veteran_perms,
    )
    .execute(&state.db)
    .await?;

    // Moderator: veteran perms + kick/ban/manage messages/manage channels/manage roles/mute/move
    let mod_perms: i64 = veteran_perms
        | Permission::MANAGE_MESSAGES
        | Permission::KICK_MEMBERS
        | Permission::BAN_MEMBERS
        | Permission::MANAGE_CHANNELS
        | Permission::MANAGE_ROLES
        | Permission::MANAGE_AGENTS
        | Permission::MUTE_MEMBERS
        | Permission::MOVE_MEMBERS;
    sqlx::query!(
        "INSERT INTO roles (server_id, name, color, permissions, position)
         VALUES ($1, 'Moderator', '#e74c3c', $2, 50)",
        server_id,
        mod_perms,
    )
    .execute(&state.db)
    .await?;

    // Auto-enable AutoMod with sensible defaults.
    if req.enable_automod {
        let automod = AutoModConfig {
            enabled: true,
            bad_words: vec![
                "nigger".into(), "nigga".into(), "faggot".into(), "retard".into(),
                "kys".into(), "kill yourself".into(),
            ],
            spam_threshold_per_minute: 5,
            block_invites: true,
            block_links: false,
            max_mentions: 10,
            max_caps_percent: 0.8,
        };
        save_automod_config(&state.db, server_id, &automod).await.ok();
    }

    tracing::info!(
        server_id = %server_id,
        owner = %auth.user_id,
        name = %name,
        "Server created with #general channel and @everyone role"
    );

    Ok((
        StatusCode::CREATED,
        Json(ServerInfo {
            id: server_id,
            name,
            description: req.description,
            icon_url: req.icon_url,
            banner_url: None,
            default_notification_level: "all".into(),
            verification_level: 0,
            explicit_content_filter: 0,
            system_channel_id: Some(channel_id),
            vanity_code: None,
            member_tab_label: "Users".into(),
            slash_commands_enabled: true,
            message_retention_days: None,
            disappearing_messages_default: None,
            last_activity_at: Some(chrono::Utc::now().to_rfc3339()),
            is_archived: false,
            archived_at: None,
            scheduled_deletion_at: None,
            owner_id: auth.user_id,
            member_count: 1,
            created_at: chrono::Utc::now().to_rfc3339(),
        }),
    ))
}

// ─── GET /servers ───────────────────────────────────────────────────────

pub async fn list_servers(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT s.id, s.name, s.description, s.icon_url, s.banner_url, s.default_notification_level,
                s.verification_level, s.explicit_content_filter, s.system_channel_id, s.vanity_code,
                s.member_tab_label, s.slash_commands_enabled, s.message_retention_days,
                s.disappearing_messages_default, s.last_activity_at, s.is_archived,
                s.archived_at, s.scheduled_deletion_at, s.owner_id, s.created_at,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
         FROM servers s
         INNER JOIN server_members m ON m.server_id = s.id
         WHERE m.user_id = $1
         ORDER BY s.name",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let servers: Vec<ServerInfo> = rows
        .into_iter()
        .map(|r| ServerInfo {
            id: r.id,
            name: r.name,
            description: r.description,
            icon_url: r.icon_url,
            banner_url: r.banner_url,
            default_notification_level: r.default_notification_level.unwrap_or_else(|| "all".into()),
            verification_level: r.verification_level,
            explicit_content_filter: r.explicit_content_filter,
            system_channel_id: r.system_channel_id,
            vanity_code: r.vanity_code,
            member_tab_label: r.member_tab_label,
            slash_commands_enabled: r.slash_commands_enabled,
            message_retention_days: r.message_retention_days,
            disappearing_messages_default: r.disappearing_messages_default.clone(),
            last_activity_at: r.last_activity_at.map(|t| t.to_rfc3339()),
            is_archived: r.is_archived,
            archived_at: r.archived_at.map(|t| t.to_rfc3339()),
            scheduled_deletion_at: r.scheduled_deletion_at.map(|t| t.to_rfc3339()),
            owner_id: r.owner_id,
            member_count: r.member_count.unwrap_or(0),
            created_at: r.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(servers))
}

// ─── GET /servers/:id ───────────────────────────────────────────────────

pub async fn get_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Must be a member to view.
    require_membership(&state, server_id, auth.user_id).await?;

    let server = sqlx::query!(
        "SELECT s.id, s.name, s.description, s.icon_url, s.banner_url, s.default_notification_level,
                s.verification_level, s.explicit_content_filter, s.system_channel_id, s.vanity_code,
                s.member_tab_label, s.slash_commands_enabled, s.message_retention_days,
                s.disappearing_messages_default, s.last_activity_at, s.is_archived,
                s.archived_at, s.scheduled_deletion_at, s.owner_id, s.created_at,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
         FROM servers s
         WHERE s.id = $1",
        server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))?;

    Ok(Json(ServerInfo {
        id: server.id,
        name: server.name,
        description: server.description,
        icon_url: server.icon_url,
        banner_url: server.banner_url,
        default_notification_level: server.default_notification_level.unwrap_or_else(|| "all".into()),
        verification_level: server.verification_level,
        explicit_content_filter: server.explicit_content_filter,
        system_channel_id: server.system_channel_id,
        vanity_code: server.vanity_code,
        member_tab_label: server.member_tab_label,
        slash_commands_enabled: server.slash_commands_enabled,
        message_retention_days: server.message_retention_days,
        disappearing_messages_default: server.disappearing_messages_default,
        last_activity_at: server.last_activity_at.map(|t| t.to_rfc3339()),
        is_archived: server.is_archived,
        archived_at: server.archived_at.map(|t| t.to_rfc3339()),
        scheduled_deletion_at: server.scheduled_deletion_at.map(|t| t.to_rfc3339()),
        owner_id: server.owner_id,
        member_count: server.member_count.unwrap_or(0),
        created_at: server.created_at.to_rfc3339(),
    }))
}

// ─── PATCH /servers/:id ─────────────────────────────────────────────────

pub async fn update_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<UpdateServerRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Only owner can update.
    require_owner(&state, server_id, auth.user_id).await?;

    // Build dynamic update — only set provided fields.
    if let Some(ref name) = req.name {
        let name = name.trim();
        if name.is_empty() || name.len() > 128 {
            return Err(AppError::BadRequest(
                "Server name must be 1-128 characters".into(),
            ));
        }
        sqlx::query!(
            "UPDATE servers SET name = $1, updated_at = NOW() WHERE id = $2",
            name,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref desc) = req.description {
        sqlx::query!(
            "UPDATE servers SET description = $1, updated_at = NOW() WHERE id = $2",
            desc,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref icon) = req.icon_url {
        sqlx::query!(
            "UPDATE servers SET icon_url = $1, updated_at = NOW() WHERE id = $2",
            icon,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref banner) = req.banner_url {
        sqlx::query!(
            "UPDATE servers SET banner_url = $1, updated_at = NOW() WHERE id = $2",
            banner,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref level) = req.default_notification_level {
        if !matches!(level.as_str(), "all" | "mentions" | "nothing") {
            return Err(AppError::BadRequest(
                "default_notification_level must be one of: all, mentions, nothing".into(),
            ));
        }
        sqlx::query!(
            "UPDATE servers SET default_notification_level = $1, updated_at = NOW() WHERE id = $2",
            level,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(level) = req.verification_level {
        if !(0..=3).contains(&level) {
            return Err(AppError::BadRequest("verification_level must be between 0 and 3".into()));
        }
        sqlx::query!(
            "UPDATE servers SET verification_level = $1, updated_at = NOW() WHERE id = $2",
            level,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(filter) = req.explicit_content_filter {
        if !(0..=2).contains(&filter) {
            return Err(AppError::BadRequest(
                "explicit_content_filter must be between 0 and 2".into(),
            ));
        }
        sqlx::query!(
            "UPDATE servers SET explicit_content_filter = $1, updated_at = NOW() WHERE id = $2",
            filter,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(system_channel_id) = req.system_channel_id {
        let channel_exists = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1 AND server_id = $2)",
            system_channel_id,
            server_id,
        )
        .fetch_one(&state.db)
        .await?
        .unwrap_or(false);
        if !channel_exists {
            return Err(AppError::BadRequest(
                "system_channel_id must reference a channel in this server".into(),
            ));
        }
        sqlx::query!(
            "UPDATE servers SET system_channel_id = $1, updated_at = NOW() WHERE id = $2",
            system_channel_id,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref label) = req.member_tab_label {
        let label = label.trim();
        if label.is_empty() || label.len() > 32 {
            return Err(AppError::BadRequest(
                "member_tab_label must be 1-32 characters".into(),
            ));
        }
        sqlx::query!(
            "UPDATE servers SET member_tab_label = $1, updated_at = NOW() WHERE id = $2",
            label,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(enabled) = req.slash_commands_enabled {
        sqlx::query!(
            "UPDATE servers SET slash_commands_enabled = $1, updated_at = NOW() WHERE id = $2",
            enabled,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref retention) = req.message_retention_days {
        sqlx::query!(
            "UPDATE servers SET message_retention_days = $1, updated_at = NOW() WHERE id = $2",
            *retention,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref disappearing) = req.disappearing_messages_default {
        sqlx::query!(
            "UPDATE servers SET disappearing_messages_default = $1, updated_at = NOW() WHERE id = $2",
            disappearing.as_deref() as Option<&str>,
            server_id,
        )
        .execute(&state.db)
        .await?;
    }

    if let Some(ref role) = req.mention_everyone_role {
        if matches!(role.as_str(), "admin" | "moderator" | "everyone") {
            sqlx::query!("UPDATE servers SET mention_everyone_role = $1, updated_at = NOW() WHERE id = $2", role, server_id)
                .execute(&state.db).await?;
        }
    }
    if let Some(ref role) = req.mention_here_role {
        if matches!(role.as_str(), "admin" | "moderator" | "everyone") {
            sqlx::query!("UPDATE servers SET mention_here_role = $1, updated_at = NOW() WHERE id = $2", role, server_id)
                .execute(&state.db).await?;
        }
    }

    // Audit log
    let changes = serde_json::json!({
        "name": req.name, "description": req.description.is_some(),
        "icon_url": req.icon_url.is_some(), "banner_url": req.banner_url.is_some(),
        "notification_level": req.default_notification_level,
        "verification_level": req.verification_level,
        "member_tab_label": req.member_tab_label,
        "slash_commands_enabled": req.slash_commands_enabled,
        "message_retention_days": req.message_retention_days,
        "disappearing_messages_default": req.disappearing_messages_default,
        "mention_everyone_role": req.mention_everyone_role,
        "mention_here_role": req.mention_here_role,
    });
    let _ = citadel_audit::log_action(
        &state.db,
        citadel_audit::AuditEntry {
            server_id,
            actor_id: auth.user_id,
            action: "UPDATE_SERVER",
            target_type: Some("server"),
            target_id: Some(server_id),
            changes: Some(changes),
            reason: None,
        },
    ).await;

    // Return the updated server.
    let server = sqlx::query!(
        "SELECT id, name, description, icon_url, banner_url, default_notification_level,
                verification_level, explicit_content_filter, system_channel_id, vanity_code,
                member_tab_label, slash_commands_enabled, message_retention_days,
                disappearing_messages_default, last_activity_at, is_archived,
                archived_at, scheduled_deletion_at, owner_id, created_at,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = servers.id) AS member_count
         FROM servers WHERE id = $1",
        server_id,
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ServerInfo {
        id: server.id,
        name: server.name,
        description: server.description,
        icon_url: server.icon_url,
        banner_url: server.banner_url,
        default_notification_level: server.default_notification_level.unwrap_or_else(|| "all".into()),
        verification_level: server.verification_level,
        explicit_content_filter: server.explicit_content_filter,
        system_channel_id: server.system_channel_id,
        vanity_code: server.vanity_code,
        member_tab_label: server.member_tab_label,
        slash_commands_enabled: server.slash_commands_enabled,
        message_retention_days: server.message_retention_days,
        disappearing_messages_default: server.disappearing_messages_default,
        last_activity_at: server.last_activity_at.map(|t| t.to_rfc3339()),
        is_archived: server.is_archived,
        archived_at: server.archived_at.map(|t| t.to_rfc3339()),
        scheduled_deletion_at: server.scheduled_deletion_at.map(|t| t.to_rfc3339()),
        owner_id: server.owner_id,
        member_count: server.member_count.unwrap_or(0),
        created_at: server.created_at.to_rfc3339(),
    }))
}

// ─── DELETE /servers/:id ────────────────────────────────────────────────

pub async fn delete_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_owner(&state, server_id, auth.user_id).await?;

    // CASCADE deletes members, channels, messages, invites, bans, agents.
    let result = sqlx::query!(
        "DELETE FROM servers WHERE id = $1 AND owner_id = $2",
        server_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Server not found".into()));
    }

    tracing::info!(server_id = %server_id, owner = %auth.user_id, "Server deleted");

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /servers/:id/join ─────────────────────────────────────────────

pub async fn join_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<JoinServerRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Check if banned.
    let banned = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_bans WHERE server_id = $1 AND user_id = $2)",
        server_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if banned.unwrap_or(false) {
        return Err(AppError::Forbidden(
            "You are banned from this server".into(),
        ));
    }

    // Validate invite code.
    let invite = sqlx::query!(
        "SELECT id, max_uses, use_count, expires_at
         FROM server_invites
         WHERE server_id = $1 AND code = $2",
        server_id,
        req.invite_code,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Invalid invite code".into()))?;

    // Check if expired.
    if let Some(expires_at) = invite.expires_at {
        if expires_at < chrono::Utc::now() {
            return Err(AppError::Gone("Invite has expired".into()));
        }
    }

    // Check max uses.
    if let Some(max_uses) = invite.max_uses {
        if invite.use_count >= max_uses {
            return Err(AppError::Gone("Invite has reached maximum uses".into()));
        }
    }

    // Check already a member.
    let already_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if already_member.unwrap_or(false) {
        return Err(AppError::Conflict("Already a member of this server".into()));
    }

    // Tier limit: max members per server (based on server owner's tier).
    let owner_tier = sqlx::query_scalar!(
        "SELECT u.account_tier FROM servers s JOIN users u ON u.id = s.owner_id WHERE s.id = $1",
        server_id,
    )
    .fetch_one(&state.db)
    .await?;
    crate::discreet_tier_limits::check_member_join(&state.db, server_id, &owner_tier).await?;

    // Join.
    sqlx::query!(
        "INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)",
        server_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Increment invite use count and update last_activity_at.
    sqlx::query!(
        "UPDATE server_invites SET use_count = use_count + 1 WHERE id = $1",
        invite.id,
    )
    .execute(&state.db)
    .await?;

    let _ = sqlx::query!(
        "UPDATE servers SET last_activity_at = NOW() WHERE id = $1",
        server_id,
    )
    .execute(&state.db)
    .await;

    tracing::info!(server_id = %server_id, user_id = %auth.user_id, "User joined server");

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /servers/:id/leave ────────────────────────────────────────────

pub async fn leave_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Owner can't leave — must transfer ownership or delete.
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id,
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if is_owner.unwrap_or(false) {
        return Err(AppError::BadRequest(
            "Server owner cannot leave. Transfer ownership or delete the server.".into(),
        ));
    }

    let result = sqlx::query!(
        "DELETE FROM server_members WHERE server_id = $1 AND user_id = $2",
        server_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Not a member of this server".into()));
    }

    tracing::info!(server_id = %server_id, user_id = %auth.user_id, "User left server");

    Ok(StatusCode::NO_CONTENT)
}

// ─── GET /servers/:id/members ───────────────────────────────────────────

pub async fn list_members(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Query(params): Query<ListMembersQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    let limit = params.limit.clamp(1, 500);
    let offset = params.offset.max(0);

    let rows = sqlx::query!(
        "SELECT u.id AS user_id, u.username, u.display_name, u.is_bot, m.nickname, m.joined_at, m.notification_level, m.visibility_override
         FROM server_members m
         INNER JOIN users u ON u.id = m.user_id
         WHERE m.server_id = $1
         ORDER BY u.is_bot ASC, m.joined_at
         LIMIT $2 OFFSET $3",
        server_id,
        limit,
        offset,
    )
    .fetch_all(&state.db)
    .await?;

    let members: Vec<MemberInfo> = rows
        .into_iter()
        .map(|r| MemberInfo {
            user_id: r.user_id,
            username: r.username,
            display_name: r.display_name,
            nickname: r.nickname,
            is_bot: r.is_bot,
            joined_at: r.joined_at.to_rfc3339(),
            notification_level: r.notification_level,
            visibility_override: r.visibility_override,
        })
        .collect();

    Ok(Json(members))
}

// ─── PATCH /servers/:id/notification-level ──────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UpdateNotificationLevelRequest {
    pub notification_level: String,
}

/// PATCH /servers/:id/notification-level — set per-server notification preference.
pub async fn set_notification_level(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<UpdateNotificationLevelRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !matches!(req.notification_level.as_str(), "all" | "mentions" | "nothing") {
        return Err(AppError::BadRequest("notification_level must be 'all', 'mentions', or 'nothing'".into()));
    }

    let result = sqlx::query!(
        "UPDATE server_members SET notification_level = $1 WHERE server_id = $2 AND user_id = $3",
        req.notification_level,
        server_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Not a member of this server".into()));
    }

    Ok(Json(serde_json::json!({ "notification_level": req.notification_level })))
}

// ─── PATCH /servers/:id/visibility ──────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SetVisibilityRequest {
    /// null to clear override (use global), or "online"/"idle"/"invisible"
    pub visibility_override: Option<String>,
}

/// PATCH /servers/:id/visibility — set per-server online appearance.
pub async fn set_visibility_override(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<SetVisibilityRequest>,
) -> Result<impl IntoResponse, AppError> {
    if let Some(ref v) = req.visibility_override {
        if !matches!(v.as_str(), "online" | "idle" | "invisible") {
            return Err(AppError::BadRequest("visibility_override must be 'online', 'idle', 'invisible', or null".into()));
        }
    }

    let result = sqlx::query!(
        "UPDATE server_members SET visibility_override = $1 WHERE server_id = $2 AND user_id = $3",
        req.visibility_override,
        server_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Not a member of this server".into()));
    }

    // Re-broadcast presence so the override takes effect.
    // Read the user's actual global status from the presence map, then
    // set_presence will apply per-server overrides from the DB.
    let actual_status = {
        let map = state.presence.read().await;
        map.get(&auth.user_id)
            .map(|p| p.status.clone())
            .unwrap_or(crate::citadel_state::PresenceStatus::Online)
    };
    state.set_presence(auth.user_id, actual_status, server_id).await;

    Ok(Json(serde_json::json!({ "visibility_override": req.visibility_override })))
}

// ─── POST /servers/:id/invites ──────────────────────────────────────────

pub async fn create_invite(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateInviteRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Must be a member to create invites.
    require_membership(&state, server_id, auth.user_id).await?;

    let code = generate_invite_code();
    // Default: 7 days (604 800 s). Pass max_age_seconds = 0 for a permanent invite.
    let expires_at: Option<chrono::DateTime<chrono::Utc>> = match req.max_age_seconds {
        Some(0)    => None,
        Some(secs) => Some(chrono::Utc::now() + chrono::Duration::seconds(secs)),
        None       => Some(chrono::Utc::now() + chrono::Duration::seconds(604_800)),
    };

    sqlx::query!(
        "INSERT INTO server_invites (server_id, code, created_by, max_uses, expires_at)
         VALUES ($1, $2, $3, $4, $5)",
        server_id,
        code,
        auth.user_id,
        req.max_uses,
        expires_at,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(server_id = %server_id, code = %code, "Invite created");

    let _ = citadel_audit::log_action(
        &state.db,
        citadel_audit::AuditEntry {
            server_id,
            actor_id: auth.user_id,
            action: "CREATE_INVITE",
            target_type: Some("invite"),
            target_id: None,
            changes: Some(serde_json::json!({ "code": &code, "max_uses": req.max_uses })),
            reason: None,
        },
    ).await;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "code": code,
            "max_uses": req.max_uses,
            "expires_at": expires_at.map(|t| t.to_rfc3339()),
        })),
    ))
}

// ─── GET /servers/:id/invites ───────────────────────────────────────────

pub async fn list_invites(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Only owner can list all invites.
    require_owner(&state, server_id, auth.user_id).await?;

    let rows = sqlx::query!(
        "SELECT id, code, created_by, max_uses, use_count, expires_at, created_at
         FROM server_invites
         WHERE server_id = $1
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let invites: Vec<InviteInfo> = rows
        .into_iter()
        .map(|r| InviteInfo {
            id: r.id,
            code: r.code,
            created_by: r.created_by,
            max_uses: r.max_uses,
            use_count: r.use_count,
            expires_at: r.expires_at.map(|t| t.to_rfc3339()),
            created_at: r.created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(invites))
}

// ─── POST /servers/:id/vanity ───────────────────────────────────────────

pub async fn set_server_vanity(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<SetVanityCodeRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_owner(&state, server_id, auth.user_id).await?;

    let code = req.code.trim().to_ascii_lowercase();
    if code.len() < 3 || code.len() > 32 {
        return Err(AppError::BadRequest("Vanity code must be 3-32 characters".into()));
    }
    if !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::BadRequest(
            "Vanity code may only contain alphanumeric characters and hyphens".into(),
        ));
    }

    let existing = sqlx::query_scalar!(
        "SELECT id FROM servers WHERE vanity_code = $1 AND id <> $2",
        code,
        server_id,
    )
    .fetch_optional(&state.db)
    .await?;
    if existing.is_some() {
        return Err(AppError::Conflict("Vanity code is already in use".into()));
    }

    sqlx::query!(
        "UPDATE servers SET vanity_code = $1, updated_at = NOW() WHERE id = $2",
        code,
        server_id,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "vanity_code": code })))
}

// ─── GET /invites/:code ────────────────────────────────────────────────

pub async fn resolve_invite_code(
    State(state): State<Arc<AppState>>,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let invite_server = sqlx::query!(
        "SELECT s.id AS server_id, s.name AS server_name, s.icon_url,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
         FROM server_invites i
         INNER JOIN servers s ON s.id = i.server_id
         WHERE i.code = $1
           AND (i.expires_at IS NULL OR i.expires_at > NOW())
           AND (i.max_uses IS NULL OR i.use_count < i.max_uses)
         ORDER BY i.created_at DESC
         LIMIT 1",
        code,
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some(server) = invite_server {
        return Ok(Json(InviteResolutionInfo {
            server_id: server.server_id,
            server_name: server.server_name,
            member_count: server.member_count.unwrap_or(0),
            icon_url: server.icon_url,
        }));
    }

    let vanity_server = sqlx::query!(
        "SELECT s.id AS server_id, s.name AS server_name, s.icon_url,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
         FROM servers s
         WHERE s.vanity_code = $1",
        code.to_ascii_lowercase(),
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Invite code not found".into()))?;

    Ok(Json(InviteResolutionInfo {
        server_id: vanity_server.server_id,
        server_name: vanity_server.server_name,
        member_count: vanity_server.member_count.unwrap_or(0),
        icon_url: vanity_server.icon_url,
    }))
}

// ─── Helpers ────────────────────────────────────────────────────────────

/// Verify user is a member of the server. Returns Forbidden if not.
async fn require_membership(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let is_member = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
        server_id,
        user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_member.unwrap_or(false) {
        return Err(AppError::Forbidden("Not a member of this server".into()));
    }
    Ok(())
}

/// Verify user is the server owner. Returns Forbidden if not.
async fn require_owner(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<(), AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id,
        user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !is_owner.unwrap_or(false) {
        return Err(AppError::Forbidden(
            "Only the server owner can do this".into(),
        ));
    }
    Ok(())
}

/// Generate a random 8-character alphanumeric invite code.
fn generate_invite_code() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

// ─── PUT /servers/:id/members/:user_id/nickname ────────────────────────

#[derive(Debug, Deserialize)]
pub struct SetNicknameRequest {
    pub nickname: Option<String>,
}

/// Set or clear a member's server nickname.
///
/// - Own nickname: requires CHANGE_NICKNAME permission.
/// - Other's nickname: requires MANAGE_NICKNAMES permission.
/// - Setting nickname to `null` or empty string clears it.
pub async fn set_nickname(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<SetNicknameRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Check permissions: own nick vs others' nicks.
    if target_user_id == auth.user_id {
        crate::citadel_permissions::require_permission(
            &state, server_id, auth.user_id, Permission::CHANGE_NICKNAME,
        ).await?;
    } else {
        crate::citadel_permissions::require_permission(
            &state, server_id, auth.user_id, Permission::MANAGE_NICKNAMES,
        ).await?;
    }

    // Validate nickname length.
    let nickname = req.nickname
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    if let Some(ref n) = nickname {
        if n.len() > 64 {
            return Err(AppError::BadRequest("Nickname must be 64 characters or less".into()));
        }
    }

    // Update server_members row.
    let result = sqlx::query!(
        "UPDATE server_members SET nickname = $1 WHERE server_id = $2 AND user_id = $3",
        nickname.as_deref(),
        server_id,
        target_user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Member not found".into()));
    }

    // Broadcast nickname change to server members.
    state.ws_broadcast(server_id, serde_json::json!({
        "type": "member_update",
        "server_id": server_id,
        "user_id": target_user_id,
        "nickname": nickname,
    })).await;

    Ok(Json(serde_json::json!({
        "user_id": target_user_id,
        "nickname": nickname,
    })))
}

// ─── GET /servers/:id/members/search?q=... ─────────────────────────────

/// Search server members by username, display name, or nickname.
pub async fn search_members(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Query(params): Query<SearchMembersQuery>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    let q = params.q.trim().to_lowercase();
    if q.is_empty() || q.len() < 2 {
        return Err(AppError::BadRequest("Search query must be at least 2 characters".into()));
    }

    let pattern = format!("%{}%", q);
    let rows = sqlx::query!(
        "SELECT u.id AS user_id, u.username, u.display_name, u.is_bot, m.nickname, m.joined_at, m.notification_level, m.visibility_override
         FROM server_members m
         INNER JOIN users u ON u.id = m.user_id
         WHERE m.server_id = $1
           AND (LOWER(u.username) LIKE $2 OR LOWER(u.display_name) LIKE $2 OR LOWER(m.nickname) LIKE $2)
         ORDER BY u.username
         LIMIT 25",
        server_id,
        pattern,
    )
    .fetch_all(&state.db)
    .await?;

    let members: Vec<MemberInfo> = rows
        .into_iter()
        .map(|r| MemberInfo {
            user_id: r.user_id,
            username: r.username,
            display_name: r.display_name,
            nickname: r.nickname,
            is_bot: r.is_bot,
            joined_at: r.joined_at.to_rfc3339(),
            notification_level: r.notification_level,
            visibility_override: r.visibility_override,
        })
        .collect();

    Ok(Json(members))
}

#[derive(Debug, Deserialize)]
pub struct SearchMembersQuery {
    #[serde(default)]
    pub q: String,
}

// ─── POST /servers/:id/bots ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateBotRequest {
    pub username: String,
    pub display_name: String,
    pub persona: String,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(default = "default_mention")]
    pub trigger_mode: String,
}

fn default_mention() -> String { "mention".into() }

#[derive(Debug, Serialize)]
pub struct BotInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub persona: String,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    pub trigger_mode: String,
}

/// Create a bot user and add it to the server as a member.
/// Bots appear in the member list just like human users but with is_bot=true.
pub async fn create_bot(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateBotRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_owner(&state, server_id, auth.user_id).await?;

    let username = req.username.trim().to_lowercase().replace(' ', "-");
    if username.is_empty() || username.len() > 64 {
        return Err(AppError::BadRequest("Bot username must be 1-64 characters".into()));
    }

    // Create a user record for the bot (no password hash — bots can't log in).
    let bot_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO users (id, username, display_name, email, password_hash, is_bot, bot_persona)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)",
        bot_id,
        format!("{}#{}", username, &bot_id.to_string()[..4]),
        req.display_name.trim(),
        format!("bot-{}@discreet.local", bot_id),
        "BOT_NO_LOGIN",
        serde_json::json!({
            "persona": req.persona,
            "description": req.description,
            "trigger_mode": req.trigger_mode,
        }),
    )
    .execute(&state.db)
    .await?;

    // Add bot to the server as a member.
    sqlx::query!(
        "INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)
         ON CONFLICT (server_id, user_id) DO NOTHING",
        server_id,
        bot_id,
    )
    .execute(&state.db)
    .await?;

    // Track in server_bots table.
    sqlx::query!(
        "INSERT INTO server_bots (server_id, user_id, persona, description, avatar_url, trigger_mode)
         VALUES ($1, $2, $3, $4, $5, $6)",
        server_id,
        bot_id,
        req.persona.trim(),
        req.description.as_deref(),
        req.avatar_url.as_deref(),
        req.trigger_mode.as_str(),
    )
    .execute(&state.db)
    .await?;

    tracing::info!(
        bot_id = %bot_id,
        server_id = %server_id,
        persona = %req.persona,
        "Bot created and added to server"
    );

    Ok((
        StatusCode::CREATED,
        Json(BotInfo {
            user_id: bot_id,
            username: format!("{}#{}", username, &bot_id.to_string()[..4]),
            display_name: req.display_name,
            persona: req.persona,
            description: req.description,
            avatar_url: req.avatar_url,
            trigger_mode: req.trigger_mode,
        }),
    ))
}

// ─── GET /servers/:id/bots ─────────────────────────────────────────────

pub async fn list_bots(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    require_membership(&state, server_id, auth.user_id).await?;

    let rows = sqlx::query!(
        "SELECT sb.user_id, u.username, u.display_name, sb.persona, sb.description, sb.avatar_url, sb.trigger_mode
         FROM server_bots sb
         INNER JOIN users u ON u.id = sb.user_id
         WHERE sb.server_id = $1
         ORDER BY sb.created_at",
        server_id,
    )
    .fetch_all(&state.db)
    .await?;

    let bots: Vec<BotInfo> = rows
        .into_iter()
        .map(|r| BotInfo {
            user_id: r.user_id,
            username: r.username,
            display_name: r.display_name.unwrap_or_default(),
            persona: r.persona,
            description: r.description,
            avatar_url: r.avatar_url,
            trigger_mode: r.trigger_mode,
        })
        .collect();

    Ok(Json(bots))
}

// ─── POST /servers/:id/archive ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ArchiveRequest {
    /// true = archive, false = unarchive.
    pub archive: bool,
}

pub async fn archive_server(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<ArchiveRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_owner(&state, server_id, auth.user_id).await?;

    if req.archive {
        sqlx::query!(
            "UPDATE servers SET is_archived = TRUE, archived_at = NOW(), updated_at = NOW() WHERE id = $1",
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: auth.user_id,
                action: "SERVER_ARCHIVED",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: None,
                reason: None,
            },
        ).await;

        tracing::info!(server_id = %server_id, "Server archived by owner");
    } else {
        // Unarchive also cancels any scheduled deletion.
        sqlx::query!(
            "UPDATE servers SET is_archived = FALSE, archived_at = NULL, scheduled_deletion_at = NULL, updated_at = NOW() WHERE id = $1",
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: auth.user_id,
                action: "SERVER_UNARCHIVED",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: None,
                reason: None,
            },
        ).await;

        tracing::info!(server_id = %server_id, "Server unarchived by owner");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /servers/:id/schedule-deletion ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ScheduleDeletionRequest {
    /// true = schedule 30-day deletion, false = cancel.
    pub schedule: bool,
}

pub async fn schedule_server_deletion(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<ScheduleDeletionRequest>,
) -> Result<impl IntoResponse, AppError> {
    require_owner(&state, server_id, auth.user_id).await?;

    if req.schedule {
        let deletion_at = chrono::Utc::now() + chrono::Duration::days(30);
        sqlx::query!(
            "UPDATE servers SET scheduled_deletion_at = $1, is_archived = TRUE, archived_at = COALESCE(archived_at, NOW()), updated_at = NOW() WHERE id = $2",
            deletion_at,
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: auth.user_id,
                action: "SERVER_DELETION_SCHEDULED",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: Some(serde_json::json!({ "deletion_at": deletion_at.to_rfc3339() })),
                reason: None,
            },
        ).await;

        tracing::info!(server_id = %server_id, deletion_at = %deletion_at, "Server deletion scheduled");
    } else {
        sqlx::query!(
            "UPDATE servers SET scheduled_deletion_at = NULL, updated_at = NOW() WHERE id = $1",
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: auth.user_id,
                action: "SERVER_DELETION_CANCELLED",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: None,
                reason: None,
            },
        ).await;

        tracing::info!(server_id = %server_id, "Server deletion cancelled");
    }

    Ok(StatusCode::NO_CONTENT)
}

// ─── GET /admin/inactive-servers ────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct InactiveServersQuery {
    /// Minimum days idle to include (default 30).
    #[serde(default = "default_inactive_days")]
    pub days: i64,
}

fn default_inactive_days() -> i64 { 30 }

#[derive(Debug, Serialize)]
pub struct InactiveServerInfo {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub owner_username: String,
    pub member_count: i64,
    pub last_activity_at: String,
    pub days_idle: i64,
    pub is_archived: bool,
    pub scheduled_deletion_at: Option<String>,
}

pub async fn list_inactive_servers(
    caller: crate::citadel_platform_permissions::PlatformUser,
    State(state): State<Arc<AppState>>,
    Query(params): Query<InactiveServersQuery>,
) -> Result<impl IntoResponse, AppError> {
    crate::citadel_platform_admin_handlers::require_staff_role(&caller)?;

    let days = params.days.clamp(1, 365) as i32;

    let rows = sqlx::query!(
        "SELECT s.id, s.name, s.owner_id, u.username AS owner_username,
                s.last_activity_at, s.is_archived, s.scheduled_deletion_at,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count
         FROM servers s
         JOIN users u ON u.id = s.owner_id
         WHERE s.last_activity_at < NOW() - make_interval(days => $1)
         ORDER BY s.last_activity_at ASC",
        days,
    )
    .fetch_all(&state.db)
    .await?;

    let servers: Vec<InactiveServerInfo> = rows
        .into_iter()
        .map(|r| {
            let last_at = r.last_activity_at.unwrap_or_else(|| chrono::Utc::now().naive_utc().and_utc());
            let idle = (chrono::Utc::now() - last_at).num_days();
            InactiveServerInfo {
                id: r.id,
                name: r.name,
                owner_id: r.owner_id,
                owner_username: r.owner_username,
                member_count: r.member_count.unwrap_or(0),
                last_activity_at: last_at.to_rfc3339(),
                days_idle: idle,
                is_archived: r.is_archived,
                scheduled_deletion_at: r.scheduled_deletion_at.map(|t| t.to_rfc3339()),
            }
        })
        .collect();

    Ok(Json(servers))
}

// ─── POST /admin/servers/:id/archive (admin override) ───────────────────

pub async fn admin_archive_server(
    caller: crate::citadel_platform_permissions::PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<ArchiveRequest>,
) -> Result<impl IntoResponse, AppError> {
    crate::citadel_platform_admin_handlers::require_staff_role(&caller)?;

    if req.archive {
        sqlx::query!(
            "UPDATE servers SET is_archived = TRUE, archived_at = NOW(), updated_at = NOW() WHERE id = $1",
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: caller.user_id,
                action: "SERVER_ARCHIVED_BY_ADMIN",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: None,
                reason: None,
            },
        ).await;
    } else {
        sqlx::query!(
            "UPDATE servers SET is_archived = FALSE, archived_at = NULL, scheduled_deletion_at = NULL, updated_at = NOW() WHERE id = $1",
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: caller.user_id,
                action: "SERVER_UNARCHIVED_BY_ADMIN",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: None,
                reason: None,
            },
        ).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /admin/servers/:id/schedule-deletion (admin override) ─────────

pub async fn admin_schedule_deletion(
    caller: crate::citadel_platform_permissions::PlatformUser,
    State(state): State<Arc<AppState>>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<ScheduleDeletionRequest>,
) -> Result<impl IntoResponse, AppError> {
    crate::citadel_platform_admin_handlers::require_staff_role(&caller)?;

    if req.schedule {
        let deletion_at = chrono::Utc::now() + chrono::Duration::days(30);
        sqlx::query!(
            "UPDATE servers SET scheduled_deletion_at = $1, is_archived = TRUE, archived_at = COALESCE(archived_at, NOW()), updated_at = NOW() WHERE id = $2",
            deletion_at,
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: caller.user_id,
                action: "SERVER_DELETION_SCHEDULED_BY_ADMIN",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: Some(serde_json::json!({ "deletion_at": deletion_at.to_rfc3339() })),
                reason: None,
            },
        ).await;
    } else {
        sqlx::query!(
            "UPDATE servers SET scheduled_deletion_at = NULL, updated_at = NOW() WHERE id = $1",
            server_id,
        )
        .execute(&state.db)
        .await?;

        let _ = citadel_audit::log_action(
            &state.db,
            citadel_audit::AuditEntry {
                server_id,
                actor_id: caller.user_id,
                action: "SERVER_DELETION_CANCELLED_BY_ADMIN",
                target_type: Some("server"),
                target_id: Some(server_id),
                changes: None,
                reason: None,
            },
        ).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

// ─── Route Registration ─────────────────────────────────────────────────

pub fn server_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{delete, get, patch, post};
    axum::Router::new()
        .route("/servers", post(create_server))
        .route("/servers", get(list_servers))
        .route("/servers/:id", get(get_server))
        .route("/servers/:id", patch(update_server))
        .route("/servers/:id", delete(delete_server))
        .route("/servers/:id/join", post(join_server))
        .route("/servers/:id/leave", post(leave_server))
        .route("/servers/:id/members", get(list_members))
        .route("/servers/:id/members/search", get(search_members))
        .route("/servers/:id/invites", post(create_invite))
        .route("/servers/:id/invites", get(list_invites))
        .route("/servers/:id/vanity", post(set_server_vanity))
        .route("/servers/:id/bots", post(create_bot))
        .route("/servers/:id/bots", get(list_bots))
        .route("/servers/:id/archive", post(archive_server))
        .route("/servers/:id/schedule-deletion", post(schedule_server_deletion))
        .route("/invites/:code", get(resolve_invite_code))
}

pub fn server_admin_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/admin/inactive-servers", get(list_inactive_servers))
        .route("/admin/servers/:id/archive", post(admin_archive_server))
        .route("/admin/servers/:id/schedule-deletion", post(admin_schedule_deletion))
}
