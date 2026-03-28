/**
 * SupportPage — /app/support
 * Crypto donations, sponsorship links, and enterprise contact.
 */
import React, { useState } from 'react';
import { getLandingColors } from '../hooks/useLandingTheme';
import { PublicHeader } from '../components/PublicHeader';

const BTC_ADDRESS = 'bc1qXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const ETH_ADDRESS = '0xXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const XMR_ADDRESS = '4XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

function getColors() {
  const C = getLandingColors();
  return {
    bg: C.bg,
    card: C.sf,
    card2: C.sf2,
    border: C.bd,
    text: C.tx,
    muted: C.mt,
    accent: C.ac,
    accentHover: '#6D28D9',
  };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? COLORS.accent : 'transparent',
        color: copied ? COLORS.bg : COLORS.accent,
        border: `1px solid ${COLORS.accent}`,
        borderRadius: 8,
        padding: '6px 14px',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        transition: 'all 0.2s',
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function CryptoRow({ label, symbol, address }: { label: string; symbol: string; address: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '14px 0',
      borderBottom: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 4 }}>
          {label} <span style={{ color: COLORS.muted }}>({symbol})</span>
        </div>
        <div style={{
          fontSize: 12,
          color: COLORS.muted,
          fontFamily: 'monospace',
          wordBreak: 'break-all',
        }}>
          {address}
        </div>
      </div>
      <CopyButton value={address} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 16,
      padding: '28px 28px 20px',
      marginBottom: 24,
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: COLORS.text, margin: '0 0 16px' }}>{title}</h2>
      {children}
    </div>
  );
}

export default function SupportPage() {
  const COLORS = getColors();
  return (
    <div style={{
      minHeight: '100vh',
      background: COLORS.bg,
      color: COLORS.text,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '48px 16px',
    }}>
      <PublicHeader />
      <div style={{ maxWidth: 560, width: '100%', paddingTop: 56 }}>
        <button
          onClick={() => window.history.back()}
          style={{
            background: 'none',
            border: 'none',
            color: COLORS.accent,
            cursor: 'pointer',
            fontSize: 14,
            marginBottom: 24,
            padding: 0,
          }}
        >
          &larr; Back
        </button>

        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 8px', color: COLORS.text }}>
          Support Discreet
        </h1>
        <p style={{ fontSize: 14, color: COLORS.muted, margin: '0 0 32px', lineHeight: 1.6 }}>
          Discreet is free, open-source, and community-funded. Every contribution helps keep it that way.
        </p>

        {/* Crypto */}
        <Section title="Crypto">
          <CryptoRow label="Bitcoin" symbol="BTC" address={BTC_ADDRESS} />
          <CryptoRow label="Ethereum" symbol="ETH" address={ETH_ADDRESS} />
          <CryptoRow label="Monero" symbol="XMR" address={XMR_ADDRESS} />
        </Section>

        {/* Sponsor */}
        <Section title="Sponsor">
          <p style={{ fontSize: 14, color: COLORS.muted, margin: '0 0 16px', lineHeight: 1.6 }}>
            Recurring support through your preferred platform:
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a
              href="https://github.com/sponsors/discreetai"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background: COLORS.card2,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                color: COLORS.text,
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              GitHub Sponsors
            </a>
            <a
              href="https://ko-fi.com/discreetai"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                background: COLORS.card2,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                color: COLORS.text,
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Ko-fi
            </a>
          </div>
        </Section>

        {/* Enterprise */}
        <Section title="Enterprise">
          <p style={{ fontSize: 14, color: COLORS.muted, margin: 0, lineHeight: 1.6 }}>
            Need a custom deployment, SLA, or integration?{' '}
            <a
              href="mailto:enterprise@discreetai.net"
              style={{ color: COLORS.accent, textDecoration: 'none' }}
            >
              Contact enterprise@discreetai.net
            </a>
          </p>
        </Section>
      </div>
    </div>
  );
}
