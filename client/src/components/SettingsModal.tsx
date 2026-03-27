/**
 * SettingsModal — User settings panel.
 * Categories: Account, Privacy, Appearance, Notifications, Security, Advanced.
 * Sub-tabs: My Account, Profile, Privacy & Safety, Themes & Layout, Accessibility,
 *   Notifications, Account Security, Active Sessions, Voice & Video, Keybinds,
 *   Network, Advanced, Discover, About, + Staff tabs for admin/dev.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { T, ta, getInp, FONT_SIZE_MAP } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';
import i18n, { setLanguage } from '../i18n/i18n';
import { useTimezone, detectedTimezone } from '../hooks/TimezoneContext';
import { voice } from '../hooks/useVoice';
import { previewSound, SOUND_OPTIONS } from '../utils/sounds';
import { TIER_META } from '../utils/tiers';
import { OfflineContacts } from './OfflineContacts';
import type { Tier } from '../utils/tiers';
import { Av } from './Av';
import { Modal } from './Modal';
import { AvatarCreator } from './AvatarCreator';
import { AdminDashboard } from './AdminDashboard';
import { DangerConfirmModal } from './DangerConfirmModal';
import KeybindSettings from './settings/KeybindSettings';

// ── Lazy-loaded settings tabs ─────────────────────────────
const SettingsAppearance    = lazy(() => import('./settings/SettingsAppearance'));
const SettingsVoice         = lazy(() => import('./settings/SettingsVoice'));
const SettingsPrivacy       = lazy(() => import('./settings/SettingsPrivacy'));
const SettingsAccount       = lazy(() => import('./settings/SettingsAccount'));
const SettingsNotifications = lazy(() => import('./settings/SettingsNotifications'));
const SettingsAdvanced         = lazy(() => import('./settings/SettingsAdvanced'));
const SettingsAccountSecurity  = lazy(() => import('./settings/SettingsAccountSecurity'));

// ─── Types ────────────────────────────────────────────────

interface UserSettings {
  theme?: string;
  font_size?: string;
  compact_mode?: boolean;
  show_embeds?: boolean;
  dm_privacy?: string;
  friend_request_privacy?: string;
  notification_level?: string;
  show_shared_servers?: boolean;
  hide_online_status?: boolean;
  hide_activity?: boolean;
  block_stranger_dms?: boolean;
  require_mutual_friends?: boolean;
  locale?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface SettingsModalProps {
  onClose: () => void;
  onThemeChange?: (theme: string) => void;
  showConfirm: (title: string, message: string, danger?: boolean) => Promise<boolean>;
  setUserMap?: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  curServer?: { id: string } | null;
  onLogout?: () => void;
  onUpgrade?: () => void;
  /** Full response from GET /api/v1/platform/me — null until loaded. */
  platformUser?: { account_tier?: string; platform_role?: string | null; badge_type?: string | null; permissions?: string[] } | null;
  /** Current dev-tier impersonation (null = real tier). */
  devTierOverride?: Tier | null;
  /** Called when the dev tier dropdown changes. Pass null to clear the override. */
  onSetDevTierOverride?: (t: Tier | null) => void;
  onStatusChange?: (status: string) => void;
}

// ─── Module-level constants ───────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || (window.location.origin + '/api/v1');

const notifSound = {
  _ctx: null as AudioContext | null,
  _getCtx() {
    if (!this._ctx) this._ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    return this._ctx!;
  },
  play(type: string) {
    // Global gates: d_sounds (new key) or legacy d_mute_sounds
    if (localStorage.getItem('d_sounds') === 'false') return;
    if (localStorage.getItem('d_mute_sounds') === 'true') return;
    // Per-type gates
    if (type === 'send'    && localStorage.getItem('d_sound_send')          === 'false') return;
    if (type === 'receive' && localStorage.getItem('d_sound_receive')        === 'false') return;
    if (type === 'message' && localStorage.getItem('d_sound_receive')        === 'false') return;
    if ((type === 'join' || type === 'leave') && localStorage.getItem('d_sound_voice') === 'false') return;
    if (type === 'mention' && localStorage.getItem('d_notif_sound_mention')  === 'false') return;
    try {
      const ctx = this._getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      const vol = parseFloat(localStorage.getItem('d_notif_vol') || '0.3');
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      if (type === 'send') {
        // Subtle upward blip for outgoing messages
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'message' || type === 'receive') {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
      } else if (type === 'mention') {
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
      } else if (type === 'join') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
      } else if (type === 'leave') {
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
      } else if (type === 'call') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(550, ctx.currentTime + 0.2);
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.6);
      }
    } catch {}
  },
};

// ─── Reauth Modal ─────────────────────────────────────────
// Prompts for current password before dangerous operations.
// Returns a single-use reauth_token valid for 5 minutes.

interface ReauthModalProps {
  onSuccess: (reauthToken: string) => void;
  onCancel: () => void;
}

function ReauthModal({ onSuccess, onCancel }: ReauthModalProps) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    if (!pw.trim()) { setErr('Please enter your password.'); return; }
    setLoading(true);
    setErr('');
    try {
      const res = await api.verifyPassword(pw);
      onSuccess(res.reauth_token);
    } catch (e: any) {
      setErr(e.message || 'Incorrect password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--border-radius)', padding: 24, width: 380, maxWidth: '90vw' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 4 }}>Confirm Your Identity</div>
        <div style={{ fontSize: 12, color: T.mt, marginBottom: 16, lineHeight: 1.5 }}>
          Enter your password to continue. This is required for security-sensitive actions.
        </div>
        <input
          type="password"
          value={pw}
          onChange={e => { setPw(e.target.value); setErr(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }}
          placeholder="Your password"
          autoFocus
          autoComplete="current-password" name="password" aria-label="Password"
          style={{ width: '100%', padding: '10px 12px', background: T.bg, border: `1px solid ${err ? 'rgba(255,71,87,0.5)' : T.bd}`, borderRadius: 6, color: T.tx, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 8 }}
        />
        {err && <div style={{ fontSize: 11, color: T.err, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="pill-btn" style={{ background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, padding: '8px 16px', fontSize: 12, fontWeight: 600 }}>Cancel</button>
          <button onClick={handleVerify} disabled={loading} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '8px 16px', fontSize: 12, fontWeight: 700 }}>{loading ? 'Verifying...' : 'Continue'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

interface DeviceSelectorProps {
  label: string;
  kind: MediaDeviceKind;
  storageKey: string;
  onChange: (deviceId: string) => void;
}

function DeviceSelector({ label, kind, storageKey, onChange }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(localStorage.getItem(storageKey) || 'default');
  useEffect(() => {
    const enumerate = () => {
      navigator.mediaDevices?.enumerateDevices().then(all => {
        const filtered = all.filter(d => d.kind === kind);
        // If labels are empty, request permission to get real names
        if (filtered.length > 0 && !filtered[0].label && kind === 'audioinput') {
          navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
            s.getTracks().forEach(t => t.stop());
            navigator.mediaDevices.enumerateDevices().then(all2 => setDevices(all2.filter(d => d.kind === kind))).catch(() => {});
          }).catch(() => {});
        } else {
          setDevices(filtered);
        }
      }).catch(() => {});
    };
    enumerate();
    const onDeviceChange = () => enumerate();
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    return () => { navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange); };
  }, [kind]);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>{label}</div>
      <select value={selected} onChange={e => { setSelected(e.target.value); localStorage.setItem(storageKey, e.target.value); onChange(e.target.value); }}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.bg, color: T.tx, fontSize: 12, cursor: 'pointer', outline: 'none' }}>
        <option value="default">Default Device</option>
        {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `${kind} ${d.deviceId.slice(0, 8)}`}</option>)}
      </select>
    </div>
  );
}

// ─── Audio Test Buttons ──────────────────────────────────────

function TestMicrophoneButton() {
  const [state, setState] = useState<'idle' | 'recording' | 'playing'>('idle');
  const [level, setLevel] = useState(0);
  const recRef = React.useRef<{ stream: MediaStream; chunks: Blob[]; recorder: MediaRecorder } | null>(null);
  const animRef = React.useRef(0);

  const startRecording = async () => {
    try {
      const deviceId = localStorage.getItem('d_audioIn');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}) },
      });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(animRef.current);
        setLevel(0);
        if (chunks.length === 0) { setState('idle'); return; }
        const blob = new Blob(chunks, { type: recorder.mimeType });
        playBack(blob);
      };
      // Level meter via AnalyserNode
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setLevel(avg / 128);
        animRef.current = requestAnimationFrame(tick);
      };
      tick();

      recRef.current = { stream, chunks, recorder };
      recorder.start();
      setState('recording');
      setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 3000);
    } catch {
      setState('idle');
    }
  };

  const playBack = (blob: Blob) => {
    setState('playing');
    const audio = new Audio(URL.createObjectURL(blob));
    const outDev = localStorage.getItem('d_audioOut');
    if (outDev && outDev !== 'default' && (audio as any).setSinkId) {
      (audio as any).setSinkId(outDev).catch(() => {});
    }
    audio.onended = () => { setState('idle'); URL.revokeObjectURL(audio.src); };
    audio.onerror = () => setState('idle');
    audio.play().catch(() => setState('idle'));
  };

  const stop = () => {
    if (recRef.current?.recorder?.state === 'recording') recRef.current.recorder.stop();
    setState('idle');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <button onClick={state === 'idle' ? startRecording : stop}
        style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${T.bd}`, background: state === 'recording' ? 'rgba(255,71,87,0.15)' : state === 'playing' ? 'rgba(0,212,170,0.1)' : 'transparent', color: state === 'recording' ? '#ff4757' : T.ac, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {state === 'idle' ? 'Test Mic' : state === 'recording' ? 'Recording...' : 'Playing back...'}
      </button>
      {state === 'recording' && (
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.bd, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: `linear-gradient(90deg, ${T.ac}, #00ff88)`, width: `${Math.min(level * 100, 100)}%`, transition: 'width 0.05s' }} />
        </div>
      )}
      {state === 'playing' && <span style={{ fontSize: 10, color: T.mt }}>Playing through selected output...</span>}
    </div>
  );
}

function TestSpeakerButton() {
  const [playing, setPlaying] = useState(false);

  const playTone = () => {
    if (playing) return;
    setPlaying(true);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.5);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Route to selected output if setSinkId is available
    const outDev = localStorage.getItem('d_audioOut');
    if (outDev && outDev !== 'default' && (ctx as any).setSinkId) {
      (ctx as any).setSinkId(outDev).catch(() => {});
    }
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
    osc.onended = () => { ctx.close(); setPlaying(false); };
  };

  return (
    <button onClick={playTone} disabled={playing}
      style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${T.bd}`, background: playing ? 'rgba(0,212,170,0.1)' : 'transparent', color: T.ac, fontSize: 11, fontWeight: 600, cursor: playing ? 'default' : 'pointer', opacity: playing ? 0.6 : 1, whiteSpace: 'nowrap', marginTop: 8 }}>
      {playing ? 'Playing...' : 'Test Speaker'}
    </button>
  );
}

interface AudioToggleProps {
  label: string;
  storageKey: string;
  defaultVal: boolean;
  desc?: string;
  onChange: (val: boolean) => void;
}

function AudioToggle({ label, storageKey, defaultVal, desc, onChange }: AudioToggleProps) {
  const [on, setOn] = useState(() => { const v = localStorage.getItem(storageKey); return v !== null ? v === 'true' : defaultVal; });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${ta(T.bd,'22')}` }}>
      <div>
        <div style={{ fontSize: 12, color: T.tx, fontWeight: 500 }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: T.mt }}>{desc}</div>}
      </div>
      <div onClick={() => { const nv = !on; setOn(nv); localStorage.setItem(storageKey, String(nv)); onChange(nv); }}
        style={{ width: 36, height: 20, borderRadius: 10, background: on ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
        <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: on ? 18 : 2, transition: 'left 0.2s' }} />
      </div>
    </div>
  );
}

