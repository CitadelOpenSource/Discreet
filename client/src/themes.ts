/**
 * themes.ts — Built-in theme definitions for Discreet.
 *
 * Each theme defines values for every CSS variable from the theme engine (2P).
 * These are the source of truth — theme.ts imports and applies them.
 *
 * CSS variables set on :root:
 *   --bg-primary, --bg-secondary, --bg-card, --text-primary, --text-muted,
 *   --accent, --accent-secondary, --sidebar-bg, --input-bg, --border-color,
 *   --danger, --success, --warning, --bg-tertiary
 */

import type { ThemePreset } from './theme';

// ─── Midnight ───────────────────────────────────────────────────────────
// Deep dark theme with teal accents. The default Discreet experience.

export const midnight: ThemePreset = {
  id: 'midnight',
  name: 'Midnight',
  description: 'Deep dark theme with teal accents',
  colors: {
    bg:   '#0a0e17',   // --bg-primary
    sf:   '#0d1117',   // --bg-secondary / --sidebar-bg
    sf2:  '#1a2030',   // --bg-card / --input-bg
    sf3:  '#141922',   // --bg-tertiary
    bd:   '#2a3040',   // --border-color
    tx:   '#e2e8f0',   // --text-primary
    mt:   '#8892a4',   // --text-muted
    ac:   '#00D4AA',   // --accent
    ac2:  '#009e7e',   // --accent-secondary
    err:  '#ff4757',   // --danger
    warn: '#ffa502',   // --warning
    ok:   '#2ed573',   // --success
  },
};

// ─── Dawn ───────────────────────────────────────────────────────────────
// Clean light mode with blue accents. White backgrounds, dark text.

export const dawn: ThemePreset = {
  id: 'dawn',
  name: 'Dawn',
  description: 'Clean light mode with blue accents',
  colors: {
    bg:   '#ffffff',   // --bg-primary
    sf:   '#f5f5f5',   // --bg-secondary / --sidebar-bg
    sf2:  '#eeeeee',   // --bg-card / --input-bg
    sf3:  '#e0e0e0',   // --bg-tertiary
    bd:   '#d0d0d0',   // --border-color
    tx:   '#1a1a2e',   // --text-primary
    mt:   '#6b7280',   // --text-muted
    ac:   '#1a73e8',   // --accent
    ac2:  '#1557b0',   // --accent-secondary
    err:  '#dc2626',   // --danger
    warn: '#d97706',   // --warning
    ok:   '#16a34a',   // --success
  },
};

// ─── Terminal ───────────────────────────────────────────────────────────
// Hacker mode. Green on black. Monospace font. No avatars. Bracket
// timestamps [HH:MM]. Zero border-radius. Flat borders.

export const terminal: ThemePreset = {
  id: 'terminal',
  name: 'Terminal',
  description: 'Green on black \u2014 monospace, no avatars',
  colors: {
    bg:   '#000000',   // --bg-primary
    sf:   '#0a0a0a',   // --bg-secondary / --sidebar-bg
    sf2:  '#0f0f0f',   // --bg-card / --input-bg
    sf3:  '#141414',   // --bg-tertiary
    bd:   '#1a1a1a',   // --border-color (flat, subtle)
    tx:   '#00FF00',   // --text-primary (green)
    mt:   '#338833',   // --text-muted (dark green)
    ac:   '#00FF00',   // --accent (green)
    ac2:  '#00cc00',   // --accent-secondary
    err:  '#ff3333',   // --danger
    warn: '#ffaa00',   // --warning
    ok:   '#00FF00',   // --success
  },
  font: "'JetBrains Mono','Fira Code','Courier New',monospace",
  borderRadius: 0,
  hideAvatars: true,
  bracketTimestamps: true,
};

// ─── Obsidian ───────────────────────────────────────────────────────────
// True black for OLED displays. Minimal, subtle gray borders. Saves
// battery on AMOLED screens by using pure #000000 backgrounds.

export const obsidian: ThemePreset = {
  id: 'obsidian',
  name: 'Obsidian',
  description: 'True black for OLED displays',
  colors: {
    bg:   '#000000',   // --bg-primary (pure black)
    sf:   '#0a0a0a',   // --bg-secondary / --sidebar-bg
    sf2:  '#111111',   // --bg-card / --input-bg
    sf3:  '#181818',   // --bg-tertiary
    bd:   '#1a1a1a',   // --border-color (subtle gray)
    tx:   '#e0e0e0',   // --text-primary
    mt:   '#666666',   // --text-muted
    ac:   '#00D4AA',   // --accent
    ac2:  '#009e7e',   // --accent-secondary
    err:  '#ff4757',   // --danger
    warn: '#ffa502',   // --warning
    ok:   '#10b981',   // --success
  },
};

/** All built-in themes in display order. */
export const ALL_THEMES: ThemePreset[] = [midnight, dawn, terminal, obsidian];
