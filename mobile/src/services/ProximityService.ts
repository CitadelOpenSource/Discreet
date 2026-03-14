/**
 * ProximityService — BLE proximity discovery + encrypted peer messaging.
 *
 * ── Discovery ──────────────────────────────────────────────────────────────
 * Uses react-native-ble-plx for BLE scanning (central/observer role).
 * Privacy model: each device broadcasts pseudoId = SHA-256(userId:hourlySlot).slice(0,16).
 * The real userId is never transmitted. IDs rotate every hour.
 *
 * ── Messaging ──────────────────────────────────────────────────────────────
 * When two devices discover each other they can exchange end-to-end encrypted
 * messages over BLE GATT without any internet connection.
 *
 * Crypto stack:
 *   Key exchange  — ECDH P-256 (SubtleCrypto)
 *   Key derivation — HKDF-SHA-256 over the ECDH shared secret
 *   Encryption    — AES-256-GCM (unique 12-byte nonce per fragment)
 *
 * Fragmentation: messages are split into ≤180-byte plaintext chunks so that each
 * on-wire JSON frame stays within 512 bytes (BLE MTU-safe characteristic value).
 *
 * Offline queue: every sent fragment is appended to AsyncStorage key
 * 'proximity_queue' so messages can be synced to the server when internet returns.
 *
 * ── Peripheral / Advertising ───────────────────────────────────────────────
 * react-native-ble-plx is a central-only library and cannot set up a GATT
 * server or advertise. Full bidirectional messaging therefore requires:
 *   1. react-native-ble-advertiser  — for broadcasting the discovery beacon.
 *   2. A native GATT server module  — to host CHAR_KEY_UUID + CHAR_MSG_UUID.
 * Stub integration points are marked with "// [NATIVE PERIPHERAL]" comments.
 *
 * iOS Info.plist:
 *   NSBluetoothAlwaysUsageDescription
 *   NSBluetoothPeripheralUsageDescription
 *
 * Android AndroidManifest.xml (also requested at runtime):
 *   BLUETOOTH_SCAN, BLUETOOTH_ADVERTISE, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';

// ── Constants ─────────────────────────────────────────────────────────────────

// GATT service and characteristics hosted by each Discreet device.
export const SERVICE_UUID  = 'd15c0001-0001-0001-0001-00d15c000001';
export const CHAR_UUID     = 'd15c0002-0001-0001-0001-00d15c000001'; // discovery beacon (read)
export const CHAR_KEY_UUID = 'd15c0010-0001-0001-0001-00d15c000001'; // ECDH public key (read/write)
export const CHAR_MSG_UUID     = 'd15c0011-0001-0001-0001-00d15c000001'; // encrypted messages (write+notify)
export const CHAR_CONTACT_UUID = 'd15c0012-0001-0001-0001-00d15c000001'; // contact exchange (read/write)

// Discovery timing
const EXPIRY_MS      = 30_000;
const SCAN_WINDOW    = 4_500;
const SCAN_INTERVAL  = 5_000;
const CLEAN_INTERVAL = 10_000;
const MAX_BEACON_AGE_SLOTS = 2;

// Messaging limits
const MAX_PLAINTEXT_FRAG = 180;  // bytes of plaintext per fragment (keeps frame ≤512 bytes)
const MAX_FRAME_BYTES    = 512;  // hard cap on characteristic value size
const CONN_TIMEOUT_MS    = 12_000;
const FRAG_TIMEOUT_MS    = 30_000; // discard incomplete reassembly after this

// AsyncStorage keys
const STORE_ECDH_PRIV  = 'prox_ecdh_priv';  // JWK-encoded private key
const STORE_ECDH_PUB   = 'prox_ecdh_pub';   // base64 raw public key (65 bytes)
const STORE_QUEUE      = 'proximity_queue';  // JSON array of QueuedMessage
const STORE_CONTACTS   = 'proximity_contacts'; // JSON array of BleContact

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NearbyUser {
  pseudoId: string;
  rssi:     number;
  lastSeen: number;
  deviceId: string;
}

/** Decrypted message delivered to onProximityMessage subscribers. */
export interface ProximityMessage {
  id:          string;   // message ID (same across all fragments)
  senderId:    string;   // sender's pseudoId
  recipientId: string;   // recipient's pseudoId (ours)
  plaintext:   string;
  timestamp:   number;
}

