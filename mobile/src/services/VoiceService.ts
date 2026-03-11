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

    // Subscribe to WS voice events
    this.subscribeWsEvents();

    // Tell the server we're joining
    this.ws.send({ type: 'voice_join', channel_id: this.channelId });
  }

  async leave(): Promise<void> {
    this.ws.send({ type: 'voice_leave', channel_id: this.channelId });
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
