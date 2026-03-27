import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../../theme';
import * as I from '../../icons';
import { api } from '../../api/CitadelAPI';

interface UserSettings { [key: string]: unknown; }

export interface SettingsAccountSecurityProps {
  s: UserSettings;
  save: (k: string, v: unknown) => void;
  sectionVisible: (section: string) => boolean;
  platformUser?: { account_tier?: string; platform_role?: string | null; badge_type?: string | null; permissions?: string[] } | null;
  SecurityStatus: React.ComponentType<{ platformUser: any; onSetupStep: (step: string) => void; me?: any }>;
  ChangeEmail: React.ComponentType;
  ChangePassword: React.ComponentType;
  onNavigateTab: (tab: string) => void;
  me?: any;
}

// ─── Row layout helper ──────────────────────────────────────────────────────

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px', background: T.sf2, borderRadius: 'var(--radius-md)',
  border: `1px solid ${T.bd}`, marginBottom: 6,
};

const LABEL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: T.tx };
const STATUS: React.CSSProperties = { fontSize: 12, color: T.mt, marginTop: 2 };
const BTN: React.CSSProperties = {
  fontSize: 11, padding: '5px 14px', borderRadius: 6,
  border: `1px solid ${T.bd}`, background: T.sf, color: T.mt,
  cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
};
const BTN_AC: React.CSSProperties = {
  ...BTN, background: T.ac, color: '#000', border: 'none', fontWeight: 700,
};

// ─── Main component ─────────────────────────────────────────────────────────

