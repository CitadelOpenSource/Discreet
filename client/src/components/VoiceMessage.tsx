/**
 * VoiceMessage — Voice recording and playback components.
 *
 * VoiceRecorder: inline recording bar with live waveform + timer.
 *   Press mic button → shows recorder bar → cancel or send.
 *
 * VoicePlayer: inline playback widget with waveform bars + duration.
 *   Click play → fetches + plays audio. Right-click → save as .opus.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { T } from '../theme';

// ─── Shared helpers ─────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function WaveformBars({ data, progress = 1, color, height = 28 }: {
  data: number[]; progress?: number; color: string; height?: number;
}) {
  const barCount = Math.min(data.length, 40);
  const step = Math.max(1, Math.floor(data.length / barCount));
  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    bars.push((data[Math.min(i * step, data.length - 1)] || 0) / 255);
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1.5, height }}>
      {bars.map((amp, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 1.5, transition: 'height 0.1s',
          height: Math.max(3, amp * height),
          background: i / barCount <= progress ? color : `${color}44`,
        }} />
      ))}
    </div>
  );
}

// ─── VoiceRecorder ──────────────────────────────────────────────────────

const MAX_RECORD_MS = 120_000;

export function VoiceRecorder({ onSend, onCancel }: {
  onSend: (blob: Blob, durationMs: number, waveform: number[]) => void;
  onCancel: () => void;
}) {
  const [duration, setDuration] = useState(0);
  const [liveWf, setLiveWf] = useState<number[]>([]);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const t0 = useRef(0);
  const analyser = useRef<AnalyserNode | null>(null);
  const raf = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const samples = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const ctxRef = useRef<AudioContext | null>(null);

  const stop = useCallback(() => {
    clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    if (recRef.current?.state === 'recording') recRef.current.stop();
    stream.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close().catch(() => {});
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        // Request microphone — browser will show permission prompt if needed.
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (dead) { s.getTracks().forEach(t => t.stop()); return; }
        stream.current = s;

        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(s);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        analyser.current = an;

        const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus' : 'audio/webm';

        const rec = new MediaRecorder(s, { mimeType: mime });
        recRef.current = rec;
        chunks.current = [];

        rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
        rec.onstop = () => {
          const blob = new Blob(chunks.current, { type: 'audio/ogg' });
          const elapsed = Date.now() - t0.current;
          const raw = samples.current;
          const bc = 40, st = Math.max(1, Math.floor(raw.length / bc));
          const wf: number[] = [];
          for (let i = 0; i < bc; i++) wf.push(raw[Math.min(i * st, raw.length - 1)] || 0);
          onSend(blob, elapsed, wf);
          ctx.close().catch(() => {});
        };

        t0.current = Date.now();
        rec.start(100);

        timer.current = setInterval(() => {
          const el = Date.now() - t0.current;
          setDuration(el);
          if (el >= MAX_RECORD_MS) stop();
        }, 100);

        const buf = new Uint8Array(an.frequencyBinCount);
        const draw = () => {
          an.getByteFrequencyData(buf);
          const avg = Math.round(buf.reduce((a, b) => a + b, 0) / buf.length);
          samples.current.push(avg);
          setLiveWf(p => [...p.slice(-39), avg]);
          raf.current = requestAnimationFrame(draw);
        };
        raf.current = requestAnimationFrame(draw);
      } catch {
        onCancel();
      }
    })();
    return () => { dead = true; stop(); };
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
      background: 'rgba(255,71,87,0.06)', borderTop: `1px solid ${T.bd}` }}>
      <div style={{ width: 10, height: 10, borderRadius: 5, background: '#ff4757',
        animation: 'pulse 1s infinite' }} />
      <span style={{ fontSize: 14, fontWeight: 700, color: T.tx, fontVariantNumeric: 'tabular-nums',
        minWidth: 42 }}>{formatDuration(duration)}</span>
      <div style={{ flex: 1 }}>
        <WaveformBars data={liveWf.length ? liveWf : [0]} color="#ff4757" height={24} />
      </div>
      <div onClick={() => { stop(); onCancel(); }}
        style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: T.mt,
          fontSize: 12, fontWeight: 600, border: `1px solid ${T.bd}` }}>Cancel</div>
      <div onClick={stop}
        style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: '#000',
          fontWeight: 700, fontSize: 12, background: `linear-gradient(135deg,${T.ac},${T.ac2})` }}>Send</div>
    </div>
  );
}

// ─── VoicePlayer ────────────────────────────────────────────────────────

export function VoicePlayer({ audioUrl, durationMs, waveform }: {
  audioUrl: string; durationMs: number; waveform?: number[];
}) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef(0);

  const wf = waveform?.length ? waveform
    : Array.from({ length: 40 }, (_, i) => 80 + Math.round(Math.sin(i * 0.5) * 60 + Math.random() * 40));

  const toggle = () => {
    if (!audioRef.current) {
      const a = new Audio(audioUrl);
      audioRef.current = a;
      a.onended = () => { setPlaying(false); setProgress(0); cancelAnimationFrame(rafRef.current); };
      a.onplay = () => {
        const tick = () => {
          if (a.duration > 0) setProgress(a.currentTime / a.duration);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      };
    }
    if (playing) {
      audioRef.current.pause();
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const save = () => {
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = 'voice_message.opus';
    a.click();
  };

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); audioRef.current?.pause(); }, []);

  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); save(); }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', background: T.sf2, borderRadius: 16,
        border: `1px solid ${T.bd}`, marginTop: 4, maxWidth: 300 }}
    >
      <div onClick={toggle}
        style={{ width: 32, height: 32, borderRadius: 16,
          background: `linear-gradient(135deg,${T.ac},${T.ac2})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#000', fontWeight: 700,
          marginLeft: playing ? 0 : 2 }}>{playing ? '⏸' : '▶'}</span>
      </div>
      <WaveformBars data={wf} progress={progress} color={T.ac} height={28} />
      <span style={{ fontSize: 11, color: T.mt, fontVariantNumeric: 'tabular-nums',
        flexShrink: 0 }}>{formatDuration(durationMs)}</span>
    </div>
  );
}
