/**
 * PrivacyPolicy — Full-page privacy policy for Discreet.
 * Route: /app/privacy (accessible without authentication)
 */
import React from 'react';
import { getLandingColors } from '../../hooks/useLandingTheme';

function useS() {
  const C = getLandingColors();
  return {
    page: { background: C.bg, color: C.tx, minHeight: '100vh', height: '100vh', overflowY: 'auto', padding: '60px 24px 80px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,sans-serif', lineHeight: 1.7 } as React.CSSProperties,
    wrap: { maxWidth: 720, margin: '0 auto' } as React.CSSProperties,
    h1: { fontSize: 32, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 } as React.CSSProperties,
    updated: { fontSize: 13, color: C.mt, marginBottom: 40 } as React.CSSProperties,
    h2: { fontSize: 20, fontWeight: 700, marginTop: 36, marginBottom: 12, color: C.ac } as React.CSSProperties,
    p: { fontSize: 14, color: C.mt, marginBottom: 12 } as React.CSSProperties,
    ul: { fontSize: 14, color: C.mt, marginBottom: 12, paddingInlineStart: 24 } as React.CSSProperties,
    li: { marginBottom: 6 } as React.CSSProperties,
    strong: { color: C.tx, fontWeight: 600 } as React.CSSProperties,
    back: { display: 'inline-block', marginBottom: 32, color: C.ac, textDecoration: 'none', fontSize: 14, fontWeight: 600 } as React.CSSProperties,
    footer: { marginTop: 48, paddingTop: 24, borderTop: `1px solid ${C.bd}`, fontSize: 12, color: C.mt } as React.CSSProperties,
    highlight: { padding: '14px 16px', background: 'rgba(0,212,170,0.05)', border: '1px solid rgba(0,212,170,0.15)', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 14, color: C.ac, lineHeight: 1.6 } as React.CSSProperties,
    ac: C.ac, mt: C.mt,
  };
}

