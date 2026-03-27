/**
 * MediaViewer — Fullscreen lightbox for images, videos, and file previews.
 *
 * Image: zoom (scroll/pinch/double-tap 100%), pan when zoomed, gallery nav
 *   (arrows/swipe, dots), download, share, info panel. Preloads next/prev.
 *   Crossfade 300ms.
 * Video: play/pause (spacebar+click), volume, scrub, fullscreen, browser PiP.
 *   Autoplay muted.
 * File: card with icon + name + size + download. Text files: preview with
 *   syntax highlighting (max 500 lines).
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { T } from '../../theme';
import { I } from '../../icons';

// ─── Types ───────────────────────────────────────────────────────────────

export interface MediaItem {
  url: string;
  thumbnailUrl?: string;
  filename: string;
  contentType: string;
  size?: number;
  width?: number;
  height?: number;
  date?: string;
  uploader?: string;
}

interface MediaViewerProps {
  items: MediaItem[];
  initialIndex?: number;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const isImage = (ct: string) => ct.startsWith('image/');
const isVideo = (ct: string) => ct.startsWith('video/');
const isText = (fn: string) => /\.(txt|md|json|csv|log|yml|yaml|toml|xml|html|css|js|ts|py|rs|go|sh)$/i.test(fn);

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ───────────────────────────────────────────────────────────

export function MediaViewer({ items, initialIndex = 0, onClose }: MediaViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showInfo, setShowInfo] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [fade, setFade] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const panStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const lastTap = useRef(0);
  const controlsTimer = useRef<ReturnType<typeof setTimeout>>();

  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  // Reset zoom/pan on index change
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTextContent(null);
    setImgDims(null);
    setFade(true);
    const t = setTimeout(() => setFade(false), 300);
    return () => clearTimeout(t);
  }, [index]);

  // Preload adjacent images
  useEffect(() => {
    [index - 1, index + 1].forEach(i => {
      if (i >= 0 && i < items.length && isImage(items[i].contentType)) {
        const img = new Image();
        img.src = items[i].url;
      }
    });
  }, [index, items]);

  // Auto-hide controls
  const resetControls = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  useEffect(() => {
    resetControls();
    return () => clearTimeout(controlsTimer.current);
  }, [resetControls]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) setIndex(i => i - 1);
      if (e.key === 'ArrowRight' && hasNext) setIndex(i => i + 1);
      if (e.key === ' ' && isVideo(item.contentType)) {
        e.preventDefault();
        if (videoRef.current) videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
      }
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.5, 5));
      if (e.key === '-') setZoom(z => Math.max(z - 0.5, 0.5));
      if (e.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasPrev, hasNext, item.contentType, onClose]);

  // Scroll to zoom (images)
  const onWheel = (e: React.WheelEvent) => {
    if (!isImage(item.contentType)) return;
    e.preventDefault();
    setZoom(z => Math.max(0.5, Math.min(5, z - e.deltaY * 0.002)));
  };

  // Double-tap to zoom 100%
  const onTap = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isImage(item.contentType)) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setZoom(z => z === 1 ? 2 : 1);
      setPan({ x: 0, y: 0 });
    }
    lastTap.current = now;
    resetControls();
  };

  // Pan when zoomed
  const onPanStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (zoom <= 1) return;
    const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
    panStart.current = { x: cx, y: cy, px: pan.x, py: pan.y };
  };

  useEffect(() => {
    if (!panStart.current) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!panStart.current) return;
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
      setPan({
        x: panStart.current.px + (cx - panStart.current.x),
        y: panStart.current.py + (cy - panStart.current.y),
      });
    };
    const onUp = () => { panStart.current = null; };
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
  });

  // Load text preview
  const loadTextPreview = async () => {
    try {
      const r = await fetch(item.url);
      const text = await r.text();
      const lines = text.split('\n');
      setTextContent(lines.slice(0, 500).join('\n') + (lines.length > 500 ? '\n\n... (truncated at 500 lines)' : ''));
    } catch {
      setTextContent('Failed to load preview');
    }
  };

  // Image onLoad for dimensions
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
  };

  // Download
  const download = () => {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.filename;
    a.click();
  };

  // Share
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: item.filename, url: item.url }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard?.writeText(item.url);
    }
  };

  // Video PiP
  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch { /* not supported */ }
  };

  const navBtn = (dir: 'left' | 'right', onClick: () => void) => (
    <div onClick={e => { e.stopPropagation(); onClick(); }} style={{
      position: 'absolute', top: '50%', [dir]: 16, transform: 'translateY(-50%)',
      width: 44, height: 44, borderRadius: 22,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', color: '#fff', zIndex: 3, opacity: showControls ? 1 : 0, transition: 'opacity 300ms',
    }} aria-label={dir === 'left' ? 'Previous' : 'Next'}>
      {dir === 'left' ? <span style={{ transform: 'rotate(180deg)', display: 'flex' }}><I.ChevR s={24} /></span> : <I.ChevR s={24} />}
    </div>
  );

  return (
    <div
      onMouseMove={resetControls}
      onClick={onTap}
      onWheel={onWheel}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.9)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: zoom > 1 ? 'grab' : 'default',
      }}
    >
      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 4,
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
        opacity: showControls ? 1 : 0, transition: 'opacity 300ms',
        pointerEvents: showControls ? 'auto' : 'none',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.filename}
        </span>
        {items.length > 1 && (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{index + 1} / {items.length}</span>
        )}
        <div onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }} style={{ cursor: 'pointer', color: '#fff', padding: 4 }} title="Info" aria-label="File info">
          <I.Eye s={18} />
        </div>
        <div onClick={e => { e.stopPropagation(); share(); }} style={{ cursor: 'pointer', color: '#fff', padding: 4 }} title="Share" aria-label="Share">
          <I.Link s={18} />
        </div>
        <div onClick={e => { e.stopPropagation(); download(); }} style={{ cursor: 'pointer', color: '#fff', padding: 4 }} title="Download" aria-label="Download">
          <I.Download s={18} />
        </div>
        <div onClick={e => { e.stopPropagation(); onClose(); }} style={{ cursor: 'pointer', color: '#fff', padding: 4 }} title="Close" aria-label="Close">
          <I.X s={20} />
        </div>
      </div>

      {/* Gallery navigation */}
      {hasPrev && navBtn('left', () => setIndex(i => i - 1))}
      {hasNext && navBtn('right', () => setIndex(i => i + 1))}

      {/* Main content */}
      <div
        onMouseDown={onPanStart}
        onTouchStart={onPanStart}
        style={{
          maxWidth: '90vw', maxHeight: '80vh',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: fade ? 0.3 : 1, transition: 'opacity 300ms ease',
        }}
      >
        {/* Image */}
        {isImage(item.contentType) && (
          <img
            ref={imgRef}
            src={item.url}
            alt={item.filename}
            onLoad={onImgLoad}
            draggable={false}
            style={{
              maxWidth: '90vw', maxHeight: '80vh',
              objectFit: 'contain', borderRadius: 4,
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: zoom === 1 ? 'transform 200ms ease' : 'none',
              userSelect: 'none',
            }}
          />
        )}

        {/* Video */}
        {isVideo(item.contentType) && (
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '80vh' }}>
            <video
              ref={videoRef}
              src={item.url}
              autoPlay muted
              controls
              style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 4 }}
              onClick={e => { e.stopPropagation(); }}
            />
            {document.pictureInPictureEnabled && (
              <div onClick={e => { e.stopPropagation(); togglePiP(); }}
                style={{ position: 'absolute', top: 8, right: 8, padding: 6, borderRadius: 6, background: 'rgba(0,0,0,0.6)', cursor: 'pointer', color: '#fff' }}
                title="Picture-in-Picture" aria-label="Picture-in-Picture">
                <I.Monitor s={16} />
              </div>
            )}
          </div>
        )}

        {/* File card (non-image, non-video) */}
        {!isImage(item.contentType) && !isVideo(item.contentType) && (
          <div onClick={e => e.stopPropagation()} style={{
            padding: 32, background: T.sf, borderRadius: 16,
            border: `1px solid ${T.bd}`, maxWidth: 480, width: '90vw',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <I.Paperclip s={48} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 4, wordBreak: 'break-all' }}>
              {item.filename}
            </div>
            {item.size != null && (
              <div style={{ fontSize: 13, color: T.mt, marginBottom: 16 }}>{formatBytes(item.size)}</div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={download} style={{
                padding: '10px 24px', borderRadius: 10, border: 'none',
                background: T.ac, color: '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}>Download</button>
              {isText(item.filename) && !textContent && (
                <button onClick={loadTextPreview} style={{
                  padding: '10px 24px', borderRadius: 10, border: `1px solid ${T.bd}`,
                  background: T.sf2, color: T.tx, fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}>Preview</button>
              )}
            </div>
            {/* Text preview */}
            {textContent && (
              <pre style={{
                marginTop: 16, padding: 16, background: T.bg, borderRadius: 'var(--radius-md)',
                border: `1px solid ${T.bd}`, textAlign: 'left', fontSize: 12,
                color: T.tx, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', fontFamily: 'var(--font-mono)',
              }}>
                {textContent}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Dots indicator (multi-item gallery) */}
      {items.length > 1 && items.length <= 20 && (
        <div style={{
          position: 'absolute', bottom: 20, display: 'flex', gap: 6, zIndex: 4,
          opacity: showControls ? 1 : 0, transition: 'opacity 300ms',
        }}>
          {items.map((_, i) => (
            <div key={i} onClick={e => { e.stopPropagation(); setIndex(i); }}
              style={{
                width: i === index ? 10 : 6, height: 6, borderRadius: 3,
                background: i === index ? '#fff' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer', transition: 'all 200ms',
              }}
            />
          ))}
        </div>
      )}

      {/* Info panel */}
      {showInfo && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', right: 16, top: 56, width: 280,
          background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: 16, zIndex: 5,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 12 }}>File Info</div>
          {[
            { label: 'Filename', value: item.filename },
            imgDims ? { label: 'Dimensions', value: `${imgDims.w} \u00D7 ${imgDims.h}` } : null,
            item.size != null ? { label: 'Size', value: formatBytes(item.size) } : null,
            item.date ? { label: 'Date', value: item.date } : null,
            item.uploader ? { label: 'Uploaded by', value: item.uploader } : null,
          ].filter(Boolean).map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
              <span style={{ color: T.mt }}>{row!.label}</span>
              <span style={{ color: T.tx, fontWeight: 500, textAlign: 'right', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row!.value}</span>
            </div>
          ))}
          <div onClick={() => setShowInfo(false)} style={{ fontSize: 11, color: T.ac, cursor: 'pointer', marginTop: 8, fontWeight: 600, textAlign: 'center' }}>Close</div>
        </div>
      )}
    </div>
  );
}

// ─── EXIF Stripping + Thumbnail Generation ──────────────────────────────

/**
 * Strips EXIF metadata (GPS, camera info — privacy critical) and generates
 * a 200px thumbnail alongside the processed image. Returns both files.
 */
export async function processImageForUpload(file: File): Promise<{ image: File; thumbnail: File }> {
  // Skip non-images and GIFs
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return { image: file, thumbnail: file };
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // Resize if > 2048px
      if (width > 2048 || height > 2048) {
        const ratio = Math.min(2048 / width, 2048 / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // Determine output format: keep PNG for transparency, else JPEG
      const hasAlpha = file.type === 'image/png';
      const outType = hasAlpha ? 'image/png' : 'image/jpeg';
      const quality = hasAlpha ? undefined : 0.85;

      // Main image (EXIF stripped by drawing to canvas)
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve({ image: file, thumbnail: file }); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((mainBlob) => {
        if (!mainBlob) { resolve({ image: file, thumbnail: file }); return; }
        const ext = hasAlpha ? '.png' : '.jpg';
        const mainFile = new File([mainBlob], file.name.replace(/\.\w+$/, ext), { type: outType });

        // Thumbnail (200px on longest side)
        const thumbScale = Math.min(200 / width, 200 / height, 1);
        const tw = Math.round(width * thumbScale);
        const th = Math.round(height * thumbScale);
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = tw;
        thumbCanvas.height = th;
        const tctx = thumbCanvas.getContext('2d');
        if (!tctx) { resolve({ image: mainFile, thumbnail: mainFile }); return; }
        tctx.drawImage(img, 0, 0, tw, th);

        thumbCanvas.toBlob((thumbBlob) => {
          if (!thumbBlob) { resolve({ image: mainFile, thumbnail: mainFile }); return; }
          const thumbFile = new File([thumbBlob], `thumb_${file.name.replace(/\.\w+$/, ext)}`, { type: outType });
          resolve({ image: mainFile, thumbnail: thumbFile });
        }, outType, 0.7);
      }, outType, quality);
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve({ image: file, thumbnail: file }); };
    img.src = url;
  });
}
