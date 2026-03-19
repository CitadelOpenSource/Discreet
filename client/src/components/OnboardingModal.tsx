/**
 * OnboardingModal — First-run setup wizard for new users.
 *
 * 6 steps: Welcome, Theme, Layout, Profile, Security, Done.
 * Skippable. Persists completion to localStorage so it only shows once.
 * While user browses early steps, MLS crypto keys initialize in background.
 */
import React, { useState, useEffect, useRef } from 'react';
import { T, ta } from '../theme';

const TOTAL_STEPS = 6;

export interface OnboardingModalProps {
  onComplete: (data: {
    selectedTheme?: string;
    selectedLayout?: string;
    displayName?: string;
    avatarFile?: File | null;
  }) => void;
  onThemeChange?: (themeId: string) => void;
  onLayoutChange?: (layoutId: string) => void;
  username?: string;
}

export function OnboardingModal({ onComplete, onThemeChange, onLayoutChange, username }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState('midnight');
  const [selectedLayout, setSelectedLayout] = useState('basic');
  const [displayName, setDisplayName] = useState(username || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [twoFaComplete, setTwoFaComplete] = useState(false);
  const cryptoInitiated = useRef(false);

  // Check if already completed
  useEffect(() => {
    if (localStorage.getItem('onboarding_complete')) {
      onComplete({});
    }
  }, []);

  // Initialize MLS crypto in background during early steps
  useEffect(() => {
    if (currentStep <= 2 && !cryptoInitiated.current) {
      cryptoInitiated.current = true;
      // Trigger crypto initialization if available
      try {
        const initCrypto = (window as any).__initCrypto;
        if (typeof initCrypto === 'function') {
          initCrypto().catch(() => {});
        }
      } catch { /* crypto init is best-effort */ }
    }
  }, [currentStep]);

  // Handle avatar file selection
  const handleAvatarChange = (file: File | null) => {
    setAvatarFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setAvatarPreview(null);
    }
  };

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(s => s + 1);
    } else {
      // Final step — complete
      localStorage.setItem('onboarding_complete', 'true');
      onComplete({ selectedTheme, selectedLayout, displayName, avatarFile });
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(s => s - 1);
  };

  const handleSkip = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(s => s + 1);
    } else {
      localStorage.setItem('onboarding_complete', 'true');
      onComplete({});
    }
  };

  // Don't render if already completed (useEffect will call onComplete)
  if (localStorage.getItem('onboarding_complete')) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
      fontFamily: "'DM Sans',sans-serif",
    }}>
      <div style={{
        width: '100%', maxWidth: 560, background: T.sf, borderRadius: 16,
        border: `1px solid ${T.bd}`, padding: 32,
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        animation: 'fadeIn 0.25s ease',
      }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} style={{
              width: 10, height: 10, borderRadius: 5,
              background: i === currentStep ? T.ac : 'transparent',
              border: i === currentStep ? `2px solid ${T.ac}` : `2px solid ${T.bd}`,
              transition: 'background 0.2s, border-color 0.2s',
            }} />
          ))}
        </div>

        {/* Step content */}
        <div style={{ minHeight: 280 }}>
          {currentStep === 0 && <StepWelcome onNext={handleNext} />}
          {currentStep === 1 && <StepTheme selected={selectedTheme} onSelect={(id) => {
            setSelectedTheme(id);
            onThemeChange?.(id);
          }} />}
          {currentStep === 2 && <StepLayout selected={selectedLayout} onSelect={(id) => {
            setSelectedLayout(id);
            onLayoutChange?.(id);
          }} />}
          {currentStep === 3 && (
            <StepProfile
              displayName={displayName}
              onNameChange={setDisplayName}
              avatarPreview={avatarPreview}
              onAvatarChange={handleAvatarChange}
            />
          )}
          {currentStep === 4 && (
            <StepSecurity
              twoFaComplete={twoFaComplete}
              onTwoFaComplete={() => setTwoFaComplete(true)}
              onSkip={handleNext}
            />
          )}
          {currentStep === 5 && <StepDone onFinish={() => {
            localStorage.setItem('onboarding_complete', 'true');
            onComplete({ selectedTheme, selectedLayout, displayName, avatarFile });
          }} />}
        </div>

        {/* Navigation buttons (hidden on Welcome and Done — they have their own CTAs) */}
        {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
            <div>
              <button onClick={handleBack} style={{
                padding: '8px 18px', borderRadius: 8, border: `1px solid ${T.bd}`,
                background: 'transparent', color: T.mt, fontSize: 13, cursor: 'pointer',
              }}>Back</button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSkip} style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: 'transparent', color: T.mt, fontSize: 13, cursor: 'pointer',
              }}>Skip</button>
              <button onClick={handleNext} style={{
                padding: '8px 22px', borderRadius: 8, border: 'none',
                background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
                color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 0: Welcome ────────────────────────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 280 }}>
      {/* Discreet text logo */}
      <div style={{
        fontSize: 36, fontWeight: 900, letterSpacing: '-0.5px',
        background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        marginBottom: 20,
      }}>Discreet</div>
      <h2 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800, color: T.tx }}>Welcome to Discreet</h2>
      <p style={{ margin: '0 0 32px', fontSize: 14, color: T.mt, lineHeight: 1.7, maxWidth: 400 }}>
        Your messages are end-to-end encrypted. No one can read them except
        you and the people you talk to. Not even us.
      </p>
      <button onClick={onNext} style={{
        padding: '12px 36px', borderRadius: 10, border: 'none',
        background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
        color: '#000', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        letterSpacing: '0.3px',
      }}>Let's Get Started</button>
    </div>
  );
}

