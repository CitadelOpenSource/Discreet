/**
 * Theme system for Discreet.
 *
 * 8 built-in presets defined in themes.ts. CSS custom properties are set
 * on :root so all components reference them via var(). The T object returns
 * var() strings so inline styles use CSS variables with zero component changes.
 *
 * Structural skins (Phosphor, Pixel, etc.) also apply a body class
 * (.theme-pixel) for layout/rendering rules that CSS variables cannot express.
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
  // Extended palette (optional for backward compat with custom themes)
  tx2?: string;     // Text secondary
  tx3?: string;     // Text tertiary / disabled
  ac3?: string;     // Accent tertiary
  bd2?: string;     // Border secondary
  info?: string;    // Info / notice
  online?: string;  // Presence: online
  idle?: string;    // Presence: idle
  dnd?: string;     // Presence: do not disturb
  mention?: string; // @mention highlight background
}

/** Expanded theme format for structural skins. */
export interface ThemeDefinition {
  name: string;
  displayName: string;
  description: string;
  category: 'color' | 'skin';
  variables: Record<string, string>;
}

// ─── Theme presets ──────────────────────────────────────────────────────

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ThemeRaw;
  swatch?: [string, string, string, string]; // 4 hex preview colors
  font?: string;             // CSS font-family override for all UI text
  headingFont?: string;      // CSS font-family for headings only (Arcade)
  borderRadius?: number;     // px (undefined = 12 default)
  borderWidth?: number;      // px (undefined = 1 default)
  hideAvatars?: boolean;     // Terminal mode
  bracketTimestamps?: boolean; // [HH:MM] format
  overlay?: 'scanlines';     // CSS overlay effect
  sidebarGradient?: string;  // CSS gradient for sidebar bg (Vapor)
  messageAlpha?: number;     // Message bubble background opacity 0-1 (Vapor)
  variables?: Record<string, string>; // Per-theme CSS variable overrides (spacing, shadows, etc.)
}

import { ALL_THEMES } from './themes';

/** All built-in theme presets (from themes.ts). */
export const PRESETS: ThemePreset[] = ALL_THEMES;

/** Font size presets → CSS values. Shared by SettingsModal and App.tsx login sync. */
export const FONT_SIZE_MAP: Record<string, string> = { small: '12px', medium: '14px', large: '16px', xl: '18px' };

