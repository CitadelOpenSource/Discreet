/**
 * ChannelSearch — Client-side encrypted message search.
 *
 * Runs entirely in the browser on messages already decrypted by the client.
 * No search queries are ever sent to the server. Zero metadata leakage.
 *
 * Slides down from the channel header with debounced substring matching.
 * Results show sender, timestamp, and highlighted context around the match.
 * Click scrolls to the message with a pulse highlight animation.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { T, ta } from '../theme';
import * as I from '../icons';

interface SearchMsg {
  id: string;
  text?: string;
  author_id: string;
  authorName?: string;
  created_at: string;
}

interface ChannelSearchProps {
  messages: SearchMsg[];
  getName: (uid: string) => string;
  onClose: () => void;
  onLoadOlder?: () => Promise<void>;
  channelId: string;
}

export function ChannelSearch({ messages, getName, onClose, onLoadOlder, channelId }: ChannelSearchProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Debounce query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Search results
  const results = useCallback(() => {
    if (!debouncedQuery.trim()) return [];
    const q = debouncedQuery.toLowerCase();
    return messages
      .filter(m => m.text && m.text.toLowerCase().includes(q))
      .slice(0, 50);
  }, [debouncedQuery, messages])();

  const handleResultClick = (msgId: string) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Pulse animation
      const htmlEl = el as HTMLElement;
      htmlEl.style.transition = 'background-color 0.3s ease';
      htmlEl.style.backgroundColor = ta(T.ac, '33');
      setTimeout(() => {
        htmlEl.style.backgroundColor = 'transparent';
        setTimeout(() => { htmlEl.style.transition = ''; }, 300);
      }, 2000);
    }
  };

  const handleLoadOlder = async () => {
    if (!onLoadOlder || loadingOlder) return;
    setLoadingOlder(true);
    await onLoadOlder();
    setLoadingOlder(false);
  };

  return (
    <div style={{
      borderBottom: `1px solid ${T.bd}`,
      background: T.sf,
      animation: 'fadeIn 0.15s ease',
    }}>
      {/* Search input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px' }}>
        <I.Search s={14} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search messages in this channel..."
          style={{
            flex: 1, padding: '6px 10px', background: T.bg, border: `1px solid ${T.bd}`,
            borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none',
            fontFamily: 'var(--font-primary)',
          }}
        />
        <span style={{ fontSize: 10, color: T.mt, whiteSpace: 'nowrap' }}>
          {debouncedQuery.trim() ? `${results.length} result${results.length !== 1 ? 's' : ''}` : ''}
        </span>
        <div onClick={onClose} style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Close (Esc)">
          <I.X s={14} />
        </div>
      </div>

      {/* Results dropdown */}
      {debouncedQuery.trim() && (
        <div style={{
          maxHeight: 400, overflowY: 'auto', borderTop: `1px solid ${T.bd}`,
        }}>
          {results.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: T.mt, fontSize: 13 }}>
              No messages match "{debouncedQuery}"
            </div>
          )}

          {results.map(m => {
            const text = m.text || '';
            const qLower = debouncedQuery.toLowerCase();
            const idx = text.toLowerCase().indexOf(qLower);
            const contextStart = Math.max(0, idx - 20);
            const contextEnd = Math.min(text.length, idx + debouncedQuery.length + 20);
            const before = (contextStart > 0 ? '...' : '') + text.slice(contextStart, idx);
            const match = text.slice(idx, idx + debouncedQuery.length);
            const after = text.slice(idx + debouncedQuery.length, contextEnd) + (contextEnd < text.length ? '...' : '');

            return (
              <div
                key={m.id}
                onClick={() => handleResultClick(m.id)}
                style={{
                  padding: '8px 16px', cursor: 'pointer', borderBottom: `1px solid ${T.bd}`,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.tx }}>{m.authorName || getName(m.author_id)}</span>
                  <span style={{ fontSize: 10, color: T.mt, marginInlineStart: 'auto', whiteSpace: 'nowrap' }}>
                    {new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.5 }}>
                  {before}
                  <mark style={{ background: ta(T.ac, '33'), color: T.ac, borderRadius: 2, padding: '0 1px' }}>{match}</mark>
                  {after}
                </div>
              </div>
            );
          })}

          {/* Load older messages */}
          {onLoadOlder && (
            <div
              onClick={handleLoadOlder}
              style={{
                padding: '10px 16px', textAlign: 'center', fontSize: 12,
                color: loadingOlder ? T.mt : T.ac, cursor: loadingOlder ? 'default' : 'pointer',
                fontWeight: 600,
              }}
            >
              {loadingOlder ? 'Loading...' : 'Load older messages and search again'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
