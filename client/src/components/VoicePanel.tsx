/**
 * VoicePanel — Voice connection status bar in the sidebar.
 *
 * Shows: connection status, channel name, encryption badge, latency,
 * mute/deafen/video/screenshare/leave buttons, audio level indicator.
 * Pure rendering — all state lives in App.tsx.
 */
import React from 'react';
import { T, ta } from '../theme';
import * as I from '../icons';

export interface VoicePanelProps {
  channelName: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  sframeActive: boolean;
  latencyMs: number;
  audioLevel: number;
  serverMuted: boolean;
  isStreaming: boolean;

  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onStartGoLive: () => void;
  onStopGoLive: () => void;
  onLeave: () => void;
  onAddPeople?: () => void;
  someoneElseSharing?: boolean;
}

export function VoicePanel({
  channelName, speaking, muted, deafened, videoEnabled, screenSharing,
  sframeActive, latencyMs, audioLevel, serverMuted, isStreaming,
  onToggleMute, onToggleDeafen, onToggleVideo, onToggleScreenShare,
  onStartGoLive, onStopGoLive, onLeave, onAddPeople, someoneElseSharing,
}: VoicePanelProps) {
  return (
    <div style={{ padding: '8px 10px', borderTop: `1px solid ${T.bd}`, background: T.bg }}>
      {/* Connection indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: speaking ? '#43b581' : T.ac, boxShadow: speaking ? '0 0 0 2px #43b581, 0 0 8px rgba(67,181,129,0.6)' : 'none', transition: 'box-shadow .2s, background .2s' }} />
        <span style={{ fontSize: 11, color: T.ac, fontWeight: 600 }}>Voice Connected</span>
      </div>

      {/* Channel name + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: T.mt, marginBottom: 6 }}>
        <span># {channelName}</span>
        {sframeActive ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(67,181,129,0.15)', color: '#43b581', fontWeight: 700 }}>
            <I.ShieldCheck s={9} /> E2EE Voice
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(250,166,26,0.15)', color: '#faa61a', fontWeight: 700 }}>
            <I.ShieldAlert s={9} /> Encrypted
          </span>
        )}
        {latencyMs > 0 && (
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: latencyMs > 150 ? 'rgba(255,71,87,0.15)' : latencyMs > 80 ? 'rgba(250,166,26,0.15)' : 'rgba(67,181,129,0.15)', color: latencyMs > 150 ? '#ff4757' : latencyMs > 80 ? '#faa61a' : '#43b581', fontWeight: 700 }}>
            {latencyMs}ms
          </span>
        )}
        {serverMuted && (
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,71,87,0.15)', color: '#ff4757', fontWeight: 700 }}>
            Server Muted
          </span>
        )}
      </div>

      {/* Control buttons */}
      <div style={{ display: 'flex', gap: 4 }}>
        <div onClick={onToggleMute} style={{ flex: 1, padding: '5px 0', textAlign: 'center', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: muted ? 'rgba(255,71,87,0.15)' : T.sf2, color: muted ? T.err : T.mt, border: `1px solid ${muted ? 'rgba(255,71,87,0.3)' : T.bd}` }}>
          {muted ? '🔇 Muted' : '🎤 Mic'}
        </div>
        <div onClick={onToggleDeafen} style={{ flex: 1, padding: '5px 0', textAlign: 'center', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: deafened ? 'rgba(255,71,87,0.15)' : T.sf2, color: deafened ? T.err : T.mt, border: `1px solid ${deafened ? 'rgba(255,71,87,0.3)' : T.bd}` }}>
          {deafened ? '🔇 Deaf' : '🎧 Audio'}
        </div>
        <div onClick={onToggleVideo} style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: videoEnabled ? 'rgba(52,152,219,0.15)' : T.sf2, color: videoEnabled ? '#3498db' : T.mt, border: `1px solid ${videoEnabled ? 'rgba(52,152,219,0.4)' : T.bd}`, display: 'flex', alignItems: 'center', gap: 3 }}>
          <I.Camera s={11} /> {videoEnabled ? 'On' : 'Cam'}
        </div>
        <div
          onClick={someoneElseSharing && !screenSharing ? undefined : onToggleScreenShare}
          title={someoneElseSharing && !screenSharing ? 'Someone is sharing' : screenSharing ? 'Stop sharing' : 'Share screen'}
          style={{
            padding: '5px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 3,
            cursor: someoneElseSharing && !screenSharing ? 'not-allowed' : 'pointer',
            opacity: someoneElseSharing && !screenSharing ? 0.4 : 1,
            background: screenSharing ? 'rgba(155,89,182,0.15)' : T.sf2,
            color: screenSharing ? '#9b59b6' : T.mt,
            border: `1px solid ${screenSharing ? 'rgba(155,89,182,0.4)' : T.bd}`,
          }}
        >
          <I.Monitor s={11} /> {screenSharing ? 'Sharing' : someoneElseSharing ? 'In Use' : 'Screen'}
        </div>
        {onAddPeople && (
          <div onClick={onAddPeople} title="Add People" style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: T.sf2, color: T.ac, border: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 2 }}>
            <I.UserPlus s={11} />
          </div>
        )}
        {isStreaming ? (
          <div onClick={onStopGoLive} title="Stop streaming" style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700, background: 'rgba(255,71,87,0.2)', color: T.err, border: '1px solid rgba(255,71,87,0.4)' }}>
            ⏹ Stop
          </div>
        ) : (
          <div onClick={onStartGoLive} title="Go Live" style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700, background: 'rgba(255,71,87,0.08)', color: '#ff4757', border: '1px solid rgba(255,71,87,0.3)' }}>
            🔴 Live
          </div>
        )}
        <div onClick={onLeave} style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.3)' }}>
          ✕
        </div>
      </div>

      {/* Audio level bar */}
      <div style={{ marginTop: 4, height: 3, background: T.sf2, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(audioLevel * 500, 100)}%`, background: speaking ? T.ac : T.mt, transition: 'width 0.1s', borderRadius: 2 }} />
      </div>
    </div>
  );
}
