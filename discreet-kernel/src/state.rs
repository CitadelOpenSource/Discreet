use secrecy::{ExposeSecret, Secret};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct IdentityState {
    pub user_id: String,
    #[zeroize(skip)] // Secret handles its own zeroize
    pub signing_key: Option<Secret<Vec<u8>>>,
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct GroupState {
    pub channel_id: String,
    pub epoch: u64,
    #[zeroize(skip)]
    pub encryption_key: Option<Secret<Vec<u8>>>,
    /// Master key material from which per-epoch keys are derived.
    #[zeroize(skip)]
    pub master_key: Option<Secret<Vec<u8>>>,
    /// Retained old epoch keys for decrypting recent messages.
    /// Entries older than MAX_RETAINED_EPOCHS are removed.
    #[zeroize(skip)]
    pub retained_keys: Vec<(u64, Secret<Vec<u8>>)>,
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SessionState {
    pub user_id: String,
    pub token_hash: String, // NOT the raw JWT
    pub expires_at: i64,
    pub tier: String,
    pub is_admin: bool,
    pub is_founder: bool,
}

// ─── Serializable state snapshots (for sealed storage) ──────────────────────
// These are the wire-format types that get encrypted and persisted.
// Secret<Vec<u8>> is serialized as base64 for JSON compatibility.

#[derive(Serialize, Deserialize)]
pub struct KernelSnapshot {
    pub identity: Option<IdentitySnapshot>,
    pub session: Option<SessionSnapshot>,
    pub groups: Vec<GroupSnapshot>,
}

#[derive(Serialize, Deserialize)]
pub struct IdentitySnapshot {
    pub user_id: String,
    pub signing_key: Option<String>, // base64-encoded
}

#[derive(Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub user_id: String,
    pub token_hash: String,
    pub expires_at: i64,
    pub tier: String,
    pub is_admin: bool,
    pub is_founder: bool,
}

#[derive(Serialize, Deserialize)]
pub struct GroupSnapshot {
    pub channel_id: String,
    pub epoch: u64,
    pub master_key: Option<String>, // base64-encoded
}

// ─── Snapshot conversion ────────────────────────────────────────────────────

impl IdentityState {
    pub fn to_snapshot(&self) -> IdentitySnapshot {
        IdentitySnapshot {
            user_id: self.user_id.clone(),
            signing_key: self.signing_key.as_ref().map(|k| {
                crate::crypto::base64_encode(k.expose_secret())
            }),
        }
    }

    pub fn from_snapshot(snap: &IdentitySnapshot) -> Self {
        Self {
            user_id: snap.user_id.clone(),
            signing_key: snap.signing_key.as_ref().and_then(|b64| {
                crate::crypto::base64_decode(b64).ok().map(Secret::new)
            }),
        }
    }
}

impl SessionState {
    pub fn to_snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            user_id: self.user_id.clone(),
            token_hash: self.token_hash.clone(),
            expires_at: self.expires_at,
            tier: self.tier.clone(),
            is_admin: self.is_admin,
            is_founder: self.is_founder,
        }
    }

    pub fn from_snapshot(snap: &SessionSnapshot) -> Self {
        Self {
            user_id: snap.user_id.clone(),
            token_hash: snap.token_hash.clone(),
            expires_at: snap.expires_at,
            tier: snap.tier.clone(),
            is_admin: snap.is_admin,
            is_founder: snap.is_founder,
        }
    }
}

impl GroupState {
    pub fn to_snapshot(&self) -> GroupSnapshot {
        GroupSnapshot {
            channel_id: self.channel_id.clone(),
            epoch: self.epoch,
            master_key: self.master_key.as_ref().map(|k| {
                crate::crypto::base64_encode(k.expose_secret())
            }),
        }
    }

    pub fn from_snapshot(snap: &GroupSnapshot) -> Self {
        Self {
            channel_id: snap.channel_id.clone(),
            epoch: snap.epoch,
            encryption_key: None,
            master_key: snap.master_key.as_ref().and_then(|b64| {
                crate::crypto::base64_decode(b64).ok().map(Secret::new)
            }),
            retained_keys: Vec::new(),
        }
    }
}
