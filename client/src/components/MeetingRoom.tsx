/**
 * MeetingRoom — in-app video conferencing backed by /meetings endpoints.
 *
 * Phases:
 *   lobby      — create a new meeting or join by code
 *   conference — live video call using useVoice (WebRTC)
 *
 * Exports:
 *   MeetingRoom   — the full-screen overlay component
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { T, ta } from '../theme';
import { api } from '../api/CitadelAPI';
import { voice, useVoice } from '../hooks/useVoice';

// ─── Types ────────────────────────────────────────────────

export interface MeetingRoomProps {
  onClose: () => void;
  /** Pre-populated code (e.g. from /meeting slash command). */
  initialCode?: string;
}

interface Meeting {
  id:        string;
  code:      string;
  join_code?: string;
  title:     string;
  host_id?:  string;
  password?: string;
}

interface PeerVideo {
  peerId: string;
  stream: MediaStream;
}

// ─── Helpers ──────────────────────────────────────────────

/** Format a raw meeting code as XXX-XXX for readability. */
function formatCode(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length >= 6 ? `${c.slice(0, 3)}-${c.slice(3, 6)}` : c;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

// ─── Participant tile ─────────────────────────────────────

function ParticipantTile({
  name,
  stream,
  muted,
  speaking,
  self,
}: {
  name:     string;
  stream?:  MediaStream | null;
  muted?:   boolean;
  speaking?: boolean;
  self?:    boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div style={{
      position: 'relative',
      background: '#1a1d2e',
      borderRadius: 'var(--border-radius)',
      overflow: 'hidden',
      aspectRatio: '16/9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: speaking ? `2px solid ${T.ac}` : `2px solid transparent`,
      transition: 'border-color .2s',
    }}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={self}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: self ? 'scaleX(-1)' : 'none' }}
        />
      ) : (
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: `linear-gradient(135deg, ${ta(T.ac,'44')}, ${ta(T.ac2,'44')})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 700, color: T.ac,
        }}>
          {initials}
        </div>
      )}

      {/* Name tag */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        background: 'rgba(0,0,0,0.65)', borderRadius: 6,
        padding: '3px 8px', fontSize: 12, fontWeight: 600, color: '#fff',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {speaking && <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.ac, display: 'inline-block' }} />}
        {name}{self ? ' (You)' : ''}
      </div>

      {/* Mute badge */}
      {muted && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: 'rgba(237,66,69,0.85)', borderRadius: 6,
          padding: '2px 6px', fontSize: 11, color: '#fff',
        }}>
          🔇
        </div>
      )}
    </div>
  );
}

// ─── MeetingRoom ──────────────────────────────────────────

export function MeetingRoom({ onClose, initialCode }: MeetingRoomProps) {
  // Lobby state
  const [tab,           setTab]           = useState<'create' | 'join'>(initialCode ? 'join' : 'create');
  const [titleInput,    setTitleInput]    = useState('Quick Meeting');
  const [codeInput,     setCodeInput]     = useState(initialCode ?? '');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword,  setShowPassword]  = useState(false);
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);

  // Conference state
  const [meeting,       setMeeting]       = useState<Meeting | null>(null);
  const [peerVideos,    setPeerVideos]    = useState<PeerVideo[]>([]);
  const [localVideo,    setLocalVideo]    = useState<MediaStream | null>(null);
  const [startedAt,     setStartedAt]     = useState<number>(0);
  const [elapsed,       setElapsed]       = useState('00:00');

  const vc = useVoice();
  const panelRef = useRef<HTMLDivElement>(null);

  // Timer
  useEffect(() => {
    if (!meeting) return;
    const t = setInterval(() => setElapsed(fmtDuration(Date.now() - startedAt)), 1000);
    return () => clearInterval(t);
  }, [meeting, startedAt]);

  // Listen for peer video streams
  useEffect(() => {
    const unsub = voice.onEvent((e) => {
      if (e.type === 'peer_video' && e.peerId && e.stream) {
        setPeerVideos(prev => {
          const without = prev.filter(p => p.peerId !== e.peerId!);
          return [...without, { peerId: e.peerId!, stream: e.stream! }];
        });
      }
      if (e.type === 'peer_left' && e.peerId) {
        setPeerVideos(prev => prev.filter(p => p.peerId !== e.peerId));
      }
      if (e.type === 'video_started' && e.stream) {
        setLocalVideo(e.stream);
      }
      if (e.type === 'video_stopped') {
        setLocalVideo(null);
      }
    });
    return unsub;
  }, []);

  // Leave + cleanup on unmount
  useEffect(() => {
    return () => {
      if (voice.channelId) voice.leave();
    };
  }, []);

  // ── Actions ───────────────────────────────────────────

  const enterConference = useCallback(async (m: Meeting) => {
    setMeeting(m);
    setStartedAt(Date.now());
    await voice.join(m.code);
  }, []);

  const handleCreate = async () => {
    const title = titleInput.trim() || 'Quick Meeting';
    setLoading(true);
    setError('');
    try {
      const m = await api.createMeeting(title, passwordInput.trim() || undefined);
      if (!m?.code) { setError('Failed to create meeting. Try again.'); return; }
      await enterConference(m as Meeting);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    const code = codeInput.trim().replace(/[^A-Za-z0-9]/g, '');
    if (code.length < 4) { setError('Enter a valid meeting code.'); return; }
    setLoading(true);
    setError('');
    try {
      const m = await api.joinMeeting(code, passwordInput.trim() || undefined);
      if (!m?.code) { setError(m?.message || 'Meeting not found or wrong password.'); return; }
      await enterConference(m as Meeting);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = () => {
    voice.leave();
    setMeeting(null);
    setPeerVideos([]);
    setLocalVideo(null);
    onClose();
  };

  const copyCode = () => {
    if (meeting) navigator.clipboard?.writeText(meeting.join_code || meeting.code);
  };

  const shareUrl = () => {
    if (!meeting) return;
    const code = meeting.join_code || meeting.code;
    const url = `${window.location.origin}/meet/${code}`;
    navigator.clipboard?.writeText(url);
  };

  // ── Render ────────────────────────────────────────────

  const inConference = !!meeting;

  // Compute participant display names (in real app these would come from WS presence)
  const selfName = api.username || 'You';
  const peerIds  = Array.from(vc.streams.keys());

  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 20000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-primary)',
    }}>
      <div
        ref={panelRef}
        style={{
          width: inConference ? '100%' : 440,
          height: inConference ? '100%' : 'auto',
          maxWidth: inConference ? undefined : 440,
          background: T.sf,
          borderRadius: inConference ? 0 : 16,
          border: inConference ? 'none' : `1px solid ${T.bd}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '-8px 0 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* ══════════════ LOBBY ══════════════ */}
        {!inConference && (
          <>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px', borderBottom: `1px solid ${T.bd}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>📹</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>Meeting Room</span>
              </div>
              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${T.bd}` }}>
              {(['create', 'join'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setError(''); }}
                  style={{
                    flex: 1, padding: '12px 0',
                    background: 'none', border: 'none',
                    borderBottom: tab === t ? `2px solid ${T.ac}` : '2px solid transparent',
                    color: tab === t ? T.ac : T.mt,
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    transition: 'color .15s',
                  }}
                >
                  {t === 'create' ? '+ New Meeting' : '→ Join Meeting'}
                </button>
              ))}
            </div>

            {/* Body */}
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {tab === 'create' ? (
                <>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                      Meeting Title
                    </label>
                    <input
                      autoFocus
                      value={titleInput}
                      onChange={e => setTitleInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !loading && handleCreate()}
                      placeholder="Quick Meeting"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 12px', borderRadius: 'var(--radius-md)',
                        background: T.bg, border: `1px solid ${T.bd}`,
                        color: T.tx, fontSize: 14, outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                      Password <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={passwordInput}
                        onChange={e => setPasswordInput(e.target.value)}
                        placeholder="Leave blank for open meeting"
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-md)',
                          background: T.bg, border: `1px solid ${T.bd}`,
                          color: T.tx, fontSize: 14, outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => setShowPassword(p => !p)}
                        style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 13 }}
                      >
                        {showPassword ? '🙈' : '👁'}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div style={{ fontSize: 12, color: T.err, background: `${ta(T.err,'15')}`, borderRadius: 6, padding: '8px 10px' }}>
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleCreate}
                    disabled={loading}
                    style={{
                      padding: '12px 0', borderRadius: 10, border: 'none',
                      background: loading ? T.mt : `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
                      color: '#000', fontSize: 14, fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      transition: 'opacity .15s',
                    }}
                  >
                    {loading ? 'Starting…' : '📹 Start Meeting'}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                      Meeting Code
                    </label>
                    <input
                      autoFocus
                      value={codeInput}
                      onChange={e => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 7))}
                      onKeyDown={e => e.key === 'Enter' && !loading && handleJoin()}
                      placeholder="ABC-123"
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 12px', borderRadius: 'var(--radius-md)',
                        background: T.bg, border: `1px solid ${T.bd}`,
                        color: T.ac, fontSize: 20, fontWeight: 700,
                        textAlign: 'center', letterSpacing: 4, outline: 'none',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                      Password <span style={{ fontWeight: 400, textTransform: 'none' }}>(if required)</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={passwordInput}
                        onChange={e => setPasswordInput(e.target.value)}
                        placeholder="Enter password"
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          padding: '10px 38px 10px 12px', borderRadius: 'var(--radius-md)',
                          background: T.bg, border: `1px solid ${T.bd}`,
                          color: T.tx, fontSize: 14, outline: 'none',
                        }}
                      />
                      <button
                        onClick={() => setShowPassword(p => !p)}
                        style={{ position: 'absolute', insetInlineEnd: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 13 }}
                      >
                        {showPassword ? '🙈' : '👁'}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div style={{ fontSize: 12, color: T.err, background: `${ta(T.err,'15')}`, borderRadius: 6, padding: '8px 10px' }}>
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleJoin}
                    disabled={loading}
                    style={{
                      padding: '12px 0', borderRadius: 10, border: 'none',
                      background: loading ? T.mt : `linear-gradient(135deg, ${T.ac}, ${T.ac2})`,
                      color: '#000', fontSize: 14, fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loading ? 'Joining…' : '→ Join Meeting'}
                  </button>
                </>
              )}

              <div style={{ fontSize: 11, color: T.mt, textAlign: 'center', lineHeight: 1.5 }}>
                Meetings use end-to-end encrypted WebRTC.<br />
                Video and audio never leave your device unencrypted.
              </div>
            </div>
          </>
        )}

        {/* ══════════════ CONFERENCE ══════════════ */}
        {inConference && (
          <>
            {/* Top bar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', background: '#0d0f1a',
              borderBottom: `1px solid ${T.bd}`, flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 16 }}>📹</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>{meeting.title}</div>
                  <div style={{ fontSize: 11, color: T.mt }}>{elapsed} · {peerIds.length + 1} participant{peerIds.length !== 0 ? 's' : ''}</div>
                </div>
              </div>

              {/* Join code pill + copy + share */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  onClick={copyCode}
                  title="Click to copy join code"
                  style={{
                    background: `${ta(T.ac,'15')}`, border: `1px solid ${ta(T.ac,'40')}`,
                    borderRadius: 'var(--radius-md)', padding: '6px 16px',
                    fontSize: 24, fontWeight: 700, color: T.ac,
                    letterSpacing: 4, fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                  }}
                >
                  {meeting.join_code || formatCode(meeting.code)}
                </div>
                <button
                  onClick={copyCode}
                  title="Copy join code"
                  style={{ background: `${ta(T.ac,'22')}`, border: `1px solid ${ta(T.ac,'33')}`, borderRadius: 6, color: T.ac, cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 10px' }}
                >
                  Copy
                </button>
                <button
                  onClick={shareUrl}
                  title="Copy share link"
                  style={{ background: `${ta(T.ac,'22')}`, border: `1px solid ${ta(T.ac,'33')}`, borderRadius: 6, color: T.ac, cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 10px' }}
                >
                  Share
                </button>
              </div>
            </div>

            {/* Video grid */}
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: 16,
              display: 'grid',
              gridTemplateColumns: peerIds.length === 0
                ? '1fr'
                : peerIds.length === 1
                  ? 'repeat(2, 1fr)'
                  : peerIds.length < 4
                    ? 'repeat(2, 1fr)'
                    : 'repeat(3, 1fr)',
              gap: 12,
              alignContent: 'start',
              background: '#0a0c14',
            }}>
              {/* Local tile */}
              <ParticipantTile
                name={selfName}
                stream={localVideo}
                muted={vc.muted}
                speaking={vc.speaking}
                self
              />

              {/* Remote peer tiles */}
              {peerIds.map(pid => {
                const pv = peerVideos.find(p => p.peerId === pid);
                return (
                  <ParticipantTile
                    key={pid}
                    name={pid}
                    stream={pv?.stream ?? null}
                    speaking={false}
                  />
                );
              })}
            </div>

            {/* Controls bar */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '14px 20px', background: '#0d0f1a',
              borderTop: `1px solid ${T.bd}`, flexShrink: 0,
            }}>
              {/* Mute */}
              <ControlBtn
                active={vc.muted}
                activeColor="#ed4245"
                icon={vc.muted ? '🔇' : '🎤'}
                label={vc.muted ? 'Unmute' : 'Mute'}
                onClick={() => voice.toggleMute()}
              />

              {/* Camera */}
              <ControlBtn
                active={!vc.videoEnabled}
                activeColor="#ed4245"
                icon={vc.videoEnabled ? '📹' : '📷'}
                label={vc.videoEnabled ? 'Stop Video' : 'Start Video'}
                onClick={() => vc.videoEnabled ? voice.stopVideo() : voice.startVideo()}
              />

              {/* Screen share */}
              <ControlBtn
                active={vc.screenSharing}
                activeColor={T.ac}
                icon="🖥️"
                label={vc.screenSharing ? 'Stop Share' : 'Share Screen'}
                onClick={() => vc.screenSharing ? voice.stopScreenShare() : voice.startScreenShare()}
              />

              {/* Deafen */}
              <ControlBtn
                active={vc.deafened}
                activeColor="#ed4245"
                icon={vc.deafened ? '🔕' : '🎧'}
                label={vc.deafened ? 'Undeafen' : 'Deafen'}
                onClick={() => voice.toggleDeafen()}
              />

              {/* Leave */}
              <button
                onClick={handleLeave}
                style={{
                  padding: '10px 24px', borderRadius: 10, border: 'none',
                  background: '#ed4245', color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                📵 Leave
              </button>
            </div>
          </>
        )}
      </div>

      {/* Click-outside to close lobby only */}
      {!inConference && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: -1 }}
          onClick={onClose}
        />
      )}
    </div>,
    document.body,
  );
}

// ─── ControlBtn ───────────────────────────────────────────

function ControlBtn({
  icon, label, active, activeColor, onClick,
}: {
  icon:        string;
  label:       string;
  active:      boolean;
  activeColor: string;
  onClick:     () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      title={label}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: '10px 16px', borderRadius: 'var(--border-radius)', border: 'none',
        background: active ? `${activeColor}22` : hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        color: active ? activeColor : '#ccc',
        cursor: 'pointer', transition: 'background .15s, color .15s', minWidth: 64,
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
    </button>
  );
}
