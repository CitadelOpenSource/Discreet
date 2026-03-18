/**
 * Theme system for Discreet.
 *
 * 4 built-in presets: Midnight (default dark), Dawn (light), Terminal
 * (hacker green-on-black), Obsidian (OLED true black).
 *
 * CSS custom properties are set on :root so all components can reference
 * them via var(). The T object returns var() strings so existing inline
 * styles automatically use CSS variables with zero component changes.
 *
 * For transparency/alpha, use ta(T.ac, '22') which produces a
 * color-mix() expression that works with CSS variables.
 */

// ─── Raw theme definitions ──────────────────────────────────────────────

export interface ThemeRaw {
  bg: string;   // Background
  sf: string;   // Surface 1 / Sidebar
  sf2: string;  // Surface 2 / Card / Input
  sf3: string;  // Surface 3
  bd: string;   // Border
  tx: string;   // Text primary
  mt: string;   // Text muted
  ac: string;   // Accent primary
  ac2: string;  // Accent secondary
  err: string;  // Error/danger
  warn: string; // Warning
  ok: string;   // Success
}

// ─── Theme presets ──────────────────────────────────────────────────────

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ThemeRaw;
  font?: string;             // CSS font-family override
  borderRadius?: number;     // px (undefined = 12 default)
  hideAvatars?: boolean;     // Terminal mode
  bracketTimestamps?: boolean; // [HH:MM] format
}

export const PRESETS: ThemePreset[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep dark theme with teal accents',
    colors: { bg:"#0a0e17", sf:"#0b0d15", sf2:"#0f1119", sf3:"#131620", bd:"#181c2a", tx:"#dde0ea", mt:"#5a6080", ac:"#00d4aa", ac2:"#009e7e", err:"#ff4757", warn:"#ffa502", ok:"#10b981" },
  },
  {
    id: 'dawn',
    name: 'Dawn',
    description: 'Clean light mode with blue accents',
    colors: { bg:"#f5f6fa", sf:"#ebedf2", sf2:"#ffffff", sf3:"#e2e5ec", bd:"#d0d4dc", tx:"#1a1c26", mt:"#5a5f75", ac:"#3b82f6", ac2:"#2563eb", err:"#dc2626", warn:"#d97706", ok:"#16a34a" },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Green on black \u2014 monospace, no avatars',
    colors: { bg:"#000000", sf:"#0a0a0a", sf2:"#0f0f0f", sf3:"#141414", bd:"#1a1a1a", tx:"#00ff00", mt:"#338833", ac:"#00ff00", ac2:"#00cc00", err:"#ff3333", warn:"#ffaa00", ok:"#00ff00" },
    font: "'JetBrains Mono','Fira Code','Courier New',monospace",
    borderRadius: 0,
    hideAvatars: true,
    bracketTimestamps: true,
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'True black for OLED displays',
    colors: { bg:"#000000", sf:"#080808", sf2:"#101010", sf3:"#181818", bd:"#222222", tx:"#e0e0e0", mt:"#666666", ac:"#00d4aa", ac2:"#009e7e", err:"#ff4757", warn:"#ffa502", ok:"#10b981" },
  },
];

// Build THEMES record from presets (indexed by id).
// Includes aliases for backward compatibility with old theme names.
export const THEMES: Record<string, ThemeRaw> = (() => {
  const map: Record<string, ThemeRaw> = {};
  for (const p of PRESETS) map[p.id] = p.colors;
  // Aliases: old names → new presets
  map.dark = map.midnight;
  map.light = map.dawn;
  map.onyx = map.obsidian;
  return map;
})();

/** Look up a preset by id (with alias resolution). */
export function getPreset(id: string): ThemePreset {
  // Custom theme
  if (id === 'custom') {
    const custom = loadCustomTheme();
    if (custom) return { id: 'custom', name: 'Custom', description: 'Your custom theme', colors: custom };
  }
  // Resolve aliases
  const resolved = id === 'dark' ? 'midnight' : id === 'light' ? 'dawn' : id === 'onyx' ? 'obsidian' : id;
  return PRESETS.find(p => p.id === resolved) || PRESETS[0];
}

/** Runtime flags derived from the active theme preset. */
export let themeFlags = { hideAvatars: false, bracketTimestamps: false, font: '' };

// ─── CSS variable names ─────────────────────────────────────────────────

const VAR_MAP: Record<keyof ThemeRaw, string> = {
  bg:   '--bg-primary',
  sf:   '--bg-secondary',
  sf2:  '--bg-card',
  sf3:  '--bg-tertiary',
  bd:   '--border-color',
  tx:   '--text-primary',
  mt:   '--text-muted',
  ac:   '--accent',
  ac2:  '--accent-secondary',
  err:  '--danger',
  warn: '--warning',
  ok:   '--success',
};

// Additional semantic aliases set on :root
const ALIASES: Record<string, keyof ThemeRaw> = {
  '--sidebar-bg': 'sf',
  '--input-bg':   'sf2',
};

// ─── Theme interface (returns var() strings) ────────────────────────────

export interface Theme {
  bg: string;
  sf: string;
  sf2: string;
  sf3: string;
  bd: string;
  tx: string;
  mt: string;
  ac: string;
  ac2: string;
  err: string;
  warn: string;
  ok: string;
}

function buildVarTheme(): Theme {
  const t: any = {};
  for (const [key, varName] of Object.entries(VAR_MAP)) {
    t[key] = `var(${varName})`;
  }
  return t as Theme;
}

