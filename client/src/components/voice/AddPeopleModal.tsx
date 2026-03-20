/**
 * AddPeopleModal — Invite friends to an active voice/video call.
 *
 * Lists the user's friends with checkboxes. Selected friends receive
 * a call ring notification via WebSocket. When they accept, they join
 * the same voice channel, turning 1:1 into a group call seamlessly.
 */
import React, { useState, useEffect } from 'react';
import { T, ta } from '../../theme';
import * as I from '../../icons';
import { api } from '../../api/CitadelAPI';
import { Av } from '../Av';

interface Friend {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
}

interface Props {
  channelId: string;
  channelName: string;
  existingParticipants: string[];
  onClose: () => void;
}

export function AddPeopleModal({ channelId, channelName, existingParticipants, onClose }: Props) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api.listFriends().then((data: any) => {
      const list = Array.isArray(data) ? data : data?.friends || [];
      // Filter out users already in the call.
      const filtered = list
        .map((f: any) => ({ id: f.id || f.user_id, username: f.username || f.other_username, display_name: f.display_name, avatar_url: f.avatar_url }))
        .filter((f: Friend) => f.id && !existingParticipants.includes(f.id));
      setFriends(filtered);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [existingParticipants]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sendInvites = async () => {
    setSending(true);
    for (const uid of selected) {
      try {
        api.ws?.send(JSON.stringify({
          type: 'call_invite',
          target_user_id: uid,
          channel_id: channelId,
          channel_name: channelName,
        }));
      } catch { /* best-effort */ }
    }
    setSent(true);
    setSending(false);
    setTimeout(onClose, 1500);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10002, padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 380, background: T.sf, borderRadius: 12,
        border: `1px solid ${T.bd}`, boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', maxHeight: '70vh',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${T.bd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I.UserPlus s={16} />
            <span style={{ fontSize: 15, fontWeight: 700, color: T.tx }}>Add People</span>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', color: T.mt, padding: 2 }} aria-label="Close"><I.X s={16} /></div>
        </div>

        {/* Friend list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: T.mt, fontSize: 12 }}>Loading friends...</div>}

          {!loading && friends.length === 0 && (
            <div style={{ padding: '24px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: T.mt }}>No friends available to invite</div>
            </div>
          )}

          {friends.map(f => {
            const checked = selected.has(f.id);
            return (
              <div
                key={f.id}
                onClick={() => toggle(f.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 18px', cursor: 'pointer',
                  background: checked ? ta(T.ac, '08') : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(f.id)}
                  style={{ accentColor: T.ac, width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                  aria-label={`Invite ${f.display_name || f.username}`}
                />
                <Av name={f.display_name || f.username} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{f.display_name || f.username}</div>
                  {f.display_name && <div style={{ fontSize: 10, color: T.mt }}>{f.username}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.bd}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {sent ? (
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ac }}>Invites sent!</div>
          ) : (
            <>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.bd}`,
                  background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={sendInvites}
                disabled={selected.size === 0 || sending}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: 'none',
                  background: selected.size === 0 || sending ? T.sf2 : `linear-gradient(135deg,${T.ac},${T.ac2})`,
                  color: selected.size === 0 || sending ? T.mt : '#000',
                  fontSize: 12, fontWeight: 700,
                  cursor: selected.size === 0 || sending ? 'default' : 'pointer',
                }}
              >
                {sending ? 'Sending...' : `Invite ${selected.size || ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
