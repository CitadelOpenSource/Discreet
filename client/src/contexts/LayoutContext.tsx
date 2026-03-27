/**
 * LayoutContext — Controls component visibility based on layout mode.
 *
 * Three modes (independent of theme):
 *   Simple   — Minimal chrome, bottom tabs, back navigation. iMessage-like.
 *   Standard — Full sidebar, channels, member list. Discord-like.
 *   Power    — Everything visible plus dev tools, split panes, shortcuts.
 *
 * Components check visibility via useLayout().isVisible('serverRail').
 * Layout persists in localStorage and syncs to user_settings.layout_mode.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export type LayoutMode = 'simple' | 'standard' | 'power';

/** Named UI regions whose visibility depends on layout mode. */
export type LayoutComponent =
  | 'serverRail'
  | 'channelSidebar'
  | 'memberList'
  | 'bottomTabs'
  | 'backButton'
  | 'keyboardShortcuts'
  | 'splitPane'
  | 'advancedSettings';

/** Which modes each component is visible in. */
const VISIBILITY: Record<LayoutComponent, readonly LayoutMode[]> = {
  serverRail:        ['standard', 'power'],
  channelSidebar:    ['standard', 'power'],
  memberList:        ['standard', 'power'],
  bottomTabs:        ['simple'],
  backButton:        ['simple'],
  keyboardShortcuts: ['power'],
  splitPane:         ['power'],
  advancedSettings:  ['standard', 'power'],
};

export interface LayoutContextValue {
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
  isSimple: boolean;
  isStandard: boolean;
  isPower: boolean;
  isStandardPlus: boolean;
  isVisible: (component: LayoutComponent) => boolean;
}

const STORAGE_KEY = 'd_layout_mode';

function loadMode(): LayoutMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'simple' || stored === 'standard' || stored === 'power') return stored;
  return 'standard';
}

const LayoutCtx = createContext<LayoutContextValue>({
  mode: 'standard',
  setMode: () => {},
  isSimple: false,
  isStandard: true,
  isPower: false,
  isStandardPlus: true,
  isVisible: (c) => VISIBILITY[c].includes('standard'),
});

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<LayoutMode>(loadMode);

  const setMode = useCallback((m: LayoutMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  }, []);

  const value = useMemo<LayoutContextValue>(() => ({
    mode,
    setMode,
    isSimple: mode === 'simple',
    isStandard: mode === 'standard',
    isPower: mode === 'power',
    isStandardPlus: mode === 'standard' || mode === 'power',
    isVisible: (component: LayoutComponent) => VISIBILITY[component].includes(mode),
  }), [mode, setMode]);

  return <LayoutCtx.Provider value={value}>{children}</LayoutCtx.Provider>;
}

/** Access layout mode and component visibility. */
export function useLayout(): LayoutContextValue {
  return useContext(LayoutCtx);
}
