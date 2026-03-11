/**
 * useVoice — VoiceEngine class + React hook wrapper.
 * Handles WebRTC peer connections, Web Audio (5-band EQ, VAD), PTT, video, screen share.
 */
import { useState, useEffect, useRef } from 'react';
import { sframeService } from '../services/SFrameService';
import { deriveChannelKeyBytes } from '../crypto/mls';

// ─── Types ────────────────────────────────────────────────

export type VoiceMode = 'vad' | 'ptt';

export type VoiceEventType =
  | 'joined' | 'left' | 'error'
  | 'mute_changed' | 'deafen_changed' | 'speaking_changed' | 'level'
  | 'video_started' | 'video_stopped'
  | 'screen_started' | 'screen_stopped'
  | 'peer_stream' | 'peer_video' | 'peer_left' | 'ice_candidate'
  | 'sframe_key_update';

export interface VoiceEvent {
  type: VoiceEventType;
  channelId?: string;
  muted?: boolean;
  deafened?: boolean;
  speaking?: boolean;
  level?: number;
  stream?: MediaStream;
  track?: MediaStreamTrack;
  peerId?: string;
  candidate?: RTCIceCandidate;
  message?: string;
}

export interface VoiceState {
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  sframeActive: boolean;
  audioLevel: number;
  streams: Map<string, MediaStream>;
  peerKeyIds: Map<string, number>;
}

// ─── VoiceEngine class ────────────────────────────────────

export class VoiceEngine {
  peers: Map<string, RTCPeerConnection>;
  streams: Map<string, MediaStream>;
  localStream: MediaStream | null;
  videoStream: MediaStream | null;
  screenStream: MediaStream | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  gainNode: GainNode | null;
  eqNodes: Record<number, BiquadFilterNode>;
  channelId: string | null;
  mode: VoiceMode;
  sensitivity: number;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  inputGain: number;
  outputGain: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  sframeActive: boolean;
  peerKeyIds: Map<string, number>;
  pttKey: string;
  pttDown: boolean;
  private listeners: Set<(e: VoiceEvent) => void>;
  private _vadLoop: number | null;
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;

  constructor() {
    this.peers = new Map();
    this.streams = new Map();
    this.localStream = null;
    this.videoStream = null;
    this.screenStream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.gainNode = null;
    this.eqNodes = {};
    this.channelId = null;
    this.mode = (localStorage.getItem('d_vmode') as VoiceMode) || 'vad';
    this.sensitivity = parseFloat(localStorage.getItem('d_vsens') || '0.025');
    this.muted = false;
    this.deafened = false;
    this.speaking = false;
    this.videoEnabled = false;
    this.screenSharing = false;
    this.inputGain = parseInt(localStorage.getItem('d_inputVol') || '100') / 100;
    this.outputGain = parseInt(localStorage.getItem('d_outputVol') || '100') / 100;
    this.noiseSuppression = localStorage.getItem('d_noiseSup') !== 'false';
    this.echoCancellation = localStorage.getItem('d_echoCan') !== 'false';
    this.autoGainControl = localStorage.getItem('d_agc') !== 'false';
    this.sframeActive = false;
    this.peerKeyIds = new Map();
    this.pttKey = localStorage.getItem('d_pttkey') || '`';
    this.pttDown = false;
    this.listeners = new Set();
    this._vadLoop = null;
    this._onKeyDown = (e) => {
      if (this.mode === 'ptt' && e.key === this.pttKey && !this.pttDown) {
        this.pttDown = true;
        this._setMicEnabled(true);
      }
    };
    this._onKeyUp = (e) => {
      if (this.mode === 'ptt' && e.key === this.pttKey) {
        this.pttDown = false;
        this._setMicEnabled(false);
      }
    };
  }

  emit(type: VoiceEventType, data: Omit<VoiceEvent, 'type'>): void {
    this.listeners.forEach(fn => fn({ type, ...data }));
  }

