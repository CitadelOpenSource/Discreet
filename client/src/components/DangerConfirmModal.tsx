/**
 * DangerConfirmModal — GitHub-style dangerous action confirmation.
 *
 * Renders a red warning banner, explanation text, and a text input
 * that must match `confirmPhrase` exactly before the action button enables.
 */
import React, { useState } from 'react';
import { T } from '../theme';

export interface DangerConfirmModalProps {
  /** Modal title (e.g. "Delete Server") */
  title: string;
  /** Warning text shown in the red banner */
  warningText: string;
  /** Exact phrase user must type to enable the action (e.g. "DELETE MY ACCOUNT") */
  confirmPhrase: string;
  /** Label for the confirm button (defaults to "I understand, delete this") */
  confirmLabel?: string;
  /** Loading state text for the confirm button */
  loadingLabel?: string;
  /** Called when user confirms (typed phrase matches) */
  onConfirm: () => void | Promise<void>;
  /** Called when user cancels or clicks backdrop */
  onCancel: () => void;
  /** If true, show a loading spinner on the button */
  loading?: boolean;
  /** Optional extra content between warning and input (e.g. password field) */
  children?: React.ReactNode;
}

export function DangerConfirmModal({
  title,
  warningText,
  confirmPhrase,
  confirmLabel,
  loadingLabel,
  onConfirm,
  onCancel,
  loading = false,
  children,
}: DangerConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const matches = typed === confirmPhrase;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background: T.sf, borderRadius: 12, padding: 24,
          width: 440, maxWidth: '92vw', border: `1px solid ${T.bd}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title */}
        <div style={{ fontSize: 16, fontWeight: 700, color: T.err, marginBottom: 16 }}>
          {title}
        </div>

        {/* Red warning banner */}
        <div style={{
          background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)',
          borderRadius: 8, padding: 12, marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.7 }}>
            {warningText}
          </div>
        </div>

        {/* Optional extra content */}
        {children}

        {/* Confirmation input */}
        <div style={{ fontSize: 13, color: T.tx, marginBottom: 8 }}>
          To confirm, type{' '}
          <strong style={{ color: T.err, fontFamily: 'monospace', letterSpacing: '0.5px' }}>
            {confirmPhrase}
          </strong>{' '}
          below:
        </div>
        <input
          type="text"
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder={confirmPhrase}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onKeyDown={e => { if (e.key === 'Enter' && matches && !loading) onConfirm(); }}
          style={{
            width: '100%', padding: '10px 12px',
            background: T.bg,
            border: `1px solid ${matches ? 'rgba(255,71,87,0.6)' : T.bd}`,
            borderRadius: 6, color: T.tx, fontSize: 14,
            fontFamily: 'monospace', letterSpacing: '1px',
            marginBottom: 16, boxSizing: 'border-box',
          }}
        />

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            className="pill-btn"
            style={{
              background: T.sf2, color: T.mt,
              border: `1px solid ${T.bd}`,
              padding: '8px 18px', fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches || loading}
            className="pill-btn"
            style={{
              background: matches ? 'rgba(255,71,87,0.25)' : 'rgba(255,71,87,0.08)',
              color: matches ? T.err : 'rgba(255,71,87,0.3)',
              border: '1px solid rgba(255,71,87,0.4)',
              padding: '8px 18px', fontSize: 12, fontWeight: 700,
              cursor: matches && !loading ? 'pointer' : 'not-allowed',
            }}
          >
            {loading
              ? (loadingLabel || 'Processing...')
              : (confirmLabel || 'I understand, proceed')}
          </button>
        </div>
      </div>
    </div>
  );
}
