/**
 * ConfirmDialog — Styled confirmation modal.
 * Replaces native confirm() for all destructive actions.
 * When `confirmPhrase` is set, the user must type the exact phrase to enable the button.
 */
import React, { useState, useEffect } from 'react';
import { T, btn } from '../theme';

export interface ConfirmDialogState {
  title: string;
  message: string;
  danger?: boolean;
  /** If set, user must type this exact string to enable the confirm button */
  confirmPhrase?: string;
  /** Custom label for the confirm button */
  confirmLabel?: string;
  resolve?: (confirmed: boolean) => void;
}

interface ConfirmDialogProps {
  dialog: ConfirmDialogState | null;
  setDialog: (d: ConfirmDialogState | null) => void;
}

export function ConfirmDialog({ dialog, setDialog }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  // Reset typed text when dialog changes
  useEffect(() => { setTyped(''); }, [dialog]);

  if (!dialog) return null;

  const close = (result: boolean) => {
    dialog.resolve?.(result);
    setDialog(null);
  };

  const needsPhrase = !!dialog.confirmPhrase;
  const phraseMatches = !needsPhrase || typed === dialog.confirmPhrase;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
    }} onClick={() => close(false)}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 440, maxWidth: '92vw', padding: 24,
        background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}`,
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        animation: 'fadeIn 0.15s ease',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: dialog.danger ? T.err : T.tx, marginBottom: 12 }}>
          {dialog.title}
        </div>

        {/* Warning banner for dangerous + phrase-confirmed actions */}
        {dialog.danger && needsPhrase && (
          <div style={{
            background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.25)',
            borderRadius: 12, padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {dialog.message}
            </div>
          </div>
        )}

        {/* Plain message for non-phrase dialogs */}
        {!needsPhrase && (
          <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.6, marginBottom: 20, whiteSpace: 'pre-wrap' }}>
            {dialog.message}
          </div>
        )}

        {/* Type-to-confirm input */}
        {needsPhrase && (
          <>
            <div style={{ fontSize: 13, color: T.tx, marginBottom: 8 }}>
              To confirm, type{' '}
              <strong style={{ color: T.err, fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                {dialog.confirmPhrase}
              </strong>{' '}
              below:
            </div>
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={dialog.confirmPhrase}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter' && phraseMatches) close(true); }}
              style={{
                width: '100%', padding: '10px 12px',
                background: T.bg,
                border: `1px solid ${phraseMatches ? 'rgba(255,71,87,0.6)' : T.bd}`,
                borderRadius: 6, color: T.tx, fontSize: 14,
                fontFamily: 'monospace', letterSpacing: '1px',
                marginBottom: 16, boxSizing: 'border-box',
              }}
            />
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => close(false)} style={{
            ...btn(false), width: 'auto', padding: '8px 20px',
            background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`,
          }}>Cancel</button>
          <button
            onClick={() => close(true)}
            disabled={!phraseMatches}
            style={{
              ...btn(true), width: 'auto', padding: '8px 20px',
              background: !phraseMatches
                ? 'rgba(255,71,87,0.08)'
                : dialog.danger
                  ? 'linear-gradient(135deg,#ff4757,#c0392b)'
                  : `linear-gradient(135deg,${T.ac},${T.ac2})`,
              color: !phraseMatches ? 'rgba(255,71,87,0.3)' : '#fff',
              cursor: phraseMatches ? 'pointer' : 'not-allowed',
              opacity: phraseMatches ? 1 : 0.6,
            }}
          >
            {dialog.confirmLabel || (dialog.danger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
