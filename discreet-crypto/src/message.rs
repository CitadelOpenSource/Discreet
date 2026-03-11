//! Message encryption and decryption using MLS ApplicationMessage.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use tls_codec::{Deserialize as TlsDeserialize, Serialize as TlsSerialize};

/// Encrypt a plaintext message for an MLS group. Returns serialized ciphertext bytes.
pub fn encrypt_message<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    signer: &SignatureKeyPair,
    plaintext: &[u8],
) -> Result<Vec<u8>, String> {
    let mls_message = group
        .create_message(provider, signer, plaintext)
        .map_err(|e| format!("Message encryption failed: {e}"))?;

    mls_message
        .tls_serialize_detached()
        .map_err(|e| format!("Ciphertext serialization failed: {e}"))
}

/// Decrypt a ciphertext message from an MLS group. Returns plaintext bytes.
pub fn decrypt_message<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    ciphertext: &[u8],
) -> Result<Vec<u8>, String> {
    let mls_message = MlsMessageIn::tls_deserialize_exact(ciphertext)
        .map_err(|e| format!("Ciphertext deserialization failed: {e}"))?;

    let protocol_message = mls_message
        .try_into_protocol_message()
        .map_err(|e| format!("Not a valid protocol message: {e}"))?;

    let processed = group
        .process_message(provider, protocol_message)
        .map_err(|e| format!("Message decryption failed: {e}"))?;

    match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(app_msg) => {
            Ok(app_msg.into_bytes())
        }
        ProcessedMessageContent::StagedCommitMessage(staged) => {
            group
                .merge_staged_commit(provider, *staged)
                .map_err(|e| format!("Auto-merge commit failed: {e}"))?;
            Err("Received Commit instead of ApplicationMessage".into())
        }
        _ => Err("Unexpected message type".into()),
    }
}

/// Encrypt a text string (convenience wrapper).
pub fn encrypt_text<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    signer: &SignatureKeyPair,
    text: &str,
) -> Result<Vec<u8>, String> {
    encrypt_message(group, provider, signer, text.as_bytes())
}

/// Decrypt to a text string (convenience wrapper).
pub fn decrypt_text<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    ciphertext: &[u8],
) -> Result<String, String> {
    let bytes = decrypt_message(group, provider, ciphertext)?;
    String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode failed: {e}"))
}
