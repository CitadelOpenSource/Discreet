/**
 * GuestMeetingJoin — Standalone page for unauthenticated meeting join via /meet/:code.
 *
 * Flow:
 *   join      — name entry form
 *   waiting   — "Waiting for host approval…"
 *   conference — live voice/video (no chat, no server access)
 *   rejected  — host declined
 *   ended     — meeting ended or guest left
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── Constants ─────────────────────────────────────────────
const WS_BASE = window.location.origin.replace(/^http/, 'ws');
const SK_NAME = 'gm_display_name';
const SK_CODE = 'gm_meeting_code';

// ── Types ─────────────────────────────────────────────────
type Phase = 'join' | 'waiting' | 'conference' | 'rejected' | 'ended';

interface PeerEntry { name: string; stream: MediaStream | null; }

// ── Minimal theme ─────────────────────────────────────────
const C = {
  bg:  '#07090f',
  sf:  '#111320',
  sf2: '#1a1d2e',
  bd:  'rgba(255,255,255,0.08)',
  tx:  '#e0e4ea',
  mt:  '#666b7a',
  ac:  '#00d4aa',
  ac2: '#0096ff',
  err: '#ed4245',
};

// ── Helpers ───────────────────────────────────────────────
function formatCode(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length >= 6 ? `${c.slice(0, 3)}-${c.slice(3, 6)}` : c;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

// ── ParticipantTile ───────────────────────────────────────
function ParticipantTile({ name, stream, muted, self }: {
  name: string; stream?: MediaStream | null; muted?: boolean; self?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div style={{
      position: 'relative', background: C.sf2, borderRadius: 12, overflow: 'hidden',
      aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `2px solid transparent`,
    }}>
      {stream ? (
        <video ref={videoRef} autoPlay playsInline muted={self}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: self ? 'scaleX(-1)' : 'none' }} />
      ) : (
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: `linear-gradient(135deg,${C.ac}44,${C.ac2}44)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 700, color: C.ac,
        }}>
          {name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        background: 'rgba(0,0,0,0.65)', borderRadius: 6,
        padding: '3px 8px', fontSize: 12, fontWeight: 600, color: '#fff',
      }}>
        {name}{self ? ' (You)' : ''}
      </div>
      {muted && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: 'rgba(237,66,69,0.85)', borderRadius: 6,
          padding: '2px 6px', fontSize: 11, color: '#fff',
        }}>
          {'\uD83D\uDD07'}
        </div>
      )}
    </div>
  );
}

// ── CtrlBtn ───────────────────────────────────────────────
function CtrlBtn({ icon, label, active, activeColor, onClick }: {
  icon: string; label: string; active: boolean; activeColor: string; onClick: () => void;
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
        padding: '10px 16px', borderRadius: 12, border: 'none', minWidth: 64,
        cursor: 'pointer', transition: 'background .15s, color .15s',
        background: active ? `${activeColor}22` : hov ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        color: active ? activeColor : '#ccc',
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

// ── GuestMeetingJoin ──────────────────────────────────────
export function GuestMeetingJoin({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>(() => {
    // Auto-resume if already waiting for this code
    if (sessionStorage.getItem(SK_NAME) && sessionStorage.getItem(SK_CODE) === code) return 'waiting';
    return 'join';
  });

  const [nameInput,    setNameInput]    = useState('');
  const [displayName,  setDisplayName]  = useState(() => sessionStorage.getItem(SK_NAME) ?? '');
  const [error,        setError]        = useState('');
  const [meetingTitle, setMeetingTitle] = useState('Meeting');
  const [muted,        setMuted]        = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [localVideo,   setLocalVideo]   = useState<MediaStream | null>(null);
  const [peers,        setPeers]        = useState<Map<string, PeerEntry>>(new Map());
  const [startedAt,    setStartedAt]    = useState(0);
  const [elapsed,      setElapsed]      = useState('00:00');

  const wsRef          = useRef<WebSocket | null>(null);
  const pcMapRef       = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localAudioRef  = useRef<MediaStream | null>(null);

  const formattedCode = formatCode(code);

  // Timer
  useEffect(() => {
    if (phase !== 'conference' || !startedAt) return;
    const t = setInterval(() => setElapsed(fmtDuration(Date.now() - startedAt)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  // Cleanup on unmount
  useEffect(() => () => { cleanup(); }, []);

  // ── RTCPeerConnection factory ────────────────────────
  function makePeer(uid: string, ws: WebSocket, initiator: boolean): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcMapRef.current.set(uid, pc);

    // Add local audio tracks
    localAudioRef.current?.getTracks().forEach(t => pc.addTrack(t, localAudioRef.current!));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) ws.send(JSON.stringify({ type: 'voice_ice', to_user_id: uid, ice: candidate }));
    };

    pc.ontrack = ({ streams }) => {
      if (streams[0]) {
        setPeers(prev => {
          const m = new Map(prev);
          const entry = m.get(uid) ?? { name: uid, stream: null };
          m.set(uid, { ...entry, stream: streams[0] });
          return m;
        });
      }
    };

    if (initiator) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'voice_sdp', to_user_id: uid, sdp: offer }));
      }).catch(() => {});
    }

    return pc;
  }

  // ── WebSocket connection ─────────────────────────────
  const connectWs = useCallback((name: string) => {
    const url = `${WS_BASE}/ws/guest?meeting_code=${encodeURIComponent(code)}&display_name=${encodeURIComponent(name)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'guest_join_request', code, display_name: name }));
    };

    ws.onmessage = async (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'guest_join_approved': {
          setMeetingTitle(msg.title ?? 'Meeting');
          setStartedAt(Date.now());
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localAudioRef.current = stream;
          } catch {}
          setPhase('conference');
          break;
        }
        case 'guest_join_denied':
          setPhase('rejected');
          ws.close();
          sessionStorage.removeItem(SK_NAME);
          sessionStorage.removeItem(SK_CODE);
          break;

        case 'meeting_ended':
          cleanup();
          setPhase('ended');
          break;

        case 'voice_state': {
          const users: { id: string; display_name: string }[] = msg.users ?? [];
          setPeers(prev => {
            const next = new Map<string, PeerEntry>();
            for (const u of users) {
              next.set(u.id, prev.get(u.id) ?? { name: u.display_name, stream: null });
            }
            return next;
          });
          break;
        }
        case 'voice_join': {
          const uid = msg.user_id as string;
          const uname = (msg.display_name as string) ?? uid;
          setPeers(prev => new Map(prev).set(uid, { name: uname, stream: null }));
          makePeer(uid, ws, true);
          break;
        }
        case 'voice_leave': {
          const uid = msg.user_id as string;
          setPeers(prev => { const m = new Map(prev); m.delete(uid); return m; });
          pcMapRef.current.get(uid)?.close();
          pcMapRef.current.delete(uid);
          break;
        }
        case 'voice_sdp': {
          const uid = msg.from_user_id as string;
          let pc = pcMapRef.current.get(uid);
          if (!pc) pc = makePeer(uid, ws, false);
          if (msg.sdp?.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'voice_sdp', to_user_id: uid, sdp: answer }));
          } else if (msg.sdp?.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          }
          break;
        }
        case 'voice_ice': {
          const uid = msg.from_user_id as string;
          const pc = pcMapRef.current.get(uid);
          if (pc && msg.ice) {
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.ice)); } catch {}
          }
          break;
        }
      }
    };

    ws.onclose = () => {
      setPhase(p => (p === 'conference' || p === 'waiting') ? 'ended' : p);
    };
  }, [code]);

  // Resume WS if page reloaded mid-waiting
  useEffect(() => {
    if (phase === 'waiting') {
      const savedName = sessionStorage.getItem(SK_NAME) ?? '';
      if (savedName) connectWs(savedName);
    }
  }, []);

  // ── Cleanup ──────────────────────────────────────────
  const cleanup = useCallback(() => {
    localAudioRef.current?.getTracks().forEach(t => t.stop());
    localAudioRef.current = null;
    setLocalVideo(s => { s?.getTracks().forEach(t => t.stop()); return null; });
    for (const pc of pcMapRef.current.values()) pc.close();
    pcMapRef.current.clear();
    wsRef.current?.close();
    wsRef.current = null;
    sessionStorage.removeItem(SK_NAME);
    sessionStorage.removeItem(SK_CODE);
  }, []);

  // ── Actions ──────────────────────────────────────────
  const handleJoin = () => {
    const name = nameInput.trim();
    if (!name) { setError('Please enter your display name.'); return; }
    if (name.length > 32) { setError('Name must be 32 characters or less.'); return; }
    setDisplayName(name);
    sessionStorage.setItem(SK_NAME, name);
    sessionStorage.setItem(SK_CODE, code);
    setPhase('waiting');
    connectWs(name);
  };

  const toggleMute = () => {
    const stream = localAudioRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  };

  const toggleVideo = async () => {
    if (videoEnabled) {
      localVideo?.getVideoTracks().forEach(t => t.stop());
      for (const pc of pcMapRef.current.values()) {
        pc.getSenders().filter(s => s.track?.kind === 'video').forEach(s => pc.removeTrack(s));
      }
      setLocalVideo(null);
      setVideoEnabled(false);
    } else {
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: true });
        vs.getVideoTracks().forEach(t => {
          if (localAudioRef.current) localAudioRef.current.addTrack(t);
          for (const pc of pcMapRef.current.values()) {
            pc.addTrack(t, localAudioRef.current!);
          }
        });
        setLocalVideo(vs);
        setVideoEnabled(true);
      } catch {
        setError('Camera access denied.');
      }
    }
  };

  const handleLeave = () => {
    wsRef.current?.send(JSON.stringify({ type: 'voice_leave' }));
    cleanup();
    setPhase('ended');
  };

  // ── Render helpers ────────────────────────────────────
  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 8,
    background: C.bg, border: `1px solid ${C.bd}`, color: C.tx, fontSize: 14, outline: 'none',
    fontFamily: "'DM Sans',sans-serif",
  };
  const primaryBtn: React.CSSProperties = {
    padding: '12px 0', borderRadius: 10, border: 'none',
    background: `linear-gradient(135deg,${C.ac},${C.ac2})`,
    color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%',
  };

  // ── Join form ─────────────────────────────────────────
  if (phase === 'join') {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif", padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 400, background: C.sf, border: `1px solid ${C.bd}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
          <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.bd}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>{'📹'}</span>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: C.tx }}>Join Meeting</div>
              <div style={{ fontSize: 12, color: C.mt }}>
                Code: <span style={{ fontFamily: "'JetBrains Mono',monospace", color: C.ac, fontWeight: 700, letterSpacing: 2 }}>{formattedCode}</span>
              </div>
            </div>
          </div>

          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.mt, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
                Your Display Name
              </label>
              <input
                autoFocus
                value={nameInput}
                onChange={e => { setNameInput(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                placeholder="How should we call you?"
                maxLength={32}
                style={inp}
              />
            </div>

            {error && (
              <div style={{ fontSize: 12, color: C.err, background: `${C.err}18`, borderRadius: 6, padding: '8px 10px' }}>
                {error}
              </div>
            )}

            <button onClick={handleJoin} style={primaryBtn}>
              Join Meeting
            </button>

            <div style={{ textAlign: 'center', fontSize: 11, color: C.mt, lineHeight: 1.6 }}>
              You'll join as a guest. The host must approve your entry.<br />
              No account required — voice &amp; video only.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Waiting for approval ──────────────────────────────
  if (phase === 'waiting') {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ textAlign: 'center', maxWidth: 360, padding: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: `${C.ac}18`, border: `2px solid ${C.ac}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, margin: '0 auto 24px',
          }}>
            {'⏳'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.tx, marginBottom: 8 }}>
            Waiting for host approval
          </div>
          <div style={{ fontSize: 13, color: C.mt, lineHeight: 1.7, marginBottom: 28 }}>
            Your request to join{' '}
            <span style={{ color: C.ac, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{formattedCode}</span>
            {' '}has been sent.<br />
            The host will accept or decline shortly.
          </div>
          <button
            onClick={() => { cleanup(); setPhase('join'); }}
            style={{ padding: '10px 24px', borderRadius: 10, border: `1px solid ${C.bd}`, background: 'transparent', color: C.mt, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Rejected ──────────────────────────────────────────
  if (phase === 'rejected') {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ textAlign: 'center', maxWidth: 360, padding: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: `${C.err}18`, border: `2px solid ${C.err}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, margin: '0 auto 24px',
          }}>
            {'🚫'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.tx, marginBottom: 8 }}>Request Declined</div>
          <div style={{ fontSize: 13, color: C.mt, marginBottom: 28 }}>
            The host has declined your request to join this meeting.
          </div>
          <button
            onClick={() => { setNameInput(''); setPhase('join'); }}
            style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${C.ac},${C.ac2})`, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Ended ─────────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ textAlign: 'center', maxWidth: 360, padding: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: C.sf2, border: `1px solid ${C.bd}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, margin: '0 auto 24px',
          }}>
            {'📵'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.tx, marginBottom: 8 }}>Meeting Ended</div>
          <div style={{ fontSize: 13, color: C.mt, marginBottom: 28, lineHeight: 1.6 }}>
            This meeting has ended. Create a free account to host your own meetings.
          </div>
          <a
            href="/"
            style={{ display: 'inline-block', padding: '10px 28px', borderRadius: 10, textDecoration: 'none', background: `linear-gradient(135deg,${C.ac},${C.ac2})`, color: '#000', fontSize: 13, fontWeight: 700 }}
          >
            Create Free Account
          </a>
        </div>
      </div>
    );
  }

  // ── Conference ────────────────────────────────────────
  const peerList = Array.from(peers.entries());
  const totalPeers = peerList.length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0c14', fontFamily: "'DM Sans',sans-serif" }}>

      {/* Guest banner */}
      <div style={{
        background: `linear-gradient(90deg,${C.ac}1a,${C.ac2}1a)`,
        borderBottom: `1px solid ${C.ac}30`,
        padding: '7px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: C.ac, fontWeight: 600 }}>
          {'👤'} You're in a guest session &mdash; voice &amp; video only
        </span>
        <a
          href="/"
          style={{ fontSize: 11, color: C.ac, fontWeight: 700, textDecoration: 'none', background: `${C.ac}20`, border: `1px solid ${C.ac}40`, borderRadius: 6, padding: '3px 10px' }}
        >
          Create Free Account &rarr;
        </a>
      </div>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: '#0d0f1a',
        borderBottom: `1px solid ${C.bd}`, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16 }}>{'📹'}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{meetingTitle}</div>
            <div style={{ fontSize: 11, color: C.mt }}>{elapsed} &middot; {totalPeers + 1} participant{totalPeers !== 0 ? 's' : ''}</div>
          </div>
        </div>
        <div style={{
          background: `${C.ac}15`, border: `1px solid ${C.ac}40`,
          borderRadius: 8, padding: '4px 12px',
          fontSize: 15, fontWeight: 700, color: C.ac,
          letterSpacing: 3, fontFamily: "'JetBrains Mono',monospace",
        }}>
          {formattedCode}
        </div>
      </div>

      {/* Video grid */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 16,
        display: 'grid', gap: 12, alignContent: 'start',
        background: '#0a0c14',
        gridTemplateColumns: totalPeers === 0 ? '1fr' : totalPeers < 3 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
      }}>
        <ParticipantTile name={displayName || 'You'} stream={localVideo} muted={muted} self />
        {peerList.map(([uid, peer]) => (
          <ParticipantTile key={uid} name={peer.name} stream={peer.stream} />
        ))}
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: '14px 20px', background: '#0d0f1a',
        borderTop: `1px solid ${C.bd}`, flexShrink: 0,
      }}>
        <CtrlBtn
          active={muted} activeColor="#ed4245"
          icon={muted ? '🔇' : '🎤'} label={muted ? 'Unmute' : 'Mute'}
          onClick={toggleMute}
        />
        <CtrlBtn
          active={videoEnabled} activeColor={C.ac}
          icon={videoEnabled ? '📹' : '📷'} label={videoEnabled ? 'Stop Video' : 'Start Video'}
          onClick={toggleVideo}
        />
        <button
          onClick={handleLeave}
          style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#ed4245', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {'📵'} Leave
        </button>
      </div>
    </div>
  );
}