// ─── Step 1: Theme ──────────────────────────────────────────────────────

function StepTheme({ selected, onSelect }: { selected: string; onSelect: (t: string) => void }) {
  const themes = [
    { id: 'midnight', name: 'Midnight', bg: '#0a0e17', sf: '#141922', ac: '#00D4AA', tx: '#e2e8f0', mt: '#64748b' },
    { id: 'dawn', name: 'Dawn', bg: '#ffffff', sf: '#f5f5f5', ac: '#1a73e8', tx: '#1a1a2e', mt: '#6b7280' },
    { id: 'terminal', name: 'Terminal', bg: '#000000', sf: '#0a0a0a', ac: '#00FF00', tx: '#00FF00', mt: '#005500' },
    { id: 'obsidian', name: 'Obsidian', bg: '#000000', sf: '#080808', ac: '#00D4AA', tx: '#e0e0e0', mt: '#555555' },
  ];

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: T.tx, textAlign: 'center' }}>Choose Your Look</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: T.mt, textAlign: 'center' }}>Pick a theme that feels right.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {themes.map(t => (
          <div key={t.id} onClick={() => onSelect(t.id)} style={{
            cursor: 'pointer', borderRadius: 10, overflow: 'hidden',
            border: selected === t.id ? `2px solid ${t.ac}` : `2px solid transparent`,
            background: t.bg, height: 140, display: 'flex', flexDirection: 'row',
            transition: 'border-color 0.15s',
          }}>
            {/* Accent left strip */}
            <div style={{ width: 5, background: t.ac, flexShrink: 0 }} />

            {/* Card body */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 10 }}>
              {/* Mini mockup: 3 fake message bubbles */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                {/* Incoming message 1 */}
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    height: 14, width: '55%', borderRadius: 7,
                    background: t.sf, border: `1px solid ${t.mt}33`,
                  }} />
                </div>
                {/* Outgoing message (self — accent) */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{
                    height: 14, width: '45%', borderRadius: 7,
                    background: `${t.ac}44`,
                  }} />
                </div>
                {/* Incoming message 2 */}
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    height: 14, width: '35%', borderRadius: 7,
                    background: t.sf, border: `1px solid ${t.mt}33`,
                  }} />
                </div>
              </div>

              {/* Theme name */}
              <div style={{
                fontSize: 14, fontWeight: 700, textAlign: 'center', marginTop: 6,
                color: selected === t.id ? t.ac : t.tx,
              }}>{t.name}</div>
            </div>
          </div>
        ))}
      </div>
      <p style={{ margin: '16px 0 0', fontSize: 13, color: T.mt, textAlign: 'center', fontStyle: 'italic' }}>
        Nothing here is permanent. You can change your theme anytime in Settings.
      </p>
    </div>
  );
}

// ─── Step 2: Layout ─────────────────────────────────────────────────────

