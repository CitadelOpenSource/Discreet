/**
 * BadgeDisplay — Inline tier and role badges next to display names.
 *
 * Badge types:
 *   - verified: Small filled check circle (accent color). ONLY visible to
 *     the user themselves — never shown to others. Private confirmation.
 *   - pro: Gold 5-point star. Visible to all.
 *   - team: Small office building. Visible to all.
 *   - admin: Filled shield. Visible only in admin contexts.
 *   - bot: "BOT" pill badge. Always visible.
 *   - founder: Gold crown. Visible everywhere. Only one account ever.
 */
import React from 'react';
import { T } from '../theme';

interface Props {
  tier?: string;
  isBot?: boolean;
  isFounder?: boolean;
  isSelf?: boolean;       // true if this badge row is for the current user
  isAdminContext?: boolean; // true in admin dashboard
  platformRole?: string | null;
}

export function BadgeDisplay({ tier, isBot, isFounder, isSelf, isAdminContext, platformRole }: Props) {
  const badges: React.ReactNode[] = [];

  // Founder badge — gold crown, visible everywhere, only one account.
  if (isFounder) {
    badges.push(
      <span key="founder" title="Founder" style={{ display: 'inline-flex', color: '#f0b232', marginLeft: 3 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm0 2v2h14v-2H5z"/></svg>
      </span>
    );
  }

  // Bot badge — always visible.
  if (isBot) {
    badges.push(
      <span key="bot" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#5865f222', color: '#7984f5', fontWeight: 700, marginLeft: 4, letterSpacing: '0.3px', verticalAlign: 'middle' }}>BOT</span>
    );
  }

  // Pro badge — gold star, visible to all.
  if (tier === 'pro') {
    badges.push(
      <span key="pro" title="Pro" style={{ display: 'inline-flex', color: '#f0b232', marginLeft: 3 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
      </span>
    );
  }

  // Team badge — building icon, visible to all.
  if (tier === 'team') {
    badges.push(
      <span key="team" title="Team" style={{ display: 'inline-flex', color: '#3b82f6', marginLeft: 3 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1"/><rect x="5" y="3" width="14" height="18" rx="1"/></svg>
      </span>
    );
  }

  // Admin badge — shield, visible only in admin contexts.
  if (isAdminContext && (platformRole === 'admin' || platformRole === 'dev')) {
    badges.push(
      <span key="admin" title="Admin" style={{ display: 'inline-flex', color: T.ac, marginLeft: 3 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1.06 13.54L7.4 12l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41-5.64 5.66z"/></svg>
      </span>
    );
  }

  // Verified badge — check circle, ONLY visible to the user themselves.
  // Privacy: no other user can tell if someone is verified or not.
  if (isSelf && (tier === 'verified' || tier === 'pro' || tier === 'team' || tier === 'admin')) {
    badges.push(
      <span key="verified" title="Email verified" style={{ display: 'inline-flex', color: T.ac, marginLeft: 3 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
      </span>
    );
  }

  if (badges.length === 0) return null;
  return <>{badges}</>;
}
