/**
 * NotificationInbox — Server-backed notification dropdown with real-time unread count.
 *
 * Bell icon renders inline (caller places it in the header).
 * Click opens a dropdown with notifications grouped Today / Earlier.
 * Real-time unread count via WebSocket `notification_new` events.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { T, ta } from '../theme';
import { api } from '../api/CitadelAPI';
import { useTimezone } from '../hooks/TimezoneContext';

// ─── Types ──────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  action_url: string | null;
  read: boolean;
  created_at: string;
  // Smart join metadata (populated from WS event_reminder payloads)
  voice_channel_id?: string;
  server_id?: string;
  invite_code?: string;
  event_id?: string;
}

export interface NotificationAction {
  url?: string;
  voice_channel_id?: string;
  server_id?: string;
  invite_code?: string;
  event_id?: string;
  type?: string;
}

interface NotificationInboxProps {
  wsLastEvent?: any;
  onNavigate?: (action: NotificationAction) => void;
  me?: any;
}

// ─── Constants ──────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  event_reminder: '📅',
  mention: '@',
  friend_request: '👋',
  system: '🔔',
  meeting: '📞',
  kick: '👢',
  ban: '🔨',
};

const ACTION_LABELS: Record<string, string> = {
  event_reminder: 'View Event',
  meeting: 'Join Meeting',
  mention: 'Jump to Message',
  friend_request: 'View',
};

function getActionLabel(n: Notification): string {
  if (n.type === 'event_reminder' && n.voice_channel_id) return 'Join Voice';
  if (n.type === 'event_reminder' && n.invite_code) return 'Join & View';
  return ACTION_LABELS[n.type] || 'View';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// ─── Component ──────────────────────────────────────────

export function NotificationInbox({ wsLastEvent, onNavigate, me }: NotificationInboxProps) {
  const { formatTime } = useTimezone();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch unread count on mount
  useEffect(() => {
    api.getUnreadNotificationCount().then(setUnreadCount);
  }, []);

  // Listen for real-time notification events
  useEffect(() => {
    if (!wsLastEvent) return;
    if (wsLastEvent.type === 'notification_new') {
      if (wsLastEvent.target_user_ids?.includes(api.userId)) {
        setUnreadCount(wsLastEvent.unread_count ?? ((c: number) => c + 1));
        if (open) fetchNotifications();
      }
    }
    // Handle event_reminder WS events — show as inline notification with smart join data
    if (wsLastEvent.type === 'event_reminder') {
      if (wsLastEvent.target_user_ids?.includes(api.userId)) {
        const ephemeral: Notification = {
          id: `ws_${wsLastEvent.event_id}_${Date.now()}`,
          type: 'event_reminder',
          title: wsLastEvent.title || 'Event starting soon',
          body: `Starts ${formatTime(wsLastEvent.start_time, { hour: 'numeric', minute: '2-digit' })}`,
          action_url: null,
          read: false,
          created_at: new Date().toISOString(),
          voice_channel_id: wsLastEvent.voice_channel_id || undefined,
          server_id: wsLastEvent.server_id || undefined,
          invite_code: wsLastEvent.invite_code || undefined,
          event_id: wsLastEvent.event_id || undefined,
        };
        setItems(prev => [ephemeral, ...prev.filter(n => n.event_id !== wsLastEvent.event_id)]);
        setUnreadCount(c => c + 1);
      }
    }
  }, [wsLastEvent]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listNotifications(50);
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    setLoading(false);
  }, []);

  const handleOpen = () => {
    setOpen(p => {
      if (!p) fetchNotifications();
      return !p;
    });
  };

  const handleMarkRead = async (id: string) => {
    await api.markNotificationRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const handleAction = async (n: Notification) => {
    if (!n.read) {
      // For ephemeral WS items, just mark locally
      if (n.id.startsWith('ws_')) {
        setItems(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
        setUnreadCount(c => Math.max(0, c - 1));
      } else {
        await handleMarkRead(n.id);
      }
    }
    if (onNavigate) {
      onNavigate({
        url: n.action_url || undefined,
        voice_channel_id: n.voice_channel_id,
        server_id: n.server_id,
        invite_code: n.invite_code,
        event_id: n.event_id,
        type: n.type,
      });
    }
    setOpen(false);
  };

  // Generate system notifications from user data
  const systemNotifs: Notification[] = [];
  if (me) {
    // Welcome notification
    if (me.created_at) {
      const createdDate = new Date(me.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      systemNotifs.push({
        id: 'sys_welcome',
        type: 'system',
        title: 'Welcome to Discreet!',
        body: `Account created on ${createdDate}`,
        action_url: null,
        read: true,
        created_at: me.created_at,
      });
    }
    // Verification status
    if (me.email_verified) {
      systemNotifs.push({
        id: 'sys_verified',
        type: 'system',
        title: 'Email verified successfully',
        body: null,
        action_url: null,
        read: true,
        created_at: me.email_verified_at || me.created_at || new Date().toISOString(),
      });
    } else if (me.email) {
      systemNotifs.push({
        id: 'sys_unverified',
        type: 'system',
        title: 'Verify your email to unlock all features',
        body: 'Click to open verification settings',
        action_url: '/settings/account-security',
        read: false,
        created_at: me.created_at || new Date().toISOString(),
      });
    }
  }
  // Merge: server notifications first, then system notifications (avoid duplicates by id)
  const serverIds = new Set(items.map(n => n.id));
  const allItems = [...items, ...systemNotifs.filter(sn => !serverIds.has(sn.id))];

  const todayItems = allItems.filter(n => isToday(n.created_at));
  const earlierItems = allItems.filter(n => !isToday(n.created_at));

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Bell icon */}
      <div
        className="touch-target"
        onClick={handleOpen}
        style={{ position: 'relative', cursor: 'pointer', color: open ? T.ac : T.mt, padding: 4 }}
        title="Notifications"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <div style={{
            position: 'absolute', top: 0, right: 0,
            background: '#ed4245', borderRadius: '50%',
            minWidth: 16, height: 16, fontSize: 10, fontWeight: 700,
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', pointerEvents: 'none', lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </div>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 380, maxHeight: 480, overflowY: 'auto',
          background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--border-radius)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 1000,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: `1px solid ${T.bd}`,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>Notifications</span>
            <button
              onClick={handleMarkAllRead}
              style={{
                background: 'none', border: 'none', color: T.ac,
                fontSize: 12, cursor: 'pointer', fontWeight: 600,
              }}
            >
              Mark All Read
            </button>
          </div>

          {/* Content */}
          {loading && items.length === 0 ? (
            <div style={{ padding: '12px 16px' }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.04)', backgroundImage: 'linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.09) 50%,rgba(255,255,255,0.04) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.5s infinite', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ width: `${50 + (i * 19) % 40}%`, height: 10, borderRadius: 4, background: 'rgba(255,255,255,0.04)', backgroundImage: 'linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.09) 50%,rgba(255,255,255,0.04) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.5s infinite', marginBottom: 6 }} />
                    <div style={{ width: `${30 + (i * 13) % 30}%`, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.04)', backgroundImage: 'linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.09) 50%,rgba(255,255,255,0.04) 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.5s infinite' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : allItems.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>You're all caught up</div>
              <div style={{ fontSize: 12, color: T.mt }}>No new notifications. Enjoy the quiet.</div>
            </div>
          ) : (
            <>
              {todayItems.length > 0 && (
                <>
                  <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: 0.5 }}>Today</div>
                  {todayItems.map(n => <NotifRow key={n.id} n={n} onAction={handleAction} onMarkRead={handleMarkRead} />)}
                </>
              )}
              {earlierItems.length > 0 && (
                <>
                  <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: 0.5 }}>Earlier</div>
                  {earlierItems.map(n => <NotifRow key={n.id} n={n} onAction={handleAction} onMarkRead={handleMarkRead} />)}
                </>
              )}
            </>
          )}

          {/* Footer */}
          <div style={{
            padding: '10px 16px', borderTop: `1px solid ${T.bd}`,
            textAlign: 'center',
          }}>
            <span
              onClick={() => { setOpen(false); onNavigate?.({ url: '/settings/notifications' }); }}
              style={{ fontSize: 12, color: T.mt, cursor: 'pointer' }}
            >
              Notification Settings
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Single notification row ────────────────────────────

