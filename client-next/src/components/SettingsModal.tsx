/**
 * SettingsModal — 12-tab user settings panel.
 * Tabs: Appearance, Voice & Audio, Video, Streaming, My Profile,
 *       Privacy, Account, Notifications, Accessibility, Keybinds, Advanced, About.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { T, getInp } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';
import { setLanguage } from '../i18n/i18n';
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
}

// ─── Module-level constants ───────────────────────────────

const API_BASE = window.location.origin + '/api/v1';

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
      <div onClick={e => e.stopPropagation()} style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12, padding: 24, width: 380, maxWidth: '90vw' }}>
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
          autoComplete="current-password"
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${T.bd}22` }}>
      <div>
        <div style={{ fontSize: 12, color: T.tx, fontWeight: 500 }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: T.mt }}>{desc}</div>}
      </div>
      <div onClick={() => { const nv = !on; setOn(nv); localStorage.setItem(storageKey, String(nv)); onChange(nv); }}
        style={{ width: 36, height: 20, borderRadius: 10, background: on ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: on ? 18 : 2, transition: 'left 0.2s' }} />
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
        width: 16, height: 16, borderRadius: 8, background: '#fff',
        position: 'absolute', top: 2, left: on ? 18 : 2,
        transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

function NRow({ label, sub, on, onToggle, disabled }: { label: string; sub: string; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
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
}

function SecurityStatus({ platformUser, onSetupStep }: SecurityStatusProps) {
  const [me, setMe] = useState<any>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    api.getMe().then((u: any) => setMe(u)).catch(() => {});
  }, []);

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
          border: '1px solid #ffa50233', borderRadius: 12, padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 20,
              background: '#ffa50220', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 20,
            }}>👤</div>
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
                <span style={{ fontSize: 13, fontWeight: 700 }}>{'\u2717'}</span> {item}
              </div>
            ))}
          </div>
          <button
            onClick={() => onUpgrade ? onUpgrade() : setShowUpgrade(true)}
            style={{
              width: '100%', padding: '10px 0',
              background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
              border: 'none', borderRadius: 8, color: '#000',
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
        background: T.sf2, borderRadius: 12, padding: 16,
        border: `1px solid ${allComplete ? T.ac + '33' : T.bd}`,
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
              padding: '8px 12px', borderRadius: 8,
              background: c.ok ? `${T.ac}08` : 'rgba(255,165,0,0.06)',
              border: `1px solid ${c.ok ? T.ac + '22' : '#ffa50222'}`,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 11,
                background: c.ok ? `${T.ac}20` : '#ffa50220',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                color: c.ok ? T.ac : '#ffa502',
              }}>
                {c.ok ? '\u2713' : '!'}
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
              border: 'none', borderRadius: 8, color: '#fff',
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
        setErr(data.error || data.message || 'Upgrade failed');
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
    border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
    fontFamily: "'DM Sans',sans-serif", marginBottom: 10,
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
          border: `1px solid ${T.bd}`, borderRadius: 8, fontSize: 13, cursor: 'pointer',
        }}>Cancel</button>
        <button onClick={handleUpgrade} disabled={saving} style={{
          flex: 1, padding: '10px 0',
          background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
          border: 'none', borderRadius: 8, color: '#000',
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
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
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
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
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
            autoFocus autoComplete="current-password" />
          <input
            type="password" placeholder="New password (min 12 characters)" value={newPw}
            onChange={e => setNewPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, marginBottom: 8, outline: 'none', boxSizing: 'border-box' }}
            autoComplete="new-password" />
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
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
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
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: T.bg, borderRadius: 6, border: `1px solid ${s.current ? T.ac + '44' : T.bd}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: T.tx, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {s.device_name || 'Unknown device'}
                  {s.current && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(0,212,170,0.15)', color: T.ac, fontWeight: 700 }}>THIS DEVICE</span>}
                  {s.device_verified ? (
                    <span title="Verified device" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(59,165,93,0.15)', color: '#3ba55d', fontWeight: 700 }}>✓ VERIFIED</span>
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
                    style={{ background: 'rgba(0,212,170,0.1)', color: T.ac, border: `1px solid ${T.ac}44`, padding: '4px 10px', fontSize: 10, fontWeight: 600 }}>
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
            <div style={{ fontSize: 36, letterSpacing: 8, marginBottom: 20, padding: '16px 0', background: T.bg, borderRadius: 12, border: `1px solid ${T.bd}` }}>
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
                They Match ✓
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

export function SettingsModal({ onClose, onThemeChange, showConfirm, setUserMap, curServer, onLogout, onUpgrade, platformUser, devTierOverride, onSetDevTierOverride }: SettingsModalProps) {
  const tzCtx = useTimezone();
  const [s, setS] = useState<UserSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState('appearance');
  const [bio, setBio] = useState(localStorage.getItem('d_bio') || '');
  const [displayName, setDisplayName] = useState('');
  const [errMsg, setErrMsg] = useState('');
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
    { tab: 'appearance', section: 'theme',           label: 'Theme & Colors',       desc: 'Dark mode, light mode, accent color, density, chat font size', keywords: ['theme', 'dark', 'light', 'dark mode', 'accent', 'color', 'font', 'font size', 'compact', 'mode', 'density', 'spacing', 'layout', 'chat width', 'language', 'locale', 'timezone', 'time zone', 'message density', 'comfortable', 'cozy', 'chat font', 'chat font size'] },
    { tab: 'appearance', section: 'display-options',  label: 'Display Options',      desc: 'Embeds, avatars, timestamps, typing indicators, emoji', keywords: ['display', 'embeds', 'embed', 'link preview', 'avatar', 'timestamp', 'typing', 'indicator', 'emoji', 'animate', 'sticker', 'smooth scroll', 'twemoji', 'recently used emojis', 'emoji history', 'slash', 'suggestions'] },
    { tab: 'voice',      section: 'voice',           label: 'Voice & Audio',        desc: 'Microphone, speaker, noise suppression, push to talk',  keywords: ['voice', 'audio', 'microphone', 'mic', 'speaker', 'input', 'output', 'volume', 'noise', 'gate', 'compressor', 'echo', 'cancellation', 'noise suppression', 'push to talk', 'ptt', 'voice activation', 'sensitivity'] },
    { tab: 'video',      section: 'video',           label: 'Video & Streaming',    desc: 'Camera, resolution, FPS, screen sharing',               keywords: ['video', 'camera', 'webcam', 'resolution', 'fps', 'screen share', 'streaming', 'quality'] },
    { tab: 'profile',    section: 'profile',         label: 'My Profile',           desc: 'Display name, avatar, bio, custom status',              keywords: ['avatar', 'picture', 'profile', 'photo', 'upload', 'display name', 'bio', 'about me', 'custom status', 'name'] },
    { tab: 'profile',    section: 'avatar-creator',   label: 'Avatar Creator',       desc: 'Create and customize your avatar',                      keywords: ['avatar', 'creation', 'builder', 'randomize', 'create avatar'] },
    { tab: 'privacy',    section: 'privacy',         label: 'Privacy',              desc: 'DM privacy, friend requests, online status, read receipts, typing', keywords: ['privacy', 'dm', 'direct message', 'friend request', 'block', 'stranger', 'online status', 'hide activity', 'read receipt', 'read receipts', 'typing', 'typing indicator', 'link preview', 'link previews', 'url preview', 'default status', 'invisible', 'visibility', 'appear offline'] },
    { tab: 'privacy',    section: 'interaction',     label: 'Interaction Controls', desc: 'Online status visibility, stranger DM blocking',        keywords: ['hide online status', 'activity', 'block stranger dms', 'mutual friends', 'interaction'] },
    { tab: 'account',    section: 'security-status', label: 'Security Status',      desc: 'Security score, recovery key, account verification',    keywords: ['security', 'status', 'score', 'recovery key', 'upgrade', 'guest', 'verified', 'password'] },
    { tab: 'account',    section: 'change-email',    label: 'Email Address',        desc: 'Change or verify your email address',                   keywords: ['email', 'change email', 'verify'] },
    { tab: 'account',    section: 'security',        label: 'Security',             desc: 'Password, two-factor authentication, recovery key',     keywords: ['password', 'change password', 'two factor', '2fa', 'mfa', 'totp', 'authentication', 'two-factor', 'multi-factor', 'recovery'] },
    { tab: 'account',    section: 'active-devices',  label: 'Active Devices',       desc: 'Manage sessions and sign out other devices',            keywords: ['sessions', 'devices', 'logout', 'sign out', 'active', 'revoke'] },
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
    return <>{text.slice(0, idx)}<mark style={{ background: `${T.ac}33`, color: T.ac, borderRadius: 2, padding: '0 1px' }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
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
        el.style.boxShadow = `0 0 0 2px ${T.ac}, 0 0 12px ${T.ac}44`;
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
        if (d.locale && d.locale !== 'en') setLanguage(d.locale).catch(() => {});
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
    api.getMe().then((u: any) => { if (u?.display_name) setDisplayName(u.display_name); else if (u?.username) setDisplayName(u.username); }).catch(() => {});
  }, []);

  const save = async (k: string, v: unknown) => {
    setS(p => ({ ...p, [k]: v }));
    try { await api.updateSettings({ [k]: v }); } catch { setErrMsg('Failed to save'); }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    if (k === 'locale') { setLanguage(v as string).catch(() => {}); }
    if (k === 'font_size') {
      const m: Record<string, string> = { small: '12px', medium: '14px', large: '16px', xl: '18px' };
      document.documentElement.style.setProperty('--app-font-size', m[v as string] || '14px');
      localStorage.setItem('d_font_size', v as string);
    }
    if (k === 'theme' && onThemeChange) onThemeChange(v as string);
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
  const tabs = [
    { id: 'discover', label: '✦ Discover' }, { id: 'appearance', label: 'Appearance' }, { id: 'voice', label: 'Voice & Audio' },
    { id: 'video', label: 'Video' }, { id: 'streaming', label: 'Streaming' },
    { id: 'profile', label: 'My Profile' }, { id: 'privacy', label: 'Privacy' },
    { id: 'account', label: 'Account' }, { id: 'notifications', label: 'Notifications' },
    { id: 'accessibility', label: 'Accessibility' }, { id: 'keybinds', label: 'Keybinds' },
    { id: 'network', label: 'Network' }, { id: 'advanced', label: 'Advanced' }, { id: 'about', label: 'About' },
    ...(isStaff ? [{ id: 'admin', label: '⚙ Admin' }] : []),
    ...(isStaff ? [{ id: 'dev-tools', label: '🔧 Dev Tools' }] : []),
  ];

  return (
    <Modal title="Settings" onClose={onClose} wide>
      {!s ? <div style={{ color: T.mt, textAlign: 'center', padding: 20 }}>Loading settings...</div> : (<>
        {/* Settings Search */}
        <div style={{ marginBottom: 10, position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <input ref={searchRef} value={settingsSearch} onChange={e => setSettingsSearch(e.target.value)} placeholder="Search settings... (Ctrl+F)"
              style={{ width: '100%', padding: '8px 12px 8px 32px', background: T.bg, border: `1px solid ${settingsSearch.trim() ? T.ac : T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif", transition: 'border-color .15s' }} />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.mt, fontSize: 13, pointerEvents: 'none' }}>🔍</span>
            {settingsSearch.trim() && <span onClick={() => setSettingsSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: T.mt, fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>✕</span>}
          </div>
          {searchMatches && searchMatches.length > 0 && (
            <div style={{ marginTop: 6, background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}`, padding: 4, maxHeight: 220, overflowY: 'auto' }}>
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
            <div style={{ marginTop: 6, padding: '10px 14px', background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}`, fontSize: 12, color: T.mt, textAlign: 'center' }}>
              No settings found for &ldquo;{settingsSearch}&rdquo;
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: `1px solid ${T.bd}`, paddingBottom: 10, flexWrap: 'wrap' }}>
          {tabs.map(t => {
            const dimmed = matchedTabs && !matchedTabs.has(t.id);
            return (
              <div key={t.id} onClick={() => setTab(t.id)} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: tab === t.id ? T.ac : dimmed ? `${T.mt}44` : T.mt, background: tab === t.id ? 'rgba(0,212,170,0.1)' : 'transparent', transition: 'color .15s, opacity .15s' }}>{t.label}</div>
            );
          })}
          {onLogout && <div onClick={onLogout} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: T.err, marginLeft: 'auto' }}>Log Out</div>}
        </div>

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

          const cards: { id: string; icon: string; title: string; desc: string; action: string; targetTab: string; show: boolean }[] = [
            {
              id: 'ai_agents',
              icon: '🤖',
              title: 'AI Agents',
              desc: 'Add AI-powered bots to your servers — code helpers, game masters, moderators, and more. Supports OpenAI, Anthropic, and local Ollama models.',
              action: 'Configure Bots',
              targetTab: 'about',
              show: true, // Always show — user can explore
            },
            {
              id: '2fa',
              icon: '🔐',
              title: 'Two-Factor Authentication',
              desc: 'Add TOTP-based 2FA to protect your account. Even if your password is compromised, 2FA blocks unauthorized access.',
              action: 'Set Up 2FA',
              targetTab: 'account',
              show: !platformUser?.badge_type?.includes('2fa'),
            },
            {
              id: 'events',
              icon: '📅',
              title: 'Server Events',
              desc: 'Create scheduled events with RSVP, reminders, and optional voice channel links. Keep your community engaged.',
              action: 'View Events',
              targetTab: 'about',
              show: true,
            },
            {
              id: 'shortcuts',
              icon: '⌨️',
              title: 'Keyboard Shortcuts',
              desc: 'Navigate faster with Ctrl+K (quick switcher), Ctrl+E (emoji), Ctrl+Shift+M (mute), and more. Press Ctrl+/ to see all.',
              action: 'View Shortcuts',
              targetTab: 'keybinds',
              show: true,
            },
            {
              id: 'recovery_key',
              icon: '🔑',
              title: 'Recovery Key',
              desc: 'Back up your encryption key fingerprint. If you lose access to your account, the recovery key is your last line of defense.',
              action: 'View Key',
              targetTab: 'account',
              show: true,
            },
            {
              id: 'dnd_schedule',
              icon: '🌙',
              title: 'DND Schedule',
              desc: 'Set quiet hours to automatically silence notifications at night. DM @mentions still come through.',
              action: 'Set Schedule',
              targetTab: 'notifications',
              show: !(s?.dnd_enabled),
            },
            {
              id: 'privacy_toggles',
              icon: '👁',
              title: 'Privacy Controls',
              desc: 'Control read receipts, typing indicators, and link previews. All off by default — Discreet respects your privacy.',
              action: 'Review Privacy',
              targetTab: 'privacy',
              show: true,
            },
            {
              id: 'message_density',
              icon: '📐',
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
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, marginBottom: 4 }}>All caught up!</div>
                  <div style={{ fontSize: 12, color: T.mt, marginBottom: 16 }}>You've explored all available features.</div>
                  <button onClick={() => { setDismissedCards(new Set()); localStorage.removeItem('d_discover_dismissed'); }} style={{ padding: '6px 16px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 11, cursor: 'pointer' }}>Reset All Cards</button>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {visible.map(card => (
                  <div key={card.id} style={{ padding: '16px 14px', background: T.sf2, borderRadius: 12, border: `1px solid ${T.bd}`, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
                    <button onClick={() => dismissCard(card.id)} aria-label="Dismiss" style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 12, padding: 2, lineHeight: 1, opacity: 0.5 }} title="Dismiss">✕</button>
                    <div style={{ fontSize: 24 }}>{card.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>{card.title}</div>
                    <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5, flex: 1 }}>{card.desc}</div>
                    <button onClick={() => setTab(card.targetTab)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: T.ac, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' }}>{card.action}</button>
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* ── Appearance ── */}
        {tab === 'appearance' && (<>
          <div style={{ display: sectionVisible('theme') ? undefined : 'none' }}>
          <div data-section="theme" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Theme & Colors</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Theme</label>
              <select style={sel} value={s.theme || 'dark'} onChange={e => save('theme', e.target.value)}>
                <option value="dark">Dark</option><option value="onyx">Onyx (OLED Black)</option><option value="light">Light</option><option value="midnight">Midnight</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Accent Color</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {['#00d4aa', '#7289da', '#ff6b6b', '#faa61a', '#43b581', '#e91e63', '#9b59b6', '#1abc9c'].map(c => (
                  <div key={c} onClick={() => localStorage.setItem('d_accent', c)} style={{ width: 24, height: 24, borderRadius: 12, background: c, cursor: 'pointer', border: localStorage.getItem('d_accent') === c ? '2px solid #fff' : '2px solid transparent' }} />
                ))}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Text & Layout</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Font Size</label>
              <select style={sel} value={s.font_size || 'medium'} onChange={e => save('font_size', e.target.value)}>
                <option value="small">Small (13px)</option><option value="medium">Medium (15px)</option><option value="large">Large (18px)</option><option value="xl">Extra Large (20px)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Font Family</label>
              <select style={sel} value={localStorage.getItem('d_font') || 'dm-sans'} onChange={e => localStorage.setItem('d_font', e.target.value)}>
                <option value="dm-sans">DM Sans (Default)</option><option value="inter">Inter</option><option value="system">System UI</option><option value="mono">JetBrains Mono</option><option value="serif">Georgia (Serif)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Message Density</label>
              <select style={sel} value={s.message_density || 'comfortable'} onChange={e => { save('message_density', e.target.value); localStorage.setItem('d_msg_density', e.target.value); }}>
                <option value="comfortable">Comfortable (default)</option>
                <option value="compact">Compact</option>
                <option value="cozy">Cozy</option>
              </select>
              <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>
                {(s.message_density || 'comfortable') === 'compact' ? '2px gap, 28px avatars, inline timestamp' : (s.message_density || 'comfortable') === 'cozy' ? '12px gap, 44px avatars, spacious layout' : '8px gap, 36px avatars, balanced layout'}
              </div>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Chat Width</label>
              <select style={sel} value={localStorage.getItem('d_chat_width') || 'normal'} onChange={e => localStorage.setItem('d_chat_width', e.target.value)}>
                <option value="narrow">Narrow</option><option value="normal">Normal</option><option value="wide">Wide</option><option value="full">Full Width</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Chat Font Size: {s.chat_font_size || 14}px</label>
              <input
                type="range" min="12" max="20" step="1"
                value={s.chat_font_size || 14}
                onChange={e => {
                  const px = parseInt(e.target.value, 10);
                  save('chat_font_size', px);
                  localStorage.setItem('d_chat_font_size', String(px));
                  document.documentElement.style.setProperty('--chat-font-size', `${px}px`);
                }}
                style={{ width: '100%', accentColor: T.ac } as React.CSSProperties}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt, marginTop: 2 }}>
                <span>12px</span><span>14px</span><span>16px</span><span>18px</span><span>20px</span>
              </div>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Language</label>
              <select style={sel} value={s.locale || 'en'} onChange={e => save('locale', e.target.value)}>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="pt">Português</option>
                <option value="ru">Русский</option>
                <option value="uk">Українська</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="ar">العربية</option>
                <option value="fa">فارسی</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Timezone</label>
              <select style={sel} value={tzCtx.timezone} onChange={e => { const tz = e.target.value; tzCtx.setTimezone(tz); api.saveTimezone(tz).catch(() => {}); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
                {(() => { try { return Intl.supportedValuesOf('timeZone').map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>); } catch { return [detectedTimezone].map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>); } })()}
              </select>
              <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Auto-detected: {detectedTimezone.replace(/_/g, ' ')}</div>
            </div>
          </div>
          </div>
          <div style={{ display: sectionVisible('display-options') ? undefined : 'none' }}>
          <div data-section="display-options" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Display Options</div>
          {[
            { key: 'compact_mode',       label: 'Compact Mode',                    desc: 'Reduce padding and margins throughout the UI',                          setting: true  },
            { key: 'd_show_embeds',      label: 'Show Link Previews',              desc: 'Preview links with title, description, and images',                     local: true,   def: true },
            { key: 'd_show_avatars',     label: 'Show Avatars in Chat',            desc: 'Display user avatars next to messages',                                 local: true,   def: true },
            { key: 'd_show_timestamps',  label: 'Show Timestamps',                 desc: 'Display time next to every message',                                    local: true,   def: true },
            { key: 'd_show_join_leave',  label: 'Show Join/Leave Messages',        desc: 'Display system messages when users join or leave',                      local: true,   def: true },
            { key: 'd_animate_emoji',    label: 'Animate Emoji',                   desc: 'Play animated emoji and GIFs automatically',                            local: true,   def: true },
            { key: 'd_show_typing',      label: 'Show Typing Indicators',          desc: 'See when others are typing in a channel',                               local: true,   def: true },
            { key: 'd_sticker_preview',  label: 'Sticker & Emoji Previews',        desc: 'Show larger previews when hovering emoji/stickers',                     local: true,   def: true },
            { key: 'd_smooth_scroll',    label: 'Smooth Scrolling',                desc: 'Enable smooth scroll animations in chat',                               local: true,   def: true },
            { key: 'd_slash_suggestions',label: 'Slash Command Suggestions',       desc: 'Show autocomplete dropdown when typing / commands',                     local: true,   def: true },
            { key: 'd_show_recent_emoji',label: 'Show Recently Used Emojis',       desc: 'Show your recently used emojis section in the emoji picker',            local: true,   def: true },
            { key: 'd_twemoji_render',   label: 'Twemoji Rendering',               desc: 'Render emojis as Twemoji images (fixes flags on Windows)',              local: true,   def: true },
          ].map(opt => {
            const val = (opt as any).local
              ? localStorage.getItem(opt.key) !== (opt.def ? 'false' : 'true')
              : (opt.def ? s[opt.key] !== false : !!s[opt.key]);
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 8, marginBottom: 4 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
                <div onClick={() => { if ((opt as any).local) { localStorage.setItem(opt.key, val ? 'false' : 'true'); } else { save(opt.key, !val); } }}
                  style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
            );
          })}
          </div>
        </>)}

        {/* ── Voice & Audio ── */}
        {tab === 'voice' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Input Mode</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[{ id: 'vad', label: 'Voice Activity', desc: 'Auto-detect when you speak' }, { id: 'ptt', label: 'Push to Talk', desc: 'Hold a key to transmit' }].map(m => (
              <div key={m.id} onClick={() => { localStorage.setItem('d_vmode', m.id); voice.mode = m.id as any; }}
                style={{ flex: 1, padding: '12px 14px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${(localStorage.getItem('d_vmode') || 'vad') === m.id ? T.ac : T.bd}`, background: (localStorage.getItem('d_vmode') || 'vad') === m.id ? 'rgba(0,212,170,0.06)' : 'transparent', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: (localStorage.getItem('d_vmode') || 'vad') === m.id ? T.ac : T.tx }}>{m.label}</div>
                <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>{m.desc}</div>
              </div>
            ))}
          </div>
          {(localStorage.getItem('d_vmode') || 'vad') === 'vad' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Sensitivity</div>
              <input type="range" min="0.005" max="0.15" step="0.005" defaultValue={localStorage.getItem('d_vsens') || '0.02'} onChange={e => { localStorage.setItem('d_vsens', e.target.value); voice.sensitivity = parseFloat(e.target.value); }} style={{ width: '100%', accentColor: T.ac } as any} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt, marginTop: 2 }}><span>More Sensitive</span><span>Less Sensitive</span></div>
            </div>
          )}
          {(localStorage.getItem('d_vmode') || 'vad') === 'ptt' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Push-to-Talk Key</div>
              <div style={{ padding: '12px 16px', borderRadius: 8, border: `1px solid ${T.bd}`, background: T.sf2, fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: T.ac, textAlign: 'center', cursor: 'pointer' }}
                onClick={(e) => {
                  const el = e.currentTarget; el.textContent = 'Press any key...';
                  const handler = (ke: KeyboardEvent) => { ke.preventDefault(); voice.pttKey = ke.key; el.textContent = ke.key === ' ' ? 'Space' : ke.key; localStorage.setItem('d_pttkey', ke.key); document.removeEventListener('keydown', handler); };
                  document.addEventListener('keydown', handler);
                }}>{localStorage.getItem('d_pttkey') || '`'}</div>
            </div>
          )}
          <div style={{ padding: 12, background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginTop: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}>Audio Devices</div>
            <DeviceSelector label="Input (Microphone)" kind="audioinput" storageKey="d_audioIn" onChange={id => voice.setInputDevice(id)} />
            <DeviceSelector label="Output (Speakers/Headphones)" kind="audiooutput" storageKey="d_audioOut" onChange={id => voice.setOutputDevice(id)} />
            <DeviceSelector label="Camera" kind="videoinput" storageKey="d_videoIn" onChange={() => {}} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <TestMicrophoneButton />
              <TestSpeakerButton />
            </div>
          </div>
          <div style={{ padding: 12, background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}>Volume</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Input Volume</div>
              <input type="range" min="0" max="200" defaultValue={localStorage.getItem('d_inputVol') || '100'} onChange={e => { localStorage.setItem('d_inputVol', e.target.value); voice.inputGain = parseInt(e.target.value) / 100; }} style={{ width: '100%', accentColor: T.ac } as any} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>0%</span><span>{localStorage.getItem('d_inputVol') || '100'}%</span><span>200%</span></div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Output Volume</div>
              <input type="range" min="0" max="200" defaultValue={localStorage.getItem('d_outputVol') || '100'} onChange={e => { localStorage.setItem('d_outputVol', e.target.value); voice.outputGain = parseInt(e.target.value) / 100; }} style={{ width: '100%', accentColor: T.ac } as any} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>0%</span><span>{localStorage.getItem('d_outputVol') || '100'}%</span><span>200%</span></div>
            </div>
          </div>
          <div style={{ padding: 12, background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}><I.Sliders s={11} /> Audio Processing Chain</div>
            <div style={{ fontSize: 10, color: T.mt, marginBottom: 10, lineHeight: 1.4 }}>Signal path: Mic → Noise Suppression → Noise Gate → Compressor → EQ → Gain → Output. Inspired by OBS Studio's audio filter chain.</div>
            <AudioToggle label="Noise Suppression" storageKey="d_noiseSup" defaultVal={true} desc="AI-powered background noise removal (RNNoise)" onChange={v => voice.noiseSuppression = v} />
            <AudioToggle label="Echo Cancellation" storageKey="d_echoCan" defaultVal={true} desc="Prevents feedback loops from speakers to mic" onChange={v => voice.echoCancellation = v} />
            <AudioToggle label="Auto Gain Control" storageKey="d_agc" defaultVal={true} desc="Automatically levels your microphone" onChange={v => voice.autoGainControl = v} />

            {/* Noise Gate */}
            <div style={{ marginTop: 12, padding: 10, background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Noise Gate</span>
                <div onClick={() => { const v = localStorage.getItem('d_noiseGate') !== 'true'; localStorage.setItem('d_noiseGate', String(v)); (voice as any).noiseGate = v; }}
                  style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_noiseGate') === 'true' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_noiseGate') === 'true' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
              <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Cuts audio when signal falls below threshold. Like OBS's noise gate filter.</div>
              {[
                { key: 'd_ng_openThresh',  label: 'Open Threshold (dB)',  min: -60, max: 0,   step: 1,  def: -26 },
                { key: 'd_ng_closeThresh', label: 'Close Threshold (dB)', min: -60, max: 0,   step: 1,  def: -32 },
                { key: 'd_ng_attack',      label: 'Attack (ms)',          min: 1,   max: 100, step: 1,  def: 25  },
                { key: 'd_ng_hold',        label: 'Hold (ms)',            min: 0,   max: 500, step: 10, def: 200 },
                { key: 'd_ng_release',     label: 'Release (ms)',         min: 10,  max: 500, step: 10, def: 150 },
              ].map(p => (
                <div key={p.key} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>{p.label}</span><span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem(p.key) || p.def}</span></div>
                  <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={localStorage.getItem(p.key) || p.def} onChange={e => localStorage.setItem(p.key, e.target.value)} style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
                </div>
              ))}
            </div>

            {/* Compressor */}
            <div style={{ marginTop: 10, padding: 10, background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Compressor</span>
                <div onClick={() => { const v = localStorage.getItem('d_compressor') !== 'true'; localStorage.setItem('d_compressor', String(v)); }}
                  style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_compressor') === 'true' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_compressor') === 'true' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
              <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Reduces dynamic range — makes quiet sounds louder and loud sounds quieter. Like OBS's compressor filter.</div>
              {[
                { key: 'd_comp_ratio',   label: 'Ratio',              min: 1,   max: 20,   step: 0.5, def: 4   },
                { key: 'd_comp_thresh',  label: 'Threshold (dB)',     min: -60, max: 0,    step: 1,   def: -18 },
                { key: 'd_comp_attack',  label: 'Attack (ms)',        min: 1,   max: 100,  step: 1,   def: 6   },
                { key: 'd_comp_release', label: 'Release (ms)',       min: 10,  max: 1000, step: 10,  def: 60  },
                { key: 'd_comp_gain',    label: 'Output Gain (dB)',   min: 0,   max: 20,   step: 1,   def: 0   },
              ].map(p => (
                <div key={p.key} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>{p.label}</span><span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem(p.key) || p.def}</span></div>
                  <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={localStorage.getItem(p.key) || p.def} onChange={e => localStorage.setItem(p.key, e.target.value)} style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
                </div>
              ))}
            </div>

            {/* Expander */}
            <div style={{ marginTop: 10, padding: 10, background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Expander</span>
                <div onClick={() => { const v = localStorage.getItem('d_expander') !== 'true'; localStorage.setItem('d_expander', String(v)); }}
                  style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_expander') === 'true' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s' }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_expander') === 'true' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
              <div style={{ fontSize: 10, color: T.mt, marginBottom: 8 }}>Gradually reduces audio below threshold — smoother than noise gate.</div>
              {[
                { key: 'd_exp_ratio',   label: 'Ratio',          min: 1,  max: 10,  step: 0.5, def: 4   },
                { key: 'd_exp_thresh',  label: 'Threshold (dB)', min: -60, max: 0,  step: 1,   def: -30 },
                { key: 'd_exp_attack',  label: 'Attack (ms)',    min: 1,  max: 100, step: 1,   def: 10  },
                { key: 'd_exp_release', label: 'Release (ms)',   min: 10, max: 500, step: 10,  def: 100 },
              ].map(p => (
                <div key={p.key} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt }}><span>{p.label}</span><span style={{ color: T.ac, fontFamily: 'monospace' }}>{localStorage.getItem(p.key) || p.def}</span></div>
                  <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={localStorage.getItem(p.key) || p.def} onChange={e => localStorage.setItem(p.key, e.target.value)} style={{ width: '100%', accentColor: T.ac, height: 4 } as any} />
                </div>
              ))}
            </div>

            <div style={{ marginTop: 10 }}>
              <AudioToggle label="Audio Ducking" storageKey="d_ducking" defaultVal={false} desc="Auto-lower media volume when someone speaks (Ventrilo-style)" onChange={v => { (voice as any).ducking = v; }} />
              <AudioToggle label="Voice Normalization" storageKey="d_normalize" defaultVal={false} desc="Level all participants to similar volume" onChange={v => { (voice as any).normalization = v; }} />
            </div>

            {/* Equalizer */}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: T.tx, fontWeight: 600 }}>5-Band Equalizer</div>
                <select style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.ac, fontSize: 11, padding: '4px 8px', cursor: 'pointer' }} defaultValue="" onChange={e => {
                  if (!e.target.value) return;
                  const presets: Record<string, Record<string, number>> = {
                    flat:      { '60': 0, '250': 0, '1k': 0, '4k': 0, '16k': 0 },
                    rock:      { '60': 3, '250': 1, '1k': 0, '4k': 2, '16k': 3 },
                    hiphop:    { '60': 5, '250': 3, '1k': -1, '4k': 1, '16k': 2 },
                    pop:       { '60': 1, '250': 2, '1k': 3, '4k': 2, '16k': 1 },
                    country:   { '60': 2, '250': 1, '1k': 2, '4k': 3, '16k': 2 },
                    edm:       { '60': 4, '250': 2, '1k': 0, '4k': 1, '16k': 3 },
                    jazz:      { '60': 3, '250': 1, '1k': -1, '4k': 1, '16k': 2 },
                    classical: { '60': 1, '250': 0, '1k': 0, '4k': 1, '16k': 3 },
                    bass:      { '60': 6, '250': 4, '1k': 0, '4k': 0, '16k': 0 },
                    vocal:     { '60': -2, '250': 0, '1k': 3, '4k': 4, '16k': 1 },
                  };
                  const p = presets[e.target.value]; if (!p) return;
                  Object.entries(p).forEach(([f, v]) => { localStorage.setItem('d_eq_' + f, String(v)); voice.setEQ(f, v); });
                  e.target.value = '';
                }}>
                  <option value="">Presets ▾</option>
                  <option value="flat">🎚️ Flat (Neutral)</option><option value="rock">🎸 Rock & Roll</option>
                  <option value="hiphop">🎤 Hip-Hop / R&B</option><option value="pop">🎵 Pop</option>
                  <option value="country">🤠 Country</option><option value="edm">🎧 EDM / Electronic</option>
                  <option value="jazz">🎷 Jazz</option><option value="classical">🎻 Classical / Orchestral</option>
                  <option value="bass">🔊 Bass Boost</option><option value="vocal">🎙️ Vocal / Podcast</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end' }}>
                {[{ f: '60', l: '60' }, { f: '250', l: '250' }, { f: '1k', l: '1k' }, { f: '4k', l: '4k' }, { f: '16k', l: '16k' }].map(({ f, l }) => (
                  <div key={f} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '18%' }}>
                    <span style={{ fontSize: 9, color: T.ac, fontFamily: 'monospace', marginBottom: 2 }}>{localStorage.getItem('d_eq_' + f) || '0'}dB</span>
                    <input type="range" min="-12" max="12" defaultValue={localStorage.getItem('d_eq_' + f) || '0'} onChange={e => { localStorage.setItem('d_eq_' + f, e.target.value); voice.setEQ(f, parseFloat(e.target.value)); }} style={{ width: 60, height: 'auto', accentColor: T.ac, writingMode: 'vertical-lr', direction: 'rtl' } as any} />
                    <span style={{ fontSize: 9, color: T.mt, marginTop: 4 }}>{l}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.mt, marginTop: 4 }}><span>Bass</span><span>Mid</span><span>Treble</span></div>
              <button onClick={() => { ['60', '250', '1k', '4k', '16k'].forEach(f => { localStorage.setItem('d_eq_' + f, '0'); voice.setEQ(f, 0); }); }} className="pill-btn" style={{ marginTop: 6, fontSize: 10, color: T.mt, background: T.sf, border: `1px solid ${T.bd}`, padding: '4px 10px' }}>Reset EQ</button>
            </div>
          </div>
          {/* E2EE Voice Encryption */}
          <div style={{ padding: 12, background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 10 }}><I.Shield s={11} /> End-to-End Voice Encryption</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>End-to-End Voice Encryption</div>
                <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>Encrypts every audio and video frame with SFrame (RFC 9605). Requires browser support for Insertable Streams.</div>
              </div>
              <div onClick={() => { const v = localStorage.getItem('d_sframe_enabled') !== 'false'; localStorage.setItem('d_sframe_enabled', String(!v)); }}
                style={{ width: 36, height: 20, borderRadius: 10, background: localStorage.getItem('d_sframe_enabled') !== 'false' ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: localStorage.getItem('d_sframe_enabled') !== 'false' ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: T.mt, padding: '6px 8px', background: T.bg, borderRadius: 6, border: `1px solid ${T.bd}` }}>
              <span style={{ fontWeight: 600, color: T.tx }}>Cipher Suite:</span>
              <span style={{ fontFamily: 'monospace', color: T.ac }}>AES-256-GCM</span>
            </div>
          </div>

          <div style={{ padding: 12, background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>How Discreet Voice Works</div>
            <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.5 }}>Voice uses peer-to-peer WebRTC with echo cancellation and noise suppression. Audio goes directly between participants — it never touches our servers. SFrame (RFC 9605) encrypts every audio frame end-to-end when enabled.</div>
          </div>
        </>)}

        {/* ── My Profile ── */}
        {tab === 'profile' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Your Profile</div>
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
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>{displayName || api.username}</div>
              <div style={{ fontSize: 12, color: T.mt }}>@{api.username}</div>
              <div style={{ fontSize: 10, color: T.ac, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}><I.Lock s={8} /> E2EE Active</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={() => setShowAvatarCreator(true)} className="pill-btn" style={{ flex: 1, padding: '8px 0', background: `linear-gradient(135deg,${T.ac}22,${(T as any).ac2 || T.ac}22)`, color: T.ac, border: `1px solid ${T.ac}44`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>🎨 Create Avatar</button>
            {localStorage.getItem('d_my_avatar') && (
              <button onClick={() => { localStorage.removeItem('d_my_avatar'); const c = JSON.parse(localStorage.getItem('d_avatars') || '{}'); delete c[api.userId]; localStorage.setItem('d_avatars', JSON.stringify(c)); api.updateProfile({ avatar_url: '' }); setSaved(true); setTimeout(() => setSaved(false), 1500); }} className="pill-btn" style={{ padding: '8px 14px', background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, fontSize: 12 }}>Remove</button>
            )}
          </div>
          {showAvatarCreator && <AvatarCreator onClose={() => setShowAvatarCreator(false)} onSave={(dataUrl: string) => {
            localStorage.setItem('d_my_avatar', dataUrl);
            const avCache = JSON.parse(localStorage.getItem('d_avatars') || '{}'); avCache[api.userId] = dataUrl; localStorage.setItem('d_avatars', JSON.stringify(avCache));
            api.updateProfile({ avatar_url: dataUrl }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
            setShowAvatarCreator(false);
          }} />}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: T.mt, marginBottom: 4 }}>Display Name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...getInp(), flex: 1 }} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="How others see you" />
              <button onClick={saveDisplayName} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '8px 16px', whiteSpace: 'nowrap' }}>Save</button>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: T.mt, marginBottom: 4 }}>About Me (public bio)</label>
            <textarea value={bio} onChange={e => saveBio(e.target.value)} placeholder="Tell others about yourself..." rows={3}
              style={{ width: '100%', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 13, padding: '10px 12px', resize: 'vertical', fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box', outline: 'none' }} />
            <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>{bio.length}/190 characters</div>
          </div>
        </>)}

        {/* ── Privacy ── */}
        {tab === 'privacy' && (<>
          <div style={{ display: sectionVisible('privacy') ? undefined : 'none' }}>
          <div data-section="privacy" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Privacy</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Who can DM me</label>
              <select style={sel} value={s.dm_privacy || 'everyone'} onChange={e => save('dm_privacy', e.target.value)}>
                <option value="everyone">Everyone</option><option value="friends">Friends only</option><option value="nobody">Nobody</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Friend requests</label>
              <select style={sel} value={s.friend_request_privacy || 'everyone'} onChange={e => save('friend_request_privacy', e.target.value)}>
                <option value="everyone">Everyone</option><option value="friends_of_friends">Friends of friends</option><option value="nobody">Nobody</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Default Online Status</label>
              <select style={sel} value={s.default_status || 'online'} onChange={e => save('default_status', e.target.value)}>
                <option value="online">Online</option>
                <option value="idle">Idle</option>
                <option value="invisible">Invisible</option>
              </select>
              <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Your status on servers without a per-server override. Right-click a server icon to set per-server appearance.</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Show Shared Servers</div>
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>Let others see which servers you both share when they search for you.</div>
            </div>
            <div onClick={() => save('show_shared_servers', !(s.show_shared_servers === true))} style={{ width: 36, height: 20, borderRadius: 10, background: s.show_shared_servers === true ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: s.show_shared_servers === true ? 18 : 2, transition: 'left 0.2s' }} />
            </div>
          </div>
          {/* ─ Privacy Toggles (privacy-first defaults: all OFF) ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Communication Privacy</div>
          {[
            { key: 'show_read_receipts',    label: 'Show Read Receipts',    desc: 'Let others know when you\'ve read their messages. When off, you also cannot see others\' read status (mutual).', def: false },
            { key: 'show_typing_indicator',  label: 'Show Typing Indicator', desc: 'Let others see when you\'re typing. The server will not broadcast your typing events when off.', def: false },
            { key: 'show_link_previews',     label: 'Link Previews',         desc: 'Show rich previews for URLs in messages. Previews are generated client-side only — URLs are never sent to the server.', def: false },
          ].map(opt => {
            const val = s[opt.key] !== undefined ? !!s[opt.key] : opt.def;
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
                <div><div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div><div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>{opt.desc}</div></div>
                <div onClick={() => save(opt.key, !val)} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left 0.2s' }} />
                </div>
              </div>
            );
          })}
          </div>
          <div style={{ display: sectionVisible('interaction') ? undefined : 'none' }}>
          <div data-section="interaction" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Interaction Controls</div>
          {[
            { key: 'hide_online_status',      label: 'Hide Online Status from Non-Friends',        desc: 'Only friends can see when you\'re online, idle, or DND.', def: true },
            { key: 'hide_activity',            label: 'Hide Activity from Non-Friends',             desc: "Don't show what server you're in or what you're doing to non-friends.", def: true },
            { key: 'block_stranger_dms',       label: 'Block DMs from Server Strangers',            desc: 'People you share a server with but aren\'t friends with cannot DM you.', def: true },
            { key: 'require_mutual_friends',   label: 'Require Mutual Friends for Friend Requests', desc: 'Only allow friend requests from people who share a mutual friend with you.', def: false },
          ].map(opt => {
            const val = s[opt.key] !== undefined ? !!s[opt.key] : opt.def;
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
                <div><div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div><div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>{opt.desc}</div></div>
                <div onClick={() => save(opt.key, !val)} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left 0.2s' }} />
                </div>
              </div>
            );
          })}
          <div style={{ padding: '8px 12px', background: T.bg, borderRadius: 6, fontSize: 11, color: T.mt, lineHeight: 1.5, marginTop: 8 }}>
            <I.Shield /> Discreet respects your privacy. Shared server info is never publicly exposed.
          </div>
          </div>
          <OfflineContacts />
        </>)}

        {/* ── Account ── */}
        {tab === 'account' && (<>
          {/* ─ Security Status ─ */}
          <div style={{ display: sectionVisible('security-status') ? undefined : 'none' }}>
          <div data-section="security-status"><SecurityStatus
            platformUser={platformUser}
            onSetupStep={(step) => {
              if (step === 'verify-email') {
                // Scroll to / highlight email section — for now just show a toast-like hint
                const el = document.querySelector('[data-section="change-email"]');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
              // 2FA and recovery key buttons are in the Security section below
              if (step === 'setup-2fa') {
                const el = document.querySelector('[data-section="2fa"]');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
              if (step === 'recovery-key') {
                const el = document.querySelector('[data-section="recovery-key"]');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }}
          /></div>
          </div>

          {/* ─ Identity ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Identity</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Username</div>
              <div style={{ fontSize: 12, color: T.ac, fontFamily: 'monospace', marginTop: 2 }}>{api.username || '—'}</div>
            </div>
            <button onClick={() => navigator.clipboard?.writeText(api.userId || '')} style={{ fontSize: 10, color: T.mt, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }} title="Copy user ID">Copy ID</button>
          </div>
          <div style={{ display: sectionVisible('change-email') ? undefined : 'none' }}>
          <div data-section="change-email"><ChangeEmail /></div>
          </div>

          {/* ─ Plan ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Your Plan</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{(TIER_META as any)[platformUser?.account_tier ?? 'verified']?.icon ?? '✅'} {(TIER_META as any)[platformUser?.account_tier ?? 'verified']?.label ?? 'Free'}</div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>See what's available on other plans</div>
            </div>
            <button onClick={() => onUpgrade ? onUpgrade() : window.open('/app/tiers', '_blank')} className="pill-btn" style={{ background: `${T.ac}18`, color: T.ac, border: `1px solid ${T.ac}44`, padding: '6px 14px', fontSize: 11, fontWeight: 700 }}>View Plans</button>
          </div>

          {/* ─ Security ─ */}
          <div style={{ display: sectionVisible('security') ? undefined : 'none' }}>
          <div data-section="security" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Security</div>
          <ChangePassword />
          <div data-section="2fa" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
            <div><div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>Two-Factor Authentication (2FA) <I.Lock s={10} /></div><div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Add TOTP-based 2FA for extra account security</div></div>
            <button onClick={() => { alert('2FA setup will be available in a future update. Your account is still protected by password-based authentication and session management.'); }} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '6px 14px', fontSize: 11, fontWeight: 700 }}>Setup 2FA</button>
          </div>
          <div data-section="recovery-key" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
            <div><div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>Encryption Key Fingerprint <I.Lock s={10} /></div><div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Verify your identity key hasn't been tampered with</div></div>
            <button onClick={() => navigator.clipboard?.writeText(api.userId || '')} style={{ fontSize: 10, color: T.ac, background: 'none', border: `1px solid ${T.bd}`, borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace' }} title="Copy fingerprint">Copy</button>
          </div>

          </div>
          {/* ─ Active Devices ─ */}
          <div style={{ display: sectionVisible('active-devices') ? undefined : 'none' }}>
          <div data-section="active-devices" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Active Devices</div>
          <ActiveSessions />

          {/* ─ Danger Zone ─ */}
          <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,71,87,0.04)', borderRadius: 10, border: '1px solid rgba(255,71,87,0.15)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.err, textTransform: 'uppercase', marginBottom: 14 }}>Danger Zone</div>
            <RotateEncryptionKey />
            <div style={{ height: 1, background: 'rgba(255,71,87,0.1)', margin: '12px 0' }} />
            <ClearLocalCache />
            <div style={{ height: 1, background: 'rgba(255,71,87,0.1)', margin: '12px 0' }} />
            <div style={{ fontSize: 12, color: T.mt, marginBottom: 12, lineHeight: 1.6 }}>
              Permanently delete your account and <strong style={{ color: T.err }}>ALL</strong> associated data. <strong style={{ color: T.err }}>This action is irreversible.</strong>
            </div>
            <DeleteAccount />
          </div>
          </div>
        </>)}

        {/* ── Notifications ── */}
        {tab === 'notifications' && (<>

          {/* ─ Global level ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Message Notifications</div>
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 12, color: T.mt, display: 'block', marginBottom: 4 }}>Default notification level</label>
            <select style={{ ...sel, marginBottom: 0 }} value={s?.notification_level || 'all'} onChange={e => save('notification_level', e.target.value)}>
              <option value="all">All messages</option>
              <option value="mentions">Mentions only</option>
              <option value="nothing">Nothing</option>
            </select>
          </div>
          <NRow
            label="Mentions-only mode"
            sub="Only show a badge/alert when you are directly @mentioned"
            on={ns.mentionsOnly}
            onToggle={() => setN('mentionsOnly', !ns.mentionsOnly, 'd_notif_mentions_only')}
          />
          <NRow
            label="Group notifications"
            sub="Bundle multiple messages from the same channel into one alert"
            on={ns.group}
            onToggle={() => setN('group', !ns.group, 'd_notif_group')}
          />

          {/* ─ Sound alerts ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Sound Alerts</div>
          <NRow
            label="Enable sounds"
            sub="Master switch for all notification tones"
            on={ns.sounds}
            onToggle={() => setN('sounds', !ns.sounds, 'd_sounds')}
          />

          {ns.sounds && (<>
            <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.tx, marginBottom: 8 }}>Volume</div>
              <input
                type="range" min="0" max="100"
                value={Math.round(ns.vol * 100)}
                onChange={e => {
                  const v = parseInt(e.target.value) / 100;
                  setNs(p => ({ ...p, vol: v }));
                  localStorage.setItem('d_notif_vol', v.toFixed(2));
                }}
                style={{ width: '100%', accentColor: T.ac } as React.CSSProperties}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt, marginTop: 2 }}>
                <span>0%</span><span>{Math.round(ns.vol * 100)}%</span><span>100%</span>
              </div>
            </div>

            {([
              { key: 'soundSend',    lsKey: 'd_sound_send',           label: 'Message send',      sub: 'Short blip when you send a message',          test: 'send'    },
              { key: 'soundReceive', lsKey: 'd_sound_receive',        label: 'Message receive',   sub: 'Tone when a new message arrives',              test: 'message' },
              { key: 'soundMention', lsKey: 'd_notif_sound_mention',  label: 'Mention',           sub: 'Distinct chime when you are @mentioned',       test: 'mention' },
              { key: 'soundVoice',   lsKey: 'd_sound_voice',          label: 'Voice join / leave', sub: 'Sounds when users enter or leave voice chat', test: 'join'    },
            ] as const).map(opt => (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: T.mt }}>{opt.sub}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                  <button
                    onClick={() => notifSound.play(opt.test)}
                    title="Preview sound"
                    style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 5, color: T.mt, cursor: 'pointer', fontSize: 10, padding: '3px 8px' }}
                  >
                    ▶ Test
                  </button>
                  <Toggle on={ns[opt.key]} onToggle={() => setN(opt.key, !ns[opt.key], opt.lsKey)} />
                </div>
              </div>
            ))}
            {/* ─ Sound customization ─ */}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Sound Style</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 6 }}>
              {([
                { key: 'sound_dm',      lsKey: 'd_sound_dm',      label: 'DM Sound' },
                { key: 'sound_server',  lsKey: 'd_sound_server',  label: 'Server Message' },
                { key: 'sound_mention', lsKey: 'd_sound_mention', label: '@Mention' },
              ] as const).map(opt => (
                <div key={opt.key}>
                  <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>{opt.label}</label>
                  <select
                    style={sel}
                    value={s[opt.key] || 'default'}
                    onChange={e => {
                      const v = e.target.value;
                      save(opt.key, v);
                      localStorage.setItem(opt.lsKey, v);
                      previewSound(v as any);
                    }}
                  >
                    {SOUND_OPTIONS.map(so => (
                      <option key={so.value} value={so.value}>{so.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: T.mt, lineHeight: 1.5, padding: '4px 0' }}>
              Sounds are synthesized locally — no audio files are downloaded.
            </div>
          </>)}

          {/* ─ Desktop notifications ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Desktop Notifications</div>

          {/* Permission status */}
          <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ns.desktopPerm !== 'granted' ? 8 : 0 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Browser permission</div>
                <div style={{ fontSize: 11, color: ns.desktopPerm === 'granted' ? '#3ba55d' : ns.desktopPerm === 'denied' ? T.err : T.mt }}>
                  {ns.desktopPerm === 'granted' ? '✓ Granted' : ns.desktopPerm === 'denied' ? '✕ Denied — change in browser settings' : '⚠ Not yet requested'}
                </div>
              </div>
              {ns.desktopPerm !== 'granted' && ns.desktopPerm !== 'denied' && (
                <button
                  onClick={requestDesktopPermission}
                  style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: T.ac, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Allow
                </button>
              )}
            </div>
          </div>

          <NRow
            label="Enable desktop notifications"
            sub="Show OS notifications when Discreet is in the background"
            on={ns.desktop && ns.desktopPerm === 'granted'}
            disabled={ns.desktopPerm !== 'granted'}
            onToggle={() => ns.desktopPerm === 'granted' && setN('desktop', !ns.desktop, 'd_notif_desktop')}
          />

          {ns.desktop && ns.desktopPerm === 'granted' && (
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 12, color: T.mt, display: 'block', marginBottom: 4 }}>Show desktop notification for</label>
              <select
                style={{ ...sel, marginBottom: 0 }}
                value={ns.desktopLevel}
                onChange={e => setN('desktopLevel', e.target.value as typeof ns.desktopLevel, 'd_notif_desktop_level')}
              >
                <option value="all">All messages</option>
                <option value="mentions">Mentions only</option>
                <option value="dms">DMs only</option>
              </select>
            </div>
          )}

          {/* ─ Do Not Disturb ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Do Not Disturb</div>
          <NRow
            label="Manual DND override"
            sub="Immediately suppress all notifications (overrides schedule)"
            on={ns.dnd}
            onToggle={() => setN('dnd', !ns.dnd, 'd_notif_dnd')}
          />
          {ns.dnd && (
            <div style={{ padding: '8px 14px', background: 'rgba(237,66,69,0.08)', borderRadius: 8, border: '1px solid rgba(237,66,69,0.2)', marginBottom: 6, fontSize: 11, color: '#ed4245', display: 'flex', alignItems: 'center', gap: 6 }}>
              🌙 DND is active — all notifications suppressed except DM @mentions.
            </div>
          )}
          <div style={{ padding: '14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Scheduled quiet hours</div>
                <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Automatically enable DND during these times. DM @mentions still come through.</div>
              </div>
              <Toggle on={ns.dndSchedule} onToggle={() => {
                const next = !ns.dndSchedule;
                setN('dndSchedule', next, 'd_notif_dnd_schedule');
                save('dnd_enabled', next);
              }} />
            </div>

            {ns.dndSchedule && (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Start</label>
                  <input
                    type="time"
                    value={ns.dndStart}
                    onChange={e => { setN('dndStart', e.target.value, 'd_notif_dnd_start'); save('dnd_start', e.target.value); }}
                    style={{ ...getInp(), marginBottom: 0, width: '100%', boxSizing: 'border-box' } as React.CSSProperties}
                  />
                </div>
                <div style={{ color: T.mt, fontSize: 13, paddingTop: 18 }}>→</div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>End</label>
                  <input
                    type="time"
                    value={ns.dndEnd}
                    onChange={e => { setN('dndEnd', e.target.value, 'd_notif_dnd_end'); save('dnd_end', e.target.value); }}
                    style={{ ...getInp(), marginBottom: 0, width: '100%', boxSizing: 'border-box' } as React.CSSProperties}
                  />
                </div>
              </div>
              <div style={{ fontSize: 11, color: T.mt, marginBottom: 6 }}>Active on:</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
                  const activeDays = ns.dndDays.split(',').map(Number);
                  const isActive = activeDays.includes(i);
                  return (
                    <div key={day} onClick={() => {
                      const next = isActive ? activeDays.filter(d => d !== i) : [...activeDays, i].sort();
                      const daysStr = next.join(',');
                      setN('dndDays', daysStr, 'd_notif_dnd_days');
                      save('dnd_days', daysStr);
                    }} style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: isActive ? `${T.ac}22` : T.bg,
                      color: isActive ? T.ac : T.mt,
                      border: `1px solid ${isActive ? T.ac : T.bd}`,
                      transition: 'all .15s',
                    }}>{day}</div>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: T.mt, marginTop: 8 }}>
                🌙 {ns.dndStart} — {ns.dndEnd} on selected days. Synced to your account.
              </div>
            </>)}
          </div>

          {/* ─ @everyone suppression ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Mention Controls</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Suppress @everyone and @here</div>
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>The text still shows, but you won't get pinged or notified. Applies to all servers.</div>
            </div>
            <div onClick={() => save('suppress_all_everyone', !(s.suppress_all_everyone === true))} role="switch" aria-checked={s.suppress_all_everyone === true} style={{ width: 36, height: 20, borderRadius: 10, background: s.suppress_all_everyone === true ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: s.suppress_all_everyone === true ? 18 : 2, transition: 'left 0.2s' }} />
            </div>
          </div>

          {/* ─ Per-server mute ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Per-Server Settings</div>
          {notifServers.length === 0 && (
            <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', padding: '16px 0' }}>No servers — join one to configure per-server notifications.</div>
          )}
          {notifServers.map(sv => {
            const muted      = muteServerIds.includes(sv.id);
            const mentionOnly = mentionServerIds.includes(sv.id);
            return (
              <div key={sv.id} style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
                {/* Server name row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: sv.icon_url ? 'transparent' : `${T.ac}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: T.ac, overflow: 'hidden', flexShrink: 0 }}>
                    {sv.icon_url ? <img src={sv.icon_url} alt="" style={{ width: 28, height: 28, objectFit: 'cover' }} /> : sv.name[0]?.toUpperCase()}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: muted ? T.mt : T.tx, flex: 1 }}>{sv.name}</span>
                  {muted && <span style={{ fontSize: 10, color: T.mt, background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, padding: '1px 6px' }}>Muted</span>}
                </div>
                {/* Controls */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: T.tx }}>Mute server</span>
                    <Toggle on={muted} onToggle={() => toggleMuteServer(sv.id)} />
                  </div>
                  {!muted && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: T.tx }}>Mentions only</span>
                      <Toggle on={mentionOnly} onToggle={() => toggleMentionServer(sv.id)} />
                    </div>
                  )}
                  {!muted && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: T.tx }}>Event reminders</span>
                      <Toggle on={localStorage.getItem(`d_event_reminders_${sv.id}`) !== 'false'} onToggle={() => {
                        const key = `d_event_reminders_${sv.id}`;
                        const cur = localStorage.getItem(key) !== 'false';
                        localStorage.setItem(key, cur ? 'false' : 'true');
                        api.fetch(`/servers/${sv.id}/notification-settings`, { method: 'PATCH', body: JSON.stringify({ event_reminders: !cur }) }).catch(() => {});
                      }} />
                    </div>
                  )}
                  {!muted && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: T.tx }}>Email reminders</span>
                      <Toggle on={localStorage.getItem(`d_email_reminders_${sv.id}`) === 'true'} onToggle={() => {
                        const key = `d_email_reminders_${sv.id}`;
                        const cur = localStorage.getItem(key) === 'true';
                        localStorage.setItem(key, cur ? 'false' : 'true');
                        api.fetch(`/servers/${sv.id}/notification-settings`, { method: 'PATCH', body: JSON.stringify({ email_reminders: !cur }) }).catch(() => {});
                      }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* ─ Status & Presence (preserved from original) ─ */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Status & Presence</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Auto-Idle Timeout</div>
            <select style={sel} value={localStorage.getItem('d_idle_timeout') || '300'} onChange={e => localStorage.setItem('d_idle_timeout', e.target.value)}>
              <option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes (default)</option>
              <option value="600">10 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option>
              <option value="3600">1 hour</option><option value="0">Never (stay online)</option>
            </select>
            <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Automatically switch to Idle after this much inactivity.</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Show Media Automatically</div>
            {[
              { key: 'd_show_images', label: 'Auto-show images in chat' },
              { key: 'd_show_videos', label: 'Auto-play videos in chat'  },
            ].map(opt => {
              const val = localStorage.getItem(opt.key) !== 'false';
              return (
                <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: T.tx }}>{opt.label}</span>
                  <Toggle on={val} onToggle={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} />
                </div>
              );
            })}
          </div>
        </>)}

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
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 8, marginBottom: 4 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
                <div onClick={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
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
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 8, marginBottom: 4 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
                <div onClick={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
            );
          })}
        </>)}

        {/* ── Accessibility ── */}
        {tab === 'accessibility' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Accessibility</div>
          {[
            { key: 'd_reduce_motion', label: 'Reduce Motion',             desc: 'Disable all animations and transitions throughout the UI. Respects your OS preference automatically.' },
            { key: 'd_high_contrast', label: 'High Contrast Mode',        desc: 'Boost borders and text contrast to meet WCAG AAA standards. Improves readability in all lighting conditions.' },
            { key: 'd_focus_rings',   label: 'Focus Indicators',          desc: 'Show visible outlines on keyboard-focused elements for navigation without a mouse.' },
            { key: 'd_screen_reader', label: 'Screen Reader Optimized',   desc: 'Enhanced ARIA labels and landmarks for screen readers.' },
            { key: 'd_large_click',   label: 'Large Click Targets',       desc: 'Increase button and link sizes for easier interaction.' },
            { key: 'd_dyslexia_font', label: 'Dyslexia-Friendly Font',    desc: 'Use OpenDyslexic font for improved readability.' },
          ].map(opt => {
            const val = localStorage.getItem(opt.key) === 'true';
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 8, marginBottom: 4 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
                <div onClick={() => {
                  const next = !val;
                  localStorage.setItem(opt.key, String(next));
                  // Apply immediately via DOM classes
                  const root = document.querySelector('.chat-root');
                  if (root) {
                    if (opt.key === 'd_reduce_motion') root.classList.toggle('reduce-motion', next);
                    if (opt.key === 'd_high_contrast') { root.classList.toggle('high-contrast', next); (root as HTMLElement).style.background = next ? '#000' : ''; }
                    if (opt.key === 'd_focus_rings') root.classList.toggle('focus-visible', next);
                  }
                  // Force re-render of this component
                  setS(p => ({ ...p }));
                }} role="switch" aria-checked={val} aria-label={opt.label} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
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
        {tab === 'keybinds' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Keyboard Shortcuts</div>
          <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Quick Reference</div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Press <kbd style={{ padding: '1px 6px', borderRadius: 3, border: `1px solid ${T.bd}`, background: T.bg, fontSize: 10, fontFamily: 'monospace', color: T.ac }}>Ctrl</kbd> + <kbd style={{ padding: '1px 6px', borderRadius: 3, border: `1px solid ${T.bd}`, background: T.bg, fontSize: 10, fontFamily: 'monospace', color: T.ac }}>/</kbd> anywhere to view all shortcuts</div>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Built-in Shortcuts</div>
          <div style={{ marginBottom: 14 }}>
            {[
              { keys: 'Ctrl + K', desc: 'Quick switcher' },
              { keys: 'Ctrl + /', desc: 'Shortcuts help' },
              { keys: 'Ctrl + Shift + M', desc: 'Toggle mute' },
              { keys: 'Ctrl + Shift + D', desc: 'Toggle deafen' },
              { keys: 'Ctrl + E', desc: 'Emoji picker' },
              { keys: '↑ (empty input)', desc: 'Edit last message' },
              { keys: 'Escape', desc: 'Close modal/overlay' },
            ].map(sc => (
              <div key={sc.keys} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', background: T.sf2, borderRadius: 6, marginBottom: 3, fontSize: 12 }}>
                <span style={{ color: T.tx }}>{sc.desc}</span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: T.mt }}>{sc.keys}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Custom Keybinds</div>
          <div style={{ fontSize: 12, color: T.mt, marginBottom: 12 }}>Click any key to rebind. Press Escape to cancel, Delete to clear.</div>
          {[
            { key: 'd_kb_ptt',       label: 'Push to Talk',       def: '`'        },
            { key: 'd_kb_mute',      label: 'Toggle Mute',        def: 'm'        },
            { key: 'd_kb_deafen',    label: 'Toggle Deafen',      def: 'd'        },
            { key: 'd_kb_search',    label: 'Search',             def: '/'        },
            { key: 'd_kb_emoji',     label: 'Emoji Picker',       def: 'e'        },
            { key: 'd_kb_gif',       label: 'GIF Picker',         def: 'g'        },
            { key: 'd_kb_edit',      label: 'Edit Last Message',  def: 'ArrowUp'  },
            { key: 'd_kb_reply',     label: 'Reply to Last',      def: 'r'        },
            { key: 'd_kb_mark_read', label: 'Mark as Read',       def: 'Escape'   },
            { key: 'd_kb_settings',  label: 'Settings',           def: ','        },
          ].map(kb => {
            const current = localStorage.getItem(kb.key) || kb.def;
            return (
              <div key={kb.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: T.sf2, borderRadius: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{kb.label}</span>
                <div onClick={e => {
                  const el = e.currentTarget; el.textContent = '...'; el.style.borderColor = T.ac;
                  const h = (ke: KeyboardEvent) => {
                    ke.preventDefault(); ke.stopPropagation();
                    if (ke.key === 'Escape') { el.textContent = current === 'ArrowUp' ? '↑' : current; }
                    else if (ke.key === 'Delete') { localStorage.removeItem(kb.key); el.textContent = 'None'; }
                    else { localStorage.setItem(kb.key, ke.key); el.textContent = ke.key === ' ' ? 'Space' : ke.key === 'ArrowUp' ? '↑' : ke.key; }
                    el.style.borderColor = T.bd; document.removeEventListener('keydown', h);
                  };
                  document.addEventListener('keydown', h);
                }} style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${T.bd}`, background: T.bg, fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: T.ac, cursor: 'pointer', minWidth: 40, textAlign: 'center' }}>
                  {current === ' ' ? 'Space' : current === 'ArrowUp' ? '↑' : current}
                </div>
              </div>
            );
          })}
          <button onClick={() => { ['d_kb_ptt', 'd_kb_mute', 'd_kb_deafen', 'd_kb_search', 'd_kb_emoji', 'd_kb_gif', 'd_kb_edit', 'd_kb_reply', 'd_kb_mark_read', 'd_kb_settings'].forEach(k => localStorage.removeItem(k)); }} className="pill-btn" style={{ marginTop: 6, fontSize: 10, color: T.mt, background: T.sf, border: `1px solid ${T.bd}`, padding: '4px 12px' }}>Reset All</button>
        </>)}

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
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${proxyType === p.id ? T.ac : T.bd}`, background: proxyType === p.id ? 'rgba(0,212,170,0.06)' : 'transparent', textAlign: 'center' }}>
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
              <div style={{ padding: '8px 12px', background: 'rgba(0,212,170,0.08)', borderRadius: 8, border: `1px solid ${T.ac}22`, marginBottom: 12, fontSize: 11, color: T.ac, fontWeight: 600 }}>
                Proxy configured: {proxyType.toUpperCase()}://{proxyHost}:{proxyPort}
              </div>
            )}
            {isTauri && proxyType !== 'none' && (
              <div style={{ padding: '8px 12px', background: 'rgba(250,166,26,0.08)', borderRadius: 8, border: '1px solid rgba(250,166,26,0.15)', marginBottom: 12, fontSize: 11, color: T.warn, fontWeight: 600 }}>
                Restart the desktop app to apply proxy changes to the system webview.
              </div>
            )}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>VPN & Privacy</div>
            <div style={{ padding: '10px 12px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
              Discreet works with any VPN. For maximum privacy, we recommend using a VPN that doesn't log traffic.
              <div style={{ marginTop: 8, fontSize: 10, color: T.mt }}>
                Your messages are end-to-end encrypted regardless of whether you use a VPN or proxy. These settings only affect the transport layer — the server cannot read your message content either way.
              </div>
            </div>
            {isTauri && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Desktop Proxy</div>
                <div style={{ padding: '10px 12px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
                  Proxy settings are applied to the WebView2 browser engine via <code style={{ color: T.ac }}>--proxy-server</code>. All HTTP, WebSocket, and media traffic routes through your configured proxy. Changes require an app restart.
                </div>
              </>
            )}
            {!isTauri && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Desktop App (Tauri)</div>
                <div style={{ padding: '10px 12px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
                  In the Discreet desktop app, proxy settings are passed to the system webview. SOCKS5 proxies are applied at the OS network level via Tauri's proxy configuration. Restart the app after changing proxy settings.
                </div>
              </>
            )}
          </>);
        })()}

        {tab === 'advanced' && (<>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Advanced Settings</div>
          <div style={{ fontSize: 11, color: T.warn, marginBottom: 12, padding: '8px 12px', background: 'rgba(250,166,26,0.08)', borderRadius: 8, border: '1px solid rgba(250,166,26,0.15)' }}>⚠️ Power user settings. Incorrect changes may affect performance.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>WS Reconnect</label>
              <select style={sel} value={localStorage.getItem('d_ws_reconnect') || '3000'} onChange={e => localStorage.setItem('d_ws_reconnect', e.target.value)}>
                <option value="1000">1s (aggressive)</option><option value="3000">3s (default)</option><option value="5000">5s</option><option value="10000">10s (saver)</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Message Cache</label>
              <select style={sel} value={localStorage.getItem('d_msg_cache') || '200'} onChange={e => localStorage.setItem('d_msg_cache', e.target.value)}>
                <option value="50">50 msgs</option><option value="100">100 msgs</option><option value="200">200 (default)</option><option value="500">500 msgs</option><option value="1000">1000 msgs</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Image Quality</label>
              <select style={sel} value={localStorage.getItem('d_img_quality') || 'high'} onChange={e => localStorage.setItem('d_img_quality', e.target.value)}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High (default)</option><option value="original">Original</option>
              </select>
            </div>
            <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Max Upload</label>
              <div style={{ padding: '8px 12px', background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}`, fontSize: 12, color: T.ac, fontFamily: 'monospace' }}>50 MB</div>
            </div>
          </div>
          {[
            { key: 'd_dev_tools',    label: 'Developer Mode',          desc: 'Show IDs and API debug info' },
            { key: 'd_raw_cipher',   label: 'Show Raw Ciphertext',      desc: 'Display encrypted data alongside decrypted messages' },
            { key: 'd_perf_overlay', label: 'Performance Overlay',      desc: 'FPS, memory, WebSocket latency' },
            { key: 'd_verbose_log',  label: 'Verbose Console Logs',     desc: 'Log all API calls and WS events' },
            { key: 'd_experimental', label: 'Experimental Features',    desc: 'Enable unstable features in development' },
          ].map(opt => {
            const val = localStorage.getItem(opt.key) === 'true';
            return (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: T.sf2, borderRadius: 8, marginBottom: 3 }}>
                <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt }}>{opt.desc}</div></div>
                <div onClick={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, padding: 10, background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.err, textTransform: 'uppercase', marginBottom: 8 }}>Danger Zone</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => { if (confirm('Clear ALL local settings?')) { localStorage.clear(); window.location.reload(); } }} className="pill-btn" style={{ background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.3)', padding: '5px 12px', fontSize: 10 }}>Reset All Settings</button>
              <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(localStorage))} className="pill-btn" style={{ background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, padding: '5px 12px', fontSize: 10 }}>Export Settings</button>
            </div>
          </div>
          {localStorage.getItem('d_dev_tools') === 'true' && (
            <div style={{ marginTop: 16, padding: 12, background: T.bg, borderRadius: 10, border: `1px solid ${T.ac}22` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.ac, textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>💻 Developer Tools</div>
              <div style={{ fontSize: 11, color: T.mt, marginBottom: 10 }}>API testing and debugging tools. Available to verified accounts on their own servers.</div>
              <DevTools curServer={curServer} />
            </div>
          )}
        </>)}

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
            <span style={{ fontSize: 22 }}>{platformUser?.platform_role === 'admin' ? '👑' : '🔧'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>{platformUser?.platform_role === 'admin' ? 'Platform Admin' : 'Developer'}</div>
              <div style={{ fontSize: 11, color: T.mt }}>platform_role: {platformUser?.platform_role} · account_tier: {platformUser?.account_tier}</div>
            </div>
            {/* Permission chips inline */}
            {(platformUser?.permissions ?? []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 280, justifyContent: 'flex-end' }}>
                {(platformUser?.permissions ?? []).map((p: string) => (
                  <span key={p} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: `${T.ac}18`, border: `1px solid ${T.ac}33`, color: T.ac, fontFamily: 'monospace' }}>{p}</span>
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
              {(TIER_META as any)[platformUser?.account_tier ?? '']?.icon ?? '❓'}{' '}
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
              <option value="guest">👤 Guest</option>
              <option value="unverified">📬 Unverified</option>
              <option value="verified">✅ Verified</option>
              <option value="pro">⚡ Pro</option>
              <option value="teams">🏢 Teams</option>
              <option value="enterprise">🏛 Enterprise</option>
            </select>
            {devTierOverride && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(250,166,26,0.08)', border: '1px solid rgba(250,166,26,0.3)', borderRadius: 8, fontSize: 12, color: '#faa61a' }}>
                ⚠ UI showing <strong>{devTierOverride}</strong> tier limits. Actual server permissions are unchanged.
              </div>
            )}
          </div>

          {/* Resources */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Resources</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { href: '/api/v1/info',           label: '🖥 API Info' },
              { href: '/api/v1/platform/me',    label: '👤 My Platform Profile' },
              { href: '/api/v1/admin/stats',    label: '📊 Admin Stats' },
            ].map(({ href, label }) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 12px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 7, color: T.mt, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = T.ac)}
                onMouseLeave={e => (e.currentTarget.style.color = T.mt)}>
                {label}
              </a>
            ))}
          </div>
        </>)}

        {errMsg && <div style={{ padding: '8px 12px', background: 'rgba(255,71,87,0.08)', borderRadius: 8, color: T.err, fontSize: 13, textAlign: 'center', marginTop: 8 }}>{errMsg}</div>}
        {saved && <div style={{ padding: '8px 12px', background: 'rgba(0,212,170,0.08)', borderRadius: 8, color: T.ac, fontSize: 13, textAlign: 'center', marginTop: 8 }}>Settings saved!</div>}
      </>)}
    </Modal>
  );
}