  onEvent(fn: (e: VoiceEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async join(channelId: string): Promise<boolean> {
    this.channelId = channelId;
    try {
      const deviceId = localStorage.getItem('d_audioIn');
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: this.echoCancellation,
          noiseSuppression: this.noiseSuppression,
          autoGainControl: this.autoGainControl,
          ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
        },
      };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.localStream);
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.inputGain;
      // 5-band EQ
      const freqs = [60, 250, 1000, 4000, 16000];
      let lastNode: AudioNode = src;
      freqs.forEach(f => {
        const eq = this.audioCtx!.createBiquadFilter();
        eq.type = f === 60 ? 'lowshelf' : f === 16000 ? 'highshelf' : 'peaking';
        eq.frequency.value = f;
        eq.gain.value = parseFloat(localStorage.getItem('d_eq_' + (f >= 1000 ? (f / 1000) + 'k' : f)) || '0');
        eq.Q.value = 1.4;
        lastNode.connect(eq);
        this.eqNodes[f] = eq;
        lastNode = eq;
      });
      lastNode.connect(this.gainNode);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.gainNode.connect(this.analyser);
      this._startVAD();
      if (this.mode === 'ptt') this._setMicEnabled(false);
      document.addEventListener('keydown', this._onKeyDown);
      document.addEventListener('keyup', this._onKeyUp);
      this.emit('joined', { channelId });
      return true;
    } catch (err) {
      console.error('Mic denied:', err);
      this.emit('error', { message: 'Microphone access denied' });
      return false;
    }
  }

  leave(): void {
    sframeService.cleanup();
    this.sframeActive = false;
    this.peerKeyIds.clear();
    this.peers.forEach(pc => pc.close());
    this.peers.clear();
    this.streams.clear();
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
    if (this.videoStream) { this.videoStream.getTracks().forEach(t => t.stop()); this.videoStream = null; this.videoEnabled = false; }
    if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; this.screenSharing = false; }
    if (this.audioCtx) { this.audioCtx.close(); this.audioCtx = null; }
    if (this._vadLoop) { cancelAnimationFrame(this._vadLoop); this._vadLoop = null; }
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.channelId = null;
    this.speaking = false;
    this.emit('left', {});
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this._setMicEnabled(!this.muted);
    this.emit('mute_changed', { muted: this.muted });
  }

  toggleDeafen(): void {
    this.deafened = !this.deafened;
    this.streams.forEach(s => s.getAudioTracks().forEach(t => { t.enabled = !this.deafened; }));
    if (this.deafened && !this.muted) { this.muted = true; this._setMicEnabled(false); }
    if (!this.deafened && this.muted) { this.muted = false; this._setMicEnabled(true); }
    this.emit('deafen_changed', { deafened: this.deafened, muted: this.muted });
  }

  _setMicEnabled(on: boolean): void {
    if (this.localStream) this.localStream.getAudioTracks().forEach(t => { t.enabled = on && !this.muted; });
  }

  setEQ(freq: string, gain: number): void {
    const freqMap: Record<string, number> = { '60': 60, '250': 250, '1k': 1000, '4k': 4000, '16k': 16000 };
    const f = freqMap[freq] || parseInt(freq);
    if (this.eqNodes[f]) this.eqNodes[f].gain.value = gain;
  }

  setInputDevice(deviceId: string): void {
    localStorage.setItem('d_audioIn', deviceId);
    // Will apply on next join
  }

  setOutputDevice(deviceId: string): void {
    localStorage.setItem('d_audioOut', deviceId);
    document.querySelectorAll<HTMLMediaElement>('audio[id^="voice-"],video[id^="video-"]').forEach(el => {
      if ((el as any).setSinkId) (el as any).setSinkId(deviceId).catch(() => {});
    });
  }

  async startVideo(): Promise<MediaStream | null> {
    try {
      const camId = localStorage.getItem('d_videoIn');
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          ...(camId && camId !== 'default' ? { deviceId: { exact: camId } } : {}),
        },
      };
      this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoEnabled = true;
      this.videoStream.getVideoTracks().forEach(track => {
        this.peers.forEach(pc => pc.addTrack(track, this.videoStream!));
      });
      this.emit('video_started', { stream: this.videoStream });
      return this.videoStream;
    } catch (err) {
      console.error('Camera denied:', err);
      this.emit('error', { message: 'Camera access denied' });
      return null;
    }
  }

  stopVideo(): void {
    if (this.videoStream) { this.videoStream.getTracks().forEach(t => t.stop()); this.videoStream = null; }
    this.videoEnabled = false;
    this.emit('video_stopped', {});
  }

  async startScreenShare(): Promise<MediaStream | null> {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } as any, audio: true });
      this.screenSharing = true;
      this.screenStream.getVideoTracks()[0].onended = () => this.stopScreenShare();
      this.screenStream.getTracks().forEach(track => {
        this.peers.forEach(pc => pc.addTrack(track, this.screenStream!));
      });
      this.emit('screen_started', { stream: this.screenStream });
      return this.screenStream;
    } catch (err) {
      console.error('Screen share denied:', err);
      return null;
    }
  }

  stopScreenShare(): void {
    if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }
    this.screenSharing = false;
    this.emit('screen_stopped', {});
  }

  private _startVAD(): void {
    const data = new Uint8Array(this.analyser!.frequencyBinCount);
    const check = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
      const was = this.speaking;
      if (this.mode === 'vad') {
        this.speaking = avg > this.sensitivity && !this.muted;
        if (this.speaking !== was) this.emit('speaking_changed', { speaking: this.speaking, level: avg });
      } else {
        this.speaking = this.pttDown && !this.muted;
      }
      this.emit('level', { level: avg });
      this._vadLoop = requestAnimationFrame(check);
    };
    check();
  }

  async createOffer(pid: string): Promise<RTCSessionDescriptionInit> {
    const pc = this._getOrCreatePeer(pid);
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    return o;
  }

  async handleOffer(pid: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const pc = this._getOrCreatePeer(pid);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    return a;
  }

  async handleAnswer(pid: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(pid);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async handleIceCandidate(pid: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(pid);
    if (pc && candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  _getOrCreatePeer(pid: string): RTCPeerConnection {
    if (this.peers.has(pid)) return this.peers.get(pid)!;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    if (this.localStream) this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream!));
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (e.track.kind === 'video') {
        this.emit('peer_video', { peerId: pid, stream, track: e.track });
      } else {
        this.streams.set(pid, stream);
        const outDev = localStorage.getItem('d_audioOut');
        const audio = new Audio();
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.id = `voice-${pid}`;
        audio.volume = this.outputGain;
        if (outDev && outDev !== 'default' && (audio as any).setSinkId) {
          (audio as any).setSinkId(outDev).catch(() => {});
        }
        document.body.appendChild(audio);
        this.emit('peer_stream', { peerId: pid, stream });
      }
    };
    pc.onicecandidate = (e) => { if (e.candidate) this.emit('ice_candidate', { peerId: pid, candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') this._removePeer(pid);
    };
    this.peers.set(pid, pc);
    this._setupSFrame(pc);
    return pc;
  }

  private _setupSFrame(pc: RTCPeerConnection): void {
    if (!this.channelId || !sframeService.isSupported()) return;
    const channelId = this.channelId;
    deriveChannelKeyBytes(channelId)
      .then(keyBytes => sframeService.setupEncryption(pc, keyBytes))
      .then(() => {
        this.sframeActive = true;
      })
      .catch(err => {
        console.error('[voice] SFrame setup failed:', err);
        this.sframeActive = false;
      });
  }

  handleSFrameKeyUpdate(userId: string, keyId: number, epoch: number): void {
    const MAX_U64 = 0xFFFFFFFFFFFFFFFF;
    if (epoch === MAX_U64 || epoch === -1) {
      this.peerKeyIds.delete(userId);
    } else {
      this.peerKeyIds.set(userId, keyId);
    }
    this.emit('sframe_key_update', {});
  }

  _removePeer(pid: string): void {
    const pc = this.peers.get(pid);
    if (pc) pc.close();
    this.peers.delete(pid);
    this.streams.delete(pid);
    const el = document.getElementById(`voice-${pid}`);
    if (el) el.remove();
    this.emit('peer_left', { peerId: pid });
  }
}

// ─── Singleton ────────────────────────────────────────────

export const voice = new VoiceEngine();

// ─── Hook ─────────────────────────────────────────────────

export function useVoice() {
  const [state, setState] = useState<VoiceState>({
    channelId: null,
    muted: false,
    deafened: false,
    speaking: false,
    videoEnabled: false,
    screenSharing: false,
    sframeActive: false,
    audioLevel: 0,
    streams: new Map(),
    peerKeyIds: new Map(),
  });

  // Keep a ref to force Map identity change on peer updates
  const streamsRef = useRef<Map<string, MediaStream>>(voice.streams);

  useEffect(() => {
    const unsub = voice.onEvent((e) => {
      switch (e.type) {
        case 'joined':
          setState(s => ({ ...s, channelId: e.channelId ?? voice.channelId }));
          break;
        case 'left':
          setState(s => ({ ...s, channelId: null, muted: false, deafened: false, speaking: false, videoEnabled: false, screenSharing: false, sframeActive: false, audioLevel: 0, streams: new Map(), peerKeyIds: new Map() }));
          break;
        case 'mute_changed':
          setState(s => ({ ...s, muted: e.muted ?? voice.muted }));
          break;
        case 'deafen_changed':
          setState(s => ({ ...s, deafened: e.deafened ?? voice.deafened, muted: e.muted ?? voice.muted }));
          break;
        case 'speaking_changed':
          setState(s => ({ ...s, speaking: e.speaking ?? voice.speaking }));
          break;
        case 'level':
          setState(s => ({ ...s, audioLevel: e.level ?? 0 }));
          break;
        case 'video_started':
          setState(s => ({ ...s, videoEnabled: true }));
          break;
        case 'video_stopped':
          setState(s => ({ ...s, videoEnabled: false }));
          break;
        case 'screen_started':
          setState(s => ({ ...s, screenSharing: true }));
          break;
        case 'screen_stopped':
          setState(s => ({ ...s, screenSharing: false }));
          break;
        case 'peer_stream':
        case 'peer_left':
          // Return new Map so consumers re-render
          setState(s => ({ ...s, streams: new Map(voice.streams) }));
          break;
        case 'sframe_key_update':
          setState(s => ({ ...s, peerKeyIds: new Map(voice.peerKeyIds) }));
          break;
      }
    });
    return unsub;
  }, []);

  return {
    ...state,
    join: (channelId: string) => voice.join(channelId),
    leave: () => voice.leave(),
    toggleMute: () => voice.toggleMute(),
    toggleDeafen: () => voice.toggleDeafen(),
    startVideo: () => voice.startVideo(),
    stopVideo: () => voice.stopVideo(),
    startScreenShare: () => voice.startScreenShare(),
    stopScreenShare: () => voice.stopScreenShare(),
    setEQ: (freq: string, gain: number) => voice.setEQ(freq, gain),
    setInputDevice: (deviceId: string) => voice.setInputDevice(deviceId),
    setOutputDevice: (deviceId: string) => voice.setOutputDevice(deviceId),
    createOffer: (pid: string) => voice.createOffer(pid),
    handleOffer: (pid: string, offer: RTCSessionDescriptionInit) => voice.handleOffer(pid, offer),
    handleAnswer: (pid: string, answer: RTCSessionDescriptionInit) => voice.handleAnswer(pid, answer),
    handleIceCandidate: (pid: string, candidate: RTCIceCandidateInit) => voice.handleIceCandidate(pid, candidate),
    engine: voice,
  };
}
