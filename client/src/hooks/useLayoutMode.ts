/**
 * useLayoutMode — Controls which UI components render based on user expertise.
 *
 * Three modes (independent of theme, which controls colors/fonts/shapes):
 *   Simple   — iMessage/WhatsApp feel. Minimal chrome. Essential buttons only.
 *   Standard — Discord-like. Full sidebar, more actions, shortcuts in tooltips.
 *   Power    — Everything visible. Dev tools, WebRTC stats, audit log access.
 *
 * Stored in localStorage d_layout_mode and synced to user_settings.layout_mode.
 */
import { useState, useCallback, useMemo } from 'react';

export type LayoutMode = 'simple' | 'standard' | 'power';

export interface LayoutModeValue {
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
  isSimple: boolean;
  isStandard: boolean;
  isPower: boolean;
  /** Standard OR Power (anything above Simple). */
  isStandardPlus: boolean;
}

const STORAGE_KEY = 'd_layout_mode';

function loadMode(): LayoutMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'simple' || stored === 'standard' || stored === 'power') return stored;
  return 'standard';
}

export function useLayoutMode(): LayoutModeValue {
  const [mode, setModeState] = useState<LayoutMode>(loadMode);

  const setMode = useCallback((m: LayoutMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  }, []);

  return useMemo(() => ({
    mode,
    setMode,
    isSimple: mode === 'simple',
    isStandard: mode === 'standard',
    isPower: mode === 'power',
    isStandardPlus: mode === 'standard' || mode === 'power',
  }), [mode, setMode]);
}

/** Layout mode metadata for Settings UI. */
export const LAYOUT_MODES: { id: LayoutMode; name: string; description: string; icon: string }[] = [
  {
    id: 'simple',
    name: 'Simple',
    description: 'Clean and minimal. Only essential buttons. Perfect for casual chatting.',
    icon: '\u2022', // bullet
  },
  {
    id: 'standard',
    name: 'Standard',
    description: 'Full sidebar, action buttons, keyboard shortcuts. The Discord experience.',
    icon: '\u2630', // trigram
  },
  {
    id: 'power',
    name: 'Power',
    description: 'Everything visible. Dev tools, Copy ID, connection stats, audit log.',
    icon: '\u26A1', // lightning
  },
];
