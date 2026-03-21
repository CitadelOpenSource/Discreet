/**
 * DownloadPage — Platform download links and verification instructions.
 * Route: /download (accessible without authentication)
 */
import React from 'react';
import { T } from '../theme';

const S = {
  page: { background: T.bg, color: T.tx, minHeight: '100vh', padding: '60px 24px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,sans-serif', lineHeight: 1.7 } as React.CSSProperties,
  wrap: { maxWidth: 900, margin: '0 auto' } as React.CSSProperties,
  back: { display: 'inline-block', marginBottom: 32, color: T.ac, textDecoration: 'none', fontSize: 14, fontWeight: 600 } as React.CSSProperties,
  h1: { fontSize: 32, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 } as React.CSSProperties,
  subtitle: { fontSize: 14, color: T.mt, marginBottom: 40 } as React.CSSProperties,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginBottom: 40 } as React.CSSProperties,
  card: (available: boolean) => ({
    padding: '20px', background: T.sf2, borderRadius: 12, border: `1px solid ${T.bd}`,
    opacity: available ? 1 : 0.55, position: 'relative' as const,
  }),
  icon: { fontSize: 28, marginBottom: 10, display: 'block' } as React.CSSProperties,
  name: { fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 4 } as React.CSSProperties,
  desc: { fontSize: 12, color: T.mt, lineHeight: 1.5, marginBottom: 14 } as React.CSSProperties,
  btn: (primary: boolean) => ({
    display: 'inline-block', padding: '8px 20px', borderRadius: 8, border: 'none',
    background: primary ? T.ac : T.sf2, color: primary ? '#000' : T.mt,
    fontSize: 13, fontWeight: 700, cursor: primary ? 'pointer' : 'default',
    textDecoration: 'none',
  }),
  badge: { position: 'absolute' as const, top: 12, right: 12, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(250,166,26,0.15)', color: '#faa61a', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  hash: { fontSize: 10, fontFamily: 'monospace', color: T.mt, marginTop: 8, wordBreak: 'break-all' as const } as React.CSSProperties,
  section: { marginBottom: 32 } as React.CSSProperties,
  h2: { fontSize: 20, fontWeight: 700, color: T.ac, marginBottom: 12 } as React.CSSProperties,
  code: { display: 'block', padding: '12px 14px', background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: T.ac, overflowX: 'auto' as const, marginBottom: 8 } as React.CSSProperties,
  footer: { marginTop: 48, paddingTop: 24, borderTop: `1px solid ${T.bd}`, fontSize: 12, color: T.mt } as React.CSSProperties,
};

const PLATFORMS = [
  {
    id: 'web',
    icon: '🌐',
    name: 'Web Browser',
    desc: 'Use Discreet directly in your browser. No installation required. Works on any modern browser with WebCrypto support.',
    available: true,
    action: { label: 'Use in Browser', href: '/app' },
  },
  {
    id: 'windows',
    icon: '🪟',
    name: 'Windows',
    desc: 'Native desktop app built with Tauri. Runs natively with minimal resource usage. Requires Windows 10 or later.',
    available: true,
    action: { label: 'Download .msi', href: 'https://github.com/CitadelOpenSource/Discreet/releases/latest/download/Discreet-Setup.msi' },
    hash: 'SHA-256 hash published on the GitHub release page',
    virusTotal: 'https://www.virustotal.com/',
  },
  {
    id: 'macos',
    icon: '🍎',
    name: 'macOS',
    desc: 'Universal binary for Intel and Apple Silicon Macs. Runs natively on macOS 12 Monterey and later.',
    available: false,
    action: { label: 'Download .dmg', href: '#' },
  },
  {
    id: 'linux',
    icon: '🐧',
    name: 'Linux',
    desc: 'AppImage that runs on most Linux distributions. No installation required — download, make executable, and run.',
    available: false,
    action: { label: 'Download .AppImage', href: '#' },
  },
  {
    id: 'android',
    icon: '🤖',
    name: 'Android',
    desc: 'APK available for sideloading. Built with React Native. Google Play listing coming soon.',
    available: false,
    action: { label: 'Download .apk', href: '#' },
    note: 'APK available for sideloading. Google Play coming soon.',
  },
  {
    id: 'ios',
    icon: '📱',
    name: 'iOS',
    desc: 'Built with React Native and native Swift modules. TestFlight beta program opening soon.',
    available: false,
    action: { label: 'Join TestFlight', href: '#' },
  },
] as const;