/** A queued message stored in AsyncStorage for later server sync. */
export interface QueuedMessage {
  id:          string;
  senderId:    string;
  recipientId: string;
  /** AES-256-GCM ciphertext (base64). */
  ciphertext:  string;
  /** AES-GCM nonce (base64, 12 bytes). */
  nonce:       string;
  timestamp:   number;
  fragmentIndex: number;
  fragmentTotal: number;
  messageId:     string;
}

/** Contact info exchanged via BLE CHAR_CONTACT_UUID. */
export interface BleContact {
  user_id:              string;
  username:             string;
  preferred_instance_url: string;
  exchanged_at:         number;
  friend_request_sent?: boolean;
}

/** On-wire frame written to / read from CHAR_MSG_UUID. Short keys save BLE bytes. */
interface WireFrame {
  id:   string;  // frame ID  (8 hex)
  sid:  string;  // sender pseudoId (16 hex)
  rid:  string;  // recipient pseudoId (16 hex)
  ct:   string;  // AES-GCM ciphertext (base64)
  n:    string;  // nonce (base64, 12 bytes → 16 b64 chars)
  ts:   number;  // unix ms
  fi:   number;  // fragment index (0-based)
  ft:   number;  // total fragments
  fmid: string;  // message ID (8 hex, same for all fragments)
}

interface FragBuf {
  frames:  Map<number, WireFrame>;
  total:   number;
  recvd:   number;
  timer:   ReturnType<typeof setTimeout>;
}

type ProximityEvent  = 'user_discovered' | 'user_lost';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener<T = any> = (payload: T) => void;
type MsgCallback       = (msg: ProximityMessage) => void;

// ── Crypto helpers ────────────────────────────────────────────────────────────

/** Cryptographically random 8-hex-char ID. */
function generateId(bytes = 4): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** base64 ↔ Uint8Array without Buffer dependency. */
function rawToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToRaw(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** UTF-8 string ↔ base64 (for JSON payloads that may contain Unicode). */
function b64Encode(str: string): string {
  try { return btoa(unescape(encodeURIComponent(str))); }
  catch { return btoa(str); }
}
function b64Decode(b64: string): string {
  try { return decodeURIComponent(escape(atob(b64))); }
  catch { return atob(b64); }
}

/** SHA-256 hex digest, with a non-cryptographic fallback for environments
 *  where SubtleCrypto is unavailable. */
async function sha256hex(input: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h1 = 0x811c9dc5, h2 = 0xdeadbeef;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
    }
    const s = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
    return (s + s + s + s).slice(0, 64);
  }
}

function hourlySlot(): number {
  return Math.floor(Date.now() / 3_600_000);
}

// ── ECDH / HKDF / AES-GCM ────────────────────────────────────────────────────

async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    /* extractable */ true,
    ['deriveKey', 'deriveBits'],
  );
}

/** Export the public key as 65 raw bytes (uncompressed point). */
async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  const buf = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(buf);
}

/** Import 65 raw bytes as a P-256 ECDH public key. */
async function importPublicKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', bytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    /* extractable */ false,
    [],
  );
}

/**
 * Derive a symmetric AES-256-GCM key from an ECDH exchange.
 * Both parties arrive at the same key: HKDF(ECDH(myPriv, theirPub)).
 *
 * Salt is deterministic so no out-of-band salt exchange is needed.
 */
async function deriveAesKey(myPrivate: CryptoKey, peerPublicBytes: Uint8Array): Promise<CryptoKey> {
  const peerPublic = await importPublicKey(peerPublicBytes);

  // ECDH → 256-bit shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublic },
    myPrivate,
    256,
  );

  // HKDF key material
  const hkdfKey = await crypto.subtle.importKey(
    'raw', sharedBits, 'HKDF', false, ['deriveKey'],
  );

  const salt = new TextEncoder().encode('discreet-proximity-salt-v1');
  const info = new TextEncoder().encode('discreet-proximity-aes-v1');

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  );
}

/** AES-256-GCM encrypt. Returns ciphertext (includes 16-byte auth tag) and nonce. */
async function encryptFragment(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipherbuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
  return { ciphertext: new Uint8Array(cipherbuf), nonce };
}

/** AES-256-GCM decrypt. Throws on authentication failure. */
async function decryptFragment(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
  return new Uint8Array(buf);
}

// ── Key persistence ───────────────────────────────────────────────────────────

