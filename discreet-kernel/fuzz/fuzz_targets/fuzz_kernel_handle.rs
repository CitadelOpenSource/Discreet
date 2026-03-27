/// Fuzz target: kernel handle() entry point.
///
/// Generates random byte sequences, attempts to parse them as KernelRequest
/// JSON, and feeds valid requests to Kernel::handle(). Verifies that the
/// function NEVER panics — it must always return a Result.
///
/// Run before every release:
///   cargo fuzz run fuzz_kernel_handle -- -max_len=4096
///   # Let it run for at least 10 minutes.
#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;

use discreet_kernel::types::KernelRequest;
use discreet_kernel::Kernel;

#[derive(Debug, Arbitrary)]
enum FuzzAction {
    RawJson(String),
    Initialize,
    Encrypt { channel_id: String, plaintext: String },
    Decrypt { channel_id: String, ciphertext: String },
    Validate { field: String, value: String },
    Outgoing { channel_id: String, text: String },
    Unlock { assertion: String },
    Persist,
    Restore { state: String },
    Capabilities { channel_id: String, user_id: String, role: String },
    Incoming { payload: String },
}

fuzz_target!(|data: &[u8]| {
    // Approach 1: try parsing raw bytes as JSON → KernelRequest
    if let Ok(json_str) = std::str::from_utf8(data) {
        if let Ok(req) = serde_json::from_str::<KernelRequest>(json_str) {
            let mut k = Kernel::new();
            let _ = k.handle(KernelRequest::Initialize);
            let _ = k.handle(req);
        }
    }

    // Approach 2: interpret as a structured FuzzAction via Arbitrary
    if let Ok(action) = arbitrary::Unstructured::new(data).arbitrary::<FuzzAction>() {
        let mut k = Kernel::new();
        let _ = k.handle(KernelRequest::Initialize);

        match action {
            FuzzAction::RawJson(json) => {
                if let Ok(req) = serde_json::from_str::<KernelRequest>(&json) {
                    let _ = k.handle(req);
                }
            }
            FuzzAction::Initialize => {
                let _ = k.handle(KernelRequest::Initialize);
            }
            FuzzAction::Encrypt { channel_id, plaintext } => {
                let _ = k.handle(KernelRequest::Encrypt { channel_id, plaintext });
            }
            FuzzAction::Decrypt { channel_id, ciphertext } => {
                let _ = k.handle(KernelRequest::Decrypt { channel_id, ciphertext });
            }
            FuzzAction::Validate { field, value } => {
                let _ = k.handle(KernelRequest::ValidateInput { field, value });
            }
            FuzzAction::Outgoing { channel_id, text } => {
                let _ = k.handle(KernelRequest::GenerateOutgoing { channel_id, text });
            }
            FuzzAction::Unlock { assertion } => {
                let _ = k.handle(KernelRequest::Unlock { assertion });
            }
            FuzzAction::Persist => {
                let _ = k.handle(KernelRequest::PersistState);
            }
            FuzzAction::Restore { state } => {
                let _ = k.handle(KernelRequest::RestoreState { encrypted_state: state });
            }
            FuzzAction::Capabilities { channel_id, user_id, role } => {
                let _ = k.handle(KernelRequest::GetCapabilities {
                    channel_id,
                    user_id,
                    user_role: role,
                });
            }
            FuzzAction::Incoming { payload } => {
                let _ = k.handle(KernelRequest::ProcessIncoming { payload });
            }
        }
    }
});
