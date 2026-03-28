/**
 * PublicHeader — Shared header for all pre-auth pages.
 * Renders: logo, nav links, light/dark toggle, language selector, sign-in CTA.
 */
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getLandingTheme, getLandingColors, toggleLandingTheme, type LandingTheme } from '../hooks/useLandingTheme';
import { setLanguage, SUPPORTED_LANGUAGES } from '../i18n/i18n';

const NAV_LINKS = [
  { href: '/app/terms', label: 'Terms' },
  { href: '/app/privacy', label: 'Privacy' },
  { href: '/download', label: 'Download' },
  { href: '/app/support', label: 'Support' },
];

export function PublicHeader({ onSignIn }: { onSignIn?: () => void }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState<LandingTheme>(getLandingTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const C = theme === 'light'
    ? { bg: '#F5F3F0', tx: '#1a1a2e', mt: '#6b7280', ac: '#7C3AED', bd: 'rgba(0,0,0,0.1)', sf: '#EDEAE6' }
    : { bg: '#0a0e17', tx: '#e2e8f0', mt: '#94a3b8', ac: '#7C3AED', bd: 'rgba(226,232,240,0.08)', sf: '#141922' };

  const handleToggle = useCallback(() => {
    const next = toggleLandingTheme();
    setTheme(next);
    // Force re-render of sibling components that call getLandingColors()
    window.dispatchEvent(new Event('landing-theme-change'));
  }, []);

  const handleLang = useCallback(async (code: string) => {
    await setLanguage(code);
  }, []);

  return (
    <header style={{
      position: 'fixed', top: 0, insetInlineStart: 0, insetInlineEnd: 0, zIndex: 1000,
      background: `${C.bg}e6`, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${C.bd}`,
    }}>
      <div style={{
        maxWidth: 1200, margin: '0 auto', padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56,
      }}>
        {/* Logo */}
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.ac} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.tx, letterSpacing: -0.5 }}>Discreet</span>
        </a>

        {/* Desktop nav */}
        <nav style={{ alignItems: 'center', gap: 6 }} className="public-nav-desktop">
          {NAV_LINKS.map(link => (
            <a key={link.href} href={link.href} style={{
              padding: '6px 12px', fontSize: 13, fontWeight: 500, color: C.mt,
              textDecoration: 'none', borderRadius: 6, transition: 'color 0.15s',
            }} onMouseEnter={e => (e.currentTarget.style.color = C.tx)}
               onMouseLeave={e => (e.currentTarget.style.color = C.mt)}>
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Theme toggle */}
          <button
            type="button"
            onClick={handleToggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              color: C.mt, display: 'flex', alignItems: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = C.tx)}
            onMouseLeave={e => (e.currentTarget.style.color = C.mt)}
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
              </svg>
            )}
          </button>

          {/* Language selector */}
          <select
            value={i18n.language || 'en'}
            onChange={e => handleLang(e.target.value)}
            aria-label={t('settings.language')}
            style={{
              padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.bd}`,
              background: C.sf, color: C.mt, fontSize: 11, cursor: 'pointer',
              outline: 'none', fontFamily: 'inherit',
            }}
          >
            {SUPPORTED_LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.label}{l.beta ? ' (Beta)' : ''}</option>
            ))}
          </select>

          {/* Sign in CTA */}
          {onSignIn && (
            <button
              onClick={onSignIn}
              style={{
                padding: '7px 18px', borderRadius: 8, border: 'none',
                background: C.ac, color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Sign In
            </button>
          )}

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
            className="public-nav-hamburger"
            style={{
              background: 'none', border: 'none',
              cursor: 'pointer', padding: 4, color: C.mt,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen
                ? <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>
                : <><path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/></>
              }
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="public-nav-mobile" style={{
          padding: '8px 24px 16px', background: C.bg, borderBottom: `1px solid ${C.bd}`,
        }}>
          {NAV_LINKS.map(link => (
            <a key={link.href} href={link.href} style={{
              display: 'block', padding: '10px 0', fontSize: 14, color: C.mt,
              textDecoration: 'none', borderBottom: `1px solid ${C.bd}`,
            }}>
              {link.label}
            </a>
          ))}
        </div>
      )}

      <style>{`
        .public-nav-desktop { display: flex; }
        .public-nav-hamburger { display: none; }
        .public-nav-mobile { display: none; }
        @media (max-width: 640px) {
          .public-nav-desktop { display: none; }
          .public-nav-hamburger { display: flex; }
        }
      `}</style>
    </header>
  );
}

export default PublicHeader;
