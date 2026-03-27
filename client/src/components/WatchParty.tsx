/**
 * WatchParty — synchronized video watching for channel members.
 *
 * Supports:
 *   YouTube  — full sync via IFrame API (play/pause/seek broadcast over WS)
 *   Twitch   — live channel embed (no seek; sync not needed for live)
 *
 * WS message types used (all include channel_id):
 *   watch_party        — host starts session  { video_url, video_id, video_type, title, started_by }
 *   watch_party_join   — viewer joins         { user_id, username }
 *   watch_party_leave  — viewer leaves        { user_id }
 *   watch_party_play   — host plays           { current_time }
 *   watch_party_pause  — host pauses          { current_time }
 *   watch_party_seek   — host seeks           { current_time }
 *   watch_party_sync   — periodic host sync   { current_time, playing }
 *   watch_party_end    — host ends session    {}
 *
 * Stream status (viewer count) is also polled from the backend's
 *   GET /channels/:channel_id/stream  endpoint (returns StreamStatus).
 *
 * Props: channelId, serverId, onClose
 */
import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import ReactDOM from 'react-dom';
import { T, ta, getInp, btn } from '../theme';
import { api } from '../api/CitadelAPI';

// ─── Types ────────────────────────────────────────────────

export interface WatchPartyProps {
  channelId: string;
  serverId:  string;
  onClose:   () => void;
}

type VideoType = 'youtube' | 'twitch';

interface WatchSession {
  videoUrl:   string;
  videoId:    string;
  videoType:  VideoType;
  title:      string;
  startedBy:  string;  // user_id
  startedAt:  number;
}

// Minimal YT IFrame API types
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

// ─── URL helpers ──────────────────────────────────────────

const YT_RE     = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
const TWITCH_RE = /twitch\.tv\/([a-zA-Z0-9_]+)/;

function parseVideoUrl(url: string): { videoId: string; videoType: VideoType } | null {
  const yt = url.match(YT_RE);
  if (yt) return { videoId: yt[1], videoType: 'youtube' };
  const tw = url.match(TWITCH_RE);
  if (tw) return { videoId: tw[1], videoType: 'twitch' };
  return null;
}

