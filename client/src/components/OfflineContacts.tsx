/**
 * OfflineContacts — Manage contacts exchanged via BLE proximity.
 *
 * Stored in localStorage as JSON array under key 'd_offline_contacts'.
 * When internet is available, users can send friend requests to stored contacts.
 */
import React, { useEffect, useState } from 'react';
import { T, ta, btn } from '../theme';
import { api } from '../api/CitadelAPI';

// ── Types ────────────────────────────────────────────────────────────────

export interface OfflineContact {
  user_id: string;
  username: string;
  instance_url: string;
  exchanged_at: number; // unix ms
  friend_request_sent?: boolean;
}

const STORAGE_KEY = 'd_offline_contacts';

// ── Storage helpers ─────────────────────────────────────────────────────

export function loadOfflineContacts(): OfflineContact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveOfflineContact(contact: OfflineContact): void {
  const existing = loadOfflineContacts();
  const idx = existing.findIndex(c => c.user_id === contact.user_id);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...contact };
  } else {
    existing.push(contact);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function removeOfflineContact(userId: string): void {
  const existing = loadOfflineContacts().filter(c => c.user_id !== userId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

function markFriendRequestSent(userId: string): void {
  const existing = loadOfflineContacts();
  const idx = existing.findIndex(c => c.user_id === userId);
  if (idx >= 0) {
    existing[idx].friend_request_sent = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  }
}

// ── Component ───────────────────────────────────────────────────────────

export function OfflineContacts() {
  const [contacts, setContacts] = useState<OfflineContact[]>([]);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    setContacts(loadOfflineContacts());
  }, []);

  const handleSendFriendRequest = async (contact: OfflineContact) => {
    // Only works if the contact is on the same instance
    if (contact.instance_url !== window.location.origin) {
      return;
    }
    setSending(contact.user_id);
    try {
      await api.sendFriendRequest(contact.user_id);
      markFriendRequestSent(contact.user_id);
      setContacts(loadOfflineContacts());
    } catch { /* may already be friends */ }
    setSending(null);
  };

  const handleRemove = (userId: string) => {
    removeOfflineContact(userId);
    setContacts(loadOfflineContacts());
  };

  if (contacts.length === 0) {
    return (
      <div style={{ padding: '16px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
          Offline Contacts
        </div>
        <div style={{ fontSize: 12, color: T.mt, fontStyle: 'italic' }}>
          No offline contacts yet. Exchange contacts via BLE proximity to add people here.
        </div>
      </div>
    );
  }

  const sameInstance = contacts.filter(c => c.instance_url === window.location.origin);
  const otherInstance = contacts.filter(c => c.instance_url !== window.location.origin);

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
        Offline Contacts ({contacts.length})
      </div>

      {sameInstance.map(c => (
        <div key={c.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 6, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
          {/* Avatar placeholder */}
          <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg,${ta(T.ac,'33')},${ta(T.ac2,'33')})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: T.ac, flexShrink: 0 }}>
            {c.username[0]?.toUpperCase() || '?'}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.username}
            </div>
            <div style={{ fontSize: 10, color: T.mt }}>
              Met {new Date(c.exchanged_at).toLocaleDateString()} via proximity
            </div>
          </div>

          {/* Actions */}
          {c.friend_request_sent ? (
            <span style={{ fontSize: 10, color: T.mt, fontWeight: 600, padding: '4px 10px', background: T.sf3, borderRadius: 6 }}>
              Request Sent
            </span>
          ) : (
            <button
              onClick={() => handleSendFriendRequest(c)}
              disabled={sending === c.user_id}
              style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: T.ac, color: '#000', border: 'none', opacity: sending === c.user_id ? 0.6 : 1, flexShrink: 0 }}
            >
              {sending === c.user_id ? '...' : 'Add Friend'}
            </button>
          )}

          <button
            onClick={() => handleRemove(c.user_id)}
            style={{ padding: '4px 8px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: 'rgba(237,66,69,0.08)', color: '#ed4245', border: '1px solid rgba(237,66,69,0.25)', flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      ))}

      {otherInstance.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginTop: 12, marginBottom: 6 }}>
            Other Instances
          </div>
          {otherInstance.map(c => (
            <div key={c.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 6, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, opacity: 0.7 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: `${ta(T.warn,'18')}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🌐</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{c.username}</div>
                <div style={{ fontSize: 10, color: T.mt }}>
                  {(() => { try { return new URL(c.instance_url).host; } catch { return c.instance_url; } })()}
                </div>
              </div>
              <button
                onClick={() => handleRemove(c.user_id)}
                style={{ padding: '4px 8px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: 'rgba(237,66,69,0.08)', color: '#ed4245', border: '1px solid rgba(237,66,69,0.25)', flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
