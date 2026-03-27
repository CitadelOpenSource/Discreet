// discreet_post_quantum.rs — Post-quantum cryptography for Discreet.
//
// Hybrid classical + post-quantum key encapsulation and signatures.
// Protects against "harvest now, decrypt later" quantum attacks.
//
//   KEM:  X25519 + ML-KEM-768  (FIPS 203)
//   Sig:  Ed25519 + ML-DSA-65  (FIPS 204)
//
// Security levels (Apple PQ3 compatible):
//   Level 1: Classical only
//   Level 2: PQ in initial key exchange  (PQXDH pattern)
//   Level 3: PQ in initial + rekeying    (≈ Apple PQ3)
//   Level 4: Full PQ + quantum-safe sigs (Discreet target)
//
// Crates: ml-kem, ml-dsa, hkdf, sha2

use serde::{Deserialize, Serialize};

// ─── Security Level ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum PQSecurityLevel {
    Classical    = 1,
    PQInitial    = 2,
    PQContinuous = 3,
    PQFull       = 4,
}

// ─── Hybrid KEM ─────────────────────────────────────────────────────────
// Both classical and PQ must be broken simultaneously to compromise the secret.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridKEMPublicKey {
    pub x25519_public: [u8; 32],
    pub ml_kem_public: Vec<u8>,    // 1184 bytes for ML-KEM-768
    pub level: PQSecurityLevel,
}

#[derive(Debug, Clone)]
pub struct HybridKEMSecretKey {
    pub x25519_secret: [u8; 32],
    pub ml_kem_secret: Vec<u8>,    // 2400 bytes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridKEMCiphertext {
    pub x25519_ephemeral: [u8; 32],
    pub ml_kem_ciphertext: Vec<u8>, // 1088 bytes
}

/// Combined shared secret: HKDF(X25519_shared ‖ ML_KEM_shared, "discreet-pqkem-v1")
#[derive(Debug, Clone)]
pub struct HybridSharedSecret {
    pub secret: [u8; 32],
}

// ─── Hybrid Signatures ──────────────────────────────────────────────────
// Verification requires BOTH signatures to pass.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSignaturePublicKey {
    pub ed25519_public: [u8; 32],
    pub ml_dsa_public: Vec<u8>,    // 1952 bytes for ML-DSA-65
}

#[derive(Debug, Clone)]
pub struct HybridSignatureSecretKey {
    pub ed25519_secret: [u8; 64],
    pub ml_dsa_secret: Vec<u8>,    // 4032 bytes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSignature {
    pub ed25519_sig: Vec<u8>,      // 64 bytes
    pub ml_dsa_sig: Vec<u8>,       // 3309 bytes
}

// ─── PQ-Enhanced MLS ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PQKeyPackage {
    pub mls_key_package: Vec<u8>,
    pub pq_kem_public: Vec<u8>,
    pub hybrid_signature: HybridSignature,
    pub security_level: PQSecurityLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PQWelcome {
    pub mls_welcome: Vec<u8>,
    pub pq_kem_ciphertext: Vec<u8>,
    pub hybrid_signature: HybridSignature,
}

// ─── PQ Rekey Schedule ──────────────────────────────────────────────────
// Periodic PQ rekeying within MLS epochs (Level 3+).

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PQRekeySchedule {
    pub message_interval: u32,
    pub time_interval_secs: u64,
    pub current_generation: u64,
    pub last_rekey: Option<chrono::DateTime<chrono::Utc>>,
    pub messages_since_rekey: u32,
}

impl Default for PQRekeySchedule {
    fn default() -> Self {
        Self {
            message_interval: 50,        // Match Apple PQ3
            time_interval_secs: 3600,    // Or every hour
            current_generation: 0,
            last_rekey: None,
            messages_since_rekey: 0,
        }
    }
}

// ─── Module Config ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PQConfig {
    pub default_level: PQSecurityLevel,
    pub enforce_pq: bool,
    pub rekey_schedule: PQRekeySchedule,
    pub allow_classical_fallback: bool,
}

impl Default for PQConfig {
    fn default() -> Self {
        Self {
            default_level: PQSecurityLevel::PQFull,
            enforce_pq: true,
            allow_classical_fallback: false,
            rekey_schedule: PQRekeySchedule::default(),
        }
    }
}
