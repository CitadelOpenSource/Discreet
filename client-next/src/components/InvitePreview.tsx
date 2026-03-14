/**
 * InvitePreview — Inline invite link card rendered below messages.
 *
 * States:
 *   - Loading: shimmer placeholder while resolving
 *   - Resolved: server icon, name, member count, Join button
 *   - Already joined: grayed "Already Joined" badge
 *   - Expired/invalid: "Invite Expired" notice
 *   - External instance: domain warning + Open in Browser button
 */
import React, { useEffect, useState } from 'react';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';

export interface InvitePreviewProps {
  /** Full invite URL (https://host/invite/CODE) */
  url: string;
  /** List of server IDs the current user has joined */
  joinedServerIds?: string[];
  /** Called after a successful join so the parent can reload */
  onJoined?: () => void;
}

interface ResolvedInvite {
  server_name: string;
  member_count: number;
  icon_url?: string;
  server_id?: string;
}

type CardState = 'loading' | 'resolved' | 'joined' | 'expired' | 'external';

export function InvitePreview({ url, joinedServerIds, onJoined }: InvitePreviewProps) {
  const [state, setState] = useState<CardState>('loading');
  const [info, setInfo]   = useState<ResolvedInvite | null>(null);
  const [host, setHost]   = useState('');
  const [code, setCode]   = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;

    try {
      const parsed = new URL(url);
      const m = parsed.pathname.match(/^\/invite\/([A-Za-z0-9]+)\/?$/);
      if (!m) { setState('expired'); return; }

      setCode(m[1]);
      setHost(parsed.host);

      // Different instance?
      if (parsed.host !== window.location.host) {
        setState('external');
        return;
      }

      // Resolve invite
      api.resolveInvite(m[1])
        .then((data: any) => {
          if (cancelled) return;
          setInfo(data);
          // Check if already a member
          if (data.server_id && joinedServerIds?.includes(data.server_id)) {
            setState('joined');
          } else {
            setState('resolved');
          }
        })
        .catch(() => {
          if (!cancelled) setState('expired');
        });
    } catch {
      setState('expired');
    }

    return () => { cancelled = true; };
  }, [url, joinedServerIds]);

  const handleJoin = async () => {
    if (joining || !code) return;
    setJoining(true);
    try {
      await api.joinServer('', code);
      setState('joined');
      onJoined?.();
    } catch {
      // Might already be a member or invite expired
      setState('expired');
    }
    setJoining(false);
  };

  // ── Card styles ────────────────────────────────────────

  const card: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    marginTop: 6,
    background: T.sf2,
    border: `1px solid ${T.bd}`,
    borderRadius: 10,
    maxWidth: 400,
    fontFamily: "'DM Sans', sans-serif",
  };

  // ── Loading ────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div style={{ ...card, opacity: 0.5 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: T.bd }} />
        <div style={{ flex: 1 }}>
          <div style={{ width: 120, height: 12, borderRadius: 4, background: T.bd, marginBottom: 6 }} />
          <div style={{ width: 60, height: 10, borderRadius: 4, background: T.bd }} />
        </div>
      </div>
    );
  }

  // ── Expired / Invalid ──────────────────────────────────

  if (state === 'expired') {
    return (
      <div style={{ ...card, opacity: 0.6 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: T.bd, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: T.mt }}>?</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.mt }}>Invite Expired</div>
          <div style={{ fontSize: 11, color: T.mt, opacity: 0.7 }}>This invite is no longer valid or has reached its maximum uses.</div>
        </div>
      </div>
    );
  }

  // ── External instance ──────────────────────────────────

  if (state === 'external') {
    return (
      <div style={card}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${T.warn}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🌐</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>External Discreet Instance</div>
          <div style={{ fontSize: 11, color: T.mt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}</div>
        </div>
        <button
          onClick={() => window.open(url, '_blank', 'noopener')}
          style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: T.sf3, color: T.tx, border: `1px solid ${T.bd}`, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Open
        </button>
      </div>
    );
  }

  // ── Resolved or Already Joined ─────────────────────────

  const serverInitial = info?.server_name?.[0]?.toUpperCase() || '?';
  const isJoined = state === 'joined';

  return (
    <div style={card}>
      {/* Server icon */}
      <div style={{ width: 40, height: 40, borderRadius: 12, background: info?.icon_url ? 'transparent' : `linear-gradient(135deg,${T.ac}33,${T.ac2}33)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: T.ac, overflow: 'hidden', flexShrink: 0 }}>
        {info?.icon_url
          ? <img src={info.icon_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover' }} />
          : serverInitial}
      </div>

      {/* Server info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {info?.server_name || 'Server'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.mt }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3ba55d', flexShrink: 0 }} />
          {info?.member_count ?? 0} member{(info?.member_count ?? 0) !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Action button */}
      {isJoined ? (
        <span style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 8, background: T.sf3, color: T.mt, border: `1px solid ${T.bd}`, whiteSpace: 'nowrap', flexShrink: 0 }}>
          Already Joined
        </span>
      ) : (
        <button
          onClick={handleJoin}
          disabled={joining}
          style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, borderRadius: 8, cursor: joining ? 'default' : 'pointer', background: T.ac, color: '#000', border: 'none', whiteSpace: 'nowrap', flexShrink: 0, opacity: joining ? 0.6 : 1 }}
        >
          {joining ? 'Joining…' : 'Join'}
        </button>
      )}
    </div>
  );
}
