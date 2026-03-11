/**
 * GifPicker — Tenor API v2 integration.
 * Renders as a portal at document.body. Shows trending GIFs on open,
 * switches to search results as the user types (300ms debounce).
 * Closes when clicking outside.
 */
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';

// ─── Types ────────────────────────────────────────────────

interface TenorMedia {
  gif?:     { url: string };
  tinygif?: { url: string };
}

interface TenorResult {
  id?:    string;
  media?: TenorMedia[];
}

export interface GifPickerProps {
  onSelect: (url: string) => void;
  onClose:  () => void;
}

// ─── Constants ────────────────────────────────────────────

const TENOR_KEY = 'LIVDSRZULELA';
const TENOR_BASE = 'https://g.tenor.com/v1';

// ─── Helpers ──────────────────────────────────────────────

function getThumbUrl(g: TenorResult): string {
  return g?.media?.[0]?.tinygif?.url || g?.media?.[0]?.gif?.url || '';
}

function getFullUrl(g: TenorResult): string {
  return g?.media?.[0]?.gif?.url || g?.media?.[0]?.tinygif?.url || '';
}

// ─── Component ────────────────────────────────────────────

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [query, setQuery]     = useState('');
  const [gifs, setGifs]       = useState<TenorResult[]>([]);
  const [trending, setTrending] = useState<TenorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Load trending + close-on-outside-click
  useEffect(() => {
    fetch(`${TENOR_BASE}/trending?key=${TENOR_KEY}&limit=20&media_filter=minimal`)
      .then(r => r.json())
      .then(d => setTrending(d.results || []))
      .catch(() => setError('Could not load GIFs'));

    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const search = async (q: string) => {
    if (!q.trim()) { setGifs([]); setError(null); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=20&media_filter=minimal`);
      const d = await r.json();
      setGifs(d.results || []);
      if (!d.results?.length) setError('No GIFs found');
    } catch { setError('Search failed — check connection'); }
    setLoading(false);
  };

  // 300ms debounce on query
  useEffect(() => {
    const timer = setTimeout(() => { if (query) search(query); else setError(null); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const results = query ? gifs : trending;

  return ReactDOM.createPortal(
    <div ref={ref} style={{ position: 'fixed', bottom: 70, right: 80, width: 340, maxHeight: 420, background: '#111320', borderRadius: 12, border: `1px solid ${T.bd}`, boxShadow: '0 12px 40px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', zIndex: 10000, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.ac }}>GIF</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search GIFs..."
          autoFocus
          style={{ flex: 1, background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, padding: '8px 12px', color: T.tx, fontSize: 13, outline: 'none', fontFamily: "'DM Sans',sans-serif", boxSizing: 'border-box' }}
        />
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {loading && <div style={{ textAlign: 'center', padding: 20, color: T.mt }}>Searching...</div>}
        {error && !loading && <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 12 }}>{error}</div>}
        {!loading && !error && results.length === 0 && !query && (
          <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 12 }}>Loading trending GIFs...</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {results.map((g, i) => {
            const thumb = getThumbUrl(g);
            if (!thumb) return null;
            return (
              <img
                key={g.id || i}
                src={thumb}
                onClick={() => { onSelect(getFullUrl(g)); onClose(); }}
                style={{ width: '100%', borderRadius: 6, cursor: 'pointer', display: 'block', background: T.sf2 }}
                loading="lazy"
                alt=""
              />
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
