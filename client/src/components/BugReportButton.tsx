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

export function BugReportButton({ showToast, externalOpen, onExternalClose }: { showToast?: (msg: string) => void; externalOpen?: boolean; onExternalClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const isOpen = open || !!externalOpen;
  const close = () => { setOpen(false); onExternalClose?.(); };
  const [description, setDescription] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  // ESC key to close
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const reset = () => {
    close();
    setDescription('');
    setErrorCode('');
    setSeverity('medium');
    setScreenshot(null);
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

      let screenshotData: string | undefined;
      if (screenshot) {
        screenshotData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(screenshot);
        });
      }

      const res = await fetch(`${API_BASE}/bug-reports`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          page: window.location.pathname,
          description: description.trim(),
          error_code: errorCode.trim() || undefined,
          browser_info: navigator.userAgent,
          severity,
          screenshot: screenshotData,
        }),
      });

      if (res.ok) {
        reset();
        showToast?.('Bug report submitted. Thank you!');
      } else {
        const data = await res.json().catch(() => ({}));
        const errMsg = typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Error ${res.status}`;
        setErr(errMsg);
      }
    } catch {
      setErr('Network error — please try again');
    }
    setSubmitting(false);
  };

  return (
    <>
      {/* No floating button — opened via sidebar "Report Bug" or externalOpen prop */}

      {/* Modal */}
      {isOpen && ReactDOM.createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000, padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) reset(); }}
        >
          <div style={{
            width: '100%', maxWidth: 420, background: T.sf, borderRadius: 'var(--border-radius)',
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

            {/* Report form */}
            {<>
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
                    border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
                    fontSize: 13, fontFamily: 'var(--font-primary)', resize: 'vertical',
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
                    border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
                    fontSize: 13, fontFamily: 'monospace', outline: 'none',
                    boxSizing: 'border-box', marginBottom: 6,
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                />

                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                  Severity
                </label>
                <select
                  value={severity}
                  onChange={e => setSeverity(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', background: T.bg,
                    border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx,
                    fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
                  }}
                  aria-label="Bug severity"
                >
                  <option value="low">Low — cosmetic issue</option>
                  <option value="medium">Medium — feature broken but workaround exists</option>
                  <option value="high">High — feature completely broken</option>
                  <option value="critical">Critical — data loss or security issue</option>
                </select>

                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                  Screenshot <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                </label>
                <div style={{ marginBottom: 12 }}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={e => {
                      const f = e.target.files?.[0] || null;
                      if (f && f.size > 5 * 1024 * 1024) { setErr('Screenshot must be under 5 MB'); setScreenshot(null); return; }
                      setScreenshot(f);
                    }}
                    style={{ fontSize: 12, color: T.mt }}
                    aria-label="Upload screenshot"
                  />
                  {screenshot && <div style={{ fontSize: 10, color: T.ac, marginTop: 4 }}>{screenshot.name} ({Math.round(screenshot.size / 1024)} KB)</div>}
                </div>

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
                    background: T.ac, color: '#000', border: 'none', borderRadius: 'var(--radius-md)',
                    padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
                    opacity: submitting ? 0.7 : 1,
                  }}>
                    {submitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                  <button onClick={reset} style={{
                    background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)',
                    padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              </>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
