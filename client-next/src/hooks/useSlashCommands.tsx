/**
 * useSlashCommands — slash command registry, suggestion UI, and executor.
 *
 * Each command declares:
 *   name           — the /command string
 *   description    — shown in autocomplete
 *   icon           — emoji prefix
 *   visibleToOthers — true if the output goes into chat (e.g. /shrug)
 *   guestAllowed   — true if guests can use it
 *   args?          — arg placeholder for autocomplete hint
 *   handler        — async executor, returns true if handled
 *
 * Exports:
 *   SLASH_COMMANDS       — full registry
 *   SlashSuggestions     — dropdown UI component
 *   processSlashCommand  — async executor
 */
import React from 'react';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';
import { Av } from '../components/Av';

// ─── Types ────────────────────────────────────────────────

export interface SlashMember {
  user_id:   string;
  username?: string;
  display_name?: string;
}

export interface SlashRole {
  id:     string;
  name?:  string;
  color?: string;
}

/** Contextual state passed to command handlers. */
export interface SlashContext {
  members:           SlashMember[];
  allRoles:          SlashRole[];
  curServer:         { id: string; owner_id?: string } | null;
  curChannel:        { id: string } | null;
  voiceChannel:      { id: string } | null;
  isGuest:           boolean;
  setMembers:        (fn: (prev: SlashMember[]) => SlashMember[]) => void;
  setModal:          (modal: unknown) => void;
  setShowInputEmoji: (show: boolean) => void;
  setWatchParty:     (wp: unknown) => void;
  setShowMeeting:    (show: boolean) => void;
  handleAssignRole:  (userId: string, roleId: string) => Promise<void>;
  loadMsgs:          () => void;
  setInput?:         (text: string) => void;
  goDiscover?:       () => void;
  setSlashTool?:     (tool: 'calc' | 'convert' | 'color' | null) => void;
  changeStatus?:     (status: string) => void;
  setToast?:         (msg: string) => void;
  logout?:           () => void;
  clearMessages?:    () => void;
}

export interface SlashCommandDef {
  name:             string;   // e.g. "/shrug"
  description:      string;
  icon:             string;
  visibleToOthers:  boolean;  // true = output goes into chat
  guestAllowed:     boolean;
  args?:            string;   // hint, e.g. "<expression>"
  handler: (args: string, ctx: SlashContext) => Promise<{ handled: boolean; sendText?: string }>;
}

