//! Discreet Security Kernel — single entry point, pure state machine.
//! No network IO, no DOM. Frontend ↔ JSON ↔ Kernel::handle().

pub mod auth;
pub mod crypto;
pub mod error;
pub mod oracle_guard;
pub mod permissions;
pub mod render_model;
pub mod sanitize;
pub mod sealed_storage;
pub mod state;
pub mod types;
pub mod validation;

#[cfg(target_arch = "wasm32")]
pub mod wasm_api;

use std::collections::HashMap;
use secrecy::{ExposeSecret, Secret};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::KernelError;
use crate::oracle_guard::OracleGuard;
use crate::permissions::PermissionSet;
use crate::render_model::{AuthorInfo, RenderMessage};
use crate::state::{GroupState, IdentityState, KernelSnapshot, SessionState};
use crate::types::{KernelRequest, KernelResponse};

// ─── Kernel Status ───────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq)]
pub enum KernelStatus {
    Uninitialized,
    Ready,
    Locked, // Oracle triggered, needs re-auth
}

impl Zeroize for KernelStatus {
    fn zeroize(&mut self) {
        *self = KernelStatus::Uninitialized;
    }
}

// ─── The Kernel ──────────────────────────────────────────────────────────────

/// Security kernel. All operations go through handle().
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct Kernel {
    #[zeroize(skip)] // HashMap doesn't impl Zeroize
    groups: HashMap<String, GroupState>,
    identity: Option<IdentityState>,
    session: Option<SessionState>,
    #[zeroize(skip)]
    permissions_cache: HashMap<String, PermissionSet>,
    oracle: OracleGuard,
    status: KernelStatus,
}

/// Current time in milliseconds (js_sys on WASM, std::time on native).
fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before UNIX epoch")
            .as_millis() as f64
    }
}

impl Kernel {
    pub fn new() -> Self {
        Kernel {
            groups: HashMap::new(),
            identity: None,
            session: None,
            permissions_cache: HashMap::new(),
            oracle: OracleGuard::new(),
            status: KernelStatus::Uninitialized,
        }
    }

    /// Dispatch a request. Never panics.
    pub fn handle(&mut self, request: KernelRequest) -> Result<KernelResponse, KernelError> {
        if self.status == KernelStatus::Locked
            && !matches!(request, KernelRequest::Unlock { .. })
        {
            return Err(KernelError::Locked);
        }

        match request {
            KernelRequest::Initialize => self.handle_init(),
            KernelRequest::Encrypt {
                channel_id,
                plaintext,
            } => self.handle_encrypt(&channel_id, &plaintext),
            KernelRequest::Decrypt {
                channel_id,
                ciphertext,
            } => self.handle_decrypt(&channel_id, &ciphertext),
            KernelRequest::ValidateInput { field, value } => {
                self.handle_validate(&field, &value)
            }
            KernelRequest::GetCapabilities {
                channel_id,
                user_id,
                user_role,
            } => self.handle_capabilities(&channel_id, &user_id, &user_role),
            KernelRequest::ProcessIncoming { payload } => self.handle_incoming(&payload),
            KernelRequest::GenerateOutgoing { channel_id, text } => {
                self.handle_outgoing(&channel_id, &text)
            }
            KernelRequest::Unlock { assertion } => self.handle_unlock(&assertion),
            KernelRequest::PersistState => self.handle_persist(),
            KernelRequest::RestoreState { encrypted_state } => {
                self.handle_restore(&encrypted_state)
            }
        }
    }

    // ── Handlers ──────────────────────────────────────────────────────────

    fn handle_init(&mut self) -> Result<KernelResponse, KernelError> {
        self.status = KernelStatus::Ready;
        self.oracle.reset();
        Ok(KernelResponse::Initialized)
    }

