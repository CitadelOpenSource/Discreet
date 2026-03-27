/**
 * DebugOverlay — Developer debug panel toggled with Ctrl+Shift+D.
 *
 * Shows:
 *   - "DEBUG" badge in top-left corner
 *   - Collapsible API call log in bottom-right
 *   - Adds .debug-mode class to <html> for CSS component outlines
 *
 * State persisted in localStorage key "discreet-debug-mode".
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { debugApi, DebugApiEvent } from '../api/CitadelAPI';

// ── Hook: useDebugMode ──────────────────────────────────────────────────────

export function useDebugMode(): [boolean, () => void] {
  const [on, setOn] = useState(() => localStorage.getItem('discreet-debug-mode') === '1');

  const toggle = useCallback(() => {
    setOn(prev => {
      const next = !prev;
      localStorage.setItem('discreet-debug-mode', next ? '1' : '0');
      document.documentElement.classList.toggle('debug-mode', next);
      return next;
    });
  }, []);

  // Sync class on mount
  useEffect(() => {
    document.documentElement.classList.toggle('debug-mode', on);
  }, [on]);

  // Global keyboard shortcut: Ctrl+Shift+D
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  return [on, toggle];
}

// ── Debug CSS (injected once) ───────────────────────────────────────────────

export function DebugStyles() {
  return (
    <style>{`
      .debug-mode [data-component]     { outline: 1px dashed rgba(0,212,170,0.25); position: relative; }
      .debug-mode [data-testid]        { outline: 1px dashed rgba(250,166,26,0.3); }
      .debug-mode [data-component]:hover::after {
        content: attr(data-component);
        position: absolute; top: 0; left: 0; z-index: 99999;
        padding: 1px 5px; font-size: 9px; font-family: monospace;
        background: rgba(0,0,0,0.85); color: #00d4aa;
        border-radius: 0 0 4px 0; pointer-events: none; white-space: nowrap;
      }
      .debug-mode [data-testid]:hover::after {
        content: "testid=" attr(data-testid);
        position: absolute; top: 0; right: 0; z-index: 99999;
        padding: 1px 5px; font-size: 9px; font-family: monospace;
        background: rgba(0,0,0,0.85); color: #faa61a;
        border-radius: 0 0 0 4px; pointer-events: none; white-space: nowrap;
      }
    `}</style>
  );
}

// ── Overlay Component ───────────────────────────────────────────────────────

const MAX_LOG = 100;

export function DebugOverlay() {
  const [logs, setLogs] = useState<DebugApiEvent[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return debugApi.subscribe(event => {
      setLogs(prev => [event, ...prev].slice(0, MAX_LOG));
    });
  }, []);

  // Auto-scroll to top when new entries arrive
  useEffect(() => {
    if (!collapsed && logRef.current) logRef.current.scrollTop = 0;
  }, [logs.length, collapsed]);

  const statusColor = (s: number) =>
    s < 300 ? '#3ba55d' : s < 400 ? '#faa61a' : '#ff4757';

  return (
    <>
      {/* DEBUG badge — top-left */}
      <div style={{
        position: 'fixed', top: 8, left: 8, zIndex: 99998,
        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800,
        fontFamily: 'monospace', letterSpacing: '1px',
        background: '#ff4757', color: '#fff', pointerEvents: 'none',
      }}>
        DEBUG
      </div>

      {/* API log panel — bottom-right */}
      <div style={{
        position: 'fixed', bottom: 8, right: 8, zIndex: 99998,
        width: collapsed ? 'auto' : 380, maxHeight: collapsed ? 'auto' : 320,
        background: '#0b0d15', border: '1px solid #181c2a', borderRadius: 8,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)', fontFamily: 'var(--font-mono)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div
          onClick={() => setCollapsed(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', cursor: 'pointer', userSelect: 'none',
            borderBottom: collapsed ? 'none' : '1px solid #181c2a',
            background: '#0f1119',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: '#00d4aa' }}>
            API Log ({logs.length})
          </span>
          <span style={{ fontSize: 10, color: '#5a6080' }}>
            {collapsed ? '▲' : '▼'}
          </span>
        </div>

        {/* Log entries */}
        {!collapsed && (
          <div ref={logRef} style={{ flex: 1, overflowY: 'auto', maxHeight: 280 }}>
            {logs.length === 0 ? (
              <div style={{ padding: '16px 10px', textAlign: 'center', fontSize: 10, color: '#5a6080' }}>
                No API calls yet
              </div>
            ) : logs.map((e, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px', fontSize: 10, color: '#dde0ea',
                borderBottom: '1px solid #181c2a11',
              }}>
                <span style={{
                  fontWeight: 700, width: 42, flexShrink: 0,
                  color: e.method === 'GET' ? '#5a6080' : '#faa61a',
                }}>
                  {e.method}
                </span>
                <span style={{
                  fontWeight: 600, color: statusColor(e.status),
                  width: 28, flexShrink: 0, textAlign: 'center',
                }}>
                  {e.status}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9ca3af' }}>
                  {e.url}
                </span>
                <span style={{ flexShrink: 0, color: '#5a6080' }}>
                  {e.latency}ms
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
