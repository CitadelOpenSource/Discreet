/**
 * WifiDirectService — Wi-Fi Direct proximity voice calls.
 *
 * PLATFORM: Android only.
 * iOS does not expose Wi-Fi Direct (WifiP2pManager) to third-party apps.
 * On iOS this module initialises as a no-op and all methods return early.
 *
 * ── Dependencies ───────────────────────────────────────────────────────────────
 *   react-native-wifi-p2p    — Wi-Fi Direct peer discovery + group management
 *   react-native-tcp-socket  — local TCP signaling server / client
 *   react-native-webrtc      — WebRTC peer connections + audio media
 *
 * ── Architecture ───────────────────────────────────────────────────────────────
 *   One device becomes the Group Owner (GO) by calling startVoiceHost().
 *   Others call connectToPeer(macAddress) then joinVoice(goIp).
 *
 *   Signaling is a newline-delimited JSON protocol over a TCP server that runs
 *   on the GO at port SIGNALING_PORT.  The GO both hosts the server and
 *   participates in the voice mesh as a normal peer.
 *
 *   Voice topology: full mesh — every participant holds an RTCPeerConnection to
 *   every other participant.  Audio is rendered natively by react-native-webrtc.
 *
 * ── Android Manifest ────────────────────────────────────────────────────────────
 *   <uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>
 *   <uses-permission android:name="android.permission.CHANGE_WIFI_STATE"/>
 *   <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE"/>
 *   <uses-permission android:name="android.permission.INTERNET"/>
 *   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
 *   <!-- Android 13+ -->
 *   <uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES"/>
 *
 * ── Signaling protocol ─────────────────────────────────────────────────────────
 *   Client → Host:
 *     { t:'join',   pid:string }
 *     { t:'offer',  from:string, to:string, sdp:string }
 *     { t:'answer', from:string, to:string, sdp:string }
 *     { t:'ice',    from:string, to:string, c:object }
 *     { t:'leave',  from:string }
 *   Host → Client:
 *     { t:'welcome', peers:string[] }   — existing participant peerIds
 *     { t:'full' }                      — room is at MAX_PARTICIPANTS
 *     { t:'peer_joined', pid:string }
 *     { t:'peer_left',   pid:string }
 *     (also relays offer / answer / ice unchanged)
 */

import { Platform, PermissionsAndroid } from 'react-native';
import WifiP2P from 'react-native-wifi-p2p';
import TcpSocket from 'react-native-tcp-socket';
import {
  mediaDevices,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
} from 'react-native-webrtc';

// ── Constants ─────────────────────────────────────────────────────────────────

const SIGNALING_PORT  = 8_765;
const MAX_PARTICIPANTS = 8;
const GO_IP           = '192.168.49.1'; // Android Wi-Fi Direct GO address (fixed)

