/**
 * AuthScreen — Login / Register / Guest / Meeting Join screen.
 * First thing users see before authentication.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { T, ta, getInp, btn } from '../theme';
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

  // Anonymous registration
  const [anonMode, setAnonMode]             = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [phraseConfirmed, setPhraseConfirmed] = useState(false);
  const [loginWithPhrase, setLoginWithPhrase] = useState(false);
  const [phraseInput, setPhraseInput]         = useState('');

  // OAuth providers + SAML SSO
  const [oauthProviders, setOauthProviders] = useState<{ provider: string; client_id: string }[]>([]);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [samlEnabled, setSamlEnabled] = useState(false);
  const [samlLoading, setSamlLoading] = useState(false);

  useEffect(() => {
    api.fetch('/auth/oauth/providers').then(r => r.json()).then((data: any) => {
      if (Array.isArray(data?.providers)) setOauthProviders(data.providers);
    }).catch(() => {});
    // Check SAML
    api.fetch('/info').then(r => r.json()).then((info: any) => {
      // Read saml_enabled from platform settings via info or separate call
    }).catch(() => {});
    api.fetch('/admin/settings').then(r => { if (r.ok) return r.json(); return null; }).then((s: any) => {
      if (s?.saml_enabled) setSamlEnabled(true);
    }).catch(() => {
      // Non-admin: try reading from a public endpoint instead
      // For now, check if SAML metadata endpoint exists
      fetch(`${window.location.origin}/api/v1/auth/saml/metadata`, { method: 'HEAD' })
        .then(r => { if (r.ok) setSamlEnabled(true); })
        .catch(() => {});
    });
  }, []);

  const handleOAuthLogin = async (provider: string) => {
    setOauthLoading(provider);
    setError('');
    try {
      const r = await api.fetch(`/auth/oauth/${provider}/authorize`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data.auth_url) window.location.href = data.auth_url;
    } catch (e: any) {
      setError(e?.message || 'OAuth login failed');
    }
    setOauthLoading(null);
  };

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

  const submitAnonymous = async () => {
    if (!username.trim()) { setError('Username is required'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.registerAnonymous(username.trim());
      if (res.ok && res.data?.recovery_phrase) {
        setRecoveryPhrase(res.data.recovery_phrase);
      } else {
        setError(res.data?.error?.message || res.data?.error || 'Registration failed');
      }
    } catch (e: any) {
      setError(e?.message || 'Registration failed');
    }
    setLoading(false);
  };

  const submitLoginAnonymous = async () => {
    if (!username.trim() || !phraseInput.trim()) { setError('Username and recovery phrase are required'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.loginAnonymous(username.trim(), phraseInput.trim());
      if (res.ok) {
        onAuth();
      } else {
        setError(res.data?.error?.message || res.data?.error || 'Invalid username or recovery phrase');
      }
    } catch (e: any) {
      setError(e?.message || 'Login failed');
    }
    setLoading(false);
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

        {/* ── SAML SSO button ── */}
        {mode === 'login' && samlEnabled && (
          <div style={{ marginBottom: oauthProviders.length > 0 ? 8 : 16 }}>
            <button type="button" onClick={async () => {
              setSamlLoading(true);
              try {
                // Read SSO URL from settings and redirect
                const r = await api.fetch('/admin/settings').catch(() => null);
                const s = r && r.ok ? await r.json() : null;
                const ssoUrl = s?.saml_sso_url;
                if (ssoUrl) {
                  window.location.href = ssoUrl;
                } else {
                  setError('SSO is enabled but no IdP login URL is configured. Contact your administrator.');
                }
              } catch { setError('SSO login failed'); }
              setSamlLoading(false);
            }} disabled={samlLoading} style={{
              height: 44, width: '100%', borderRadius: 8, border: 'none',
              background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
              color: '#000', fontSize: 14, fontWeight: 600,
              cursor: samlLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 10, opacity: samlLoading ? 0.7 : 1,
              fontFamily: "'DM Sans',sans-serif",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              {samlLoading ? 'Redirecting to SSO...' : 'Sign in with SSO'}
            </button>
          </div>
        )}

        {/* ── OAuth social login buttons ── */}
        {mode === 'login' && oauthProviders.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {oauthProviders.map(p => (
                <OAuthButton key={p.provider} provider={p.provider} loading={oauthLoading === p.provider} onClick={() => handleOAuthLogin(p.provider)} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: T.bd }} />
              <span style={{ fontSize: 12, color: T.mt, fontWeight: 500 }}>or</span>
              <div style={{ flex: 1, height: 1, background: T.bd }} />
            </div>
          </div>
        )}

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

          {/* Anonymous Registration */}
          {mode === 'register' && !anonMode && (
            <button type="button" onClick={() => setAnonMode(true)}
              style={{ ...btn(true), background: T.sf2, color: T.ac, border: `1px solid ${ta(T.ac, '33')}`, width: '100%', marginTop: 10 }}>
              Register Anonymously — No email required
            </button>
          )}
          {mode === 'register' && anonMode && !recoveryPhrase && (
            <div style={{ marginTop: 10, padding: 14, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 8 }}>Anonymous Registration</div>
              <div style={{ fontSize: 11, color: T.mt, marginBottom: 10, lineHeight: 1.5 }}>No email, no phone number. You'll receive a 12-word recovery phrase instead of a password.</div>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Choose a username" style={{ ...getInp(), marginBottom: 8 }} />
              {error && <div style={{ fontSize: 11, color: '#ff4757', marginBottom: 8 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setAnonMode(false)} style={{ ...btn(true), background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, flex: 1 }}>Cancel</button>
                <button type="button" onClick={submitAnonymous} disabled={loading || !username.trim()} style={{ ...btn(!loading && !!username.trim()), flex: 1 }}>{loading ? 'Creating...' : 'Create Account'}</button>
              </div>
            </div>
          )}

          {/* Login with Recovery Phrase */}
          {mode === 'login' && !loginWithPhrase && (
            <button type="button" onClick={() => setLoginWithPhrase(true)}
              style={{ background: 'none', border: 'none', color: T.ac, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0, marginTop: 10 }}>
              Login with Recovery Phrase
            </button>
          )}
          {mode === 'login' && loginWithPhrase && (
            <div style={{ marginTop: 10, padding: 14, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 8 }}>Recovery Phrase Login</div>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" style={{ ...getInp(), marginBottom: 8 }} />
              <textarea value={phraseInput} onChange={e => setPhraseInput(e.target.value)} placeholder="Enter your 12-word recovery phrase" rows={3}
                style={{ ...getInp(), resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginBottom: 8 }} />
              {error && <div style={{ fontSize: 11, color: '#ff4757', marginBottom: 8 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setLoginWithPhrase(false)} style={{ ...btn(true), background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, flex: 1 }}>Cancel</button>
                <button type="button" onClick={submitLoginAnonymous} disabled={loading || !username.trim() || !phraseInput.trim()} style={{ ...btn(!loading && !!username.trim() && !!phraseInput.trim()), flex: 1 }}>{loading ? 'Verifying...' : 'Log In'}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recovery phrase modal (anonymous registration success) */}
      {recoveryPhrase && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 480, background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, padding: 'clamp(24px, 5vw, 36px)', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.tx }}>Your Recovery Phrase</div>
              <div style={{ fontSize: 12, color: T.mt, marginTop: 4 }}>This is the <strong>only</strong> way to access your account.</div>
            </div>

            <div style={{ padding: '16px 20px', background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600, color: T.ac, lineHeight: 2, textAlign: 'center', marginBottom: 16, wordSpacing: '0.5em' }}>
              {recoveryPhrase}
            </div>

            <div style={{ padding: '10px 14px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#ff4757', lineHeight: 1.6 }}>
              <strong>This is the ONLY way to recover your account.</strong> We cannot help you if you lose these words. Write them down and store them safely.
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button type="button" onClick={() => navigator.clipboard?.writeText(recoveryPhrase)}
                style={{ flex: 1, padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.bd}`, background: T.sf2, color: T.tx, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Copy to clipboard
              </button>
              <button type="button" onClick={() => {
                const blob = new Blob([`Discreet Recovery Phrase\n\nUsername: ${username}\nPhrase: ${recoveryPhrase}\n\nStore this file securely. Delete after writing down the words.`], { type: 'text/plain' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'discreet-recovery.txt'; a.click(); URL.revokeObjectURL(a.href);
              }}
                style={{ flex: 1, padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.bd}`, background: T.sf2, color: T.tx, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Download as file
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={phraseConfirmed} onChange={e => setPhraseConfirmed(e.target.checked)}
                style={{ accentColor: T.ac, width: 16, height: 16, flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: T.tx, lineHeight: 1.5 }}>I have saved my recovery phrase and understand it cannot be retrieved later.</span>
            </label>

            <button type="button" disabled={!phraseConfirmed} onClick={() => { setRecoveryPhrase(''); onAuth(); }}
              style={{ ...btn(phraseConfirmed), width: '100%' }}>
              {phraseConfirmed ? 'Continue to Discreet' : 'Save your phrase first'}
            </button>
          </div>
        </div>
      )}

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

// ─── OAuth branded buttons ──────────────────────────────────────────────────

const OAUTH_BRANDS: Record<string, { bg: string; color: string; border: string; label: string; logo: React.ReactNode }> = {
  google: {
    bg: '#ffffff', color: '#3c4043', border: '1px solid #dadce0', label: 'Continue with Google',
    logo: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 001 12c0 1.94.46 3.77 1.18 5.39l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
  },
  github: {
    bg: '#24292f', color: '#ffffff', border: 'none', label: 'Continue with GitHub',
    logo: <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>,
  },
  apple: {
    bg: '#000000', color: '#ffffff', border: 'none', label: 'Continue with Apple',
    logo: <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>,
  },
  discord: {
    bg: '#5865F2', color: '#ffffff', border: 'none', label: 'Continue with Discord',
    logo: <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>,
  },
};

function OAuthButton({ provider, loading, onClick }: { provider: string; loading: boolean; onClick: () => void }) {
  const brand = OAUTH_BRANDS[provider];
  if (!brand) return null;
  return (
    <button type="button" onClick={onClick} disabled={loading} style={{
      height: 44, width: '100%', borderRadius: 8, border: brand.border,
      background: brand.bg, color: brand.color, fontSize: 14, fontWeight: 500,
      cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 10, opacity: loading ? 0.7 : 1,
      fontFamily: "'DM Sans',sans-serif", transition: 'opacity .15s',
    }}>
      {brand.logo}
      {loading ? 'Redirecting...' : brand.label}
    </button>
  );
}

// ─── OAuth callback page ────────────────────────────────────────────────────

export function OAuthCallback({ onAuth }: { onAuth: () => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const pathParts = window.location.pathname.split('/');
    const provider = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

    if (!code || !state) {
      setError('Missing authorization code or state parameter.');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const r = await fetch(`${window.location.origin}/api/v1/auth/oauth/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error((e as any).error || `Authentication failed (${r.status})`);
        }
        const data = await r.json();
        if (data.access_token) {
          (api as any).token = data.access_token;
          if (data.user) {
            api.userId = data.user.id;
            api.username = data.user.username;
            _storage.setItem('d_uid', data.user.id);
            _storage.setItem('d_uname', data.user.username);
          }
          window.history.replaceState({}, '', '/app');
          onAuth();
        } else {
          throw new Error('No access token in response');
        }
      } catch (e: any) {
        setError(e?.message || 'OAuth login failed');
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ maxWidth: 400, width: '100%', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: T.ac, marginBottom: 24 }}>Discreet</div>
        {loading && (
          <div style={{ color: T.mt, fontSize: 14 }}>Completing login...</div>
        )}
        {error && (
          <div>
            <div style={{ color: T.err, fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>{error}</div>
            <button onClick={() => { window.location.href = '/app'; }} style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: T.ac, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>Back to Login</button>
          </div>
        )}
      </div>
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
