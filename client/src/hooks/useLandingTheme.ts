/**
 * useLandingTheme — Reads the landing page theme preference and returns
 * CSS overrides for public-facing pages (Terms, Privacy, Canary, Download).
 *
 * Reads localStorage key 'd_landing_theme'. Falls back to system preference
 * via prefers-color-scheme, then dark.
 */

export type LandingTheme = 'dark' | 'light';

export function getLandingTheme(): LandingTheme {
  // Check the landing-specific key first, then the auth page preference, then system preference.
  const landing = localStorage.getItem('d_landing_theme');
  if (landing === 'light' || landing === 'dark') return landing;
  const authPref = localStorage.getItem('discreet-theme-preference');
  if (authPref === 'dawn' || authPref === 'daylight') return 'light';
  if (authPref) return 'dark'; // any other theme value = dark
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export const LIGHT = {
  bg: '#ffffff',
  tx: '#1a1a2e',
  mt: '#6b7280',
  ac: '#00A88A',
  bd: 'rgba(0,0,0,0.1)',
  sf: '#f5f5f5',
  sf2: '#f0f0f0',
};

export const DARK = {
  bg: '#0a0e17',
  tx: '#e2e8f0',
  mt: '#94a3b8',
  ac: '#00D4AA',
  bd: 'rgba(226,232,240,0.08)',
  sf: '#141922',
  sf2: '#1e2530',
};

/** Get the color palette for the current landing theme. */
export function getLandingColors() {
  return getLandingTheme() === 'light' ? LIGHT : DARK;
}
