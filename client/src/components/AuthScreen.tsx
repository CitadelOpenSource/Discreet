/**
 * AuthScreen — Login / Register / Guest / Meeting Join screen.
 * First thing users see before authentication.
 */
import React, { useState, useMemo } from 'react';
import { T, getInp, btn } from '../theme';
import { api, storageBlocked, _storage } from '../api/CitadelAPI';

// ─── WebAuthn base64url helpers ──────────────────────────────────────────────

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

interface AuthScreenProps {
  onAuth: () => void;
}

// ─── Password requirements (OWASP 2026) ──────────────────────────────────────

interface PwRequirement {
  label: string;
  met: boolean;
}

function checkPasswordRequirements(pw: string): PwRequirement[] {
  return [
    { label: 'At least 12 characters',        met: pw.length >= 12 },
    { label: 'No more than 128 characters',    met: pw.length <= 128 },
    { label: 'One uppercase letter (A-Z)',     met: /[A-Z]/.test(pw) },
    { label: 'One lowercase letter (a-z)',     met: /[a-z]/.test(pw) },
    { label: 'One digit (0-9)',                met: /[0-9]/.test(pw) },
    { label: 'One special character (!@#...)', met: /[^a-zA-Z0-9]/.test(pw) },
  ];
}

type StrengthLevel = 'too-short' | 'weak' | 'fair' | 'strong' | 'very-strong';

interface StrengthResult {
  level: StrengthLevel;
  label: string;
  color: string;
  score: number; // 0-4
}

function passwordStrength(pw: string): StrengthResult {
  if (pw.length === 0) return { level: 'too-short', label: '', color: T.bd, score: 0 };
  if (pw.length < 12)  return { level: 'too-short', label: 'Too short', color: '#ff4757', score: 0 };

  let types = 0;
  if (/[a-z]/.test(pw)) types++;
  if (/[A-Z]/.test(pw)) types++;
  if (/[0-9]/.test(pw)) types++;
  if (/[^a-zA-Z0-9]/.test(pw)) types++;

  const long = pw.length >= 16;
  const vlong = pw.length >= 20;

  if (types <= 1) return { level: 'weak',        label: 'Weak',        color: '#ff6b35', score: 1 };
  if (types === 2) return { level: 'fair',        label: 'Fair',        color: '#faa61a', score: 2 };
  if (types === 3) return { level: 'strong',      label: long ? 'Strong' : 'Fair', color: long ? '#2ecc71' : '#faa61a', score: long ? 3 : 2 };
  if (vlong)       return { level: 'very-strong', label: 'Very Strong', color: '#00d4aa', score: 4 };
  return                   { level: 'strong',      label: 'Strong',      color: '#2ecc71', score: 3 };
}

// ─── Username validation ──────────────────────────────────────────────────────

