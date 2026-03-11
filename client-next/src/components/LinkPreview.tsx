/**
 * LinkPreview (named LinkEmbed in the monolith) — URL embed cards rendered
 * below a chat message.
 *
 * Handles:
 *   - YouTube        → privacy-safe iframe embed (youtube-nocookie.com)
 *   - Twitch         → channel badge + open link
 *   - GitHub repos   → repo badge + open link
 *   - Everything else → favicon + domain + truncated URL card
 *
 * Respects the "Show Link Embeds" user setting (d_show_embeds localStorage key).
 * Skips URLs that already render as inline media (images/video extensions).
 * Shows at most 3 embeds per message.
 */
import React from 'react';
import { T } from '../theme';

// ─── Types ────────────────────────────────────────────────

export interface LinkPreviewProps {
  /** Raw decrypted message text — URLs are extracted from this. */
  text: string;
}

// ─── Constants ────────────────────────────────────────────

const MEDIA_EXTS = /\.(gif|gifv|webp|jpg|jpeg|png|bmp|svg|mp4|webm|mov|ogg|m4v)(\?.*)?$/i;

const YT_RE     = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
const TWITCH_RE = /twitch\.tv\/([a-zA-Z0-9_]+)/;
const GH_RE     = /github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/;

// ─── Single-URL card ──────────────────────────────────────

interface CardProps {
  url: string;
  index: number;
}

function UrlCard({ url, index }: CardProps) {
  // YouTube
  const ytMatch = url.match(YT_RE);
  if (ytMatch) {
    return (
      <div key={index} style={{ marginTop: 6, maxWidth: 400, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.bd}`, background: T.sf2 }}>
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

  // Generic domain card with favicon
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    return (
      <div style={{ marginTop: 6, maxWidth: 400, borderRadius: 6, border: `1px solid ${T.bd}`, background: T.sf2, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          width="16"
          height="16"
          style={{ borderRadius: 2, flexShrink: 0 }}
          alt=""
          loading="lazy"
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
  } catch {
    return null;
  }
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
        <UrlCard key={i} url={url} index={i} />
      ))}
    </>
  );
}