function RotateEncryptionKey() {
  const [showModal, setShowModal] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [showReauth, setShowReauth] = useState(false);
  const [reauthToken, setReauthToken] = useState<string | null>(null);

  const startRotate = () => {
    if (reauthToken) { setShowModal(true); } else { setShowReauth(true); }
  };

  const handleReauth = (token: string) => {
    setReauthToken(token);
    setShowReauth(false);
    setShowModal(true);
  };

  const handleRotate = async () => {
    setRotating(true);
    try {
      const { generateIdentity, generateKeyPackages, isMlsAvailable } = await import('../crypto/mls');
      if (isMlsAvailable() && api.userId && api.username) {
        await generateIdentity(api.userId, api.username);
        const packages = await generateKeyPackages(50);
        const b64Packages = packages.map((p: Uint8Array) => btoa(String.fromCharCode(...p)));
        await api.uploadKeyPackages(b64Packages);
      }
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('d_msg_') || k.startsWith('d_cache_') || k.startsWith('d_channel_') || k.startsWith('messages_'))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name && (db.name.includes('crypto') || db.name.includes('mls') || db.name.includes('key'))) {
            indexedDB.deleteDatabase(db.name);
          }
        }
      } catch { /* indexedDB.databases() not supported in all browsers */ }
      setShowModal(false);
      alert('Encryption key rotated. All previous messages are now permanently unreadable. The page will reload.');
      window.location.reload();
    } catch (e: any) {
      alert('Key rotation failed: ' + (e.message || 'Unknown error'));
    } finally {
      setRotating(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.mt, marginBottom: 8, lineHeight: 1.6 }}>
          Generate a new encryption identity. <strong style={{ color: T.err }}>All previous messages will become permanently unreadable</strong> — the server stores only ciphertext encrypted with your current key, and rotating destroys the old key material.
        </div>
        <button onClick={startRotate} className="pill-btn" style={{ background: 'rgba(255,71,87,0.12)', color: T.err, border: '1px solid rgba(255,71,87,0.3)', padding: '10px 22px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <I.Lock s={10} /> Rotate Encryption Key
        </button>
      </div>
      {showReauth && <ReauthModal onSuccess={handleReauth} onCancel={() => setShowReauth(false)} />}
      {showModal && (
        <DangerConfirmModal
          title="Rotate Encryption Key"
          warningText="This will generate a new encryption identity and destroy your current key material. All previous messages become permanently unreadable. Server-side ciphertext cannot be decrypted with the new key. Local message cache will be cleared. This action cannot be undone."
          confirmPhrase="ROTATE MY KEY"
          confirmLabel="Rotate Key"
          loadingLabel="Rotating..."
          loading={rotating}
          onConfirm={handleRotate}
          onCancel={() => { setShowModal(false); setReauthToken(null); }}
        />
      )}
    </>
  );
}

function ClearLocalCache() {
  const [showModal, setShowModal] = useState(false);

  const handleClear = () => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('d_msg_') || k.startsWith('d_cache_') || k.startsWith('d_channel_') || k.startsWith('messages_'))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    setShowModal(false);
    alert(`Cleared ${keysToRemove.length} cached entries. Your encryption keys are unchanged.`);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6 }}>
            Clear locally cached messages without affecting your encryption keys. Messages will be re-fetched from the server on next load.
          </div>
        </div>
        <button onClick={() => setShowModal(true)} className="pill-btn" style={{ background: 'rgba(255,165,0,0.12)', color: '#ffa500', border: '1px solid rgba(255,165,0,0.3)', padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 12 }}>
          Clear Cache
        </button>
      </div>
      {showModal && (
        <DangerConfirmModal
          title="Clear Local Cache"
          warningText="This will delete all locally cached messages. Your encryption keys are not affected. Messages will be re-fetched from the server on next load."
          confirmPhrase="CLEAR ALL"
          confirmLabel="Clear Cache"
          onConfirm={handleClear}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function DeleteAccount() {
  const [showReauth, setShowReauth] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [reauthToken, setReauthToken] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const startDelete = () => { setShowReauth(true); };

  const handleReauth = (token: string) => {
    setReauthToken(token);
    setShowReauth(false);
    setShowModal(true);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteAccount(reauthToken || undefined);
      localStorage.clear();
      window.location.reload();
    } catch (e: any) {
      alert('Account deletion failed: ' + (e.message || 'error'));
      setDeleting(false);
    }
  };

  return (
    <>
      <button onClick={startDelete} className="pill-btn" style={{ background: 'rgba(255,71,87,0.12)', color: T.err, border: '1px solid rgba(255,71,87,0.3)', padding: '10px 22px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><I.Lock s={10} /> Delete My Account</button>
      {showReauth && <ReauthModal onSuccess={handleReauth} onCancel={() => setShowReauth(false)} />}
      {showModal && (
        <DangerConfirmModal
          title="Delete Account"
          warningText="This will PERMANENTLY delete your account, all servers you own, all messages, DMs, and friend connections. This action CANNOT be undone."
          confirmPhrase="DELETE MY ACCOUNT"
          confirmLabel="Permanently Delete Account"
          loadingLabel="Deleting..."
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => { setShowModal(false); setReauthToken(null); }}
        />
      )}
    </>
  );
}

interface DevToolsProps {
  curServer?: { id: string } | null;
}

function DevTools({ curServer }: DevToolsProps) {
  const [endpoint, setEndpoint] = useState('/health');
  const [method, setMethod] = useState('GET');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<{ status: number | string; ms: string; data: unknown } | null>(null);
  const [loading, setLoading] = useState(false);
  const [wsLog, setWsLog] = useState<{ dir: string; data: string; t: string }[]>([]);

  const runRequest = async () => {
    setLoading(true); setResult(null);
    try {
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.token } as HeadersInit };
      if (method !== 'GET' && body.trim()) opts.body = body;
      const start = performance.now();
      const res = await fetch(API_BASE + endpoint, opts);
      const ms = (performance.now() - start).toFixed(1);
      const text = await res.text();
      let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = text; }
      setResult({ status: res.status, ms, data: parsed });
    } catch (e: any) { setResult({ status: 'ERR', ms: '0', data: e.message }); }
    setLoading(false);
  };

  useEffect(() => {
    if (localStorage.getItem('d_verbose_log') !== 'true') return;
    const ws = (api as any).ws;
    const origSend = ws?.send?.bind(ws);
    if (ws && origSend) {
      ws._devOrigSend = origSend;
      ws.send = (data: string) => {
        setWsLog(p => [...p.slice(-19), { dir: '→', data: data.slice(0, 120), t: new Date().toLocaleTimeString() }]);
        origSend(data);
      };
    }
    return () => { if (ws?._devOrigSend) ws.send = ws._devOrigSend; };
  }, []);

  return (<>
    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
      <select value={method} onChange={e => setMethod(e.target.value)} style={{ background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.ac, fontSize: 11, padding: '4px 6px', fontFamily: 'monospace' }}>
        {['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="/api/v1/..." style={{ flex: 1, background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 11, padding: '4px 8px', fontFamily: 'monospace' }} />
      <button onClick={runRequest} disabled={loading} style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 4, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{loading ? '...' : 'Send'}</button>
    </div>
    {method !== 'GET' && (
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder='{"key":"value"}' rows={2} style={{ width: '100%', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.tx, fontSize: 10, padding: 6, fontFamily: 'monospace', resize: 'vertical', marginBottom: 6, boxSizing: 'border-box' }} />
    )}
    {result && (
      <div style={{ background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, padding: 8, maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 10 }}>
          <span style={{ color: (result.status as number) < 300 ? T.ac : (result.status as number) < 500 ? T.warn : T.err, fontWeight: 700 }}>{result.status}</span>
          <span style={{ color: T.mt }}>{result.ms}ms</span>
        </div>
        <pre style={{ fontSize: 10, color: T.tx, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}</pre>
      </div>
    )}
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
      {['/health', '/api/v1/users/@me', '/api/v1/users/@me/servers', '/api/v1/bots/personas'].map(ep => (
        <button key={ep} onClick={() => { setEndpoint(ep); setMethod('GET'); }} style={{ background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 4, color: T.mt, fontSize: 9, padding: '2px 6px', cursor: 'pointer', fontFamily: 'monospace' }}>{ep.replace('/api/v1', '')}</button>
      ))}
    </div>
    <div style={{ fontSize: 10, color: T.mt, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
      <div>User ID: <span style={{ color: T.ac, fontFamily: 'monospace' }}>{api.userId?.slice(0, 8)}</span></div>
      <div>WS: <span style={{ color: (api as any).ws?.readyState === 1 ? T.ac : T.err }}>{(api as any).ws?.readyState === 1 ? 'Connected' : 'Disconnected'}</span></div>
      <div>Token: <span style={{ color: T.ac, fontFamily: 'monospace' }}>{api.token?.slice(0, 12)}...</span></div>
      <div>Server: <span style={{ color: T.ac, fontFamily: 'monospace' }}>{curServer?.id?.slice(0, 8) || '—'}</span></div>
    </div>
    {wsLog.length > 0 && (
      <div style={{ marginTop: 8, maxHeight: 100, overflowY: 'auto', background: T.sf2, borderRadius: 4, padding: 4, border: `1px solid ${T.bd}` }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: T.mt, marginBottom: 2 }}>WebSocket Log</div>
        {wsLog.map((l, i) => (
          <div key={i} style={{ fontSize: 9, fontFamily: 'monospace', color: l.dir === '→' ? T.ac : '#faa61a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {l.t} {l.dir} {l.data}
          </div>
        ))}
      </div>
    )}
  </>);
}

// ─── Notification sub-components ─────────────────────────

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      role="switch"
      aria-checked={on}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } }}
      style={{
        width: 36, height: 20, borderRadius: 10, flexShrink: 0,
        background: on ? T.ac : T.bd,
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative', transition: 'background .2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff',
        position: 'absolute', top: 2, left: on ? 18 : 2,
        transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

function NRow({ label, sub, on, onToggle, disabled }: { label: string; sub: string; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 6 }}>
      <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: disabled ? T.mt : T.tx }}>{label}</div>
        <div style={{ fontSize: 11, color: T.mt }}>{sub}</div>
      </div>
      <Toggle on={on} onToggle={onToggle} disabled={disabled} />
    </div>
  );
}

// ─── Change Email ────────────────────────────────────────

// ─── Security Status ──────────────────────────────────────

interface SecurityStatusProps {
  platformUser?: SettingsModalProps['platformUser'];
  onSetupStep?: (step: string) => void;
  me?: any;
}

