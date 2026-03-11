/**
 * VideoGrid — Grid layout for voice/video call streams.
 * VideoTile — Individual video stream with label overlay.
 */
import React, { useRef, useEffect } from 'react';
import { I } from '../icons';

interface VideoTileProps {
  stream: MediaStream;
  label: string;
  muted: boolean;
}

export function VideoTile({ stream, label, muted }: VideoTileProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && stream) { ref.current.srcObject = stream; } }, [stream]);
  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#111', aspectRatio: '16/9', minHeight: 180 }}>
      <video ref={ref} autoPlay playsInline muted={muted} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,0.7)', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: '#fff', fontWeight: 600 }}>{label}</div>
    </div>
  );
}

interface VideoGridProps {
  streams: Record<string, MediaStream | null>;
  localName: string;
  peers: Array<{ id: string; name: string; speaking: boolean }>;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function VideoGrid({ streams, localName, peers, fullscreen, onToggleFullscreen }: VideoGridProps) {
  const entries = Object.entries(streams).filter(([, s]) => s) as [string, MediaStream][];
  if (entries.length === 0) return null;
  const cols = entries.length <= 1 ? 1 : entries.length <= 4 ? 2 : 3;
  const maxH = fullscreen
    ? 'calc(100vh - 110px)'
    : entries.length === 1 ? '55vh' : entries.length <= 4 ? '45vh' : '40vh';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 6, padding: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 10,
      marginBottom: fullscreen ? 0 : 10, maxHeight: maxH, overflow: 'hidden',
      flexShrink: 0, position: 'relative',
    }}>
      {entries.map(([key, stream]) => {
        const isLocal = key === 'local';
        const isScreen = key === 'screen';
        const peer = peers.find(p => p.id === key);
        const label = isLocal ? `${localName} (You)` : isScreen ? `${localName} (Screen)` : (peer?.name || 'Peer');
        return <VideoTile key={key} stream={stream} label={label} muted={isLocal || isScreen} />;
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
