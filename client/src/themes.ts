/**
 * themes.ts — Built-in theme definitions for Discreet.
 *
 * Each theme provides colors for all 21 CSS color variables and optional
 * overrides for the ~60 layout/spacing/shadow/typography variables.
 * theme.ts imports these and applies them to :root as CSS custom properties.
 *
 * 10 built-in themes:
 *   Midnight (default dark), Daylight (light), OLED (true black),
 *   Obsidian (dark mono), Phosphor (CRT), Arcade (pixel art),
 *   Vapor (pastel), Pixel (8-bit retro), Cipher (digital rain), Neon (glow)
 */

import type { ThemePreset } from './theme';

// ─── Midnight ───────────────────────────────────────────────────────────

export const midnight: ThemePreset = {
  id: 'midnight',
  name: 'Midnight',
  description: 'Deep dark theme with purple accents',
  swatch: ['#0a0e17', '#7C3AED', '#e2e8f0', '#2a3040'],
  colors: {
    bg: '#0a0e17', sf: '#0d1117', sf2: '#161d2a', sf3: '#121820',
    bd: '#252d3d', bd2: '#1c2332',
    tx: '#e2e8f0', tx2: '#b0bac8', tx3: '#586478', mt: '#8490a4',
    ac: '#7C3AED', ac2: '#6D28D9', ac3: '#8B5CF6',
    err: '#ff4757', warn: '#ffa502', ok: '#2ed573', info: '#3b82f6',
    online: '#43b581', idle: '#faa61a', dnd: '#f04747',
    mention: 'rgba(124,58,237,0.15)',
  },
  variables: {
    '--shadow-sm': '0 1px 3px rgba(0,0,0,0.24)',
    '--shadow-md': '0 4px 16px rgba(0,0,0,0.32)',
    '--shadow-lg': '0 12px 40px rgba(0,0,0,0.48)',
    '--shadow-focus': '0 0 0 2px rgba(124,58,237,0.4)',
    '--scrollbar-color': '#161d2a',
  },
};

// ─── Dawn ───────────────────────────────────────────────────────────────

export const dawn: ThemePreset = {
  id: 'dawn',
  name: 'Daylight',
  description: 'Warm light mode with purple accents',
  swatch: ['#F5F3F0', '#7C3AED', '#1A1A1A', '#D5D2CE'],
  colors: {
    bg: '#F5F3F0', sf: '#EDEAE6', sf2: '#E5E2DE', sf3: '#F0EDEA',
    bd: '#D5D2CE', bd2: '#C5C2BE',
    tx: '#1A1A1A', tx2: '#4A4A4A', tx3: '#6B6B6B', mt: '#8A8A8A',
    ac: '#7C3AED', ac2: '#6D28D9', ac3: '#8B5CF6',
    err: '#DC2626', warn: '#D97706', ok: '#16A34A', info: '#7C3AED',
    online: '#16A34A', idle: '#D97706', dnd: '#DC2626',
    mention: 'rgba(124,58,237,0.10)',
  },
  variables: {
    '--shadow-sm': '0 1px 3px rgba(0,0,0,0.08)',
    '--shadow-md': '0 4px 12px rgba(0,0,0,0.08)',
    '--shadow-lg': '0 8px 24px rgba(0,0,0,0.10)',
    '--shadow-inset': 'inset 0 1px 2px rgba(0,0,0,0.04)',
    '--shadow-focus': '0 0 0 2px rgba(124,58,237,0.3)',
    '--overlay-bg': 'rgba(0,0,0,0.25)',
    '--scrollbar-color': '#D5D2CE',
    '--code-bg': '#EDEAE6',
    '--selection-bg': 'rgba(124,58,237,0.12)',
  },
};

// ─── Terminal ───────────────────────────────────────────────────────────

export const terminal: ThemePreset = {
  id: 'terminal',
  name: 'Obsidian',
  description: 'Dark obsidian — monospace, no avatars',
  swatch: ['#000000', '#7C3AED', '#00FF00', '#1a1a1a'],
  colors: {
    bg: '#000000', sf: '#0a0a0a', sf2: '#0f0f0f', sf3: '#141414',
    bd: '#1a1a1a', bd2: '#111111',
    tx: '#00FF00', tx2: '#22aa22', tx3: '#115511', mt: '#338833',
    ac: '#7C3AED', ac2: '#6D28D9', ac3: '#8B5CF6',
    err: '#ff3333', warn: '#ffaa00', ok: '#00FF00', info: '#8B5CF6',
    online: '#00FF00', idle: '#ffaa00', dnd: '#ff3333',
    mention: 'rgba(124,58,237,0.15)',
  },
  font: "'JetBrains Mono','Fira Code','Courier New',monospace",
  borderRadius: 0,
  hideAvatars: true,
  bracketTimestamps: true,
  variables: {
    '--shadow-sm': 'none', '--shadow-md': 'none', '--shadow-lg': 'none',
    '--shadow-inset': 'none', '--shadow-glow': 'none',
    '--radius-sm': '0px', '--radius-md': '0px', '--radius-lg': '0px',
  },
};