export function PrivacyPolicy() {
  const S = useS();
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <a href="/" style={S.back}>&larr; Back to Discreet</a>

        <h1 style={S.h1}>Privacy Policy</h1>
        <div style={S.updated}>Last updated: March 20, 2026</div>

        <p style={S.p}>
          Discreet is a privacy-first communication platform. This policy explains
          what data we collect, what we never collect, and how we handle your information.
        </p>

        <div style={S.highlight}>
          <strong>In short:</strong> We collect the minimum data needed to operate the Service.
          We cannot read your messages. We do not track you. We do not sell your data.
        </div>

        {/* ── What We Collect ── */}
        <h2 style={S.h2}>1. What We Collect</h2>
        <p style={S.p}>When you create an account, we store:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>Email address</strong> — used for account recovery, email verification, and critical security notifications</li>
          <li style={S.li}><strong style={S.strong}>Hashed password</strong> — stored using Argon2id; we never store or see your plaintext password</li>
          <li style={S.li}><strong style={S.strong}>Username</strong> — your chosen public identifier</li>
          <li style={S.li}><strong style={S.strong}>Display name</strong> (optional) — a customizable name shown alongside your username</li>
          <li style={S.li}><strong style={S.strong}>Date of birth</strong> (optional) — used only for age verification (COPPA compliance)</li>
          <li style={S.li}><strong style={S.strong}>Account creation timestamp</strong></li>
        </ul>
        <p style={S.p}>During use, we process:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>Encrypted messages</strong> — stored as ciphertext the server cannot decrypt</li>
          <li style={S.li}><strong style={S.strong}>Message metadata</strong> — sender ID, channel ID, timestamps (required for delivery)</li>
          <li style={S.li}><strong style={S.strong}>IP addresses</strong> — used for rate limiting and abuse prevention; not stored long-term</li>
          <li style={S.li}><strong style={S.strong}>Session tokens</strong> — for maintaining your logged-in state</li>
        </ul>

        {/* ── What We Never Collect ── */}
        <h2 style={S.h2}>2. What We Never Collect</h2>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>Phone number</strong> — not required, not requested, not stored</li>
          <li style={S.li}><strong style={S.strong}>Location data</strong> — no GPS, no geolocation, no location tracking</li>
          <li style={S.li}><strong style={S.strong}>Message content</strong> — end-to-end encrypted; the server stores only ciphertext it cannot read</li>
          <li style={S.li}><strong style={S.strong}>Analytics or telemetry</strong> — zero tracking pixels, zero analytics scripts, zero data collection SDKs</li>
          <li style={S.li}><strong style={S.strong}>Contact lists</strong> — we never access or upload your contacts</li>
          <li style={S.li}><strong style={S.strong}>Browsing history</strong> — we do not track what you click, view, or search</li>
          <li style={S.li}><strong style={S.strong}>Advertising identifiers</strong> — Discreet has no ads and no ad tracking</li>
        </ul>

        {/* ── Third-Party Services ── */}
        <h2 style={S.h2}>3. Third-Party Services</h2>
        <p style={S.p}>We use a minimal set of third-party services:</p>
        <ul style={S.ul}>
          <li style={S.li}>
            <strong style={S.strong}>Resend</strong> — transactional email delivery (password resets,
            email verification). Resend processes your email address only to deliver
            messages on our behalf. They do not use it for marketing.
          </li>
          <li style={S.li}>
            <strong style={S.strong}>Cloudflare</strong> — DNS, DDoS protection, and CDN for the
            landing page. Cloudflare may process IP addresses and HTTP headers as part
            of their standard proxy service. They do not have access to encrypted message content.
          </li>
        </ul>
        <p style={S.p}>
          <strong style={S.strong}>We do not sell, rent, or share your personal data with any third party.</strong>{' '}
          We do not use advertising networks, data brokers, or analytics platforms.
        </p>

        {/* ── End-to-End Encryption ── */}
        <h2 style={S.h2}>4. End-to-End Encryption</h2>
        <p style={S.p}>
          All messages are encrypted on your device before they leave your browser.
          The server stores and relays ciphertext that only the intended recipients
          can decrypt. We use the Messaging Layer Security (MLS) protocol (RFC 9420)
          for group messaging and SFrame (RFC 9605) for voice/video encryption.
        </p>
        <p style={S.p}>
          This means we <strong style={S.strong}>cannot</strong>:
        </p>
        <ul style={S.ul}>
          <li style={S.li}>Read your messages</li>
          <li style={S.li}>Search your message content</li>
          <li style={S.li}>Provide message content to third parties (including law enforcement)</li>
          <li style={S.li}>Moderate message content (moderation relies on user reports)</li>
        </ul>

        {/* ── Your Rights ── */}
        <h2 style={S.h2}>5. Your Rights</h2>
        <p style={S.p}>You have full control over your data:</p>
        <ul style={S.ul}>
          <li style={S.li}>
            <strong style={S.strong}>Export</strong> — Download all your data at any time
            (Settings &rarr; Account &rarr; Export My Data). The export includes messages,
            voice recordings, and account information as a ZIP file.
          </li>
          <li style={S.li}>
            <strong style={S.strong}>Delete messages</strong> — Remove individual messages or
            use disappearing messages for automatic deletion.
          </li>
          <li style={S.li}>
            <strong style={S.strong}>Delete account</strong> — Permanently delete your account
            and all associated data (Settings &rarr; Account &rarr; Delete Account).
            This action is irreversible.
          </li>
          <li style={S.li}>
            <strong style={S.strong}>Correct data</strong> — Update your email, username,
            display name, and other profile information at any time.
          </li>
        </ul>
        <p style={S.p}>
          If you are in the EU/EEA, you have additional rights under GDPR including
          the right to data portability, the right to restrict processing, and the
          right to lodge a complaint with a supervisory authority.
        </p>

        {/* ── Data Security ── */}
        <h2 style={S.h2}>6. Data Security</h2>
        <p style={S.p}>
          We take security seriously. Our measures include:
        </p>
        <ul style={S.ul}>
          <li style={S.li}>End-to-end encryption for all messages (MLS RFC 9420)</li>
          <li style={S.li}>Argon2id password hashing with tuned parameters</li>
          <li style={S.li}>TLS 1.3 for all connections</li>
          <li style={S.li}>FIDO2 passkey support for passwordless authentication</li>
          <li style={S.li}>Compile-time SQL validation (prevents injection by design)</li>
          <li style={S.li}>Open-source code for public audit</li>
        </ul>

        {/* ── Children's Privacy ── */}
        <h2 style={S.h2}>7. Children's Privacy</h2>
        <p style={S.p}>
          Discreet is not intended for children under 13. We do not knowingly collect
          personal information from children under 13. If we learn that we have
          collected data from a child under 13, we will delete the account and
          associated data promptly. If you believe a child under 13 is using Discreet,
          please contact us at{' '}
          <a href="mailto:dev@discreetai.net" style={{ color: S.ac }}>dev@discreetai.net</a>.
        </p>

        {/* ── Changes ── */}
        <h2 style={S.h2}>8. Changes to This Policy</h2>
        <p style={S.p}>
          We may update this Privacy Policy from time to time. Material changes will
          be announced via the application. The "Last updated" date at the top of this
          page indicates when the policy was last revised.
        </p>

        {/* ── Contact ── */}
        <h2 style={S.h2}>9. Contact</h2>
        <p style={S.p}>
          Questions or concerns about your privacy? Contact us at{' '}
          <a href="mailto:dev@discreetai.net" style={{ color: S.ac }}>dev@discreetai.net</a>.
        </p>

        <div style={S.footer}>
          <p>Copyright &copy; 2024-2026 Discreet contributors. Patent Pending.</p>
          <p style={{ marginTop: 8 }}>
            <a href="/terms" style={{ color: S.ac, marginInlineEnd: 16 }}>Terms of Service</a>
            <a href="/" style={{ color: S.mt }}>Back to Discreet</a>
          </p>
        </div>
      </div>
    </div>
  );
}
