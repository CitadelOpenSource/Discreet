/// Sealed storage — kernel state encrypted with non-extractable WebCrypto key.
/// JS main thread holds ciphertext but cannot decrypt. WASM-only; native is a no-op.
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use wasm_bindgen::prelude::*;
    use wasm_bindgen_futures::JsFuture;
    use js_sys::{Object, Reflect, Uint8Array};
    use web_sys::CryptoKey;

    use crate::error::KernelError;

    /// Holds the non-extractable CryptoKey and availability flag.
    pub struct SealedStore {
        key: Option<CryptoKey>,
        pub available: bool,
    }

    impl SealedStore {
        pub fn new() -> Self {
            Self {
                key: None,
                available: false,
            }
        }

        /// Generate non-extractable AES-256-GCM key. Async (WebCrypto).
        pub async fn init(&mut self) -> Result<(), KernelError> {
            let crypto: web_sys::Crypto = match js_sys::global()
                .dyn_into::<web_sys::WorkerGlobalScope>()
                .ok()
                .and_then(|w: web_sys::WorkerGlobalScope| w.crypto().ok())
            {
                Some(c) => c,
                None => {
                    web_sys::console::warn_1(
                        &"Sealed storage: WebCrypto unavailable — storing unencrypted".into(),
                    );
                    self.available = false;
                    return Ok(());
                }
            };

            let subtle = crypto.subtle();

            // Algorithm: AES-GCM 256-bit
            let algo = Object::new();
            Reflect::set(&algo, &"name".into(), &"AES-GCM".into())
                .map_err(|_| KernelError::InternalError("Failed to set algorithm name".into()))?;
            Reflect::set(&algo, &"length".into(), &256.into())
                .map_err(|_| KernelError::InternalError("Failed to set key length".into()))?;

            // Key usages
            let usages = js_sys::Array::new();
            usages.push(&"encrypt".into());
            usages.push(&"decrypt".into());

            // Generate key with extractable: FALSE — this is the core security property
            let key_promise = subtle
                .generate_key_with_object(&algo, false, &usages)
                .map_err(|_| KernelError::InternalError("generateKey call failed".into()))?;

            let key_val: wasm_bindgen::JsValue = JsFuture::from(key_promise)
                .await
                .map_err(|e| {
                    KernelError::InternalError(format!(
                        "generateKey failed: {:?}",
                        e.as_string().unwrap_or_default()
                    ))
                })?;

            let key: CryptoKey = key_val
                .dyn_into()
                .map_err(|_| KernelError::InternalError("Key is not a CryptoKey".into()))?;

            self.key = Some(key);
            self.available = true;
            Ok(())
        }

        /// Encrypt state → base64(iv ‖ ciphertext).
        pub async fn encrypt(&self, plaintext: &str) -> Result<String, KernelError> {
            let key = self.key.as_ref().ok_or_else(|| {
                KernelError::InternalError("Sealed key not initialized".into())
            })?;

            let crypto: web_sys::Crypto = js_sys::global()
                .dyn_into::<web_sys::WorkerGlobalScope>()
                .ok()
                .and_then(|w: web_sys::WorkerGlobalScope| w.crypto().ok())
                .ok_or_else(|| KernelError::InternalError("WebCrypto unavailable".into()))?;

            // Generate random 12-byte IV
            let mut iv_bytes = [0u8; 12];
            crypto
                .get_random_values_with_u8_array(&mut iv_bytes)
                .map_err(|_| KernelError::InternalError("getRandomValues failed".into()))?;

            // AES-GCM params with IV
            let iv = Uint8Array::from(&iv_bytes[..]);
            let algo = Object::new();
            Reflect::set(&algo, &"name".into(), &"AES-GCM".into())
                .map_err(|_| KernelError::InternalError("Set algo name failed".into()))?;
            Reflect::set(&algo, &"iv".into(), &iv)
                .map_err(|_| KernelError::InternalError("Set IV failed".into()))?;

            let data_bytes = plaintext.as_bytes();

            let encrypt_promise = crypto
                .subtle()
                .encrypt_with_object_and_u8_array(&algo, key, data_bytes)
                .map_err(|_| KernelError::EncryptionFailed("subtle.encrypt call failed".into()))?;

            let result = JsFuture::from(encrypt_promise)
                .await
                .map_err(|_| KernelError::EncryptionFailed("subtle.encrypt failed".into()))?;

            let ciphertext = Uint8Array::new(&result);

            // Combine IV + ciphertext, base64 encode
            let ct_bytes = ciphertext.to_vec();
            let mut combined = Vec::with_capacity(12 + ct_bytes.len());
            combined.extend_from_slice(&iv_bytes);
            combined.extend_from_slice(&ct_bytes);

            Ok(crate::crypto::base64_encode(&combined))
        }

        /// Decrypt sealed blob → plaintext state JSON.
        pub async fn decrypt(&self, sealed_blob: &str) -> Result<String, KernelError> {
            let key = self.key.as_ref().ok_or_else(|| {
                KernelError::InternalError("Sealed key not initialized".into())
            })?;

            let combined = crate::crypto::base64_decode(sealed_blob)
                .map_err(|e| KernelError::DecryptionFailed(format!("Base64 decode: {}", e)))?;

            if combined.len() < 13 {
                return Err(KernelError::DecryptionFailed("Sealed blob too short".into()));
            }

            let (iv_bytes, ct_bytes) = combined.split_at(12);

            let crypto: web_sys::Crypto = js_sys::global()
                .dyn_into::<web_sys::WorkerGlobalScope>()
                .ok()
                .and_then(|w: web_sys::WorkerGlobalScope| w.crypto().ok())
                .ok_or_else(|| KernelError::InternalError("WebCrypto unavailable".into()))?;

            let iv = Uint8Array::from(iv_bytes);

            let algo = Object::new();
            Reflect::set(&algo, &"name".into(), &"AES-GCM".into())
                .map_err(|_| KernelError::InternalError("Set algo name failed".into()))?;
            Reflect::set(&algo, &"iv".into(), &iv)
                .map_err(|_| KernelError::InternalError("Set IV failed".into()))?;

            let decrypt_promise = crypto
                .subtle()
                .decrypt_with_object_and_u8_array(&algo, key, ct_bytes)
                .map_err(|_| KernelError::DecryptionFailed("subtle.decrypt call failed".into()))?;

            let result = JsFuture::from(decrypt_promise)
                .await
                .map_err(|_| {
                    KernelError::DecryptionFailed("subtle.decrypt failed — wrong key or corrupted".into())
                })?;

            let plaintext_bytes = Uint8Array::new(&result).to_vec();
            String::from_utf8(plaintext_bytes)
                .map_err(|_| KernelError::DecryptionFailed("Decrypted state is not valid UTF-8".into()))
        }

        /// Stub: key rotation check.
        pub fn needs_rotation(&self) -> bool {
            // TODO: track key creation time, rotate every 24 hours
            false
        }

        /// Rotate: new key, re-encrypt. Old key is GC'd.
        pub async fn rotate_key(&mut self, current_state: &str) -> Result<String, KernelError> {
            // Decrypt with old key
            let plaintext = if self.available && self.key.is_some() {
                // We already have the plaintext passed in, no need to decrypt
                current_state.to_string()
            } else {
                current_state.to_string()
            };

            // Generate new key
            self.init().await?;

            // Re-encrypt with new key
            self.encrypt(&plaintext).await
        }
    }

    impl Default for SealedStore {
        fn default() -> Self {
            Self::new()
        }
    }
}

