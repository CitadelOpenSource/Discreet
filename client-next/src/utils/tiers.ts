/**
 * tiers.ts — Tier system for Discreet.
 *
 * Tiers (lowest → highest):
 *   guest       — No account (browsing public content only)
 *   unverified  — Registered, email not confirmed
 *   verified    — Email confirmed
 *   pro         — Paid individual plan
 *   teams       — Paid team plan
 *   enterprise  — Paid enterprise plan
 *
 * getUserTier(user) inspects the user object returned by GET /users/@me
 * and returns the appropriate Tier string.
 *
 * TIER_LIMITS contains the feature caps for each tier. Features not
 * present in a tier are inherited from the tier above the lowest that
 * defines them — i.e., always compare against the user's own limits
 * using getLimits(tier) rather than TIER_LIMITS directly.
 *
 * Design notes:
 *   - TierGate is a React component that renders a tasteful, dismissable
 *     "you've hit a limit" nudge. It is never a blocker modal — just an
 *     informational nudge that explains what the next tier unlocks.
 *   - No countdown timers, no purchase urgency, no dark patterns.
 */

import React from 'react';
import { T } from '../theme';

// ── Tier type ─────────────────────────────────────────────────────────────────

export type Tier = 'guest' | 'unverified' | 'verified' | 'pro' | 'teams' | 'enterprise';

// ── Limits ────────────────────────────────────────────────────────────────────

export interface TierLimits {
  maxServers:             number;    // how many servers the user can own/create
  maxBots:                number;    // AI bots per server
  canUpload:              boolean;   // file attachments
  canVoice:               boolean;   // voice / video channels
  maxMessageLength:       number;    // characters per message
  maxFileSize:            number;    // bytes (0 = no upload)
  canCreateInvites:       boolean;   // generate invite links
  customStatus:           boolean;   // custom status text
  threadHistory:          number;    // days of thread history retained (0 = forever)
  maxStorageMB:           number;    // cumulative file storage quota in MB (Infinity = unlimited)
  maxDmsPerDay:           number;    // new DM conversations per day (Infinity = unlimited)
  maxServersJoinedPerHour: number;   // server joins per hour (Infinity = unlimited)
  maxMessagesPerMinute:   number;    // outbound messages per minute (Infinity = unlimited)
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  guest: {
    maxServers:              0,
    maxBots:                 0,
    canUpload:               false,
    canVoice:                false,
    maxMessageLength:        500,
    maxFileSize:             0,
    canCreateInvites:        false,
    customStatus:            false,
    threadHistory:           7,
    maxStorageMB:            0,
    maxDmsPerDay:            0,
    maxServersJoinedPerHour: 0,
    maxMessagesPerMinute:    0,
  },
  unverified: {
    maxServers:              2,
    maxBots:                 0,
    canUpload:               false,
    canVoice:                true,
    maxMessageLength:        2000,
    maxFileSize:             0,
    canCreateInvites:        true,
    customStatus:            false,
    threadHistory:           30,
    maxStorageMB:            50,
    maxDmsPerDay:            10,
    maxServersJoinedPerHour: 3,
    maxMessagesPerMinute:    20,
  },
  verified: {
    maxServers:              10,
    maxBots:                 5,
    canUpload:               true,
    canVoice:                true,
    maxMessageLength:        4000,
    maxFileSize:             8 * 1024 * 1024,   // 8 MB
    canCreateInvites:        true,
    customStatus:            true,
    threadHistory:           0,
    maxStorageMB:            500,
    maxDmsPerDay:            Infinity,
    maxServersJoinedPerHour: Infinity,
    maxMessagesPerMinute:    Infinity,
  },
  pro: {
    maxServers:              50,
    maxBots:                 20,
    canUpload:               true,
    canVoice:                true,
    maxMessageLength:        8000,
    maxFileSize:             50 * 1024 * 1024,  // 50 MB
    canCreateInvites:        true,
    customStatus:            true,
    threadHistory:           0,
    maxStorageMB:            5000,
    maxDmsPerDay:            Infinity,
    maxServersJoinedPerHour: Infinity,
    maxMessagesPerMinute:    Infinity,
  },
  teams: {
    maxServers:              200,
    maxBots:                 50,
    canUpload:               true,
    canVoice:                true,
    maxMessageLength:        8000,
    maxFileSize:             100 * 1024 * 1024, // 100 MB
    canCreateInvites:        true,
    customStatus:            true,
    threadHistory:           0,
    maxStorageMB:            50000,
    maxDmsPerDay:            Infinity,
    maxServersJoinedPerHour: Infinity,
    maxMessagesPerMinute:    Infinity,
  },
  enterprise: {
    maxServers:              Infinity,
    maxBots:                 Infinity,
    canUpload:               true,
    canVoice:                true,
    maxMessageLength:        16000,
    maxFileSize:             500 * 1024 * 1024, // 500 MB
    canCreateInvites:        true,
    customStatus:            true,
    threadHistory:           0,
    maxStorageMB:            Infinity,
    maxDmsPerDay:            Infinity,
    maxServersJoinedPerHour: Infinity,
    maxMessagesPerMinute:    Infinity,
  },
};

