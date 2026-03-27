/**
 * kernelClient.ts — Typed async bridge between React and the Kernel Worker.
 *
 * React calls these typed functions. They send a postMessage to the Worker
 * and await the response via a pending-promise map. The Worker's WASM memory
 * is INACCESSIBLE from this thread — only JSON crosses the boundary.
 */

import type {
  KernelRequest,
  RenderMessage,
  CapabilitySet,
} from './types.generated';

// Re-export generated types for consumers
export type { KernelRequest, RenderMessage, CapabilitySet } from './types.generated';
export type { KernelResponse, KernelError, SanitizedContent, AuthorInfo, ValidatedLink, FormattingSpan, AttachmentMeta, PermissionSet } from './types.generated';

// ─── Worker lifecycle ────────────────────────────────────────────────────────

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('./kernel-worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (event) => {
      const { id, ok, data, error } = event.data;
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        if (ok) p.resolve(data);
        else p.reject(new Error(error));
      }
    };
    worker.onerror = (event) => {
      // Log but don't crash — kernel unavailability is handled by callers
      console.error('Kernel Worker error:', event.message);
    };
  }
  return worker;
}

// ─── Generic request ─────────────────────────────────────────────────────────

export function kernelRequest<T>(request: KernelRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, {
      resolve: resolve as (data: unknown) => void,
      reject,
    });
    getWorker().postMessage({ id, request });
  });
}

// ─── Typed convenience functions ─────────────────────────────────────────────

export function kernelInit() {
  return kernelRequest<Record<string, never>>({ type: 'Initialize' });
}

export function kernelEncrypt(channelId: string, plaintext: string) {
  return kernelRequest<{ ciphertext: string }>({
    type: 'Encrypt',
    channel_id: channelId,
    plaintext,
  });
}

export function kernelDecrypt(channelId: string, ciphertext: string) {
  return kernelRequest<{ render_model: RenderMessage }>({
    type: 'Decrypt',
    channel_id: channelId,
    ciphertext,
  });
}

export function kernelValidate(field: string, value: string) {
  return kernelRequest<{ valid: boolean; error?: string }>({
    type: 'ValidateInput',
    field,
    value,
  });
}

export function kernelGetCapabilities(
  channelId: string,
  userId: string,
  role: string,
) {
  return kernelRequest<{ caps: CapabilitySet }>({
    type: 'GetCapabilities',
    channel_id: channelId,
    user_id: userId,
    user_role: role,
  });
}

export function kernelGenerateOutgoing(channelId: string, text: string) {
  return kernelRequest<{ encrypted: string }>({
    type: 'GenerateOutgoing',
    channel_id: channelId,
    text,
  });
}

export function kernelUnlock(assertion: string) {
  return kernelRequest<Record<string, never>>({
    type: 'Unlock',
    assertion,
  });
}

export function kernelPersistState() {
  return kernelRequest<{ sealed_state: string }>({
    type: 'PersistState',
  });
}

export function kernelRestoreState(encryptedState: string) {
  return kernelRequest<Record<string, never>>({
    type: 'RestoreState',
    encrypted_state: encryptedState,
  });
}