/// Native (non-WASM) sealed storage — no-op passthrough.
/// Used for tests, CLI tools, and server-side validation.
#[cfg(not(target_arch = "wasm32"))]
pub mod native {
    use crate::error::KernelError;

    pub struct SealedStore {
        pub available: bool,
    }

    impl SealedStore {
        pub fn new() -> Self {
            Self { available: false }
        }

        /// No-op on native — returns plaintext as-is.
        pub fn encrypt_sync(&self, plaintext: &str) -> Result<String, KernelError> {
            Ok(plaintext.to_string())
        }

        /// No-op on native — returns blob as-is.
        pub fn decrypt_sync(&self, blob: &str) -> Result<String, KernelError> {
            Ok(blob.to_string())
        }
    }

    impl Default for SealedStore {
        fn default() -> Self {
            Self::new()
        }
    }
}

// ─── Browser test procedure (manual) ────────────────────────────────────────
//
// To verify sealed storage in a browser:
//
// 1. Build WASM: cd discreet-kernel && wasm-pack build --target web --release
// 2. Start client: cd client && npm run dev
// 3. Open DevTools → Console in the Kernel Worker context
// 4. Run:
//      const k = new WasmKernel();
//      // Initialize kernel
//      const initResp = k.handle('{"type":"Initialize"}');
//      console.log('Init:', initResp);
//
//      // Persist state (encrypted with non-extractable key)
//      const persistResp = k.handle('{"type":"PersistState"}');
//      const blob = JSON.parse(persistResp);
//      console.log('Sealed blob:', blob.sealed_state);
//
//      // Verify main thread CANNOT decrypt:
//      // Copy blob.sealed_state to main thread console
//      // Try: crypto.subtle.decrypt(...) → will fail (no key access)
//
//      // Restore state
//      const restoreResp = k.handle(JSON.stringify({
//        type: "RestoreState",
//        encrypted_state: blob.sealed_state
//      }));
//      console.log('Restore:', restoreResp);
