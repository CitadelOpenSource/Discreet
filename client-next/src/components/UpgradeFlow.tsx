/**
 * UpgradeFlow — Progressive account upgrade wizard.
 *
 * Steps (based on current tier):
 *   Guest       → Register (pre-filled with guest username)
 *   Unverified  → Verify email (via Resend)
 *   Verified    → Add phone (optional, skip allowed)
 *   Full        → Premium tier comparison
 *
 * Never visible to other users. Accessed via /upgrade command,
 * Settings, guest upgrade modals, or direct navigation.
 */
import React, { useState } from 'react';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';
import { TIER_META, TIER_LIMITS, type Tier } from '../utils/tiers';

// ── Step definitions ──────────────────────────────────────

const STEPS = [
  { key: 'register',  label: 'Create Account', icon: '📝' },
  { key: 'verify',    label: 'Verify Email',   icon: '📬' },
  { key: 'phone',     label: 'Add Phone',      icon: '📱' },
  { key: 'premium',   label: 'Go Premium',     icon: '⚡' },
] as const;

type StepKey = typeof STEPS[number]['key'];

function stepIndex(key: StepKey): number {
  return STEPS.findIndex(s => s.key === key);
}

function tierToStep(tier: Tier): StepKey {
  if (tier === 'guest') return 'register';
  if (tier === 'unverified') return 'verify';
  if (tier === 'verified') return 'phone';
  return 'premium';
}

// ── Props ─────────────────────────────────────────────────

export interface UpgradeFlowProps {
  tier: Tier;
  me: any;                           // user object from /users/@me
  onClose: () => void;
  onLogout: () => void;              // for guest → register (logs out to show AuthScreen)
  onRefreshMe?: () => void;          // re-fetch /users/@me after step completion
}

// ── Component ─────────────────────────────────────────────

export function UpgradeFlow({ tier, me, onClose, onLogout, onRefreshMe }: UpgradeFlowProps) {
  const initialStep = tierToStep(tier);
  const [step, setStep] = useState<StepKey>(initialStep);

  // ── Shared styles ─────────────────────────────
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
  };
  const card: React.CSSProperties = {
    width: 500, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto',
    background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`,
  };
  const header: React.CSSProperties = {
    padding: '20px 24px 16px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', borderBottom: `1px solid ${T.bd}`,
  };

  const currentIdx = stepIndex(step);
  const startIdx = stepIndex(initialStep);

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={header}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>Upgrade Your Account</div>
          <div onClick={onClose} style={{ cursor: 'pointer', color: T.mt, fontSize: 20, lineHeight: 1 }}>&times;</div>
        </div>

        {/* Progress Bar */}
        <ProgressBar currentIdx={currentIdx} startIdx={startIdx} />

        {/* Step Content */}
        <div style={{ padding: '20px 24px 24px' }}>
          {step === 'register'  && <RegisterStep me={me} onLogout={onLogout} onClose={onClose} />}
          {step === 'verify'    && <VerifyStep me={me} onDone={() => { onRefreshMe?.(); setStep('phone'); }} />}
          {step === 'phone'     && <PhoneStep me={me} onDone={() => { onRefreshMe?.(); setStep('premium'); }} onSkip={() => setStep('premium')} />}
          {step === 'premium'   && <PremiumStep tier={tier} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────

function ProgressBar({ currentIdx, startIdx }: { currentIdx: number; startIdx: number }) {
  return (
    <div style={{ padding: '16px 24px 0', display: 'flex', alignItems: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const skipped = i < startIdx;
        const color = done ? T.ac : active ? T.ac : T.bd;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <div style={{
                flex: 1, height: 2,
                background: done ? T.ac : `${T.bd}88`,
                transition: 'background .3s',
              }} />
            )}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              opacity: skipped ? 0.35 : 1,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 14,
                background: done ? T.ac : active ? `${T.ac}22` : T.sf2,
                border: `2px solid ${color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: done ? '#000' : active ? T.ac : T.mt,
                fontWeight: 700, transition: 'all .3s',
              }}>
                {done ? '\u2713' : s.icon}
              </div>
              <div style={{
                fontSize: 9, color: active ? T.ac : T.mt,
                fontWeight: active ? 700 : 400, whiteSpace: 'nowrap',
              }}>
                {s.label}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Step 1: Register (Guest) ──────────────────────────────

