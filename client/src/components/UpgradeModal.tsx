/**
 * UpgradeModal — Shown when a guest user attempts a restricted feature.
 * Two-column comparison (Guest vs Free Account) + Premium teaser.
 */
import React from 'react';
import { T } from '../theme';
import { TIER_META } from '../utils/tiers';

interface UpgradeModalProps {
  feature: string;           // e.g. "create servers", "upload files"
  onCreateAccount: () => void;
  onViewTiers: () => void;
  onClose: () => void;
}

const CHECK = '\u2713';
const CROSS = '\u2717';

const features: { label: string; guest: string; free: string; premium: string }[] = [
  { label: 'Messaging',            guest: '500 chars',         free: '4,000 chars',   premium: '8,000 chars' },
  { label: 'Voice & Video',        guest: CROSS,               free: CHECK,            premium: CHECK },
  { label: 'Create Servers',       guest: CROSS,               free: 'Up to 10',       premium: 'Up to 50' },
  { label: 'AI Bots',              guest: CROSS,               free: '5 per server',   premium: '20 per server' },
  { label: 'File Uploads',         guest: CROSS,               free: '8 MB',           premium: '50 MB' },
  { label: 'Custom Avatar',        guest: CROSS,               free: CHECK,            premium: CHECK },
  { label: '2FA',                  guest: CROSS,               free: CHECK,            premium: CHECK },
  { label: 'Screen Share',         guest: CROSS,               free: CHECK,            premium: CHECK },
  { label: 'Message Retention',    guest: '7 days',            free: 'Unlimited',      premium: 'Unlimited' },
];

export function UpgradeModal({ feature, onCreateAccount, onViewTiers, onClose }: UpgradeModalProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto',
        background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, padding: 0,
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 24px 16px',
          background: `linear-gradient(135deg, ${T.ac}15, ${T.sf})`,
          borderBottom: `1px solid ${T.bd}`,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.tx, marginBottom: 6 }}>
            Unlock More with a Free Account
          </div>
          <div style={{ fontSize: 13, color: T.mt, lineHeight: 1.5 }}>
            You need an account to <strong style={{ color: T.tx }}>{feature}</strong>.
            Create one in seconds — no credit card required.
          </div>
        </div>

        {/* Comparison columns */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* Guest column */}
            <div style={{
              background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}`, padding: 16,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.mt, marginBottom: 4 }}>
                {TIER_META.guest.icon} Guest
              </div>
              <div style={{ fontSize: 11, color: T.mt, marginBottom: 14, fontStyle: 'italic' }}>
                Current plan
              </div>
              {features.map(f => (
                <div key={f.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 12, padding: '5px 0', borderBottom: `1px solid ${T.bd}22`,
                }}>
                  <span style={{ color: T.mt }}>{f.label}</span>
                  <span style={{
                    color: f.guest === CROSS ? 'rgba(255,71,87,0.5)' : T.mt,
                    fontWeight: f.guest === CROSS ? 700 : 400,
                    fontSize: f.guest === CROSS ? 14 : 11,
                    fontFamily: f.guest !== CHECK && f.guest !== CROSS ? 'monospace' : undefined,
                  }}>{f.guest}</span>
                </div>
              ))}
            </div>

            {/* Free Account column */}
            <div style={{
              background: T.bg, borderRadius: 10,
              border: `2px solid ${T.ac}44`, padding: 16,
              position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: -10, right: 12,
                background: T.ac, color: '#000', fontSize: 10, fontWeight: 700,
                padding: '2px 10px', borderRadius: 10,
              }}>RECOMMENDED</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ac, marginBottom: 4 }}>
                {TIER_META.verified.icon} Free Account
              </div>
              <div style={{ fontSize: 11, color: T.mt, marginBottom: 14 }}>
                Free forever
              </div>
              {features.map(f => (
                <div key={f.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 12, padding: '5px 0', borderBottom: `1px solid ${T.bd}22`,
                }}>
                  <span style={{ color: T.tx }}>{f.label}</span>
                  <span style={{
                    color: f.free === CHECK ? T.ac : f.free === CROSS ? 'rgba(255,71,87,0.5)' : T.ac,
                    fontWeight: 700,
                    fontSize: f.free === CHECK || f.free === CROSS ? 14 : 11,
                    fontFamily: f.free !== CHECK && f.free !== CROSS ? 'monospace' : undefined,
                  }}>{f.free}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Create Account CTA */}
          <button onClick={onCreateAccount} style={{
            width: '100%', padding: '12px 20px',
            background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
            border: 'none', borderRadius: 10, color: '#000',
            fontSize: 15, fontWeight: 700, cursor: 'pointer',
            marginBottom: 16,
          }}>
            Create Free Account
          </button>

          {/* Premium teaser */}
          <div style={{
            background: `linear-gradient(135deg, #6366f115, #6366f108)`,
            border: '1px solid #6366f133',
            borderRadius: 10, padding: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>{TIER_META.pro.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#6366f1' }}>Premium</span>
              <span style={{ fontSize: 11, color: T.mt, fontStyle: 'italic' }}>Price TBD</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {['AI-powered bots (20 per server)', 'Priority support', '50 MB file uploads', '8,000-char messages'].map(p => (
                <div key={p} style={{ fontSize: 12, color: T.mt, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#6366f1' }}>{CHECK}</span> {p}
                </div>
              ))}
            </div>
            <button onClick={onViewTiers} style={{
              marginTop: 12, padding: '6px 14px',
              background: '#6366f118', border: '1px solid #6366f144',
              borderRadius: 7, color: '#6366f1', fontSize: 12,
              fontWeight: 700, cursor: 'pointer',
            }}>
              Compare All Plans
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px', borderTop: `1px solid ${T.bd}`,
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} style={{
            padding: '8px 18px', background: T.sf2, color: T.mt,
            border: `1px solid ${T.bd}`, borderRadius: 7, fontSize: 12,
            cursor: 'pointer',
          }}>
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}