export default function SettingsAccountSecurity({
  s, save, sectionVisible, platformUser,
  SecurityStatus, ChangeEmail, ChangePassword, onNavigateTab, me,
}: SettingsAccountSecurityProps) {
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    api.listSessions().then((list: any) => setSessionCount(Array.isArray(list) ? list.length : 0)).catch(() => {});
  }, []);

  return (<>
    {/* Security Status (score ring) */}
    <div style={{ display: sectionVisible('security-status') ? undefined : 'none' }}>
      <div data-section="security-status">
        <SecurityStatus
          platformUser={platformUser}
          me={me}
          onSetupStep={(step) => {
            const sectionMap: Record<string, string> = {
              'verify-email': 'sec-email',
              'setup-2fa': 'sec-2fa',
              'recovery-key': 'sec-recovery',
            };
            const target = sectionMap[step];
            if (target) {
              const el = document.querySelector(`[data-section="${target}"]`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
        />
      </div>
    </div>

    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
      Account Security
    </div>

    {/* Email */}
    <div data-section="sec-email">
      <ChangeEmail />
    </div>

    {/* Password */}
    <div data-section="sec-password">
      <ChangePassword />
    </div>

    {/* Recovery Phrase */}
    <RecoveryPhraseRow me={me} />

    {/* Two-Factor Authentication */}
    <TwoFactorRow me={me} />

    {/* Passkeys */}
    <PasskeyRow />

    {/* Active Sessions */}
    <div style={ROW} data-section="sec-sessions">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={LABEL}>Active Sessions</div>
        <div style={STATUS}>{sessionCount} active {sessionCount === 1 ? 'session' : 'sessions'}</div>
      </div>
      <button onClick={() => onNavigateTab('sessions')} style={BTN}>
        Manage
      </button>
    </div>

    {/* Device Verification */}
    <div style={ROW} data-section="sec-device-verify">
      <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
        <div style={LABEL}>Device Verification</div>
        <div style={STATUS}>Verify new devices with emoji comparison</div>
      </div>
      <Toggle
        on={s.device_verification !== false}
        onToggle={() => save('device_verification', s.device_verification === false ? true : false)}
      />
    </div>
  </>);
}

// ─── Toggle ─────────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      style={{
        width: 36, height: 20, borderRadius: 10, flexShrink: 0,
        background: on ? T.ac : T.bd,
        cursor: 'pointer', position: 'relative', transition: 'background .2s',
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

// ─── Recovery Phrase Row ────────────────────────────────────────────────────

function RecoveryPhraseRow({ me }: { me: any }) {
  const [showView, setShowView] = useState(false);
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const hasRecovery = !!me?.has_recovery_key;

  const viewPhrase = async () => {
    if (!password) { setErr('Password required to view recovery phrase'); return; }
    setErr(''); setLoading(true);
    try {
      const res = await api.fetch('/auth/recovery-phrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const data = await res.json();
        setPhrase(data.phrase || data.recovery_phrase || '');
      } else {
        const data = await res.json().catch(() => ({}));
        setErr(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to retrieve phrase');
      }
    } catch {
      setErr('Network error');
    }
    setLoading(false);
  };

  return (
    <div data-section="sec-recovery" style={{ marginBottom: 6 }}>
      <div style={ROW}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 6 }}>
            Recovery Phrase <I.Lock s={10} />
          </div>
          <div style={STATUS}>
            {hasRecovery ? (
              <span style={{ color: T.ac }}>Active</span>
            ) : (
              <span style={{ color: '#faa61a' }}>Not set</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasRecovery && (
            <button onClick={() => setShowView(!showView)} style={BTN}>
              {showView ? 'Hide' : 'View'}
            </button>
          )}
          {!hasRecovery && (
            <button onClick={() => {
              const el = document.querySelector('[data-section="security-status"]');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }} style={BTN_AC}>Generate</button>
          )}
        </div>
      </div>
      {showView && (
        <div style={{ padding: '10px 16px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginTop: -2, marginBottom: 6 }}>
          {phrase ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#faa61a', marginBottom: 6 }}>
                Keep this phrase safe. Anyone with it can access your account.
              </div>
              <div style={{
                fontFamily: 'monospace', fontSize: 13, color: T.tx, padding: '10px 14px',
                background: T.sf2, borderRadius: 6, border: `1px solid ${T.bd}`,
                wordBreak: 'break-word', lineHeight: 1.8, letterSpacing: '0.5px',
              }}>
                {phrase}
              </div>
              <button onClick={() => { navigator.clipboard?.writeText(phrase); }}
                style={{ ...BTN, marginTop: 8, fontSize: 10 }}>
                Copy to Clipboard
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: T.mt, marginBottom: 8 }}>Enter your password to view your recovery phrase</div>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') viewPhrase(); }}
                placeholder="Password"
                style={{ width: '100%', padding: '8px 10px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}
                autoFocus
                aria-label="Password for recovery phrase"
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={viewPhrase} disabled={loading} style={{ ...BTN_AC, opacity: loading ? 0.6 : 1, cursor: loading ? 'wait' : 'pointer' }}>
                  {loading ? 'Verifying...' : 'Confirm'}
                </button>
                <button onClick={() => { setShowView(false); setPassword(''); setPhrase(''); setErr(''); }} style={BTN}>Cancel</button>
              </div>
            </div>
          )}
          {err && <div style={{ fontSize: 11, color: '#ff4757', marginTop: 6, padding: '6px 10px', background: 'rgba(255,71,87,0.06)', borderRadius: 4 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Two-Factor Row ─────────────────────────────────────────────────────────

function TwoFactorRow({ me }: { me: any }) {
  const [showMsg, setShowMsg] = useState(false);
  const enabled = !!me?.totp_enabled;

  return (
    <div data-section="sec-2fa" style={{ marginBottom: 6 }}>
      <div style={ROW}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 6 }}>
            Two-Factor Authentication <I.Lock s={10} />
          </div>
          <div style={STATUS}>
            {enabled ? (
              <span style={{ color: T.ac }}>Enabled</span>
            ) : (
              <span style={{ color: '#faa61a' }}>Disabled</span>
            )}
          </div>
        </div>
        <button onClick={() => setShowMsg(true)} style={enabled ? BTN : BTN_AC}>
          {enabled ? 'Disable' : 'Setup'}
        </button>
      </div>
      {showMsg && (
        <div style={{ padding: '10px 16px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginTop: -2, marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6 }}>
            2FA setup will be available in a future update. Your account is protected by password-based authentication, session management, and optional passkey support.
          </div>
          <button onClick={() => setShowMsg(false)} style={{ ...BTN, marginTop: 8, fontSize: 10 }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

// ─── Passkey Row ────────────────────────────────────────────────────────────

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

function PasskeyRow() {
  const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  const [passkeys, setPasskeys] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.passkeyList();
      if (Array.isArray(data)) setPasskeys(data);
    } catch { /* no passkeys yet */ }
  }, []);

  useEffect(() => { if (supported) load(); }, [supported, load]);

  if (!supported) return null;

  const register = async () => {
    setError(''); setLoading(true);
    try {
      const options = await api.passkeyRegisterStart();
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
    <div data-section="sec-passkeys" style={{ marginBottom: 6 }}>
      <div style={ROW}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...LABEL, display: 'flex', alignItems: 'center', gap: 6 }}>
            Passkeys <I.Lock s={10} />
          </div>
          <div style={STATUS}>
            {passkeys.length > 0 ? (
              <span style={{ color: T.ac }}>{passkeys.length} registered</span>
            ) : (
              <span>None registered</span>
            )}
          </div>
        </div>
        <button onClick={() => setExpanded(!expanded)} style={BTN}>
          {expanded ? 'Close' : 'Manage'}
        </button>
      </div>
      {expanded && (
        <div style={{ padding: '10px 16px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginTop: -2, marginBottom: 6 }}>
          {passkeys.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {passkeys.map(pk => (
                <div key={pk.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: T.sf2, borderRadius: 6, marginBottom: 4 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{pk.name}</div>
                    <div style={{ fontSize: 10, color: T.mt }}>{new Date(pk.created_at).toLocaleDateString()}</div>
                  </div>
                  <button onClick={() => remove(pk.id)} style={{ fontSize: 10, color: '#ff4757', background: 'none', border: '1px solid rgba(255,71,87,0.3)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Passkey name (optional)"
              style={{ flex: 1, padding: '6px 10px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, outline: 'none' }}
              aria-label="New passkey name"
            />
            <button onClick={register} disabled={loading} style={{ ...BTN_AC, opacity: loading ? 0.6 : 1, cursor: loading ? 'wait' : 'pointer' }}>
              {loading ? 'Adding...' : 'Add Passkey'}
            </button>
          </div>
          {error && <div style={{ fontSize: 11, color: '#ff4757', marginTop: 6, padding: '6px 10px', background: 'rgba(255,71,87,0.06)', borderRadius: 4 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
