/**
 * VideoGrid — FaceTime-style responsive video call layout.
 * VideoTile — Individual participant tile with video/avatar, speaker ring.
 *
 * Auto-layout grid:
 *   1 → fullscreen, 2 → 50/50, 3-4 → 2x2, 5-6 → 2x3,
 *   7-9 → 3x3, 10+ → 4-col scrollable.
 *
 * Presenter mode (screen share or pinned speaker): 75% + thumbnail row.
 * Self-view: draggable corner overlay (120x90 desktop, 80x60 mobile).
 * Controls bar: bottom, semi-transparent backdrop-blur, auto-hide 4s.
 * Top bar: channel name, timer, count, E2EE indicator.
 * All transitions 300ms ease.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { T, ta } from '../theme';
import { I } from '../icons';

// ─── VideoTile ──────────────────────────────────────────────────────────────

interface VideoTileProps {
  stream: MediaStream;
  label: string;
  muted: boolean;
  speaking: boolean;
  isScreen?: boolean;
  compact?: boolean;
  avatarFallback?: string;
  showMuteIcon?: boolean;
  pinned?: boolean;
  onPin?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function VideoTile({
  stream, label, muted, speaking, isScreen, compact,
  avatarFallback, showMuteIcon, pinned, onPin, onContextMenu,
}: VideoTileProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      const tracks = stream.getVideoTracks();
      setHasVideo(tracks.length > 0 && tracks[0].enabled);
      const onTrackChange = () => {
        const vt = stream.getVideoTracks();
        setHasVideo(vt.length > 0 && vt[0].enabled);
      };
      stream.addEventListener('addtrack', onTrackChange);
      stream.addEventListener('removetrack', onTrackChange);
      return () => {
        stream.removeEventListener('addtrack', onTrackChange);
        stream.removeEventListener('removetrack', onTrackChange);
      };
    }
  }, [stream]);

  const initial = (avatarFallback || label || '?')[0].toUpperCase();

  return (
    <div
      onContextMenu={onContextMenu}
      style={{
        position: 'relative', borderRadius: compact ? 8 : 12, overflow: 'hidden', background: '#1a1a2e',
        aspectRatio: isScreen ? '16/9' : '16/9',
        minHeight: compact ? 60 : 100,
        border: speaking
          ? '2px solid #2ecc71'
          : pinned ? `2px solid ${T.ac}` : '2px solid transparent',
        boxShadow: speaking ? '0 0 12px rgba(46,204,113,0.4)' : 'none',
        transition: 'border-color 300ms ease, box-shadow 300ms ease',
        cursor: onPin ? 'pointer' : 'default',
      }}
    >
      {/* Video element */}
      <video
        ref={ref} autoPlay playsInline muted={muted}
        style={{
          width: '100%', height: '100%', objectFit: isScreen ? 'contain' : 'cover',
          display: hasVideo ? 'block' : 'none',
        }}
      />

      {/* Avatar fallback when no video */}
      {!hasVideo && (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #2a2a4a, #1a1a2e)',
        }}>
          <div style={{
            width: compact ? 36 : 64, height: compact ? 36 : 64, borderRadius: '50%',
            background: `linear-gradient(135deg, ${T.ac}, ${T.ac2 || T.ac})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: compact ? 16 : 28, fontWeight: 800, color: '#fff',
          }}>
            {initial}
          </div>
        </div>
      )}

      {/* Name label — bottom-left */}
      <div style={{
        position: 'absolute', bottom: compact ? 3 : 8, left: compact ? 4 : 8,
        fontSize: compact ? 9 : 12, color: '#fff', fontWeight: 600,
        textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        {speaking && <span style={{ width: 6, height: 6, borderRadius: 3, background: '#2ecc71', flexShrink: 0, animation: 'pulse-dot 1.5s infinite' }} />}
        {isScreen && <I.Monitor s={compact ? 9 : 11} />}
        {label}
      </div>

      {/* Mute icon — bottom-right */}
      {showMuteIcon && muted && (
        <div style={{
          position: 'absolute', bottom: compact ? 3 : 8, right: compact ? 4 : 8,
          background: 'rgba(255,71,87,0.85)', borderRadius: 4, padding: compact ? 2 : 3,
          display: 'flex', alignItems: 'center',
        }}>
          <I.MicOff s={compact ? 10 : 14} />
        </div>
      )}

      {/* Pin badge */}
      {pinned && (
        <div style={{
          position: 'absolute', top: compact ? 3 : 6, right: compact ? 3 : 6,
          background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 6px',
          fontSize: 9, color: T.ac, fontWeight: 700,
        }}>
          <I.Pin s={9} /> Pinned
        </div>
      )}
    </div>
  );
}

// ─── SelfViewOverlay ────────────────────────────────────────────────────────

interface SelfViewProps {
  stream: MediaStream;
  label: string;
  isMobile: boolean;
  containerW: number;
  containerH: number;
  onDoubleTap?: () => void;
}

function SelfViewOverlay({ stream, label, isMobile, containerW, containerH, onDoubleTap }: SelfViewProps) {
  const w = isMobile ? 80 : 120;
  const h = isMobile ? 60 : 90;
  const [pos, setPos] = useState({ x: containerW - w - 12, y: containerH - h - 56 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const lastTap = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragOffset.current = { x: cx - pos.x, y: cy - pos.y };

    const onMove = (me: MouseEvent | TouchEvent) => {
      const mx = 'touches' in me ? me.touches[0].clientX : me.clientX;
      const my = 'touches' in me ? me.touches[0].clientY : me.clientY;
      setPos({
        x: Math.max(4, Math.min(containerW - w - 4, mx - dragOffset.current.x)),
        y: Math.max(4, Math.min(containerH - h - 4, my - dragOffset.current.y)),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [pos.x, pos.y, containerW, containerH, w, h]);

  const handleClick = () => {
    const now = Date.now();
    if (now - lastTap.current < 300 && onDoubleTap) {
      onDoubleTap();
    }
    lastTap.current = now;
  };

  return (
    <div
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      onClick={handleClick}
      style={{
        position: 'absolute',
        left: pos.x, top: pos.y,
        width: w, height: h,
        borderRadius: 'var(--border-radius)', overflow: 'hidden',
        border: `2px solid ${T.ac}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        cursor: 'grab', zIndex: 5,
        transition: 'box-shadow 200ms ease',
      }}
    >
      <VideoTile stream={stream} label={label} muted speaking={false} compact />
    </div>
  );
}

