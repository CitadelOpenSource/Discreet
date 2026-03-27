/**
 * DiscoverPanel — browsable grid of publicly listed servers.
 *
 * Endpoints used:
 *   GET  /discover                        — list published servers (query, category)
 *   POST /servers/:id/publish             — publish a server (called from ServerSettingsModal)
 *   DELETE /servers/:id/publish           — unpublish (called from ServerSettingsModal)
 *
 * Exports:
 *   DiscoveredServer   — shape returned by /discover
 *   DiscoverPanelProps
 *   DiscoverPanel
 */
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { T, ta } from '../theme';
import { api } from '../api/CitadelAPI';
import { Av } from './Av';

// ─── Types ────────────────────────────────────────────────

export interface DiscoveredServer {
  id:           string;
  name:         string;
  description?: string;
  icon_url?:    string;
  member_count: number;
  category?:    string;
  tags?:        string[];
  online_count?: number;
  is_public:    boolean;
}

export interface DiscoverPanelProps {
  /** Called when the user successfully joins a server. */
  onJoin: (serverId: string) => void;
}

// ─── Constants ────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',        label: 'All',        icon: '🌐' },
  { id: 'gaming',     label: 'Gaming',     icon: '🎮' },
  { id: 'community',  label: 'Community',  icon: '🏘️' },
  { id: 'education',  label: 'Education',  icon: '📚' },
  { id: 'tech',       label: 'Tech',       icon: '💻' },
  { id: 'art',        label: 'Art',        icon: '🎨' },
  { id: 'music',      label: 'Music',      icon: '🎵' },
] as const;

type Category = typeof CATEGORIES[number]['id'];

// ─── ServerCard ───────────────────────────────────────────

