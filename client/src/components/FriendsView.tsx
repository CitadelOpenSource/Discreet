/**
 * FriendsView — Full-page friends management panel.
 * Tabs: All, Add Friend, Pending, Blocked.
 * Supports right-click context menu on friend rows.
 */
import React, { useState, useEffect } from 'react';
import { T, ta, getInp } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';
import { Av } from './Av';

// ─── Types ───────────────────────────────────────────────

interface Friend {
  id: string;
  friend_id?: string;
  friend_username?: string;
  username?: string;
  status?: string;
}

interface FriendRequest {
  id: string;
  sender_username?: string;
  recipient_username?: string;
  username?: string;
}

interface UserResult {
  id: string;
  username: string;
}

interface CtxMenuItem {
  label?: string;
  icon?: React.ReactNode;
  fn?: () => void;
  hint?: string;
  danger?: boolean;
  sep?: boolean;
}

interface CtxMenuState {
  x: number;
  y: number;
  items: CtxMenuItem[];
}

export interface FriendsViewProps {
  setCtxMenu: (menu: CtxMenuState | null) => void;
  showConfirm: (title: string, message: string, danger?: boolean, dismissKey?: string) => Promise<boolean>;
  isGuest?: boolean;
  isMobile?: boolean;
  onStartCall?: (userId: string) => void;
}

// ─── Component ────────────────────────────────────────────

export function FriendsView({ setCtxMenu, showConfirm, isGuest, isMobile, onStartCall }: FriendsViewProps) {
  const [tab, setTab] = useState('all');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchR, setSearchR] = useState<UserResult[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [f, i, o] = await Promise.all([api.listFriends(), api.listIncomingRequests(), api.listOutgoingRequests()]);
    setFriends(Array.isArray(f) ? f : []);
    setIncoming(Array.isArray(i) ? i : []);
    setOutgoing(Array.isArray(o) ? o : []);
  };

  const doSearch = async () => {
    if (!searchQ.trim()) return;
    const r = await api.searchUsers(searchQ.trim());
    setSearchR(Array.isArray(r) ? r.filter((u: UserResult) => u.id !== api.userId) : []);
  };

  const sendReq = async (uid: string) => {
    const r = await api.sendFriendRequest(uid);
    setMsg(r.ok ? 'Request sent!' : 'Already sent or blocked');
    setTimeout(() => setMsg(''), 2000);
    load();
  };

  const startDm = async (uid: string) => {
    const dm = await api.createDm(uid);
    if (dm) { setMsg('DM opened!'); setTimeout(() => setMsg(''), 1500); }
  };

  const pc = incoming.length + outgoing.length;
  const tabs = [
    { id: 'all',     label: 'All' },
    ...(!isGuest ? [{ id: 'add', label: 'Add Friend' }] : []),
    { id: 'pending', label: `Pending${pc ? ` (${pc})` : ''}` },
    { id: 'blocked', label: 'Blocked' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 16 }}>
        <I.Users />
        <span style={{ fontWeight: 700, fontSize: 15 }}>Friends</span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
          {tabs.map(t => (
            <div key={t.id} onClick={() => setTab(t.id)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: tab === t.id ? T.ac : T.mt, background: tab === t.id ? 'rgba(0,212,170,0.12)' : 'transparent', transition: 'all .15s' }}>{t.label}</div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {tab === 'all' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Friends — {friends.length}</div>
          {friends.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 20px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 32, background: `${ta(T.ac,'12')}`, marginBottom: 16 }}><I.Users s={28} /></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 6 }}>Add friends to start chatting</div>
              <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.5, maxWidth: 320, margin: '0 auto 16px' }}>Search by username or share your ID so others can find you.</div>
              <button onClick={() => setTab('add')} style={{ padding: '8px 20px', borderRadius: 'var(--radius-md)', border: 'none', background: T.ac, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Add Friend</button>
            </div>
          )}
          {friends.map(f => {
            const fid = f.friend_id || f.id;
            const fname = f.friend_username || f.username || '?';
            return (
              <div key={f.id} className="friend-row"
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  setCtxMenu({ x: e.clientX, y: e.clientY, items: [
                    { label: 'Message', icon: <I.Msg />, fn: () => startDm(fid) },
                    ...(onStartCall ? [{ label: 'Call', icon: <I.Phone />, fn: () => onStartCall(fid) }] : []),
                    { sep: true },
                    { label: 'Remove Friend', icon: <I.Trash />, danger: true, fn: async () => {
                      if (await showConfirm('Remove Friend', `Remove ${fname} from your friends list?`, true, 'remove_friend')) {
                        api.removeFriend(f.id); load();
                      }
                    }},
                    { sep: true },
                    { label: 'Copy User ID',   icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(fid || '') },
                    { label: 'Copy Username',  icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(fname) },
                  ]});
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)' }}>
                <Av name={f.friend_username || f.username || '?'} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{f.friend_username || f.username || 'Unknown User'}</div></div>
                <div onClick={() => startDm(fid)} style={{ cursor: 'pointer', color: T.mt, padding: isMobile ? 10 : 4, minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Message" aria-label="Message">
                  <I.Msg s={isMobile ? 20 : 16} />
                </div>
                {onStartCall && (
                  <div onClick={() => onStartCall(fid)} style={{ cursor: 'pointer', color: T.mt, padding: isMobile ? 10 : 4, minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Call" aria-label="Call">
                    <I.Phone s={isMobile ? 20 : 16} />
                  </div>
                )}
                <div onClick={async () => {
                  if (await showConfirm('Remove Friend', `Remove ${f.friend_username || f.username || 'this user'} from your friends list?`, true, 'remove_friend')) {
                    api.removeFriend(f.id); load();
                  }
                }} style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Remove"><I.Trash /></div>
              </div>
            );
          })}
        </>)}

        {tab === 'pending' && (<>
          {incoming.length > 0 && (<>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Incoming — {incoming.length}</div>
            {incoming.map(r => (
              <div key={r.id} className="friend-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
                <Av name={r.sender_username || r.username || '?'} />
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{r.sender_username || r.username || '?'}</div>
                <div onClick={() => { api.acceptFriend(r.id); load(); }} className="pill-btn" style={{ background: T.ac, color: '#000', display: 'inline-flex', alignItems: 'center', gap: 4 }}><I.Check /> Accept</div>
                <div onClick={() => { api.declineFriend(r.id); load(); }} className="pill-btn" style={{ background: T.sf2, color: T.mt }}>Decline</div>
              </div>
            ))}
          </>)}
          {outgoing.length > 0 && (<>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '16px 0 10px' }}>Outgoing — {outgoing.length}</div>
            {outgoing.map(r => (
              <div key={r.id} className="friend-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
                <Av name={r.recipient_username || r.username || '?'} />
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{r.recipient_username || r.username || '?'}</div>
                <div style={{ fontSize: 12, color: T.mt, marginRight: 8 }}>Pending</div>
                <div onClick={() => { api.removeFriend(r.id); load(); }} className="pill-btn" style={{ background: T.sf2, color: T.mt }}>Cancel</div>
              </div>
            ))}
          </>)}
          {incoming.length === 0 && outgoing.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 20px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 28, background: `${ta(T.ac,'12')}`, marginBottom: 12 }}><I.Check s={24} /></div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>No pending requests</div>
              <div style={{ fontSize: 12, color: T.mt }}>When someone sends you a friend request, it will appear here.</div>
            </div>
          )}
        </>)}

        {tab === 'blocked' && <BlockedList showConfirm={showConfirm} />}

        {tab === 'add' && (<>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Add Friend</div>
          <div style={{ fontSize: 13, color: T.mt, marginBottom: 14 }}>Search by username to send a friend request.</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input style={{ ...getInp(), flex: 1 }} value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="Enter a username" autoFocus />
            <button onClick={doSearch} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '10px 20px', borderRadius: 'var(--radius-md)' }}>Search</button>
          </div>
          {msg && <div style={{ padding: '8px 12px', background: 'rgba(0,212,170,0.08)', borderRadius: 'var(--radius-md)', color: T.ac, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
          {searchR.map(u => (
            <div key={u.id} className="friend-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
              <Av name={u.username || '?'} />
              <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{u.username}</div>
              <button onClick={() => sendReq(u.id)} className="pill-btn" style={{ background: T.ac, color: '#000' }}>Send Request</button>
            </div>
          ))}
        </>)}
      </div>
    </div>
  );
}

