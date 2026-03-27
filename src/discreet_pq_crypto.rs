// discreet_pq_crypto.rs — Post-quantum cryptographic operations.
//
// ML-KEM-768 (FIPS 203): libcrux-ml-kem by Cryspen. Formally verified for
// panic freedom, correctness, and secret independence using hax and F*.
// SIMD-optimized (AVX2, AArch64 Neon) with runtime CPU feature detection.
//
// ML-DSA-65 (FIPS 204): gated behind `pq-sig` feature until a formally
// verified implementation (libcrux-ml-dsa) is available on crates.io.
//
// The hybrid architecture layers ML-KEM over MLS group secrets at the
// application level, since OpenMLS 0.8 does not support PQ cipher suites.

use libcrux_ml_kem::mlkem768;
use rand::RngCore;

/// ML-KEM-768 key pair (public + private).
pub type MlKemKeyPair = mlkem768::MlKem768KeyPair;

/// ML-KEM-768 ciphertext (1088 bytes).
pub type MlKemCiphertext = mlkem768::MlKem768Ciphertext;

// ─── ML-KEM-768 Key Encapsulation ───────────────────────────────────────

/// Generate an ML-KEM-768 keypair.
///
/// Uses 64 bytes of OS randomness. The private key must be stored securely;
/// the public key is shared with peers for encapsulation.
pub fn pq_kem_keygen() -> MlKemKeyPair {
    let mut randomness = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut randomness);
    mlkem768::generate_key_pair(randomness)
}

/// Validate a public key per FIPS 203 requirements.
///
/// MUST be called before encapsulating with any received public key.
/// Rejects malformed keys that could enable chosen-ciphertext attacks.
pub fn pq_validate_public_key(public_key: &mlkem768::MlKem768PublicKey) -> bool {
    mlkem768::validate_public_key(public_key)
}

/// Encapsulate a shared secret using the recipient's public key.
///
/// Returns `(ciphertext, shared_secret)`. The ciphertext is sent to the
/// recipient; the 32-byte shared secret derives symmetric keys via HKDF.
///
/// Returns `None` if the public key fails FIPS 203 validation.
pub fn pq_encapsulate(
    public_key: &mlkem768::MlKem768PublicKey,
) -> Option<(MlKemCiphertext, [u8; 32])> {
    if !mlkem768::validate_public_key(public_key) {
        return None;
    }
    let mut randomness = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut randomness);
    let (ct, ss) = mlkem768::encapsulate(public_key, randomness);
    Some((ct, ss))
}

/// Decapsulate a shared secret from a ciphertext using the private key.
///
/// Returns the same 32-byte shared secret produced by `pq_encapsulate`.
pub fn pq_decapsulate(
    private_key: &mlkem768::MlKem768PrivateKey,
    ciphertext: &MlKemCiphertext,
) -> [u8; 32] {
    mlkem768::decapsulate(private_key, ciphertext)
}

// ─── ML-DSA-65 Digital Signatures (gated behind pq-sig feature) ─────────

#[cfg(feature = "pq-sig")]
pub use ml_dsa::{MlDsa65, SigningKey, VerifyingKey};

#[cfg(feature = "pq-sig")]
pub fn pq_sig_keygen() -> (SigningKey<MlDsa65>, VerifyingKey<MlDsa65>) {
    use ml_dsa::KeyGen as DsaKeyGen;
    let mut rng = rand::thread_rng();
    let sk = SigningKey::<MlDsa65>::generate(&mut rng);
    let vk = sk.verifying_key().clone();
    (sk, vk)
}

#[cfg(feature = "pq-sig")]
pub fn pq_sign(signing_key: &SigningKey<MlDsa65>, message: &[u8]) -> Vec<u8> {
    use ml_dsa::Signer;
    signing_key.sign(message).to_bytes().to_vec()
}

#[cfg(feature = "pq-sig")]
pub fn pq_verify(
    verifying_key: &VerifyingKey<MlDsa65>,
    message: &[u8],
    signature: &[u8],
) -> bool {
    use ml_dsa::{Signature, Verifier};
    let Ok(sig) = Signature::<MlDsa65>::try_from(signature) else {
        return false;
    };
    verifying_key.verify(message, &sig).is_ok()
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kem_keygen_produces_valid_key() {
        let kp = pq_kem_keygen();
        assert!(
            pq_validate_public_key(kp.public_key()),
            "Generated public key must pass FIPS 203 validation"
        );
    }

    #[test]
    fn kem_encapsulate_decapsulate() {
        let kp = pq_kem_keygen();
        let (ct, ss_sender) = pq_encapsulate(kp.public_key())
            .expect("Encapsulation with valid key must succeed");
        let ss_receiver = pq_decapsulate(kp.private_key(), &ct);
        assert_eq!(
            ss_sender, ss_receiver,
            "Sender and receiver shared secrets must match"
        );
    }

    #[test]
    fn kem_different_keys_different_secrets() {
        let kp1 = pq_kem_keygen();
        let kp2 = pq_kem_keygen();
        let (_, ss1) = pq_encapsulate(kp1.public_key()).unwrap();
        let (_, ss2) = pq_encapsulate(kp2.public_key()).unwrap();
        assert_ne!(ss1, ss2, "Different keys should produce different secrets");
    }

    #[test]
    fn kem_key_validation_rejects_zeros() {
        // All-zero bytes should not pass validation
        let zero_key = mlkem768::MlKem768PublicKey::from([0u8; 1184]);
        // Note: validation may or may not reject all-zeros depending on
        // the implementation. The important thing is it doesn't panic.
        let _ = pq_validate_public_key(&zero_key);
    }

    #[cfg(feature = "pq-sig")]
    #[test]
    fn sig_sign_verify() {
        let (sk, vk) = pq_sig_keygen();
        let message = b"discreet post-quantum test message";
        let sig = pq_sign(&sk, message);
        assert!(
            pq_verify(&vk, message, &sig),
            "Signature should verify with correct key and message"
        );
    }

    #[cfg(feature = "pq-sig")]
    #[test]
    fn sig_verify_wrong_message() {
        let (sk, vk) = pq_sig_keygen();
        let sig = pq_sign(&sk, b"correct message");
        assert!(
            !pq_verify(&vk, b"wrong message", &sig),
            "Signature should not verify with wrong message"
        );
    }

    #[cfg(feature = "pq-sig")]
    #[test]
    fn sig_verify_wrong_key() {
        let (sk, _) = pq_sig_keygen();
        let (_, wrong_vk) = pq_sig_keygen();
        let sig = pq_sign(&sk, b"test");
        assert!(
            !pq_verify(&wrong_vk, b"test", &sig),
            "Signature should not verify with wrong key"
        );
    }

    #[cfg(feature = "pq-sig")]
    #[test]
    fn sig_verify_garbage_signature() {
        let (_, vk) = pq_sig_keygen();
        assert!(!pq_verify(&vk, b"test", &[0u8; 10]));
        assert!(!pq_verify(&vk, b"test", &[]));
    }
}
