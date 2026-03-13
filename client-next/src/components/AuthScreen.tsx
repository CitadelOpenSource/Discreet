/**
 * AuthScreen — Login / Register / Guest / Meeting Join screen.
 * First thing users see before authentication.
 */
import React, { useState, useMemo } from 'react';
import { T, getInp, btn } from '../theme';
import { api, storageBlocked, _storage } from '../api/CitadelAPI';

interface AuthScreenProps {
  onAuth: () => void;
}

// ─── Password strength ────────────────────────────────────────────────────────

type StrengthLevel = 'too-short' | 'weak' | 'fair' | 'good' | 'strong';

interface StrengthResult {
  level: StrengthLevel;
  label: string;
  color: string;
  score: number; // 0-4
}

function passwordStrength(pw: string): StrengthResult {
  if (pw.length === 0) return { level: 'too-short', label: '', color: T.bd, score: 0 };
  if (pw.length < 8)   return { level: 'too-short', label: 'Too short', color: '#ff4757', score: 0 };

  let types = 0;
  if (/[a-z]/.test(pw)) types++;
  if (/[A-Z]/.test(pw)) types++;
  if (/[0-9]/.test(pw)) types++;
  if (/[^a-zA-Z0-9]/.test(pw)) types++;

  const long = pw.length >= 12;

  if (types === 1) return { level: 'weak',   label: 'Weak',      color: '#ff6b35', score: 1 };
  if (types === 2) return { level: 'fair',   label: 'Fair',      color: '#faa61a', score: 2 };
  if (types === 3) return { level: 'good',   label: long ? 'Strong' : 'Good', color: long ? '#2ecc71' : '#00d4aa', score: long ? 4 : 3 };
  return            { level: 'strong', label: 'Strong',     color: '#2ecc71', score: 4 };
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
  const [email, setEmail]         = useState('');
  const [termsOk, setTermsOk]     = useState(false);

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

  const canSubmit = (() => {
    if (loading) return false;
    if (!username.trim() || !password) return false;
    if (mode === 'register') {
      if (usernameErr) return false;
      if (password.length < 8) return false;
      if (!termsOk) return false;
    }
    return true;
  })();

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
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
        : await api.register(username, password, email || undefined);
      if (res.ok) {
        const u = username.trim().toLowerCase();
        if (u === 'admin' || u === 'dev') _storage.setItem('d_dev_local', 'true');
        if (rememberMe) _storage.setItem('d_remember_me', '1');
        if (mode === 'register' && res.data?.recovery_key) {
          setRecoveryKey(res.data.recovery_key);
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
                placeholder="alice or alice@example.com" autoFocus autoComplete="username" />

              <label style={label()}>Password</label>
              <input style={{ ...getInp(), marginBottom: 8 }} type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password" />

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
                      style={{ ...getInp(), marginBottom: 8 }} autoFocus />
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
                      type="password" placeholder="Minimum 8 characters" value={fpNewPw}
                      onChange={e => { setFpNewPw(e.target.value); setFpError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('fp-reset-btn')?.click(); } }}
                      style={{ ...getInp(), marginBottom: 8 }} autoComplete="new-password" />
                    {fpError && <div style={{ fontSize: 11, color: '#ff4757', marginBottom: 8 }}>{fpError}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button id="fp-reset-btn" type="button" disabled={fpLoading || !fpToken.trim() || fpNewPw.length < 8} onClick={async () => {
                        setFpError(''); setFpLoading(true);
                        try {
                          await api.resetPassword(fpToken.trim(), fpNewPw);
                          setFpStep('done');
                        } catch (e: any) { setFpError(e.message || 'Reset failed'); }
                        setFpLoading(false);
                      }} style={btn(!fpLoading && !!fpToken.trim() && fpNewPw.length >= 8)}>
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
                placeholder="alice" autoFocus autoComplete="username"
                maxLength={32} />
              {fieldErr(usernameErr)}
              {!usernameErr && username.length > 0 && (
                <div style={{ fontSize: 11, color: T.mt, marginBottom: 10, marginTop: -8 }}>
                  3–32 characters · letters, numbers, _ and - only
                </div>
              )}

              <label style={label()}>Password</label>
              <input
                style={{ ...getInp(), marginBottom: 8, borderColor: password.length > 0 && password.length < 8 ? '#ff4757' : undefined }}
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Minimum 8 characters" autoComplete="new-password" />

              {/* Strength indicator */}
              {password.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, transition: 'background .2s',
                        background: strength.score >= i ? strength.color : T.bd }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: strength.color, fontWeight: 600 }}>
                    {strength.label}
                    {strength.level === 'too-short' && <span style={{ color: T.mt, fontWeight: 400 }}> — minimum 8 characters</span>}
                  </div>
                </div>
              )}
              {password.length === 0 && <div style={{ marginBottom: 14 }} />}

              <label style={label()}>Email <span style={{ color: T.mt, fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(optional)</span></label>
              <input style={{ ...getInp(), marginBottom: 6 }} type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="alice@example.com" autoComplete="email" />
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5, marginBottom: 18 }}>
                Adding an email enables account recovery and qualifies your account for the Verified tier.
              </div>

              {/* Terms checkbox */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 18, userSelect: 'none' }}>
                <input type="checkbox" checked={termsOk} onChange={e => setTermsOk(e.target.checked)}
                  style={{ accentColor: T.ac, width: 15, height: 15, flexShrink: 0, marginTop: 1, cursor: 'pointer' }} />
                <span style={{ fontSize: 12, color: T.mt, lineHeight: 1.5 }}>
                  I agree to the{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: T.ac, textDecoration: 'none', fontWeight: 600 }}>Terms of Service</a>
                  {' '}and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: T.ac, textDecoration: 'none', fontWeight: 600 }}>Privacy Policy</a>
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

        {/* Divider + Guest */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: T.bd }} />
            <span style={{ fontSize: 11, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>or</span>
            <div style={{ flex: 1, height: 1, background: T.bd }} />
          </div>
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
              <button type="button" onClick={() => { setRecoveryKey(''); onAuth(); }}
                style={{ ...btn(true), flex: 1 }}>
                I've Saved It — Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