// ─── Obsidian ───────────────────────────────────────────────────────────

export const obsidian: ThemePreset = {
  id: 'obsidian',
  name: 'OLED',
  description: 'True black for OLED displays',
  swatch: ['#000000', '#7C3AED', '#f0f0f0', '#1a1a1a'],
  colors: {
    bg: '#000000', sf: '#000000', sf2: '#0d0d0d', sf3: '#0a0a0a',
    bd: '#1a1a1a', bd2: '#111111',
    tx: '#f0f0f0', tx2: '#c0c0c0', tx3: '#555555', mt: '#777777',
    ac: '#7C3AED', ac2: '#6D28D9', ac3: '#8B5CF6',
    err: '#ff4757', warn: '#ffa502', ok: '#10b981', info: '#3b82f6',
    online: '#43b581', idle: '#faa61a', dnd: '#f04747',
    mention: 'rgba(124,58,237,0.12)',
  },
  variables: {
    '--shadow-sm': 'none',
    '--shadow-md': 'none',
    '--shadow-lg': '0 0 1px rgba(255,255,255,0.08)',
    '--shadow-inset': 'none',
    '--shadow-glow': 'none',
    '--shadow-focus': '0 0 0 1px rgba(124,58,237,0.5)',
    '--scrollbar-color': '#1a1a1a',
    '--divider-color': '#1a1a1a',
    '--overlay-bg': 'rgba(0,0,0,0.8)',
    '--code-bg': '#0d0d0d',
  },
};

// ─── Phosphor ───────────────────────────────────────────────────────────

export const phosphor: ThemePreset = {
  id: 'phosphor',
  name: 'Phosphor',
  description: 'CRT scanlines, green phosphor, amber accents',
  swatch: ['#0a0a0a', '#00FF00', '#FFAA00', '#1a2a1a'],
  colors: {
    bg: '#0a0a0a', sf: '#0d120d', sf2: '#121a12', sf3: '#0f160f',
    bd: '#1a2a1a', bd2: '#0f1a0f',
    tx: '#00FF00', tx2: '#339933', tx3: '#226622', mt: '#448844',
    ac: '#FFAA00', ac2: '#cc8800', ac3: '#ffcc33',
    err: '#ff3333', warn: '#FFAA00', ok: '#00FF00', info: '#FFAA00',
    online: '#00FF00', idle: '#FFAA00', dnd: '#ff3333',
    mention: 'rgba(255,170,0,0.12)',
  },
  font: "'JetBrains Mono','Fira Code','Courier New',monospace",
  borderRadius: 4,
  overlay: 'scanlines',
  variables: {
    '--shadow-sm': 'none', '--shadow-md': 'none', '--shadow-lg': 'none',
    '--shadow-inset': 'none',
    '--shadow-glow': '0 0 6px rgba(0,255,0,0.15)',
  },
};

// ─── Arcade ─────────────────────────────────────────────────────────────

export const arcade: ThemePreset = {
  id: 'arcade',
  name: 'Arcade',
  description: 'Pixel art vibes — hot pink, electric cyan',
  swatch: ['#1a1a2e', '#FF2D78', '#00F0FF', '#2a2a4e'],
  colors: {
    bg: '#1a1a2e', sf: '#16162b', sf2: '#222244', sf3: '#1e1e3a',
    bd: '#2a2a4e', bd2: '#1a1a3e',
    tx: '#f0f0ff', tx2: '#c0c0ee', tx3: '#6666aa', mt: '#8888bb',
    ac: '#FF2D78', ac2: '#00F0FF', ac3: '#ff6699',
    err: '#ff4444', warn: '#ffcc00', ok: '#00ff88', info: '#00F0FF',
    online: '#00ff88', idle: '#ffcc00', dnd: '#ff4444',
    mention: 'rgba(255,45,120,0.12)',
  },
  borderRadius: 0,
  borderWidth: 2,
  headingFont: "'Press Start 2P',monospace",
  variables: {
    '--radius-sm': '0px', '--radius-md': '0px', '--radius-lg': '0px',
    '--radius-full': '0px',
    '--shadow-sm': '0 0 4px rgba(255,45,120,0.2)',
    '--shadow-md': '0 0 10px rgba(255,45,120,0.3)',
    '--shadow-lg': '0 0 20px rgba(255,45,120,0.25), 0 0 40px rgba(0,240,255,0.1)',
    '--shadow-glow': '0 0 6px rgba(0,240,255,0.4)',
    '--shadow-inset': 'none',
    '--shadow-focus': '0 0 0 2px #00F0FF',
    '--scrollbar-color': '#2a2a4e',
    '--overlay-bg': 'rgba(26,26,46,0.85)',
    '--code-bg': '#16162b',
    '--selection-bg': 'rgba(255,45,120,0.25)',
  },
};

