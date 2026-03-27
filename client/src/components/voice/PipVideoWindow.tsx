/**
 * PipVideoWindow — Floating picture-in-picture video during calls.
 *
 * DESKTOP (>=768px): 320x240 default, min 240x180, max 640x480.
 *   Draggable from anywhere (YouTube-style). Resizable corners.
 *   Snaps to nearest corner on release (200ms ease). Controls auto-hide
 *   after 3s, appear on hover/tap. Self-view 80x60 bottom-left, draggable
 *   within PiP bounds.
 *
 * MOBILE (<768px): 160x120, bottom-right 12px inset. Tap expands.
 *   Swipe-down minimizes to pill. Swipe-left dismisses (via onClose).
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { T } from '../../theme';
import { I } from '../../icons';
import { VideoTile } from '../VideoGrid';

const CORNER_KEY = 'd_pip_corner';
const SNAP_DURATION = 200; // ms
const CONTROLS_TIMEOUT = 3000; // ms
const EDGE_MARGIN = 12;

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function loadCorner(): Corner {
  try {
    const v = localStorage.getItem(CORNER_KEY);
    if (v === 'top-left' || v === 'top-right' || v === 'bottom-left' || v === 'bottom-right') return v;
  } catch { /* ignore */ }
  return 'bottom-right';
}

function cornerPos(corner: Corner, w: number, h: number): { x: number; y: number } {
  const mx = EDGE_MARGIN;
  const my = EDGE_MARGIN;
  switch (corner) {
    case 'top-left':     return { x: mx, y: my };
    case 'top-right':    return { x: window.innerWidth - w - mx, y: my };
    case 'bottom-left':  return { x: mx, y: window.innerHeight - h - 60 - my }; // 60 above ActiveCallBar
    case 'bottom-right': return { x: window.innerWidth - w - mx, y: window.innerHeight - h - 60 - my };
  }
}

function nearestCorner(x: number, y: number, w: number, h: number): Corner {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const midX = window.innerWidth / 2;
  const midY = window.innerHeight / 2;
  if (cx < midX) return cy < midY ? 'top-left' : 'bottom-left';
  return cy < midY ? 'top-right' : 'bottom-right';
}

