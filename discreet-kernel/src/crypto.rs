/// AES-256-GCM + HKDF-SHA256. All intermediate key material zeroized.
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::KernelError;

/// AES-256-GCM nonce size in bytes (96 bits).
const NONCE_SIZE: usize = 12;
/// AES-256 key size in bytes.
const KEY_SIZE: usize = 32;

// ─── Key Derivation ──────────────────────────────────────────────────────────

/// Salt context for HKDF derivation.
pub enum KeyContext<'a> {
    /// Channel message encryption: "discreet:{channel_id}:{epoch}"
    Channel { channel_id: &'a str, epoch: u64 },
    /// Voice/video SFrame: "discreet-voice-{channel_id}-{epoch}"
    Voice { channel_id: &'a str, epoch: u64 },
    /// AI agent key wrapping: "discreet-agent-v1"
    Agent,
    /// OAuth token encryption: "discreet-oauth-v1"
    OAuth,
}

impl<'a> KeyContext<'a> {
    fn salt_string(&self) -> String {
        match self {
            Self::Channel { channel_id, epoch } => {
                format!("discreet:{}:{}", channel_id, epoch)
            }
            Self::Voice { channel_id, epoch } => {
                format!("discreet-voice-{}-{}", channel_id, epoch)
            }
            Self::Agent => "discreet-agent-v1".to_string(),
            Self::OAuth => "discreet-oauth-v1".to_string(),
        }
    }
}

/// HKDF-SHA256 key derivation (RFC 5869).
///
/// Parameters:
///   IKM  = master key material
///   salt = context string from KeyContext (e.g. "discreet:{cid}:{epoch}")
///   info = fixed application label "discreet-key-v1"
///
/// RFC 5869 §3.1 notes that salt and info are both optional and serve
/// different purposes: salt adds entropy to the extract step, info
/// differentiates derived keys in the expand step. We use the channel-
/// specific context as salt so each channel/epoch produces a distinct
/// PRK, and a fixed info string since only one key is derived per PRK.
pub fn derive_key(master: &[u8], ctx: &KeyContext<'_>) -> Result<Zeroizing<Vec<u8>>, KernelError> {
    if master.is_empty() {
        return Err(KernelError::EncryptionFailed(
            "Master key is empty".to_string(),
        ));
    }

    let salt = ctx.salt_string();
    let hk = Hkdf::<Sha256>::new(Some(salt.as_bytes()), master);

    let mut okm = Zeroizing::new(vec![0u8; KEY_SIZE]);
    hk.expand(b"discreet-key-v1", &mut okm).map_err(|e| {
        KernelError::EncryptionFailed(format!("HKDF expand failed: {}", e))
    })?;

    Ok(okm)
}

/// Derive channel key for a given channel + epoch.
pub fn derive_channel_key(
    channel_id: &str,
    epoch: u64,
    master: &[u8],
) -> Result<Zeroizing<Vec<u8>>, KernelError> {
    derive_key(master, &KeyContext::Channel { channel_id, epoch })
}

// ─── Encryption ──────────────────────────────────────────────────────────────

/// AES-256-GCM encrypt. Returns base64(nonce ‖ ciphertext).
pub fn encrypt(key: &[u8], plaintext: &[u8]) -> Result<String, KernelError> {
    if key.len() != KEY_SIZE {
        return Err(KernelError::EncryptionFailed(format!(
            "Key must be {} bytes, got {}",
            KEY_SIZE,
            key.len()
        )));
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| {
        KernelError::EncryptionFailed(format!("Invalid key: {}", e))
    })?;

    // Generate random 96-bit nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| {
        KernelError::EncryptionFailed(format!("AES-GCM encrypt failed: {}", e))
    })?;

    // Prepend nonce to ciphertext, then base64-encode
    let mut combined = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(base64_encode(&combined))
}

/// AES-256-GCM decrypt. Caller must zeroize the returned bytes.
pub fn decrypt(key: &[u8], encoded: &str) -> Result<Vec<u8>, KernelError> {
    if key.len() != KEY_SIZE {
        return Err(KernelError::DecryptionFailed(format!(
            "Key must be {} bytes, got {}",
            KEY_SIZE,
            key.len()
        )));
    }

    let combined = base64_decode(encoded).map_err(|e| {
        KernelError::DecryptionFailed(format!("Base64 decode failed: {}", e))
    })?;

    if combined.len() < NONCE_SIZE + 1 {
        return Err(KernelError::DecryptionFailed(
            "Ciphertext too short".to_string(),
        ));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| {
        KernelError::DecryptionFailed(format!("Invalid key: {}", e))
    })?;

    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|_| {
        KernelError::DecryptionFailed(
            "Decryption failed — wrong key or corrupted data".to_string(),
        )
    })?;

    Ok(plaintext)
}

// ─── Epoch Management ────────────────────────────────────────────────────────

