import React, { useState, useEffect, useRef, useCallback } from 'react';
import { T, ta } from '../../theme';
import * as I from '../../icons';
import { api } from '../../api/CitadelAPI';
import { TIER_META } from '../../utils/tiers';
import { VerificationGate, maskEmail } from '../VerificationGate';

interface UserSettings { [key: string]: unknown; }

export interface SettingsAccountProps {
  s: UserSettings;
  save: (k: string, v: unknown) => void;
  sectionVisible: (section: string) => boolean;
  onUpgrade?: () => void;
  platformUser?: { account_tier?: string; platform_role?: string | null; badge_type?: string | null; permissions?: string[] } | null;
  ChangeEmail: React.ComponentType;
  RotateEncryptionKey: React.ComponentType;
  ClearLocalCache: React.ComponentType;
}

export default function SettingsAccount({
  s, save, sectionVisible, onUpgrade, platformUser,
  ChangeEmail, RotateEncryptionKey, ClearLocalCache,
}: SettingsAccountProps) {
  return (<>
    {/* Account Tier */}
    <AccountTierBanner platformUser={platformUser} />

    {/* Identity */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Identity</div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Username</div>
        <div style={{ fontSize: 12, color: T.ac, fontFamily: 'monospace', marginTop: 2 }}>{api.username || '\u2014'}</div>
        <div style={{ fontSize: 10, color: T.mt, fontFamily: 'monospace', marginTop: 4, wordBreak: 'break-all', opacity: 0.7 }}>
          Your ID: {api.userId || '\u2014'}
        </div>
      </div>
      <button onClick={() => { navigator.clipboard?.writeText(api.userId || ''); }} style={{ fontSize: 10, color: T.mt, background: 'none', border: `1px solid ${T.bd}`, borderRadius: 4, cursor: 'pointer', padding: '3px 8px', fontFamily: 'monospace' }} title="Copy user ID to clipboard">Copy ID</button>
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

      {/* ── Emergency Section ── */}
      <div style={{ marginTop: 8, padding: 14, background: 'rgba(255,71,87,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ display: 'flex', color: T.err }}><I.AlertTriangle s={14} /></span>
          <span style={{ fontSize: 12, fontWeight: 800, color: T.err }}>Emergency</span>
        </div>

        {/* Wipe Local Data */}
        <WipeLocalDataButton />

        <div style={{ height: 1, background: 'rgba(255,71,87,0.15)', margin: '14px 0' }} />

        {/* Delete Account — enhanced with username confirmation */}
        {(platformUser as any)?.account_tier === 'anonymous' && (
          <div style={{ padding: '10px 12px', background: 'rgba(255,71,87,0.08)', borderRadius: 6, border: '1px solid rgba(255,71,87,0.2)', marginBottom: 12, lineHeight: 1.6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.err, marginBottom: 4 }}>Anonymous Account Warning</div>
            <div style={{ fontSize: 11, color: T.mt }}>
              Anonymous accounts <strong style={{ color: T.err }}>cannot be recovered</strong> once deleted. You have no email on file. There is no password reset. This action is <strong style={{ color: T.err }}>permanent and irreversible</strong>.
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: T.mt, marginBottom: 12, lineHeight: 1.6 }}>
          Permanently delete your account and <strong style={{ color: T.err }}>ALL</strong> associated data — messages, servers, friends, agent configs. Your UUID is tombstoned to prevent cryptographic key reuse. <strong style={{ color: T.err }}>This action is irreversible.</strong>
        </div>
        <DeleteAccountWithConfirm username={api.username || ''} isAnonymous={(platformUser as any)?.account_tier === 'anonymous'} />
      </div>
    </div>
  </>);
}

// ─── Account Tier Banner ─────────────────────────────────────────────────────

function AccountTierBanner({ platformUser }: { platformUser?: any }) {
  const tier = platformUser?.account_tier || 'unverified';
  const email = platformUser?.email || '';

  if (tier === 'unverified') {
    return (
      <div style={{ padding: '12px 14px', background: 'rgba(250,166,26,0.08)', borderRadius: 10, border: '1px solid rgba(250,166,26,0.2)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ color: '#faa61a', display: 'flex' }}><I.AlertTriangle s={16} /></span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#faa61a' }}>Email not verified</div>
            <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Some features are restricted until you verify your email address.</div>
          </div>
        </div>
        <VerificationGate tier={tier} maskedEmail={email ? maskEmail(email) : undefined} onVerified={() => window.location.reload()}>
          <div style={{ fontSize: 12, color: T.ac, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><I.Check s={12} /> Verified</div>
        </VerificationGate>
      </div>
    );
  }

  if (tier === 'verified') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: ta(T.ac, '06'), borderRadius: 'var(--radius-md)', border: `1px solid ${ta(T.ac, '20')}`, marginBottom: 16 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill={T.ac}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.ac }}>Email verified</span>
      </div>
    );
  }

  if (tier === 'anonymous') {
    const [addingEmail, setAddingEmail] = React.useState(false);
    const [anonEmail, setAnonEmail] = React.useState('');
    return (
      <div style={{ padding: '12px 14px', background: 'rgba(250,166,26,0.06)', borderRadius: 10, border: '1px solid rgba(250,166,26,0.15)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: '#faa61a', display: 'flex' }}><I.Lock s={16} /></span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#faa61a' }}>Anonymous Account — Limited Features</div>
            <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Some features require a verified email. Add one to upgrade.</div>
          </div>
        </div>
        {!addingEmail ? (
          <button onClick={() => setAddingEmail(true)} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${ta(T.ac, '44')}`, background: ta(T.ac, '12'), color: T.ac, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}>
            Add Email to Upgrade
          </button>
        ) : (
          <div style={{ marginBottom: 8 }}>
            <input value={anonEmail} onChange={e => setAnonEmail(e.target.value)} placeholder="your@email.com" type="email"
              style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setAddingEmail(false)} style={{ flex: 1, padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => { try { await api.changeEmail(anonEmail, '', undefined); setAddingEmail(false); } catch {} }} style={{ flex: 1, padding: '6px 12px', borderRadius: 6, border: 'none', background: T.ac, color: '#000', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Send Code</button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 10, color: T.mt, lineHeight: 1.5 }}>Your recovery phrase was shown once at account creation. We cannot retrieve it.</div>
        {platformUser?.id && <div style={{ fontSize: 10, color: T.mt, fontFamily: 'monospace', marginTop: 4 }}>ID: {platformUser.id}</div>}
        {platformUser?.created_at && <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>Created: {new Date(platformUser.created_at).toLocaleDateString()}</div>}
      </div>
    );
  }

  if (tier === 'pro') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(240,178,50,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(240,178,50,0.2)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#f0b232', display: 'flex' }}><I.Star s={16} /></span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f0b232' }}>Pro Member</span>
        </div>
        <span style={{ fontSize: 11, color: T.mt, cursor: 'pointer' }}>Manage subscription</span>
      </div>
    );
  }

  return null;
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
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

const PROVIDER_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  google:  { icon: 'G', color: '#4285F4' },
  github:  { icon: '⬡', color: '#24292f' },
  apple:   { icon: '', color: '#000000' },
  discord: { icon: <I.Gamepad s={16} />, color: '#5865F2' },
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
  if (providers.length === 0) return <div style={{ fontSize: 11, color: T.mt, padding: '8px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 8 }}>No OAuth providers configured.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
      {providers.map(p => {
        const linked = accounts.find(a => a.provider === p.provider);
        const brand = PROVIDER_ICONS[p.provider] || { icon: <I.Link s={16} />, color: T.mt };
        return (
          <div key={p.provider} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
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
          <button onClick={doExport} style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', border: 'none', background: T.ac, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
          <button onClick={() => setState('idle')} style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 8 }}>
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
    icon: <I.Lock s={20} />,
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
    icon: <I.MessageSquare s={20} />,
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
    icon: <I.Monitor s={20} />,
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
    icon: <I.Smartphone s={20} />,
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
          <div key={src.id} style={{ background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${isExpanded ? ta(src.color, '66') : T.bd}`, overflow: 'hidden', transition: 'border-color 0.2s' }}>
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
                  <ol style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: T.tx, lineHeight: 1.8 }}>
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
                        padding: '20px 14px', textAlign: 'center', borderRadius: 'var(--radius-md)', cursor: uploading ? 'wait' : 'pointer',
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
                  <div style={{ padding: 14, background: ta(T.ok, '0a'), borderRadius: 'var(--radius-md)', border: `1px solid ${ta(T.ok, '33')}` }}>
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
                  <div style={{ padding: 14, background: 'rgba(255,71,87,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.2)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.err, marginBottom: 4 }}>Import Failed</div>
                    <div style={{ fontSize: 12, color: T.tx, lineHeight: 1.6 }}>{job.error_message || 'An unexpected error occurred.'}</div>
                    <button onClick={retry} style={{ marginTop: 10, padding: '6px 14px', borderRadius: 6, border: 'none', background: T.err, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Retry
                    </button>
                  </div>
                ) : (
                  /* Progress */
                  <div style={{ padding: 14, background: T.bg, borderRadius: 'var(--radius-md)' }}>
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

// ─── Wipe Local Data ─────────────────────────────────────────────────────

function WipeLocalDataButton() {
  const [confirm, setConfirm] = useState(false);

  const doWipe = async () => {
    // Clear localStorage
    localStorage.clear();
    // Clear sessionStorage
    sessionStorage.clear();
    // Clear IndexedDB databases
    if (window.indexedDB?.databases) {
      try {
        const dbs = await window.indexedDB.databases();
        for (const db of dbs) {
          if (db.name) window.indexedDB.deleteDatabase(db.name);
        }
      } catch { /* not supported in all browsers */ }
    }
    // Clear service worker caches
    if ('caches' in window) {
      try {
        const names = await caches.keys();
        for (const name of names) await caches.delete(name);
      } catch { /* ignore */ }
    }
    // Unregister service workers
    if ('serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) await reg.unregister();
      } catch { /* ignore */ }
    }
    // Clear cookies for current origin
    document.cookie.split(';').forEach(c => {
      const name = c.split('=')[0].trim();
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
    // Redirect to login
    window.location.href = '/';
  };

  if (!confirm) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Wipe Local Data</div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2, lineHeight: 1.5 }}>
            Delete all cached data, settings, and login state on this device.
          </div>
        </div>
        <button onClick={() => setConfirm(true)} style={{
          padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,71,87,0.4)',
          background: 'transparent', color: T.err, fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}>
          Wipe
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, background: 'rgba(255,71,87,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.2)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.err, marginBottom: 8 }}>Wipe Local Data?</div>
      <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6, marginBottom: 12 }}>
        This will delete <strong style={{ color: T.tx }}>ALL</strong> local data including cached messages, settings, encryption keys, and login state.
        You will be logged out. Your account remains on the server and you can log in again.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setConfirm(false)} style={{
          padding: '8px 18px', borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`,
          background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer',
        }}>Cancel</button>
        <button onClick={doWipe} style={{
          padding: '8px 18px', borderRadius: 'var(--radius-md)', border: 'none',
          background: T.err, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>Wipe Everything</button>
      </div>
    </div>
  );
}

// ─── Delete Account with Username Confirmation ──────────────────────────

function DeleteAccountWithConfirm({ username, isAnonymous }: { username: string; isAnonymous: boolean }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'deleting'>('idle');
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const matches = typed === username;

  const doDelete = async () => {
    if (!matches) return;
    setError('');
    setStep('deleting');
    try {
      // For non-anonymous accounts, verify password first
      let reauthToken: string | undefined;
      if (!isAnonymous && password) {
        const verifyRes = await api.verifyPassword(password);
        reauthToken = verifyRes.reauth_token;
      }
      await api.deleteAccount(reauthToken);
      // Wipe all local data
      localStorage.clear();
      sessionStorage.clear();
      if (window.indexedDB?.databases) {
        try { const dbs = await window.indexedDB.databases(); for (const db of dbs) { if (db.name) window.indexedDB.deleteDatabase(db.name); } } catch {}
      }
      if ('caches' in window) { try { const names = await caches.keys(); for (const name of names) await caches.delete(name); } catch {} }
      // Redirect to login
      window.location.href = '/';
    } catch (e: any) {
      setError(e?.message || 'Account deletion failed');
      setStep('confirm');
    }
  };

  if (step === 'idle') {
    return (
      <button onClick={() => setStep('confirm')} style={{
        padding: '8px 18px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.5)',
        background: 'rgba(255,71,87,0.08)', color: T.err, fontSize: 13, fontWeight: 700,
        cursor: 'pointer', width: '100%',
      }}>
        Delete My Account
      </button>
    );
  }

  return (
    <div style={{ padding: 14, background: 'rgba(255,71,87,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.25)' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.err, marginBottom: 10 }}>
        {isAnonymous ? 'Permanently Delete Anonymous Account' : 'Permanently Delete Account'}
      </div>

      <div style={{ padding: '10px 12px', background: 'rgba(255,71,87,0.1)', borderRadius: 6, marginBottom: 14, fontSize: 12, color: T.err, lineHeight: 1.6 }}>
        This will: revoke all sessions, remove you from all servers, replace all messages with "[deleted]",
        delete friend connections, delete agent configs, and tombstone your UUID.
        {isAnonymous
          ? <><br /><strong>Your recovery phrase will no longer work. There is no way to undo this.</strong></>
          : <><br />Your data will be purged within 30 days.</>}
      </div>

      {/* Password (non-anonymous only) */}
      {!isAnonymous && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: T.mt, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Your Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Enter your password" autoComplete="current-password"
            style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
        </div>
      )}

      {/* Username confirmation */}
      <div style={{ fontSize: 12, color: T.tx, marginBottom: 6 }}>
        Type <strong style={{ color: T.err, fontFamily: 'monospace' }}>{username}</strong> to confirm:
      </div>
      <input value={typed} onChange={e => setTyped(e.target.value)}
        placeholder={username} autoFocus spellCheck={false} autoComplete="off"
        onKeyDown={e => { if (e.key === 'Enter' && matches && step !== 'deleting') doDelete(); }}
        style={{
          width: '100%', padding: '8px 12px', background: T.bg,
          border: `1px solid ${matches ? 'rgba(255,71,87,0.6)' : T.bd}`,
          borderRadius: 6, color: T.tx, fontSize: 14, fontFamily: 'monospace',
          outline: 'none', boxSizing: 'border-box', marginBottom: 12,
        }} />

      {error && <div style={{ fontSize: 11, color: T.err, padding: '6px 10px', background: 'rgba(255,71,87,0.08)', borderRadius: 4, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setStep('idle'); setTyped(''); setPassword(''); setError(''); }} disabled={step === 'deleting'}
          style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={doDelete} disabled={!matches || step === 'deleting' || (!isAnonymous && !password)}
          style={{
            padding: '8px 18px', borderRadius: 'var(--radius-md)', border: 'none', fontSize: 12, fontWeight: 700,
            background: matches && (isAnonymous || password) && step !== 'deleting' ? T.err : T.sf2,
            color: matches && (isAnonymous || password) && step !== 'deleting' ? '#fff' : T.mt,
            cursor: matches && (isAnonymous || password) && step !== 'deleting' ? 'pointer' : 'not-allowed',
          }}>
          {step === 'deleting' ? 'Deleting\u2026' : 'Delete My Account Forever'}
        </button>
      </div>
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
          <span style={{ display: 'flex', color: T.ac }}><I.Building2 s={16} /></span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>Self-Hosted Instance</div>
            <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>All features included — no subscription required.</div>
          </div>
        </div>
      </div>
    );
  }

  const tierKey = billing?.tier || platformUser?.account_tier || 'verified';
  const tierMeta = (TIER_META as any)[tierKey] || { icon: <I.Check s={16} />, label: 'Free', color: T.ac };
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
        <div style={{ padding: '10px 12px', background: 'rgba(255,71,87,0.06)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,71,87,0.15)', marginTop: 6 }}>
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
