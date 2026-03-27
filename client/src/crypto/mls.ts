/**
 * discreet-crypto WASM bridge
 * 
 * Imports the WASM module as a local npm dependency (file:../discreet-crypto/pkg).
 * Vite handles WASM loading natively via vite-plugin-wasm.
 * 
 * If WASM isn't built yet, falls back to HKDF-SHA256 encryption.
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
    // MLS WASM module loaded — RFC 9420 active
  } catch (e) {
    // WASM not available — using HKDF fallback
  }
}

/**
 * Check if real MLS crypto is available (WASM loaded).
 * If false, the client operates in HKDF-SHA256 fallback mode.
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
    // Fallback: HKDF-SHA256 encryption
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
    // Fallback: HKDF-SHA256 decryption
    return legacyDecrypt(groupId, ciphertext);
  }
  return wasmModule.decrypt_message(groupId, ciphertext);
}

// ── HKDF-SHA256 fallback (symmetric channel encryption) ──

/** Constant-time comparison of two byte arrays. */
function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Derive 32-byte key commitment tag for a channel (info suffix ":commit"). */
async function deriveChannelCommitment(channelId: string): Promise<Uint8Array> {
  const salt = new TextEncoder().encode('discreet-mls-v1');
  const info = new TextEncoder().encode(`discreet:${channelId}:0:commit`);
  const km = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`discreet:${channelId}:0`),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    km,
    256,
  );
  return new Uint8Array(bits);
}

async function legacyEncrypt(channelId: string, plaintext: string): Promise<string> {
  const key = await deriveChannelKey(channelId);
  const commitment = await deriveChannelCommitment(channelId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  // Output: [commitment(32) | iv(12) | ciphertext]
  const combined = new Uint8Array(32 + iv.length + new Uint8Array(ciphertext).length);
  combined.set(commitment);
  combined.set(iv, 32);
  combined.set(new Uint8Array(ciphertext), 32 + iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function legacyDecrypt(channelId: string, b64: string): Promise<string> {
  try {
    const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (combined.length < 32 + 12) throw new Error('Key commitment failed');
    const storedCommit = combined.slice(0, 32);
    const expectedCommit = await deriveChannelCommitment(channelId);
    if (!ctEqual(storedCommit, expectedCommit)) throw new Error('Key commitment failed');
    const iv = combined.slice(32, 44);
    const ciphertext = combined.slice(44);
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

/**
 * Derive raw 32-byte key material for a channel (used by SFrame voice encryption).
 * Same HKDF-SHA256 derivation as text encryption but exports raw bytes.
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

async function deriveChannelKey(channelId: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode('discreet-mls-v1');
  const info = new TextEncoder().encode(`discreet:${channelId}:0`);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`discreet:${channelId}:0`),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