// ─── Command Registry ────────────────────────────────────

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // ── Visible (output goes into the message) ───────────────
  {
    name: '/shrug', description: 'Append ¯\\_(ツ)_/¯', icon: '🤷',
    visibleToOthers: true, guestAllowed: false,
    handler: async (args) => ({ handled: true, sendText: (args ? args + ' ' : '') + '¯\\_(ツ)_/¯' }),
  },
  {
    name: '/tableflip', description: 'Append (╯°□°)╯︵ ┻━┻', icon: '🪑',
    visibleToOthers: true, guestAllowed: false,
    handler: async (args) => ({ handled: true, sendText: (args ? args + ' ' : '') + '(╯°□°)╯︵ ┻━┻' }),
  },
  {
    name: '/unflip', description: 'Append ┬─┬ノ( º _ ºノ)', icon: '🪑',
    visibleToOthers: true, guestAllowed: false,
    handler: async (args) => ({ handled: true, sendText: (args ? args + ' ' : '') + '┬─┬ノ( º _ ºノ)' }),
  },
  {
    name: '/lenny', description: 'Append ( ͡° ͜ʖ ͡°)', icon: '😏',
    visibleToOthers: true, guestAllowed: false,
    handler: async (args) => ({ handled: true, sendText: (args ? args + ' ' : '') + '( ͡° ͜ʖ ͡°)' }),
  },

  // ── Tool overlays ────────────────────────────────────────
  {
    name: '/calc', description: 'Open calculator', icon: '🧮', args: '[expression]',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      if (args.trim()) {
        // Inline evaluate
        if (!/^[\d\s+\-*/%.()^eE,]+$/.test(args)) {
          ctx.setToast?.('Calc: invalid characters');
          return { handled: true };
        }
        const safeExpr = args.replace(/\^/g, '**');
        try {
          // eslint-disable-next-line no-new-func
          const result = new Function(`"use strict"; return (${safeExpr})`)();
          ctx.setInput?.(`${args} = ${result}`);
        } catch { ctx.setToast?.('Calc: could not evaluate'); }
        return { handled: true };
      }
      ctx.setSlashTool?.('calc');
      return { handled: true };
    },
  },
  {
    name: '/convert', description: 'Open unit converter', icon: '📏',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.setSlashTool?.('convert'); return { handled: true }; },
  },
  {
    name: '/color', description: 'Open color picker', icon: '🎨',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.setSlashTool?.('color'); return { handled: true }; },
  },

  // ── Presence / status (silent) ───────────────────────────
  {
    name: '/afk', description: 'Set Away with auto-response', icon: '💤', args: '[message]',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      const msg = args.trim() || 'I\'m AFK';
      ctx.changeStatus?.('idle');
      api.fetch('/users/@me/status', { method: 'PUT', body: JSON.stringify({ presence: 'idle', auto_response: msg }) }).catch(() => {});
      ctx.setToast?.(`Away: "${msg}"`);
      return { handled: true };
    },
  },
  {
    name: '/away', description: 'Set Away with auto-response', icon: '💤', args: '[message]',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      const msg = args.trim() || 'I\'m away';
      ctx.changeStatus?.('idle');
      api.fetch('/users/@me/status', { method: 'PUT', body: JSON.stringify({ presence: 'idle', auto_response: msg }) }).catch(() => {});
      ctx.setToast?.(`Away: "${msg}"`);
      return { handled: true };
    },
  },
  {
    name: '/brb', description: 'Set Away — be right back', icon: '🔙',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => {
      ctx.changeStatus?.('idle');
      api.fetch('/users/@me/status', { method: 'PUT', body: JSON.stringify({ presence: 'idle', auto_response: 'Be right back' }) }).catch(() => {});
      ctx.setToast?.('Away: "Be right back"');
      return { handled: true };
    },
  },
  {
    name: '/idle', description: 'Set status to Idle', icon: '🌙',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.changeStatus?.('idle'); ctx.setToast?.('Status: Idle'); return { handled: true }; },
  },
  {
    name: '/online', description: 'Set status to Online', icon: '🟢',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => {
      ctx.changeStatus?.('online');
      api.fetch('/users/@me/status', { method: 'PUT', body: JSON.stringify({ presence: 'online', auto_response: '' }) }).catch(() => {});
      ctx.setToast?.('Status: Online');
      return { handled: true };
    },
  },
  {
    name: '/dnd', description: 'Set Do Not Disturb', icon: '⛔',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.changeStatus?.('dnd'); ctx.setToast?.('Status: Do Not Disturb'); return { handled: true }; },
  },
  {
    name: '/invisible', description: 'Go invisible', icon: '👻',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.changeStatus?.('invisible'); ctx.setToast?.('Status: Invisible'); return { handled: true }; },
  },
  {
    name: '/status', description: 'Set custom status text', icon: '💬', args: '<text>',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      const text = args.trim().slice(0, 128);
      try {
        await api.fetch('/users/@me/status', { method: 'PUT', body: JSON.stringify({ status: text, emoji: '', presence: '' }) });
        ctx.setToast?.(text ? `Status: "${text}"` : 'Custom status cleared');
      } catch { ctx.setToast?.('Failed to set status'); }
      return { handled: true };
    },
  },

  // ── Nickname ─────────────────────────────────────────────
  {
    name: '/nick', description: 'Set your server nickname', icon: '✏️', args: '<name>',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      if (!ctx.curServer) { ctx.setToast?.('Not in a server'); return { handled: true }; }
      const nick = args.trim().slice(0, 64) || null;
      try {
        await api.setNickname(ctx.curServer.id, api.userId!, nick);
        ctx.setToast?.(nick ? `Nickname set to "${nick}"` : 'Nickname cleared');
      } catch { ctx.setToast?.('Failed to set nickname'); }
      return { handled: true };
    },
  },

  // ── Mute / unmute channel ────────────────────────────────
  {
    name: '/mute', description: 'Mute current channel', icon: '🔇',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => {
      if (!ctx.curChannel) return { handled: false };
      const key = `d_muted_${ctx.curChannel.id}`;
      localStorage.setItem(key, 'true');
      ctx.setToast?.('Channel muted');
      return { handled: true };
    },
  },
  {
    name: '/unmute', description: 'Unmute current channel', icon: '🔊',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => {
      if (!ctx.curChannel) return { handled: false };
      const key = `d_muted_${ctx.curChannel.id}`;
      localStorage.removeItem(key);
      ctx.setToast?.('Channel unmuted');
      return { handled: true };
    },
  },

  // ── UI / app commands ────────────────────────────────────
  {
    name: '/clear', description: 'Clear local message view', icon: '🧹',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => {
      ctx.clearMessages?.();
      ctx.setToast?.('Chat view cleared');
      return { handled: true };
    },
  },
  {
    name: '/logout', description: 'Log out of Discreet', icon: '🚪',
    visibleToOthers: false, guestAllowed: true,
    handler: async (_args, ctx) => { ctx.logout?.(); return { handled: true }; },
  },
  {
    name: '/upgrade', description: 'Open upgrade flow', icon: '⭐',
    visibleToOthers: false, guestAllowed: true,
    handler: async (_args, ctx) => { ctx.setModal('upgrade'); return { handled: true }; },
  },

  // ── Moderation (existing) ────────────────────────────────
  {
    name: '/ban', description: 'Ban a user', icon: '🔨', args: '<user> [reason]',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      const parts = args.split(' ');
      const arg1 = parts[0];
      const rest = parts.slice(1).join(' ');
      if (!arg1) return { handled: false };
      const target = ctx.members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
      if (!target) return { handled: false };
      await api.banUser(ctx.curServer!.id, target.user_id, rest || 'No reason');
      api.listMembers(ctx.curServer!.id).then((m: SlashMember[]) => {
        if (Array.isArray(m)) ctx.setMembers(() => m);
      });
      return { handled: true };
    },
  },
  {
    name: '/kick', description: 'Kick a user', icon: '👢', args: '<user> [reason]',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      const parts = args.split(' ');
      const arg1 = parts[0];
      const rest = parts.slice(1).join(' ');
      if (!arg1) return { handled: false };
      const target = ctx.members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
      if (!target) return { handled: false };
      await api.banUser(ctx.curServer!.id, target.user_id, rest || 'Kicked');
      await api.unbanUser(ctx.curServer!.id, target.user_id);
      api.listMembers(ctx.curServer!.id).then((m: SlashMember[]) => {
        if (Array.isArray(m)) ctx.setMembers(() => m);
      });
      return { handled: true };
    },
  },
  {
    name: '/role', description: 'Assign role to user', icon: '🏷️', args: '<user> <role>',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      const parts = args.split(' ');
      if (parts.length < 2) return { handled: false };
      const arg1 = parts[0];
      const roleName = parts.slice(1).join(' ');
      const target = ctx.members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
      const role = ctx.allRoles.find(r => r.name?.toLowerCase() === roleName.toLowerCase());
      if (target && role) { await ctx.handleAssignRole(target.user_id, role.id); return { handled: true }; }
      return { handled: false };
    },
  },
  {
    name: '/audit', description: 'View audit log', icon: '📋',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.setModal('server-settings'); return { handled: true }; },
  },
  {
    name: '/settings', description: 'Server settings', icon: '⚙️',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.setModal('server-settings'); return { handled: true }; },
  },
  {
    name: '/invite', description: 'Create invite link', icon: '🔗',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => {
      const inv = await api.createInvite(ctx.curServer!.id, 0, 168);
      ctx.setModal({ type: 'invite', data: inv } as any);
      return { handled: true };
    },
  },
  {
    name: '/pin', description: 'Pin last message', icon: '📌',
    visibleToOthers: false, guestAllowed: false,
    handler: async () => ({ handled: false }), // Existing handler in App.tsx
  },
  {
    name: '/emoji', description: 'Open emoji picker', icon: '😀',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.setShowInputEmoji(true); return { handled: true }; },
  },
  {
    name: '/poll', description: 'Create a poll', icon: '📊', args: '"Q" "A" "B"',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      if (!ctx.curChannel) return { handled: false };
      const txt = '/poll ' + args;
      const matches = txt.match(/"([^"]+)"/g);
      if (matches && matches.length >= 3) {
        const question = matches[0].replace(/"/g, '');
        const options = matches.slice(1).map(m => m.replace(/"/g, ''));
        const result = await api.createPoll(ctx.curChannel.id, question, options);
        if (result?.id) ctx.loadMsgs();
        return { handled: true };
      }
      if (args.includes('|')) {
        const pipeParts = args.split('|').map(s => s.trim()).filter(Boolean);
        if (pipeParts.length >= 3) {
          const result = await api.createPoll(ctx.curChannel.id, pipeParts[0], pipeParts.slice(1));
          if (result?.id) ctx.loadMsgs();
          return { handled: true };
        }
      }
      return { handled: false };
    },
  },
  {
    name: '/meeting', description: 'Start a meeting', icon: '📹',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.setShowMeeting(true); return { handled: true }; },
  },
  {
    name: '/meet', description: 'Start a meeting', icon: '📹',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.setShowMeeting(true); return { handled: true }; },
  },
  {
    name: '/discover', description: 'Discover servers', icon: '🔭',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => { ctx.goDiscover?.(); return { handled: true }; },
  },
  {
    name: '/watch', description: 'Watch YouTube together', icon: '📺', args: '<url>',
    visibleToOthers: false, guestAllowed: false,
    handler: async (args, ctx) => {
      if (!args || !ctx.voiceChannel) return { handled: false };
      const ytMatch = args.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
      if (!ytMatch) return { handled: false };
      const wp = { url: args, videoId: ytMatch[1], startedBy: api.username, startedAt: Date.now() };
      ctx.setWatchParty(wp);
      (api as any).ws?.send(JSON.stringify({ type: 'watch_party', channel_id: ctx.voiceChannel.id, ...wp }));
      return { handled: true };
    },
  },
  {
    name: '/stopwatch', description: 'End watch party', icon: '⏹',
    visibleToOthers: false, guestAllowed: false,
    handler: async (_args, ctx) => {
      if (!ctx.voiceChannel) return { handled: false };
      ctx.setWatchParty(null);
      (api as any).ws?.send(JSON.stringify({ type: 'watch_party_end', channel_id: ctx.voiceChannel.id }));
      return { handled: true };
    },
  },
];

