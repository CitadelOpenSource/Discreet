/**
 * LinkPreview — client-side Open Graph link embed cards.
 *
 * SECURITY: The Discreet SERVER never fetches arbitrary URLs.
 * All OG metadata fetching happens in the browser via fetch() with
 * mode: 'cors' and a 5-second timeout. This prevents SSRF attacks
 * (e.g. an attacker sending http://169.254.169.254/latest/meta-data/).
 *
 * Features:
 *   - YouTube        → privacy-safe iframe embed (youtube-nocookie.com)
 *   - Twitch         → channel badge + open link
 *   - GitHub repos   → repo badge + open link
 *   - Everything else → fetch OG metadata client-side, render compact card
 *
 * OG image validation: HEAD request first, reject Content-Length > 2MB.
 * Cache: localStorage keyed by SHA-256(url), 24-hour expiry.
 * Respects "Show Link Embeds" setting (d_show_embeds localStorage key).
 * Shows at most 3 embeds per message.
 */
import React, { useState, useEffect } from 'react';
import { T } from '../theme';

// ─── Types ────────────────────────────────────────────────

export interface LinkPreviewProps {
  /** Raw decrypted message text — URLs are extracted from this. */
  text: string;
}

interface OgData {
  title?: string;
  description?: string;
  image?: string;
  domain: string;
  url: string;
  ts: number; // cache timestamp
}

// ─── Constants ────────────────────────────────────────────

const MEDIA_EXTS = /\.(gif|gifv|webp|jpg|jpeg|png|bmp|svg|mp4|webm|mov|ogg|m4v)(\?.*)?$/i;

const YT_RE     = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
const TWITCH_RE = /twitch\.tv\/([a-zA-Z0-9_]+)/;
const GH_RE     = /github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/;

const OG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT = 5000; // 5 seconds
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB

// ─── Helpers ──────────────────────────────────────────────

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCached(hash: string): OgData | null {
  try {
    const raw = localStorage.getItem(`og_${hash}`);
    if (!raw) return null;
    const data: OgData = JSON.parse(raw);
    if (Date.now() - data.ts > OG_CACHE_TTL) {
      localStorage.removeItem(`og_${hash}`);
      return null;
    }
    return data;
  } catch { return null; }
}

function setCache(hash: string, data: OgData) {
  try { localStorage.setItem(`og_${hash}`, JSON.stringify(data)); } catch { /* quota */ }
}

/** Extract OG meta content from raw HTML string. */
function parseOgTag(html: string, property: string): string | undefined {
  // Match <meta property="og:title" content="..." /> or <meta content="..." property="og:title" />
  const re = new RegExp(
    `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*?)["']` +
    `|<meta[^>]*content=["']([^"']*?)["'][^>]*(?:property|name)=["']${property}["']`,
    'i'
  );
  const m = html.match(re);
  return m?.[1] ?? m?.[2] ?? undefined;
}

/** Validate og:image via HEAD request — reject if > 2MB. */
async function validateImage(imageUrl: string): Promise<string | undefined> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const res = await fetch(imageUrl, { method: 'HEAD', mode: 'cors', signal: ctrl.signal });
    clearTimeout(timer);
    const len = res.headers.get('content-length');
    if (len && parseInt(len, 10) > MAX_IMAGE_BYTES) return undefined;
    const ct = res.headers.get('content-type');
    if (ct && !ct.startsWith('image/')) return undefined;
    return imageUrl;
  } catch {
    // HEAD failed (CORS, timeout, etc.) — skip the image
    return undefined;
  }
}

/** Fetch OG metadata for a URL. Client-side only — no server involvement. */
async function fetchOgData(url: string): Promise<OgData> {
  let domain: string;
  try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = url; }

  const base: OgData = { domain, url, ts: Date.now() };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, { mode: 'cors', signal: ctrl.signal, headers: { Accept: 'text/html' } });
    clearTimeout(timer);

    if (!res.ok) return base;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return base;

    // Read only first 50KB to avoid downloading huge pages
    const reader = res.body?.getReader();
    if (!reader) return base;
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel();

    const title = parseOgTag(html, 'og:title')
      || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const description = parseOgTag(html, 'og:description')
      || parseOgTag(html, 'description');
    const rawImage = parseOgTag(html, 'og:image');

    // Validate image size via HEAD before accepting
    let image: string | undefined;
    if (rawImage) {
      // Resolve relative URLs
      let absImage = rawImage;
      if (rawImage.startsWith('/')) {
        try { absImage = new URL(rawImage, url).href; } catch { /* skip */ }
      }
      image = await validateImage(absImage);
    }

    return { ...base, title: title?.slice(0, 200), description: description?.slice(0, 300), image };
  } catch {
    // CORS blocked, timeout, network error — return domain-only card
    return base;
  }
}

