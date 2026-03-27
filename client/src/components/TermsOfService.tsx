/**
 * TermsOfService — Full-page terms of service for Discreet.
 */
import React from 'react';
import { T } from '../theme';

const S: Record<string, React.CSSProperties> = {
  page: { background: T.bg, color: T.tx, minHeight: '100vh', padding: '60px 24px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,sans-serif', lineHeight: 1.7 },
  wrap: { maxWidth: 720, margin: '0 auto' },
  h1: { fontSize: 32, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 },
  updated: { fontSize: 13, color: T.mt, marginBottom: 40 },
  h2: { fontSize: 20, fontWeight: 700, marginTop: 36, marginBottom: 12, color: T.ac },
  p: { fontSize: 14, color: T.mt, marginBottom: 12 },
  ul: { fontSize: 14, color: T.mt, marginBottom: 12, paddingInlineStart: 24 },
  li: { marginBottom: 6 },
  back: { display: 'inline-block', marginBottom: 32, color: T.ac, textDecoration: 'none', fontSize: 14, fontWeight: 600 },
  footer: { marginTop: 48, paddingTop: 24, borderTop: `1px solid ${T.bd}`, fontSize: 12, color: T.mt },
};

export function TermsOfService() {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <a href="/app" style={S.back}>&larr; Back to Discreet</a>

        <h1 style={S.h1}>Terms of Service</h1>
        <div style={S.updated}>Last updated: March 13, 2026</div>

        <p style={S.p}>
          These terms govern your use of Discreet ("the Service"), an end-to-end encrypted communication platform.
          By creating an account or using the Service, you agree to these terms.
        </p>

        <h2 style={S.h2}>1. Eligibility</h2>
        <p style={S.p}>
          You must be at least 13 years old to use Discreet. If you are under 18, you represent that you have
          parental or guardian consent. By using the Service, you represent that you meet these requirements.
        </p>

        <h2 style={S.h2}>2. Your Account</h2>
        <ul style={S.ul}>
          <li style={S.li}>You are responsible for maintaining the security of your account credentials and recovery keys.</li>
          <li style={S.li}>You must not share your account or allow others to access it.</li>
          <li style={S.li}>You are responsible for all activity under your account.</li>
          <li style={S.li}>If you suspect unauthorized access, change your password immediately and contact us.</li>
        </ul>

        <h2 style={S.h2}>3. Acceptable Use</h2>
        <p style={S.p}>You agree not to use Discreet to:</p>
        <ul style={S.ul}>
          <li style={S.li}>Violate any applicable law or regulation</li>
          <li style={S.li}>Distribute malware, spam, or phishing content</li>
          <li style={S.li}>Harass, threaten, or abuse other users</li>
          <li style={S.li}>Distribute child sexual abuse material (CSAM)</li>
          <li style={S.li}>Impersonate another person or entity</li>
          <li style={S.li}>Attempt to circumvent rate limits, bans, or security measures</li>
          <li style={S.li}>Reverse-engineer the encryption to intercept other users' communications</li>
          <li style={S.li}>Use automated systems to scrape data or create accounts in bulk</li>
        </ul>
        <p style={S.p}>
          Server owners and moderators are responsible for setting and enforcing rules within their communities.
          Discreet provides moderation tools (AutoMod, bans, role permissions) but does not moderate individual servers.
        </p>

        <h2 style={S.h2}>4. End-to-End Encryption</h2>
        <p style={S.p}>
          Discreet uses end-to-end encryption for messages, files, and voice/video. This means:
        </p>
        <ul style={S.ul}>
          <li style={S.li}>We cannot read, moderate, or recover the content of your encrypted communications.</li>
          <li style={S.li}>If you lose your encryption keys and recovery key, your encrypted data is permanently inaccessible. We cannot recover it for you.</li>
          <li style={S.li}>You are solely responsible for backing up your recovery key.</li>
        </ul>

        <h2 style={S.h2}>5. AI Agents</h2>
        <p style={S.p}>
          Discreet supports AI agents that participate as encrypted group members. When you interact with an AI agent:
        </p>
        <ul style={S.ul}>
          <li style={S.li}>The agent decrypts messages using its own MLS leaf key — the server does not decrypt on its behalf.</li>
          <li style={S.li}>Conversations may be processed by third-party LLM providers (Anthropic, OpenAI) or locally via Ollama, depending on the agent configuration set by the server admin.</li>
          <li style={S.li}>Server admins choose which AI providers to enable. Check with your server admin for details.</li>
        </ul>

        <h2 style={S.h2}>6. Content and Intellectual Property</h2>
        <ul style={S.ul}>
          <li style={S.li}>You retain ownership of all content you create and share.</li>
          <li style={S.li}>By posting content, you grant Discreet a limited license to store and relay the encrypted ciphertext as necessary to operate the Service.</li>
          <li style={S.li}>Discreet and its logo are trademarks. The software is licensed under AGPL-3.0-or-later.</li>
        </ul>

        <h2 style={S.h2}>7. Self-Hosted Instances</h2>
        <p style={S.p}>
          Discreet is open source and self-hostable. If you use a third-party instance:
        </p>
        <ul style={S.ul}>
          <li style={S.li}>The instance operator is responsible for their own terms, privacy policy, and legal compliance.</li>
          <li style={S.li}>These terms apply only to the official Discreet service at discreetai.net.</li>
          <li style={S.li}>The encryption guarantees are provided by the client software regardless of who operates the server.</li>
        </ul>

        <h2 style={S.h2}>8. Account Termination</h2>
        <ul style={S.ul}>
          <li style={S.li}>You may delete your account at any time from Settings. Deletion is permanent and irreversible.</li>
          <li style={S.li}>We may suspend or terminate accounts that violate these terms, with notice where possible.</li>
          <li style={S.li}>Upon termination, your profile and metadata are deleted. Encrypted messages you sent remain as ciphertext in channels (other members' copies).</li>
        </ul>

        <h2 style={S.h2}>9. Disclaimers</h2>
        <p style={S.p}>
          The Service is provided "as is" without warranties of any kind, express or implied. We do not warrant
          that the Service will be uninterrupted, error-free, or free of vulnerabilities. Cryptographic software
          is complex — while we use published standards (MLS, SFrame, ML-KEM), no system is provably immune to
          all future attacks.
        </p>

        <h2 style={S.h2}>10. Limitation of Liability</h2>
        <p style={S.p}>
          To the maximum extent permitted by law, Discreet and its contributors shall not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or any loss of data, profits,
          or revenue, arising from your use of the Service.
        </p>

        <h2 style={S.h2}>11. Changes to These Terms</h2>
        <p style={S.p}>
          We may update these terms from time to time. We will notify users of material changes via an in-app
          banner and update the "Last updated" date. Continued use after changes constitutes acceptance.
        </p>

        <h2 style={S.h2}>12. Governing Law</h2>
        <p style={S.p}>
          These terms are governed by the laws of the United States. Any disputes shall be resolved in the
          courts of the jurisdiction where the operator is located.
        </p>

        <h2 style={S.h2}>13. Contact</h2>
        <p style={S.p}>
          For questions about these terms:<br />
          <strong style={{ color: T.tx }}>security@discreetai.net</strong>
        </p>

        <div style={S.footer}>
          &copy; 2026 Discreet &middot; AGPL-3.0-or-later &middot; <a href="/app/privacy" style={{ color: T.ac }}>Privacy Policy</a> &middot; <a href="/app" style={{ color: T.ac }}>Back to app</a>
        </div>
      </div>
    </div>
  );
}

export default TermsOfService;
