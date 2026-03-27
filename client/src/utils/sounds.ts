/**
 * sounds.ts — Notification sound synthesizer.
 *
 * All sounds are generated client-side via the Web Audio API.
 * Zero external files, zero network requests, zero tracking.
 * Each sound is under 300ms and uses minimal CPU.
 */

type SoundVariant = 'default' | 'chime' | 'pop' | 'bell' | 'none';
type SoundCategory = 'dm' | 'server' | 'mention';

let _ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!_ctx) _ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return _ctx;
}

function getVolume(): number {
  return parseFloat(localStorage.getItem('d_notif_vol') || '0.3');
}

/** Synthesize a sound variant. Returns immediately (fire-and-forget). */
function synthesize(variant: SoundVariant): void {
  if (variant === 'none') return;
  try {
    const ctx = getCtx();
    const vol = getVolume();
    const t = ctx.currentTime;

    if (variant === 'default') {
      // Classic two-tone ascending blip
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(1100, t + 0.05);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.start(t); osc.stop(t + 0.15);
    } else if (variant === 'chime') {
      // Three-note ascending chime (C5→E5→G5)
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain); gain.connect(ctx.destination);
        const offset = i * 0.08;
        osc.frequency.setValueAtTime(freq, t + offset);
        gain.gain.setValueAtTime(vol * 0.7, t + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.15);
        osc.start(t + offset); osc.stop(t + offset + 0.15);
      });
    } else if (variant === 'pop') {
      // Short percussive pop with quick frequency drop
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.start(t); osc.stop(t + 0.1);
    } else if (variant === 'bell') {
      // Rich bell-like tone with harmonics
      [1, 2, 3].forEach((harmonic) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(440 * harmonic, t);
        const hVol = vol / (harmonic * 1.5);
        gain.gain.setValueAtTime(hVol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t); osc.stop(t + 0.4);
      });
    }
  } catch { /* AudioContext not available */ }
}

/** Get the user's selected sound variant for a category. */
function getVariant(category: SoundCategory): SoundVariant {
  const key = `d_sound_${category}`;
  const val = localStorage.getItem(key);
  if (val === 'chime' || val === 'pop' || val === 'bell' || val === 'none') return val;
  return 'default';
}

/**
 * Play a notification sound, respecting the user's per-category preference.
 * Categories: 'dm', 'server', 'mention'.
 */
export function playNotifSound(category: SoundCategory): void {
  // Global mute check
  if (localStorage.getItem('d_sounds') === 'false') return;
  if (localStorage.getItem('d_mute_sounds') === 'true') return;
  synthesize(getVariant(category));
}

/** Play a specific sound variant (for preview in settings). */
export function previewSound(variant: SoundVariant): void {
  synthesize(variant);
}

/** All available sound options for dropdowns. */
export const SOUND_OPTIONS: { value: SoundVariant; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'chime',   label: 'Chime' },
  { value: 'pop',     label: 'Pop' },
  { value: 'bell',    label: 'Bell' },
  { value: 'none',    label: 'None' },
];
