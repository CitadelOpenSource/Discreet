/**
 * UserProfileCard — Popup profile card when clicking a username.
 * Renders via ReactDOM.createPortal at the click position.
 * Shows user info, roles, notes, and moderation actions.
 */
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';
import { Av } from './Av';
import { QrConnectModal } from './QrConnectModal';

// ─── Types ───────────────────────────────────────────────

interface UserRole {
  id?: string;
  role_id?: string;
  name: string;
  color?: string;
}

interface UserData {
  id: string;
  username: string;
  display_name?: string;
  custom_status?: string;
  avatar_url?: string;
  is_bot?: boolean;
  persona?: string;
  created_at?: string;
  platform_role?: string | null;
}

interface ServerInfo {
  id: string;
  owner_id?: string;
}

interface BotConfig {
  bot_user_id: string;
  username?: string;
  display_name?: string;
  persona?: string;
}

interface PermissionSet {
  kick?: boolean;
  ban?: boolean;
  manageRoles?: boolean;
  admin?: boolean;
  manageServer?: boolean;
}

export interface UserProfileCardProps {
  userId: string;
  pos: { x: number; y: number };
  onClose: () => void;
  curServer?: ServerInfo | null;
  isOwner?: boolean;
  canMod?: boolean;
  onKick?: (userId: string) => void;
  onBan?: (userId: string, reason: string) => void;
  onAssignRole?: (userId: string, roleId: string) => void;
  onUnassignRole?: (userId: string, roleId: string) => void;
  allRoles?: UserRole[];
  perms?: PermissionSet;
  onConfigBot?: (bot: BotConfig) => void;
  onMessage?: (userId: string) => void;
  showConfirm: (title: string, message: string, danger?: boolean) => Promise<boolean>;
  customStatuses?: Record<string, string>;
  isGuest?: boolean;
}

