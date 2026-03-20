/**
 * VideoGrid — Responsive grid layout for voice/video call streams.
 * VideoTile — Individual video stream with label overlay and speaker highlight.
 *
 * Layouts:
 *   No screen share → participant grid (1→full, 2→side-by-side, 3-4→2x2, 5-9→3x3, 10+→4-col scroll)
 *   Screen share active → presenter mode (share large center, cameras as bottom thumbnails)
 *
 * Active speaker gets a green border highlight.
 * Screen share participant shows a monitor icon badge.
 */
import React, { useRef, useEffect } from 'react';
import { I } from '../icons';

interface VideoTileProps {
  stream: MediaStream;
  label: string;
  muted: boolean;
  speaking: boolean;
  isScreen?: boolean;
  compact?: boolean;
}

export function VideoTile({ stream, label, muted, speaking, isScreen, compact }: VideoTileProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && stream) { ref.current.srcObject = stream; } }, [stream]);
  return (
    <div style={{
      position: 'relative', borderRadius: compact ? 6 : 8, overflow: 'hidden', background: '#111',
      aspectRatio: isScreen ? '16/9' : compact ? '4/3' : '16/9',
      minHeight: compact ? 80 : 120,
      border: speaking ? '2px solid #2ecc71' : '2px solid transparent',
      boxShadow: speaking ? '0 0 12px rgba(46,204,113,0.3)' : 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}>
      <video ref={ref} autoPlay playsInline muted={muted} style={{ width: '100%', height: '100%', objectFit: isScreen ? 'contain' : 'cover' }} />
      <div style={{
        position: 'absolute', bottom: compact ? 3 : 6, left: compact ? 3 : 6,
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'rgba(0,0,0,0.7)', padding: compact ? '1px 5px' : '2px 8px',
        borderRadius: 4, fontSize: compact ? 9 : 11, color: '#fff', fontWeight: 600,
      }}>
        {speaking && <span style={{ width: 6, height: 6, borderRadius: 3, background: '#2ecc71', flexShrink: 0 }} />}
        {isScreen && <span style={{ fontSize: compact ? 8 : 10 }}>🖥️</span>}
        {label}
      </div>
    </div>
  );
}

interface VideoGridProps {
  streams: Record<string, MediaStream | null>;
  localName: string;
  peers: Array<{ id: string; name: string; speaking: boolean; screenSharing?: boolean }>;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  screenSharerName?: string;
}

export function VideoGrid({ streams, localName, peers, fullscreen, onToggleFullscreen, screenSharerName }: VideoGridProps) {
  const entries = Object.entries(streams).filter(([, s]) => s) as [string, MediaStream][];
  if (entries.length === 0) return null;

  const screenEntry = entries.find(([key]) => key === 'screen');
  const hasScreenShare = !!screenEntry;

  // Presenter layout: screen share large + camera thumbnails at bottom.
  if (hasScreenShare) {
    const cameraEntries = entries.filter(([key]) => key !== 'screen');
    const maxH = fullscreen ? 'calc(100vh - 110px)' : '55vh';

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: 10,
        background: 'rgba(0,0,0,0.3)', borderRadius: 10,
        marginBottom: fullscreen ? 0 : 10, maxHeight: maxH,
        flexShrink: 0, position: 'relative', overflow: 'hidden',
      }}>
        {/* Main screen share view */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <VideoTile
            stream={screenEntry![1]}
            label={screenSharerName ? `${screenSharerName} (Screen)` : `${localName} (Screen)`}
            muted
            speaking={false}
            isScreen
          />
          {/* PiP camera overlay (bottom-right of screen share) */}
          {cameraEntries.length > 0 && cameraEntries[0][0] === 'local' && (
            <div style={{
              position: 'absolute', bottom: 12, right: 12,
              width: 160, borderRadius: 8, overflow: 'hidden',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              border: '2px solid rgba(255,255,255,0.15)',
            }}>
              <VideoTile
                stream={cameraEntries[0][1]}
                label={localName}
                muted
                speaking={false}
                compact
              />
            </div>
          )}
        </div>
        {/* Thumbnail row of other cameras */}
        {cameraEntries.length > (cameraEntries[0]?.[0] === 'local' ? 1 : 0) && (
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flexShrink: 0, height: 90 }}>
            {cameraEntries
              .filter(([key]) => key !== 'local')
              .map(([key, stream]) => {
                const peer = peers.find(p => p.id === key);
                return (
                  <div key={key} style={{ width: 130, flexShrink: 0 }}>
                    <VideoTile
                      stream={stream}
                      label={peer?.name || 'Peer'}
                      muted={false}
                      speaking={peer?.speaking || false}
                      compact
                    />
                  </div>
                );
              })}
          </div>
        )}
        {onToggleFullscreen && (
          <div onClick={onToggleFullscreen} style={{
            position: 'absolute', top: 8, right: 8, padding: '4px 8px',
            background: 'rgba(0,0,0,0.7)', borderRadius: 4, cursor: 'pointer',
            fontSize: 10, color: '#fff', fontWeight: 600, zIndex: 2,
          }} title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            {fullscreen ? '⊖ Exit' : '⊕ Full'}
          </div>
        )}
      </div>
    );
  }

  // Standard participant grid (no screen share).
  const count = entries.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const maxH = fullscreen
    ? 'calc(100vh - 110px)'
    : count === 1 ? '55vh' : count <= 4 ? '50vh' : '45vh';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 6, padding: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 10,
      marginBottom: fullscreen ? 0 : 10, maxHeight: maxH,
      overflow: count > 9 ? 'auto' : 'hidden',
      flexShrink: 0, position: 'relative',
    }}>
      {entries.map(([key, stream]) => {
        const isLocal = key === 'local';
        const peer = peers.find(p => p.id === key);
        const label = isLocal ? `${localName} (You)` : (peer?.name || 'Peer');
        const speaking = isLocal ? false : (peer?.speaking || false);
        return <VideoTile key={key} stream={stream} label={label} muted={isLocal} speaking={speaking} />;
      })}
      {onToggleFullscreen && (
        <div onClick={onToggleFullscreen} style={{
          position: 'absolute', top: 8, right: 8, padding: '4px 8px',
          background: 'rgba(0,0,0,0.7)', borderRadius: 4, cursor: 'pointer',
          fontSize: 10, color: '#fff', fontWeight: 600, zIndex: 2,
        }} title={fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
          {fullscreen ? '⊖ Exit' : '⊕ Full'}
        </div>
      )}
    </div>
  );
}
