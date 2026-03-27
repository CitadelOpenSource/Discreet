/**
 * Gamification — points, ranks, and leaderboards.
 *
 * Exports:
 *   RANKS              — rank tier definitions (threshold, name, icon, color)
 *   getRank()          — returns the rank for a given points total
 *   RankBadge          — small inline badge showing a user's rank
 *   LeaderboardPanel   — full leaderboard panel for a server
 *
 * Points are awarded for:
 *   Sending a message      → 1 pt  (caller: award on successful sendMessage)
 *   Receiving a reaction   → 2 pt  (caller: award on addReaction)
 *   Voice time per minute  → 1 pt  (caller: award on voice tick)
 *   Daily login streak     → 5 pt  (caller: award on login / day-change)
 *
 * API methods used (added to CitadelAPI.ts):
 *   api.getLeaderboard(sid)                  → LeaderboardEntry[]
 *   api.getPoints(sid, uid)                  → { points: number } | null
 *   api.awardPoints(sid, uid, amount, reason)→ { points: number } | null
 */
import React, { useEffect, useState, useCallback } from 'react';
import { T, ta } from '../theme';
import { api } from '../api/CitadelAPI';
import { Av } from './Av';

// ─── Types ────────────────────────────────────────────────

export interface LeaderboardEntry {
  user_id:  string;
  username: string;
  points:   number;
}

export interface RankTier {
  threshold: number;
  name:      string;
  icon:      string;
  color:     string;
}

// ─── Rank definitions ─────────────────────────────────────

export const RANKS: RankTier[] = [
  { threshold: 0,    name: 'Lurker',   icon: '👻', color: '#747f8d' },
  { threshold: 50,   name: 'Member',   icon: '🌱', color: '#3ba55d' },
  { threshold: 150,  name: 'Regular',  icon: '⭐', color: '#5865f2' },
  { threshold: 350,  name: 'Veteran',  icon: '🔥', color: '#e67e22' },
  { threshold: 700,  name: 'Elder',    icon: '💎', color: '#9b59b6' },
  { threshold: 1200, name: 'Legend',   icon: '👑', color: '#faa61a' },
];

export function getRank(points: number): RankTier {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (points >= r.threshold) rank = r;
  }
  return rank;
}

/** Points needed to reach the next rank tier (null if already at Legend). */
function nextRankThreshold(points: number): number | null {
  for (const r of RANKS) {
    if (points < r.threshold) return r.threshold;
  }
  return null;
}

// ─── RankBadge ────────────────────────────────────────────

export interface RankBadgeProps {
  /** Total points for this user. */
  points: number;
  /** 'full' shows icon + name, 'icon' shows icon only, 'compact' shows icon + short pts. */
  variant?: 'full' | 'icon' | 'compact';
}

export function RankBadge({ points, variant = 'full' }: RankBadgeProps) {
  const rank = getRank(points);

  if (variant === 'icon') {
    return (
      <span title={`${rank.name} · ${points} pts`} style={{ fontSize: 13, cursor: 'default' }}>
        {rank.icon}
      </span>
    );
  }

  if (variant === 'compact') {
    return (
      <span title={rank.name} style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: 10, color: rank.color, fontWeight: 600,
        background: `${rank.color}22`, borderRadius: 4,
        padding: '1px 5px', cursor: 'default',
      }}>
        {rank.icon} {points}
      </span>
    );
  }

  // 'full'
  return (
    <span title={`${points} pts`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 11, color: rank.color, fontWeight: 700,
      background: `${rank.color}18`, borderRadius: 6,
      padding: '2px 7px', cursor: 'default',
    }}>
      {rank.icon} {rank.name}
    </span>
  );
}

// ─── LeaderboardPanel ─────────────────────────────────────

export interface LeaderboardPanelProps {
  serverId: string;
  /** Full member list — used to supplement display names when API omits them. */
  members: { user_id: string; username?: string; display_name?: string }[];
}

const MEDAL = ['🥇', '🥈', '🥉'];