/** Load the ECDH key pair from AsyncStorage, or generate and persist a new one. */
async function loadOrGenerateKeyPair(): Promise<{ pair: CryptoKeyPair; pubBytes: Uint8Array }> {
  try {
    const [privJwk, pubB64] = await AsyncStorage.multiGet([STORE_ECDH_PRIV, STORE_ECDH_PUB]);
    if (privJwk[1] && pubB64[1]) {
      const privateKey = await crypto.subtle.importKey(
        'jwk', JSON.parse(privJwk[1]),
        { name: 'ECDH', namedCurve: 'P-256' },
        /* extractable */ true,
        ['deriveKey', 'deriveBits'],
      );
      // Re-derive public key from stored raw bytes (we don't store it as CryptoKey)
      const pubBytes = b64ToRaw(pubB64[1]);
      const publicKey = await crypto.subtle.importKey(
        'raw', pubBytes,
        { name: 'ECDH', namedCurve: 'P-256' },
        /* extractable */ true,
        [],
      );
      return { pair: { privateKey, publicKey }, pubBytes };
    }
  } catch {}

  // Generate fresh key pair
  const pair     = await generateEcdhKeyPair();
  const pubBytes = await exportPublicKey(pair.publicKey);
  const privJwk  = await crypto.subtle.exportKey('jwk', pair.privateKey);

  await AsyncStorage.multiSet([
    [STORE_ECDH_PRIV, JSON.stringify(privJwk)],
    [STORE_ECDH_PUB,  rawToB64(pubBytes)],
  ]);

  // NOTE: AsyncStorage is plaintext on disk. For production, migrate the private
  // key to react-native-keychain (iOS Keychain / Android Keystore).

  return { pair, pubBytes };
}

// ── ProximityService ──────────────────────────────────────────────────────────

export class ProximityService {
  private manager:  BleManager;
  private userId:   string;

  // Discovery state
  private active:       boolean = false;
  private myPseudoId:   string  = '';
  private myHourSlot:   number  = -1;
  private nearbyUsers:  Map<string, NearbyUser> = new Map();
  private deviceToPid:  Map<string, string>     = new Map();
  private pidToDevice:  Map<string, string>     = new Map();
  private scanTimer:    ReturnType<typeof setInterval> | null = null;
  private cleanTimer:   ReturnType<typeof setInterval> | null = null;

  // ECDH identity
  private keyPair:      CryptoKeyPair | null = null;
  private myPubBytes:   Uint8Array | null    = null;
  private keysReady:    Promise<void> | null = null;

  // Peer connections (keyed by BLE deviceId)
  private connections:  Map<string, Device>         = new Map();
  private aesKeys:      Map<string, CryptoKey>      = new Map();
  private connSubs:     Map<string, Subscription>   = new Map();
  private fragBuffers:  Map<string, FragBuf>         = new Map();

  // Callbacks
  private discoveryListeners: Map<ProximityEvent, Set<Listener>> = new Map([
    ['user_discovered', new Set()],
    ['user_lost',       new Set()],
  ]);
  private msgCallbacks: Set<MsgCallback> = new Set();

  constructor(userId: string) {
    this.userId  = userId;
    this.manager = new BleManager();
  }

  // ── Public — Discovery ────────────────────────────────────────────────────

  async startDiscovery(): Promise<{ ok: boolean; reason?: string }> {
    if (this.active) return { ok: true };

    const granted = await this.requestPermissions();
    if (!granted) return { ok: false, reason: 'BLE permissions denied' };

    const bleReady = await this.waitForPoweredOn();
    if (!bleReady) return { ok: false, reason: 'Bluetooth unavailable or powered off' };

    await this.initKeys();
    await this.refreshPseudoId();

    this.active = true;

    // [NATIVE PERIPHERAL] — wire react-native-ble-advertiser here:
    //   BleAdvertiser.setCompanyId(0xFFFF);
    //   await BleAdvertiser.broadcast(SERVICE_UUID, [this.buildBeaconBytes()], { connectable: true });
    //
    // [NATIVE GATT SERVER] — register CHAR_KEY_UUID + CHAR_MSG_UUID here:
    //   GattServer.addService(SERVICE_UUID, [
    //     { uuid: CHAR_KEY_UUID, properties: ['read', 'write'] },
    //     { uuid: CHAR_MSG_UUID, properties: ['write', 'notify'] },
    //   ]);
    //   GattServer.onWrite(CHAR_KEY_UUID,  (data, remote) => this._onPeerKeyWrite(data, remote));
    //   GattServer.onWrite(CHAR_MSG_UUID,  (data, remote) => this._handleIncomingFrame(data, remote));
    //   GattServer.onRead(CHAR_KEY_UUID,   ()             => rawToB64(this.myPubBytes!));

    this._runScanBurst();
    this.scanTimer  = setInterval(() => this._runScanBurst(),  SCAN_INTERVAL);
    this.cleanTimer = setInterval(() => this._evictExpired(), CLEAN_INTERVAL);

    return { ok: true };
  }