// ─── BlockedList (sub-component) ─────────────────────────

interface BlockedEntry {
  id: string;
  friend_id?: string;
  friend_username?: string;
  username?: string;
  status?: string;
}

interface BlockedListProps {
  showConfirm: (title: string, message: string, danger?: boolean) => Promise<boolean>;
}

function BlockedList({ showConfirm }: BlockedListProps) {
  const [blocked, setBlocked] = useState<BlockedEntry[]>([]);

  useEffect(() => {
    api.listFriends?.().then((f: any[]) => {
      const b = (Array.isArray(f) ? f : []).filter((x: any) => x.status === 'blocked');
      setBlocked(b);
    }).catch(() => {});
  }, []);

  return (<>
    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Blocked Users</div>
    <div style={{ fontSize: 12, color: T.mt, marginBottom: 14 }}>Blocked users cannot message you, see your online status, or send friend requests.</div>
    {blocked.length === 0 && (
      <div style={{ textAlign: 'center', padding: '48px 20px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 28, background: 'rgba(255,255,255,0.04)', marginBottom: 12 }}><I.Shield s={24} /></div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>No blocked users</div>
        <div style={{ fontSize: 12, color: T.mt }}>Users you block will appear here.</div>
      </div>
    )}
    {blocked.map(b => (
      <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: 4, background: T.sf2 }}>
        <Av name={b.friend_username || b.username || '?'} size={32} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{b.friend_username || b.username}</div>
          <div style={{ fontSize: 10, color: T.mt }}>Blocked</div>
        </div>
        <button onClick={async () => {
          if (await showConfirm('Unblock', `Unblock ${b.friend_username || b.username}?`, false)) {
            await api.unblockUser(b.friend_id || b.id);
            setBlocked(p => p.filter(x => x.id !== b.id));
          }
        }} className="pill-btn" style={{ background: T.sf, color: T.mt, border: `1px solid ${T.bd}`, padding: '4px 12px', fontSize: 11 }}>Unblock</button>
      </div>
    ))}
  </>);
}