// ─── OG Card Component ───────────────────────────────────

function OgCard({ url }: { url: string }) {
  const [og, setOg] = useState<OgData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hash = await sha256(url);
      const cached = getCached(hash);
      if (cached) { if (!cancelled) { setOg(cached); setLoading(false); } return; }

      const data = await fetchOgData(url);
      if (!cancelled) {
        setOg(data);
        setLoading(false);
        setCache(hash, data);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return null; // Don't show skeleton — just appear when ready
  if (!og) return null;

  const hasRichData = og.title || og.description || og.image;

  // If no OG data was fetched (CORS blocked etc.), show simple domain card
  if (!hasRichData) {
    let domain: string;
    try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = url; }
    return (
      <div style={{ marginTop: 6, maxWidth: 400, borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          width="16" height="16"
          style={{ borderRadius: 2, flexShrink: 0 }}
          alt="" loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain}</div>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: T.ac, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {url.length > 60 ? url.slice(0, 60) + '...' : url}
          </a>
        </div>
        <span style={{ color: T.mt, fontSize: 12, flexShrink: 0 }}>↗</span>
      </div>
    );
  }

  // Rich OG card: thumbnail | title + description + domain
  return (
    <div style={{ marginTop: 6, maxWidth: 420, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.bd}`, background: T.sf2, display: 'flex' }}>
      {og.image && (
        <img
          src={og.image}
          alt=""
          style={{ width: 80, height: 80, objectFit: 'cover', flexShrink: 0 }}
          loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div style={{ padding: '8px 10px', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
        {og.title && (
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: T.tx, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {og.title}
          </a>
        )}
        {og.description && (
          <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
            {og.description}
          </div>
        )}
        <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>{og.domain}</div>
      </div>
    </div>
  );
}

// ─── Single-URL card (special sites) ─────────────────────

function UrlCard({ url }: { url: string }) {
  // YouTube
  const ytMatch = url.match(YT_RE);
  if (ytMatch) {
    return (
      <div style={{ marginTop: 6, maxWidth: 400, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.bd}`, background: T.sf2 }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${ytMatch[1]}`}
          width="100%"
          height="225"
          style={{ display: 'block', border: 'none' }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
        <div style={{ padding: '6px 10px', fontSize: 11, color: T.mt, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#ff0000', fontWeight: 700, fontSize: 12 }}>▶</span> YouTube
        </div>
      </div>
    );
  }

  // Twitch
  const twitchMatch = url.match(TWITCH_RE);
  if (twitchMatch) {
    return (
      <div style={{ marginTop: 6, maxWidth: 400, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.bd}`, background: T.sf2, padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#9146ff', fontWeight: 700 }}>⬤</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{twitchMatch[1]}</span>
          <span style={{ fontSize: 11, color: T.mt }}>on Twitch</span>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T.ac, marginTop: 4, display: 'block' }}>Open in Twitch →</a>
      </div>
    );
  }

  // GitHub repo
  const ghMatch = url.match(GH_RE);
  if (ghMatch) {
    return (
      <div style={{ marginTop: 6, maxWidth: 400, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.bd}`, background: T.sf2, padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>🐙</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{ghMatch[1]}</span>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: T.ac, marginTop: 4, display: 'block' }}>View on GitHub →</a>
      </div>
    );
  }

  // Generic URL → OG fetch card
  return <OgCard url={url} />;
}

// ─── Component ────────────────────────────────────────────

export function LinkPreview({ text }: LinkPreviewProps) {
  if (!text || localStorage.getItem('d_show_embeds') === 'false') return null;

  const urls = text.match(/https?:\/\/[^\s<]+/g);
  if (!urls) return null;

  const embeddable = urls.filter(u => !MEDIA_EXTS.test(u)).slice(0, 3);
  if (!embeddable.length) return null;

  return (
    <>
      {embeddable.map((url, i) => (
        <UrlCard key={i} url={url} />
      ))}
    </>
  );
}