function ServerCard({
  server,
  onJoin,
}: {
  server:  DiscoveredServer;
  onJoin:  (id: string) => void;
}) {
  const [joining,  setJoining]  = useState(false);
  const [joined,   setJoined]   = useState(false);
  const [error,    setError]    = useState('');
  const [hovered,  setHovered]  = useState(false);

  const cat = CATEGORIES.find(c => c.id === server.category?.toLowerCase());

  const handleJoin = async () => {
    if (joining || joined) return;
    setJoining(true);
    setError('');
    try {
      // Use the invite/join-by-id endpoint pattern — discover servers are public
      const res = await api.fetch(`/servers/${server.id}/join`, { method: 'POST' });
      if (res.ok) {
        setJoined(true);
        onJoin(server.id);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body?.message || 'Could not join server.');
        setTimeout(() => setError(''), 3000);
      }
    } catch {
      setError('Network error.');
      setTimeout(() => setError(''), 3000);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? T.sf2 : T.sf,
        border: `1px solid ${hovered ? ta(T.ac,'44') : T.bd}`,
        borderRadius: 14,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'background .15s, border-color .15s',
        cursor: 'default',
      }}
    >
      {/* Icon + name row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 'var(--border-radius)', flexShrink: 0,
          overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: server.icon_url ? 'transparent' : `linear-gradient(135deg, ${ta(T.ac,'33')}, ${ta(T.ac2,'33')})`,
          fontSize: 20, fontWeight: 700, color: T.ac,
        }}>
          {server.icon_url
            ? <img src={server.icon_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover' }} />
            : server.name[0]?.toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {server.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
            {/* Member count */}
            <span style={{ fontSize: 11, color: T.mt, display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 9 }}>👥</span>
              {server.member_count.toLocaleString()} members
            </span>
            {/* Online count if present */}
            {server.online_count != null && server.online_count > 0 && (
              <span style={{ fontSize: 11, color: '#3ba55d', display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3ba55d', display: 'inline-block' }} />
                {server.online_count.toLocaleString()} online
              </span>
            )}
            {/* Category badge */}
            {cat && cat.id !== 'all' && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: T.ac,
                background: `${ta(T.ac,'18')}`, border: `1px solid ${ta(T.ac,'33')}`,
                borderRadius: 5, padding: '1px 6px',
              }}>
                {cat.icon} {cat.label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {server.description && (
        <div style={{
          fontSize: 12, color: T.mt, lineHeight: 1.5,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {server.description}
        </div>
      )}

      {/* Tags */}
      {server.tags && server.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {server.tags.slice(0, 5).map(tag => (
            <span key={tag} style={{
              fontSize: 10, color: T.mt, background: T.bg,
              border: `1px solid ${T.bd}`, borderRadius: 4, padding: '1px 6px',
            }}>
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Join button + error */}
      {error && (
        <div style={{ fontSize: 11, color: T.err, background: `${ta(T.err,'12')}`, borderRadius: 6, padding: '5px 8px' }}>
          {error}
        </div>
      )}
      <button
        onClick={handleJoin}
        disabled={joining || joined}
        style={{
          width: '100%', padding: '9px 0', borderRadius: 9, border: 'none',
          background: joined
            ? '#3ba55d'
            : joining
              ? T.mt
              : `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
          color: joined ? '#fff' : '#000',
          fontSize: 13, fontWeight: 700, cursor: joining || joined ? 'default' : 'pointer',
          transition: 'background .2s',
        }}
      >
        {joined ? '✓ Joined' : joining ? 'Joining…' : 'Join Server'}
      </button>
    </div>
  );
}

// ─── Skeleton keyframes (injected once at module level) ───

let _skeletonInjected = false;
function ensureSkeletonKeyframes() {
  if (_skeletonInjected) return;
  _skeletonInjected = true;
  const s = document.createElement('style');
  s.textContent = '@keyframes discover-skeleton{0%{background-position:200% 0}100%{background-position:-200% 0}}';
  document.head.appendChild(s);
}

// ─── SkeletonCard ─────────────────────────────────────────

function SkeletonCard() {
  ensureSkeletonKeyframes();
  const pulse: React.CSSProperties = {
    background: `linear-gradient(90deg, ${T.sf2} 25%, ${T.bd} 50%, ${T.sf2} 75%)`,
    backgroundSize: '200% 100%',
    animation: 'discover-skeleton 1.4s ease infinite',
    borderRadius: 6,
  };
  return (
    <div style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <div style={{ ...pulse, width: 48, height: 48, borderRadius: 'var(--border-radius)', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ ...pulse, height: 14, marginBottom: 8, width: '60%' }} />
          <div style={{ ...pulse, height: 11, width: '40%' }} />
        </div>
      </div>
      <div style={{ ...pulse, height: 11, marginBottom: 5 }} />
      <div style={{ ...pulse, height: 11, width: '80%', marginBottom: 12 }} />
      <div style={{ ...pulse, height: 34, borderRadius: 9 }} />
    </div>
  );
}

// ─── DiscoverPanel ────────────────────────────────────────

export function DiscoverPanel({ onJoin }: DiscoverPanelProps) {
  const { t } = useTranslation();
  const [servers,   setServers]   = useState<DiscoveredServer[]>([]);
  const [query,     setQuery]     = useState('');
  const [category,  setCategory]  = useState<Category>('all');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [page,      setPage]      = useState(0);
  const [hasMore,   setHasMore]   = useState(false);

  const PAGE_SIZE = 12;
  const fullListRef = useRef<DiscoveredServer[]>([]);

  // ── Debounced query ─────────────────────────────────────
  // Typing updates `query` instantly (for the input value) but
  // the API call uses `debouncedQuery`, which lags 300ms behind.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [fetchKey, setFetchKey] = useState(0); // increment to force re-fetch (Retry)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // ── Fetch — exactly one call per trigger ────────────────
  // deps: [debouncedQuery, category, fetchKey] — all user-driven.
  // Never depends on servers, loading, error, page, or hasMore.
  //
  // setTimeout(0) + clearTimeout in cleanup ensures React 18
  // StrictMode double-invoke produces ONE network request:
  //   1st invoke → schedules timer
  //   cleanup    → clears timer (fetch never starts)
  //   2nd invoke → schedules new timer → fires → one fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const timer = setTimeout(() => {
      api.discoverServers(debouncedQuery || undefined, category)
        .then((raw: DiscoveredServer[]) => {
          if (cancelled) return;
          const list = Array.isArray(raw) ? raw : [];
          fullListRef.current = list;
          setServers(list.slice(0, PAGE_SIZE));
          setPage(0);
          setHasMore(list.length > PAGE_SIZE);
        })
        .catch(() => {
          if (cancelled) return;
          setError('Failed to load servers. Please try again.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [debouncedQuery, category, fetchKey]);

  const loadMore = () => {
    const full = fullListRef.current;
    const nextPage = page + 1;
    const slice = full.slice(0, (nextPage + 1) * PAGE_SIZE);
    setServers(slice);
    setPage(nextPage);
    setHasMore(full.length > slice.length);
  };

  // ── Render ─────────────────────────────────────────────

  // Initial loading — show full-page skeleton to prevent flash of unstyled content
  if (loading && servers.length === 0 && !error) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-primary)', overflow: 'hidden' }}>
        <div style={{ padding: '24px 24px 0', flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.tx, marginBottom: 4 }}>🔭 Discover Servers</div>
          <div style={{ fontSize: 13, color: T.mt, marginBottom: 14 }}>Find public communities to join.</div>
        </div>
        <div style={{ flex: 1, padding: '0 24px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, paddingTop: 4 }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-primary)',
      overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: '24px 24px 0',
        flexShrink: 0,
      }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.tx, marginBottom: 4 }}>
            🔭 Discover Servers
          </div>
          <div style={{ fontSize: 13, color: T.mt }}>
            Find public communities to join.
          </div>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 10,
          padding: '9px 14px', marginBottom: 14,
        }}>
          <span style={{ fontSize: 14, color: T.mt }}>🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search servers…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: T.tx, fontSize: 14, fontFamily: 'var(--font-primary)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Category tabs */}
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 14,
          scrollbarWidth: 'none',
        }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', whiteSpace: 'nowrap',
                background: category === cat.id ? T.ac : T.sf2,
                color: category === cat.id ? '#000' : T.mt,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'background .15s, color .15s',
              }}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>

        {/* Error state */}
        {error && (
          <div style={{
            textAlign: 'center', padding: '48px 20px', color: T.err,
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{error}</div>
            <button
              onClick={() => setFetchKey(k => k + 1)}
              style={{
                padding: '8px 20px', borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`,
                background: T.sf2, color: T.tx, cursor: 'pointer', fontSize: 13,
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && !error && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
            paddingTop: 4,
          }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && servers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: T.mt }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔭</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.tx, marginBottom: 6 }}>
              No servers found
            </div>
            <div style={{ fontSize: 13 }}>
              {query
                ? `No results for "${query}" — try a different search.`
                : 'No public servers in this category yet.'}
            </div>
          </div>
        )}

        {/* Server grid */}
        {!loading && !error && servers.length > 0 && (
          <>
            <div style={{
              fontSize: 11, fontWeight: 700, color: T.mt,
              textTransform: 'uppercase', letterSpacing: '0.5px',
              padding: '4px 0 12px',
            }}>
              {servers.length} server{servers.length !== 1 ? 's' : ''}
              {query ? ` matching "${query}"` : ''}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 14,
            }}>
              {servers.map(s => (
                <ServerCard key={s.id} server={s} onJoin={onJoin} />
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div style={{ textAlign: 'center', paddingTop: 20 }}>
                <button
                  onClick={loadMore}
                  style={{
                    padding: '10px 32px', borderRadius: 10,
                    border: `1px solid ${T.bd}`, background: T.sf2,
                    color: T.tx, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
