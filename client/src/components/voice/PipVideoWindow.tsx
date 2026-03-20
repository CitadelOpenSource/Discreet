/**
 * PipVideoWindow — Draggable, resizable floating video window.
 *
 * Renders when the user navigates away from the voice channel while
 * in a video call. Shows the active speaker's video with a self-view
 * overlay. Desktop: 320x240, draggable + resizable. Mobile: 160x120,
 * draggable only, tap to expand.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { T } from '../../theme';
import * as I from '../../icons';
import { VideoTile } from '../VideoGrid';

const STORAGE_KEY = 'd_pip_position';
const DEFAULT_POS = { x: -1, y: -1 }; // -1 means "auto bottom-right"

interface Props {
  channelName: string;
  participantCount: number;
  /** The main stream to show (active speaker or first remote). */
  mainStream: MediaStream | null;
  mainLabel: string;
  mainSpeaking: boolean;
  /** Local camera self-view (small overlay). */
  selfStream: MediaStream | null;
  selfLabel: string;
  isMobile: boolean;
  onExpand: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

function loadPos(): { x: number; y: number } {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || DEFAULT_POS; }
  catch { return DEFAULT_POS; }
}

export function PipVideoWindow({
  channelName, participantCount,
  mainStream, mainLabel, mainSpeaking,
  selfStream, selfLabel,
  isMobile, onExpand, onMinimize, onClose,
}: Props) {
  const defaultSize = isMobile ? { w: 160, h: 120 } : { w: 320, h: 240 };
  const minSize = isMobile ? { w: 160, h: 120 } : { w: 240, h: 180 };
  const maxSize = isMobile ? { w: 160, h: 120 } : { w: 640, h: 480 };

  const [size, setSize] = useState(defaultSize);
  const [pos, setPos] = useState(loadPos);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute actual position (auto = bottom-right with 16px margin).
  const actualX = pos.x < 0 ? window.innerWidth - size.w - 16 : pos.x;
  const actualY = pos.y < 0 ? window.innerHeight - size.h - 64 : pos.y; // 64 = above ActiveCallBar

  // Persist position.
  useEffect(() => {
    if (pos.x >= 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  }, [pos]);

  // ── Drag handlers ──
  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragOffset.current = { x: clientX - actualX, y: clientY - actualY };
    setDragging(true);
  }, [actualX, actualY]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const nx = Math.max(0, Math.min(window.innerWidth - size.w, clientX - dragOffset.current.x));
      const ny = Math.max(0, Math.min(window.innerHeight - size.h, clientY - dragOffset.current.y));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => setDragging(false);
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
  }, [dragging, size.w, size.h]);

  // ── Resize handlers (desktop only) ──
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.w;
    const startH = size.h;

    const onMove = (me: MouseEvent) => {
      const nw = Math.max(minSize.w, Math.min(maxSize.w, startW + (me.clientX - startX)));
      const nh = Math.max(minSize.h, Math.min(maxSize.h, startH + (me.clientY - startY)));
      setSize({ w: nw, h: nh });
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, size.w, size.h, minSize.w, minSize.h, maxSize.w, maxSize.h]);

  if (!mainStream) return null;

  const truncName = channelName.length > 20 ? channelName.slice(0, 17) + '...' : channelName;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: actualX,
        top: actualY,
        width: size.w,
        height: size.h,
        zIndex: 9999,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        border: `1px solid ${T.bd}`,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        cursor: dragging ? 'grabbing' : 'default',
      }}
    >
      {/* Header bar — draggable */}
      <div
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onClick={isMobile ? onExpand : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', background: 'rgba(0,0,0,0.85)',
          cursor: dragging ? 'grabbing' : 'grab',
          flexShrink: 0, userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {truncName}
        </span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>
          <I.Users s={9} /> {participantCount}
        </span>
        {!isMobile && (
          <>
            <div onClick={e => { e.stopPropagation(); onExpand(); }} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: 2 }} title="Expand"><I.Monitor s={10} /></div>
            <div onClick={e => { e.stopPropagation(); onMinimize(); }} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: 2 }} title="Minimize"><I.ChevD s={10} /></div>
            <div onClick={e => { e.stopPropagation(); onClose(); }} style={{ cursor: 'pointer', color: '#ff4757', padding: 2 }} title="Leave call"><I.X s={10} /></div>
          </>
        )}
      </div>

      {/* Video content */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <VideoTile stream={mainStream} label={mainLabel} muted={false} speaking={mainSpeaking} compact />

        {/* Self-view overlay */}
        {selfStream && (
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            width: isMobile ? 50 : 80, height: isMobile ? 38 : 60,
            borderRadius: 6, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}>
            <VideoTile stream={selfStream} label={selfLabel} muted speaking={false} compact />
          </div>
        )}
      </div>

      {/* Resize handle (desktop only) */}
      {!isMobile && (
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 14, height: 14, cursor: 'nwse-resize',
            background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%)',
            borderRadius: '0 0 10px 0',
          }}
        />
      )}
    </div>
  );
}