// ─── Vapor ──────────────────────────────────────────────────────────────

export const vapor: ThemePreset = {
  id: 'vapor',
  name: 'Vapor',
  description: 'Pastel pink, teal, purple — vaporwave aesthetic',
  swatch: ['#f0c6d3', '#008080', '#7B68EE', '#c3a6d8'],
  colors: {
    bg: '#f0c6d3', sf: '#e8b8c8', sf2: '#dda8be', sf3: '#f5d4de',
    bd: '#c89aaa', bd2: '#d4a8b8',
    tx: '#2a4a4a', tx2: '#3a5f5f', tx3: '#7a9a9a', mt: '#5a7a7a',
    ac: '#7B68EE', ac2: '#9370DB', ac3: '#9f8fee',
    err: '#DC143C', warn: '#c06090', ok: '#20B2AA', info: '#7B68EE',
    online: '#20B2AA', idle: '#c06090', dnd: '#DC143C',
    mention: 'rgba(123,104,238,0.10)',
  },
  borderRadius: 20,
  sidebarGradient: 'linear-gradient(180deg, #e8b8c8 0%, #c3a6d8 50%, #a6d8d3 100%)',
  messageAlpha: 0.7,
  variables: {
    '--radius-sm': '8px', '--radius-md': '12px', '--radius-lg': '20px',
    '--shadow-sm': '0 1px 4px rgba(240,198,211,0.2)',
    '--shadow-md': '0 4px 16px rgba(240,198,211,0.2)',
    '--shadow-lg': '0 8px 32px rgba(195,166,216,0.2)',
    '--shadow-glow': '0 0 8px rgba(123,104,238,0.15)',
    '--shadow-inset': 'inset 0 1px 3px rgba(200,154,170,0.15)',
    '--shadow-focus': '0 0 0 2px rgba(123,104,238,0.4)',
    '--transition-fast': '200ms ease', '--transition-normal': '300ms ease',
    '--transition-slow': '400ms ease',
    '--transition-spring': '350ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    '--overlay-bg': 'rgba(195,166,216,0.4)',
    '--scrollbar-color': '#c3a6d8',
    '--code-bg': '#e8b8c8',
    '--selection-bg': 'rgba(123,104,238,0.15)',
  },
};

// ─── Pixel ─────────────────────────────────────────────────────────────

export const pixel: ThemePreset = {
  id: 'pixel',
  name: 'Pixel',
  description: 'Blocky 8-bit retro with earthy stone palette',
  swatch: ['#2d2d2d', '#5b8731', '#e8e8e8', '#1a1a1a'],
  colors: {
    bg: '#2d2d2d', sf: '#3d3d3d', sf2: '#4a4a4a', sf3: '#333333',
    bd: '#1a1a1a', bd2: '#2a2a2a',
    tx: '#e8e8e8', tx2: '#b0b0b0', tx3: '#707070', mt: '#808080',
    ac: '#5b8731', ac2: '#4a7028', ac3: '#6b9741',
    err: '#c0392b', warn: '#d4a017', ok: '#5b8731', info: '#5b8731',
    online: '#5b8731', idle: '#d4a017', dnd: '#c0392b',
    mention: 'rgba(91,135,49,0.2)',
  },
  font: "'Press Start 2P',monospace",
  borderRadius: 0,
  borderWidth: 2,
  variables: {
    '--font-primary': "'Press Start 2P',monospace",
    '--font-display': "'Press Start 2P',monospace",
    '--font-size-sm': '9px',
    '--font-size-md': '11px',
    '--font-size-lg': '13px',
    '--radius-sm': '0px', '--radius-md': '0px', '--radius-lg': '0px',
    '--radius-full': '0px',
    '--shadow-sm': '2px 2px 0 rgba(0,0,0,0.5)',
    '--shadow-md': '3px 3px 0 rgba(0,0,0,0.5)',
    '--shadow-lg': '4px 4px 0 rgba(0,0,0,0.6)',
    '--shadow-glow': 'none',
    '--shadow-inset': 'none',
    '--shadow-focus': '0 0 0 2px #5b8731',
    '--transition-fast': '0ms',
    '--transition-normal': '0ms',
    '--transition-slow': '0ms',
    '--transition-spring': '0ms',
    '--scrollbar-color': '#3d3d3d',
  },
};