// Build THEMES record from presets (indexed by id).
// Includes aliases for backward compatibility with old theme names.
export const THEMES: Record<string, ThemeRaw> = (() => {
  const map: Record<string, ThemeRaw> = {};
  for (const p of PRESETS) map[p.id] = p.colors;
  // Aliases: old names → new presets
  map.dark = map.midnight;
  map.light = map.dawn;
  map.onyx = map.obsidian;
  map['retro-terminal'] = map.phosphor;
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
  const resolved = id === 'dark' ? 'midnight' : id === 'light' ? 'dawn' : id === 'onyx' ? 'obsidian' : id === 'retro-terminal' ? 'phosphor' : id;
  return PRESETS.find(p => p.id === resolved) || PRESETS[0];
}

/** Runtime flags derived from the active theme preset. */
export let themeFlags = { hideAvatars: false, bracketTimestamps: false, font: '' };

// ─── CSS variable names ─────────────────────────────────────────────────

// Maps ThemeRaw keys to CSS custom property names.
// Required keys are always set; optional keys use COLOR_DEFAULTS as fallback.
const VAR_MAP: Record<string, string> = {
  bg:   '--bg-primary',
  sf:   '--bg-secondary',
  sf2:  '--bg-card',
  sf3:  '--bg-tertiary',
  bd:   '--border-color',
  bd2:  '--border-secondary',
  tx:   '--text-primary',
  tx2:  '--text-secondary',
  tx3:  '--text-tertiary',
  mt:   '--text-muted',
  ac:   '--accent',
  ac2:  '--accent-secondary',
  ac3:  '--accent-tertiary',
  err:  '--danger',
  warn: '--warning',
  ok:   '--success',
  info: '--info',
  online: '--status-online',
  idle:   '--status-idle',
  dnd:    '--status-dnd',
  mention: '--mention-bg',
};

// Defaults for the extended color fields (used when a custom theme omits them)
const COLOR_DEFAULTS: Partial<ThemeRaw> = {
  tx2: '#b0b8c8', tx3: '#5c6478', ac3: '#66e8cc', bd2: '#1e2430',
  info: '#3b82f6', online: '#43b581', idle: '#faa61a', dnd: '#f04747',
  mention: 'rgba(124,58,237,0.15)',
};

// Non-color CSS variables: spacing, typography, borders, shadows, transitions, layout
const LAYOUT_DEFAULTS: Record<string, string> = {
  // Spacing
  '--space-xs': '4px', '--space-sm': '8px', '--space-md': '12px',
  '--space-lg': '16px', '--space-xl': '24px', '--space-2xl': '32px',
  '--panel-padding': '16px', '--gap': '8px',
  // Typography
  '--font-primary': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  '--font-mono': "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
  '--font-display': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  '--font-size-sm': '12px', '--font-size-md': '14px', '--font-size-lg': '16px',
  '--font-weight-normal': '400', '--font-weight-bold': '600',
  // Borders
  '--radius-sm': '4px', '--radius-md': '8px', '--radius-lg': '16px',
  '--radius-full': '9999px', '--border-style': 'solid',
  '--divider-width': '1px', '--divider-color': 'var(--border-color)',
  // Shadows
  '--shadow-sm': '0 1px 2px rgba(0,0,0,0.2)',
  '--shadow-md': '0 4px 12px rgba(0,0,0,0.3)',
  '--shadow-lg': '0 8px 32px rgba(0,0,0,0.4)',
  '--shadow-glow': 'none',
  '--shadow-inset': 'inset 0 1px 3px rgba(0,0,0,0.2)',
  '--shadow-focus': '0 0 0 2px var(--accent)',
  // Transitions
  '--transition-fast': '100ms ease', '--transition-normal': '200ms ease',
  '--transition-slow': '300ms ease',
  '--transition-spring': '200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
  // Component dimensions
  '--sidebar-width': '240px', '--server-rail-width': '72px',
  '--header-height': '48px', '--input-height': '44px',
  '--avatar-radius': 'var(--radius-full)', '--message-max-width': '100%',
  '--scrollbar-width': '8px', '--scrollbar-color': 'var(--bg-card)',
  // Semantic (derived)
  '--overlay-bg': 'rgba(0,0,0,0.6)', '--tooltip-bg': 'var(--bg-card)',
  '--tooltip-color': 'var(--text-primary)', '--code-bg': 'var(--bg-card)',
  '--link-color': 'var(--accent)', '--selection-bg': 'var(--accent)',
};

// Additional semantic aliases set on :root
const ALIASES: Record<string, keyof ThemeRaw> = {
  '--sidebar-bg': 'sf',
  '--input-bg':   'sf2',
};

// ─── Theme interface (returns var() strings) ────────────────────────────

export interface Theme {
  bg: string; sf: string; sf2: string; sf3: string;
  bd: string; bd2: string;
  tx: string; tx2: string; tx3: string; mt: string;
  ac: string; ac2: string; ac3: string;
  err: string; warn: string; ok: string; info: string;
  online: string; idle: string; dnd: string; mention: string;
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

  // 1. Layout defaults (spacing, typography, borders, shadows, transitions, component)
  for (const [varName, value] of Object.entries(LAYOUT_DEFAULTS)) {
    root.style.setProperty(varName, value);
  }

  // 2. Color variables (required + extended with fallbacks)
  for (const [key, varName] of Object.entries(VAR_MAP)) {
    const value = raw[key as keyof ThemeRaw] ?? COLOR_DEFAULTS[key as keyof ThemeRaw];
    if (value) root.style.setProperty(varName, value);
  }

  // 3. Semantic aliases
  for (const [varName, themeKey] of Object.entries(ALIASES)) {
    root.style.setProperty(varName, raw[themeKey]);
  }

  // 4. Preset-specific overrides (font, radius, border, etc.)
  const ff = preset.font || "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const hf = preset.headingFont || ff;
  root.style.setProperty('--font-family', ff);
  root.style.setProperty('--font-primary', ff);
  root.style.setProperty('--heading-font', hf);
  root.style.setProperty('--font-display', hf);
  root.style.setProperty('--border-radius', `${preset.borderRadius ?? 12}px`);
  root.style.setProperty('--border-width', `${preset.borderWidth ?? 1}px`);
  root.style.setProperty('--sidebar-gradient', preset.sidebarGradient || 'none');
  root.style.setProperty('--message-alpha', String(preset.messageAlpha ?? 1));

  // 5. Per-theme variable overrides (structural skins)
  if (preset.variables) {
    for (const [varName, value] of Object.entries(preset.variables)) {
      root.style.setProperty(varName, value);
    }
  }

  // Scanline overlay
  const existingOverlay = document.getElementById('theme-scanlines');
  if (preset.overlay === 'scanlines') {
    if (!existingOverlay) {
      const el = document.createElement('div');
      el.id = 'theme-scanlines';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);';
      document.body.appendChild(el);
    }
  } else if (existingOverlay) {
    existingOverlay.remove();
  }

  // Structural skin body classes (one active at a time)
  const SKIN_IDS = ['phosphor', 'arcade', 'pixel', 'cipher', 'neon'];
  for (const sid of SKIN_IDS) document.body.classList.remove(`theme-${sid}`);
  if (SKIN_IDS.includes(preset.id)) {
    document.body.classList.add(`theme-${preset.id}`);
  }

  // Browser color scheme (scrollbars, form controls, autofill)
  const isLight = preset.id === 'dawn' || preset.id === 'vapor';
  root.style.colorScheme = isLight ? 'light' : 'dark';
  root.setAttribute('data-theme', preset.id);

  // 300ms crossfade transition
  root.style.transition = 'background-color 300ms ease, color 300ms ease';

  // Update runtime flags
  themeFlags = {
    hideAvatars: !!preset.hideAvatars,
    bracketTimestamps: !!preset.bracketTimestamps,
    font: preset.font || '',
  };
}

