/**
 * AdminDashboard — Full-page analytics panel for server owners.
 * Accessible via the "Admin" tab in the home sidebar.
 *
 * Sections:
 *   1. 6 stat cards (Users, Servers, Messages Today, Voice, Bots, Uptime)
 *   2. SVG bar chart — 14-day user growth (localStorage mock, keyed d_admin_*)
 *   3. Server health — PostgreSQL, Redis, WebSocket (fetched from /health)
 *   4. Recent activity feed (last 10 entries from localStorage d_admin_activity)
 */
import React, { useState, useEffect, useRef } from 'react';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';
import { ServerHealth } from './ServerHealth';

// ─── Types ────────────────────────────────────────────────

interface HealthService {
  status: 'ok' | 'degraded' | 'down';
  latency_ms?: number;
  connections?: number;
  message?: string;
}

interface HealthData {
  status?: string;
  postgres?: HealthService | string;
  redis?:    HealthService | string;
  websocket?: HealthService | string;
  uptime_seconds?: number;
  version?: string;
}

interface ActivityEntry {
  ts:    number;
  type:  'join' | 'server_create' | 'bot_spawn' | 'message' | 'ban' | 'custom';
  label: string;
  icon:  string;
}

// ─── Helpers ──────────────────────────────────────────────

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h < 24)   return `${h}h ${m}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtRelTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)  return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function getOrInitGrowth(): number[] {
  try {
    const stored = localStorage.getItem('d_admin_growth');
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length === 14) return arr;
    }
  } catch { /* ignore */ }
  // Generate plausible mock data (cumulative daily registrations)
  const base = [2, 5, 3, 8, 12, 7, 4, 9, 14, 11, 6, 18, 10, 15];
  localStorage.setItem('d_admin_growth', JSON.stringify(base));
  return base;
}

function getOrInitActivity(): ActivityEntry[] {
  try {
    const stored = localStorage.getItem('d_admin_activity');
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* ignore */ }
  // Seed mock activity feed
  const now = Date.now();
  const seed: ActivityEntry[] = [
    { ts: now - 120_000,    type: 'join',          icon: '👤', label: 'alice joined the server' },
    { ts: now - 480_000,    type: 'bot_spawn',     icon: '🤖', label: 'Code Helper bot spawned in #dev' },
    { ts: now - 900_000,    type: 'server_create', icon: '🏠', label: 'Server "Gaming Lounge" created' },
    { ts: now - 1_800_000,  type: 'join',          icon: '👤', label: 'bob joined the server' },
    { ts: now - 3_600_000,  type: 'message',       icon: '💬', label: '50 messages sent in #general' },
    { ts: now - 7_200_000,  type: 'ban',           icon: '🔨', label: 'spammer123 was banned' },
    { ts: now - 14_400_000, type: 'join',          icon: '👤', label: 'carol joined the server' },
    { ts: now - 21_600_000, type: 'bot_spawn',     icon: '🤖', label: 'Trivia Host bot spawned in #fun' },
    { ts: now - 43_200_000, type: 'server_create', icon: '🏠', label: 'Server "Study Group" created' },
    { ts: now - 86_400_000, type: 'join',          icon: '👤', label: 'dave joined the server' },
  ];
  localStorage.setItem('d_admin_activity', JSON.stringify(seed));
  return seed;
}

function countBotInteractionsToday(): number {
  let count = 0;
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('d_bot_logs_')) {
        const logs = JSON.parse(localStorage.getItem(key) || '[]');
        count += logs.filter((l: { ts: number }) => l.ts >= cutoff.getTime()).length;
      }
    }
  } catch { /* ignore */ }
  return count;
}

function parseService(svc: HealthService | string | undefined): { ok: boolean; latency?: number; conns?: number } {
  if (!svc) return { ok: false };
  if (typeof svc === 'string') return { ok: svc === 'ok' };
  return { ok: svc.status === 'ok', latency: svc.latency_ms, conns: svc.connections };
}

// ─── Sub-components ───────────────────────────────────────

interface StatCardProps {
  label:   string;
  value:   string | number;
  icon:    string;
  color?:  string;
  sub?:    string;
}

function StatCard({ label, value, icon, color, sub }: StatCardProps) {
  const ac = color || T.ac;
  return (
    <div style={{ flex: 1, minWidth: 140, background: T.sf2, borderRadius: 12, padding: '16px 18px', border: `1px solid ${T.bd}`, position: 'relative', overflow: 'hidden' }}>
      {/* glow blob */}
      <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: 40, background: `${ac}18`, pointerEvents: 'none' }} />
      <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: ac, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: T.mt, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: T.mt, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ─── SVG Bar Chart ────────────────────────────────────────

interface BarChartProps { data: number[]; color: string; }

function BarChart({ data, color }: BarChartProps) {
  const W = 560; const H = 100; const PAD = { top: 8, right: 8, bottom: 22, left: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(...data, 1);
  const barW = innerW / data.length;
  const gap = Math.max(2, barW * 0.18);

  // Day labels: "M T W T F S S" cycling back from today
  const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date().getDay(); // 0=Sun

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* y-axis grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const y = PAD.top + innerH * (1 - frac);
        const val = Math.round(max * frac);
        return (
          <g key={frac}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={T.bd} strokeWidth={0.5} />
            {frac > 0 && <text x={PAD.left - 3} y={y + 3} textAnchor="end" fontSize={7} fill={T.mt}>{val}</text>}
          </g>
        );
      })}

      {/* bars */}
      {data.map((v, i) => {
        const barH = (v / max) * innerH;
        const x = PAD.left + i * barW + gap / 2;
        const y = PAD.top + innerH - barH;
        const w = barW - gap;
        const dayIdx = (today - (data.length - 1 - i) + 70) % 7;
        const isToday = i === data.length - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={barH} rx={2}
              fill={isToday ? color : `${color}88`} />
            <text x={x + w / 2} y={H - 2} textAnchor="middle" fontSize={7} fill={isToday ? color : T.mt}>
              {isToday ? 'Today' : dayLetters[dayIdx]}
            </text>
            {/* value label on hover via title */}
            <title>{v} registrations</title>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Health Dot ───────────────────────────────────────────

interface HealthRowProps { label: string; ok: boolean; latency?: number; conns?: number; loading: boolean; }

function HealthRow({ label, ok, latency, conns, loading }: HealthRowProps) {
  const dotColor = loading ? T.bd : ok ? '#3ba55d' : '#ff4757';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${T.bd}` }}>
      <div style={{ width: 10, height: 10, borderRadius: 5, background: dotColor, flexShrink: 0, boxShadow: ok && !loading ? `0 0 6px ${dotColor}88` : 'none', transition: 'background .3s' }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: T.tx, flex: 1 }}>{label}</span>
      {!loading && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {latency !== undefined && (
            <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: latency < 20 ? '#3ba55d' : latency < 100 ? T.warn : '#ff4757' }}>
              {latency}ms
            </span>
          )}
          {conns !== undefined && (
            <span style={{ fontSize: 11, color: T.mt }}>{conns} conn{conns !== 1 ? 's' : ''}</span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, color: ok ? '#3ba55d' : '#ff4757' }}>
            {ok ? 'HEALTHY' : 'DOWN'}
          </span>
        </div>
      )}
      {loading && <span style={{ fontSize: 11, color: T.mt }}>checking…</span>}
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────

