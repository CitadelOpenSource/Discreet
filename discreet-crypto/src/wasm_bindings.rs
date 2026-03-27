// discreet-crypto/src/wasm_bindings.rs
//! WebAssembly bindings for the Discreet MLS crypto layer.
//! Build: `wasm-pack build --target web --features wasm --no-default-features`

#![cfg(feature = "wasm")]

use wasm_bindgen::prelude::*;
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use openmls::prelude::*;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_basic_credential::SignatureKeyPair;
use crate::{identity, keypackage, group, message, sframe_voice};
use base64::Engine;

// ── Global State ──────────────────────────────────────────────────────────
// Split into IDENTITY (read-mostly) and GROUPS (mutated on encrypt/decrypt)
// to avoid borrow conflicts between &signer and &mut group.

static PROVIDER: Lazy<OpenMlsRustCrypto> = Lazy::new(|| OpenMlsRustCrypto::default());

struct Identity {
    signer: Option<SignatureKeyPair>,
    credential: Option<CredentialWithKey>,
    user_id: String,
    username: String,
}

static IDENTITY: Lazy<Mutex<Identity>> = Lazy::new(|| {
    Mutex::new(Identity {
        signer: None,
        credential: None,
        user_id: String::new(),
        username: String::new(),
    })
});

static GROUPS: Lazy<Mutex<HashMap<String, MlsGroup>>> = Lazy::new(|| {
    Mutex::new(HashMap::new())
});

