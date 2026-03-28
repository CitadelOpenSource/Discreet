/**
 * ErrorBoundary — Catches React render errors and shows a branded error page.
 *
 * Also exports ApiErrorPage for rendering server-side error responses
 * (401, 403, 404, 429, 500, 503) as full-page views.
 */
import React from 'react';

// ── Hardcoded theme values (ErrorBoundary can't use T — it may have crashed) ─
// Reads website preference so the error page matches what the user was seeing.
function getErrorTheme() {
  try {
    const pref = localStorage.getItem('d_landing_theme');
    if (pref === 'light') return 'light';
    const auth = localStorage.getItem('discreet-theme-preference');
    if (auth === 'dawn' || auth === 'daylight') return 'light';
  } catch { /* localStorage unavailable */ }
  return 'dark';
}

const DARK_COLORS  = { BG: '#07090f', SF: '#0b0d15', BD: '#181c2a', TX: '#dde0ea', MT: '#5a6080' };
const LIGHT_COLORS = { BG: '#F5F3F0', SF: '#EDEAE6', BD: 'rgba(0,0,0,0.12)', TX: '#1a1a2e', MT: '#6b7280' };
const _lt = getErrorTheme() === 'light';
const BG   = _lt ? LIGHT_COLORS.BG : DARK_COLORS.BG;
const SF   = _lt ? LIGHT_COLORS.SF : DARK_COLORS.SF;
const BD   = _lt ? LIGHT_COLORS.BD : DARK_COLORS.BD;
const TX   = _lt ? LIGHT_COLORS.TX : DARK_COLORS.TX;
const MT   = _lt ? LIGHT_COLORS.MT : DARK_COLORS.MT;
const AC   = '#7C3AED';
const ERR  = '#dc2626';
const WARN = '#f59e0b';

// ── Crash report helper ──────────────────────────────────────────────────────
// Strips absolute file paths from stack traces to avoid leaking local dev paths.
function sanitizeStack(stack: string): string {
  return stack.replace(/(?:[A-Z]:)?\/[^\s)]+\/(src\/)/gi, '$1')
              .replace(/(?:[A-Z]:\\)[^\s)]+\\(src\\)/gi, '$1');
}

