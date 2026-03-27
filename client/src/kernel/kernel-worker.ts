/**
 * kernel-worker.ts — Web Worker that hosts the Discreet Security Kernel.
 *
 * The WASM module runs in this Worker's memory space, which is
 * INACCESSIBLE from the main thread. The main thread communicates
 * via structured-clone postMessage only — no SharedArrayBuffer,
 * no transferable handles to kernel memory.
 *
 * Sealed storage: PersistState/RestoreState use `kernel_handle_async`
 * which encrypts/decrypts with a non-extractable WebCrypto key that
 * exists only in this Worker's crypto keystore.
 *
 * Protocol:
 *   Main → Worker: { id: number, request: KernelRequest }
 *   Worker → Main: { id: number, ok: true, data: KernelResponse }
 *                 | { id: number, ok: false, error: string }
 */

import init, { kernel_handle, kernel_handle_async } from '../../../discreet-kernel/pkg/discreet_kernel';

let ready = false;

// Request types that require the async (sealed storage) path
const ASYNC_TYPES = new Set(['PersistState', 'RestoreState']);

self.onmessage = async (event: MessageEvent) => {
  const { id, request } = event.data;

  try {
    if (!ready) {
      await init();
      ready = true;
    }

    const requestJson = JSON.stringify(request);
    let responseJson: string;

    if (ASYNC_TYPES.has(request.type)) {
      // Sealed storage operations — use async handler (WebCrypto Promises)
      responseJson = await kernel_handle_async(requestJson);
    } else {
      // All other operations — synchronous handler
      responseJson = kernel_handle(requestJson);
    }

    const response = JSON.parse(responseJson);

    (self as unknown as Worker).postMessage({
      id,
      ok: true,
      data: response,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: message,
    });
  }
};
