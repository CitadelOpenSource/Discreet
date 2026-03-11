//! SFrame (RFC 9605) voice/media encryption for Discreet.
//!
//! Wraps the `sframe` crate to provide per-channel frame encryption
//! using AES-256-GCM (SHA-512 key schedule, 128-bit tag) with
//! HKDF-SHA256 key derivation from MLS epoch secrets.

use hkdf::Hkdf;
use sha2::Sha256;
use sframe::{receiver::Receiver, sender::Sender, CipherSuiteVariant};

/// SFrame cipher suite: AES_256_GCM_SHA512_128 per RFC 9605.
const CIPHER_SUITE: CipherSuiteVariant = CipherSuiteVariant::AesGcm256Sha512;

/// Wrapper around an SFrame [`Sender`] that encrypts voice frames.
pub struct EncryptionKey {
    sender: Sender,
    key_material: Vec<u8>,
}

/// Wrapper around an SFrame [`Receiver`] that decrypts voice frames.
pub struct DecryptionKey {
    receiver: Receiver,
    key_material: Vec<u8>,
}

impl EncryptionKey {
    /// Returns the raw 32-byte key material (useful for WASM serialisation).
    pub fn key_material(&self) -> &[u8] {
        &self.key_material
    }
}

impl DecryptionKey {
    /// Returns the raw 32-byte key material (useful for WASM serialisation).
    pub fn key_material(&self) -> &[u8] {
        &self.key_material
    }
}

/// Derives a 32-byte voice key from `base_secret`, `channel_id`, and `epoch`
/// using HKDF-SHA256, then constructs an [`EncryptionKey`] and [`DecryptionKey`]
/// configured for AES_256_GCM_SHA512_128.
///
/// The `epoch` is also used as the SFrame `key_id`.
pub fn derive_voice_key(
    base_secret: &[u8],
    channel_id: &str,
    epoch: u64,
) -> Result<(EncryptionKey, DecryptionKey), String> {
    // HKDF-SHA256: extract then expand
    let salt = format!("discreet-voice-{channel_id}-{epoch}");
    let hk = Hkdf::<Sha256>::new(Some(salt.as_bytes()), base_secret);
    let mut okm = [0u8; 32];
    hk.expand(b"sframe-key", &mut okm)
        .map_err(|e| format!("HKDF expand: {e}"))?;

    let key_id = epoch;

    let mut sender = Sender::with_cipher_suite(key_id, CIPHER_SUITE);
    sender
        .set_encryption_key(&okm)
        .map_err(|e| format!("SFrame set encryption key: {e}"))?;

    let mut receiver = Receiver::with_cipher_suite(CIPHER_SUITE);
    receiver
        .set_encryption_key(key_id, &okm)
        .map_err(|e| format!("SFrame set decryption key: {e}"))?;

    Ok((
        EncryptionKey {
            sender,
            key_material: okm.to_vec(),
        },
        DecryptionKey {
            receiver,
            key_material: okm.to_vec(),
        },
    ))
}

/// Encrypts a single voice frame with the given [`EncryptionKey`].
///
/// `key_id` is recorded in the SFrame header for receiver-side key lookup.
/// `counter` is incremented after each successful encryption to track frame count.
pub fn encrypt_voice_frame(
    plaintext: &[u8],
    _key_id: u64,
    enc_key: &mut EncryptionKey,
    counter: &mut u64,
) -> Result<Vec<u8>, String> {
    let ciphertext = enc_key
        .sender
        .encrypt(plaintext, 0)
        .map_err(|e| format!("SFrame encrypt: {e}"))?;
    *counter += 1;
    Ok(ciphertext.to_vec())
}

/// Decrypts an SFrame-encrypted voice frame with the given [`DecryptionKey`].
pub fn decrypt_voice_frame(
    ciphertext: &[u8],
    dec_key: &mut DecryptionKey,
) -> Result<Vec<u8>, String> {
    let plaintext = dec_key
        .receiver
        .decrypt(ciphertext, 0)
        .map_err(|e| format!("SFrame decrypt: {e}"))?;
    Ok(plaintext.to_vec())
}

// ── Raw-bytes helpers for WASM interop ──────────────────────────────────

