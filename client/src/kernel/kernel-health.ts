/**
 * kernel-health.ts — Kernel health check for Settings > About.
 *
 * Probes the kernel Worker to determine if WASM is loaded, the kernel is
 * responsive, WebCrypto is available, and the oracle is in a ready state.
 * Results are displayed in the Settings UI so users and developers can
 * verify the security kernel is operational.
 */
import { kernelInit, kernelValidate } from './kernelClient';

export interface KernelHealth {
  workerCreated: boolean;
  wasmInitialized: boolean;
  kernelResponsive: boolean;
  webCryptoAvailable: boolean;
  sealedStorageSupported: boolean;
  oracleStatus: 'ready' | 'locked' | 'unknown';
}

export async function checkKernelHealth(): Promise<KernelHealth> {
  const health: KernelHealth = {
    workerCreated: false,
    wasmInitialized: false,
    kernelResponsive: false,
    webCryptoAvailable: false,
    sealedStorageSupported: false,
    oracleStatus: 'unknown',
  };

  try {
    // Check if Worker and WASM are up
    await kernelInit();
    health.workerCreated = true;
    health.wasmInitialized = true;
    health.kernelResponsive = true;

    // Check WebCrypto availability (main thread — mirrors Worker capability)
    health.webCryptoAvailable =
      typeof crypto !== 'undefined' &&
      typeof crypto.subtle !== 'undefined';
    health.sealedStorageSupported = health.webCryptoAvailable;

    // Check oracle status by attempting a lightweight validate
    try {
      await kernelValidate('message', 'health check');
      health.oracleStatus = 'ready';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      health.oracleStatus = msg.includes('LOCKED') ? 'locked' : 'unknown';
    }
  } catch {
    // Kernel not available — health stays at defaults
  }

  return health;
}