export function UserProfileCard({
  userId, pos, onClose, curServer, isOwner, canMod,
  onKick, onBan, onAssignRole, onUnassignRole, allRoles, perms,
  onConfigBot, onMessage, showConfirm, customStatuses, isGuest,
}: UserProfileCardProps) {
  const [user, setUser] = useState<UserData | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [note, setNote] = useState('');
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState('about');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) return;
    api.getUser(userId).then((u: UserData) => {
      setUser(u);
      if (u?.avatar_url) {
        setAvatarUrl(u.avatar_url);
        try {
          const c = JSON.parse(localStorage.getItem('d_avatars') || '{}');
          c[userId] = u.avatar_url;
          localStorage.setItem('d_avatars', JSON.stringify(c));
        } catch {}
      }
    });
    const notes = JSON.parse(localStorage.getItem('d_notes') || '{}');
    setNote(notes[userId] || '');
    const mutes = JSON.parse(localStorage.getItem('d_mutes') || '[]');
    setMuted(mutes.includes(userId));
    const bios = JSON.parse(localStorage.getItem('d_bios') || '{}');
    setBio(bios[userId] || '');
    if (userId === api.userId) setBio(localStorage.getItem('d_bio') || '');
    const avCache = JSON.parse(localStorage.getItem('d_avatars') || '{}');
    if (avCache[userId]) setAvatarUrl(avCache[userId]);
    if (curServer) {
      api.listMemberRoles(curServer.id, userId).then((r: UserRole[]) => setRoles(Array.isArray(r) ? r : [])).catch(() => {});
    }
  }, [userId, curServer?.id]);

  useEffect(() => {
    const handle = (e: MouseEvent) => { if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', handle), 50);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const saveNote = (v: string) => {
    setNote(v);
    const notes = JSON.parse(localStorage.getItem('d_notes') || '{}');
    notes[userId] = v;
    localStorage.setItem('d_notes', JSON.stringify(notes));
  };

  const toggleMute = () => {
    const mutes = JSON.parse(localStorage.getItem('d_mutes') || '[]');
    const next = muted ? mutes.filter((id: string) => id !== userId) : [...mutes, userId];
    localStorage.setItem('d_mutes', JSON.stringify(next));
    setMuted(!muted);
  };

  const sendFriendReq = async () => { try { await api.sendFriendRequest(userId); } catch {} };
  const blockUser = async () => {
    if (await showConfirm('Block User', `Block ${user?.username}? They won't be able to message you or see your online status.`, true)) {
      try { await api.blockUser(userId); onClose(); } catch {}
    }
  };

  const isSelf = userId === api.userId;
  const isBot = user?.is_bot;
  const isServerOwner = curServer?.owner_id === api.userId;
  const p = perms || {};
  const canKick = isOwner || p.kick;
  const canBan = isOwner || p.ban;
  const canTimeout = isOwner || p.kick || p.ban;
  const canManageRoles = isOwner || p.manageRoles;
  const isTargetOwner = curServer?.owner_id === userId;
  const showAdminTab = (canKick || canBan || canManageRoles || isOwner || p.admin || p.manageServer) && !isTargetOwner;

  if (!user) return null;

  const left = Math.min(pos.x, window.innerWidth - 320);
  const top = Math.min(pos.y, window.innerHeight - 420);

  return ReactDOM.createPortal(
    <div ref={cardRef} style={{ position: 'fixed', left, top, zIndex: 10000, width: 300, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
      {/* Banner + Avatar */}
      <div style={{ height: 60, background: `linear-gradient(135deg, ${T.ac}44, ${T.ac2 ?? T.ac}44)`, position: 'relative' }}>
        <div style={{ position: 'absolute', bottom: -20, left: 16 }}>
          <Av name={user.display_name || user.username || '?'} size={48} color={T.ac} url={avatarUrl} style={{ border: `3px solid ${T.sf}`, borderRadius: 24 }} />
        </div>
        {!isSelf && (
          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
            <div onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: muted ? T.err : T.mt }}>{muted ? '🔇' : '🔈'}</div>
          </div>
        )}
      </div>

      {/* Identity */}
      <div style={{ padding: '28px 16px 8px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, display: 'flex', alignItems: 'center', gap: 6 }}>
          {user.display_name || user.username}
          {(user.platform_role === 'admin' || user.platform_role === 'dev') && (
            <span title="This user is a Discreet staff member" style={{ fontSize: 10, fontWeight: 700, color: '#00D4AA', display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(0,212,170,0.1)', padding: '1px 6px', borderRadius: 4 }}>🛡 Staff</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: T.mt }}>{user.username}{isSelf && ' (you)'}</div>
        {(() => {
          const wsStatus = customStatuses?.[userId];
          const status = wsStatus !== undefined ? wsStatus : user.custom_status;
          return status ? <div style={{ fontSize: 12, color: T.ac, marginTop: 4, fontStyle: 'italic' }}>{status}</div> : null;
        })()}
      </div>

      {/* Self: Quick Status/Name Editor */}
      {isSelf && <SelfStatusEdit user={user} api={api} />}

      {/* Bio */}
      {(bio || (isSelf && localStorage.getItem('d_bio'))) && (
        <div style={{ padding: '0 16px 8px' }}>
          <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.5, padding: '6px 10px', background: T.bg, borderRadius: 6 }}>{bio || localStorage.getItem('d_bio')}</div>
        </div>
      )}

      {/* Roles */}
      {roles.length > 0 && (
        <div style={{ padding: '0 16px 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {roles.map(r => (
            <span key={r.id || r.role_id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${r.color || T.mt}22`, color: r.color || T.mt, border: `1px solid ${r.color || T.mt}44`, fontWeight: 600 }}>{r.name}</span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${T.bd}`, padding: '0 16px' }}>
        {['about', 'note', ...(showAdminTab ? ['admin'] : [])].map(t => (
          <div key={t} onClick={() => setTab(t)} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: tab === t ? T.ac : T.mt, borderBottom: tab === t ? `2px solid ${T.ac}` : '2px solid transparent', textTransform: 'capitalize' }}>{t}</div>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ padding: 12, minHeight: 80, maxHeight: 200, overflowY: 'auto' }}>
        {tab === 'about' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Member Since</div>
          <div style={{ fontSize: 13, color: T.tx, marginBottom: 12 }}>{user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown'}</div>
          {muted && <div style={{ fontSize: 12, color: T.err, padding: '4px 8px', background: `${T.err}11`, borderRadius: 6, marginBottom: 8 }}>🔇 Muted — their messages are hidden</div>}
        </>)}

        {tab === 'note' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Personal Note (only you see this)</div>
          <textarea value={note} onChange={e => saveNote(e.target.value)} placeholder="Add a note about this user..." style={{ width: '100%', minHeight: 60, background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, padding: 8, resize: 'vertical', fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box' }} />
        </>)}

        {tab === 'admin' && showAdminTab && (<>
          {canManageRoles && (<>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 8 }}>Roles</div>
            {(allRoles || []).filter(r => r.name !== '@everyone').map(role => {
              const has = roles.some(mr => mr.id === role.id || mr.role_id === role.id);
              return (
                <div key={role.id} onClick={() => {
                  if (has) { onUnassignRole?.(userId, role.id!); setRoles(p => p.filter(r => (r.id || r.role_id) !== role.id)); }
                  else { onAssignRole?.(userId, role.id!); setRoles(p => [...p, role]); }
                }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: T.tx }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
                  <div style={{ width: 10, height: 10, borderRadius: 5, background: role.color || T.mt }} />
                  <span style={{ flex: 1 }}>{role.name}</span>
                  {has && <span style={{ color: T.ac }}>✓</span>}
                </div>
              );
            })}
            <div style={{ height: 1, background: T.bd, margin: '8px 0' }} />
          </>)}
          {canTimeout && (
            <div onClick={async () => {
              if (await showConfirm('Timeout User', `Timeout ${user?.username} for 10 minutes?`, true)) {
                const tos: Record<string, number> = JSON.parse(localStorage.getItem('d_timeouts') || '{}');
                tos[userId] = Date.now() + 600000;
                localStorage.setItem('d_timeouts', JSON.stringify(tos));
                onClose();
              }
            }} style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: T.warn, display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,165,2,0.08)')}
              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
              ⏱ Timeout (10 min)
            </div>
          )}
          {canKick && (
            <div onClick={async () => {
              if (await showConfirm('Kick Member', `Kick ${user?.username} from the server?`, true)) { onKick?.(userId); onClose(); }
            }} style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: T.warn, display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,165,2,0.08)')}
              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
              <I.Out /> Kick from Server
            </div>
          )}
          {canBan && (
            <div onClick={async () => {
              if (await showConfirm('Ban Member', `Ban ${user?.username}? They will NOT be able to rejoin until unbanned.`, true)) { onBan?.(userId, ''); onClose(); }
            }} style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: T.err, display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,70,87,0.08)')}
              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
              <I.Shield /> Ban from Server
            </div>
          )}
        </>)}
      </div>

      {/* Bot Config button */}
      {isBot && isServerOwner && onConfigBot && (
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${T.bd}` }}>
          <button onClick={() => { onConfigBot({ bot_user_id: userId, username: user?.username, display_name: user?.display_name || user?.username, persona: user?.persona || 'general' }); onClose(); }} className="pill-btn" style={{ width: '100%', padding: '9px 0', background: 'linear-gradient(135deg,#7289da,#5865F2)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>🤖 Configure Bot</button>
        </div>
      )}

      {/* Self QR Share */}
      {isSelf && <SelfQrButton />}

      {/* Bottom Actions */}
      {!isSelf && (
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${T.bd}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { if (onMessage) { onMessage(userId); onClose(); } else { api.createDm(userId).then(() => onClose()); } }} className="pill-btn" style={{ flex: 1, padding: '7px 0', background: T.sf2, color: T.ac, border: `1px solid ${T.bd}`, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Message</button>
            {!isGuest && <button onClick={sendFriendReq} className="pill-btn" style={{ flex: 1, padding: '7px 0', background: T.ac, color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add Friend</button>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={toggleMute} className="pill-btn" style={{ flex: 1, padding: '6px 0', background: muted ? 'rgba(255,71,87,0.1)' : T.sf2, color: muted ? T.err : T.mt, border: `1px solid ${muted ? 'rgba(255,71,87,0.2)' : T.bd}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{muted ? '🔇 Unmute' : '🔈 Mute'}</button>
            <button onClick={blockUser} className="pill-btn" style={{ flex: 1, padding: '6px 0', background: T.sf2, color: T.err, border: `1px solid ${T.bd}`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>🚫 Block</button>
          </div>
          {!isTargetOwner && (canKick || canBan || canTimeout) && (
            <div style={{ display: 'flex', gap: 4, paddingTop: 4, borderTop: `1px solid ${T.bd}` }}>
              {canTimeout && <button onClick={async () => {
                if (await showConfirm('Timeout User', `Timeout ${user?.username} for 10 minutes?`, true)) {
                  const tos: Record<string, number> = JSON.parse(localStorage.getItem('d_timeouts') || '{}');
                  tos[userId] = Date.now() + 600000;
                  localStorage.setItem('d_timeouts', JSON.stringify(tos));
                  onClose();
                }
              }} className="pill-btn" style={{ flex: 1, padding: '5px 0', background: T.sf2, color: T.warn, border: `1px solid ${T.bd}`, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>⏱ Timeout</button>}
              {canKick && <button onClick={async () => {
                if (await showConfirm('Kick Member', `Kick ${user?.username} from the server?`, true)) { onKick?.(userId); onClose(); }
              }} className="pill-btn" style={{ flex: 1, padding: '5px 0', background: T.sf2, color: T.warn, border: `1px solid ${T.bd}`, borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>👢 Kick</button>}
              {canBan && <button onClick={async () => {
                if (await showConfirm('Ban Member', `Ban ${user?.username} from the server? They will NOT be able to rejoin until unbanned.`, true)) { onBan?.(userId, ''); onClose(); }
              }} className="pill-btn" style={{ flex: 1, padding: '5px 0', background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.3)', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>🚫 Ban</button>}
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── SelfStatusEdit (inline sub-component) ───────────────

interface SelfStatusEditProps {
  user: UserData;
  api: any;
}

function SelfStatusEdit({ user, api: apiRef }: SelfStatusEditProps) {
  const [editing, setEditing] = useState(false);
  const [newStatus, setNewStatus] = useState(localStorage.getItem('d_custom_status') || '');
  const [newDisplayName, setNewDisplayName] = useState(user.display_name || user.username || '');

  if (!editing) return (
    <div style={{ padding: '0 16px 8px' }}>
      <button onClick={() => setEditing(true)} className="pill-btn" style={{ width: '100%', padding: '8px 0', background: `linear-gradient(135deg,${T.ac}22,${T.ac}22)`, color: T.ac, border: `1px solid ${T.ac}44`, borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>✏️ Edit Profile & Status</button>
    </div>
  );

  return (
    <div style={{ padding: '0 16px 8px' }}>
      <div style={{ background: T.bg, borderRadius: 8, padding: 10, border: `1px solid ${T.bd}` }}>
        <label style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Display Name</label>
        <input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} style={{ width: '100%', padding: '6px 8px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
        <label style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Custom Status</label>
        <input value={newStatus} onChange={e => setNewStatus(e.target.value)} placeholder="What's on your mind?" maxLength={128} style={{ width: '100%', padding: '6px 8px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={async () => {
            await apiRef.updateProfile({ display_name: newDisplayName, custom_status: newStatus });
            localStorage.setItem('d_custom_status', newStatus);
            apiRef.invalidateUserCache?.(apiRef.userId);
            if (apiRef.ws && apiRef.ws.readyState === 1) {
              apiRef.ws.send(JSON.stringify({ type: 'user_update', user_id: apiRef.userId, username: apiRef.username, display_name: newDisplayName, custom_status: newStatus }));
            }
            setEditing(false);
          }} className="pill-btn" style={{ flex: 1, background: T.ac, color: '#000', padding: '6px 0', fontSize: 11, fontWeight: 700 }}>Save</button>
          <button onClick={() => setEditing(false)} className="pill-btn" style={{ background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, padding: '6px 12px', fontSize: 11 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── SelfQrButton (inline sub-component) ──────────────────

function SelfQrButton() {
  const [showQr, setShowQr] = useState(false);

  return (
    <div style={{ padding: '4px 12px' }}>
      <button onClick={() => setShowQr(true)} className="pill-btn" style={{
        width: '100%', padding: '7px 0', background: T.sf2, color: T.tx,
        border: `1px solid ${T.bd}`, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 14 }}>&#9783;</span> My QR Code
      </button>
      {showQr && (
        <QrConnectModal type="friend" onClose={() => setShowQr(false)} />
      )}
    </div>
  );
}
