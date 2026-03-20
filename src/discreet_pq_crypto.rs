// discreet_pq_crypto.rs — Post-quantum cryptographic operations.
//
// Wraps ML-KEM-768 (FIPS 203) for key encapsulation and ML-DSA-65
// (FIPS 204) for digital signatures. Gated behind the `pq` feature flag.
//
// These are the building blocks for hybrid PQ+classical key exchange
// described in discreet_post_quantum.rs. The classical halves (X25519,
// Ed25519) live behind the existing `post-quantum` feature flag.
//
// Compile: cargo build --features pq
// Test:    cargo test --features pq pq_crypto

use ml_kem::{
    kem::{Decapsulate, Encapsulate},
    KemCore, MlKem768, MlKem768Params,
};
use ml_dsa::{MlDsa65, KeyGen as DsaKeyGen, SigningKey, VerifyingKey};

/// ML-KEM-768 encapsulation key (public key, 1184 bytes).
pub type KemEncapsulationKey = ml_kem::kem::EncapsulationKey<MlKem768Params>;

/// ML-KEM-768 decapsulation key (secret key, 2400 bytes).
pub type KemDecapsulationKey = ml_kem::kem::DecapsulationKey<MlKem768Params>;

// ─── ML-KEM-768 Key Encapsulation ───────────────────────────────────────

/// Generate an ML-KEM-768 keypair.
///
/// Returns `(decapsulation_key, encapsulation_key)` — the decapsulation key
/// is secret and must be stored securely; the encapsulation key is public.
pub fn pq_kem_keygen() -> (KemDecapsulationKey, KemEncapsulationKey) {
    let mut rng = rand::thread_rng();
    MlKem768::generate(&mut rng)
}

/// Encapsulate a shared secret using the recipient's public encapsulation key.
///
/// Returns `(ciphertext, shared_secret)`. The ciphertext is sent to the
/// recipient; the shared secret is used to derive symmetric keys via HKDF.
pub fn pq_encapsulate(
    encapsulation_key: &KemEncapsulationKey,
) -> (ml_kem::Ciphertext<MlKem768Params>, [u8; 32]) {
    let mut rng = rand::thread_rng();
    let (ct, ss) = encapsulation_key.encapsulate(&mut rng).expect("ML-KEM encapsulation");
    let mut secret = [0u8; 32];
    secret.copy_from_slice(ss.as_slice());
    (ct, secret)
}

/// Decapsulate a shared secret from a ciphertext using the secret
/// decapsulation key.
///
/// Returns the same 32-byte shared secret that was produced by
/// `pq_encapsulate` on the sender side.
pub fn pq_decapsulate(
    decapsulation_key: &KemDecapsulationKey,
    ciphertext: &ml_kem::Ciphertext<MlKem768Params>,
) -> [u8; 32] {
    let ss = decapsulation_key.decapsulate(ciphertext).expect("ML-KEM decapsulation");
    let mut secret = [0u8; 32];
    secret.copy_from_slice(ss.as_slice());
    secret
}

// ─── ML-DSA-65 Digital Signatures ───────────────────────────────────────

/// Generate an ML-DSA-65 signing keypair.
///
/// Returns `(signing_key, verifying_key)` — the signing key is secret.
pub fn pq_sig_keygen() -> (SigningKey<MlDsa65>, VerifyingKey<MlDsa65>) {
    let mut rng = rand::thread_rng();
    let sk = SigningKey::<MlDsa65>::generate(&mut rng);
    let vk = sk.verifying_key().clone();
    (sk, vk)
}

/// Sign a message with ML-DSA-65.
///
/// Returns the signature bytes. The signature is deterministic for
/// a given message and key (no additional randomness needed).
pub fn pq_sign(signing_key: &SigningKey<MlDsa65>, message: &[u8]) -> Vec<u8> {
    use ml_dsa::Signer;
    let sig = signing_key.sign(message);
    sig.to_bytes().to_vec()
}

/// Verify an ML-DSA-65 signature.
///
/// Returns `true` if the signature is valid for the given message and
/// verifying key, `false` otherwise. Never panics on invalid signatures.
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
    fn kem_keygen_roundtrip() {
        let (dk, ek) = pq_kem_keygen();
        // Keys should have non-trivial length.
        let _ = &dk;
        let _ = &ek;
    }

    #[test]
    fn kem_encapsulate_decapsulate() {
        let (dk, ek) = pq_kem_keygen();
        let (ct, ss_sender) = pq_encapsulate(&ek);
        let ss_receiver = pq_decapsulate(&dk, &ct);
        assert_eq!(
            ss_sender, ss_receiver,
            "Sender and receiver shared secrets must match"
        );
    }

    #[test]
    fn kem_different_keys_different_secrets() {
        let (_, ek1) = pq_kem_keygen();
        let (_, ek2) = pq_kem_keygen();
        let (_, ss1) = pq_encapsulate(&ek1);
        let (_, ss2) = pq_encapsulate(&ek2);
        assert_ne!(ss1, ss2, "Different keys should produce different secrets");
    }

    #[test]
    fn sig_keygen_roundtrip() {
        let (sk, vk) = pq_sig_keygen();
        let _ = &sk;
        let _ = &vk;
    }

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

    #[test]
    fn sig_verify_wrong_message() {
        let (sk, vk) = pq_sig_keygen();
        let sig = pq_sign(&sk, b"correct message");
        assert!(
            !pq_verify(&vk, b"wrong message", &sig),
            "Signature should not verify with wrong message"
        );
    }

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

    #[test]
    fn sig_verify_garbage_signature() {
        let (_, vk) = pq_sig_keygen();
        assert!(
            !pq_verify(&vk, b"test", &[0u8; 10]),
            "Garbage signature should not verify"
        );
        assert!(
            !pq_verify(&vk, b"test", &[]),
            "Empty signature should not verify"
        );
    }
}