interface Props {
  channelName: string;
  participantCount: number;
  mainStream: MediaStream | null;
  mainLabel: string;
  mainSpeaking: boolean;
  selfStream: MediaStream | null;
  selfLabel: string;
  isMobile: boolean;
  isMuted: boolean;
  videoEnabled: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onExpand: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

export function PipVideoWindow({
  channelName, participantCount,
  mainStream, mainLabel, mainSpeaking,
  selfStream, selfLabel,
  isMobile, isMuted, videoEnabled,
  onToggleMute, onToggleVideo,
  onExpand, onMinimize, onClose,
}: Props) {
  const defaultSize = isMobile ? { w: 160, h: 120 } : { w: 320, h: 240 };
  const minSize = isMobile ? { w: 160, h: 120 } : { w: 240, h: 180 };
  const maxSize = isMobile ? { w: 160, h: 120 } : { w: 640, h: 480 };

  const [size, setSize] = useState(defaultSize);
  const [corner, setCorner] = useState<Corner>(loadCorner);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null); // null = snapped to corner
  const [snapping, setSnapping] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [minimizedPill, setMinimizedPill] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const dragOffset = useRef({ x: 0, y: 0 });
  const controlsTimer = useRef<ReturnType<typeof setTimeout>>();
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);

  // Self-view position within PiP
  const [selfPos, setSelfPos] = useState({ x: 4, y: -1 }); // -1 = auto bottom
  const selfDragOffset = useRef({ x: 0, y: 0 });
  const [selfDragging, setSelfDragging] = useState(false);

  // Call timer for pill display
  useEffect(() => {
    const iv = setInterval(() => setCallSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Snapped position
  const snappedPos = cornerPos(corner, size.w, size.h);
  const posX = dragPos ? dragPos.x : snappedPos.x;
  const posY = dragPos ? dragPos.y : snappedPos.y;

  // Persist corner
  useEffect(() => {
    localStorage.setItem(CORNER_KEY, corner);
  }, [corner]);

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), CONTROLS_TIMEOUT);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => clearTimeout(controlsTimer.current);
  }, [resetControlsTimer]);

  // ── Drag (entire window, YouTube-style) ──
  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-pip-control]')) return;
    if ((e.target as HTMLElement).closest('[data-self-view]')) return;
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragOffset.current = { x: clientX - posX, y: clientY - posY };
    touchStart.current = { x: clientX, y: clientY, t: Date.now() };
    setDragPos({ x: posX, y: posY });
    setSnapping(false);
    resetControlsTimer();
  }, [posX, posY, resetControlsTimer]);

  useEffect(() => {
    if (!dragPos) return;
    let moved = false;

    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      moved = true;
      const nx = Math.max(0, Math.min(window.innerWidth - size.w, clientX - dragOffset.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - size.h, clientY - dragOffset.current.y));
      setDragPos({ x: nx, y: ny });
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      if (dragPos) {
        // Mobile gesture detection
        if (isMobile && touchStart.current) {
          const endX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
          const endY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
          const dx = endX - touchStart.current.x;
          const dy = endY - touchStart.current.y;
          const dt = Date.now() - touchStart.current.t;

          // Swipe left to dismiss
          if (dx < -60 && Math.abs(dy) < 40 && dt < 400) {
            touchStart.current = null;
            setDragPos(null);
            onClose();
            return;
          }
          // Swipe down to minimize to pill
          if (dy > 60 && Math.abs(dx) < 40 && dt < 400) {
            touchStart.current = null;
            setDragPos(null);
            setMinimizedPill(true);
            return;
          }
          // Tap (no significant movement)
          if (!moved && dt < 300) {
            touchStart.current = null;
            setDragPos(null);
            onExpand();
            return;
          }
        }

        // Snap to nearest corner
        const nc = nearestCorner(dragPos.x, dragPos.y, size.w, size.h);
        setCorner(nc);
        setSnapping(true);
        setTimeout(() => setSnapping(false), SNAP_DURATION);
      }
      touchStart.current = null;
      setDragPos(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragPos, size.w, size.h, isMobile, onClose, onExpand]);

  // ── Resize (desktop corners) ──
  const onResizeStart = useCallback((e: React.MouseEvent, resizeCorner: string) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.w;
    const startH = size.h;

    const onMove = (me: MouseEvent) => {
      let dw = me.clientX - startX;
      let dh = me.clientY - startY;
      if (resizeCorner.includes('left')) dw = -dw;
      if (resizeCorner.includes('top')) dh = -dh;
      const nw = Math.max(minSize.w, Math.min(maxSize.w, startW + dw));
      const nh = Math.max(minSize.h, Math.min(maxSize.h, startH + dh));
      setSize({ w: nw, h: nh });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, size.w, size.h, minSize.w, minSize.h, maxSize.w, maxSize.h]);

  // ── Self-view drag within PiP ──
  const onSelfDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const selfW = isMobile ? 50 : 80;
    const selfH = isMobile ? 38 : 60;
    const actualSelfY = selfPos.y < 0 ? (size.h - selfH - 40 - 4) : selfPos.y; // 40 = controls bar area
    selfDragOffset.current = { x: clientX - selfPos.x, y: clientY - actualSelfY };
    setSelfDragging(true);

    const onMove = (me: MouseEvent | TouchEvent) => {
      const cx = 'touches' in me ? me.touches[0].clientX : me.clientX;
      const cy = 'touches' in me ? me.touches[0].clientY : me.clientY;
      const nx = Math.max(2, Math.min(size.w - selfW - 2, cx - selfDragOffset.current.x));
      const ny = Math.max(2, Math.min(size.h - selfH - 2, cy - selfDragOffset.current.y));
      setSelfPos({ x: nx, y: ny });
    };
    const onUp = () => {
      setSelfDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [isMobile, selfPos.x, selfPos.y, size.w, size.h]);

  if (!mainStream) return null;

  // ── Mobile minimized pill ──
  if (minimizedPill) {
    return (
      <div
        onClick={() => setMinimizedPill(false)}
        style={{
          position: 'fixed',
          bottom: 72, right: EDGE_MARGIN,
          height: 44, paddingInlineStart: 12, paddingInlineEnd: 12,
          borderRadius: 22,
          background: 'rgba(0,0,0,0.85)',
          border: `1px solid ${T.bd}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          zIndex: 9999,
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer',
        }}
        aria-label="Expand call"
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: 'monospace' }}>
          {formatTime(callSeconds)}
        </span>
        {isMuted && (
          <div style={{ color: '#ff4757' }}>
            <I.MicOff s={14} />
          </div>
        )}
        {!isMuted && (
          <div style={{ color: '#2ecc71' }}>
            <I.Mic s={14} />
          </div>
        )}
      </div>
    );
  }

  const truncName = channelName.length > 20 ? channelName.slice(0, 17) + '\u2026' : channelName;
  const selfW = isMobile ? 50 : 80;
  const selfH = isMobile ? 38 : 60;
  const selfActualY = selfPos.y < 0 ? (size.h - selfH - 40 - 4) : selfPos.y;

  const resizeHandle = (pos: string, cursor: string, style: React.CSSProperties) => (
    <div
      key={pos}
      onMouseDown={e => onResizeStart(e, pos)}
      style={{
        position: 'absolute', width: 14, height: 14, cursor, zIndex: 2,
        ...style,
      }}
    />
  );

  return (
    <div
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      onMouseEnter={resetControlsTimer}
      onMouseMove={resetControlsTimer}
      style={{
        position: 'fixed',
        left: posX,
        top: posY,
        width: size.w,
        height: size.h,
        zIndex: 9999,
        borderRadius: 'var(--border-radius)',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        border: `1px solid ${T.bd}`,
        background: '#000',
        cursor: dragPos ? 'grabbing' : 'grab',
        userSelect: 'none',
        transition: snapping ? `left ${SNAP_DURATION}ms ease, top ${SNAP_DURATION}ms ease` : 'none',
      }}
    >
      {/* Video content */}
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <VideoTile stream={mainStream} label={mainLabel} muted={false} speaking={mainSpeaking} compact />

        {/* Top overlay — channel name + count (auto-hides) */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '6px 10px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
          display: 'flex', alignItems: 'center', gap: 6,
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.2s',
          pointerEvents: showControls ? 'auto' : 'none',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {truncName}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <I.Users s={10} /> {participantCount}
          </span>
        </div>

        {/* Bottom controls bar (auto-hides) — 36px semi-transparent */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 36,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: showControls ? 1 : 0,
          transition: 'opacity 0.2s',
          pointerEvents: showControls ? 'auto' : 'none',
        }}>
          {/* Mic toggle */}
          <div data-pip-control onClick={e => { e.stopPropagation(); onToggleMute(); resetControlsTimer(); }}
            style={{ cursor: 'pointer', color: isMuted ? '#ff4757' : '#fff', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6 }}
            title={isMuted ? 'Unmute' : 'Mute'} aria-label={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? <I.MicOff s={20} /> : <I.Mic s={20} />}
          </div>

          {/* Camera toggle */}
          <div data-pip-control onClick={e => { e.stopPropagation(); onToggleVideo(); resetControlsTimer(); }}
            style={{ cursor: 'pointer', color: videoEnabled ? '#fff' : '#ff4757', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6 }}
            title={videoEnabled ? 'Turn off camera' : 'Turn on camera'} aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}>
            <I.Camera s={20} />
          </div>

          {/* End call (red) */}
          <div data-pip-control onClick={e => { e.stopPropagation(); onClose(); }}
            style={{ cursor: 'pointer', color: '#fff', background: '#ff4757', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6 }}
            title="Leave call" aria-label="Leave call">
            <I.PhoneOff s={20} />
          </div>

          {/* Expand (back to full view) */}
          <div data-pip-control onClick={e => { e.stopPropagation(); onExpand(); }}
            style={{ cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6 }}
            title="Expand" aria-label="Expand to full view">
            <I.Monitor s={20} />
          </div>
        </div>

        {/* Self-view overlay — bottom-left, draggable within PiP */}
        {selfStream && (
          <div
            data-self-view
            onMouseDown={!isMobile ? onSelfDragStart : undefined}
            onTouchStart={!isMobile ? onSelfDragStart : undefined}
            style={{
              position: 'absolute',
              left: selfPos.x,
              top: selfActualY,
              width: selfW,
              height: selfH,
              borderRadius: 6,
              overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.25)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              cursor: selfDragging ? 'grabbing' : 'grab',
              zIndex: 1,
            }}
          >
            <VideoTile stream={selfStream} label={selfLabel} muted speaking={false} compact />
          </div>
        )}
      </div>

      {/* Resize handles (desktop only, all four corners) */}
      {!isMobile && (<>
        {resizeHandle('top-left', 'nwse-resize', { top: 0, left: 0 })}
        {resizeHandle('top-right', 'nesw-resize', { top: 0, right: 0 })}
        {resizeHandle('bottom-left', 'nesw-resize', { bottom: 0, left: 0 })}
        {resizeHandle('bottom-right', 'nwse-resize', { bottom: 0, right: 0 })}
      </>)}
    </div>
  );
}
