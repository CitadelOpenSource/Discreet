/**
 * MobileBottomTabs — Fixed bottom tab bar for mobile viewports.
 *
 * Renders when isMobile is true. Four tabs: Home, Chats, Servers, Settings.
 * Height 56px + safe area inset for notched phones.
 */
import React from 'react';
import { T } from '../theme';
import * as I from '../icons';

export type MobileTab = 'home' | 'chats' | 'servers' | 'settings';

interface MobileBottomTabsProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const TABS: { id: MobileTab; label: string; Icon: React.ComponentType<{ s?: number }> }[] = [
  { id: 'home',     label: 'Home',     Icon: I.Home },
  { id: 'chats',    label: 'Chats',    Icon: I.MessageSquare },
  { id: 'servers',  label: 'Servers',  Icon: I.Grid },
  { id: 'settings', label: 'Settings', Icon: I.Settings },
];

export function MobileBottomTabs({ activeTab, onTabChange }: MobileBottomTabsProps) {
  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      background: T.sf,
      borderTop: `1px solid ${T.bd}`,
      display: 'flex',
      alignItems: 'stretch',
    }}>
      {TABS.map(tab => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            aria-label={tab.label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: active ? T.ac : T.mt,
              padding: '6px 0',
              minHeight: 48,
              transition: 'color 0.15s',
            }}
          >
            <tab.Icon s={22} />
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, lineHeight: 1 }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