// ICE config — no STUN/TURN: all traffic stays on the local 192.168.49.x subnet.
// The local-network ICE candidates are discovered automatically.
const PC_CONFIG = {
  iceServers:         [] as { urls: string }[],
  iceTransportPolicy: 'all' as const,
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** A Wi-Fi Direct device as returned by react-native-wifi-p2p. */
export interface WifiP2pDevice {
  deviceAddress: string; // MAC address (use for connect())
  deviceName:    string;
  status:        number; // 0=connected 1=invited 2=failed 3=available 4=unavailable
}

/** Connection info returned by getConnectionInfo(). */
export interface WifiP2pInfo {
  groupOwnerAddress: { hostAddress: string; isLoopbackAddress: boolean };
  groupFormed:       boolean;
  isGroupOwner:      boolean;
}

/** Voice participant visible to the caller. */
export interface VoiceParticipant {
  peerId:  string;
  muted:   boolean;
  /** True while ICE is still negotiating. */
  pending: boolean;
}

type WDEvent =
  | 'voice_peer_joined'
  | 'voice_peer_left'
  | 'voice_connected'
  | 'voice_disconnected';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener<T = any> = (payload: T) => void;

// Internal signaling message shape
interface SigMsg {
  t:     string;
  pid?:  string;
  peers?: string[];
  from?: string;
  to?:   string;
  sdp?:  string;
  c?:    RTCIceCandidateInit;
}

/** State tracked per TCP client connection on the host's signaling server. */
interface ClientConn {
  socket: ReturnType<typeof TcpSocket.createConnection>;
  peerId: string | null;
  buf:    string;
}

// ── ID generation ─────────────────────────────────────────────────────────────

function generatePeerId(): string {
  const buf = new Uint8Array(8);
  try { crypto.getRandomValues(buf); }
  catch { for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256); }
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── WifiDirectService ─────────────────────────────────────────────────────────

export class WifiDirectService {
  private readonly _myPeerId: string = generatePeerId();

  // Wi-Fi Direct peer inventory (MAC → device)
  private _wifiPeers:   Map<string, WifiP2pDevice> = new Map();
  private _wifiUnsubs:  Array<() => void>          = [];

  // WebRTC voice mesh (peerId → RTCPeerConnection)
  private _voicePeers:  Map<string, RTCPeerConnection> = new Map();
  private _localStream: MediaStream | null             = null;
  private _isHost:      boolean                        = false;
  private _inCall:      boolean                        = false;
  private _muted:       boolean                        = false;

  // ── Host-side signaling ─────────────────────────────────────────────────
  // The server accepts client TCP connections and relays SDP/ICE between them.
  private _sigServer:       ReturnType<typeof TcpSocket.createServer> | null = null;
  private _sigClients:      Map<number, ClientConn> = new Map(); // connId → conn
  private _peerToConnId:    Map<string, number>     = new Map(); // peerId → connId
  private _connIdSeq:       number                  = 0;

  // ── Client-side signaling ───────────────────────────────────────────────
  private _sigClient:    ReturnType<typeof TcpSocket.createConnection> | null = null;
  private _sigClientBuf: string = '';

  // Event listeners
  private _listeners: Map<WDEvent, Set<Listener>> = new Map([
    ['voice_peer_joined',   new Set()],
    ['voice_peer_left',     new Set()],
    ['voice_connected',     new Set()],
    ['voice_disconnected',  new Set()],
  ]);

  // ── Public — lifecycle ─────────────────────────────────────────────────────

  /**
   * Initialise the Wi-Fi Direct module.  Must be called once before any other
   * method.  No-op on iOS.
   */
  async initialize(): Promise<{ ok: boolean; reason?: string }> {
    if (Platform.OS !== 'android') return { ok: false, reason: 'iOS not supported' };

    const granted = await this._requestPermissions();
    if (!granted) return { ok: false, reason: 'Wi-Fi Direct permissions denied' };

    try {
      await WifiP2P.initialize();

      // Subscribe to peer and connection updates
      const unsubPeers = WifiP2P.subscribeOnPeersUpdates(
        ({ devices }: { devices: WifiP2pDevice[] }) => {
          this._wifiPeers.clear();
          devices.forEach(d => this._wifiPeers.set(d.deviceAddress, d));
        },
      );
      const unsubConn = WifiP2P.subscribeOnConnectionInfoUpdates(
        (_info: WifiP2pInfo) => { /* Caller reads via getConnectionInfo() */ },
      );

      this._wifiUnsubs.push(unsubPeers, unsubConn);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  // ── Public — Wi-Fi Direct peer management ─────────────────────────────────

  /**
   * Scan for nearby Wi-Fi Direct devices.
   * Results are delivered via the subscribeOnPeersUpdates callback; this method
   * also returns the current snapshot after a brief settle delay.
   */
  async discoverPeers(): Promise<WifiP2pDevice[]> {
    if (Platform.OS !== 'android') return [];
    try {
      await WifiP2P.startDiscoveringPeers();
      // Allow a 1-second settle window for the first update
      await new Promise(r => setTimeout(r, 1_000));
      const { devices } = await WifiP2P.getAvailablePeers();
      devices.forEach((d: WifiP2pDevice) => this._wifiPeers.set(d.deviceAddress, d));
      return devices;
    } catch {
      return Array.from(this._wifiPeers.values());
    }
  }

  async stopDiscovery(): Promise<void> {
    if (Platform.OS !== 'android') return;
    try { await WifiP2P.stopDiscoveringPeers(); } catch {}
  }

  /**
   * Make this device the Wi-Fi Direct Group Owner (the "cold spot").
   * Other devices must call connectToPeer() to join this group.
   */
  async createGroup(): Promise<{ ok: boolean; reason?: string }> {
    if (Platform.OS !== 'android') return { ok: false, reason: 'iOS not supported' };
    try {
      await WifiP2P.createGroup();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  async removeGroup(): Promise<void> {
    try { await WifiP2P.removeGroup(); } catch {}
  }

  /**
   * Join an existing Wi-Fi Direct group.
   * @param macAddress  Device MAC address from discoverPeers()
   */
  async connectToPeer(macAddress: string): Promise<{ ok: boolean; reason?: string }> {
    if (Platform.OS !== 'android') return { ok: false, reason: 'iOS not supported' };
    try {
      await WifiP2P.connect(macAddress);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  async disconnectFromGroup(): Promise<void> {
    try { await WifiP2P.disconnect(); } catch {}
  }

  /**
   * Returns Wi-Fi Direct connection info including the Group Owner IP
   * (always 192.168.49.1 on Android when a group is formed).
   */
  async getConnectionInfo(): Promise<WifiP2pInfo | null> {
    try { return await WifiP2P.getConnectionInfo(); }
    catch { return null; }
  }

  // ── Public — voice calls ──────────────────────────────────────────────────

  /**
   * Start as the voice host (Group Owner).
   * Requires createGroup() to have been called first.
   * The GO's IP will be GO_IP (192.168.49.1).
   */
  async startVoiceHost(): Promise<{ ok: boolean; reason?: string }> {
    if (Platform.OS !== 'android') return { ok: false, reason: 'iOS not supported' };
    if (this._inCall) return { ok: false, reason: 'Already in a voice call' };

    this._isHost = true;
    this._inCall = true;

    try {
      this._localStream = await this._getLocalAudio();
    } catch (e) {
      this._isHost = false;
      this._inCall = false;
      return { ok: false, reason: `Microphone error: ${e}` };
    }

    this._startSignalingServer();
    this._emit('voice_connected', { asHost: true, ip: GO_IP, port: SIGNALING_PORT });
    return { ok: true };
  }

  /**
   * Join the voice call hosted at `hostIp`.
   * Requires connectToPeer() to have been called and the Wi-Fi Direct group
   * to be formed (getConnectionInfo().groupFormed === true).
   *
   * @param hostIp  Group Owner IP — use getConnectionInfo().groupOwnerAddress.hostAddress
   *                (typically '192.168.49.1' on Android)
   */
  async joinVoice(hostIp: string = GO_IP): Promise<{ ok: boolean; reason?: string }> {
    if (Platform.OS !== 'android') return { ok: false, reason: 'iOS not supported' };
    if (this._inCall) return { ok: false, reason: 'Already in a voice call' };

    this._isHost = false;
    this._inCall = true;

    try {
      this._localStream = await this._getLocalAudio();
    } catch (e) {
      this._inCall = false;
      return { ok: false, reason: `Microphone error: ${e}` };
    }

    const connected = await this._connectSignalingClient(hostIp);
    if (!connected) {
      this._inCall = false;
      this._localStream?.getTracks().forEach((t: any) => t.stop());
      this._localStream = null;
      return { ok: false, reason: `Cannot reach signaling server at ${hostIp}:${SIGNALING_PORT}` };
    }

    this._emit('voice_connected', { asHost: false, ip: hostIp });
    return { ok: true };
  }

  /**
   * Leave the current voice call and tear down all peer connections.
   * Also removes the Wi-Fi Direct group if this device was the host.
   */
  async leaveVoice(): Promise<void> {
    if (!this._inCall) return;
    this._inCall = false;

    // Notify peers
    const bye: SigMsg = { t: 'leave', from: this._myPeerId };
    if (this._isHost) {
      this._broadcastToClients(bye);
    } else {
      this._clientSend(bye);
    }

    this._cleanup();
    this._emit('voice_disconnected', {});
  }

  isInVoiceCall(): boolean { return this._inCall; }

  /** Mute / unmute local audio tracks. */
  setMuted(muted: boolean): void {
    this._muted = muted;
    this._localStream?.getAudioTracks().forEach((t: any) => { t.enabled = !muted; });
  }

  isMuted(): boolean { return this._muted; }

  /** Returns all current voice participants (excludes self). */
  getParticipants(): VoiceParticipant[] {
    return Array.from(this._voicePeers.entries()).map(([peerId, pc]) => ({
      peerId,
      muted:   false, // remote mute state is not tracked at this layer
      pending: pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed',
    }));
  }

  // ── Public — events ───────────────────────────────────────────────────────

  on(event: 'voice_peer_joined',   listener: Listener<{ peerId: string }>): void;
  on(event: 'voice_peer_left',     listener: Listener<{ peerId: string }>): void;
  on(event: 'voice_connected',     listener: Listener<{ asHost: boolean; ip: string }>): void;
  on(event: 'voice_disconnected',  listener: Listener<Record<string, never>>): void;
  on(event: WDEvent, listener: Listener): void {
    this._listeners.get(event)!.add(listener);
  }

  off(event: WDEvent, listener: Listener): void {
    this._listeners.get(event)?.delete(listener);
  }

  destroy(): void {
    this.leaveVoice();
    this._wifiUnsubs.forEach(fn => { try { fn(); } catch {} });
    this._wifiUnsubs = [];
    this._listeners.forEach(s => s.clear());
  }

  // ── Private — signaling server (host) ─────────────────────────────────────

  private _startSignalingServer(): void {
    const server = TcpSocket.createServer((socket: any) => {
      const connId = ++this._connIdSeq;
      const conn: ClientConn = { socket, peerId: null, buf: '' };
      this._sigClients.set(connId, conn);

      socket.on('data', (raw: Buffer | string) => {
        conn.buf += raw.toString();
        const lines = conn.buf.split('\n');
        conn.buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) {
            try { this._handleServerMessage(JSON.parse(line), connId); } catch {}
          }
        }
      });

      socket.on('close', () => {
        this._sigClients.delete(connId);
        if (conn.peerId) {
          this._peerToConnId.delete(conn.peerId);
          this._cleanupVoicePeer(conn.peerId);
          this._broadcastToClients({ t: 'peer_left', pid: conn.peerId }, connId);
          this._emit('voice_peer_left', { peerId: conn.peerId });
        }
      });

      socket.on('error', () => socket.destroy());
    });

    server.listen({ port: SIGNALING_PORT, host: '0.0.0.0', reuseAddress: true }, () => {
      console.log('[WifiDirect] signaling server listening on', SIGNALING_PORT);
    });
    server.on('error', (e: Error) => console.warn('[WifiDirect] server error:', e));
    this._sigServer = server;
  }

  /**
   * Handle a message arriving at the host's TCP server from connId.
   * Messages addressed to another peer are relayed; those addressed to the
   * host (or broadcasts) are handled locally.
   */
  private _handleServerMessage(msg: SigMsg, connId: number): void {
    const conn = this._sigClients.get(connId);
    if (!conn) return;

    switch (msg.t) {
      case 'join': {
        if (!msg.pid) return;

        // Enforce participant limit (host + existing clients + new joiner)
        if (this._sigClients.size > MAX_PARTICIPANTS) {
          conn.socket.write(JSON.stringify({ t: 'full' }) + '\n');
          conn.socket.destroy();
          return;
        }

        conn.peerId = msg.pid;
        this._peerToConnId.set(msg.pid, connId);

        // Send current peer list to the new joiner (includes host and existing clients)
        const existingPeers = [this._myPeerId, ...this._peerToConnId.keys()].filter(
          pid => pid !== msg.pid,
        );
        conn.socket.write(JSON.stringify({ t: 'welcome', peers: existingPeers }) + '\n');

        // Notify existing clients that a new peer arrived
        this._broadcastToClients({ t: 'peer_joined', pid: msg.pid }, connId);

        // Host initiates WebRTC offer to the new joiner
        this._createPeerConnection(msg.pid, /* initiator */ true);
        this._emit('voice_peer_joined', { peerId: msg.pid });
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice': {
        if (!msg.to) return;
        if (msg.to === this._myPeerId) {
          // For the host itself
          this._handleWebRTCSignal(msg);
        } else {
          // Relay to the target client
          const targetConnId = this._peerToConnId.get(msg.to);
          if (targetConnId !== undefined) {
            const target = this._sigClients.get(targetConnId);
            target?.socket.write(JSON.stringify(msg) + '\n');
          }
        }
        break;
      }

      case 'leave': {
        if (!conn.peerId) return;
        this._sigClients.delete(connId);
        this._peerToConnId.delete(conn.peerId);
        this._cleanupVoicePeer(conn.peerId);
        this._broadcastToClients({ t: 'peer_left', pid: conn.peerId }, connId);
        this._emit('voice_peer_left', { peerId: conn.peerId });
        conn.socket.destroy();
        break;
      }
    }
  }

  // ── Private — signaling client (joiner) ───────────────────────────────────

  private _connectSignalingClient(hostIp: string): Promise<boolean> {
    return new Promise(resolve => {
      const timeout = setTimeout(() => { client.destroy(); resolve(false); }, 8_000);

      const client = TcpSocket.createConnection(
        { host: hostIp, port: SIGNALING_PORT, tls: false },
        () => {
          clearTimeout(timeout);
          // Announce ourselves to the host
          this._clientSend({ t: 'join', pid: this._myPeerId });
          resolve(true);
        },
      );

      client.on('data', (raw: Buffer | string) => {
        this._sigClientBuf += raw.toString();
        const lines = this._sigClientBuf.split('\n');
        this._sigClientBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) {
            try { this._handleClientMessage(JSON.parse(line)); } catch {}
          }
        }
      });

      client.on('error', (e: Error) => {
        console.warn('[WifiDirect] client error:', e);
        clearTimeout(timeout);
        resolve(false);
      });

      client.on('close', () => {
        if (this._inCall) {
          this._cleanup();
          this._emit('voice_disconnected', {});
        }
      });

      this._sigClient = client;
    });
  }

  private _handleClientMessage(msg: SigMsg): void {
    switch (msg.t) {
      case 'welcome': {
        // Create offers to every existing peer (joiner initiates to all)
        (msg.peers ?? []).forEach(pid => {
          this._createPeerConnection(pid, /* initiator */ true);
          this._emit('voice_peer_joined', { peerId: pid });
        });
        break;
      }

      case 'full': {
        console.warn('[WifiDirect] voice room is full');
        this._inCall = false;
        this._emit('voice_disconnected', {});
        break;
      }

      case 'peer_joined': {
        if (!msg.pid) return;
        // Do NOT create offer here — the existing peer will receive 'welcome'
        // and create an offer to us. We wait for their offer.
        this._emit('voice_peer_joined', { peerId: msg.pid });
        break;
      }

      case 'peer_left': {
        if (!msg.pid) return;
        this._cleanupVoicePeer(msg.pid);
        this._emit('voice_peer_left', { peerId: msg.pid });
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice':
        this._handleWebRTCSignal(msg);
        break;
    }
  }

  // ── Private — signaling send helpers ─────────────────────────────────────

  private _sendSignal(msg: SigMsg): void {
    const frame = JSON.stringify(msg) + '\n';
    if (this._isHost) {
      // Host sends directly to the target client socket
      if (msg.to) {
        const connId = this._peerToConnId.get(msg.to);
        if (connId !== undefined) {
          this._sigClients.get(connId)?.socket.write(frame);
        }
      }
    } else {
      this._sigClient?.write(frame);
    }
  }

  private _clientSend(msg: SigMsg): void {
    this._sigClient?.write(JSON.stringify(msg) + '\n');
  }

  private _broadcastToClients(msg: SigMsg, excludeConnId?: number): void {
    const frame = JSON.stringify(msg) + '\n';
    for (const [id, conn] of this._sigClients) {
      if (id !== excludeConnId && conn.peerId) {
        try { conn.socket.write(frame); } catch {}
      }
    }
  }

  // ── Private — WebRTC peer connections ─────────────────────────────────────

  private _createPeerConnection(peerId: string, initiator: boolean): RTCPeerConnection {
    if (this._voicePeers.has(peerId)) return this._voicePeers.get(peerId)!;

    const pc = new RTCPeerConnection(PC_CONFIG as any);
    this._voicePeers.set(peerId, pc);

    // Add local audio tracks so the peer can hear us
    if (this._localStream) {
      (this._localStream as any).getTracks().forEach((track: any) => {
        (pc as any).addTrack(track, this._localStream);
      });
    }

    // ICE candidate → send via signaling
    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        this._sendSignal({
          t:    'ice',
          from: this._myPeerId,
          to:   peerId,
          c:    event.candidate.toJSON(),
        });
      }
    };

    // ICE state changes
    (pc as any).oniceconnectionstatechange = () => {
      const state: string = (pc as any).iceConnectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this._cleanupVoicePeer(peerId);
        this._emit('voice_peer_left', { peerId });
      }
    };

    // Remote audio arrives automatically via the WebRTC audio stack
    (pc as any).ontrack = (_event: any) => {
      // react-native-webrtc renders audio natively when a track is received;
      // no explicit attachment to a view is needed for audio-only streams.
    };

    if (initiator) {
      (pc as any).createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
        .then((sdp: any) => (pc as any).setLocalDescription(sdp).then(() => sdp))
        .then((sdp: any) => {
          this._sendSignal({ t: 'offer', from: this._myPeerId, to: peerId, sdp: sdp.sdp });
        })
        .catch((e: Error) => console.warn('[WifiDirect] offer error:', e));
    }

    return pc;
  }

  private async _handleWebRTCSignal(msg: SigMsg): Promise<void> {
    if (!msg.from) return;
    const peerId = msg.from;

    switch (msg.t) {
      case 'offer': {
        if (!msg.sdp) return;
        // Answerer side: create PC (not initiator), set remote offer, send answer
        const pc = this._createPeerConnection(peerId, /* initiator */ false);
        try {
          await (pc as any).setRemoteDescription(
            new RTCSessionDescription({ type: 'offer', sdp: msg.sdp } as any),
          );
          const answer = await (pc as any).createAnswer();
          await (pc as any).setLocalDescription(answer);
          this._sendSignal({
            t: 'answer', from: this._myPeerId, to: peerId, sdp: answer.sdp,
          });
        } catch (e) {
          console.warn('[WifiDirect] answer error:', e);
        }
        break;
      }

      case 'answer': {
        if (!msg.sdp) return;
        const pc = this._voicePeers.get(peerId);
        if (!pc) return;
        try {
          await (pc as any).setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: msg.sdp } as any),
          );
        } catch (e) {
          console.warn('[WifiDirect] setRemoteDescription error:', e);
        }
        break;
      }

      case 'ice': {
        if (!msg.c) return;
        const pc = this._voicePeers.get(peerId);
        if (!pc) return;
        try {
          await (pc as any).addIceCandidate(new RTCIceCandidate(msg.c as any));
        } catch (e) {
          console.warn('[WifiDirect] addIceCandidate error:', e);
        }
        break;
      }
    }
  }

  // ── Private — media ────────────────────────────────────────────────────────

  private async _getLocalAudio(): Promise<MediaStream> {
    const stream = await (mediaDevices as any).getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },
      video: false,
    });
    return stream as MediaStream;
  }

  // ── Private — cleanup ─────────────────────────────────────────────────────

  private _cleanupVoicePeer(peerId: string): void {
    const pc = this._voicePeers.get(peerId);
    if (!pc) return;
    try { (pc as any).close(); } catch {}
    this._voicePeers.delete(peerId);
  }

  private _cleanup(): void {
    // Close all WebRTC connections
    for (const peerId of this._voicePeers.keys()) {
      this._cleanupVoicePeer(peerId);
    }

    // Stop local audio
    this._localStream?.getTracks().forEach((t: any) => { try { t.stop(); } catch {} });
    this._localStream = null;

    // Close signaling server
    if (this._sigServer) {
      for (const conn of this._sigClients.values()) {
        try { conn.socket.destroy(); } catch {}
      }
      this._sigClients.clear();
      this._peerToConnId.clear();
      try { this._sigServer.close(); } catch {}
      this._sigServer = null;
    }

    // Close signaling client
    if (this._sigClient) {
      try { this._sigClient.destroy(); } catch {}
      this._sigClient    = null;
      this._sigClientBuf = '';
    }

    this._isHost = false;
    this._muted  = false;
  }

  // ── Private — permissions ─────────────────────────────────────────────────

  private async _requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const api = Platform.Version as number;

    const base = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      // ACCESS_WIFI_STATE and CHANGE_WIFI_STATE are normal permissions —
      // they don't require a runtime request, only manifest declaration.
    ] as string[];

    // Android 13+ requires NEARBY_WIFI_DEVICES
    if (api >= 33) {
      base.push('android.permission.NEARBY_WIFI_DEVICES');
    }

    const results = await PermissionsAndroid.requestMultiple(base as any);
    return Object.values(results).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
  }

  // ── Private — event emission ───────────────────────────────────────────────

  private _emit(event: WDEvent, payload: unknown): void {
    this._listeners.get(event)?.forEach(fn => { try { fn(payload); } catch {} });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: WifiDirectService | null = null;

/** Returns the shared WifiDirectService instance. */
export function getWifiDirectService(): WifiDirectService {
  if (!_instance) _instance = new WifiDirectService();
  return _instance;
}

export function destroyWifiDirectService(): void {
  _instance?.destroy();
  _instance = null;
}
