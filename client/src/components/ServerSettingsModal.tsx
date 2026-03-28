/**
 * ServerSettingsModal — Full server administration panel.
 * Tabs: Overview, Channels, Roles, Members, Bots, Emoji, Events, Moderation, Bans, Audit Log.
 */
import React, { useState, useEffect } from 'react';
import { T, ta, getInp, btn } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';
import { Modal } from './Modal';
import { Av } from './Av';
import { type FilterLevel, getProfanityLevel, setProfanityLevel } from '../utils/profanityFilter';
import { BotConfigModal, PRESETS } from './BotConfigModal';
import { DangerConfirmModal } from './DangerConfirmModal';
import WebhookSettings from './settings/WebhookSettings';

// ─── Types ───────────────────────────────────────────────

export interface Server {
  id: string;
  name: string;
  description?: string;
  member_tab_label?: string;
  slash_commands_enabled?: boolean;
  message_retention_days?: number | null;
  disappearing_messages_default?: string | null;
  last_activity_at?: string | null;
  is_archived?: boolean;
  archived_at?: string | null;
  scheduled_deletion_at?: string | null;
  owner_id?: string;
  icon_url?: string;
  is_public?: boolean;
}

interface Channel {
  id: string;
  name: string;
  topic?: string;
  channel_type?: string;
  locked?: boolean;
  min_role_position?: number;
  message_ttl_seconds?: number;
  slowmode_seconds?: number;
  nsfw?: boolean;
  position?: number;
  category_id?: string | null;
  is_archived?: boolean;
  is_announcement?: boolean;
  ai_model_override?: string | null;
  read_only?: boolean;
  ttl_seconds?: number | null;
}

interface Category {
  id: string;
  name: string;
  position?: number;
}

interface Role {
  id: string;
  name: string;
  color?: string;
  permissions?: number;
}

interface Member {
  user_id: string;
  username: string;
  display_name?: string;
  is_bot?: boolean;
  joined_at?: string;
  last_active_at?: string;
  online?: boolean;
  nickname?: string;
}

interface BanEntry {
  id?: string;
  user_id: string;
  username?: string;
  reason?: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor_username?: string;
  reason?: string;
  created_at: string;
  chain_hash?: string;
  sequence_num?: number;
}

interface SearchMessage {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
}

interface BotEntry {
  bot_user_id:     string;
  username?:       string;
  display_name?:   string;
  persona?:        string;
  system_prompt?:  string;
  temperature?:    number;
  enabled?:        boolean;
  description?:    string;
  greeting_message?: string;
  response_prefix?:  string;
  voice_style?:    string;
  max_tokens?:     number;
  response_mode?:  string;
  dm_auto_respond?: boolean;
  blocked_topics?: string;
  rate_limit_per_min?: number;
  persistent?:     boolean;
  typing_delay?:   number;
  context_memory?: boolean;
  context_window?: number;
  auto_thread?:    boolean;
  dm_greeting?:    string;
  emoji_reactions?: boolean;
  language?:       string;
  knowledge_base?: string;
}

interface EmojiEntry {
  id: string;
  name: string;
  image_url: string;
}

interface Event {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time?: string;
  going_count: number;
  interested_count: number;
  creator_username: string;
}

// ─── Permission Helpers (safe for bits > 31) ─────────────
// JS bitwise operators (&, |, ~) truncate to 32 bits.
// These helpers use arithmetic for bits >= 2^32.
function permHas(perms: number, bit: number): boolean {
  if (bit < 0x100000000) return (perms & bit) !== 0;
  return Math.floor(perms / bit) % 2 === 1;
}
function permSet(perms: number, bit: number): number {
  if (permHas(perms, bit)) return perms;
  return perms + bit;
}
function permClear(perms: number, bit: number): number {
  if (!permHas(perms, bit)) return perms;
  return perms - bit;
}
function permToggle(perms: number, bit: number): number {
  return permHas(perms, bit) ? permClear(perms, bit) : permSet(perms, bit);
}

// ─── Permission Labels ────────────────────────────────────

const PERM_LABELS = [
  { bit: 1 << 0,  label: 'View Channels',         cat: 'General' },
  { bit: 1 << 1,  label: 'Send Messages',          cat: 'General' },
  { bit: 1 << 2,  label: 'Read History',           cat: 'General' },
  { bit: 1 << 3,  label: 'Attach Files',           cat: 'General' },
  { bit: 1 << 4,  label: 'Create Invites',         cat: 'General' },
  { bit: 1 << 5,  label: 'Change Nickname',        cat: 'General' },
  { bit: 1 << 6,  label: 'Mention Everyone',       cat: 'General' },
  { bit: 1 << 10, label: 'Manage Messages',        cat: 'Moderation' },
  { bit: 1 << 11, label: 'Kick Members',           cat: 'Moderation' },
  { bit: 1 << 12, label: 'Ban Members',            cat: 'Moderation' },
  { bit: 1 << 13, label: 'Manage Nicknames',       cat: 'Moderation' },
  { bit: 1 << 16, label: 'Manage AutoMod',         cat: 'Moderation' },
  { bit: 1 << 9,  label: 'Manage Pins',            cat: 'Channels' },
  { bit: 1 << 14, label: 'Archive Channels',       cat: 'Channels' },
  { bit: 1 << 20, label: 'Manage Channels',        cat: 'Channels' },
  { bit: 1 << 30, label: 'Connect Voice',          cat: 'Voice' },
  { bit: 1 << 31, label: 'Speak',                  cat: 'Voice' },
  { bit: 1 << 32, label: 'Mute Members',           cat: 'Voice' },
  { bit: 1 << 33, label: 'Move Members',           cat: 'Voice' },
  { bit: 1 << 34, label: 'Priority Speaker',       cat: 'Voice' },
  { bit: 1 << 7,  label: 'Manage Webhooks',        cat: 'Administration' },
  { bit: 1 << 8,  label: 'Manage Scheduled Msgs',  cat: 'Administration' },
  { bit: 1 << 15, label: 'View Audit Log',         cat: 'Administration' },
  { bit: 1 << 17, label: 'Manage Bots',            cat: 'Administration' },
  { bit: 1 << 21, label: 'Manage Roles',           cat: 'Administration' },
  { bit: 1 << 22, label: 'Manage Server Settings', cat: 'Administration' },
  { bit: 1 << 23, label: 'Manage Invites',         cat: 'Administration' },
  { bit: 1 << 24, label: 'Manage AI Agents',       cat: 'Administration' },
  { bit: 2 ** 40, label: 'Administrator',          cat: 'Dangerous' },
  { bit: 2 ** 41, label: 'Delete Server',          cat: 'Dangerous' },
  { bit: 2 ** 42, label: 'Transfer Ownership',     cat: 'Dangerous' },
];

// ─── ChannelManagerRow ───────────────────────────────────

function chTypeIcon(type?: string): string {
  if (type === 'voice')        return '🔊';
  if (type === 'announcement') return '📢';
  return '#';
}

interface ChannelManagerRowProps {
  ch: Channel;
  index: number;
  total: number;
  categories: Category[];
  serverId: string;
  onRefresh: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
  showConfirm: (title: string, message: string, danger?: boolean, confirmPhrase?: string, confirmLabel?: string) => Promise<boolean>;
}

const AI_MODEL_OPTIONS = [
  { value: '',                          label: 'Default (server)' },
  { value: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'claude-opus-4-6',          label: 'Claude Opus 4.6' },
  { value: 'gpt-4o',                    label: 'GPT-4o' },
  { value: 'gpt-4o-mini',              label: 'GPT-4o Mini' },
  { value: 'llama3',                    label: 'Llama 3 (Ollama)' },
  { value: 'mistral',                   label: 'Mistral (Ollama)' },
  { value: 'codellama',                 label: 'Code Llama (Ollama)' },
];

function ChannelManagerRow({ ch, index, total, categories, onRefresh, onMove, showConfirm }: ChannelManagerRowProps) {
  const [editing, setEditing]   = useState(false);
  const [chName, setChName]     = useState(ch.name);
  const [saving, setSaving]     = useState(false);
  const [hovered, setHovered]   = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const saveRename = async () => {
    const trimmed = chName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed || trimmed === ch.name) { setEditing(false); return; }
    setSaving(true);
    await api.updateChannel(ch.id, { name: trimmed });
    setSaving(false);
    setEditing(false);
    onRefresh();
  };

  const moveCat = async (catId: string) => {
    await api.updateChannel(ch.id, { category_id: catId || null });
    onRefresh();
  };

  const toggleArchive = async () => {
    await api.updateChannel(ch.id, { is_archived: !ch.is_archived });
    onRefresh();
  };

  const typeColor = ch.channel_type === 'voice' ? '#5865f2' : ch.channel_type === 'announcement' ? '#f0b132' : T.mt;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
        borderRadius: 7, marginBottom: 3,
        background: hovered ? 'rgba(255,255,255,0.04)' : T.sf2,
        border: `1px solid ${hovered ? T.bd : 'transparent'}`,
        transition: 'background .12s, border-color .12s',
      }}
    >
      {/* position controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
        <button
          onClick={() => onMove(ch.id, -1)} disabled={index === 0}
          style={{ background: 'none', border: 'none', color: index === 0 ? T.bd : T.mt, cursor: index === 0 ? 'default' : 'pointer', padding: '0 2px', fontSize: 9, lineHeight: 1 }}
          title="Move up"
        >▲</button>
        <button
          onClick={() => onMove(ch.id, 1)} disabled={index === total - 1}
          style={{ background: 'none', border: 'none', color: index === total - 1 ? T.bd : T.mt, cursor: index === total - 1 ? 'default' : 'pointer', padding: '0 2px', fontSize: 9, lineHeight: 1 }}
          title="Move down"
        >▼</button>
      </div>

      {/* type icon */}
      <span style={{ fontSize: 15, flexShrink: 0, color: typeColor, minWidth: 18, textAlign: 'center' }}>{chTypeIcon(ch.channel_type)}</span>

      {/* name / inline edit */}
      {editing ? (
        <input
          autoFocus
          value={chName}
          onChange={e => setChName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditing(false); setChName(ch.name); } }}
          style={{ ...getInp(), flex: 1, padding: '3px 7px', fontSize: 13 }}
        />
      ) : (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: ch.is_archived ? T.mt : T.tx }}>
            {ch.name}
            {ch.is_archived && <span style={{ marginInlineStart: 6, fontSize: 10, color: T.mt, fontWeight: 400 }}>[archived]</span>}
          </div>
          {ch.topic && <div style={{ fontSize: 11, color: T.mt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.topic}</div>}
        </div>
      )}

      {/* type badge */}
      <span style={{ fontSize: 10, color: typeColor, fontFamily: 'var(--font-mono)', background: T.bg, padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}>
        {ch.channel_type || 'text'}
      </span>

      {/* AI model override badge / picker */}
      {ch.channel_type !== 'voice' && (
        showModelPicker ? (
          <select
            autoFocus
            value={ch.ai_model_override || ''}
            onChange={async (e) => {
              const val = e.target.value || null;
              await api.updateChannel(ch.id, { ai_model_override: val });
              onRefresh();
              setShowModelPicker(false);
            }}
            onBlur={() => setShowModelPicker(false)}
            style={{ ...getInp(), padding: '3px 6px', fontSize: 10, maxWidth: 130, flexShrink: 0 }}
          >
            {AI_MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : ch.ai_model_override ? (
          <span
            onClick={() => setShowModelPicker(true)}
            title={`AI Model: ${ch.ai_model_override} (click to change)`}
            style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'rgba(88,101,242,0.12)', color: '#5865F2', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            🤖 {ch.ai_model_override}
          </span>
        ) : hovered ? (
          <span
            onClick={() => setShowModelPicker(true)}
            title="Set AI model override for this channel"
            style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, color: T.mt, cursor: 'pointer', flexShrink: 0, opacity: 0.6 }}
          >
            🤖
          </span>
        ) : null
      )}

      {/* category move */}
      {categories.length > 0 && (
        <select
          value={ch.category_id || ''}
          onChange={e => moveCat(e.target.value)}
          title="Move to category"
          style={{ ...getInp(), padding: '3px 6px', fontSize: 11, maxWidth: 110, flexShrink: 0 }}
        >
          <option value="">No category</option>
          {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
        </select>
      )}

      {/* action buttons */}
      {editing ? (<>
        <button onClick={saveRename} disabled={saving} style={{ background: 'none', border: 'none', color: T.ac, cursor: 'pointer', padding: 4, fontSize: 14 }} title="Save"><I.Check /></button>
        <button onClick={() => { setEditing(false); setChName(ch.name); }} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', padding: 4, fontSize: 14 }} title="Cancel"><I.X /></button>
      </>) : (<>
        <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', padding: 4, fontSize: 13, opacity: hovered ? 1 : 0.5, transition: 'opacity .12s' }} title="Rename"><I.Edit /></button>
        <button
          onClick={async () => {
            await api.updateChannel(ch.id, { read_only: !ch.read_only });
            onRefresh();
          }}
          title={ch.read_only ? 'Make writable' : 'Make read-only'}
          style={{ background: 'none', border: 'none', color: ch.read_only ? '#faa61a' : T.mt, cursor: 'pointer', padding: 4, fontSize: 13, opacity: hovered ? 1 : 0.5, transition: 'opacity .12s' }}
        >{ch.read_only ? '📣' : '📢'}</button>
        <button
          onClick={toggleArchive}
          title={ch.is_archived ? 'Unarchive' : 'Archive'}
          style={{ background: 'none', border: 'none', color: ch.is_archived ? T.ac : T.mt, cursor: 'pointer', padding: 4, fontSize: 13, opacity: hovered ? 1 : 0.5, transition: 'opacity .12s' }}
        >📦</button>
        <button
          onClick={async () => {
            if (await showConfirm('Delete Channel', `This will permanently delete #${ch.name} and all its messages. This action cannot be undone.`, true, ch.name, 'Delete Channel')) {
              await api.deleteChannel(ch.id);
              onRefresh();
            }
          }}
          style={{ background: 'none', border: 'none', color: T.err, cursor: 'pointer', padding: 4, fontSize: 13, opacity: hovered ? 1 : 0.5, transition: 'opacity .12s' }}
          title="Delete channel"
        ><I.Trash /></button>
      </>)}
    </div>
  );
}

// ─── MemberManagerRow ─────────────────────────────────────

const TIMEOUT_OPTS = [
  { label: '60s',  secs: 60 },
  { label: '5m',   secs: 300 },
  { label: '10m',  secs: 600 },
  { label: '1h',   secs: 3600 },
  { label: '1d',   secs: 86400 },
  { label: '1w',   secs: 604800 },
];

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface MemberManagerRowProps {
  member: Member;
  userRoles: Role[];
  allRoles: Role[];
  serverId: string;
  onRolesChange: (uid: string, newRoles: Role[]) => void;
  onKicked: (uid: string) => void;
  onBanned: (uid: string) => void;
  showConfirm: (title: string, msg: string, danger?: boolean) => Promise<boolean>;
}

