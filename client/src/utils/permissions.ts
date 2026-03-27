/**
 * permissions.ts — privilege level system for Discreet.
 *
 * Privilege levels sit above the bitflag permission system and give a simple
 * ordinal gate for UI visibility decisions (show/hide admin controls).
 *
 * Levels:
 *   GUEST(0)     — unknown / unauthenticated visitor
 *   MEMBER(1)    — has any assigned role (position >= 10) or the Member role
 *   VERIFIED(2)  — reserved; not auto-assigned yet (future email/phone verify)
 *   VETERAN(3)   — auto: joined 30+ days ago AND 100+ messages
 *   MODERATOR(4) — has a role with position >= 50 (Moderator preset) or KICK/BAN perm
 *   ADMIN(5)     — has MANAGE_SERVER or ADMIN permission bit
 *   OWNER(6)     — user_id matches server owner_id
 *
 * Exports:
 *   PRIVILEGE_LEVELS   — const map of level names → numbers
 *   getUserLevel()     — derives level from member object + roles
 *   hasPrivilege()     — ordinal check: userLevel >= requiredLevel
 */

// ─── Constants ────────────────────────────────────────────

export const PRIVILEGE_LEVELS = {
  GUEST:     0,
  MEMBER:    1,
  VERIFIED:  2,
  VETERAN:   3,
  MODERATOR: 4,
  ADMIN:     5,
  OWNER:     6,
} as const;

// Permission bit references (mirrors constants.ts P object)
const PERM_KICK         = 1 << 11;
const PERM_BAN          = 1 << 12;
const PERM_MANAGE_CH    = 1 << 20;
const PERM_MANAGE_SVR   = 1 << 22;
const PERM_ADMIN        = Math.pow(2, 40); // 2**40 — matches constants.ts

// Veteran thresholds
const VETERAN_DAYS     = 30;
const VETERAN_MESSAGES = 100;

// Role position thresholds (matches PRESET_ROLES in constants.ts)
const POS_MEMBER    = 10;
const POS_MODERATOR = 50;

// ─── hasPrivilege ─────────────────────────────────────────

/**
 * Returns true if userLevel >= requiredLevel.
 * Owner (6) passes every check; Guest (0) passes none above Guest.
 */
export function hasPrivilege(userLevel: number, requiredLevel: number): boolean {
  return userLevel >= requiredLevel;
}

// ─── getUserLevel ─────────────────────────────────────────

interface RoleLike {
  id:          string;
  position?:   number;
  permissions?: number;
}

interface MemberLike {
  user_id?:      string;
  role_ids?:     string[];
  joined_at?:    string | number;   // ISO string or epoch ms
  message_count?: number;
}

/**
 * Derives the privilege level for a member.
 *
 * @param member        The member object (may be undefined if not in server)
 * @param serverOwnerId The user_id of the server owner
 * @param roles         All roles in the server (optional; enables perm-bit checks)
 */
export function getUserLevel(
  member:        MemberLike | null | undefined,
  serverOwnerId: string,
  roles?:        RoleLike[],
): number {
  if (!member) return PRIVILEGE_LEVELS.GUEST;

  // ── Owner ──────────────────────────────────────────────
  if (member.user_id === serverOwnerId) return PRIVILEGE_LEVELS.OWNER;

  // Compute effective permissions from assigned roles
  const memberRoleIds = new Set(member.role_ids || []);
  let effectivePerms = 0;
  let maxRolePos = 0;

  if (roles) {
    for (const role of roles) {
      if (memberRoleIds.has(role.id)) {
        if (role.permissions) effectivePerms |= role.permissions;
        if ((role.position ?? 0) > maxRolePos) maxRolePos = role.position ?? 0;
      }
      // @everyone always contributes (position 0)
      if (role.position === 0 && role.permissions) {
        effectivePerms |= role.permissions;
      }
    }
  }

  const isAdmin = (effectivePerms & PERM_ADMIN) !== 0 ||
                  // PERM_ADMIN is 2**40 so bitwise | truncates — check numerically
                  (typeof effectivePerms === 'number' && effectivePerms === Number.MAX_SAFE_INTEGER);

  // ── Admin (5) ──────────────────────────────────────────
  if (isAdmin || (effectivePerms & PERM_MANAGE_SVR) !== 0) {
    return PRIVILEGE_LEVELS.ADMIN;
  }

  // ── Moderator (4) ─────────────────────────────────────
  // Role position >= 50 OR has kick/ban/manage-channel permission
  const hasModePerms = (effectivePerms & PERM_KICK)      !== 0 ||
                       (effectivePerms & PERM_BAN)       !== 0 ||
                       (effectivePerms & PERM_MANAGE_CH) !== 0;
  if (maxRolePos >= POS_MODERATOR || hasModePerms) {
    return PRIVILEGE_LEVELS.MODERATOR;
  }

  // ── Veteran (3) — auto-earned ──────────────────────────
  if (_isVeteran(member)) return PRIVILEGE_LEVELS.VETERAN;

  // ── Member (1) — any meaningful role ──────────────────
  if (maxRolePos >= POS_MEMBER || memberRoleIds.size > 0) {
    return PRIVILEGE_LEVELS.MEMBER;
  }

  return PRIVILEGE_LEVELS.GUEST;
}

// ─── Veteran auto-check ───────────────────────────────────

function _isVeteran(member: MemberLike): boolean {
  const msgs = member.message_count ?? 0;
  if (msgs < VETERAN_MESSAGES) return false;

  if (!member.joined_at) return false;

  const joinedMs = typeof member.joined_at === 'number'
    ? member.joined_at
    : Date.parse(member.joined_at);

  if (isNaN(joinedMs)) return false;

  const daysSinceJoin = (Date.now() - joinedMs) / 86_400_000;
  return daysSinceJoin >= VETERAN_DAYS;
}