function RegisterStep({ me, onLogout, onClose }: { me: any; onLogout: () => void; onClose: () => void }) {
  const guestName = me?.username || '';

  return (
    <div>
      <div style={{ fontSize: 22, textAlign: 'center', marginBottom: 8 }}>📝</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.tx, textAlign: 'center', marginBottom: 6 }}>
        Create Your Account
      </div>
      <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
        You're browsing as a guest. Register to unlock messaging, voice, servers, and more.
        {guestName && (
          <span style={{ display: 'block', marginTop: 6, color: T.tx, fontWeight: 600 }}>
            Your username "{guestName}" will be pre-filled.
          </span>
        )}
      </div>

      {/* Feature comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <FeatureCol
          title="Guest"
          icon={TIER_META.guest.icon}
          color={TIER_META.guest.color}
          current
          items={['Read-only access', '500 char messages', 'No voice or video', 'No file uploads']}
        />
        <FeatureCol
          title="Free Account"
          icon={TIER_META.verified.icon}
          color={TIER_META.verified.color}
          items={['Full messaging', 'Voice & video', 'Create servers', 'File uploads', 'Custom status']}
        />
      </div>

      <button onClick={() => { onClose(); onLogout(); }} style={{
        width: '100%', padding: '12px 0',
        background: `linear-gradient(135deg, ${T.ac}, ${T.ac2 || T.ac})`,
        border: 'none', borderRadius: 10, color: '#000',
        fontSize: 14, fontWeight: 700, cursor: 'pointer',
      }}>
        Create Free Account
      </button>
      <div style={{ fontSize: 11, color: T.mt, textAlign: 'center', marginTop: 8 }}>
        No credit card required. Free forever.
      </div>
    </div>
  );
}

// ── Step 2: Verify Email (Unverified) ─────────────────────

function VerifyStep({ me, onDone }: { me: any; onDone: () => void }) {
  const [email, setEmail] = useState(me?.email || '');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const sendVerification = async () => {
    setError(''); setLoading(true);
    try {
      // If user hasn't set email yet, set it first
      if (!me?.email && email) {
        const r = await api.fetch('/users/@me/email', {
          method: 'PUT',
          body: JSON.stringify({ new_email: email, password: '' }),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({ error: 'Failed to set email' }));
          setError(e.error || e.message || 'Failed to set email');
          setLoading(false);
          return;
        }
      }
      const r = await api.fetch('/auth/verify-email/send', { method: 'POST' });
      if (r.ok) {
        setSent(true);
      } else {
        const e = await r.json().catch(() => ({ error: 'Failed to send' }));
        setError(e.error || e.message || 'Failed to send verification email');
      }
    } catch { setError('Network error'); }
    setLoading(false);
  };

  const confirmCode = async () => {
    setError(''); setLoading(true);
    try {
      const r = await api.fetch('/auth/verify-email/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: code.trim() }),
      });
      if (r.ok) {
        // Server returns a fresh access_token with updated claims.
        const d = await r.json().catch(() => ({}));
        if (d.access_token) api.token = d.access_token;
        onDone();
      } else {
        const e = await r.json().catch(() => ({ error: 'Invalid code' }));
        setError(e.error || e.message || 'Invalid verification code');
      }
    } catch { setError('Network error'); }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ fontSize: 22, textAlign: 'center', marginBottom: 8 }}>📬</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.tx, textAlign: 'center', marginBottom: 6 }}>
        Verify Your Email
      </div>
      <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
        Confirming your email unlocks file uploads, custom status, AI bots, and more.
      </div>

      {!sent ? (
        <>
          <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: '100%', padding: '10px 12px', background: T.bg,
              border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
              fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
            }}
          />

          {/* What you unlock */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: T.mt, marginBottom: 6, fontWeight: 600 }}>This unlocks:</div>
            {TIER_META.verified.perks.slice(0, 4).map(p => (
              <div key={p} style={{ fontSize: 11, color: T.mt, display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                <span style={{ color: T.ac }}>{'\u2713'}</span> {p}
              </div>
            ))}
          </div>

          <button onClick={sendVerification} disabled={loading || !email.includes('@')} style={{
            width: '100%', padding: '10px 0',
            background: email.includes('@') ? T.ac : T.sf2,
            border: 'none', borderRadius: 8, color: email.includes('@') ? '#000' : T.mt,
            fontSize: 13, fontWeight: 700, cursor: email.includes('@') ? 'pointer' : 'default',
            opacity: loading ? 0.6 : 1,
          }}>
            {loading ? 'Sending...' : 'Send Verification Email'}
          </button>
        </>
      ) : (
        <>
          <div style={{
            padding: 14, background: `${T.ac}0a`, border: `1px solid ${T.ac}33`,
            borderRadius: 8, marginBottom: 14, fontSize: 12, color: T.mt, lineHeight: 1.5,
          }}>
            Check your inbox at <strong style={{ color: T.tx }}>{email || me?.email}</strong>.
            Enter the verification code below.
          </div>

          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Enter verification code"
            style={{
              width: '100%', padding: '10px 12px', background: T.bg,
              border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
              fontSize: 14, fontFamily: 'monospace', textAlign: 'center',
              letterSpacing: 2, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
            }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={confirmCode} disabled={loading || !code.trim()} style={{
              flex: 1, padding: '10px 0',
              background: code.trim() ? T.ac : T.sf2,
              border: 'none', borderRadius: 8, color: code.trim() ? '#000' : T.mt,
              fontSize: 13, fontWeight: 700, cursor: code.trim() ? 'pointer' : 'default',
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Verifying...' : 'Confirm'}
            </button>
            <button onClick={() => { setSent(false); setCode(''); setError(''); }} style={{
              padding: '10px 16px', background: T.sf2, border: `1px solid ${T.bd}`,
              borderRadius: 8, color: T.mt, fontSize: 12, cursor: 'pointer',
            }}>
              Resend
            </button>
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 6, fontSize: 12, color: '#ff4757' }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Step 3: Phone (Optional) ──────────────────────────────

function PhoneStep({ me, onDone, onSkip }: { me: any; onDone: () => void; onSkip: () => void }) {
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setError(''); setLoading(true);
    try {
      const r = await api.fetch('/auth/verify-phone/send', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (r.ok) { setSent(true); }
      else {
        const e = await r.json().catch(() => ({ error: 'Failed' }));
        setError(e.error || e.message || 'Failed to send code');
      }
    } catch { setError('Network error'); }
    setLoading(false);
  };

  const confirmCode = async () => {
    setError(''); setLoading(true);
    try {
      const r = await api.fetch('/auth/verify-phone/confirm', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      if (r.ok) { onDone(); }
      else {
        const e = await r.json().catch(() => ({ error: 'Invalid code' }));
        setError(e.error || e.message || 'Invalid code');
      }
    } catch { setError('Network error'); }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ fontSize: 22, textAlign: 'center', marginBottom: 8 }}>📱</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.tx, textAlign: 'center', marginBottom: 6 }}>
        Add Your Phone Number
      </div>
      <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
        Optional — adds an extra layer of account recovery. You can always do this later in Settings.
      </div>

      {!sent ? (
        <>
          <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
            Phone Number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+1 (555) 123-4567"
            style={{
              width: '100%', padding: '10px 12px', background: T.bg,
              border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
              fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 16,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={sendCode} disabled={loading || phone.trim().length < 7} style={{
              flex: 1, padding: '10px 0',
              background: phone.trim().length >= 7 ? T.ac : T.sf2,
              border: 'none', borderRadius: 8,
              color: phone.trim().length >= 7 ? '#000' : T.mt,
              fontSize: 13, fontWeight: 700,
              cursor: phone.trim().length >= 7 ? 'pointer' : 'default',
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Sending...' : 'Send Code'}
            </button>
            <button onClick={onSkip} style={{
              padding: '10px 20px', background: T.sf2, border: `1px solid ${T.bd}`,
              borderRadius: 8, color: T.mt, fontSize: 12, cursor: 'pointer',
            }}>
              Skip for Now
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{
            padding: 14, background: `${T.ac}0a`, border: `1px solid ${T.ac}33`,
            borderRadius: 8, marginBottom: 14, fontSize: 12, color: T.mt, lineHeight: 1.5,
          }}>
            Code sent to <strong style={{ color: T.tx }}>{phone}</strong>. Enter it below.
          </div>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Enter code"
            style={{
              width: '100%', padding: '10px 12px', background: T.bg,
              border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
              fontSize: 14, fontFamily: 'monospace', textAlign: 'center',
              letterSpacing: 2, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={confirmCode} disabled={loading || !code.trim()} style={{
              flex: 1, padding: '10px 0',
              background: code.trim() ? T.ac : T.sf2,
              border: 'none', borderRadius: 8, color: code.trim() ? '#000' : T.mt,
              fontSize: 13, fontWeight: 700, cursor: code.trim() ? 'pointer' : 'default',
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Verifying...' : 'Confirm'}
            </button>
            <button onClick={onSkip} style={{
              padding: '10px 20px', background: T.sf2, border: `1px solid ${T.bd}`,
              borderRadius: 8, color: T.mt, fontSize: 12, cursor: 'pointer',
            }}>
              Skip
            </button>
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 6, fontSize: 12, color: '#ff4757' }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Step 4: Premium Tiers ─────────────────────────────────

const PAID_TIERS: Tier[] = ['pro', 'teams', 'enterprise'];

function PremiumStep({ tier, onClose }: { tier: Tier; onClose: () => void }) {
  return (
    <div>
      <div style={{ fontSize: 22, textAlign: 'center', marginBottom: 8 }}>⚡</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.tx, textAlign: 'center', marginBottom: 6 }}>
        Upgrade to Premium
      </div>
      <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
        You've got the essentials. Unlock even more with a premium plan.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {PAID_TIERS.map(t => {
          const m = TIER_META[t];
          const isCurrent = t === tier;
          return (
            <div key={t} style={{
              padding: 16, background: isCurrent ? `${m.color}0a` : T.sf2,
              border: `1px solid ${isCurrent ? m.color + '44' : T.bd}`,
              borderRadius: 10, position: 'relative',
            }}>
              {isCurrent && (
                <div style={{
                  position: 'absolute', top: -8, right: 12, background: m.color,
                  color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 8px',
                  borderRadius: 8, textTransform: 'uppercase',
                }}>Current</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.label}</span>
                <span style={{ fontSize: 12, color: T.mt, marginLeft: 'auto' }}>{m.price}</span>
              </div>
              <div style={{ fontSize: 11, color: T.mt, marginBottom: 8 }}>{m.tagline}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {m.perks.map(p => (
                  <div key={p} style={{
                    fontSize: 10, color: T.mt, display: 'flex', alignItems: 'center',
                    gap: 4, padding: '2px 6px', background: `${m.color}08`, borderRadius: 4,
                  }}>
                    <span style={{ color: m.color }}>{'\u2713'}</span> {p}
                  </div>
                ))}
              </div>
              {!isCurrent && (
                <button style={{
                  marginTop: 10, padding: '6px 14px',
                  background: `${m.color}15`, border: `1px solid ${m.color}44`,
                  borderRadius: 7, color: m.color, fontSize: 11,
                  fontWeight: 700, cursor: 'pointer',
                }}>
                  {t === 'enterprise' ? 'Contact Us' : 'Coming Soon'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={onClose} style={{
        width: '100%', padding: '10px 0', marginTop: 16,
        background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 8,
        color: T.mt, fontSize: 12, cursor: 'pointer',
      }}>
        Done
      </button>
    </div>
  );
}

// ── Shared: Feature column ────────────────────────────────

function FeatureCol({ title, icon, color, items, current }: {
  title: string; icon: string; color: string; items: string[]; current?: boolean;
}) {
  return (
    <div style={{
      background: T.bg, borderRadius: 10, padding: 14,
      border: current ? `1px solid ${T.bd}` : `2px solid ${color}44`,
      position: 'relative',
    }}>
      {!current && (
        <div style={{
          position: 'absolute', top: -8, right: 10, background: color,
          color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 8px',
          borderRadius: 8, textTransform: 'uppercase',
        }}>Upgrade</div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: current ? T.mt : color, marginBottom: 8 }}>
        {icon} {title}
      </div>
      {items.map(it => (
        <div key={it} style={{
          fontSize: 11, color: current ? T.mt : T.tx, padding: '3px 0',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ color: current ? 'rgba(255,71,87,0.5)' : color, fontSize: 12 }}>
            {current ? '\u2717' : '\u2713'}
          </span>
          {it}
        </div>
      ))}
    </div>
  );
}
