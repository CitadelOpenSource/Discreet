/**
 * useLandingTheme — Website light/dark preference for public pages.
 *
 * Separate from the 10-theme app system. Public pages (landing, auth, terms,
 * privacy, download, canary) use a simple light/dark toggle stored in
 * localStorage('d_landing_theme'). Falls back to system preference.
 */

export type LandingTheme = 'dark' | 'light';

const STORAGE_KEY = 'd_landing_theme';

export function getLandingTheme(): LandingTheme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  const authPref = localStorage.getItem('discreet-theme-preference');
  if (authPref === 'dawn' || authPref === 'daylight') return 'light';
  if (authPref) return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

/** Persist and apply website theme. Returns the new theme value. */
export function setLandingTheme(theme: LandingTheme): LandingTheme {
  localStorage.setItem(STORAGE_KEY, theme);
  return theme;
}

/** Toggle website theme. Returns the new theme value. */
export function toggleLandingTheme(): LandingTheme {
  const next = getLandingTheme() === 'dark' ? 'light' : 'dark';
  return setLandingTheme(next);
}

export const LIGHT = {
  bg: '#F5F3F0',
  tx: '#1a1a2e',
  mt: '#6b7280',
  ac: '#7C3AED',
  bd: 'rgba(0,0,0,0.1)',
  sf: '#EDEAE6',
  sf2: '#E5E2DE',
  err: '#dc2626',
};

export const DARK = {
  bg: '#0a0e17',
  tx: '#e2e8f0',
  mt: '#94a3b8',
  ac: '#7C3AED',
  bd: 'rgba(226,232,240,0.08)',
  sf: '#141922',
  sf2: '#1e2530',
  err: '#ff4757',
};

export function getLandingColors() {
  return getLandingTheme() === 'light' ? LIGHT : DARK;
}
