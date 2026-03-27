/**
 * BottomTabBar — Fixed bottom tab bar for Simple layout mode and mobile.
 *
 * Four tabs: Chats (DMs + recent), Servers, Friends, Settings.
 * Height 56px + safe area inset for notched phones.
 * 44px minimum touch targets per Apple HIG / Material Design.
 */
import React from 'react';
import { T } from '../theme';
import * as I from '../icons';

export type MobileTab = 'chats' | 'servers' | 'friends' | 'settings';

interface BottomTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  unreadCount?: number;
}

const TABS: { id: MobileTab; label: string; Icon: React.ComponentType<{ s?: number }> }[] = [
  { id: 'chats',    label: 'Chats',    Icon: I.MessageSquare },
  { id: 'servers',  label: 'Servers',  Icon: I.Grid },
  { id: 'friends',  label: 'Friends',  Icon: I.Users },
  { id: 'settings', label: 'Settings', Icon: I.Settings },
];

export function MobileBottomTabs({ activeTab, onTabChange, unreadCount }: BottomTabBarProps) {
  return (
    <nav
      role="tablist"
      aria-label="Navigation tabs"
      style={{
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
      }}
    >
      {TABS.map(tab => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            onClick={() => onTabChange(tab.id)}
            aria-label={tab.label}
            aria-selected={active}
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
              minHeight: 44,
              transition: 'color var(--transition-fast)',
            }}
          >
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <tab.Icon s={22} />
              {tab.id === 'chats' && !!unreadCount && unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -8,
                  minWidth: 14, height: 14, borderRadius: 7,
                  background: T.err, color: '#fff',
                  fontSize: 9, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 3px',
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, lineHeight: 1 }}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
