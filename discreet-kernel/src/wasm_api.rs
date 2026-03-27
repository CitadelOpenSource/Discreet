/// WASM bindings. Global Kernel behind Mutex, JSON in/out.
/// Sealed ops (persist/restore) go through kernel_handle_async.
use wasm_bindgen::prelude::*;
use once_cell::sync::Lazy;
use std::sync::Mutex;

use crate::Kernel;
use crate::sealed_storage::wasm::SealedStore;
use crate::types::{KernelRequest, KernelResponse};

struct KernelState {
    kernel: Kernel,
    sealed: SealedStore,
}

static STATE: Lazy<Mutex<KernelState>> = Lazy::new(|| {
    Mutex::new(KernelState {
        kernel: Kernel::new(),
        sealed: SealedStore::new(),
    })
});

/// Panic hook → console.error.
#[wasm_bindgen(start)]
pub fn kernel_init() {
    std::panic::set_hook(Box::new(|info| {
        web_sys::console::error_1(&format!("Kernel fault: {}", info).into());
    }));
}

/// Sync handler. Rejects sealed ops (use kernel_handle_async).
#[wasm_bindgen]
pub fn kernel_handle(request_json: &str) -> String {
    let mut state = match STATE.lock() {
        Ok(s) => s,
        Err(_) => {
            return error_json("MUTEX_POISONED", "Kernel state corrupted");
        }
    };

    let request = match serde_json::from_str::<KernelRequest>(request_json) {
        Ok(r) => r,
        Err(e) => {
            return error_json("INVALID_REQUEST", &e.to_string());
        }
    };

    // Sealed storage operations require async — redirect to kernel_handle_async
    if matches!(request, KernelRequest::PersistState | KernelRequest::RestoreState { .. }) {
        return error_json(
            "USE_ASYNC",
            "PersistState/RestoreState require kernel_handle_async",
        );
    }

    match state.kernel.handle(request) {
        Ok(response) => serde_json::to_string(&response).unwrap_or_default(),
        Err(e) => error_json("KERNEL_ERROR", &e.to_string()),
    }
}

/// Async handler — all requests including sealed storage.
#[wasm_bindgen]
pub async fn kernel_handle_async(request_json: String) -> String {
    let request = match serde_json::from_str::<KernelRequest>(&request_json) {
        Ok(r) => r,
        Err(e) => {
            return error_json("INVALID_REQUEST", &e.to_string());
        }
    };

    match request {
        KernelRequest::PersistState => handle_persist_sealed().await,
        KernelRequest::RestoreState { encrypted_state } => {
            handle_restore_sealed(&encrypted_state).await
        }
        // All other requests — delegate to synchronous handler
        _ => kernel_handle(&request_json),
    }
}

/// Persist: kernel state → sealed encrypt → blob.
async fn handle_persist_sealed() -> String {
    let mut state = match STATE.lock() {
        Ok(s) => s,
        Err(_) => return error_json("MUTEX_POISONED", "Kernel state corrupted"),
    };

    // Initialize sealed store on first use
    if !state.sealed.available && state.sealed.needs_rotation() == false {
        if let Err(e) = state.sealed.init().await {
            return error_json("SEALED_INIT_FAILED", &e.to_string());
        }
    }

    // Get the serialized state from kernel
    let json = match state.kernel.handle(KernelRequest::PersistState) {
        Ok(KernelResponse::StatePersisted { sealed_state }) => sealed_state,
        Ok(_) => return error_json("INTERNAL", "Unexpected persist response"),
        Err(e) => return error_json("KERNEL_ERROR", &e.to_string()),
    };

    // Encrypt with sealed key if available
    if state.sealed.available {
        match state.sealed.encrypt(&json).await {
            Ok(blob) => serde_json::to_string(&KernelResponse::StatePersisted {
                sealed_state: blob,
            })
            .unwrap_or_default(),
            Err(e) => error_json("ENCRYPT_FAILED", &e.to_string()),
        }
    } else {
        // Fallback: return unencrypted (Worker isolation still protects)
        serde_json::to_string(&KernelResponse::StatePersisted {
            sealed_state: json,
        })
        .unwrap_or_default()
    }
}

/// Restore: sealed decrypt → kernel state.
async fn handle_restore_sealed(encrypted_state: &str) -> String {
    let mut state = match STATE.lock() {
        Ok(s) => s,
        Err(_) => return error_json("MUTEX_POISONED", "Kernel state corrupted"),
    };

    // Initialize sealed store if needed
    if !state.sealed.available {
        if let Err(e) = state.sealed.init().await {
            // If we can't init, try treating as unencrypted (fallback)
            web_sys::console::warn_1(
                &format!("Sealed init failed, trying unencrypted restore: {}", e).into(),
            );
        }
    }

    // Decrypt if sealed storage is available
    let json = if state.sealed.available {
        match state.sealed.decrypt(encrypted_state).await {
            Ok(plaintext) => plaintext,
            Err(_) => {
                // Decryption failed — maybe state was stored unencrypted (fallback)
                encrypted_state.to_string()
            }
        }
    } else {
        encrypted_state.to_string()
    };

    // Restore kernel state
    match state.kernel.handle(KernelRequest::RestoreState {
        encrypted_state: json,
    }) {
        Ok(response) => serde_json::to_string(&response).unwrap_or_default(),
        Err(e) => error_json("RESTORE_FAILED", &e.to_string()),
    }
}

fn error_json(code: &str, message: &str) -> String {
    serde_json::to_string(&KernelResponse::Error {
        code: code.into(),
        message: message.into(),
    })
    .unwrap_or_default()
}
