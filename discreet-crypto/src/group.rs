//! MLS Group management — create, join, add members, remove members, key rotation.

use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use tls_codec::{Deserialize as TlsDeserialize, Serialize as TlsSerialize};

/// Configuration for new MLS groups.
fn group_config() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .build()
}

fn create_group_config() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
        .use_ratchet_tree_extension(true)
        .build()
}

/// Create a new MLS group for a channel.
pub fn create_group<Provider: OpenMlsProvider>(
    provider: &Provider,
    signer: &SignatureKeyPair,
    credential: &CredentialWithKey,
    group_id: &[u8],
) -> Result<MlsGroup, String> {
    let mls_group_id = GroupId::from_slice(group_id);

    MlsGroup::new_with_group_id(
        provider,
        signer,
        &create_group_config(),
        mls_group_id,
        credential.clone(),
    )
    .map_err(|e| format!("Group creation failed: {e}"))
}

/// Add a member to an MLS group.
/// Returns (commit_bytes, welcome_bytes) for relay to server/new member.
pub fn add_member<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    signer: &SignatureKeyPair,
    key_package: KeyPackageIn,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let verified_kp = key_package
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .map_err(|e| format!("KeyPackage validation failed: {e}"))?;

    let (commit, welcome, _group_info) = group
        .add_members(provider, signer, &[verified_kp])
        .map_err(|e| format!("Add member failed: {e}"))?;

    group
        .merge_pending_commit(provider)
        .map_err(|e| format!("Merge commit failed: {e}"))?;

    let commit_bytes = commit.tls_serialize_detached()
        .map_err(|e| format!("Commit serialization failed: {e}"))?;
    let welcome_bytes = welcome.tls_serialize_detached()
        .map_err(|e| format!("Welcome serialization failed: {e}"))?;

    Ok((commit_bytes, welcome_bytes))
}

/// Join a group using a Welcome message bytes.
pub fn join_from_welcome<Provider: OpenMlsProvider>(
    provider: &Provider,
    welcome_bytes: &[u8],
) -> Result<MlsGroup, String> {
    // Welcome is wrapped in MlsMessageOut format by add_members(),
    // so deserialize as MlsMessageIn first, then extract the Welcome body
    let mls_msg = MlsMessageIn::tls_deserialize_exact(welcome_bytes)
        .map_err(|e| format!("Welcome message deserialization failed: {e}"))?;

    // Extract the body — should be MlsMessageBodyIn::Welcome
    let welcome = match mls_msg.extract() {
        MlsMessageBodyIn::Welcome(w) => w,
        other => return Err(format!("Expected Welcome, got {:?}", std::mem::discriminant(&other))),
    };

    let staged = StagedWelcome::new_from_welcome(provider, &group_config(), welcome, None)
        .map_err(|e| format!("Staged welcome failed: {e}"))?;

    staged
        .into_group(provider)
        .map_err(|e| format!("Join from welcome failed: {e}"))
}

/// Remove a member from the group.
pub fn remove_member<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    signer: &SignatureKeyPair,
    member: &LeafNodeIndex,
) -> Result<Vec<u8>, String> {
    let (commit, _, _) = group
        .remove_members(provider, signer, &[*member])
        .map_err(|e| format!("Remove member failed: {e}"))?;

    group
        .merge_pending_commit(provider)
        .map_err(|e| format!("Merge remove commit failed: {e}"))?;

    commit.tls_serialize_detached()
        .map_err(|e| format!("Commit serialization failed: {e}"))
}

/// Self-update: rotate keys for Post-Compromise Security.
pub fn self_update<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    signer: &SignatureKeyPair,
) -> Result<Vec<u8>, String> {
    let (commit, _welcome, _group_info) = group
        .self_update(provider, signer, LeafNodeParameters::default())
        .map_err(|e| format!("Self-update failed: {e}"))?;

    group
        .merge_pending_commit(provider)
        .map_err(|e| format!("Merge self-update failed: {e}"))?;

    commit.tls_serialize_detached()
        .map_err(|e| format!("Commit serialization failed: {e}"))
}

/// Process a Commit received from another group member.
pub fn process_commit<Provider: OpenMlsProvider>(
    group: &mut MlsGroup,
    provider: &Provider,
    commit_bytes: &[u8],
) -> Result<(), String> {
    let mls_message = MlsMessageIn::tls_deserialize_exact(commit_bytes)
        .map_err(|e| format!("Commit deserialization failed: {e}"))?;

    let protocol_message = mls_message
        .try_into_protocol_message()
        .map_err(|e| format!("Not a valid protocol message: {e}"))?;

    let processed = group
        .process_message(provider, protocol_message)
        .map_err(|e| format!("Process commit failed: {e}"))?;

    match processed.into_content() {
        ProcessedMessageContent::StagedCommitMessage(staged) => {
            group
                .merge_staged_commit(provider, *staged)
                .map_err(|e| format!("Merge staged commit failed: {e}"))?;
        }
        _ => return Err("Expected a Commit message".into()),
    }

    Ok(())
}

/// Get the current MLS epoch number.
pub fn current_epoch(group: &MlsGroup) -> u64 {
    group.epoch().as_u64()
}

/// Get the number of members.
pub fn member_count(group: &MlsGroup) -> usize {
    group.members().count()
}
