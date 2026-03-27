/**
 * VoiceService — WebRTC voice channel management for React Native.
 *
 * Uses react-native-webrtc for peer connections and media.
 * Signaling is done via the existing WebSocketService.
 *
 * Usage:
 *   const svc = new VoiceService(ws, channelId, userId);
 *   await svc.join();
 *   svc.setMuted(true);
 *   svc.setSpeaker(true);
 *   await svc.leave();
 */

import {
  mediaDevices,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
} from 'react-native-webrtc';
import { WebSocketService } from './WebSocketService';

// ── SFrame helpers (AES-256-GCM, matching web client) ─────────────────────────

/** HKDF-SHA256 key derivation — matches web client's deriveChannelKeyBytes exactly. */
async function deriveChannelKeyBytes(channelId: string): Promise<Uint8Array> {
  try {
    const QuickCrypto = require('react-native-quick-crypto');
    const ikm = Buffer.from(`discreet:${channelId}:0`);
    const salt = Buffer.from('discreet-mls-v1');
    const info = Buffer.from(`discreet:${channelId}:0`);
    return new Uint8Array(QuickCrypto.hkdfSync('sha256', ikm, salt, info, 32));
  } catch {
    const enc = new TextEncoder();
    const salt = enc.encode('discreet-mls-v1');
    const info = enc.encode(`discreet:${channelId}:0`);
    const mat = await crypto.subtle.importKey(
      'raw', enc.encode(`discreet:${channelId}:0`), 'HKDF', false, ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info }, mat, 256,
    );
    return new Uint8Array(bits);
  }
}

/** Derive 32-byte key commitment tag for a channel (info suffix ":commit"). */
async function deriveChannelCommitment(channelId: string): Promise<Uint8Array> {
  try {
    const QuickCrypto = require('react-native-quick-crypto');
    const ikm = Buffer.from(`discreet:${channelId}:0`);
    const salt = Buffer.from('discreet-mls-v1');
    const info = Buffer.from(`discreet:${channelId}:0:commit`);
    return new Uint8Array(QuickCrypto.hkdfSync('sha256', ikm, salt, info, 32));
  } catch {
    const enc = new TextEncoder();
    const salt = enc.encode('discreet-mls-v1');
    const info = enc.encode(`discreet:${channelId}:0:commit`);
    const mat = await crypto.subtle.importKey(
      'raw', enc.encode(`discreet:${channelId}:0`), 'HKDF', false, ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info }, mat, 256,
    );
    return new Uint8Array(bits);
  }
}

/** Constant-time comparison of two byte arrays. */
function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Import raw 256-bit key for AES-GCM. */
async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(rawKey.buffer),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a single audio frame.
 * Wire format: [12-byte IV | AES-GCM ciphertext + 16-byte tag]
 * IV = 8 random bytes + 4-byte monotonic counter (big-endian).
 */
async function encryptAudioFrame(
  plaintext: Uint8Array,
  key: CryptoKey,
  counter: number,
): Promise<{ encrypted: Uint8Array; nextCounter: number }> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv.subarray(0, 8));
  const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
  view.setUint32(8, counter, false);

  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv.buffer) },
    key,
    plaintext,
  );
  const ctArr = new Uint8Array(ct);

  const out = new Uint8Array(12 + ctArr.byteLength);
  out.set(iv, 0);
  out.set(ctArr, 12);

  return { encrypted: out, nextCounter: counter + 1 };
}

/**
 * Decrypt a single audio frame.
 * Tries currentKey first, then previousKey (2-second rotation overlap).
 */
async function decryptAudioFrame(
  frame: Uint8Array,
  currentKey: CryptoKey,
  previousKey: CryptoKey | null,
): Promise<Uint8Array | null> {
  if (frame.byteLength < 28) return null;           // 12 IV + 16 tag minimum
  const iv = frame.slice(0, 12);
  const ct = frame.slice(12);

  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv.buffer) },
      currentKey,
      ct,
    );
    return new Uint8Array(pt);
  } catch {
    if (!previousKey) return null;
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv.buffer) },
        previousKey,
        ct,
      );
      return new Uint8Array(pt);
    } catch {
      return null;
    }
  }
}

export type VoiceUser = {
  user_id: string;
  username: string;
  muted: boolean;
  deafened: boolean;
};

