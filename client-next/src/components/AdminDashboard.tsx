/**
 * AdminDashboard — Platform admin panel, rendered inside the Settings Admin tab.
 *
 * Guards: only renders when platformUser.platform_role is 'admin' or 'dev'.
 *
 * Sections:
 *   1. Stats grid   — GET /api/v1/admin/stats (9 metric cards)
 *   2. User table   — GET /api/v1/admin/users (paginated, client-side search)
 *      └ Edit panel — POST /api/v1/admin/users/:id/role (promote / demote)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { T, getInp } from '../theme';
import { api } from '../api/CitadelAPI';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlatformStats {
  total_users:         number;
  verified_users:      number;
  guest_users:         number;
  total_servers:       number;
  total_messages:      number;
  total_channels:      number;
  active_users_24h:    number;
  registrations_today: number;
  total_bot_configs:   number;
}

interface AdminUser {
  id:             string;
  username:       string;
  display_name:   string | null;
  account_tier:   string | null;
  platform_role:  string | null;
  badge_type:     string | null;
  email_verified: boolean;
  is_bot:         boolean;
  created_at:     string;
}

interface UserListResponse {
  users:       AdminUser[];
  total:       number;
  page:        number;
  per_page:    number;
  total_pages: number;
}

interface EditState {
  user:          AdminUser;
  platform_role: string;   // ''     = no change  |  'null' = clear  |  role string = set
  account_tier:  string;   // ''     = no change  |  tier string = set
  saving:        boolean;
  error:         string | null;
}

export interface AdminDashboardProps {
  platformUser: { platform_role?: string | null } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ROLES = ['admin', 'dev', 'premium', 'verified', 'unverified', 'guest'];

const BADGE_EMOJI: Record<string, string> = {
  crown:  '👑',
  wrench: '🔧',
  gem:    '💎',
  shield: '🛡️',
};

const TIER_COLOR: Record<string, string> = {
  admin:      '#ff4757',
  dev:        '#5865F2',
  premium:    '#a855f7',
  verified:   '#10b981',
  unverified: '#f59e0b',
  guest:      '#6b7280',
};

const STAT_CARDS: {
  key:   keyof PlatformStats;
  label: string;
  icon:  string;
  color: string;
}[] = [
  { key: 'total_users',         label: 'Total Users',         icon: '👤', color: '#5865F2' },
  { key: 'verified_users',      label: 'Verified Users',      icon: '🛡️', color: '#10b981' },
  { key: 'guest_users',         label: 'Guests',              icon: '🔒', color: '#6b7280' },
  { key: 'total_servers',       label: 'Servers',             icon: '🏠', color: '#3b82f6' },
  { key: 'total_messages',      label: 'Messages',            icon: '💬', color: '#00d4aa' },
  { key: 'total_channels',      label: 'Channels',            icon: '📢', color: '#6366f1' },
  { key: 'active_users_24h',    label: 'Active 24h',          icon: '⚡', color: '#fbbf24' },
  { key: 'registrations_today', label: 'Registrations Today', icon: '📬', color: '#f59e0b' },
  { key: 'total_bot_configs',   label: 'Bot Configs',         icon: '🤖', color: '#a855f7' },
];

const PER_PAGE = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function TierPill({ tier }: { tier: string | null }) {
  if (!tier) return <span style={{ color: T.bd, fontSize: 11 }}>—</span>;
  const color = TIER_COLOR[tier] ?? '#6b7280';
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 4,
      background: `${color}20`, border: `1px solid ${color}55`,
      color, fontFamily: 'monospace', whiteSpace: 'nowrap',
    }}>
      {tier}
    </span>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, icon, color, value, loading }: {
  label:   string;
  icon:    string;
  color:   string;
  value:   number | undefined;
  loading: boolean;
}) {
  return (
    <div style={{
      background: T.sf2,
      border: `1px solid ${T.bd}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* subtle corner glow */}
      <div style={{
        position: 'absolute', top: -16, right: -16,
        width: 60, height: 60, borderRadius: 30,
        background: `${color}14`, pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 10, color: T.mt, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {loading
          ? <span style={{ fontSize: 14, color: T.bd }}>…</span>
          : (value ?? 0).toLocaleString()
        }
      </div>
    </div>
  );
}