function SecurityStatus({ platformUser, onSetupStep, me }: SecurityStatusProps) {
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (!me) return <div style={{ padding: 12, color: T.mt, fontSize: 12 }}>Loading security status...</div>;

  const isGuest = me.is_guest;
  const emailVerified = !!me.email_verified;
  const totpEnabled = !!me.totp_enabled;
  const hasRecoveryKey = !!me.has_recovery_key;
  const hasEmail = !!me.email;
  const tierKey = platformUser?.account_tier ?? me.account_tier ?? 'guest';
  const tierMeta = (TIER_META as any)[tierKey];

  // Security checks (guests get 0)
  const checks = isGuest ? [] : [
    { label: 'Email Verified', ok: emailVerified, action: 'verify-email', actionLabel: 'Verify' },
    { label: '2FA Enabled', ok: totpEnabled, action: 'setup-2fa', actionLabel: 'Setup' },
    { label: 'Recovery Key', ok: hasRecoveryKey, action: 'recovery-key', actionLabel: 'Generate' },
  ];
  const passed = checks.filter(c => c.ok).length;
  const total = checks.length;
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;
  const allComplete = total > 0 && passed === total;

  // Score ring color
  const scoreColor = score >= 100 ? T.ac : score >= 66 ? '#ffa502' : T.err;

  // Guest account view
  if (isGuest) {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Security Status</div>
        <div style={{
          background: `linear-gradient(135deg, #ffa50210, ${T.sf2})`,
          border: '1px solid #ffa50233', borderRadius: 'var(--border-radius)', padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 20,
              background: '#ffa50220', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 20,
            }}><I.User s={20} /></div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#ffa502' }}>Guest Account</div>
              <div style={{ fontSize: 12, color: T.mt }}>Limited features — create an account to unlock security settings</div>
            </div>
          </div>
          <div style={{
            display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14,
          }}>
            {['No email protection', 'No 2FA', 'No recovery key', 'Data not preserved'].map(item => (
              <div key={item} style={{
                fontSize: 11, color: 'rgba(255,71,87,0.7)', display: 'flex',
                alignItems: 'center', gap: 4, padding: '3px 8px',
                background: 'rgba(255,71,87,0.06)', borderRadius: 6,
              }}>
                <span style={{ display: 'flex' }}><I.X s={13} /></span> {item}
              </div>
            ))}
          </div>
          <button
            onClick={() => onUpgrade ? onUpgrade() : setShowUpgrade(true)}
            style={{
              width: '100%', padding: '10px 0',
              background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
              border: 'none', borderRadius: 'var(--radius-md)', color: '#000',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Upgrade to Full Account
          </button>
        </div>
        {showUpgrade && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
          }} onClick={e => { if (e.target === e.currentTarget) setShowUpgrade(false); }}>
            <div onClick={e => e.stopPropagation()} style={{
              width: 440, maxWidth: '92vw', background: T.sf, borderRadius: 14,
              border: `1px solid ${T.bd}`, padding: 24,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.tx, marginBottom: 16 }}>
                Create Your Account
              </div>
              <GuestUpgradeForm username={me.username} onClose={() => setShowUpgrade(false)} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Security Status</div>
      <div style={{
        background: T.sf2, borderRadius: 'var(--border-radius)', padding: 16,
        border: `1px solid ${allComplete ? ta(T.ac,'33') : T.bd}`,
      }}>
        {/* Score + tier badge row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          {/* Score ring */}
          <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
            <svg width="52" height="52" viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="22" fill="none" stroke={T.bd} strokeWidth="4" />
              <circle cx="26" cy="26" r="22" fill="none" stroke={scoreColor} strokeWidth="4"
                strokeDasharray={`${(score / 100) * 138.2} 138.2`}
                strokeLinecap="round" transform="rotate(-90 26 26)" />
            </svg>
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14, fontWeight: 800, color: scoreColor,
            }}>{score}%</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 14, fontWeight: 700,
              color: allComplete ? T.ac : '#ffa502',
            }}>
              {allComplete ? 'Account Fully Secured' : 'Account Security Incomplete'}
            </div>
            <div style={{ fontSize: 12, color: T.mt, marginTop: 2 }}>
              {passed}/{total} security checks passed
            </div>
          </div>
          {/* Tier badge */}
          {tierMeta && (
            <div style={{
              padding: '4px 12px', borderRadius: 20,
              background: `${tierMeta.color}18`,
              border: `1px solid ${tierMeta.color}33`,
              fontSize: 11, fontWeight: 700, color: tierMeta.color,
              whiteSpace: 'nowrap',
            }}>
              {tierMeta.icon} {tierMeta.label}
            </div>
          )}
        </div>

        {/* Check rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {checks.map(c => (
            <div key={c.label} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 'var(--radius-md)',
              background: c.ok ? `${ta(T.ac,'08')}` : 'rgba(255,165,0,0.06)',
              border: `1px solid ${c.ok ? ta(T.ac,'22') : '#ffa50222'}`,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 11,
                background: c.ok ? `${ta(T.ac,'20')}` : '#ffa50220',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                color: c.ok ? T.ac : '#ffa502',
              }}>
                {c.ok ? <I.Check s={12} /> : <I.AlertTriangle s={12} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{c.label}</div>
              </div>
              {c.ok ? (
                <span style={{ fontSize: 11, color: T.ac, fontWeight: 600 }}>Enabled</span>
              ) : (
                <button
                  onClick={() => onSetupStep?.(c.action)}
                  className="pill-btn"
                  style={{
                    background: '#ffa50218', color: '#ffa502',
                    border: '1px solid #ffa50233', padding: '4px 12px',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {c.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Complete Setup CTA */}
        {!allComplete && (
          <button
            onClick={() => {
              const first = checks.find(c => !c.ok);
              if (first) onSetupStep?.(first.action);
            }}
            style={{
              width: '100%', marginTop: 12, padding: '10px 0',
              background: `linear-gradient(135deg, #ffa502, #e67e22)`,
              border: 'none', borderRadius: 'var(--radius-md)', color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Complete Setup
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Guest Upgrade Form ──────────────────────────────────

function GuestUpgradeForm({ username, onClose }: { username: string; onClose: () => void }) {
  const [newUsername, setNewUsername] = useState(username || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const handleUpgrade = async () => {
    setErr('');
    if (!newUsername.trim()) { setErr('Username is required'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setErr('Passwords do not match'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${window.location.origin}/api/v1/auth/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.token}` },
        body: JSON.stringify({ username: newUsername.trim(), password, email: email.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(typeof data.error === 'string' ? data.error : data.error?.message || data.message || 'Upgrade failed');
        return;
      }
      const data = await res.json();
      if (data.access_token) {
        api.token = data.access_token;
        localStorage.setItem('d_token', data.access_token);
      }
      onClose();
      window.location.reload();
    } catch (e: any) {
      setErr(e.message || 'Network error');
    } finally { setSaving(false); }
  };

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: T.bg,
    border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'var(--font-primary)', marginBottom: 10,
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: T.mt, marginBottom: 16, lineHeight: 1.6 }}>
        Upgrade your guest account to keep your messages and unlock all features.
      </div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Username</label>
      <input value={newUsername} onChange={e => setNewUsername(e.target.value)} style={inp} placeholder="Choose a username" autoFocus />
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Email <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></label>
      <input value={email} onChange={e => setEmail(e.target.value)} type="email" style={inp} placeholder="you@example.com" />
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Password</label>
      <input value={password} onChange={e => setPassword(e.target.value)} type="password" style={inp} placeholder="Min 8 characters" />
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Confirm Password</label>
      <input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" style={inp} placeholder="Re-enter password"
        onKeyDown={e => { if (e.key === 'Enter') handleUpgrade(); }}
      />
      {err && <div style={{ color: T.err, fontSize: 12, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button onClick={onClose} style={{
          flex: 1, padding: '10px 0', background: T.sf2, color: T.mt,
          border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', fontSize: 13, cursor: 'pointer',
        }}>Cancel</button>
        <button onClick={handleUpgrade} disabled={saving} style={{
          flex: 1, padding: '10px 0',
          background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
          border: 'none', borderRadius: 'var(--radius-md)', color: '#000',
          fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Creating...' : 'Create Account'}</button>
      </div>
    </div>
  );
}

function ChangeEmail() {
  const [editing, setEditing] = useState(false);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showReauth, setShowReauth] = useState(false);
  const [reauthToken, setReauthToken] = useState<string | null>(null);

  useEffect(() => {
    api.getMe().then((u: any) => { if (u?.email) setCurrentEmail(u.email); });
  }, []);

  const startEdit = () => {
    if (reauthToken) { setEditing(true); setMsg(''); setErr(''); }
    else { setShowReauth(true); }
  };

  const handleReauth = (token: string) => {
    setReauthToken(token);
    setShowReauth(false);
    setEditing(true); setMsg(''); setErr('');
  };

  const handleSubmit = async () => {
    setErr(''); setMsg('');
    if (!newEmail.includes('@') || !newEmail.includes('.')) { setErr('Invalid email address'); return; }
    if (!password) { setErr('Password is required'); return; }
    setSaving(true);
    try {
      const res = await api.changeEmail(newEmail, password, reauthToken || undefined);
      setMsg(res.message || 'Email updated. Your email is now unverified until you confirm the new address.');
      setCurrentEmail(newEmail);
      setNewEmail(''); setPassword(''); setEditing(false); setReauthToken(null);
    } catch (e: any) {
      setErr(e.message || 'Failed to change email');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>Email Address <I.Lock s={10} /></div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>{currentEmail || 'No email set'}</div>
        </div>
        {!editing && (
          <button onClick={startEdit} className="pill-btn" style={{ background: T.sf, color: T.mt, border: `1px solid ${T.bd}`, padding: '6px 14px', fontSize: 11 }}>Change</button>
        )}
      </div>
      {showReauth && <ReauthModal onSuccess={handleReauth} onCancel={() => setShowReauth(false)} />}
      {editing && (
        <div style={{ marginTop: 10 }}>
          <input
            type="email" placeholder="New email address" value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, marginBottom: 6, outline: 'none', boxSizing: 'border-box' }}
          />
          <input
            type="password" placeholder="Confirm your password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, marginBottom: 8, outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSubmit} disabled={saving} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '6px 14px', fontSize: 11, fontWeight: 700 }}>{saving ? 'Saving...' : 'Update Email'}</button>
            <button onClick={() => { setEditing(false); setNewEmail(''); setPassword(''); setErr(''); setReauthToken(null); }} className="pill-btn" style={{ background: T.sf, color: T.mt, border: `1px solid ${T.bd}`, padding: '6px 14px', fontSize: 11 }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 11, color: T.ac, padding: '6px 10px', background: 'rgba(0,212,170,0.08)', borderRadius: 6 }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, fontSize: 11, color: T.err, padding: '6px 10px', background: 'rgba(255,71,87,0.08)', borderRadius: 6 }}>{err}</div>}
    </div>
  );
}

// ─── Change Password ─────────────────────────────────────

function ChangePassword() {
  const [editing, setEditing] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showReauth, setShowReauth] = useState(false);
  const [reauthToken, setReauthToken] = useState<string | null>(null);

  const startEdit = () => {
    if (reauthToken) { setEditing(true); setMsg(''); setErr(''); }
    else { setShowReauth(true); }
  };

  const handleReauth = (token: string) => {
    setReauthToken(token);
    setShowReauth(false);
    setEditing(true); setMsg(''); setErr('');
  };

  const handleSubmit = async () => {
    setErr(''); setMsg('');
    if (!currentPw) { setErr('Current password is required'); return; }
    if (newPw.length < 12) { setErr('New password must be at least 12 characters'); return; }
    setSaving(true);
    try {
      const res = await api.changePassword(currentPw, newPw, reauthToken || undefined);
      // Store new tokens if returned
      if (res.access_token) {
        (api as any).token = res.access_token;
        if (res.refresh_token) (api as any).refreshToken = res.refresh_token;
      }
      setMsg('Password updated successfully. All other sessions have been revoked.');
      setCurrentPw(''); setNewPw(''); setEditing(false); setReauthToken(null);
    } catch (e: any) {
      setErr(e.message || 'Failed to change password');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>Password <I.Lock s={10} /></div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Update your password regularly for better security</div>
        </div>
        {!editing && (
          <button onClick={startEdit} className="pill-btn" style={{ background: T.sf, color: T.mt, border: `1px solid ${T.bd}`, padding: '6px 14px', fontSize: 11 }}>Change</button>
        )}
      </div>
      {showReauth && <ReauthModal onSuccess={handleReauth} onCancel={() => setShowReauth(false)} />}
      {editing && (
        <div style={{ marginTop: 10 }}>
          <input
            type="password" placeholder="Current password" value={currentPw}
            onChange={e => setCurrentPw(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, marginBottom: 6, outline: 'none', boxSizing: 'border-box' }}
            autoFocus autoComplete="current-password" name="current-password" aria-label="Current password" />
          <input
            type="password" placeholder="New password (min 12 characters)" value={newPw}
            onChange={e => setNewPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, marginBottom: 8, outline: 'none', boxSizing: 'border-box' }}
            autoComplete="new-password" name="new-password" aria-label="New password" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSubmit} disabled={saving} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '6px 14px', fontSize: 11, fontWeight: 700 }}>{saving ? 'Saving...' : 'Update Password'}</button>
            <button onClick={() => { setEditing(false); setCurrentPw(''); setNewPw(''); setErr(''); setReauthToken(null); }} className="pill-btn" style={{ background: T.sf, color: T.mt, border: `1px solid ${T.bd}`, padding: '6px 14px', fontSize: 11 }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 11, color: T.ac, padding: '6px 10px', background: 'rgba(0,212,170,0.08)', borderRadius: 6 }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, fontSize: 11, color: T.err, padding: '6px 10px', background: 'rgba(255,71,87,0.08)', borderRadius: 6 }}>{err}</div>}
    </div>
  );
}

// ─── Active Sessions ─────────────────────────────────────

function ActiveSessions() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [showReauth, setShowReauth] = useState(false);
  const [verifyingSession, setVerifyingSession] = useState<string | null>(null);
  const [verifyEmoji, setVerifyEmoji] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const list = await api.listSessions();
    setSessions(Array.isArray(list) ? list : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await api.revokeSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch { /* ignore */ }
    setRevoking(null);
  };

  const startRevokeAll = () => { setShowReauth(true); };

  const revokeAllOthers = async (reauthToken: string) => {
    setShowReauth(false);
    setRevokingAll(true);
    try {
      await api.revokeAllOtherSessions(reauthToken);
      setSessions(prev => prev.filter(s => s.current));
    } catch { /* ignore */ }
    setRevokingAll(false);
  };

  const formatActive = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return 'Active now';
    if (diff < 3_600_000) return `Active ${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `Active ${Math.floor(diff / 3_600_000)}h ago`;
    return `Active ${d.toLocaleDateString()}`;
  };

  const otherCount = sessions.filter(s => !s.current).length;

  return (
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Active Devices</div>
        {otherCount > 0 && (
          <button onClick={startRevokeAll} disabled={revokingAll} className="pill-btn"
            style={{ background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.25)', padding: '4px 10px', fontSize: 10, fontWeight: 600 }}>
            {revokingAll ? '...' : <><I.Lock s={9} /> Sign Out All Others</>}
          </button>
        )}
      </div>
      {showReauth && <ReauthModal onSuccess={revokeAllOthers} onCancel={() => setShowReauth(false)} />}
      {loading ? (
        <div style={{ fontSize: 11, color: T.mt }}>Loading devices...</div>
      ) : sessions.length === 0 ? (
        <div style={{ fontSize: 11, color: T.mt }}>No active sessions</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sessions.map((s: any) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: T.bg, borderRadius: 6, border: `1px solid ${s.current ? ta(T.ac,'44') : T.bd}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: T.tx, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.device_name || 'Unknown device'}
                  {s.current && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(0,212,170,0.15)', color: T.ac, fontWeight: 700 }}>THIS DEVICE</span>}
                  {s.device_verified ? (
                    <span title="Verified device" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(59,165,93,0.15)', color: '#3ba55d', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 2 }}><I.Check s={9} /> VERIFIED</span>
                  ) : (
                    <span title="Unverified device" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(250,166,26,0.15)', color: '#faa61a', fontWeight: 700 }}>UNVERIFIED</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>
                  {s.ip_address || 'Unknown IP'} · {formatActive(s.last_active_at || s.created_at)} · Since {new Date(s.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {!s.device_verified && (
                  <button onClick={async () => {
                    setVerifyingSession(s.id);
                    try {
                      const res = await api.initiateVerify(s.id);
                      setVerifyEmoji(res.emoji);
                    } catch { setVerifyingSession(null); }
                  }} className="pill-btn"
                    style={{ background: 'rgba(0,212,170,0.1)', color: T.ac, border: `1px solid ${ta(T.ac,'44')}`, padding: '4px 10px', fontSize: 10, fontWeight: 600 }}>
                    Verify
                  </button>
                )}
                {!s.current && (
                  <button onClick={() => revoke(s.id)} disabled={revoking === s.id} className="pill-btn"
                    style={{ background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.25)', padding: '4px 10px', fontSize: 10, fontWeight: 600 }}>
                    {revoking === s.id ? '...' : 'Sign Out'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Emoji verification modal */}
      {verifyingSession && verifyEmoji && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10003 }} onClick={() => { setVerifyingSession(null); setVerifyEmoji(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}`, padding: 28, width: 360, maxWidth: '90vw', textAlign: 'center', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 8 }}>Verify Device</div>
            <div style={{ fontSize: 12, color: T.mt, marginBottom: 16, lineHeight: 1.5 }}>
              Compare this emoji sequence on both devices. If they match, the connection is secure.
            </div>
            <div style={{ fontSize: 36, letterSpacing: 8, marginBottom: 20, padding: '16px 0', background: T.bg, borderRadius: 'var(--border-radius)', border: `1px solid ${T.bd}` }}>
              {verifyEmoji}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={async () => {
                try {
                  await api.confirmVerify(verifyingSession);
                  setSessions(prev => prev.map(s => s.id === verifyingSession ? { ...s, device_verified: true } : s));
                } catch {}
                setVerifyingSession(null);
                setVerifyEmoji(null);
              }} style={{ padding: '8px 24px', borderRadius: 10, border: 'none', background: '#3ba55d', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                They Match <I.Check s={12} />
              </button>
              <button onClick={() => { setVerifyingSession(null); setVerifyEmoji(null); }} style={{ padding: '8px 24px', borderRadius: 10, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                They Don't Match
              </button>
            </div>
            <div style={{ fontSize: 10, color: T.mt, marginTop: 12 }}>
              If they don't match, sign out the unrecognized device immediately.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────

export function SettingsModal({ onClose, onThemeChange, showConfirm, setUserMap, curServer, onLogout, onUpgrade, platformUser, devTierOverride, onSetDevTierOverride, onStatusChange }: SettingsModalProps) {
  const { t } = useTranslation();
  const tzCtx = useTimezone();
  const [s, setS] = useState<UserSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState('profile');
  const [bio, setBio] = useState(localStorage.getItem('d_bio') || '');
  const [displayName, setDisplayName] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [me, setMe] = useState<any>(null);
  const [showAvatarCreator, setShowAvatarCreator] = useState(false);
  const [dismissedCards, setDismissedCards] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('d_discover_dismissed') || '[]')); } catch { return new Set(); }
  });
  const [settingsSearch, setSettingsSearch] = useState('');
  const [highlightSection, setHighlightSection] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Notification settings state ──────────────────────────
  const [ns, setNs] = useState(() => ({
    sounds:       localStorage.getItem('d_sounds') !== 'false',
    soundSend:    localStorage.getItem('d_sound_send') !== 'false',
    soundReceive: localStorage.getItem('d_sound_receive') !== 'false',
    soundVoice:   localStorage.getItem('d_sound_voice') !== 'false',
    soundMention: localStorage.getItem('d_notif_sound_mention') !== 'false',
    desktop:      localStorage.getItem('d_notif_desktop') === 'true',
    desktopPerm:  (typeof Notification !== 'undefined' ? Notification.permission : 'default') as NotificationPermission,
    desktopLevel: localStorage.getItem('d_notif_desktop_level') || 'mentions',
    group:        localStorage.getItem('d_notif_group') !== 'false',
    dnd:          localStorage.getItem('d_notif_dnd') === 'true',
    dndSchedule:  localStorage.getItem('d_notif_dnd_schedule') !== 'false',
    dndStart:     localStorage.getItem('d_notif_dnd_start') || '22:00',
    dndEnd:       localStorage.getItem('d_notif_dnd_end') || '08:00',
    dndDays:      localStorage.getItem('d_notif_dnd_days') || '0,1,2,3,4,5,6',
    mentionsOnly: localStorage.getItem('d_notif_mentions_only') === 'true',
    vol:          parseFloat(localStorage.getItem('d_notif_vol') || '0.3'),
  }));
  const [muteServerIds, setMuteServerIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('d_notif_muted_servers') || '[]'); } catch { return []; }
  });
  const [mentionServerIds, setMentionServerIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('d_notif_mentions_servers') || '[]'); } catch { return []; }
  });
  const [notifServers, setNotifServers] = useState<{ id: string; name: string; icon_url?: string }[]>([]);

  // Load servers when Notifications tab is active
  useEffect(() => {
    if (tab !== 'notifications') return;
    api.listServers().then((list: any) => {
      if (Array.isArray(list)) setNotifServers(list.map((sv: any) => ({ id: sv.id, name: sv.name, icon_url: sv.icon_url })));
    }).catch(() => {});
  }, [tab]);

  const setN = <K extends keyof typeof ns>(key: K, val: typeof ns[K], lsKey: string) => {
    setNs(p => ({ ...p, [key]: val }));
    localStorage.setItem(lsKey, String(val));
  };

  const requestDesktopPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNs(p => ({ ...p, desktopPerm: perm, desktop: perm === 'granted' }));
    if (perm === 'granted') localStorage.setItem('d_notif_desktop', 'true');
  };

  const toggleMuteServer = (sid: string) => {
    setMuteServerIds(prev => {
      const next = prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid];
      localStorage.setItem('d_notif_muted_servers', JSON.stringify(next));
      return next;
    });
  };

  const toggleMentionServer = (sid: string) => {
    setMentionServerIds(prev => {
      const next = prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid];
      localStorage.setItem('d_notif_mentions_servers', JSON.stringify(next));
      return next;
    });
  };

  const SETTINGS_INDEX = useMemo(() => [
    { tab: 'discover',   section: 'discover',        label: 'Discover Features',    desc: 'Explore features you haven\'t set up yet',                     keywords: ['discover', 'features', 'new', 'setup', 'getting started', 'onboarding', 'tips', 'tour'] },
    { tab: 'appearance', section: 'theme',           label: 'Theme & Colors',       desc: 'Dark mode, light mode, accent color, density, chat font size, bubbles', keywords: ['theme', 'dark', 'light', 'dark mode', 'accent', 'color', 'font', 'font size', 'compact', 'mode', 'density', 'spacing', 'layout', 'chat width', 'language', 'locale', 'timezone', 'time zone', 'message density', 'cozy', 'spacious', 'chat font', 'chat font size', 'bubble', 'bubbles', 'chat bubbles', 'imessage', 'messenger'] },
    { tab: 'appearance', section: 'display-options',  label: 'Display Options',      desc: 'Embeds, avatars, timestamps, typing indicators, emoji, nighttime mode', keywords: ['display', 'embeds', 'embed', 'link preview', 'avatar', 'timestamp', 'typing', 'indicator', 'emoji', 'animate', 'sticker', 'smooth scroll', 'twemoji', 'recently used emojis', 'emoji history', 'slash', 'suggestions', 'nighttime', 'night mode', 'bedtime', 'sleep', 'blue light', 'moon', 'dark mode schedule'] },
    { tab: 'voice',      section: 'voice',           label: 'Voice & Video',        desc: 'Microphone, speaker, camera, noise suppression, push to talk, video quality',  keywords: ['voice', 'audio', 'video', 'camera', 'microphone', 'mic', 'speaker', 'input', 'output', 'volume', 'noise', 'gate', 'compressor', 'echo', 'cancellation', 'noise suppression', 'push to talk', 'ptt', 'voice activation', 'sensitivity', 'confirm', 'leave', 'disconnect', 'webcam', 'resolution', 'fps'] },
    { tab: 'video',      section: 'video',           label: 'Video & Streaming',    desc: 'Camera, resolution, FPS, screen sharing',               keywords: ['video', 'camera', 'webcam', 'resolution', 'fps', 'screen share', 'streaming', 'quality'] },
    { tab: 'profile',    section: 'profile',         label: 'My Profile',           desc: 'Display name, avatar, bio, custom status',              keywords: ['avatar', 'picture', 'profile', 'photo', 'upload', 'display name', 'bio', 'about me', 'custom status', 'name'] },
    { tab: 'profile',    section: 'avatar-creator',   label: 'Avatar Creator',       desc: 'Create and customize your avatar',                      keywords: ['avatar', 'creation', 'builder', 'randomize', 'create avatar'] },
    { tab: 'privacy',    section: 'privacy',         label: 'Privacy',              desc: 'DM privacy, friend requests, online status, read receipts, typing, friends-only encryption', keywords: ['privacy', 'dm', 'direct message', 'friend request', 'block', 'stranger', 'online status', 'hide activity', 'read receipt', 'read receipts', 'typing', 'typing indicator', 'link preview', 'link previews', 'url preview', 'default status', 'invisible', 'visibility', 'appear offline', 'friends only', 'friends-only', 'encryption mode', 'decrypt'] },
    { tab: 'privacy',    section: 'interaction',     label: 'Interaction Controls', desc: 'Online status visibility, stranger DM blocking, AI disable',        keywords: ['hide online status', 'activity', 'block stranger dms', 'mutual friends', 'interaction', 'ai', 'disable ai', 'bot', 'agent', 'ai disabled'] },
    { tab: 'account',    section: 'change-email',    label: 'Email Address',        desc: 'Change or verify your email address',                   keywords: ['email', 'change email', 'verify'] },
    { tab: 'account',    section: 'import-messages', label: 'Import Messages',      desc: 'Import chat history from Signal, WhatsApp, iMessage, Android SMS', keywords: ['import', 'signal', 'whatsapp', 'imessage', 'sms', 'android', 'migrate', 'transfer', 'chat history', 'messages', 'backup'] },
    { tab: 'account-security', section: 'security-status', label: 'Security Status', desc: 'Security score, account verification',              keywords: ['security', 'status', 'score', 'upgrade', 'guest', 'verified'] },
    { tab: 'account-security', section: 'sec-email',       label: 'Email Security',  desc: 'Change or verify your email address',                keywords: ['email', 'change email', 'verify email'] },
    { tab: 'account-security', section: 'sec-password',    label: 'Password',        desc: 'Change your password',                               keywords: ['password', 'change password'] },
    { tab: 'account-security', section: 'sec-recovery',    label: 'Recovery Phrase',  desc: 'View or manage your recovery phrase',                keywords: ['recovery', 'recovery phrase', 'backup', 'seed phrase', 'recovery key'] },
    { tab: 'account-security', section: 'sec-2fa',         label: 'Two-Factor Auth', desc: 'TOTP two-factor authentication',                     keywords: ['two factor', '2fa', 'mfa', 'totp', 'authentication', 'two-factor', 'multi-factor'] },
    { tab: 'account-security', section: 'sec-passkeys',    label: 'Passkeys',        desc: 'FIDO2 passkeys and biometric sign-in',               keywords: ['passkey', 'passkeys', 'fido', 'webauthn', 'biometric', 'fingerprint', 'face id'] },
    { tab: 'sessions',         section: 'sessions',        label: 'Active Sessions', desc: 'Manage sessions, sign out other devices, device verification', keywords: ['sessions', 'devices', 'logout', 'sign out', 'active', 'revoke', 'device verification'] },
    { tab: 'notifications', section: 'notifications', label: 'Notifications',       desc: 'Sound customization, desktop alerts, DND schedule, quiet hours', keywords: ['notification', 'notifications', 'sound', 'alert', 'mention', 'badge', 'desktop', 'browser', 'push', 'mute', 'muted', 'do not disturb', 'dnd', 'quiet hours', 'schedule', 'moon', 'chime', 'pop', 'bell', 'ringtone', 'tone'] },
    { tab: 'accessibility', section: 'accessibility', label: 'Accessibility',       desc: 'Motion, contrast, dyslexia font, zoom, saturation',    keywords: ['accessibility', 'reduce motion', 'high contrast', 'dyslexia', 'font', 'zoom', 'saturation', 'screen reader', 'a11y'] },
    { tab: 'keybinds',   section: 'keybinds',        label: 'Keybinds',            desc: 'Keyboard shortcuts, quick switcher, mute/deafen, emoji', keywords: ['keybinds', 'keyboard', 'shortcuts', 'hotkeys', 'push to talk', 'mute', 'deafen', 'keybinding', 'ctrl+k', 'quick switcher', 'emoji picker', 'ctrl+e'] },
    { tab: 'advanced',   section: 'advanced',        label: 'Advanced',            desc: 'Developer mode, performance, cache, danger zone',       keywords: ['advanced', 'developer', 'developer mode', 'performance', 'overlay', 'cache', 'clear data', 'danger zone', 'delete account', 'reset'] },
    { tab: 'network',    section: 'network',         label: 'Network & Proxy',     desc: 'SOCKS5, HTTP proxy, VPN, Tor connection',               keywords: ['network', 'proxy', 'socks5', 'http', 'vpn', 'connection', 'tor', 'socks'] },
  ], []);

  // Synonym map: common search terms → canonical keywords for matching
  const SYNONYMS: Record<string, string[]> = useMemo(() => ({
    'dark mode': ['theme'], 'light mode': ['theme'], 'night mode': ['theme'], 'color scheme': ['theme'],
    '2fa': ['two factor', '2fa'], 'mfa': ['multi-factor', 'mfa'], 'two-factor': ['two factor'],
    'timezone': ['timezone'], 'time zone': ['timezone', 'time zone'],
    'password': ['password', 'change password'], 'passwd': ['password'],
    'mute': ['mute', 'muted', 'notification'], 'unmute': ['mute'],
    'font': ['font', 'font size', 'dyslexia'], 'text size': ['font size'],
    'proxy': ['proxy', 'socks5', 'network'], 'vpn': ['vpn', 'network'],
    'hotkey': ['hotkeys', 'shortcuts', 'keybinds'], 'shortcut': ['shortcuts', 'keybinds'],
    'language': ['language', 'locale'], 'locale': ['locale', 'language'],
    'mic': ['microphone', 'mic'], 'camera': ['camera', 'webcam'],
    'notifications': ['notification', 'notifications'], 'sound': ['sound', 'notification'],
    'read receipt': ['read receipt', 'read receipts'], 'typing indicator': ['typing', 'typing indicator'],
    'link preview': ['link preview', 'link previews', 'url preview'], 'url preview': ['link preview', 'url preview'],
    'status': ['online status', 'custom status', 'status'],
    'avatar': ['avatar', 'picture', 'profile'], 'profile pic': ['avatar', 'profile'],
    'delete': ['delete account', 'danger zone'], 'logout': ['logout', 'sign out'],
    'import': ['import', 'signal', 'whatsapp', 'imessage', 'sms', 'migrate'], 'migrate': ['import', 'migrate', 'transfer'],
    'passkey': ['passkey', 'passkeys', 'fido', 'webauthn', 'biometric'], 'fingerprint': ['biometric', 'passkey'],
    'recovery': ['recovery', 'recovery phrase', 'seed phrase', 'recovery key', 'backup'],
    'session': ['sessions', 'devices', 'active'], 'device': ['devices', 'sessions', 'device verification'],
  }), []);

  const searchMatches = useMemo(() => {
    const q = settingsSearch.trim().toLowerCase();
    if (!q) return null;
    const words = [q];
    // Expand with synonyms
    for (const [syn, targets] of Object.entries(SYNONYMS)) {
      if (q.includes(syn) || syn.includes(q)) words.push(...targets);
    }
    return SETTINGS_INDEX.filter(si => {
      const labelMatch = si.label.toLowerCase().includes(q);
      const descMatch = si.desc.toLowerCase().includes(q);
      const kwMatch = si.keywords.some(kw => words.some(w => kw.includes(w) || w.includes(kw)));
      return labelMatch || descMatch || kwMatch;
    });
  }, [settingsSearch, SETTINGS_INDEX, SYNONYMS]);

  // Determine which tabs have matches
  const matchedTabs = useMemo(() => {
    if (!searchMatches) return null;
    return new Set(searchMatches.map(m => m.tab));
  }, [searchMatches]);

  // Determine which sections have matches
  const matchedSections = useMemo(() => {
    if (!searchMatches) return null;
    return new Set(searchMatches.map(m => m.section));
  }, [searchMatches]);

  // Auto-switch to first matching tab when searching
  useEffect(() => {
    if (searchMatches && searchMatches.length > 0 && matchedTabs && !matchedTabs.has(tab)) {
      setTab(searchMatches[0].tab);
    }
  }, [searchMatches, matchedTabs, tab]);

  // Ctrl+F focuses search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Highlight matched text helper
  const highlightMatch = useCallback((text: string) => {
    const q = settingsSearch.trim().toLowerCase();
    if (!q || q.length < 2) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return text;
    return <>{text.slice(0, idx)}<mark style={{ background: `${ta(T.ac,'33')}`, color: T.ac, borderRadius: 2, padding: '0 1px' }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
  }, [settingsSearch]);

  // Section visibility helper — hides sections that don't match during search
  const sectionVisible = useCallback((section: string) => {
    if (!matchedSections) return true;
    return matchedSections.has(section);
  }, [matchedSections]);

  // Scroll + highlight when search jumps to a section
  useEffect(() => {
    if (!highlightSection) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-section="${highlightSection}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s';
        el.style.boxShadow = `0 0 0 2px ${T.ac}, 0 0 12px ${ta(T.ac,'44')}`;
        setTimeout(() => { el.style.boxShadow = ''; }, 2000);
      }
      setHighlightSection('');
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightSection]);

  useEffect(() => {
    api.getSettings().then((d: any) => {
      if (d && typeof d === 'object' && d.user_id) {
        setS(d);
        if (d.locale && d.locale !== i18n.language) i18n.changeLanguage(d.locale);
        if (d.timezone && d.timezone !== 'UTC') tzCtx.setTimezone(d.timezone);
        // Sync DND schedule from server
        if (d.dnd_enabled !== undefined) {
          setNs(p => ({
            ...p,
            dndSchedule: !!d.dnd_enabled,
            dndStart: d.dnd_start || p.dndStart,
            dndEnd: d.dnd_end || p.dndEnd,
            dndDays: d.dnd_days || p.dndDays,
          }));
          if (d.dnd_start) localStorage.setItem('d_notif_dnd_start', d.dnd_start);
          if (d.dnd_end) localStorage.setItem('d_notif_dnd_end', d.dnd_end);
          if (d.dnd_days) localStorage.setItem('d_notif_dnd_days', d.dnd_days);
          localStorage.setItem('d_notif_dnd_schedule', String(!!d.dnd_enabled));
        }
      } else setS({ theme: 'dark', font_size: 'medium', compact_mode: false, show_embeds: true, dm_privacy: 'friends', friend_request_privacy: 'friends_of_friends', notification_level: 'all', hide_online_status: true, hide_activity: true, block_stranger_dms: true });
    }).catch(() => setS({ theme: 'dark', font_size: 'medium', compact_mode: false, show_embeds: true, dm_privacy: 'friends', friend_request_privacy: 'friends_of_friends', notification_level: 'all', hide_online_status: true, hide_activity: true, block_stranger_dms: true }));
    api.getMe().then((u: any) => { setMe(u); if (u?.display_name) setDisplayName(u.display_name); else if (u?.username) setDisplayName(u.username); }).catch(() => {});
  }, []);

  const save = async (k: string, v: unknown) => {
    setS(p => ({ ...p, [k]: v }));
    try { await api.updateSettings({ [k]: v }); } catch { setErrMsg('Failed to save'); }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    if (k === 'locale') { setLanguage(v as string).catch(() => {}); }
    if (k === 'font_size') {
      document.documentElement.style.setProperty('--app-font-size', FONT_SIZE_MAP[v as string] || '14px');
      localStorage.setItem('d_font_size', v as string);
    }
    if (k === 'theme' && onThemeChange) onThemeChange(v as string);
    if (k === 'default_status' && onStatusChange) onStatusChange(v as string);
  };

  const saveBio = (v: string) => { setBio(v); localStorage.setItem('d_bio', v); };

  const saveDisplayName = async () => {
    if (!displayName?.trim()) { setErrMsg('Display name cannot be empty'); return; }
    try {
      const res = await api.updateProfile({ display_name: displayName.trim() });
      if (res && !res.ok) { const err = await res.text().catch(() => ''); setErrMsg('Save failed: ' + err); return; }
      setUserMap?.(p => ({ ...p, [api.userId]: displayName.trim() }));
      (api as any).invalidateUserCache?.(api.userId);
      const ws = (api as any).ws;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'user_update', user_id: api.userId, username: api.username, display_name: displayName.trim() }));
      }
      setSaved(true); setTimeout(() => setSaved(false), 1500); setErrMsg('');
    } catch (e: any) { setErrMsg('Failed to save: ' + (e?.message || 'Network error')); }
  };

  const sel: React.CSSProperties = { ...getInp(), cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', paddingRight: 32, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235a6080' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' };
  const isStaff = platformUser?.platform_role === 'admin' || platformUser?.platform_role === 'dev';
  const tabGroups = [
    { heading: t('settings.myAccount'), tabs: [
      { id: 'profile', label: t('settings.profile') },
      { id: 'account', label: t('settings.account') },
      { id: 'account-security', label: t('settings.security') },
      { id: 'sessions', label: t('settings.sessions') },
      { id: 'privacy', label: t('settings.privacy') },
    ]},
    { heading: t('settings.appSettings'), tabs: [
      { id: 'appearance', label: t('settings.appearance') },
      { id: 'notifications', label: t('settings.notifications') },
      { id: 'voice', label: t('settings.voiceVideo') },
      { id: 'keybinds', label: t('settings.keybinds') },
      { id: 'accessibility', label: t('settings.accessibility') },
    ]},
    { heading: t('settings.advanced'), tabs: [
      { id: 'network', label: t('settings.network') },
      { id: 'advanced', label: t('settings.dataStorage') },
      { id: 'discover', label: t('settings.discover') },
      { id: 'about', label: t('settings.about') },
    ]},
    ...(isStaff ? [{ heading: t('settings.staff'), tabs: [
      { id: 'admin', label: t('nav.admin') },
      { id: 'dev-tools', label: t('settings.devTools') },
    ]}] : []),
  ];
  const tabs = tabGroups.flatMap(g => g.tabs);

  return (
    <Modal title={t('settings.title')} onClose={onClose} widthOverride={860} data-testid="settings-modal" data-component="SettingsModal">
      {!s ? <div style={{ color: T.mt, textAlign: 'center', padding: 20 }}>{t('common.loading')}</div> : (<>
        {/* Settings Search */}
        <div style={{ marginBottom: 10, position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <input ref={searchRef} value={settingsSearch} onChange={e => setSettingsSearch(e.target.value)} placeholder={t('settings.searchPlaceholder')}
              style={{ width: '100%', padding: '8px 12px 8px 32px', background: T.bg, border: `1px solid ${settingsSearch.trim() ? T.ac : T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-primary)', transition: 'border-color .15s' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.mt, pointerEvents: 'none', display: 'flex' }}><I.Search s={13} /></span>
            {settingsSearch.trim() && <span onClick={() => setSettingsSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: T.mt, cursor: 'pointer', display: 'flex' }}><I.X s={14} /></span>}
          </div>
          {searchMatches && searchMatches.length > 0 && (
            <div style={{ marginTop: 6, background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, padding: 4, maxHeight: 220, overflowY: 'auto' }}>
              {searchMatches.map((result, i) => (
                <div key={i} onClick={() => { setTab(result.tab); setHighlightSection(result.section); setSettingsSearch(''); }}
                  style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: T.tx, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{highlightMatch(result.label)}</div>
                    <div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{highlightMatch(result.desc)}</div>
                  </div>
                  <span style={{ fontSize: 10, color: T.mt, textTransform: 'capitalize', whiteSpace: 'nowrap', flexShrink: 0 }}>{result.tab}</span>
                </div>
              ))}
            </div>
          )}
          {searchMatches && searchMatches.length === 0 && (
            <div style={{ marginTop: 6, padding: '10px 14px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, fontSize: 12, color: T.mt, textAlign: 'center' }}>
              No settings found for &ldquo;{settingsSearch}&rdquo;
            </div>
          )}
        </div>

        {/* Settings Sidebar + Content Layout */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 0, minHeight: 400 }}>
        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${T.bd}`, paddingRight: 12, marginRight: 16, overflowY: 'auto', maxHeight: 'calc(90vh - 120px)' }}>
          {tabGroups.map(group => (
            <div key={group.heading} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.6px', padding: '6px 10px 2px', marginBottom: 2 }}>{group.heading}</div>
              {group.tabs.map(t => {
                const dimmed = matchedTabs && !matchedTabs.has(t.id);
                return (
                  <div key={t.id} onClick={() => setTab(t.id)}
                    style={{
                      padding: '5px 10px 5px 18px', borderRadius: 4, fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
                      cursor: 'pointer', marginBottom: 1,
                      color: tab === t.id ? T.ac : dimmed ? ta(T.mt, '44') : T.mt,
                      background: tab === t.id ? ta(T.ac, '10') : 'transparent',
                      transition: 'color .15s, background .15s',
                    }}
                    onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.background = 'transparent'; }}
                  >{t.label}</div>
                );
              })}
            </div>
          ))}
          {onLogout && (
            <div style={{ borderTop: `1px solid ${T.bd}`, paddingTop: 8, marginTop: 4 }}>
              <div onClick={onLogout} style={{ padding: '5px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: T.err }}>Log Out</div>
            </div>
          )}
        </div>
        {/* Content */}
        <div style={{ flex: 1, minWidth: 500, overflowY: 'auto', maxHeight: 'calc(90vh - 120px)', padding: '0 32px 0 0' }}>

        {/* ── Discover ── */}
        {tab === 'discover' && (() => {
          const dismissCard = (id: string) => {
            setDismissedCards(prev => {
              const next = new Set(prev);
              next.add(id);
              localStorage.setItem('d_discover_dismissed', JSON.stringify([...next]));
              return next;
            });
          };

          const cards: { id: string; icon: React.ReactNode; title: string; desc: string; action: string; targetTab: string; show: boolean }[] = [
            {
              id: 'ai_agents',
              icon: <I.Bot s={24} />,
              title: 'AI Agents',
              desc: 'Add AI-powered bots to your servers — code helpers, game masters, moderators, and more. Supports OpenAI, Anthropic, and local Ollama models.',
              action: 'Configure Bots',
              targetTab: 'about',
              show: true,
            },
            {
              id: '2fa',
              icon: <I.Lock s={24} />,
              title: 'Two-Factor Authentication',
              desc: 'Add TOTP-based 2FA to protect your account. Even if your password is compromised, 2FA blocks unauthorized access.',
              action: 'Set Up 2FA',
              targetTab: 'account',
              show: !platformUser?.badge_type?.includes('2fa'),
            },
            {
              id: 'events',
              icon: <I.Calendar s={24} />,
              title: 'Server Events',
              desc: 'Create scheduled events with RSVP, reminders, and optional voice channel links. Keep your community engaged.',
              action: 'View Events',
              targetTab: 'about',
              show: true,
            },
            {
              id: 'shortcuts',
              icon: <I.Sliders s={24} />,
              title: 'Keyboard Shortcuts',
              desc: 'Navigate faster with Ctrl+K (quick switcher), Ctrl+E (emoji), Ctrl+Shift+M (mute), and more. Press Ctrl+/ to see all.',
              action: 'View Shortcuts',
              targetTab: 'keybinds',
              show: true,
            },
            {
              id: 'recovery_key',
              icon: <I.Lock s={24} />,
              title: 'Recovery Key',
              desc: 'Back up your encryption key fingerprint. If you lose access to your account, the recovery key is your last line of defense.',
              action: 'View Key',
              targetTab: 'account',
              show: true,
            },
            {
              id: 'dnd_schedule',
              icon: <I.Moon s={24} />,
              title: 'DND Schedule',
              desc: 'Set quiet hours to automatically silence notifications at night. DM @mentions still come through.',
              action: 'Set Schedule',
              targetTab: 'notifications',
              show: !(s?.dnd_enabled),
            },
            {
              id: 'privacy_toggles',
              icon: <I.Eye s={24} />,
              title: 'Privacy Controls',
              desc: 'Control read receipts, typing indicators, and link previews. All off by default — Discreet respects your privacy.',
              action: 'Review Privacy',
              targetTab: 'privacy',
              show: true,
            },
            {
              id: 'message_density',
              icon: <I.Sliders s={24} />,
              title: 'Chat Display Density',
              desc: 'Switch between Comfortable, Compact, and Cozy message layouts. Adjust chat font size from 12px to 20px.',
              action: 'Customize',
              targetTab: 'appearance',
              show: !s?.message_density || s.message_density === 'comfortable',
            },
          ];

          const visible = cards.filter(c => c.show && !dismissedCards.has(c.id));
          const allDismissed = visible.length === 0;

          return (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Discover Features</div>
              <div style={{ fontSize: 12, color: T.mt, marginBottom: 14, lineHeight: 1.5 }}>Features you haven't explored yet. Dismiss cards you don't need.</div>

              {allDismissed && (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ marginBottom: 8, color: T.ac, display: 'flex', justifyContent: 'center' }}><I.Check s={32} /></div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>All caught up!</div>
                  <div style={{ fontSize: 12, color: T.mt, marginBottom: 16 }}>You've explored all available features.</div>
                  <button onClick={() => { setDismissedCards(new Set()); localStorage.removeItem('d_discover_dismissed'); }} style={{ padding: '6px 16px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 11, cursor: 'pointer' }}>Reset All Cards</button>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {visible.map(card => (
                  <div key={card.id} style={{ padding: '16px 14px', background: T.sf2, borderRadius: 'var(--border-radius)', border: `1px solid ${T.bd}`, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
                    <button onClick={() => dismissCard(card.id)} aria-label="Dismiss" style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: T.mt, cursor: 'pointer', padding: 2, lineHeight: 1, opacity: 0.5, display: 'flex' }} title="Dismiss"><I.X s={14} /></button>
                    <div style={{ color: T.ac }}>{card.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>{card.title}</div>
                    <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5, flex: 1 }}>{card.desc}</div>
                    <button onClick={() => setTab(card.targetTab)} style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: T.ac, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' }}>{card.action}</button>
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* ── Appearance ── */}
        {tab === 'appearance' && (<Suspense fallback={<div style={{ color: T.mt, textAlign: 'center', padding: 20, fontSize: 12 }}>Loading...</div>}><SettingsAppearance s={s} save={save} sel={sel} sectionVisible={sectionVisible} setSaved={setSaved} /></Suspense>)}

        {/* ── Voice & Audio ── */}
        {tab === 'voice' && (<Suspense fallback={<div style={{ color: T.mt, textAlign: 'center', padding: 20, fontSize: 12 }}>Loading...</div>}><SettingsVoice DeviceSelector={DeviceSelector} TestMicrophoneButton={TestMicrophoneButton} TestSpeakerButton={TestSpeakerButton} AudioToggle={AudioToggle} /></Suspense>)}

        {/* ── My Profile ── */}
        {tab === 'profile' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Your Profile</div>

          {/* Avatar card */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: 16, background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}` }}>
            <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => {
              const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
              f.onchange = async (e: any) => {
                const file = e.target.files[0]; if (!file || file.size > 2 * 1024 * 1024) { alert('Avatar must be under 2MB'); return; }
                const reader = new FileReader(); reader.onload = (ev: any) => {
                  const dataUrl = ev.target.result;
                  localStorage.setItem('d_my_avatar', dataUrl);
                  const avCache = JSON.parse(localStorage.getItem('d_avatars') || '{}'); avCache[api.userId] = dataUrl; localStorage.setItem('d_avatars', JSON.stringify(avCache));
                  api.updateProfile({ avatar_url: dataUrl }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
                }; reader.readAsDataURL(file);
              }; f.click();
            }} title="Click to upload avatar">
              <Av name={displayName || api.username} size={56} color={T.ac} url={localStorage.getItem('d_my_avatar') || undefined} />
              <div style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, background: T.ac, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#000', fontWeight: 700, border: `2px solid ${T.bg}` }}>+</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>{displayName || api.username}</div>
              <div style={{ fontSize: 12, color: T.mt }}>@{api.username}</div>
              <div style={{ fontSize: 10, color: T.ac, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}><I.Lock s={8} /> E2EE Active</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button onClick={() => setShowAvatarCreator(true)} className="pill-btn" style={{ flex: 1, padding: '8px 0', background: `linear-gradient(135deg,${ta(T.ac,'22')},${(T as any).ac2 || T.ac}22)`, color: T.ac, border: `1px solid ${ta(T.ac,'44')}`, borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><I.Palette s={14} /> Create Avatar</button>
            {localStorage.getItem('d_my_avatar') && (
              <button onClick={() => { localStorage.removeItem('d_my_avatar'); const c = JSON.parse(localStorage.getItem('d_avatars') || '{}'); delete c[api.userId]; localStorage.setItem('d_avatars', JSON.stringify(c)); api.updateProfile({ avatar_url: '' }); setSaved(true); setTimeout(() => setSaved(false), 1500); }} className="pill-btn" style={{ padding: '8px 14px', background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.2)', borderRadius: 'var(--radius-md)', fontSize: 12 }}>Remove</button>
            )}
          </div>
          {showAvatarCreator && <AvatarCreator onClose={() => setShowAvatarCreator(false)} onSave={(dataUrl: string) => {
            localStorage.setItem('d_my_avatar', dataUrl);
            const avCache = JSON.parse(localStorage.getItem('d_avatars') || '{}'); avCache[api.userId] = dataUrl; localStorage.setItem('d_avatars', JSON.stringify(avCache));
            api.updateProfile({ avatar_url: dataUrl }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
            setShowAvatarCreator(false);
          }} />}

          {/* Username (read-only + copy) */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: T.mt, marginBottom: 4 }}>Username</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...getInp(), flex: 1, opacity: 0.7 }} value={api.username || ''} readOnly />
              <button onClick={() => { navigator.clipboard?.writeText(api.username || ''); setSaved(true); setTimeout(() => setSaved(false), 1500); }} className="pill-btn"
                style={{ background: T.sf2, color: T.mt, padding: '8px 14px', whiteSpace: 'nowrap', border: `1px solid ${T.bd}` }}>Copy</button>
            </div>
          </div>

          {/* Display Name (editable) */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: T.mt, marginBottom: 4 }}>Display Name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...getInp(), flex: 1 }} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="How others see you" maxLength={32} />
              <button onClick={saveDisplayName} className="pill-btn"
                disabled={(me as any)?.display_name_changes >= 3 && !['admin','tester'].includes((me as any)?.account_tier)}
                title={(me as any)?.display_name_changes >= 3 && !['admin','tester'].includes((me as any)?.account_tier) ? `Limit reached — resets ${(me as any)?.display_name_reset_at ? new Date(new Date((me as any).display_name_reset_at).getTime() + 30*24*60*60*1000).toLocaleDateString() : 'in 30 days'}` : undefined}
                style={{ background: T.ac, color: '#000', padding: '8px 16px', whiteSpace: 'nowrap', opacity: (me as any)?.display_name_changes >= 3 && !['admin','tester'].includes((me as any)?.account_tier) ? 0.5 : 1 }}>Save</button>
            </div>
            <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>
              {(me as any)?.display_name_changes != null ? `${(me as any).display_name_changes}/3 changes used this month` : ''}
            </div>
          </div>

          {/* Email (read-only + change) */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: T.mt, marginBottom: 4 }}>Email</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...getInp(), flex: 1, opacity: 0.7 }} value={(me as any)?.email || 'No email on file'} readOnly />
              <button onClick={() => setTab('account')} className="pill-btn"
                style={{ background: T.sf2, color: T.mt, padding: '8px 14px', whiteSpace: 'nowrap', border: `1px solid ${T.bd}` }}>Change</button>
            </div>
          </div>

          {/* About Me (bio) */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: T.mt, marginBottom: 4 }}>About Me</label>
            <textarea value={bio} onChange={e => { if (e.target.value.length <= 500) saveBio(e.target.value); }} placeholder="Tell others about yourself..." rows={4}
              style={{ width: '100%', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, padding: '10px 12px', resize: 'vertical', fontFamily: 'var(--font-primary)', boxSizing: 'border-box', outline: 'none' }} />
            <div style={{ fontSize: 10, color: bio.length >= 480 ? T.err : T.mt, marginTop: 4 }}>{bio.length}/500 characters</div>
          </div>

          {/* Date of Birth (read-only if present) */}
          {(me as any)?.date_of_birth && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: T.mt, marginBottom: 4 }}>Date of Birth</label>
              <input style={{ ...getInp(), opacity: 0.7 }} value={new Date((me as any).date_of_birth).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} readOnly />
            </div>
          )}
        </>)}

        {/* ── Privacy ── */}
        {tab === 'privacy' && (<Suspense fallback={<div style={{ color: T.mt, textAlign: 'center', padding: 20, fontSize: 12 }}>Loading...</div>}><SettingsPrivacy s={s} save={save} sel={sel} sectionVisible={sectionVisible} /></Suspense>)}

        {/* ── Account ── */}
        {tab === 'account' && (<Suspense fallback={<div style={{ color: T.mt, textAlign: 'center', padding: 20, fontSize: 12 }}>Loading...</div>}><SettingsAccount s={s} save={save} sectionVisible={sectionVisible} onUpgrade={onUpgrade} platformUser={platformUser} ChangeEmail={ChangeEmail} RotateEncryptionKey={RotateEncryptionKey} ClearLocalCache={ClearLocalCache} /></Suspense>)}

        {/* ── Account Security ── */}
        {tab === 'account-security' && (<Suspense fallback={<div style={{ color: T.mt, textAlign: 'center', padding: 20, fontSize: 12 }}>Loading...</div>}><SettingsAccountSecurity s={s} save={save} sectionVisible={sectionVisible} platformUser={platformUser} SecurityStatus={SecurityStatus} ChangeEmail={ChangeEmail} ChangePassword={ChangePassword} onNavigateTab={setTab} me={me} /></Suspense>)}

        {/* ── Active Sessions ── */}
        {tab === 'sessions' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Active Sessions</div>
          <ActiveSessions />
        </>)}

        {/* ── Notifications ── */}
        {tab === 'notifications' && (<Suspense fallback={<div style={{ color: T.mt, textAlign: 'center', padding: 20, fontSize: 12 }}>Loading...</div>}><SettingsNotifications s={s} save={save} sel={sel} ns={ns} setN={setN} setNs={setNs} requestDesktopPermission={requestDesktopPermission} toggleMuteServer={toggleMuteServer} toggleMentionServer={toggleMentionServer} muteServerIds={muteServerIds} mentionServerIds={mentionServerIds} notifServers={notifServers} Toggle={Toggle} NRow={NRow} notifSound={notifSound} /></Suspense>)}

        {/* ── Video ── */}
        {tab === 'video' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Camera & Video Playback</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Camera Resolution</label>
              <select style={sel} value={localStorage.getItem('d_cam_res') || '720'} onChange={e => localStorage.setItem('d_cam_res', e.target.value)}>
                <option value="480">480p</option><option value="720">720p (Default)</option><option value="1080">1080p</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Camera FPS</label>
              <select style={sel} value={localStorage.getItem('d_cam_fps') || '30'} onChange={e => localStorage.setItem('d_cam_fps', e.target.value)}>
                <option value="15">15 FPS</option><option value="24">24 FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Video Grid Size</div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Max Video Grid Height</label>
            <select style={sel} value={localStorage.getItem('d_video_max_height') || '280px'} onChange={e => localStorage.setItem('d_video_max_height', e.target.value)}>
              <option value="180px">Small (180px)</option><option value="280px">Medium (280px — Default)</option>
              <option value="420px">Large (420px)</option><option value="600px">XL (600px)</option><option value="none">Full Size (No Limit)</option>
            </select>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>In-Chat Playback</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Default Volume</label>
              <input type="range" min="0" max="100" defaultValue={localStorage.getItem('d_video_vol') || '80'} onChange={e => localStorage.setItem('d_video_vol', e.target.value)} style={{ width: '100%', accentColor: T.ac } as any} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>0%</span><span>{localStorage.getItem('d_video_vol') || '80'}%</span><span>100%</span></div>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Playback Speed</label>
              <select style={sel} value={localStorage.getItem('d_video_speed') || '1'} onChange={e => localStorage.setItem('d_video_speed', e.target.value)}>
                <option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x (Normal)</option>
                <option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option>
              </select>
            </div>
          </div>
          {[
            { key: 'd_video_autoplay', label: 'Autoplay Videos',          desc: 'Automatically play video attachments',     def: false },
            { key: 'd_video_loop',     label: 'Loop Short Videos',         desc: 'Auto-loop videos under 30 seconds',        def: false },
            { key: 'd_video_pip',      label: 'Picture-in-Picture',        desc: 'Pop out floating video player',            def: true  },
            { key: 'd_hardware_accel', label: 'Hardware Acceleration',     desc: 'Use GPU for video decoding',               def: true  },
          ].map(opt => {
            const val = localStorage.getItem(opt.key) !== (opt.def ? 'false' : 'true');
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
                <div onClick={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
            );
          })}
        </>)}

        {/* ── Streaming ── */}
        {tab === 'streaming' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Stream Output</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Output Resolution</label>
              <select style={sel} value={localStorage.getItem('d_stream_res') || '1080'} onChange={e => localStorage.setItem('d_stream_res', e.target.value)}>
                <option value="480">480p (854×480)</option><option value="720">720p (1280×720)</option><option value="1080">1080p (1920×1080)</option><option value="1440">1440p (2560×1440)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Frame Rate</label>
              <select style={sel} value={localStorage.getItem('d_stream_fps') || '30'} onChange={e => localStorage.setItem('d_stream_fps', e.target.value)}>
                <option value="15">15 FPS</option><option value="24">24 FPS (Cinematic)</option><option value="30">30 FPS (Default)</option><option value="60">60 FPS (Smooth)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Encoder</label>
              <select style={sel} value={localStorage.getItem('d_stream_encoder') || 'auto'} onChange={e => localStorage.setItem('d_stream_encoder', e.target.value)}>
                <option value="auto">Auto (Recommended)</option><option value="h264">H.264 (Hardware/NVENC)</option><option value="vp8">VP8 (Software)</option><option value="vp9">VP9 (Quality)</option><option value="av1">AV1 (Experimental)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Rate Control</label>
              <select style={sel} value={localStorage.getItem('d_stream_rc') || 'cbr'} onChange={e => localStorage.setItem('d_stream_rc', e.target.value)}>
                <option value="cbr">CBR (Constant Bitrate)</option><option value="vbr">VBR (Variable Bitrate)</option><option value="cqp">CQP (Constant Quality)</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Bitrate</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Video Bitrate (kbps)</label>
              <input type="range" min="500" max="12000" step="500" defaultValue={localStorage.getItem('d_stream_vbr') || '4000'} onChange={e => localStorage.setItem('d_stream_vbr', e.target.value)} style={{ width: '100%', accentColor: T.ac } as any} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>500</span><span style={{ color: T.ac, fontWeight: 700 }}>{localStorage.getItem('d_stream_vbr') || '4000'} kbps</span><span>12000</span></div>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Audio Bitrate</label>
              <select style={sel} value={localStorage.getItem('d_stream_abr') || '128'} onChange={e => localStorage.setItem('d_stream_abr', e.target.value)}>
                <option value="64">64 kbps</option><option value="96">96 kbps</option><option value="128">128 kbps (Default)</option>
                <option value="160">160 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps (Studio)</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Advanced Stream</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Keyframe Interval</label>
              <select style={sel} value={localStorage.getItem('d_stream_kfi') || '2'} onChange={e => localStorage.setItem('d_stream_kfi', e.target.value)}>
                <option value="1">1 second</option><option value="2">2 seconds (Default)</option><option value="3">3 seconds</option><option value="4">4 seconds</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Profile</label>
              <select style={sel} value={localStorage.getItem('d_stream_profile') || 'high'} onChange={e => localStorage.setItem('d_stream_profile', e.target.value)}>
                <option value="baseline">Baseline</option><option value="main">Main</option><option value="high">High (Default)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Downscale Filter</label>
              <select style={sel} value={localStorage.getItem('d_stream_filter') || 'lanczos'} onChange={e => localStorage.setItem('d_stream_filter', e.target.value)}>
                <option value="bilinear">Bilinear (Fast)</option><option value="bicubic">Bicubic (Balanced)</option><option value="lanczos">Lanczos (Sharp)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Color Format</label>
              <select style={sel} value={localStorage.getItem('d_stream_color') || 'nv12'} onChange={e => localStorage.setItem('d_stream_color', e.target.value)}>
                <option value="nv12">NV12 (Default)</option><option value="i420">I420</option><option value="i444">I444 (High Quality)</option>
              </select>
            </div>
          </div>
          {[
            { key: 'd_stream_preview',  label: 'Stream Preview',              desc: 'Show preview before going live',               def: true  },
            { key: 'd_stream_audio',    label: 'Include System Audio',         desc: 'Capture desktop audio in screen share',        def: true  },
            { key: 'd_stream_cursor',   label: 'Show Cursor',                  desc: 'Include mouse cursor in screen share',         def: true  },
            { key: 'd_stream_optimize', label: 'Optimize for Low Latency',     desc: 'Reduce encoding delay for real-time viewing',  def: false },
          ].map(opt => {
            const val = localStorage.getItem(opt.key) !== (opt.def ? 'false' : 'true');
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
                <div onClick={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
            );
          })}
        </>)}

        {/* ── Accessibility ── */}
        {tab === 'accessibility' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Accessibility</div>
          {typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && localStorage.getItem('d_reduce_motion') !== 'true' && (
            <div style={{ padding: '8px 12px', background: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.15)', borderRadius: 'var(--radius-md)', marginBottom: 10, fontSize: 11, color: T.ac, lineHeight: 1.5 }}>
              Your OS has <strong>Reduce Motion</strong> enabled. Discreet respects this automatically via CSS media query. Toggle below to override.
            </div>
          )}
          {[
            { key: 'd_reduce_motion', label: 'Reduce Motion',             desc: 'Disable all animations and transitions. Your OS preference is respected automatically — this toggle overrides it.', settingsKey: 'reduce_motion' },
            { key: 'd_high_contrast', label: 'High Contrast Mode',        desc: 'Stronger borders (WCAG AA), 3px focus outlines, boosted text contrast for all text and interactive elements.', settingsKey: 'high_contrast' },
            { key: 'd_focus_rings',   label: 'Focus Indicators',          desc: 'Show visible outlines on keyboard-focused elements for navigation without a mouse.', settingsKey: 'focus_rings' },
            { key: 'd_screen_reader', label: 'Screen Reader Optimized',   desc: 'Enhanced ARIA labels and landmarks for screen readers.', settingsKey: 'screen_reader' },
            { key: 'd_large_click',   label: 'Large Click Targets',       desc: 'Increase button and link sizes for easier interaction.', settingsKey: 'large_click_targets' },
            { key: 'd_dyslexia_font', label: 'Dyslexia-Friendly Font',    desc: 'Use OpenDyslexic font for improved readability.', settingsKey: 'dyslexia_font' },
          ].map(opt => {
            const val = localStorage.getItem(opt.key) === 'true';
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1, lineHeight: 1.4 }}>{opt.desc}</div></div>
                <div onClick={() => {
                  const next = !val;
                  localStorage.setItem(opt.key, String(next));
                  save(opt.settingsKey, next);
                  const root = document.querySelector('.chat-root');
                  if (root) {
                    if (opt.key === 'd_reduce_motion') root.classList.toggle('reduce-motion', next);
                    if (opt.key === 'd_high_contrast') { root.classList.toggle('high-contrast', next); (root as HTMLElement).style.background = next ? '#000' : ''; }
                    if (opt.key === 'd_focus_rings') root.classList.toggle('focus-visible', next);
                  }
                  setS(p => ({ ...p }));
                }} role="switch" aria-checked={val} aria-label={opt.label} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 12 }}><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>UI Zoom</label>
            <input type="range" min="80" max="150" step="5" defaultValue={localStorage.getItem('d_zoom') || '100'} onChange={e => { localStorage.setItem('d_zoom', e.target.value); document.documentElement.style.fontSize = e.target.value + '%'; }} style={{ width: '100%', accentColor: T.ac } as any} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>80%</span><span>{localStorage.getItem('d_zoom') || '100'}%</span><span>150%</span></div>
          </div>
          <div style={{ marginTop: 12 }}><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Color Saturation</label>
            <input type="range" min="0" max="200" step="10" defaultValue={localStorage.getItem('d_saturation') || '100'} onChange={e => localStorage.setItem('d_saturation', e.target.value)} style={{ width: '100%', accentColor: T.ac } as any} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>Grayscale</span><span>{localStorage.getItem('d_saturation') || '100'}%</span><span>Vivid</span></div>
          </div>
        </>)}

        {/* ── Keybinds ── */}
        {tab === 'keybinds' && <KeybindSettings />}

        {/* ── Advanced ── */}
        {tab === 'network' && (() => {
          const proxyType = localStorage.getItem('d_proxy_type') || 'none';
          const proxyHost = localStorage.getItem('d_proxy_host') || '';
          const proxyPort = localStorage.getItem('d_proxy_port') || '';
          const isTauri = !!(window as any).__TAURI_INTERNALS__;
          const syncTauri = (type: string, host: string, port: string) => {
            if (!isTauri) return;
            const { invoke } = (window as any).__TAURI_INTERNALS__;
            invoke('set_proxy_config', { proxyType: type, host, port }).catch(() => {});
          };
          const setProxy = (id: string) => {
            localStorage.setItem('d_proxy_type', id);
            syncTauri(id, proxyHost, proxyPort);
          };
          return (<>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Proxy Configuration</div>
            <div style={{ fontSize: 11, color: T.mt, marginBottom: 12 }}>
              Route your connection through a proxy. This is client-side only — the server never knows your proxy settings.
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Proxy Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { id: 'none', label: 'None', desc: 'Direct connection' },
                  { id: 'socks5', label: 'SOCKS5', desc: 'SOCKS5 proxy' },
                  { id: 'http', label: 'HTTP', desc: 'HTTP/HTTPS proxy' },
                ].map(p => (
                  <div key={p.id} onClick={() => setProxy(p.id)}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `2px solid ${proxyType === p.id ? T.ac : T.bd}`, background: proxyType === p.id ? 'rgba(0,212,170,0.06)' : 'transparent', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: proxyType === p.id ? T.ac : T.tx }}>{p.label}</div>
                    <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>{p.desc}</div>
                  </div>
                ))}
              </div>
            </div>
            {proxyType !== 'none' && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Host</label>
                  <input defaultValue={proxyHost} onBlur={e => { const v = e.target.value.trim(); localStorage.setItem('d_proxy_host', v); syncTauri(proxyType, v, proxyPort); }} placeholder={proxyType === 'socks5' ? '127.0.0.1' : 'proxy.example.com'} style={{ ...getInp(), width: '100%', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Port</label>
                  <input defaultValue={proxyPort} onBlur={e => { const v = e.target.value.trim(); localStorage.setItem('d_proxy_port', v); syncTauri(proxyType, proxyHost, v); }} placeholder={proxyType === 'socks5' ? '1080' : '8080'} style={{ ...getInp(), width: '100%', boxSizing: 'border-box' }} />
                </div>
              </div>
            )}
            {proxyType !== 'none' && proxyHost && proxyPort && (
              <div style={{ padding: '8px 12px', background: 'rgba(0,212,170,0.08)', borderRadius: 'var(--radius-md)', border: `1px solid ${ta(T.ac,'22')}`, marginBottom: 12, fontSize: 11, color: T.ac, fontWeight: 600 }}>
                Proxy configured: {proxyType.toUpperCase()}://{proxyHost}:{proxyPort}
              </div>
            )}
            {isTauri && proxyType !== 'none' && (
              <div style={{ padding: '8px 12px', background: 'rgba(250,166,26,0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(250,166,26,0.15)', marginBottom: 12, fontSize: 11, color: T.warn, fontWeight: 600 }}>
                Restart the desktop app to apply proxy changes to the system webview.
              </div>
            )}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>VPN & Privacy</div>
            <div style={{ padding: '10px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
              Discreet works with any VPN. For maximum privacy, we recommend using a VPN that doesn't log traffic.
              <div style={{ marginTop: 8, fontSize: 10, color: T.mt }}>
                Your messages are end-to-end encrypted regardless of whether you use a VPN or proxy. These settings only affect the transport layer — the server cannot read your message content either way.
              </div>
            </div>
            {isTauri && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Desktop Proxy</div>
                <div style={{ padding: '10px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
                  Proxy settings are applied to the WebView2 browser engine via <code style={{ color: T.ac }}>--proxy-server</code>. All HTTP, WebSocket, and media traffic routes through your configured proxy. Changes require an app restart.
                </div>
              </>
            )}
            {!isTauri && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Desktop App (Tauri)</div>
                <div style={{ padding: '10px 12px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
                  In the Discreet desktop app, proxy settings are passed to the system webview. SOCKS5 proxies are applied at the OS network level via Tauri's proxy configuration. Restart the app after changing proxy settings.
                </div>
              </>
            )}
          </>);
        })()}

        {tab === 'advanced' && (<Suspense fallback={<div style={{ color: T.mt, textAlign: 'center', padding: 20, fontSize: 12 }}>Loading...</div>}><SettingsAdvanced sel={sel} curServer={curServer} DevTools={DevTools} /></Suspense>)}

        {/* ── About ── */}
        {tab === 'about' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>About Discreet</div>
          <div style={{ padding: 16, background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><I.Shield s={20} /><span style={{ fontSize: 16, fontWeight: 700 }}>Discreet v0.4.0-alpha</span></div>
            <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.6, marginBottom: 12 }}>Zero-knowledge encrypted messaging. The server cannot read your messages. Ever.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div><span style={{ color: T.mt }}>Encryption:</span> <span style={{ color: T.ac }}>AES-256-GCM</span></div>
              <div><span style={{ color: T.mt }}>Protocol:</span> <span style={{ color: T.ac }}>MLS RFC 9420</span></div>
              <div><span style={{ color: T.mt }}>License:</span> <span style={{ color: T.ac }}>AGPL-3.0</span></div>
              <div><span style={{ color: T.mt }}>Backend:</span> <span style={{ color: T.ac }}>Rust/Axum</span></div>
            </div>
          </div>
        </>)}

        {/* ── Admin ── */}
        {tab === 'admin' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Platform Administration</div>

          {/* Role card */}
          <div style={{ background: T.sf2, borderRadius: 10, padding: 14, marginBottom: 16, border: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'flex', color: platformUser?.platform_role === 'admin' ? '#ffa502' : T.ac }}>{platformUser?.platform_role === 'admin' ? <I.Crown s={22} /> : <I.Wrench s={22} />}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>{platformUser?.platform_role === 'admin' ? 'Platform Admin' : 'Developer'}</div>
              <div style={{ fontSize: 11, color: T.mt }}>platform_role: {platformUser?.platform_role} · account_tier: {platformUser?.account_tier}</div>
            </div>
            {/* Permission chips inline */}
            {(platformUser?.permissions ?? []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 280, justifyContent: 'flex-end' }}>
                {(platformUser?.permissions ?? []).map((p: string) => (
                  <span key={p} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: `${ta(T.ac,'18')}`, border: `1px solid ${ta(T.ac,'33')}`, color: T.ac, fontFamily: 'monospace' }}>{p}</span>
                ))}
              </div>
            )}
          </div>

          {/* Dashboard — stats grid + user table */}
          <AdminDashboard platformUser={platformUser ?? null} />
        </>)}

        {/* ── Dev Tools ── */}
        {tab === 'dev-tools' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Developer Tools</div>

          {/* Current tier */}
          <div style={{ background: T.sf2, borderRadius: 10, padding: 14, marginBottom: 16, border: `1px solid ${T.bd}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Real Account Tier</div>
            <div style={{ fontSize: 14, color: T.tx }}>
              {(TIER_META as any)[platformUser?.account_tier ?? '']?.icon ?? <I.AlertTriangle s={16} />}{' '}
              <strong>{(TIER_META as any)[platformUser?.account_tier ?? '']?.label ?? platformUser?.account_tier ?? '—'}</strong>
              {platformUser?.platform_role && (
                <span style={{ marginLeft: 8, fontSize: 11, color: '#5865F2', fontFamily: 'monospace' }}>platform_role: {platformUser.platform_role}</span>
              )}
            </div>
          </div>

          {/* Tier impersonation */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>
              Impersonate Tier <span style={{ color: '#6b7280', fontWeight: 400, textTransform: 'none' }}>(UI only — does not change server permissions)</span>
            </label>
            <select style={sel} value={devTierOverride ?? ''} onChange={e => {
              const v = e.target.value as Tier | '';
              onSetDevTierOverride?.(v || null);
            }}>
              <option value="">— Use real tier ({platformUser?.account_tier ?? 'unknown'}) —</option>
              <option value="guest">Guest</option>
              <option value="unverified">Unverified</option>
              <option value="verified">Verified</option>
              <option value="pro">Pro</option>
              <option value="teams">Teams</option>
              <option value="enterprise">Enterprise</option>
            </select>
            {devTierOverride && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(250,166,26,0.08)', border: '1px solid rgba(250,166,26,0.3)', borderRadius: 'var(--radius-md)', fontSize: 12, color: '#faa61a' }}>
                <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}><I.AlertTriangle s={12} /></span> UI showing <strong>{devTierOverride}</strong> tier limits. Actual server permissions are unchanged.
              </div>
            )}
          </div>

          {/* Resources */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Resources</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { href: '/api/v1/info',           icon: <I.Monitor s={12} />, label: 'API Info' },
              { href: '/api/v1/platform/me',    icon: <I.User s={12} />,    label: 'My Platform Profile' },
              { href: '/api/v1/admin/stats',    icon: <I.BarChart s={12} />, label: 'Admin Stats' },
            ].map(({ href, icon, label }) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 7, color: T.mt, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = T.ac)}
                onMouseLeave={e => (e.currentTarget.style.color = T.mt)}>
                {icon}{label}
              </a>
            ))}
          </div>
        </>)}

        {errMsg && <div style={{ padding: '8px 12px', background: 'rgba(255,71,87,0.08)', borderRadius: 'var(--radius-md)', color: T.err, fontSize: 13, textAlign: 'center', marginTop: 8 }}>{errMsg}</div>}
        {saved && <div style={{ position: 'fixed', bottom: 24, right: 24, padding: '8px 16px', background: T.ac, color: '#000', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 700, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', zIndex: 10001, animation: 'fadeIn 0.2s ease' }}><span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}><I.Check s={12} /></span>{t('settings.saved')}</div>}
        </div>{/* end content */}
        </div>{/* end sidebar+content flex */}
      </>)}
    </Modal>
  );
}

// ─── Collapsible Advanced Section ────────────────────────────────────────

/**
 * AdvancedSection — Collapsible section at the bottom of a settings tab.
 *
 * State stored per-section in localStorage (d_adv_{sectionId}).
 * Chevron rotates 180° on expand. Smooth max-height transition 200ms.
 */
export function AdvancedSection({ sectionId, children }: { sectionId: string; children: React.ReactNode }) {
  const key = `d_adv_${sectionId}`;
  const [open, setOpen] = React.useState(() => localStorage.getItem(key) === '1');

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(key, next ? '1' : '0');
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ height: 1, background: T.bd, opacity: 0.5, marginBottom: 12 }} />
      <div onClick={toggle} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}>
        <span style={{ fontSize: 10, color: T.mt, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block' }}>▼</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Advanced</span>
      </div>
      <div style={{ maxHeight: open ? 2000 : 0, overflow: 'hidden', transition: 'max-height 0.2s ease' }}>
        <div style={{ paddingTop: 10 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