function LayoutIconChat({ color }: { color: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function LayoutIconSliders({ color }: { color: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function LayoutIconTerminal({ color }: { color: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function StepLayout({ selected, onSelect }: { selected: string; onSelect: (l: string) => void }) {
  const layouts = [
    { id: 'basic', name: 'Basic', desc: 'Clean and simple. Perfect for everyday messaging.', Icon: LayoutIconChat },
    { id: 'medium', name: 'Medium', desc: 'More details at a glance. Status indicators and quick actions.', Icon: LayoutIconSliders },
    { id: 'advanced', name: 'Advanced', desc: 'Full control. Every option visible. For developers and power users.', Icon: LayoutIconTerminal },
  ];

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: T.tx, textAlign: 'center' }}>Choose Your Comfort Level</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: T.mt, textAlign: 'center' }}>How much do you want to see?</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {layouts.map(l => {
          const active = selected === l.id;
          return (
            <div key={l.id} onClick={() => onSelect(l.id)} style={{
              padding: '16px 18px', borderRadius: 10, cursor: 'pointer',
              border: active ? `2px solid ${T.ac}` : `2px solid ${T.bd}`,
              background: active ? ta(T.ac, '08') : 'transparent',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'border-color 0.15s, background 0.15s',
            }}>
              <l.Icon color={active ? T.ac : T.mt} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: active ? T.ac : T.tx }}>{l.name}</div>
                <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>{l.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ margin: '16px 0 0', fontSize: 13, color: T.mt, textAlign: 'center' }}>
        All three layouts have the exact same features and security. This only changes what is visible on screen.
      </p>
    </div>
  );
}

// ─── Step 3: Profile ────────────────────────────────────────────────────

function CameraIcon({ color }: { color: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function StepProfile({ displayName, onNameChange, avatarPreview, onAvatarChange }: {
  displayName: string;
  onNameChange: (name: string) => void;
  avatarPreview: string | null;
  onAvatarChange: (file: File | null) => void;
}) {
  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: T.tx, textAlign: 'center' }}>Set Up Your Profile</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: T.mt, textAlign: 'center' }}>This is how others will see you.</p>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        {/* Display name */}
        <div style={{ width: '100%', maxWidth: 320 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Your display name</label>
          <input
            value={displayName}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Enter a display name"
            maxLength={40}
            autoComplete="off"
            style={{
              width: '100%', padding: '10px 14px', background: T.bg,
              border: `1px solid ${T.bd}`, borderRadius: 10, color: T.tx,
              fontSize: 14, outline: 'none', boxSizing: 'border-box',
              fontFamily: "'DM Sans',sans-serif",
            }}
          />
          <div style={{ fontSize: 10, color: T.mt, marginTop: 4, textAlign: 'right' }}>{displayName.length}/40</div>
        </div>

        {/* Avatar upload */}
        <label style={{ cursor: 'pointer' }}>
          {avatarPreview ? (
            <img src={avatarPreview} alt="Avatar preview" style={{
              width: 80, height: 80, borderRadius: '50%', objectFit: 'cover',
              border: `2px solid ${T.ac}`, display: 'block',
            }} />
          ) : (
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              border: `2px dashed ${T.bd}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
            }}>
              <CameraIcon color={T.mt} />
            </div>
          )}
          <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={e => {
            const file = e.target.files?.[0] || null;
            if (file && file.size > 2 * 1024 * 1024) return;
            onAvatarChange(file);
          }} />
          <div style={{ fontSize: 11, color: T.mt, textAlign: 'center', marginTop: 6 }}>
            {avatarPreview ? 'Change photo' : 'Upload a photo'}
          </div>
        </label>
      </div>
    </div>
  );
}

// ─── Step 4: Security ──────────────────────────────────────────────────

function CheckCircleIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function ShieldIcon({ color }: { color: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function StepSecurity({ twoFaComplete, onTwoFaComplete, onSkip }: {
  twoFaComplete: boolean;
  onTwoFaComplete: () => void;
  onSkip: () => void;
}) {
  const [showSetup, setShowSetup] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [qrUri, setQrUri] = useState('');
  const [secret, setSecret] = useState('');

  const handleSetup = async () => {
    setShowSetup(true);
    setError('');
    try {
      const res = await fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQrUri(data.otpauth_uri || data.uri || '');
        setSecret(data.secret || '');
      } else {
        setError('Could not start 2FA setup. You can set this up later in Settings.');
      }
    } catch {
      setError('Could not start 2FA setup. You can set this up later in Settings.');
    }
  };

  const handleVerify = async () => {
    if (totpCode.length !== 6) return;
    setVerifying(true);
    setError('');
    try {
      const res = await fetch('/api/auth/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ code: totpCode }),
      });
      if (res.ok) {
        onTwoFaComplete();
      } else {
        setError('Invalid code. Please try again.');
      }
    } catch {
      setError('Verification failed. You can set this up later in Settings.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: T.tx, textAlign: 'center' }}>Protect Your Account</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: T.mt, textAlign: 'center', lineHeight: 1.6 }}>
        Two-factor authentication ensures that even if someone gets your password, they still cannot log in.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {twoFaComplete ? (
          /* ── Success state ── */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 0' }}>
            <CheckCircleIcon color="#22c55e" />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e' }}>Your account is protected</div>
            <div style={{ fontSize: 12, color: T.mt }}>Two-factor authentication is enabled.</div>
          </div>
        ) : !showSetup ? (
          /* ── Initial CTA ── */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '12px 0' }}>
            <ShieldIcon color={T.ac} />
            <button onClick={handleSetup} style={{
              padding: '10px 28px', borderRadius: 10, border: 'none',
              background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
              color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>Setup 2FA</button>
          </div>
        ) : (
          /* ── TOTP setup flow ── */
          <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {qrUri ? (
              <>
                <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', lineHeight: 1.5 }}>
                  Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                </div>
                <div style={{
                  padding: 12, background: '#fff', borderRadius: 10,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUri)}`}
                    alt="TOTP QR Code"
                    width={160} height={160}
                    style={{ display: 'block' }}
                  />
                </div>
                {secret && (
                  <div style={{ fontSize: 10, color: T.mt, textAlign: 'center', wordBreak: 'break-all' }}>
                    Manual entry: <span style={{ fontFamily: 'monospace', color: T.tx, fontSize: 11 }}>{secret}</span>
                  </div>
                )}
                <div style={{ width: '100%' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Enter 6-digit code</label>
                  <input
                    value={totpCode}
                    onChange={e => { if (/^\d{0,6}$/.test(e.target.value)) setTotpCode(e.target.value); }}
                    placeholder="000000"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    style={{
                      width: '100%', padding: '10px 14px', background: T.bg,
                      border: `1px solid ${T.bd}`, borderRadius: 10, color: T.tx,
                      fontSize: 18, fontFamily: 'monospace', textAlign: 'center',
                      outline: 'none', boxSizing: 'border-box', letterSpacing: '6px',
                    }}
                  />
                </div>
                <button onClick={handleVerify} disabled={totpCode.length !== 6 || verifying} style={{
                  padding: '10px 28px', borderRadius: 10, border: 'none',
                  background: totpCode.length === 6 ? `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})` : T.bd,
                  color: totpCode.length === 6 ? '#000' : T.mt,
                  fontSize: 13, fontWeight: 700, cursor: totpCode.length === 6 ? 'pointer' : 'default',
                  opacity: verifying ? 0.6 : 1,
                }}>{verifying ? 'Verifying...' : 'Verify'}</button>
              </>
            ) : !error ? (
              <div style={{ fontSize: 12, color: T.mt }}>Setting up...</div>
            ) : null}
            {error && <div style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{error}</div>}
          </div>
        )}

        {/* Skip for now */}
        {!twoFaComplete && (
          <button onClick={onSkip} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.mt, fontSize: 13, textDecoration: 'underline',
            padding: '4px 8px', marginTop: 4,
          }}>Skip for Now</button>
        )}
      </div>
    </div>
  );
}

// ─── Step 5: Done ──────────────────────────────────────────────────────

function StepDone({ onFinish }: { onFinish: () => void }) {
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 280 }}>
      <div style={{
        fontSize: 36, fontWeight: 900, letterSpacing: '-0.5px',
        background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        marginBottom: 20,
      }}>Discreet</div>
      <h2 style={{ margin: '0 0 12px', fontSize: 24, fontWeight: 800, color: T.tx }}>You're all set</h2>
      <p style={{ margin: '0 0 32px', fontSize: 14, color: T.mt, lineHeight: 1.7, maxWidth: 380 }}>
        Your messages are encrypted. Your identity is yours. Welcome to Discreet.
      </p>
      <button onClick={onFinish} style={{
        padding: '12px 36px', borderRadius: 10, border: 'none',
        background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
        color: '#000', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        letterSpacing: '0.3px',
      }}>Start Chatting</button>
    </div>
  );
}
