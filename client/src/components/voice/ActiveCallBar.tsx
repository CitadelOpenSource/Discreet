/**
 * ActiveCallBar — Persistent mini-bar shown when in a voice/video session.
 *
 * Renders OUTSIDE the main content area so it persists across all navigation.
 * Fixed at the bottom of the viewport, 48px tall.
 *
 * Features:
 *   - Colored left border: green (voice), blue (video), purple (screen share)
 *   - Channel/call name (truncated 30 chars)
 *   - Participant count with people icon
 *   - Mute/unmute toggle
 *   - Deafen toggle
 *   - Hang up button
 *   - Return to Call navigation
 *   - Show Video button for video calls (PiP follow-up for mobile)
 *
 * Responsive: full-width on mobile (<768px), sidebar-aligned on desktop.
 */
import React from 'react';
import { T, ta } from '../../theme';
import * as I from '../../icons';

export interface ActiveCallBarProps {
  channelName: string;
  participantCount: number;
  muted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  pttActive: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onHangUp: () => void;
  onReturnToCall: () => void;
  onShowVideo?: () => void;
}

export function ActiveCallBar({
  channelName, participantCount, muted, deafened, videoEnabled, screenSharing, pttActive,
  onToggleMute, onToggleDeafen, onHangUp, onReturnToCall, onShowVideo,
}: ActiveCallBarProps) {
  // Left border color indicates session type.
  const borderColor = screenSharing ? '#9b59b6' : videoEnabled ? '#3498db' : '#2ecc71';
  const truncName = channelName.length > 30 ? channelName.slice(0, 27) + '...' : channelName;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        background: T.bg,
        borderTop: `1px solid ${T.bd}`,
        borderInlineStart: `3px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        zIndex: 9998,
        fontFamily: 'var(--font-primary)',
      }}
      aria-label="Active call bar"
    >
      {/* Connection indicator */}
      <div style={{
        width: 8, height: 8, borderRadius: 4,
        background: borderColor,
        boxShadow: `0 0 6px ${borderColor}`,
        flexShrink: 0,
      }} />

      {/* Channel name */}
      <div
        onClick={onReturnToCall}
        style={{
          fontSize: 13, fontWeight: 600, color: T.tx,
          cursor: 'pointer', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          minWidth: 0,
        }}
        title={channelName}
      >
        {truncName}
      </div>

      {/* Participant count */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 3,
        fontSize: 11, color: T.mt, flexShrink: 0,
      }}>
        <I.Users s={12} />
        <span>{participantCount}</span>
      </div>

      {/* PTT Transmitting indicator */}
      {pttActive && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 4,
          background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.4)',
          fontSize: 10, fontWeight: 700, color: '#2ecc71', flexShrink: 0,
          animation: 'fadeIn 0.15s ease',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#2ecc71', boxShadow: '0 0 6px #2ecc71' }} />
          TRANSMITTING
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Return to call */}
      <button
        onClick={onReturnToCall}
        style={{
          padding: '4px 10px', borderRadius: 4,
          border: `1px solid ${ta(T.ac, '44')}`,
          background: ta(T.ac, '12'),
          color: T.ac, fontSize: 11, fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}
        aria-label="Return to call"
      >
        Return to Call
      </button>

      {/* Show Video (for video calls — PiP rendering is a follow-up) */}
      {videoEnabled && onShowVideo && (
        <button
          onClick={onShowVideo}
          style={{
            padding: '4px 8px', borderRadius: 4,
            border: `1px solid ${ta('#3498db', '44')}`,
            background: ta('#3498db', '12'),
            color: '#3498db', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', flexShrink: 0,
          }}
          aria-label="Show video"
        >
          <I.Camera s={12} />
        </button>
      )}

      {/* Mute */}
      <button
        onClick={onToggleMute}
        style={{
          padding: '4px 8px', borderRadius: 4,
          border: `1px solid ${muted ? 'rgba(255,71,87,0.3)' : T.bd}`,
          background: muted ? 'rgba(255,71,87,0.1)' : 'transparent',
          color: muted ? T.err : T.mt,
          cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center',
        }}
        title={muted ? 'Unmute' : 'Mute'}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <I.MicOff s={14} /> : <I.Mic s={14} />}
      </button>

      {/* Deafen */}
      <button
        onClick={onToggleDeafen}
        style={{
          padding: '4px 8px', borderRadius: 4,
          border: `1px solid ${deafened ? 'rgba(255,71,87,0.3)' : T.bd}`,
          background: deafened ? 'rgba(255,71,87,0.1)' : 'transparent',
          color: deafened ? T.err : T.mt,
          cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center',
        }}
        title={deafened ? 'Undeafen' : 'Deafen'}
        aria-label={deafened ? 'Undeafen' : 'Deafen'}
      >
        {deafened ? <I.Headphones s={14} /> : <I.Headphones s={14} />}
      </button>

      {/* Hang up */}
      <button
        onClick={onHangUp}
        style={{
          padding: '4px 10px', borderRadius: 4,
          border: 'none',
          background: T.err, color: '#fff',
          cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 11, fontWeight: 700,
        }}
        title="Hang up"
        aria-label="Hang up"
      >
        <I.PhoneOff s={12} />
      </button>
    </div>
  );
}
