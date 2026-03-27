use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use crate::permissions::CapabilitySet;
use crate::render_model::RenderMessage;

#[typeshare]
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum KernelRequest {
    Initialize,
    Encrypt {
        channel_id: String,
        plaintext: String,
    },
    Decrypt {
        channel_id: String,
        ciphertext: String,
    },
    ValidateInput {
        field: String,
        value: String,
    },
    GetCapabilities {
        channel_id: String,
        user_id: String,
        user_role: String,
    },
    ProcessIncoming {
        payload: String,
    },
    GenerateOutgoing {
        channel_id: String,
        text: String,
    },
    Unlock {
        assertion: String,
    },
    PersistState,
    RestoreState {
        encrypted_state: String,
    },
}

#[typeshare]
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum KernelResponse {
    Initialized,
    Encrypted { ciphertext: String },
    Decrypted { render_model: Box<RenderMessage> },
    ValidationResult { valid: bool, error: Option<String> },
    Capabilities { caps: CapabilitySet },
    IncomingProcessed { render_models: Vec<RenderMessage> },
    OutgoingPayload { encrypted: String },
    Unlocked,
    StatePersisted { sealed_state: String },
    StateRestored,
    Error { code: String, message: String },
}
