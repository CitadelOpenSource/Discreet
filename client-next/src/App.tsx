/**
 * Discreet — Vite Client (Full Featured)
 * Orchestrates all extracted components into a complete chat application.
 */
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { api, _storage } from './api/CitadelAPI';
import { T, getInp, btn, setTheme } from './theme';
import { I } from './icons';
import { initCrypto, isMlsAvailable, encryptMessage, decryptMessage } from './crypto/mls';
import { sframeService } from './services/SFrameService';
import { AuthScreen, VerifyEmailBanner } from './components/AuthScreen';
import { BugReportButton } from './components/BugReportButton';
import { Av } from './components/Av';
import { Modal } from './components/Modal';
import { CtxMenu } from './components/CtxMenu';
import { EmojiPicker, getQuickReact, type CustomEmoji } from './components/EmojiPicker';
import { FriendsView } from './components/FriendsView';
import { VideoGrid } from './components/VideoGrid';
import { SearchPanel } from './components/SearchPanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { UpgradeModal } from './components/UpgradeModal';
import { MaintenancePage } from './components/ErrorBoundary';
import { GifPicker } from './components/GifPicker';
import { LinkPreview } from './components/LinkPreview';
import { Markdown } from './components/Markdown';
import { InvitePreview } from './components/InvitePreview';
import { QrCode, encodeInviteQr, decodeInviteQr } from './components/QrCode';
import { QrScanner } from './components/QrScanner';
import { ChannelSidebar } from './components/ChannelSidebar';
import { NotificationCenter, type AppNotification, makeNotification, loadNotifications, saveNotifications } from './components/NotificationCenter';
import { NotificationInbox } from './components/NotificationInbox';
// ── Lazy-loaded heavy modals (reduce initial bundle) ──────
const SettingsModal      = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const UpgradeFlow        = lazy(() => import('./components/UpgradeFlow').then(m => ({ default: m.UpgradeFlow })));
const ServerSettingsModal = lazy(() => import('./components/ServerSettingsModal').then(m => ({ default: m.ServerSettingsModal })));
const BotConfigModal     = lazy(() => import('./components/BotConfigModal').then(m => ({ default: m.BotConfigModal })));
const AvatarCreator      = lazy(() => import('./components/AvatarCreator').then(m => ({ default: m.AvatarCreator })));
const WatchParty         = lazy(() => import('./components/WatchParty').then(m => ({ default: m.WatchParty })));
const MeetingRoom        = lazy(() => import('./components/MeetingRoom').then(m => ({ default: m.MeetingRoom })));
const CalendarView       = lazy(() => import('./components/CalendarView').then(m => ({ default: m.CalendarView })));
const DocumentEditor     = lazy(() => import('./components/DocumentEditor').then(m => ({ default: m.DocumentEditor })));
const ServerHealth       = lazy(() => import('./components/ServerHealth').then(m => ({ default: m.ServerHealth })));
const UserProfileCard    = lazy(() => import('./components/UserProfileCard').then(m => ({ default: m.UserProfileCard })));
import { ThreadView, type ParentMsg } from './components/ThreadView';
import { DiscoverPanel } from './components/DiscoverPanel';
import { AdminDashboard } from './components/AdminDashboard';
import { EventsPanel } from './components/EventsPanel';
import { LeaderboardPanel, RankBadge } from './components/Gamification';
import type { ConfirmDialogState } from './components/ConfirmDialog';
import { useVoice } from './hooks/useVoice';
import { SlashSuggestions, processSlashCommand, type SlashContext } from './hooks/useSlashCommands';
import { filterMessage, getProfanityLevel } from './utils/profanityFilter';
import { sanitizeInput, validateMessageLength, rateLimitCheck } from './utils/security';
import { PRIVILEGE_LEVELS, getUserLevel, hasPrivilege } from './utils/permissions';
import { getUserTier, TIER_LIMITS, TIER_META, tierRank, checkRateLimit, checkStorageLimit, addStorageUsedBytes } from './utils/tiers';
import type { Tier } from './utils/tiers';
import type { CtxMenuItem } from './components/CtxMenu';

// ── Types ─────────────────────────────────────────────────
interface Server { id: string; name: string; owner_id: string; icon_url?: string; member_count?: number; slash_commands_enabled?: boolean; message_retention_days?: number | null; disappearing_messages_default?: string | null; last_activity_at?: string | null; is_archived?: boolean; archived_at?: string | null; scheduled_deletion_at?: string | null; }
interface Channel { id: string; name: string; server_id: string; channel_type: string; category_id?: string; position: number; last_message_at?: string; }
interface Msg { id: string; author_id: string; content_ciphertext: string; mls_epoch: number; created_at: string; reply_to_id?: string; parent_message_id?: string; reply_count?: number; mentioned_user_ids?: string[]; text?: string; authorName?: string; }
interface DM { id: string; other_user_id: string; other_username: string; other_is_bot?: boolean; last_message_at?: string; }

// ── Crypto ────────────────────────────────────────────────
async function enc(cid: string, text: string): Promise<string> {
  // Try MLS first, fall back to PBKDF2 if MLS group doesn't exist yet
  if (isMlsAvailable()) {
    try { return await encryptMessage(cid, text); } catch { /* MLS group not set up — fall back */ }
  }
  // PBKDF2 fallback (same as monolith)
  const pw = `citadel:${cid}:0`, salt = new TextEncoder().encode('mls-group-secret');
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const c = new Uint8Array(iv.length + new Uint8Array(ct).length); c.set(iv); c.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...c));
}
async function dec(cid: string, b64: string): Promise<string> {
  // Try MLS first, fall back to PBKDF2
  if (isMlsAvailable()) {
    try { return await decryptMessage(cid, b64); } catch { /* fall back */ }
  }
  try { const d = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const pw = `citadel:${cid}:0`, salt = new TextEncoder().encode('mls-group-secret'); const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']); const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.slice(0, 12) }, key, d.slice(12)); return new TextDecoder().decode(pt); } catch { return b64; }
}

// ── Quick Emojis (dynamic — see EmojiPicker.getQuickReact) ──

// ── Channel permission overrides ───────────────────────────
type PermState = 'allow' | 'neutral' | 'deny';
type PermOverrides = Record<string, Record<string, PermState>>; // { roleId: { permKey: state } }

const CH_PERMS = [
  { key: 'view_channel',    label: 'View Channel',     desc: 'Read messages and see the channel',       bit: 1 << 0 },
  { key: 'send_messages',   label: 'Send Messages',    desc: 'Post messages in the channel',            bit: 1 << 1 },
  { key: 'attach_files',    label: 'Attach Files',     desc: 'Upload images and files',                 bit: 1 << 2 },
  { key: 'add_reactions',   label: 'Add Reactions',    desc: 'React to messages with emoji',            bit: 1 << 3 },
  { key: 'manage_messages', label: 'Manage Messages',  desc: 'Delete or pin any message in the channel', bit: 1 << 4 },
  { key: 'manage_channel',  label: 'Manage Channel',   desc: 'Edit channel name, topic, and settings',  bit: 1 << 5 },
] as const;

const PERM_OPTS = [
  { val: 'allow'   as PermState, icon: '✓', label: 'Allow',   color: '#3ba55d', activeBg: 'rgba(59,165,93,0.18)'  },
  { val: 'neutral' as PermState, icon: '—', label: 'Neutral', color: '#72767d', activeBg: 'rgba(114,118,125,0.18)' },
  { val: 'deny'    as PermState, icon: '✕', label: 'Deny',    color: '#ed4245', activeBg: 'rgba(237,66,69,0.18)'  },
];

// ── Shimmer skeleton helpers ───────────────────────────────
const shimBase: React.CSSProperties = {
  background: 'linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.09) 50%,rgba(255,255,255,0.04) 75%)',
  backgroundSize: '400% 100%',
  animation: 'shimmer 1.4s infinite',
};
function GlobalStyles() {
  return (
    <style>{`
      @keyframes shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes typingBounce{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
      .typing-dot{display:inline-block;font-weight:900;font-size:14px;line-height:1;animation:typingBounce 1.4s ease-in-out infinite}
      .typing-dot:nth-child(2){animation-delay:.2s}
      .typing-dot:nth-child(3){animation-delay:.4s}

      /* ── Slim translucent scrollbars ─────────────────── */
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
      * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent; }

      /* ── Structural helpers ───────────────────────────── */
      .chat-root  { height:100vh; display:flex; overflow:hidden; }
      .chat-main  { flex:1; display:flex; flex-direction:column; overflow:hidden; min-width:0; }
      .msg-actions:hover { display:flex !important; }
      div:hover > .msg-actions { display:flex !important; }

      /* ── Server icon pill indicator ──── */
      .srv-icon { position:relative; }
      .srv-icon::before {
        content:''; position:absolute; left:-10px; top:50%; transform:translateY(-50%);
        width:4px; height:0; border-radius:0 4px 4px 0;
        background:currentColor; transition:height .15s ease;
      }
      .srv-icon:hover::before { height:20px; }
      .srv-icon--active::before { height:36px !important; }
      .srv-icon--unread::before { height:8px; }

      /* ── Global transitions ─────────────────────────── */
      .ch-row { transition:background .15s ease, color .15s ease, font-weight .15s ease; }
      .ch-row:hover { background:rgba(255,255,255,0.04) !important; }

      /* ── Hamburger (hidden on desktop) ───────────────── */
      .hamburger { display:none; }
      .mobile-backdrop { display:none; }

      /* ── ≤ 768px ─────────────────────────────────────── */
      @media (max-width:768px) {
        .server-rail { display:none !important; }

        .sidebar {
          position:fixed !important;
          left:-244px; top:0; bottom:0;
          z-index:200;
          width:240px !important;
          min-width:240px !important;
          transition:left .25s ease, box-shadow .25s ease;
        }
        .sidebar--open {
          left:0 !important;
          box-shadow:4px 0 24px rgba(0,0,0,.6);
        }

        .hamburger {
          display:flex;
          flex-direction:column;
          justify-content:center;
          gap:4px;
          width:36px; height:36px;
          padding:6px;
          background:transparent;
          border:none;
          border-radius:8px;
          cursor:pointer;
          color:inherit;
          flex-shrink:0;
        }
        .hamburger span {
          display:block; height:2px;
          background:currentColor;
          border-radius:1px;
          transition:transform .2s, opacity .2s;
        }
        .hamburger--open span:nth-child(1){transform:translateY(6px) rotate(45deg);}
        .hamburger--open span:nth-child(2){opacity:0;}
        .hamburger--open span:nth-child(3){transform:translateY(-6px) rotate(-45deg);}

        .mobile-backdrop {
          display:block;
          position:fixed; inset:0;
          background:rgba(0,0,0,.55);
          z-index:199;
          animation:fadeIn .2s ease;
        }

        .member-panel {
          position:fixed !important;
          left:0 !important; right:0 !important;
          bottom:0 !important; top:auto !important;
          width:100% !important;
          min-width:unset !important;
          max-height:50vh;
          border-left:none !important;
          border-top:1px solid rgba(255,255,255,.08);
          z-index:180;
          box-shadow:0 -8px 32px rgba(0,0,0,.4);
          overflow-y:auto;
        }

        .input-bar { width:100%; }
      }

      /* ── ≤ 480px ─────────────────────────────────────── */
      @media (max-width:480px) {
        .chat-header { min-height:52px; padding:8px 12px !important; }

        /* 44px minimum touch targets */
        .hamburger   { width:44px; height:44px; }
        .touch-target {
          min-height:44px; min-width:44px;
          display:flex; align-items:center; justify-content:center;
        }

        /* Readable message text, prevents iOS input zoom */
        .msg-text  { font-size:16px !important; line-height:1.6 !important; }
        .input-bar input { font-size:16px !important; }

        /* Full-width sidebar overlay */
        .sidebar        { left:-100vw; width:100vw !important; }
        .sidebar--open  { left:0 !important; }

        /* Taller member bottom-sheet */
        .member-panel { max-height:65vh; }
      }
    `}</style>
  );
}
function SkeletonBar({ w = '100%', h = 14, mb = 8 }: { w?: string | number; h?: number; mb?: number }) {
  return <div style={{ ...shimBase, width: w, height: h, borderRadius: 6, marginBottom: mb }} />;
}
function SkeletonCircle({ size = 36 }: { size?: number }) {
  return <div style={{ ...shimBase, width: size, height: size, borderRadius: size / 2, flexShrink: 0 }} />;
}
function MessageSkeleton({ count = 8 }: { count?: number }) {
  return (<>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 16px', animation: `fadeIn 0.3s ${i * 0.04}s both` }}>
        <SkeletonCircle size={36} />
        <div style={{ flex: 1, paddingTop: 2 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <SkeletonBar w={`${60 + (i * 23) % 60}px`} h={12} mb={0} />
            <SkeletonBar w={40} h={10} mb={0} />
          </div>
          <SkeletonBar w={`${40 + (i * 17) % 55}%`} h={13} mb={4} />
          {i % 3 === 0 && <SkeletonBar w={`${25 + (i * 11) % 40}%`} h={13} mb={0} />}
        </div>
      </div>
    ))}
  </>);
}
/** Fallback shown while a lazy modal is loading */
function ModalLoadingFallback() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#111320', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 32, width: 420 }}>
        <SkeletonBar w="50%" h={22} mb={20} />
        <SkeletonBar w="100%" mb={10} />
        <SkeletonBar w="85%" mb={10} />
        <SkeletonBar w="70%" mb={24} />
        <SkeletonBar w="30%" h={36} />
      </div>
    </div>
  );
}

// ── Notification Sounds ─────────────────────────────────
const playSound = (type: 'send' | 'receive' | 'join' | 'leave') => {
  try {
    const soundsEnabled = localStorage.getItem('d_sounds') !== 'false';
    if (!soundsEnabled) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.value = 0.08;
    if (type === 'send') { osc.frequency.value = 600; osc.type = 'sine'; gain.gain.setValueAtTime(0.08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15); osc.start(); osc.stop(ctx.currentTime + 0.15); }
    else if (type === 'receive') { osc.frequency.value = 440; osc.type = 'sine'; gain.gain.setValueAtTime(0.06, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
    else if (type === 'join') { osc.frequency.value = 800; osc.type = 'sine'; gain.gain.setValueAtTime(0.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3); osc.start(); osc.stop(ctx.currentTime + 0.3); }
    else { osc.frequency.value = 300; osc.type = 'sine'; gain.gain.setValueAtTime(0.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2); osc.start(); osc.stop(ctx.currentTime + 0.2); }
  } catch {}
};

// ── Slash Tool Components ─────────────────────────────────

function CalcTool({ onInsert }: { onInsert: (v: string) => void }) {
  const [expr, setExpr] = React.useState('');
  const [result, setResult] = React.useState('');
  const evaluate = (e: string) => {
    setExpr(e);
    if (!e.trim()) { setResult(''); return; }
    try {
      // Only allow numbers, operators, parens, dots
      if (!/^[\d+\-*/().%\s]+$/.test(e)) { setResult('Invalid'); return; }
      // eslint-disable-next-line no-eval
      const r = Function('"use strict"; return (' + e + ')')();
      setResult(typeof r === 'number' && isFinite(r) ? String(Math.round(r * 1e10) / 1e10) : 'Error');
    } catch { setResult('Error'); }
  };
  return (
    <div>
      <input value={expr} onChange={e => evaluate(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && result && result !== 'Error' && result !== 'Invalid') { e.preventDefault(); onInsert(result); } }}
        placeholder="e.g. 24 * 365"
        autoFocus
        style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 14, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
      {result && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: result === 'Error' || result === 'Invalid' ? '#ff4757' : T.ac, fontFamily: 'monospace' }}>{result}</span>
          {result !== 'Error' && result !== 'Invalid' && (
            <span onClick={() => onInsert(result)} style={{ fontSize: 11, color: T.ac, cursor: 'pointer', fontWeight: 600 }}>Insert ↵</span>
          )}
        </div>
      )}
    </div>
  );
}

const CONVERT_UNITS: Record<string, { units: string[]; convert: (v: number, from: string, to: string) => number }> = {
  Length: {
    units: ['m', 'km', 'cm', 'mm', 'in', 'ft', 'yd', 'mi'],
    convert: (v, from, to) => {
      const toM: Record<string, number> = { m: 1, km: 1000, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 };
      return v * (toM[from] || 1) / (toM[to] || 1);
    },
  },
  Weight: {
    units: ['kg', 'g', 'mg', 'lb', 'oz', 'ton'],
    convert: (v, from, to) => {
      const toKg: Record<string, number> = { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, ton: 907.185 };
      return v * (toKg[from] || 1) / (toKg[to] || 1);
    },
  },
  Temperature: {
    units: ['°C', '°F', 'K'],
    convert: (v, from, to) => {
      let c = from === '°C' ? v : from === '°F' ? (v - 32) * 5 / 9 : v - 273.15;
      return to === '°C' ? c : to === '°F' ? c * 9 / 5 + 32 : c + 273.15;
    },
  },
};

function ConvertTool({ onInsert }: { onInsert: (v: string) => void }) {
  const [cat, setCat] = React.useState('Length');
  const [val, setVal] = React.useState('');
  const [from, setFrom] = React.useState(CONVERT_UNITS.Length.units[0]);
  const [to, setTo] = React.useState(CONVERT_UNITS.Length.units[1]);
  const info = CONVERT_UNITS[cat];
  const num = parseFloat(val);
  const result = !isNaN(num) && info ? Math.round(info.convert(num, from, to) * 1e8) / 1e8 : null;
  const selStyle: React.CSSProperties = { padding: '4px 6px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 12, outline: 'none' };
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {Object.keys(CONVERT_UNITS).map(c => (
          <span key={c} onClick={() => { setCat(c); setFrom(CONVERT_UNITS[c].units[0]); setTo(CONVERT_UNITS[c].units[1]); }}
            style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: cat === c ? T.ac : T.bg, color: cat === c ? '#000' : T.mt }}>{c}</span>
        ))}
      </div>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="Value" autoFocus
        style={{ width: '100%', padding: '6px 8px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 13, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box', marginBottom: 6 }} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <select value={from} onChange={e => setFrom(e.target.value)} style={selStyle}>
          {info.units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <span style={{ color: T.mt, fontSize: 12 }}>→</span>
        <select value={to} onChange={e => setTo(e.target.value)} style={selStyle}>
          {info.units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      {result !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.ac, fontFamily: 'monospace' }}>{result} {to}</span>
          <span onClick={() => onInsert(`${val} ${from} = ${result} ${to}`)} style={{ fontSize: 11, color: T.ac, cursor: 'pointer', fontWeight: 600 }}>Insert ↵</span>
        </div>
      )}
    </div>
  );
}

