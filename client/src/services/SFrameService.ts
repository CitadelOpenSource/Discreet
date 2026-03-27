/**
 * SFrameService — SFrame encryption for WebRTC voice and video.
 *
 * Uses RTCRtpScriptTransform (preferred) or legacy createEncodedStreams
 * to encrypt/decrypt every RTP frame with AES-256-GCM via the Web Crypto API.
 * Supports key rotation with a 2-second overlap window so in-flight frames
 * encrypted under the old key can still be decrypted.
 */

// ─── Types ────────────────────────────────────────────────

interface TransformState {
  pc: RTCPeerConnection;
  senders: Map<RTCRtpSender, RTCRtpScriptTransform | TransformStream>;
  receivers: Map<RTCRtpReceiver, RTCRtpScriptTransform | TransformStream>;
  trackListener: (e: RTCTrackEvent) => void;
}

type SupportMode = 'script-transform' | 'encoded-streams' | 'none';

// ─── SFrameService class ─────────────────────────────────

class SFrameService {
  private currentKey: CryptoKey | null = null;
  private previousKey: CryptoKey | null = null;
  private overlapTimer: ReturnType<typeof setTimeout> | null = null;
  private connections: Map<RTCPeerConnection, TransformState> = new Map();
  private counter = 0;
  private _supportMode: SupportMode | null = null;
  private worker: Worker | null = null;

  // ── Browser support detection ───────────────────────────

  isSupported(): boolean {
    return this.detectSupport() !== 'none';
  }

  private detectSupport(): SupportMode {
    if (this._supportMode !== null) return this._supportMode;

    if (typeof RTCRtpScriptTransform !== 'undefined') {
      this._supportMode = 'script-transform';
    } else if (
      typeof RTCRtpSender !== 'undefined' &&
      'createEncodedStreams' in RTCRtpSender.prototype
    ) {
      this._supportMode = 'encoded-streams';
    } else {
      this._supportMode = 'none';
    }
    return this._supportMode;
  }

  // ── Key management ──────────────────────────────────────

