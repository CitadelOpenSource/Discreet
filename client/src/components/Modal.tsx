/**
 * Modal — Generic modal overlay with title and close button.
 * Used for settings, bot config, server settings, avatar creator, etc.
 *
 * Accessibility:
 *   - role="dialog" with aria-labelledby on the title
 *   - Focus trap: Tab/Shift+Tab cycles within the modal
 *   - Escape closes the modal
 *   - Auto-focuses first focusable element on mount
 */
import React, { ReactNode, useEffect, useRef, useCallback } from 'react';
import { T } from '../theme';
import { X } from '../icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  extraWide?: boolean;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, wide, extraWide }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 8)}`).current;

  // Focus trap: Tab cycles within the modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab') return;
    const el = dialogRef.current;
    if (!el) return;
    const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, [onClose]);

  // Auto-focus first focusable element on mount
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(FOCUSABLE);
    if (first) first.focus();
  }, []);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
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
          <h3 id={titleId} style={{ fontSize: 18, fontWeight: 700, color: T.tx }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ cursor: 'pointer', color: T.mt, padding: 4, background: 'none', border: 'none', lineHeight: 1 }}><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