// ─── Apply CSS variables to :root ───────────────────────────────────────

function applyVarsToRoot(raw: ThemeRaw, preset: ThemePreset) {
  const root = document.documentElement;
  for (const [key, varName] of Object.entries(VAR_MAP)) {
    root.style.setProperty(varName, raw[key as keyof ThemeRaw]);
  }
  // Semantic aliases
  for (const [varName, themeKey] of Object.entries(ALIASES)) {
    root.style.setProperty(varName, raw[themeKey]);
  }
  // Font and layout overrides
  root.style.setProperty('--font-family', preset.font || "'DM Sans',sans-serif");
  root.style.setProperty('--border-radius', `${preset.borderRadius ?? 12}px`);
  // Update runtime flags
  themeFlags = {
    hideAvatars: !!preset.hideAvatars,
    bracketTimestamps: !!preset.bracketTimestamps,
    font: preset.font || '',
  };
}

// ─── Initialise on load (before first render) ───────────────────────────

const initialThemeName = localStorage.getItem('d_theme') || 'midnight';
const initialPreset = getPreset(initialThemeName);
applyVarsToRoot(initialPreset.colors, initialPreset);

/** T — theme object returning var() CSS strings. Use in inline styles. */
export const T: Theme = buildVarTheme();

/** Raw hex values for the current theme (for JS color computation). */
export let Traw: ThemeRaw = { ...initialPreset.colors };

// ─── Theme lifecycle ────────────────────────────────────────────────────

/** Get the current theme name (resolved from aliases). */
export function getThemeName(): string {
  return getPreset(localStorage.getItem('d_theme') || 'midnight').id;
}

/** Get raw hex theme object. */
export function getTheme(): ThemeRaw {
  return getPreset(localStorage.getItem('d_theme') || 'midnight').colors;
}

/** Switch to a named theme. Updates CSS vars, localStorage, and syncs to server. */
export function setTheme(name: string) {
  const preset = getPreset(name);
  localStorage.setItem('d_theme', preset.id);
  Traw = { ...preset.colors };
  applyVarsToRoot(preset.colors, preset);
  syncThemeToServer(preset.id);
}

/** Apply a theme name received from the server (no re-sync back). */
export function applyServerTheme(name: string) {
  const preset = getPreset(name);
  localStorage.setItem('d_theme', preset.id);
  Traw = { ...preset.colors };
  applyVarsToRoot(preset.colors, preset);
}

// ─── Server sync ────────────────────────────────────────────────────────

let _syncApi: { updateSettings: (s: any) => Promise<any> } | null = null;

/** Register the API client for theme sync. Called once from App.tsx. */
export function registerThemeSync(apiClient: { updateSettings: (s: any) => Promise<any> }) {
  _syncApi = apiClient;
}

function syncThemeToServer(name: string) {
  _syncApi?.updateSettings({ theme: name }).catch(() => {});
}

// ─── Custom theme support ───────────────────────────────────────────────

const CUSTOM_THEME_KEY = 'd_custom_theme';

/** Required keys for a valid custom theme. */
const REQUIRED_KEYS: (keyof ThemeRaw)[] = ['bg','sf','sf2','sf3','bd','tx','mt','ac','ac2','err','warn','ok'];

/** Validate that an object has all required hex color fields. */
export function validateCustomTheme(obj: unknown): ThemeRaw | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of REQUIRED_KEYS) {
    if (typeof o[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o[k] as string)) return null;
  }
  return o as unknown as ThemeRaw;
}

/** Load a saved custom theme from localStorage (if any). */
export function loadCustomTheme(): ThemeRaw | null {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_KEY);
    if (!raw) return null;
    return validateCustomTheme(JSON.parse(raw));
  } catch { return null; }
}

/** Save and apply a custom theme. Stores in localStorage and syncs to server. */
export function applyCustomTheme(colors: ThemeRaw) {
  localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(colors));
  localStorage.setItem('d_theme', 'custom');
  Traw = { ...colors };
  const preset: ThemePreset = { id: 'custom', name: 'Custom', description: 'Your custom theme', colors };
  applyVarsToRoot(colors, preset);
  syncThemeToServer('custom');
  _syncApi?.updateSettings({ custom_theme: colors }).catch(() => {});
}

/** Export the current theme as a JSON object for download. */
export function exportTheme(): { name: string; version: 1; colors: ThemeRaw } {
  const name = getThemeName();
  const colors = name === 'custom' ? (loadCustomTheme() || getTheme()) : getTheme();
  return { name, version: 1, colors };
}

// Register 'custom' in THEMES so getPreset/setTheme can resolve it
if (loadCustomTheme()) {
  THEMES.custom = loadCustomTheme()!;
}

// ─── Alpha transparency helper ─────────────────────────────────────────

/**
 * Create a transparent variant of a CSS variable color.
 *
 * Usage: ta(T.ac, '22')  →  color-mix(in srgb, var(--accent) 13%, transparent)
 *
 * The hexAlpha parameter is a 2-digit hex string (00-ff) matching the
 * pattern previously used as ${T.ac}22 with raw hex colors.
 */
export function ta(cssVar: string, hexAlpha: string): string {
  const pct = Math.round((parseInt(hexAlpha, 16) / 255) * 100);
  return `color-mix(in srgb, ${cssVar} ${pct}%, transparent)`;
}

// ─── Style helpers ──────────────────────────────────────────────────────

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
