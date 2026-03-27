/**
 * CtxMenu — Context menu with submenu support.
 * Renders as a portal at the click position.
 * Supports separators, danger items, hints, and hover-to-expand submenus.
 */
import React, { useRef, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';

export interface CtxMenuItem {
  label?: string;
  icon?: React.ReactNode;
  fn?: () => void;
  danger?: boolean;
  off?: boolean;       // Disabled
  hint?: string;       // Right-side text hint
  sep?: boolean;       // Separator line
  sub?: CtxSubItem[];  // Submenu items
}

export interface CtxSubItem {
  label: string;
  icon?: React.ReactNode;
  fn?: () => void;
}

interface CtxMenuProps {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
}

export function CtxMenu({ x, y, items, onClose }: CtxMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [subOpen, setSubOpen] = useState<number | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    document.addEventListener('touchstart', h as any);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
      document.removeEventListener('touchstart', h as any);
    };
  }, [onClose]);

  const mx = Math.min(x, window.innerWidth - 220);
  const my = Math.min(y, window.innerHeight - (items.length * 36 + 20));

  return ReactDOM.createPortal(
    <div ref={ref} style={{
      position: 'fixed', left: mx, top: my, zIndex: 10001,
      minWidth: 200, background: T.sf, borderRadius: 8,
      border: '1px solid ' + T.bd, padding: '5px 0',
      boxShadow: 'var(--shadow-lg)',
      fontFamily: 'var(--font-primary)',
    }}>
      {items.map((it, i) => {
        if (it.sep) return <div key={i} style={{ height: 1, background: T.bd, margin: '4px 8px' }} />;
        const hasSub = it.sub && it.sub.length > 0;
        return (
          <div key={i} style={{ position: 'relative' }}>
            <div
              onClick={() => {
                if (hasSub) { setSubOpen(subOpen === i ? null : i); return; }
                if (!it.off) { it.fn?.(); onClose(); }
              }}
              onMouseEnter={e => {
                if (hasSub) setSubOpen(i);
                if (!it.off) (e.currentTarget as HTMLElement).style.background = it.danger ? 'rgba(255,71,87,0.08)' : 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={e => {
                if (!hasSub) (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
              style={{
                padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 9,
                fontSize: 13, color: it.danger ? '#ff4757' : it.off ? T.mt : T.tx,
                cursor: it.off ? 'default' : 'pointer', opacity: it.off ? 0.4 : 1,
                borderRadius: 4, margin: '0 4px', transition: 'background .1s',
                background: subOpen === i && hasSub ? 'rgba(255,255,255,0.06)' : 'transparent',
              }}
            >
              {it.icon && <span style={{ display: 'flex', alignItems: 'center', width: 20, color: it.danger ? '#ff4757' : T.mt }}>{it.icon}</span>}
              <span style={{ flex: 1 }}>{it.label}</span>
              {hasSub && <span style={{ fontSize: 10, color: T.mt }}>▸</span>}
              {it.hint && <span style={{ fontSize: 10, color: T.mt, fontFamily: 'var(--font-mono)' }}>{it.hint}</span>}
            </div>
            {subOpen === i && hasSub && (
              <div
                style={{
                  position: 'absolute', left: '100%', top: 0, minWidth: 180,
                  background: T.sf, borderRadius: 8, border: '1px solid ' + T.bd,
                  padding: '5px 0', boxShadow: 'var(--shadow-lg)', zIndex: 10002,
                }}
                onMouseLeave={() => setSubOpen(null)}
              >
                {it.sub!.map((s, j) => (
                  <div key={j}
                    onClick={() => { s.fn?.(); onClose(); }}
                    style={{
                      padding: '7px 12px', fontSize: 12, color: T.tx, cursor: 'pointer',
                      borderRadius: 4, margin: '0 4px', display: 'flex', alignItems: 'center', gap: 8,
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    {s.icon && <span style={{ display: 'flex', alignItems: 'center', width: 16, color: T.mt }}>{s.icon}</span>}
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