const ADMIN_TABS = [
  { id: 'overview', label: 'Overview',      icon: '📊' },
  { id: 'health',   label: 'Server Health', icon: '🩺' },
] as const;

type AdminTab = typeof ADMIN_TABS[number]['id'];

// ─── Main component ───────────────────────────────────────

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [health, setHealth]       = useState<HealthData | null>(null);
  const [healthErr, setHealthErr] = useState(false);
  const [healthLoading, setHealthLoading] = useState(true);
  const [pingMs, setPingMs]       = useState<number | null>(null);
  const [activity]                = useState<ActivityEntry[]>(() => getOrInitActivity());
  const [growth]                  = useState<number[]>(() => getOrInitGrowth());
  const [now, setNow]             = useState(Date.now);
  const startTs = useRef((() => {
    const k = 'd_admin_start';
    const v = localStorage.getItem(k);
    if (v) return parseInt(v, 10);
    const t = Date.now();
    localStorage.setItem(k, String(t));
    return t;
  })());

  // clock tick for uptime
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // fetch /health
  useEffect(() => {
    const t0 = Date.now();
    setHealthLoading(true);
    // Try /health at root first, then /api/v1/health
    fetch('/health')
      .then(r => {
        setPingMs(Date.now() - t0);
        return r.ok ? r.json() : null;
      })
      .then(d => {
        if (d) { setHealth(d); setHealthErr(false); }
        else {
          // try via authenticated API path
          return api.fetch('/health').then(r => r.ok ? r.json() : null).then(d2 => {
            if (d2) setHealth(d2);
            else setHealthErr(true);
          });
        }
      })
      .catch(() => {
        // try api path as fallback
        api.fetch('/health')
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) { setHealth(d); setHealthErr(false); } else setHealthErr(true); })
          .catch(() => setHealthErr(true));
      })
      .finally(() => setHealthLoading(false));
  }, []);

  // ── stat computations ──
  const totalUsers    = parseInt(localStorage.getItem('d_admin_users_total') || '0', 10);
  const totalServers  = parseInt(localStorage.getItem('d_admin_servers_total') || '0', 10);
  const msgsToday     = parseInt(localStorage.getItem('d_admin_msgs_today') || '0', 10);
  const activeVoice   = parseInt(localStorage.getItem('d_admin_voice_active') || '0', 10);
  const botInteracts  = countBotInteractionsToday();
  const uptimeMs      = now - startTs.current;

  // parse health services
  const pg  = parseService(health?.postgres);
  const rd  = parseService(health?.redis);
  const ws  = parseService(health?.websocket);
  // If health endpoint returned a simple "ok" with no sub-services, treat all as ok
  const healthSimple = health?.status === 'ok' && !health.postgres;

  const accentBlue  = '#5865f2';
  const accentGreen = '#3ba55d';
  const accentOrange = '#f0b232';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

      {/* ── Shared header + tab bar ── */}
      <div style={{ padding: '20px 28px 0', borderBottom: `1px solid ${T.bd}`, background: T.bg, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>🛡️</span>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: T.tx, margin: 0 }}>Admin Dashboard</h1>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: T.mt, fontFamily: "'JetBrains Mono',monospace" }}>
            {new Date().toLocaleString()}
          </span>
        </div>
        {/* tab bar */}
        <div style={{ display: 'flex', gap: 2 }}>
          {ADMIN_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer',
                fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 500,
                background: activeTab === tab.id ? T.sf2 : 'transparent',
                color: activeTab === tab.id ? T.tx : T.mt,
                borderBottom: activeTab === tab.id ? `2px solid ${T.ac}` : '2px solid transparent',
                transition: 'all .15s',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Server Health tab ── */}
      {activeTab === 'health' && <ServerHealth />}

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 40px', minWidth: 0 }}>

      <p style={{ margin: '0 0 20px', fontSize: 13, color: T.mt }}>Platform overview — visible to server owners only</p>

      {/* ── Stat Cards ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard label="Total Users"       value={totalUsers || '—'}   icon="👥" color={T.ac} sub={totalUsers ? undefined : 'no data yet'} />
        <StatCard label="Total Servers"     value={totalServers || '—'} icon="🏠" color={accentBlue} sub={totalServers ? undefined : 'no data yet'} />
        <StatCard label="Messages Today"    value={msgsToday || '—'}    icon="💬" color={accentGreen} />
        <StatCard label="Active Voice"      value={activeVoice}          icon="🔊" color={accentOrange} sub="sessions" />
        <StatCard label="Bot Interactions"  value={botInteracts}         icon="🤖" color="#9b59b6" sub="today" />
        <StatCard label="Uptime"            value={fmtUptime(uptimeMs)} icon="⏱️" color={T.ac} sub="this session" />
      </div>

      {/* ── Two-column lower section ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>

        {/* Left column: growth chart + activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Growth Chart */}
          <div style={{ background: T.sf2, borderRadius: 12, padding: '18px 20px', border: `1px solid ${T.bd}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 2 }}>User Registrations</div>
                <div style={{ fontSize: 11, color: T.mt }}>Last 14 days</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: T.ac }}>{growth.reduce((a, b) => a + b, 0)}</div>
                <div style={{ fontSize: 10, color: T.mt }}>total in period</div>
              </div>
            </div>
            <BarChart data={growth} color={T.ac} />
            <div style={{ marginTop: 8, fontSize: 10, color: T.mt, fontStyle: 'italic' }}>
              Mock data — update <code style={{ background: T.bg, padding: '1px 4px', borderRadius: 3 }}>d_admin_growth</code> in localStorage with real values
            </div>
          </div>

          {/* Activity Feed */}
          <div style={{ background: T.sf2, borderRadius: 12, padding: '18px 20px', border: `1px solid ${T.bd}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 14 }}>Recent Activity</div>
            {activity.slice(0, 10).map((entry, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: i < Math.min(activity.length, 10) - 1 ? `1px solid ${T.bd}` : 'none' }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                  {entry.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.4 }}>{entry.label}</div>
                  <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>{fmtRelTime(entry.ts)}</div>
                </div>
              </div>
            ))}
            {activity.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px 0', color: T.mt, fontSize: 12 }}>No activity recorded yet</div>
            )}
          </div>
        </div>

        {/* Right column: health */}
        <div style={{ background: T.sf2, borderRadius: 12, padding: '18px 20px', border: `1px solid ${T.bd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>Server Health</div>
            {pingMs !== null && (
              <span style={{ fontSize: 10, color: T.mt, fontFamily: "'JetBrains Mono',monospace" }}>
                RTT {pingMs}ms
              </span>
            )}
          </div>

          {/* overall status banner */}
          {!healthLoading && (
            <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 14, background: (healthErr ? '#ff475712' : '#3ba55d12'), border: `1px solid ${healthErr ? '#ff475733' : '#3ba55d33'}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: healthErr ? '#ff4757' : '#3ba55d' }}>
                {healthErr ? '⚠️  Cannot reach /health endpoint' : (health?.status === 'ok' ? '✓  All systems operational' : '⚠️  Degraded')}
              </div>
              {health?.version && <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>v{health.version}</div>}
            </div>
          )}

          <HealthRow
            label="PostgreSQL"
            ok={healthSimple || pg.ok}
            latency={pg.latency}
            loading={healthLoading}
          />
          <HealthRow
            label="Redis"
            ok={healthSimple || rd.ok}
            latency={rd.latency}
            loading={healthLoading}
          />
          <HealthRow
            label="WebSocket"
            ok={healthSimple || ws.ok}
            latency={pingMs ?? undefined}
            conns={ws.conns}
            loading={healthLoading}
          />
          <HealthRow
            label="REST API"
            ok={!healthErr}
            latency={pingMs ?? undefined}
            loading={healthLoading}
          />

          {/* uptime from server if available */}
          {health?.uptime_seconds !== undefined && (
            <div style={{ marginTop: 14, padding: '10px 12px', background: T.bg, borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Server Process Uptime</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.ac, fontFamily: "'JetBrains Mono',monospace" }}>
                {fmtUptime(health.uptime_seconds * 1000)}
              </div>
            </div>
          )}

          {/* refresh */}
          <button
            onClick={() => {
              setHealthLoading(true);
              const t0 = Date.now();
              fetch('/health')
                .then(r => { setPingMs(Date.now() - t0); return r.ok ? r.json() : null; })
                .then(d => { if (d) { setHealth(d); setHealthErr(false); } else setHealthErr(true); })
                .catch(() => setHealthErr(true))
                .finally(() => setHealthLoading(false));
            }}
            style={{ marginTop: 14, width: '100%', padding: '8px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.mt, fontSize: 12, cursor: 'pointer', transition: 'border-color .15s' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = T.ac)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = T.bd)}
          >
            {healthLoading ? 'Checking…' : '↻ Refresh Health'}
          </button>

          {/* localStorage note */}
          <div style={{ marginTop: 18, padding: '10px 12px', background: T.bg, borderRadius: 8, border: `1px dashed ${T.bd}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Mock Data Keys</div>
            {[
              ['d_admin_users_total',   'Total user count'],
              ['d_admin_servers_total', 'Total server count'],
              ['d_admin_msgs_today',    'Messages today'],
              ['d_admin_voice_active',  'Active voice sessions'],
              ['d_admin_growth',        '14-day reg. array (JSON)'],
              ['d_admin_activity',      'Activity feed (JSON)'],
            ].map(([key, desc]) => (
              <div key={key} style={{ marginBottom: 4 }}>
                <code style={{ fontSize: 9, background: T.sf2, padding: '1px 4px', borderRadius: 3, color: T.ac, display: 'block' }}>{key}</code>
                <span style={{ fontSize: 9, color: T.mt }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      </div>}
    </div>
  );
}