// ─── Cipher ────────────────────────────────────────────────────────────

export const cipher: ThemePreset = {
  id: 'cipher',
  name: 'Cipher',
  description: 'Digital rain — green on black, encryption aesthetic',
  swatch: ['#000000', '#00ff41', '#00cc33', '#0a3a0a'],
  colors: {
    bg: '#000000', sf: '#050505', sf2: '#0a0a0a', sf3: '#030303',
    bd: '#0a3a0a', bd2: '#082808',
    tx: '#00ff41', tx2: '#00cc33', tx3: '#006b1a', mt: '#008f23',
    ac: '#00ff41', ac2: '#00cc33', ac3: '#33ff66',
    err: '#ff3333', warn: '#ffaa00', ok: '#00ff41', info: '#00ff41',
    online: '#00ff41', idle: '#ffaa00', dnd: '#ff3333',
    mention: 'rgba(0,255,65,0.15)',
  },
  font: "'Share Tech Mono','Fira Code',monospace",
  borderRadius: 3,
  variables: {
    '--font-primary': "'Share Tech Mono','Fira Code',monospace",
    '--font-display': "'Share Tech Mono',monospace",
    '--radius-sm': '2px', '--radius-md': '3px', '--radius-lg': '4px',
    '--shadow-sm': '0 0 4px rgba(0,255,65,0.15)',
    '--shadow-md': '0 0 8px rgba(0,255,65,0.2)',
    '--shadow-lg': '0 0 16px rgba(0,255,65,0.25)',
    '--shadow-glow': '0 0 6px rgba(0,255,65,0.3)',
    '--shadow-inset': 'inset 0 0 4px rgba(0,255,65,0.1)',
    '--shadow-focus': '0 0 0 2px rgba(0,255,65,0.5)',
    '--scrollbar-color': '#0a3a0a',
    '--overlay-bg': 'rgba(0,0,0,0.85)',
    '--code-bg': '#050505',
  },
};

// ─── Neon ──────────────────────────────────────────────────────────────

export const neon: ThemePreset = {
  id: 'neon',
  name: 'Neon',
  description: 'Hot pink + cyan glow on deep purple-black',
  swatch: ['#0a0014', '#ff0080', '#00ffff', '#2a0040'],
  colors: {
    bg: '#0a0014', sf: '#0d0020', sf2: '#12002a', sf3: '#080012',
    bd: '#2a0040', bd2: '#1a0030',
    tx: '#f0e6ff', tx2: '#c0a8e0', tx3: '#6040a0', mt: '#8060a0',
    ac: '#ff0080', ac2: '#cc0066', ac3: '#ff33a0',
    err: '#ff3366', warn: '#ffaa00', ok: '#00ff80', info: '#00ffff',
    online: '#00ff80', idle: '#ffaa00', dnd: '#ff3366',
    mention: 'rgba(255,0,128,0.15)',
  },
  font: "'Orbitron',sans-serif",
  borderRadius: 2,
  variables: {
    '--font-primary': "'Orbitron',sans-serif",
    '--font-display': "'Orbitron',sans-serif",
    '--radius-sm': '0px', '--radius-md': '2px', '--radius-lg': '4px',
    '--shadow-sm': '0 0 6px rgba(255,0,128,0.2)',
    '--shadow-md': '0 0 15px rgba(255,0,128,0.3)',
    '--shadow-lg': '0 0 30px rgba(255,0,128,0.2), 0 0 60px rgba(0,255,255,0.1)',
    '--shadow-glow': '0 0 10px rgba(0,255,255,0.3)',
    '--shadow-inset': 'inset 0 0 6px rgba(255,0,128,0.1)',
    '--shadow-focus': '0 0 0 2px #ff0080, 0 0 10px rgba(255,0,128,0.4)',
    '--scrollbar-color': '#2a0040',
    '--overlay-bg': 'rgba(10,0,20,0.85)',
    '--code-bg': '#0d0020',
  },
};

/** All built-in themes in display order. */
export const ALL_THEMES: ThemePreset[] = [midnight, dawn, obsidian, terminal, phosphor, arcade, vapor, pixel, cipher, neon];