// ─── Initialise on load (before first render) ───────────────────────────

const initialThemeName = localStorage.getItem('d_theme')
  || localStorage.getItem('discreet-theme-preference')
  || 'midnight';
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
  localStorage.setItem('discreet-theme-preference', preset.id);
  Traw = { ...preset.colors };
  applyVarsToRoot(preset.colors, preset);
  syncThemeToServer(preset.id);
}

/** Apply a theme name received from the server (no re-sync back). */
export function applyServerTheme(name: string) {
  const preset = getPreset(name);
  localStorage.setItem('d_theme', preset.id);
  localStorage.setItem('discreet-theme-preference', preset.id);
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

const CUSTOM_THEME_KEY = 'discreet_custom_theme';

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

/** Preview a theme by applying CSS vars without saving to localStorage or server.
 *  Call `setTheme(previousId)` or `applyCustomTheme(colors)` to commit or revert. */
export function previewTheme(colors: ThemeRaw) {
  const preset: ThemePreset = { id: '_preview', name: 'Preview', description: '', colors };
  applyVarsToRoot(colors, preset);
}

/** Revert a preview by re-applying the currently saved theme. */
export function revertPreview() {
  const saved = getThemeName();
  const preset = getPreset(saved);
  applyVarsToRoot(preset.colors, preset);
  Traw = { ...preset.colors };
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
  borderRadius: 'var(--border-radius)',
  color: T.tx,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box' as const,
  fontFamily: 'var(--font-primary)',
  transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
});

export const btn = (on: boolean) => ({
  width: '100%',
  padding: '11px',
  background: on ? `linear-gradient(135deg,${T.ac},${T.ac2})` : T.sf2,
  border: 'none',
  borderRadius: 'var(--border-radius)',
  color: on ? '#fff' : T.mt,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'var(--font-primary)',
  transition: 'background var(--transition-fast), box-shadow var(--transition-fast)',
});