export function LeaderboardPanel({ serverId, members }: LeaderboardPanelProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [myPoints, setMyPoints] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [board, mine] = await Promise.all([
        api.getLeaderboard(serverId),
        api.userId ? api.getPoints(serverId, api.userId) : Promise.resolve(null),
      ]);
      setEntries(Array.isArray(board) ? board : []);
      setMyPoints(mine?.points ?? null);
    } catch {
      setError('Could not load leaderboard');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { load(); }, [load]);

  // Resolve display name: prefer member list, fall back to entry username
  const getName = (entry: LeaderboardEntry) => {
    const m = members.find(x => x.user_id === entry.user_id);
    return m?.display_name || m?.username || entry.username || 'Unknown User';
  };

  const myRank   = myPoints !== null ? getRank(myPoints) : null;
  const nextPts  = myPoints !== null ? nextRankThreshold(myPoints) : null;
  const progress = (myPoints !== null && nextPts !== null)
    ? Math.round((myPoints / nextPts) * 100)
    : 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, fontFamily: 'var(--font-primary)' }}>

      {/* ── My stats banner ── */}
      {myPoints !== null && myRank && (
        <div style={{
          background: `linear-gradient(135deg, ${myRank.color}18 0%, ${T.sf2} 100%)`,
          border: `1px solid ${myRank.color}44`,
          borderRadius: 10, padding: '12px 14px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22 }}>{myRank.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: myRank.color }}>{myRank.name}</div>
                <div style={{ fontSize: 10, color: T.mt }}>{myPoints} total points</div>
              </div>
            </div>
            {nextPts !== null && (
              <div style={{ fontSize: 10, color: T.mt, textAlign: 'right' }}>
                {nextPts - myPoints} pts to<br />
                <span style={{ color: RANKS.find(r => r.threshold === nextPts)?.color || T.ac }}>
                  {RANKS.find(r => r.threshold === nextPts)?.name}
                </span>
              </div>
            )}
          </div>
          {nextPts !== null && (
            <div style={{ background: T.bg, borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4,
                background: myRank.color,
                width: `${progress}%`,
                transition: 'width .4s',
              }} />
            </div>
          )}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Leaderboard
        </div>
        <button onClick={load} disabled={loading} style={{
          background: 'none', border: 'none', color: T.mt, cursor: 'pointer',
          fontSize: 13, padding: '2px 4px', borderRadius: 4, opacity: loading ? 0.4 : 1,
        }} title="Refresh">↻</button>
      </div>

      {/* ── States ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 24, color: T.mt, fontSize: 12 }}>Loading...</div>
      )}
      {error && !loading && (
        <div style={{ textAlign: 'center', padding: 16, color: T.mt, fontSize: 12 }}>{error}</div>
      )}
      {!loading && !error && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: 24, color: T.mt, fontSize: 12 }}>
          No points yet — start chatting!
        </div>
      )}

      {/* ── Rows ── */}
      {!loading && !error && entries.map((entry, i) => {
        const rank    = getRank(entry.points);
        const isMe    = entry.user_id === api.userId;
        const name    = getName(entry);

        return (
          <div
            key={entry.user_id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 'var(--radius-md)',
              background: isMe ? `${ta(T.ac,'0d')}` : i % 2 === 0 ? T.sf2 : 'transparent',
              border: isMe ? `1px solid ${ta(T.ac,'33')}` : '1px solid transparent',
              marginBottom: 2,
            }}
          >
            {/* Rank number / medal */}
            <div style={{
              width: 22, textAlign: 'center', fontSize: i < 3 ? 16 : 12,
              fontWeight: 700, color: i < 3 ? undefined : T.mt, flexShrink: 0,
            }}>
              {i < 3 ? MEDAL[i] : `${i + 1}`}
            </div>

            {/* Avatar */}
            <Av name={name} size={28} />

            {/* Name + rank */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: isMe ? 700 : 500,
                color: isMe ? T.ac : T.tx,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {name}{isMe && ' (you)'}
              </div>
              <div style={{ fontSize: 10, color: rank.color, display: 'flex', alignItems: 'center', gap: 3 }}>
                {rank.icon} {rank.name}
              </div>
            </div>

            {/* Points */}
            <div style={{
              fontSize: 13, fontWeight: 700, color: rank.color,
              background: `${rank.color}18`, borderRadius: 6,
              padding: '2px 8px', flexShrink: 0,
            }}>
              {entry.points.toLocaleString()}
            </div>
          </div>
        );
      })}

      {/* ── Point guide ── */}
      {!loading && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 11, color: T.mt, cursor: 'pointer', userSelect: 'none' }}>
            How to earn points
          </summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              ['💬', 'Send a message',      '1 pt'],
              ['❤️', 'Receive a reaction',  '2 pts'],
              ['🎙', 'Voice time (per min)', '1 pt'],
              ['🔥', 'Daily login streak',  '5 pts'],
            ].map(([icon, label, pts]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.mt, padding: '2px 4px' }}>
                <span>{icon} {label}</span>
                <span style={{ color: T.ac, fontWeight: 600 }}>{pts}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
