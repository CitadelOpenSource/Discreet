/**
 * useSlashCommands — slash command definitions, filtering hook, suggestion UI,
 * and async command executor.
 *
 * Exports:
 *   SLASH_COMMANDS       — full list of available commands
 *   useSlashCommands()   — filters suggestions based on current input
 *   SlashSuggestions     — dropdown UI component
 *   processSlashCommand  — async executor (call from message send handler)
 */
import React from 'react';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';
import { Av } from '../components/Av';

// ─── Types ────────────────────────────────────────────────

export interface SlashCommand {
  c:    string;  // e.g. "/ban"
  d:    string;  // description
  icon: string;  // emoji
}

export interface SlashMember {
  user_id:   string;
  username?: string;
}

export interface SlashRole {
  id:     string;
  name?:  string;
  color?: string;
}

/** Contextual state that processSlashCommand needs from the App. */
export interface SlashContext {
  members:           SlashMember[];
  allRoles:          SlashRole[];
  curServer:         { id: string; owner_id?: string } | null;
  curChannel:        { id: string } | null;
  voiceChannel:      { id: string } | null;
  setMembers:        (fn: (prev: SlashMember[]) => SlashMember[]) => void;
  setModal:          (modal: unknown) => void;
  setShowInputEmoji: (show: boolean) => void;
  setWatchParty:     (wp: unknown) => void;
  setShowMeeting:    (show: boolean) => void;
  handleAssignRole:  (userId: string, roleId: string) => Promise<void>;
  loadMsgs:          () => void;
  setInput?:         (text: string) => void;
  goDiscover?:       () => void;
}

// ─── Command Definitions ──────────────────────────────────

export const SLASH_COMMANDS: SlashCommand[] = [
  { c: '/ban',       d: 'Ban a user [reason]',    icon: '🔨' },
  { c: '/kick',      d: 'Kick a user [reason]',   icon: '👢' },
  { c: '/role',      d: 'Assign role',            icon: '🏷️' },
  { c: '/nick',      d: 'Set nickname',           icon: '✏️' },
  { c: '/audit',     d: 'View audit log',         icon: '📋' },
  { c: '/settings',  d: 'Server settings',        icon: '⚙️' },
  { c: '/invite',    d: 'Create invite',          icon: '🔗' },
  { c: '/pin',       d: 'Pin last message',       icon: '📌' },
  { c: '/emoji',     d: 'Open emoji picker',      icon: '😀' },
  { c: '/watch',     d: 'Watch YouTube together', icon: '📺' },
  { c: '/stopwatch', d: 'End watch party',        icon: '⏹' },
  { c: '/poll',      d: 'Create a poll',          icon: '📊' },
  { c: '/meeting',   d: 'Start a meeting',        icon: '📹' },
  { c: '/meet',      d: 'Start a meeting',        icon: '📹' },
  { c: '/calc',      d: 'Evaluate math',          icon: '🧮' },
  { c: '/discover',  d: 'Discover servers',       icon: '🔭' },
];

// ─── Suggestion result shape ──────────────────────────────

type SuggestionResult =
  | { kind: 'commands'; items: SlashCommand[] }
  | { kind: 'members';  cmd: string; items: SlashMember[] }
  | { kind: 'roles';    username: string; items: SlashRole[] }
  | { kind: 'none' };

// ─── Hook ─────────────────────────────────────────────────

/**
 * Derives the autocomplete suggestion state from the current input string.
 * Returns null when input doesn't start with "/".
 */
