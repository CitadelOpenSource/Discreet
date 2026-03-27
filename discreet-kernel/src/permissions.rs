use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use typeshare::typeshare;

// ─── Permission bitfield constants ──────────────────────────────────────────

/// Permission bits matching the server's role permission system.
pub const SEND_MESSAGES: u64 = 1 << 0;
pub const READ_MESSAGES: u64 = 1 << 1;
pub const EMBED_LINKS: u64 = 1 << 2;
pub const ATTACH_FILES: u64 = 1 << 3;
pub const MANAGE_MESSAGES: u64 = 1 << 4;
pub const ADD_REACTIONS: u64 = 1 << 5;
pub const MENTION_EVERYONE: u64 = 1 << 6;
pub const MANAGE_CHANNELS: u64 = 1 << 7;
pub const MANAGE_SERVER: u64 = 1 << 8;
pub const KICK_MEMBERS: u64 = 1 << 9;
pub const BAN_MEMBERS: u64 = 1 << 10;
pub const CREATE_INVITES: u64 = 1 << 11;
pub const MANAGE_ROLES: u64 = 1 << 12;

// ─── Per-message capability set ─────────────────────────────────────────────

/// Per-message capabilities. UI shows/hides actions based on these.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilitySet {
    pub can_reply: bool,
    pub can_edit: bool,
    pub can_delete: bool,
    pub can_forward: bool,
    pub can_react: bool,
    pub can_pin: bool,
    pub can_report: bool,
    pub can_start_thread: bool,
    pub can_mention_everyone: bool,
}

impl Default for CapabilitySet {
    fn default() -> Self {
        Self {
            can_reply: true,
            can_edit: false,
            can_delete: false,
            can_forward: true,
            can_react: true,
            can_pin: false,
            can_report: false,
            can_start_thread: true,
            can_mention_everyone: false,
        }
    }
}

/// Compute per-message capabilities from the user's permission bitfield.
///
/// - `user_id`: the current viewer
/// - `message_author_id`: who wrote the message
/// - `user_permissions`: bitfield from the server (role-based)
/// - `_channel_flags`: reserved for channel-level overrides (read-only channels, etc.)
pub fn compute_capabilities(
    user_id: &str,
    message_author_id: &str,
    user_permissions: u64,
    _channel_flags: u64,
) -> CapabilitySet {
    let is_author = user_id == message_author_id;
    let can_manage = user_permissions & MANAGE_MESSAGES != 0;

    CapabilitySet {
        can_edit: is_author,
        can_delete: is_author || can_manage,
        can_reply: user_permissions & SEND_MESSAGES != 0,
        can_react: user_permissions & ADD_REACTIONS != 0,
        can_pin: can_manage,
        can_forward: true,
        can_report: !is_author,
        can_start_thread: user_permissions & SEND_MESSAGES != 0,
        can_mention_everyone: user_permissions & MENTION_EVERYONE != 0,
    }
}

// ─── Internal permission cache ──────────────────────────────────────────────

/// Internal permission set cached per user-channel pair.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionSet {
    pub roles: Vec<String>,
    pub overrides: HashMap<String, bool>,
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn author_can_edit_own_message() {
        let caps = compute_capabilities("user1", "user1", SEND_MESSAGES, 0);
        assert!(caps.can_edit);
        assert!(caps.can_delete); // Author can always delete own
    }

    #[test]
    fn non_author_cannot_edit() {
        let caps = compute_capabilities("user1", "user2", SEND_MESSAGES, 0);
        assert!(!caps.can_edit);
    }

    #[test]
    fn admin_can_delete_any_message() {
        let caps = compute_capabilities("admin", "user2", MANAGE_MESSAGES | SEND_MESSAGES, 0);
        assert!(caps.can_delete);
        assert!(!caps.can_edit); // Can't edit others' messages even as admin
        assert!(caps.can_pin);
    }

    #[test]
    fn regular_user_cannot_pin() {
        let caps = compute_capabilities("user1", "user2", SEND_MESSAGES, 0);
        assert!(!caps.can_pin);
    }

    #[test]
    fn no_send_means_no_reply() {
        let caps = compute_capabilities("user1", "user2", 0, 0);
        assert!(!caps.can_reply);
        assert!(!caps.can_start_thread);
    }

    #[test]
    fn cannot_report_own_message() {
        let caps = compute_capabilities("user1", "user1", SEND_MESSAGES, 0);
        assert!(!caps.can_report);
    }

    #[test]
    fn can_report_others_message() {
        let caps = compute_capabilities("user1", "user2", SEND_MESSAGES, 0);
        assert!(caps.can_report);
    }

    #[test]
    fn mention_everyone_requires_permission() {
        let without = compute_capabilities("user1", "user1", SEND_MESSAGES, 0);
        assert!(!without.can_mention_everyone);

        let with = compute_capabilities("user1", "user1", SEND_MESSAGES | MENTION_EVERYONE, 0);
        assert!(with.can_mention_everyone);
    }

    #[test]
    fn full_permissions_bitfield() {
        let all = SEND_MESSAGES | MANAGE_MESSAGES | ADD_REACTIONS | MENTION_EVERYONE;
        let caps = compute_capabilities("admin", "user2", all, 0);
        assert!(caps.can_reply);
        assert!(caps.can_delete);
        assert!(caps.can_react);
        assert!(caps.can_pin);
        assert!(caps.can_mention_everyone);
        assert!(!caps.can_edit); // Not the author
        assert!(caps.can_report);
        assert!(caps.can_forward);
    }
}
