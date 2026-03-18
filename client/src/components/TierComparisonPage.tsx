/**
 * TierComparisonPage — Full-page tier comparison matrix at /app/tiers.
 * Styled like X/Twitter premium page with feature matrix grid.
 */
import React from 'react';
import { T, ta } from '../theme';
import { TIER_META, TIER_LIMITS, type Tier } from '../utils/tiers';

const CHECK = '\u2713';
const CROSS = '\u2717';

const tiers: Tier[] = ['guest', 'unverified', 'verified', 'pro', 'teams', 'enterprise'];
const displayTiers: { tier: Tier; label: string; price: string; highlight?: boolean }[] = [
  { tier: 'guest',      label: 'Guest',      price: 'No account' },
  { tier: 'verified',   label: 'Free',       price: 'Free forever', highlight: true },
  { tier: 'pro',        label: 'Pro',        price: '$5/mo' },
  { tier: 'teams',      label: 'Teams',      price: '$12/mo' },
  { tier: 'enterprise', label: 'Enterprise', price: 'Contact us' },
];

interface FeatureRow {
  label: string;
  values: Record<Tier, string>;
}

const fmtSize = (bytes: number) => {
  if (bytes === 0) return CROSS;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
};

const fmtNum = (n: number) => n === Infinity ? 'Unlimited' : n === 0 ? CROSS : String(n);
const fmtBool = (b: boolean) => b ? CHECK : CROSS;

const featureRows: FeatureRow[] = [
  {
    label: 'Messaging',
    values: Object.fromEntries(tiers.map(t => [t, `${TIER_LIMITS[t].maxMessageLength.toLocaleString()} chars`])) as Record<Tier, string>,
  },
  {
    label: 'Voice & Video',
    values: Object.fromEntries(tiers.map(t => [t, fmtBool(TIER_LIMITS[t].canVoice)])) as Record<Tier, string>,
  },
  {
    label: 'Create Servers',
    values: Object.fromEntries(tiers.map(t => [t, fmtNum(TIER_LIMITS[t].maxServers)])) as Record<Tier, string>,
  },
  {
    label: 'AI Bots',
    values: Object.fromEntries(tiers.map(t => [t, TIER_LIMITS[t].maxBots === 0 ? CROSS : `${fmtNum(TIER_LIMITS[t].maxBots)}/server`])) as Record<Tier, string>,
  },
  {
    label: 'File Upload Size',
    values: Object.fromEntries(tiers.map(t => [t, fmtSize(TIER_LIMITS[t].maxFileSize)])) as Record<Tier, string>,
  },
  {
    label: 'Custom Avatar',
    values: Object.fromEntries(tiers.map(t => [t, fmtBool(TIER_LIMITS[t].customStatus)])) as Record<Tier, string>,
  },
  {
    label: '2FA',
    values: { guest: CROSS, unverified: CROSS, verified: CHECK, pro: CHECK, teams: CHECK, enterprise: CHECK },
  },
  {
    label: 'Proximity Chat',
    values: { guest: CROSS, unverified: CHECK, verified: CHECK, pro: CHECK, teams: CHECK, enterprise: CHECK },
  },
  {
    label: 'Screen Share',
    values: Object.fromEntries(tiers.map(t => [t, fmtBool(TIER_LIMITS[t].canVoice)])) as Record<Tier, string>,
  },
  {
    label: 'Message Retention',
    values: Object.fromEntries(tiers.map(t => [t, TIER_LIMITS[t].threadHistory === 0 ? 'Unlimited' : `${TIER_LIMITS[t].threadHistory} days`])) as Record<Tier, string>,
  },
  {
    label: 'Storage',
    values: Object.fromEntries(tiers.map(t => [t, TIER_LIMITS[t].maxStorageMB === Infinity ? 'Unlimited' : TIER_LIMITS[t].maxStorageMB === 0 ? CROSS : `${TIER_LIMITS[t].maxStorageMB} MB`])) as Record<Tier, string>,
  },
  {
    label: 'DMs per Day',
    values: Object.fromEntries(tiers.map(t => [t, fmtNum(TIER_LIMITS[t].maxDmsPerDay)])) as Record<Tier, string>,
  },
  {
    label: 'Custom Status',
    values: Object.fromEntries(tiers.map(t => [t, fmtBool(TIER_LIMITS[t].customStatus)])) as Record<Tier, string>,
  },
];

interface TierComparisonPageProps {
  onBack: () => void;
  onCreateAccount?: () => void;
  isGuest?: boolean;
}

