/**
 * discreet-crypto WASM bridge
 * 
 * Imports the WASM module as a local npm dependency (file:../discreet-crypto/pkg).
 * Vite handles WASM loading natively via vite-plugin-wasm.
 * 
 * If WASM isn't built yet, falls back to PBKDF2 encryption.
 */

let wasmModule: typeof import('discreet-crypto') | null = null;
let initialized = false;

/**
 * Initialize the WASM crypto module.
 * Must be called before any other crypto operations.
 */
export async function initCrypto(): Promise<void> {
  if (initialized) return;
  
  try {
    const mod = await import('discreet-crypto');
    // wasm-pack --target web requires calling the default export to init
    if (typeof mod.default === 'function') {
      await mod.default();
    }
    wasmModule = mod;
    initialized = true;
    console.log('[crypto] MLS WASM module loaded — RFC 9420 active');
  } catch (e) {
    console.warn('[crypto] WASM not available, using PBKDF2 fallback:', (e as Error)?.message);
  }
}

/**
 * Check if real MLS crypto is available (WASM loaded).
 * If false, the client operates in legacy PBKDF2 mode.
 */
export function isMlsAvailable(): boolean {
  return initialized && wasmModule !== null;
}

/**
 * Generate a new MLS identity for the current user.
 * Called once at registration, stored in IndexedDB.
 */
export async function generateIdentity(userId: string, username: string) {
  if (!isMlsAvailable()) throw new Error('MLS not initialized');
  return wasmModule.generate_identity(userId, username);
}

/**
 * Generate KeyPackages for upload to the server.
 * @param count Number of KeyPackages to generate (default: 50)
 */
export async function generateKeyPackages(count: number = 50): Promise<Uint8Array[]> {
  if (!isMlsAvailable()) throw new Error('MLS not initialized');
  return wasmModule.generate_key_packages(count);
}

/**
 * Create a new MLS group for a channel.
 * @param channelId The channel UUID (used as MLS GroupId)
 */
export async function createGroup(channelId: string): Promise<string> {
  if (!isMlsAvailable()) throw new Error('MLS not initialized');
  return wasmModule.create_group(channelId);
}

/**
 * Encrypt a message for the current group.
 * Returns base64-encoded ciphertext for the server.
 */
export async function encryptMessage(groupId: string, plaintext: string): Promise<string> {
  if (!isMlsAvailable()) {
    // Fallback: legacy PBKDF2 encryption
    return legacyEncrypt(groupId, plaintext);
  }
  return wasmModule.encrypt_message(groupId, plaintext);
}

/**
 * Decrypt a message from the current group.
 * Input is base64-encoded ciphertext from the server.
 */
export async function decryptMessage(groupId: string, ciphertext: string): Promise<string> {
  if (!isMlsAvailable()) {
    // Fallback: legacy PBKDF2 decryption
    return legacyDecrypt(groupId, ciphertext);
  }
  return wasmModule.decrypt_message(groupId, ciphertext);
}

// ── Legacy PBKDF2 fallback (matches current client/index.html crypto) ──

async function legacyEncrypt(channelId: string, plaintext: string): Promise<string> {
  const key = await deriveChannelKey(channelId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  // Prepend IV to ciphertext
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function legacyDecrypt(channelId: string, b64: string): Promise<string> {
  try {
    const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const key = await deriveChannelKey(channelId);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return b64; // Return raw text if decryption fails (unencrypted message)
  }
}

async function deriveChannelKey(channelId: string): Promise<CryptoKey> {
  const password = `citadel:${channelId}:0`;
  const salt = new TextEncoder().encode('mls-group-secret');
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