export function useSlashCommands(
  input:   string,
  members: SlashMember[],
  roles:   SlashRole[],
): SuggestionResult | null {
  if (!input.startsWith('/')) return null;

  const parts = input.split(' ');
  const cmd   = parts[0].toLowerCase();
  const arg   = parts.slice(1).join(' ').toLowerCase();

  // Show full command list on bare "/"
  if (input === '/') {
    return { kind: 'commands', items: SLASH_COMMANDS };
  }

  // Show filtered command list while typing the command name (no space yet)
  if (!input.includes(' ')) {
    const filtered = SLASH_COMMANDS.filter(sc => sc.c.startsWith(cmd));
    return filtered.length ? { kind: 'commands', items: filtered } : { kind: 'none' };
  }

  // Member picker for /ban, /kick, /role (second argument)
  if (['/ban', '/kick', '/role'].includes(cmd) && parts.length <= 2) {
    const filtered = (members || []).filter(m =>
      !arg || m.username?.toLowerCase().includes(arg),
    );
    return filtered.length ? { kind: 'members', cmd, items: filtered } : { kind: 'none' };
  }

  // Role picker for /role <username> <role>
  if (cmd === '/role' && parts.length >= 3) {
    const rArg     = parts.slice(2).join(' ').toLowerCase();
    const filtered = (roles || []).filter(r =>
      !rArg || r.name?.toLowerCase().includes(rArg),
    );
    return { kind: 'roles', username: parts[1], items: filtered };
  }

  return { kind: 'none' };
}

// ─── SlashSuggestions UI ──────────────────────────────────

export interface SlashSuggestionsProps {
  input:   string;
  members: SlashMember[];
  roles:   SlashRole[];
  /** Called when user selects a suggestion — replaces current input. */
  onSet:   (value: string) => void;
}