function NotifRow({ n, onAction, onMarkRead }: {
  n: Notification;
  onAction: (n: Notification) => void;
  onMarkRead: (id: string) => void;
}) {
  const icon = TYPE_ICONS[n.type] || '🔔';
  const actionLabel = getActionLabel(n);
  const hasAction = n.action_url || n.voice_channel_id || n.event_id;

  return (
    <div
      onClick={() => onAction(n)}
      style={{
        display: 'flex', gap: 10, padding: '10px 16px', cursor: 'pointer',
        background: n.read ? 'transparent' : `${ta(T.ac,'08')}`,
        borderLeft: n.read ? '3px solid transparent' : `3px solid ${T.ac}`,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = T.sf2)}
      onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : `${ta(T.ac,'08')}`)}
    >
      {/* Type icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: T.sf2, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, flexShrink: 0,
      }}>
        {icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: T.tx, lineHeight: 1.3 }}>
          {n.title}
        </div>
        {n.body && (
          <div style={{
            fontSize: 12, color: T.mt, lineHeight: 1.3, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {n.body}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 11, color: T.mt }}>{timeAgo(n.created_at)}</span>
          {hasAction && (
            <span style={{ fontSize: 11, color: T.ac, fontWeight: 600 }}>{actionLabel}</span>
          )}
        </div>
      </div>

      {/* Unread dot */}
      {!n.read && (
        <div
          onClick={e => { e.stopPropagation(); onMarkRead(n.id); }}
          title="Mark read"
          style={{
            width: 8, height: 8, borderRadius: '50%', background: T.ac,
            flexShrink: 0, marginTop: 6, cursor: 'pointer',
          }}
        />
      )}
    </div>
  );
}