// ─── EditPanel ────────────────────────────────────────────────────────────────

function EditPanel({ edit, onSave, onCancel }: {
  edit:     EditState;
  onSave:   (role: string, tier: string) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(edit.platform_role);
  const [tier, setTier] = useState(edit.account_tier);
  const noChange = role === '' && tier === '';

  const selStyle: React.CSSProperties = {
    ...getInp(),
    fontSize: 12,
    padding: '6px 10px',
    cursor: 'pointer',
    appearance: 'none' as any,
    WebkitAppearance: 'none' as any,
  };

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0 }}>
        <div style={{
          background: `${T.ac}0a`,
          border: `1px solid ${T.ac}33`,
          borderRadius: 8,
          padding: '12px 16px',
          margin: '2px 4px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-end',
        }}>
          <div style={{ width: '100%', fontSize: 13, fontWeight: 700, color: T.tx }}>
            Edit: <span style={{ color: T.ac }}>{edit.user.username}</span>
            <span style={{ marginLeft: 8, fontSize: 10, color: T.mt, fontWeight: 400, fontFamily: 'monospace' }}>
              {edit.user.id.slice(0, 8)}…
            </span>
          </div>

          {/* platform_role */}
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <div style={{ fontSize: 10, color: T.mt, marginBottom: 4, textTransform: 'uppercase', fontWeight: 700 }}>
              Platform Role
            </div>
            <select value={role} onChange={e => setRole(e.target.value)} style={selStyle}>
              <option value="">— no change —</option>
              <option value="null">⊘ Clear (null)</option>
              {VALID_ROLES.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* account_tier */}
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <div style={{ fontSize: 10, color: T.mt, marginBottom: 4, textTransform: 'uppercase', fontWeight: 700 }}>
              Account Tier
            </div>
            <select value={tier} onChange={e => setTier(e.target.value)} style={selStyle}>
              <option value="">— no change —</option>
              {VALID_ROLES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              disabled={edit.saving || noChange}
              onClick={() => onSave(role, tier)}
              style={{
                padding: '7px 18px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none',
                background: noChange || edit.saving
                  ? T.sf2
                  : `linear-gradient(135deg,${T.ac},${T.ac2})`,
                color: noChange || edit.saving ? T.mt : '#000',
                cursor: edit.saving || noChange ? 'not-allowed' : 'pointer',
              }}
            >
              {edit.saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              onClick={onCancel}
              style={{
                padding: '7px 14px', borderRadius: 7, fontSize: 12,
                background: T.sf2, color: T.mt,
                border: `1px solid ${T.bd}`, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {edit.error && (
              <span style={{ fontSize: 11, color: T.err, maxWidth: 220 }}>{edit.error}</span>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── AdminDashboard ───────────────────────────────────────────────────────────

export function AdminDashboard({ platformUser }: AdminDashboardProps) {
  const isStaff =
    platformUser?.platform_role === 'admin' ||
    platformUser?.platform_role === 'dev';

  // ── Stats state ──
  const [stats, setStats]             = useState<PlatformStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError]   = useState<string | null>(null);

  // ── Users state ──
  const [users, setUsers]               = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal]     = useState(0);
  const [usersPage, setUsersPage]       = useState(1);
  const [totalPages, setTotalPages]     = useState(1);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError]     = useState<string | null>(null);
  const [search, setSearch]             = useState('');

  // ── Edit state ──
  const [editState, setEditState] = useState<EditState | null>(null);

  // ── Fetch stats ──
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const r = await api.fetch('/admin/stats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStats(await r.json());
    } catch (e: any) {
      setStatsError(e.message ?? 'Failed to load');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Fetch users ──
  const loadUsers = useCallback(async (page: number) => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const r = await api.fetch(`/admin/users?page=${page}&per_page=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: UserListResponse = await r.json();
      setUsers(data.users);
      setUsersTotal(data.total);
      setTotalPages(data.total_pages);
      setUsersPage(data.page);
    } catch (e: any) {
      setUsersError(e.message ?? 'Failed to load');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isStaff) return;
    loadStats();
    loadUsers(1);
  }, [isStaff, loadStats, loadUsers]);

  // ── Save role edit ──
  const handleSave = async (role: string, tier: string) => {
    if (!editState) return;
    setEditState(prev => prev ? { ...prev, saving: true, error: null } : null);

    const body: Record<string, unknown> = {};
    if (role === 'null') body.platform_role = null;
    else if (role !== '') body.platform_role = role;
    if (tier !== '') body.account_tier = tier;

    try {
      const r = await api.fetch(`/admin/users/${editState.user.id}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text();
        let msg = `Error ${r.status}`;
        try { msg = JSON.parse(text).error ?? msg; } catch {}
        setEditState(prev => prev ? { ...prev, saving: false, error: msg } : null);
        return;
      }
      const updated: AdminUser = await r.json();
      setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, ...updated } : u));
      setEditState(null);
    } catch (e: any) {
      setEditState(prev => prev ? { ...prev, saving: false, error: e.message ?? 'Unknown error' } : null);
    }
  };

  if (!isStaff) return null;

  // ── Client-side search (filters current page) ──
  const q = search.trim().toLowerCase();
  const filtered = q
    ? users.filter(u =>
        u.username.toLowerCase().includes(q) ||
        (u.display_name ?? '').toLowerCase().includes(q)
      )
    : users;

  // ── Shared styles ──
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: T.mt,
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };
  const refreshBtn: React.CSSProperties = {
    background: 'none', border: `1px solid ${T.bd}`, borderRadius: 5,
    color: T.mt, fontSize: 10, padding: '2px 8px', cursor: 'pointer',
  };
  const th: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: T.mt,
    textTransform: 'uppercase', letterSpacing: '0.4px',
    padding: '8px 10px', textAlign: 'left',
    borderBottom: `1px solid ${T.bd}`,
    whiteSpace: 'nowrap', background: T.sf2,
  };
  const tdBase: React.CSSProperties = {
    fontSize: 12, color: T.tx,
    padding: '7px 10px',
    borderBottom: `1px solid ${T.bd}22`,
    verticalAlign: 'middle',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Stats grid ───────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={sectionLabel}>Platform Stats</span>
          <button style={refreshBtn} disabled={statsLoading} onClick={loadStats}>
            {statsLoading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {statsError && (
          <div style={{ fontSize: 12, color: T.err, marginBottom: 8 }}>
            ⚠ {statsError}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {STAT_CARDS.map(c => (
            <StatCard
              key={c.key}
              label={c.label}
              icon={c.icon}
              color={c.color}
              value={stats?.[c.key]}
              loading={statsLoading}
            />
          ))}
        </div>
      </div>

      {/* ── User table ───────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={sectionLabel}>
            Users
            {usersTotal > 0 && (
              <span style={{ fontWeight: 400, color: T.mt, textTransform: 'none', marginLeft: 6 }}>
                ({usersTotal.toLocaleString()} total)
              </span>
            )}
          </span>
          <button style={refreshBtn} disabled={usersLoading} onClick={() => loadUsers(usersPage)}>
            {usersLoading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by username or display name…"
          style={{ ...getInp(), fontSize: 12, padding: '8px 12px', marginBottom: 10 }}
        />

        {usersError && (
          <div style={{ fontSize: 12, color: T.err, marginBottom: 8 }}>⚠ {usersError}</div>
        )}

        {/* Table */}
        <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${T.bd}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th}>Username</th>
                <th style={th}>Display Name</th>
                <th style={th}>Tier</th>
                <th style={th}>Role</th>
                <th style={{ ...th, textAlign: 'center' }}>Badge</th>
                <th style={{ ...th, textAlign: 'center' }}>Verified</th>
                <th style={th}>Joined</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdBase, textAlign: 'center', color: T.mt, padding: 24 }}>
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdBase, textAlign: 'center', color: T.mt, padding: 24 }}>
                    {q ? 'No users match that search.' : 'No users found.'}
                  </td>
                </tr>
              ) : (
                filtered.map(u => {
                  const isEditing = editState?.user.id === u.id;
                  return (
                    <React.Fragment key={u.id}>
                      <tr style={{ background: isEditing ? `${T.ac}08` : 'transparent' }}>

                        {/* Username */}
                        <td style={tdBase}>
                          <span style={{
                            fontWeight: 600, color: T.tx,
                            fontFamily: 'monospace', fontSize: 11,
                          }}>
                            {u.username}
                          </span>
                          {u.is_bot && (
                            <span style={{
                              marginLeft: 5, fontSize: 9,
                              padding: '1px 5px', borderRadius: 3,
                              background: '#a855f720', color: '#a855f7',
                              border: '1px solid #a855f740',
                            }}>
                              BOT
                            </span>
                          )}
                        </td>

                        {/* Display name */}
                        <td style={{
                          ...tdBase, color: T.mt,
                          maxWidth: 130, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {u.display_name || <span style={{ color: T.bd }}>—</span>}
                        </td>

                        {/* Tier */}
                        <td style={tdBase}>
                          <TierPill tier={u.account_tier} />
                        </td>

                        {/* Platform role */}
                        <td style={tdBase}>
                          <TierPill tier={u.platform_role} />
                        </td>

                        {/* Badge */}
                        <td style={{ ...tdBase, textAlign: 'center', fontSize: 16 }}>
                          {u.badge_type
                            ? (BADGE_EMOJI[u.badge_type] ?? u.badge_type)
                            : <span style={{ color: T.bd, fontSize: 11 }}>—</span>
                          }
                        </td>

                        {/* Email verified */}
                        <td style={{ ...tdBase, textAlign: 'center' }}>
                          {u.email_verified
                            ? <span style={{ color: '#10b981', fontWeight: 800, fontSize: 14 }}>✓</span>
                            : <span style={{ color: T.mt, fontSize: 13 }}>✗</span>
                          }
                        </td>

                        {/* Joined */}
                        <td style={{ ...tdBase, color: T.mt, whiteSpace: 'nowrap', fontSize: 11 }}>
                          {fmtDate(u.created_at)}
                        </td>

                        {/* Actions */}
                        <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {isEditing ? (
                            <button
                              onClick={() => setEditState(null)}
                              style={{
                                fontSize: 11, padding: '4px 10px', borderRadius: 5,
                                background: T.sf2, color: T.mt,
                                border: `1px solid ${T.bd}`, cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          ) : (
                            <button
                              onClick={() => setEditState({
                                user:          u,
                                platform_role: '',
                                account_tier:  '',
                                saving:        false,
                                error:         null,
                              })}
                              style={{
                                fontSize: 11, padding: '4px 10px', borderRadius: 5,
                                background: `${T.ac}18`, color: T.ac,
                                border: `1px solid ${T.ac}44`, cursor: 'pointer',
                              }}
                            >
                              Edit Role
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Inline edit panel — spans full row width */}
                      {isEditing && editState && (
                        <EditPanel
                          edit={editState}
                          onSave={handleSave}
                          onCancel={() => setEditState(null)}
                        />
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
            <button
              disabled={usersPage <= 1 || usersLoading}
              onClick={() => { setEditState(null); loadUsers(usersPage - 1); }}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12,
                background: usersPage <= 1 ? T.sf2 : `${T.ac}18`,
                color: usersPage <= 1 ? T.mt : T.ac,
                border: `1px solid ${usersPage <= 1 ? T.bd : `${T.ac}44`}`,
                cursor: usersPage <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 11, color: T.mt }}>
              Page {usersPage} of {totalPages}
            </span>
            <button
              disabled={usersPage >= totalPages || usersLoading}
              onClick={() => { setEditState(null); loadUsers(usersPage + 1); }}
              style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 12,
                background: usersPage >= totalPages ? T.sf2 : `${T.ac}18`,
                color: usersPage >= totalPages ? T.mt : T.ac,
                border: `1px solid ${usersPage >= totalPages ? T.bd : `${T.ac}44`}`,
                cursor: usersPage >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