  async stopDiscovery(): Promise<void> {
    if (!this.active) return;
    this.active = false;

    if (this.scanTimer)  { clearInterval(this.scanTimer);  this.scanTimer  = null; }
    if (this.cleanTimer) { clearInterval(this.cleanTimer); this.cleanTimer = null; }

    try { this.manager.stopDeviceScan(); } catch {}

    // Disconnect all active peers
    for (const deviceId of this.connections.keys()) {
      await this.disconnectPeer(deviceId).catch(() => {});
    }

    this.nearbyUsers.clear();
    this.deviceToPid.clear();
    this.pidToDevice.clear();
  }

  getNearbyUsers(): NearbyUser[] {
    return Array.from(this.nearbyUsers.values());
  }

  isActive(): boolean { return this.active; }

  destroy(): void {
    this.stopDiscovery();
    this.manager.destroy();
    this.discoveryListeners.forEach(s => s.clear());
    this.msgCallbacks.clear();
    for (const buf of this.fragBuffers.values()) clearTimeout(buf.timer);
    this.fragBuffers.clear();
  }

  // ── Public — Events (discovery) ───────────────────────────────────────────

  on(event: 'user_discovered', listener: Listener<NearbyUser>): void;
  on(event: 'user_lost',       listener: Listener<{ pseudoId: string }>): void;
  on(event: ProximityEvent, listener: Listener): void {
    this.discoveryListeners.get(event)!.add(listener);
  }

  off(event: ProximityEvent, listener: Listener): void {
    this.discoveryListeners.get(event)?.delete(listener);
  }

  // ── Public — Messaging ────────────────────────────────────────────────────

  /**
   * Establish a GATT connection to a nearby peer and perform ECDH key exchange.
   *
   * Requires the peer to be running a GATT server with CHAR_KEY_UUID (read/write).
   * In the current ble-plx-only setup the peer must expose this via native code —
   * see [NATIVE GATT SERVER] comment in startDiscovery().
   *
   * @param deviceId  BLE device identifier from NearbyUser.deviceId
   */
  async connectToPeer(deviceId: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.connections.has(deviceId)) return { ok: true };

    await this.initKeys();
    if (!this.keyPair || !this.myPubBytes) {
      return { ok: false, reason: 'Crypto keys not initialised' };
    }

    let device: Device;
    try {
      device = await this.manager.connectToDevice(deviceId, {
        timeout: CONN_TIMEOUT_MS,
        requestMTU: 512,
      });
      await device.discoverAllServicesAndCharacteristics();
    } catch (e) {
      return { ok: false, reason: `Connection failed: ${e}` };
    }

    // Read the peer's ECDH public key from CHAR_KEY_UUID
    let peerPubBytes: Uint8Array;
    try {
      const keyChar = await device.readCharacteristicForService(SERVICE_UUID, CHAR_KEY_UUID);
      if (!keyChar.value) throw new Error('empty key characteristic');
      peerPubBytes = b64ToRaw(keyChar.value);
    } catch (e) {
      await device.cancelConnection().catch(() => {});
      return { ok: false, reason: `Key read failed: ${e}` };
    }

