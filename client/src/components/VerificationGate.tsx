/**
 * VerificationGate — Inline email verification prompt.
 *
 * Wraps any action that requires a verified account. If the user is
 * unverified, renders a 6-digit code input instead of the wrapped children.
 * When verified, renders children normally. Does NOT use a modal — the
 * verification prompt appears inline exactly where the action would be.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { T, ta } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';

interface Props {
  /** Current user's account tier. */
  tier: string;
  /** Masked email like "j***@example.com". */
  maskedEmail?: string;
  /** Called when verification succeeds. */
  onVerified?: () => void;
  /** The action content to render when verified. */
  children: React.ReactNode;
}

export function VerificationGate({ tier, maskedEmail, onVerified, children }: Props) {
  const isVerified = tier !== 'unverified' && tier !== 'guest';

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown timer for resend.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // If verified (either on mount or after success), render children.
  if (isVerified || success) return <>{children}</>;

  const handleDigit = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...code];
    next[index] = value;
    setCode(next);
    setError('');

    // Auto-advance to next input.
    if (value && index < 5) {
      refs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered.
    if (value && index === 5 && next.every(d => d)) {
      submitCode(next.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      // Handle paste.
      e.preventDefault();
      navigator.clipboard?.readText().then(text => {
        const digits = text.replace(/\D/g, '').slice(0, 6);
        if (digits.length === 6) {
          const next = digits.split('');
          setCode(next);
          refs.current[5]?.focus();
          submitCode(digits);
        }
      });
    }
  };

  const submitCode = async (codeStr: string) => {
    setVerifying(true);
    setError('');
    try {
      await api.fetch('/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ code: codeStr }),
      });
      setSuccess(true);
      onVerified?.();
    } catch (e: any) {
      setError(e?.message || 'Invalid or expired code');
      setCode(['', '', '', '', '', '']);
      refs.current[0]?.focus();
    }
    setVerifying(false);
  };

  const resend = async () => {
    if (resendCooldown > 0) return;
    try {
      await api.fetch('/auth/resend-code', { method: 'POST' });
      setResendCooldown(60);
    } catch (e: any) {
      setError(e?.message || 'Failed to resend code');
    }
  };

  return (
    <div style={{
      padding: '10px 14px', background: ta(T.ac, '06'), borderRadius: 8,
      border: `1px solid ${ta(T.ac, '20')}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <I.Lock s={14} />
        <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Verify your email to unlock this feature</span>
      </div>

      {/* 6-digit code input */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {code.map((digit, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={e => handleDigit(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            disabled={verifying}
            style={{
              width: 36, height: 42, textAlign: 'center', fontSize: 18, fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
              background: T.bg, border: `1px solid ${digit ? T.ac : T.bd}`,
              borderRadius: 8, color: T.tx, outline: 'none',
              transition: 'border-color 0.15s',
            }}
            aria-label={`Digit ${i + 1}`}
          />
        ))}
      </div>

      {error && <div style={{ fontSize: 11, color: T.err, marginBottom: 6 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: T.mt }}>
          {maskedEmail ? `Check your email at ${maskedEmail}` : 'Check your email for the code'}
        </span>
        <button
          onClick={resend}
          disabled={resendCooldown > 0}
          style={{
            background: 'none', border: 'none', fontSize: 10, fontWeight: 600,
            color: resendCooldown > 0 ? T.mt : T.ac, cursor: resendCooldown > 0 ? 'default' : 'pointer',
            padding: 0,
          }}
        >
          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
        </button>
      </div>
    </div>
  );
}

/** Mask an email: "john@example.com" → "j***@example.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || !local) return email;
  return `${local[0]}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}
