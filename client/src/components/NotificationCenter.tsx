/**
 * NotificationCenter — slide-in panel showing:
 *   kick / ban alerts, friend requests, missed @mentions, event reminders.
 *
 * Notifications are persisted to localStorage under 'd_notifications'.
 *
 * Exports:
 *   AppNotification      — shared type for the notifications array
 *   makeNotification()   — factory that stamps id + timestamp
 *   NotificationCenter   — the slide-in panel component
 */
import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';

// ─── Types ────────────────────────────────────────────────

export type NotifType = 'kick' | 'ban' | 'friend_request' | 'mention' | 'event';

export interface AppNotification {
  id:        string;
  type:      NotifType;
  title:     string;
  message:   string;
  timestamp: number;
  read:      boolean;
  meta?: {
    serverId?:   string;
    channelId?:  string;
    userId?:     string;
    eventId?:    string;
  };
}

export interface NotificationCenterProps {
  notifications: AppNotification[];
  onDismiss:     (id: string) => void;
  onMarkRead:    (id: string) => void;
  onClear:       () => void;
  onClose:       () => void;
}

// ─── Storage helpers ──────────────────────────────────────

const STORAGE_KEY = 'd_notifications';

export function loadNotifications(): AppNotification[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

export function saveNotifications(ns: AppNotification[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ns.slice(0, 200))); } catch {}
}

/** Create a new notification with a generated id and current timestamp. */
export function makeNotification(
  type:    NotifType,
  title:   string,
  message: string,
  meta?:   AppNotification['meta'],
): AppNotification {
  return {
    id:        `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    title,
    message,
    timestamp: Date.now(),
    read:      false,
    meta,
  };
}

// ─── Per-type config ──────────────────────────────────────

const TYPE_CONFIG: Record<NotifType, { icon: string; color: string }> = {
  kick:           { icon: '👢', color: '#faa61a' },
  ban:            { icon: '🔨', color: '#ed4245' },
  friend_request: { icon: '👋', color: '#5865f2' },
  mention:        { icon: '@',  color: '#00d4aa' },
  event:          { icon: '📅', color: '#9b59b6' },
};

// ─── Relative time ────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)   return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Single notification row ──────────────────────────────

function NotifRow({
  n,
  onDismiss,
  onMarkRead,
}: {
  n:          AppNotification;
  onDismiss:  (id: string) => void;
  onMarkRead: (id: string) => void;
}) {
  const cfg = TYPE_CONFIG[n.type];

  return (
    <div
      onClick={() => !n.read && onMarkRead(n.id)}
      style={{
        display: 'flex', gap: 10, padding: '10px 12px',
        borderRadius: 'var(--radius-md)', cursor: n.read ? 'default' : 'pointer',
        background: n.read ? 'transparent' : `${cfg.color}0d`,
        border: `1px solid ${n.read ? T.bd : cfg.color + '33'}`,
        marginBottom: 6,
        transition: 'background .15s',
      }}
    >
      {/* Icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 'var(--radius-md)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${cfg.color}22`, fontSize: n.type === 'mention' ? 12 : 16,
        fontWeight: 700, color: cfg.color,
      }}>
        {cfg.icon}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: n.read ? 500 : 700, color: T.tx, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {n.title}
          </span>
          {!n.read && (
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
          )}
        </div>
        <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {n.message}
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 4, opacity: 0.7 }}>
          {relativeTime(n.timestamp)}
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={e => { e.stopPropagation(); onDismiss(n.id); }}
        title="Dismiss"
        style={{
          background: 'none', border: 'none', color: T.mt, cursor: 'pointer',
          padding: '2px 4px', borderRadius: 4, fontSize: 14, alignSelf: 'flex-start',
          flexShrink: 0, lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── NotificationCenter ───────────────────────────────────

const TYPE_LABELS: Record<NotifType, string> = {
  kick:           'Kick',
  ban:            'Ban',
  friend_request: 'Friend Requests',
  mention:        'Mentions',
  event:          'Events',
};

export function NotificationCenter({
  notifications,
  onDismiss,
  onMarkRead,
  onClear,
  onClose,
}: NotificationCenterProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter(n => !n.read).length;

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    // Slight delay so the click that opened it doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [onClose]);

  // Group by type, newest-first within each group
  const grouped = (Object.keys(TYPE_LABELS) as NotifType[]).map(type => ({
    type,
    items: notifications.filter(n => n.type === type).sort((a, b) => b.timestamp - a.timestamp),
  })).filter(g => g.items.length > 0);

  return ReactDOM.createPortal(
    <>
      {/* Backdrop (transparent — click handled by mousedown listener above) */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 19998 }} />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 340, zIndex: 19999,
          background: T.sf,
          borderLeft: `1px solid ${T.bd}`,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column',
          fontFamily: 'var(--font-primary)',
          animation: 'notif-slide-in 0.2s ease',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: `1px solid ${T.bd}`, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🔔</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: T.tx }}>Notifications</span>
            {unread > 0 && (
              <span style={{
                background: '#ed4245', color: '#fff', fontSize: 10, fontWeight: 700,
                borderRadius: 'var(--radius-md)', minWidth: 18, height: 18, display: 'flex',
                alignItems: 'center', justifyContent: 'center', padding: '0 5px',
              }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {notifications.length > 0 && (
              <button
                onClick={onClear}
                style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 11, padding: '3px 6px', borderRadius: 4 }}
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {notifications.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: T.mt }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🔕</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>All caught up</div>
              <div style={{ fontSize: 11 }}>No notifications yet.</div>
            </div>
          )}

          {grouped.map(({ type, items }) => (
            <div key={type} style={{ marginBottom: 16 }}>
              {/* Group header */}
              <div style={{
                fontSize: 10, fontWeight: 700, color: T.mt,
                textTransform: 'uppercase', letterSpacing: '0.5px',
                padding: '4px 2px 6px', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ color: TYPE_CONFIG[type].color }}>{TYPE_CONFIG[type].icon}</span>
                {TYPE_LABELS[type]}
                <span style={{ color: T.mt, fontWeight: 400 }}>({items.length})</span>
              </div>

              {items.map(n => (
                <NotifRow key={n.id} n={n} onDismiss={onDismiss} onMarkRead={onMarkRead} />
              ))}
            </div>
          ))}
        </div>

        {/* ── Footer ── */}
        {notifications.length > 0 && (
          <div style={{
            padding: '10px 16px', borderTop: `1px solid ${T.bd}`,
            fontSize: 11, color: T.mt, textAlign: 'center', flexShrink: 0,
          }}>
            {notifications.length} notification{notifications.length !== 1 ? 's' : ''} · {unread} unread
          </div>
        )}
      </div>

      {/* Slide-in keyframe */}
      <style>{`
        @keyframes notif-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>,
    document.body,
  );
}