// ── Tier metadata (for UI display) ───────────────────────────────────────────

interface TierMeta {
  label:    string;
  icon:     string;
  color:    string;
  tagline:  string;
  price:    string;  // display string only — actual billing is server-side
  /** Human-readable list of what this tier adds over the previous one */
  perks:    string[];
}

export const TIER_META: Record<Tier, TierMeta> = {
  guest: {
    label:   'Guest',
    icon:    '👤',
    color:   '#6b7280',
    tagline: 'No account',
    price:   'Free',
    perks:   ['Read public servers', 'Up to 500-char messages'],
  },
  unverified: {
    label:   'Unverified',
    icon:    '📬',
    color:   '#f59e0b',
    tagline: 'Registered — verify your email to unlock more',
    price:   'Free',
    perks:   ['Up to 2 servers', 'Voice channels', 'Up to 2,000-char messages', 'Generate invites'],
  },
  verified: {
    label:   'Verified',
    icon:    '✅',
    color:   '#10b981',
    tagline: 'Email confirmed',
    price:   'Free',
    perks:   ['Up to 10 servers', 'Up to 5 bots per server', 'File uploads (8 MB)', 'Custom status', 'Up to 4,000-char messages', 'Full thread history'],
  },
  pro: {
    label:   'Pro',
    icon:    '⚡',
    color:   '#6366f1',
    tagline: 'For power users',
    price:   '$5 / month',
    perks:   ['Up to 50 servers', 'Up to 20 bots per server', 'Uploads up to 50 MB', 'Up to 8,000-char messages'],
  },
  teams: {
    label:   'Teams',
    icon:    '🏢',
    color:   '#3b82f6',
    tagline: 'For small teams',
    price:   '$12 / month',
    perks:   ['Up to 200 servers', 'Up to 50 bots per server', 'Uploads up to 100 MB', 'Priority support'],
  },
  enterprise: {
    label:   'Enterprise',
    icon:    '🏛',
    color:   '#f59e0b',
    tagline: 'Unlimited everything',
    price:   'Contact us',
    perks:   ['Unlimited servers', 'Unlimited bots', 'Uploads up to 500 MB', 'SLA + dedicated support', '16,000-char messages'],
  },
};

// ── Tier ordering ─────────────────────────────────────────────────────────────

const TIER_ORDER: Tier[] = ['guest', 'unverified', 'verified', 'pro', 'teams', 'enterprise'];