type VoiceEventListener = (users: VoiceUser[]) => void;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class VoiceService {
  private ws:         WebSocketService;
  private channelId:  string;
  private userId:     string;

  private pc:          RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private muted       = false;
  private speakerOn   = false;

  // Map of peerId -> RTCPeerConnection for multi-user voice
  private peers: Map<string, RTCPeerConnection> = new Map();

  private listeners: VoiceEventListener[] = [];
  private voiceUsers: VoiceUser[] = [];

  // ── SFrame state ──
  sframeActive = false;
  private sframeKey:      CryptoKey | null = null;
  private sframePrevKey:  CryptoKey | null = null;
  private sframeCounter   = 0;
  private sframeRotationTimer: ReturnType<typeof setTimeout> | null = null;
  peerKeyIds: Map<string, number> = new Map();

  // WS unsubscribe handles
  private wsUnsubs: Array<() => void> = [];

  constructor(ws: WebSocketService, channelId: string, userId: string) {
    this.ws        = ws;
    this.channelId = channelId;
    this.userId    = userId;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async join(): Promise<void> {
    // Get local audio
    this.localStream = await mediaDevices.getUserMedia({ audio: true, video: false }) as MediaStream;

    // Derive SFrame encryption key
    await this.setupSFrame();

    // Subscribe to WS voice events
    this.subscribeWsEvents();

    // Tell the server we're joining
    this.ws.send({ type: 'voice_join', channel_id: this.channelId });
  }

  async leave(): Promise<void> {
    this.ws.send({ type: 'voice_leave', channel_id: this.channelId });
    this.sframeCleanup();
    this.cleanup();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
    // Notify server of mute state change
    this.ws.send({ type: 'voice_state', channel_id: this.channelId, muted, deafened: false });
  }

  setSpeaker(on: boolean): void {
    this.speakerOn = on;
    // Try InCallManager if available (optional dep)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const InCallManager = require('react-native-incall-manager').default;
      InCallManager.setSpeakerphoneOn(on);
    } catch {
      // InCallManager not installed — speaker toggle is a no-op
    }
  }

  isMuted(): boolean { return this.muted; }
  isSpeakerOn(): boolean { return this.speakerOn; }

  onUsersChanged(fn: VoiceEventListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  // ── WebSocket signaling ────────────────────────────────────────────────────

  private subscribeWsEvents(): void {
    // voice_state — updated list of who's in the channel
    const onState = (evt: any) => {
      if (evt.channel_id !== this.channelId) return;
      if (Array.isArray(evt.users)) {
        this.voiceUsers = evt.users as VoiceUser[];
        this.emitUsers();
      } else if (evt.user_id) {
        // Single user state update
        const idx = this.voiceUsers.findIndex(u => u.user_id === evt.user_id);
        const updated: VoiceUser = {
          user_id:  evt.user_id,
          username: evt.username || evt.user_id.slice(0, 8),
          muted:    evt.muted    ?? false,
          deafened: evt.deafened ?? false,
        };
        if (idx >= 0) {
          const next = [...this.voiceUsers];
          next[idx] = updated;
          this.voiceUsers = next;
        } else {
          this.voiceUsers = [...this.voiceUsers, updated];
        }
        this.emitUsers();
      }
    };

    // voice_join — another user joined
    const onJoin = (evt: any) => {
      if (evt.channel_id !== this.channelId) return;
      if (!evt.user_id || this.voiceUsers.some(u => u.user_id === evt.user_id)) return;
      this.voiceUsers = [...this.voiceUsers, {
        user_id:  evt.user_id,
        username: evt.username || evt.user_id.slice(0, 8),
        muted:    false,
        deafened: false,
      }];
      this.emitUsers();
      // Initiate peer connection to new participant
      this.createPeerOffer(evt.user_id);
    };

    // voice_leave — user left
    const onLeave = (evt: any) => {
      if (evt.channel_id !== this.channelId) return;
      this.voiceUsers = this.voiceUsers.filter(u => u.user_id !== evt.user_id);
      this.emitUsers();
      const peer = this.peers.get(evt.user_id);
      if (peer) { peer.close(); this.peers.delete(evt.user_id); }
    };

    // voice_sdp — SDP offer/answer from a peer
    const onSdp = async (evt: any) => {
      if (evt.channel_id !== this.channelId) return;
      const peerId = evt.from_user_id;
      if (!peerId) return;

      let peer = this.peers.get(peerId);
      if (!peer) {
        peer = this.createPeerConnection(peerId);
      }

      try {
        await peer.setRemoteDescription(new RTCSessionDescription({ type: evt.sdp_type, sdp: evt.sdp }));
        if (evt.sdp_type === 'offer') {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.ws.send({
            type:        'voice_sdp',
            channel_id:  this.channelId,
            to_user_id:  peerId,
            sdp_type:    'answer',
            sdp:         answer.sdp,
          });
        }
      } catch (e) {
        console.warn('[voice] SDP error:', e);
      }
    };

    // voice_ice — ICE candidate from a peer
    const onIce = async (evt: any) => {
      if (evt.channel_id !== this.channelId) return;
      const peerId = evt.from_user_id;
      if (!peerId) return;
      const peer = this.peers.get(peerId);
      if (!peer) return;
      try {
        await peer.addIceCandidate(new RTCIceCandidate(evt.candidate));
      } catch (e) {
        console.warn('[voice] ICE error:', e);
      }
    };

    this.ws.on('voice_state', onState);
    this.ws.on('VOICE_STATE', onState);
    this.ws.on('voice_join',  onJoin);
    this.ws.on('VOICE_JOIN',  onJoin);
    this.ws.on('voice_leave', onLeave);
    this.ws.on('VOICE_LEAVE', onLeave);
    this.ws.on('voice_sdp',   onSdp);
    this.ws.on('voice_ice',   onIce);

    // SFrame key updates
    const onSFrameKey = (evt: any) => {
      if (evt.channel_id !== this.channelId) return;
      this.handleSFrameKeyUpdate(evt.user_id, evt.key_id, evt.epoch);
    };
    this.ws.on('voice_sframe_key_update', onSFrameKey);

    // Store unsub handles if WebSocketService supports it; otherwise we rely on destroy()
    // (WebSocketService doesn't expose off(), so cleanup is handled by destroy() or leaving)
  }

  // ── WebRTC peer management ─────────────────────────────────────────────────

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        peer.addTrack(track, this.localStream!);
      });
    }

    // ICE candidate relay
    peer.addEventListener('icecandidate', (e: any) => {
      if (e.candidate) {
        this.ws.send({
          type:        'voice_ice',
          channel_id:  this.channelId,
          to_user_id:  peerId,
          candidate:   e.candidate,
        });
      }
    });

    // Connection state monitoring
    peer.addEventListener('connectionstatechange', () => {
      const state = (peer as any).connectionState;
      if (state === 'failed' || state === 'disconnected') {
        console.warn(`[voice] peer ${peerId} ${state}`);
      }
    });

    this.peers.set(peerId, peer);
    return peer;
  }

  private async createPeerOffer(peerId: string): Promise<void> {
    const peer = this.createPeerConnection(peerId);
    try {
      const offer = await peer.createOffer({ offerToReceiveAudio: true } as any);
      await peer.setLocalDescription(offer);
      this.ws.send({
        type:        'voice_sdp',
        channel_id:  this.channelId,
        to_user_id:  peerId,
        sdp_type:    'offer',
        sdp:         offer.sdp,
      });
    } catch (e) {
      console.warn('[voice] offer error:', e);
    }
  }

  // ── SFrame encryption ────────────────────────────────────────────────────

  private async setupSFrame(): Promise<void> {
    try {
      const rawKey = await deriveChannelKeyBytes(this.channelId);
      this.sframeKey = await importAesKey(rawKey);
      this.sframeCounter = 0;
      this.sframeActive = true;
      console.log('[voice] SFrame encryption active');
    } catch (e) {
      console.warn('[voice] SFrame setup failed, continuing without E2EE:', e);
      this.sframeActive = false;
    }
  }

  /** Rotate to a new key (2-second overlap for in-flight frames). */
  async rotateKey(newRawKey: Uint8Array): Promise<void> {
    if (this.sframeRotationTimer) clearTimeout(this.sframeRotationTimer);
    this.sframePrevKey = this.sframeKey;
    this.sframeKey = await importAesKey(newRawKey);
    this.sframeCounter = 0;

    this.sframeRotationTimer = setTimeout(() => {
      this.sframePrevKey = null;
      this.sframeRotationTimer = null;
    }, 2_000);
  }

  /** Encrypt a frame before sending. */
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.sframeKey) return plaintext;
    const { encrypted, nextCounter } = await encryptAudioFrame(
      plaintext, this.sframeKey, this.sframeCounter,
    );
    this.sframeCounter = nextCounter;
    return encrypted;
  }

  /** Decrypt a received frame. */
  async decrypt(frame: Uint8Array): Promise<Uint8Array | null> {
    if (!this.sframeKey) return frame;
    return decryptAudioFrame(frame, this.sframeKey, this.sframePrevKey);
  }

  /** Handle server key_id broadcasts. */
  handleSFrameKeyUpdate(userId: string, keyId: number, epoch: number): void {
    if (epoch === 0xFFFFFFFF || epoch === Number.MAX_SAFE_INTEGER) {
      // User removed
      this.peerKeyIds.delete(userId);
    } else {
      this.peerKeyIds.set(userId, keyId);
    }
  }

  private sframeCleanup(): void {
    this.sframeActive = false;
    this.sframeKey = null;
    this.sframePrevKey = null;
    this.sframeCounter = 0;
    this.peerKeyIds.clear();
    if (this.sframeRotationTimer) {
      clearTimeout(this.sframeRotationTimer);
      this.sframeRotationTimer = null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private emitUsers(): void {
    this.listeners.forEach(fn => fn([...this.voiceUsers]));
  }

  private cleanup(): void {
    // Stop local audio
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;

    // Close all peer connections
    this.peers.forEach(peer => peer.close());
    this.peers.clear();

    this.voiceUsers = [];
    this.emitUsers();

    // Reset speaker to earpiece
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const InCallManager = require('react-native-incall-manager').default;
      InCallManager.setSpeakerphoneOn(false);
      InCallManager.stop();
    } catch {}
  }
}