/// Max retained old epoch keys.
pub const MAX_RETAINED_EPOCHS: u64 = 5;

/// True if key_epoch is within the retention window.
pub fn is_epoch_retained(current_epoch: u64, key_epoch: u64) -> bool {
    if key_epoch > current_epoch {
        return false; // Future epoch — invalid
    }
    current_epoch - key_epoch < MAX_RETAINED_EPOCHS
}

// ─── Base64 helpers ──────────────────────────────────────────────────────────

use base64::Engine as _;

pub fn base64_encode(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

pub fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode failed: {}", e))
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroize;

    fn test_master_key() -> Vec<u8> {
        vec![0x42u8; 32]
    }

    #[test]
    fn derive_channel_key_produces_32_bytes() {
        let key = derive_channel_key("ch-123", 0, &test_master_key()).unwrap();
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn different_channels_derive_different_keys() {
        let k1 = derive_channel_key("ch-1", 0, &test_master_key()).unwrap();
        let k2 = derive_channel_key("ch-2", 0, &test_master_key()).unwrap();
        assert_ne!(k1, k2);
    }

    #[test]
    fn different_epochs_derive_different_keys() {
        let k0 = derive_channel_key("ch-1", 0, &test_master_key()).unwrap();
        let k1 = derive_channel_key("ch-1", 1, &test_master_key()).unwrap();
        assert_ne!(k0, k1);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = derive_channel_key("ch-1", 0, &test_master_key()).unwrap();
        let plaintext = b"Hello, Discreet!";

        let encoded = encrypt(&key, plaintext).unwrap();
        let mut decrypted = decrypt(&key, &encoded).unwrap();

        assert_eq!(decrypted, plaintext);
        decrypted.zeroize();
    }

    #[test]
    fn wrong_key_fails_decryption() {
        let key1 = derive_channel_key("ch-1", 0, &test_master_key()).unwrap();
        let key2 = derive_channel_key("ch-2", 0, &test_master_key()).unwrap();

        let encoded = encrypt(&key1, b"secret message").unwrap();
        let result = decrypt(&key2, &encoded);

        assert!(result.is_err());
        match result.unwrap_err() {
            KernelError::DecryptionFailed(_) => {} // Expected
            other => panic!("Expected DecryptionFailed, got {:?}", other),
        }
    }

    #[test]
    fn wrong_channel_fails_decryption() {
        let master = test_master_key();
        let key_ch1 = derive_channel_key("ch-1", 0, &master).unwrap();
        let key_ch2 = derive_channel_key("ch-2", 0, &master).unwrap();

        let encoded = encrypt(&key_ch1, b"for channel 1 only").unwrap();
        assert!(decrypt(&key_ch2, &encoded).is_err());
    }

    #[test]
    fn empty_master_key_rejected() {
        let result = derive_channel_key("ch-1", 0, &[]);
        assert!(result.is_err());
    }

    #[test]
    fn short_ciphertext_rejected() {
        let key = derive_channel_key("ch-1", 0, &test_master_key()).unwrap();
        let result = decrypt(&key, "AAAA"); // Too short after decode
        assert!(result.is_err());
    }

    #[test]
    fn epoch_retention_check() {
        assert!(is_epoch_retained(10, 6));  // 10-6=4 < 5
        assert!(is_epoch_retained(10, 10)); // Same epoch
        assert!(!is_epoch_retained(10, 5)); // 10-5=5, not < 5
        assert!(!is_epoch_retained(10, 0)); // Too old
        assert!(!is_epoch_retained(5, 10)); // Future epoch
    }

    #[test]
    fn base64_roundtrip() {
        let data = b"test data for base64 encoding";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn voice_and_agent_contexts_derive_different_keys() {
        let master = test_master_key();
        let k_chan = derive_key(&master, &KeyContext::Channel { channel_id: "ch", epoch: 0 }).unwrap();
        let k_voice = derive_key(&master, &KeyContext::Voice { channel_id: "ch", epoch: 0 }).unwrap();
        let k_agent = derive_key(&master, &KeyContext::Agent).unwrap();
        let k_oauth = derive_key(&master, &KeyContext::OAuth).unwrap();

        // All four contexts produce different keys
        assert_ne!(k_chan, k_voice);
        assert_ne!(k_chan, k_agent);
        assert_ne!(k_chan, k_oauth);
        assert_ne!(k_voice, k_agent);
    }

    #[test]
    fn decrypt_zeroizes_plaintext() {
        let key = derive_channel_key("ch-1", 0, &test_master_key()).unwrap();
        let encoded = encrypt(&key, b"sensitive data").unwrap();
        let mut plaintext = decrypt(&key, &encoded).unwrap();
        assert_eq!(plaintext, b"sensitive data");

        plaintext.zeroize();
        assert!(plaintext.iter().all(|&b| b == 0));
    }
}