/// HKDF-SHA256 key derivation returning raw 32-byte key material.
pub fn derive_voice_key_bytes(
    base_secret: &[u8],
    channel_id: &str,
    epoch: u64,
) -> Result<Vec<u8>, String> {
    let salt = format!("discreet-voice-{channel_id}-{epoch}");
    let hk = Hkdf::<Sha256>::new(Some(salt.as_bytes()), base_secret);
    let mut okm = [0u8; 32];
    hk.expand(b"sframe-key", &mut okm)
        .map_err(|e| format!("HKDF expand: {e}"))?;
    Ok(okm.to_vec())
}

/// Encrypts a voice frame from raw key bytes (stateless, creates a fresh Sender).
pub fn encrypt_voice_frame_bytes(
    plaintext: &[u8],
    key_material: &[u8],
    key_id: u64,
) -> Result<Vec<u8>, String> {
    let mut sender = Sender::with_cipher_suite(key_id, CIPHER_SUITE);
    sender
        .set_encryption_key(key_material)
        .map_err(|e| format!("SFrame set key: {e}"))?;
    let ciphertext = sender
        .encrypt(plaintext, 0)
        .map_err(|e| format!("SFrame encrypt: {e}"))?;
    Ok(ciphertext.to_vec())
}

/// Decrypts a voice frame from raw key bytes (stateless, creates a fresh Receiver).
pub fn decrypt_voice_frame_bytes(
    ciphertext: &[u8],
    key_material: &[u8],
    key_id: u64,
) -> Result<Vec<u8>, String> {
    let mut receiver = Receiver::with_cipher_suite(CIPHER_SUITE);
    receiver
        .set_encryption_key(key_id, key_material)
        .map_err(|e| format!("SFrame set key: {e}"))?;
    let plaintext = receiver
        .decrypt(ciphertext, 0)
        .map_err(|e| format!("SFrame decrypt: {e}"))?;
    Ok(plaintext.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_voice_key_length() {
        let (enc, dec) = derive_voice_key(b"base-secret", "channel-1", 0)
            .expect("derive_voice_key failed");
        assert_eq!(enc.key_material().len(), 32);
        assert_eq!(dec.key_material().len(), 32);
        assert_eq!(enc.key_material(), dec.key_material());
    }

    #[test]
    fn test_sframe_voice_roundtrip() {
        let base_secret = b"super-secret-base-key-material!!";
        let channel_id = "voice-channel-42";
        let epoch = 1u64;

        let (mut enc_key, mut dec_key) =
            derive_voice_key(base_secret, channel_id, epoch)
                .expect("derive_voice_key failed");

        let plaintext = b"hello voice frame data 1234567890";
        let mut counter = 0u64;

        let ciphertext = encrypt_voice_frame(plaintext, epoch, &mut enc_key, &mut counter)
            .expect("encrypt_voice_frame failed");

        assert_eq!(counter, 1);
        assert_ne!(&ciphertext[..], &plaintext[..]);

        let decrypted = decrypt_voice_frame(&ciphertext, &mut dec_key)
            .expect("decrypt_voice_frame failed");

        assert_eq!(&decrypted[..], &plaintext[..]);
    }

    #[test]
    fn test_sframe_voice_multiple_frames() {
        let (mut enc, mut dec) =
            derive_voice_key(b"key-material", "ch-99", 5).unwrap();
        let mut ctr = 0u64;

        for i in 0..5u8 {
            let frame = vec![i; 160]; // simulated 20ms Opus frame
            let ct = encrypt_voice_frame(&frame, 5, &mut enc, &mut ctr).unwrap();
            let pt = decrypt_voice_frame(&ct, &mut dec).unwrap();
            assert_eq!(pt, frame);
        }
        assert_eq!(ctr, 5);
    }

    #[test]
    fn test_different_epochs_produce_different_keys() {
        let secret = b"same-secret";
        let (e1, _) = derive_voice_key(secret, "ch", 1).unwrap();
        let (e2, _) = derive_voice_key(secret, "ch", 2).unwrap();
        assert_ne!(e1.key_material(), e2.key_material());
    }

    #[test]
    fn test_bytes_helpers_roundtrip() {
        let key = derive_voice_key_bytes(b"secret", "ch", 0).unwrap();
        let ct = encrypt_voice_frame_bytes(b"audio", &key, 0).unwrap();
        let pt = decrypt_voice_frame_bytes(&ct, &key, 0).unwrap();
        assert_eq!(&pt[..], b"audio");
    }
}
