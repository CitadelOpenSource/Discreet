/**
 * ServerHealth — Real-time server diagnostics panel.
 * Polls /health and /api/v1/info every 10 s.
 *
 * Metrics cards: uptime, PostgreSQL (connected + pool), Redis,
 * WebSocket connections, memory usage, request rate, active voice
 * channels, total users, total servers, total messages.
 *
 * Extras: auto-refresh toggle, manual Refresh button,
 *         SVG sparkline of last 20 ping latencies.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';

// ─── Types ────────────────────────────────────────────────

interface ServiceDetail {
  status?:    'ok' | 'degraded' | 'down' | 'connected' | 'error';
  latency_ms?: number;
  pool_size?:  number;
  pool_idle?:  number;
  connections?: number;
  message?:    string;
  version?:    string;
}

interface HealthPayload {
  status?:          string;
  uptime_seconds?:  number;
  version?:         string;

  // services — may be an object or just a string "ok"/"error"
  postgres?:        ServiceDetail | string;
  redis?:           ServiceDetail | string;
  websocket?:       ServiceDetail | string;

  // resource metrics
  memory?: {
    used_mb?:  number;
    total_mb?: number;
    rss_mb?:   number;
    percent?:  number;
  };
  requests?: {
    per_second?: number;
    total?:      number;
  };

  // domain counts (may live in /health or /info)
  users_total?:     number;
  servers_total?:   number;
  messages_total?:  number;
  voice_channels_active?: number;
}

interface InfoPayload {
  users?:    number;
  servers?:  number;
  messages?: number;
  users_total?:    number;
  servers_total?:  number;
  messages_total?: number;
  voice_active?:   number;
  version?:        string;
}

type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

// ─── Helpers ──────────────────────────────────────────────

function fmtUptime(secs: number): string {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h < 24) return `${h}h ${m}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function parseServiceStatus(svc: ServiceDetail | string | undefined): { status: ServiceStatus; latency?: number; extra?: string } {
  if (svc === undefined) return { status: 'unknown' };
  if (typeof svc === 'string') {
    const s = svc.toLowerCase();
    return { status: s === 'ok' || s === 'connected' ? 'healthy' : s === 'degraded' ? 'degraded' : 'down' };
  }
  const s = svc.status?.toLowerCase() || '';
  const status: ServiceStatus = (s === 'ok' || s === 'connected') ? 'healthy' : s === 'degraded' ? 'degraded' : s === 'error' || s === 'down' ? 'down' : 'unknown';
  const parts: string[] = [];
  if (svc.pool_size !== undefined) parts.push(`pool ${svc.pool_idle ?? '?'}/${svc.pool_size}`);
  if (svc.connections !== undefined) parts.push(`${svc.connections} conn`);
  if (svc.version) parts.push(`v${svc.version}`);
  if (svc.message) parts.push(svc.message);
  return { status, latency: svc.latency_ms, extra: parts.join(' · ') || undefined };
}

function statusColor(s: ServiceStatus): string {
  if (s === 'healthy')  return '#3ba55d';
  if (s === 'degraded') return '#f0b232';
  if (s === 'down')     return '#ff4757';
  return T.mt;
}

function memoryStatus(pct: number | undefined): ServiceStatus {
  if (pct === undefined) return 'unknown';
  if (pct < 70) return 'healthy';
  if (pct < 90) return 'degraded';
  return 'down';
}

// ─── Sparkline SVG ────────────────────────────────────────

interface SparklineProps { pings: number[]; width?: number; height?: number; }

function Sparkline({ pings, width = 300, height = 56 }: SparklineProps) {
  if (pings.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <text x={width / 2} y={height / 2 + 4} textAnchor="middle" fontSize={10} fill={T.mt}>Collecting data…</text>
      </svg>
    );
  }

  const PAD = { top: 6, right: 4, bottom: 16, left: 30 };
  const W = width; const H = height;
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const max = Math.max(...pings, 1);
  const min = Math.max(0, Math.min(...pings) - 5);
  const range = max - min || 1;

  const pts = pings.map((v, i) => ({
    x: PAD.left + (i / (pings.length - 1)) * iW,
    y: PAD.top + iH - ((v - min) / range) * iH,
  }));

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = linePath
    + ` L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + iH).toFixed(1)}`
    + ` L${pts[0].x.toFixed(1)},${(PAD.top + iH).toFixed(1)} Z`;

  // y-axis ticks
  const ticks = [min, min + range * 0.5, max];

  // color the line by latest latency
  const latest = pings[pings.length - 1];
  const lineColor = latest < 50 ? '#3ba55d' : latest < 150 ? '#f0b232' : '#ff4757';
  const gradId = 'spark-grad';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
          <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* grid lines */}
      {ticks.map((v, i) => {
        const y = PAD.top + iH - ((v - min) / range) * iH;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={T.bd} strokeWidth={0.5} strokeDasharray="3,3" />
            <text x={PAD.left - 3} y={y + 3} textAnchor="end" fontSize={7} fill={T.mt}>{Math.round(v)}</text>
          </g>
        );
      })}

      {/* x-axis label */}
      <text x={PAD.left} y={H - 1} fontSize={7} fill={T.mt}>oldest</text>
      <text x={W - PAD.right} y={H - 1} textAnchor="end" fontSize={7} fill={T.mt}>now</text>

      {/* area fill */}
      <path d={areaPath} fill={`url(#${gradId})`} />

      {/* line */}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

      {/* latest dot */}
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} fill={lineColor} />
      <text x={pts[pts.length - 1].x + 4} y={pts[pts.length - 1].y + 3} fontSize={8} fill={lineColor} fontWeight={700}>
        {latest}ms
      </text>
    </svg>
  );
}