fn b64_encode(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn b64_decode(s: &str) -> Result<Vec<u8>, JsValue> {
    base64::engine::general_purpose::STANDARD.decode(s)
        .map_err(|e| JsValue::from_str(&format!("Base64 decode error: {e}")))
}

// ── Exported Functions ────────────────────────────────────────────────────

#[wasm_bindgen(js_name = "generate_identity")]
pub fn init_identity(user_id: &str, username: &str) -> Result<String, JsValue> {
    let provider = &*PROVIDER;
    let (signer, credential) = identity::generate_identity(provider, user_id, username)
        .map_err(|e| JsValue::from_str(&e))?;

    let pub_key = b64_encode(&signer.to_public_vec());

    let mut id = IDENTITY.lock().unwrap();
    id.signer = Some(signer);
    id.credential = Some(credential);
    id.user_id = user_id.to_string();
    id.username = username.to_string();

    Ok(serde_json::json!({
        "user_id": user_id,
        "username": username,
        "public_key": pub_key,
    }).to_string())
}

#[wasm_bindgen]
pub fn generate_key_packages(count: usize) -> Result<String, JsValue> {
    let id = IDENTITY.lock().unwrap();
    let credential = id.credential.as_ref()
        .ok_or_else(|| JsValue::from_str("Identity not initialized"))?;
    let signer = id.signer.as_ref()
        .ok_or_else(|| JsValue::from_str("Identity not initialized"))?;

    let provider = &*PROVIDER;
    let packages = keypackage::generate_key_packages(provider, credential, signer, count)
        .map_err(|e| JsValue::from_str(&e))?;

    let b64_packages: Vec<String> = packages.iter().map(|p| b64_encode(p)).collect();
    serde_json::to_string(&b64_packages)
        .map_err(|e| JsValue::from_str(&format!("JSON serialize error: {e}")))
}

#[wasm_bindgen]
pub fn create_group(channel_id: &str) -> Result<u32, JsValue> {
    let id = IDENTITY.lock().unwrap();
    let signer = id.signer.as_ref()
        .ok_or_else(|| JsValue::from_str("Identity not initialized"))?;
    let credential = id.credential.as_ref()
        .ok_or_else(|| JsValue::from_str("Identity not initialized"))?;

    let provider = &*PROVIDER;
    let mls_group = group::create_group(provider, signer, credential, channel_id.as_bytes())
        .map_err(|e| JsValue::from_str(&e))?;

    let epoch = group::current_epoch(&mls_group) as u32;
    GROUPS.lock().unwrap().insert(channel_id.to_string(), mls_group);

    Ok(epoch)
}

#[wasm_bindgen]
pub fn add_member(channel_id: &str, key_package_b64: &str) -> Result<String, JsValue> {
    let kp_bytes = b64_decode(key_package_b64)?;

    let id = IDENTITY.lock().unwrap();
    let signer = id.signer.as_ref()
        .ok_or_else(|| JsValue::from_str("Identity not initialized"))?;

    let mut groups = GROUPS.lock().unwrap();
    let mls_group = groups.get_mut(channel_id)
        .ok_or_else(|| JsValue::from_str(&format!("Group not found: {channel_id}")))?;

    let kp_in = keypackage::deserialize_key_package(&kp_bytes)
        .map_err(|e| JsValue::from_str(&e))?;

    let provider = &*PROVIDER;
    let (commit_bytes, welcome_bytes) = group::add_member(mls_group, provider, signer, kp_in)
        .map_err(|e| JsValue::from_str(&e))?;

    Ok(serde_json::json!({
        "commit": b64_encode(&commit_bytes),
        "welcome": b64_encode(&welcome_bytes),
        "epoch": group::current_epoch(mls_group),
    }).to_string())
}

#[wasm_bindgen]
pub fn join_from_welcome(channel_id: &str, welcome_b64: &str) -> Result<u32, JsValue> {
    let welcome_bytes = b64_decode(welcome_b64)?;

    let provider = &*PROVIDER;
    let mls_group = group::join_from_welcome(provider, &welcome_bytes)
        .map_err(|e| JsValue::from_str(&e))?;

    let epoch = group::current_epoch(&mls_group) as u32;
    GROUPS.lock().unwrap().insert(channel_id.to_string(), mls_group);

    Ok(epoch)
}

#[wasm_bindgen]
pub fn encrypt_message(channel_id: &str, plaintext: &str) -> Result<String, JsValue> {
    let id = IDENTITY.lock().unwrap();
    let signer = id.signer.as_ref()
        .ok_or_else(|| JsValue::from_str("Identity not initialized"))?;

    let mut groups = GROUPS.lock().unwrap();
    let mls_group = groups.get_mut(channel_id)
        .ok_or_else(|| JsValue::from_str(&format!("Group not found: {channel_id}")))?;

    let provider = &*PROVIDER;
    let ciphertext = message::encrypt_text(mls_group, provider, signer, plaintext)
        .map_err(|e| JsValue::from_str(&e))?;

    Ok(b64_encode(&ciphertext))
}

#[wasm_bindgen]
pub fn decrypt_message(channel_id: &str, ciphertext_b64: &str) -> Result<String, JsValue> {
    let ct_bytes = b64_decode(ciphertext_b64)?;

    let mut groups = GROUPS.lock().unwrap();
    let mls_group = groups.get_mut(channel_id)
        .ok_or_else(|| JsValue::from_str(&format!("Group not found: {channel_id}")))?;

    let provider = &*PROVIDER;
    let plaintext = message::decrypt_text(mls_group, provider, &ct_bytes)
        .map_err(|e| JsValue::from_str(&e))?;

    Ok(plaintext)
}

#[wasm_bindgen]
pub fn process_commit(channel_id: &str, commit_b64: &str) -> Result<u32, JsValue> {
    let commit_bytes = b64_decode(commit_b64)?;

    let mut groups = GROUPS.lock().unwrap();
    let mls_group = groups.get_mut(channel_id)
        .ok_or_else(|| JsValue::from_str(&format!("Group not found: {channel_id}")))?;

    let provider = &*PROVIDER;
    group::process_commit(mls_group, provider, &commit_bytes)
        .map_err(|e| JsValue::from_str(&e))?;

    Ok(group::current_epoch(mls_group) as u32)
}

#[wasm_bindgen]
pub fn self_update(channel_id: &str) -> Result<String, JsValue> {
    let id = IDENTITY.lock().unwrap();
    let signer = id.signer.as_ref()
        .ok_or_else(|| JsValue::from_str("Identity not initialized"))?;

    let mut groups = GROUPS.lock().unwrap();
    let mls_group = groups.get_mut(channel_id)
        .ok_or_else(|| JsValue::from_str(&format!("Group not found: {channel_id}")))?;

    let provider = &*PROVIDER;
    let commit_bytes = group::self_update(mls_group, provider, signer)
        .map_err(|e| JsValue::from_str(&e))?;

    Ok(b64_encode(&commit_bytes))
}

#[wasm_bindgen]
pub fn group_info(channel_id: &str) -> String {
    let groups = GROUPS.lock().unwrap();
    match groups.get(channel_id) {
        Some(g) => serde_json::json!({
            "has_group": true,
            "epoch": group::current_epoch(g),
            "members": group::member_count(g),
        }).to_string(),
        None => serde_json::json!({
            "has_group": false,
            "epoch": 0,
            "members": 0,
        }).to_string(),
    }
}

#[wasm_bindgen]
pub fn is_initialized() -> bool {
    IDENTITY.lock().unwrap().signer.is_some()
}

#[wasm_bindgen]
pub fn mls_version() -> String {
    format!("OpenMLS {} / MLS RFC 9420 / Cipher: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519", crate::VERSION)
}

// ── SFrame Voice Bindings ───────────────────────────────────────────────

#[wasm_bindgen]
pub fn derive_voice_key(base_secret_b64: &str, channel_id: &str, epoch: u64) -> Result<String, JsValue> {
    let base_secret = b64_decode(base_secret_b64)?;
    let key = sframe_voice::derive_voice_key_bytes(&base_secret, channel_id, epoch)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(b64_encode(&key))
}

#[wasm_bindgen]
pub fn encrypt_voice_frame(plaintext_b64: &str, key_id: u64, key_b64: &str) -> Result<String, JsValue> {
    let plaintext = b64_decode(plaintext_b64)?;
    let key = b64_decode(key_b64)?;
    let ciphertext = sframe_voice::encrypt_voice_frame_bytes(&plaintext, &key, key_id)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(b64_encode(&ciphertext))
}

#[wasm_bindgen]
pub fn decrypt_voice_frame(ciphertext_b64: &str, key_id: u64, key_b64: &str) -> Result<String, JsValue> {
    let ciphertext = b64_decode(ciphertext_b64)?;
    let key = b64_decode(key_b64)?;
    let decrypted = sframe_voice::decrypt_voice_frame_bytes(&ciphertext, &key, key_id)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(b64_encode(&decrypted))
}