function ColorTool({ onInsert }: { onInsert: (v: string) => void }) {
  const [hex, setHex] = React.useState('#00D4AA');
  const hexToRgb = (h: string) => {
    const m = h.replace('#', '').match(/.{2}/g);
    if (!m || m.length < 3) return null;
    return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
  };
  const rgbToHex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const rgb = hexToRgb(hex);
  const [rVal, setR] = React.useState(rgb?.r ?? 0);
  const [gVal, setG] = React.useState(rgb?.g ?? 212);
  const [bVal, setB] = React.useState(rgb?.b ?? 170);
  const updateFromHex = (h: string) => {
    setHex(h);
    const c = hexToRgb(h);
    if (c) { setR(c.r); setG(c.g); setB(c.b); }
  };
  const updateFromRgb = (r: number, g: number, b: number) => {
    setR(r); setG(g); setB(b);
    setHex(rgbToHex(r, g, b));
  };
  const display = hex.toUpperCase();
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
        <input type="color" value={hex} onChange={e => updateFromHex(e.target.value)}
          style={{ width: 48, height: 48, border: 'none', borderRadius: 6, cursor: 'pointer', padding: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: T.mt, marginBottom: 4 }}>HEX</div>
          <input value={display} onChange={e => { const v = e.target.value; if (/^#?[0-9A-Fa-f]{0,6}$/.test(v.replace('#', ''))) updateFromHex(v.startsWith('#') ? v : '#' + v); }}
            style={{ width: '100%', padding: '4px 6px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 13, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[{ label: 'R', val: rVal, set: (v: number) => updateFromRgb(v, gVal, bVal), col: '#ff4757' },
          { label: 'G', val: gVal, set: (v: number) => updateFromRgb(rVal, v, bVal), col: '#2ecc71' },
          { label: 'B', val: bVal, set: (v: number) => updateFromRgb(rVal, gVal, v), col: '#3498db' }].map(c => (
          <div key={c.label} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: c.col, fontWeight: 700, marginBottom: 2 }}>{c.label}</div>
            <input type="number" min={0} max={255} value={c.val}
              onChange={e => c.set(Math.max(0, Math.min(255, parseInt(e.target.value) || 0)))}
              style={{ width: '100%', padding: '3px 4px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span onClick={() => onInsert(display)} style={{ flex: 1, textAlign: 'center', padding: '5px 0', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, fontSize: 11, color: T.ac, cursor: 'pointer', fontWeight: 600 }}>Insert HEX</span>
        <span onClick={() => onInsert(`rgb(${rVal}, ${gVal}, ${bVal})`)} style={{ flex: 1, textAlign: 'center', padding: '5px 0', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, fontSize: 11, color: T.ac, cursor: 'pointer', fontWeight: 600 }}>Insert RGB</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
export default function App() {
  const [authed, setAuthed] = useState(false);
  const [authLoading, setAuthLoading] = useState(!!api.userId); // true if we need to try cookie refresh
  const [maintenanceMsg, setMaintenanceMsg] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'server' | 'dm'>('home');
  const [homeTab, setHomeTab] = useState('home');

  // ── Core Data ───────────────────────────────────────────
  const [me, setMe] = useState<any>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [dms, setDms] = useState<DM[]>([]);
  const [dmUnreadCounts, setDmUnreadCounts] = useState<Record<string, number>>({});
  const [groupDms, setGroupDms] = useState<any[]>([]);
  const [curGroupDm, setCurGroupDm] = useState<any | null>(null);
  const [dmMsgs, setDmMsgs] = useState<any[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [rawUsernameMap, setRawUsernameMap] = useState<Record<string, string>>({});
  const [badgeMap, setBadgeMap] = useState<Record<string, { badge_type: string | null; account_tier: string | null }>>({});
  const [platformUser, setPlatformUser] = useState<any>(null);
  const [devTierOverride, setDevTierOverride] = useState<Tier | null>(() => localStorage.getItem('d_dev_tier_override') as Tier | null);
  const [reactions, setReactions] = useState<Record<string, any[]>>({});
  const [pollVotes, setPollVotes] = useState<Record<string, number | null>>({}); // pollId → local vote index override
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({}); // user_id → last-event ms
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({});
  const [agentDisclosures, setAgentDisclosures] = useState<Record<string, { agent_id: string; display_name: string; disclosure_text: string }>>({});
  const [wsLatency, setWsLatency] = useState(0);
  const [showConnInfo, setShowConnInfo] = useState(false);
  const [connDiag, setConnDiag] = useState<{ api: string; ws: string; dns: string } | null>(null);
  const sessionStartRef = useRef(Date.now());
  const pingRef = useRef(0);
  // Server organization: favorites, folders, custom order
  const [serverFavorites, setServerFavorites] = useState<string[]>(() => JSON.parse(localStorage.getItem('d_srv_favs') || '[]'));
  const [serverFolders, setServerFolders] = useState<Record<string, string[]>>(() => JSON.parse(localStorage.getItem('d_srv_folders') || '{}'));
  const [serverOrder, setServerOrder] = useState<string[]>(() => JSON.parse(localStorage.getItem('d_srv_order') || '[]'));
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [dragServer, setDragServer] = useState<string | null>(null);
  const [voiceChannel,   setVoiceChannel]   = useState<Channel | null>(null);
  const [voicePresence,  setVoicePresence]  = useState<Record<string, string[]>>({});
  const [streamStatus,    setStreamStatus]    = useState<Record<string, { active: boolean; viewerCount: number; viewerUrl?: string }>>({});
  const [myStreamChannelId, setMyStreamChannelId] = useState<string | null>(null);
  const [obsModal,  setObsModal]  = useState<{ rtmpUrl: string; streamKey: string } | null>(null);
  const [watchModal, setWatchModal] = useState<{ channelId: string; name: string; viewerUrl: string } | null>(null);

  // ── Voice ───────────────────────────────────────────────
  const vc = useVoice();
  const joinVoice = async (ch: Channel) => {
    if (voiceChannel?.id === ch.id) {
      vc.leave(); setVoiceChannel(null); playSound('leave');
      setVoicePresence(p => ({ ...p, [ch.id]: (p[ch.id] || []).filter(id => id !== api.userId) }));
      return;
    }
    await vc.join(ch.id);
    setVoiceChannel(ch);
    playSound('join');
    api.ws?.send(JSON.stringify({ type: 'voice_join', channel_id: ch.id }));
    setVoicePresence(p => ({ ...p, [ch.id]: [...new Set([...(p[ch.id] || []), api.userId!])] }));
  };
  const leaveVoice = () => {
    if (voiceChannel) {
      api.ws?.send(JSON.stringify({ type: 'voice_leave', channel_id: voiceChannel.id }));
      setVoicePresence(p => ({ ...p, [voiceChannel.id]: (p[voiceChannel.id] || []).filter(id => id !== api.userId) }));
    }
    vc.leave();
    setVoiceChannel(null);
    playSound('leave');
  };

  // ── Streaming ───────────────────────────────────────────
  const startGoLive = async () => {
    if (!voiceChannel) return;
    const data = await api.startStream(voiceChannel.id);
    if (data?.rtmpUrl && data?.streamKey) {
      setMyStreamChannelId(voiceChannel.id);
      setStreamStatus(p => ({ ...p, [voiceChannel.id]: { active: true, viewerCount: 0, viewerUrl: data.viewerUrl } }));
      setObsModal({ rtmpUrl: data.rtmpUrl, streamKey: data.streamKey });
    } else {
      setToast('Failed to start stream — check server settings');
      setTimeout(() => setToast(''), 4000);
    }
  };
  const stopGoLive = async () => {
    if (!myStreamChannelId) return;
    await api.stopStream(myStreamChannelId);
    setStreamStatus(p => ({ ...p, [myStreamChannelId]: { active: false, viewerCount: 0 } }));
    setMyStreamChannelId(null);
    setObsModal(null);
  };

  // ── Selection ───────────────────────────────────────────
  const [curServer, setCurServer] = useState<Server | null>(null);
  const [curChannel, setCurChannel] = useState<Channel | null>(null);
  const [curDm, setCurDm] = useState<DM | null>(null);

  // ── UI State ────────────────────────────────────────────
  const [msgInput, setMsgInput] = useState('');
  const [slashTool, setSlashTool] = useState<'calc' | 'convert' | 'color' | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [verifyBannerDismissed, setVerifyBannerDismissed] = useState(() => _storage.getItem('d_verify_dismissed') === '1');
  const [selectedBot, setSelectedBot] = useState<any>(null);
  const [createName, setCreateName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [invitePreview, setInvitePreview] = useState<{ code: string; server_name: string; member_count: number; icon_url?: string; foreign?: boolean; url?: string } | null>(null);
  const [showNewDmModal, setShowNewDmModal] = useState(false);
  const [newDmQuery, setNewDmQuery] = useState('');
  const [newDmFriends, setNewDmFriends] = useState<any[]>([]);
  const [newDmSearchResults, setNewDmSearchResults] = useState<any[]>([]);
  const [newDmSearching, setNewDmSearching] = useState(false);
  const [showGroupDmModal, setShowGroupDmModal] = useState(false);
  const [gdmName, setGdmName] = useState('');
  const [gdmSelected, setGdmSelected] = useState<string[]>([]);
  const [gdmFriends, setGdmFriends] = useState<any[]>([]);
  const [inviteResult, setInviteResult] = useState('');
  const [inviteExpiry, setInviteExpiry] = useState('7d');
  const [inviteMaxUses, setInviteMaxUses] = useState<number | null>(null);
  const [inviteTemporary, setInviteTemporary] = useState(false);
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [showInviteQr, setShowInviteQr] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [createChannelName, setCreateChannelName] = useState('');
  const [createChannelType, setCreateChannelType] = useState('text');
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [editChannelName, setEditChannelName] = useState('');
  const [editChannelTopic, setEditChannelTopic] = useState('');
  const [chSettingsTab, setChSettingsTab] = useState('overview');
  const [chSlowmode, setChSlowmode] = useState(0);
  const [chNsfw, setChNsfw] = useState(false);
  const [chPermOverrides, setChPermOverrides] = useState<PermOverrides>({});
  const [chArchived, setChArchived] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<string | null>(null); // message id for reaction
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editMsg, setEditMsg] = useState<Msg | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [serverEmoji, setServerEmoji] = useState<CustomEmoji[]>([]);
  const [panel, setPanel] = useState<'members' | 'search' | 'thread' | null>('members');
  const [threadParent, setThreadParent] = useState<Msg | null>(null);
  const [threadReplies, setThreadReplies] = useState<Msg[]>([]);
  const [profileCard, setProfileCard] = useState<{ userId: string; pos: { x: number; y: number } } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);
  const [quickSwitcher, setQuickSwitcher] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedMsg, setHighlightedMsg] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [roles, setRoles] = useState<any[]>([]);
  const [userStatus, setUserStatus] = useState(() => localStorage.getItem('d_status') || 'online');
  const [manualStatus, setManualStatus] = useState<string | null>(() => localStorage.getItem('d_manual_status') || null);
  const [presenceMap,    setPresenceMap]    = useState<Record<string, string>>({});
  const [customStatuses, setCustomStatuses] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');
  const [notifications, setNotifications] = useState<AppNotification[]>(() => loadNotifications());
  const [showNotifCenter, setShowNotifCenter] = useState(false);
  const [wsLastEvent, setWsLastEvent] = useState<any>(null);
  const [showWatchParty, setShowWatchParty] = useState(false);
  const [showMeeting,    setShowMeeting]    = useState(false);
  const [meetingCode,    setMeetingCode]    = useState<string | undefined>(undefined);
  const [showCalendar,   setShowCalendar]   = useState(false);
  const [showDocEditor,  setShowDocEditor]  = useState(false);
  const [showHealth,     setShowHealth]     = useState(false);
  const [showPinned,     setShowPinned]     = useState(false);
  const [pinnedMsgs,     setPinnedMsgs]     = useState<any[]>([]);
  const [openThread,     setOpenThread]     = useState<ParentMsg | null>(null);

  // ── Loading states ───────────────────────────────────────
  const [loadingServers,  setLoadingServers]  = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingMembers,  setLoadingMembers]  = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [channelFadeKey,  setChannelFadeKey]  = useState(0); // bumped on channel switch for fade-in
  const [membersLoaded,   setMembersLoaded]   = useState<string | null>(null); // server id for which members were loaded

  // ── Mobile nav ───────────────────────────────────────────
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ── Session restore: try to refresh access token from HttpOnly cookie ──
  useEffect(() => {
    if (!api.userId) { setAuthLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${window.location.origin}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          credentials: 'same-origin',
        });
        if (res.ok && !cancelled) {
          const d = await res.json();
          api.token = d.access_token;
          setAuthed(true);
        } else if (!cancelled) {
          api.clearAuth();
        }
      } catch {
        if (!cancelled) api.clearAuth();
      }
      if (!cancelled) setAuthLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-idle — only when user hasn't set a manual status (DND/invisible)
  useEffect(() => {
    if (!authed) return;
    if (manualStatus && manualStatus !== 'online') return;
    let idleTimeout: any;
    const idleMs = parseInt(localStorage.getItem('d_idle_timeout') || '300000');
    const resetIdle = () => {
      if (userStatus === 'idle' && !manualStatus) { setUserStatus('online'); api.ws?.send(JSON.stringify({ type: 'status_change', status: 'online' })); }
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => { if (!manualStatus) { setUserStatus('idle'); api.ws?.send(JSON.stringify({ type: 'status_change', status: 'idle' })); } }, idleMs);
    };
    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    resetIdle();
    return () => { clearTimeout(idleTimeout); window.removeEventListener('mousemove', resetIdle); window.removeEventListener('keydown', resetIdle); };
  }, [authed, manualStatus]);

  const changeStatus = (status: string) => {
    setUserStatus(status); localStorage.setItem('d_status', status);
    setPresenceMap(p => ({ ...p, [api.userId!]: status }));
    if (status === 'online') { setManualStatus(null); localStorage.removeItem('d_manual_status'); }
    else { setManualStatus(status); localStorage.setItem('d_manual_status', status); }
    api.ws?.send(JSON.stringify({ type: 'status_change', status }));
    api.updateSettings?.({ status }).catch(() => {});
    setModal(null);
  };
  const msgEndRef  = useRef<HTMLDivElement>(null);
  const msgScrollRef = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const [msgScrollTop, setMsgScrollTop] = useState(0);
  const typingRef  = useRef(0); // timestamp of last typing event sent

  // ── Init ────────────────────────────────────────────────
  useEffect(() => {
    if (!authed) return;
    initCrypto().catch(() => {});
    // Token pre-refresh: if access token expires within 5 minutes, refresh now
    // so subsequent API calls don't hit a 401 mid-session.
    try {
      const tok = api.token;
      if (tok && api.refreshToken) {
        const payload = JSON.parse(atob(tok.split('.')[1]));
        const expiresIn = (payload.exp * 1000) - Date.now();
        if (expiresIn < 5 * 60 * 1000) api.tryRefresh();
      }
    } catch {}
    loadServers(true); loadDms(); api.getMe().then(setMe).catch(() => {});
    api.getPlatformMe().then((d: any) => { if (d && api.userId) { setPlatformUser(d); setBadgeMap(prev => ({ ...prev, [api.userId!]: { badge_type: d.badge_type ?? null, account_tier: d.account_tier ?? null } })); } }).catch(() => {});
    // Forward voice ICE candidates to server via WS
    const unsubVoice = vc.engine.onEvent((e) => {
      if (e.type === 'ice_candidate' && api.ws?.readyState === 1) {
        api.ws.send(JSON.stringify({ type: 'voice_ice', to: e.peerId, candidate: e.candidate }));
      }
    });
    // Keyboard shortcuts
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setQuickSwitcher(p => !p); }
      if (e.key === 'Escape') { setQuickSwitcher(false); setModal(null); }
    };
    window.addEventListener('keydown', onKey);
    // Load theme from settings
    api.getSettings?.().then((s: any) => {
      if (s?.theme) handleThemeChange(s.theme);
    }).catch(() => {});
    return () => { unsubVoice(); window.removeEventListener('keydown', onKey); };
  }, [authed]);

  // ── Handle /invite/:code deep links ─────────────────────
  useEffect(() => {
    if (!authed) return;
    const m = window.location.pathname.match(/^\/invite\/([A-Za-z0-9]+)\/?$/);
    if (m) {
      const code = m[1];
      api.resolveInvite(code).then((info: any) => {
        setInvitePreview({ code, server_name: info.server_name, member_count: info.member_count, icon_url: info.icon_url });
      }).catch(() => {
        setToast('Invalid or expired invite link'); setTimeout(() => setToast(''), 3000);
      });
      // Clean up URL without reload
      window.history.replaceState({}, '', '/app');
    }
  }, [authed]);

  // ── WebSocket ───────────────────────────────────────────
  const curChannelRef = useRef(curChannel);
  curChannelRef.current = curChannel;
  const membersRef = useRef(members);
  membersRef.current = members;
  const curDmRef = useRef(curDm);
  curDmRef.current = curDm;
  const dmsRef = useRef(dms);
  dmsRef.current = dms;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  useEffect(() => {
    if (!authed || !curServer) return;
    api.connectWs(curServer.id);
    const handler = (evt: any) => {
      setWsLastEvent(evt);
      const ch = curChannelRef.current;
      if ((evt.type === 'message_create' || evt.type === 'MESSAGE_CREATE') && evt.channel_id === ch?.id) {
        if (evt.author_id !== api.userId) playSound('receive');
        // Advance the persisted read cursor while viewing this channel.
        localStorage.setItem(`d_channel_last_read_${ch.id}`, String(Date.now()));
        loadMessages(ch);
        // Bot @mention: check plain-text fields the server may include in the WS event.
        // For our own messages this is handled in sendMessage(); here we catch other users' mentions.
        if (evt.author_id !== api.userId && curServer) {
          const content: string = evt.content || evt.text || '';
          if (content) {
            const mentionRe = /@([\w.-]+)/g;
            let mm;
            while ((mm = mentionRe.exec(content)) !== null) {
              const mentioned = mm[1].toLowerCase();
              const bot = membersRef.current.find(
                (mb: any) => mb.is_bot && (mb.username?.toLowerCase() === mentioned || mb.display_name?.toLowerCase() === mentioned),
              );
              if (bot) api.promptBot(curServer.id, bot.user_id, content, ch?.id ?? undefined).catch(() => {});
            }
          }
        }
      }
      if ((evt.type === 'typing_start' || evt.type === 'typing') && evt.channel_id === ch?.id && evt.user_id !== api.userId) {
        setTypingUsers(p => ({ ...p, [evt.user_id]: Date.now() }));
      }
      if (evt.type === 'mention_notification' && evt.mentioned_user_id === api.userId && evt.channel_id !== ch?.id) {
        setMentionCounts(p => ({ ...p, [evt.channel_id]: (p[evt.channel_id] || 0) + 1 }));
      }
      if (evt.type === 'reaction_add' && evt.channel_id === ch?.id) {
        setReactions(p => ({ ...p, [evt.message_id]: [...(p[evt.message_id] || []), { emoji: evt.emoji, user_id: evt.user_id }] }));
      }
      if (evt.type === 'presence_update' || evt.type === 'status_change') {
        if (evt.user_id) setPresenceMap(p => ({ ...p, [evt.user_id]: evt.status || 'online' }));
      }
      if (evt.type === 'user_update' && evt.user_id && evt.custom_status !== undefined) {
        setCustomStatuses(p => ({ ...p, [evt.user_id]: evt.custom_status }));
      }
      if (evt.type === 'user_profile_update' && evt.user_id && evt.avatar_url) {
        setMembers((prev: any[]) => prev.map((m: any) => m.user_id === evt.user_id ? { ...m, avatar_url: evt.avatar_url } : m));
      }
      if (evt.type === 'member_update' && evt.user_id) {
        if (evt.nickname !== undefined) {
          setMembers((prev: any[]) => prev.map((m: any) => m.user_id === evt.user_id ? { ...m, nickname: evt.nickname } : m));
          setUserMap(p => {
            const m = members.find((mb: any) => mb.user_id === evt.user_id);
            const name = evt.nickname || m?.display_name || m?.username || p[evt.user_id];
            return { ...p, [evt.user_id]: name };
          });
        }
      }
      if (evt.type === 'account_suspended') {
        api.clearAuth();
        setAuthed(false);
        alert(evt.reason || 'Your account has been suspended.');
        return;
      }
      if (evt.type === 'maintenance_mode') {
        setMaintenanceMsg(evt.message || 'Discreet is undergoing scheduled maintenance.');
        return;
      }
      // Track all users joining/leaving voice channels (including bots via force_voice_join)
      if ((evt.type === 'voice_join') && evt.channel_id && evt.user_id && evt.user_id !== api.userId) {
        setVoicePresence(p => ({ ...p, [evt.channel_id]: [...new Set([...(p[evt.channel_id] || []), evt.user_id])] }));
      }
      if (evt.type === 'voice_leave' && evt.channel_id && evt.user_id) {
        setVoicePresence(p => ({ ...p, [evt.channel_id]: (p[evt.channel_id] || []).filter((id: string) => id !== evt.user_id) }));
      }
      // Voice signaling
      if (evt.type === 'voice_offer' && evt.from) vc.handleOffer(evt.from, evt.offer);
      if (evt.type === 'voice_answer' && evt.from) vc.handleAnswer(evt.from, evt.answer);
      if (evt.type === 'voice_ice' && evt.from) vc.handleIceCandidate(evt.from, evt.candidate);
      // SFrame key updates from server
      if (evt.type === 'voice_sframe_key_update' && evt.user_id && evt.channel_id) {
        vc.engine.handleSFrameKeyUpdate(evt.user_id, evt.key_id ?? 0, evt.epoch ?? 0);
      }
      // Admin server-mute: server tells client to mute
      if (evt.type === 'admin_mute' && evt.user_id === api.userId) {
        vc.engine.applyServerMute();
        setToast('You have been muted by an admin');
        setTimeout(() => setToast(''), 3000);
      }
      // Auto-reply from away/afk user — inject as local system message
      if (evt.type === 'auto_reply' && evt.channel_id) {
        const ch = curChannelRef.current;
        if (ch && evt.channel_id === ch.id) {
          setMessages(prev => [...prev, {
            id: 'auto_reply_' + Date.now(),
            channel_id: evt.channel_id,
            author_id: evt.user_id,
            authorName: evt.username,
            text: evt.message,
            content_ciphertext: '',
            created_at: new Date().toISOString(),
            is_auto_reply: true,
          }]);
        }
      }
      // Latency pong response — measure round-trip time
      if (evt.type === 'ws_pong' && pingRef.current > 0) {
        setWsLatency(Date.now() - pingRef.current);
        pingRef.current = 0;
      }
      // DM unread tracking: dm_message event (dm_id) or message_create whose channel_id matches a DM
      if (evt.author_id !== api.userId) {
        const dmId = evt.dm_id || (dmsRef.current.find((dm: DM) => dm.id === evt.channel_id)?.id);
        if (dmId && curDmRef.current?.id !== dmId) {
          setDmUnreadCounts(p => ({ ...p, [dmId]: (p[dmId] || 0) + 1 }));
        }
      }
      if (evt.type === 'message_create' && evt.channel_id !== ch?.id) {
        setUnreadCounts(p => ({ ...p, [evt.channel_id]: (p[evt.channel_id] || 0) + 1 }));
        // @mention notification for messages in other channels
        const evtContent: string = evt.content || evt.text || '';
        if (evtContent && api.username && evtContent.toLowerCase().includes(`@${api.username.toLowerCase()}`)) {
          pushNotif(makeNotification('mention',
            `@${api.username} mentioned`,
            `${evt.username || 'Someone'}: ${evtContent.slice(0, 120)}`,
            { serverId: curServer?.id, channelId: evt.channel_id },
          ));
        }
      }
      // Kick / ban events
      if ((evt.type === 'member_kicked' || evt.type === 'user_kicked') && evt.user_id === api.userId) {
        pushNotif(makeNotification('kick', 'You were kicked', `You were removed from ${curServer?.name || 'a server'}.`, { serverId: curServer?.id }));
      }
      if ((evt.type === 'member_banned' || evt.type === 'user_banned') && evt.user_id === api.userId) {
        pushNotif(makeNotification('ban', 'You were banned', `You were banned from ${curServer?.name || 'a server'}.`, { serverId: curServer?.id }));
      }
      // Friend request
      if (evt.type === 'friend_request' && evt.from_user_id !== api.userId) {
        pushNotif(makeNotification('friend_request', 'Friend Request',
          `${evt.from_username || 'Someone'} sent you a friend request.`,
          { userId: evt.from_user_id },
        ));
      }
      // Watch party started by someone else — notify
      if (evt.type === 'watch_party' && evt.started_by !== api.userId) {
        pushNotif(makeNotification('event', 'Watch Party Started',
          `Someone started a watch party in your channel. Click 🎬 to join.`,
          { serverId: curServer?.id, channelId: evt.channel_id },
        ));
      }
      // Event reminder
      if (evt.type === 'event_reminder') {
        pushNotif(makeNotification('event', evt.event_title || 'Event Starting',
          `${evt.event_title || 'An event'} is starting soon.`,
          { serverId: curServer?.id, eventId: evt.event_id },
        ));
      }
      // Stream lifecycle events
      if (evt.type === 'stream_started' && evt.channel_id) {
        setStreamStatus(p => ({ ...p, [evt.channel_id]: { active: true, viewerCount: 0, viewerUrl: evt.viewer_url } }));
      }
      if (evt.type === 'stream_ended' && evt.channel_id) {
        setStreamStatus(p => ({ ...p, [evt.channel_id]: { active: false, viewerCount: 0 } }));
        if (myStreamChannelId === evt.channel_id) setMyStreamChannelId(null);
      }
      if (evt.type === 'stream_viewer_count' && evt.channel_id) {
        setStreamStatus(p => ({ ...p, [evt.channel_id]: { ...(p[evt.channel_id] ?? { active: true, viewerCount: 0 }), viewerCount: evt.viewer_count ?? 0 } }));
      }
      // Agent disclosure — surface AI-in-channel notice when a bot joins
      if (evt.type === 'agent_disclosure' && evt.channel_id) {
        setAgentDisclosures(p => ({
          ...p,
          [evt.channel_id]: {
            agent_id:       evt.agent_id       ?? '',
            display_name:   evt.display_name   ?? 'AI Agent',
            disclosure_text: evt.disclosure_text ?? '',
          },
        }));
      }
      // Force voice join — server re-broadcasts as voice_join so presence
      // is already handled above; here we only need to move *this* client.
      if (evt.type === 'force_voice_join' && evt.channel_id && evt.user_id) {
        if (evt.user_id === api.userId) {
          const ch = channelsRef.current.find((c: any) => c.id === evt.channel_id);
          if (ch) joinVoice(ch as any);
        }
      }
    };
    const unsub = api.onWsEvent(handler);
    // Latency ping every 10 seconds
    const pingInterval = setInterval(() => {
      if (api.ws?.readyState === 1) {
        pingRef.current = Date.now();
        api.ws.send(JSON.stringify({ type: 'ws_ping' }));
      }
    }, 10000);
    return () => { unsub(); clearInterval(pingInterval); api.disconnectWs(); };
  }, [curServer?.id]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, dmMsgs]);

  // Lazy-load members when member panel is opened
  useEffect(() => {
    if (panel === 'members' && curServer && membersLoaded !== curServer.id) {
      setMembersLoaded(curServer.id);
      loadMembers(curServer.id);
    }
  }, [panel, curServer?.id]);

  // ── Stream status polling ────────────────────────────────
  // Poll getStreamStatus for the current voice channel every 30 s to keep
  // viewer count and active state fresh (supplements WS events).
  useEffect(() => {
    if (!voiceChannel) return;
    const poll = async () => {
      const s = await api.getStreamStatus(voiceChannel.id);
      if (s) {
        setStreamStatus(p => ({
          ...p,
          [voiceChannel.id]: {
            active:      !!s.active,
            viewerCount: s.viewer_count ?? s.viewerCount ?? 0,
            viewerUrl:   s.viewer_url  ?? s.viewerUrl,
          },
        }));
      }
    };
    poll();
    const t = setInterval(poll, 30_000);
    return () => clearInterval(t);
  }, [voiceChannel?.id]);

  // ── Loaders ─────────────────────────────────────────────
  const loadServers = async (autoSelect?: boolean) => { setLoadingServers(true); try { const s = await api.listServers(); if (Array.isArray(s)) { setServers(s); if (autoSelect && s.length === 1 && !curServer) selectServer(s[0]); } } catch {} finally { setLoadingServers(false); } };
  const loadDms = async () => {
    try {
      const d = await api.listDms();
      const all = Array.isArray(d) ? d : d?.channels || [];
      const hidden: string[] = JSON.parse(localStorage.getItem('d_hidden_dms') || '[]');
      const visible = all.filter((dm: DM) => !hidden.includes(dm.id));
      setDms(visible);
      // Compute unread counts by comparing last_message_at vs stored last-read timestamp.
      const counts: Record<string, number> = {};
      for (const dm of visible) {
        const lastRead = parseInt(localStorage.getItem(`d_dm_last_read_${dm.id}`) || '0', 10);
        const lastMsgAt = dm.last_message_at ? new Date(dm.last_message_at).getTime() : 0;
        if (lastMsgAt > lastRead && lastMsgAt > 0) counts[dm.id] = 1;
      }
      setDmUnreadCounts(counts);
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      if (total > 0) {
        setToast(`You have ${total} unread message${total !== 1 ? 's' : ''}`);
        setTimeout(() => setToast(''), 4000);
      }
    } catch {}
    try { const g = await api.listGroupDms(); if (Array.isArray(g)) setGroupDms(g); } catch {}
  };
  const loadChannels = async (sid: string): Promise<Channel[]> => {
    setLoadingChannels(true);
    try {
      const c = await api.listChannels(sid);
      if (Array.isArray(c)) {
        setChannels(c);
        // Restore persistent unread state from localStorage.
        // Uses last_message_at if the API provides it; otherwise only WS increments apply.
        const restored: Record<string, number> = {};
        for (const ch of c as Channel[]) {
          if (ch.channel_type && ch.channel_type !== 'text') continue;
          const lastRead = parseInt(localStorage.getItem(`d_channel_last_read_${ch.id}`) || '0', 10);
          const lastMsgAt = ch.last_message_at ? new Date(ch.last_message_at).getTime() : 0;
          if (lastMsgAt > lastRead && lastMsgAt > 0) restored[ch.id] = 1;
        }
        if (Object.keys(restored).length > 0) {
          setUnreadCounts(p => ({ ...p, ...restored }));
        }
        return c as Channel[];
      }
      return [];
    } catch { return []; } finally { setLoadingChannels(false); }
  };
  const loadCategories = async (sid: string) => { try { const c = await api.listCategories(sid); if (Array.isArray(c)) setCategories(c); } catch {} };
  const loadMembers = async (sid: string) => {
    setLoadingMembers(true);
    try { const m = await api.listMembers(sid); if (Array.isArray(m)) { setMembers(m); const map: Record<string, string> = {}; const raw: Record<string, string> = {}; const bm: Record<string, { badge_type: string | null; account_tier: string | null }> = {}; m.forEach((u: any) => { map[u.user_id] = u.nickname || u.display_name || u.username; raw[u.user_id] = u.username; bm[u.user_id] = { badge_type: u.badge_type ?? null, account_tier: u.account_tier ?? null }; }); setUserMap(p => ({ ...p, ...map })); setRawUsernameMap(p => ({ ...p, ...raw })); setBadgeMap(prev => ({ ...prev, ...bm })); } } catch {} finally { setLoadingMembers(false); }
  };
  const loadRoles = async (sid: string) => {
    try { const r = await api.listRoles(sid); if (Array.isArray(r)) setRoles(r); } catch {}
  };
  const loadMessages = async (ch: Channel | null) => {
    if (!ch) return;
    setLoadingMessages(true);
    try { const raw = await api.getMessages(ch.id, 50); if (!Array.isArray(raw)) { console.error('[msg] not array:', raw); return; } const decrypted = await Promise.all(raw.map(async (m: any) => ({ ...m, text: await dec(ch.id, m.content_ciphertext).catch(() => m.content_ciphertext), authorName: userMap[m.author_id] || 'Unknown' }))); setMessages(decrypted.reverse()); } catch (e) { console.error('[msg] load error:', e); } finally { setLoadingMessages(false); }
  };
  const loadDmMessages = async (dm: DM) => {
    try { const raw = await api.getDmMessages(dm.id, 50); if (Array.isArray(raw)) setDmMsgs(raw.reverse()); } catch {}
  };

  // ── Actions ─────────────────────────────────────────────
  const selectServer = async (s: Server) => {
    if (voiceChannel) leaveVoice();
    // Flush read timestamps for whatever is open before switching.
    const now = String(Date.now());
    if (curChannelRef.current) localStorage.setItem(`d_channel_last_read_${curChannelRef.current.id}`, now);
    if (curDmRef.current)      localStorage.setItem(`d_dm_last_read_${curDmRef.current.id}`, now);
    setCurServer(s); setCurChannel(null); setCurDm(null); setMessages([]); setView('server'); setMobileMenuOpen(false);
    setMembersLoaded(null); setMembers([]);
    api.listEmojis(s.id).then((e: any) => setServerEmoji(Array.isArray(e) ? e : []));
    const [chs] = await Promise.all([loadChannels(s.id), loadCategories(s.id), loadRoles(s.id)]);
    // Auto-join: localStorage default → 'welcome'/'general' → first text channel
    const textChs = chs.filter((c: Channel) => !c.channel_type || c.channel_type === 'text');
    const savedId = localStorage.getItem(`d_default_channel_${s.id}`);
    const pick = (savedId && textChs.find((c: Channel) => c.id === savedId))
      || textChs.find((c: Channel) => c.name === 'welcome' || c.name === 'general')
      || textChs[0];
    if (pick) selectChannel(pick);
  };
  const selectChannel = async (ch: Channel) => {
    const now = String(Date.now());
    // Mark previous channel as read at switch-away time.
    if (curChannelRef.current && curChannelRef.current.id !== ch.id) {
      localStorage.setItem(`d_channel_last_read_${curChannelRef.current.id}`, now);
    }
    // Mark new channel as read now (we're opening it).
    localStorage.setItem(`d_channel_last_read_${ch.id}`, now);
    setCurChannel(ch); setOpenThread(null); setMobileMenuOpen(false); setTypingUsers({});
    setUnreadCounts(p => { const n = { ...p }; delete n[ch.id]; return n; });
    setMentionCounts(p => { const n = { ...p }; delete n[ch.id]; return n; });
    setChannelFadeKey(k => k + 1); setMsgScrollTop(0);
    await loadMessages(ch); inputRef.current?.focus();
  };
  const selectDm = async (dm: DM) => {
    if (voiceChannel) leaveVoice();
    const now = String(Date.now());
    // Flush read state for whatever was open.
    if (curChannelRef.current) localStorage.setItem(`d_channel_last_read_${curChannelRef.current.id}`, now);
    if (curDmRef.current && curDmRef.current.id !== dm.id) localStorage.setItem(`d_dm_last_read_${curDmRef.current.id}`, now);
    // Mark target DM as read.
    localStorage.setItem(`d_dm_last_read_${dm.id}`, now);
    setDmUnreadCounts(p => { const n = { ...p }; delete n[dm.id]; return n; });
    setCurDm(dm); setCurGroupDm(null); setCurServer(null); setView('dm'); setMobileMenuOpen(false);
    await loadDmMessages(dm);
  };
  const selectGroupDm = async (gdm: any) => {
    if (voiceChannel) leaveVoice();
    setCurGroupDm(gdm); setCurDm(null); setCurServer(null); setView('dm'); setMobileMenuOpen(false);
    try { const raw = await api.getGroupDmMessages(gdm.id); if (Array.isArray(raw)) setDmMsgs(raw.reverse()); } catch {}
  };
  const goHome = () => { if (voiceChannel) leaveVoice(); setView('home'); setHomeTab('home'); setCurServer(null); setCurChannel(null); setCurDm(null); setCurGroupDm(null); setMessages([]); setDmMsgs([]); setServerEmoji([]); setMobileMenuOpen(false); };
  const getName = (uid: string) => userMap[uid] || uid?.slice(0, 8) || '?';

  // Inline badge shown after a username. badge_type drives the emoji; account_tier
  // drives the text label for users with no special badge.
  const renderPlatformBadge = (uid: string) => {
    const e = uid === api.userId ? badgeMap[uid] : badgeMap[uid];
    if (!e) return null;
    const { badge_type: bt, account_tier: at } = e;
    if (bt === 'crown')  return <span title="Platform Admin" style={{ marginLeft: 3, fontSize: 11, color: '#faa61a', verticalAlign: 'middle' }}>👑</span>;
    if (bt === 'wrench') return <span title="Developer"      style={{ marginLeft: 3, fontSize: 11, color: '#5865F2', verticalAlign: 'middle' }}>🔧</span>;
    if (bt === 'gem')    return <span title="Premium"        style={{ marginLeft: 3, fontSize: 11, color: '#a855f7', verticalAlign: 'middle' }}>💎</span>;
    if (bt === 'shield') return <span title="Verified"       style={{ marginLeft: 3, fontSize: 11, color: '#10b981', verticalAlign: 'middle' }}>🛡️</span>;
    if (at === 'unverified') return <span style={{ marginLeft: 3, fontSize: 10, color: '#6b7280', verticalAlign: 'middle' }}>Unverified</span>;
    if (at === 'guest')      return <span style={{ marginLeft: 3, fontSize: 10, color: '#6b7280', verticalAlign: 'middle' }}>Guest</span>;
    return null;
  };

  const pushNotif = (n: AppNotification) => {
    setNotifications(prev => {
      const next = [n, ...prev];
      saveNotifications(next);
      return next;
    });
  };

  const sendMessage = async () => {
    if (!msgInput.trim()) return;
    let text = sanitizeInput(msgInput.trim());
    if (!text) return;
    if (!validateMessageLength(text)) {
      setToast('Message too long — max 4,000 characters');
      setTimeout(() => setToast(''), 3000);
      return;
    }
    if (!checkRateLimit('d_msg_count', 'd_msg_window', 60_000, tierLimits.maxMessagesPerMinute)) {
      if (me?.is_guest) { setUpgradeFeature('send messages'); return; }
      setToast(`Message limit reached — ${tierLimits.maxMessagesPerMinute}/min for your tier. Verify your email to unlock unlimited messaging.`);
      setTimeout(() => setToast(''), 4000);
      return;
    }
    if (!rateLimitCheck('send_message', 30)) {
      setToast('Slow down — you\'re sending messages too quickly');
      setTimeout(() => setToast(''), 3000);
      return;
    }
    try {
      // Slash commands — unified registry handles tool overlays, presence, etc.
      if (msgInput.startsWith('/')) {
        const slashCtx: SlashContext = {
          members: members.map(m => ({ user_id: m.user_id, username: m.username, display_name: m.display_name })),
          allRoles: roles.map(r => ({ id: r.id, name: r.name })),
          curServer, curChannel, voiceChannel,
          isGuest: !!me?.is_guest,
          setMembers: setMembers as any,
          setModal: setModal as any,
          setShowInputEmoji: setShowEmojiPicker,
          setWatchParty: () => {},
          setShowMeeting,
          handleAssignRole: async (uid: string, rid: string) => { if (curServer) await api.assignRole(curServer.id, uid, rid); },
          loadMsgs: () => curChannel ? loadMessages(curChannel) : undefined,
          setInput: (text: string) => setMsgInput(text),
          goDiscover: () => { setView('home'); setHomeTab('discover'); },
          setSlashTool,
          changeStatus,
          setToast: (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); },
          logout: async () => { await api.logout(); setAuthed(false); },
          clearMessages: () => setMessages([]),
        };
        const result = await processSlashCommand(msgInput, slashCtx);
        if (result.handled) {
          if (result.sendText) {
            // Visible command — override text and fall through to send
            text = result.sendText;
          } else {
            setMsgInput('');
            return;
          }
        }
      }
      if (editMsg) {
        const ct = await enc(curChannel!.id, msgInput.trim());
        await api.editMessage(editMsg.id, ct, 0);
        setEditMsg(null); setMsgInput(''); await loadMessages(curChannel); return;
      }
      if (curChannel) {
        console.log('[send] encrypting for channel:', curChannel.id);
        const ct = await enc(curChannel.id, text);
        console.log('[send] ciphertext length:', ct.length);
        // Extract mentioned user IDs from @mentions in text
        const mentionIds: string[] = [];
        const mentionRe2 = /@([\w.-]+)/g;
        let mm2;
        while ((mm2 = mentionRe2.exec(text)) !== null) {
          const name = mm2[1].toLowerCase();
          if (name === 'everyone') { mentionIds.push('00000000-0000-0000-0000-000000000000'); continue; }
          const found = members.find((mb: any) => mb.username?.toLowerCase() === name || mb.display_name?.toLowerCase() === name);
          if (found) mentionIds.push(found.user_id);
        }
        const threadRoot = replyTo ? (replyTo.parent_message_id || replyTo.id) : undefined;
        const res = await api.sendMessage(curChannel.id, ct, 0, replyTo?.id, threadRoot, mentionIds.length ? mentionIds : undefined);
        console.log('[send] response:', res);
        setMsgInput(''); setReplyTo(null); playSound('send'); await loadMessages(curChannel);
        // Trigger bot responses for any @mentioned bots in this message
        if (curServer) {
          const mentionRe = /@([\w.-]+)/g;
          let mm;
          while ((mm = mentionRe.exec(text)) !== null) {
            const mentioned = mm[1].toLowerCase();
            const bot = members.find(
              (mb: any) => mb.is_bot && (mb.username?.toLowerCase() === mentioned || mb.display_name?.toLowerCase() === mentioned),
            );
            if (bot) api.promptBot(curServer.id, bot.user_id, text, curChannel.id).catch(() => {});
          }
        }
      } else if (curGroupDm) {
        await api.sendGroupDm(curGroupDm.id, text);
        setMsgInput('');
        try { const raw = await api.getGroupDmMessages(curGroupDm.id); if (Array.isArray(raw)) setDmMsgs(raw.reverse()); } catch {}
      } else if (curDm) {
        await api.sendDmMessage(curDm.id, text);
        setMsgInput(''); await loadDmMessages(curDm);
        // Trigger bot response when DMing a bot directly
        const botMember = members.find((mb: any) => mb.user_id === curDm.other_user_id && mb.is_bot);
        if (botMember && curServer) {
          api.promptBot(curServer.id, botMember.user_id, text).catch(() => {});
        }
      }
    } catch (e: any) {
      console.error('[send] FAILED:', e);
      setToast('Send failed: ' + (e?.message || 'Unknown error'));
      setTimeout(() => setToast(''), 5000);
    }
  };

  // Purge stale typing indicators every 2 s (remove entries older than 6 s)
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - 5000;
      setTypingUsers(p => {
        const next = Object.fromEntries(Object.entries(p).filter(([, ts]) => ts > cutoff));
        return Object.keys(next).length === Object.keys(p).length ? p : next;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);
  const openInviteModal = () => { setInviteResult(''); setModal('invite-config'); };

  /** Extract invite code from a full URL or bare code. Returns the code or null. */
  const extractInviteCode = (input: string): string | null => {
    // Full URL: https://host/invite/CODE
    const m = input.match(/\/invite\/([A-Za-z0-9]+)\/?$/);
    if (m) return m[1];
    // Bare code (alphanumeric, 4-12 chars)
    if (/^[A-Za-z0-9]{4,12}$/.test(input)) return input;
    return input; // fallback — let the server validate
  };

  const startDm = async (uid: string) => {
    if (!checkRateLimit('d_dm_count', 'd_dm_window', 24 * 60 * 60_000, tierLimits.maxDmsPerDay)) {
      if (me?.is_guest) { setUpgradeFeature('send direct messages'); return; }
      setToast(`DM limit reached — ${tierLimits.maxDmsPerDay} new DMs per day for your tier. Verify your email to unlock unlimited DMs.`);
      setTimeout(() => setToast(''), 4000);
      return;
    }
    const dm = await api.createDm(uid);
    if (dm?.id) { setDms(p => [dm, ...p.filter(d => d.id !== dm.id)]); selectDm(dm); }
  };

  const generateInvite = async () => {
    if (!curServer || inviteGenerating) return;
    setInviteGenerating(true);
    try {
      const expiresAt = (() => {
        if (inviteExpiry === 'never') return null;
        const mins: Record<string, number> = { '30m': 30, '1h': 60, '6h': 360, '12h': 720, '1d': 1440, '7d': 10080 };
        const d = new Date(); d.setMinutes(d.getMinutes() + (mins[inviteExpiry] ?? 10080));
        return d.toISOString();
      })();
      const inv = await api.createInvite(curServer.id, { expires_at: expiresAt, max_uses: inviteMaxUses, temporary: inviteTemporary });
      const code = inv?.code || inv?.invite_code;
      if (code) setInviteResult(code);
      else setToast('Failed to create invite');
    } catch { setToast('Failed to create invite'); setTimeout(() => setToast(''), 3000); }
    setInviteGenerating(false);
  };

  const addReaction = async (msgId: string, emoji: string) => {
    if (curChannel) {
      setReactions(p => ({ ...p, [msgId]: [...(p[msgId] || []), { emoji, user_id: api.userId }] }));
      try { await api.addReaction(curChannel.id, msgId, emoji); } catch {
        setReactions(p => ({ ...p, [msgId]: (p[msgId] || []).filter(r => !(r.emoji === emoji && r.user_id === api.userId)) }));
      }
    }
    setEmojiTarget(null);
  };
  const removeReaction = async (msgId: string, emoji: string) => {
    if (curChannel) {
      setReactions(p => ({ ...p, [msgId]: (p[msgId] || []).filter(r => !(r.emoji === emoji && r.user_id === api.userId)) }));
      try { await api.removeReaction(curChannel.id, msgId, emoji); } catch {
        setReactions(p => ({ ...p, [msgId]: [...(p[msgId] || []), { emoji, user_id: api.userId }] }));
      }
    }
  };
  const toggleReaction = (msgId: string, emoji: string) => {
    const alreadyReacted = (reactions[msgId] || []).some(r => r.emoji === emoji && r.user_id === api.userId);
    if (alreadyReacted) removeReaction(msgId, emoji); else addReaction(msgId, emoji);
  };

  const [serverPreset, setServerPreset] = useState<string | null>(null);
  const [serverCreating, setServerCreating] = useState(false);
  const [enableAutomod, setEnableAutomod] = useState(true);
  const tier = getUserTier(me);
  const _devEmails = (localStorage.getItem('d_dev_emails') || 'admin@discreet.chat')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const isDev = (me?.email && _devEmails.includes(me.email.toLowerCase())) ||
    localStorage.getItem('d_dev_local') === 'true';
  const isPlatformDevOrAdmin = platformUser?.platform_role === 'dev' || platformUser?.platform_role === 'admin';
  const effectiveTier: Tier = (isPlatformDevOrAdmin && devTierOverride)
    ? devTierOverride
    : (isDev && tierRank(tier) < tierRank('verified') ? 'verified' : tier);
  const tierLimits = TIER_LIMITS[effectiveTier];

  const createServer = async () => {
    if (!createName.trim() || serverCreating) return;
    const ownedServers = servers.filter(s => s.owner_id === api.userId);
    if (ownedServers.length >= tierLimits.maxServers) {
      if (me?.is_guest) { setUpgradeFeature('create servers'); return; }
      setToast('Verify your email to unlock this feature'); setTimeout(() => setToast(''), 4000); return;
    }
    setServerCreating(true);
    try {
      const s = await api.createServer(sanitizeInput(createName.trim()), { enable_automod: enableAutomod });
    if (s?.id) {
      // Apply preset channels
      if (serverPreset === 'gaming') {
        await api.createChannel(s.id, 'strategy', null, 'text');
        await api.createChannel(s.id, 'looking-for-group', null, 'text');
        const _vch = await api.createChannel(s.id, 'game-lobby', null, 'voice');
        await api.createChannel(s.id, 'team-chat', null, 'voice');
        if (tierLimits.maxBots > 0) try {
          const _bot = await api.spawnBot(s.id, { persona: 'gaming', display_name: 'Game Master' });
          if (_bot && _vch?.id) setTimeout(() => api.ws?.send(JSON.stringify({ type: 'force_voice_join', user_id: _bot.bot_user_id || _bot.user_id, channel_id: _vch.id })), 2000);
        } catch {}
      } else if (serverPreset === 'meeting') {
        await api.createChannel(s.id, 'agenda', null, 'text');
        await api.createChannel(s.id, 'notes', null, 'text');
        await api.createChannel(s.id, 'action-items', null, 'text');
        const _vch = await api.createChannel(s.id, 'meeting-room', null, 'voice');
        if (tierLimits.maxBots > 0) try {
          const _bot = await api.spawnBot(s.id, { persona: 'general', display_name: 'Meeting Bot' });
          if (_bot && _vch?.id) setTimeout(() => api.ws?.send(JSON.stringify({ type: 'force_voice_join', user_id: _bot.bot_user_id || _bot.user_id, channel_id: _vch.id })), 2000);
        } catch {}
      } else if (serverPreset === 'community') {
        await api.createChannel(s.id, 'introductions', null, 'text');
        await api.createChannel(s.id, 'off-topic', null, 'text');
        const _vch = await api.createChannel(s.id, 'hangout', null, 'voice');
        if (tierLimits.maxBots > 0) try {
          const _bot = await api.spawnBot(s.id, { persona: 'general', display_name: 'Community Bot' });
          if (_bot && _vch?.id) setTimeout(() => api.ws?.send(JSON.stringify({ type: 'force_voice_join', user_id: _bot.bot_user_id || _bot.user_id, channel_id: _vch.id })), 2000);
        } catch {}
      } else if (serverPreset === 'study') {
        await api.createChannel(s.id, 'resources', null, 'text');
        await api.createChannel(s.id, 'questions', null, 'text');
        const _vch = await api.createChannel(s.id, 'study-hall', null, 'voice');
        if (tierLimits.maxBots > 0) try {
          const _bot = await api.spawnBot(s.id, { persona: 'coding', display_name: 'Tutor Bot' });
          if (_bot && _vch?.id) setTimeout(() => api.ws?.send(JSON.stringify({ type: 'force_voice_join', user_id: _bot.bot_user_id || _bot.user_id, channel_id: _vch.id })), 2000);
        } catch {}
      }
      // Quick creation with no preset still gets general + voice
      if (!serverPreset) {
        // Server already has #general from backend
      }
      await loadServers(); await selectServer(s);
    }
    setCreateName(''); setServerPreset(null); setModal(null);
    } finally { setServerCreating(false); }
  };

  const showConfirm = (title: string, message: string, danger?: boolean, confirmPhrase?: string, confirmLabel?: string): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmDialog({ title, message, danger, confirmPhrase, confirmLabel, resolve });
    });
  };

  // ── Message Context Menu ────────────────────────────────
  const openMsgCtx = (e: React.MouseEvent, m: Msg) => {
    e.preventDefault();
    const isMine = m.author_id === api.userId;
    const items: CtxMenuItem[] = [];
    if (isMine) {
      items.push({ label: 'Edit Message', icon: <I.Edit />, fn: () => { setEditMsg(m); setMsgInput(m.text || ''); inputRef.current?.focus(); } });
    }
    if (isMine || hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.MODERATOR)) {
      items.push({ label: 'Delete Message', icon: <I.Trash />, danger: true, fn: async () => { await api.deleteMessage(m.id); setMessages(p => p.filter(x => x.id !== m.id)); } });
    }
    items.push({ sep: true });
    items.push({ label: 'Reply', icon: <I.Reply />, fn: () => { setReplyTo(m); inputRef.current?.focus(); } });
    if (curChannel) {
      items.push({ label: 'Create Thread', icon: <I.Msg />, fn: () => setOpenThread({ id: m.id, author_id: m.author_id, text: m.text, authorName: getName(m.author_id), created_at: m.created_at }) });
    }
    items.push({ label: 'React', icon: <I.Smile />, fn: () => setEmojiTarget(m.id) });
    if (curServer && curChannel) {
      items.push({ label: 'Pin Message', icon: <I.Lock />, fn: async () => { await api.pinMessage(curServer.id, curChannel.id, m.id); setToast('Message pinned'); setTimeout(() => setToast(''), 2000); } });
    }
    items.push({ label: 'Mention Author', icon: <I.At />, fn: () => { setMsgInput(p => p + `@${getName(m.author_id)} `); inputRef.current?.focus(); } });
    items.push({ sep: true });
    items.push({ label: 'Copy Text', icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(m.text || '') });
    items.push({ label: 'Copy Message ID', icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(m.id) });
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ── Move to Voice ────────────────────────────────────────
  const moveToVoice = (targetUid: string) => {
    const targetCh = voiceChannel || channels.find((c: any) => c.channel_type === 'voice');
    if (!targetCh || !curServer) return;
    api.ws?.send(JSON.stringify({ type: 'force_voice_join', user_id: targetUid, channel_id: targetCh.id }));
    setToast(`Moving ${getName(targetUid)} to #${targetCh.name}`);
    setTimeout(() => setToast(''), 2000);
  };

  // ── Member Context Menu ─────────────────────────────────
  const openMemberCtx = (e: React.MouseEvent, uid: string) => {
    e.preventDefault();
    const items: CtxMenuItem[] = [
      { label: 'View Profile', icon: <I.Users />, fn: () => setProfileCard({ userId: uid, pos: { x: e.clientX, y: e.clientY } }) },
      { label: 'Send Message', icon: <I.Msg />, fn: () => startDm(uid) },
      ...(uid !== api.userId ? [{ label: 'Send Friend Request', icon: <I.UserPlus />, fn: async () => { try { await api.sendFriendRequest(uid); setToast('Friend request sent!'); } catch { setToast('Could not send request'); } setTimeout(() => setToast(''), 2000); } }] : []),
      { label: 'Copy User ID', icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(uid) },
    ];
    if (hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.MODERATOR) && uid !== api.userId && uid !== curServer?.owner_id) {
      items.push({ sep: true });
      const hasVoiceCh = channels.some((c: any) => c.channel_type === 'voice');
      const targetIsBot = members.find(m => m.user_id === uid)?.is_bot;
      if (hasVoiceCh) {
        items.push({ label: targetIsBot ? '🔊 Move Bot to Voice' : '🔊 Move to Voice', icon: <I.Vol />, fn: () => moveToVoice(uid) });
      }
      // Role assignment submenu
      roles.filter(r => r.name !== '@everyone').slice(0, 3).forEach(r => {
        items.push({ label: `Assign ${r.name}`, icon: <I.Shield />, fn: async () => {
          if (curServer) await api.assignRole(curServer.id, uid, r.id);
          setToast(`Assigned ${r.name}`); setTimeout(() => setToast(''), 2000);
        }});
      });
      items.push({ sep: true });
      items.push({ label: 'Timeout (10 min)', icon: <I.Clock />, fn: async () => {
        if (curServer) await api.timeoutMember(curServer.id, uid, 600);
        setToast(`Timed out ${getName(uid)}`); setTimeout(() => setToast(''), 2000);
      }});
      items.push({ label: 'Kick', icon: <I.Out />, danger: true, fn: async () => {
        if (await showConfirm('Kick', `Kick ${getName(uid)}?`)) {
          if (curServer) await api.kickMember(curServer.id, uid);
          await loadMembers(curServer!.id);
        }
      }});
      items.push({ label: 'Ban', icon: <I.Trash />, danger: true, fn: async () => {
        if (await showConfirm('Ban', `Ban ${getName(uid)} permanently?`, true)) {
          if (curServer) await api.banUser(curServer.id, uid, 'Banned');
          await loadMembers(curServer!.id);
        }
      }});
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  const [, forceUpdate] = useState(0);
  const handleThemeChange = (name: string) => { setTheme(name); forceUpdate(n => n + 1); };

  // Clock update
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  if (maintenanceMsg) return <MaintenancePage message={maintenanceMsg} />;

  if (authLoading) return <><div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#1a1a2e',color:'#e0e0e0',fontFamily:'Inter,sans-serif'}}>Restoring session…</div><BugReportButton /></>;
  if (!authed) return <><AuthScreen onAuth={() => setAuthed(true)} /><BugReportButton /></>;

  const isOwner = curServer?.owner_id === api.userId;
  const isAnyOwner = servers.some(s => s.owner_id === api.userId);
  const totalDmUnread = Object.values(dmUnreadCounts).reduce((s, n) => s + n, 0);
  const myMember = curServer ? members.find(m => m.user_id === api.userId) : undefined;
  const myPrivilege = getUserLevel(myMember ?? null, curServer?.owner_id ?? '', roles);
  const curTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const curDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  // ── Server icon render helper (with favorites/folders/drag) ──────────
  const toggleFavorite = (sid: string) => {
    setServerFavorites(prev => {
      const next = prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid];
      localStorage.setItem('d_srv_favs', JSON.stringify(next));
      return next;
    });
  };
  const addToFolder = (sid: string, folderName: string) => {
    setServerFolders(prev => {
      const next = { ...prev };
      // Remove from any existing folder
      for (const k of Object.keys(next)) next[k] = next[k].filter(x => x !== sid);
      if (!next[folderName]) next[folderName] = [];
      next[folderName].push(sid);
      // Clean empty folders
      for (const k of Object.keys(next)) { if (next[k].length === 0) delete next[k]; }
      localStorage.setItem('d_srv_folders', JSON.stringify(next));
      return next;
    });
  };
  const removeFromFolder = (sid: string) => {
    setServerFolders(prev => {
      const next = { ...prev };
      for (const k of Object.keys(next)) next[k] = next[k].filter(x => x !== sid);
      for (const k of Object.keys(next)) { if (next[k].length === 0) delete next[k]; }
      localStorage.setItem('d_srv_folders', JSON.stringify(next));
      return next;
    });
  };
  const renderServerIcon = (s: Server, isFav: boolean) => {
    const isActive = curServer?.id === s.id;
    const hasUnread = Object.entries(unreadCounts).some(([k, v]) => v > 0 && channels.some(c => c.id === k && c.server_id === s.id));
    return (
    <div key={s.id} onClick={() => selectServer(s)}
      className={`srv-icon${isActive ? ' srv-icon--active' : hasUnread && !isActive ? ' srv-icon--unread' : ''}`}
      draggable onDragStart={() => setDragServer(s.id)} onDragOver={e => e.preventDefault()}
      onDrop={() => { if (dragServer && dragServer !== s.id) { /* basic reorder: swap */ setServers(prev => { const arr = [...prev]; const fi = arr.findIndex(x => x.id === dragServer); const ti = arr.findIndex(x => x.id === s.id); if (fi >= 0 && ti >= 0) { [arr[fi], arr[ti]] = [arr[ti], arr[fi]]; } return arr; }); setDragServer(null); } }}
      onContextMenu={(e) => {
        e.preventDefault();
        const items: CtxMenuItem[] = [
          { label: isFav ? '★ Unfavorite' : '☆ Favorite', icon: <I.Star />, fn: () => toggleFavorite(s.id) },
          { label: 'Invite People', icon: <I.UserPlus />, fn: () => openInviteModal() },
          { label: 'Server Settings', icon: <I.Settings />, fn: () => { selectServer(s).then(() => setModal('server-settings')); } },
          { sep: true },
        ];
        // Folder options
        const folderNames = Object.keys(serverFolders);
        if (folderNames.length > 0) {
          folderNames.forEach(fn => items.push({ label: `📁 Move to ${fn}`, fn: () => addToFolder(s.id, fn) }));
          items.push({ label: '📁 Remove from Folder', fn: () => removeFromFolder(s.id) });
          items.push({ sep: true });
        }
        items.push({ label: '📁 New Folder…', fn: () => { const name = prompt('Folder name:'); if (name?.trim()) addToFolder(s.id, name.trim()); } });
        items.push({ label: 'Copy Server ID', icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(s.id) });
        if (s.owner_id === api.userId) items.push({ label: 'Delete Server', icon: <I.Trash />, danger: true, fn: async () => { if (await showConfirm('Delete Server', `This will permanently delete "${s.name}" and ALL its channels, messages, roles, and members. This action cannot be undone.`, true, s.name, 'Delete Server')) { await api.deleteServer(s.id); await loadServers(); goHome(); } } });
        else items.push({ label: 'Leave Server', icon: <I.Out />, danger: true, fn: async () => { if (await showConfirm('Leave Server', `You are about to leave "${s.name}". You will lose access to all channels and messages unless you rejoin with an invite.`, true, s.name, 'Leave Server')) { await api.leaveServer(s.id); await loadServers(); goHome(); } } });
        setCtxMenu({ x: e.clientX, y: e.clientY, items });
      }}
      title={s.name}
      style={{ width: 48, height: 48, borderRadius: isActive ? 16 : 24, background: s.icon_url ? 'transparent' : (isActive ? `linear-gradient(135deg,${T.ac},${T.ac2})` : T.sf2), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'border-radius .2s, box-shadow .15s ease', fontSize: 16, fontWeight: 700, color: isActive ? '#000' : T.tx, overflow: 'hidden', position: 'relative' }}>
      {s.icon_url ? <img src={s.icon_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover' }} /> : s.name[0]?.toUpperCase()}
      {isFav && <div style={{ position: 'absolute', bottom: -1, right: -1, fontSize: 8, color: '#f0b232' }}>★</div>}
      {hasUnread && !isActive && (
        <div style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5, background: T.err, border: `2px solid ${T.bg}` }} />
      )}
    </div>
    );
  };

  // ══════════════════════════════════════════════════════════
  return (
    <div className="chat-root" style={{ color: T.tx, fontFamily: "'DM Sans',sans-serif", background: T.bg }}>
      <GlobalStyles />
      {/* Verify email banner — shown when user skipped verification */}
      {me && !me.email_verified && me.email && !verifyBannerDismissed && _storage.getItem('d_verify_skipped') === '1' && (
        <VerifyEmailBanner
          onVerify={() => setModal('settings')}
          onDismiss={() => { setVerifyBannerDismissed(true); _storage.setItem('d_verify_dismissed', '1'); }}
        />
      )}
      {mobileMenuOpen && <div className="mobile-backdrop" onClick={() => setMobileMenuOpen(false)} />}

      {/* ═══ Server Rail ═══ */}
      <div className="server-rail" style={{ width: 68, minWidth: 68, background: T.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 4, borderRight: `1px solid ${T.bd}`, overflowY: 'auto' }}>
        <div className={`srv-icon${view === 'home' ? ' srv-icon--active' : ''}`} onClick={goHome} title="Home" style={{ width: 48, height: 48, borderRadius: view === 'home' ? 16 : 24, background: view === 'home' ? `linear-gradient(135deg,${T.ac},${T.ac2})` : T.sf2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'border-radius .2s, box-shadow .15s ease', color: view === 'home' ? '#000' : T.tx }}><I.Home /></div>
        {/* DM button */}
        <div title="Direct Messages" style={{ width: 48, height: 48, borderRadius: view === 'dm' ? 16 : 24, background: view === 'dm' ? `linear-gradient(135deg,${T.ac},${T.ac2})` : T.sf2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'border-radius .2s', color: view === 'dm' ? '#000' : T.tx, position: 'relative', fontSize: 14 }} onClick={() => { setView('dm'); }}>
          <I.Msg />
          {totalDmUnread > 0 && <div style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 12, background: '#ed4245', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${T.bg}`, padding: '0 3px' }}>{totalDmUnread}</div>}
        </div>
        <div style={{ width: 28, height: 2, background: T.bd, borderRadius: 1, margin: '4px 0' }} />
        {/* Favorite servers */}
        {(() => {
          const favServers = servers.filter(s => serverFavorites.includes(s.id));
          if (favServers.length === 0) return null;
          return (<>
            {favServers.map(s => renderServerIcon(s, true))}
            <div style={{ width: 28, height: 2, background: `${T.ac}44`, borderRadius: 1, marginBottom: 2 }} />
          </>);
        })()}
        {/* Folders */}
        {Object.entries(serverFolders).map(([folderName, ids]) => {
          const folderServers = servers.filter(s => ids.includes(s.id));
          if (folderServers.length === 0) return null;
          const collapsed = collapsedFolders.has(folderName);
          return (<React.Fragment key={`f-${folderName}`}>
            <div onClick={() => setCollapsedFolders(prev => { const n = new Set(prev); n.has(folderName) ? n.delete(folderName) : n.add(folderName); return n; })} title={folderName} style={{ width: 42, height: 20, borderRadius: 6, background: T.sf2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 9, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.3px', overflow: 'hidden', whiteSpace: 'nowrap', marginBottom: 2 }}>
              {collapsed ? '▸' : '▾'} {folderName.slice(0, 4)}
            </div>
            {!collapsed && folderServers.map(s => renderServerIcon(s, false))}
          </React.Fragment>);
        })}
        {/* Regular servers (not in favorites or folders) */}
        {loadingServers && servers.length === 0
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ width: 48, height: 48, borderRadius: 24, ...shimBase }} />
            ))
          : (() => {
              const inFolder = new Set(Object.values(serverFolders).flat());
              return servers.filter(s => !serverFavorites.includes(s.id) && !inFolder.has(s.id)).map(s => renderServerIcon(s, false));
            })()
        }
        <div onClick={() => me?.is_guest ? setUpgradeFeature('create servers') : setModal('create-server')} title="Create Server" style={{ width: 48, height: 48, borderRadius: 24, background: T.sf2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: T.ac, fontSize: 20 }}>+</div>
      </div>

      {/* ═══ Sidebar ═══ */}
      <div className={`sidebar${mobileMenuOpen ? ' sidebar--open' : ''}`} style={{ width: 230, minWidth: 230, background: T.sf, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.bd}` }}>
        <div onContextMenu={e => {
          if (view === 'server' && curServer) {
            e.preventDefault();
            const items: CtxMenuItem[] = [
              { label: 'Invite People', icon: <I.UserPlus />, fn: () => openInviteModal() },
              { label: 'Create Channel', icon: <I.Plus />, fn: () => setModal('create-channel') },
            ];
            if (hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.ADMIN)) {
              items.push({ sep: true });
              items.push({ label: 'Server Settings', icon: <I.Settings />, fn: () => setModal('server-settings') });
              items.push({ label: 'Leave Server', icon: <I.Out />, danger: true, fn: async () => { if (await showConfirm('Leave Server', `You are about to leave "${curServer.name}". You will lose access to all channels and messages unless you rejoin with an invite.`, true, curServer.name, 'Leave Server')) { await api.leaveServer(curServer.id); await loadServers(); goHome(); } } });
            }
            setCtxMenu({ x: e.clientX, y: e.clientY, items });
          }
        }} style={{ padding: '12px 14px', borderBottom: `1px solid ${T.bd}`, fontWeight: 700, fontSize: 15, cursor: view === 'server' ? 'pointer' : 'default' }}>
          {view === 'server' && curServer ? curServer.name : 'Discreet'}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
          {view !== 'server' && (<>
            <div onClick={goHome} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: homeTab === 'home' ? T.ac : T.mt, background: homeTab === 'home' ? 'rgba(0,212,170,0.08)' : 'transparent' }}><I.Home /> Home</div>
            <div onClick={() => { goHome(); setHomeTab('friends'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: homeTab === 'friends' ? T.ac : T.mt, background: homeTab === 'friends' ? 'rgba(0,212,170,0.08)' : 'transparent' }}><I.Users /> Friends</div>
            <div onClick={() => { goHome(); setHomeTab('events'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: homeTab === 'events' ? T.ac : T.mt, background: homeTab === 'events' ? 'rgba(0,212,170,0.08)' : 'transparent' }}><I.Clock /> Events</div>
            <div onClick={() => { goHome(); setHomeTab('leaderboard'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: homeTab === 'leaderboard' ? T.ac : T.mt, background: homeTab === 'leaderboard' ? 'rgba(0,212,170,0.08)' : 'transparent' }}>🏆 Leaderboard</div>
            <div onClick={() => { goHome(); setHomeTab('tools'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: homeTab === 'tools' ? T.ac : T.mt, background: homeTab === 'tools' ? 'rgba(0,212,170,0.08)' : 'transparent' }}>🧰 Tools</div>
            <div onClick={() => { goHome(); setHomeTab('discover'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: homeTab === 'discover' ? T.ac : T.mt, background: homeTab === 'discover' ? 'rgba(0,212,170,0.08)' : 'transparent' }}>🔭 Discover</div>
            {(isAnyOwner || isPlatformDevOrAdmin) && <div onClick={() => { goHome(); setHomeTab('admin'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: homeTab === 'admin' ? '#f0b232' : T.mt, background: homeTab === 'admin' ? 'rgba(240,178,50,0.08)' : 'transparent' }}>🛡️ Admin</div>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 6px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Direct Messages
                {totalDmUnread > 0 && <span style={{ background: '#ed4245', color: '#fff', borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '1px 5px', lineHeight: '14px' }}>{totalDmUnread}</span>}
              </span>
              <span onClick={async () => { const f = await api.listFriends(); setNewDmFriends(Array.isArray(f) ? f : []); setNewDmQuery(''); setNewDmSearchResults([]); setShowNewDmModal(true); }} title="New DM" style={{ cursor: 'pointer', color: T.mt, fontSize: 16, lineHeight: 1, padding: '0 2px' }} onMouseEnter={e => (e.currentTarget.style.color = T.ac)} onMouseLeave={e => (e.currentTarget.style.color = T.mt)}>+</span>
            </div>
            {dms.map(dm => (
              <div key={dm.id} onClick={() => selectDm(dm)} onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, items: [
                  { label: 'View Profile', icon: <I.Users />, fn: () => setProfileCard({ userId: dm.other_user_id, pos: { x: e.clientX, y: e.clientY } }) },
                  { sep: true },
                  { label: 'Close DM', icon: <I.X />, fn: () => {
                    const hidden: string[] = JSON.parse(localStorage.getItem('d_hidden_dms') || '[]');
                    if (!hidden.includes(dm.id)) { hidden.push(dm.id); localStorage.setItem('d_hidden_dms', JSON.stringify(hidden)); }
                    setDms(p => p.filter(d => d.id !== dm.id));
                    if (curDm?.id === dm.id) goHome();
                  }},
                  { label: 'Copy User ID', icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(dm.other_user_id) },
                ]});
              }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: curDm?.id === dm.id ? T.ac : T.mt, background: curDm?.id === dm.id ? 'rgba(0,212,170,0.08)' : 'transparent' }}>
                <Av name={dm.other_username} size={24} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dm.other_username}</span>
                {(dmUnreadCounts[dm.id] ?? 0) > 0 && (
                  <span style={{ background: '#ed4245', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 16, textAlign: 'center', lineHeight: '16px', flexShrink: 0 }}>{dmUnreadCounts[dm.id]}</span>
                )}
              </div>
            ))}
            {/* Group DMs */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 6px' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Group DMs</span>
              <span onClick={async () => { const f = await api.listFriends(); setGdmFriends(Array.isArray(f) ? f : []); setGdmSelected([]); setGdmName(''); setShowGroupDmModal(true); }} title="New Group DM" style={{ cursor: 'pointer', color: T.mt, fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                onMouseEnter={e => (e.currentTarget.style.color = T.ac)} onMouseLeave={e => (e.currentTarget.style.color = T.mt)}>+</span>
            </div>
            {groupDms.length === 0 && (
              <div style={{ fontSize: 11, color: T.mt, padding: '2px 10px 8px', fontStyle: 'italic' }}>No group chats yet</div>
            )}
            {groupDms.map(gdm => (
              <div key={gdm.id} onClick={() => selectGroupDm(gdm)} onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Leave Group', icon: <I.Out />, danger: true, fn: () => { setGroupDms(p => p.filter(g => g.id !== gdm.id)); if (curGroupDm?.id === gdm.id) goHome(); } }] }); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: curGroupDm?.id === gdm.id ? T.ac : T.mt, background: curGroupDm?.id === gdm.id ? 'rgba(0,212,170,0.08)' : 'transparent' }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>👥</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gdm.name || 'Group DM'}</span>
              </div>
            ))}
          </>)}
          {view === 'server' && (<>
            {/* Server actions */}
            {hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.ADMIN) && (
              <div style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                <div onClick={() => setModal('create-channel')} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: T.mt, textAlign: 'center', background: T.sf2, border: `1px solid ${T.bd}` }}>+ Channel</div>
                <div onClick={openInviteModal} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: T.mt, textAlign: 'center', background: T.sf2, border: `1px solid ${T.bd}` }}>Invite</div>
                <div onClick={() => setModal('server-settings')} style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', color: T.mt, background: T.sf2, border: `1px solid ${T.bd}` }}><I.Settings /></div>
              </div>
            )}
            {loadingChannels && channels.length === 0 ? (
              <div style={{ flex: 1, padding: '12px 10px' }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ ...shimBase, width: 14, height: 14, borderRadius: 3 }} />
                    <SkeletonBar w={`${50 + (i * 13) % 40}%`} h={12} mb={0} />
                  </div>
                ))}
              </div>
            ) : (
            <ChannelSidebar
              channels={channels as any}
              catData={categories.map(c => ({ id: c.id, name: c.name, position: c.position ?? 0 }))}
              curChannel={curChannel as any}
              voiceChannel={voiceChannel as any}
              voicePeers={voiceChannel ? [
                { id: api.userId!, name: api.username || '?', speaking: vc.speaking, self: true },
                ...Array.from(vc.streams.keys()).map(pid => ({ id: pid, name: getName(pid), speaking: false }))
              ] : []}
              voicePresence={voicePresence}
              memberMap={Object.fromEntries([
                ...members.map((m: any) => [m.user_id, { name: m.display_name || m.username, isBot: !!m.is_bot }]),
                [api.userId!, { name: api.username || '?', isBot: false }],
              ])}
              unreadCounts={unreadCounts}
              mentionCounts={mentionCounts}
              mutedChannels={{}}
              videoStreams={{}}
              streamStatus={streamStatus}
              sframeActive={vc.sframeActive}
              sframeSupported={sframeService.isSupported()}
              isOwner={hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.ADMIN)}
              canMoveMember={false}
              userMaxRolePos={0}
              onClick={(ch) => selectChannel(ch as any)}
              onVoiceClick={(ch) => joinVoice(ch as any)}
              onWatchStream={(ch) => {
                const info = streamStatus[ch.id];
                if (info?.active && info.viewerUrl) {
                  setWatchModal({ channelId: ch.id, name: ch.name, viewerUrl: info.viewerUrl });
                } else {
                  setToast('Stream URL not available yet — try again in a moment');
                  setTimeout(() => setToast(''), 3000);
                }
              }}
              onChannelSettings={(ch) => { setEditChannel(ch as any); setEditChannelName(ch.name); setEditChannelTopic((ch as any).topic || ''); setChSettingsTab('overview'); setChSlowmode((ch as any).slowmode_seconds || 0); setChNsfw((ch as any).is_nsfw || false); setChArchived((ch as any).is_archived || false); setChPermOverrides(JSON.parse(localStorage.getItem(`d_ch_perms_${ch.id}`) || '{}')); setModal('edit-channel'); }}
              onReorder={async (dragCh, targetCh) => {
                if (!curServer) return;
                await api.updateChannel(dragCh.id, { position: targetCh.position });
                await api.updateChannel(targetCh.id, { position: dragCh.position });
                await loadChannels(curServer.id);
              }}
              onMoveUserToVoice={() => {}}
              onChannelCtx={(e: React.MouseEvent, ch: any) => {
                e.preventDefault();
                const items: CtxMenuItem[] = [
                  { label: 'Invite to Channel', icon: <I.UserPlus />, fn: () => openInviteModal() },
                ];
                if (curChannel?.id !== ch.id) items.push({ label: 'Mark as Read', icon: <I.Check />, fn: () => setUnreadCounts(p => { const n = { ...p }; delete n[ch.id]; return n; }) });
                items.push({ label: 'Copy Channel ID', icon: <I.Copy />, fn: () => navigator.clipboard?.writeText(ch.id) });
                if (hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.ADMIN)) {
                  items.push({ sep: true });
                  items.push({ label: '⚙ Channel Settings', icon: <I.Settings />, fn: () => { setEditChannel(ch); setEditChannelName(ch.name); setEditChannelTopic((ch as any).topic || ''); setChSettingsTab('overview'); setChSlowmode((ch as any).slowmode_seconds || 0); setChNsfw((ch as any).is_nsfw || false); setChArchived((ch as any).is_archived || false); setChPermOverrides(JSON.parse(localStorage.getItem(`d_ch_perms_${ch.id}`) || '{}')); setModal('edit-channel'); } });
                  items.push({ label: 'Clone Channel', icon: <I.Plus />, fn: async () => { if (curServer) { await api.createChannel(curServer.id, `${ch.name}-copy`, null, ch.channel_type); await loadChannels(curServer.id); setToast('Channel cloned'); setTimeout(() => setToast(''), 2000); } } });
                  items.push({ sep: true });
                  items.push({ label: 'Delete Channel', icon: <I.Trash />, danger: true, fn: async () => { if (await showConfirm('Delete Channel', `This will permanently delete #${ch.name} and all its messages. This action cannot be undone.`, true, ch.name, 'Delete Channel')) { await api.deleteChannel(ch.id); if (curServer) await loadChannels(curServer.id); if (curChannel?.id === ch.id) setCurChannel(null); } } });
                }
                setCtxMenu({ x: e.clientX, y: e.clientY, items });
              }}
            />
            )}
          </>)}
        </div>
        {/* Voice Panel */}
        {voiceChannel && (
          <div style={{ padding: '8px 10px', borderTop: `1px solid ${T.bd}`, background: T.bg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: vc.speaking ? '#43b581' : T.ac, boxShadow: vc.speaking ? '0 0 0 2px #43b581, 0 0 8px rgba(67,181,129,0.6)' : 'none', transition: 'box-shadow .2s, background .2s' }} />
              <span style={{ fontSize: 11, color: T.ac, fontWeight: 600 }}>Voice Connected</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: T.mt, marginBottom: 6 }}>
              <span># {voiceChannel.name}</span>
              {vc.sframeActive ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(67,181,129,0.15)', color: '#43b581', fontWeight: 700 }}>
                  <I.ShieldCheck s={9} /> E2EE Voice
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(250,166,26,0.15)', color: '#faa61a', fontWeight: 700 }}>
                  <I.ShieldAlert s={9} /> Encrypted
                </span>
              )}
              {vc.latencyMs > 0 && (
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: vc.latencyMs > 150 ? 'rgba(255,71,87,0.15)' : vc.latencyMs > 80 ? 'rgba(250,166,26,0.15)' : 'rgba(67,181,129,0.15)', color: vc.latencyMs > 150 ? '#ff4757' : vc.latencyMs > 80 ? '#faa61a' : '#43b581', fontWeight: 700 }}>
                  {vc.latencyMs}ms
                </span>
              )}
              {vc.serverMuted && (
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,71,87,0.15)', color: '#ff4757', fontWeight: 700 }}>
                  Server Muted
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <div onClick={() => vc.toggleMute()} style={{ flex: 1, padding: '5px 0', textAlign: 'center', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: vc.muted ? 'rgba(255,71,87,0.15)' : T.sf2, color: vc.muted ? T.err : T.mt, border: `1px solid ${vc.muted ? 'rgba(255,71,87,0.3)' : T.bd}` }}>
                {vc.muted ? '🔇 Muted' : '🎤 Mic'}
              </div>
              <div onClick={() => vc.toggleDeafen()} style={{ flex: 1, padding: '5px 0', textAlign: 'center', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: vc.deafened ? 'rgba(255,71,87,0.15)' : T.sf2, color: vc.deafened ? T.err : T.mt, border: `1px solid ${vc.deafened ? 'rgba(255,71,87,0.3)' : T.bd}` }}>
                {vc.deafened ? '🔇 Deaf' : '🎧 Audio'}
              </div>
              <div onClick={() => vc.videoEnabled ? vc.stopVideo() : vc.startVideo()} style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: vc.videoEnabled ? `${T.ac}22` : T.sf2, color: vc.videoEnabled ? T.ac : T.mt, border: `1px solid ${T.bd}` }}>
                {vc.videoEnabled ? '📹 Cam' : '📹 Cam'}
              </div>
              <div onClick={() => vc.screenSharing ? vc.stopScreenShare() : vc.startScreenShare()} style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: vc.screenSharing ? `${T.ac}22` : T.sf2, color: vc.screenSharing ? T.ac : T.mt, border: `1px solid ${T.bd}` }}>
                {vc.screenSharing ? '🖥️ Live' : '🖥️ Share'}
              </div>
              {/* Go Live / Stop Streaming */}
              {myStreamChannelId === voiceChannel?.id ? (
                <div onClick={stopGoLive} title="Stop streaming" style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700, background: 'rgba(255,71,87,0.2)', color: T.err, border: '1px solid rgba(255,71,87,0.4)' }}>
                  ⏹ Stop
                </div>
              ) : (
                <div onClick={startGoLive} title="Go Live (RTMP to OBS)" style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700, background: 'rgba(255,71,87,0.08)', color: '#ff4757', border: '1px solid rgba(255,71,87,0.3)' }}>
                  🔴 Live
                </div>
              )}
              <div onClick={leaveVoice} style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.3)' }}>
                ✕
              </div>
            </div>
            {/* Audio level bar */}
            <div style={{ marginTop: 4, height: 3, background: T.sf2, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(vc.audioLevel * 500, 100)}%`, background: vc.speaking ? T.ac : T.mt, transition: 'width 0.1s', borderRadius: 2 }} />
            </div>
          </div>
        )}

        {/* User Bar */}
        <div style={{ padding: '8px 10px', borderTop: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8, background: T.bg }}>
          <div onClick={() => { setModal('settings'); }} style={{ position: 'relative', cursor: 'pointer' }}>
            <Av name={api.username} size={32} color={T.ac2} />
            <div style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderRadius: 6, background: userStatus === 'online' ? '#3ba55d' : userStatus === 'idle' ? '#faa61a' : userStatus === 'dnd' ? '#ed4245' : '#747f8d', border: `2px solid ${T.bg}` }} />
          </div>
          <div onClick={() => { setModal('settings'); }} style={{ flex: 1, overflow: 'hidden', cursor: 'pointer' }}>
            <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{api.username}</span>
              <span title={TIER_META[effectiveTier].label} style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: `${TIER_META[effectiveTier].color}22`, color: TIER_META[effectiveTier].color, border: `1px solid ${TIER_META[effectiveTier].color}44` }}>{TIER_META[effectiveTier].icon} {effectiveTier === 'verified' ? '✓' : effectiveTier === 'pro' ? 'Pro' : effectiveTier === 'teams' ? 'Teams' : effectiveTier === 'enterprise' ? 'Ent' : TIER_META[effectiveTier].label}</span>
              {isDev && <span title="Developer account" style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(255,59,48,0.15)', color: '#ff3b30', border: '1px solid rgba(255,59,48,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>DEV</span>}
            </div>
            <div onClick={e => { e.stopPropagation(); setModal('status-picker'); }} style={{ fontSize: 10, color: userStatus === 'online' ? T.ac : userStatus === 'idle' ? '#faa61a' : T.mt, cursor: 'pointer' }}>{userStatus === 'online' ? '● Online' : userStatus === 'idle' ? '🌙 Idle' : userStatus === 'dnd' ? '⛔ DND' : '👻 Invisible'} ▾</div>
          </div>
          {/* Latency indicator */}
          <div onClick={() => setShowConnInfo(p => !p)} title={`Latency: ${wsLatency}ms`} style={{ position: 'relative', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, background: T.sf2, border: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: wsLatency > 300 ? '#ff4757' : wsLatency > 100 ? '#faa61a' : '#43b581', flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: wsLatency > 300 ? '#ff4757' : wsLatency > 100 ? '#faa61a' : '#43b581' }} />
            {wsLatency > 0 ? `${wsLatency}ms` : '--'}
            {showConnInfo && (
              <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, width: 260, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 12, zIndex: 200, fontSize: 11, color: T.tx }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12 }}>Connection Info</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: T.mt }}>Latency</span>
                    <span style={{ fontWeight: 600, color: wsLatency > 300 ? '#ff4757' : wsLatency > 100 ? '#faa61a' : '#43b581' }}>{wsLatency > 0 ? `${wsLatency}ms` : 'Measuring...'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: T.mt }}>Connection</span>
                    <span style={{ fontWeight: 600 }}>WebSocket</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: T.mt }}>Server</span>
                    <span style={{ fontWeight: 600 }}>{(() => { try { return new URL(location.origin).hostname; } catch { return 'local'; } })()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: T.mt }}>Session Uptime</span>
                    <span style={{ fontWeight: 600 }}>{(() => { const s = Math.floor((Date.now() - sessionStartRef.current) / 1000); const m = Math.floor(s / 60); const h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`; })()}</span>
                  </div>
                  {localStorage.getItem('d_proxy_type') && localStorage.getItem('d_proxy_type') !== 'none' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: T.mt }}>Proxy</span>
                      <span style={{ fontWeight: 600, color: T.ac }}>Connected via {(localStorage.getItem('d_proxy_type') || '').toUpperCase()}</span>
                    </div>
                  )}
                </div>
                <div onClick={async () => {
                  setConnDiag(null);
                  const results: any = { api: 'checking', ws: 'checking', dns: 'checking' };
                  setConnDiag({ ...results });
                  // Check API
                  try {
                    const t0 = Date.now();
                    const r = await fetch((location.origin) + '/health', { signal: AbortSignal.timeout(5000) });
                    const dt = Date.now() - t0;
                    results.api = r.ok ? `OK (${dt}ms)` : 'Error';
                  } catch { results.api = 'Failed'; }
                  // Check WebSocket
                  results.ws = api.ws?.readyState === 1 ? 'Connected' : api.ws?.readyState === 0 ? 'Connecting' : 'Disconnected';
                  // DNS estimate (time to fetch /health minus typical API processing)
                  try {
                    const t0 = Date.now();
                    await fetch((location.origin) + '/health', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
                    const dt = Date.now() - t0;
                    results.dns = `~${dt}ms round-trip`;
                  } catch { results.dns = 'Failed'; }
                  setConnDiag({ ...results });
                }} style={{ padding: '6px 0', textAlign: 'center', borderRadius: 6, cursor: 'pointer', background: T.sf2, border: `1px solid ${T.bd}`, fontWeight: 600, fontSize: 11, color: T.ac, marginBottom: connDiag ? 8 : 0 }}>
                  Troubleshoot
                </div>
                {connDiag && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {Object.entries(connDiag).map(([key, val]) => {
                      const ok = typeof val === 'string' && (val.startsWith('OK') || val === 'Connected');
                      const fail = typeof val === 'string' && (val === 'Failed' || val === 'Disconnected');
                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 4, background: ok ? '#43b581' : fail ? '#ff4757' : '#faa61a', flexShrink: 0 }} />
                          <span style={{ color: T.mt, textTransform: 'capitalize' }}>{key === 'api' ? 'API Health' : key === 'ws' ? 'WebSocket' : 'DNS Resolve'}</span>
                          <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 10, color: ok ? '#43b581' : fail ? '#ff4757' : '#faa61a' }}>{val}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <div onClick={() => setModal('settings')} style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Settings"><I.Settings /></div>
        </div>
      </div>

      {/* ═══ Main Content ═══ */}
      <div className="chat-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div className="chat-header" style={{ padding: '10px 16px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 10, minHeight: 48 }}>
          {/* Hamburger — mobile only */}
          <button
            className={`hamburger${mobileMenuOpen ? ' hamburger--open' : ''}`}
            onClick={() => setMobileMenuOpen(p => !p)}
            aria-label="Toggle navigation"
            style={{ color: T.mt }}
          >
            <span /><span /><span />
          </button>
          {view === 'server' && curChannel && (<><I.Hash s={18} /><span style={{ fontWeight: 700, fontSize: 15 }}>{curChannel.name}</span></>)}
          {view === 'dm' && curDm && (<><I.Msg /><span style={{ fontWeight: 700, fontSize: 15 }}>{curDm.other_username}</span></>)}
          {view === 'dm' && curGroupDm && (<><span style={{ fontSize: 16 }}>👥</span><span style={{ fontWeight: 700, fontSize: 15 }}>{curGroupDm.name || 'Group DM'}</span></>)}
          {view === 'home' && (<><I.Home /><span style={{ fontWeight: 700, fontSize: 15 }}>{homeTab === 'friends' ? 'Friends' : 'Home'}</span></>)}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {React.createElement(function EncryptionBadge() {
              const [showInfo, setShowInfo] = useState(false);
              const mlsActive = isMlsAvailable();
              return (
                <div style={{ position: 'relative' }}>
                  <span onClick={() => setShowInfo(p => !p)} style={{ fontSize: 10, color: mlsActive ? T.ac : '#faa61a', background: mlsActive ? `${T.ac}15` : 'rgba(250,166,26,0.1)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', userSelect: 'none', transition: 'all .2s' }}>
                    {mlsActive ? '🔒 MLS' : '🔒 AES-256'}
                  </span>
                  {showInfo && (
                    <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 28, right: 0, width: 320, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 10, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 100 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 20 }}>{mlsActive ? '🔒' : '🔐'}</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: mlsActive ? T.ac : '#faa61a' }}>{mlsActive ? 'MLS RFC 9420' : 'AES-256-GCM'}</div>
                          <div style={{ fontSize: 11, color: T.mt }}>{mlsActive ? 'Group key agreement active' : 'End-to-end encrypted (fallback mode)'}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.6, marginBottom: 10 }}>
                        {mlsActive
                          ? 'Messages use the Messaging Layer Security protocol (RFC 9420). Each member has their own cryptographic identity, and group keys are ratcheted forward with every message. This is the gold standard for group E2E encryption.'
                          : 'Messages are encrypted with AES-256-GCM derived from a channel-specific key. The server cannot read your messages. This mode activates when the MLS group hasn\'t been established yet for this channel.'}
                      </div>
                      {!mlsActive && (
                        <div style={{ padding: '8px 10px', background: 'rgba(250,166,26,0.08)', border: '1px solid rgba(250,166,26,0.15)', borderRadius: 6, fontSize: 11, color: '#faa61a', lineHeight: 1.5 }}>
                          <strong>How to upgrade:</strong> MLS activates automatically when members exchange key packages. This happens when the WASM crypto module loads and group key exchange completes. No action needed — it upgrades silently.
                        </div>
                      )}
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 6, height: 6, borderRadius: 3, background: '#3ba55d' }} />
                        <span style={{ fontSize: 10, color: T.mt }}>Server is zero-knowledge — cannot decrypt messages in either mode</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Bell icon with server-backed notification inbox */}
            <NotificationInbox wsLastEvent={wsLastEvent} onNavigate={async (action) => {
              // Settings navigation
              if (action.url?.startsWith('/settings')) { setModal('settings'); return; }
              // Smart event join: if event has voice channel, navigate to server and auto-join voice
              if (action.type === 'event_reminder' && action.server_id) {
                // If user isn't a member and invite code is present, join server first
                if (action.invite_code) {
                  try { await api.joinServer(action.server_id, action.invite_code); await loadServers(); } catch {}
                }
                // Navigate to the server (selectServer loads channels)
                const srv = servers.find((s: any) => s.id === action.server_id);
                if (srv) {
                  await selectServer(srv);
                  // After selectServer, channels are loaded — now auto-join voice if linked
                  if (action.voice_channel_id) {
                    // Small delay to ensure channels state is flushed
                    setTimeout(() => {
                      const vch = channelsRef.current.find((c: any) => c.id === action.voice_channel_id);
                      if (vch) joinVoice(vch);
                    }, 200);
                  }
                }
                return;
              }
              // Generic action_url navigation
              if (action.url) {
                window.location.href = action.url;
              }
            }} />
            {view === 'server' && (<>
              <div className="touch-target" onClick={() => setShowWatchParty(p => !p)} style={{ cursor: 'pointer', color: showWatchParty ? T.ac : T.mt, padding: 4, fontSize: 16, lineHeight: 1 }} title="Watch Party">🎬</div>
              <div className="touch-target" onClick={async () => { setShowPinned(p => !p); if (!showPinned && curServer && curChannel) { try { const pins = await api.getPinnedMessages(curServer.id, curChannel.id); setPinnedMsgs(Array.isArray(pins) ? pins : []); } catch { setPinnedMsgs([]); } } }} style={{ cursor: 'pointer', color: showPinned ? T.ac : T.mt, padding: 4, fontSize: 16, lineHeight: 1 }} title="Pinned Messages">📌</div>
              <div className="touch-target" onClick={() => setPanel(panel === 'search' ? null : 'search')} style={{ cursor: 'pointer', color: panel === 'search' ? T.ac : T.mt, padding: 4 }} title="Search"><I.Search /></div>
              <div className="touch-target" onClick={() => setPanel(panel === 'members' ? null : 'members')} style={{ cursor: 'pointer', color: panel === 'members' ? T.ac : T.mt, padding: 4, display: 'flex', alignItems: 'center', gap: 4 }} title="Members"><I.Users /> <span style={{ fontSize: 11 }}>{members.length}</span></div>
            </>)}
          </div>
        </div>

        {/* ─── Home View ─── */}
        {view === 'home' && homeTab === 'home' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Welcome back{api.username ? `, ${api.username}` : ''}!</div>
                <div style={{ fontSize: 14, color: T.mt }}>Zero-knowledge encrypted messaging.</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: T.ac }}>{curTime}</div>
                <div style={{ fontSize: 12, color: T.mt }}>{curDate}</div>
              </div>
            </div>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 20, maxWidth: 440 }}>
              {[{ l: 'Servers', v: servers.length, i: '🏰', c: T.ac }, { l: 'DMs', v: dms.length, i: '💬', c: '#faa61a' }, { l: 'Encryption', v: isMlsAvailable() ? 'MLS' : 'AES', i: '🔐', c: '#43b581' }].map((s, i) => (
                <div key={i} style={{ background: T.sf, borderRadius: 10, border: `1px solid ${T.bd}`, padding: '14px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20 }}>{s.i}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.c, marginTop: 4 }}>{s.v}</div>
                  <div style={{ fontSize: 10, color: T.mt, fontWeight: 600, textTransform: 'uppercase' }}>{s.l}</div>
                </div>
              ))}
            </div>
            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
              <div onClick={() => me?.is_guest ? setUpgradeFeature('create servers') : setModal('create-server')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}`, fontSize: 13, fontWeight: 600 }}><span style={{ color: T.ac }}>+</span> Create Server</div>
              <div onClick={() => setModal('join-server')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}`, fontSize: 13, fontWeight: 600 }}><I.Link /> Join Server</div>
              <div onClick={() => setHomeTab('friends')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}`, fontSize: 13, fontWeight: 600 }}><I.Users /> Friends</div>
              <div onClick={() => setShowMeeting(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}`, fontSize: 13, fontWeight: 600 }}>📹 Start Meeting</div>
              <div onClick={() => setShowCalendar(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}`, fontSize: 13, fontWeight: 600 }}>📅 Calendar</div>
              <div onClick={() => window.open('/app/tiers', '_blank')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}`, fontSize: 13, fontWeight: 600 }}>⚡ View Plans</div>
            </div>
            {/* Servers Grid */}
            {servers.length > 0 && (<>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Your Servers — {servers.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 24 }}>
                {servers.map(s => (
                  <div key={s.id} onClick={() => selectServer(s)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: s.icon_url ? 'transparent' : `linear-gradient(135deg,${T.ac}33,${T.ac2}33)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: T.ac, overflow: 'hidden' }}>
                      {s.icon_url ? <img src={s.icon_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 10 }} /> : s.name[0]?.toUpperCase()}
                    </div>
                    <div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div><div style={{ fontSize: 11, color: T.mt }}>{s.member_count || '?'} members</div></div>
                  </div>
                ))}
              </div>
            </>)}
            {/* Recent DMs */}
            {dms.length > 0 && (<>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Recent Conversations</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {dms.slice(0, 5).map(dm => (
                  <div key={dm.id} onClick={() => selectDm(dm)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.sf, borderRadius: 12, cursor: 'pointer', border: `1px solid ${T.bd}` }}>
                    <Av name={dm.other_username} size={32} />
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{dm.other_username}</div><div style={{ fontSize: 11, color: T.mt }}>Click to chat</div></div>
                  </div>
                ))}
              </div>
            </>)}

            {/* Calendar + Notes side by side */}
            <div style={{ display: 'flex', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
              {/* Calendar */}
              {React.createElement(function CalendarWidget() {
                const [date, setDate] = useState(new Date());
                const today = new Date();
                const year = date.getFullYear(), month = date.getMonth();
                const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const days: (number|null)[] = [];
                for (let i = 0; i < firstDay; i++) days.push(null);
                for (let i = 1; i <= daysInMonth; i++) days.push(i);
                const isToday = (d: number | null) => d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
                return (
                  <div style={{ flex: 1, minWidth: 260, background: T.sf, borderRadius: 12, border: `1px solid ${T.bd}`, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer' }} onClick={() => setShowCalendar(true)}>📅 Calendar</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div onClick={() => setDate(new Date(year, month - 1, 1))} style={{ cursor: 'pointer', color: T.mt, padding: '2px 6px', fontSize: 12 }}>◀</div>
                        <div style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer' }} onClick={() => setShowCalendar(true)}>{monthNames[month]} {year}</div>
                        <div onClick={() => setDate(new Date(year, month + 1, 1))} style={{ cursor: 'pointer', color: T.mt, padding: '2px 6px', fontSize: 12 }}>▶</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, textAlign: 'center', fontSize: 10 }}>
                      {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} style={{ color: T.mt, fontWeight: 700, padding: 4 }}>{d}</div>)}
                      {days.map((d, i) => <div key={i} onClick={() => d && setShowCalendar(true)} style={{ padding: 4, borderRadius: 4, background: isToday(d) ? T.ac : 'transparent', color: isToday(d) ? '#000' : d ? T.tx : 'transparent', fontWeight: isToday(d) ? 700 : 400, cursor: d ? 'pointer' : 'default', fontSize: 11 }}>{d || ''}</div>)}
                    </div>
                    <div onClick={() => setShowCalendar(true)} style={{ marginTop: 10, textAlign: 'center', fontSize: 11, color: T.ac, cursor: 'pointer', fontWeight: 600, padding: '4px 0', borderTop: `1px solid ${T.bd}` }}>+ New Event</div>
                  </div>
                );
              })}

              {/* Quick Notes */}
              {React.createElement(function NotesWidget() {
                const [notes, setNotes] = useState<{ id: string; text: string; done: boolean }[]>(() => {
                  try { const p = JSON.parse(localStorage.getItem('d_todos_v') || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
                });
                const [newNote, setNewNote] = useState('');
                const save = (n: typeof notes) => { setNotes(n); localStorage.setItem('d_todos_v', JSON.stringify(n)); };
                const add = () => { if (!newNote.trim()) return; save([{ id: Date.now().toString(), text: newNote.trim(), done: false }, ...notes]); setNewNote(''); };
                return (
                  <div style={{ flex: 1, minWidth: 260, background: T.sf, borderRadius: 12, border: `1px solid ${T.bd}`, padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>📝 Quick Notes</div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add a note..." style={{ flex: 1, padding: '6px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, outline: 'none' }} />
                      <div onClick={add} style={{ padding: '6px 10px', background: T.ac, color: '#000', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+</div>
                    </div>
                    <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                      {notes.length === 0 && <div style={{ fontSize: 11, color: T.mt, textAlign: 'center', padding: 8 }}>No notes yet.</div>}
                      {notes.slice(0, 15).map(n => (
                        <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12 }}>
                          <div onClick={() => save(notes.map(x => x.id === n.id ? { ...x, done: !x.done } : x))} style={{ cursor: 'pointer', color: n.done ? T.ac : T.mt }}>{n.done ? '☑' : '☐'}</div>
                          <span style={{ flex: 1, textDecoration: n.done ? 'line-through' : 'none', color: n.done ? T.mt : T.tx }}>{n.text}</span>
                          <span onClick={() => save(notes.filter(x => x.id !== n.id))} style={{ cursor: 'pointer', color: T.mt, fontSize: 10 }}>✕</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── AI Agents on Home ─── */}
        {view === 'home' && homeTab === 'home' && (
          <div style={{ padding: '0 24px 24px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>🤖 AI Agents</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {[
                { name: 'Research Assistant', desc: 'Web search, summarization, analysis', icon: '🔬', color: '#5865F2' },
                { name: 'Code Helper', desc: 'Debug, explain, generate code', icon: '💻', color: '#3ba55d' },
                { name: 'Creative Writer', desc: 'Stories, poems, brainstorming', icon: '✍️', color: '#faa61a' },
                { name: 'Math Tutor', desc: 'Equations, proofs, step-by-step', icon: '📐', color: '#ed4245' },
                { name: 'Language Coach', desc: 'Translation, grammar, practice', icon: '🌐', color: '#00d2aa' },
                { name: 'Music Theory', desc: 'Chords, scales, composition', icon: '🎵', color: '#9b59b6' },
              ].map(bot => (
                <div key={bot.name} onClick={() => { setToast(`${bot.name} — activate from a server's Bot Marketplace`); setTimeout(() => setToast(''), 3000); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: T.sf, borderRadius: 10, cursor: 'pointer', border: `1px solid ${T.bd}` }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = bot.color}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.bd}>
                  <div style={{ width: 36, height: 36, borderRadius: 12, background: `${bot.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{bot.icon}</div>
                  <div><div style={{ fontSize: 12, fontWeight: 600 }}>{bot.name}</div><div style={{ fontSize: 10, color: T.mt }}>{bot.desc}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Friends View ─── */}
        {view === 'home' && homeTab === 'friends' && (
          <FriendsView setCtxMenu={setCtxMenu as any} showConfirm={showConfirm} isGuest={me?.is_guest} />
        )}

        {/* ─── Events View ─── */}
        {view === 'home' && homeTab === 'events' && curServer && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <EventsPanel serverId={curServer.id} isOwner={hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.ADMIN)} channels={channels} />
          </div>
        )}
        {view === 'home' && homeTab === 'events' && !curServer && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.mt }}>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 40, marginBottom: 8 }}>📅</div><div style={{ fontSize: 16, fontWeight: 600 }}>Select a server to view events</div></div>
          </div>
        )}

        {/* ─── Leaderboard View ─── */}
        {view === 'home' && homeTab === 'leaderboard' && curServer && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <LeaderboardPanel serverId={curServer.id} members={members as any} />
          </div>
        )}
        {view === 'home' && homeTab === 'leaderboard' && !curServer && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.mt }}>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 40, marginBottom: 8 }}>🏆</div><div style={{ fontSize: 16, fontWeight: 600 }}>Select a server to view leaderboard</div></div>
          </div>
        )}

        {/* ─── Tools ─── */}
        {view === 'home' && homeTab === 'tools' && React.createElement(function ToolsView() {
          const [activeTool, setActiveTool] = useState<string | null>(null);
          // Calculator state
          const [display, setDisplay] = useState('0');
          const [prev, setPrev] = useState<number | null>(null);
          const [op, setOp] = useState<string | null>(null);
          const [fresh, setFresh] = useState(true);
          const input = (d: string) => { setDisplay(fresh ? d : display + d); setFresh(false); };
          const operate = (nextOp: string) => {
            const cur = parseFloat(display);
            if (prev !== null && op) {
              const r = op === '+' ? prev + cur : op === '-' ? prev - cur : op === '×' ? prev * cur : op === '÷' && cur !== 0 ? prev / cur : cur;
              setDisplay(String(r)); setPrev(r);
            } else setPrev(cur);
            setOp(nextOp); setFresh(true);
          };
          const equals = () => { if (prev !== null && op) { operate('='); setOp(null); } };
          const clear = () => { setDisplay('0'); setPrev(null); setOp(null); setFresh(true); };
          const btnS = (bg: string, c: string) => ({ padding: '16px 0', borderRadius: 12, cursor: 'pointer', fontSize: 18, fontWeight: 600 as const, background: bg, color: c, border: 'none', textAlign: 'center' as const });
          // Unit converter state
          const [unitVal, setUnitVal] = useState('');
          const [unitType, setUnitType] = useState('temp');
          const convertUnit = () => {
            const v = parseFloat(unitVal); if (isNaN(v)) return '—';
            if (unitType === 'temp') return `${v}°F = ${((v - 32) * 5/9).toFixed(2)}°C`;
            if (unitType === 'weight') return `${v} lbs = ${(v * 0.453592).toFixed(2)} kg`;
            if (unitType === 'length') return `${v} mi = ${(v * 1.60934).toFixed(2)} km`;
            if (unitType === 'data') return `${v} GB = ${(v * 1024).toFixed(0)} MB`;
            return '—';
          };

          if (!activeTool) return (
            <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>🧰 Tools</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                {([
                  { key: 'calc',     icon: '🧮', name: 'Calculator',    desc: 'Basic arithmetic' },
                  { key: 'unit',     icon: '📐', name: 'Unit Converter', desc: 'Temp, weight, length' },
                  { key: 'timer',    icon: '⏱',  name: 'Stopwatch',     desc: 'Track time' },
                  { key: 'docs',     icon: '📄', name: 'Documents',     desc: 'Encrypted rich text', action: () => setShowDocEditor(true) },
                  { key: 'calendar', icon: '📅', name: 'Calendar',      desc: 'Events & meetings',   action: () => setShowCalendar(true) },
                  ...(isAnyOwner ? [{ key: 'health', icon: '🩺', name: 'Server Health', desc: 'Uptime & latency', action: () => setShowHealth(true) }] : []),
                ] as Array<{ key: string; icon: string; name: string; desc: string; action?: () => void }>).map(t => (
                  <div key={t.key} onClick={() => t.action ? t.action() : setActiveTool(t.key)} style={{ padding: 16, background: T.sf, borderRadius: 12, border: `1px solid ${T.bd}`, cursor: 'pointer', textAlign: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.ac}
                    onMouseLeave={e => e.currentTarget.style.borderColor = T.bd}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>{t.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: T.mt }}>{t.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          );

          return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <div onClick={() => setActiveTool(null)} style={{ cursor: 'pointer', color: T.mt, fontSize: 12, marginBottom: 16, alignSelf: 'flex-start' }}>← Back to Tools</div>

              {activeTool === 'calc' && (
                <div style={{ width: 300, background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}`, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
                  <div style={{ padding: '24px 20px 16px', textAlign: 'right', fontSize: 36, fontWeight: 300, fontFamily: "'JetBrains Mono',monospace", color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis' }}>{display}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, padding: '0 2px 2px' }}>
                    <div onClick={clear} style={btnS(T.sf2, T.err)}>C</div>
                    <div onClick={() => setDisplay(String(parseFloat(display) * -1))} style={btnS(T.sf2, T.mt)}>±</div>
                    <div onClick={() => setDisplay(String(parseFloat(display) / 100))} style={btnS(T.sf2, T.mt)}>%</div>
                    <div onClick={() => operate('÷')} style={btnS(op === '÷' ? T.ac : `${T.ac}33`, op === '÷' ? '#000' : T.ac)}>÷</div>
                    {['7','8','9'].map(d => <div key={d} onClick={() => input(d)} style={btnS(T.bg, T.tx)}>{d}</div>)}
                    <div onClick={() => operate('×')} style={btnS(op === '×' ? T.ac : `${T.ac}33`, op === '×' ? '#000' : T.ac)}>×</div>
                    {['4','5','6'].map(d => <div key={d} onClick={() => input(d)} style={btnS(T.bg, T.tx)}>{d}</div>)}
                    <div onClick={() => operate('-')} style={btnS(op === '-' ? T.ac : `${T.ac}33`, op === '-' ? '#000' : T.ac)}>−</div>
                    {['1','2','3'].map(d => <div key={d} onClick={() => input(d)} style={btnS(T.bg, T.tx)}>{d}</div>)}
                    <div onClick={() => operate('+')} style={btnS(op === '+' ? T.ac : `${T.ac}33`, op === '+' ? '#000' : T.ac)}>+</div>
                    <div onClick={() => input('0')} style={{ ...btnS(T.bg, T.tx), gridColumn: 'span 2' }}>0</div>
                    <div onClick={() => { if (!display.includes('.')) { setDisplay(display + '.'); setFresh(false); } }} style={btnS(T.bg, T.tx)}>.</div>
                    <div onClick={equals} style={btnS(T.ac, '#000')}>=</div>
                  </div>
                </div>
              )}

              {activeTool === 'unit' && (
                <div style={{ width: 320, background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}`, padding: 20 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>📐 Unit Converter</div>
                  <select value={unitType} onChange={e => setUnitType(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 12, color: T.tx, fontSize: 13, marginBottom: 10 }}>
                    <option value="temp">Temperature (°F → °C)</option>
                    <option value="weight">Weight (lbs → kg)</option>
                    <option value="length">Distance (mi → km)</option>
                    <option value="data">Data (GB → MB)</option>
                  </select>
                  <input value={unitVal} onChange={e => setUnitVal(e.target.value)} placeholder="Enter value" style={{ ...getInp(), marginBottom: 10 }} />
                  <div style={{ padding: '12px 16px', background: T.bg, borderRadius: 12, fontSize: 16, fontWeight: 600, textAlign: 'center', fontFamily: "'JetBrains Mono',monospace" }}>{unitVal ? convertUnit() : 'Enter a value above'}</div>
                </div>
              )}

              {activeTool === 'timer' && React.createElement(function StopwatchTool() {
                const [running, setRunning] = useState(false);
                const [elapsed, setElapsed] = useState(0);
                const startRef = useRef(0);
                useEffect(() => {
                  if (!running) return;
                  startRef.current = Date.now() - elapsed;
                  const t = setInterval(() => setElapsed(Date.now() - startRef.current), 10);
                  return () => clearInterval(t);
                }, [running]);
                const fmt = (ms: number) => { const m = Math.floor(ms/60000); const s = Math.floor((ms%60000)/1000); const c = Math.floor((ms%1000)/10); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`; };
                return (
                  <div style={{ width: 300, background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}`, padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 48, fontWeight: 300, fontFamily: "'JetBrains Mono',monospace", marginBottom: 20 }}>{fmt(elapsed)}</div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                      <button onClick={() => setRunning(!running)} style={{ ...btn(true), padding: '8px 24px' }}>{running ? 'Stop' : 'Start'}</button>
                      <button onClick={() => { setRunning(false); setElapsed(0); }} style={{ padding: '8px 24px', background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, borderRadius: 12, cursor: 'pointer' }}>Reset</button>
                    </div>
                  </div>
                );
              })}

            </div>
          );
        })}

        {/* ─── Discover View ─── */}
        {view === 'home' && homeTab === 'discover' && (
          <DiscoverPanel
            onJoin={async (serverId) => {
              await loadServers();
              const s = servers.find(sv => sv.id === serverId);
              if (s) selectServer(s);
            }}
          />
        )}

        {/* ─── Admin Dashboard ─── */}
        {view === 'home' && homeTab === 'admin' && (isAnyOwner || isPlatformDevOrAdmin) && (
          <AdminDashboard platformUser={platformUser} />
        )}

        {/* ─── Group DM View ─── */}
        {view === 'dm' && curGroupDm && (<>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 18 }}>👥</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{curGroupDm.name || 'Group DM'}</span>
            {curGroupDm.member_ids?.length > 0 && <span style={{ fontSize: 11, color: T.mt }}>{curGroupDm.member_ids.length} members</span>}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {dmMsgs.map((m: any) => (
              <div key={m.id} style={{ display: 'flex', gap: 10, padding: '4px 16px' }}>
                <div onClick={e => setProfileCard({ userId: m.author_id, pos: { x: e.clientX, y: e.clientY } })} style={{ cursor: 'pointer' }}>
                  <Av name={m.author_id === api.userId ? (api.username || '?') : getName(m.author_id)} size={36} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span onClick={e => setProfileCard({ userId: m.author_id, pos: { x: e.clientX, y: e.clientY } })} style={{ fontWeight: 600, fontSize: 14, color: m.author_id === api.userId ? T.ac : T.tx, cursor: 'pointer' }}>{m.author_id === api.userId ? (api.username || '?') : getName(m.author_id)}</span>
                    {renderPlatformBadge(m.author_id)}
                    <span style={{ fontSize: 10, color: T.mt }}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}><Markdown text={m.text || m.content || m.content_ciphertext} /></div>
                </div>
              </div>
            ))}
            <div ref={msgEndRef} />
          </div>
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.bd}` }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input ref={inputRef} value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } }} placeholder={`Message ${curGroupDm.name || 'group'}`} style={{ flex: 1, padding: '10px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 12, color: T.tx, fontSize: 14, outline: 'none', fontFamily: "'DM Sans',sans-serif" }} />
              <div onClick={sendMessage} style={{ padding: '8px 14px', background: `linear-gradient(135deg,${T.ac},${T.ac2})`, borderRadius: 12, cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 13 }}>Send</div>
            </div>
          </div>
        </>)}

        {/* ─── DM View ─── */}
        {view === 'dm' && curDm && (<>
          {/* DM Header */}
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span onClick={() => setProfileCard({ userId: curDm.other_user_id, pos: { x: 160, y: 60 } })} style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer' }} title="View profile">
              {curDm.other_username}
            </span>
            {curDm.other_is_bot && (() => {
              const showAiTag = localStorage.getItem('d_dm_bot_tag_' + curDm.id) !== 'false';
              return (<>
                {showAiTag && <span style={{ background: '#5865F2', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 700, letterSpacing: '0.5px' }}>AI</span>}
                <span onClick={() => { localStorage.setItem('d_dm_bot_tag_' + curDm.id, String(!showAiTag)); forceUpdate(n => n + 1); }} title={showAiTag ? 'Hide AI indicator' : 'Show AI indicator'} style={{ color: showAiTag ? T.mt : T.bd, cursor: 'pointer', fontSize: 13, userSelect: 'none', lineHeight: 1 }}>👁</span>
              </>);
            })()}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {dmMsgs.map((m: any) => (
              <div key={m.id} style={{ display: 'flex', gap: 10, padding: '4px 16px' }}>
                <div onClick={e => setProfileCard({ userId: m.author_id, pos: { x: e.clientX, y: e.clientY } })} style={{ cursor: 'pointer' }}>
                  <Av name={m.author_id === api.userId ? api.username : curDm.other_username} size={36} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span onClick={e => setProfileCard({ userId: m.author_id, pos: { x: e.clientX, y: e.clientY } })} style={{ fontWeight: 600, fontSize: 14, color: m.author_id === api.userId ? T.ac : T.tx, cursor: 'pointer' }}>{m.author_id === api.userId ? api.username : curDm.other_username}</span>
                    <span style={{ fontSize: 10, color: T.mt }}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}><Markdown text={m.text || m.content || m.content_ciphertext} /></div>
                </div>
              </div>
            ))}
            <div ref={msgEndRef} />
          </div>
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.bd}` }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input ref={inputRef} value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } }} placeholder={`Message ${curDm.other_username}`} style={{ flex: 1, padding: '10px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 12, color: T.tx, fontSize: 14, outline: 'none', fontFamily: "'DM Sans',sans-serif" }} />
              <div onClick={sendMessage} style={{ padding: '8px 14px', background: `linear-gradient(135deg,${T.ac},${T.ac2})`, borderRadius: 12, cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 13 }}>Send</div>
            </div>
          </div>
        </>)}

        {/* ─── Server Channel View ─── */}
        {view === 'server' && curChannel && (<div key={channelFadeKey} style={{ display: 'contents', animation: 'fadeIn 0.2s ease' }}>
          {/* Video Grid (when in voice with video/screen active) */}
          {voiceChannel && (vc.videoEnabled || vc.screenSharing || vc.streams.size > 0) && (
            <VideoGrid
              streams={Object.fromEntries([
                ...(vc.videoEnabled && vc.engine.videoStream ? [['local', vc.engine.videoStream]] : []),
                ...(vc.screenSharing && vc.engine.screenStream ? [['screen', vc.engine.screenStream]] : []),
                ...Array.from(vc.streams.entries()),
              ])}
              localName={api.username || '?'}
              peers={Array.from(vc.streams.keys()).map(id => ({ id, name: getName(id), speaking: false }))}
            />
          )}
          {(() => {
            const MSG_H = 52;
            const BUFFER = 20;
            const containerH = msgScrollRef.current?.clientHeight || 600;
            const startIdx = Math.max(0, Math.floor(msgScrollTop / MSG_H) - BUFFER);
            const endIdx = Math.min(messages.length, Math.ceil((msgScrollTop + containerH) / MSG_H) + BUFFER);
            const visibleMessages = messages.slice(startIdx, endIdx);
            return (
            <div ref={msgScrollRef} onScroll={async (e) => {
              const el = e.currentTarget;
              setMsgScrollTop(el.scrollTop);
              if (el.scrollTop < 50 && messages.length >= 50 && curChannel && !loadingMore) {
                setLoadingMore(true);
                try {
                  const older = await api.getMessagesBatch(curChannel.id, 50, messages[0]?.id);
                  if (Array.isArray(older) && older.length > 0) {
                    const prevH = el.scrollHeight;
                    const decOlder = await Promise.all(older.map(async (m: any) => ({ ...m, text: await dec(curChannel.id, m.content_ciphertext), authorName: userMap[m.author_id] || 'Unknown' })));
                    setMessages(prev => [...decOlder.reverse(), ...prev]);
                    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevH; });
                  }
                } catch {} setLoadingMore(false);
              }
            }} style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {loadingMore && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ display: 'inline-block', width: 20, height: 20, border: `2px solid ${T.bd}`, borderTop: `2px solid ${T.ac}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ fontSize: 11, color: T.mt, marginTop: 4 }}>Loading older messages...</div>
              </div>
            )}
            {curChannel && agentDisclosures[curChannel.id] && (
              <div style={{ background: '#1a1a2e', borderLeft: '3px solid #f0b232', borderRadius: 12, padding: 12, margin: '8px 16px 8px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>🛡️</span>
                <span style={{ flex: 1, fontSize: 13, color: '#e0e0e0', lineHeight: 1.5 }}>
                  {agentDisclosures[curChannel.id].disclosure_text}
                </span>
                <span
                  onClick={() => setAgentDisclosures(p => { const n = { ...p }; delete n[curChannel.id]; return n; })}
                  title="Dismiss"
                  style={{ cursor: 'pointer', color: '#888', fontSize: 15, flexShrink: 0, lineHeight: 1, paddingTop: 1 }}
                >✕</span>
              </div>
            )}
            {loadingMessages && messages.length === 0 && <MessageSkeleton count={10} />}
            {!loadingMessages && messages.length === 0 && (
              <div key={channelFadeKey} style={{ textAlign: 'center', padding: 40, color: T.mt, animation: 'fadeIn 0.25s ease' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>#</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Welcome to #{curChannel?.name}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Messages are end-to-end encrypted.</div>
              </div>
            )}
            {messages.length > 0 && <div style={{ height: startIdx * MSG_H }} />}
            {visibleMessages.map((m, vi) => {
              const idx = startIdx + vi;
              // Date separator
              const prevMsg = idx > 0 ? messages[idx - 1] : null;
              const curDate = new Date(m.created_at).toLocaleDateString();
              const showDateSep = !prevMsg || new Date(prevMsg.created_at).toLocaleDateString() !== curDate;

              // Profanity filter (per-server, level from localStorage)
              const profanityLevel = curServer ? getProfanityLevel(curServer.id) : 'off';
              const msgText = filterMessage(m.text || m.content_ciphertext, profanityLevel);

              // Mention handlers for Markdown component
              const onMention = (username: string, e: React.MouseEvent) => {
                const mentioned = members.find(u => u.username === username || u.display_name === username);
                if (mentioned) setProfileCard({ userId: mentioned.user_id, pos: { x: e.clientX, y: e.clientY } });
              };
              const mentionStyle = (username: string): React.CSSProperties => {
                const mentioned = members.find(u => u.username === username || u.display_name === username);
                const isSelf = mentioned?.user_id === api.userId;
                return { background: isSelf ? 'rgba(0,212,170,0.2)' : 'rgba(88,101,242,0.2)', color: isSelf ? T.ac : '#5865F2', padding: '0 3px', borderRadius: 3, cursor: 'pointer', fontWeight: 600 };
              };

              // Auto-reply system message — gray italic, no avatar
              if (m.is_auto_reply) {
                return (
                  <div key={m.id} style={{ padding: '2px 16px 2px 62px', fontSize: 13, color: T.mt, fontStyle: 'italic' }}>
                    {m.authorName || getName(m.author_id)} is away: {m.text}
                  </div>
                );
              }

              return (
                <React.Fragment key={m.id}>
                {showDateSep && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', margin: '4px 0' }}>
                    <div style={{ flex: 1, height: 1, background: T.bd }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.mt }}>{curDate}</span>
                    <div style={{ flex: 1, height: 1, background: T.bd }} />
                  </div>
                )}
                <div data-msg-id={m.id} onContextMenu={e => openMsgCtx(e, m)} style={{ display: 'flex', gap: 10, padding: '4px 16px', position: 'relative', background: highlightedMsg === m.id ? 'rgba(0,212,170,0.12)' : (m.mentioned_user_ids?.includes(api.userId) ? 'rgba(0,212,170,0.06)' : 'transparent'), transition: 'background .15s ease', borderLeft: m.author_id === api.userId ? `2px solid ${T.ac}44` : '2px solid transparent' }}
                  onMouseEnter={e => { if (highlightedMsg !== m.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { if (highlightedMsg !== m.id) e.currentTarget.style.background = 'transparent'; }}>
                <div onClick={e => setProfileCard({ userId: m.author_id, pos: { x: e.clientX, y: e.clientY } })} style={{ cursor: 'pointer' }}>
                  <Av name={getName(m.author_id)} size={36} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Reply reference */}
                  {m.reply_to_id && <div style={{ fontSize: 11, color: T.mt, marginBottom: 2, paddingLeft: 12, borderLeft: `2px solid ${T.bd}` }}>↩ replying to a message</div>}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span onClick={e => setProfileCard({ userId: m.author_id, pos: { x: e.clientX, y: e.clientY } })} title={rawUsernameMap[m.author_id] || ''} style={{ fontWeight: 600, fontSize: 14, color: m.author_id === api.userId ? T.ac : T.tx, cursor: 'pointer' }}>{getName(m.author_id)}</span>
                    {renderPlatformBadge(m.author_id)}
                    <span style={{ fontSize: 10, color: T.mt }}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="msg-text" style={{ fontSize: 14, lineHeight: 1.5, wordBreak: 'break-word' }}><Markdown text={msgText} onMention={onMention} mentionStyle={mentionStyle} /></div>
                  {/* Invite previews */}
                  {(msgText.match(/https?:\/\/[^\s<>]*\/invite\/[A-Za-z0-9]+\/?/g) || []).map((invUrl: string, i: number) => (
                    <InvitePreview key={`inv-${m.id}-${i}`} url={invUrl} joinedServerIds={servers.map(s => s.id)} onJoined={loadServers} />
                  ))}
                  {/* Attachments */}
                  {(m as any).attachments?.map((a: any) => (
                    <div key={a.id || a.url} style={{ marginTop: 4 }}>
                      {a.content_type?.startsWith('image/') ? (
                        <img src={a.url} alt={a.filename} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8 }} />
                      ) : (
                        <a href={a.url} target="_blank" rel="noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: T.sf2, borderRadius: 6, border: `1px solid ${T.bd}`, color: T.ac, fontSize: 12, textDecoration: 'none' }}>
                          <I.Download /> {a.filename || 'Download'} {a.size ? `(${(a.size / 1024).toFixed(0)}KB)` : ''}
                        </a>
                      )}
                    </div>
                  ))}
                  {/* Poll */}
                  {(m as any).poll && (() => {
                    const poll = (m as any).poll;
                    const opts: string[] = poll.options || [];
                    const serverCounts: number[] = poll.votes || poll.vote_counts || opts.map(() => 0);
                    const myVote: number | null = poll.id in pollVotes ? pollVotes[poll.id] : (poll.my_vote ?? poll.user_vote ?? null);
                    // Optimistically adjust counts when local vote differs from server
                    const counts = serverCounts.map((c, i) => {
                      const serverVote = poll.my_vote ?? poll.user_vote ?? null;
                      let adj = c;
                      if (poll.id in pollVotes) {
                        if (serverVote === i && myVote !== i) adj -= 1;       // removed vote from this option
                        if (serverVote !== i && myVote === i) adj += 1;       // added vote to this option
                      }
                      return Math.max(0, adj);
                    });
                    const total = counts.reduce((a, b) => a + b, 0);
                    return (
                      <div style={{ marginTop: 8, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, padding: 12, maxWidth: 380 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 10 }}>📊 {poll.question}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {opts.map((opt: string, i: number) => {
                            const count = counts[i] || 0;
                            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                            const isVoted = myVote === i;
                            return (
                              <div key={i} onClick={async () => {
                                const prev = myVote;
                                const next = isVoted ? null : i;
                                setPollVotes(p => ({ ...p, [poll.id]: next }));
                                try { await api.votePoll(poll.id, i); } catch { setPollVotes(p => ({ ...p, [poll.id]: prev })); }
                              }} style={{ cursor: 'pointer', borderRadius: 6, border: `1px solid ${isVoted ? T.ac : T.bd}`, padding: '7px 10px', position: 'relative', overflow: 'hidden', transition: 'border-color .15s' }}
                                onMouseEnter={e => { if (!isVoted) e.currentTarget.style.borderColor = `${T.ac}88`; }}
                                onMouseLeave={e => { if (!isVoted) e.currentTarget.style.borderColor = T.bd; }}>
                                {/* Progress bar fill */}
                                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`, background: isVoted ? `${T.ac}22` : `${T.mt}18`, borderRadius: 6, transition: 'width .4s ease' }} />
                                <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 13, color: isVoted ? T.ac : T.tx, fontWeight: isVoted ? 600 : 400 }}>
                                    {isVoted && <span style={{ marginRight: 4 }}>✓</span>}{opt}
                                  </span>
                                  <span style={{ fontSize: 11, color: T.mt, whiteSpace: 'nowrap' }}>{count} · {pct}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: 10, color: T.mt, marginTop: 8 }}>
                          {total} vote{total !== 1 ? 's' : ''}
                          {poll.expires_at ? ` · ends ${new Date(poll.expires_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}
                        </div>
                      </div>
                    );
                  })()}
                  {/* URL Previews */}
                  {m.text && <LinkPreview text={msgText} />}
                  {/* Reactions */}
                  {reactions[m.id]?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {Object.entries(reactions[m.id].reduce((acc: any, r: any) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {})).map(([emoji, count]) => {
                        const mine = (reactions[m.id] || []).some(r => r.emoji === emoji && r.user_id === api.userId);
                        return (
                          <span key={emoji} onClick={() => toggleReaction(m.id, emoji)} title={mine ? 'Remove reaction' : 'Add reaction'} style={{ padding: '1px 6px', background: mine ? `${T.ac}22` : T.sf2, borderRadius: 4, fontSize: 12, cursor: 'pointer', border: `1px solid ${mine ? T.ac : T.bd}`, color: mine ? T.ac : T.tx, fontWeight: mine ? 600 : 400, transition: 'background .1s, border-color .1s' }}>
                            {emoji} {count as number}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* Thread reply count badge */}
                  {(m.reply_count ?? 0) > 0 && (
                    <div onClick={async () => { setThreadParent(m); setPanel('thread'); try { const r = await api.getThreadReplies(m.id); const dec = await Promise.all((r as any[]).map(async (rm: any) => { try { rm.text = await (window as any).__decryptMsg?.(curChannel!.id, rm.content_ciphertext) ?? rm.content_ciphertext; } catch { rm.text = rm.content_ciphertext; } return rm; })); setThreadReplies(dec); } catch { setThreadReplies([]); } }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 8px', background: `${T.ac}14`, borderRadius: 8, cursor: 'pointer', fontSize: 11, color: T.ac, fontWeight: 600, border: `1px solid ${T.ac}22`, transition: 'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = `${T.ac}22`}
                      onMouseLeave={e => e.currentTarget.style.background = `${T.ac}14`}>
                      <I.Reply /> {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
                    </div>
                  )}
                </div>
                {/* Quick react bar on hover */}
                <div className="msg-actions" style={{ position: 'absolute', top: -4, right: 16, display: 'none', gap: 2, background: T.sf, borderRadius: 4, border: `1px solid ${T.bd}`, padding: 2, zIndex: 10 }}>
                  {getQuickReact().map(em => (
                    <span key={em} onClick={() => addReaction(m.id, em)} style={{ cursor: 'pointer', padding: '2px 4px', fontSize: 14 }} title={em}>{em}</span>
                  ))}
                  <span onClick={() => setEmojiTarget(m.id)} style={{ cursor: 'pointer', padding: '2px 4px', fontSize: 12, color: T.mt }} title="More reactions">＋</span>
                  <span style={{ width: 1, background: T.bd, margin: '0 2px' }} />
                  <span onClick={() => { setReplyTo(m); inputRef.current?.focus(); }} style={{ cursor: 'pointer', padding: '2px 4px', color: T.mt, fontSize: 12 }} title="Reply"><I.Reply /></span>
                  {curServer && curChannel && <span onClick={async () => { try { await api.pinMessage(curServer.id, curChannel.id, m.id); setToast('Message pinned'); setTimeout(() => setToast(''), 2000); } catch (e: any) { setToast(e?.message || 'Failed to pin'); setTimeout(() => setToast(''), 3000); } }} style={{ cursor: 'pointer', padding: '2px 4px', color: T.mt, fontSize: 12 }} title="Pin">📌</span>}
                  <span onClick={e => openMsgCtx(e, m)} style={{ cursor: 'pointer', padding: '2px 4px', color: T.mt, fontSize: 12 }} title="More">⋯</span>
                </div>
              </div>
              </React.Fragment>
              );
            })}
            {messages.length > 0 && <div style={{ height: (messages.length - endIdx) * MSG_H }} />}
            <div ref={msgEndRef} />
          </div>
            );
          })()}

          {/* Typing indicator */}
          {Object.keys(typingUsers).length > 0 && (() => {
            const uids  = Object.keys(typingUsers);
            const names = uids.map(uid => getName(uid));
            const label = uids.length === 1
              ? `${names[0]} is typing`
              : uids.length === 2
                ? `${names[0]} and ${names[1]} are typing`
                : `${names[0]} and ${uids.length - 1} others are typing`;
            return (
              <div style={{ padding: '2px 16px 4px', minHeight: 22, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 12, color: T.mt, fontStyle: 'italic' }}>{label}</span>
                <span aria-hidden="true">
                  <span className="typing-dot" style={{ color: T.ac }}>.</span>
                  <span className="typing-dot" style={{ color: T.ac }}>.</span>
                  <span className="typing-dot" style={{ color: T.ac }}>.</span>
                </span>
              </div>
            );
          })()}

          {/* Reply/Edit bar */}
          {(replyTo || editMsg) && (
            <div style={{ padding: '6px 16px', background: T.sf2, borderTop: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ color: T.ac }}>{editMsg ? '✏️ Editing' : '↩ Replying to'}</span>
              <span style={{ color: T.mt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editMsg?.text || replyTo?.text}</span>
              <span onClick={() => { setReplyTo(null); setEditMsg(null); setMsgInput(''); }} style={{ cursor: 'pointer', color: T.mt }}>✕</span>
            </div>
          )}

          {/* Input area with slash suggestions + @mention autocomplete */}
          <div className="input-bar" style={{ position: 'relative' }}>
            {/* Slash command suggestions */}
            {msgInput.startsWith('/') && (
              <SlashSuggestions input={msgInput} members={members} roles={roles} isGuest={!!me?.is_guest} onSet={setMsgInput} />
            )}
            {/* @mention autocomplete */}
            {(() => {
              const atMatch = msgInput.match(/@(\w*)$/);
              if (!atMatch) return null;
              const query = atMatch[1].toLowerCase();
              const matches = members.filter(m => (m.username?.toLowerCase().includes(query) || m.display_name?.toLowerCase().includes(query) || m.nickname?.toLowerCase().includes(query))).slice(0, 6);
              if (matches.length === 0) return null;
              return (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12, padding: 4, marginBottom: 4, boxShadow: '0 -4px 16px rgba(0,0,0,0.3)', maxHeight: 200, overflowY: 'auto', zIndex: 100 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, padding: '4px 8px', textTransform: 'uppercase' }}>Members</div>
                  {matches.map(m => (
                    <div key={m.user_id} onClick={() => setMsgInput(prev => prev.replace(/@\w*$/, `@${m.nickname || m.display_name || m.username} `))} title={m.username} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,170,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <Av name={m.nickname || m.display_name || m.username} size={24} />
                      <span style={{ fontSize: 13 }}>{m.nickname || m.display_name || m.username}</span>
                      {m.nickname && <span style={{ fontSize: 10, color: T.mt }}>({m.username})</span>}
                      {m.user_id === curServer?.owner_id && <span style={{ fontSize: 9, color: '#faa61a' }}>👑</span>}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Slash tool overlays */}
            {slashTool && (
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', bottom: 0, left: 16, right: 16, zIndex: 50 }}>
                  <div style={{ width: 280, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>
                        {slashTool === 'calc' ? 'Calculator' : slashTool === 'convert' ? 'Unit Converter' : 'Color Picker'}
                      </span>
                      <span onClick={() => setSlashTool(null)} style={{ cursor: 'pointer', color: T.mt, fontSize: 16, lineHeight: 1 }} title="Close (Esc)">✕</span>
                    </div>

                    {slashTool === 'calc' && <CalcTool onInsert={(v: string) => { setMsgInput(p => p + v); setSlashTool(null); inputRef.current?.focus(); }} />}
                    {slashTool === 'convert' && <ConvertTool onInsert={(v: string) => { setMsgInput(p => p + v); setSlashTool(null); inputRef.current?.focus(); }} />}
                    {slashTool === 'color' && <ColorTool onInsert={(v: string) => { setMsgInput(p => p + v); setSlashTool(null); inputRef.current?.focus(); }} />}
                  </div>
                </div>
              </div>
            )}

            {/* Archived banner */}
            {curServer?.is_archived && (
              <div style={{ padding: '10px 16px', background: 'rgba(255,165,0,0.08)', borderTop: '1px solid rgba(255,165,0,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>📦</span>
                <span style={{ fontSize: 12, color: '#ffa500', fontWeight: 600 }}>This server is archived and read-only.</span>
                {curServer.scheduled_deletion_at && (
                  <span style={{ fontSize: 11, color: T.err, marginLeft: 4 }}>
                    Scheduled for deletion on {new Date(curServer.scheduled_deletion_at).toLocaleDateString()}.
                  </span>
                )}
              </div>
            )}

            {/* Input */}
            <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.bd}` }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Attach file">
                <I.Paperclip />
                <input type="file" style={{ display: 'none' }} onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file || !curChannel) return;
                  if (!tierLimits.canUpload) { if (me?.is_guest) { setUpgradeFeature('upload files'); } else { setToast('Verify your email to unlock this feature'); setTimeout(() => setToast(''), 4000); } e.target.value = ''; return; }
                  if (!checkStorageLimit(me, file.size)) {
                    const usedMB = Math.round(parseInt(localStorage.getItem('d_storage_used_bytes') || '0', 10) / 1024 / 1024);
                    setToast(`Storage limit reached (${usedMB} MB / ${tierLimits.maxStorageMB} MB used). Upgrade to upload more files.`);
                    setTimeout(() => setToast(''), 5000); e.target.value = ''; return;
                  }
                  try { await api.uploadFile(curChannel.id, file); addStorageUsedBytes(file.size); await loadMessages(curChannel); } catch {}
                  e.target.value = '';
                }} />
              </label>
              <input ref={inputRef} value={msgInput}
                onChange={e => { setMsgInput(e.target.value); if (Date.now() - typingRef.current > 3000 && curServer && curChannel) { typingRef.current = Date.now(); api.startTyping(curServer.id, curChannel.id).catch(() => {}); } }}
                onKeyDown={e => { if (e.key === 'Escape') { setSlashTool(null); } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={editMsg ? 'Edit message...' : `Message #${curChannel.name} (encrypted)`}
                style={{ flex: 1, padding: '10px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 12, color: T.tx, fontSize: 14, outline: 'none', fontFamily: "'DM Sans',sans-serif" }} />
              <div onClick={() => setShowEmojiPicker(p => !p)} style={{ cursor: 'pointer', color: T.mt, padding: 4 }}><I.Smile /></div>
              <div onClick={() => { setPollQuestion(''); setPollOptions(['', '']); setModal('create-poll'); }} style={{ cursor: 'pointer', color: T.mt, padding: 4, fontSize: 13 }} title="Create Poll">📊</div>
              <div onClick={() => setShowGifPicker(p => !p)} style={{ cursor: 'pointer', color: T.mt, padding: 4, fontSize: 11, fontWeight: 700 }} title="GIF">GIF</div>
              <div onClick={sendMessage} style={{ padding: '8px 14px', background: `linear-gradient(135deg,${T.ac},${T.ac2})`, borderRadius: 12, cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 13 }}>Send</div>
            </div>
          </div>
          </div>{/* close positioned wrapper */}
        </div>)}

        {view === 'server' && !curChannel && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.mt }}>
            <div style={{ textAlign: 'center' }}><div style={{ fontSize: 40, marginBottom: 8 }}>💬</div><div style={{ fontSize: 16, fontWeight: 600 }}>Select a channel</div></div>
          </div>
        )}
      </div>

      {/* ═══ Thread Panel ═══ */}
      {view === 'server' && openThread && curChannel && (
        <ThreadView
          parentMessage={openThread}
          channelId={curChannel.id}
          onClose={() => setOpenThread(null)}
          getName={getName}
        />
      )}

      {/* ═══ Right Panel ═══ */}
      {view === 'server' && !openThread && panel === 'members' && (loadingMembers && members.length === 0 ? (
        <div className="member-panel" style={{ width: 220, minWidth: 220, background: T.sf, borderLeft: `1px solid ${T.bd}`, padding: 16 }}>
          <SkeletonBar w="50%" h={11} mb={14} />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <SkeletonCircle size={30} />
              <div style={{ flex: 1 }}>
                <SkeletonBar w={`${45 + (i * 17) % 40}%`} h={11} mb={4} />
                <SkeletonBar w="30%" h={9} mb={0} />
              </div>
            </div>
          ))}
        </div>
      ) : (() => {
        // Group members by their highest role
        const roleMap = new Map<string, { name: string; color: string; position: number; members: any[] }>();
        // Add 'Online' and 'Offline' defaults
        roleMap.set('__owner', { name: '👑 Owner', color: '#faa61a', position: -1, members: [] });
        roles.forEach(r => roleMap.set(r.id, { name: r.name, color: r.color || T.mt, position: r.position ?? 99, members: [] }));
        roleMap.set('__online', { name: 'Online', color: T.mt, position: 998, members: [] });

        members.forEach(m => {
          if (m.user_id === curServer?.owner_id) { roleMap.get('__owner')!.members.push(m); return; }
          // Find highest role for this member
          const memberRoles = (m.role_ids || []).map((rid: string) => roles.find(r => r.id === rid)).filter(Boolean);
          if (memberRoles.length > 0) {
            const highest = memberRoles.sort((a: any, b: any) => (a.position ?? 99) - (b.position ?? 99))[0];
            if (roleMap.has(highest.id)) roleMap.get(highest.id)!.members.push(m);
            else roleMap.get('__online')!.members.push(m);
          } else {
            roleMap.get('__online')!.members.push(m);
          }
        });

        const groups = Array.from(roleMap.values()).filter(g => g.members.length > 0).sort((a, b) => a.position - b.position);

        return (
          <div className="member-panel" style={{ width: 220, minWidth: 220, background: T.sf, borderLeft: `1px solid ${T.bd}`, overflowY: 'auto', padding: 12 }}>
            {groups.map(group => (
              <div key={group.name}>
                <div style={{ fontSize: 10, fontWeight: 700, color: group.color, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '10px 0 4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{group.name}</span><span style={{ color: T.mt }}>{group.members.length}</span>
                </div>
                {group.members.map((m: any) => {
                  const _gbp = localStorage.getItem('d_show_bot_tags') ?? 'true';
                  const _srv = curServer ? (localStorage.getItem('d_server_bot_tags_' + curServer.id) ?? 'true') : 'true';
                  const _pbp = m.is_bot ? (localStorage.getItem('d_bot_tag_' + m.user_id) ?? 'true') : 'true';
                  // Badge shows if: user forced 'always', OR (server allows AND per-bot allows)
                  const showBotBadge = _gbp === 'always' || (_srv !== 'false' && _pbp !== 'false');
                  return (
                  <div key={m.user_id} onClick={e => { if (m.is_bot) { setSelectedBot({ ...m, bot_user_id: m.user_id }); setModal('bot-config'); } else { setProfileCard({ userId: m.user_id, pos: { x: e.clientX, y: e.clientY } }); } }} onContextMenu={e => openMemberCtx(e, m.user_id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 5, marginBottom: 1, cursor: 'pointer', borderLeft: m.is_bot && !showBotBadge ? `1px solid ${group.color}` : undefined }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ position: 'relative' }}>
                      <Av name={m.nickname || m.display_name || m.username} size={28} color={m.user_id === curServer?.owner_id ? '#faa61a' : undefined} />
                      <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, background: (() => { const s = m.user_id === api.userId ? userStatus : (presenceMap[m.user_id] || 'online'); return s === 'offline' ? '#747f8d' : s === 'idle' ? '#faa61a' : s === 'dnd' ? '#ed4245' : s === 'invisible' ? '#747f8d' : '#3ba55d'; })(), border: `2px solid ${T.sf}` }} />
                    </div>
                    <div title={m.username} style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: m.user_id === curServer?.owner_id ? '#faa61a' : T.tx }}>
                      {m.nickname || m.display_name || m.username}
                      {m.user_id === curServer?.owner_id && ' 👑'}
                      {renderPlatformBadge(m.user_id)}
                      {m.user_id === api.userId && <span style={{ color: T.ac, fontSize: 10 }}> (you)</span>}
                      {m.is_bot && <>
                        {showBotBadge && <span style={{ background: '#5865F2', color: '#fff', fontSize: 8, padding: '1px 4px', borderRadius: 3, marginLeft: 4, verticalAlign: 'middle' }}>BOT</span>}
                        <span onClick={e => { e.stopPropagation(); setSelectedBot({ ...m, bot_user_id: m.user_id }); setModal('bot-config'); }} title="Configure bot" style={{ marginLeft: 4, cursor: 'pointer', color: T.mt, fontSize: 15, verticalAlign: 'middle', lineHeight: 1 }}
                          onMouseEnter={e => (e.currentTarget.style.color = T.ac)}
                          onMouseLeave={e => (e.currentTarget.style.color = T.mt)}>⚙</span>
                      </>}
                    </div>
                  </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })())}

      {/* ═══ Modals ═══ */}
      {modal === 'create-server' && (
        <Modal title="Create a Server" onClose={() => { setModal(null); setServerPreset(null); }} wide>
          <div style={{ padding: 20 }}>
            {!serverPreset && (<>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Choose a template or start from scratch</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                {[
                  { key: 'quick', icon: '⚡', name: 'Quick Create', desc: 'Just a name', color: T.ac },
                  { key: 'gaming', icon: '🎮', name: 'Gaming', desc: 'Lobby + GameMaster bot', color: '#5865F2' },
                  { key: 'meeting', icon: '📋', name: 'Meeting', desc: 'Agenda + MeetingBot', color: '#faa61a' },
                  { key: 'community', icon: '👥', name: 'Community', desc: 'Welcome + CommunityBot', color: '#3ba55d' },
                  { key: 'study', icon: '📚', name: 'Study Group', desc: 'Resources + TutorBot', color: '#9b59b6' },
                ].map(p => (
                  <div key={p.key} onClick={() => p.key === 'quick' ? setServerPreset('quick') : setServerPreset(p.key)} style={{ padding: '16px 12px', borderRadius: 10, border: `2px solid ${T.bd}`, cursor: 'pointer', textAlign: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = p.color}
                    onMouseLeave={e => e.currentTarget.style.borderColor = T.bd}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>{p.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: T.mt }}>{p.desc}</div>
                  </div>
                ))}
              </div>
            </>)}
            {serverPreset && (<>
              <div onClick={() => setServerPreset(null)} style={{ cursor: 'pointer', color: T.mt, fontSize: 12, marginBottom: 12 }}>← Back to templates</div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Server Name</label>
              <input style={{ ...getInp(), marginBottom: 12 }} value={createName} onChange={e => setCreateName(e.target.value)} placeholder={serverPreset === 'gaming' ? 'Epic Gamers' : serverPreset === 'meeting' ? 'Team Standup' : serverPreset === 'study' ? 'Study Squad' : 'My Server'} autoFocus onKeyDown={e => { if (e.key === 'Enter') createServer(); }} />
              {serverPreset !== 'quick' && (
                <div style={{ padding: '10px 12px', background: T.sf2, borderRadius: 12, border: `1px solid ${T.bd}`, marginBottom: 12, fontSize: 12, color: T.mt }}>
                  ✨ This template will auto-create channels and spawn an AI bot for your server.
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: T.sf2, borderRadius: 12, border: `1px solid ${T.bd}`, marginBottom: 12, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={enableAutomod} onChange={e => setEnableAutomod(e.target.checked)} style={{ accentColor: T.ac }} />
                <div>
                  <div style={{ fontWeight: 600, color: T.tx }}>Enable AutoMod <span style={{ fontSize: 10, color: T.ac, fontWeight: 700 }}>RECOMMENDED</span></div>
                  <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Blocks slurs, invite spam, and mention flooding</div>
                </div>
              </label>
              <button onClick={createServer} style={btn(!!createName.trim())}>Create Server</button>
            </>)}
          </div>
        </Modal>
      )}
      {/* New DM Modal */}
      {showNewDmModal && (() => {
        const q = newDmQuery.toLowerCase();
        const filteredFriends = newDmFriends.filter(f => {
          const name = (f.username || f.display_name || '').toLowerCase();
          return !q || name.startsWith(q) || name.includes(q);
        });
        // non-friend search results (exclude anyone already in friends list)
        const friendIds = new Set(newDmFriends.map(f => f.friend_id || f.user_id || f.id));
        const extraResults = newDmSearchResults.filter(u => !friendIds.has(u.id || u.user_id));

        const UserRow = ({ uid, name, onSelect }: { uid: string; name: string; onSelect: () => void }) => {
          const status = uid === api.userId ? userStatus : (presenceMap[uid] || 'offline');
          const statusColor = status === 'online' ? '#3ba55d' : status === 'idle' ? '#faa61a' : status === 'dnd' ? '#ed4245' : '#747f8d';
          return (
            <div onClick={onSelect} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', cursor: 'pointer', borderRadius: 6 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Av name={name} size={32} />
                <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, background: statusColor, border: `2px solid ${T.sf}` }} />
              </div>
              <span style={{ fontSize: 13, color: T.tx, fontWeight: 500 }}>{name}</span>
            </div>
          );
        };

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 10500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }} onClick={() => setShowNewDmModal(false)}>
            <div onClick={e => e.stopPropagation()} style={{ width: 300, background: T.sf, borderRadius: 10, border: `1px solid ${T.bd}`, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '14px 14px 10px', borderBottom: `1px solid ${T.bd}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 10 }}>Open a DM</div>
                <input
                  autoFocus
                  value={newDmQuery}
                  onChange={async e => {
                    const val = e.target.value;
                    setNewDmQuery(val);
                    if (val.trim().length >= 2) {
                      setNewDmSearching(true);
                      const res = await api.searchUsers(val.trim());
                      setNewDmSearchResults(Array.isArray(res) ? res : []);
                      setNewDmSearching(false);
                    } else {
                      setNewDmSearchResults([]);
                    }
                  }}
                  placeholder="Find or start a conversation"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 13, outline: 'none', fontFamily: "'DM Sans',sans-serif" }}
                />
              </div>

              {/* Results */}
              <div style={{ maxHeight: 320, overflowY: 'auto', padding: '6px 0' }}>
                {/* Friends */}
                {filteredFriends.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 12px 2px' }}>Friends</div>
                    {filteredFriends.map(f => {
                      const uid = f.friend_id || f.user_id || f.id;
                      const name = f.username || f.display_name || uid?.slice(0, 8);
                      return <UserRow key={uid} uid={uid} name={name} onSelect={async () => { await startDm(uid); setShowNewDmModal(false); }} />;
                    })}
                  </>
                )}
                {filteredFriends.length === 0 && !newDmQuery && (
                  <div style={{ padding: '12px 14px', fontSize: 12, color: T.mt, fontStyle: 'italic' }}>No friends yet — search by username below.</div>
                )}

                {/* Divider + all-user search */}
                {newDmQuery.trim().length >= 2 && (
                  <>
                    {filteredFriends.length > 0 && <div style={{ height: 1, background: T.bd, margin: '6px 12px' }} />}
                    {newDmSearching && <div style={{ padding: '8px 14px', fontSize: 12, color: T.mt }}>Searching…</div>}
                    {!newDmSearching && extraResults.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 12px 2px' }}>All Users</div>
                        {extraResults.map(u => {
                          const uid = u.id || u.user_id;
                          const name = u.username || u.display_name || uid?.slice(0, 8);
                          return <UserRow key={uid} uid={uid} name={name} onSelect={async () => { await startDm(uid); setShowNewDmModal(false); }} />;
                        })}
                      </>
                    )}
                    {!newDmSearching && extraResults.length === 0 && filteredFriends.length === 0 && (
                      <div style={{ padding: '10px 14px', fontSize: 12, color: T.mt }}>No users found for "{newDmQuery}"</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* New Group DM Modal */}
      {showGroupDmModal && (
        <Modal title="New Group DM" onClose={() => setShowGroupDmModal(false)}>
          <div style={{ padding: 20, minWidth: 320 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Group Name</label>
            <input autoFocus value={gdmName} onChange={e => setGdmName(e.target.value)} placeholder="e.g. Weekend plans" style={{ ...getInp(), marginBottom: 16 }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 8 }}>Add Friends</label>
            {gdmFriends.length === 0 ? (
              <div style={{ fontSize: 12, color: T.mt, fontStyle: 'italic', marginBottom: 16 }}>No friends to add yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16, maxHeight: 220, overflowY: 'auto' }}>
                {gdmFriends.map((f: any) => {
                  const uid = f.friend_id || f.user_id || f.id;
                  const name = f.username || f.display_name || uid?.slice(0, 8);
                  const checked = gdmSelected.includes(uid);
                  return (
                    <div key={uid} onClick={() => setGdmSelected(p => checked ? p.filter(id => id !== uid) : [...p, uid])}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, cursor: 'pointer', border: `1px solid ${checked ? T.ac : T.bd}`, background: checked ? `${T.ac}12` : 'transparent', transition: 'border-color .1s' }}>
                      <Av name={name} size={28} />
                      <span style={{ flex: 1, fontSize: 13, color: checked ? T.ac : T.tx, fontWeight: checked ? 600 : 400 }}>{name}</span>
                      <span style={{ fontSize: 16, color: checked ? T.ac : T.bd }}>{checked ? '✓' : '○'}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {gdmSelected.length > 0 && (
              <div style={{ fontSize: 11, color: T.mt, marginBottom: 12 }}>{gdmSelected.length} selected</div>
            )}
            <button disabled={gdmSelected.length < 2 || !gdmName.trim()} onClick={async () => {
              try {
                const gdm = await api.createGroupDm(gdmName.trim(), gdmSelected);
                if (gdm?.id) { setGroupDms(p => [gdm, ...p]); selectGroupDm(gdm); }
              } catch { setToast('Failed to create group DM'); setTimeout(() => setToast(''), 3000); }
              setShowGroupDmModal(false);
            }} style={{ ...btn(gdmSelected.length >= 2 && !!gdmName.trim()), width: '100%' }}>
              Create Group DM {gdmSelected.length >= 2 ? `(${gdmSelected.length} people)` : ''}
            </button>
            {gdmSelected.length < 2 && <div style={{ fontSize: 11, color: T.mt, textAlign: 'center', marginTop: 6 }}>Select at least 2 friends</div>}
          </div>
        </Modal>
      )}

      {modal === 'join-server' && (
        <Modal title="Join Server" onClose={() => { setModal(null); setShowQrScanner(false); }}>
          <div style={{ padding: 20 }}>
            {showQrScanner ? (
              <QrScanner
                onScan={(data) => {
                  setShowQrScanner(false);
                  const invite = decodeInviteQr(data);
                  if (invite) {
                    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
                      setToast('This invite has expired'); setTimeout(() => setToast(''), 3000);
                      return;
                    }
                    if (invite.instance_url === window.location.origin) {
                      setJoinCode(invite.invite_code);
                      setToast(`Found invite to "${invite.server_name}"`); setTimeout(() => setToast(''), 2000);
                    } else {
                      setInvitePreview({ code: invite.invite_code, server_name: invite.server_name, member_count: 0, foreign: true, url: `${invite.instance_url}/invite/${invite.invite_code}` });
                      setModal(null);
                    }
                  } else {
                    // Try as raw invite code or URL
                    const code = extractInviteCode(data);
                    if (code) setJoinCode(code);
                    else { setToast('Invalid QR code'); setTimeout(() => setToast(''), 3000); }
                  }
                }}
                onClose={() => setShowQrScanner(false)}
              />
            ) : (
              <>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Invite Code or Link</label>
                <input style={{ ...getInp(), marginBottom: 12 }} value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder={`abc123 or ${window.location.origin}/invite/abc123`} autoFocus onKeyDown={async e => { if (e.key === 'Enter' && joinCode.trim()) { const code = extractInviteCode(joinCode.trim()); if (!code) return; if (!checkRateLimit('d_join_count', 'd_join_window', 60 * 60_000, tierLimits.maxServersJoinedPerHour)) { setToast('You\'re joining servers too quickly. Try again later.'); setTimeout(() => setToast(''), 4000); return; } await api.joinServer('', code); await loadServers(); setJoinCode(''); setModal(null); } }} />
                <div style={{ display: 'flex', gap: 8, marginBottom: 0 }}>
                  <button onClick={async () => { if (joinCode.trim()) { const code = extractInviteCode(joinCode.trim()); if (!code) return; if (!checkRateLimit('d_join_count', 'd_join_window', 60 * 60_000, tierLimits.maxServersJoinedPerHour)) { setToast('You\'re joining servers too quickly. Try again later.'); setTimeout(() => setToast(''), 4000); return; } await api.joinServer('', code); await loadServers(); setJoinCode(''); setModal(null); } }} style={{ ...btn(true), flex: 1 }}>Join</button>
                  <button onClick={() => setShowQrScanner(true)} style={{ padding: '9px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: T.sf2, color: T.tx, border: `1px solid ${T.bd}`, whiteSpace: 'nowrap' }}>
                    Scan QR
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      {invitePreview && !invitePreview.foreign && (
        <Modal title="You've been invited to join a server" onClose={() => setInvitePreview(null)}>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: invitePreview.icon_url ? 'transparent' : `linear-gradient(135deg,${T.ac}33,${T.ac2}33)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, color: T.ac, overflow: 'hidden', margin: '0 auto 12px' }}>
              {invitePreview.icon_url ? <img src={invitePreview.icon_url} alt="" style={{ width: 64, height: 64, objectFit: 'cover' }} /> : invitePreview.server_name[0]?.toUpperCase()}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.tx, marginBottom: 4 }}>{invitePreview.server_name}</div>
            <div style={{ fontSize: 12, color: T.mt, marginBottom: 20 }}>{invitePreview.member_count} member{invitePreview.member_count !== 1 ? 's' : ''}</div>
            <button onClick={async () => { if (!checkRateLimit('d_join_count', 'd_join_window', 60 * 60_000, tierLimits.maxServersJoinedPerHour)) { setToast('You\'re joining servers too quickly. Try again later.'); setTimeout(() => setToast(''), 4000); return; } try { await api.joinServer('', invitePreview.code); await loadServers(); setToast('Joined server!'); setTimeout(() => setToast(''), 2000); } catch { setToast('Failed to join server'); setTimeout(() => setToast(''), 3000); } setInvitePreview(null); }} style={{ ...btn(true), width: '100%', fontSize: 14, padding: '10px 0' }}>Join {invitePreview.server_name}</button>
          </div>
        </Modal>
      )}
      {invitePreview && invitePreview.foreign && (
        <Modal title="Different Instance" onClose={() => setInvitePreview(null)}>
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🌐</div>
            <div style={{ fontSize: 14, color: T.tx, fontWeight: 600, marginBottom: 8 }}>This invite is for a different Discreet instance</div>
            <div style={{ fontSize: 12, color: T.mt, marginBottom: 20, lineHeight: 1.5 }}>This invite link points to a different server at <span style={{ color: T.ac, fontWeight: 600 }}>{(() => { try { return new URL(invitePreview.url || '').host; } catch { return 'unknown'; } })()}</span>. You'll need to open it in your browser to join.</div>
            <button onClick={() => { window.open(invitePreview.url, '_blank', 'noopener'); setInvitePreview(null); }} style={{ ...btn(true), width: '100%', fontSize: 14, padding: '10px 0' }}>Open in Browser</button>
          </div>
        </Modal>
      )}
      {modal === 'settings' && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <SettingsModal
            onClose={() => setModal(null)}
            onThemeChange={handleThemeChange}
            showConfirm={showConfirm}
            setUserMap={setUserMap}
            curServer={curServer}
            onLogout={async () => { await api.logout(); setAuthed(false); setModal(null); }}
            onUpgrade={() => { setModal('upgrade'); }}
            platformUser={platformUser}
            devTierOverride={devTierOverride}
            onSetDevTierOverride={(t) => {
              setDevTierOverride(t);
              if (t) localStorage.setItem('d_dev_tier_override', t);
              else localStorage.removeItem('d_dev_tier_override');
            }}
          />
        </Suspense>
      )}
      {modal === 'create-channel' && curServer && (
        <Modal title="Create Channel" onClose={() => setModal(null)}>
          <div style={{ padding: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Channel Name</label>
            <input style={{ ...getInp(), marginBottom: 12 }} value={createChannelName} onChange={e => setCreateChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="general" autoFocus onKeyDown={e => { if (e.key === 'Enter') { api.createChannel(curServer.id, sanitizeInput(createChannelName.trim()), null, createChannelType).then(() => { loadChannels(curServer.id); setCreateChannelName(''); setModal(null); }); } }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
              {([
                { id: 'text',         icon: '#',  label: 'Text'         },
                { id: 'voice',        icon: '🔊', label: 'Voice'        },
                { id: 'announcement', icon: '📢', label: 'Announcement' },
                { id: 'forum',        icon: '💬', label: 'Forum'        },
                { id: 'stage',        icon: '🎤', label: 'Stage'        },
              ] as { id: string; icon: string; label: string }[]).map(t => (
                <div key={t.id} onClick={() => setCreateChannelType(t.id)} style={{ padding: '8px 6px', borderRadius: 12, cursor: 'pointer', border: `2px solid ${createChannelType === t.id ? T.ac : T.bd}`, textAlign: 'center', fontSize: 12, fontWeight: 600, color: createChannelType === t.id ? T.ac : T.mt, background: createChannelType === t.id ? `${T.ac}11` : 'transparent' }}>
                  <div style={{ fontSize: 18, marginBottom: 2 }}>{t.icon}</div>
                  {t.label}
                </div>
              ))}
            </div>
            <button onClick={() => { api.createChannel(curServer.id, sanitizeInput(createChannelName.trim()), null, createChannelType).then(() => { loadChannels(curServer.id); setCreateChannelName(''); setModal(null); }); }} style={btn(!!createChannelName.trim())}>Create Channel</button>
          </div>
        </Modal>
      )}
      {modal === 'invite-config' && curServer && (
        <Modal title={`Invite people to ${curServer.name}`} onClose={() => { setModal(null); setInviteResult(''); }}>
          <div style={{ padding: 20, minWidth: 340 }}>
            {/* Config row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Expire After</label>
                <select value={inviteExpiry} onChange={e => { setInviteExpiry(e.target.value); setInviteResult(''); }} style={{ width: '100%', padding: '8px 10px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 13, outline: 'none' }}>
                  <option value="30m">30 minutes</option>
                  <option value="1h">1 hour</option>
                  <option value="6h">6 hours</option>
                  <option value="12h">12 hours</option>
                  <option value="1d">1 day</option>
                  <option value="7d">7 days</option>
                  <option value="never">Never</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Max Uses</label>
                <select value={inviteMaxUses ?? 'none'} onChange={e => { setInviteMaxUses(e.target.value === 'none' ? null : Number(e.target.value)); setInviteResult(''); }} style={{ width: '100%', padding: '8px 10px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 13, outline: 'none' }}>
                  <option value="none">No limit</option>
                  <option value="1">1 use</option>
                  <option value="5">5 uses</option>
                  <option value="10">10 uses</option>
                  <option value="25">25 uses</option>
                  <option value="50">50 uses</option>
                  <option value="100">100 uses</option>
                </select>
              </div>
            </div>
            {/* Temporary membership toggle */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20, padding: '12px 14px', background: T.sf2, borderRadius: 12, border: `1px solid ${T.bd}` }}>
              <div onClick={() => { setInviteTemporary(p => !p); setInviteResult(''); }} style={{ flexShrink: 0, marginTop: 2, width: 36, height: 20, borderRadius: 10, background: inviteTemporary ? T.ac : T.bd, position: 'relative', cursor: 'pointer', transition: 'background .2s' }}>
                <div style={{ position: 'absolute', top: 3, left: inviteTemporary ? 19 : 3, width: 14, height: 14, borderRadius: 7, background: '#fff', transition: 'left .2s' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.tx, marginBottom: 2 }}>Temporary Membership</div>
                <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4 }}>Members are kicked when they go offline unless they've been assigned a role.</div>
              </div>
            </div>
            {/* Generated link */}
            {inviteResult ? (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Invite Link</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, padding: '10px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, fontSize: 13, fontFamily: "'JetBrains Mono',monospace", color: T.ac, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {window.location.host}/invite/{inviteResult}
                  </div>
                  <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/invite/${inviteResult}`); setToast('Link copied!'); setTimeout(() => setToast(''), 2000); }} style={{ ...btn(true), padding: '9px 14px', whiteSpace: 'nowrap', fontSize: 13 }}>Copy Link</button>
                </div>
                <div style={{ fontSize: 10, color: T.mt, marginTop: 6 }}>
                  {inviteExpiry === 'never' ? 'Never expires' : `Expires in ${inviteExpiry === '30m' ? '30 minutes' : inviteExpiry === '1h' ? '1 hour' : inviteExpiry === '6h' ? '6 hours' : inviteExpiry === '12h' ? '12 hours' : inviteExpiry === '1d' ? '1 day' : '7 days'}`}
                  {inviteMaxUses ? ` · ${inviteMaxUses} use${inviteMaxUses !== 1 ? 's' : ''} max` : ' · Unlimited uses'}
                </div>
              </div>
            ) : null}
            <button onClick={generateInvite} disabled={inviteGenerating} style={{ ...btn(true), width: '100%' }}>
              {inviteGenerating ? 'Generating…' : inviteResult ? 'Regenerate' : 'Generate Invite'}
            </button>
            {/* Share Offline — QR Code */}
            {inviteResult && !showInviteQr && (
              <button onClick={() => setShowInviteQr(true)} style={{ width: '100%', marginTop: 10, padding: '9px 0', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: T.sf2, color: T.tx, border: `1px solid ${T.bd}` }}>
                Share Offline (QR Code)
              </button>
            )}
            {inviteResult && showInviteQr && curServer && (
              <div style={{ marginTop: 14, textAlign: 'center', padding: '16px 0', background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}` }}>
                <QrCode
                  data={encodeInviteQr({
                    instance_url: window.location.origin,
                    invite_code: inviteResult,
                    server_name: curServer.name,
                    expires_at: inviteExpiry === 'never' ? null : (() => {
                      const mins: Record<string, number> = { '30m': 30, '1h': 60, '6h': 360, '12h': 720, '1d': 1440, '7d': 10080 };
                      const d = new Date(); d.setMinutes(d.getMinutes() + (mins[inviteExpiry] ?? 10080));
                      return d.toISOString();
                    })(),
                  })}
                  size={220}
                  label="Scan to join server"
                />
                <div style={{ fontSize: 10, color: T.mt, marginTop: 8 }}>
                  Click QR code for fullscreen · Works offline
                </div>
                <button onClick={() => setShowInviteQr(false)} style={{ marginTop: 8, padding: '4px 12px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: T.sf2, color: T.mt, border: `1px solid ${T.bd}` }}>
                  Hide QR
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal === 'create-poll' && curChannel && (
        <Modal title="Create Poll" onClose={() => setModal(null)}>
          <div style={{ padding: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Question</label>
            <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="What do you want to ask?" style={{ ...getInp(), marginBottom: 12 }} autoFocus />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Options</label>
            {pollOptions.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: T.mt, width: 20 }}>{i + 1}.</span>
                <input value={opt} onChange={e => { const n = [...pollOptions]; n[i] = e.target.value; setPollOptions(n); }} placeholder={`Option ${i + 1}`} style={{ ...getInp(), flex: 1 }} />
                {pollOptions.length > 2 && <span onClick={() => setPollOptions(p => p.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: T.err, fontSize: 14 }}>✕</span>}
              </div>
            ))}
            {pollOptions.length < 10 && (
              <div onClick={() => setPollOptions(p => [...p, ''])} style={{ padding: '6px 0', fontSize: 12, color: T.ac, cursor: 'pointer', marginBottom: 12 }}>+ Add Option</div>
            )}
            <button onClick={async () => {
              const validOpts = pollOptions.filter(o => o.trim());
              if (!pollQuestion.trim() || validOpts.length < 2) { setToast('Need a question and at least 2 options'); setTimeout(() => setToast(''), 2000); return; }
              try {
                await api.createPoll(curChannel.id, pollQuestion.trim(), validOpts);
                setToast('Poll created!'); setTimeout(() => setToast(''), 2000);
                setModal(null);
              } catch { setToast('Failed to create poll'); setTimeout(() => setToast(''), 2000); }
            }} style={btn(!!pollQuestion.trim() && pollOptions.filter(o => o.trim()).length >= 2)}>Create Poll</button>
          </div>
        </Modal>
      )}
      {modal === 'status-picker' && (
        <Modal title="Set Status" onClose={() => setModal(null)}>
          <div style={{ padding: 16 }}>
            {[
              { key: 'online', label: '● Online', color: '#3ba55d', desc: 'You are available' },
              { key: 'idle', label: '🌙 Idle', color: '#faa61a', desc: 'You may be away' },
              { key: 'dnd', label: '⛔ Do Not Disturb', color: '#ed4245', desc: 'Suppress notifications' },
              { key: 'invisible', label: '👻 Invisible', color: '#747f8d', desc: 'Appear offline' },
            ].map(s => (
              <div key={s.key} onClick={() => changeStatus(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', marginBottom: 4, background: userStatus === s.key ? 'rgba(0,212,170,0.08)' : 'transparent', border: userStatus === s.key ? `1px solid ${T.ac}33` : '1px solid transparent' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = userStatus === s.key ? 'rgba(0,212,170,0.08)' : 'transparent'}>
                <div style={{ width: 12, height: 12, borderRadius: 6, background: s.color }} />
                <div><div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{s.label}</div><div style={{ fontSize: 11, color: T.mt }}>{s.desc}</div></div>
                {userStatus === s.key && <span style={{ marginLeft: 'auto', color: T.ac }}>✓</span>}
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'edit-channel' && editChannel && (
        <Modal title={`Channel Settings — #${editChannel.name}`} onClose={() => { setModal(null); setEditChannel(null); }} wide>
          <div style={{ display: 'flex', minHeight: 400 }}>
            {/* Sidebar tabs */}
            <div style={{ width: 160, background: T.bg, padding: '12px 8px', borderRight: `1px solid ${T.bd}` }}>
              {['Overview', 'Permissions', 'Invites', 'Danger Zone'].map(tab => (
                <div key={tab} onClick={() => setChSettingsTab(tab.toLowerCase().replace(' ', '-'))} style={{ padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: chSettingsTab === tab.toLowerCase().replace(' ', '-') ? 600 : 400, color: chSettingsTab === tab.toLowerCase().replace(' ', '-') ? T.ac : T.mt, background: chSettingsTab === tab.toLowerCase().replace(' ', '-') ? 'rgba(0,212,170,0.08)' : 'transparent', marginBottom: 2 }}>{tab}</div>
              ))}
            </div>
            <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
              {chSettingsTab === 'overview' && (<>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Overview</div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Channel Name</label>
                <input value={editChannelName} onChange={e => setEditChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} style={{ ...getInp(), marginBottom: 12 }} />
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Topic</label>
                <input value={editChannelTopic} onChange={e => setEditChannelTopic(e.target.value)} placeholder="Describe this channel" style={{ ...getInp(), marginBottom: 12 }} />
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Slowmode (seconds between messages)</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {[0, 5, 10, 15, 30, 60, 120, 300, 600].map(s => (
                    <div key={s} onClick={() => setChSlowmode(s)} style={{ padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11, background: chSlowmode === s ? T.ac : T.sf2, color: chSlowmode === s ? '#000' : T.mt, border: `1px solid ${chSlowmode === s ? T.ac : T.bd}` }}>{s === 0 ? 'Off' : s < 60 ? `${s}s` : `${s / 60}m`}</div>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <div onClick={() => setChNsfw(!chNsfw)} style={{ width: 36, height: 20, borderRadius: 10, background: chNsfw ? T.ac : T.sf2, position: 'relative', cursor: 'pointer', transition: 'background .2s' }}><div style={{ width: 16, height: 16, borderRadius: 12, background: '#fff', position: 'absolute', top: 2, left: chNsfw ? 18 : 2, transition: 'left .2s' }} /></div>
                    <span style={{ fontSize: 13 }}>NSFW Channel</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <div onClick={() => setChArchived(!chArchived)} style={{ width: 36, height: 20, borderRadius: 10, background: chArchived ? T.ac : T.sf2, position: 'relative', cursor: 'pointer', transition: 'background .2s' }}><div style={{ width: 16, height: 16, borderRadius: 12, background: '#fff', position: 'absolute', top: 2, left: chArchived ? 18 : 2, transition: 'left .2s' }} /></div>
                    <span style={{ fontSize: 13 }}>Archive Channel (read-only)</span>
                  </label>
                </div>
                <button onClick={async () => {
                  await api.updateChannel(editChannel.id, { name: editChannelName.trim() || editChannel.name, topic: editChannelTopic, slowmode_seconds: chSlowmode, is_nsfw: chNsfw, is_archived: chArchived });
                  if (curServer) await loadChannels(curServer.id);
                  setToast('Channel updated'); setTimeout(() => setToast(''), 2000);
                }} style={btn(true)}>Save Changes</button>
              </>)}
              {chSettingsTab === 'permissions' && (() => {
                const saveChPerms = async () => {
                  const lsKey = `d_ch_perms_${editChannel.id}`;
                  localStorage.setItem(lsKey, JSON.stringify(chPermOverrides));
                  // Build allow/deny bitfields per role for the API
                  const overwrites = Object.fromEntries(
                    Object.entries(chPermOverrides).map(([roleId, perms]) => {
                      let allow = 0, deny = 0;
                      CH_PERMS.forEach(p => {
                        if (perms[p.key] === 'allow') allow |= p.bit;
                        if (perms[p.key] === 'deny')  deny  |= p.bit;
                      });
                      return [roleId, { allow, deny }];
                    })
                  );
                  await api.updateChannel(editChannel.id, { permission_overwrites: overwrites });
                  setToast('Permissions saved'); setTimeout(() => setToast(''), 2000);
                };

                const activeCount = (roleId: string) =>
                  Object.values(chPermOverrides[roleId] || {}).filter(v => v !== 'neutral').length;

                return (<>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Permission Overrides</div>
                  <div style={{ fontSize: 12, color: T.mt, marginBottom: 20, lineHeight: 1.5 }}>
                    Set per-role overrides for <strong style={{ color: T.tx }}>#{editChannel.name}</strong>.
                    Overrides take priority over server-level role permissions.
                    <br />Neutral means "use server default".
                  </div>

                  {roles.map(r => {
                    const rolePerms = chPermOverrides[r.id] || {};
                    const count = activeCount(r.id);
                    return (
                      <div key={r.id} style={{ background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 10, overflow: 'hidden' }}>
                        {/* Role header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: T.sf2, borderBottom: `1px solid ${T.bd}` }}>
                          <div style={{ width: 12, height: 12, borderRadius: 3, background: r.color || T.mt, flexShrink: 0 }} />
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</span>
                          {count > 0 && (
                            <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, background: 'rgba(0,212,170,0.15)', color: T.ac, padding: '2px 8px', borderRadius: 10 }}>
                              {count} override{count !== 1 ? 's' : ''}
                            </span>
                          )}
                          {count > 0 && (
                            <span
                              onClick={() => setChPermOverrides(p => ({ ...p, [r.id]: {} }))}
                              style={{ fontSize: 10, color: T.mt, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, border: `1px solid ${T.bd}` }}
                              title="Reset this role to defaults"
                            >Reset</span>
                          )}
                        </div>

                        {/* Permission rows */}
                        {CH_PERMS.map(({ key: permKey, label, desc }) => {
                          const state: PermState = rolePerms[permKey] || 'neutral';
                          return (
                            <div key={permKey} style={{ display: 'flex', alignItems: 'center', padding: '9px 16px', gap: 12, borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                              {/* Perm info */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: T.tx }}>{label}</div>
                                <div style={{ fontSize: 11, color: T.mt, marginTop: 1 }}>{desc}</div>
                              </div>

                              {/* Allow / Neutral / Deny toggle group */}
                              <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.bd}`, flexShrink: 0 }}>
                                {PERM_OPTS.map((opt, oi) => {
                                  const active = state === opt.val;
                                  return (
                                    <button
                                      key={opt.val}
                                      onClick={() => setChPermOverrides(prev => ({
                                        ...prev,
                                        [r.id]: { ...prev[r.id], [permKey]: opt.val },
                                      }))}
                                      title={opt.label}
                                      style={{
                                        padding: '5px 12px',
                                        border: 'none',
                                        borderLeft: oi > 0 ? `1px solid ${T.bd}` : 'none',
                                        cursor: 'pointer',
                                        fontSize: 13,
                                        fontWeight: 700,
                                        lineHeight: 1,
                                        background: active ? opt.activeBg : T.sf2,
                                        color: active ? opt.color : T.mt,
                                        transition: 'background .12s, color .12s',
                                        minWidth: 36,
                                      }}
                                    >
                                      {opt.icon}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* Action bar */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
                    <button onClick={saveChPerms} style={btn(true)}>Save Permissions</button>
                    <button
                      onClick={() => setChPermOverrides({})}
                      style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${T.bd}`, borderRadius: 12, color: T.mt, cursor: 'pointer', fontSize: 13 }}
                    >Reset All Roles</button>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: T.mt }}>
                      {Object.values(chPermOverrides).reduce((n, rp) => n + Object.values(rp).filter(v => v !== 'neutral').length, 0)} active override(s)
                    </span>
                  </div>
                </>);
              })()}
              {chSettingsTab === 'invites' && (<>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Invites</div>
                <button onClick={openInviteModal} style={btn(true)}>Create Invite</button>
              </>)}
              {chSettingsTab === 'danger-zone' && (<>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.err, marginBottom: 16 }}>Danger Zone</div>
                <div style={{ padding: 16, background: 'rgba(255,71,87,0.05)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.err, marginBottom: 8 }}>Delete Channel</div>
                  <div style={{ fontSize: 12, color: T.mt, marginBottom: 12 }}>Permanently delete #{editChannel.name}. This action cannot be undone. All messages will be lost.</div>
                  <button onClick={async () => {
                    if (await showConfirm('Delete Channel', `This will permanently delete #${editChannel.name} and all its messages. This action cannot be undone.`, true, editChannel.name, 'Delete Channel')) {
                      await api.deleteChannel(editChannel.id);
                      if (curServer) await loadChannels(curServer.id);
                      if (curChannel?.id === editChannel.id) setCurChannel(null);
                      setModal(null); setEditChannel(null);
                    }
                  }} style={{ padding: '8px 16px', background: 'rgba(255,71,87,0.15)', border: '1px solid rgba(255,71,87,0.4)', borderRadius: 12, color: T.err, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Delete Channel</button>
                </div>
              </>)}
            </div>
          </div>
        </Modal>
      )}
      {modal === 'server-settings' && curServer && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <ServerSettingsModal
            server={curServer as any}
            onClose={() => setModal(null)}
            onUpdate={async () => { await loadServers(); await loadChannels(curServer.id); await loadMembers(curServer.id); }}
            showConfirm={showConfirm}
            getName={getName}
            decrypt={async (ct, cid, ep) => dec(cid, ct)}
            onCreateInvite={() => { setModal(null); openInviteModal(); }}
          />
        </Suspense>
      )}

      {showWatchParty && curServer && curChannel && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <WatchParty
            channelId={curChannel.id}
            serverId={curServer.id}
            onClose={() => setShowWatchParty(false)}
          />
        </Suspense>
      )}

      {showMeeting && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <MeetingRoom onClose={() => { setShowMeeting(false); setMeetingCode(undefined); }} initialCode={meetingCode} />
        </Suspense>
      )}

      {showCalendar && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 19000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: '92vw', maxWidth: 1040, maxHeight: '90vh', overflow: 'auto', borderRadius: 14, background: T.sf, border: `1px solid ${T.bd}`, boxShadow: '0 24px 80px rgba(0,0,0,0.55)' }}>
            <button onClick={() => setShowCalendar(false)} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', color: T.mt, fontSize: 18, cursor: 'pointer', zIndex: 10, lineHeight: 1 }}>✕</button>
            <Suspense fallback={<ModalLoadingFallback />}>
              <CalendarView
                serverId={curServer?.id ?? null}
                onJoinMeeting={(code) => { setShowCalendar(false); setMeetingCode(code); setShowMeeting(true); }}
              />
            </Suspense>
          </div>
        </div>
      )}

      {showDocEditor && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <DocumentEditor
            channelId={curChannel?.id || api.userId || 'personal'}
            onClose={() => setShowDocEditor(false)}
          />
        </Suspense>
      )}

      {showHealth && isAnyOwner && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 19000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: '92vw', maxWidth: 860, maxHeight: '90vh', overflow: 'auto', borderRadius: 14, background: T.sf, border: `1px solid ${T.bd}`, boxShadow: '0 24px 80px rgba(0,0,0,0.55)' }}>
            <button onClick={() => setShowHealth(false)} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', color: T.mt, fontSize: 18, cursor: 'pointer', zIndex: 10, lineHeight: 1 }}>✕</button>
            <Suspense fallback={<ModalLoadingFallback />}>
              <ServerHealth />
            </Suspense>
          </div>
        </div>
      )}

      {showNotifCenter && (
        <NotificationCenter
          notifications={notifications}
          onDismiss={id => {
            setNotifications(prev => { const next = prev.filter(n => n.id !== id); saveNotifications(next); return next; });
          }}
          onMarkRead={id => {
            setNotifications(prev => { const next = prev.map(n => n.id === id ? { ...n, read: true } : n); saveNotifications(next); return next; });
          }}
          onClear={() => { setNotifications([]); saveNotifications([]); }}
          onClose={() => setShowNotifCenter(false)}
        />
      )}

      {modal === 'avatar-creator' && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AvatarCreator
            onSave={async (dataUrl: string) => {
              const res = await api.updateProfile({ avatar: dataUrl });
              const json = await res?.json().catch(() => null);
              api.ws?.send(JSON.stringify({ type: 'user_profile_update', avatar_url: json?.avatar_url ?? dataUrl }));
              setModal(null);
            }}
            onClose={() => setModal(null)}
          />
        </Suspense>
      )}

      {modal === 'bot-config' && selectedBot && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <BotConfigModal
            bot={selectedBot}
            serverId={curServer?.id}
            channelId={curChannel?.id}
            onClose={() => { setModal(null); setSelectedBot(null); }}
            showConfirm={showConfirm}
          />
        </Suspense>
      )}

      {/* GIF Picker */}
      {showGifPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={() => setShowGifPicker(false)}>
          <div style={{ position: 'fixed', bottom: 70, right: panel ? 240 : 20, zIndex: 10000 }} onClick={e => e.stopPropagation()}>
            <GifPicker onSelect={async (url) => {
              setShowGifPicker(false);
              if (curChannel) {
                const ct = await enc(curChannel.id, url);
                await api.sendMessage(curChannel.id, ct, 0);
                await loadMessages(curChannel);
              }
            }} onClose={() => setShowGifPicker(false)} />
          </div>
        </div>
      )}

      {/* Emoji picker for reactions */}
      {emojiTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={() => setEmojiTarget(null)}>
          <div style={{ position: 'fixed', bottom: 80, right: 20, zIndex: 10000 }} onClick={e => e.stopPropagation()}>
            <EmojiPicker full onSelect={em => addReaction(emojiTarget, em)} onClose={() => setEmojiTarget(null)} customEmoji={serverEmoji} />
          </div>
        </div>
      )}

      {/* Emoji picker for input */}
      {showEmojiPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={() => setShowEmojiPicker(false)}>
          <div style={{ position: 'fixed', bottom: 70, right: panel ? 240 : 20, zIndex: 10000 }} onClick={e => e.stopPropagation()}>
            <EmojiPicker full onSelect={em => { setMsgInput(p => p + em); setShowEmojiPicker(false); }} onClose={() => setShowEmojiPicker(false)} customEmoji={serverEmoji} />
          </div>
        </div>
      )}

      {/* Profile Card */}
      {profileCard && (
        <Suspense fallback={null}>
          <UserProfileCard
            userId={profileCard.userId}
            pos={profileCard.pos}
            onClose={() => setProfileCard(null)}
            curServer={curServer as any}
            isOwner={curServer?.owner_id === api.userId}
            canMod={hasPrivilege(myPrivilege, PRIVILEGE_LEVELS.MODERATOR)}
            allRoles={roles}
            showConfirm={showConfirm}
            onKick={async (uid) => { if (curServer) { await api.kickMember(curServer.id, uid); await loadMembers(curServer.id); } setProfileCard(null); }}
            onBan={async (uid, reason) => { if (curServer) { await api.banUser(curServer.id, uid, reason); await loadMembers(curServer.id); } setProfileCard(null); }}
            onAssignRole={async (uid, roleId) => { if (curServer) { await api.assignRole(curServer.id, uid, roleId); await loadMembers(curServer.id); } }}
            onUnassignRole={async (uid, roleId) => { if (curServer) { await api.unassignRole(curServer.id, uid, roleId); await loadMembers(curServer.id); } }}
            onConfigBot={(bot) => { setSelectedBot(bot); setModal('bot-config'); setProfileCard(null); }}
            onMessage={(uid) => { startDm(uid); setProfileCard(null); }}
            customStatuses={customStatuses}
            isGuest={me?.is_guest}
          />
        </Suspense>
      )}

      {/* Context Menu */}
      {ctxMenu && <CtxMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

      {/* Search Panel (right sidebar) */}
      {view === 'server' && !openThread && panel === 'search' && (
          <SearchPanel
            messages={messages}
            dmMsgs={dmMsgs}
            members={members}
            channels={channels}
            curServer={curServer}
            curChannel={curChannel}
            view={view}
            getName={getName}
            onNavigate={(target: any) => {
              if (target?.channel) selectChannel(target.channel);
              if (target?.messageId) {
                // Scroll to and highlight the matched message
                setHighlightedMsg(target.messageId);
                setTimeout(() => {
                  const el = document.querySelector(`[data-msg-id="${target.messageId}"]`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 150);
                setTimeout(() => setHighlightedMsg(null), 3000);
              }
            }}
            onClose={() => setPanel('members')}
          />
      )}

      {/* Thread Panel */}
      {panel === 'thread' && threadParent && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, background: T.sf, borderLeft: `1px solid ${T.bd}`, zIndex: 9999, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${T.bd}` }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.tx }}>Thread</div>
            <button onClick={() => { setPanel('members'); setThreadParent(null); setThreadReplies([]); }} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1 }}>✕</button>
          </div>
          {/* Parent message */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.bd}`, background: T.sf2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Av name={getName(threadParent.author_id)} size={24} />
              <span style={{ fontWeight: 600, fontSize: 13, color: T.tx }}>{getName(threadParent.author_id)}</span>
              <span style={{ fontSize: 10, color: T.mt }}>{new Date(threadParent.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div style={{ fontSize: 13, color: T.tx, lineHeight: 1.5, wordBreak: 'break-word' }}>{threadParent.text || threadParent.content_ciphertext}</div>
          </div>
          {/* Replies */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {threadReplies.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: T.mt, fontSize: 13 }}>No replies yet</div>
            )}
            {threadReplies.map(r => (
              <div key={r.id} style={{ padding: '6px 16px 6px 28px', display: 'flex', gap: 8, borderLeft: `2px solid ${T.bd}`, marginLeft: 16 }}>
                <Av name={getName(r.author_id)} size={20} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: T.tx }}>{getName(r.author_id)}</span>
                    <span style={{ fontSize: 9, color: T.mt }}>{new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ fontSize: 13, color: T.tx, lineHeight: 1.4, wordBreak: 'break-word' }}>{r.text || r.content_ciphertext}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pinned Messages Panel */}
      {showPinned && view === 'server' && curChannel && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 350, background: T.sf, borderLeft: `1px solid ${T.bd}`, zIndex: 9999, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${T.bd}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: T.tx }}>
              <span>📌</span> Pinned Messages
            </div>
            <button onClick={() => setShowPinned(false)} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 18, padding: 4, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {pinnedMsgs.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: T.mt, fontSize: 13 }}>No pinned messages in this channel.</div>
            ) : pinnedMsgs.map((m: any) => (
              <div key={m.id} style={{ padding: '10px 16px', borderBottom: `1px solid ${T.bd}20` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Av name={getName(m.author_id)} size={22} />
                    <span style={{ fontWeight: 600, fontSize: 12, color: T.tx }}>{getName(m.author_id)}</span>
                    <span style={{ fontSize: 10, color: T.mt }}>{new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <button onClick={async () => { if (curServer && curChannel) { await api.unpinMessage(curServer.id, curChannel.id, m.id); setPinnedMsgs(p => p.filter(x => x.id !== m.id)); } }} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 4 }} title="Unpin" onMouseEnter={e => { e.currentTarget.style.color = T.err; }} onMouseLeave={e => { e.currentTarget.style.color = T.mt; }}>Unpin</button>
                </div>
                <div style={{ fontSize: 13, color: T.tx, lineHeight: 1.5, wordBreak: 'break-word', paddingLeft: 28 }}><Markdown text={m.text || m.content || m.content_ciphertext} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Switcher (Ctrl+K) */}
      {quickSwitcher && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh', zIndex: 10002 }} onClick={() => setQuickSwitcher(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '90vw', background: T.sf, borderRadius: 12, border: `1px solid ${T.bd}`, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Where would you like to go?" style={{ width: '100%', padding: '16px 20px', background: 'transparent', border: 'none', color: T.tx, fontSize: 16, outline: 'none', fontFamily: "'DM Sans',sans-serif" }} onKeyDown={e => { if (e.key === 'Escape') setQuickSwitcher(false); }} />
            <div style={{ borderTop: `1px solid ${T.bd}`, maxHeight: 300, overflowY: 'auto', padding: 8 }}>
              {servers.filter(s => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 5).map(s => (
                <div key={s.id} onClick={() => { selectServer(s); setQuickSwitcher(false); setSearchQuery(''); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,170,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 10, color: T.mt, background: T.sf2, padding: '2px 6px', borderRadius: 3 }}>server</span> {s.name}
                </div>
              ))}
              {curServer && channels.filter(c => !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 5).map(ch => (
                <div key={ch.id} onClick={() => { selectChannel(ch); setQuickSwitcher(false); setSearchQuery(''); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,170,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 10, color: T.mt, background: T.sf2, padding: '2px 6px', borderRadius: 3 }}>channel</span> # {ch.name}
                </div>
              ))}
              {dms.filter(d => !searchQuery || d.other_username.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(dm => (
                <div key={dm.id} onClick={() => { selectDm(dm); setQuickSwitcher(false); setSearchQuery(''); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,170,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontSize: 10, color: T.mt, background: T.sf2, padding: '2px 6px', borderRadius: 3 }}>dm</span> {dm.other_username}
                </div>
              ))}
              <div style={{ padding: '6px 12px', fontSize: 10, color: T.mt }}>Ctrl+K to open · Esc to close</div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog dialog={confirmDialog} setDialog={setConfirmDialog} />

      {/* Guest Upgrade Modal */}
      {upgradeFeature && (
        <UpgradeModal
          feature={upgradeFeature}
          onCreateAccount={() => { setUpgradeFeature(null); setModal('upgrade'); }}
          onViewTiers={() => { setUpgradeFeature(null); setModal('upgrade'); }}
          onClose={() => setUpgradeFeature(null)}
        />
      )}

      {/* Progressive Upgrade Flow */}
      {modal === 'upgrade' && (
        <Suspense fallback={null}>
          <UpgradeFlow
            tier={tier}
            me={me}
            onClose={() => setModal(null)}
            onLogout={async () => { setModal(null); await api.logout(); setAuthed(false); }}
            onRefreshMe={() => api.getMe().then((u: any) => setMe(u)).catch(() => {})}
          />
        </Suspense>
      )}

      {/* ── OBS Setup Modal ── */}
      {obsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 15000 }} onClick={() => setObsModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '90vw', background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 18 }}>🔴</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>You're Live — OBS Setup</span>
              <div onClick={() => setObsModal(null)} style={{ marginLeft: 'auto', cursor: 'pointer', color: T.mt, fontSize: 20, lineHeight: 1 }}>×</div>
            </div>
            <p style={{ fontSize: 12, color: T.mt, marginBottom: 18, lineHeight: 1.6 }}>
              In OBS → Settings → Stream, set <strong style={{ color: T.tx }}>Service</strong> to "Custom…" then paste the values below.
            </p>
            {/* RTMP URL */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Server (RTMP URL)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={obsModal.rtmpUrl} style={{ flex: 1, padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                <div onClick={() => { navigator.clipboard?.writeText(obsModal.rtmpUrl); setToast('Copied!'); setTimeout(() => setToast(''), 1500); }} style={{ padding: '8px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, color: T.mt, whiteSpace: 'nowrap' }}>Copy</div>
              </div>
            </div>
            {/* Stream Key */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Stream Key</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={obsModal.streamKey} type="password" style={{ flex: 1, padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, fontFamily: 'monospace', outline: 'none' }} />
                <div onClick={() => { navigator.clipboard?.writeText(obsModal.streamKey); setToast('Copied!'); setTimeout(() => setToast(''), 1500); }} style={{ padding: '8px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, cursor: 'pointer', fontSize: 12, color: T.mt, whiteSpace: 'nowrap' }}>Copy</div>
              </div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 6 }}>Keep this secret — anyone with it can stream to your channel.</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div onClick={() => setObsModal(null)} style={{ flex: 1, padding: '10px 0', textAlign: 'center', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: T.sf2, color: T.tx, border: `1px solid ${T.bd}` }}>Done</div>
              <div onClick={stopGoLive} style={{ flex: 1, padding: '10px 0', textAlign: 'center', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: 'rgba(255,71,87,0.15)', color: T.err, border: '1px solid rgba(255,71,87,0.35)' }}>Stop Streaming</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Watch Stream Modal ── */}
      {watchModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 15000 }} onClick={() => setWatchModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 780, maxWidth: '95vw', background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${T.bd}` }}>
              <span style={{ background: '#ff4757', color: '#fff', fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.5px' }}>● LIVE</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>#{watchModal.name}</span>
              {(streamStatus[watchModal.channelId]?.viewerCount ?? 0) > 0 && (
                <span style={{ fontSize: 12, color: T.mt }}>· {streamStatus[watchModal.channelId].viewerCount} watching</span>
              )}
              <div onClick={() => setWatchModal(null)} style={{ marginLeft: 'auto', cursor: 'pointer', color: T.mt, fontSize: 22, lineHeight: 1 }}>×</div>
            </div>
            {/* Video player */}
            <div style={{ background: '#000', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video
                src={watchModal.viewerUrl}
                controls
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', display: 'block' }}
                onError={() => {
                  /* HLS fallback notice handled below */
                }}
              />
            </div>
            {/* Footer */}
            <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, borderTop: `1px solid ${T.bd}` }}>
              <span style={{ fontSize: 11, color: T.mt, flex: 1 }}>If the player doesn't load, open the stream URL directly or use VLC.</span>
              <div onClick={() => { navigator.clipboard?.writeText(watchModal.viewerUrl); setToast('Stream URL copied'); setTimeout(() => setToast(''), 2000); }} style={{ padding: '6px 12px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, color: T.mt }}>Copy URL</div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toast.startsWith('Send failed') ? T.err : T.ac, color: toast.startsWith('Send failed') ? '#fff' : '#000', padding: '10px 24px', borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 20000, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</div>
      )}

      {/* CSS for hover actions */}
      <style>{`.msg-row:hover .msg-actions, div:hover > .msg-actions { display: flex !important; }`}</style>

      <BugReportButton />
    </div>
  );
}