export function SlashSuggestions({ input, members, roles, onSet }: SlashSuggestionsProps) {
  const result = useSlashCommands(input, members, roles);
  if (!result || result.kind === 'none') return null;

  const box: React.CSSProperties = {
    position: 'absolute', bottom: '100%', left: 0, right: 0,
    background: '#111320', borderRadius: '8px 8px 0 0',
    border: `1px solid ${T.bd}`, borderBottom: 'none',
    padding: 6, zIndex: 50, maxHeight: 240, overflowY: 'auto',
  };
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px', borderRadius: 5, cursor: 'pointer',
    fontSize: 13, transition: 'background .1s',
  };
  const hov  = (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; };
  const uhov = (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = 'transparent'; };

  if (result.kind === 'commands') {
    return (
      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: '4px 8px', textTransform: 'uppercase' }}>Commands</div>
        {result.items.map(c => (
          <div key={c.c} onClick={() => onSet(c.c + ' ')} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
            <span>{c.icon}</span>
            <span style={{ color: T.ac, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{c.c}</span>
            <span style={{ color: T.mt, fontSize: 12 }}>{c.d}</span>
          </div>
        ))}
      </div>
    );
  }

  if (result.kind === 'members') {
    return (
      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: '4px 8px' }}>Select member:</div>
        {result.items.slice(0, 8).map(m => (
          <div key={m.user_id} onClick={() => onSet(result.cmd + ' ' + m.username + ' ')} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
            <Av name={m.username || '?'} size={22} />
            <span style={{ color: T.tx }}>{m.username}</span>
          </div>
        ))}
      </div>
    );
  }

  if (result.kind === 'roles') {
    return (
      <div style={box}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: '4px 8px' }}>Select role for {result.username}:</div>
        {result.items.map(r => (
          <div key={r.id} onClick={() => onSet('/role ' + result.username + ' ' + r.name)} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: r.color || T.ac }} />
            <span style={{ color: r.color || T.tx }}>{r.name}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Command Executor ─────────────────────────────────────

/**
 * Executes a slash command string.
 * Returns true if the command was handled (caller should not send as message).
 * Returns false if unrecognised or missing arguments.
 */
export async function processSlashCommand(
  txt: string,
  ctx: SlashContext,
): Promise<boolean> {
  const parts = txt.split(' ');
  const cmd   = parts[0].toLowerCase();
  const arg1  = parts[1];
  const rest  = parts.slice(2).join(' ');

  // /ban <username> [reason]
  if (cmd === '/ban' && arg1) {
    const target = ctx.members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
    if (!target) return false;
    await api.banUser(ctx.curServer!.id, target.user_id, rest || 'No reason');
    api.listMembers(ctx.curServer!.id).then((m: SlashMember[]) => {
      if (Array.isArray(m)) ctx.setMembers(() => m);
    });
    return true;
  }

  // /kick <username> [reason]  (ban + immediate unban)
  if (cmd === '/kick' && arg1) {
    const target = ctx.members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
    if (!target) return false;
    const reason = rest || 'Kicked';
    await api.banUser(ctx.curServer!.id, target.user_id, reason);
    await api.unbanUser(ctx.curServer!.id, target.user_id);
    api.listMembers(ctx.curServer!.id).then((m: SlashMember[]) => {
      if (Array.isArray(m)) ctx.setMembers(() => m);
    });
    return true;
  }

  // /role <username> <role name>
  if (cmd === '/role' && arg1 && parts.length >= 3) {
    const roleName = parts.slice(2).join(' ');
    const target   = ctx.members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
    const role     = ctx.allRoles.find(r => r.name?.toLowerCase() === roleName.toLowerCase());
    if (target && role) {
      await ctx.handleAssignRole(target.user_id, role.id);
      return true;
    }
    return false;
  }

  // /audit — open server settings (audit tab)
  if (cmd === '/audit') { ctx.setModal('server-settings'); return true; }

  // /settings — open server settings
  if (cmd === '/settings') { ctx.setModal('server-settings'); return true; }

  // /invite — create and display an invite link
  if (cmd === '/invite') {
    const inv = await api.createInvite(ctx.curServer!.id, 0, 168);
    ctx.setModal({ type: 'invite', data: inv });
    return true;
  }

  // /emoji — open the emoji picker
  if (cmd === '/emoji') { ctx.setShowInputEmoji(true); return true; }

  // /poll "Question?" "Option1" "Option2" ...   or   /poll Q | Opt1 | Opt2
  if (cmd === '/poll' && ctx.curChannel) {
    // Quoted format: /poll "Question?" "Opt1" "Opt2"
    const matches = txt.match(/"([^"]+)"/g);
    if (matches && matches.length >= 3) {
      const question = matches[0].replace(/"/g, '');
      const options  = matches.slice(1).map(m => m.replace(/"/g, ''));
      const result   = await api.createPoll(ctx.curChannel.id, question, options);
      if (result?.id) ctx.loadMsgs();
      return true;
    }
    // Pipe format: /poll Question | Opt1 | Opt2
    const pipeStr = arg1 ? (arg1 + (rest ? ' ' + rest : '')) : '';
    if (pipeStr.includes('|')) {
      const pipeParts = pipeStr.split('|').map((s: string) => s.trim()).filter(Boolean);
      if (pipeParts.length >= 3) {
        const result = await api.createPoll(ctx.curChannel.id, pipeParts[0], pipeParts.slice(1));
        if (result?.id) ctx.loadMsgs();
        return true;
      }
    }
    return false;
  }

  // /meeting [title] or /meet
  if (cmd === '/meeting' || cmd === '/meet') {
    ctx.setShowMeeting(true);
    return true;
  }

  // /calc <expression>
  if (cmd === '/calc') {
    const expr = parts.slice(1).join(' ').trim();
    if (!expr) return false;
    try {
      // Whitelist: only allow digits, operators, parens, spaces, dots, e/E for exponents
      if (!/^[\d\s+\-*/%.()^eE,]+$/.test(expr)) {
        ctx.setInput?.(`/calc → Error: invalid characters`);
        return true;
      }
      // Replace ^ with ** for exponentiation
      const safeExpr = expr.replace(/\^/g, '**');
      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${safeExpr})`)();
      ctx.setInput?.(`/calc ${expr} = ${result}`);
    } catch {
      ctx.setInput?.(`/calc → Error: could not evaluate`);
    }
    return true;
  }

  // /discover — open discover panel
  if (cmd === '/discover') {
    ctx.goDiscover?.();
    return true;
  }

  // /watch <youtube-url>
  if (cmd === '/watch' && arg1 && ctx.voiceChannel) {
    const ytMatch = arg1.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    );
    if (ytMatch) {
      const wp = { url: arg1, videoId: ytMatch[1], startedBy: api.username, startedAt: Date.now() };
      ctx.setWatchParty(wp);
      (api as any).ws?.send(JSON.stringify({ type: 'watch_party', channel_id: ctx.voiceChannel.id, ...wp }));
      return true;
    }
    return false;
  }

  // /stopwatch / /endwatch
  if ((cmd === '/stopwatch' || cmd === '/endwatch') && ctx.voiceChannel) {
    ctx.setWatchParty(null);
    (api as any).ws?.send(JSON.stringify({ type: 'watch_party_end', channel_id: ctx.voiceChannel.id }));
    return true;
  }

  return false;
}
