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
import { T, ta } from '../theme';
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
                background: done ? T.ac : `${ta(T.bd,'88')}`,
                transition: 'background .3s',
              }} />
            )}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              opacity: skipped ? 0.35 : 1,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 14,
                background: done ? T.ac : active ? `${ta(T.ac,'22')}` : T.sf2,
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
          setError(typeof e.error === 'string' ? e.error : e.error?.message || e.message || 'Failed to set email');
          setLoading(false);
          return;
        }
      }
      const r = await api.fetch('/auth/verify-email/send', { method: 'POST' });
      if (r.ok) {
        setSent(true);
      } else {
        const e = await r.json().catch(() => ({ error: 'Failed to send' }));
        setError(typeof e.error === 'string' ? e.error : e.error?.message || e.message || 'Failed to send verification email');
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
        setError(typeof e.error === 'string' ? e.error : e.error?.message || e.message || 'Invalid verification code');
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
              border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
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
            border: 'none', borderRadius: 'var(--radius-md)', color: email.includes('@') ? '#000' : T.mt,
            fontSize: 13, fontWeight: 700, cursor: email.includes('@') ? 'pointer' : 'default',
            opacity: loading ? 0.6 : 1,
          }}>
            {loading ? 'Sending...' : 'Send Verification Email'}
          </button>
        </>
      ) : (
        <>
          <div style={{
            padding: 14, background: `${ta(T.ac,'0a')}`, border: `1px solid ${ta(T.ac,'33')}`,
            borderRadius: 'var(--radius-md)', marginBottom: 14, fontSize: 12, color: T.mt, lineHeight: 1.5,
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
              border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
              fontSize: 14, fontFamily: 'monospace', textAlign: 'center',
              letterSpacing: 2, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
            }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={confirmCode} disabled={loading || !code.trim()} style={{
              flex: 1, padding: '10px 0',
              background: code.trim() ? T.ac : T.sf2,
              border: 'none', borderRadius: 'var(--radius-md)', color: code.trim() ? '#000' : T.mt,
              fontSize: 13, fontWeight: 700, cursor: code.trim() ? 'pointer' : 'default',
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Verifying...' : 'Confirm'}
            </button>
            <button onClick={() => { setSent(false); setCode(''); setError(''); }} style={{
              padding: '10px 16px', background: T.sf2, border: `1px solid ${T.bd}`,
              borderRadius: 'var(--radius-md)', color: T.mt, fontSize: 12, cursor: 'pointer',
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
        setError(typeof e.error === 'string' ? e.error : e.error?.message || e.message || 'Failed to send code');
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
        setError(typeof e.error === 'string' ? e.error : e.error?.message || e.message || 'Invalid code');
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
              border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
              fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 16,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={sendCode} disabled={loading || phone.trim().length < 7} style={{
              flex: 1, padding: '10px 0',
              background: phone.trim().length >= 7 ? T.ac : T.sf2,
              border: 'none', borderRadius: 'var(--radius-md)',
              color: phone.trim().length >= 7 ? '#000' : T.mt,
              fontSize: 13, fontWeight: 700,
              cursor: phone.trim().length >= 7 ? 'pointer' : 'default',
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Sending...' : 'Send Code'}
            </button>
            <button onClick={onSkip} style={{
              padding: '10px 20px', background: T.sf2, border: `1px solid ${T.bd}`,
              borderRadius: 'var(--radius-md)', color: T.mt, fontSize: 12, cursor: 'pointer',
            }}>
              Skip for Now
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{
            padding: 14, background: `${ta(T.ac,'0a')}`, border: `1px solid ${ta(T.ac,'33')}`,
            borderRadius: 'var(--radius-md)', marginBottom: 14, fontSize: 12, color: T.mt, lineHeight: 1.5,
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
              border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
              fontSize: 14, fontFamily: 'monospace', textAlign: 'center',
              letterSpacing: 2, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={confirmCode} disabled={loading || !code.trim()} style={{
              flex: 1, padding: '10px 0',
              background: code.trim() ? T.ac : T.sf2,
              border: 'none', borderRadius: 'var(--radius-md)', color: code.trim() ? '#000' : T.mt,
              fontSize: 13, fontWeight: 700, cursor: code.trim() ? 'pointer' : 'default',
              opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'Verifying...' : 'Confirm'}
            </button>
            <button onClick={onSkip} style={{
              padding: '10px 20px', background: T.sf2, border: `1px solid ${T.bd}`,
              borderRadius: 'var(--radius-md)', color: T.mt, fontSize: 12, cursor: 'pointer',
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

const PLAN_FEATURES = [
  { label: 'Servers',             free: '5',    pro: '20',    ent: 'Unlimited' },
  { label: 'Members per server',  free: '50',   pro: '500',   ent: 'Unlimited' },
  { label: 'File upload',         free: '25 MB', pro: '100 MB', ent: '500 MB' },
  { label: 'AI agents',           free: '1',    pro: '5',     ent: 'Unlimited' },
  { label: 'Custom emoji',        free: '50',   pro: '500',   ent: 'Unlimited' },
  { label: 'Audit log',           free: '7 days', pro: '90 days', ent: 'Forever' },
  { label: 'Priority support',    free: '',     pro: 'check', ent: 'check' },
  { label: 'Custom branding',     free: '',     pro: '',      ent: 'check' },
  { label: 'SSO / SAML',          free: '',     pro: '',      ent: 'check' },
  { label: 'SLA guarantee',       free: '',     pro: '',      ent: 'check' },
];

function PremiumStep({ tier, onClose }: { tier: Tier; onClose: () => void }) {
  const [showPayment, setShowPayment] = useState<string | null>(null); // 'pro' or 'teams'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Self-hosted: skip the entire upgrade flow
  const isSelfHosted = localStorage.getItem('d_self_hosted') === 'true';
  if (isSelfHosted) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>🏠</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 6 }}>All features unlocked</div>
        <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.5, marginBottom: 16 }}>Self-hosted instance — enterprise-tier limits apply to all users.</div>
        <button onClick={onClose} style={{ padding: '8px 24px', borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, fontSize: 13, cursor: 'pointer' }}>Close</button>
      </div>
    );
  }

  const startCheckout = async (selectedTier: string, method: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.fetch('/billing/create-checkout', {
        method: 'POST',
        body: JSON.stringify({ tier: selectedTier, payment_method: method }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Checkout failed');
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to create checkout');
    }
    setLoading(false);
  };

  const check = <span style={{ color: T.ac, fontWeight: 700 }}>✓</span>;
  const dash = <span style={{ color: T.bd }}>—</span>;
  const cell = (v: string) => v === 'check' ? check : v === '' ? dash : <span>{v}</span>;

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.tx, textAlign: 'center', marginBottom: 4 }}>
        Choose Your Plan
      </div>
      <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', marginBottom: 16, lineHeight: 1.5 }}>
        All plans include E2E encryption, zero-knowledge architecture, and no tracking.
      </div>

      {/* Plan headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 0, marginBottom: 2, fontSize: 11 }}>
        <div />
        <div style={{ textAlign: 'center', padding: '10px 4px', background: tier === 'verified' ? `${ta(T.ac,'10')}` : 'transparent', borderRadius: '8px 8px 0 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>Free</div>
          <div style={{ fontSize: 11, color: T.mt }}>$0/mo</div>
          {(tier === 'verified' || tier === 'unverified' || tier === 'guest') && <div style={{ fontSize: 9, color: T.ac, fontWeight: 700, marginTop: 2 }}>CURRENT</div>}
        </div>
        <div style={{ textAlign: 'center', padding: '10px 4px', background: tier === 'pro' ? 'rgba(88,101,242,0.1)' : 'transparent', borderRadius: '8px 8px 0 0', border: tier !== 'pro' ? `1px solid #5865F244` : undefined, borderBottom: 'none' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#5865F2' }}>Pro</div>
          <div style={{ fontSize: 11, color: T.mt }}>$8/mo</div>
          {tier === 'pro' && <div style={{ fontSize: 9, color: '#5865F2', fontWeight: 700, marginTop: 2 }}>CURRENT</div>}
        </div>
        <div style={{ textAlign: 'center', padding: '10px 4px', background: tier === 'enterprise' ? 'rgba(250,166,26,0.1)' : 'transparent', borderRadius: '8px 8px 0 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#faa61a' }}>Enterprise</div>
          <div style={{ fontSize: 11, color: T.mt }}>Contact Us</div>
          {tier === 'enterprise' && <div style={{ fontSize: 9, color: '#faa61a', fontWeight: 700, marginTop: 2 }}>CURRENT</div>}
        </div>
      </div>

      {/* Feature rows */}
      {PLAN_FEATURES.map((f, i) => (
        <div key={f.label} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 0, fontSize: 11, background: i % 2 === 0 ? T.sf2 : 'transparent', borderRadius: 4, padding: '5px 0' }}>
          <div style={{ padding: '0 8px', color: T.mt, fontWeight: 600 }}>{f.label}</div>
          <div style={{ textAlign: 'center', color: T.tx }}>{cell(f.free)}</div>
          <div style={{ textAlign: 'center', color: T.tx }}>{cell(f.pro)}</div>
          <div style={{ textAlign: 'center', color: T.tx }}>{cell(f.ent)}</div>
        </div>
      ))}

      {/* Action buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 0, marginTop: 12, padding: '0 0 4px' }}>
        <div />
        <div style={{ textAlign: 'center' }}>
          {(tier === 'verified' || tier === 'unverified' || tier === 'guest') && (
            <div style={{ fontSize: 10, color: T.mt, padding: '6px 0' }}>Your plan</div>
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          {tier !== 'pro' && tier !== 'enterprise' && (
            <button onClick={() => setShowPayment('pro')} style={{ padding: '6px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: '#5865F2', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Upgrade</button>
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          {tier !== 'enterprise' && (
            <button onClick={() => { window.location.href = 'mailto:enterprise@discreetai.net?subject=Enterprise%20Plan%20Inquiry'; }} style={{ padding: '6px 16px', borderRadius: 'var(--radius-md)', border: `1px solid #faa61a44`, background: 'rgba(250,166,26,0.1)', color: '#faa61a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Contact</button>
          )}
        </div>
      </div>

      {error && <div style={{ padding: '8px 12px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)', borderRadius: 'var(--radius-md)', color: T.err, fontSize: 11, marginTop: 8 }}>{error}</div>}

      {/* Payment method modal */}
      {showPayment && (
        <div style={{ marginTop: 12, padding: '16px', background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 10, textAlign: 'center' }}>Choose Payment Method</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={() => startCheckout(showPayment, 'crypto')} disabled={loading} style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: `1px solid ${T.bd}`, background: T.sf2, cursor: loading ? 'default' : 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>₿</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.tx }}>Pay with Crypto</div>
              <div style={{ fontSize: 10, color: T.mt }}>Bitcoin, Lightning, Monero</div>
            </button>
            <button onClick={() => startCheckout(showPayment, 'stripe')} disabled={loading} style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: `1px solid ${T.bd}`, background: T.sf2, cursor: loading ? 'default' : 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>💳</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.tx }}>Pay with Card</div>
              <div style={{ fontSize: 10, color: T.mt }}>Visa, Mastercard, Amex</div>
            </button>
          </div>
          {loading && <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: T.mt }}>Redirecting to checkout...</div>}
          <button onClick={() => setShowPayment(null)} style={{ width: '100%', marginTop: 8, padding: '6px 0', background: 'transparent', border: 'none', color: T.mt, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}

      <button onClick={onClose} style={{ width: '100%', padding: '10px 0', marginTop: 12, background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.mt, fontSize: 12, cursor: 'pointer' }}>
        {tier === 'pro' || tier === 'enterprise' ? 'Close' : 'Maybe Later'}
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
          borderRadius: 'var(--radius-md)', textTransform: 'uppercase',
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