// ─── YouTube IFrame API loader ────────────────────────────

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise(resolve => {
    if (window.YT?.Player) { resolve(); return; }
    const existing = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { existing?.(); resolve(); };
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script');
      s.id  = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
  return ytApiPromise;
}

// ─── WS send helper ───────────────────────────────────────

function wsSend(channelId: string, payload: Record<string, unknown>) {
  (api as any).ws?.send(JSON.stringify({ channel_id: channelId, ...payload }));
}

// ─── WatchParty ───────────────────────────────────────────

export function WatchParty({ channelId, serverId, onClose }: WatchPartyProps) {
  const [urlInput,     setUrlInput]     = useState('');
  const [titleInput,   setTitleInput]   = useState('');
  const [parseErr,     setParseErr]     = useState('');
  const [session,      setSession]      = useState<WatchSession | null>(null);
  const [isHost,       setIsHost]       = useState(false);
  const [playing,      setPlaying]      = useState(false);
  const [viewerCount,  setViewerCount]  = useState(1);
  const [syncMsg,      setSyncMsg]      = useState('');   // e.g. "Buffering…"

  const ytPlayerRef    = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted      = useRef(true);

  // ── Cleanup on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      ytPlayerRef.current?.destroy?.();
    };
  }, []);

  // ── Announce join on open ──────────────────────────────
  useEffect(() => {
    wsSend(channelId, { type: 'watch_party_join', user_id: api.userId, username: api.username });
    return () => {
      wsSend(channelId, { type: 'watch_party_leave', user_id: api.userId });
    };
  }, [channelId]);

  // ── WS event handler ──────────────────────────────────
  const handleWs = useCallback((evt: any) => {
    if (evt.channel_id !== channelId) return;

    switch (evt.type) {
      case 'watch_party': {
        const sess: WatchSession = {
          videoUrl:  evt.video_url,
          videoId:   evt.video_id,
          videoType: evt.video_type,
          title:     evt.title || evt.video_url,
          startedBy: evt.started_by,
          startedAt: Date.now(),
        };
        setSession(sess);
        setIsHost(evt.started_by === api.userId);
        setPlaying(false);
        setViewerCount(1);
        break;
      }
      case 'watch_party_join':
        setViewerCount(c => c + 1);
        break;
      case 'watch_party_leave':
        setViewerCount(c => Math.max(1, c - 1));
        break;
      case 'watch_party_play':
        setPlaying(true);
        if (ytPlayerRef.current && evt.current_time != null) {
          ytPlayerRef.current.seekTo(evt.current_time, true);
          ytPlayerRef.current.playVideo();
        }
        setSyncMsg('');
        break;
      case 'watch_party_pause':
        setPlaying(false);
        if (ytPlayerRef.current && evt.current_time != null) {
          ytPlayerRef.current.seekTo(evt.current_time, true);
          ytPlayerRef.current.pauseVideo();
        }
        break;
      case 'watch_party_seek':
        if (ytPlayerRef.current && evt.current_time != null) {
          ytPlayerRef.current.seekTo(evt.current_time, true);
        }
        break;
      case 'watch_party_sync':
        // Non-host: drift correction (if more than 3s off, snap)
        if (!isHost && ytPlayerRef.current && evt.current_time != null) {
          const playerTime = ytPlayerRef.current.getCurrentTime?.() ?? 0;
          if (Math.abs(playerTime - evt.current_time) > 3) {
            ytPlayerRef.current.seekTo(evt.current_time, true);
            setSyncMsg('Syncing…');
            setTimeout(() => { if (isMounted.current) setSyncMsg(''); }, 2000);
          }
          if (evt.playing && ytPlayerRef.current.getPlayerState?.() !== 1) {
            ytPlayerRef.current.playVideo();
          } else if (!evt.playing && ytPlayerRef.current.getPlayerState?.() === 1) {
            ytPlayerRef.current.pauseVideo();
          }
        }
        break;
      case 'watch_party_end':
        endSession(false);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, isHost]);

  useEffect(() => {
    const unsub = api.onWsEvent(handleWs);
    return () => unsub();
  }, [handleWs]);

  // ── Mount YouTube player when session starts ───────────
  useEffect(() => {
    if (!session || session.videoType !== 'youtube') return;
    let destroyed = false;

    loadYouTubeApi().then(() => {
      if (destroyed || !ytContainerRef.current) return;
      // Ensure container div has an id
      ytContainerRef.current.id = 'wp-yt-player';
      ytPlayerRef.current = new window.YT.Player('wp-yt-player', {
        videoId: session.videoId,
        playerVars: { autoplay: 0, controls: isHost ? 1 : 0, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            if (!isHost) ytPlayerRef.current?.pauseVideo?.();
          },
          onStateChange: (e: any) => {
            if (!isHost) return;  // only host broadcasts state changes
            const YT_PLAYING = 1, YT_PAUSED = 2;
            const t = ytPlayerRef.current?.getCurrentTime?.() ?? 0;
            if (e.data === YT_PLAYING) {
              setPlaying(true);
              wsSend(channelId, { type: 'watch_party_play', current_time: t });
            } else if (e.data === YT_PAUSED) {
              setPlaying(false);
              wsSend(channelId, { type: 'watch_party_pause', current_time: t });
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      ytPlayerRef.current?.destroy?.();
      ytPlayerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.videoId, session?.videoType]);

  // ── Host: periodic sync broadcast ─────────────────────
  useEffect(() => {
    if (!isHost || !session) {
      if (syncIntervalRef.current) { clearInterval(syncIntervalRef.current); syncIntervalRef.current = null; }
      return;
    }
    syncIntervalRef.current = setInterval(() => {
      const t = ytPlayerRef.current?.getCurrentTime?.() ?? 0;
      wsSend(channelId, { type: 'watch_party_sync', current_time: t, playing });
    }, 5000);
    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
  }, [isHost, session, channelId, playing]);

  // ── Start a new session ────────────────────────────────
  const startSession = () => {
    const parsed = parseVideoUrl(urlInput.trim());
    if (!parsed) { setParseErr('Enter a valid YouTube or Twitch URL'); return; }
    setParseErr('');

    const sess: WatchSession = {
      videoUrl:  urlInput.trim(),
      videoId:   parsed.videoId,
      videoType: parsed.videoType,
      title:     titleInput.trim() || urlInput.trim(),
      startedBy: api.userId!,
      startedAt: Date.now(),
    };
    setSession(sess);
    setIsHost(true);
    setPlaying(false);
    setViewerCount(1);

    wsSend(channelId, {
      type:       'watch_party',
      video_url:  sess.videoUrl,
      video_id:   sess.videoId,
      video_type: sess.videoType,
      title:      sess.title,
      started_by: api.userId,
    });
  };

  // ── End the session ────────────────────────────────────
  const endSession = (broadcast = true) => {
    if (broadcast) wsSend(channelId, { type: 'watch_party_end' });
    setSession(null);
    setIsHost(false);
    setPlaying(false);
    ytPlayerRef.current?.destroy?.();
    ytPlayerRef.current = null;
  };

  // ── Host play/pause buttons ────────────────────────────
  const hostPlay = () => {
    const t = ytPlayerRef.current?.getCurrentTime?.() ?? 0;
    ytPlayerRef.current?.playVideo?.();
    setPlaying(true);
    wsSend(channelId, { type: 'watch_party_play', current_time: t });
  };
  const hostPause = () => {
    const t = ytPlayerRef.current?.getCurrentTime?.() ?? 0;
    ytPlayerRef.current?.pauseVideo?.();
    setPlaying(false);
    wsSend(channelId, { type: 'watch_party_pause', current_time: t });
  };

  // ─── Render ────────────────────────────────────────────

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 20000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      fontFamily: 'var(--font-primary)',
    }}>
      {/* ── Header bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', background: T.sf,
        borderBottom: `1px solid ${T.bd}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 18 }}>🎬</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: T.tx }}>
          {session ? session.title : 'Watch Party'}
        </span>
        {session && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginInlineStart: 8 }}>
            <span style={{ fontSize: 10, color: T.mt }}>👥</span>
            <span style={{ fontSize: 12, color: T.mt }}>{viewerCount} viewer{viewerCount !== 1 ? 's' : ''}</span>
            {isHost && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: T.ac,
                background: `${ta(T.ac,'22')}`, padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase',
              }}>HOST</span>
            )}
            {syncMsg && (
              <span style={{ fontSize: 11, color: '#faa61a' }}>{syncMsg}</span>
            )}
          </div>
        )}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {session && isHost && (
            <button
              onClick={() => endSession(true)}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(237,66,69,0.4)', background: 'rgba(237,66,69,0.1)', color: '#ed4245', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              End Party
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '2px 6px' }}
          >✕</button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Player area ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }}>

          {!session ? (
            /* ── Setup panel ── */
            <div style={{
              background: T.sf, borderRadius: 'var(--border-radius)', border: `1px solid ${T.bd}`,
              padding: '28px 32px', maxWidth: 480, width: '100%',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.tx, marginBottom: 4 }}>Start a Watch Party</div>
              <div style={{ fontSize: 12, color: T.mt, marginBottom: 20 }}>
                Share a YouTube or Twitch URL. Playback syncs for everyone in the channel.
              </div>

              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>
                Video URL *
              </label>
              <input
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setParseErr(''); }}
                onKeyDown={e => e.key === 'Enter' && startSession()}
                placeholder="https://youtube.com/watch?v=… or https://twitch.tv/channel"
                autoFocus
                style={{ ...getInp(), marginBottom: 4, fontSize: 13 }}
              />
              {parseErr && (
                <div style={{ fontSize: 11, color: '#ed4245', marginBottom: 8 }}>{parseErr}</div>
              )}

              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, marginTop: 12, textTransform: 'uppercase' }}>
                Title (optional)
              </label>
              <input
                value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
                placeholder="Movie night, Game stream…"
                style={{ ...getInp(), marginBottom: 20, fontSize: 13 }}
              />

              {/* Preview detected type */}
              {urlInput && (() => {
                const p = parseVideoUrl(urlInput.trim());
                if (!p) return null;
                return (
                  <div style={{ padding: '8px 12px', background: `${ta(T.ac,'11')}`, borderRadius: 'var(--radius-md)', border: `1px solid ${ta(T.ac,'33')}`, marginBottom: 16, fontSize: 12, color: T.ac, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{p.videoType === 'youtube' ? '▶ YouTube' : '⬤ Twitch'}</span>
                    <span style={{ color: T.mt }}>ID: {p.videoId}</span>
                  </div>
                );
              })()}

              <button onClick={startSession} style={{ ...btn(true), width: '100%', fontSize: 14 }}>
                🎬 Start Watch Party
              </button>
              <div style={{ marginTop: 12, fontSize: 11, color: T.mt, textAlign: 'center' }}>
                All channel members will be notified and can join.
              </div>
            </div>
          ) : (
            /* ── Active session ── */
            <>
              {/* Player */}
              <div style={{
                width: '100%', maxWidth: 900,
                borderRadius: 'var(--border-radius)', overflow: 'hidden',
                border: `1px solid ${T.bd}`,
                background: '#000',
                aspectRatio: '16 / 9',
                position: 'relative',
              }}>
                {session.videoType === 'youtube' ? (
                  <div
                    ref={ytContainerRef}
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  /* Twitch embed */
                  <iframe
                    src={`https://player.twitch.tv/?channel=${session.videoId}&parent=${window.location.hostname}`}
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                    allowFullScreen
                    title={session.title}
                  />
                )}

                {/* Non-host overlay nudge */}
                {!isHost && session.videoType === 'youtube' && (
                  <div style={{
                    position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(0,0,0,0.7)', borderRadius: 6, padding: '4px 10px',
                    fontSize: 11, color: T.mt, pointerEvents: 'none',
                  }}>
                    Playback controlled by host
                  </div>
                )}
              </div>

              {/* Host controls (YouTube only) */}
              {isHost && session.videoType === 'youtube' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {playing ? (
                    <button onClick={hostPause} style={{ ...btn(true), padding: '8px 20px', fontSize: 13 }}>
                      ⏸ Pause for all
                    </button>
                  ) : (
                    <button onClick={hostPlay} style={{ ...btn(true), padding: '8px 20px', fontSize: 13 }}>
                      ▶ Play for all
                    </button>
                  )}
                  <span style={{ fontSize: 11, color: T.mt }}>
                    Sync broadcast every 5s
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Side panel ── */}
        <div style={{
          width: 220, flexShrink: 0,
          background: T.sf, borderInlineStart: `1px solid ${T.bd}`,
          display: 'flex', flexDirection: 'column', padding: 12, gap: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
            Session Info
          </div>

          {session ? (
            <>
              <InfoRow label="Type"    value={session.videoType === 'youtube' ? '▶ YouTube' : '⬤ Twitch'} />
              <InfoRow label="Viewers" value={String(viewerCount)} />
              <InfoRow label="Status"  value={playing ? '▶ Playing' : '⏸ Paused'} color={playing ? T.ac : T.mt} />
              <InfoRow label="Host"    value={session.startedBy === api.userId ? 'You' : 'Channel member'} />

              {session.videoType === 'youtube' && (
                <div style={{ marginTop: 8 }}>
                  <a
                    href={session.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: T.ac, textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    ↗ Open on YouTube
                  </a>
                </div>
              )}

              {!isHost && (
                <div style={{ marginTop: 'auto', padding: '8px 10px', background: T.sf2, borderRadius: 'var(--radius-md)', fontSize: 11, color: T.mt, lineHeight: 1.5 }}>
                  The host controls playback. Your player will sync automatically.
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}>Enter a URL and start a session.</p>
              <p style={{ margin: 0 }}>Supported:<br />• YouTube videos<br />• YouTube Shorts<br />• Twitch channels</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Small helper ─────────────────────────────────────────

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: T.mt }}>{label}</span>
      <span style={{ color: color || T.tx, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
