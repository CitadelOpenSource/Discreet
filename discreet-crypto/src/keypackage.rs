//! KeyPackage generation — pre-keys that allow others to add us to MLS groups.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use tls_codec::{Deserialize as TlsDeserialize, Serialize as TlsSerialize};
use crate::identity::CIPHERSUITE;

/// Generate a batch of MLS KeyPackages for upload to the server.
pub fn generate_key_packages<Provider: OpenMlsProvider>(
    provider: &Provider,
    credential_with_key: &CredentialWithKey,
    signer: &SignatureKeyPair,
    count: usize,
) -> Result<Vec<Vec<u8>>, String> {
    let mut packages = Vec::with_capacity(count);

    for _ in 0..count {
        let key_package_bundle = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                provider,
                signer,
                credential_with_key.clone(),
            )
            .map_err(|e| format!("KeyPackage generation failed: {e}"))?;

        let serialized = key_package_bundle.key_package()
            .tls_serialize_detached()
            .map_err(|e| format!("KeyPackage serialization failed: {e}"))?;

        packages.push(serialized);
    }

    Ok(packages)
}

/// Deserialize a KeyPackage received from the server.
pub fn deserialize_key_package(data: &[u8]) -> Result<KeyPackageIn, String> {
    KeyPackageIn::tls_deserialize_exact(data)
        .map_err(|e| format!("KeyPackage deserialization failed: {e}"))
}
