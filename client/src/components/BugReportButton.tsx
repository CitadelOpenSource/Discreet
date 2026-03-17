/**
 * BugReportButton — Floating bug report button shown on all pages.
 * Submits to POST /api/v1/bug-reports (no auth required).
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';
import { BugIcon, X } from '../icons';
import { api } from '../api/CitadelAPI';

const API_BASE = import.meta.env.VITE_API_URL || (window.location.origin + '/api/v1');

export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const reset = () => {
    setOpen(false);
    setDescription('');
    setErrorCode('');
    setDone(false);
    setErr('');
  };

  const submit = async () => {
    if (!description.trim()) { setErr('Please describe the issue'); return; }
    setErr('');
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // Attach token if available (optional — endpoint doesn't require auth)
      if (api.token) headers['Authorization'] = `Bearer ${api.token}`;

      const res = await fetch(`${API_BASE}/bug-reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          page: window.location.pathname,
          description: description.trim(),
          error_code: errorCode.trim() || undefined,
          browser_info: navigator.userAgent,
        }),
      });

      if (res.ok) {
        setDone(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || data.message || `Error ${res.status}`);
      }
    } catch {
      setErr('Network error — please try again');
    }
    setSubmitting(false);
  };

  return (
    <>
      {/* Floating button */}
      <div
        onClick={() => { setOpen(true); setDone(false); setErr(''); }}
        title="Report a bug"
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          width: 44, height: 44, borderRadius: 22,
          background: T.sf2, border: `1px solid ${T.bd}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          transition: 'transform .15s, box-shadow .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.4)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'; }}
      >
        <BugIcon s={20} />
      </div>

      {/* Modal */}
      {open && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000, padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) reset(); }}
        >
          <div style={{
            width: '100%', maxWidth: 420, background: T.sf, borderRadius: 12,
            border: `1px solid ${T.bd}`, boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
            padding: 24, position: 'relative',
          }}>
            {/* Close button */}
            <div
              onClick={reset}
              style={{ position: 'absolute', top: 12, right: 12, cursor: 'pointer', color: T.mt, padding: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = T.tx)}
              onMouseLeave={e => (e.currentTarget.style.color = T.mt)}
            >
              <X s={18} />
            </div>

            {done ? (
              /* Thank you screen */
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🐛</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.ac, marginBottom: 8 }}>Thank you!</div>
                <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.6, marginBottom: 20 }}>
                  Your bug report has been submitted. We'll look into it.
                </div>
                <button onClick={reset} style={{
                  background: T.ac, color: '#000', border: 'none', borderRadius: 8,
                  padding: '10px 28px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>Close</button>
              </div>
            ) : (
              /* Report form */
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 4 }}>Report a Bug</div>
                <div style={{ fontSize: 12, color: T.mt, marginBottom: 16, lineHeight: 1.5 }}>
                  Help us improve Discreet by reporting issues you encounter.
                </div>

                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                  What happened? *
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe the issue in detail..."
                  rows={4}
                  maxLength={5000}
                  style={{
                    width: '100%', padding: '10px 12px', background: T.bg,
                    border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
                    fontSize: 13, fontFamily: "'DM Sans', sans-serif", resize: 'vertical',
                    outline: 'none', boxSizing: 'border-box', marginBottom: 12,
                  }}
                  autoFocus
                />

                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                  Error code <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                </label>
                <input
                  value={errorCode}
                  onChange={e => setErrorCode(e.target.value)}
                  placeholder="e.g. 500, NETWORK_ERROR"
                  maxLength={50}
                  style={{
                    width: '100%', padding: '8px 12px', background: T.bg,
                    border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
                    fontSize: 13, fontFamily: 'monospace', outline: 'none',
                    boxSizing: 'border-box', marginBottom: 6,
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                />

                <div style={{ fontSize: 10, color: T.mt, marginBottom: 16 }}>
                  Page: <span style={{ fontFamily: 'monospace' }}>{window.location.pathname}</span>
                </div>

                {err && (
                  <div style={{ padding: '8px 12px', background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 6, color: '#ff4757', fontSize: 12, marginBottom: 12 }}>
                    {err}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={submit} disabled={submitting} style={{
                    background: T.ac, color: '#000', border: 'none', borderRadius: 8,
                    padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
                    opacity: submitting ? 0.7 : 1,
                  }}>
                    {submitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                  <button onClick={reset} style={{
                    background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, borderRadius: 8,
                    padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