  private async importKey(rawKey: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      new Uint8Array(rawKey.buffer),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Rotate the encryption key. The old key is kept for decryption
   * during a 2-second overlap window so in-flight frames are not dropped.
   */
  async rotateKey(newKeyBytes: Uint8Array): Promise<void> {
    const newKey = await this.importKey(newKeyBytes);

    if (this.currentKey) {
      this.previousKey = this.currentKey;
      if (this.overlapTimer) clearTimeout(this.overlapTimer);
      this.overlapTimer = setTimeout(() => {
        this.previousKey = null;
        this.overlapTimer = null;
      }, 2000);
    }

    this.currentKey = newKey;
    this.counter = 0;

    // Forward raw key to worker for RTCRtpScriptTransform path
    if (this.worker && this.detectSupport() === 'script-transform') {
      const copy = newKeyBytes.slice();
      this.worker.postMessage(
        { type: 'key', key: copy.buffer },
        [copy.buffer],
      );
    }
  }

  // ── Frame encryption / decryption ───────────────────────

  /**
   * Encrypt a single encoded frame.
   * Wire format: [12-byte IV | AES-GCM ciphertext + 16-byte tag]
   */
  private async encryptFrame(
    frame: RTCEncodedAudioFrame | RTCEncodedVideoFrame,
    controller: TransformStreamDefaultController,
  ): Promise<void> {
    if (!this.currentKey) {
      controller.enqueue(frame);
      return;
    }

    try {
      const data = new Uint8Array(frame.data);

      // 12-byte IV: 8 random bytes + 4-byte monotonic counter
      const iv = new Uint8Array(12);
      crypto.getRandomValues(iv.subarray(0, 8));
      new DataView(iv.buffer).setUint32(8, this.counter++);

      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: new Uint8Array(0) },
        this.currentKey,
        data,
      );

      const ct = new Uint8Array(ciphertext);
      const output = new ArrayBuffer(12 + ct.byteLength);
      const out = new Uint8Array(output);
      out.set(iv, 0);
      out.set(ct, 12);

      frame.data = output;
      controller.enqueue(frame);
    } catch {
      controller.enqueue(frame);
    }
  }

  /**
   * Decrypt a single encoded frame.
   * Tries currentKey first, falls back to previousKey during overlap.
   */
  private async decryptFrame(
    frame: RTCEncodedAudioFrame | RTCEncodedVideoFrame,
    controller: TransformStreamDefaultController,
  ): Promise<void> {
    if (!this.currentKey) {
      controller.enqueue(frame);
      return;
    }

    const data = new Uint8Array(frame.data);
    // 12 IV + 16 tag = 28 minimum for an encrypted frame
    if (data.byteLength < 28) {
      controller.enqueue(frame);
      return;
    }

    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);

    const decrypted = await this.tryDecrypt(ciphertext, iv, this.currentKey);
    if (decrypted !== null) {
      frame.data = decrypted;
      controller.enqueue(frame);
      return;
    }

    if (this.previousKey) {
      const fallback = await this.tryDecrypt(ciphertext, iv, this.previousKey);
      if (fallback !== null) {
        frame.data = fallback;
        controller.enqueue(frame);
        return;
      }
    }

    // Both keys failed — drop the frame
  }

  private async tryDecrypt(
    ciphertext: Uint8Array,
    iv: Uint8Array,
    key: CryptoKey,
  ): Promise<ArrayBuffer | null> {
    try {
      return await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv.buffer), additionalData: new Uint8Array(0) },
        key,
        ciphertext,
      );
    } catch {
      return null;
    }
  }

  // ── Transform installation ──────────────────────────────

  /**
   * Set up encryption on an RTCPeerConnection.
   * Installs send/receive transforms on all current audio and video
   * senders and receivers, and listens for tracks added later
   * (e.g. screen share, late-join video).
   */
  async setupEncryption(pc: RTCPeerConnection, keyBytes: Uint8Array): Promise<void> {
    if (this.detectSupport() === 'none') {
      // Insertable Streams not supported — voice will use transport-level encryption only
      return;
    }

    await this.rotateKey(keyBytes);

    const state: TransformState = {
      pc,
      senders: new Map(),
      receivers: new Map(),
      trackListener: (e: RTCTrackEvent) => {
        this.installReceiverTransform(e.receiver, state);
      },
    };

    for (const sender of pc.getSenders()) {
      if (sender.track) this.installSenderTransform(sender, state);
    }

    for (const receiver of pc.getReceivers()) {
      this.installReceiverTransform(receiver, state);
    }

    pc.addEventListener('track', state.trackListener);
    this.connections.set(pc, state);
  }

  private installSenderTransform(sender: RTCRtpSender, state: TransformState): void {
    if (state.senders.has(sender)) return;

    if (this.detectSupport() === 'encoded-streams') {
      const { readable, writable } = (sender as any).createEncodedStreams();
      const transform = new TransformStream({
        transform: (
          frame: RTCEncodedAudioFrame | RTCEncodedVideoFrame,
          controller: TransformStreamDefaultController,
        ) => this.encryptFrame(frame, controller),
      });
      readable.pipeThrough(transform).pipeTo(writable);
      state.senders.set(sender, transform);
    } else {
      const transform = new RTCRtpScriptTransform(
        this.getOrCreateWorker(),
        { operation: 'encrypt', id: crypto.randomUUID() },
      );
      (sender as any).transform = transform;
      state.senders.set(sender, transform);
    }
  }

  private installReceiverTransform(receiver: RTCRtpReceiver, state: TransformState): void {
    if (state.receivers.has(receiver)) return;

    if (this.detectSupport() === 'encoded-streams') {
      const { readable, writable } = (receiver as any).createEncodedStreams();
      const transform = new TransformStream({
        transform: (
          frame: RTCEncodedAudioFrame | RTCEncodedVideoFrame,
          controller: TransformStreamDefaultController,
        ) => this.decryptFrame(frame, controller),
      });
      readable.pipeThrough(transform).pipeTo(writable);
      state.receivers.set(receiver, transform);
    } else {
      const transform = new RTCRtpScriptTransform(
        this.getOrCreateWorker(),
        { operation: 'decrypt', id: crypto.randomUUID() },
      );
      (receiver as any).transform = transform;
      state.receivers.set(receiver, transform);
    }
  }

  // ── RTCRtpScriptTransform worker ────────────────────────

  private getOrCreateWorker(): Worker {
    if (this.worker) return this.worker;

    const workerCode = `
      self.onrtctransform = (event) => {
        const { readable, writable } = event.transformer;
        const { operation } = event.transformer.options;

        let currentKey = null;
        let previousKey = null;
        let counter = 0;

        self.onmessage = async (e) => {
          if (e.data.type === 'key') {
            previousKey = currentKey;
            currentKey = await crypto.subtle.importKey(
              'raw', e.data.key, { name: 'AES-GCM', length: 256 }, false,
              ['encrypt', 'decrypt']
            );
            counter = 0;
            if (previousKey) setTimeout(() => { previousKey = null; }, 2000);
          }
        };

        const transform = new TransformStream({
          async transform(frame, controller) {
            if (!currentKey) { controller.enqueue(frame); return; }

            if (operation === 'encrypt') {
              try {
                const data = new Uint8Array(frame.data);
                const iv = new Uint8Array(12);
                crypto.getRandomValues(iv.subarray(0, 8));
                new DataView(iv.buffer).setUint32(8, counter++);
                const ct = new Uint8Array(await crypto.subtle.encrypt(
                  { name: 'AES-GCM', iv, additionalData: new Uint8Array(0) },
                  currentKey, data
                ));
                const out = new Uint8Array(12 + ct.byteLength);
                out.set(iv, 0);
                out.set(ct, 12);
                frame.data = out.buffer;
              } catch {}
              controller.enqueue(frame);
            } else {
              const data = new Uint8Array(frame.data);
              if (data.byteLength < 28) { controller.enqueue(frame); return; }
              const iv = data.slice(0, 12);
              const ciphertext = data.slice(12);
              let ok = false;
              for (const key of [currentKey, previousKey]) {
                if (!key) continue;
                try {
                  frame.data = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv, additionalData: new Uint8Array(0) },
                    key, ciphertext
                  );
                  ok = true;
                  break;
                } catch {}
              }
              if (ok) controller.enqueue(frame);
            }
          }
        });
        readable.pipeThrough(transform).pipeTo(writable);
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
    return this.worker;
  }

  // ── Cleanup ─────────────────────────────────────────────

  /**
   * Remove all transforms and release resources.
   */
  cleanup(): void {
    for (const [pc, state] of this.connections) {
      pc.removeEventListener('track', state.trackListener);

      for (const [sender] of state.senders) {
        try { (sender as any).transform = null; } catch {}
      }
      state.senders.clear();

      for (const [receiver] of state.receivers) {
        try { (receiver as any).transform = null; } catch {}
      }
      state.receivers.clear();
    }
    this.connections.clear();

    if (this.overlapTimer) {
      clearTimeout(this.overlapTimer);
      this.overlapTimer = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.currentKey = null;
    this.previousKey = null;
    this.counter = 0;
  }
}

// ─── Singleton + exports ──────────────────────────────────

export const sframeService = new SFrameService();
export default sframeService;
