/**
 * AdminDashboard — Platform admin panel.
 *
 * Guards: only renders when platformUser.platform_role is 'admin' or 'dev'.
 *
 * Sections:
 *   1. Stats grid        — GET /api/v1/admin/stats
 *   2. Kill switches     — GET/PUT /api/v1/admin/settings
 *   3. Server health     — GET /api/v1/info (DB, Redis, uptime)
 *   4. Active defense    — Rate limiting, banned IPs, failed logins
 *   5. Registration graph — GET /api/v1/admin/registrations (30 days)
 *   6. User table        — GET /api/v1/admin/users (paginated)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { T, ta, getInp } from '../theme';
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
  messages_today:      number;
  storage_used_bytes:  number;
  lockdown_status:     boolean;
  pending_bans:        number;
}

interface PlatformSettings {
  registrations_enabled: boolean;
  logins_enabled:        boolean;
  guest_access_enabled:  boolean;
  ai_bots_enabled:       boolean;
  maintenance_mode:      boolean;
  maintenance_message:   string;
  ai_global_model:       string;
  ai_rate_limit_per_minute: number;
  ai_emergency_stop:     boolean;
  default_retention_days: number;
  global_disappearing_default: string;
  official_server_id: string;
  disappearing_messages_enabled: boolean;
}

interface ServerInfo {
  name:    string;
  version: string;
  connectivity: { database: boolean; redis: boolean };
  features: Record<string, boolean>;
  limits:  { rate_limit_per_minute: number; auth_rate_limit_per_minute: number };
}

interface RegDay { date: string; count: number }

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
  platform_role: string;
  account_tier:  string;
  saving:        boolean;
  error:         string | null;
}

export interface AdminDashboardProps {
  platformUser: { platform_role?: string | null } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ROLES = ['admin', 'dev', 'premium', 'verified', 'unverified', 'guest'];
const PER_PAGE = 50;

const BADGE_EMOJI: Record<string, string> = { crown: '👑', wrench: '🔧', gem: '💎', shield: '🛡️' };
const TIER_COLOR: Record<string, string> = {
  admin: '#ff4757', dev: '#5865F2', premium: '#a855f7', verified: '#10b981', unverified: '#f59e0b', guest: '#6b7280',
};

const STAT_CARDS: { key: keyof PlatformStats; label: string; icon: string; color: string }[] = [
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

// ─── Shared styles ────────────────────────────────────────────────────────────

const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: T.mt,
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const refreshBtn: React.CSSProperties = {
  background: 'none', border: `1px solid ${T.bd}`, borderRadius: 5,
  color: T.mt, fontSize: 10, padding: '2px 8px', cursor: 'pointer',
};
const cardStyle: React.CSSProperties = {
  background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 10, padding: 16,
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ label, loading, onRefresh }: { label: string; loading?: boolean; onRefresh?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={sectionTitle}>{label}</span>
      {onRefresh && (
        <button style={refreshBtn} disabled={loading} onClick={onRefresh}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      )}
    </div>
  );
}

function StatCard({ label, icon, color, value, loading, displayValue }: {
  label: string; icon: string; color: string; value?: number; loading: boolean; displayValue?: string;
}) {
  return (
    <div style={{
      background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 10,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: -16, right: -16, width: 60, height: 60, borderRadius: 30, background: `${color}14`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontSize: 10, color: T.mt, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {loading ? <span style={{ fontSize: 14, color: T.bd }}>…</span> : (displayValue ?? (value ?? 0).toLocaleString())}
      </div>
    </div>
  );
}

function TierPill({ tier }: { tier: string | null }) {
  if (!tier) return <span style={{ color: T.bd, fontSize: 11 }}>—</span>;
  const color = TIER_COLOR[tier] ?? '#6b7280';
  return (
    <span style={{
      fontSize: 10, padding: '2px 7px', borderRadius: 4,
      background: `${color}20`, border: `1px solid ${color}55`,
      color, fontFamily: 'monospace', whiteSpace: 'nowrap',
    }}>{tier}</span>
  );
}

function Toggle({ on, label, desc, onToggle, disabled }: {
  on: boolean; label: string; desc: string; onToggle: () => void; disabled?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 14px', background: T.sf2, borderRadius: 8,
      border: `1px solid ${T.bd}`, opacity: disabled ? 0.5 : 1,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{label}</div>
        <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>{desc}</div>
      </div>
      <div
        onClick={disabled ? undefined : onToggle}
        style={{
          width: 40, height: 22, borderRadius: 11, cursor: disabled ? 'not-allowed' : 'pointer',
          background: on ? T.ac : T.bd, transition: 'background 0.2s', position: 'relative', flexShrink: 0, marginLeft: 12,
        }}
      >
        <div style={{
          width: 16, height: 16, borderRadius: 8, background: '#fff',
          position: 'absolute', top: 3, left: on ? 21 : 3, transition: 'left 0.2s',
        }} />
      </div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: ok ? '#10b981' : '#ff4757', marginRight: 6 }} />;
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ height: 6, background: T.bd, borderRadius: 3, overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? '#ff4757' : T.ac, borderRadius: 3, transition: 'width 0.3s' }} />
    </div>
  );
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso.slice(0, 10); }
}

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ─── Registration Graph ──────────────────────────────────────────────────────

function RegGraph({ data, loading }: { data: RegDay[]; loading: boolean }) {
  if (loading) return <div style={{ color: T.mt, fontSize: 12, textAlign: 'center', padding: 24 }}>Loading…</div>;
  if (!data.length) return <div style={{ color: T.mt, fontSize: 12, textAlign: 'center', padding: 24 }}>No registration data</div>;

  const max = Math.max(...data.map(d => d.count), 1);
  const barW = Math.max(4, Math.floor((100 / data.length) * 0.7));

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100, padding: '8px 0' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div
            title={`${d.date}: ${d.count} registrations`}
            style={{
              width: barW, minWidth: 4, borderRadius: 2,
              background: T.ac, opacity: 0.8,
              height: `${Math.max(2, (d.count / max) * 80)}px`,
              transition: 'height 0.3s',
            }}
          />
          {(i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) && (
            <span style={{ fontSize: 8, color: T.mt, whiteSpace: 'nowrap' }}>
              {d.date.slice(5)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── EditPanel ───────────────────────────────────────────────────────────────

function EditPanel({ edit, onSave, onCancel }: {
  edit: EditState; onSave: (role: string, tier: string) => void; onCancel: () => void;
}) {
  const [role, setRole] = useState(edit.platform_role);
  const [tier, setTier] = useState(edit.account_tier);
  const noChange = role === '' && tier === '';
  const selStyle: React.CSSProperties = { ...getInp(), fontSize: 12, padding: '6px 10px', cursor: 'pointer' };

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0 }}>
        <div style={{
          background: `${ta(T.ac,'0a')}`, border: `1px solid ${ta(T.ac,'33')}`, borderRadius: 8,
          padding: '12px 16px', margin: '2px 4px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end',
        }}>
          <div style={{ width: '100%', fontSize: 13, fontWeight: 700, color: T.tx }}>
            Edit: <span style={{ color: T.ac }}>{edit.user.username}</span>
            <span style={{ marginLeft: 8, fontSize: 10, color: T.mt, fontWeight: 400, fontFamily: 'monospace' }}>{edit.user.id.slice(0, 8)}…</span>
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <div style={{ fontSize: 10, color: T.mt, marginBottom: 4, textTransform: 'uppercase', fontWeight: 700 }}>Platform Role</div>
            <select value={role} onChange={e => setRole(e.target.value)} style={selStyle}>
              <option value="">— no change —</option>
              <option value="null">Clear (null)</option>
              {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <div style={{ fontSize: 10, color: T.mt, marginBottom: 4, textTransform: 'uppercase', fontWeight: 700 }}>Account Tier</div>
            <select value={tier} onChange={e => setTier(e.target.value)} style={selStyle}>
              <option value="">— no change —</option>
              {VALID_ROLES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button disabled={edit.saving || noChange} onClick={() => onSave(role, tier)} style={{
              padding: '7px 18px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: 'none',
              background: noChange || edit.saving ? T.sf2 : `linear-gradient(135deg,${T.ac},${(T as any).ac2 || '#00b894'})`,
              color: noChange || edit.saving ? T.mt : '#000', cursor: edit.saving || noChange ? 'not-allowed' : 'pointer',
            }}>
              {edit.saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button onClick={onCancel} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, cursor: 'pointer' }}>
              Cancel
            </button>
            {edit.error && <span style={{ fontSize: 11, color: T.err, maxWidth: 220 }}>{edit.error}</span>}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── InactiveServersPanel ─────────────────────────────────────────────────────

interface InactiveServer {
  id: string;
  name: string;
  owner_id: string;
  owner_username: string;
  member_count: number;
  last_activity_at: string;
  days_idle: number;
  is_archived: boolean;
  scheduled_deletion_at: string | null;
}

function InactiveServersPanel() {
  const [servers, setServers] = useState<InactiveServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [daysFilter, setDaysFilter] = useState(30);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const res = await api.fetch(`/admin/inactive-servers?days=${days}`);
      const data = await res.json();
      if (Array.isArray(data)) setServers(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(daysFilter); }, [daysFilter, load]);

  const handleArchive = async (id: string, archive: boolean) => {
    setActionLoading(id);
    try {
      await api.fetch(`/admin/servers/${id}/archive`, { method: 'POST', body: JSON.stringify({ archive }) });
      await load(daysFilter);
    } catch { /* ignore */ }
    setActionLoading(null);
  };

  const handleScheduleDeletion = async (id: string, schedule: boolean) => {
    setActionLoading(id);
    try {
      await api.fetch(`/admin/servers/${id}/schedule-deletion`, { method: 'POST', body: JSON.stringify({ schedule }) });
      await load(daysFilter);
    } catch { /* ignore */ }
    setActionLoading(null);
  };

  return (
    <div style={{ padding: 16, background: T.sf, borderRadius: 10, border: `1px solid ${T.bd}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>Inactive Servers</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: T.mt }}>Idle for</span>
          {[30, 60, 90, 180].map(d => (
            <button
              key={d}
              onClick={() => setDaysFilter(d)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: daysFilter === d ? `1px solid ${T.ac}` : `1px solid ${T.bd}`,
                background: daysFilter === d ? `${ta(T.ac,'15')}` : T.sf2,
                color: daysFilter === d ? T.ac : T.mt,
              }}
            >{d}d</button>
          ))}
          <button onClick={() => load(daysFilter)} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 13, padding: 4 }} title="Refresh">
            {loading ? '...' : '↻'}
          </button>
        </div>
      </div>

      {servers.length === 0 && !loading && (
        <div style={{ color: T.mt, fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          No servers idle for {daysFilter}+ days
        </div>
      )}

      {servers.map(s => (
        <div key={s.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
          background: s.scheduled_deletion_at ? 'rgba(255,71,87,0.06)' : s.is_archived ? 'rgba(255,165,0,0.06)' : T.sf2,
          borderRadius: 8, marginBottom: 6,
          border: `1px solid ${s.scheduled_deletion_at ? 'rgba(255,71,87,0.15)' : s.is_archived ? 'rgba(255,165,0,0.15)' : T.bd}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{s.name}</span>
              {s.is_archived && <span style={{ fontSize: 9, fontWeight: 700, color: '#ffa500', background: 'rgba(255,165,0,0.12)', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' }}>Archived</span>}
              {s.scheduled_deletion_at && <span style={{ fontSize: 9, fontWeight: 700, color: T.err, background: 'rgba(255,71,87,0.12)', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' }}>Deletion {new Date(s.scheduled_deletion_at).toLocaleDateString()}</span>}
            </div>
            <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>
              Owner: {s.owner_username} · {s.member_count} members · {s.days_idle}d idle
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {!s.is_archived && (
              <button
                onClick={() => handleArchive(s.id, true)}
                disabled={actionLoading === s.id}
                style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,165,0,0.1)', color: '#ffa500', border: '1px solid rgba(255,165,0,0.3)' }}
              >Archive</button>
            )}
            {s.is_archived && !s.scheduled_deletion_at && (
              <>
                <button
                  onClick={() => handleArchive(s.id, false)}
                  disabled={actionLoading === s.id}
                  style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: `${ta(T.ac,'12')}`, color: T.ac, border: `1px solid ${ta(T.ac,'40')}` }}
                >Unarchive</button>
                <button
                  onClick={() => handleScheduleDeletion(s.id, true)}
                  disabled={actionLoading === s.id}
                  style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.3)' }}
                >Schedule Delete</button>
              </>
            )}
            {s.scheduled_deletion_at && (
              <button
                onClick={() => handleScheduleDeletion(s.id, false)}
                disabled={actionLoading === s.id}
                style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: `${ta(T.ac,'12')}`, color: T.ac, border: `1px solid ${ta(T.ac,'40')}` }}
              >Cancel Deletion</button>
            )}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 10, color: T.mt, marginTop: 10, lineHeight: 1.6 }}>
        <strong>Archive:</strong> read-only, zero compute, data preserved. <strong>Deletion:</strong> 30-day countdown, owner can cancel, messages/channels/roles removed, audit tombstone kept.
      </div>
    </div>
  );
}