    /// Get or create a GroupState for a channel, ensuring it has a master key.
    fn ensure_group(&mut self, channel_id: &str) -> &GroupState {
        if !self.groups.contains_key(channel_id) {
            // Generate a random master key for this channel
            let mut master = vec![0u8; 32];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut master);
            self.groups.insert(
                channel_id.to_string(),
                GroupState {
                    channel_id: channel_id.to_string(),
                    epoch: 0,
                    encryption_key: None,
                    master_key: Some(Secret::new(master)),
                    retained_keys: Vec::new(),
                },
            );
        }
        &self.groups[channel_id]
    }

    fn handle_encrypt(
        &mut self,
        channel_id: &str,
        plaintext: &str,
    ) -> Result<KernelResponse, KernelError> {
        if self.status == KernelStatus::Uninitialized {
            return Err(KernelError::NotInitialized);
        }

        self.ensure_group(channel_id);
        let group = &self.groups[channel_id];

        let master = group
            .master_key
            .as_ref()
            .ok_or_else(|| KernelError::EncryptionFailed("No master key".to_string()))?;

        let mut derived = crypto::derive_channel_key(
            channel_id,
            group.epoch,
            master.expose_secret(),
        )?;

        let result = crypto::encrypt(&derived, plaintext.as_bytes());

        // Zeroize derived key immediately after use
        derived.zeroize();

        match result {
            Ok(ciphertext) => {
                self.oracle.record_success();
                Ok(KernelResponse::Encrypted { ciphertext })
            }
            Err(e) => {
                if self.oracle.record_failure() {
                    self.status = KernelStatus::Locked;
                }
                Err(e)
            }
        }
    }

    fn handle_decrypt(
        &mut self,
        channel_id: &str,
        ciphertext: &str,
    ) -> Result<KernelResponse, KernelError> {
        if self.status == KernelStatus::Uninitialized {
            return Err(KernelError::NotInitialized);
        }

        if let Err(e) = self.oracle.check_decrypt(now_ms()) {
            self.status = KernelStatus::Locked;
            return Err(e);
        }

        let group = self.groups.get(channel_id).ok_or_else(|| {
            KernelError::DecryptionFailed(format!("No group state for channel {}", channel_id))
        })?;

        let master = group
            .master_key
            .as_ref()
            .ok_or_else(|| KernelError::DecryptionFailed("No master key".to_string()))?;

        let mut derived = crypto::derive_channel_key(
            channel_id,
            group.epoch,
            master.expose_secret(),
        )?;

        let result = crypto::decrypt(&derived, ciphertext);

        // Zeroize derived key immediately
        derived.zeroize();

        match result {
            Ok(mut plaintext_bytes) => {
                // Convert to string, then zeroize the raw bytes immediately
                let raw_content = String::from_utf8_lossy(&plaintext_bytes).to_string();
                plaintext_bytes.zeroize();

                // Full sanitization pipeline: XSS strip, Glassworm defense, markdown parse
                let sanitized = match sanitize::sanitize_message(&raw_content) {
                    Ok(s) => s,
                    Err(e) => {
                        if self.oracle.record_failure() {
                            self.status = KernelStatus::Locked;
                        }
                        return Err(e);
                    }
                };

                // Compute per-message capabilities based on current user
                let user_id = self.identity.as_ref().map(|i| i.user_id.as_str()).unwrap_or("");
                let user_perms = self.session.as_ref().map(|s| {
                    if s.is_admin { permissions::SEND_MESSAGES | permissions::MANAGE_MESSAGES | permissions::ADD_REACTIONS | permissions::MENTION_EVERYONE }
                    else { permissions::SEND_MESSAGES | permissions::ADD_REACTIONS }
                }).unwrap_or(permissions::SEND_MESSAGES);

                let capabilities = permissions::compute_capabilities(
                    user_id, "", user_perms, 0, // author_id not known at decrypt time
                );

                let render_model = RenderMessage {
                    id: String::new(),
                    content: sanitized,
                    capabilities,
                    author: AuthorInfo::default(),
                    timestamp: 0,
                    edited: false,
                    pinned: None,
                    thread_id: None,
                    reply_to: None,
                };

                self.oracle.record_success();
                Ok(KernelResponse::Decrypted { render_model: Box::new(render_model) })
            }
            Err(e) => {
                if self.oracle.record_failure() {
                    self.status = KernelStatus::Locked;
                }
                Err(e)
            }
        }
    }

    fn handle_validate(
        &mut self,
        field: &str,
        value: &str,
    ) -> Result<KernelResponse, KernelError> {
        if let Err(e) = self.oracle.check_validate(now_ms()) {
            self.status = KernelStatus::Locked;
            return Err(e);
        }

        match validation::validate_field(field, value) {
            Ok(()) => Ok(KernelResponse::ValidationResult {
                valid: true,
                error: None,
            }),
            Err(KernelError::ValidationFailed { message, .. }) => {
                Ok(KernelResponse::ValidationResult {
                    valid: false,
                    error: Some(message),
                })
            }
            Err(e) => Err(e),
        }
    }

    fn handle_capabilities(
        &mut self,
        _channel_id: &str,
        user_id: &str,
        user_role: &str,
    ) -> Result<KernelResponse, KernelError> {
        // Map role string to permission bitfield
        let user_perms = match user_role {
            "owner" | "admin" => {
                permissions::SEND_MESSAGES | permissions::MANAGE_MESSAGES
                    | permissions::ADD_REACTIONS | permissions::MENTION_EVERYONE
                    | permissions::MANAGE_CHANNELS | permissions::MANAGE_SERVER
            }
            "moderator" => {
                permissions::SEND_MESSAGES | permissions::MANAGE_MESSAGES
                    | permissions::ADD_REACTIONS
            }
            _ => permissions::SEND_MESSAGES | permissions::ADD_REACTIONS,
        };

        // For channel-level caps, author_id is empty (not message-specific)
        let caps = permissions::compute_capabilities(user_id, "", user_perms, 0);
        Ok(KernelResponse::Capabilities { caps })
    }

    fn handle_incoming(
        &mut self,
        _payload: &str,
    ) -> Result<KernelResponse, KernelError> {
        // STUB: return empty list
        Ok(KernelResponse::IncomingProcessed {
            render_models: Vec::new(),
        })
    }

    fn handle_outgoing(
        &mut self,
        channel_id: &str,
        text: &str,
    ) -> Result<KernelResponse, KernelError> {
        if self.status == KernelStatus::Uninitialized {
            return Err(KernelError::NotInitialized);
        }

        if let Err(e) = self.oracle.check_sign(now_ms()) {
            self.status = KernelStatus::Locked;
            return Err(e);
        }

        // Delegate to handle_encrypt — same crypto path
        match self.handle_encrypt(channel_id, text)? {
            KernelResponse::Encrypted { ciphertext } => {
                Ok(KernelResponse::OutgoingPayload { encrypted: ciphertext })
            }
            _ => Err(KernelError::InternalError("Unexpected encrypt response".to_string())),
        }
    }

    fn handle_unlock(
        &mut self,
        assertion: &str,
    ) -> Result<KernelResponse, KernelError> {
        if self.status != KernelStatus::Locked {
            return Ok(KernelResponse::Unlocked);
        }

        if assertion.is_empty() {
            return Err(KernelError::InvalidRequest(
                "Unlock requires a non-empty assertion".to_string(),
            ));
        }

        // Accept any non-empty assertion for now.
        // Integrate WebAuthn assertion verification when webauthn-rs supports WASM target.
        self.status = KernelStatus::Ready;
        self.oracle.reset();
        Ok(KernelResponse::Unlocked)
    }

    fn handle_persist(&self) -> Result<KernelResponse, KernelError> {
        let snapshot = KernelSnapshot {
            identity: self.identity.as_ref().map(|i| i.to_snapshot()),
            session: self.session.as_ref().map(|s| s.to_snapshot()),
            groups: self.groups.values().map(|g| g.to_snapshot()).collect(),
        };

        let json = serde_json::to_string(&snapshot)
            .map_err(|e| KernelError::InternalError(format!("Serialize state: {}", e)))?;

        // On native (non-WASM): return plaintext JSON (no WebCrypto available).
        // On WASM: the wasm_api layer handles encryption via SealedStore
        // before returning to JS. The kernel itself is sync — sealed storage
        // encryption is done in the async wasm_api wrapper.
        Ok(KernelResponse::StatePersisted {
            sealed_state: json,
        })
    }

    fn handle_restore(&mut self, state_json: &str) -> Result<KernelResponse, KernelError> {
        // On native: state_json is plaintext JSON.
        // On WASM: wasm_api decrypts the sealed blob first, then passes plaintext here.
        let snapshot: KernelSnapshot = serde_json::from_str(state_json)
            .map_err(|e| KernelError::InternalError(format!("Deserialize state: {}", e)))?;

        // Restore identity
        self.identity = snapshot.identity.as_ref().map(IdentityState::from_snapshot);

        // Restore session
        self.session = snapshot.session.as_ref().map(SessionState::from_snapshot);

        // Restore groups
        self.groups.clear();
        for gs in &snapshot.groups {
            let group = GroupState::from_snapshot(gs);
            self.groups.insert(gs.channel_id.clone(), group);
        }

        if self.status == KernelStatus::Uninitialized {
            self.status = KernelStatus::Ready;
        }
        self.oracle.reset();

        Ok(KernelResponse::StateRestored)
    }
}

