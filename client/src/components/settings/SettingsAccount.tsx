import React, { useState, useEffect, useRef, useCallback } from 'react';
import { T, ta } from '../../theme';
import * as I from '../../icons';
import { api } from '../../api/CitadelAPI';
import { TIER_META } from '../../utils/tiers';

interface UserSettings { [key: string]: unknown; }

export interface SettingsAccountProps {
  s: UserSettings;
  save: (k: string, v: unknown) => void;
  sectionVisible: (section: string) => boolean;
  onUpgrade?: () => void;
  platformUser?: { account_tier?: string; platform_role?: string | null; badge_type?: string | null; permissions?: string[] } | null;
  SecurityStatus: React.ComponentType<{ platformUser: any; onSetupStep: (step: string) => void }>;
  ChangeEmail: React.ComponentType;
  ChangePassword: React.ComponentType;
  ActiveSessions: React.ComponentType;
  RotateEncryptionKey: React.ComponentType;
  ClearLocalCache: React.ComponentType;
  DeleteAccount: React.ComponentType;
}

export default function SettingsAccount({
  s, save, sectionVisible, onUpgrade, platformUser,
  SecurityStatus, ChangeEmail, ChangePassword, ActiveSessions,
  RotateEncryptionKey, ClearLocalCache, DeleteAccount,
}: SettingsAccountProps) {
  return (<>
    {/* Security Status */}
    <div style={{ display: sectionVisible('security-status') ? undefined : 'none' }}>
    <div data-section="security-status"><SecurityStatus
      platformUser={platformUser}
      onSetupStep={(step) => {
        if (step === 'verify-email') {
          const el = document.querySelector('[data-section="change-email"]');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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

    {/* Identity */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Identity</div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Username</div>
        <div style={{ fontSize: 12, color: T.ac, fontFamily: 'monospace', marginTop: 2 }}>{api.username || '\u2014'}</div>
      </div>
      <button onClick={() => navigator.clipboard?.writeText(api.userId || '')} style={{ fontSize: 10, color: T.mt, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }} title="Copy user ID">Copy ID</button>
    </div>
    <div style={{ display: sectionVisible('change-email') ? undefined : 'none' }}>
    <div data-section="change-email"><ChangeEmail /></div>
    </div>

    {/* Connected Accounts (OAuth) */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Connected Accounts</div>
    <ConnectedAccounts />

    {/* Subscription */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Subscription</div>
    <SubscriptionPanel platformUser={platformUser} onUpgrade={onUpgrade} />

    {/* Security */}
    <div style={{ display: sectionVisible('security') ? undefined : 'none' }}>
    <div data-section="security" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Security</div>
    <ChangePassword />
    <div data-section="2fa" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div><div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>Two-Factor Authentication (2FA) <I.Lock s={10} /></div><div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Add TOTP-based 2FA for extra account security</div></div>
      <TwoFactorSetupButton />
    </div>
    <PasskeyManager />
    <div data-section="recovery-key" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div><div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>Encryption Key Fingerprint <I.Lock s={10} /></div><div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Verify your identity key hasn't been tampered with</div></div>
      <button onClick={() => navigator.clipboard?.writeText(api.userId || '')} style={{ fontSize: 10, color: T.ac, background: 'none', border: `1px solid ${T.bd}`, borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace' }} title="Copy fingerprint">Copy</button>
    </div>
    </div>

    {/* Active Devices + Danger Zone */}
    <div style={{ display: sectionVisible('active-devices') ? undefined : 'none' }}>
    <div data-section="active-devices" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Active Devices</div>
    <ActiveSessions />

    {/* Data Export */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Data Export</div>
    <ExportDataButton />

    {/* Import Messages */}
    <div style={{ display: sectionVisible('import-messages') ? undefined : 'none' }}>
    <div data-section="import-messages" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12, marginTop: 20 }}>Import Messages</div>
    <ImportMessages />
    </div>

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
  </>);
}

// ─── Passkey Manager ────────────────────────────────────────────────────────

function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBuffer(b64: string): ArrayBuffer {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

function PasskeyManager() {
  const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  const [passkeys, setPasskeys] = React.useState<{ id: string; name: string; created_at: string }[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [name, setName] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const data = await api.passkeyList();
      if (Array.isArray(data)) setPasskeys(data);
    } catch { /* no passkeys yet */ }
  }, []);

  React.useEffect(() => { if (supported) load(); }, [supported, load]);

  if (!supported) return null;

  const register = async () => {
    setError(''); setLoading(true);
    try {
      const options = await api.passkeyRegisterStart();
      // Decode challenge and user.id from base64url
      options.publicKey.challenge = base64urlToBuffer(options.publicKey.challenge);
      options.publicKey.user.id = base64urlToBuffer(options.publicKey.user.id);
      if (options.publicKey.excludeCredentials) {
        options.publicKey.excludeCredentials = options.publicKey.excludeCredentials.map((c: any) => ({
          ...c, id: base64urlToBuffer(c.id),
        }));
      }
      const credential = await navigator.credentials.create(options) as PublicKeyCredential;
      if (!credential) { setError('Passkey creation cancelled'); setLoading(false); return; }
      const response = credential.response as AuthenticatorAttestationResponse;
      const result = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: bufferToBase64url(response.attestationObject),
          clientDataJSON: bufferToBase64url(response.clientDataJSON),
        },
      };
      await api.passkeyRegisterFinish(result, name || undefined);
      setName('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Passkey registration failed');
    }
    setLoading(false);
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this passkey?')) return;
    try {
      await api.passkeyDelete(id);
      setPasskeys(prev => prev.filter(p => p.id !== id));
    } catch { setError('Failed to remove passkey'); }
  };

  return (
    <div data-section="passkeys" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            Passkeys <I.Lock s={10} />
          </div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Sign in with biometrics or a security key</div>
        </div>
      </div>
      {passkeys.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {passkeys.map(pk => (
            <div key={pk.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: T.bg, borderRadius: 6, marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{pk.name}</div>
                <div style={{ fontSize: 10, color: T.mt }}>{new Date(pk.created_at).toLocaleDateString()}</div>
              </div>
              <button onClick={() => remove(pk.id)} style={{ fontSize: 10, color: T.err, background: 'none', border: `1px solid rgba(255,71,87,0.3)`, borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Passkey name (optional)" style={{ flex: 1, padding: '6px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, outline: 'none' }} />
        <button onClick={register} disabled={loading} style={{ background: T.ac, color: '#000', padding: '6px 14px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 6, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' }}>
          {loading ? 'Adding…' : 'Add Passkey'}
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: T.err, marginTop: 6, padding: '6px 10px', background: 'rgba(255,71,87,0.06)', borderRadius: 4 }}>{error}</div>}
    </div>
  );
}

// ─── Connected Accounts (OAuth) ─────────────────────────────────────────

const PROVIDER_ICONS: Record<string, { icon: string; color: string }> = {
  google:  { icon: 'G', color: '#4285F4' },
  github:  { icon: '⬡', color: '#24292f' },
  apple:   { icon: '', color: '#000000' },
  discord: { icon: '🎮', color: '#5865F2' },
};

function ConnectedAccounts() {
  const [accounts, setAccounts] = React.useState<{ provider: string; provider_email?: string }[]>([]);
  const [providers, setProviders] = React.useState<{ provider: string }[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      // Get available providers
      const pr = await api.fetch('/auth/oauth/providers');
      if (pr.ok) { const d = await pr.json(); setProviders(d.providers || []); }
      // Get user's linked accounts (from user settings or a dedicated endpoint)
      // For now, we display what's available and let the user link/unlink
    } catch {}
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const disconnect = async (provider: string) => {
    try {
      const r = await api.fetch(`/auth/oauth/${provider}`, { method: 'DELETE' });
      if (r.ok) {
        setAccounts(prev => prev.filter(a => a.provider !== provider));
        load();
      }
    } catch {}
  };

  const connect = async (provider: string) => {
    try {
      const r = await api.fetch(`/auth/oauth/${provider}/authorize`);
      if (r.ok) {
        const data = await r.json();
        if (data.auth_url) window.location.href = data.auth_url;
      }
    } catch {}
  };

  if (loading) return <div style={{ fontSize: 11, color: T.mt, padding: 12 }}>Loading...</div>;
  if (providers.length === 0) return <div style={{ fontSize: 11, color: T.mt, padding: '8px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>No OAuth providers configured.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
      {providers.map(p => {
        const linked = accounts.find(a => a.provider === p.provider);
        const brand = PROVIDER_ICONS[p.provider] || { icon: '🔗', color: T.mt };
        return (
          <div key={p.provider} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, color: brand.color, fontWeight: 700 }}>{brand.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.tx, textTransform: 'capitalize' }}>{p.provider}</div>
                {linked?.provider_email && <div style={{ fontSize: 10, color: T.mt }}>{linked.provider_email}</div>}
              </div>
            </div>
            {linked ? (
              <button onClick={() => disconnect(p.provider)} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: 'none', color: T.err, cursor: 'pointer' }}>Disconnect</button>
            ) : (
              <button onClick={() => connect(p.provider)} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: 'none', color: T.ac, cursor: 'pointer' }}>Connect</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 2FA Setup Button (pending implementation) ─────────────────────────

function TwoFactorSetupButton() {
  const [showMsg, setShowMsg] = useState(false);
  return (
    <>
      <button onClick={() => setShowMsg(true)} className="pill-btn" style={{ background: T.ac, color: '#000', padding: '6px 14px', fontSize: 11, fontWeight: 700 }}>Setup 2FA</button>
      {showMsg && (
        <div style={{ fontSize: 11, color: T.mt, marginTop: 6, padding: '8px 12px', background: T.bg, borderRadius: 6, border: `1px solid ${T.bd}`, lineHeight: 1.5 }}>
          2FA setup will be available in a future update. Your account is protected by password-based authentication, session management, and optional passkey support.
          <span onClick={() => setShowMsg(false)} style={{ marginLeft: 8, color: T.mt, cursor: 'pointer', fontSize: 10 }}>Dismiss</span>
        </div>
      )}
    </>
  );
}

// ─── Export Data Button ─────────────────────────────────────────────────

function ExportDataButton() {
  const [state, setState] = useState<'idle' | 'confirm' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  const doExport = async () => {
    setState('loading');
    setError('');
    try {
      const headers: Record<string, string> = {};
      if ((api as any).token) headers['Authorization'] = `Bearer ${(api as any).token}`;
      const r = await fetch(`${api.baseUrl}/users/@me/export-zip`, { headers, credentials: 'same-origin' });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || `Export failed (${r.status})`);
      }
      const blob = await r.blob();
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `discreet-export-${date}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setState('idle');
    } catch (e: any) {
      setError(e?.message || 'Export failed');
      setState('error');
    }
  };

  if (state === 'confirm') {
    return (
      <div style={{ padding: 14, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx, marginBottom: 8 }}>Export My Data</div>
        <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6, marginBottom: 14 }}>
          This will download all your messages and voice recordings as a ZIP file.
          Depending on your message history, this may take several minutes.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={doExport} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: T.ac, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
          <button onClick={() => setState('idle')} style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.tx, display: 'flex', alignItems: 'center', gap: 6 }}><I.Download /> Export My Data</div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Download all messages and voice recordings as ZIP</div>
        </div>
        <button onClick={() => setState('confirm')} disabled={state === 'loading'} style={{
          padding: '6px 14px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, color: T.tx,
          fontSize: 11, fontWeight: 600, cursor: state === 'loading' ? 'wait' : 'pointer',
          opacity: state === 'loading' ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {state === 'loading' ? (<><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid transparent', borderTopColor: T.ac, borderRadius: 6, animation: 'spin 0.6s linear infinite' }} /> Exporting...</>) : 'Export'}
        </button>
      </div>
      {state === 'error' && error && (
        <div style={{ fontSize: 11, color: T.err, marginTop: 8, padding: '6px 10px', background: 'rgba(255,71,87,0.06)', borderRadius: 4 }}>{error}
          <button onClick={() => setState('idle')} style={{ marginLeft: 8, fontSize: 10, color: T.mt, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

// ─── Import Messages ─────────────────────────────────────────────────────

const IMPORT_SOURCES = [
  {
    id: 'signal' as const,
    label: 'Signal',
    icon: '🔒',
    color: '#3A76F0',
    accept: '.zip',
    instructions: [
      'Open Signal Desktop',
      'Go to File → Export messages',
      'Choose a location and save the .zip file',
      'Upload the exported .zip below',
    ],
  },
  {
    id: 'whatsapp' as const,
    label: 'WhatsApp',
    icon: '💬',
    color: '#25D366',
    accept: '.zip',
    instructions: [
      'Open WhatsApp on your phone',
      'Go to Settings → Chats → Export Chat',
      'Select each conversation to export',
      'Choose "Without Media" or "Include Media"',
      'Send/save the .zip file to your computer',
      'Upload the .zip below',
    ],
  },
  {
    id: 'imessage' as const,
    label: 'iMessage',
    icon: '🍎',
    color: '#007AFF',
    accept: '.db',
    instructions: [
      'On your Mac, open Finder',
      'Press Cmd+Shift+G and go to: ~/Library/Messages/',
      'Copy the chat.db file to your desktop',
      'Upload the chat.db file below',
    ],
  },
  {
    id: 'android_sms' as const,
    label: 'Android SMS',
    icon: '📱',
    color: '#A4C639',
    accept: '.xml',
    instructions: [
      'Install "SMS Backup & Restore" from the Play Store',
      'Open the app and tap "Back Up Now"',
      'Transfer the .xml backup file to your computer',
      'Upload the .xml file below',
    ],
  },
] as const;

type ImportSource = typeof IMPORT_SOURCES[number]['id'];
type JobState = { status: string; total_messages: number; imported_count: number; error_message: string | null };

function ImportMessages() {
  const [expanded, setExpanded] = useState<ImportSource | null>(null);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((id: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.getImportJob(id);
        setJob(data);
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling();
        }
      } catch {
        stopPolling();
      }
    }, 2000);
  }, [stopPolling]);

  const handleUpload = async (source: ImportSource, file: File) => {
    setError('');
    setJob(null);
    setUploading(true);
    try {
      const { id } = await api.createImportJob(source, file);
      setJobId(id);
      setJob({ status: 'pending', total_messages: 0, imported_count: 0, error_message: null });
      startPolling(id);
    } catch (e: any) {
      setError(e?.message || 'Import failed');
    }
    setUploading(false);
  };

  const handleFile = (source: ImportSource, file: File | undefined) => {
    if (!file) return;
    const src = IMPORT_SOURCES.find(s => s.id === source);
    if (src && !file.name.toLowerCase().endsWith(src.accept)) {
      setError(`Please select a ${src.accept} file for ${src.label} import`);
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('File size exceeds 100 MB limit');
      return;
    }
    handleUpload(source, file);
  };

  const retry = () => {
    setJobId(null);
    setJob(null);
    setError('');
  };

  const pct = job && job.total_messages > 0
    ? Math.min(100, Math.round((job.imported_count / job.total_messages) * 100))
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {IMPORT_SOURCES.map(src => {
        const isExpanded = expanded === src.id;
        const isActive = isExpanded && (uploading || (job && job.status !== 'completed' && job.status !== 'failed'));
        return (
          <div key={src.id} style={{ background: T.sf2, borderRadius: 8, border: `1px solid ${isExpanded ? ta(src.color, '66') : T.bd}`, overflow: 'hidden', transition: 'border-color 0.2s' }}>
            {/* Source card header */}
            <div
              onClick={() => { if (!isActive) { setExpanded(isExpanded ? null : src.id); setError(''); setJob(null); setJobId(null); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: isActive ? 'default' : 'pointer', userSelect: 'none' }}
              aria-label={`Import from ${src.label}`}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>{src.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{src.label}</div>
                <div style={{ fontSize: 11, color: T.mt }}>Import chat history from {src.label}</div>
              </div>
              <span style={{ fontSize: 10, color: T.mt, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </div>

            {/* Expanded panel */}
            {isExpanded && (
              <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${T.bd}` }}>
                {/* Instructions */}
                <div style={{ margin: '12px 0', padding: '10px 12px', background: T.bg, borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>How to export from {src.label}</div>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.tx, lineHeight: 1.8 }}>
                    {src.instructions.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                </div>

                {/* Upload / Progress / Result */}
                {!jobId ? (
                  <>
                    {/* Dropzone */}
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(src.id, e.dataTransfer.files[0]); }}
                      onClick={() => fileRef.current?.click()}
                      style={{
                        padding: '20px 14px', textAlign: 'center', borderRadius: 8, cursor: uploading ? 'wait' : 'pointer',
                        border: `2px dashed ${dragOver ? src.color : T.bd}`,
                        background: dragOver ? ta(src.color, '0a') : T.bg,
                        transition: 'border-color 0.2s, background 0.2s',
                        opacity: uploading ? 0.6 : 1,
                      }}
                      aria-label={`Upload ${src.accept} file`}
                    >
                      <I.Download />
                      <div style={{ fontSize: 12, color: T.tx, marginTop: 6, fontWeight: 600 }}>
                        {uploading ? 'Uploading...' : `Drop ${src.accept} file here or click to browse`}
                      </div>
                      <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Maximum 100 MB</div>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept={src.accept}
                      style={{ display: 'none' }}
                      onChange={e => { handleFile(src.id, e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ''; }}
                      aria-label={`Select ${src.accept} file`}
                    />
                  </>
                ) : job?.status === 'completed' ? (
                  /* Success */
                  <div style={{ padding: 14, background: ta(T.ok, '0a'), borderRadius: 8, border: `1px solid ${ta(T.ok, '33')}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.ok, marginBottom: 4 }}>Import Complete</div>
                    <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.6 }}>
                      Successfully imported <strong>{job.imported_count.toLocaleString()}</strong> of{' '}
                      <strong>{job.total_messages.toLocaleString()}</strong> messages.
                    </div>
                    <button onClick={retry} style={{ marginTop: 10, padding: '6px 14px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, color: T.tx, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      Import Another
                    </button>
                  </div>
                ) : job?.status === 'failed' ? (
                  /* Failure */
                  <div style={{ padding: 14, background: 'rgba(255,71,87,0.06)', borderRadius: 8, border: '1px solid rgba(255,71,87,0.2)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.err, marginBottom: 4 }}>Import Failed</div>
                    <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.6 }}>{job.error_message || 'An unexpected error occurred.'}</div>
                    <button onClick={retry} style={{ marginTop: 10, padding: '6px 14px', borderRadius: 6, border: 'none', background: T.err, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Retry
                    </button>
                  </div>
                ) : (
                  /* Progress */
                  <div style={{ padding: 14, background: T.bg, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>
                        {job?.status === 'processing' ? 'Importing...' : 'Starting...'}
                      </span>
                      <span style={{ fontSize: 11, color: T.mt }}>
                        {job && job.total_messages > 0
                          ? `${job.imported_count.toLocaleString()} / ${job.total_messages.toLocaleString()}`
                          : 'Preparing...'}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 6, background: T.sf2, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 3, transition: 'width 0.3s ease',
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${src.color}, ${T.ac})`,
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: T.mt, marginTop: 6, textAlign: 'center' }}>
                      {pct}% — polling every 2 seconds
                    </div>
                  </div>
                )}

                {/* Error banner */}
                {error && !jobId && (
                  <div style={{ fontSize: 11, color: T.err, marginTop: 8, padding: '6px 10px', background: 'rgba(255,71,87,0.06)', borderRadius: 4 }}>
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Subscription sub-panel (self-contained state)
function SubscriptionPanel({ platformUser, onUpgrade }: { platformUser: any; onUpgrade?: () => void }) {
  const [billing, setBilling] = React.useState<any>(null);
  const [loadingBilling, setLoadingBilling] = React.useState(true);
  const [cancelling, setCancelling] = React.useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = React.useState(false);

  React.useEffect(() => {
    api.getBillingStatus().then(d => { setBilling(d); setLoadingBilling(false); }).catch(() => setLoadingBilling(false));
  }, []);

  if (loadingBilling) return <div style={{ fontSize: 11, color: T.mt, padding: 12 }}>Loading subscription...</div>;

  if (billing?.self_hosted) {
    return (
      <div style={{ padding: '14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>&#127968;</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>Self-Hosted Instance</div>
            <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>All features included — no subscription required.</div>
          </div>
        </div>
      </div>
    );
  }

  const tierKey = billing?.tier || platformUser?.account_tier || 'verified';
  const tierMeta = (TIER_META as any)[tierKey] || { icon: '\u2705', label: 'Free', color: T.ac };
  const isPaid = billing?.status === 'active' && (tierKey === 'pro' || tierKey === 'teams' || tierKey === 'enterprise');
  const expiresAt = billing?.expires_at ? new Date(billing.expires_at) : null;
  const willCancel = billing?.cancel_at_period_end;
  const paymentMethod = billing?.payment_method;

  return (
    <div style={{ padding: '14px', background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isPaid ? 10 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{tierMeta.icon}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: tierMeta.color }}>{tierMeta.label}</div>
            {isPaid && paymentMethod && (
              <div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>
                via {paymentMethod === 'stripe' ? 'Card' : paymentMethod === 'btcpay' ? 'Crypto' : paymentMethod}
                {expiresAt && !willCancel && <span> · renews {expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                {expiresAt && willCancel && <span> · expires {expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
              </div>
            )}
          </div>
        </div>
        <button onClick={() => onUpgrade ? onUpgrade() : window.open('/app/tiers', '_blank')} className="pill-btn" style={{ background: `${ta(T.ac,'18')}`, color: T.ac, border: `1px solid ${ta(T.ac,'44')}`, padding: '6px 14px', fontSize: 11, fontWeight: 700 }}>
          {isPaid ? 'Change Plan' : 'Upgrade'}
        </button>
      </div>
      {willCancel && expiresAt && (
        <div style={{ padding: '8px 10px', background: 'rgba(250,166,26,0.08)', borderRadius: 6, border: '1px solid rgba(250,166,26,0.15)', fontSize: 11, color: '#faa61a', marginBottom: 8 }}>
          Your {tierMeta.label} features will remain active until {expiresAt.toLocaleDateString()}. After that you'll be on the Free plan.
        </div>
      )}
      {isPaid && !willCancel && !showCancelConfirm && (
        <button onClick={() => setShowCancelConfirm(true)} style={{ background: 'none', border: 'none', color: T.mt, fontSize: 10, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Cancel subscription</button>
      )}
      {showCancelConfirm && (
        <div style={{ padding: '10px 12px', background: 'rgba(255,71,87,0.06)', borderRadius: 8, border: '1px solid rgba(255,71,87,0.15)', marginTop: 6 }}>
          <div style={{ fontSize: 12, color: T.tx, marginBottom: 6 }}>
            Your {tierMeta.label} features will remain active until <strong>{expiresAt?.toLocaleDateString() || 'the end of the billing period'}</strong>. After that you'll be on the Free plan.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={async () => {
              setCancelling(true);
              try {
                await api.fetch('/subscription', { method: 'DELETE' });
                setBilling((p: any) => ({ ...p, cancel_at_period_end: true }));
                setShowCancelConfirm(false);
              } catch {}
              setCancelling(false);
            }} disabled={cancelling} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: T.err, color: '#fff', fontSize: 11, fontWeight: 700, cursor: cancelling ? 'default' : 'pointer' }}>
              {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
            </button>
            <button onClick={() => setShowCancelConfirm(false)} style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 11, cursor: 'pointer' }}>Keep Plan</button>
          </div>
        </div>
      )}
    </div>
  );
}