function validateUsername(u: string): string {
  if (u.length === 0) return '';
  if (u.length < 3)   return 'At least 3 characters required';
  if (u.length > 32)  return 'Maximum 32 characters';
  if (!/^[a-zA-Z0-9_-]+$/.test(u)) return 'Only letters, numbers, _ and - allowed';
  return '';
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const label = (extra?: React.CSSProperties): React.CSSProperties => ({
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: T.mt,
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  ...extra,
});

const fieldErr = (msg: string) => msg ? (
  <div style={{ fontSize: 11, color: '#ff4757', marginTop: 4, marginBottom: 8 }}>{msg}</div>
) : null;

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthScreen({ onAuth }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('register') === 'true' ? 'register' : 'login';
  });

  // Shared
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // Register-only
  const [confirmPw, setConfirmPw] = useState('');
  const [email, setEmail]         = useState('');
  const [dob, setDob]             = useState('');
  const [termsOk, setTermsOk]     = useState(false);

  // Verification code modal (shown after registration with email)
  const [verifyModal, setVerifyModal] = useState(false);
  const [verifyCode, setVerifyCode]   = useState('');
  const [verifyErr, setVerifyErr]     = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Login-only
  const [rememberMe, setRememberMe]   = useState(false);
  const [forgotShown, setForgotShown] = useState(false);

  // Recovery key modal (shown after registration)
  const [recoveryKey, setRecoveryKey] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);

  // Forgot password flow
  const [fpStep, setFpStep] = useState<'email' | 'token' | 'done'>('email');
  const [fpEmail, setFpEmail] = useState('');
  const [fpToken, setFpToken] = useState('');
  const [fpNewPw, setFpNewPw] = useState('');
  const [fpError, setFpError] = useState('');
  const [fpMsg, setFpMsg]     = useState('');
  const [fpLoading, setFpLoading] = useState(false);

  const usernameErr = mode === 'register' ? validateUsername(username) : '';
  const strength    = useMemo(() => passwordStrength(password), [password]);
  const pwRequirements = useMemo(() => checkPasswordRequirements(password), [password]);
  const allReqsMet = pwRequirements.every(r => r.met);

  const canSubmit = (() => {
    if (loading) return false;
    if (!username.trim() || !password) return false;
    if (mode === 'register') {
      if (usernameErr) return false;
      if (!allReqsMet) return false;
      if (password !== confirmPw) return false;
      if (!termsOk) return false;
    }
    return true;
  })();

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
    setConfirmPw('');
    setForgotShown(false);
    setFpStep('email'); setFpEmail(''); setFpToken(''); setFpNewPw(''); setFpError(''); setFpMsg('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await api.login(username, password)
        : await api.register(username, password, email || undefined, dob || undefined);
      if (res.ok) {
        const u = username.trim().toLowerCase();
        if (u === 'admin' || u === 'dev') _storage.setItem('d_dev_local', 'true');
        if (rememberMe) _storage.setItem('d_remember_me', '1');
        if (mode === 'register' && res.data?.recovery_key) {
          setRecoveryKey(res.data.recovery_key);
          setLoading(false);
          return;
        }
        // If verification code was sent, show the modal instead of completing auth.
        if (mode === 'register' && res.data?.verification_pending) {
          setVerifyModal(true);
          setLoading(false);
          return;
        }
        onAuth();
      } else {
        setError(res.data?.error?.message || 'Authentication failed');
      }
    } catch {
      setError('Network error — check your connection');
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 'clamp(24px, 5vw, 40px)', background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}`, boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🛡️</div>
          <h1 style={{ margin: 0, color: T.tx, fontSize: 26, fontWeight: 700 }}>Discreet</h1>
          <p style={{ margin: '6px 0 0', color: T.mt, fontSize: 13 }}>Zero-knowledge encrypted messaging</p>
        </div>

        {/* Storage blocked warning */}
        {storageBlocked && (
          <div style={{
            padding: '10px 14px', marginBottom: 16, borderRadius: 8,
            background: 'rgba(255,165,0,0.08)', border: '1px solid rgba(255,165,0,0.25)',
            fontSize: 12, color: '#ffa502', lineHeight: 1.5,
          }}>
            Your browser is blocking storage. You may need to re-login after closing this tab.
          </div>
        )}

        {/* Tab switcher */}
        <div style={{ display: 'flex', background: T.bg, borderRadius: 10, padding: 4, marginBottom: 24, gap: 4 }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} onClick={() => switchMode(m)} type="button"
              style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, transition: 'all .15s',
                background: mode === m ? T.sf : 'transparent',
                color: mode === m ? T.tx : T.mt,
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
              }}>
              {m === 'login' ? 'Log In' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate>
          {/* ── Login form ── */}
          {mode === 'login' && (
            <>
              <label style={label()}>Username or Email</label>
              <input style={{ ...getInp(), marginBottom: 14 }} value={username} onChange={e => setUsername(e.target.value)}
                placeholder="alice or alice@example.com" autoFocus autoComplete="username" name="email" type="email" aria-label="Email address" />

              <label style={label()}>Password</label>
              <input style={{ ...getInp(), marginBottom: 8 }} type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password" name="password" aria-label="Password" />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                {/* Remember me */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, color: T.mt, userSelect: 'none' }}>
                  <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                    style={{ accentColor: T.ac, width: 15, height: 15, cursor: 'pointer' }} />
                  Remember me
                </label>

                {/* Forgot password */}
                <span onClick={() => { setForgotShown(v => !v); setFpStep('email'); setFpError(''); setFpMsg(''); }}
                  style={{ fontSize: 12, color: T.ac, cursor: 'pointer', fontWeight: 500 }}>
                  Forgot password?
                </span>
              </div>

              {forgotShown && (
                <div style={{ padding: '14px', background: 'rgba(0,212,170,0.06)', border: `1px solid rgba(0,212,170,0.2)`, borderRadius: 8, marginBottom: 14 }}>

                  {fpStep === 'email' && (<>
                    <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6, marginBottom: 10 }}>
                      Enter the email address on your account. We'll send a reset code if it exists.
                    </div>
                    <input
                      type="email" placeholder="Email address" value={fpEmail}
                      onChange={e => { setFpEmail(e.target.value); setFpError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('fp-send-btn')?.click(); } }}
                      style={{ ...getInp(), marginBottom: 8 }} autoFocus
                      autoComplete="email" name="email" aria-label="Email address" />
                    {fpError && <div style={{ fontSize: 11, color: '#ff4757', marginBottom: 8 }}>{fpError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button id="fp-send-btn" type="button" disabled={fpLoading || !fpEmail.includes('@')} onClick={async () => {
                        setFpError(''); setFpLoading(true);
                        try {
                          const res = await api.forgotPassword(fpEmail.trim());
                          setFpMsg(res.message || 'Check your email for a reset code.');
                          setFpStep('token');
                        } catch (e: any) { setFpError(e.message || 'Failed to send reset email'); }
                        setFpLoading(false);
                      }} style={btn(!fpLoading && fpEmail.includes('@'))}>
                        {fpLoading ? 'Sending…' : 'Send Reset Code'}
                      </button>
                      <button type="button" onClick={() => { setForgotShown(false); setFpStep('email'); setFpError(''); setFpMsg(''); }}
                        style={{ ...btn(true), background: T.sf2, color: T.mt, border: `1px solid ${T.bd}` }}>Cancel</button>
                    </div>
                  </>)}

                  {fpStep === 'token' && (<>
                    {fpMsg && <div style={{ fontSize: 12, color: T.ac, marginBottom: 10, lineHeight: 1.5 }}>{fpMsg}</div>}
                    <label style={label()}>Reset Code</label>
                    <input
                      placeholder="Paste the code from your email" value={fpToken}
                      onChange={e => { setFpToken(e.target.value); setFpError(''); }}
                      style={{ ...getInp(), marginBottom: 10, fontFamily: 'monospace' }} autoFocus />
                    <label style={label()}>New Password</label>
                    <input
                      type="password" placeholder="Minimum 12 characters" value={fpNewPw}
                      onChange={e => { setFpNewPw(e.target.value); setFpError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('fp-reset-btn')?.click(); } }}
                      style={{ ...getInp(), marginBottom: 8 }} autoComplete="new-password" name="password" aria-label="New password" />
                    {fpError && <div style={{ fontSize: 11, color: '#ff4757', marginBottom: 8 }}>{fpError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button id="fp-reset-btn" type="button" disabled={fpLoading || !fpToken.trim() || fpNewPw.length < 12} onClick={async () => {
                        setFpError(''); setFpLoading(true);
                        try {
                          await api.resetPassword(fpToken.trim(), fpNewPw);
                          setFpStep('done');
                        } catch (e: any) { setFpError(e.message || 'Reset failed'); }
                        setFpLoading(false);
                      }} style={btn(!fpLoading && !!fpToken.trim() && fpNewPw.length >= 12)}>
                        {fpLoading ? 'Resetting…' : 'Reset Password'}
                      </button>
                      <button type="button" onClick={() => { setFpStep('email'); setFpToken(''); setFpNewPw(''); setFpError(''); }}
                        style={{ ...btn(true), background: T.sf2, color: T.mt, border: `1px solid ${T.bd}` }}>Back</button>
                    </div>
                  </>)}

                  {fpStep === 'done' && (<>
                    <div style={{ fontSize: 13, color: T.ac, fontWeight: 600, marginBottom: 8 }}>Password reset successfully!</div>
                    <div style={{ fontSize: 12, color: T.mt, marginBottom: 10, lineHeight: 1.5 }}>You can now log in with your new password.</div>
                    <button type="button" onClick={() => {
                      setForgotShown(false); setFpStep('email'); setFpEmail(''); setFpToken(''); setFpNewPw(''); setFpError(''); setFpMsg('');
                    }} style={btn(true)}>Back to Login</button>
                  </>)}

                </div>
              )}
            </>
          )}

          {/* ── Register form ── */}
          {mode === 'register' && (
            <>
              <label style={label()}>Username</label>
              <input
                style={{ ...getInp(), marginBottom: usernameErr ? 4 : 14, borderColor: usernameErr ? '#ff4757' : undefined }}
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="alice" autoFocus autoComplete="username" name="username" aria-label="Username"
                maxLength={32} />
              {fieldErr(usernameErr)}
              {!usernameErr && username.length > 0 && (
                <div style={{ fontSize: 11, color: T.mt, marginBottom: 10, marginTop: -8 }}>
                  3–32 characters · letters, numbers, _ and - only
                </div>
              )}

              <label style={label()}>Password</label>
              <input
                style={{ ...getInp(), marginBottom: 8, borderColor: password.length > 0 && !allReqsMet ? '#ff4757' : undefined }}
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Minimum 12 characters" autoComplete="new-password" name="password" aria-label="Password" />

              {/* Strength meter */}
              {password.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, transition: 'background .2s',
                        background: strength.score >= i ? strength.color : T.bd }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: strength.color, fontWeight: 600 }}>
                    {strength.label}
                    {strength.level === 'too-short' && <span style={{ color: T.mt, fontWeight: 400 }}> — minimum 12 characters</span>}
                  </div>
                </div>
              )}

              {/* Requirements checklist */}
              {password.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {pwRequirements.map((r, i) => (
                    <div key={i} style={{ fontSize: 11, lineHeight: 1.8, color: r.met ? '#2ecc71' : T.mt, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13 }}>{r.met ? '\u2713' : '\u2717'}</span>
                      {r.label}
                    </div>
                  ))}
                </div>
              )}
              {password.length === 0 && <div style={{ marginBottom: 14 }} />}

              {/* Confirm password */}
              {password.length > 0 && (
                <>
                  <label style={label()}>Confirm Password</label>
                  <input
                    style={{ ...getInp(), marginBottom: 4, borderColor: confirmPw.length > 0 && password !== confirmPw ? '#ff4757' : undefined }}
                    type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    placeholder="Re-enter your password" autoComplete="new-password" name="confirm-password" aria-label="Confirm password" />
                  {confirmPw.length > 0 && (
                    <div style={{ fontSize: 11, marginBottom: 10, color: password === confirmPw ? '#2ecc71' : '#ff4757', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13 }}>{password === confirmPw ? '\u2713' : '\u2717'}</span>
                      {password === confirmPw ? 'Passwords match' : 'Passwords do not match'}
                    </div>
                  )}
                  {confirmPw.length === 0 && <div style={{ marginBottom: 14 }} />}
                </>
              )}

              <label style={label()}>Email <span style={{ color: T.mt, fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(optional)</span></label>
              <input style={{ ...getInp(), marginBottom: 6 }} type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="alice@example.com" autoComplete="email" name="email" aria-label="Email address" />
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5, marginBottom: 14 }}>
                Adding an email enables account recovery and qualifies your account for the Verified tier.
              </div>

              <label style={label()}>Date of Birth <span style={{ color: T.mt, fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(optional)</span></label>
              <input style={{ ...getInp(), marginBottom: 6 }} type="date" value={dob} onChange={e => setDob(e.target.value)}
                max={new Date(Date.now() - 13 * 365.25 * 86400000).toISOString().slice(0, 10)} />
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5, marginBottom: 18 }}>
                You must be at least 13 years old to use Discreet.
              </div>

              {/* Terms checkbox */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 18, userSelect: 'none' }}>
                <input type="checkbox" checked={termsOk} onChange={e => setTermsOk(e.target.checked)}
                  style={{ accentColor: T.ac, width: 15, height: 15, flexShrink: 0, marginTop: 1, cursor: 'pointer' }} />
                <span style={{ fontSize: 12, color: T.mt, lineHeight: 1.5 }}>
                  I agree to the{' '}
                  <a href="/app/terms" target="_blank" rel="noopener noreferrer" style={{ color: T.ac, textDecoration: 'none', fontWeight: 600 }}>Terms of Service</a>
                  {' '}and{' '}
                  <a href="/app/privacy" target="_blank" rel="noopener noreferrer" style={{ color: T.ac, textDecoration: 'none', fontWeight: 600 }}>Privacy Policy</a>
                </span>
              </label>
            </>
          )}

          {/* Error message */}
          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, color: '#ff4757', fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={!canSubmit} style={btn(canSubmit)}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>

        {/* Divider + Passkey + Guest */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: T.bd }} />
            <span style={{ fontSize: 11, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>or</span>
            <div style={{ flex: 1, height: 1, background: T.bd }} />
          </div>
          {typeof window !== 'undefined' && !!window.PublicKeyCredential && mode === 'login' && (
            <button
              type="button"
              onClick={async () => {
                if (!username.trim()) { setError('Enter your username first'); return; }
                setLoading(true); setError('');
                try {
                  const start = await api.passkeyLoginStart(username.trim());
                  if (!start.ok) { setError(start.data?.error?.message || 'Passkey login not available'); setLoading(false); return; }
                  const options = start.data;
                  options.publicKey.challenge = base64urlToBuffer(options.publicKey.challenge);
                  if (options.publicKey.allowCredentials) {
                    options.publicKey.allowCredentials = options.publicKey.allowCredentials.map((c: any) => ({
                      ...c, id: base64urlToBuffer(c.id),
                    }));
                  }
                  const assertion = await navigator.credentials.get(options) as PublicKeyCredential;
                  if (!assertion) { setError('Passkey authentication cancelled'); setLoading(false); return; }
                  const resp = assertion.response as AuthenticatorAssertionResponse;
                  const credential = {
                    id: assertion.id,
                    rawId: bufferToBase64url(assertion.rawId),
                    type: assertion.type,
                    response: {
                      authenticatorData: bufferToBase64url(resp.authenticatorData),
                      clientDataJSON: bufferToBase64url(resp.clientDataJSON),
                      signature: bufferToBase64url(resp.signature),
                      userHandle: resp.userHandle ? bufferToBase64url(resp.userHandle) : null,
                    },
                  };
                  const result = await api.passkeyLoginFinish(username.trim(), credential);
                  if (result.ok) onAuth();
                  else setError(result.data?.error?.message || 'Passkey login failed');
                } catch (e: any) {
                  if (e?.name !== 'NotAllowedError') setError(e?.message || 'Passkey login failed');
                }
                setLoading(false);
              }}
              disabled={loading}
              style={{ ...btn(!loading), background: T.sf2, color: T.tx, border: `1px solid ${T.bd}`, width: '100%', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {loading ? '…' : 'Sign in with Passkey'}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              setLoading(true); setError('');
              try {
                const r = await api.registerGuest();
                if (r.ok) onAuth();
                else setError(r.data?.error?.message || 'Error');
              } catch { setError('Network error'); }
              setLoading(false);
            }}
            disabled={loading}
            style={{ ...btn(!loading), background: T.sf2, color: T.tx, border: `1px solid ${T.bd}`, width: '100%' }}>
            {loading ? '…' : 'Join as Guest — No signup required'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, color: T.mt, lineHeight: 1.5 }}>
            Guest accounts have limited access (no servers, voice, or friends). Upgrade anytime.
          </div>
        </div>
      </div>

      {/* Recovery key modal */}
      {recoveryKey && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 440, background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, padding: 'clamp(24px, 5vw, 36px)', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔑</div>
              <h2 style={{ margin: 0, color: T.tx, fontSize: 20, fontWeight: 700 }}>Your Recovery Key</h2>
            </div>

            <div style={{ padding: '14px 16px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, color: '#ff4757', fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
              Save this key somewhere safe. It is the <strong>only way</strong> to recover your account if you lose your password. This key will <strong>never be shown again</strong>.
            </div>

            <div style={{ padding: '16px', background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}`, textAlign: 'center', marginBottom: 16, cursor: 'pointer', userSelect: 'all' }}
              onClick={() => { navigator.clipboard.writeText(recoveryKey); setKeyCopied(true); }}>
              <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: T.ac, letterSpacing: '2px' }}>
                {recoveryKey}
              </div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 8 }}>Click to copy</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => { navigator.clipboard.writeText(recoveryKey); setKeyCopied(true); }}
                style={{ ...btn(true), flex: 1, background: T.sf2, color: T.tx, border: `1px solid ${T.bd}` }}>
                {keyCopied ? 'Copied!' : 'Copy Key'}
              </button>
              <button type="button" onClick={() => {
                  setRecoveryKey('');
                  if (verifyModal) return; // verify modal will show next
                  onAuth();
                }}
                style={{ ...btn(true), flex: 1 }}>
                I've Saved It — Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verification code modal */}
      {verifyModal && !recoveryKey && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 420, background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, padding: 'clamp(24px, 5vw, 36px)', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{'\u2709'}</div>
              <h2 style={{ margin: 0, color: T.tx, fontSize: 20, fontWeight: 700 }}>Verify Your Email</h2>
              <p style={{ margin: '8px 0 0', color: T.mt, fontSize: 13 }}>
                We sent a 6-digit code to <strong style={{ color: T.tx }}>{email}</strong>
              </p>
            </div>

            <input
              style={{ ...getInp(), textAlign: 'center', fontSize: 24, fontFamily: 'monospace', letterSpacing: '8px', marginBottom: 12 }}
              value={verifyCode} onChange={e => { setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setVerifyErr(''); }}
              placeholder="000000" maxLength={6} autoFocus
              autoComplete="one-time-code" inputMode="numeric" name="otp" aria-label="Verification code" />

            {verifyErr && (
              <div style={{ fontSize: 12, color: '#ff4757', marginBottom: 10, textAlign: 'center' }}>{verifyErr}</div>
            )}

            <button type="button" disabled={verifyLoading || verifyCode.length !== 6} onClick={async () => {
              setVerifyLoading(true); setVerifyErr('');
              try {
                const r = await api.verifyCode(verifyCode);
                if (r.ok) { setVerifyModal(false); onAuth(); }
                else setVerifyErr(r.data?.error?.message || 'Invalid code');
              } catch { setVerifyErr('Network error'); }
              setVerifyLoading(false);
            }} style={{ ...btn(verifyCode.length === 6 && !verifyLoading), width: '100%', marginBottom: 12 }}>
              {verifyLoading ? 'Verifying…' : 'Verify'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button type="button" disabled={resendCooldown > 0} onClick={async () => {
                try {
                  const r = await api.resendCode();
                  if (r.ok) {
                    setResendCooldown(60);
                    const iv = setInterval(() => setResendCooldown(c => { if (c <= 1) { clearInterval(iv); return 0; } return c - 1; }), 1000);
                  } else {
                    setVerifyErr(r.data?.error?.message || 'Failed to resend');
                  }
                } catch { setVerifyErr('Network error'); }
              }} style={{ background: 'none', border: 'none', color: resendCooldown > 0 ? T.mt : T.ac, cursor: resendCooldown > 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 500, padding: 0 }}>
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
              </button>

              <button type="button" onClick={() => {
                setVerifyModal(false);
                _storage.setItem('d_verify_skipped', '1');
                onAuth();
              }} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 13, padding: 0 }}>
                Skip for Now
              </button>
            </div>

            <div style={{ fontSize: 11, color: T.mt, marginTop: 14, lineHeight: 1.5, textAlign: 'center' }}>
              Code expires in 10 minutes. Check your spam folder if you don't see it.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dismissible verification banner ─────────────────────────────────────────
// Import and render this in App.tsx when the user is unverified and skipped verification.

export function VerifyEmailBanner({ onVerify, onDismiss }: { onVerify: () => void; onDismiss: () => void }) {
  return (
    <div style={{
      padding: '10px 16px', background: 'rgba(0,212,170,0.08)', borderBottom: `1px solid rgba(0,212,170,0.2)`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <span style={{ fontSize: 13, color: T.tx }}>
        Verify your email to unlock all features.
      </span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={onVerify} style={{
          padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
          background: T.ac, color: '#fff', cursor: 'pointer',
        }}>Verify Now</button>
        <button onClick={onDismiss} style={{
          padding: '5px 10px', fontSize: 12, borderRadius: 6, border: `1px solid ${T.bd}`,
          background: 'transparent', color: T.mt, cursor: 'pointer',
        }}>{'\u2715'}</button>
      </div>
    </div>
  );
}