impl Default for Kernel {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_kernel_is_uninitialized() {
        let k = Kernel::new();
        assert_eq!(k.status, KernelStatus::Uninitialized);
        assert!(k.identity.is_none());
        assert!(k.session.is_none());
        assert!(k.groups.is_empty());
    }

    #[test]
    fn initialize_transitions_to_ready() {
        let mut k = Kernel::new();
        let resp = k.handle(KernelRequest::Initialize).unwrap();
        assert!(matches!(resp, KernelResponse::Initialized));
        assert_eq!(k.status, KernelStatus::Ready);
    }

    #[test]
    fn locked_kernel_rejects_non_unlock_requests() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();
        k.status = KernelStatus::Locked;

        let err = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "hello".into(),
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::Locked));

        let err = k.handle(KernelRequest::Initialize).unwrap_err();
        assert!(matches!(err, KernelError::Locked));

        let err = k
            .handle(KernelRequest::ValidateInput {
                field: "username".into(),
                value: "test".into(),
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::Locked));
    }

    #[test]
    fn unlock_transitions_locked_to_ready() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();
        k.status = KernelStatus::Locked;

        let resp = k
            .handle(KernelRequest::Unlock {
                assertion: "valid".into(),
            })
            .unwrap();
        assert!(matches!(resp, KernelResponse::Unlocked));
        assert_eq!(k.status, KernelStatus::Ready);
    }

    #[test]
    fn validate_empty_value_returns_validation_failed() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let resp = k
            .handle(KernelRequest::ValidateInput {
                field: "username".into(),
                value: "".into(),
            })
            .unwrap();

        match resp {
            KernelResponse::ValidationResult { valid, error } => {
                assert!(!valid);
                assert!(error.is_some());
            }
            _ => panic!("Expected ValidationResult"),
        }
    }

    #[test]
    fn validate_good_username_passes() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let resp = k
            .handle(KernelRequest::ValidateInput {
                field: "username".into(),
                value: "alice".into(),
            })
            .unwrap();

        match resp {
            KernelResponse::ValidationResult { valid, error } => {
                assert!(valid);
                assert!(error.is_none());
            }
            _ => panic!("Expected ValidationResult"),
        }
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let enc_resp = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "hello world".into(),
            })
            .unwrap();

        let ciphertext = match enc_resp {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        // Ciphertext must differ from plaintext (real encryption)
        assert_ne!(ciphertext, "hello world");

        let dec_resp = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext,
            })
            .unwrap();

        match dec_resp {
            KernelResponse::Decrypted { render_model } => {
                assert_eq!(render_model.content.text, "hello world");
            }
            _ => panic!("Expected Decrypted"),
        }
    }

    #[test]
    fn wrong_channel_fails_decryption() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        // Encrypt on channel "ch1"
        let enc_resp = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "secret".into(),
            })
            .unwrap();

        let ciphertext = match enc_resp {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        // Ensure ch2 group exists with a DIFFERENT master key
        k.ensure_group("ch2");

        // Attempt to decrypt on "ch2" — must fail (different HKDF salt)
        let err = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch2".into(),
                ciphertext,
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::DecryptionFailed(_)));
    }

    #[test]
    fn epoch_rotation_derives_different_keys() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        // Encrypt at epoch 0
        let enc_resp = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "epoch 0 message".into(),
            })
            .unwrap();

        let ct_epoch0 = match enc_resp {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        // Advance epoch
        k.groups.get_mut("ch1").unwrap().epoch = 1;

        // Decrypt with epoch 1 key — must fail (different derived key)
        let err = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext: ct_epoch0,
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::DecryptionFailed(_)));
    }

    #[test]
    fn decrypt_rejects_control_chars_in_content() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        // Encrypt text with a control character (BEL)
        let enc_resp = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "hello\x07world".into(),
            })
            .unwrap();

        let ciphertext = match enc_resp {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        // Decryption should fail because the sanitizer rejects control chars
        let result = k.handle(KernelRequest::Decrypt {
            channel_id: "ch1".into(),
            ciphertext,
        });
        assert!(result.is_err());
    }

    #[test]
    fn decrypt_strips_html_xss() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let enc_resp = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "<script>alert(1)</script>hello".into(),
            })
            .unwrap();

        let ciphertext = match enc_resp {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        let dec_resp = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext,
            })
            .unwrap();

        match dec_resp {
            KernelResponse::Decrypted { render_model } => {
                assert!(!render_model.content.text.contains("<script>"));
                assert!(render_model.content.text.contains("hello"));
            }
            _ => panic!("Expected Decrypted"),
        }
    }

    #[test]
    fn decrypt_extracts_formatting() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let enc_resp = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "hello **bold** and @alice".into(),
            })
            .unwrap();

        let ciphertext = match enc_resp {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        let dec_resp = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext,
            })
            .unwrap();

        match dec_resp {
            KernelResponse::Decrypted { render_model } => {
                assert!(render_model.content.formatting.iter().any(|f|
                    matches!(f.style, crate::render_model::FormattingStyle::Bold)));
                assert_eq!(render_model.content.mentions.len(), 1);
                assert_eq!(render_model.content.mentions[0].username, "alice");
            }
            _ => panic!("Expected Decrypted"),
        }
    }

    #[test]
    fn uninitialized_kernel_rejects_encrypt() {
        let mut k = Kernel::new();
        let err = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "hello".into(),
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::NotInitialized));
    }

    #[test]
    fn outgoing_uses_real_encryption() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let resp = k
            .handle(KernelRequest::GenerateOutgoing {
                channel_id: "ch1".into(),
                text: "outgoing msg".into(),
            })
            .unwrap();

        let encrypted = match resp {
            KernelResponse::OutgoingPayload { encrypted } => encrypted,
            _ => panic!("Expected OutgoingPayload"),
        };

        // Should be base64-encoded real ciphertext, not "enc:..."
        assert!(!encrypted.starts_with("enc:"));
        assert!(!encrypted.contains("outgoing msg"));

        // Decrypt should work
        let dec = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext: encrypted,
            })
            .unwrap();
        match dec {
            KernelResponse::Decrypted { render_model } => {
                assert_eq!(render_model.content.text, "outgoing msg");
            }
            _ => panic!("Expected Decrypted"),
        }
    }

    #[test]
    fn oracle_locks_kernel_after_repeated_failures() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        // Encrypt on ch1 to create the group
        k.handle(KernelRequest::Encrypt {
            channel_id: "ch1".into(),
            plaintext: "test".into(),
        })
        .unwrap();

        // Feed garbage ciphertext repeatedly to trigger oracle
        for _ in 0..5 {
            let _ = k.handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext: "definitely-not-valid-base64-ciphertext!!!".into(),
            });
        }

        assert_eq!(k.status, KernelStatus::Locked);
    }

    #[test]
    fn kernel_drop_zeroizes_identity() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();
        k.identity = Some(IdentityState {
            user_id: "user-123".to_string(),
            signing_key: None,
        });
        k.session = Some(SessionState {
            user_id: "user-123".to_string(),
            token_hash: "hash-abc".to_string(),
            expires_at: 9999999999,
            tier: "verified".to_string(),
            is_admin: false,
            is_founder: false,
        });
        drop(k);
    }

    #[test]
    fn oracle_guard_locks_after_max_failures() {
        let mut guard = OracleGuard::new();
        for _ in 0..4 {
            assert!(!guard.record_failure());
        }
        assert!(guard.record_failure());
    }

    #[test]
    fn oracle_guard_resets_on_success() {
        let mut guard = OracleGuard::new();
        guard.record_failure();
        guard.record_failure();
        guard.record_success();
        assert_eq!(guard.failure_count, 0);
    }

    #[test]
    fn capabilities_admin_role() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let resp = k
            .handle(KernelRequest::GetCapabilities {
                channel_id: "ch1".into(),
                user_id: "admin1".into(),
                user_role: "admin".into(),
            })
            .unwrap();

        match resp {
            KernelResponse::Capabilities { caps } => {
                assert!(caps.can_pin);
                assert!(caps.can_delete);
                assert!(caps.can_mention_everyone);
                assert!(caps.can_reply);
            }
            _ => panic!("Expected Capabilities"),
        }
    }

    #[test]
    fn capabilities_member_role() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let resp = k
            .handle(KernelRequest::GetCapabilities {
                channel_id: "ch1".into(),
                user_id: "user1".into(),
                user_role: "member".into(),
            })
            .unwrap();

        match resp {
            KernelResponse::Capabilities { caps } => {
                assert!(!caps.can_pin);
                assert!(!caps.can_delete);
                assert!(!caps.can_mention_everyone);
                assert!(caps.can_reply);
                assert!(caps.can_react);
            }
            _ => panic!("Expected Capabilities"),
        }
    }

    #[test]
    fn decrypt_includes_capabilities() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let enc_resp = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "test".into(),
            })
            .unwrap();

        let ciphertext = match enc_resp {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        let dec_resp = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext,
            })
            .unwrap();

        match dec_resp {
            KernelResponse::Decrypted { render_model } => {
                // Capabilities should be populated (default perms since no session)
                assert!(render_model.capabilities.can_reply);
            }
            _ => panic!("Expected Decrypted"),
        }
    }

    #[test]
    fn persist_and_restore_roundtrip() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        // Encrypt something to create group state
        k.handle(KernelRequest::Encrypt {
            channel_id: "ch1".into(),
            plaintext: "hello".into(),
        })
        .unwrap();

        // Set identity
        k.identity = Some(IdentityState {
            user_id: "user-persist-test".into(),
            signing_key: None,
        });

        // Persist state
        let persist_resp = k.handle(KernelRequest::PersistState).unwrap();
        let state_json = match persist_resp {
            KernelResponse::StatePersisted { sealed_state } => sealed_state,
            _ => panic!("Expected StatePersisted"),
        };

        // Create a fresh kernel and restore
        let mut k2 = Kernel::new();
        let restore_resp = k2
            .handle(KernelRequest::RestoreState {
                encrypted_state: state_json,
            })
            .unwrap();
        assert!(matches!(restore_resp, KernelResponse::StateRestored));

        // Verify restored state
        assert_eq!(k2.status, KernelStatus::Ready);
        assert_eq!(
            k2.identity.as_ref().unwrap().user_id,
            "user-persist-test"
        );
        assert!(k2.groups.contains_key("ch1"));
    }

    #[test]
    fn restore_invalid_json_returns_error() {
        let mut k = Kernel::new();
        let result = k.handle(KernelRequest::RestoreState {
            encrypted_state: "not valid json{{{".into(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn persist_preserves_group_epochs() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        // Create group and advance epoch
        k.handle(KernelRequest::Encrypt {
            channel_id: "ch-epoch".into(),
            plaintext: "msg".into(),
        })
        .unwrap();
        k.groups.get_mut("ch-epoch").unwrap().epoch = 42;

        // Persist
        let resp = k.handle(KernelRequest::PersistState).unwrap();
        let json = match resp {
            KernelResponse::StatePersisted { sealed_state } => sealed_state,
            _ => panic!("Expected StatePersisted"),
        };

        // Restore into fresh kernel
        let mut k2 = Kernel::new();
        k2.handle(KernelRequest::RestoreState {
            encrypted_state: json,
        })
        .unwrap();

        assert_eq!(k2.groups["ch-epoch"].epoch, 42);
    }

    // ── Rate-limit oracle tests ──────────────────────────────────────────

    #[test]
    fn rate_limit_locks_after_100_decrypts() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let enc = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "test".into(),
            })
            .unwrap();
        let ct = match enc {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        for _ in 0..100 {
            k.handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext: ct.clone(),
            })
            .unwrap();
        }

        let err = k
            .handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext: ct,
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::Locked));
        assert_eq!(k.status, KernelStatus::Locked);
    }

    #[test]
    fn rate_limit_window_resets_after_expiry() {
        let mut guard = OracleGuard::new();
        let base = 1_000_000.0;

        for _ in 0..100 {
            guard.check_decrypt(base).unwrap();
        }
        assert!(guard.check_decrypt(base).is_err());

        // 11 seconds later: window expires, counter resets
        guard.check_decrypt(base + 11_000.0).unwrap();
    }

    #[test]
    fn rate_limit_unlock_resets_counters() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        let enc = k
            .handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "test".into(),
            })
            .unwrap();
        let ct = match enc {
            KernelResponse::Encrypted { ciphertext } => ciphertext,
            _ => panic!("Expected Encrypted"),
        };

        for _ in 0..100 {
            k.handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext: ct.clone(),
            })
            .unwrap();
        }

        // 101st triggers lock
        let _ = k.handle(KernelRequest::Decrypt {
            channel_id: "ch1".into(),
            ciphertext: ct.clone(),
        });
        assert_eq!(k.status, KernelStatus::Locked);

        // Unlock resets all rate counters
        k.handle(KernelRequest::Unlock {
            assertion: "valid".into(),
        })
        .unwrap();
        assert_eq!(k.status, KernelStatus::Ready);

        // Decrypt works again after unlock
        k.handle(KernelRequest::Decrypt {
            channel_id: "ch1".into(),
            ciphertext: ct,
        })
        .unwrap();
    }

    #[test]
    fn rate_limit_locked_rejects_encrypt_decrypt_validate() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        // Lock via validate rate limit (cheapest operation)
        for _ in 0..200 {
            k.handle(KernelRequest::ValidateInput {
                field: "username".into(),
                value: "alice".into(),
            })
            .unwrap();
        }
        let _ = k.handle(KernelRequest::ValidateInput {
            field: "username".into(),
            value: "alice".into(),
        });
        assert_eq!(k.status, KernelStatus::Locked);

        // Every operation type is blocked
        assert!(matches!(
            k.handle(KernelRequest::Encrypt {
                channel_id: "ch1".into(),
                plaintext: "test".into(),
            })
            .unwrap_err(),
            KernelError::Locked
        ));
        assert!(matches!(
            k.handle(KernelRequest::Decrypt {
                channel_id: "ch1".into(),
                ciphertext: "x".into(),
            })
            .unwrap_err(),
            KernelError::Locked
        ));
        assert!(matches!(
            k.handle(KernelRequest::ValidateInput {
                field: "username".into(),
                value: "bob".into(),
            })
            .unwrap_err(),
            KernelError::Locked
        ));
    }

    #[test]
    fn unlock_while_not_locked_is_noop() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();
        assert_eq!(k.status, KernelStatus::Ready);

        let resp = k
            .handle(KernelRequest::Unlock {
                assertion: "test".into(),
            })
            .unwrap();
        assert!(matches!(resp, KernelResponse::Unlocked));
        assert_eq!(k.status, KernelStatus::Ready);
    }

    #[test]
    fn rate_limit_locks_after_50_outgoing() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        for i in 0..50 {
            k.handle(KernelRequest::GenerateOutgoing {
                channel_id: "ch1".into(),
                text: format!("msg {}", i),
            })
            .unwrap();
        }

        let err = k
            .handle(KernelRequest::GenerateOutgoing {
                channel_id: "ch1".into(),
                text: "one too many".into(),
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::Locked));
        assert_eq!(k.status, KernelStatus::Locked);
    }

    #[test]
    fn rate_limit_locks_after_200_validations() {
        let mut k = Kernel::new();
        k.handle(KernelRequest::Initialize).unwrap();

        for _ in 0..200 {
            k.handle(KernelRequest::ValidateInput {
                field: "username".into(),
                value: "alice".into(),
            })
            .unwrap();
        }

        let err = k
            .handle(KernelRequest::ValidateInput {
                field: "username".into(),
                value: "alice".into(),
            })
            .unwrap_err();
        assert!(matches!(err, KernelError::Locked));
        assert_eq!(k.status, KernelStatus::Locked);
    }
}
