/**
 * PrivacyPolicy — Full-page privacy policy for Discreet.
 */
import React from 'react';
import { T } from '../theme';

const S: Record<string, React.CSSProperties> = {
  page: { background: T.bg, color: T.tx, minHeight: '100vh', padding: '60px 24px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,sans-serif', lineHeight: 1.7 },
  wrap: { maxWidth: 720, margin: '0 auto' },
  h1: { fontSize: 32, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 },
  updated: { fontSize: 13, color: T.mt, marginBottom: 40 },
  h2: { fontSize: 20, fontWeight: 700, marginTop: 36, marginBottom: 12, color: T.ac },
  h3: { fontSize: 16, fontWeight: 600, marginTop: 24, marginBottom: 8 },
  p: { fontSize: 14, color: T.mt, marginBottom: 12 },
  ul: { fontSize: 14, color: T.mt, marginBottom: 12, paddingLeft: 24 },
  li: { marginBottom: 6 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14, marginBottom: 16 },
  th: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: `1px solid ${T.bd}`, color: T.mt, fontWeight: 600, fontSize: 12, textTransform: 'uppercase' as const },
  td: { padding: '8px 12px', borderBottom: `1px solid ${T.bd}`, color: T.mt },
  back: { display: 'inline-block', marginBottom: 32, color: T.ac, textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  footer: { marginTop: 48, paddingTop: 24, borderTop: `1px solid ${T.bd}`, fontSize: 12, color: T.mt },
};

export function PrivacyPolicy() {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <a href="/app" style={S.back}>&larr; Back to Discreet</a>

        <h1 style={S.h1}>Privacy Policy</h1>
        <div style={S.updated}>Last updated: March 13, 2026</div>

        <p style={S.p}>
          Discreet is built on a simple principle: <strong style={{ color: T.tx }}>the server cannot read your messages</strong>.
          All message content, files, and voice/video streams are end-to-end encrypted (E2EE) before they leave your device.
          This policy explains what limited data we do collect and how we handle it.
        </p>

        <h2 style={S.h2}>1. What We Collect</h2>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Data</th>
              <th style={S.th}>Purpose</th>
              <th style={S.th}>Stored</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={S.td}>Username</td><td style={S.td}>Account identity</td><td style={S.td}>Until account deletion</td></tr>
            <tr><td style={S.td}>Email (optional)</td><td style={S.td}>Password recovery, verification</td><td style={S.td}>Until account deletion</td></tr>
            <tr><td style={S.td}>Phone (optional)</td><td style={S.td}>2FA recovery</td><td style={S.td}>Until account deletion</td></tr>
            <tr><td style={S.td}>Password hash (Argon2id)</td><td style={S.td}>Authentication</td><td style={S.td}>Until account deletion</td></tr>
            <tr><td style={S.td}>IP address</td><td style={S.td}>Rate limiting, abuse prevention</td><td style={S.td}>Not persisted to database</td></tr>
            <tr><td style={S.td}>Server/channel membership</td><td style={S.td}>Message routing</td><td style={S.td}>Until you leave or delete</td></tr>
          </tbody>
        </table>

        <h2 style={S.h2}>2. What We Cannot See</h2>
        <p style={S.p}>
          The following data is end-to-end encrypted. The server stores only ciphertext blobs and
          has no ability to decrypt them, even under legal compulsion:
        </p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={{ color: T.tx }}>Message content</strong> — encrypted with MLS (RFC 9420) for groups, Signal Protocol for DMs</li>
          <li style={S.li}><strong style={{ color: T.tx }}>Files and attachments</strong> — encrypted before upload</li>
          <li style={S.li}><strong style={{ color: T.tx }}>Voice and video streams</strong> — encrypted with SFrame (RFC 9605)</li>
          <li style={S.li}><strong style={{ color: T.tx }}>AI agent conversations</strong> — agents hold MLS leaf secrets; the server relays ciphertext</li>
        </ul>

        <h2 style={S.h2}>3. How We Use Your Data</h2>
        <p style={S.p}>We use the limited plaintext data we hold for two purposes only:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={{ color: T.tx }}>Authentication</strong> — verifying your identity when you log in</li>
          <li style={S.li}><strong style={{ color: T.tx }}>Abuse prevention</strong> — rate limiting, spam detection, and enforcing bans</li>
        </ul>
        <p style={S.p}>We do not sell, rent, or share your data with advertisers. We do not profile you. We do not track you across sites.</p>

        <h2 style={S.h2}>4. Third-Party Services</h2>
        <p style={S.p}>We use a minimal set of third-party services:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={{ color: T.tx }}>Resend</strong> — transactional email delivery (verification, password reset). Receives your email address only if you provide one.</li>
          <li style={S.li}><strong style={{ color: T.tx }}>Cloudflare</strong> — CDN and DNS. Processes IP addresses for traffic routing. Does not have access to encrypted content.</li>
          <li style={S.li}><strong style={{ color: T.tx }}>LLM providers</strong> (Anthropic, OpenAI, Ollama) — only if you or your server admin enable AI agents. Agent conversations are decrypted on the agent's MLS leaf node, not on the server. Self-hosted Ollama keeps data entirely local.</li>
        </ul>

        <h2 style={S.h2}>5. Data Retention</h2>
        <ul style={S.ul}>
          <li style={S.li}>Encrypted messages are stored as ciphertext indefinitely to support message history.</li>
          <li style={S.li}>When you delete your account, all associated data (profile, memberships, messages) is permanently deleted from the database.</li>
          <li style={S.li}>Backups are encrypted at rest and rotated on a 30-day cycle.</li>
        </ul>

        <h2 style={S.h2}>6. Your Rights (GDPR)</h2>
        <p style={S.p}>If you are in the EU/EEA, you have the following rights — all of which are built into the platform:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={{ color: T.tx }}>Access & Export</strong> — download all your data from Settings</li>
          <li style={S.li}><strong style={{ color: T.tx }}>Deletion</strong> — delete your account and all associated data from Settings</li>
          <li style={S.li}><strong style={{ color: T.tx }}>Portability</strong> — export your data in a machine-readable format</li>
          <li style={S.li}><strong style={{ color: T.tx }}>Rectification</strong> — update your profile information at any time</li>
        </ul>
        <p style={S.p}>For self-hosted instances, the instance operator is the data controller. Discreet software provides the tools; the operator sets the policies.</p>

        <h2 style={S.h2}>7. Children</h2>
        <p style={S.p}>
          Discreet is not intended for children under 13. We do not knowingly collect data from anyone under 13.
          If you believe a child under 13 has created an account, contact us and we will delete it.
        </p>

        <h2 style={S.h2}>8. Security</h2>
        <p style={S.p}>
          Passwords are hashed with Argon2id. Sessions are JWT-based with Redis-backed revocation.
          TOTP secrets are encrypted with AES-256-GCM at rest. All connections require TLS.
          The cryptographic design is based on published IETF and NIST standards (MLS RFC 9420, SFrame RFC 9605, ML-KEM FIPS 203).
        </p>

        <h2 style={S.h2}>9. Changes to This Policy</h2>
        <p style={S.p}>
          We will post updates to this page and update the "Last updated" date. For material changes,
          we will notify users via an in-app banner.
        </p>

        <h2 style={S.h2}>10. Contact</h2>
        <p style={S.p}>
          For privacy questions, data requests, or security disclosures:<br />
          <strong style={{ color: T.tx }}>security@discreetai.net</strong>
        </p>

        <div style={S.footer}>
          &copy; 2026 Discreet &middot; AGPL-3.0-or-later &middot; <a href="/app" style={{ color: T.ac }}>Back to app</a>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