export function TierComparisonPage({ onBack, onCreateAccount, isGuest }: TierComparisonPageProps) {
  return (
    <div style={{
      minHeight: '100vh', background: T.bg, color: T.tx,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Hero */}
      <div style={{
        textAlign: 'center', padding: '48px 24px 32px',
        background: `linear-gradient(180deg, ${T.sf} 0%, ${T.bg} 100%)`,
      }}>
        <button onClick={onBack} style={{
          position: 'absolute', top: 16, left: 16,
          background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 8,
          color: T.mt, fontSize: 13, padding: '8px 16px', cursor: 'pointer',
        }}>
          &larr; Back
        </button>
        <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>
          Choose your plan
        </div>
        <div style={{ fontSize: 15, color: T.mt, maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
          Discreet is free to use. Upgrade for more power, larger uploads, and AI-powered features.
        </div>
      </div>

      {/* Tier cards */}
      <div style={{
        display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap',
        padding: '0 24px 32px', maxWidth: 900, margin: '0 auto',
      }}>
        {displayTiers.map(({ tier, label, price, highlight }) => {
          const meta = TIER_META[tier];
          return (
            <div key={tier} style={{
              width: 155, padding: 20, borderRadius: 12, textAlign: 'center',
              background: highlight ? `linear-gradient(135deg, ${ta(T.ac,'12')}, ${T.sf})` : T.sf,
              border: highlight ? `2px solid ${ta(T.ac,'55')}` : `1px solid ${T.bd}`,
              position: 'relative',
            }}>
              {highlight && (
                <div style={{
                  position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                  background: T.ac, color: '#000', fontSize: 10, fontWeight: 700,
                  padding: '2px 12px', borderRadius: 10, whiteSpace: 'nowrap',
                }}>MOST POPULAR</div>
              )}
              <div style={{ fontSize: 24, marginBottom: 6 }}>{meta.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: highlight ? T.ac : T.tx, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: T.mt, marginBottom: 10 }}>{price}</div>
              <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.5 }}>{meta.tagline}</div>
            </div>
          );
        })}
      </div>

      {/* Feature comparison matrix */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 48px' }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, textAlign: 'center' }}>
          Feature Comparison
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse', fontSize: 13,
          }}>
            <thead>
              <tr>
                <th style={{
                  textAlign: 'left', padding: '12px 16px', borderBottom: `2px solid ${T.bd}`,
                  color: T.mt, fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
                  position: 'sticky', left: 0, background: T.bg, zIndex: 1,
                }}>Feature</th>
                {displayTiers.map(({ tier, label, highlight }) => (
                  <th key={tier} style={{
                    textAlign: 'center', padding: '12px 10px',
                    borderBottom: `2px solid ${highlight ? ta(T.ac,'44') : T.bd}`,
                    color: highlight ? T.ac : T.tx, fontWeight: 700, fontSize: 12,
                    minWidth: 100,
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureRows.map((row, i) => (
                <tr key={row.label} style={{
                  background: i % 2 === 0 ? 'transparent' : `${ta(T.sf,'66')}`,
                }}>
                  <td style={{
                    padding: '10px 16px', borderBottom: `1px solid ${ta(T.bd,'22')}`,
                    color: T.tx, fontWeight: 600, fontSize: 12,
                    position: 'sticky', left: 0, background: i % 2 === 0 ? T.bg : T.sf,
                    zIndex: 1,
                  }}>{row.label}</td>
                  {displayTiers.map(({ tier, highlight }) => {
                    const val = row.values[tier];
                    const isCheck = val === CHECK;
                    const isCross = val === CROSS;
                    return (
                      <td key={tier} style={{
                        textAlign: 'center', padding: '10px 8px',
                        borderBottom: `1px solid ${ta(T.bd,'22')}`,
                        color: isCheck ? T.ac : isCross ? 'rgba(255,71,87,0.4)' : (highlight ? T.ac : T.mt),
                        fontWeight: isCheck || isCross ? 700 : 400,
                        fontSize: isCheck || isCross ? 16 : 12,
                        fontFamily: !isCheck && !isCross ? 'monospace' : undefined,
                      }}>{val}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* CTA */}
        {isGuest && onCreateAccount && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button onClick={onCreateAccount} style={{
              padding: '14px 40px',
              background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
              border: 'none', borderRadius: 10, color: '#000',
              fontSize: 16, fontWeight: 700, cursor: 'pointer',
            }}>
              Create Free Account
            </button>
            <div style={{ fontSize: 12, color: T.mt, marginTop: 8 }}>
              No credit card required
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
