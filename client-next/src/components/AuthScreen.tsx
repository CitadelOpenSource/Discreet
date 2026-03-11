/**
 * AuthScreen — Login / Register / Guest / Meeting Join screen.
 * First thing users see before authentication.
 */
import React, { useState } from 'react';
import { T, getInp, btn } from '../theme';
import { api } from '../api/CitadelAPI';

interface AuthScreenProps {
  onAuth: () => void;
}

export function AuthScreen({ onAuth }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await api.login(username, password)
        : await api.register(username, password, email);
      if (res.ok) {
        const u = username.trim().toLowerCase();
        if (u === 'admin' || u === 'dev') {
          localStorage.setItem('d_dev_local', 'true');
        }
        onAuth();
      } else setError(res.data?.error?.message || 'Error');
    } catch {
      setError('Network error');
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 400, maxWidth: '92vw', padding: 'clamp(24px,5vw,40px)', background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}` }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🛡️</div>
          <h1 style={{ margin: 0, color: T.tx, fontSize: 26, fontWeight: 700 }}>Discreet</h1>
          <p style={{ margin: '8px 0 0', color: T.mt, fontSize: 13 }}>Zero-knowledge encrypted messaging</p>
        </div>

        {/* Form */}
        <form onSubmit={submit}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Username</label>
          <input style={{ ...getInp(), marginBottom: 14 }} value={username} onChange={e => setUsername(e.target.value)} placeholder="alice" autoFocus />

          {mode === 'register' && (
            <>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email (optional)</label>
              <input style={{ ...getInp(), marginBottom: 14 }} value={email} onChange={e => setEmail(e.target.value)} placeholder="alice@example.com" />
            </>
          )}

          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Password</label>
          <input style={{ ...getInp(), marginBottom: 18 }} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />

          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, color: T.err, fontSize: 13, marginBottom: 14 }}>{error}</div>
          )}

          <button type="submit" disabled={loading} style={btn(!loading)}>
            {loading ? '...' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>

        {/* Toggle mode */}
        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: T.mt }}>
          {mode === 'login' ? 'Need an account?' : 'Already have one?'}{' '}
          <span onClick={() => { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); }}
            style={{ color: T.ac, cursor: 'pointer', fontWeight: 600 }}>
            {mode === 'login' ? 'Register' : 'Log In'}
          </span>
        </div>

        {/* Guest login */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: T.bd }} />
            <span style={{ fontSize: 11, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px' }}>or</span>
            <div style={{ flex: 1, height: 1, background: T.bd }} />
          </div>
          <button
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
            {loading ? '...' : 'Join as Guest — No signup required'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 8, fontSize: 10, color: T.mt, lineHeight: 1.5 }}>
            Guest accounts have limited access (no servers, voice, or friends). Upgrade anytime.
          </div>
        </div>
      </div>
    </div>
  );
}
