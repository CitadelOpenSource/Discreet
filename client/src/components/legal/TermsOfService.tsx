/**
 * TermsOfService — Full-page terms of service for Discreet.
 * Route: /app/terms (accessible without authentication)
 */
import React from 'react';
import { T } from '../../theme';

const S: Record<string, React.CSSProperties> = {
  page: { background: T.bg, color: T.tx, minHeight: '100vh', padding: '60px 24px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,sans-serif', lineHeight: 1.7 },
  wrap: { maxWidth: 720, margin: '0 auto' },
  h1: { fontSize: 32, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 },
  updated: { fontSize: 13, color: T.mt, marginBottom: 40 },
  h2: { fontSize: 20, fontWeight: 700, marginTop: 36, marginBottom: 12, color: T.ac },
  p: { fontSize: 14, color: T.mt, marginBottom: 12 },
  ul: { fontSize: 14, color: T.mt, marginBottom: 12, paddingLeft: 24 },
  li: { marginBottom: 6 },
  strong: { color: T.tx, fontWeight: 600 },
  back: { display: 'inline-block', marginBottom: 32, color: T.ac, textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  footer: { marginTop: 48, paddingTop: 24, borderTop: `1px solid ${T.bd}`, fontSize: 12, color: T.mt },
  warn: { padding: '14px 16px', background: 'rgba(255,71,87,0.06)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, marginBottom: 12, fontSize: 14, color: '#ff4757', lineHeight: 1.6 },
};

export function TermsOfService() {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <a href="/app" style={S.back}>&larr; Back to Discreet</a>

        <h1 style={S.h1}>Terms of Service</h1>
        <div style={S.updated}>Last updated: March 20, 2026</div>

        <p style={S.p}>
          These Terms of Service ("Terms") govern your use of Discreet ("the Service"),
          an end-to-end encrypted communication platform operated by Citadel Open Source LLC
          ("we", "us", "our"). By creating an account, you agree to these Terms.
        </p>

        {/* ── Account Creation ── */}
        <h2 style={S.h2}>1. Account Creation</h2>
        <p style={S.p}>
          To create an account, you must provide a valid email address and choose a
          username and password. A phone number is <strong style={S.strong}>not required</strong>.
          You are responsible for maintaining the security of your account credentials.
          You must not share your account or allow others to access it.
        </p>

        {/* ── Age Requirement ── */}
        <h2 style={S.h2}>2. Age Requirement</h2>
        <p style={S.p}>
          You must be at least <strong style={S.strong}>13 years of age</strong> to use
          Discreet. If you are under 13, you may not create an account. In jurisdictions
          where the minimum age for digital services is higher (e.g., 16 in the EU under
          GDPR), that higher age applies. We comply with the Children's Online Privacy
          Protection Act (COPPA) and do not knowingly collect personal information from
          children under 13.
        </p>

        {/* ── Acceptable Use ── */}
        <h2 style={S.h2}>3. Acceptable Use</h2>
        <p style={S.p}>You agree not to use Discreet to:</p>
        <ul style={S.ul}>
          <li style={S.li}>Share, distribute, or produce child sexual abuse material (CSAM) in any form</li>
          <li style={S.li}>Harass, threaten, stalk, or intimidate other users</li>
          <li style={S.li}>Engage in or facilitate illegal activity</li>
          <li style={S.li}>Distribute malware, phishing links, or other harmful software</li>
          <li style={S.li}>Impersonate other individuals or organizations</li>
          <li style={S.li}>Attempt to circumvent security measures, access other users' accounts, or exploit vulnerabilities</li>
          <li style={S.li}>Use the Service for spam, unsolicited advertising, or automated bulk messaging</li>
        </ul>

        {/* ── CSAM Zero-Tolerance ── */}
        <h2 style={S.h2}>4. CSAM Zero-Tolerance Policy</h2>
        <div style={S.warn}>
          <strong>Discreet has an absolute zero-tolerance policy for child sexual abuse
          material (CSAM).</strong> Any account found to be associated with CSAM will be
          permanently banned immediately. All available metadata (account creation date,
          IP addresses, timestamps, server memberships) will be preserved and reported to
          the National Center for Missing & Exploited Children (NCMEC) in accordance with
          18 U.S.C. &sect; 2258A. We will cooperate fully with law enforcement investigations.
        </div>
        <p style={S.p}>
          While Discreet uses end-to-end encryption and cannot read message content,
          we act on reports from users, server administrators, and law enforcement.
          Encryption does not protect illegal conduct.
        </p>

        {/* ── Encryption Disclosure ── */}
        <h2 style={S.h2}>5. Encryption Disclosure</h2>
        <p style={S.p}>
          Discreet uses end-to-end encryption (MLS RFC 9420) for all messages.
          This means <strong style={S.strong}>we cannot read your messages</strong>.
          The server stores and relays ciphertext that only the intended recipients
          can decrypt. We cannot provide message content to any third party,
          including law enforcement, because we do not possess the decryption keys.
        </p>
        <p style={S.p}>
          Metadata (such as who sent a message, when, and to which channel) is
          visible to the server for message routing purposes.
        </p>

        {/* ── Data Retention ── */}
        <h2 style={S.h2}>6. Data Retention</h2>
        <p style={S.p}>
          Messages are stored encrypted on our servers until you or a server
          administrator deletes them. You control your data:
        </p>
        <ul style={S.ul}>
          <li style={S.li}>You can delete individual messages at any time</li>
          <li style={S.li}>You can use disappearing messages to auto-delete after a set period</li>
          <li style={S.li}>You can export all your data (Settings &rarr; Account &rarr; Export My Data)</li>
          <li style={S.li}>You can delete your account and all associated data permanently</li>
        </ul>
        <p style={S.p}>
          Server administrators may configure channel-level retention policies
          that automatically delete messages older than a specified number of days.
        </p>

        {/* ── Open Source ── */}
        <h2 style={S.h2}>7. Open Source</h2>
        <p style={S.p}>
          Discreet is open-source software licensed under the{' '}
          <strong style={S.strong}>GNU Affero General Public License v3.0 (AGPL-3.0-or-later)</strong>.
          The source code is publicly available at{' '}
          <a href="https://github.com/CitadelOpenSource/Discreet" style={{ color: T.ac }}>
            github.com/CitadelOpenSource/Discreet
          </a>.
          You may self-host your own instance under the terms of the AGPL.
        </p>

        {/* ── Disclaimer of Warranty ── */}
        <h2 style={S.h2}>8. Disclaimer of Warranty</h2>
        <p style={S.p}>
          Discreet is provided <strong style={S.strong}>"as is"</strong> without
          warranty of any kind, express or implied. This is alpha software under active
          development. We do not guarantee uninterrupted service, data durability, or
          freedom from bugs. Use the Service at your own risk. We strongly recommend
          keeping local backups of important data.
        </p>

        {/* ── Limitation of Liability ── */}
        <h2 style={S.h2}>9. Limitation of Liability</h2>
        <p style={S.p}>
          To the maximum extent permitted by law, Citadel Open Source LLC shall not be
          liable for any indirect, incidental, special, consequential, or punitive damages
          arising from your use of the Service, including loss of data, loss of profits,
          or interruption of service.
        </p>

        {/* ── Termination ── */}
        <h2 style={S.h2}>10. Termination</h2>
        <p style={S.p}>
          We may suspend or terminate your account if you violate these Terms. You may
          delete your account at any time through Settings &rarr; Account &rarr; Delete Account.
          Upon deletion, your data is permanently removed from our servers.
        </p>

        {/* ── Governing Law ── */}
        <h2 style={S.h2}>11. Governing Law</h2>
        <p style={S.p}>
          These Terms are governed by the laws of the State of Delaware, United States,
          without regard to conflict of law principles. Any disputes arising from these
          Terms shall be resolved in the state or federal courts located in Delaware.
        </p>

        {/* ── Changes ── */}
        <h2 style={S.h2}>12. Changes to These Terms</h2>
        <p style={S.p}>
          We may update these Terms from time to time. Material changes will be announced
          via the application. Continued use of the Service after changes constitutes
          acceptance of the updated Terms.
        </p>

        {/* ── Contact ── */}
        <h2 style={S.h2}>13. Contact</h2>
        <p style={S.p}>
          Questions about these Terms? Contact us at{' '}
          <a href="mailto:dev@discreetai.net" style={{ color: T.ac }}>dev@discreetai.net</a>.
        </p>

        <div style={S.footer}>
          <p>Copyright &copy; 2024-2026 Discreet contributors. Patent Pending.</p>
          <p style={{ marginTop: 8 }}>
            <a href="/app/privacy" style={{ color: T.ac, marginRight: 16 }}>Privacy Policy</a>
            <a href="/app" style={{ color: T.mt }}>Back to Discreet</a>
          </p>
        </div>
      </div>
    </div>
  );
}
