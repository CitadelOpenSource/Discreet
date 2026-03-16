//! # discreet-crypto
//!
//! MLS (RFC 9420) cryptographic layer for the Discreet platform.
//!
//! Compiles to native Rust, WebAssembly, and FFI.
//! Cipher suite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519.

pub mod identity;
pub mod keypackage;
pub mod group;
pub mod message;
pub mod sframe_voice;

#[cfg(feature = "wasm")]
pub mod wasm_bindings;

pub use identity::{generate_identity, CIPHERSUITE, UserIdentity};
pub use openmls::prelude::*;

#[cfg(feature = "native")]
pub use openmls_rust_crypto::OpenMlsRustCrypto;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(feature = "native")]
pub fn default_provider() -> OpenMlsRustCrypto {
    OpenMlsRustCrypto::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use openmls_rust_crypto::OpenMlsRustCrypto;


    #[test]
    fn test_full_mls_lifecycle() {
        let alice_provider = OpenMlsRustCrypto::default();
        let bob_provider = OpenMlsRustCrypto::default();

        // Step 1: Generate identities
        let (alice_signer, alice_cred) =
            identity::generate_identity(&alice_provider, "alice-uuid", "alice")
                .expect("Alice identity generation failed");

        let (bob_signer, bob_cred) =
            identity::generate_identity(&bob_provider, "bob-uuid", "bob")
                .expect("Bob identity generation failed");

        // Step 2: Bob generates KeyPackages
        let bob_kps = keypackage::generate_key_packages(
            &bob_provider, &bob_cred, &bob_signer, 5,
        ).expect("Bob KeyPackage generation failed");
        assert_eq!(bob_kps.len(), 5);

        // Step 3: Alice creates a group (channel)
        let channel_id = b"test-channel-uuid-1234";
        let mut alice_group = group::create_group(
            &alice_provider, &alice_signer, &alice_cred, channel_id,
        ).expect("Group creation failed");

        assert_eq!(group::current_epoch(&alice_group), 0);
        assert_eq!(group::member_count(&alice_group), 1);

        // Step 4: Alice adds Bob
        let bob_kp_in = keypackage::deserialize_key_package(&bob_kps[0])
            .expect("Bob KP deserialization failed");

        let (_commit_bytes, welcome_bytes) = group::add_member(
            &mut alice_group, &alice_provider, &alice_signer, bob_kp_in,
        ).expect("Add Bob failed");

        assert_eq!(group::current_epoch(&alice_group), 1);
        assert_eq!(group::member_count(&alice_group), 2);

        // Step 5: Bob joins from Welcome
        let mut bob_group = group::join_from_welcome(&bob_provider, &welcome_bytes)
            .expect("Bob join from welcome failed");

        assert_eq!(group::current_epoch(&bob_group), 1);
        assert_eq!(group::member_count(&bob_group), 2);

        // Step 6: Alice sends an encrypted message
        let plaintext = "Hello Bob! This message is E2EE with MLS RFC 9420.";
        let ciphertext = message::encrypt_text(
            &mut alice_group, &alice_provider, &alice_signer, plaintext,
        ).expect("Encryption failed");

        assert!(ciphertext.len() > plaintext.len());

        // Step 7: Bob decrypts the message
        let decrypted = message::decrypt_text(
            &mut bob_group, &bob_provider, &ciphertext,
        ).expect("Decryption failed");

        assert_eq!(decrypted, plaintext);

        // Step 8: Key rotation (Post-Compromise Security)
        let _update_bytes = group::self_update(
            &mut alice_group, &alice_provider, &alice_signer,
        ).expect("Self-update failed");

        assert_eq!(group::current_epoch(&alice_group), 2);

        println!("✅ Full MLS lifecycle test passed!");
        println!("   - Identity generation: ✅");
        println!("   - KeyPackage generation: ✅");
        println!("   - Group creation: ✅");
        println!("   - Member addition via Welcome: ✅");
        println!("   - Message encrypt/decrypt: ✅");
        println!("   - Key rotation (PCS): ✅");
    }

    #[test]
    fn test_mls_group_roundtrip() {
        // 1) Create providers (each user needs independent storage)
        let alice_provider = OpenMlsRustCrypto::default();
        let bob_provider = OpenMlsRustCrypto::default();

        // 2) Generate identity for Alice
        let (alice_signer, alice_cred) =
            identity::generate_identity(&alice_provider, "alice-id", "alice")
                .expect("Alice identity failed");

        // 3) Alice creates an MLS group
        let mut alice_group = group::create_group(
            &alice_provider, &alice_signer, &alice_cred, b"roundtrip-channel",
        ).expect("Group creation failed");
        assert_eq!(group::member_count(&alice_group), 1);

        // 4) Generate identity for Bob
        let (bob_signer, bob_cred) =
            identity::generate_identity(&bob_provider, "bob-id", "bob")
                .expect("Bob identity failed");

        // 5) Bob creates a KeyPackage
        let bob_kps = keypackage::generate_key_packages(
            &bob_provider, &bob_cred, &bob_signer, 1,
        ).expect("Bob KP generation failed");
        let bob_kp = keypackage::deserialize_key_package(&bob_kps[0])
            .expect("Bob KP deserialize failed");

        // 6) Alice adds Bob → (commit, welcome)
        let (_commit, welcome) = group::add_member(
            &mut alice_group, &alice_provider, &alice_signer, bob_kp,
        ).expect("Add Bob failed");
        assert_eq!(group::member_count(&alice_group), 2);

        // 7) Bob joins from welcome
        let mut bob_group = group::join_from_welcome(&bob_provider, &welcome)
            .expect("Bob join failed");
        assert_eq!(group::member_count(&bob_group), 2);
        assert_eq!(group::current_epoch(&bob_group), group::current_epoch(&alice_group));

        // 8) Alice encrypts "Hello MLS"
        let ciphertext = message::encrypt_text(
            &mut alice_group, &alice_provider, &alice_signer, "Hello MLS",
        ).expect("Encrypt failed");

        // 9) Bob decrypts, assert eq
        let decrypted = message::decrypt_text(
            &mut bob_group, &bob_provider, &ciphertext,
        ).expect("Decrypt failed");
        assert_eq!(decrypted, "Hello MLS");
    }
}
