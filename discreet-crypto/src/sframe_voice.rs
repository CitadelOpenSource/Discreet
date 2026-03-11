//! SFrame (RFC 9605) voice/media encryption for Discreet.
//!
//! Wraps the `sframe` crate to provide per-channel frame encryption
//! using AES-256-GCM with SHA-512 key derivation.

use sframe::{receiver::Receiver, sender::Sender, CipherSuiteVariant};

const CIPHER_SUITE: CipherSuiteVariant = CipherSuiteVariant::AesGcm256Sha512;

/// Derives an SFrame encryption key from a channel ID, epoch, and base secret.
///
/// Returns a 32-byte key suitable for use with [`sframe_encrypt`] / [`sframe_decrypt`].
pub fn derive_sframe_key(channel_id: &str, epoch: u64, base_secret: &[u8]) -> Vec<u8> {
    use sha2::{Sha512, Digest};
    let mut hasher = Sha512::new();
    hasher.update(b"discreet-sframe-key-v1:");
    hasher.update(channel_id.as_bytes());
    hasher.update(b":");
    hasher.update(epoch.to_be_bytes());
    hasher.update(b":");
    hasher.update(base_secret);
    let hash = hasher.finalize();
    // Take first 32 bytes as the key material
    hash[..32].to_vec()
}

/// Encrypts a plaintext frame using SFrame with the given key material and key ID.
///
/// The `key_material` should be derived from [`derive_sframe_key`].
/// The `key_id` identifies the sender/epoch for decryption routing.
pub fn sframe_encrypt(plaintext: &[u8], key_material: &[u8], key_id: u64) -> Result<Vec<u8>, String> {
    let mut sender = Sender::with_cipher_suite(key_id, CIPHER_SUITE);
    sender
        .set_encryption_key(key_material)
        .map_err(|e| format!("SFrame set key: {e}"))?;
    let encrypted = sender
        .encrypt(plaintext, 0)
        .map_err(|e| format!("SFrame encrypt: {e}"))?;
    Ok(encrypted.to_vec())
}

/// Decrypts an SFrame-encrypted ciphertext.
///
/// The `key_material` must match what was used to encrypt, and `key_id` must
/// match the sender's key ID embedded in the SFrame header.
pub fn sframe_decrypt(ciphertext: &[u8], key_material: &[u8], key_id: u64) -> Result<Vec<u8>, String> {
    let mut receiver = Receiver::with_cipher_suite(CIPHER_SUITE);
    receiver
        .set_encryption_key(key_id, key_material)
        .map_err(|e| format!("SFrame set key: {e}"))?;
    let decrypted = receiver
        .decrypt(ciphertext, 0)
        .map_err(|e| format!("SFrame decrypt: {e}"))?;
    Ok(decrypted.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sframe_roundtrip() {
        let channel_id = "voice-channel-42";
        let epoch = 1u64;
        let base_secret = b"super-secret-base-key-material!!";
        let key_id = 7u64;

        // Derive key
        let key = derive_sframe_key(channel_id, epoch, base_secret);
        assert_eq!(key.len(), 32);

        // Encrypt
        let plaintext = b"hello voice frame data 1234567890";
        let ciphertext = sframe_encrypt(plaintext, &key, key_id)
            .expect("encryption failed");
        assert_ne!(ciphertext, plaintext);

        // Decrypt
        let decrypted = sframe_decrypt(&ciphertext, &key, key_id)
            .expect("decryption failed");
        assert_eq!(decrypted, plaintext);
    }
}