export function tierRank(t: Tier): number { return TIER_ORDER.indexOf(t); }
export function tierAtLeast(current: Tier, needed: Tier): boolean {
  return tierRank(current) >= tierRank(needed);
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Determine a user's tier from the /users/@me response.
 *
 * Priority order (highest wins):
 *   enterprise > teams > pro > verified (email confirmed) > unverified > guest
 */
export function getUserTier(user: any): Tier {
  if (!user || !user.id) return 'guest';
  const t = user.account_tier as string | undefined;
  if (t === 'enterprise') return 'enterprise';
  if (t === 'teams')      return 'teams';
  if (t === 'pro')        return 'pro';
  if (user.email_verified || user.is_email_verified) return 'verified';
  return 'unverified';
}

/**
 * Shorthand — get TierLimits for a user object.
 */
export function getLimits(user: any): TierLimits {
  return TIER_LIMITS[getUserTier(user)];
}

// ── Smallest tier that grants a given capability ──────────────────────────────

/** Returns the lowest tier that allows `check(limits)` to pass. */
function minTierFor(check: (l: TierLimits) => boolean): Tier {
  for (const t of TIER_ORDER) {
    if (check(TIER_LIMITS[t])) return t;
  }
  return 'enterprise';
}

export function minTierForUpload(): Tier       { return minTierFor(l => l.canUpload); }
export function minTierForBots(): Tier         { return minTierFor(l => l.maxBots > 0); }
export function minTierForServers(n: number): Tier {
  return minTierFor(l => l.maxServers >= n);
}
export function minTierForMsgLen(n: number): Tier {
  return minTierFor(l => l.maxMessageLength >= n);
}
export function minTierForStorage(mb: number): Tier {
  return minTierFor(l => l.maxStorageMB >= mb);
}

// ── Storage helpers (localStorage-backed) ─────────────────────────────────────

/** Bytes currently used across all uploads this session (persisted in localStorage). */
export function getStorageUsedBytes(): number {
  return parseInt(localStorage.getItem('d_storage_used_bytes') || '0', 10);
}

/** Increment the stored byte counter after a successful upload. */
export function addStorageUsedBytes(bytes: number): void {
  localStorage.setItem('d_storage_used_bytes', String(getStorageUsedBytes() + bytes));
}

/**
 * Returns true if the file fits within the user's remaining storage quota.
 * Always returns true for unlimited tiers (enterprise).
 */
export function checkStorageLimit(user: any, fileSizeBytes: number): boolean {
  const limits = getLimits(user);
  if (limits.maxStorageMB === Infinity) return true;
  if (limits.maxStorageMB === 0) return false;
  return getStorageUsedBytes() + fileSizeBytes <= limits.maxStorageMB * 1024 * 1024;
}

// ── Rolling-window rate-limit helper ─────────────────────────────────────────

/**
 * Check and record one usage tick of a rolling-window rate limit.
 *
 * @param countKey   localStorage key for the tick count in the current window.
 * @param windowKey  localStorage key for the window start timestamp (ms).
 * @param windowMs   Window length in milliseconds.
 * @param limit      Maximum allowed ticks per window. Pass Infinity to always allow.
 * @returns true if the action is permitted; false if the limit is exceeded.
 */
export function checkRateLimit(
  countKey:  string,
  windowKey: string,
  windowMs:  number,
  limit:     number,
): boolean {
  if (limit === Infinity) return true;
  if (limit <= 0) return false;
  const now = Date.now();
  const windowStart = parseInt(localStorage.getItem(windowKey) || '0', 10);
  let count = parseInt(localStorage.getItem(countKey) || '0', 10);
  if (now - windowStart >= windowMs) {
    // Window expired — start a fresh one.
    count = 0;
    localStorage.setItem(windowKey, String(now));
  }
  if (count >= limit) return false;
  localStorage.setItem(countKey, String(count + 1));
  return true;
}

// ── TierGate React component ──────────────────────────────────────────────────

/**
 * TierGate — tasteful, non-aggressive upgrade nudge.
 *
 * Renders a compact banner card explaining what the user needs to unlock
 * a feature, and a single clear action (verify email or learn about plans).
 *
 * Usage:
 *   {tierPrompt && (
 *     <TierGate
 *       currentTier={myTier}
 *       neededTier={tierPrompt.needed}
 *       feature={tierPrompt.feature}
 *       onDismiss={() => setTierPrompt(null)}
 *     />
 *   )}
 */
export interface TierGateProps {
  currentTier: Tier;
  neededTier:  Tier;
  feature:     string;  // e.g. "upload files", "create more servers"
  onDismiss:   () => void;
}

export function TierGate({ currentTier, neededTier, feature, onDismiss }: TierGateProps) {
  const needed  = TIER_META[neededTier];
  const current = TIER_META[currentTier];

  const isEmailGate = neededTier === 'verified' && currentTier === 'unverified';
  const isPaidGate  = tierRank(neededTier) >= tierRank('pro');

  // Perks the user gains by moving to neededTier (first 3 only — keep it scannable)
  const newPerks = needed.perks.slice(0, 3);

  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
      padding: '14px 16px',
      background: T.sf,
      border: `1px solid ${needed.color}33`,
      borderLeft: `3px solid ${needed.color}`,
      borderRadius: 10,
      marginBottom: 12,
      animation: 'fadeIn .2s ease',
    } as React.CSSProperties,
  },
    // Icon
    React.createElement('div', { style: { fontSize: 22, flexShrink: 0, marginTop: 1 } }, needed.icon),

    // Body
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', {
        style: { fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 3 },
      }, `${needed.label} needed to ${feature}`),

      React.createElement('div', {
        style: { fontSize: 12, color: T.mt, marginBottom: 8, lineHeight: 1.5 },
      },
        isEmailGate
          ? `You're on the ${current.label} plan. Confirming your email unlocks this and more:`
          : `Your current plan (${current.label}) doesn't include this. ${needed.label} adds:`,
      ),

      // Perks list
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 } },
        ...newPerks.map(perk =>
          React.createElement('div', {
            key: perk,
            style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.mt },
          },
            React.createElement('span', { style: { color: needed.color, fontSize: 12 } }, '✓'),
            perk,
          ),
        ),
      ),

      // CTA
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        isEmailGate
          ? React.createElement('button', {
              onClick: onDismiss,
              style: {
                padding: '6px 14px',
                background: `${needed.color}18`,
                border: `1px solid ${needed.color}44`,
                borderRadius: 7,
                color: needed.color,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              } as React.CSSProperties,
            }, '✉ Verify in Settings → Account')
          : isPaidGate
            ? React.createElement('button', {
                onClick: onDismiss,
                style: {
                  padding: '6px 14px',
                  background: `${needed.color}18`,
                  border: `1px solid ${needed.color}44`,
                  borderRadius: 7,
                  color: needed.color,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                } as React.CSSProperties,
              }, `View ${needed.label} — ${needed.price}`)
            : null,

        React.createElement('button', {
          onClick: onDismiss,
          style: {
            padding: '6px 10px',
            background: 'transparent',
            border: `1px solid ${T.bd}`,
            borderRadius: 7,
            color: T.mt,
            fontSize: 12,
            cursor: 'pointer',
          } as React.CSSProperties,
        }, 'Dismiss'),
      ),
    ),

    // Dismiss X
    React.createElement('button', {
      onClick: onDismiss,
      title: 'Dismiss',
      style: {
        background: 'none',
        border: 'none',
        color: T.mt,
        cursor: 'pointer',
        fontSize: 16,
        lineHeight: 1,
        padding: 2,
        flexShrink: 0,
      } as React.CSSProperties,
    }, '×'),
  );
}

// ── useTierGate hook — convenience for App.tsx ────────────────────────────────

export interface TierPrompt {
  feature: string;
  needed:  Tier;
}