function sendCrashReport(message: string, stack: string, component: string) {
  if (!import.meta.env.PROD) return;
  try {
    const body = JSON.stringify({
      error_message: (message || '').slice(0, 500),
      stack: sanitizeStack((stack || '').slice(0, 4000)),
      component,
      url: window.location.pathname,
      browser: navigator.userAgent,
      severity: 'critical',
      timestamp: new Date().toISOString(),
    });
    fetch(`${window.location.origin}/api/v1/errors/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  } catch { /* best effort */ }
}

/** Attach global handlers for uncaught errors and unhandled rejections. */
export function setupGlobalErrorHandlers() {
  window.onerror = (_msg, _source, _line, _col, error) => {
    sendCrashReport(
      error?.message || String(_msg || 'Unknown error'),
      error?.stack || `at ${_source || 'unknown'}:${_line || 0}:${_col || 0}`,
      'window.onerror',
    );
  };
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason || 'Unhandled rejection');
    const stack = reason instanceof Error ? (reason.stack || '') : '';
    sendCrashReport(message, stack, 'unhandledrejection');
  });
}

// ── Error code → user-friendly info ─────────────────────────────────────────

interface ErrorInfo {
  title: string;
  description: string;
  icon: string;
  color: string;
}

const ERROR_MAP: Record<number, ErrorInfo> = {
  401: { title: 'Session Expired', description: 'Please log in to continue.', icon: '🔒', color: WARN },
  403: { title: 'Access Denied', description: 'You don\'t have permission to view this page.', icon: '🚫', color: ERR },
  404: { title: 'Page Not Found', description: 'The page you\'re looking for doesn\'t exist or has been moved.', icon: '🔍', color: MT },
  429: { title: 'Too Many Requests', description: 'Please slow down and try again in a moment.', icon: '⏳', color: WARN },
  500: { title: 'Something Went Wrong', description: 'Internal error — our team has been notified.', icon: '⚠️', color: ERR },
  503: { title: 'Under Maintenance', description: 'Discreet is undergoing scheduled maintenance. We\'ll be back shortly.', icon: '🔧', color: AC },
};

// ── Shared error page layout ────────────────────────────────────────────────

function ErrorPage({
  title,
  description,
  icon,
  color,
  code,
  details,
  onReload,
  onReport,
  onLogin,
}: {
  title: string;
  description: string;
  icon: string;
  color: string;
  code?: string | number;
  details?: string;
  onReload?: () => void;
  onReport?: () => void;
  onLogin?: () => void;
}) {
  return (
    <div style={{
      minHeight: '100vh', background: BG, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'DM Sans', -apple-system, sans-serif",
    }}>
      <div style={{
        width: '100%', maxWidth: 480, textAlign: 'center',
        background: SF, borderRadius: 16, border: `1px solid ${BD}`,
        padding: 'clamp(32px, 6vw, 48px)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
      }}>
        {/* Logo — inline SVG (ErrorBoundary can't import lucide-react safely) */}
        <div style={{ marginBottom: 24 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={TX} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 12px ${AC}44)`, marginBottom: 8 }}>
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <div style={{ fontSize: 20, fontWeight: 700, color: TX }}>Discreet</div>
        </div>

        {/* Error icon */}
        <div style={{
          width: 72, height: 72, borderRadius: 36, margin: '0 auto 20px',
          background: `${color}12`, border: `2px solid ${color}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32,
        }}>
          {icon}
        </div>

        {/* Title */}
        <h1 style={{
          margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: TX,
        }}>
          {title}
        </h1>

        {/* Description */}
        <p style={{
          margin: '0 0 8px', fontSize: 14, color: MT,
          lineHeight: 1.6, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto',
        }}>
          {description}
        </p>

        {/* Error code */}
        {code && (
          <div style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 6,
            background: `${color}12`, border: `1px solid ${color}22`,
            fontSize: 11, fontFamily: 'monospace', color: color,
            fontWeight: 600, letterSpacing: '0.5px', marginBottom: 20,
          }}>
            {typeof code === 'number' ? `HTTP ${code}` : code}
          </div>
        )}

        {/* Technical details (collapsed) */}
        {details && (
          <details style={{ marginBottom: 20, textAlign: 'start' }}>
            <summary style={{
              cursor: 'pointer', fontSize: 12, color: MT,
              padding: '8px 0', userSelect: 'none',
            }}>
              Show Details
            </summary>
            <pre style={{
              padding: 12, background: '#1a1a1a', borderRadius: 8,
              border: `1px solid ${BD}`, fontSize: 11, color: MT,
              fontFamily: "'JetBrains Mono', Consolas, monospace", whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', maxHeight: 300, overflowY: 'scroll',
              margin: '8px 0 8px',
            }}>
              {details}
            </pre>
            <button onClick={() => {
              const report = `Error Report\n${'='.repeat(40)}\n${details}\n\nBrowser: ${navigator.userAgent}\nTime: ${new Date().toISOString()}`;
              navigator.clipboard?.writeText(report);
            }} style={{
              padding: '4px 12px', borderRadius: 6, border: `1px solid ${BD}`,
              background: 'transparent', color: MT, fontSize: 11,
              fontWeight: 600, cursor: 'pointer',
            }}>
              Copy Error Report
            </button>
          </details>
        )}

        {/* Action buttons */}
        <div style={{
          display: 'flex', gap: 10, justifyContent: 'center',
          flexWrap: 'wrap', marginTop: details ? 0 : 20,
        }}>
          {onLogin && (
            <button onClick={onLogin} style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: AC,
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
              Log In
            </button>
          )}
          {onReload && (
            <button onClick={onReload} style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: AC,
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
              Reload
            </button>
          )}
          {onReport && (
            <button onClick={onReport} style={{
              padding: '10px 24px', borderRadius: 8,
              background: 'transparent', border: `1px solid ${BD}`,
              color: MT, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              Report Bug
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ApiErrorPage — for server-side error codes ──────────────────────────────

export function ApiErrorPage({
  status,
  message,
  onReload,
  onLogin,
}: {
  status: number;
  message?: string;
  onReload?: () => void;
  onLogin?: () => void;
}) {
  const info = ERROR_MAP[status] || {
    title: `Error ${status}`,
    description: message || 'An unexpected error occurred.',
    icon: '⚠️',
    color: ERR,
  };

  return (
    <ErrorPage
      title={info.title}
      description={message || info.description}
      icon={info.icon}
      color={info.color}
      code={status}
      onReload={status !== 401 ? onReload : undefined}
      onLogin={status === 401 ? (onLogin || (() => window.location.reload())) : undefined}
    />
  );
}

// ── MaintenancePage — dedicated 503 page ────────────────────────────────────

export function MaintenancePage({ message }: { message?: string }) {
  return (
    <ErrorPage
      title="Under Maintenance"
      description={message || "Discreet is undergoing scheduled maintenance. We'll be back shortly."}
      icon="🔧"
      color={AC}
      code={503}
    />
  );
}

// ── ErrorBoundary — React class component ───────────────────────────────────

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Section name for error reporting. Omit for full-page fallback. */
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showBugReport: boolean;
  showDetails: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, showBugReport: false, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    sendCrashReport(error.message, errorInfo.componentStack || error.stack || '', this.props.name || 'root');
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleReport = () => {
    this.setState({ showBugReport: true });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo, showBugReport, showDetails } = this.state;
    // Safely extract error info as strings — never render an object directly.
    const errorName = typeof error?.name === 'string' ? error.name : 'Error';
    const errorMessage = typeof error?.message === 'string'
      ? error.message
      : error ? String(error) : 'An unexpected error occurred';
    const stack = typeof error?.stack === 'string' ? error.stack : '';
    const componentStack = errorInfo?.componentStack || '';

    // ── Section-level inline fallback (when name prop is set) ──
    if (this.props.name) {
      const sectionDetails = [
        `${errorName}: ${errorMessage}`,
        componentStack && `\nComponent stack:${componentStack}`,
      ].filter(Boolean).join('\n');

      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flex: 1, padding: 24, minHeight: 120,
        }}>
          <div style={{
            maxWidth: 400, width: '100%', padding: 24,
            background: 'var(--bg-card, #0f1119)', borderRadius: 12,
            border: '1px solid var(--border-color, #181c2a)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #dde0ea)', marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted, #5a6080)', lineHeight: 1.6, marginBottom: 16 }}>
              This section encountered an error but the rest of the app is still working.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: showDetails ? 12 : 0 }}>
              <button onClick={this.handleRetry} style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: `var(--accent, ${AC})`, color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>
                Retry
              </button>
              <button onClick={() => this.setState({ showDetails: !showDetails })} style={{
                padding: '8px 16px', borderRadius: 8,
                background: 'transparent', border: `1px solid ${BD}`,
                color: MT, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
                {showDetails ? 'Hide Details' : 'Show Details'}
              </button>
            </div>
            {showDetails && (
              <div style={{ textAlign: 'start', marginTop: 8 }}>
                <pre style={{
                  padding: 12, background: '#1a1a1a', borderRadius: 8,
                  border: `1px solid ${BD}`, fontSize: 11, color: MT,
                  fontFamily: "'JetBrains Mono', Consolas, monospace", whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', maxHeight: 300, overflowY: 'scroll',
                  margin: '0 0 8px',
                }}>
                  {sectionDetails}
                </pre>
                <button onClick={() => {
                  const report = `Error Report\n${'='.repeat(40)}\n${sectionDetails}\n\nBrowser: ${navigator.userAgent}\nTime: ${new Date().toISOString()}`;
                  navigator.clipboard?.writeText(report);
                }} style={{
                  padding: '4px 12px', borderRadius: 6, border: `1px solid ${BD}`,
                  background: 'transparent', color: MT, fontSize: 11,
                  fontWeight: 600, cursor: 'pointer',
                }}>
                  Copy Error Report
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // ── Full-page fallback (top-level ErrorBoundary without name) ──
    const details = [
      `${errorName}: ${errorMessage}`,
      stack && `\nStack trace:\n${stack}`,
      componentStack && `\nComponent stack:${componentStack}`,
    ].filter(Boolean).join('\n');

    return (
      <>
        <ErrorPage
          title="Something Unexpected Happened"
          description="Our team has been notified. You can try reloading or report additional details to help us fix it faster."
          icon="⚠️"
          color={AC}
          code={errorName !== 'Error' ? errorName : 'REACT_ERROR'}
          details={details}
          onReload={this.handleReload}
          onReport={this.handleReport}
        />

        {showBugReport && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 99999, padding: 16,
            fontFamily: "'DM Sans', -apple-system, sans-serif",
          }} onClick={e => { if (e.target === e.currentTarget) this.setState({ showBugReport: false }); }}>
            <div style={{
              width: '100%', maxWidth: 440, background: SF, borderRadius: 12,
              border: `1px solid ${BD}`, padding: 24,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: TX, marginBottom: 12 }}>Report Bug</div>
              <div style={{ fontSize: 12, color: MT, marginBottom: 16, lineHeight: 1.5 }}>
                The error details will be included automatically.
              </div>
              <textarea
                id="eb-description"
                placeholder="Any extra context about what you were doing..."
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', background: BG,
                  border: `1px solid ${BD}`, borderRadius: 8, color: TX,
                  fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                  marginBottom: 12,
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    const desc = (document.getElementById('eb-description') as HTMLTextAreaElement)?.value || '';
                    const body = {
                      page: window.location.pathname,
                      description: `[ErrorBoundary] ${errorMessage}\n\n${desc}`.trim(),
                      error_code: errorName,
                      browser_info: navigator.userAgent,
                    };
                    try {
                      await fetch(`${window.location.origin}/api/v1/bug-reports`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                      });
                    } catch { /* best effort */ }
                    this.setState({ showBugReport: false });
                    alert('Bug report submitted. Thank you!');
                  }}
                  style={{
                    padding: '10px 24px', borderRadius: 8, border: 'none',
                    background: AC, color: '#000', fontSize: 13,
                    fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  Submit Report
                </button>
                <button
                  onClick={() => this.setState({ showBugReport: false })}
                  style={{
                    padding: '10px 20px', borderRadius: 8,
                    background: 'transparent', border: `1px solid ${BD}`,
                    color: MT, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
}