// ─── Suggestion filtering ────────────────────────────────

type SuggestionResult =
  | { kind: 'commands'; items: SlashCommandDef[] }
  | { kind: 'members';  cmd: string; items: SlashMember[] }
  | { kind: 'roles';    username: string; items: SlashRole[] }
  | { kind: 'none' };

function filterCommands(
  input:   string,
  members: SlashMember[],
  roles:   SlashRole[],
  isGuest: boolean,
): SuggestionResult | null {
  if (!input.startsWith('/')) return null;

  const parts = input.split(' ');
  const cmd   = parts[0].toLowerCase();
  const arg   = parts.slice(1).join(' ').toLowerCase();

  // Get visible commands (filter by guest status)
  const visible = SLASH_COMMANDS.filter(c => !isGuest || c.guestAllowed);

  // Bare "/" → show all
  if (input === '/') return { kind: 'commands', items: visible };

  // Still typing the command name (no space yet)
  if (!input.includes(' ')) {
    const filtered = visible.filter(c => c.name.startsWith(cmd));
    return filtered.length ? { kind: 'commands', items: filtered } : { kind: 'none' };
  }

  // Member picker for /ban, /kick, /role
  if (['/ban', '/kick', '/role'].includes(cmd) && parts.length <= 2) {
    const filtered = (members || []).filter(m =>
      !arg || m.username?.toLowerCase().includes(arg),
    );
    return filtered.length ? { kind: 'members', cmd, items: filtered } : { kind: 'none' };
  }

  // Role picker for /role <username> <role>
  if (cmd === '/role' && parts.length >= 3) {
    const rArg = parts.slice(2).join(' ').toLowerCase();
    const filtered = (roles || []).filter(r =>
      !rArg || r.name?.toLowerCase().includes(rArg),
    );
    return { kind: 'roles', username: parts[1], items: filtered };
  }

  return { kind: 'none' };
}