// ─── VideoGrid ──────────────────────────────────────────────────────────────

interface VideoGridProps {
  streams: Record<string, MediaStream | null>;
  localName: string;
  peers: Array<{ id: string; name: string; speaking: boolean; muted?: boolean; screenSharing?: boolean }>;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  screenSharerName?: string;
  channelName?: string;
  participantCount?: number;
  sframeActive?: boolean;
  isMobile?: boolean;
  isMuted?: boolean;
  isDeafened?: boolean;
  videoEnabled?: boolean;
  screenSharing?: boolean;
  onToggleMute?: () => void;
  onToggleDeafen?: () => void;
  onToggleVideo?: () => void;
  onToggleScreenShare?: () => void;
  onLeave?: () => void;
  onAddPeople?: () => void;
  onToggleNoiseSuppression?: () => void;
  onTogglePTT?: () => void;
  onReport?: () => void;
}

export function VideoGrid({
  streams, localName, peers, fullscreen, onToggleFullscreen, screenSharerName,
  channelName, participantCount, sframeActive, isMobile,
  isMuted, isDeafened, videoEnabled, screenSharing,
  onToggleMute, onToggleDeafen, onToggleVideo, onToggleScreenShare,
  onLeave, onAddPeople, onToggleNoiseSuppression, onTogglePTT, onReport,
}: VideoGridProps) {
  const entries = Object.entries(streams).filter(([, s]) => s) as [string, MediaStream][];
  const containerRef = useRef<HTMLDivElement>(null);
  const [showControls, setShowControls] = useState(true);
  const [callSeconds, setCallSeconds] = useState(0);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showE2EInfo, setShowE2EInfo] = useState(false);
  const [selfInGrid, setSelfInGrid] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const controlsTimer = useRef<ReturnType<typeof setTimeout>>();

  if (entries.length === 0) return null;

  // Call timer
  useEffect(() => {
    const iv = setInterval(() => setCallSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // Auto-hide controls
  const resetControls = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 4000);
  }, []);

  useEffect(() => {
    resetControls();
    return () => clearTimeout(controlsTimer.current);
  }, [resetControls]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Determine layout
  const screenEntry = entries.find(([key]) => key === 'screen');
  const hasScreenShare = !!screenEntry;
  const hasPinned = pinnedId && entries.some(([k]) => k === pinnedId);
  const isPresenter = hasScreenShare || hasPinned;

  // Separate streams
  const localEntry = entries.find(([k]) => k === 'local');
  const gridEntries = selfInGrid
    ? entries.filter(([k]) => k !== 'screen' && !(hasPinned && k === pinnedId))
    : entries.filter(([k]) => k !== 'local' && k !== 'screen' && !(hasPinned && k === pinnedId));

  const presenterEntry = hasPinned
    ? entries.find(([k]) => k === pinnedId)
    : screenEntry;

  // Grid columns
  const count = gridEntries.length + (isPresenter ? 0 : 0);
  const effectiveCount = isPresenter ? gridEntries.length : (selfInGrid ? entries.filter(([k]) => k !== 'screen').length : entries.filter(([k]) => k !== 'local' && k !== 'screen').length);
  const cols = effectiveCount <= 1 ? 1 : effectiveCount <= 4 ? 2 : effectiveCount <= 6 ? 3 : 4;

  // Context menu for pinning
  const handleTileContext = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    setPinnedId(prev => prev === key ? null : key);
  };

  const ctrlBtn = (
    onClick: (() => void) | undefined,
    icon: React.ReactNode,
    active: boolean,
    danger?: boolean,
    size?: number,
    title?: string,
  ) => (
    <div
      data-control
      onClick={e => { e.stopPropagation(); onClick?.(); resetControls(); }}
      title={title}
      aria-label={title}
      style={{
        width: size || 40, height: size || 40, borderRadius: size === 56 ? 28 : 20,
        background: danger ? '#ff4757' : active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default', color: '#fff',
        transition: 'background 200ms ease',
      }}
    >
      {icon}
    </div>
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={resetControls}
      onTouchStart={resetControls}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        background: '#0d0d1a', borderRadius: fullscreen ? 0 : 12,
        overflow: 'hidden', flexShrink: 0,
        maxHeight: fullscreen ? '100vh' : '60vh',
        minHeight: 200,
        transition: 'all 300ms ease',
      }}
    >
      {/* ── Top bar (auto-hides) ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '10px 14px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)',
        display: 'flex', alignItems: 'center', gap: 10,
        opacity: showControls ? 1 : 0,
        transition: 'opacity 300ms ease',
        pointerEvents: showControls ? 'auto' : 'none',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{channelName || 'Voice'}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>{formatTime(callSeconds)}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <I.Users s={11} /> {participantCount || entries.length}
        </span>
        <div
          onClick={() => setShowE2EInfo(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: sframeActive ? 'rgba(46,204,113,0.2)' : 'rgba(250,166,26,0.2)',
            color: sframeActive ? '#2ecc71' : '#faa61a',
          }}
        >
          <I.Lock s={10} /> E2EE
        </div>
        <div style={{ flex: 1 }} />
        {onToggleFullscreen && (
          <div onClick={onToggleFullscreen} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: 4 }} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <I.Monitor s={16} />
          </div>
        )}
      </div>

      {/* E2EE info tooltip */}
      {showE2EInfo && (
        <div style={{
          position: 'absolute', top: 44, left: 14, zIndex: 11,
          padding: '10px 14px', borderRadius: 'var(--radius-md)', maxWidth: 280,
          background: T.sf, border: `1px solid ${T.bd}`, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          fontSize: 12, color: T.tx, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>End-to-End Encrypted Voice</div>
          <div style={{ color: T.mt }}>
            Voice and video streams are encrypted using SFrame (RFC 9605). Keys are derived per-channel per-epoch via MLS.
            The server cannot decrypt your calls.
          </div>
          <div onClick={() => setShowE2EInfo(false)} style={{ fontSize: 11, color: T.ac, cursor: 'pointer', marginTop: 6, fontWeight: 600 }}>Dismiss</div>
        </div>
      )}

      {/* ── Main content area ── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: 6 }}>
        {isPresenter && presenterEntry ? (
          /* Presenter mode: 75% main + thumbnail row */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
            <div style={{ flex: 3, minHeight: 0 }}>
              <VideoTile
                stream={presenterEntry[1]}
                label={
                  presenterEntry[0] === 'screen'
                    ? `${screenSharerName || localName} (Screen)`
                    : presenterEntry[0] === 'local'
                      ? `${localName} (You)`
                      : (peers.find(p => p.id === presenterEntry[0])?.name || 'Peer')
                }
                muted={presenterEntry[0] === 'local'}
                speaking={presenterEntry[0] === 'local' ? false : (peers.find(p => p.id === presenterEntry[0])?.speaking || false)}
                isScreen={presenterEntry[0] === 'screen'}
                pinned={hasPinned ? true : undefined}
                onContextMenu={e => handleTileContext(e, presenterEntry[0])}
              />
            </div>
            {/* Thumbnail row (25%) */}
            {gridEntries.length > 0 && (
              <div style={{ flex: 1, minHeight: 60, display: 'flex', gap: 4, overflowX: 'auto' }}>
                {gridEntries.map(([key, stream]) => {
                  const isLocal = key === 'local';
                  const peer = peers.find(p => p.id === key);
                  return (
                    <div key={key} style={{ minWidth: 100, flex: 1, maxWidth: 180 }}>
                      <VideoTile
                        stream={stream}
                        label={isLocal ? `${localName} (You)` : (peer?.name || 'Peer')}
                        muted={isLocal}
                        speaking={isLocal ? false : (peer?.speaking || false)}
                        showMuteIcon={peer?.muted}
                        compact
                        onContextMenu={e => handleTileContext(e, key)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Standard grid */
          <div style={{
            display: 'grid',
            gridTemplateColumns: effectiveCount === 1 ? '1fr' : `repeat(${cols}, 1fr)`,
            gap: 6,
            height: '100%',
            overflow: effectiveCount > 9 ? 'auto' : 'hidden',
            alignContent: 'center',
          }}>
            {(selfInGrid ? entries : entries.filter(([k]) => k !== 'local')).filter(([k]) => k !== 'screen').map(([key, stream]) => {
              const isLocal = key === 'local';
              const peer = peers.find(p => p.id === key);
              return (
                <VideoTile
                  key={key}
                  stream={stream}
                  label={isLocal ? `${localName} (You)` : (peer?.name || 'Peer')}
                  muted={isLocal}
                  speaking={isLocal ? false : (peer?.speaking || false)}
                  showMuteIcon={!isLocal && peer?.muted}
                  avatarFallback={isLocal ? localName : peer?.name}
                  onContextMenu={e => handleTileContext(e, key)}
                />
              );
            })}
          </div>
        )}

        {/* Self-view overlay (when not in grid) */}
        {!selfInGrid && localEntry && !isPresenter && (
          <SelfViewOverlay
            stream={localEntry[1]}
            label={`${localName} (You)`}
            isMobile={!!isMobile}
            containerW={containerSize.w}
            containerH={containerSize.h}
            onDoubleTap={() => setSelfInGrid(true)}
          />
        )}
      </div>

      {/* ── Bottom controls bar (auto-hides, backdrop-blur) ── */}
      {(onToggleMute || onLeave) && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
          padding: '10px 0',
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: showControls ? 1 : 0,
          transition: 'opacity 300ms ease',
          pointerEvents: showControls ? 'auto' : 'none',
        }}>
          {/* Camera flip — mobile only (placeholder, no-op) */}
          {isMobile && ctrlBtn(undefined, <I.Camera s={20} />, false, false, 40, 'Flip camera')}

          {/* Mic toggle */}
          {ctrlBtn(onToggleMute, isMuted ? <I.MicOff s={20} /> : <I.Mic s={20} />, !!isMuted, false, 40, isMuted ? 'Unmute' : 'Mute')}

          {/* END CALL — 56px red circle */}
          {ctrlBtn(onLeave, <I.PhoneOff s={24} />, false, true, 56, 'Leave call')}

          {/* Camera toggle */}
          {ctrlBtn(onToggleVideo, <I.Camera s={20} />, !!videoEnabled, false, 40, videoEnabled ? 'Turn off camera' : 'Turn on camera')}

          {/* Speaker/deafen toggle */}
          {ctrlBtn(onToggleDeafen, <I.Headphones s={20} />, !!isDeafened, false, 40, isDeafened ? 'Undeafen' : 'Deafen')}

          {/* Screen share — desktop only */}
          {!isMobile && ctrlBtn(onToggleScreenShare, <I.Monitor s={20} />, !!screenSharing, false, 40, screenSharing ? 'Stop sharing' : 'Share screen')}

          {/* More menu */}
          <div style={{ position: 'relative' }}>
            {ctrlBtn(() => setShowMoreMenu(v => !v), <I.Menu s={20} />, showMoreMenu, false, 40, 'More options')}

            {showMoreMenu && (
              <div style={{
                position: 'absolute', bottom: 50, right: 0,
                background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                minWidth: 180, padding: 4, zIndex: 20,
              }}>
                {[
                  onAddPeople ? { label: 'Add People', icon: <I.UserPlus s={14} />, action: () => { onAddPeople(); setShowMoreMenu(false); } } : null,
                  pinnedId ? { label: 'Unpin Speaker', icon: <I.Pin s={14} />, action: () => { setPinnedId(null); setShowMoreMenu(false); } } : null,
                  onToggleNoiseSuppression ? { label: 'Noise Suppression', icon: <I.Vol s={14} />, action: () => { onToggleNoiseSuppression(); setShowMoreMenu(false); } } : null,
                  onTogglePTT ? { label: 'Push-to-Talk', icon: <I.Mic s={14} />, action: () => { onTogglePTT(); setShowMoreMenu(false); } } : null,
                  onReport ? { label: 'Report', icon: <I.Flag s={14} />, action: () => { onReport(); setShowMoreMenu(false); } } : null,
                ].filter(Boolean).map((item, i) => (
                  <div key={i} onClick={item!.action} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                    fontSize: 13, color: T.tx, cursor: 'pointer', borderRadius: 6,
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = T.sf2)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ color: T.mt }}>{item!.icon}</span>
                    {item!.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pulse animation for speaking dot */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
