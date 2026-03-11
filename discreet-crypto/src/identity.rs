//! Identity key management — Ed25519 signing keys for MLS credentials.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use serde::{Deserialize, Serialize};

/// The MLS cipher suite we use everywhere.
pub const CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// A user's serializable identity.
#[derive(Debug, Serialize, Deserialize)]
pub struct UserIdentity {
    pub user_id: String,
    pub username: String,
    #[serde(with = "base64_bytes")]
    pub signature_keypair: Vec<u8>,
    #[serde(with = "base64_bytes")]
    pub credential: Vec<u8>,
}

/// Generate a new cryptographic identity for a user.
pub fn generate_identity<Provider: OpenMlsProvider>(
    provider: &Provider,
    _user_id: &str,
    username: &str,
) -> Result<(SignatureKeyPair, CredentialWithKey), String> {
    let signature_keypair = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
        .map_err(|e| format!("Failed to generate signature key pair: {e}"))?;

    signature_keypair
        .store(provider.storage())
        .map_err(|e| format!("Failed to store key pair: {e}"))?;

    let credential = BasicCredential::new(username.as_bytes().to_vec());
    let credential_with_key = CredentialWithKey {
        credential: credential.into(),
        signature_key: signature_keypair.to_public_vec().into(),
    };

    Ok((signature_keypair, credential_with_key))
}

/// Base64 serialization helper for serde
mod base64_bytes {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error> {
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        serializer.serialize_str(&encoded)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(deserializer)?;
        base64::engine::general_purpose::STANDARD
            .decode(&s)
            .map_err(serde::de::Error::custom)
    }
}