    // Publish our ECDH public key so the peer can derive the shared key too.
    // The peer reads this via their GATT server write handler [NATIVE GATT SERVER].
    try {
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID, CHAR_KEY_UUID,
        rawToB64(this.myPubBytes),
      );
    } catch (e) {
      await device.cancelConnection().catch(() => {});
      return { ok: false, reason: `Key write failed: ${e}` };
    }

    // ECDH + HKDF → shared AES-256-GCM key
    let aesKey: CryptoKey;
    try {
      aesKey = await deriveAesKey(this.keyPair.privateKey, peerPubBytes);
    } catch (e) {
      await device.cancelConnection().catch(() => {});
      return { ok: false, reason: `Key derivation failed: ${e}` };
    }

    this.aesKeys.set(deviceId, aesKey);
    this.connections.set(deviceId, device);

    // Subscribe to incoming message frames on CHAR_MSG_UUID (notify).
    // The peripheral must have set up notify on this characteristic.
    device.monitorCharacteristicForService(
      SERVICE_UUID, CHAR_MSG_UUID,
      (err, char) => {
        if (err || !char?.value) return;
        this._handleIncomingFrame(char.value, deviceId).catch(() => {});
      },
    );

    // Clean up on disconnection
    const disconnSub = this.manager.onDeviceDisconnected(deviceId, () => {
      this.connections.delete(deviceId);
      this.aesKeys.delete(deviceId);
      this.connSubs.delete(deviceId);
    });
    this.connSubs.set(deviceId, disconnSub);

    return { ok: true };
  }

  async disconnectPeer(deviceId: string): Promise<void> {
    this.connSubs.get(deviceId)?.remove();
    this.connSubs.delete(deviceId);
    this.aesKeys.delete(deviceId);
    try { await this.connections.get(deviceId)?.cancelConnection(); } catch {}
    this.connections.delete(deviceId);
  }

  /**
   * Encrypt `plaintext` and write it to the connected peer's CHAR_MSG_UUID.
   * Automatically fragments messages that exceed MAX_PLAINTEXT_FRAG bytes.
   * Each fragment is also appended to the AsyncStorage offline queue.
   *
   * @param deviceId  BLE device ID of the connected peer (from NearbyUser.deviceId)
   * @param plaintext UTF-8 message text (no hard upper limit; fragmented automatically)
   */
  async sendProximityMessage(
    deviceId:  string,
    plaintext: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const aesKey = this.aesKeys.get(deviceId);
    if (!aesKey) return { ok: false, reason: 'Not connected — call connectToPeer first' };

    const device = this.connections.get(deviceId);
    if (!device)  return { ok: false, reason: 'Peer disconnected' };

    const recipientPseudoId = this.deviceToPid.get(deviceId) ?? `anon:${deviceId.slice(0, 12)}`;
    const msgId  = generateId(4);
    const rawBytes = new TextEncoder().encode(plaintext);

    // Split into ≤MAX_PLAINTEXT_FRAG-byte chunks
    const totalFrags = Math.max(1, Math.ceil(rawBytes.length / MAX_PLAINTEXT_FRAG));
    const frames: WireFrame[] = [];

    for (let fi = 0; fi < totalFrags; fi++) {
      const slice = rawBytes.slice(fi * MAX_PLAINTEXT_FRAG, (fi + 1) * MAX_PLAINTEXT_FRAG);
      const { ciphertext, nonce } = await encryptFragment(aesKey, slice);

      const frame: WireFrame = {
        id:   generateId(4),
        sid:  this.myPseudoId,
        rid:  recipientPseudoId,
        ct:   rawToB64(ciphertext),
        n:    rawToB64(nonce),
        ts:   Date.now(),
        fi,
        ft:   totalFrags,
        fmid: msgId,
      };

      // Validate on-wire size (characteristic value = JSON string bytes)
      const wireJson = JSON.stringify(frame);
      if (wireJson.length > MAX_FRAME_BYTES) {
        return {
          ok:     false,
          reason: `Fragment ${fi} is ${wireJson.length} bytes (limit ${MAX_FRAME_BYTES}). ` +
                  'Reduce MAX_PLAINTEXT_FRAG.',
        };
      }

      frames.push(frame);
    }

    // Write frames sequentially (GATT write-with-response is serial)
    for (const frame of frames) {
      try {
        // ble-plx writeCharacteristicWithResponseForService expects a base64 string
        // representing the raw bytes of the characteristic value.
        // We use the JSON string bytes directly.
        const wireB64 = btoa(JSON.stringify(frame));
        await device.writeCharacteristicWithResponseForService(
          SERVICE_UUID, CHAR_MSG_UUID, wireB64,
        );
      } catch (e) {
        return { ok: false, reason: `Write failed on fragment ${frame.fi}: ${e}` };
      }

      await this._enqueueForSync(frame);
    }

    return { ok: true };
  }

  /**
   * Register a callback for decrypted incoming proximity messages.
   * Returns an unsubscribe function.
   */
  onProximityMessage(callback: MsgCallback): () => void {
    this.msgCallbacks.add(callback);
    return () => this.msgCallbacks.delete(callback);
  }

  /**
   * Returns the current contents of the offline message queue.
   * Messages stay in the queue until flushQueueToServer() removes them.
   */
  async getPendingQueue(): Promise<QueuedMessage[]> {
    try {
      const raw = await AsyncStorage.getItem(STORE_QUEUE);
      return raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Attempt to upload all queued messages to the server.
   *
   * @param sendFn  Async function that uploads one message. Return true on
   *                success, false to leave the message in the queue.
   * @returns       Number of messages successfully flushed.
   */
  async flushQueueToServer(sendFn: (msg: QueuedMessage) => Promise<boolean>): Promise<number> {
    const queue = await this.getPendingQueue();
    if (queue.length === 0) return 0;

    let flushed = 0;
    const remaining: QueuedMessage[] = [];

    for (const msg of queue) {
      let sent = false;
      try { sent = await sendFn(msg); } catch {}
      if (sent) { flushed++; } else { remaining.push(msg); }
    }

    try {
      await AsyncStorage.setItem(STORE_QUEUE, JSON.stringify(remaining));
    } catch {}

    return flushed;
  }

  /**
   * Returns base64 beacon bytes for embedding in BLE advertising payload.
   * Pass to react-native-ble-advertiser once wired in.
   */
  buildBeaconBytes(): string {
    return b64Encode(JSON.stringify({ pid: this.myPseudoId, ts: hourlySlot() }));
  }

  // ── Private — Incoming message handling ───────────────────────────────────

  /**
   * Called when a notify fires on CHAR_MSG_UUID for a connected peer.
   * `b64Data` is the base64 characteristic value (raw JSON bytes).
   */
  private async _handleIncomingFrame(b64Data: string, deviceId: string): Promise<void> {
    const aesKey = this.aesKeys.get(deviceId);
    if (!aesKey) return;

    let frame: WireFrame;
    try {
      // Reverse the btoa(JSON) encoding used in sendProximityMessage
      const json = atob(b64Data);
      frame = JSON.parse(json) as WireFrame;
      if (typeof frame.ct !== 'string' || typeof frame.n !== 'string') throw new Error();
    } catch { return; }

    // Ignore our own echoed messages
    if (frame.sid === this.myPseudoId) return;

    // Single-fragment fast path
    if (frame.ft === 1) {
      await this._decryptAndEmit(frame, aesKey);
      return;
    }

    // Multi-fragment: buffer until complete
    const bufId = frame.fmid;
    if (!this.fragBuffers.has(bufId)) {
      const timer = setTimeout(() => {
        this.fragBuffers.delete(bufId);
      }, FRAG_TIMEOUT_MS);

      this.fragBuffers.set(bufId, {
        frames: new Map(),
        total:  frame.ft,
        recvd:  0,
        timer,
      });
    }

    const buf = this.fragBuffers.get(bufId)!;
    if (!buf.frames.has(frame.fi)) {
      buf.frames.set(frame.fi, frame);
      buf.recvd++;
    }

    if (buf.recvd === buf.total) {
      clearTimeout(buf.timer);
      this.fragBuffers.delete(bufId);
      await this._reassembleMessage(bufId, buf, aesKey);
    }
  }

  /** Decrypt a single-fragment frame and emit to callbacks. */
  private async _decryptAndEmit(frame: WireFrame, key: CryptoKey): Promise<void> {
    try {
      const ciphertext = b64ToRaw(frame.ct);
      const nonce      = b64ToRaw(frame.n);
      const plainBytes = await decryptFragment(key, ciphertext, nonce);
      const plaintext  = new TextDecoder().decode(plainBytes);

      const msg: ProximityMessage = {
        id:          frame.fmid,
        senderId:    frame.sid,
        recipientId: frame.rid,
        plaintext,
        timestamp:   frame.ts,
      };
      this.msgCallbacks.forEach(fn => { try { fn(msg); } catch {} });
    } catch {}
  }

  /** Decrypt and concatenate all fragments, then emit the reassembled message. */
  private async _reassembleMessage(
    _bufId: string,
    buf:    FragBuf,
    key:    CryptoKey,
  ): Promise<void> {
    const parts: Uint8Array[] = [];

    for (let i = 0; i < buf.total; i++) {
      const frame = buf.frames.get(i);
      if (!frame) return; // missing fragment — discard

      try {
        const plainBytes = await decryptFragment(key, b64ToRaw(frame.ct), b64ToRaw(frame.n));
        parts.push(plainBytes);
      } catch { return; } // decryption failure — discard entire message
    }

    // Concatenate all plaintext parts
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) { combined.set(p, offset); offset += p.length; }

    const firstFrame = buf.frames.get(0)!;
    const msg: ProximityMessage = {
      id:          firstFrame.fmid,
      senderId:    firstFrame.sid,
      recipientId: firstFrame.rid,
      plaintext:   new TextDecoder().decode(combined),
      timestamp:   firstFrame.ts,
    };
    this.msgCallbacks.forEach(fn => { try { fn(msg); } catch {} });
  }

  // ── Private — Offline queue ───────────────────────────────────────────────

  private async _enqueueForSync(frame: WireFrame): Promise<void> {
    const queued: QueuedMessage = {
      id:            frame.id,
      senderId:      frame.sid,
      recipientId:   frame.rid,
      ciphertext:    frame.ct,
      nonce:         frame.n,
      timestamp:     frame.ts,
      fragmentIndex: frame.fi,
      fragmentTotal: frame.ft,
      messageId:     frame.fmid,
    };

    try {
      const raw   = await AsyncStorage.getItem(STORE_QUEUE);
      const queue = raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
      queue.push(queued);
      await AsyncStorage.setItem(STORE_QUEUE, JSON.stringify(queue));
    } catch {}
  }

  // ── Private — Discovery scanning ──────────────────────────────────────────

  private _runScanBurst(): void {
    if (!this.active) return;

    if (hourlySlot() !== this.myHourSlot) {
      this.refreshPseudoId().catch(() => {});
    }

    try { this.manager.stopDeviceScan(); } catch {}

    this.manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: true },
      (error, device) => {
        if (error || !device) return;
        this._handleDevice(device).catch(() => {});
      },
    );

    setTimeout(() => {
      if (this.active) try { this.manager.stopDeviceScan(); } catch {}
    }, SCAN_WINDOW);
  }

  private async _handleDevice(device: Device): Promise<void> {
    const rssi     = device.rssi ?? -100;
    const now      = Date.now();
    const deviceId = device.id;

    const payload = this._extractBeacon(device);

    if (!payload) {
      this._upsert({ pseudoId: `anon:${deviceId.slice(0, 12)}`, rssi, lastSeen: now, deviceId });
      return;
    }

    if (payload.pid === this.myPseudoId) return;
    if (Math.abs(payload.ts - hourlySlot()) > MAX_BEACON_AGE_SLOTS) return;

    this._upsert({ pseudoId: payload.pid, rssi, lastSeen: now, deviceId });
  }

  private _extractBeacon(device: Device): { pid: string; ts: number } | null {
    try {
      const raw = device.manufacturerData
        ?? (device.serviceData ? device.serviceData[SERVICE_UUID] : null);
      if (!raw) return null;
      const obj = JSON.parse(b64Decode(raw));
      if (typeof obj.pid === 'string' && typeof obj.ts === 'number') return obj;
    } catch {}
    return null;
  }

  private _upsert(user: NearbyUser): void {
    const isNew   = !this.nearbyUsers.has(user.pseudoId);
    const prevPid = this.deviceToPid.get(user.deviceId);
    if (prevPid && prevPid !== user.pseudoId) {
      this.nearbyUsers.delete(prevPid);
      this.pidToDevice.delete(prevPid);
    }
    this.nearbyUsers.set(user.pseudoId, user);
    this.deviceToPid.set(user.deviceId, user.pseudoId);
    this.pidToDevice.set(user.pseudoId, user.deviceId);
    if (isNew) this.discoveryListeners.get('user_discovered')!.forEach(fn => {
      try { fn(user); } catch {}
    });
  }

  private _evictExpired(): void {
    const cutoff = Date.now() - EXPIRY_MS;
    for (const [pid, user] of this.nearbyUsers) {
      if (user.lastSeen < cutoff) {
        this.nearbyUsers.delete(pid);
        this.deviceToPid.delete(user.deviceId);
        this.pidToDevice.delete(pid);
        this.discoveryListeners.get('user_lost')!.forEach(fn => {
          try { fn({ pseudoId: pid }); } catch {}
        });
      }
    }
  }

  // ── Private — Keys / ID ───────────────────────────────────────────────────

  private initKeys(): Promise<void> {
    if (!this.keysReady) {
      this.keysReady = loadOrGenerateKeyPair().then(({ pair, pubBytes }) => {
        this.keyPair    = pair;
        this.myPubBytes = pubBytes;
      });
    }
    return this.keysReady;
  }

  private async refreshPseudoId(): Promise<void> {
    const slot      = hourlySlot();
    const hash      = await sha256hex(`${this.userId}:${slot}`);
    this.myPseudoId = hash.slice(0, 16);
    this.myHourSlot = slot;
  }

  // ── Private — Permissions + BLE state ────────────────────────────────────

  private async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const api = Platform.Version as number;
    if (api >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title:          'Location permission for Bluetooth',
        message:        'Discreet needs location access to find nearby users via Bluetooth.',
        buttonPositive: 'Allow',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  private waitForPoweredOn(timeoutMs = 8_000): Promise<boolean> {
    return new Promise(resolve => {
      const timer = setTimeout(() => { sub.remove(); resolve(false); }, timeoutMs);
      const sub = this.manager.onStateChange(state => {
        if (state === State.PoweredOn) {
          clearTimeout(timer); sub.remove(); resolve(true);
        } else if ([State.PoweredOff, State.Unsupported, State.Unauthorized].includes(state)) {
          clearTimeout(timer); sub.remove(); resolve(false);
        }
      }, /* emitCurrentState */ true);
    });
  }

  // ── Public — Contact Exchange ─────────────────────────────────────────────

  /**
   * Exchange contact info with a nearby peer over BLE.
   *
   * Writes our contact card to the peer's CHAR_CONTACT_UUID and reads theirs.
   * Both devices store the exchanged contact in AsyncStorage.
   */
  async exchangeContact(
    deviceId: string,
    myCard: { username: string; instanceUrl: string },
  ): Promise<{ ok: boolean; contact?: BleContact; reason?: string }> {
    let device: Device;
    try {
      device = await this.manager.connectToDevice(deviceId, {
        timeout: CONN_TIMEOUT_MS,
        requestMTU: 512,
      });
      await device.discoverAllServicesAndCharacteristics();
    } catch (e) {
      return { ok: false, reason: `Connection failed: ${e}` };
    }

    // Write our contact card
    const myCardJson = JSON.stringify({
      uid: this.userId,
      un:  myCard.username,
      iu:  myCard.instanceUrl,
      ts:  Date.now(),
    });

    try {
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUID, CHAR_CONTACT_UUID,
        rawToB64(new TextEncoder().encode(myCardJson)),
      );
    } catch (e) {
      await device.cancelConnection().catch(() => {});
      return { ok: false, reason: `Write failed: ${e}` };
    }

    // Read peer's contact card
    let peerContact: BleContact;
    try {
      const char = await device.readCharacteristicForService(SERVICE_UUID, CHAR_CONTACT_UUID);
      if (!char.value) throw new Error('empty contact characteristic');
      const raw = new TextDecoder().decode(b64ToRaw(char.value));
      const parsed = JSON.parse(raw);
      peerContact = {
        user_id: parsed.uid,
        username: parsed.un,
        preferred_instance_url: parsed.iu,
        exchanged_at: Date.now(),
      };
    } catch (e) {
      await device.cancelConnection().catch(() => {});
      return { ok: false, reason: `Read failed: ${e}` };
    }

    await device.cancelConnection().catch(() => {});

    // Store in AsyncStorage
    await this._storeContact(peerContact);

    return { ok: true, contact: peerContact };
  }

  /** Load all stored BLE contacts from AsyncStorage. */
  async getStoredContacts(): Promise<BleContact[]> {
    try {
      const raw = await AsyncStorage.getItem(STORE_CONTACTS);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /** Remove a stored contact by user_id. */
  async removeStoredContact(userId: string): Promise<void> {
    const contacts = (await this.getStoredContacts()).filter(c => c.user_id !== userId);
    await AsyncStorage.setItem(STORE_CONTACTS, JSON.stringify(contacts));
  }

  /** Mark a contact's friend request as sent. */
  async markContactFriendRequestSent(userId: string): Promise<void> {
    const contacts = await this.getStoredContacts();
    const idx = contacts.findIndex(c => c.user_id === userId);
    if (idx >= 0) {
      contacts[idx].friend_request_sent = true;
      await AsyncStorage.setItem(STORE_CONTACTS, JSON.stringify(contacts));
    }
  }

  private async _storeContact(contact: BleContact): Promise<void> {
    const contacts = await this.getStoredContacts();
    const idx = contacts.findIndex(c => c.user_id === contact.user_id);
    if (idx >= 0) {
      contacts[idx] = { ...contacts[idx], ...contact };
    } else {
      contacts.push(contact);
    }
    await AsyncStorage.setItem(STORE_CONTACTS, JSON.stringify(contacts));
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ProximityService | null = null;

export function getProximityService(userId: string): ProximityService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!_instance || (_instance as any).userId !== userId) {
    _instance?.destroy();
    _instance = new ProximityService(userId);
  }
  return _instance;
}

export function destroyProximityService(): void {
  _instance?.destroy();
  _instance = null;
}
