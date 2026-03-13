/**
 * Theme system for Discreet.
 * 4 built-in themes: dark (default), light, midnight, onyx.
 */

export interface Theme {
  bg: string;   // Background
  sf: string;   // Surface 1
  sf2: string;  // Surface 2
  sf3: string;  // Surface 3
  bd: string;   // Border
  tx: string;   // Text primary
  mt: string;   // Text muted
  ac: string;   // Accent primary
  ac2: string;  // Accent secondary
  err: string;  // Error/danger
  warn: string; // Warning
}

export const THEMES: Record<string, Theme> = {
  dark:     { bg:"#07090f", sf:"#0b0d15", sf2:"#0f1119", sf3:"#131620", bd:"#181c2a", tx:"#dde0ea", mt:"#5a6080", ac:"#00d4aa", ac2:"#009e7e", err:"#ff4757", warn:"#ffa502" },
  light:    { bg:"#e4e6eb", sf:"#ebedf2", sf2:"#d8dbe4", sf3:"#cdd1dc", bd:"#b8bcc8", tx:"#1a1c26", mt:"#5a5f75", ac:"#00a884", ac2:"#008968", err:"#e53e3e", warn:"#dd6b20" },
  midnight: { bg:"#0a0e1a", sf:"#101630", sf2:"#141a3a", sf3:"#1a2044", bd:"#252d52", tx:"#d0d4ee", mt:"#6068a0", ac:"#6c7bff", ac2:"#4f5cd9", err:"#ff4f6f", warn:"#ffaa33" },
  onyx:     { bg:"#000000", sf:"#0a0a0a", sf2:"#111111", sf3:"#161616", bd:"#1a1a1a", tx:"#e0e0e0", mt:"#666666", ac:"#00d4aa", ac2:"#009e7e", err:"#ff4757", warn:"#ffa502" },
};

/** Get the current theme (reads from localStorage). */
export function getTheme(): Theme {
  const key = localStorage.getItem('d_theme') || 'dark';
  return THEMES[key] || THEMES.dark;
}

/** Mutable theme reference (for components that read T directly). */
export let T = getTheme();

/** Update the active theme. */
export function setTheme(name: string) {
  localStorage.setItem('d_theme', name);
  T = THEMES[name] || THEMES.dark;
}

/** Style helpers */
export const getInp = () => ({
  width: '100%',
  padding: '10px 12px',
  background: T.bg,
  border: `1px solid ${T.bd}`,
  borderRadius: 12,
  color: T.tx,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box' as const,
  fontFamily: "'DM Sans',sans-serif",
  transition: 'border-color .15s ease, box-shadow .15s ease',
});

export const btn = (on: boolean) => ({
  width: '100%',
  padding: '11px',
  background: on ? `linear-gradient(135deg,${T.ac},${T.ac2})` : T.sf2,
  border: 'none',
  borderRadius: 12,
  color: on ? '#000' : T.mt,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: "'DM Sans',sans-serif",
  transition: 'background .15s ease, box-shadow .15s ease',
});
