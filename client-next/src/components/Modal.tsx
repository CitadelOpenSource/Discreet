/**
 * Modal — Generic modal overlay with title and close button.
 * Used for settings, bot config, server settings, avatar creator, etc.
 */
import React, { ReactNode } from 'react';
import { T } from '../theme';
import { X } from '../icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  extraWide?: boolean;
}

export function Modal({ title, onClose, children, wide, extraWide }: ModalProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: extraWide ? 700 : wide ? 560 : 420, maxWidth: '95vw', padding: 28,
          background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}`,
          maxHeight: extraWide ? '92vh' : '85vh', overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
          animation: 'fadeIn 0.15s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: T.tx }}>{title}</h3>
          <div onClick={onClose} style={{ cursor: 'pointer', color: T.mt, padding: 4 }}><X /></div>
        </div>
        {children}
      </div>
    </div>
  );
}