function MemberManagerRow({ member: m, userRoles, allRoles, serverId, onRolesChange, onKicked, onBanned, showConfirm }: MemberManagerRowProps) {
  const [expanded, setExpanded]       = useState(false);
  const [editingNick, setEditingNick] = useState(false);
  const [nick, setNick]               = useState(m.nickname || m.display_name || '');
  const [nickError, setNickError]     = useState('');
  const [showTimeout, setShowTimeout] = useState(false);
  const [hovered, setHovered]         = useState(false);

  const assignableRoles = allRoles.filter(r => r.name !== '@everyone');

  const toggleRole = async (role: Role) => {
    const has = userRoles.some(ur => ((ur as any).id || (ur as any).role_id) === role.id);
    if (has) {
      await api.unassignRole(serverId, m.user_id, role.id);
      onRolesChange(m.user_id, userRoles.filter(r => ((r as any).id || (r as any).role_id) !== role.id));
    } else {
      await api.assignRole(serverId, m.user_id, role.id);
      onRolesChange(m.user_id, [...userRoles, role]);
    }
  };

  const saveNick = async () => {
    setNickError('');
    const trimmed = nick.trim();
    if (trimmed) {
      // Client-side profanity check (same banned list as AuthScreen)
      const BANNED = ['nigger','nigga','chink','spic','wetback','kike','gook','raghead','towelhead','beaner','coon','darkie','jigaboo','porchmonkey','zipperhead','faggot','fag','dyke','tranny','nazi','hitler','kkk','whitepower','heil','siegheil','1488','gasjews'];
      const norm = trimmed.toLowerCase().replace(/_/g,'').replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e').replace(/4/g,'a').replace(/5/g,'s').replace(/7/g,'t').replace(/@/g,'a').replace(/\$/g,'s');
      if (BANNED.some(w => norm.includes(w))) {
        setNickError('This name contains prohibited content');
        return;
      }
    }
    // nickname update via PATCH /servers/:sid/members/:uid
    try {
      const r = await (api as any).fetch(`/servers/${serverId}/members/${m.user_id}`, { method: 'PATCH', body: JSON.stringify({ nickname: trimmed || null }) });
      if (r && !r.ok) {
        const err = await r.json().catch(() => ({ error: 'Failed' }));
        setNickError(err?.error?.message || (typeof err?.error === 'string' ? err.error : null) || 'Save failed');
        return;
      }
    } catch { /* ignore */ }
    setEditingNick(false);
  };

  const doTimeout = async (secs: number) => {
    await api.timeoutMember(serverId, m.user_id, secs);
    // persist locally so Moderation tab can read it
    const store: Record<string, number> = JSON.parse(localStorage.getItem('d_timeouts') || '{}');
    store[m.user_id] = Date.now() + secs * 1000;
    localStorage.setItem('d_timeouts', JSON.stringify(store));
    setShowTimeout(false);
  };

  const doKick = async () => {
    if (!await showConfirm('Kick Member', `Kick @${m.username}? They can rejoin with an invite link.`, true)) return;
    await api.kickMember(serverId, m.user_id);
    onKicked(m.user_id);
  };

  const doBan = async () => {
    if (!await showConfirm('Ban Member', `Ban @${m.username}? They will not be able to rejoin.`, true)) return;
    await api.banUser(serverId, m.user_id, 'Banned by admin');
    onBanned(m.user_id);
  };

  const isTimedOut = (() => {
    try {
      const store: Record<string, number> = JSON.parse(localStorage.getItem('d_timeouts') || '{}');
      return (store[m.user_id] || 0) > Date.now();
    } catch { return false; }
  })();

  const topRole = userRoles.length > 0 ? (userRoles[0] as any) : null;
  const nameColor = topRole?.color || T.tx;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ borderRadius: 'var(--radius-md)', marginBottom: 4, border: `1px solid ${expanded || hovered ? T.bd : 'transparent'}`, background: expanded ? T.bg : hovered ? 'rgba(255,255,255,0.03)' : 'transparent', transition: 'background .12s, border-color .12s' }}
    >
      {/* summary row */}
      <div
        onClick={() => setExpanded(p => !p)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
      >
        {/* avatar + online dot */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Av name={m.display_name || m.username || '?'} size={34} url={null} />
          {m.online !== undefined && (
            <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, background: m.online ? '#3ba55d' : '#747f8d', border: '2px solid ' + T.bg }} />
          )}
        </div>

        {/* name block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: nameColor, whiteSpace: 'nowrap' }}>
              {m.display_name || m.username}
            </span>
            {m.display_name && m.display_name !== m.username && (
              <span style={{ fontSize: 11, color: T.mt }}>@{m.username}</span>
            )}
            {m.is_bot && (
              <span style={{ fontSize: 9, background: 'rgba(114,137,218,0.2)', color: '#7289da', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>BOT</span>
            )}
            {isTimedOut && (
              <span style={{ fontSize: 9, background: 'rgba(240,178,50,0.15)', color: '#f0b232', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>TIMEOUT</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            {userRoles.slice(0, 3).map(r => (
              <span key={(r as any).id || (r as any).role_id} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: `${(r as any).color || T.ac}22`, color: (r as any).color || T.ac, border: `1px solid ${(r as any).color || T.ac}44` }}>
                {(r as any).name}
              </span>
            ))}
            {userRoles.length > 3 && <span style={{ fontSize: 10, color: T.mt }}>+{userRoles.length - 3}</span>}
          </div>
        </div>

        {/* dates */}
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'none' }} className="member-dates">
          <div style={{ fontSize: 10, color: T.mt }}>Joined {fmtDate(m.joined_at)}</div>
          {m.last_active_at && <div style={{ fontSize: 10, color: T.mt }}>Active {fmtDate(m.last_active_at)}</div>}
        </div>

        {/* quick actions (hover) */}
        <div style={{ display: 'flex', gap: 2, opacity: hovered ? 1 : 0, transition: 'opacity .12s', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { setShowTimeout(p => !p); setExpanded(true); }} title="Timeout" style={{ background: 'none', border: 'none', color: '#f0b232', cursor: 'pointer', padding: '4px 6px', fontSize: 14, borderRadius: 5 }}>⏱</button>
          <button onClick={doKick} title="Kick" style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', padding: '4px 6px', fontSize: 13, borderRadius: 5 }}>👢</button>
          <button onClick={doBan} title="Ban" style={{ background: 'none', border: 'none', color: T.err, cursor: 'pointer', padding: '4px 6px', fontSize: 13, borderRadius: 5 }}>🔨</button>
        </div>

        <span style={{ color: T.mt, fontSize: 10, transition: 'transform .15s', transform: expanded ? 'rotate(0)' : 'rotate(-90deg)', flexShrink: 0 }}>▼</span>
      </div>

      {/* expanded detail */}
      {expanded && (
        <div style={{ padding: '0 12px 14px', borderTop: `1px solid ${T.bd}` }}>

          {/* dates row */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 12, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Joined</div>
              <div style={{ fontSize: 12, color: T.tx }}>{fmtDate(m.joined_at)}</div>
            </div>
            {m.last_active_at && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Last Active</div>
                <div style={{ fontSize: 12, color: T.tx }}>{fmtDate(m.last_active_at)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>User ID</div>
              <button onClick={() => navigator.clipboard?.writeText(m.user_id)} style={{ fontSize: 11, color: T.mt, background: 'none', border: `1px solid ${T.bd}`, borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>Copy ID</button>
            </div>
          </div>

          {/* nickname edit */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Nickname</div>
            {editingNick ? (<>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  autoFocus
                  value={nick}
                  onChange={e => setNick(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') { setEditingNick(false); setNick(m.nickname || m.display_name || ''); } }}
                  placeholder="Enter nickname (blank to clear)"
                  style={{ ...getInp(), flex: 1, padding: '5px 9px', fontSize: 12 }}
                />
                <button onClick={saveNick} style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save</button>
                <button onClick={() => { setEditingNick(false); setNick(m.nickname || m.display_name || ''); setNickError(''); }} style={{ ...btn(), padding: '5px 10px', fontSize: 12 }}>Cancel</button>
              </div>
              {nickError && <div style={{ fontSize: 11, color: T.err, marginTop: 4 }}>{nickError}</div>}
            </>) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: (m.nickname || m.display_name) ? T.tx : T.mt, fontStyle: (m.nickname || m.display_name) ? 'normal' : 'italic' }}>
                  {m.nickname || m.display_name || 'No nickname set'}
                </span>
                <button onClick={() => setEditingNick(true)} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 4, textDecoration: 'underline' }}>Edit</button>
              </div>
            )}
          </div>

          {/* timeout picker */}
          {showTimeout && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Timeout Duration</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TIMEOUT_OPTS.map(opt => (
                  <button
                    key={opt.secs}
                    onClick={() => doTimeout(opt.secs)}
                    style={{ background: 'rgba(240,178,50,0.12)', color: '#f0b232', border: '1px solid rgba(240,178,50,0.3)', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'background .1s' }}
                    onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = 'rgba(240,178,50,0.25)'; }}
                    onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'rgba(240,178,50,0.12)'; }}
                  >{opt.label}</button>
                ))}
                <button onClick={() => setShowTimeout(false)} style={{ background: 'none', border: `1px solid ${T.bd}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, color: T.mt, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}

          {/* roles */}
          {assignableRoles.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Roles</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {assignableRoles.map(role => {
                  const has = userRoles.some(ur => ((ur as any).id || (ur as any).role_id) === role.id);
                  return (
                    <button
                      key={role.id}
                      onClick={() => toggleRole(role)}
                      style={{ padding: '4px 11px', borderRadius: 'var(--border-radius)', fontSize: 11, cursor: 'pointer', fontWeight: has ? 700 : 400, background: has ? `${role.color || T.ac}22` : 'rgba(255,255,255,0.05)', color: has ? (role.color || T.ac) : T.mt, border: `1px solid ${has ? (role.color || T.ac) + '55' : T.bd}`, transition: 'all .15s' }}
                    >{has ? '✓ ' : '+ '}{role.name}</button>
                  );
                })}
              </div>
            </div>
          )}

          {/* moderation actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.bd}` }}>
            <button onClick={() => setShowTimeout(p => !p)} style={{ background: 'rgba(240,178,50,0.1)', color: '#f0b232', border: '1px solid rgba(240,178,50,0.25)', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              ⏱ {isTimedOut ? 'Update Timeout' : 'Timeout'}
            </button>
            <button onClick={doKick} style={{ background: 'rgba(255,255,255,0.05)', color: T.mt, border: `1px solid ${T.bd}`, borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              👢 Kick
            </button>
            <button onClick={doBan} style={{ background: 'rgba(237,66,69,0.1)', color: T.err, border: '1px solid rgba(237,66,69,0.25)', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              🔨 Ban
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RoleEditorCard ───────────────────────────────────────

/** Permissions surfaced in the visual role editor, grouped by category. */
const ROLE_EDITOR_PERMS = [
  // General
  { bit: 1 << 0,  label: 'View Channels',        group: 'General',        desc: 'See the channel list and read channels' },
  { bit: 1 << 1,  label: 'Send Messages',         group: 'General',        desc: 'Send messages in text channels' },
  { bit: 1 << 2,  label: 'Read History',          group: 'General',        desc: 'Read past messages in channels' },
  { bit: 1 << 3,  label: 'Attach Files',          group: 'General',        desc: 'Upload images and files' },
  { bit: 1 << 5,  label: 'Change Nickname',       group: 'General',        desc: 'Change own nickname' },
  { bit: 1 << 6,  label: 'Mention Everyone',      group: 'General',        desc: 'Use @everyone and @here mentions' },
  // Membership
  { bit: 1 << 4,  label: 'Create Invites',        group: 'Membership',     desc: 'Generate invite links' },
  { bit: 1 << 11, label: 'Kick Members',          group: 'Membership',     desc: 'Remove members from the server' },
  { bit: 1 << 12, label: 'Ban Members',           group: 'Membership',     desc: 'Permanently ban members' },
  { bit: 1 << 13, label: 'Manage Nicknames',      group: 'Membership',     desc: 'Change other members\' nicknames' },
  // Channels
  { bit: 1 << 20, label: 'Manage Channels',       group: 'Channels',       desc: 'Create, edit, and delete channels' },
  { bit: 1 << 14, label: 'Archive Channels',      group: 'Channels',       desc: 'Archive and unarchive channels' },
  { bit: 1 << 9,  label: 'Manage Pins',           group: 'Channels',       desc: 'Pin/unpin messages and set categories' },
  // Voice
  { bit: 1 << 30, label: 'Connect Voice',         group: 'Voice',          desc: 'Join voice channels' },
  { bit: 1 << 31, label: 'Speak',                 group: 'Voice',          desc: 'Speak in voice channels' },
  { bit: 1 << 32, label: 'Mute Members',          group: 'Voice',          desc: 'Server-mute other members' },
  { bit: 1 << 33, label: 'Move Members',          group: 'Voice',          desc: 'Move members between voice channels' },
  { bit: 1 << 34, label: 'Priority Speaker',      group: 'Voice',          desc: 'Lower others\' volume when speaking' },
  // Moderation
  { bit: 1 << 10, label: 'Manage Messages',       group: 'Moderation',     desc: 'Delete any message, manage pins' },
  { bit: 1 << 16, label: 'Manage AutoMod',        group: 'Moderation',     desc: 'Configure automod rules' },
  { bit: 1 << 15, label: 'View Audit Log',        group: 'Moderation',     desc: 'Access server audit log' },
  // Administration
  { bit: 1 << 22, label: 'Manage Server Settings', group: 'Administration', desc: 'Edit server name, icon, discovery' },
  { bit: 1 << 21, label: 'Manage Roles',           group: 'Administration', desc: 'Create, edit, delete, and assign roles' },
  { bit: 1 << 23, label: 'Manage Invites',         group: 'Administration', desc: 'View and revoke invite links' },
  { bit: 1 << 7,  label: 'Manage Webhooks',        group: 'Administration', desc: 'Create, edit, delete webhooks' },
  { bit: 1 << 8,  label: 'Manage Scheduled Msgs',  group: 'Administration', desc: 'View/cancel other users\' scheduled messages' },
  { bit: 1 << 17, label: 'Manage Bots',            group: 'Administration', desc: 'Configure and remove bots' },
  { bit: 1 << 24, label: 'Manage AI Agents',       group: 'Administration', desc: 'Configure AI agent providers' },
  { bit: 2 ** 40, label: 'Administrator',           group: 'Dangerous',      desc: 'Bypasses ALL permission checks' },
  { bit: 2 ** 41, label: 'Delete Server',           group: 'Dangerous',      desc: 'Can delete the server' },
  { bit: 2 ** 42, label: 'Transfer Ownership',      group: 'Dangerous',      desc: 'Can transfer server ownership (owner-granted only)' },
] as const;

const ROLE_PERM_GROUPS = ['General', 'Membership', 'Channels', 'Voice', 'Moderation', 'Administration', 'Dangerous'] as const;

interface ToggleSwitchProps { on: boolean; onChange: () => void; color?: string; }
function ToggleSwitch({ on, onChange, color }: ToggleSwitchProps) {
  return (
    <div
      onClick={onChange}
      style={{ position: 'relative', width: 34, height: 18, borderRadius: 9, background: on ? (color || T.ac) : T.bd, cursor: 'pointer', flexShrink: 0, transition: 'background .18s' }}
    >
      <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14, borderRadius: 7, background: '#fff', transition: 'left .18s', boxShadow: '0 1px 3px rgba(0,0,0,0.35)' }} />
    </div>
  );
}

/** Tri-state permission toggle: Allow (green) / Deny (red) / Inherit (grey dash). */
type PermState = 'allow' | 'deny' | 'inherit';
function PermToggle({ state, onChange, color }: { state: PermState; onChange: (next: PermState) => void; color?: string }) {
  const cycle = () => onChange(state === 'inherit' ? 'allow' : state === 'allow' ? 'deny' : 'inherit');
  const bg = state === 'allow' ? (color || '#2ecc71') : state === 'deny' ? '#ff4757' : T.bd;
  const icon = state === 'allow' ? '✓' : state === 'deny' ? '✕' : '—';
  const fg = state === 'inherit' ? T.mt : '#fff';
  return (
    <div onClick={cycle} title={`${state === 'allow' ? 'Allowed' : state === 'deny' ? 'Denied' : 'Inherited'} — click to cycle`}
      style={{ width: 24, height: 24, borderRadius: 6, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: fg, flexShrink: 0, transition: 'background .15s', border: `1px solid ${state === 'inherit' ? T.bd : 'transparent'}` }}>
      {icon}
    </div>
  );
}

interface RoleEditorCardProps {
  r: Role;
  index: number;
  total: number;
  memberCount: number;
  onDelete: () => void;
  onUpdate: (data: Partial<Role>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

function RoleEditorCard({ r, index, total, memberCount, onDelete, onUpdate, onMove }: RoleEditorCardProps) {
  const [name, setName]       = useState(r.name);
  const [color, setColor]     = useState(r.color || '#5a6080');
  const [hexInput, setHexInput] = useState(r.color || '#5a6080');
  const [perms, setPerms]     = useState(r.permissions || 0);
  const [dirty, setDirty]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [editingName, setEditingName] = useState(false);
  const isEveryone = r.name === '@everyone';
  const colorRef = React.useRef<HTMLInputElement>(null);

  const markDirty = () => setDirty(true);

  const handleColorChange = (hex: string) => {
    setColor(hex);
    setHexInput(hex);
    markDirty();
  };

  const handleHexInput = (val: string) => {
    setHexInput(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setColor(val);
      markDirty();
    }
  };

  const handlePermToggle = (bit: number) => {
    setPerms(p => permToggle(p, bit));
    markDirty();
  };

  const save = async () => {
    setSaving(true);
    const data: Partial<Role> & { permissions?: number } = { permissions: perms };
    if (name.trim() && name !== r.name) data.name = name.trim();
    if (color !== r.color) data.color = color;
    await api.updateRole(r.id, data);
    onUpdate(data);
    setDirty(false);
    setSaving(false);
  };

  const saveNameInline = () => {
    if (name.trim() && name !== r.name) {
      api.updateRole(r.id, { name: name.trim() });
      onUpdate({ name: name.trim() });
    }
    setEditingName(false);
  };

  return (
    <div style={{ marginBottom: 10, borderRadius: 10, border: `1px solid ${dirty ? color + '88' : T.bd}`, background: T.bg, overflow: 'hidden', borderInlineStart: `4px solid ${color}`, transition: 'border-color .2s' }}>
      {/* ── header row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        {/* position controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
          <button onClick={() => onMove(r.id, -1)} disabled={index === 0 || isEveryone}
            style={{ background: 'none', border: 'none', color: (index === 0 || isEveryone) ? T.bd : T.mt, cursor: (index === 0 || isEveryone) ? 'default' : 'pointer', padding: '0 2px', fontSize: 9, lineHeight: 1 }}>▲</button>
          <button onClick={() => onMove(r.id, 1)} disabled={index === total - 1}
            style={{ background: 'none', border: 'none', color: index === total - 1 ? T.bd : T.mt, cursor: index === total - 1 ? 'default' : 'pointer', padding: '0 2px', fontSize: 9, lineHeight: 1 }}>▼</button>
        </div>

        {/* color swatch → opens native picker */}
        <div
          onClick={() => colorRef.current?.click()}
          style={{ width: 20, height: 20, borderRadius: 10, background: color, border: `2px solid ${T.bd}`, cursor: 'pointer', flexShrink: 0, transition: 'box-shadow .15s', boxShadow: '0 0 0 0 ' + color }}
          onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 0 3px ${color}44`)}
          onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 0 0 ' + color)}
          title="Click to change color"
        />
        <input ref={colorRef} type="color" value={color} onChange={e => handleColorChange(e.target.value)}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />

        {/* position badge */}
        <span style={{ fontSize: 10, color: T.mt, fontFamily: 'var(--font-mono)', background: T.sf2, padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>#{index + 1}</span>

        {/* name */}
        {editingName && !isEveryone ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={saveNameInline}
            onKeyDown={e => { if (e.key === 'Enter') saveNameInline(); if (e.key === 'Escape') { setName(r.name); setEditingName(false); } }}
            style={{ ...getInp(), flex: 1, padding: '3px 7px', fontSize: 14, fontWeight: 600 }}
          />
        ) : (
          <span
            onDoubleClick={() => !isEveryone && setEditingName(true)}
            title={isEveryone ? undefined : 'Double-click to rename'}
            style={{ flex: 1, fontSize: 14, fontWeight: 700, color: color, cursor: isEveryone ? 'default' : 'text', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >{name}</span>
        )}

        {/* hex color input */}
        <input
          value={hexInput}
          onChange={e => handleHexInput(e.target.value)}
          maxLength={7}
          style={{ ...getInp(), width: 78, padding: '3px 7px', fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}
          title="Hex color"
        />

        {/* member count */}
        <span style={{ fontSize: 11, color: T.mt, flexShrink: 0 }}>{memberCount} member{memberCount !== 1 ? 's' : ''}</span>

        {/* delete */}
        {!isEveryone && (
          <button onClick={onDelete} style={{ background: 'none', border: 'none', color: T.err, cursor: 'pointer', padding: '3px 6px', fontSize: 13, borderRadius: 5 }} title="Delete role"><I.Trash /></button>
        )}
      </div>

      {/* ── permissions grid ── */}
      <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${T.bd}` }}>
        {ROLE_PERM_GROUPS.map(group => {
          const groupPerms = ROLE_EDITOR_PERMS.filter(p => p.group === group);
          if (groupPerms.length === 0) return null;
          const isDangerous = group === 'Dangerous';
          return (
            <div key={group} style={{ marginTop: 12, ...(isDangerous ? { padding: '8px 10px', background: 'rgba(255,71,87,0.04)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.12)' } : {}) }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: isDangerous ? T.err : T.mt, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>{group}</div>
              {groupPerms.map(perm => {
                const on = permHas(perms, perm.bit);
                return (
                  <div key={perm.bit} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${ta(T.bd, '30')}` }}>
                    <PermToggle
                      state={on ? 'allow' : 'inherit'}
                      onChange={(next) => {
                        if (next === 'allow') setPerms(prev => permSet(prev, perm.bit));
                        else setPerms(prev => permClear(prev, perm.bit));
                        markDirty();
                      }}
                      color={isDangerous ? '#ff4757' : color}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: on ? T.tx : T.mt, fontWeight: on ? 600 : 400, transition: 'color .15s' }}>{perm.label}</div>
                      <div style={{ fontSize: 10, color: T.mt, lineHeight: 1.3, marginTop: 1 }}>{perm.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* save / status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.bd}` }}>
          <span style={{ flex: 1, fontSize: 11, color: dirty ? '#f0b232' : T.mt }}>
            {dirty ? '● Unsaved changes' : `${ROLE_EDITOR_PERMS.filter(rp => permHas(perms, rp.bit)).length} / ${ROLE_EDITOR_PERMS.length} permissions enabled`}
          </span>
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{ background: dirty ? color : T.sf2, color: dirty ? '#fff' : T.mt, border: `1px solid ${dirty ? color : T.bd}`, borderRadius: 7, padding: '6px 16px', fontSize: 12, fontWeight: 700, cursor: dirty ? 'pointer' : 'not-allowed', opacity: saving ? 0.6 : 1, transition: 'all .18s' }}
          >{saving ? 'Saving…' : 'Save Role'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── EmojiManager (tab sub-panel) ────────────────────────

interface EmojiManagerProps {
  serverId: string;
  showConfirm: (title: string, message: string, danger?: boolean, confirmPhrase?: string, confirmLabel?: string) => Promise<boolean>;
}

function EmojiManager({ serverId, showConfirm }: EmojiManagerProps) {
  const [emojis, setEmojis] = useState<EmojiEntry[]>([]);
  const [newName, setNewName] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => { api.listEmojis(serverId).then(e => setEmojis(Array.isArray(e) ? e : [])); }, [serverId]);

  const handleUpload = () => {
    if (!newName.trim()) return;
    const f = document.createElement('input');
    f.type = 'file';
    f.accept = 'image/png,image/gif,image/webp';
    f.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 256 * 1024) { alert('Emoji must be under 256KB'); return; }
      setUploading(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await api.uploadEmoji(serverId, newName.trim(), reader.result as string, file.name.endsWith('.gif'));
          if (result?.id) { setEmojis(p => [...p, result]); setNewName(''); }
        } catch { /* emoji upload failed silently */ }
        setUploading(false);
      };
      reader.readAsDataURL(file);
    };
    f.click();
  };

  const handleDelete = async (eid: string, ename: string) => {
    if (await showConfirm('Delete Emoji', `Delete :${ename}:? This cannot be undone.`, true)) {
      await api.deleteEmoji(serverId, eid);
      setEmojis(p => p.filter(e => e.id !== eid));
    }
  };

  return (<>
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Custom Emoji — {emojis.length}/50</div>
    <div style={{ fontSize: 12, color: T.mt, marginBottom: 12, lineHeight: 1.5 }}>Upload custom emoji for your server. Members can use them in messages with :name: syntax. Max 50 emoji, 256KB each. PNG, GIF, or WebP.</div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <input value={newName} onChange={e => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="emoji_name" style={{ ...getInp(), flex: 1 }} />
      <button onClick={handleUpload} disabled={uploading || !newName.trim()} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '8px 18px' }}>{uploading ? '...' : 'Upload'}</button>
    </div>
    {emojis.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: T.mt }}>No custom emoji yet. Upload one to get started!</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
      {emojis.map(e => (
        <div key={e.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 8, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, position: 'relative' }}>
          <img src={e.image_url} style={{ width: 32, height: 32, objectFit: 'contain' }} alt={e.name} />
          <span style={{ fontSize: 10, color: T.mt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>:{e.name}:</span>
          <div onClick={() => handleDelete(e.id, e.name)} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 'var(--radius-md)', background: 'rgba(255,71,87,0.15)', color: T.err, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 10 }}>×</div>
        </div>
      ))}
    </div>
  </>);
}

// ─── EventsManager (tab sub-panel) ───────────────────────

interface EventsManagerProps {
  serverId: string;
  showConfirm: (title: string, message: string, danger?: boolean, confirmPhrase?: string, confirmLabel?: string) => Promise<boolean>;
}

function EventsManager({ serverId, showConfirm }: EventsManagerProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');

  useEffect(() => { api.listEvents(serverId).then(e => setEvents(Array.isArray(e) ? e : [])); }, [serverId]);

  const handleCreate = async () => {
    if (!title.trim() || !startTime) return;
    const result = await api.createEvent(serverId, {
      title: title.trim(),
      description: desc || undefined,
      location: location || undefined,
      start_time: new Date(startTime).toISOString(),
      end_time: endTime ? new Date(endTime).toISOString() : undefined,
    });
    if (result?.id) {
      setCreating(false); setTitle(''); setDesc(''); setStartTime(''); setEndTime(''); setLocation('');
      api.listEvents(serverId).then(e => setEvents(Array.isArray(e) ? e : []));
    }
  };

  const handleRsvp = async (eid: string, status: string) => {
    await api.rsvpEvent(eid, status);
    api.listEvents(serverId).then(e => setEvents(Array.isArray(e) ? e : []));
  };

  const handleDelete = async (eid: string, ename: string) => {
    if (await showConfirm('Delete Event', `Delete "${ename}"? This cannot be undone.`, true)) {
      await api.deleteEvent(eid);
      setEvents(p => p.filter(e => e.id !== eid));
    }
  };

  const upcoming = events.filter(e => new Date(e.start_time) >= new Date());
  const past = events.filter(e => new Date(e.start_time) < new Date());

  return (<>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Events — {events.length}</div>
      <button onClick={() => setCreating(true)} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '5px 12px', fontSize: 11 }}><I.Plus /> New Event</button>
    </div>
    {creating && (
      <div style={{ padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 12 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" style={{ ...getInp(), marginBottom: 6, fontWeight: 600 }} autoFocus />
        <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" rows={2} style={{ ...getInp(), marginBottom: 6, resize: 'vertical' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
          <div><label style={{ fontSize: 10, color: T.mt }}>Start</label><input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} style={{ ...getInp(), fontSize: 12 }} /></div>
          <div><label style={{ fontSize: 10, color: T.mt }}>End (optional)</label><input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} style={{ ...getInp(), fontSize: 12 }} /></div>
        </div>
        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location (optional)" style={{ ...getInp(), marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleCreate} disabled={!title.trim() || !startTime} style={{ ...btn(!!title.trim() && !!startTime), fontSize: 12 }}>Create Event</button>
          <button onClick={() => setCreating(false)} className="pill-btn" style={{ background: T.sf, color: T.mt, border: `1px solid ${T.bd}`, padding: '6px 12px', fontSize: 12 }}>Cancel</button>
        </div>
      </div>
    )}
    {upcoming.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: T.ac, textTransform: 'uppercase', marginBottom: 6 }}>Upcoming</div>}
    {upcoming.map(evt => (
      <div key={evt.id} style={{ padding: 10, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>{evt.title}</div>
          <div onClick={() => handleDelete(evt.id, evt.title)} style={{ cursor: 'pointer', color: T.mt, fontSize: 10, padding: 2 }}>×</div>
        </div>
        {evt.description && <div style={{ fontSize: 12, color: T.mt, marginTop: 4 }}>{evt.description}</div>}
        <div style={{ fontSize: 11, color: T.ac, marginTop: 4 }}>📅 {new Date(evt.start_time).toLocaleString()}{evt.end_time ? ' — ' + new Date(evt.end_time).toLocaleTimeString() : ''}</div>
        {evt.location && <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>📍 {evt.location}</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {(['going', 'interested', 'not_going'] as const).map(st => (
            <button key={st} onClick={() => handleRsvp(evt.id, st)} className="pill-btn" style={{ background: T.sf, color: T.mt, border: `1px solid ${T.bd}`, padding: '4px 10px', fontSize: 10, textTransform: 'capitalize' }}>
              {st === 'going' ? '✅ Going' : st === 'interested' ? '⭐ Interested' : '❌ Not Going'}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>{evt.going_count} going · {evt.interested_count} interested · by {evt.creator_username}</div>
      </div>
    ))}
    {past.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginTop: 8, marginBottom: 6 }}>Past</div>}
    {past.map(evt => (
      <div key={evt.id} style={{ padding: 8, background: T.bg, borderRadius: 6, marginBottom: 4, opacity: 0.6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{evt.title}</div>
        <div style={{ fontSize: 10, color: T.mt }}>{new Date(evt.start_time).toLocaleString()} · {evt.going_count} went</div>
      </div>
    ))}
    {events.length === 0 && !creating && <div style={{ textAlign: 'center', padding: 20, color: T.mt }}>No events yet. Create one to get started!</div>}
  </>);
}

// ─── ModerationPanel (tab sub-panel) ─────────────────────

interface ModerationPanelProps {
  serverId: string;
  getName: (userId: string) => string;
  decrypt: (ciphertext: string, channelId: string, epoch: number) => Promise<string>;
}

interface AutoModConfig {
  enabled: boolean;
  bad_words: string[];
  spam_threshold_per_minute: number;
  block_invites: boolean;
  block_links: boolean;
  max_mentions: number;
  max_caps_percent: number;
}

const DEFAULT_AUTOMOD: AutoModConfig = {
  enabled: false,
  bad_words: [],
  spam_threshold_per_minute: 5,
  block_invites: false,
  block_links: false,
  max_mentions: 10,
  max_caps_percent: 0.8,
};

function ModerationPanel({ serverId, getName, decrypt }: ModerationPanelProps) {
  const [modTab, setModTab] = useState('search');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchChannel, setSearchChannel] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [deleted, setDeleted] = useState<number | null>(null);
  const [modChannels, setModChannels] = useState<Channel[]>([]);
  const [automod, setAutomod] = useState<AutoModConfig>(DEFAULT_AUTOMOD);
  const [automodSaved, setAutomodSaved] = useState('');
  const [automodLoaded, setAutomodLoaded] = useState(false);

  useEffect(() => {
    api.listChannels(serverId).then(c => setModChannels(Array.isArray(c) ? c.filter((ch: Channel) => ch.channel_type === 'text') : []));
    api.getAutomod(serverId).then(c => { if (c) { setAutomod({ ...DEFAULT_AUTOMOD, ...c }); } setAutomodLoaded(true); });
  }, [serverId]);

  const doSearch = async () => {
    if (!searchTerm.trim() || !searchChannel) return;
    setSearching(true); setDeleted(null);
    try {
      const data = await api.getMessagesBatch(searchChannel, 500);
      const arr = Array.isArray(data) ? data : (data?.messages || []);
      const found: SearchMessage[] = [];
      for (const m of arr) {
        try {
          const text = await decrypt(m.content_ciphertext, searchChannel, m.mls_epoch);
          if (text && text.toLowerCase().includes(searchTerm.toLowerCase())) {
            found.push({ id: m.id, text, author_id: m.author_id, created_at: m.created_at });
          }
        } catch { /* skip undecryptable */ }
      }
      setSearchResults(found);
    } catch { /* ignore */ }
    setSearching(false);
  };

  const doBulkDelete = async () => {
    if (!searchResults.length || !searchChannel) return;
    try {
      const result = await api.bulkDeleteMessages(searchChannel, searchResults.map(m => m.id), `Mod search: "${searchTerm}"`);
      setDeleted(result.deleted || searchResults.length);
      setSearchResults([]);
    } catch { /* ignore */ }
  };

  const modTabs = [
    { id: 'search',      label: 'Search & Delete',   icon: <I.Search /> },
    { id: 'automod',     label: 'Auto-Moderation',    icon: <I.Shield /> },
    { id: 'permissions', label: 'Channel Mods',        icon: <I.Users /> },
    { id: 'timeout',     label: 'Timeouts',            icon: <I.Clock /> },
  ];

  return (<>
    <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
      {modTabs.map(t => (
        <div key={t.id} onClick={() => setModTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: modTab === t.id ? T.ac : T.mt, background: modTab === t.id ? 'rgba(0,212,170,0.1)' : 'transparent', border: `1px solid ${modTab === t.id ? ta(T.ac,'44') : T.bd}` }}>
          {t.icon} {t.label}
        </div>
      ))}
    </div>

    {modTab === 'search' && (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Search Messages & Bulk Delete</div>
      <div style={{ fontSize: 12, color: T.mt, marginBottom: 12, lineHeight: 1.5 }}>Search decrypted messages in a channel for a word or phrase. Zero-knowledge: the search runs on your device. The server never sees the search term.</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <select value={searchChannel} onChange={e => setSearchChannel(e.target.value)} style={{ ...getInp(), flex: 1 }}>
          <option value="">Select channel...</option>
          {modChannels.map(ch => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doSearch(); }} placeholder="Enter word or phrase..." style={{ ...getInp(), flex: 1 }} />
        <button onClick={doSearch} disabled={searching || !searchTerm.trim() || !searchChannel} style={{ ...btn(!!searchTerm.trim() && !!searchChannel), width: 90 }}>{searching ? '...' : 'Search'}</button>
      </div>
      {deleted !== null && (
        <div style={{ padding: 16, textAlign: 'center', color: T.ac, background: T.sf2, borderRadius: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 20, marginBottom: 6 }}>✓</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{deleted} message{deleted !== 1 ? 's' : ''} deleted</div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 4 }}>Recorded in the audit log as BULK_DELETE_MESSAGES.</div>
        </div>
      )}
      {searchResults.length > 0 && (<>
        <div style={{ fontSize: 12, color: T.warn, fontWeight: 600, marginBottom: 8 }}>Found {searchResults.length} message{searchResults.length !== 1 ? 's' : ''} containing "{searchTerm}"</div>
        <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          {searchResults.map(m => (
            <div key={m.id} style={{ padding: '6px 10px', borderBottom: `1px solid ${T.bd}`, fontSize: 12 }}>
              <span style={{ color: T.ac, fontWeight: 600 }}>{getName(m.author_id)}</span>
              <span style={{ color: T.mt, marginInlineStart: 6, fontSize: 10 }}>{new Date(m.created_at).toLocaleString()}</span>
              <div style={{ color: T.tx, marginTop: 2, wordBreak: 'break-word' }}>{m.text?.length > 120 ? m.text.slice(0, 120) + '...' : m.text}</div>
            </div>
          ))}
        </div>
        <button onClick={doBulkDelete} style={{ ...btn(true), background: `linear-gradient(135deg,${T.err},#ff6b6b)`, color: '#fff' }}>Delete All {searchResults.length} Messages</button>
      </>)}
      {searching && <div style={{ textAlign: 'center', padding: 16, color: T.mt }}>Searching decrypted messages...</div>}
      {!searching && searchTerm && searchResults.length === 0 && deleted === null && <div style={{ textAlign: 'center', padding: 16, color: T.mt }}>No matches found.</div>}
    </>)}

    {modTab === 'automod' && (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Auto-Moderation Rules</div>
      <div style={{ fontSize: 12, color: T.mt, marginBottom: 16, lineHeight: 1.5 }}>Server-side AutoMod rules. Messages matching these rules are blocked or flagged before delivery.</div>

      {!automodLoaded ? <div style={{ color: T.mt, fontSize: 13, padding: 16, textAlign: 'center' }}>Loading...</div> : (<>
        {/* Master toggle */}
        {[
          { key: 'enabled',       label: 'Enable AutoMod',       desc: 'Activate server-side automatic moderation',               value: automod.enabled,       toggle: () => setAutomod(a => ({ ...a, enabled: !a.enabled })) },
          { key: 'block_invites', label: 'Block External Invite Links',   desc: 'Block invite links from other platforms and other Discreet instances', value: automod.block_invites, toggle: () => setAutomod(a => ({ ...a, block_invites: !a.block_invites })) },
          { key: 'block_links',   label: 'Block External Links', desc: 'Block all http:// and https:// URLs',                      value: automod.block_links,   toggle: () => setAutomod(a => ({ ...a, block_links: !a.block_links })) },
        ].map(rule => (
          <div key={rule.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{rule.label}</div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>{rule.desc}</div>
            </div>
            <div onClick={rule.toggle} style={{ width: 40, height: 22, borderRadius: 11, background: rule.value ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: '#fff', position: 'absolute', top: 2, left: rule.value ? 20 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
            </div>
          </div>
        ))}

        {/* Thresholds */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, marginBottom: 4 }}>Spam threshold (msg/min)</div>
            <input type="number" min={1} max={60} value={automod.spam_threshold_per_minute} onChange={e => setAutomod(a => ({ ...a, spam_threshold_per_minute: parseInt(e.target.value) || 5 }))} style={{ ...getInp(), width: '100%' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, marginBottom: 4 }}>Max mentions per message</div>
            <input type="number" min={1} max={100} value={automod.max_mentions} onChange={e => setAutomod(a => ({ ...a, max_mentions: parseInt(e.target.value) || 10 }))} style={{ ...getInp(), width: '100%' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, marginBottom: 4 }}>Max caps % (0–100)</div>
            <input type="number" min={0} max={100} value={Math.round(automod.max_caps_percent * 100)} onChange={e => setAutomod(a => ({ ...a, max_caps_percent: Math.min(1, Math.max(0, (parseInt(e.target.value) || 80) / 100)) }))} style={{ ...getInp(), width: '100%' }} />
          </div>
        </div>

        {/* Bad words */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, marginBottom: 4 }}>Blocked words (one per line)</div>
          <textarea
            value={automod.bad_words.join('\n')}
            onChange={e => setAutomod(a => ({ ...a, bad_words: e.target.value.split('\n').map(w => w.trim()).filter(Boolean) }))}
            placeholder="badword1&#10;badword2&#10;..."
            rows={5}
            style={{ ...getInp(), width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
        </div>

        {/* Save */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={async () => {
            try {
              await api.updateAutomod(serverId, automod);
              setAutomodSaved('Saved!');
              setTimeout(() => setAutomodSaved(''), 2000);
            } catch { setAutomodSaved('Error saving'); setTimeout(() => setAutomodSaved(''), 2000); }
          }} style={{ ...btn(true), padding: '8px 18px' }}>Save AutoMod Config</button>
          {automodSaved && <span style={{ fontSize: 12, color: T.ac, fontWeight: 600 }}>{automodSaved}</span>}
        </div>
      </>)}
    </>)}

    {modTab === 'permissions' && (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Channel Moderators</div>
      <div style={{ fontSize: 12, color: T.mt, marginBottom: 16, lineHeight: 1.5 }}>Assign moderator roles to specific channels. Channel mods can delete messages, manage pins, and timeout users within their assigned channels — even if they don't have server-wide permissions.</div>
      <div style={{ fontSize: 12, color: T.mt, marginBottom: 12, fontStyle: 'italic' }}>Tip: Create a "Channel Mod" role in the Roles tab with MANAGE_MESSAGES permission, then assign it to users. Use per-channel overrides for fine-grained control.</div>
      {modChannels.map(ch => (
        <div key={ch.id} style={{ padding: '10px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <I.Hash s={14} />
            <span style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{ch.name}</span>
            <span style={{ fontSize: 11, color: T.mt, marginInlineStart: 'auto' }}>
              {ch.locked ? '🔒 Locked' : (ch.min_role_position ?? 0) > 0 ? '🔐 Restricted' : '🌐 Public'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: T.mt }}>
            {disappearingEnabled ? (<>
            <span>Disappearing:</span>
            <select value={ch.ttl_seconds ?? ''} onChange={async e => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              await api.fetch(`/channels/${ch.id}/ttl`, { method: 'PUT', body: JSON.stringify({ ttl_seconds: v }) });
              onUpdate?.();
            }} style={{ fontSize: 11, padding: '2px 6px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, cursor: 'pointer' }}>
              <option value="">Off</option>
              <option value="3600">1 Hour</option>
              <option value="86400">24 Hours</option>
              <option value="604800">7 Days</option>
              <option value="2592000">30 Days</option>
            </select>
            </>) : null}
            {(ch.slowmode_seconds ?? 0) > 0 && <span>· Slowmode: {ch.slowmode_seconds}s</span>}
            {ch.nsfw && <span>· NSFW</span>}
            <span style={{ marginInlineStart: 'auto' }}><ExportChannelButton channelId={ch.id} channelName={ch.name} /></span>
          </div>
        </div>
      ))}
    </>)}

    {modTab === 'timeout' && (<>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Active Timeouts</div>
      <div style={{ fontSize: 12, color: T.mt, marginBottom: 12, lineHeight: 1.5 }}>Manage users currently timed out. Timed-out users can read messages but cannot send, react, or join voice channels.</div>
      {(() => {
        try {
          const tos: Record<string, number> = JSON.parse(localStorage.getItem('d_timeouts') || '{}');
          const active = Object.entries(tos).filter(([, exp]) => exp > Date.now());
          if (active.length === 0) return <div style={{ textAlign: 'center', padding: 20, color: T.mt }}>No active timeouts.</div>;
          return active.map(([uid, exp]) => (
            <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 6 }}>
              <Av name={getName(uid) || '?'} size={28} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{getName(uid) || 'Unknown User'}</div>
                <div style={{ fontSize: 11, color: T.warn }}>Expires {new Date(exp).toLocaleTimeString()}</div>
              </div>
              <button onClick={() => {
                const t: Record<string, number> = JSON.parse(localStorage.getItem('d_timeouts') || '{}');
                delete t[uid];
                localStorage.setItem('d_timeouts', JSON.stringify(t));
                setModTab('timeout');
              }} className="pill-btn" style={{ background: T.sf, color: T.ac, border: `1px solid ${T.bd}`, fontSize: 11 }}>Remove</button>
            </div>
          ));
        } catch { return <div style={{ color: T.mt }}>No active timeouts.</div>; }
      })()}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Timeout Durations</div>
        <div style={{ fontSize: 12, color: T.mt, marginBottom: 8 }}>Right-click a member → Timeout to apply. Available durations:</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['60s', '5m', '10m', '1h', '6h', '24h', '7d'].map(d => (
            <span key={d} style={{ padding: '4px 10px', background: T.sf2, borderRadius: 6, fontSize: 11, fontWeight: 600, color: T.mt }}>{d}</span>
          ))}
        </div>
      </div>
    </>)}
  </>);
}

// ─── ServerDangerZone ─────────────────────────────────────

function ServerDangerZone({ server, onUpdate }: { server: Server; onUpdate?: () => void }) {
  const [archiveModal, setArchiveModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);

  return (
    <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,71,87,0.04)', borderRadius: 10, border: '1px solid rgba(255,71,87,0.15)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.err, textTransform: 'uppercase', marginBottom: 14 }}>Danger Zone</div>

      {/* Archive / Unarchive */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.mt, marginBottom: 8, lineHeight: 1.6 }}>
          {server.is_archived
            ? <>This server is <strong style={{ color: T.err }}>archived</strong> and read-only. Members can view history but cannot send messages or create channels. Unarchiving restores full functionality.</>
            : <>Archive this server to make it <strong style={{ color: T.err }}>read-only</strong>. Members can still view message history. No messages or data are deleted. Zero compute cost while archived.</>
          }
        </div>
        <button
          onClick={() => setArchiveModal(true)}
          className="pill-btn"
          style={{ background: server.is_archived ? 'rgba(0,212,170,0.12)' : 'rgba(255,71,87,0.12)', color: server.is_archived ? T.ac : T.err, border: `1px solid ${server.is_archived ? 'rgba(0,212,170,0.3)' : 'rgba(255,71,87,0.3)'}`, padding: '10px 22px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          {server.is_archived ? 'Unarchive Server' : 'Archive Server'}
        </button>
      </div>

      {server.is_archived && (
        <>
          <div style={{ height: 1, background: 'rgba(255,71,87,0.1)', margin: '12px 0' }} />

          {/* Schedule / Cancel Deletion */}
          <div>
            <div style={{ fontSize: 12, color: T.mt, marginBottom: 8, lineHeight: 1.6 }}>
              {server.scheduled_deletion_at
                ? <>Server is scheduled for <strong style={{ color: T.err }}>permanent deletion</strong> on {new Date(server.scheduled_deletion_at).toLocaleDateString()}. All messages, channels, roles, and members will be removed. Only the audit tombstone is kept.</>
                : <>Schedule this server for permanent deletion with a <strong style={{ color: T.err }}>30-day countdown</strong>. You can cancel anytime before the deadline.</>
              }
            </div>
            {server.scheduled_deletion_at ? (
              <button
                onClick={async () => {
                  await api.fetch(`/servers/${server.id}/schedule-deletion`, { method: 'POST', body: JSON.stringify({ schedule: false }) });
                  onUpdate?.();
                }}
                className="pill-btn"
                style={{ background: 'rgba(0,212,170,0.12)', color: T.ac, border: '1px solid rgba(0,212,170,0.3)', padding: '10px 22px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Cancel Scheduled Deletion
              </button>
            ) : (
              <button
                onClick={() => setDeleteModal(true)}
                className="pill-btn"
                style={{ background: 'rgba(255,71,87,0.2)', color: T.err, border: '1px solid rgba(255,71,87,0.4)', padding: '10px 22px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Schedule Deletion (30 days)
              </button>
            )}
          </div>
        </>
      )}

      {/* Archive confirm modal */}
      {archiveModal && (
        <DangerConfirmModal
          title={server.is_archived ? 'Unarchive Server' : 'Archive Server'}
          warningText={server.is_archived
            ? `Unarchiving "${server.name}" will restore full functionality. Members will be able to send messages and create channels again.`
            : `Archiving "${server.name}" will make it read-only. Members can view history but cannot send messages or create channels. No data is deleted.`
          }
          confirmPhrase={server.name}
          confirmLabel={server.is_archived ? 'Unarchive Server' : 'Archive Server'}
          onConfirm={async () => {
            await api.fetch(`/servers/${server.id}/archive`, { method: 'POST', body: JSON.stringify({ archive: !server.is_archived }) });
            setArchiveModal(false);
            onUpdate?.();
          }}
          onCancel={() => setArchiveModal(false)}
        />
      )}

      {/* Schedule deletion confirm modal */}
      {deleteModal && (
        <DangerConfirmModal
          title="Schedule Server Deletion"
          warningText={`This will schedule "${server.name}" for permanent deletion in 30 days. All messages, channels, roles, and members will be removed. Only the audit tombstone is kept. You can cancel anytime before the deadline.`}
          confirmPhrase={server.name}
          confirmLabel="Schedule Deletion"
          onConfirm={async () => {
            await api.fetch(`/servers/${server.id}/schedule-deletion`, { method: 'POST', body: JSON.stringify({ schedule: true }) });
            setDeleteModal(false);
            onUpdate?.();
          }}
          onCancel={() => setDeleteModal(false)}
        />
      )}
    </div>
  );
}

// ─── Export Channel Button ────────────────────────────────

function ExportChannelButton({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'loading'>('idle');
  const [error, setError] = useState('');

  if (state === 'confirm') {
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <button onClick={async () => {
          setState('loading'); setError('');
          try {
            const headers: Record<string, string> = {};
            if ((api as any).token) headers['Authorization'] = `Bearer ${(api as any).token}`;
            const r = await fetch(`${api.baseUrl}/channels/${channelId}/export`, { headers, credentials: 'same-origin' });
            if (!r.ok) throw new Error(`Export failed (${r.status})`);
            const blob = await r.blob();
            const date = new Date().toISOString().slice(0, 10);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `discreet-channel-${channelName}-${date}.zip`;
            a.click();
            URL.revokeObjectURL(a.href);
          } catch (e: any) { setError(e?.message || 'Failed'); }
          setState('idle');
        }} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: 'none', background: T.ac, color: '#000', fontWeight: 700, cursor: 'pointer' }}>
          {state === 'loading' ? '...' : 'Confirm'}
        </button>
        <button onClick={() => setState('idle')} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: `1px solid ${T.bd}`, background: 'none', color: T.mt, cursor: 'pointer' }}>Cancel</button>
        {error && <span style={{ fontSize: 10, color: T.err }}>{error}</span>}
      </div>
    );
  }

  return (
    <button onClick={() => setState('confirm')} title="Export channel messages as ZIP"
      style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${T.bd}`, background: 'none', color: T.mt, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <I.Download /> Export
    </button>
  );
}

// ─── ServerSettingsModal ──────────────────────────────────

export interface ServerSettingsModalProps {
  server: Server;
  onClose: () => void;
  onUpdate?: () => void;
  showConfirm: (title: string, message: string, danger?: boolean, confirmPhrase?: string, confirmLabel?: string) => Promise<boolean>;
  getName: (userId: string) => string;
  decrypt: (ciphertext: string, channelId: string, epoch: number) => Promise<string>;
  onCreateInvite?: () => void;
  disappearingEnabled?: boolean;
}

export function ServerSettingsModal({ server, onClose, onUpdate, showConfirm, getName, decrypt, onCreateInvite, disappearingEnabled = true }: ServerSettingsModalProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newChName, setNewChName] = useState('');
  const [newChType, setNewChType] = useState('text');
  const [newChCat, setNewChCat] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [showCreateCh, setShowCreateCh] = useState(false);
  const [showCreateCat, setShowCreateCat] = useState(false);
  const [tab, setTab] = useState('overview');
  const [name, setName] = useState(server?.name || '');
  const [memberTabLabel, setMemberTabLabel] = useState(server?.member_tab_label || 'Users');
  const [slashCmdsEnabled, setSlashCmdsEnabled] = useState(server?.slash_commands_enabled !== false);
  const [retentionDays, setRetentionDays] = useState<number | null>(server?.message_retention_days ?? null);
  const [disappearingDefault, setDisappearingDefault] = useState<string | null>(server?.disappearing_messages_default ?? null);
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [profanityLevel, setProfanityLevelState] = useState<FilterLevel>(() => getProfanityLevel(server.id));
  const [serverBotTags, setServerBotTagsState] = useState<boolean>(() => localStorage.getItem('d_server_bot_tags_' + server.id) !== 'false');
  const [serverDefaultChannel, setServerDefaultChannelState] = useState<string>(() => localStorage.getItem('d_server_default_channel_' + server.id) || '');
  const [roles, setRoles] = useState<Role[]>([]);
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [chainVerify, setChainVerify] = useState<{ chain_intact: boolean; verified_entries?: number; first_broken_at?: number; first_broken_reason?: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [newRole, setNewRole] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#00d4aa');
  const [saved, setSaved] = useState('');
  const [mgmtMembers, setMgmtMembers] = useState<Member[]>([]);
  const [mgmtMemberRoles, setMgmtMemberRoles] = useState<Record<string, Role[]>>({});
  const [memberSearch, setMemberSearch] = useState('');
  const [roleMemberCounts, setRoleMemberCounts] = useState<Record<string, number>>({});
  const [serverBots, setServerBots]       = useState<BotEntry[]>([]);
  // Playbooks
  const [playbooks, setPlaybooks] = useState<any[]>([]);
  const [showCreatePlaybook, setShowCreatePlaybook] = useState(false);
  const [newPbName, setNewPbName] = useState('');
  const [newPbDesc, setNewPbDesc] = useState('');
  const [newPbSteps, setNewPbSteps] = useState<{ title: string; assignee_id?: string }[]>([]);
  const [expandedPb, setExpandedPb] = useState<string | null>(null);
  // Automation tasks
  const [tasks, setTasks] = useState<any[]>([]);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskType, setNewTaskType] = useState('channel_monitor');
  const [newTaskChannel, setNewTaskChannel] = useState('');
  const [newTaskCron, setNewTaskCron] = useState('0 */6 * * *');
  const [newTaskMonitorType, setNewTaskMonitorType] = useState('action_items');
  const [newTaskConfig, setNewTaskConfig] = useState<Record<string, any>>({});
  const [spawnName, setSpawnName]         = useState('');
  const [spawnPersona, setSpawnPersona]   = useState(PRESETS[0]?.id || 'general');
  const [spawning, setSpawning]           = useState(false);
  const [activeBotConfig, setActiveBotConfig] = useState<BotEntry | null>(null);
  const [memberFilter, setMemberFilter] = useState<'all' | 'online' | 'offline' | 'bots' | string>('all');
  const [memberSort, setMemberSort] = useState<'name' | 'joined' | 'active'>('name');
  const [memberPage, setMemberPage] = useState(0);
  const MEMBER_PAGE_SIZE = 50;

  useEffect(() => {
    if (tab === 'roles') {
      api.listRoles(server.id).then(r => setRoles(Array.isArray(r) ? r : []));
      // compute member counts from already-loaded mgmtMemberRoles (best-effort)
      const counts: Record<string, number> = {};
      Object.values(mgmtMemberRoles).forEach(rList => {
        rList.forEach(role => {
          const rid = (role as any).id || (role as any).role_id;
          if (rid) counts[rid] = (counts[rid] || 0) + 1;
        });
      });
      setRoleMemberCounts(counts);
    }
    if (tab === 'channels') {
      api.listChannels(server.id).then(c => setChannels(Array.isArray(c) ? c : []));
      api.listCategories(server.id).then(c => setCategories(Array.isArray(c) ? c : []));
    }
    if (tab === 'bots')     api.listBots(server.id).then(b => setServerBots(Array.isArray(b) ? b : []));
    if (tab === 'automation') { api.listTasks(server.id).then(t => setTasks(Array.isArray(t) ? t : [])); api.listChannels(server.id).then(c => setChannels(Array.isArray(c) ? c : [])); }
    if (tab === 'playbooks') { api.listPlaybooks(server.id).then(p => setPlaybooks(Array.isArray(p) ? p : [])); if (mgmtMembers.length === 0) api.listMembers(server.id).then(m => { if (Array.isArray(m)) setMgmtMembers(m); }); }
    if (tab === 'bans')     api.listBans(server.id).then(b => setBans(Array.isArray(b) ? b : []));
    if (tab === 'webhooks' && channels.length === 0) api.listChannels(server.id).then(c => setChannels(Array.isArray(c) ? c : []));
    if (tab === 'audit')    api.getAuditLog(server.id).then(a => setAuditLog(Array.isArray(a) ? a : []));
    if (tab === 'invites') { setInvitesLoading(true); api.listInvites(server.id).then(inv => { setInvites(Array.isArray(inv) ? inv : []); setInvitesLoading(false); }).catch(() => setInvitesLoading(false)); }
    if (tab === 'members') {
      setMemberPage(0);
      api.listRoles(server.id).then(r => setRoles(Array.isArray(r) ? r : []));
      api.listMembers(server.id).then(async (m: Member[]) => {
        if (!Array.isArray(m)) return;
        setMgmtMembers(m);
        const roleMap: Record<string, Role[]> = {};
        // load roles for first page eagerly, rest lazily
        await Promise.all(m.slice(0, MEMBER_PAGE_SIZE).map(async u => {
          try { const r = await api.listMemberRoles(server.id, u.user_id); roleMap[u.user_id] = Array.isArray(r) ? r : []; }
          catch { roleMap[u.user_id] = []; }
        }));
        setMgmtMemberRoles(roleMap);
        // load remaining in background
        if (m.length > MEMBER_PAGE_SIZE) {
          Promise.all(m.slice(MEMBER_PAGE_SIZE).map(async u => {
            try { const r = await api.listMemberRoles(server.id, u.user_id); roleMap[u.user_id] = Array.isArray(r) ? r : []; }
            catch { roleMap[u.user_id] = []; }
          })).then(() => setMgmtMemberRoles({ ...roleMap }));
        }
      });
    }
  }, [tab]);

  const handleInvite = async () => { const inv = await api.createInvite(server.id); if (inv.code) setInviteCode(inv.code); };
  const copyInv = () => { navigator.clipboard.writeText(`Server ID: ${server.id}\nInvite Code: ${inviteCode}`); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const saveName = async () => { await api.updateServer(server.id, { name: name.trim() }); setSaved('Saved!'); setTimeout(() => setSaved(''), 1500); if (onUpdate) onUpdate(); };
  const handleCreateRole = async () => {
    if (!newRole.trim()) return;
    await api.createRole(server.id, newRole.trim(), newRoleColor, 0);
    setNewRole('');
    api.listRoles(server.id).then(r => setRoles(Array.isArray(r) ? r : []));
    onUpdate && onUpdate();
  };
  const handleDeleteRole = async (rid: string) => {
    const role = roles.find(r => r.id === rid);
    const roleName = role?.name || 'this role';
    if (await showConfirm('Delete Role', `Deleting "${roleName}" will remove it from all members who have it. They will lose any permissions granted by this role. This cannot be undone.`, true, roleName, 'Delete Role')) {
      await api.deleteRole(server.id, rid);
      setRoles(p => p.filter(r => r.id !== rid));
    }
  };
  const refreshChannels = () => {
    api.listChannels(server.id).then(c => { if (Array.isArray(c)) setChannels(c); });
  };

  const handleCreateChannel = async () => {
    const name = newChName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;
    await api.createChannel(server.id, name, newChCat || null, newChType);
    setNewChName('');
    setShowCreateCh(false);
    refreshChannels();
  };

  const handleCreateCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    try {
      await (api as any).fetch(`/servers/${server.id}/categories`, { method: 'POST', body: JSON.stringify({ name }) });
    } catch { /* ignore if endpoint not available */ }
    setNewCatName('');
    setShowCreateCat(false);
    api.listCategories(server.id).then(c => setCategories(Array.isArray(c) ? c : []));
  };

  const handleMoveChannel = (id: string, dir: -1 | 1) => {
    setChannels(prev => {
      const idx = prev.findIndex(c => c.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      // persist new positions
      next.forEach((ch, i) => api.updateChannel(ch.id, { position: i }));
      return next;
    });
  };

  const handleMoveRole = (id: string, dir: -1 | 1) => {
    setRoles(prev => {
      const idx = prev.findIndex(r => r.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      next.forEach((r, i) => api.updateRole(r.id, { position: i }));
      return next;
    });
  };

  const handleSpawnBot = async () => {
    const name = spawnName.trim();
    if (!name) return;
    setSpawning(true);
    try {
      const preset = PRESETS.find(p => p.id === spawnPersona);
      const result = await api.createBot(server.id, {
        username:        name.toLowerCase().replace(/\s+/g, '_') + '_bot',
        display_name:    name,
        persona:         spawnPersona,
        system_prompt:   preset?.cfg.system_prompt || '',
        temperature:     preset?.cfg.temperature ?? 0.7,
        voice_style:     preset?.cfg.voice_style || 'default',
        greeting_message: preset?.cfg.greeting_message || '',
        response_prefix: preset?.cfg.response_prefix || '',
        enabled:         true,
      });
      if (result?.bot_user_id || result?.id) {
        setSpawnName('');
        api.listBots(server.id).then(b => setServerBots(Array.isArray(b) ? b : []));
        setSaved('Bot created!'); setTimeout(() => setSaved(''), 1500);
        onUpdate?.();
      }
    } catch (e: any) { setSaved('Failed: ' + (e.message || 'unknown error')); setTimeout(() => setSaved(''), 2500); }
    finally { setSpawning(false); }
  };

  const handleRemoveBot = async (bot: BotEntry) => {
    if (!await showConfirm('Remove Bot', `Remove ${bot.display_name || bot.username} from this server? All bot config will be lost.`, true)) return;
    await api.removeBotFromServer(server.id, bot.bot_user_id);
    setServerBots(p => p.filter(b => b.bot_user_id !== bot.bot_user_id));
    onUpdate?.();
  };

  const handleToggleBot = async (bot: BotEntry) => {
    const next = !bot.enabled;
    await api.updateBot(server.id, bot.bot_user_id, { enabled: next });
    setServerBots(p => p.map(b => b.bot_user_id === bot.bot_user_id ? { ...b, enabled: next } : b));
  };

  const handleUnban = async (uid: string) => {
    if (await showConfirm('Unban User', 'Unban this user? They will be able to rejoin the server.', false)) {
      await api.unbanUser(server.id, uid);
      setBans(p => p.filter(b => b.user_id !== uid));
    }
  };

  const isOwner = server.owner_id === api.userId;
  const tabGroups = [
    { heading: 'Server', tabs: [
      { id: 'overview',   label: 'Overview' },
      { id: 'roles',      label: roles.length ? `Roles (${roles.length})` : 'Roles' },
      { id: 'emoji',      label: 'Emoji' },
    ]},
    { heading: 'Channels', tabs: [
      { id: 'channels',   label: channels.length ? `Channels (${channels.length})` : 'Channels' },
    ]},
    { heading: 'Members', tabs: [
      { id: 'members',    label: mgmtMembers.length ? `Members (${mgmtMembers.length})` : 'Members' },
      { id: 'invites',    label: 'Invites' },
      { id: 'bans',       label: 'Bans' },
    ]},
    { heading: 'Moderation', tabs: [
      { id: 'moderation',  label: 'Moderation' },
      { id: 'audit',       label: 'Audit Log' },
    ]},
    { heading: 'Integrations', tabs: [
      { id: 'bots',        label: serverBots.length ? `Bots (${serverBots.length})` : 'Bots' },
      { id: 'webhooks',    label: 'Webhooks' },
      { id: 'automation',  label: 'Automation' },
    ]},
    { heading: 'Other', tabs: [
      { id: 'events',      label: 'Events' },
      { id: 'playbooks',   label: 'Playbooks' },
      { id: 'data',        label: 'Data Management' },
    ]},
  ];
  const tabs = tabGroups.flatMap(g => g.tabs);

  const actionLabels: Record<string, string> = {
    MEMBER_BAN: 'Banned member', MEMBER_UNBAN: 'Unbanned member',
    ROLE_CREATE: 'Created role', ROLE_UPDATE: 'Updated role', ROLE_DELETE: 'Deleted role',
    CHANNEL_CREATE: 'Created channel', CHANNEL_DELETE: 'Deleted channel',
    SERVER_UPDATE: 'Updated server', UPDATE_SERVER: 'Updated server settings',
    UPDATE_CHANNEL: 'Updated channel', CREATE_INVITE: 'Created invite',
    ASSIGN_ROLE: 'Assigned role', UNASSIGN_ROLE: 'Unassigned role',
    BULK_DELETE_MESSAGES: 'Bulk deleted messages',
  };

  return (
    <Modal title={server?.name || 'Server Settings'} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 0, minHeight: 400 }}>
      {/* ── Sidebar ── */}
      <div style={{ width: 180, flexShrink: 0, borderInlineEnd: `1px solid ${T.bd}`, paddingInlineEnd: 12, marginInlineEnd: 16, overflowY: 'auto', maxHeight: 'calc(80vh - 80px)' }}>
        {tabGroups.map(group => (
          <div key={group.heading} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.6px', padding: '4px 8px', marginBottom: 2 }}>{group.heading}</div>
            {group.tabs.map(t => (
              <div key={t.id} onClick={() => {
                setTab(t.id);
                if (t.id === 'bots') api.listBots(server.id).then(b => setServerBots(Array.isArray(b) ? b : []));
                if (t.id === 'channels') { api.listChannels(server.id).then(c => setChannels(Array.isArray(c) ? c : [])); api.listCategories(server.id).then(c => setCategories(Array.isArray(c) ? c : [])); }
                if (t.id === 'audit') api.getAuditLog(server.id).then(a => setAuditLog(Array.isArray(a) ? a : []));
                if (t.id === 'bans') api.listBans(server.id).then(b => setBans(Array.isArray(b) ? b : []));
                if (t.id === 'invites') { setInvitesLoading(true); api.listInvites(server.id).then(inv => { setInvites(Array.isArray(inv) ? inv : []); setInvitesLoading(false); }).catch(() => setInvitesLoading(false)); }
                if (t.id === 'roles') api.listRoles(server.id).then(r => setRoles(Array.isArray(r) ? r : []));
                if (t.id === 'webhooks' && channels.length === 0) api.listChannels(server.id).then(c => setChannels(Array.isArray(c) ? c : []));
              }}
                style={{
                  padding: '5px 8px', borderRadius: 4, fontSize: 12, fontWeight: tab === t.id ? 600 : 500,
                  cursor: 'pointer', marginBottom: 1,
                  color: tab === t.id ? T.ac : T.mt,
                  background: tab === t.id ? 'rgba(0,212,170,0.1)' : 'transparent',
                  transition: 'color .15s, background .15s',
                }}
                onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.background = 'transparent'; }}
              >{t.label}</div>
            ))}
          </div>
        ))}
      </div>
      {/* ── Content ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', maxHeight: 'calc(80vh - 80px)' }}>

      {tab === 'overview' && (<>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>
            Server Name
            {!isOwner && <span style={{ fontSize: 9, color: T.mt, fontWeight: 400, textTransform: 'none' }}><I.Lock s={9} /> Owner only</span>}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...getInp(), flex: 1, opacity: isOwner ? 1 : 0.5 }} value={name} onChange={e => { if (isOwner) setName(e.target.value); }} readOnly={!isOwner} />
            {isOwner && <button onClick={saveName} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '8px 18px' }}>Save</button>}
          </div>
          {saved && <div style={{ color: T.ac, fontSize: 12, marginTop: 6 }}>{saved}</div>}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Server Icon</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: server.icon_url ? 'transparent' : T.sf2, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: `2px dashed ${T.bd}`, flexShrink: 0 }}>
              {server.icon_url ? <img src={server.icon_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover' }} /> : <span style={{ fontSize: 24, color: T.mt }}>{server.name?.[0]?.toUpperCase() || '?'}</span>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <label style={{ padding: '6px 14px', background: T.ac, color: '#000', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'inline-block' }}>
                  Upload
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const reader = new FileReader();
                    reader.onload = async () => {
                      await api.updateServer(server.id, { icon_url: reader.result as string });
                      setSaved('Icon updated!'); setTimeout(() => setSaved(''), 1500);
                      if (onUpdate) onUpdate();
                    };
                    reader.readAsDataURL(file);
                  }} />
                </label>
                {server.icon_url && <button onClick={async () => { await api.updateServer(server.id, { icon_url: '' }); setSaved('Icon removed'); setTimeout(() => setSaved(''), 1500); if (onUpdate) onUpdate(); }} className="pill-btn" style={{ background: T.sf2, color: T.err, padding: '6px 14px', fontSize: 12, border: `1px solid ${T.bd}` }}>Remove</button>}
              </div>
              <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Recommended: 256×256 or larger. JPG, PNG, GIF, or WebP.</div>
            </div>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Member Panel Label</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...getInp(), flex: 1 }} value={memberTabLabel} onChange={e => setMemberTabLabel(e.target.value)} placeholder="Users" />
            <button onClick={async () => { await api.updateServer(server.id, { member_tab_label: memberTabLabel.trim() || 'Users' }); setSaved('Saved!'); setTimeout(() => setSaved(''), 1500); if (onUpdate) onUpdate(); }} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '8px 18px' }}>Save</button>
          </div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 4 }}>Customize what the member panel is called (e.g. "Users", "Members", "Crew", "Team")</div>
        </div>
        {/* Features */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 10, textTransform: 'uppercase' }}>Features</label>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Slash Commands</div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Allow members to use /calc, /convert, /color in channels</div>
            </div>
            <div onClick={async () => {
              const next = !slashCmdsEnabled;
              setSlashCmdsEnabled(next);
              await api.updateServer(server.id, { slash_commands_enabled: next });
              setSaved('Saved!'); setTimeout(() => setSaved(''), 1500);
              if (onUpdate) onUpdate();
            }} style={{ width: 40, height: 22, borderRadius: 11, background: slashCmdsEnabled ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginInlineStart: 12}}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: '#fff', position: 'absolute', top: 2, left: slashCmdsEnabled ? 20 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
            </div>
          </div>
          {/* Mention controls */}
          <div style={{ fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 8, marginTop: 16, textTransform: 'uppercase' }}>Mention Controls</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
            <div>
              <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Who can @everyone</label>
              <select value={(server as any).mention_everyone_role || 'admin'} onChange={async (e) => { await api.updateServer(server.id, { mention_everyone_role: e.target.value }); setSaved('Saved!'); setTimeout(() => setSaved(''), 1500); if (onUpdate) onUpdate(); }} style={{ ...getInp(), fontSize: 12 }}>
                <option value="admin">Admins only</option>
                <option value="moderator">Moderators & Admins</option>
                <option value="everyone">Everyone</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Who can @here</label>
              <select value={(server as any).mention_here_role || 'admin'} onChange={async (e) => { await api.updateServer(server.id, { mention_here_role: e.target.value }); setSaved('Saved!'); setTimeout(() => setSaved(''), 1500); if (onUpdate) onUpdate(); }} style={{ ...getInp(), fontSize: 12 }}>
                <option value="admin">Admins only</option>
                <option value="moderator">Moderators & Admins</option>
                <option value="everyone">Everyone</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 10, color: T.mt, lineHeight: 1.5 }}>Users without permission can still type @everyone — the text posts but the ping is silently suppressed.</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Server ID</label>
          <div style={{ padding: '10px 12px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, fontSize: 12, fontFamily: 'var(--font-mono)', color: T.tx, wordBreak: 'break-all', cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(server.id)}>
            {server?.id} <span style={{ color: T.mt, fontSize: 10 }}>(click to copy)</span>
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 8, textTransform: 'uppercase' }}>Invite Friends</label>
          {!inviteCode ? (
            <button onClick={handleInvite} style={{ ...btn(true), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><I.Link /> Generate Invite Code</button>
          ) : (
            <div>
              <div style={{ padding: 12, background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: T.mt, marginBottom: 4 }}>Server ID:</div>
                <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: T.ac, marginBottom: 8, wordBreak: 'break-all' }}>{server?.id}</div>
                <div style={{ fontSize: 11, color: T.mt, marginBottom: 4 }}>Invite Code:</div>
                <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', color: T.ac, fontWeight: 700 }}>{inviteCode}</div>
              </div>
              <button onClick={copyInv} style={{ ...btn(true), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><I.Copy /> {copied ? 'Copied!' : 'Copy Invite Info'}</button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 8 }}>Server Discovery</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>List in Public Discovery</div>
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>Allow anyone to find and join this server from the Explore tab.</div>
            </div>
            <div onClick={async () => {
              if (server?.is_public) { await api.unpublishServer(server.id); setSaved('Unpublished!'); }
              else { await api.publishServer(server.id, 'Community', []); setSaved('Published!'); }
              setTimeout(() => setSaved(''), 1500); if (onUpdate) onUpdate();
            }} style={{ width: 36, height: 20, borderRadius: 10, background: server?.is_public ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
              <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: server?.is_public ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 8 }}>Profanity Filter</div>
          <div style={{ fontSize: 12, color: T.mt, marginBottom: 10, lineHeight: 1.5 }}>
            Filters incoming messages for your view of this server. Stored locally — each member sets their own preference.
          </div>
          <select
            value={profanityLevel}
            onChange={e => {
              const level = e.target.value as FilterLevel;
              setProfanityLevelState(level);
              setProfanityLevel(server.id, level);
            }}
            style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13 }}
          >
            <option value="off">Off — no filtering</option>
            <option value="light">Light — slurs only</option>
            <option value="medium">Medium — common profanity</option>
            <option value="strict">Strict — all profanity</option>
          </select>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Default Channel</div>
          <div style={{ fontSize: 12, color: T.mt, marginBottom: 10, lineHeight: 1.5 }}>
            New members will land in this channel when they join your server. Choose a welcoming channel.
          </div>
          <select
            value={serverDefaultChannel}
            onChange={e => {
              const val = e.target.value;
              setServerDefaultChannelState(val);
              localStorage.setItem('d_server_default_channel_' + server.id, val);
            }}
            style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: serverDefaultChannel ? T.tx : T.mt, fontSize: 13 }}
          >
            <option value="">— No preference (auto-select) —</option>
            {channels.filter(c => c.channel_type !== 'voice').map(ch => (
              <option key={ch.id} value={ch.id}># {ch.name}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 8 }}>Bot Appearance</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, paddingInlineEnd: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Show BOT tags by default</div>
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>When disabled, bots in this server won't show the BOT badge. Members can override this in their personal settings. Bot identity is always visible to admins.</div>
            </div>
            <div onClick={() => {
              const next = !serverBotTags;
              setServerBotTagsState(next);
              localStorage.setItem('d_server_bot_tags_' + server.id, String(next));
            }} style={{ width: 36, height: 20, borderRadius: 10, background: serverBotTags ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
              <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: serverBotTags ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
            </div>
          </div>
        </div>

        {/* System Messages Channel */}
        <div style={{ marginTop: 16, marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>System Messages Channel</label>
          <select style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            value={localStorage.getItem(`d_sysmsg_ch_${server.id}`) || ''}
            onChange={e => { localStorage.setItem(`d_sysmsg_ch_${server.id}`, e.target.value); api.updateServer(server.id, { system_channel_id: e.target.value || null }).catch(() => {}); }}
          >
            <option value="">Default (first text channel)</option>
            {channels.filter(c => c.channel_type !== 'voice').map(ch => (
              <option key={ch.id} value={ch.id}># {ch.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Where join/leave and system messages are posted.</div>
        </div>

        {/* Inactive Timeout */}
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Inactive Voice Timeout</label>
          <select style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            value={localStorage.getItem(`d_idle_timeout_${server.id}`) || '300'}
            onChange={e => { localStorage.setItem(`d_idle_timeout_${server.id}`, e.target.value); }}
          >
            <option value="60">1 minute</option>
            <option value="300">5 minutes</option>
            <option value="900">15 minutes</option>
            <option value="1800">30 minutes</option>
            <option value="3600">1 hour</option>
          </select>
          <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Move idle users out of voice after this duration.</div>
        </div>

        {/* Default Notification Level */}
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Default Notification Level</label>
          <select style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            value={localStorage.getItem(`d_default_notif_${server.id}`) || 'mentions'}
            onChange={e => { localStorage.setItem(`d_default_notif_${server.id}`, e.target.value); api.updateServer(server.id, { default_notification_level: e.target.value }).catch(() => {}); }}
          >
            <option value="all">All Messages</option>
            <option value="mentions">Mentions Only</option>
            <option value="nothing">Nothing</option>
          </select>
          <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Notification level for new members joining this server.</div>
        </div>

        {/* AI Agents Toggle — owner or manage_bots permission */}
        <div style={{ marginTop: 16, padding: '12px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Disable AI Agents</div>
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>When enabled, all AI agent endpoints are rejected. Existing configs are preserved but deactivated. The server becomes AI-free.</div>
            </div>
            <div onClick={async () => {
              const next = !(server as any).ai_disabled;
              try {
                await api.updateServer(server.id, { ai_disabled: next });
                if (onUpdate) onUpdate();
              } catch {}
            }}
              style={{ width: 36, height: 20, borderRadius: 10, background: (server as any).ai_disabled ? T.err : T.bd, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginInlineStart: 12}}>
              <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: (server as any).ai_disabled ? 18 : 2, transition: 'left 0.2s' }} />
            </div>
          </div>
          {(server as any).ai_disabled && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: T.bg, borderRadius: 6, fontSize: 11, color: '#ff4757' }}>
              AI agents are disabled on this server. All AI-related API requests will be rejected.
            </div>
          )}
        </div>

        {/* Transfer Ownership — owner only */}
        {server.owner_id === api.userId && (
          <TransferOwnership serverId={server.id} serverName={server.name} members={mgmtMembers} getName={getName} showConfirm={showConfirm} onUpdate={onUpdate} />
        )}
      </>)}

      {tab === 'channels' && (() => {
        // group channels by category
        const byCat: Record<string, Channel[]> = { '': [] };
        categories.forEach(cat => { byCat[cat.id] = []; });
        channels.forEach(ch => {
          const key = ch.category_id && byCat[ch.category_id] !== undefined ? ch.category_id : '';
          byCat[key].push(ch);
        });
        const catOrder = ['', ...categories.map(c => c.id)];

        return (
          <>
            {/* toolbar */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
                Channel Management — {channels.length} channel{channels.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => { setShowCreateCat(p => !p); setShowCreateCh(false); }}
                style={{ ...btn(), padding: '6px 12px', fontSize: 12 }}
              >+ Category</button>
              <button
                onClick={() => { setShowCreateCh(p => !p); setShowCreateCat(false); }}
                style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >+ Channel</button>
            </div>

            {/* create category inline form */}
            {showCreateCat && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, padding: '10px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
                <input
                  autoFocus
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateCategory(); if (e.key === 'Escape') setShowCreateCat(false); }}
                  placeholder="Category name (e.g. GENERAL)"
                  style={{ ...getInp(), flex: 1, padding: '6px 10px', fontSize: 13 }}
                />
                <button onClick={handleCreateCategory} style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Create</button>
                <button onClick={() => setShowCreateCat(false)} style={{ ...btn(), padding: '6px 10px', fontSize: 12 }}>Cancel</button>
              </div>
            )}

            {/* create channel inline form */}
            {showCreateCh && (
              <div style={{ marginBottom: 14, padding: '12px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>New Channel</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    autoFocus
                    value={newChName}
                    onChange={e => setNewChName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateChannel(); if (e.key === 'Escape') setShowCreateCh(false); }}
                    placeholder="channel-name"
                    style={{ ...getInp(), flex: 2, minWidth: 140, padding: '7px 10px', fontSize: 13 }}
                  />
                  <select value={newChType} onChange={e => setNewChType(e.target.value)} style={{ ...getInp(), flex: 1, minWidth: 100, padding: '7px 8px', fontSize: 13 }}>
                    <option value="text">Text</option>
                    <option value="voice">Voice</option>
                    <option value="announcement">Announcement</option>
                  </select>
                  {categories.length > 0 && (
                    <select value={newChCat} onChange={e => setNewChCat(e.target.value)} style={{ ...getInp(), flex: 1, minWidth: 110, padding: '7px 8px', fontSize: 13 }}>
                      <option value="">No category</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={handleCreateChannel} style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Create Channel</button>
                  <button onClick={() => setShowCreateCh(false)} style={{ ...btn(), padding: '7px 14px', fontSize: 13 }}>Cancel</button>
                </div>
              </div>
            )}

            {/* channel list grouped by category */}
            {channels.length === 0 && (
              <div style={{ color: T.mt, fontSize: 13, textAlign: 'center', padding: '32px 0' }}>No channels yet — create one above</div>
            )}
            {catOrder.map(catId => {
              const list = byCat[catId];
              if (!list || list.length === 0) return null;
              const catLabel = catId ? categories.find(c => c.id === catId)?.name || 'Unknown' : 'Uncategorized';
              const showHeader = catId || categories.length > 0;
              return (
                <div key={catId || '__none__'} style={{ marginBottom: 16 }}>
                  {showHeader && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                        {catLabel}
                      </span>
                      <span style={{ fontSize: 10, color: T.bd }}>— {list.length}</span>
                      <div style={{ flex: 1, height: 1, background: T.bd }} />
                    </div>
                  )}
                  {list.map((ch, idx) => (
                    <ChannelManagerRow
                      key={ch.id}
                      ch={ch}
                      index={idx}
                      total={list.length}
                      categories={categories}
                      serverId={server.id}
                      showConfirm={showConfirm}
                      onRefresh={refreshChannels}
                      onMove={handleMoveChannel}
                    />
                  ))}
                </div>
              );
            })}
          </>
        );
      })()}

      {tab === 'roles' && (<>
        {/* ── Create Role ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, padding: '12px 14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', width: '100%', marginBottom: 4 }}>Create Role</span>
          <input
            style={{ ...getInp(), flex: 1, minWidth: 140 }}
            value={newRole}
            onChange={e => setNewRole(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateRole()}
            placeholder="Role name…"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div
              onClick={() => document.getElementById('new-role-color-picker')?.click()}
              style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: newRoleColor, border: `2px solid ${T.bd}`, cursor: 'pointer', transition: 'box-shadow .15s' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 0 3px ${newRoleColor}44`)}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
              title="Choose color"
            />
            <input id="new-role-color-picker" type="color" value={newRoleColor} onChange={e => setNewRoleColor(e.target.value)}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
            <input
              value={newRoleColor}
              onChange={e => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) setNewRoleColor(e.target.value); }}
              maxLength={7}
              style={{ ...getInp(), width: 78, padding: '6px 8px', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <button
            onClick={handleCreateRole}
            disabled={!newRole.trim()}
            style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: newRole.trim() ? 'pointer' : 'not-allowed', opacity: newRole.trim() ? 1 : 0.5, flexShrink: 0 }}
          >+ Create</button>
        </div>

        {/* ── Role cards ── */}
        {roles.length === 0 && (
          <div style={{ color: T.mt, fontSize: 13, textAlign: 'center', padding: '32px 0' }}>No roles yet — create one above</div>
        )}
        {roles.map((r, idx) => (
          <RoleEditorCard
            key={r.id}
            r={r}
            index={idx}
            total={roles.length}
            memberCount={roleMemberCounts[r.id] || 0}
            onDelete={() => handleDeleteRole(r.id)}
            onUpdate={data => setRoles(p => p.map(x => x.id === r.id ? { ...x, ...data } : x))}
            onMove={handleMoveRole}
          />
        ))}
      </>)}

      {tab === 'members' && (() => {
        // ── filter ──
        const q = memberSearch.toLowerCase();
        let filtered = mgmtMembers.filter(m => {
          if (q && !m.username?.toLowerCase().includes(q) && !m.display_name?.toLowerCase().includes(q)) return false;
          if (memberFilter === 'bots')    return m.is_bot;
          if (memberFilter === 'online')  return m.online === true;
          if (memberFilter === 'offline') return m.online === false;
          if (memberFilter !== 'all') {
            // filter by role id
            const ur = mgmtMemberRoles[m.user_id] || [];
            return ur.some(r => ((r as any).id || (r as any).role_id) === memberFilter);
          }
          return true;
        });

        // ── sort ──
        filtered = [...filtered].sort((a, b) => {
          if (memberSort === 'joined') return (a.joined_at || '').localeCompare(b.joined_at || '');
          if (memberSort === 'active') return (b.last_active_at || '').localeCompare(a.last_active_at || '');
          return (a.display_name || a.username || '').localeCompare(b.display_name || b.username || '');
        });

        const totalPages = Math.ceil(filtered.length / MEMBER_PAGE_SIZE);
        const page = Math.min(memberPage, Math.max(0, totalPages - 1));
        const pageSlice = filtered.slice(page * MEMBER_PAGE_SIZE, (page + 1) * MEMBER_PAGE_SIZE);
        const assignableRoles = roles.filter(r => r.name !== '@everyone');

        return (
          <>
            {/* search + sort */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <input
                value={memberSearch}
                onChange={e => { setMemberSearch(e.target.value); setMemberPage(0); }}
                placeholder={`Search ${mgmtMembers.length} members…`}
                style={{ ...getInp(), flex: 1, minWidth: 160, padding: '7px 10px', fontSize: 13 }}
              />
              <select
                value={memberSort}
                onChange={e => setMemberSort(e.target.value as 'name' | 'joined' | 'active')}
                style={{ ...getInp(), padding: '7px 8px', fontSize: 12, flexShrink: 0 }}
              >
                <option value="name">Sort: Name</option>
                <option value="joined">Sort: Join Date</option>
                <option value="active">Sort: Last Active</option>
              </select>
            </div>

            {/* Prune + filter pills */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {isOwner && (
                <select
                  onChange={async e => {
                    const days = parseInt(e.target.value);
                    if (!days) return;
                    if (!confirm(`Remove members with no roles who haven't been active in ${days} days?`)) return;
                    try { await api.fetch(`/servers/${server.id}/prune?days=${days}`, { method: 'POST' }); if (onUpdate) onUpdate(); } catch {}
                    e.target.value = '';
                  }}
                  style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.bg, color: T.mt, fontSize: 11, cursor: 'pointer' }}
                >
                  <option value="">Prune Inactive…</option>
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </select>
              )}
              {(['all', 'online', 'offline', 'bots'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => { setMemberFilter(f); setMemberPage(0); }}
                  style={{ padding: '4px 12px', borderRadius: 'var(--border-radius)', fontSize: 11, fontWeight: memberFilter === f ? 700 : 400, background: memberFilter === f ? ta(T.ac,'22') : 'rgba(255,255,255,0.05)', color: memberFilter === f ? T.ac : T.mt, border: `1px solid ${memberFilter === f ? ta(T.ac,'55') : T.bd}`, cursor: 'pointer', transition: 'all .12s', textTransform: 'capitalize' }}
                >{f === 'all' ? `All (${mgmtMembers.length})` : f.charAt(0).toUpperCase() + f.slice(1)}</button>
              ))}
              {assignableRoles.map(role => (
                <button
                  key={role.id}
                  onClick={() => { setMemberFilter(memberFilter === role.id ? 'all' : role.id); setMemberPage(0); }}
                  style={{ padding: '4px 12px', borderRadius: 'var(--border-radius)', fontSize: 11, fontWeight: memberFilter === role.id ? 700 : 400, background: memberFilter === role.id ? `${role.color || T.ac}22` : 'rgba(255,255,255,0.05)', color: memberFilter === role.id ? (role.color || T.ac) : T.mt, border: `1px solid ${memberFilter === role.id ? (role.color || T.ac) + '55' : T.bd}`, cursor: 'pointer', transition: 'all .12s' }}
                >{role.name}</button>
              ))}
            </div>

            {/* result count */}
            <div style={{ fontSize: 11, color: T.mt, marginBottom: 8 }}>
              {filtered.length === 0 ? 'No members match' : `Showing ${page * MEMBER_PAGE_SIZE + 1}–${Math.min((page + 1) * MEMBER_PAGE_SIZE, filtered.length)} of ${filtered.length}`}
            </div>

            {/* member rows */}
            {pageSlice.map(m => (
              <MemberManagerRow
                key={m.user_id}
                member={m}
                userRoles={mgmtMemberRoles[m.user_id] || []}
                allRoles={roles}
                serverId={server.id}
                showConfirm={showConfirm}
                onRolesChange={(uid, newRoles) => { setMgmtMemberRoles(p => ({ ...p, [uid]: newRoles })); onUpdate?.(); }}
                onKicked={uid => setMgmtMembers(p => p.filter(x => x.user_id !== uid))}
                onBanned={uid => setMgmtMembers(p => p.filter(x => x.user_id !== uid))}
              />
            ))}

            {/* pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.bd}` }}>
                <button
                  onClick={() => setMemberPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ ...btn(), padding: '5px 14px', fontSize: 12, opacity: page === 0 ? 0.4 : 1 }}
                >← Prev</button>
                <span style={{ fontSize: 12, color: T.mt }}>Page {page + 1} / {totalPages}</span>
                <button
                  onClick={() => setMemberPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  style={{ ...btn(), padding: '5px 14px', fontSize: 12, opacity: page >= totalPages - 1 ? 0.4 : 1 }}
                >Next →</button>
              </div>
            )}
          </>
        );
      })()}

      {tab === 'bots' && (<>
        {/* BotConfigModal overlay — rendered on top of the settings panel */}
        {activeBotConfig && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: T.bg, borderRadius: 'var(--border-radius)', overflow: 'hidden' }}>
            <BotConfigModal
              bot={activeBotConfig}
              serverId={server.id}
              onClose={() => {
                setActiveBotConfig(null);
                api.listBots(server.id).then(b => setServerBots(Array.isArray(b) ? b : []));
              }}
              onSave={async cfg => {
                await api.updateBotConfig(server.id, activeBotConfig.bot_user_id, cfg);
                setServerBots(p => p.map(b => b.bot_user_id === activeBotConfig.bot_user_id ? { ...b, ...cfg } : b));
              }}
              showConfirm={showConfirm}
            />
          </div>
        )}

        {/* ── Spawn Bot ── */}
        <div style={{ marginBottom: 18, padding: '14px 16px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Spawn New Bot
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={spawnName}
              onChange={e => setSpawnName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSpawnBot()}
              placeholder="Bot display name…"
              style={{ ...getInp(), flex: 2, minWidth: 140, padding: '8px 10px', fontSize: 13 }}
            />
            <select
              value={spawnPersona}
              onChange={e => setSpawnPersona(e.target.value)}
              style={{ ...getInp(), flex: 1, minWidth: 140, padding: '8px 8px', fontSize: 13 }}
            >
              {PRESETS.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name} — {p.tagline}</option>
              ))}
            </select>
            <button
              onClick={handleSpawnBot}
              disabled={spawning || !spawnName.trim()}
              style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: spawning || !spawnName.trim() ? 'not-allowed' : 'pointer', opacity: spawning || !spawnName.trim() ? 0.5 : 1, flexShrink: 0 }}
            >{spawning ? 'Creating…' : '+ Create Bot'}</button>
          </div>
          {/* persona preview */}
          {(() => {
            const p = PRESETS.find(x => x.id === spawnPersona);
            return p ? (
              <div style={{ marginTop: 10, padding: '8px 10px', background: T.bg, borderRadius: 7, borderInlineStart: `3px solid ${p.color}` }}>
                <div style={{ fontSize: 11, color: p.color, fontWeight: 700, marginBottom: 3 }}>{p.icon} {p.name}</div>
                <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.45 }}>{p.cfg.system_prompt.slice(0, 120)}…</div>
                <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Temp: {p.cfg.temperature} · Style: {p.cfg.voice_style}</div>
              </div>
            ) : null;
          })()}
        </div>

        {/* ── Bot Fleet ── */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
          Active Bots — {serverBots.length}
        </div>

        {serverBots.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: T.mt, fontSize: 13 }}>
            No bots yet — spawn one above
          </div>
        )}

        {serverBots.map(bot => {
          const preset     = PRESETS.find(p => p.id === bot.persona);
          const accentColor = preset?.color || T.ac;
          const msgsToday  = (() => {
            try {
              const logs = JSON.parse(localStorage.getItem(`d_bot_logs_${bot.bot_user_id}`) || '[]');
              const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
              return logs.filter((l: { ts: number }) => l.ts >= cutoff.getTime()).length;
            } catch { return 0; }
          })();
          const promptPreview = (bot.system_prompt || '').slice(0, 100) || (preset?.cfg.system_prompt || '').slice(0, 100);
          const temp = bot.temperature ?? preset?.cfg.temperature ?? 0.7;

          return (
            <div
              key={bot.bot_user_id}
              style={{ marginBottom: 8, borderRadius: 10, border: `1px solid ${T.bd}`, background: T.bg, overflow: 'hidden' }}
            >
              {/* main row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
                {/* avatar with color accent ring */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 20, overflow: 'hidden', border: `2px solid ${accentColor}` }}>
                    <Av name={bot.display_name || bot.username || '?'} size={40} url={null} />
                  </div>
                  {/* online/offline dot */}
                  <div style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, background: bot.enabled !== false ? '#3ba55d' : '#747f8d', border: `2px solid ${T.bg}` }} />
                </div>

                {/* info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>{bot.display_name || bot.username}</span>
                    <span style={{ fontSize: 9, background: 'rgba(114,137,218,0.2)', color: '#7289da', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>BOT</span>
                    {preset && (
                      <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: `${accentColor}20`, color: accentColor, border: `1px solid ${accentColor}40`, fontWeight: 600 }}>
                        {preset.icon} {preset.name}
                      </span>
                    )}
                    {msgsToday > 0 && (
                      <span style={{ fontSize: 10, color: T.mt }}>· {msgsToday} msg{msgsToday !== 1 ? 's' : ''} today</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.mt }}>@{bot.username} · temp {temp.toFixed(1)}</div>
                </div>

                {/* enabled toggle */}
                <div
                  onClick={() => handleToggleBot(bot)}
                  title={bot.enabled !== false ? 'Disable bot' : 'Enable bot'}
                  style={{ position: 'relative', width: 38, height: 22, borderRadius: 11, background: bot.enabled !== false ? T.ac : T.bd, cursor: 'pointer', flexShrink: 0, transition: 'background .2s' }}
                >
                  <div style={{ position: 'absolute', top: 3, left: bot.enabled !== false ? 19 : 3, width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
                </div>

                {/* actions */}
                <button
                  onClick={() => setActiveBotConfig(bot)}
                  style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}40`, borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                >Configure</button>
                <button
                  onClick={() => handleRemoveBot(bot)}
                  style={{ background: 'rgba(237,66,69,0.1)', color: T.err, border: '1px solid rgba(237,66,69,0.25)', borderRadius: 7, padding: '6px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
                  title="Remove bot"
                >Remove</button>
              </div>

              {/* system prompt preview + stats footer */}
              {promptPreview && (
                <div style={{ padding: '8px 14px', borderTop: `1px solid ${T.bd}`, background: T.sf2, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>System Prompt</div>
                    <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {promptPreview}{(bot.system_prompt || '').length > 100 ? '…' : ''}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: T.mt }}>Temp <span style={{ color: T.tx, fontWeight: 600 }}>{temp.toFixed(1)}</span></div>
                    <div style={{ fontSize: 10, color: bot.enabled !== false ? '#3ba55d' : T.mt, fontWeight: 600, marginTop: 2 }}>
                      {bot.enabled !== false ? 'ONLINE' : 'OFFLINE'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* permissions note */}
        <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(114,137,218,0.07)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(114,137,218,0.18)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7289da', marginBottom: 3 }}>🔒 Bot Permissions</div>
          <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5 }}>Bots appear in the member list with a BOT badge. By default they <strong style={{ color: T.tx }}>cannot</strong> delete channels, moderate members, or access server settings. Escalate via Configure → Advanced.</div>
        </div>
      </>)}

      {tab === 'emoji' && <EmojiManager serverId={server.id} showConfirm={showConfirm} />}

      {tab === 'events' && <EventsManager serverId={server.id} showConfirm={showConfirm} />}

      {tab === 'invites' && (() => {
        const now = Date.now();
        const isExpired = (inv: any) =>
          (inv.expires_at && new Date(inv.expires_at).getTime() < now) ||
          (inv.max_uses && inv.uses >= inv.max_uses);
        return (<>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Invites</div>
            <button onClick={() => onCreateInvite?.()} style={{ padding: '7px 16px', background: `linear-gradient(135deg,${T.ac},${T.ac2})`, border: 'none', borderRadius: 7, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Create Invite</button>
          </div>
          {invitesLoading && <div style={{ color: T.mt, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Loading…</div>}
          {!invitesLoading && invites.length === 0 && <div style={{ color: T.mt, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No active invites</div>}
          {!invitesLoading && invites.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.bd}` }}>
                    {['Code', 'Creator', 'Uses', 'Expires', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'start', fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv: any) => {
                    const expired = isExpired(inv);
                    const code = inv.code || inv.invite_code || inv.id;
                    const expiryStr = inv.expires_at
                      ? new Date(inv.expires_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'Never';
                    const usesStr = inv.max_uses ? `${inv.uses ?? 0} / ${inv.max_uses}` : `${inv.uses ?? 0} / ∞`;
                    return (
                      <tr key={code} style={{ borderBottom: `1px solid ${ta(T.bd,'20')}`, opacity: expired ? 0.6 : 1 }}>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: expired ? T.mt : T.ac, letterSpacing: 1 }}>{code}</span>
                        </td>
                        <td style={{ padding: '9px 10px', color: T.tx }}>{inv.creator_username || getName(inv.creator_id) || '—'}</td>
                        <td style={{ padding: '9px 10px', color: T.mt }}>{usesStr}</td>
                        <td style={{ padding: '9px 10px', color: T.mt, whiteSpace: 'nowrap' }}>{expiryStr}</td>
                        <td style={{ padding: '9px 10px' }}>
                          {expired
                            ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${ta(T.mt,'22')}`, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Expired</span>
                            : <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(59,165,93,0.15)', color: '#3ba55d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active</span>}
                        </td>
                        <td style={{ padding: '9px 10px' }}>
                          <button onClick={async () => {
                            if (!await showConfirm('Revoke Invite', `Revoke invite code "${code}"? Anyone with this link will no longer be able to join.`, true)) return;
                            await api.revokeInvite(server.id, code);
                            setInvites(p => p.filter(i => (i.code || i.invite_code || i.id) !== code));
                          }} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 5, color: '#ff4757', cursor: 'pointer' }}>Revoke</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>);
      })()}

      {tab === 'moderation' && <ModerationPanel serverId={server.id} getName={getName} decrypt={decrypt} />}

      {tab === 'data' && (<>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx, marginBottom: 12 }}>Message Retention</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Server Retention</div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Maximum message age. Cannot exceed global admin setting.</div>
            </div>
            <select
              value={retentionDays ?? ''}
              onChange={async e => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                setRetentionDays(v);
                await api.fetch(`/servers/${server.id}`, { method: 'PATCH', body: JSON.stringify({ message_retention_days: v }) });
                onUpdate?.();
              }}
              style={{ ...getInp(), fontSize: 12, padding: '6px 10px', width: 150, cursor: 'pointer' }}
            >
              <option value="">Inherit global</option>
              <option value={365}>365 days</option>
              <option value={180}>180 days</option>
              <option value={90}>90 days</option>
              <option value={30}>30 days</option>
              <option value={7}>7 days</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Disappearing Messages</div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Default for all channels. Channels can override with shorter durations.</div>
            </div>
            <select
              value={disappearingDefault ?? ''}
              onChange={async e => {
                const v = e.target.value === '' ? null : e.target.value;
                setDisappearingDefault(v);
                await api.fetch(`/servers/${server.id}`, { method: 'PATCH', body: JSON.stringify({ disappearing_messages_default: v }) });
                onUpdate?.();
              }}
              style={{ ...getInp(), fontSize: 12, padding: '6px 10px', width: 150, cursor: 'pointer' }}
            >
              <option value="">Inherit global</option>
              <option value="off">Off</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>

          <div style={{ fontSize: 11, color: T.mt, padding: '8px 14px', background: `${ta(T.ac,'08')}`, borderRadius: 6, border: `1px solid ${ta(T.ac,'20')}`, lineHeight: 1.6 }}>
            <strong style={{ color: T.ac }}>Protected data</strong> is never purged: audit log, settings changes, channel operations, role changes, and membership events live on the hash chain permanently.
          </div>
        </div>
      </>)}

      {tab === 'bans' && (<>
        {bans.length === 0 && <div style={{ color: T.mt, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No banned users</div>}
        {bans.map(b => (
          <div key={b.user_id || b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: 4, background: T.sf2 }}>
            <Av name={b.username || '?'} size={28} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{b.username || 'Unknown User'}</div>
              {b.reason && <div style={{ fontSize: 11, color: T.mt }}>{b.reason}</div>}
            </div>
            <button onClick={() => handleUnban(b.user_id)} className="pill-btn" style={{ background: T.sf, color: T.ac, border: `1px solid ${T.bd}` }}>Unban</button>
          </div>
        ))}
      </>)}

      {/* ── Danger Zone (data tab footer) ── */}
      {tab === 'data' && <ServerDangerZone server={server} onUpdate={onUpdate} />}

      {tab === 'playbooks' && (() => {
        const TEMPLATES = [
          { name: 'Incident Response', desc: 'Steps for handling production incidents', steps: ['Acknowledge incident', 'Assess severity (P1-P4)', 'Notify stakeholders', 'Investigate root cause', 'Implement fix', 'Verify resolution', 'Write post-mortem', 'Update runbook'] },
          { name: 'New Member Onboarding', desc: 'Welcome checklist for new server members', steps: ['Introduce in #welcome', 'Assign roles', 'Share server guidelines', 'Add to relevant channels', 'Schedule intro meeting', 'Check in after 1 week'] },
          { name: 'Release Checklist', desc: 'Pre-deployment verification steps', steps: ['Code review approved', 'Tests passing', 'Changelog updated', 'Version bumped', 'Staging deploy verified', 'Production deploy', 'Smoke test production', 'Announce in #releases'] },
        ];

        const loadPb = () => api.listPlaybooks(server.id).then(p => setPlaybooks(Array.isArray(p) ? p : []));

        return (<>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Playbooks — {playbooks.length}
          </span>
          <button onClick={() => { setShowCreatePlaybook(p => !p); setNewPbName(''); setNewPbDesc(''); setNewPbSteps([]); }}
            style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {showCreatePlaybook ? 'Cancel' : '+ Create Playbook'}
          </button>
        </div>

        {/* Templates */}
        {!showCreatePlaybook && playbooks.length === 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Templates</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {TEMPLATES.map(tmpl => (
                <div key={tmpl.name} onClick={async () => {
                  try { await api.createPlaybook(server.id, { name: tmpl.name, description: tmpl.desc, steps: tmpl.steps.map(s => ({ title: s })) }); loadPb(); } catch {}
                }} style={{ padding: '12px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = T.ac}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.bd}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 4 }}>{tmpl.name}</div>
                  <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4 }}>{tmpl.desc}</div>
                  <div style={{ fontSize: 10, color: T.ac, marginTop: 6 }}>{tmpl.steps.length} steps</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Create form */}
        {showCreatePlaybook && (
          <div style={{ padding: '14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>New Playbook</div>
            <input value={newPbName} onChange={e => setNewPbName(e.target.value)} placeholder="Playbook name" style={{ ...getInp(), marginBottom: 8 }} />
            <textarea value={newPbDesc} onChange={e => setNewPbDesc(e.target.value)} placeholder="Description (optional)" rows={2} style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 10 }} />
            <div style={{ fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6 }}>Steps</div>
            {newPbSteps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: T.mt, width: 16, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                <input value={step.title} onChange={e => setNewPbSteps(p => p.map((s, j) => j === i ? { ...s, title: e.target.value } : s))} placeholder={`Step ${i + 1}`} style={{ ...getInp(), flex: 1, fontSize: 12, padding: '5px 8px' }} />
                <select value={step.assignee_id || ''} onChange={e => setNewPbSteps(p => p.map((s, j) => j === i ? { ...s, assignee_id: e.target.value || undefined } : s))} style={{ ...getInp(), width: 120, fontSize: 11, padding: '5px 6px', flexShrink: 0 }}>
                  <option value="">Unassigned</option>
                  {mgmtMembers.filter(m => !m.is_bot).map(m => <option key={m.user_id} value={m.user_id}>{m.display_name || m.username}</option>)}
                </select>
                <button onClick={() => setNewPbSteps(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: T.err, cursor: 'pointer', fontSize: 13, padding: 2 }}>✕</button>
              </div>
            ))}
            <button onClick={() => setNewPbSteps(p => [...p, { title: '' }])} style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.mt, fontSize: 11, padding: '4px 10px', cursor: 'pointer', marginBottom: 10 }}>+ Add Step</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={async () => {
                if (!newPbName.trim()) return;
                const steps = newPbSteps.filter(s => s.title.trim()).map(s => ({ title: s.title.trim(), assignee_id: s.assignee_id }));
                try { await api.createPlaybook(server.id, { name: newPbName.trim(), description: newPbDesc.trim() || undefined, steps: steps.length > 0 ? steps : undefined }); setShowCreatePlaybook(false); loadPb(); } catch {}
              }} disabled={!newPbName.trim()} style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: newPbName.trim() ? 'pointer' : 'not-allowed', opacity: newPbName.trim() ? 1 : 0.5 }}>Create</button>
              {/* Template quick-fill */}
              <select onChange={e => { const t = TEMPLATES.find(t => t.name === e.target.value); if (t) { setNewPbName(t.name); setNewPbDesc(t.desc); setNewPbSteps(t.steps.map(s => ({ title: s }))); } e.target.value = ''; }} style={{ ...getInp(), fontSize: 11, padding: '5px 8px', width: 'auto' }}>
                <option value="">Use template...</option>
                {TEMPLATES.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Playbook list */}
        {playbooks.length === 0 && !showCreatePlaybook && (
          <div style={{ textAlign: 'center', padding: '24px 20px', color: T.mt }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>No playbooks yet</div>
            <div style={{ fontSize: 12 }}>Create a playbook or use a template above to get started.</div>
          </div>
        )}
        {playbooks.map((pb: any) => {
          const isExpanded = expandedPb === pb.id;
          const steps: any[] = pb.steps || [];
          const progress = pb.progress || { total: steps.length, completed: steps.filter((s: any) => s.completed).length, percent: 0 };
          if (progress.total > 0 && !progress.percent) progress.percent = Math.round((progress.completed / progress.total) * 100);
          return (
            <div key={pb.id} style={{ background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 8, overflow: 'hidden' }}>
              {/* Header */}
              <div onClick={() => setExpandedPb(isExpanded ? null : pb.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
                <span style={{ fontSize: 12, color: T.mt }}>{isExpanded ? '▼' : '▶'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>{pb.name}</div>
                  {pb.description && <div style={{ fontSize: 11, color: T.mt, marginTop: 1 }}>{pb.description}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: progress.percent === 100 ? '#3ba55d' : T.mt, fontWeight: 600 }}>{progress.completed}/{progress.total}</span>
                  <div style={{ width: 60, height: 6, borderRadius: 3, background: T.bg, overflow: 'hidden' }}>
                    <div style={{ width: `${progress.percent}%`, height: '100%', borderRadius: 3, background: progress.percent === 100 ? '#3ba55d' : T.ac, transition: 'width .3s' }} />
                  </div>
                </div>
                <button onClick={async (e) => { e.stopPropagation(); if (await showConfirm('Delete Playbook', `Delete "${pb.name}" and all its steps?`, true)) { await api.deletePlaybook(pb.id); loadPb(); } }} style={{ background: 'none', border: 'none', color: T.err, cursor: 'pointer', padding: 4, fontSize: 12, opacity: 0.6 }} title="Delete"><I.Trash /></button>
              </div>

              {/* Expanded steps */}
              {isExpanded && (
                <div style={{ borderTop: `1px solid ${T.bd}`, padding: '8px 12px' }}>
                  {steps.length === 0 && <div style={{ fontSize: 11, color: T.mt, padding: '8px 0', textAlign: 'center' }}>No steps — add one below</div>}
                  {steps.map((step: any) => (
                    <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderRadius: 6 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div onClick={async () => {
                        try {
                          const res = await api.completePlaybookStep(pb.id, step.id);
                          setPlaybooks(prev => prev.map(p => p.id === pb.id ? { ...p, steps: p.steps.map((s: any) => s.id === step.id ? { ...s, completed: res.completed, completed_at: res.completed ? new Date().toISOString() : null, completed_by: res.completed ? api.userId : null } : s), progress: res.progress } : p));
                        } catch {}
                      }} style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${step.completed ? '#3ba55d' : T.bd}`, background: step.completed ? '#3ba55d' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                        {step.completed && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: step.completed ? T.mt : T.tx, textDecoration: step.completed ? 'line-through' : 'none' }}>{step.title}</div>
                        {step.completed_by && step.completed_at && (
                          <div style={{ fontSize: 10, color: T.mt }}>{getName(step.completed_by)} · {new Date(step.completed_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                        )}
                      </div>
                      {step.assignee_id && (
                        <div title={getName(step.assignee_id)} style={{ flexShrink: 0 }}>
                          <Av name={getName(step.assignee_id)} size={20} />
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Add step inline */}
                  {React.createElement(function AddStepInline() {
                    const [title, setTitle] = useState('');
                    const [assignee, setAssignee] = useState('');
                    return (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={async e => { if (e.key === 'Enter' && title.trim()) { try { await api.addPlaybookStep(pb.id, { title: title.trim(), assignee_id: assignee || undefined }); loadPb(); setTitle(''); } catch {} } }} placeholder="Add a step..." style={{ ...getInp(), flex: 1, fontSize: 11, padding: '4px 8px' }} />
                        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ ...getInp(), width: 100, fontSize: 10, padding: '4px 4px', flexShrink: 0 }}>
                          <option value="">Assign</option>
                          {mgmtMembers.filter(m => !m.is_bot).map(m => <option key={m.user_id} value={m.user_id}>{m.display_name || m.username}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        </>);
      })()}

      {tab === 'automation' && (<>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Scheduled Tasks — {tasks.length}
          </span>
          <button
            onClick={() => setShowAddTask(p => !p)}
            style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >{showAddTask ? 'Cancel' : '+ Add Task'}</button>
        </div>

        {/* Add Task form */}
        {showAddTask && (
          <div style={{ padding: '14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>New Task</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Task Type</label>
                <select value={newTaskType} onChange={e => { setNewTaskType(e.target.value); setNewTaskConfig({}); }} style={{ ...getInp(), fontSize: 12 }}>
                  <option value="channel_monitor">Channel Monitor</option>
                  <option value="announcement">Recurring Message</option>
                  <option value="reminder">Daily Digest / Reminder</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Channel</label>
                <select value={newTaskChannel} onChange={e => setNewTaskChannel(e.target.value)} style={{ ...getInp(), fontSize: 12 }}>
                  <option value="">Select channel...</option>
                  {channels.filter(c => c.channel_type !== 'voice').map(c => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Channel Monitor sub-type */}
            {newTaskType === 'channel_monitor' && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Monitor Type</label>
                <select value={newTaskMonitorType} onChange={e => setNewTaskMonitorType(e.target.value)} style={{ ...getInp(), fontSize: 12 }}>
                  <option value="action_items">Action Items — detect TODO/action phrases</option>
                  <option value="thread_summary">Thread Summary — summarize busy threads (20+ msgs)</option>
                  <option value="inactive_alert">Inactive Alert — notify after silence</option>
                </select>
                {newTaskMonitorType === 'inactive_alert' && (
                  <div style={{ marginTop: 6 }}>
                    <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Days before alert</label>
                    <input type="number" min="1" max="90" value={newTaskConfig.inactive_days || 7} onChange={e => setNewTaskConfig(p => ({ ...p, inactive_days: parseInt(e.target.value) || 7 }))} style={{ ...getInp(), fontSize: 12, width: 80 }} />
                  </div>
                )}
              </div>
            )}

            {/* Announcement message */}
            {newTaskType === 'announcement' && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Message</label>
                <textarea value={newTaskConfig.message || ''} onChange={e => setNewTaskConfig(p => ({ ...p, message: e.target.value }))} placeholder="Message to post on schedule..." rows={2} style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
            )}

            {/* Schedule */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Schedule (cron)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                {[
                  { label: 'Every 6h', cron: '0 */6 * * *' },
                  { label: 'Daily 9am', cron: '0 9 * * *' },
                  { label: 'Mon-Fri 9am', cron: '0 9 * * 1-5' },
                  { label: 'Weekly Sun', cron: '0 10 * * 0' },
                  { label: 'Hourly', cron: '0 * * * *' },
                ].map(p => (
                  <button key={p.cron} onClick={() => setNewTaskCron(p.cron)}
                    style={{ padding: '3px 8px', borderRadius: 4, border: `1px solid ${newTaskCron === p.cron ? T.ac : T.bd}`, background: newTaskCron === p.cron ? `${ta(T.ac,'18')}` : T.bg, color: newTaskCron === p.cron ? T.ac : T.mt, fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <input value={newTaskCron} onChange={e => setNewTaskCron(e.target.value)} placeholder="min hour dom month dow" style={{ ...getInp(), fontSize: 12, fontFamily: 'var(--font-mono)' }} />
              <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>5-field cron: minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6)</div>
            </div>

            <button
              onClick={async () => {
                if (!newTaskChannel) return;
                const config = newTaskType === 'channel_monitor'
                  ? { monitor_type: newTaskMonitorType, ...newTaskConfig }
                  : { ...newTaskConfig };
                try {
                  await api.createTask(server.id, {
                    channel_id: newTaskChannel,
                    task_type: newTaskType,
                    config,
                    cron_expr: newTaskCron,
                  });
                  setShowAddTask(false);
                  setNewTaskConfig({});
                  api.listTasks(server.id).then(t => setTasks(Array.isArray(t) ? t : []));
                } catch { /* validation error shown by API */ }
              }}
              disabled={!newTaskChannel}
              style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: newTaskChannel ? 'pointer' : 'not-allowed', opacity: newTaskChannel ? 1 : 0.5 }}
            >Create Task</button>
          </div>
        )}

        {/* Task list */}
        {tasks.length === 0 && !showAddTask && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>⚙</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>No automated tasks</div>
            <div style={{ fontSize: 12, color: T.mt }}>Create a task to monitor channels, send recurring messages, or get daily digests.</div>
          </div>
        )}
        {tasks.map((task: any) => {
          const chName = channels.find(c => c.id === task.channel_id)?.name;
          const typeLabels: Record<string, string> = {
            channel_monitor: '📋 Channel Monitor',
            announcement: '📢 Recurring Message',
            reminder: '🔔 Daily Digest',
            purge: '🧹 Channel Purge',
            backup: '💾 Backup',
            role_rotate: '🔄 Role Rotate',
          };
          const monitorType = task.config?.monitor_type;
          const monitorLabels: Record<string, string> = {
            action_items: 'Action Items',
            thread_summary: 'Thread Summary',
            inactive_alert: 'Inactive Alert',
          };
          return (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 6, opacity: task.enabled ? 1 : 0.5 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{typeLabels[task.task_type] || task.task_type}</span>
                  {monitorType && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `${ta(T.ac,'15')}`, color: T.ac, fontWeight: 600 }}>{monitorLabels[monitorType] || monitorType}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 11, color: T.mt }}>
                  {chName && <span>#{chName}</span>}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{task.cron_expr}</span>
                  {task.last_run && <span>Last: {new Date(task.last_run).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                  {!task.last_run && <span style={{ fontStyle: 'italic' }}>Never run</span>}
                </div>
              </div>
              {/* Toggle */}
              <div onClick={async () => {
                try {
                  const res = await api.toggleTask(task.id);
                  setTasks(prev => prev.map(t => t.id === task.id ? { ...t, enabled: res.enabled } : t));
                } catch {}
              }} role="switch" aria-checked={task.enabled} style={{ width: 36, height: 20, borderRadius: 10, background: task.enabled ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: task.enabled ? 18 : 2, transition: 'left .2s' }} />
              </div>
              {/* Delete */}
              <button onClick={async () => {
                if (await showConfirm('Delete Task', `Delete this ${typeLabels[task.task_type] || 'task'}? This cannot be undone.`, true)) {
                  try { await api.deleteTask(task.id); setTasks(prev => prev.filter(t => t.id !== task.id)); } catch {}
                }
              }} style={{ background: 'none', border: 'none', color: T.err, cursor: 'pointer', padding: 4, fontSize: 13, opacity: 0.7 }} title="Delete task"><I.Trash /></button>
            </div>
          );
        })}
      </>)}

      {tab === 'webhooks' && (
        <WebhookSettings serverId={server.id} channels={channels} />
      )}

      {tab === 'audit' && (<>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={async () => { setVerifying(true); const r = await api.verifyAuditChain(server.id); setChainVerify(r); setVerifying(false); }}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: chainVerify?.chain_intact ? '#00d4aa' : T.ac, color: chainVerify?.chain_intact ? '#000' : '#fff' }}>
            {verifying ? 'Verifying...' : 'Verify Chain Integrity'}
          </button>
          {chainVerify && (
            <span style={{ fontSize: 12, color: chainVerify.chain_intact ? '#00d4aa' : '#ff4757', fontWeight: 600 }}>
              {chainVerify.chain_intact
                ? `Chain intact — ${chainVerify.verified_entries} entries verified`
                : `CHAIN BROKEN at seq #${chainVerify.first_broken_at}: ${chainVerify.first_broken_reason}`}
            </span>
          )}
        </div>
        {auditLog.length === 0 && <div style={{ color: T.mt, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No audit log entries</div>}
        {auditLog.map(e => (
          <div key={e.id} style={{ padding: '8px 10px', borderRadius: 'var(--radius-md)', marginBottom: 4, background: T.sf2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Av name={e.actor_username || '?'} size={24} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{e.actor_username || '?'}</span>{' '}
                <span style={{ fontSize: 13, color: T.mt }}>{actionLabels[e.action] || e.action}</span>
                {e.reason && <span style={{ fontSize: 12, color: T.mt }}> — {e.reason}</span>}
              </div>
              <span style={{ fontSize: 11, color: T.mt, whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleDateString()}</span>
            </div>
            {e.chain_hash && (
              <div style={{ marginTop: 4, paddingInlineStart: 34, fontSize: 10, fontFamily: 'monospace', color: T.mt, opacity: 0.6 }}>
                #{e.sequence_num} — {e.chain_hash?.slice(0, 16)}...
              </div>
            )}
          </div>
        ))}
      </>)}
      </div>{/* end content */}
      </div>{/* end sidebar+content flex */}
    </Modal>
  );
}

// ─── Transfer Ownership ──────────────────────────────────────────────────

function TransferOwnership({ serverId, serverName, members, getName, showConfirm, onUpdate }: {
  serverId: string;
  serverName: string;
  members: any[];
  getName: (uid: string) => string;
  showConfirm: (...args: any[]) => Promise<boolean>;
  onUpdate?: () => void;
}) {
  const [step, setStep] = React.useState<'idle' | 'select' | 'password'>('idle');
  const [selectedId, setSelectedId] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmName, setConfirmName] = React.useState('');
  const [error, setError] = React.useState('');
  const [transferring, setTransferring] = React.useState(false);

  const eligible = members.filter(m => m.user_id !== api.userId);
  const selectedName = selectedId ? getName(selectedId) : '';

  const doTransfer = async () => {
    if (confirmName !== serverName) { setError('Server name does not match'); return; }
    setError('');
    setTransferring(true);
    try {
      // Verify password first.
      await api.verifyPassword(password);
      await api.transferServer(serverId, selectedId);
      setStep('idle');
      if (onUpdate) onUpdate();
    } catch (e: any) {
      setError(e?.message || 'Transfer failed');
    }
    setTransferring(false);
  };

  if (step === 'idle') {
    return (
      <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,71,87,0.04)', borderRadius: 10, border: '1px solid rgba(255,71,87,0.15)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.err, textTransform: 'uppercase', marginBottom: 8 }}>Transfer Ownership</div>
        <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6, marginBottom: 12 }}>
          Transfer this server to another member. This action is <strong style={{ color: T.err }}>irreversible</strong> — you will lose all owner-level permissions.
        </div>
        <button onClick={() => { setStep('select'); setError(''); setSelectedId(''); setConfirmName(''); setPassword(''); }}
          style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.4)', background: 'rgba(255,71,87,0.08)', color: T.err, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Transfer Ownership
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,71,87,0.06)', borderRadius: 10, border: '1px solid rgba(255,71,87,0.25)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.err, marginBottom: 12 }}>Transfer Ownership of {serverName}</div>

      {/* Step 1: Select new owner */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>New Owner</label>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: selectedId ? T.tx : T.mt, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          aria-label="Select new owner"
        >
          <option value="">Select a member...</option>
          {eligible.map(m => (
            <option key={m.user_id} value={m.user_id}>{getName(m.user_id)} ({m.username || m.user_id.slice(0, 8)})</option>
          ))}
        </select>
      </div>

      {selectedId && (<>
        {/* Step 2: Warning */}
        <div style={{ padding: '12px 14px', background: 'rgba(255,71,87,0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.3)', marginBottom: 14, fontSize: 12, color: T.err, lineHeight: 1.6 }}>
          You are about to transfer ownership of <strong>{serverName}</strong> to <strong>{selectedName}</strong>. This action is <strong>IRREVERSIBLE</strong>. You will lose all owner-level permissions.
        </div>

        {/* Step 3: Type server name */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>
            Type the server name to confirm: <span style={{ color: T.tx, fontFamily: 'monospace' }}>{serverName}</span>
          </label>
          <input
            value={confirmName}
            onChange={e => setConfirmName(e.target.value)}
            placeholder={serverName}
            style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${confirmName === serverName ? 'rgba(255,71,87,0.5)' : T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            aria-label="Confirm server name"
          />
        </div>

        {/* Step 4: Password verification */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Enter Your Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Your password"
            style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            aria-label="Password"
            onKeyDown={e => { if (e.key === 'Enter' && confirmName === serverName && password) doTransfer(); }}
          />
        </div>
      </>)}

      {error && (
        <div style={{ fontSize: 11, color: T.err, padding: '6px 10px', background: 'rgba(255,71,87,0.08)', borderRadius: 4, marginBottom: 10 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setStep('idle')}
          style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
        <button
          onClick={doTransfer}
          disabled={!selectedId || confirmName !== serverName || !password || transferring}
          style={{
            padding: '8px 18px', borderRadius: 'var(--radius-md)', border: 'none',
            background: !selectedId || confirmName !== serverName || !password || transferring ? T.sf2 : T.err,
            color: !selectedId || confirmName !== serverName || !password || transferring ? T.mt : '#fff',
            fontSize: 12, fontWeight: 700,
            cursor: !selectedId || confirmName !== serverName || !password || transferring ? 'not-allowed' : 'pointer',
          }}
        >
          {transferring ? 'Transferring...' : 'Transfer Ownership'}
        </button>
      </div>
    </div>
  );
}