// ─── SlashSuggestions UI ─────────────────────────────────

export interface SlashSuggestionsProps {
  input:   string;
  members: SlashMember[];
  roles:   SlashRole[];
  isGuest: boolean;
  onSet:   (value: string) => void;
}

export function SlashSuggestions({ input, members, roles, isGuest, onSet }: SlashSuggestionsProps) {
  // Check settings toggle
  if (localStorage.getItem('d_slash_suggestions') === 'false') return null;

  const result = filterCommands(input, members, roles, isGuest);
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
          <div key={c.name} onClick={() => onSet(c.name + ' ')} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
            <span>{c.icon}</span>
            <span style={{ color: T.ac, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{c.name}</span>
            <span style={{ color: T.mt, fontSize: 12 }}>{c.description}</span>
            {c.args && <span style={{ color: T.bd, fontSize: 11, fontStyle: 'italic' }}>{c.args}</span>}
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

// ─── Command Executor ────────────────────────────────────

/**
 * Executes a slash command string.
 * Returns { handled, sendText? }.
 *   handled = true  → caller should NOT send as a normal message.
 *   sendText        → if set, caller should send this text as a visible message.
 */
export async function processSlashCommand(
  txt: string,
  ctx: SlashContext,
): Promise<{ handled: boolean; sendText?: string }> {
  const trimmed = txt.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const cmdName = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

  const def = SLASH_COMMANDS.find(c => c.name === cmdName);
  if (!def) return { handled: false };

  // Guest check
  if (ctx.isGuest && !def.guestAllowed) {
    ctx.setToast?.('Guests cannot use this command');
    return { handled: true };
  }

  return def.handler(args, ctx);
}
