/**
 * WarrantCanary — Public transparency page.
 * Route: /canary (accessible without authentication)
 */
import React from 'react';
import { getLandingColors } from '../../hooks/useLandingTheme';

function S() {
  const C = getLandingColors();
  return {
    page: { background: C.bg, color: C.tx, minHeight: '100vh', padding: '60px 24px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,sans-serif', lineHeight: 1.7 } as React.CSSProperties,
    wrap: { maxWidth: 720, margin: '0 auto' } as React.CSSProperties,
    back: { display: 'inline-block', marginBottom: 32, color: C.ac, textDecoration: 'none', fontSize: 14, fontWeight: 600 } as React.CSSProperties,
    h1: { fontSize: 32, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 } as React.CSSProperties,
    updated: { fontSize: 13, color: C.mt, marginBottom: 40 } as React.CSSProperties,
    p: { fontSize: 15, color: C.tx, marginBottom: 16, lineHeight: 1.8 } as React.CSSProperties,
    canary: { padding: '24px 28px', background: 'rgba(0,212,170,0.04)', border: '1px solid rgba(0,212,170,0.15)', borderRadius: 'var(--border-radius)', marginBottom: 32 } as React.CSSProperties,
    statement: { fontSize: 15, color: C.tx, lineHeight: 1.8, marginBottom: 12 } as React.CSSProperties,
    check: { color: '#2ecc71', fontWeight: 700, marginRight: 8 } as React.CSSProperties,
    notice: { fontSize: 13, color: C.mt, lineHeight: 1.7, marginTop: 24, padding: '16px 20px', background: 'rgba(250,166,26,0.06)', border: '1px solid rgba(250,166,26,0.15)', borderRadius: 'var(--radius-md)' } as React.CSSProperties,
    footer: { marginTop: 48, paddingTop: 24, borderTop: `1px solid ${C.bd}`, fontSize: 12, color: C.mt } as React.CSSProperties,
  };
}

export function WarrantCanary() {
  const s = S();
  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <a href="/app" style={s.back}>&larr; Back to Discreet</a>

        <h1 style={s.h1}>Warrant Canary</h1>
        <div style={s.updated}>Last updated: March 2026</div>

        <p style={s.p}>
          A warrant canary is a public statement confirming that an organization has not
          received certain types of government orders. If this page is removed or stops
          being updated, it may indicate that such an order has been received and a gag
          order prevents us from disclosing it directly.
        </p>

        <div style={s.canary}>
          <div style={s.statement}>
            <span style={s.check}>&#10003;</span>
            Discreet has <strong>not</strong> received any National Security Letters.
          </div>
          <div style={s.statement}>
            <span style={s.check}>&#10003;</span>
            Discreet has <strong>not</strong> received any FISA court orders.
          </div>
          <div style={s.statement}>
            <span style={s.check}>&#10003;</span>
            Discreet has <strong>not</strong> received any gag orders from any government agency.
          </div>
          <div style={s.statement}>
            <span style={s.check}>&#10003;</span>
            Discreet has <strong>not</strong> been compelled to provide user data, encryption keys,
            or backdoor access to any party.
          </div>
          <div style={s.statement}>
            <span style={s.check}>&#10003;</span>
            Discreet has <strong>not</strong> been subject to any secret court orders.
          </div>
        </div>

        <div style={s.notice}>
          <strong>Update schedule:</strong> This canary is updated quarterly. If this page is
          removed or not updated for more than 90 days, assume that the above statements
          may no longer be true. The next scheduled update is <strong>June 2026</strong>.
        </div>

        <p style={{ ...s.p, marginTop: 24 }}>
          For more information about warrant canaries and how they work, visit the{' '}
          <a href="https://www.eff.org/deeplinks/2014/04/warrant-canary-faq" target="_blank" rel="noopener noreferrer" style={{ color: s.back.color }}>
            Electronic Frontier Foundation
          </a>.
        </p>

        <div style={s.footer}>
          <p>Copyright &copy; 2024-2026 Discreet contributors. AGPL-3.0-or-later.</p>
          <p style={{ marginTop: 8 }}>
            <a href="/app/terms" style={{ color: s.back.color, marginRight: 16 }}>Terms of Service</a>
            <a href="/app/privacy" style={{ color: s.back.color, marginRight: 16 }}>Privacy Policy</a>
            <a href="/app" style={{ color: s.footer.color }}>Back to Discreet</a>
          </p>
        </div>
      </div>
    </div>
  );
}
