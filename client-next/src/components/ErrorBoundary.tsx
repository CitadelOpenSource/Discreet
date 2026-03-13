/**
 * ErrorBoundary — Catches React render errors and shows a branded error page.
 *
 * Also exports ApiErrorPage for rendering server-side error responses
 * (401, 403, 404, 429, 500, 503) as full-page views.
 */
import React from 'react';

// ── Hardcoded theme values (ErrorBoundary can't use T — it may have crashed) ─
const BG   = '#07090f';
const SF   = '#0b0d15';
const BD   = '#181c2a';
const TX   = '#dde0ea';
const MT   = '#5a6080';
const AC   = '#00d4aa';
const ERR  = '#ff4757';
const WARN = '#ffa502';

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
        {/* Logo */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🛡️</div>
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
          <details style={{ marginBottom: 20, textAlign: 'left' }}>
            <summary style={{
              cursor: 'pointer', fontSize: 12, color: MT,
              padding: '8px 0', userSelect: 'none',
            }}>
              Technical details
            </summary>
            <pre style={{
              padding: 12, background: BG, borderRadius: 8,
              border: `1px solid ${BD}`, fontSize: 11, color: MT,
              fontFamily: 'monospace', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', maxHeight: 200, overflow: 'auto',
              margin: '8px 0 0',
            }}>
              {details}
            </pre>
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
              background: `linear-gradient(135deg, ${AC}, #009e7e)`,
              color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
              Log In
            </button>
          )}
          {onReload && (
            <button onClick={onReload} style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: `linear-gradient(135deg, ${AC}, #009e7e)`,
              color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer',
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
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showBugReport: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, showBugReport: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Uncaught React error:', error, errorInfo);
  }

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

    const { error, errorInfo, showBugReport } = this.state;

    const errorName = error?.name || 'Error';
    const errorMessage = error?.message || 'An unexpected error occurred';
    const stack = error?.stack || '';
    const componentStack = errorInfo?.componentStack || '';

    const details = [
      `${errorName}: ${errorMessage}`,
      stack && `\nStack trace:\n${stack}`,
      componentStack && `\nComponent stack:${componentStack}`,
    ].filter(Boolean).join('\n');

    return (
      <>
        <ErrorPage
          title="Something Went Wrong"
          description="An unexpected error occurred in the application. You can try reloading or report this bug to help us fix it."
          icon="💥"
          color={ERR}
          code={errorName !== 'Error' ? errorName : 'REACT_ERROR'}
          details={details}
          onReload={this.handleReload}
          onReport={this.handleReport}
        />

        {/* Inline bug report form (since BugReportButton may not be mounted) */}
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
