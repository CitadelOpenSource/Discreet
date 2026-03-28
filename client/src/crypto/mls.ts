/**
 * discreet-crypto WASM bridge
 *
 * Imports the WASM module as a local npm dependency (file:../discreet-crypto/pkg).
 * Vite handles WASM loading natively via vite-plugin-wasm.
 *
 * No fallback path — if WASM isn't available, encryption operations throw.
 */

let wasmModule: typeof import('discreet-crypto') | null = null;
let initialized = false;

export async function initCrypto(): Promise<void> {
  if (initialized) return;
  try {
    const mod = await import('discreet-crypto');
    if (typeof mod.default === 'function') {
      await mod.default();
    }
    wasmModule = mod;
    initialized = true;
  } catch (e) {
    console.warn('[mls] WASM crypto module failed to load:', e);
  }
}

export function isMlsAvailable(): boolean {
  return initialized && wasmModule !== null;
}

export async function generateIdentity(userId: string, username: string) {
  if (!isMlsAvailable()) throw new Error('MLS not initialized');
  return wasmModule!.generate_identity(userId, username);
}

export async function generateKeyPackages(count: number = 50): Promise<Uint8Array[]> {
  if (!isMlsAvailable()) throw new Error('MLS not initialized');
  return wasmModule!.generate_key_packages(count);
}

export async function createGroup(channelId: string): Promise<string> {
  if (!isMlsAvailable()) throw new Error('MLS not initialized');
  return wasmModule!.create_group(channelId);
}

export async function encryptMessage(groupId: string, plaintext: string): Promise<string> {
  if (!isMlsAvailable()) throw new Error('MLS not initialized — cannot encrypt');
  return wasmModule!.encrypt_message(groupId, plaintext);
}

export async function decryptMessage(groupId: string, ciphertext: string): Promise<string> {
  if (!isMlsAvailable()) throw new Error('MLS not initialized — cannot decrypt');
  return wasmModule!.decrypt_message(groupId, ciphertext);
}

/**
 * Derive raw 32-byte key material for a channel (used by SFrame voice encryption).
 * Uses WebCrypto HKDF-SHA256 — does not require the WASM module.
 */
export async function deriveChannelKeyBytes(channelId: string): Promise<Uint8Array> {
  const salt = new TextEncoder().encode('discreet-mls-v1');
  const info = new TextEncoder().encode(`discreet:${channelId}:0`);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`discreet:${channelId}:0`),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}