export function DownloadPage() {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <a href="/app" style={S.back}>&larr; Back to Discreet</a>

        <h1 style={S.h1}>Download Discreet</h1>
        <div style={S.subtitle}>Available for every platform. Your messages stay encrypted everywhere.</div>

        {/* Platform cards */}
        <div style={S.grid}>
          {PLATFORMS.map(p => (
            <div key={p.id} style={S.card(p.available)}>
              {!p.available && <span style={S.badge}>Coming Soon</span>}
              <span style={S.icon}>{p.icon}</span>
              <div style={S.name}>{p.name}</div>
              <div style={S.desc}>{p.desc}</div>
              {p.available ? (
                <a href={p.action.href} style={S.btn(true)}>{p.action.label}</a>
              ) : (
                <span style={S.btn(false)}>{p.action.label}</span>
              )}
              {'hash' in p && p.hash && (
                <div style={S.hash}>{p.hash}</div>
              )}
              {'virusTotal' in p && p.virusTotal && (
                <div style={{ marginTop: 4 }}>
                  <a href={p.virusTotal} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: T.ac }}>View on VirusTotal</a>
                </div>
              )}
              {'note' in p && p.note && (
                <div style={{ fontSize: 10, color: '#faa61a', marginTop: 8 }}>{p.note}</div>
              )}
            </div>
          ))}
        </div>

        {/* Verify Your Download */}
        <div style={S.section}>
          <h2 style={S.h2}>Verify Your Download</h2>
          <p style={{ fontSize: 13, color: T.mt, lineHeight: 1.6, marginBottom: 16 }}>
            After downloading, verify the file integrity by comparing its SHA-256 hash against the one published on the{' '}
            <a href="https://github.com/CitadelOpenSource/Discreet/releases" style={{ color: T.ac }}>GitHub release page</a>.
          </p>

          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Windows (PowerShell)</div>
          <code style={S.code}>Get-FileHash .\Discreet-Setup.msi -Algorithm SHA256 | Format-List</code>

          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 }}>macOS / Linux</div>
          <code style={S.code}>shasum -a 256 Discreet.dmg</code>

          <p style={{ fontSize: 12, color: T.mt, marginTop: 12, lineHeight: 1.6 }}>
            If the hash matches, the file has not been tampered with. If it does not match, do not run the file — download it again from the official release page.
          </p>
        </div>

        {/* Report an Issue */}
        <div style={S.section}>
          <h2 style={S.h2}>Found a Problem?</h2>
          <p style={{ fontSize: 13, color: T.mt, lineHeight: 1.6 }}>
            If you encounter issues with installation or the application, use the bug report button (bottom-left corner in the app) or{' '}
            <a href="https://github.com/CitadelOpenSource/Discreet/issues" style={{ color: T.ac }}>open an issue on GitHub</a>.
          </p>
        </div>

        <div style={S.footer}>
          <p>Copyright &copy; 2024-2026 Discreet contributors. AGPL-3.0-or-later.</p>
          <p style={{ marginTop: 8 }}>
            <a href="/app/terms" style={{ color: T.ac, marginRight: 16 }}>Terms of Service</a>
            <a href="/app/privacy" style={{ color: T.ac, marginRight: 16 }}>Privacy Policy</a>
            <a href="/app" style={{ color: T.mt }}>Back to Discreet</a>
          </p>
        </div>
      </div>
    </div>
  );
}
