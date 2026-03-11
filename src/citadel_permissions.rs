// citadel_permissions.rs — Server-scoped RBAC with BIGINT bitflags.
//
// Each role stores a `permissions: BIGINT` column. Individual bits
// represent capabilities. Users inherit permissions from all their roles
// via bitwise OR. The server owner implicitly has all permissions.
//
// Usage in handlers:
//   require_permission(&state, server_id, user_id, Permission::MANAGE_CHANNELS).await?;

use uuid::Uuid;

use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

// ─── Permission Bits ────────────────────────────────────────────────────

/// Permission bit constants stored as i64 (maps to Postgres BIGINT).
#[allow(non_snake_case)]
pub mod Permission {
    // ── General ──
    pub const VIEW_CHANNELS: i64      = 1 << 0;   // See channel list
    pub const SEND_MESSAGES: i64      = 1 << 1;   // Send messages in text channels
    pub const READ_HISTORY: i64       = 1 << 2;   // Read message history
    pub const ATTACH_FILES: i64       = 1 << 3;   // Upload file blobs
    pub const CREATE_INVITES: i64     = 1 << 4;   // Generate invite codes
    pub const CHANGE_NICKNAME: i64    = 1 << 5;   // Change own nickname

    // ── Moderation ──
    pub const MANAGE_MESSAGES: i64    = 1 << 10;  // Delete others' messages
    pub const KICK_MEMBERS: i64       = 1 << 11;  // Remove members
    pub const BAN_MEMBERS: i64        = 1 << 12;  // Ban members
    pub const MANAGE_NICKNAMES: i64   = 1 << 13;  // Change others' nicknames

    // ── Administration ──
    pub const MANAGE_CHANNELS: i64    = 1 << 20;  // Create/edit/delete channels
    pub const MANAGE_ROLES: i64       = 1 << 21;  // Create/edit/delete roles + assign
    pub const MANAGE_SERVER: i64      = 1 << 22;  // Edit server name/description/icon
    pub const MANAGE_INVITES: i64     = 1 << 23;  // View/revoke all invites
    pub const MANAGE_AGENTS: i64      = 1 << 24;  // Configure/remove AI agents (admin)
    pub const SPAWN_AI: i64           = 1 << 25;  // Spawn personal AI bot channels (member)
    pub const USE_NSFW_AI: i64        = 1 << 26;  // Access NSFW AI bots (must be enabled per-server)

    // ── Voice (future) ──
    pub const CONNECT_VOICE: i64      = 1 << 30;  // Join voice channels
    pub const SPEAK: i64              = 1 << 31;  // Speak in voice channels
    pub const MUTE_MEMBERS: i64       = 1 << 32;  // Server-mute others
    pub const MOVE_MEMBERS: i64       = 1 << 33;  // Drag users between voice channels
    pub const PRIORITY_SPEAKER: i64   = 1 << 34;  // Priority speaker in voice

    // ── Dangerous ──
    pub const ADMINISTRATOR: i64      = 1 << 40;  // Bypasses all permission checks
    pub const DELETE_SERVER: i64       = 1 << 41;  // Can delete the server (owner can delegate)

    /// Default permissions for `@everyone` role — sensible baseline.
    /// SPAWN_AI is ON by default (everyone can talk to bots).
    /// USE_NSFW_AI is OFF by default (must be explicitly granted).
    pub const EVERYONE_DEFAULT: i64 =
        VIEW_CHANNELS | SEND_MESSAGES | READ_HISTORY | ATTACH_FILES
        | CREATE_INVITES | CHANGE_NICKNAME | CONNECT_VOICE | SPEAK
        | SPAWN_AI;
}

// ─── Permission Checking ────────────────────────────────────────────────

/// Check if a user has a specific permission on a server.
///
/// Resolution order:
/// 1. Server owner → always has all permissions.
/// 2. User has ADMINISTRATOR bit on any role → all permissions.
/// 3. Bitwise OR of all the user's role permissions → check target bit.
/// 4. Fall back to the `@everyone` role (position=0) for that server.
pub async fn check_permission(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
    required: i64,
) -> Result<bool, AppError> {
    // 1. Is this the server owner?
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if is_owner.unwrap_or(false) {
        return Ok(true);
    }

    // 2-3. OR together all assigned role permissions.
    let assigned = sqlx::query_scalar!(
        "SELECT COALESCE(BIT_OR(r.permissions), 0)
         FROM member_roles mr
         INNER JOIN roles r ON r.id = mr.role_id
         WHERE mr.server_id = $1 AND mr.user_id = $2",
        server_id, user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    // 4. Always include the @everyone role (position=0).
    let everyone = sqlx::query_scalar!(
        "SELECT COALESCE(permissions, 0)
         FROM roles
         WHERE server_id = $1 AND position = 0
         LIMIT 1",
        server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .flatten()
    .unwrap_or(0);

    let effective = assigned | everyone;
    if effective & Permission::ADMINISTRATOR != 0 {
        return Ok(true);
    }

    Ok(effective & required == required)
}

/// Convenience wrapper that returns `Err(Forbidden)` if check fails.
pub async fn require_permission(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
    required: i64,
) -> Result<(), AppError> {
    if !check_permission(state, server_id, user_id, required).await? {
        return Err(AppError::Forbidden("You lack the required permission".into()));
    }
    Ok(())
}

/// Get the effective permissions for a user on a server (for introspection).
pub async fn effective_permissions(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<i64, AppError> {
    let is_owner = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)",
        server_id, user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if is_owner.unwrap_or(false) {
        return Ok(i64::MAX); // Owner has everything
    }

    let assigned = sqlx::query_scalar!(
        "SELECT COALESCE(BIT_OR(r.permissions), 0)
         FROM member_roles mr
         INNER JOIN roles r ON r.id = mr.role_id
         WHERE mr.server_id = $1 AND mr.user_id = $2",
        server_id, user_id,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    let everyone = sqlx::query_scalar!(
        "SELECT COALESCE(permissions, 0) FROM roles
         WHERE server_id = $1 AND position = 0 LIMIT 1",
        server_id,
    )
    .fetch_optional(&state.db)
    .await?
    .flatten()
    .unwrap_or(0);

    Ok(assigned | everyone)
}

// ─── Convenience Aliases ────────────────────────────────────────────────
// Some handler files import these directly instead of Permission::*.

pub const PERM_VIEW_CHANNEL: i64 = Permission::VIEW_CHANNELS;
pub const PERM_SEND_MESSAGES: i64 = Permission::SEND_MESSAGES;
pub const PERM_ATTACH_FILES: i64 = Permission::ATTACH_FILES;
pub const PERM_MANAGE_CHANNELS: i64 = Permission::MANAGE_CHANNELS;
pub const PERM_MANAGE_MESSAGES: i64 = Permission::MANAGE_MESSAGES;
pub const PERM_USE_AGENTS: i64 = Permission::MANAGE_AGENTS;