// ─── Metric Card ──────────────────────────────────────────

interface MetricCardProps {
  label:      string;
  value:      string | number;
  icon:       string;
  status:     ServiceStatus;
  latency?:   number;
  sub?:       string;
  loading?:   boolean;
}

function MetricCard({ label, value, icon, status, latency, sub, loading }: MetricCardProps) {
  const dot = statusColor(status);
  return (
    <div style={{ background: T.sf2, borderRadius: 10, padding: '14px 16px', border: `1px solid ${loading ? T.bd : status === 'healthy' ? dot + '33' : status === 'unknown' ? T.bd : dot + '44'}`, position: 'relative', overflow: 'hidden', transition: 'border-color .3s' }}>
      {/* left accent bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: loading ? T.bd : dot, borderRadius: '10px 0 0 10px', transition: 'background .3s' }} />

      <div style={{ paddingLeft: 8 }}>
        {/* header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          {/* status dot */}
          <div style={{
            width: 8, height: 8, borderRadius: 4, flexShrink: 0,
            background: loading ? T.bd : dot,
            boxShadow: (!loading && status === 'healthy') ? `0 0 5px ${dot}99` : 'none',
            transition: 'background .3s, box-shadow .3s',
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>{label}</span>
          <span style={{ fontSize: 14 }}>{icon}</span>
        </div>

        {/* value */}
        <div style={{ fontSize: 22, fontWeight: 800, color: loading ? T.mt : (status === 'unknown' ? T.tx : dot), lineHeight: 1, marginBottom: 4, fontFamily: "'JetBrains Mono',monospace", transition: 'color .3s' }}>
          {loading ? '…' : value}
        </div>

        {/* sub-info row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!loading && status !== 'unknown' && (
            <span style={{ fontSize: 10, fontWeight: 700, color: dot }}>
              {status.toUpperCase()}
            </span>
          )}
          {latency !== undefined && !loading && (
            <span style={{ fontSize: 10, color: latency < 50 ? '#3ba55d' : latency < 150 ? '#f0b232' : '#ff4757', fontFamily: "'JetBrains Mono',monospace" }}>
              {latency}ms
            </span>
          )}
          {sub && !loading && (
            <span style={{ fontSize: 10, color: T.mt }}>{sub}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────

export function ServerHealth() {
  const [health, setHealth]         = useState<HealthPayload | null>(null);
  const [info, setInfo]             = useState<InfoPayload | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [lastFetch, setLastFetch]   = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pings, setPings]           = useState<number[]>([]);
  const [countdown, setCountdown]   = useState(10);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    const t0 = Date.now();

    try {
      // ── /health ──
      let healthData: HealthPayload | null = null;
      try {
        const r = await fetch('/health');
        const ms = Date.now() - t0;
        setPings(prev => [...prev.slice(-19), ms]);
        if (r.ok) {
          const text = await r.text();
          try { healthData = JSON.parse(text); }
          catch { healthData = { status: text.trim() === 'ok' ? 'ok' : 'unknown' }; }
        }
      } catch {
        // root /health unavailable, try API path
        try {
          const r2 = await api.fetch('/health');
          const ms = Date.now() - t0;
          setPings(prev => [...prev.slice(-19), ms]);
          if (r2.ok) healthData = await r2.json();
        } catch { /* ignore */ }
      }

      // ── /api/v1/info ──
      let infoData: InfoPayload | null = null;
      try {
        const r = await api.fetch('/info');
        if (r.ok) infoData = await r.json();
      } catch { /* endpoint may not exist, that's ok */ }

      if (!healthData && !infoData) {
        setError('Could not reach /health or /api/v1/info');
      } else {
        setHealth(healthData);
        setInfo(infoData);
        setLastFetch(new Date());
      }
    } catch (e: any) {
      setError(e.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // initial fetch
  useEffect(() => { doFetch(); }, [doFetch]);

  // auto-refresh interval + countdown
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (!autoRefresh) { setCountdown(10); return; }

    setCountdown(10);
    countdownRef.current = setInterval(() => setCountdown(c => c <= 1 ? 10 : c - 1), 1000);
    intervalRef.current  = setInterval(() => { doFetch(); setCountdown(10); }, 10_000);

    return () => {
      if (intervalRef.current)  clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, doFetch]);

  // ── parse metrics ──
  const pg  = parseServiceStatus(health?.postgres);
  const rd  = parseServiceStatus(health?.redis);
  const ws  = parseServiceStatus(health?.websocket);

  // If endpoint returned simple "ok" string → treat all sub-services as healthy
  const simpleOk = health?.status === 'ok' && !health?.postgres;

  const pgStatus  = simpleOk ? 'healthy' : pg.status;
  const rdStatus  = simpleOk ? 'healthy' : rd.status;
  const wsStatus  = simpleOk ? 'healthy' : ws.status;
  const overallOk = !error && (health?.status === 'ok' || health?.status === 'healthy' || simpleOk);

  const mem = health?.memory;
  const memPct = mem?.percent ?? (mem?.used_mb && mem?.total_mb ? Math.round((mem.used_mb / mem.total_mb) * 100) : undefined);
  const memSt = memoryStatus(memPct);

  const uptimeSecs = health?.uptime_seconds;
  const reqRate    = health?.requests?.per_second;

  // domain counts — prefer /info, fall back to health root fields
  const totalUsers    = info?.users_total ?? info?.users ?? health?.users_total ?? 0;
  const totalServers  = info?.servers_total ?? info?.servers ?? health?.servers_total ?? 0;
  const totalMessages = info?.messages_total ?? info?.messages ?? health?.messages_total ?? 0;
  const voiceActive   = info?.voice_active ?? health?.voice_channels_active ?? parseInt(localStorage.getItem('d_admin_voice_active') || '0', 10);

  const latestPing = pings.length > 0 ? pings[pings.length - 1] : undefined;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px', minWidth: 0 }}>

      {/* ── toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* overall status pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: error ? '#ff475718' : overallOk ? '#3ba55d18' : T.sf2, border: `1px solid ${error ? '#ff475744' : overallOk ? '#3ba55d44' : T.bd}` }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: error ? '#ff4757' : overallOk ? '#3ba55d' : T.mt, boxShadow: overallOk && !error ? '0 0 6px #3ba55d88' : 'none' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: error ? '#ff4757' : overallOk ? '#3ba55d' : T.mt }}>
            {loading ? 'Checking…' : error ? 'Unreachable' : overallOk ? 'All Systems Operational' : 'Degraded'}
          </span>
        </div>

        {lastFetch && (
          <span style={{ fontSize: 11, color: T.mt }}>
            Last updated {lastFetch.toLocaleTimeString()}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* auto-refresh toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: T.mt }}>Auto-refresh</span>
          <div
            onClick={() => setAutoRefresh(p => !p)}
            style={{ position: 'relative', width: 36, height: 20, borderRadius: 10, background: autoRefresh ? T.ac : T.bd, cursor: 'pointer', transition: 'background .2s', flexShrink: 0 }}
          >
            <div style={{ position: 'absolute', top: 2, left: autoRefresh ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
          {autoRefresh && (
            <span style={{ fontSize: 11, color: T.mt, fontFamily: "'JetBrains Mono',monospace", minWidth: 20, textAlign: 'right' }}>{countdown}s</span>
          )}
        </div>

        {/* manual refresh */}
        <button
          onClick={() => { doFetch(); setCountdown(10); }}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 8, color: loading ? T.mt : T.tx, fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'border-color .15s' }}
          onMouseEnter={e => !loading && (e.currentTarget.style.borderColor = T.ac)}
          onMouseLeave={e => (e.currentTarget.style.borderColor = T.bd)}
        >
          <span style={{ display: 'inline-block', transition: 'transform .4s', transform: loading ? 'rotate(360deg)' : 'none' }}>↻</span>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── error banner ── */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#ff475712', border: '1px solid #ff475733', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#ff4757' }}>
          ⚠️ {error} — metrics shown may be stale or from localStorage fallback.
        </div>
      )}

      {/* ── metric cards grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 24 }}>

        <MetricCard
          label="Server Uptime"
          value={uptimeSecs !== undefined ? fmtUptime(uptimeSecs) : '—'}
          icon="⏱️"
          status={uptimeSecs !== undefined ? 'healthy' : 'unknown'}
          sub={health?.version ? `v${health.version}` : undefined}
          loading={loading}
        />

        <MetricCard
          label="PostgreSQL"
          value={pgStatus === 'healthy' ? 'Connected' : pgStatus === 'unknown' ? '—' : 'ERROR'}
          icon="🐘"
          status={pgStatus}
          latency={pg.latency}
          sub={pg.extra}
          loading={loading}
        />

        <MetricCard
          label="Redis"
          value={rdStatus === 'healthy' ? 'Connected' : rdStatus === 'unknown' ? '—' : 'ERROR'}
          icon="⚡"
          status={rdStatus}
          latency={rd.latency}
          sub={rd.extra}
          loading={loading}
        />

        <MetricCard
          label="WebSocket"
          value={ws.extra?.match(/(\d+) conn/)?.[1] ?? (wsStatus === 'healthy' ? 'Active' : wsStatus === 'unknown' ? '—' : 'ERROR')}
          icon="🔌"
          status={wsStatus}
          latency={latestPing}
          sub={ws.extra}
          loading={loading}
        />

        <MetricCard
          label="Memory Usage"
          value={memPct !== undefined ? `${memPct}%` : mem?.used_mb !== undefined ? fmtBytes(mem.used_mb) : '—'}
          icon="🧠"
          status={memSt}
          sub={mem?.used_mb !== undefined && mem?.total_mb !== undefined ? `${fmtBytes(mem.used_mb)} / ${fmtBytes(mem.total_mb)}` : undefined}
          loading={loading}
        />

        <MetricCard
          label="Request Rate"
          value={reqRate !== undefined ? `${reqRate.toFixed(1)}/s` : '—'}
          icon="📡"
          status={reqRate !== undefined ? 'healthy' : 'unknown'}
          sub={health?.requests?.total !== undefined ? `${fmtNum(health.requests.total)} total` : undefined}
          loading={loading}
        />

        <MetricCard
          label="Active Voice"
          value={voiceActive}
          icon="🔊"
          status={voiceActive > 0 ? 'healthy' : 'unknown'}
          sub="channels"
          loading={loading}
        />

        <MetricCard
          label="Total Users"
          value={totalUsers > 0 ? fmtNum(totalUsers) : '—'}
          icon="👥"
          status={totalUsers > 0 ? 'healthy' : 'unknown'}
          loading={loading}
        />

        <MetricCard
          label="Total Servers"
          value={totalServers > 0 ? fmtNum(totalServers) : '—'}
          icon="🏠"
          status={totalServers > 0 ? 'healthy' : 'unknown'}
          loading={loading}
        />

        <MetricCard
          label="Total Messages"
          value={totalMessages > 0 ? fmtNum(totalMessages) : '—'}
          icon="💬"
          status={totalMessages > 0 ? 'healthy' : 'unknown'}
          loading={loading}
        />
      </div>

      {/* ── latency sparkline ── */}
      <div style={{ background: T.sf2, borderRadius: 12, padding: '18px 20px', border: `1px solid ${T.bd}`, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 2 }}>API Ping Latency</div>
            <div style={{ fontSize: 11, color: T.mt }}>Last {pings.length} / 20 samples</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {latestPing !== undefined && (
              <>
                <div style={{ fontSize: 22, fontWeight: 800, color: latestPing < 50 ? '#3ba55d' : latestPing < 150 ? '#f0b232' : '#ff4757', fontFamily: "'JetBrains Mono',monospace" }}>
                  {latestPing}ms
                </div>
                <div style={{ fontSize: 10, color: T.mt }}>latest</div>
              </>
            )}
          </div>
        </div>

        <Sparkline pings={pings} width={560} height={70} />

        {pings.length >= 2 && (
          <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'Min',    value: Math.min(...pings) },
              { label: 'Max',    value: Math.max(...pings) },
              { label: 'Avg',    value: Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) },
              { label: 'Median', value: [...pings].sort((a, b) => a - b)[Math.floor(pings.length / 2)] },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, fontFamily: "'JetBrains Mono',monospace" }}>{value}ms</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── raw JSON (collapsible) ── */}
      {(health || info) && (
        <details style={{ background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, overflow: 'hidden' }}>
          <summary style={{ padding: '10px 14px', fontSize: 12, color: T.mt, cursor: 'pointer', userSelect: 'none', fontWeight: 600 }}>
            Raw response data
          </summary>
          <div style={{ padding: '0 14px 14px' }}>
            {health && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, marginTop: 10 }}>/health</div>
                <pre style={{ fontSize: 10, color: T.tx, background: T.bg, padding: '10px 12px', borderRadius: 7, overflowX: 'auto', margin: 0, lineHeight: 1.5 }}>
                  {JSON.stringify(health, null, 2)}
                </pre>
              </>
            )}
            {info && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, marginTop: 10 }}>/api/v1/info</div>
                <pre style={{ fontSize: 10, color: T.tx, background: T.bg, padding: '10px 12px', borderRadius: 7, overflowX: 'auto', margin: 0, lineHeight: 1.5 }}>
                  {JSON.stringify(info, null, 2)}
                </pre>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
