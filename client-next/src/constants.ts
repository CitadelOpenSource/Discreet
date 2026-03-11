/**
 * Permission bitflags — matches the Rust backend (src/citadel_permissions.rs).
 * 
 * Each permission is a power-of-2 bit that can be combined with bitwise OR.
 * A role's `permissions` field is the OR of all its granted permissions.
 */

// ── Permission Bits ──
export const P = {
  // General
  VIEW_CHANNELS:    1 << 0,
  SEND_MESSAGES:    1 << 1,
  READ_HISTORY:     1 << 2,
  ATTACH_FILES:     1 << 3,
  CREATE_INVITES:   1 << 4,
  CHANGE_NICKNAME:  1 << 5,

  // Moderation
  MANAGE_MSG:       1 << 10,
  KICK:             1 << 11,
  BAN:              1 << 12,
  MANAGE_NICKNAMES: 1 << 13,

  // Administration
  MANAGE_CH:        1 << 20,
  MANAGE_ROLES:     1 << 21,
  MANAGE_SERVER:    1 << 22,
  MANAGE_INVITES:   1 << 23,
  MANAGE_AGENTS:    1 << 24,
  SPAWN_AI:         1 << 25,
  USE_NSFW_AI:      1 << 26,

  // Voice
  CONNECT_VOICE:    1 << 30,
  SPEAK:            1 << 31,
  MUTE_MEMBERS:     2 ** 32, // Note: 1<<32 overflows in JS, use 2**32
  MOVE_MEMBERS:     2 ** 33,
  PRIORITY_SPEAKER: 2 ** 34,

  // Dangerous
  ADMIN:            2 ** 40,
  DELETE_SERVER:     2 ** 41,
} as const;

/** Human-readable permission labels grouped by category. */
export const PERM_LABELS = [
  { bit: 1 << 0,  label: 'View Channels',     cat: 'General' },
  { bit: 1 << 1,  label: 'Send Messages',     cat: 'General' },
  { bit: 1 << 2,  label: 'Read History',       cat: 'General' },
  { bit: 1 << 3,  label: 'Attach Files',       cat: 'General' },
  { bit: 1 << 4,  label: 'Create Invites',     cat: 'General' },
  { bit: 1 << 5,  label: 'Change Nickname',    cat: 'General' },
  { bit: 1 << 10, label: 'Manage Messages',    cat: 'Moderation' },
  { bit: 1 << 11, label: 'Kick Members',       cat: 'Moderation' },
  { bit: 1 << 12, label: 'Ban Members',        cat: 'Moderation' },
  { bit: 1 << 13, label: 'Manage Nicknames',   cat: 'Moderation' },
  { bit: 1 << 20, label: 'Manage Channels',    cat: 'Admin' },
  { bit: 1 << 21, label: 'Manage Roles',       cat: 'Admin' },
  { bit: 1 << 22, label: 'Manage Server',      cat: 'Admin' },
  { bit: 1 << 23, label: 'Manage Invites',     cat: 'Admin' },
  { bit: 1 << 24, label: 'Manage AI Agents',   cat: 'Admin' },
  { bit: 2 ** 30, label: 'Connect Voice',      cat: 'Voice' },
  { bit: 2 ** 31, label: 'Speak',              cat: 'Voice' },
  { bit: 2 ** 32, label: 'Mute Members',       cat: 'Voice' },
  { bit: 2 ** 33, label: 'Move Members',       cat: 'Voice' },
  { bit: 2 ** 34, label: 'Priority Speaker',   cat: 'Voice' },
  { bit: 2 ** 40, label: 'Administrator',       cat: 'Dangerous' },
  { bit: 2 ** 41, label: 'Delete Server',       cat: 'Dangerous' },
];

/** Check if a permission set includes a specific permission bit. */
export function hasPerm(perms: number, bit: number): boolean {
  // Administrator bypasses everything
  if (perms & P.ADMIN) return true;
  return (perms & bit) !== 0;
}

/** Preset role hierarchy — auto-created on server creation. */
export const PRESET_ROLES = [
  { name: '@everyone', position: 0,  color: null },
  { name: 'Member',    position: 10, color: '#43b581' },
  { name: 'Veteran',   position: 25, color: '#faa61a' },
  { name: 'Moderator', position: 50, color: '#e74c3c' },
  // Owner is implicit — position 999, not stored as a role
];
