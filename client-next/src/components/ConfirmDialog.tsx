/**
 * ConfirmDialog — Styled confirmation modal.
 * Replaces native confirm() for all destructive actions.
 */
import React from 'react';
import { T, btn } from '../theme';

export interface ConfirmDialogState {
  title: string;
  message: string;
  danger?: boolean;
  resolve?: (confirmed: boolean) => void;
}

interface ConfirmDialogProps {
  dialog: ConfirmDialogState | null;
  setDialog: (d: ConfirmDialogState | null) => void;
}

export function ConfirmDialog({ dialog, setDialog }: ConfirmDialogProps) {
  if (!dialog) return null;

  const close = (result: boolean) => {
    dialog.resolve?.(result);
    setDialog(null);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
    }} onClick={() => close(false)}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 420, maxWidth: '92vw', padding: 24,
        background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: dialog.danger ? T.err : T.tx, marginBottom: 12 }}>
          {dialog.title}
        </div>
        <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.6, marginBottom: 20, whiteSpace: 'pre-wrap' }}>
          {dialog.message}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => close(false)} style={{
            ...btn(false), width: 'auto', padding: '8px 20px',
            background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`,
          }}>Cancel</button>
          <button onClick={() => close(true)} style={{
            ...btn(true), width: 'auto', padding: '8px 20px',
            background: dialog.danger
              ? 'linear-gradient(135deg,#ff4757,#c0392b)'
              : `linear-gradient(135deg,${T.ac},${T.ac2})`,
            color: '#fff',
          }}>
            {dialog.danger ? 'Delete' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
