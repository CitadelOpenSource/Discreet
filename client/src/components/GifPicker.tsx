/**
 * GifPicker — Simple GIF URL input.
 * Users paste a direct GIF URL which renders inline in chat.
 * No third-party API calls — privacy-first design.
 */
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';

export interface GifPickerProps {
  onSelect: (url: string) => void;
  onClose:  () => void;
}

const GIF_EXTENSIONS = ['.gif', '.gifv', '.webp'];

function isGifUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') &&
      (GIF_EXTENSIONS.some(ext => u.pathname.toLowerCase().endsWith(ext)) ||
       u.hostname.includes('giphy.com') ||
       u.hostname.includes('tenor.com') ||
       u.hostname.includes('imgur.com') ||
       u.hostname.includes('gfycat.com'));
  } catch { return false; }
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [url, setUrl]         = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr]         = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handlePaste = (value: string) => {
    setUrl(value);
    setErr('');
    const trimmed = value.trim();
    if (!trimmed) { setPreview(null); return; }
    if (isGifUrl(trimmed)) {
      setPreview(trimmed);
    } else {
      setPreview(null);
      if (trimmed.length > 10) setErr('Paste a direct link to a .gif, .webp, or supported image host');
    }
  };

  const handleSend = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (isGifUrl(trimmed)) {
      onSelect(trimmed);
      onClose();
    } else {
      setErr('Not a valid GIF URL');
    }
  };

  return ReactDOM.createPortal(
    <div ref={ref} style={{ position: 'fixed', bottom: 70, right: 80, width: 340, background: T.sf, borderRadius: 'var(--border-radius)', border: `1px solid ${T.bd}`, boxShadow: '0 12px 40px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', zIndex: 10000, overflow: 'hidden', fontFamily: 'var(--font-primary)' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.ac }}>GIF</span>
        <input
          value={url}
          onChange={e => handlePaste(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder="Paste a GIF URL..."
          autoFocus
          style={{ flex: 1, background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', padding: '8px 12px', color: T.tx, fontSize: 13, outline: 'none', fontFamily: 'var(--font-primary)', boxSizing: 'border-box' }}
        />
      </div>

      {/* Preview / Help */}
      <div style={{ padding: 12, minHeight: 80 }}>
        {err && <div style={{ fontSize: 11, color: T.err, marginBottom: 8 }}>{err}</div>}

        {preview ? (
          <div style={{ textAlign: 'center' }}>
            <img
              src={preview}
              alt="GIF preview"
              style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 'var(--radius-md)', background: T.sf2 }}
              onError={() => { setPreview(null); setErr('Could not load image'); }}
            />
            <button
              onClick={handleSend}
              style={{ marginTop: 8, background: T.ac, color: '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Send GIF
            </button>
          </div>
        ) : (
          <div style={{ color: T.mt, fontSize: 11, lineHeight: 1.6, textAlign: 'center', padding: '12px 8px' }}>
            Paste a direct link to a GIF image.<br />
            Supported: .gif, .webp, Imgur, Tenor, Giphy, Gfycat<br />
            <span style={{ fontSize: 10, opacity: 0.6, marginTop: 4, display: 'block' }}>
              No third-party tracking — your privacy is preserved.
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