// ─── AdminDashboard ──────────────────────────────────────────────────────────

export function AdminDashboard({ platformUser }: AdminDashboardProps) {
  const isStaff = platformUser?.platform_role === 'admin' || platformUser?.platform_role === 'dev';

  // ── Tab state ──
  const [tab, setTab] = useState<'overview' | 'users' | 'reports' | 'bugs' | 'export' | 'errors'>('overview');
  // Reports
  const [reports, setReports] = useState<any[]>([]);
  // Bug Reports
  const [bugReports, setBugReports] = useState<any[]>([]);
  const [bugsLoading, setBugsLoading] = useState(false);

  // ── Error Reports ──
  const [errorReports, setErrorReports] = useState<any[]>([]);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [errorsTotal, setErrorsTotal] = useState(0);
  const [errorsPage, setErrorsPage] = useState(1);
  const [errorsTotalPages, setErrorsTotalPages] = useState(1);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [errSourceFilter, setErrSourceFilter] = useState('');
  const [errSevFilter, setErrSevFilter] = useState('');
  const [errShowResolved, setErrShowResolved] = useState(false);
  const [errExpandedId, setErrExpandedId] = useState<string | null>(null);
  const [errSelected, setErrSelected] = useState<Set<string>>(new Set());
  const [reportsFilter, setReportsFilter] = useState('open');
  const [reportsLoading, setReportsLoading] = useState(false);

  // ── Stats ──
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // ── Kill switches ──
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [maintMsg, setMaintMsg] = useState('');
  const [aiRateLimit, setAiRateLimit] = useState(0);
  const [officialServerId, setOfficialServerId] = useState('');

  // ── Compliance Export ──
  const [exportServerId, setExportServerId] = useState('');
  const [exportStart, setExportStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; });
  const [exportEnd, setExportEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [exportFormat, setExportFormat] = useState('json');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  const [exportError, setExportError] = useState('');
  const [exportServers, setExportServers] = useState<{ id: string; name: string }[]>([]);

  // ── Health ──
  const [health, setHealth] = useState<ServerInfo | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [uptime, setUptime] = useState<string>('—');

  // ── Registration graph ──
  const [regData, setRegData] = useState<RegDay[]>([]);
  const [regLoading, setRegLoading] = useState(false);

  // ── Users ──
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editState, setEditState] = useState<EditState | null>(null);
  const [wipeTarget, setWipeTarget] = useState<AdminUser | null>(null);
  const [wipeReason, setWipeReason] = useState('');
  const [wipeSaving, setWipeSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Loaders ──
  const loadErrors = useCallback(async (page = 1) => {
    setErrorsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '50' });
      if (errSourceFilter) params.set('source', errSourceFilter);
      if (errSevFilter) params.set('severity', errSevFilter);
      if (!errShowResolved) params.set('resolved', 'false');
      const r = await api.fetch(`/admin/errors?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setErrorReports(data.errors || []);
      setErrorsTotal(data.total || 0);
      setErrorsTotalPages(data.total_pages || 1);
      setErrorsPage(data.page || 1);
      setUnresolvedCount(data.unresolved_count || 0);
    } catch { /* ignore */ }
    finally { setErrorsLoading(false); }
  }, [errSourceFilter, errSevFilter, errShowResolved]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true); setStatsError(null);
    try {
      const r = await api.fetch('/admin/stats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStats(await r.json());
    } catch (e: any) { setStatsError(e.message ?? 'Failed'); }
    finally { setStatsLoading(false); }
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const r = await api.fetch('/admin/settings');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s: PlatformSettings = await r.json();
      setSettings(s);
      setMaintMsg(s.maintenance_message || '');
      setAiRateLimit(s.ai_rate_limit_per_minute ?? 0);
      setOfficialServerId(s.official_server_id || '');
    } catch { /* ignore */ }
    finally { setSettingsLoading(false); }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const r = await api.fetch('/info');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setHealth(await r.json());
    } catch { /* ignore */ }
    finally { setHealthLoading(false); }
  }, []);

  const loadReg = useCallback(async () => {
    setRegLoading(true);
    try {
      const r = await api.fetch('/admin/registrations');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRegData(await r.json());
    } catch { /* ignore */ }
    finally { setRegLoading(false); }
  }, []);

  const loadUsers = useCallback(async (page: number) => {
    setUsersLoading(true); setUsersError(null);
    try {
      const r = await api.fetch(`/admin/users?page=${page}&per_page=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: UserListResponse = await r.json();
      setUsers(data.users); setUsersTotal(data.total); setTotalPages(data.total_pages); setUsersPage(data.page);
    } catch (e: any) { setUsersError(e.message ?? 'Failed'); }
    finally { setUsersLoading(false); }
  }, []);

  // ── Uptime tracker ──
  const [startTime] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - startTime) / 1000);
      const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
      setUptime(h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`);
    }, 1000);
    return () => clearInterval(t);
  }, [startTime]);

  // ── Initial load ──
  useEffect(() => {
    if (!isStaff) return;
    loadStats(); loadSettings(); loadHealth(); loadReg(); loadUsers(1); loadErrors(1);
  }, [isStaff, loadStats, loadSettings, loadHealth, loadReg, loadUsers, loadErrors]);

  // Auto-refresh error reports every 30 seconds
  useEffect(() => {
    if (!isStaff || tab !== 'errors') return;
    const t = setInterval(() => loadErrors(errorsPage), 30000);
    return () => clearInterval(t);
  }, [isStaff, tab, errorsPage, loadErrors]);

  // ── Toggle a kill switch ──
  const toggleSetting = async (key: keyof PlatformSettings, value: boolean | string | number) => {
    setSettingsSaving(true);
    try {
      const r = await api.fetch('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ [key]: value }),
      });
      if (r.ok) {
        const s: PlatformSettings = await r.json();
        setSettings(s);
        setMaintMsg(s.maintenance_message || '');
        setAiRateLimit(s.ai_rate_limit_per_minute ?? 0);
        setOfficialServerId(s.official_server_id || '');
      }
    } catch { /* ignore */ }
    finally { setSettingsSaving(false); }
  };

  // ── Save role edit ──
  const handleSave = async (role: string, tier: string) => {
    if (!editState) return;
    setEditState(prev => prev ? { ...prev, saving: true, error: null } : null);
    const body: Record<string, unknown> = {};
    if (role === 'null') body.platform_role = null;
    else if (role !== '') body.platform_role = role;
    if (tier !== '') body.account_tier = tier;
    try {
      const r = await api.fetch(`/admin/users/${editState.user.id}/role`, { method: 'POST', body: JSON.stringify(body) });
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

  const q = search.trim().toLowerCase();
  const filtered = q ? users.filter(u => u.username.toLowerCase().includes(q) || (u.display_name ?? '').toLowerCase().includes(q)) : users;

  const th: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase',
    letterSpacing: '0.4px', padding: '8px 10px', textAlign: 'left',
    borderBottom: `1px solid ${T.bd}`, whiteSpace: 'nowrap', background: T.sf2,
  };
  const tdBase: React.CSSProperties = {
    fontSize: 12, color: T.tx, padding: '7px 10px',
    borderBottom: `1px solid ${ta(T.bd,'22')}`, verticalAlign: 'middle',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '16px 20px', borderBottom: `1px solid ${T.bd}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🛡️</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: T.tx }}>Admin Dashboard</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: `${ta(T.ac,'15')}`, border: `1px solid ${ta(T.ac,'30')}`, color: T.ac }}>
            {platformUser?.platform_role}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['overview', 'users', 'reports', 'bugs', 'errors', ...(platformUser?.platform_role === 'admin' ? ['export' as const] : [])] as const).map(t => (
            <button key={t} onClick={() => {
              setTab(t as any);
              if (t === 'reports') { setReportsLoading(true); api.listReports(reportsFilter).then(r => { setReports(Array.isArray(r) ? r : []); setReportsLoading(false); }).catch(() => setReportsLoading(false)); }
              if (t === 'bugs') { setBugsLoading(true); api.listBugReports().then(d => { setBugReports(Array.isArray(d?.reports) ? d.reports : Array.isArray(d) ? d : []); setBugsLoading(false); }).catch(() => setBugsLoading(false)); }
              if (t === 'errors') loadErrors(1);
            }} style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: tab === t ? T.ac : T.sf2, color: tab === t ? '#000' : T.mt,
              position: 'relative',
            }}>
              {t === 'overview' ? 'Overview' : t === 'users' ? 'Users' : t === 'reports' ? `Abuse Queue${reports.length ? ` (${reports.length})` : ''}` : t === 'bugs' ? `Bug Reports${bugReports.length ? ` (${bugReports.length})` : ''}` : t === 'errors' ? 'Error Reports' : 'Compliance Export'}
              {t === 'errors' && unresolvedCount > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: '#ff4757', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{unresolvedCount}</span>}
              {t === 'reports' && reports.filter((r: any) => r.status === 'open').length > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: '#ff4757', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{reports.filter((r: any) => r.status === 'open').length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>

            {/* AI Kill Switch Banner */}
            {settings && (settings.ai_emergency_stop || !settings.ai_bots_enabled) && (
              <div style={{
                padding: '12px 16px', background: 'rgba(255,71,87,0.1)',
                border: '1px solid rgba(255,71,87,0.3)', borderRadius: 10,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 20 }}>🚨</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.err }}>AI services are disabled platform-wide</div>
                  <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>
                    {settings.ai_emergency_stop ? 'Emergency stop is active.' : 'AI bots toggle is off.'}{' '}
                    All AI agent endpoints return 503. Re-enable in Kill Switches below.
                  </div>
                </div>
              </div>
            )}

            {/* ── Stats grid ── */}
            <div>
              <SectionHeader label="Platform Stats" loading={statsLoading} onRefresh={loadStats} />
              {statsError && <div style={{ fontSize: 12, color: T.err, marginBottom: 8 }}>⚠ {statsError}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {STAT_CARDS.map(c => (
                  <StatCard key={c.key} label={c.label} icon={c.icon} color={c.color} value={stats?.[c.key] as number} loading={statsLoading} />
                ))}
                <StatCard key="messages_today" label="Messages Today" icon="📨" color="#f97316" value={stats?.messages_today} loading={statsLoading} />
                <StatCard key="storage_used" label="Storage Used" icon="💾" color="#8b5cf6" loading={statsLoading}
                  displayValue={fmtBytes(stats?.storage_used_bytes ?? 0)} />
                <StatCard key="lockdown" label="Lockdown"
                  icon={stats?.lockdown_status ? '🔴' : '🟢'}
                  color={stats?.lockdown_status ? '#ef4444' : '#10b981'}
                  loading={statsLoading}
                  displayValue={stats?.lockdown_status ? 'ACTIVE' : 'OFF'} />
                <StatCard key="pending_bans" label="Pending Bans" icon="⚖️" color="#ef4444" value={stats?.pending_bans} loading={statsLoading} />
              </div>
            </div>

            {/* ── Kill switches ── */}
            <div>
              <SectionHeader label="Kill Switches" loading={settingsLoading} onRefresh={loadSettings} />
              {settings ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Toggle on={settings.registrations_enabled} label="Registrations" desc="Allow new account creation" disabled={settingsSaving}
                    onToggle={() => toggleSetting('registrations_enabled', !settings.registrations_enabled)} />
                  <Toggle on={settings.logins_enabled} label="Logins" desc="Allow existing users to log in" disabled={settingsSaving}
                    onToggle={() => toggleSetting('logins_enabled', !settings.logins_enabled)} />
                  <Toggle on={settings.guest_access_enabled} label="Guest Access" desc="Allow anonymous guest accounts" disabled={settingsSaving}
                    onToggle={() => toggleSetting('guest_access_enabled', !settings.guest_access_enabled)} />
                  <Toggle on={settings.ai_bots_enabled} label="AI Bots" desc="Allow AI agent prompts across all servers" disabled={settingsSaving}
                    onToggle={() => toggleSetting('ai_bots_enabled', !settings.ai_bots_enabled)} />
                  <Toggle on={settings.disappearing_messages_enabled} label="Enable Disappearing Messages" desc="When disabled, users cannot set message timers on any channel or DM. This is required for organizations with data retention compliance requirements such as HIPAA or financial regulations." disabled={settingsSaving}
                    onToggle={() => toggleSetting('disappearing_messages_enabled', !settings.disappearing_messages_enabled)} />

                  <div style={{ marginTop: 4 }} />

                  <Toggle on={settings.maintenance_mode} label="Maintenance Mode" desc="Block all non-admin requests with 503" disabled={settingsSaving}
                    onToggle={() => toggleSetting('maintenance_mode', !settings.maintenance_mode)} />

                  {settings.maintenance_mode && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, paddingLeft: 14 }}>
                      <input
                        value={maintMsg}
                        onChange={e => setMaintMsg(e.target.value)}
                        placeholder="Maintenance message shown to users…"
                        style={{ ...getInp(), fontSize: 12, padding: '8px 12px', flex: 1 }}
                      />
                      <button
                        disabled={settingsSaving || maintMsg === settings.maintenance_message}
                        onClick={() => toggleSetting('maintenance_message', maintMsg)}
                        style={{
                          padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          border: 'none', cursor: maintMsg === settings.maintenance_message ? 'not-allowed' : 'pointer',
                          background: maintMsg === settings.maintenance_message ? T.sf2 : T.ac,
                          color: maintMsg === settings.maintenance_message ? T.mt : '#000',
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: T.mt, fontSize: 12, padding: 12 }}>Loading settings…</div>
              )}
            </div>

            {/* ── AI Configuration ── */}
            {settings && (
              <div style={cardStyle}>
                <SectionHeader label="AI Configuration" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* Emergency stop */}
                  <Toggle
                    on={settings.ai_emergency_stop}
                    label="Emergency AI Stop"
                    desc="Immediately halt all bot responses across the platform"
                    disabled={settingsSaving}
                    onToggle={() => toggleSetting('ai_emergency_stop', !settings.ai_emergency_stop)}
                  />

                  {/* Global model override */}
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Global Model Override</div>
                        <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Override all bots to use a specific model. Empty = per-bot config.</div>
                      </div>
                      <select
                        value={settings.ai_global_model}
                        onChange={e => toggleSetting('ai_global_model', e.target.value)}
                        disabled={settingsSaving}
                        style={{
                          ...getInp(), fontSize: 12, padding: '6px 10px', width: 180,
                          cursor: settingsSaving ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <option value="">Per-bot default</option>
                        <option value="claude-haiku">Claude Haiku (fast, cheap)</option>
                        <option value="claude-sonnet">Claude Sonnet (balanced)</option>
                        <option value="ollama-local">Ollama Local (self-hosted)</option>
                      </select>
                    </div>
                    {settings.ai_global_model && (
                      <div style={{ marginTop: 8, fontSize: 11, color: T.ac, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <StatusDot ok={true} />
                        Active override: <strong>{settings.ai_global_model}</strong> — all bots using this model
                      </div>
                    )}
                  </div>

                  {/* AI rate limit slider */}
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>AI Rate Limit</div>
                        <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Max AI prompts per user per minute. 0 = unlimited.</div>
                      </div>
                      <span style={{ fontSize: 18, fontWeight: 800, color: aiRateLimit === 0 ? T.mt : T.ac, fontVariantNumeric: 'tabular-nums' }}>
                        {aiRateLimit === 0 ? '∞' : `${aiRateLimit}/min`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 10, color: T.mt }}>0</span>
                      <input
                        type="range" min={0} max={60} step={1}
                        value={aiRateLimit}
                        onChange={e => setAiRateLimit(Number(e.target.value))}
                        onMouseUp={() => toggleSetting('ai_rate_limit_per_minute', aiRateLimit)}
                        onTouchEnd={() => toggleSetting('ai_rate_limit_per_minute', aiRateLimit)}
                        style={{ flex: 1, accentColor: T.ac, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 10, color: T.mt }}>60</span>
                    </div>
                  </div>

                  {/* Current AI status summary */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { label: 'AI Bots', ok: settings.ai_bots_enabled && !settings.ai_emergency_stop },
                      { label: 'Model', ok: true, text: settings.ai_global_model || 'Per-bot' },
                      { label: 'Rate Limit', ok: true, text: settings.ai_rate_limit_per_minute ? `${settings.ai_rate_limit_per_minute}/min` : 'Unlimited' },
                    ].map(s => (
                      <div key={s.label} style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 5,
                        background: s.ok ? `${ta(T.ac,'10')}` : 'rgba(255,71,87,0.1)',
                        border: `1px solid ${s.ok ? `${ta(T.ac,'30')}` : 'rgba(255,71,87,0.3)'}`,
                        color: s.ok ? T.ac : '#ff4757',
                      }}>
                        <StatusDot ok={s.ok} />{s.label}{s.text ? `: ${s.text}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Onboarding ── */}
            {settings && (
              <div style={cardStyle}>
                <SectionHeader label="Onboarding" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.tx, marginBottom: 4 }}>Official Server ID</div>
                    <div style={{ fontSize: 11, color: T.mt, marginBottom: 8 }}>New users auto-join this server on registration. Leave blank to disable.</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        value={officialServerId}
                        onChange={e => setOfficialServerId(e.target.value)}
                        placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                        style={{
                          flex: 1, padding: '8px 10px', background: T.bg,
                          border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx,
                          fontSize: 12, fontFamily: 'monospace', outline: 'none',
                        }}
                      />
                      <button
                        disabled={settingsSaving || officialServerId === (settings.official_server_id || '')}
                        onClick={() => toggleSetting('official_server_id', officialServerId.trim())}
                        style={{
                          padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                          border: 'none', cursor: officialServerId === (settings.official_server_id || '') ? 'not-allowed' : 'pointer',
                          background: officialServerId === (settings.official_server_id || '') ? T.sf2 : T.ac,
                          color: officialServerId === (settings.official_server_id || '') ? T.mt : '#000',
                        }}
                      >
                        Save
                      </button>
                      {settings.official_server_id && (
                        <button
                          disabled={settingsSaving}
                          onClick={() => { setOfficialServerId(''); toggleSetting('official_server_id', ''); }}
                          style={{
                            padding: '8px 12px', borderRadius: 6, fontSize: 12,
                            border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, cursor: 'pointer',
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Server Health + Active Defense — side by side ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

              {/* Server Health */}
              <div style={cardStyle}>
                <SectionHeader label="Server Health" loading={healthLoading} onRefresh={loadHealth} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>Session Uptime</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.ac, fontVariantNumeric: 'tabular-nums' }}>{uptime}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>Database</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      <StatusDot ok={health?.connectivity.database ?? false} />
                      {health?.connectivity.database ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>Redis</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      <StatusDot ok={health?.connectivity.redis ?? false} />
                      {health?.connectivity.redis ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>Version</span>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: T.tx }}>{health?.version ?? '—'}</span>
                  </div>
                  {health?.features && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {Object.entries(health.features).filter(([, v]) => v).map(([k]) => (
                        <span key={k} style={{
                          fontSize: 9, padding: '2px 6px', borderRadius: 3,
                          background: `${ta(T.ac,'15')}`, color: T.ac, border: `1px solid ${ta(T.ac,'30')}`,
                        }}>{k}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Active Defense */}
              <div style={cardStyle}>
                <SectionHeader label="Active Defense" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>Rate Limiting</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      <StatusDot ok={true} />
                      {health?.limits?.rate_limit_per_minute ?? '—'}/min per IP
                    </span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: T.mt }}>Auth Rate Limit</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{health?.limits?.auth_rate_limit_per_minute ?? 30}/min</span>
                    </div>
                    <MiniBar value={health?.limits?.auth_rate_limit_per_minute ?? 30} max={100} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>CAPTCHA</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      <StatusDot ok={!!health?.features?.rate_limiting} />
                      {health?.features?.rate_limiting ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>Registrations Today</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>{stats?.registrations_today ?? 0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.mt }}>Guest Accounts</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#6b7280' }}>{stats?.guest_users ?? 0}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Registration Graph ── */}
            <div style={cardStyle}>
              <SectionHeader label="Registrations — Last 30 Days" loading={regLoading} onRefresh={loadReg} />
              <RegGraph data={regData} loading={regLoading} />
            </div>

            {/* ── Data Management ── */}
            {settings && (
              <div style={cardStyle}>
                <SectionHeader label="Data Management" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* Data Retention */}
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Data Retention</div>
                        <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Minimum period messages must be preserved.</div>
                      </div>
                      <select
                        value={settings.default_retention_days}
                        onChange={e => toggleSetting('default_retention_days', Number(e.target.value))}
                        disabled={settingsSaving}
                        style={{ ...getInp(), fontSize: 12, padding: '6px 10px', width: 170, cursor: settingsSaving ? 'not-allowed' : 'pointer' }}
                      >
                        <option value={0}>Off</option>
                        <option value={90}>90 Days</option>
                        <option value={365}>1 Year</option>
                        <option value={1095}>3 Years</option>
                        <option value={2190}>6 Years (HIPAA)</option>
                        <option value={2555}>7 Years (Financial)</option>
                      </select>
                    </div>
                    <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
                      Messages are preserved for the configured retention period regardless of user deletion or disappearing message timers. HIPAA requires 6 years. SEC and FINRA require up to 7 years.
                    </div>
                  </div>

                  {/* Global disappearing default */}
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Disappearing Messages Default</div>
                        <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Per-message auto-expiry. Servers/channels can override with shorter durations.</div>
                      </div>
                      <select
                        value={settings.global_disappearing_default}
                        onChange={e => toggleSetting('global_disappearing_default', e.target.value)}
                        disabled={settingsSaving}
                        style={{ ...getInp(), fontSize: 12, padding: '6px 10px', width: 140, cursor: settingsSaving ? 'not-allowed' : 'pointer' }}
                      >
                        <option value="off">Off</option>
                        <option value="24h">24 hours</option>
                        <option value="7d">7 days</option>
                        <option value="30d">30 days</option>
                      </select>
                    </div>
                  </div>

                  {/* Info box */}
                  <div style={{ fontSize: 11, color: T.mt, padding: '8px 14px', background: `${ta(T.ac,'08')}`, borderRadius: 6, border: `1px solid ${ta(T.ac,'20')}`, lineHeight: 1.6 }}>
                    <strong style={{ color: T.ac }}>Protected data</strong> is never purged by retention policies: audit log entries, server settings changes, channel create/delete/rename, role changes, and member join/leave/kick/ban events. These live on the hash chain permanently.
                  </div>
                </div>
              </div>
            )}

            {/* ── SAML Configuration ── */}
            <div style={{ marginBottom: 20 }}>
              <SectionHeader label="SAML SSO (Enterprise)" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Toggle on={!!(settings as any)?.saml_enabled} label="Enable SAML SSO" desc="Allow users to log in via enterprise identity provider (Okta, Azure AD, etc.)" disabled={settingsSaving}
                  onToggle={() => toggleSetting('saml_enabled' as any, !(settings as any)?.saml_enabled)} />
                {(settings as any)?.saml_enabled && (<>
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>IdP Metadata URL</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={(settings as any)?.saml_idp_metadata_url || ''} onChange={e => toggleSetting('saml_idp_metadata_url' as any, e.target.value)}
                        placeholder="https://login.microsoftonline.com/.../metadata" style={{ ...getInp(), flex: 1, fontSize: 12, marginBottom: 0 }} />
                    </div>
                  </div>
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>IdP SSO Login URL</label>
                    <input value={(settings as any)?.saml_sso_url || ''} onChange={e => toggleSetting('saml_sso_url' as any, e.target.value)}
                      placeholder="https://login.microsoftonline.com/.../saml2" style={{ ...getInp(), fontSize: 12 }} />
                  </div>
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>IdP Certificate (PEM)</label>
                    <textarea value={(settings as any)?.saml_idp_certificate || ''} onChange={e => toggleSetting('saml_idp_certificate' as any, e.target.value)}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----" rows={4}
                      style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 11, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ fontSize: 10, color: T.mt, lineHeight: 1.6, padding: '4px 14px' }}>
                    SP Metadata URL: <code style={{ color: T.ac }}>{window.location.origin}/api/v1/auth/saml/metadata</code>
                  </div>
                </>)}
              </div>
            </div>

            {/* ── LDAP Configuration ── */}
            <div style={{ marginBottom: 20 }}>
              <SectionHeader label="LDAP Directory Sync (Enterprise)" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Toggle on={!!(settings as any)?.ldap_enabled} label="Enable LDAP Sync" desc="Automatically provision and update users from your LDAP/Active Directory." disabled={settingsSaving}
                  onToggle={() => toggleSetting('ldap_enabled' as any, !(settings as any)?.ldap_enabled)} />
                {(settings as any)?.ldap_enabled && (<>
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>LDAP URL</label>
                    <input value={(settings as any)?.ldap_url || ''} onChange={e => toggleSetting('ldap_url' as any, e.target.value)}
                      placeholder="ldaps://ldap.example.com:636" style={{ ...getInp(), fontSize: 12 }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Bind DN</label>
                      <input value={(settings as any)?.ldap_bind_dn || ''} onChange={e => toggleSetting('ldap_bind_dn' as any, e.target.value)}
                        placeholder="cn=admin,dc=example,dc=com" style={{ ...getInp(), fontSize: 11 }} />
                    </div>
                    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Bind Password</label>
                      <input type="password" value={(settings as any)?.ldap_bind_password || ''} onChange={e => toggleSetting('ldap_bind_password' as any, e.target.value)}
                        placeholder="••••••••" style={{ ...getInp(), fontSize: 11 }} autoComplete="off" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Base DN</label>
                      <input value={(settings as any)?.ldap_base_dn || ''} onChange={e => toggleSetting('ldap_base_dn' as any, e.target.value)}
                        placeholder="ou=people,dc=example,dc=com" style={{ ...getInp(), fontSize: 11 }} />
                    </div>
                    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>User Filter</label>
                      <input value={(settings as any)?.ldap_user_filter || '(objectClass=person)'} onChange={e => toggleSetting('ldap_user_filter' as any, e.target.value)}
                        placeholder="(objectClass=person)" style={{ ...getInp(), fontSize: 11, fontFamily: 'monospace' }} />
                    </div>
                  </div>
                  <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Sync Interval (seconds)</label>
                    <input type="number" min={60} value={(settings as any)?.ldap_sync_interval || 3600} onChange={e => toggleSetting('ldap_sync_interval' as any, Number(e.target.value))}
                      style={{ ...getInp(), fontSize: 12, width: 120 }} />
                    <span style={{ fontSize: 10, color: T.mt, marginLeft: 8 }}>Default: 3600 (1 hour). Minimum: 60.</span>
                  </div>
                </>)}
              </div>
            </div>

            {/* ── Inactive Servers ── */}
            <InactiveServersPanel />
          </div>
        )}

        {/* ── Users Tab ── */}
        {tab === 'users' && (
          <div style={{ maxWidth: 1000 }}>
            <SectionHeader label={`Users${usersTotal > 0 ? ` (${usersTotal.toLocaleString()})` : ''}`} loading={usersLoading} onRefresh={() => loadUsers(usersPage)} />

            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by username or display name…"
              style={{ ...getInp(), fontSize: 12, padding: '8px 12px', marginBottom: 10 }}
            />

            {usersError && <div style={{ fontSize: 12, color: T.err, marginBottom: 8 }}>⚠ {usersError}</div>}

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
                    <tr><td colSpan={8} style={{ ...tdBase, textAlign: 'center', color: T.mt, padding: 24 }}>Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...tdBase, textAlign: 'center', color: T.mt, padding: 24 }}>{q ? 'No users match.' : 'No users found.'}</td></tr>
                  ) : filtered.map(u => {
                    const isEditing = editState?.user.id === u.id;
                    return (
                      <React.Fragment key={u.id}>
                        <tr style={{ background: isEditing ? `${ta(T.ac,'08')}` : 'transparent' }}>
                          <td style={tdBase}>
                            <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}>{u.username}</span>
                            {u.is_bot && <span style={{ marginLeft: 5, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#a855f720', color: '#a855f7', border: '1px solid #a855f740' }}>BOT</span>}
                          </td>
                          <td style={{ ...tdBase, color: T.mt, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.display_name || <span style={{ color: T.bd }}>—</span>}
                          </td>
                          <td style={tdBase}><TierPill tier={u.account_tier} /></td>
                          <td style={tdBase}><TierPill tier={u.platform_role} /></td>
                          <td style={{ ...tdBase, textAlign: 'center', fontSize: 16 }}>
                            {u.badge_type ? (BADGE_EMOJI[u.badge_type] ?? u.badge_type) : <span style={{ color: T.bd, fontSize: 11 }}>—</span>}
                          </td>
                          <td style={{ ...tdBase, textAlign: 'center' }}>
                            {u.email_verified ? <span style={{ color: '#10b981', fontWeight: 800, fontSize: 14 }}>✓</span> : <span style={{ color: T.mt, fontSize: 13 }}>✗</span>}
                          </td>
                          <td style={{ ...tdBase, color: T.mt, whiteSpace: 'nowrap', fontSize: 11 }}>{fmtDate(u.created_at)}</td>
                          <td style={{ ...tdBase, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            {isEditing ? (
                              <button onClick={() => setEditState(null)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, cursor: 'pointer' }}>Cancel</button>
                            ) : (
                              <button onClick={() => setEditState({ user: u, platform_role: '', account_tier: '', saving: false, error: null })} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, background: `${ta(T.ac,'18')}`, color: T.ac, border: `1px solid ${ta(T.ac,'44')}`, cursor: 'pointer' }}>Edit Role</button>
                            )}
                            <button onClick={() => { setWipeTarget(u); setWipeReason(''); }} title="Wipe all sessions" style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                              Wipe
                            </button>
                            </div>
                          </td>
                        </tr>
                        {isEditing && editState && <EditPanel edit={editState} onSave={handleSave} onCancel={() => setEditState(null)} />}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
                <button disabled={usersPage <= 1 || usersLoading} onClick={() => { setEditState(null); loadUsers(usersPage - 1); }} style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12,
                  background: usersPage <= 1 ? T.sf2 : `${ta(T.ac,'18')}`, color: usersPage <= 1 ? T.mt : T.ac,
                  border: `1px solid ${usersPage <= 1 ? T.bd : `${ta(T.ac,'44')}`}`, cursor: usersPage <= 1 ? 'not-allowed' : 'pointer',
                }}>← Prev</button>
                <span style={{ fontSize: 11, color: T.mt }}>Page {usersPage} of {totalPages}</span>
                <button disabled={usersPage >= totalPages || usersLoading} onClick={() => { setEditState(null); loadUsers(usersPage + 1); }} style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12,
                  background: usersPage >= totalPages ? T.sf2 : `${ta(T.ac,'18')}`, color: usersPage >= totalPages ? T.mt : T.ac,
                  border: `1px solid ${usersPage >= totalPages ? T.bd : `${ta(T.ac,'44')}`}`, cursor: usersPage >= totalPages ? 'not-allowed' : 'pointer',
                }}>Next →</button>
              </div>
            )}
          </div>
        )}

        {tab === 'reports' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Abuse Queue</span>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                {['open', 'dismissed', 'actioned'].map(s => (
                  <button key={s} onClick={() => { setReportsFilter(s); setReportsLoading(true); api.listReports(s).then(r => { setReports(Array.isArray(r) ? r : []); setReportsLoading(false); }); }}
                    style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: reportsFilter === s ? T.ac : T.sf2, color: reportsFilter === s ? '#000' : T.mt, textTransform: 'capitalize' }}>{s}</button>
                ))}
              </div>
            </div>
            {reportsLoading && <div style={{ color: T.mt, fontSize: 12, padding: 20, textAlign: 'center' }}>Loading...</div>}
            {!reportsLoading && reports.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>No {reportsFilter} reports</div>
                <div style={{ fontSize: 12, color: T.mt }}>User reports will appear here for review.</div>
              </div>
            )}
            {reports.map((r: any) => {
              const reasonLabels: Record<string, string> = { spam: 'Spam', harassment: 'Harassment', illegal_content: 'Illegal Content', other: 'Other' };
              const reasonColors: Record<string, string> = { spam: '#faa61a', harassment: '#ff4757', illegal_content: '#ff4757', other: T.mt };
              return (
                <div key={r.id} style={{ padding: '12px 14px', background: T.sf2, borderRadius: 10, border: `1px solid ${r.reason === 'illegal_content' ? 'rgba(255,71,87,0.4)' : T.bd}`, marginBottom: 8 }}>
                  {/* Report header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${reasonColors[r.reason] || T.mt}22`, color: reasonColors[r.reason] || T.mt }}>{reasonLabels[r.reason] || r.reason}</span>
                    <span style={{ fontSize: 11, color: T.mt }}>by <strong style={{ color: T.tx }}>{r.reporter_username || '?'}</strong></span>
                    <span style={{ fontSize: 10, color: T.mt, marginLeft: 'auto' }}>{new Date(r.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  {/* Reported user metadata */}
                  <div style={{ fontSize: 11, color: T.mt, marginBottom: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>User: <strong style={{ color: T.tx }}>{r.message_author_username || '?'}</strong></span>
                    {r.message_author_id && <span style={{ fontFamily: 'monospace', fontSize: 10 }}>ID: {r.message_author_id.slice(0, 8)}...</span>}
                  </div>
                  {/* Message content preview */}
                  <div style={{ padding: '6px 10px', background: T.bg, borderRadius: 6, border: `1px solid ${T.bd}`, marginBottom: 6, fontSize: 12, color: T.tx, lineHeight: 1.5, maxHeight: 80, overflow: 'hidden' }}>
                    <span style={{ fontWeight: 600 }}>{r.message_author_username || '?'}: </span>
                    {r.message_content || '(encrypted — content unavailable to server)'}
                  </div>
                  {r.details && <div style={{ fontSize: 11, color: T.mt, marginBottom: 8, fontStyle: 'italic' }}>Reporter notes: "{r.details}"</div>}
                  {/* Actions */}
                  {r.status === 'open' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={async () => { try { await api.resolveReport(r.id, 'dismissed'); setReports(prev => prev.filter(x => x.id !== r.id)); setToast({ msg: 'Report dismissed', ok: true }); } catch {} setTimeout(() => setToast(null), 3000); }}
                        style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.bg, color: T.mt, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Dismiss</button>
                      <button onClick={async () => {
                        try {
                          await api.fetch(`/admin/users/${r.message_author_id}/warn`, { method: 'POST', body: JSON.stringify({ reason: r.reason, message: `Your message was reported for ${reasonLabels[r.reason] || r.reason}. Please review the Terms of Service.` }) });
                          await api.resolveReport(r.id, 'actioned');
                          setReports(prev => prev.filter(x => x.id !== r.id));
                          setToast({ msg: 'Warning sent to user', ok: true });
                        } catch { setToast({ msg: 'Failed to warn user', ok: false }); }
                        setTimeout(() => setToast(null), 3000);
                      }}
                        style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(250,166,26,0.3)', background: 'rgba(250,166,26,0.1)', color: '#faa61a', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Warn User</button>
                      <button onClick={async () => {
                        if (!confirm(`Permanently ban ${r.message_author_username || 'this user'}?\n\nThis will:\n- Disable the account\n- Revoke all sessions\n- Ban their IP address\n- Record all metadata in audit log`)) return;
                        try {
                          await api.fetch(`/admin/users/${r.message_author_id}/ban`, { method: 'POST', body: JSON.stringify({ reason: `Content violation: ${r.reason}. Report ID: ${r.id}`, ip_ban: true }) });
                          await api.resolveReport(r.id, 'actioned');
                          setReports(prev => prev.filter(x => x.id !== r.id));
                          setToast({ msg: `${r.message_author_username} banned permanently`, ok: true });
                        } catch { setToast({ msg: 'Ban failed', ok: false }); }
                        setTimeout(() => setToast(null), 3000);
                      }}
                        style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,71,87,0.3)', background: 'rgba(255,71,87,0.1)', color: T.err, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Ban User</button>
                      {r.reason === 'illegal_content' && (
                        <button onClick={async () => {
                          if (!confirm('ESCALATE TO NCMEC?\n\nThis will:\n- Permanently ban the user with IP ban\n- Preserve all metadata (IP, email, timestamps, device info)\n- Flag this report for NCMEC submission per 18 U.S.C. § 2258A\n\nThis action is irreversible.')) return;
                          try {
                            await api.fetch(`/admin/users/${r.message_author_id}/ban`, { method: 'POST', body: JSON.stringify({ reason: `CSAM/illegal content — NCMEC escalation. Report ID: ${r.id}`, ip_ban: true }) });
                            await api.resolveReport(r.id, 'actioned');
                            setReports(prev => prev.filter(x => x.id !== r.id));
                            setToast({ msg: 'User banned — flagged for NCMEC report', ok: true });
                          } catch { setToast({ msg: 'Escalation failed', ok: false }); }
                          setTimeout(() => setToast(null), 5000);
                        }}
                          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,71,87,0.5)', background: 'rgba(255,71,87,0.2)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Escalate (NCMEC)</button>
                      )}
                    </div>
                  )}
                  {r.status !== 'open' && (
                    <div style={{ fontSize: 10, color: r.status === 'actioned' ? T.err : T.mt, fontWeight: 600 }}>Resolved: {r.status}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'bugs' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Bug Reports</span>
              <button onClick={() => { setBugsLoading(true); api.listBugReports().then(d => { setBugReports(Array.isArray(d?.reports) ? d.reports : Array.isArray(d) ? d : []); setBugsLoading(false); }).catch(() => setBugsLoading(false)); }}
                style={{ padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: `1px solid ${T.bd}`, cursor: 'pointer', background: T.bg, color: T.mt, marginLeft: 'auto' }}>Refresh</button>
            </div>
            {bugsLoading && <div style={{ color: T.mt, fontSize: 12, padding: 20, textAlign: 'center' }}>Loading...</div>}
            {!bugsLoading && bugReports.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>No bug reports</div>
                <div style={{ fontSize: 12, color: T.mt }}>Bug reports submitted via the bug icon will appear here.</div>
              </div>
            )}
            {bugReports.map((b: any) => {
              const sevColors: Record<string, string> = { low: T.mt, medium: '#faa61a', high: '#ff6b35', critical: '#ff4757' };
              const sevColor = sevColors[b.severity] || T.mt;
              return (
                <div key={b.id} style={{ padding: '12px 14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14 }}>🐛</span>
                    {b.severity && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${sevColor}22`, color: sevColor, textTransform: 'uppercase' }}>{b.severity}</span>}
                    {b.reporter_user_id && <span style={{ fontSize: 10, color: T.mt }}>User: {b.reporter_user_id.slice(0, 8)}...</span>}
                    <span style={{ fontSize: 10, color: T.mt, marginLeft: 'auto' }}>{new Date(b.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.5, marginBottom: 6, wordBreak: 'break-word' }}>{b.description}</div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, color: T.mt }}>
                    {b.page && <span>Page: <span style={{ fontFamily: 'monospace' }}>{b.page}</span></span>}
                    {b.error_code && <span>Error: <span style={{ fontFamily: 'monospace', color: '#faa61a' }}>{b.error_code}</span></span>}
                    {b.browser_info && <span title={b.browser_info}>Browser: {b.browser_info.slice(0, 40)}...</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'export' && platformUser?.platform_role === 'admin' && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Compliance Export</div>
            <div style={{ padding: '12px 14px', background: 'rgba(250,166,26,0.06)', borderRadius: 8, border: '1px solid rgba(250,166,26,0.15)', marginBottom: 16, fontSize: 12, lineHeight: 1.6, color: '#faa61a' }}>
              Exported message content is encrypted ciphertext. The platform admin cannot read plaintext — only channel members with the decryption key can decrypt. Exports are rate-limited to 1 per hour and recorded in the audit log.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Server</label>
                <select value={exportServerId} onChange={e => setExportServerId(e.target.value)} onFocus={() => { if (exportServers.length === 0) api.listServers().then((s: any) => { if (Array.isArray(s)) setExportServers(s.map((sv: any) => ({ id: sv.id, name: sv.name }))); }); }} style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12 }}>
                  <option value="">Select server...</option>
                  {exportServers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Format</label>
                <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12 }}>
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Start Date</label>
                <input type="date" value={exportStart} onChange={e => setExportStart(e.target.value)} style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>End Date</label>
                <input type="date" value={exportEnd} onChange={e => setExportEnd(e.target.value)} style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12, boxSizing: 'border-box' }} />
              </div>
            </div>

            <button
              onClick={async () => {
                if (!exportServerId) return;
                setExportLoading(true); setExportError(''); setExportResult(null);
                try {
                  const start = new Date(exportStart).toISOString();
                  const end = new Date(exportEnd + 'T23:59:59Z').toISOString();
                  const result = await api.complianceExport(exportServerId, start, end, exportFormat);
                  setExportResult(result);
                } catch (e: any) { setExportError(e?.message || 'Export failed'); }
                setExportLoading(false);
              }}
              disabled={!exportServerId || exportLoading}
              style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: exportLoading ? T.sf2 : T.ac, color: exportLoading ? T.mt : '#000', fontSize: 13, fontWeight: 700, cursor: !exportServerId || exportLoading ? 'not-allowed' : 'pointer', opacity: !exportServerId ? 0.5 : 1, marginBottom: 12 }}
            >
              {exportLoading ? 'Exporting...' : 'Generate Export'}
            </button>

            {exportError && (
              <div style={{ padding: '10px 14px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: 8, color: T.err, fontSize: 12, marginBottom: 12 }}>{exportError}</div>
            )}

            {exportResult && (
              <div style={{ padding: '14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>Export Complete</div>
                  <button onClick={() => {
                    const blob = new Blob([JSON.stringify(exportResult, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `compliance-export-${exportStart}-to-${exportEnd}.json`; a.click(); URL.revokeObjectURL(url);
                  }} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.bg, color: T.ac, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Download</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12, marginBottom: 10 }}>
                  <div style={{ padding: '8px', background: T.bg, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.ac }}>{exportResult.message_count ?? exportResult.messages?.length ?? 0}</div>
                    <div style={{ fontSize: 10, color: T.mt }}>Messages</div>
                  </div>
                  <div style={{ padding: '8px', background: T.bg, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.ac }}>{exportResult.member_count ?? exportResult.members?.length ?? 0}</div>
                    <div style={{ fontSize: 10, color: T.mt }}>Members</div>
                  </div>
                  <div style={{ padding: '8px', background: T.bg, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.ac }}>{exportResult.audit_count ?? exportResult.audit_log?.length ?? 0}</div>
                    <div style={{ fontSize: 10, color: T.mt }}>Audit Entries</div>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: T.mt, fontStyle: 'italic' }}>{exportResult.notice}</div>
              </div>
            )}
          </div>
        )}

        {/* ── Error Reports Tab ── */}
        {tab === 'errors' && (
          <div style={{ maxWidth: 1000 }}>
            <SectionHeader label={`Error Reports${unresolvedCount ? ` (${unresolvedCount} unresolved)` : ''}`} loading={errorsLoading} onRefresh={() => loadErrors(errorsPage)} />

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={errSourceFilter} onChange={e => { setErrSourceFilter(e.target.value); loadErrors(1); }} style={{ padding: '4px 8px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 11 }}>
                <option value="">All sources</option>
                <option value="client">Client</option>
                <option value="server">Server</option>
              </select>
              <select value={errSevFilter} onChange={e => { setErrSevFilter(e.target.value); loadErrors(1); }} style={{ padding: '4px 8px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 11 }}>
                <option value="">All severity</option>
                <option value="critical">Critical</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.mt, cursor: 'pointer' }}>
                <input type="checkbox" checked={errShowResolved} onChange={e => { setErrShowResolved(e.target.checked); loadErrors(1); }} style={{ accentColor: T.ac }} />
                Show resolved
              </label>
              {errSelected.size > 0 && (
                <button onClick={async () => {
                  try {
                    await api.fetch('/admin/errors/bulk-resolve', { method: 'POST', body: JSON.stringify({ ids: [...errSelected] }) });
                    setErrSelected(new Set());
                    loadErrors(errorsPage);
                  } catch { /* ignore */ }
                }} style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', background: T.ac, color: '#000', cursor: 'pointer' }}>
                  Resolve Selected ({errSelected.size})
                </button>
              )}
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${T.bd}` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: `2px solid ${T.bd}`, fontWeight: 700, color: T.mt, fontSize: 10, width: 28 }}></th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: `2px solid ${T.bd}`, fontWeight: 700, color: T.mt, fontSize: 10 }}>Time</th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: `2px solid ${T.bd}`, fontWeight: 700, color: T.mt, fontSize: 10 }}>Source</th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: `2px solid ${T.bd}`, fontWeight: 700, color: T.mt, fontSize: 10 }}>Component</th>
                    <th style={{ padding: '8px 6px', textAlign: 'left', borderBottom: `2px solid ${T.bd}`, fontWeight: 700, color: T.mt, fontSize: 10 }}>Message</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', borderBottom: `2px solid ${T.bd}`, fontWeight: 700, color: T.mt, fontSize: 10 }}>Severity</th>
                    <th style={{ padding: '8px 6px', textAlign: 'center', borderBottom: `2px solid ${T.bd}`, fontWeight: 700, color: T.mt, fontSize: 10, width: 60 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {errorReports.map((er: any) => {
                    const sevColor: Record<string, string> = { critical: '#ff4757', error: '#f97316', warning: '#fbbf24', info: '#3b82f6' };
                    const srcColor: Record<string, string> = { client: '#3b82f6', server: '#f97316' };
                    const isExpanded = errExpandedId === er.id;
                    return (
                      <React.Fragment key={er.id}>
                        <tr onClick={() => setErrExpandedId(isExpanded ? null : er.id)} style={{ cursor: 'pointer', background: er.resolved ? 'transparent' : 'rgba(255,71,87,0.03)', borderBottom: `1px solid ${T.bd}` }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                          onMouseLeave={e => e.currentTarget.style.background = er.resolved ? 'transparent' : 'rgba(255,71,87,0.03)'}>
                          <td style={{ padding: '6px' }}>
                            <input type="checkbox" checked={errSelected.has(er.id)} onClick={e => e.stopPropagation()} onChange={e => {
                              const next = new Set(errSelected);
                              if (e.target.checked) next.add(er.id); else next.delete(er.id);
                              setErrSelected(next);
                            }} style={{ accentColor: T.ac }} />
                          </td>
                          <td style={{ padding: '6px', color: T.mt, whiteSpace: 'nowrap' }}>{fmtDate(er.created_at)}</td>
                          <td style={{ padding: '6px' }}><span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: `${srcColor[er.source] || T.mt}22`, color: srcColor[er.source] || T.mt, fontWeight: 700 }}>{er.source}</span></td>
                          <td style={{ padding: '6px', color: T.tx, fontFamily: 'monospace', fontSize: 10 }}>{er.component || '—'}</td>
                          <td style={{ padding: '6px', color: T.tx, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{er.error_message?.slice(0, 80)}{er.error_message?.length > 80 ? '…' : ''}</td>
                          <td style={{ padding: '6px', textAlign: 'center' }}><span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: `${sevColor[er.severity] || T.mt}22`, color: sevColor[er.severity] || T.mt, fontWeight: 700 }}>{er.severity}</span></td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            {!er.resolved ? (
                              <button onClick={async (e) => { e.stopPropagation(); try { await api.fetch(`/admin/errors/${er.id}/resolve`, { method: 'PATCH' }); loadErrors(errorsPage); } catch {} }} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${T.bd}`, background: 'none', color: T.ac, cursor: 'pointer' }}>Resolve</button>
                            ) : <span style={{ fontSize: 10, color: '#10b981' }}>&#10003;</span>}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr><td colSpan={7} style={{ padding: '12px 16px', background: T.bg, borderBottom: `1px solid ${T.bd}` }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10, fontSize: 11 }}>
                              <div><span style={{ color: T.mt }}>User: </span><span style={{ color: T.tx }}>{er.user_email || '—'}</span></div>
                              <div><span style={{ color: T.mt }}>Browser: </span><span style={{ color: T.tx, fontSize: 10 }}>{er.browser || '—'}</span></div>
                              <div><span style={{ color: T.mt }}>Component: </span><span style={{ color: T.ac, fontFamily: 'monospace' }}>{er.component || '—'}</span></div>
                              <div><span style={{ color: T.mt }}>Resolved: </span><span style={{ color: er.resolved ? '#10b981' : T.err }}>{er.resolved ? `Yes (${fmtDate(er.resolved_at)})` : 'No'}</span></div>
                            </div>
                            {er.stack_trace && (
                              <pre style={{ padding: 10, background: T.sf2, borderRadius: 6, border: `1px solid ${T.bd}`, fontSize: 10, color: T.mt, fontFamily: "'JetBrains Mono',monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto', margin: 0 }}>{er.stack_trace}</pre>
                            )}
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {errorReports.length === 0 && !errorsLoading && (
                    <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: T.mt }}>No error reports found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {errorsTotalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
                <button disabled={errorsPage <= 1} onClick={() => loadErrors(errorsPage - 1)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, border: `1px solid ${T.bd}`, background: T.sf2, color: errorsPage <= 1 ? T.mt : T.ac, cursor: errorsPage <= 1 ? 'not-allowed' : 'pointer' }}>Prev</button>
                <span style={{ fontSize: 11, color: T.mt }}>Page {errorsPage} of {errorsTotalPages} ({errorsTotal} total)</span>
                <button disabled={errorsPage >= errorsTotalPages} onClick={() => loadErrors(errorsPage + 1)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, border: `1px solid ${T.bd}`, background: T.sf2, color: errorsPage >= errorsTotalPages ? T.mt : T.ac, cursor: errorsPage >= errorsTotalPages ? 'not-allowed' : 'pointer' }}>Next</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Wipe Sessions Modal ── */}
      {wipeTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { if (!wipeSaving) { setWipeTarget(null); } }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 4 }}>Revoke All Sessions for {wipeTarget.username}</div>
            <div style={{ fontSize: 12, color: T.mt, marginBottom: 16, lineHeight: 1.6 }}>
              This will immediately log this user out of every device. This action cannot be undone.
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Reason for wipe</label>
            <input
              value={wipeReason}
              onChange={e => setWipeReason(e.target.value)}
              placeholder="e.g. Lost device, security concern"
              maxLength={500}
              autoFocus
              style={{ width: '100%', padding: '10px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setWipeTarget(null)} disabled={wipeSaving} style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button
                disabled={wipeReason.trim().length < 5 || wipeSaving}
                onClick={async () => {
                  setWipeSaving(true);
                  try {
                    const r = await api.fetch(`/admin/users/${wipeTarget.id}/wipe`, { method: 'POST', body: JSON.stringify({ reason: wipeReason.trim() }) });
                    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error || `HTTP ${r.status}`); }
                    const data = await r.json();
                    setToast({ msg: `Wiped ${data.wiped_sessions} sessions for ${wipeTarget.username}`, ok: true });
                    setWipeTarget(null);
                  } catch (e: any) {
                    setToast({ msg: e?.message || 'Wipe failed', ok: false });
                  }
                  setWipeSaving(false);
                  setTimeout(() => setToast(null), 4000);
                }}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: wipeReason.trim().length < 5 || wipeSaving ? 'not-allowed' : 'pointer',
                  background: wipeReason.trim().length < 5 || wipeSaving ? T.sf3 : T.err,
                  color: wipeReason.trim().length < 5 || wipeSaving ? T.mt : '#fff',
                  opacity: wipeSaving ? 0.6 : 1,
                }}>
                {wipeSaving ? 'Wiping…' : 'Wipe All Sessions'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10001,
          padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: toast.ok ? '#10b981' : T.err, color: '#fff',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)', animation: 'fadeIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
