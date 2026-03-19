// discreet_passkey.rs — WebAuthn passkey registration and login.
//
// Endpoints:
//   POST /auth/passkey/register/start   — Begin passkey registration (returns challenge)
//   POST /auth/passkey/register/finish  — Complete registration (stores credential)
//   POST /auth/passkey/login/start      — Begin passkey login (returns challenge)
//   POST /auth/passkey/login/finish     — Complete login (issues JWT)
//
// Uses webauthn-rs v0.5 with relying party ID "discreetai.net".
// Challenge state is stored in Redis with a 5-minute TTL.
// Max 10 passkeys per user.

use std::sync::Arc;

use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use uuid::Uuid;
use webauthn_rs::prelude::*;
use webauthn_rs::Webauthn;

use crate::discreet_auth::AuthUser;
use crate::discreet_auth_handlers::{
    auth_response_with_cookie, create_session, AuthResponse, UserInfo,
};
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

/// Challenge TTL in Redis (seconds).
const CHALLENGE_TTL: i64 = 300;

/// Maximum passkeys per user account.
const MAX_PASSKEYS: i64 = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Build a `Webauthn` verifier with our relying party configuration.
/// Self-hosted instances can override via WEBAUTHN_RP_ID and PUBLIC_URL.
fn build_webauthn() -> Result<Webauthn, AppError> {
    let rp_id = std::env::var("WEBAUTHN_RP_ID")
        .unwrap_or_else(|_| "discreetai.net".into());
    let rp_origin = std::env::var("PUBLIC_URL")
        .unwrap_or_else(|_| format!("https://{}", rp_id));

    let rp_origin_url = url::Url::parse(&rp_origin)
        .map_err(|e| AppError::Internal(format!("Invalid PUBLIC_URL for WebAuthn: {e}")))?;

    let builder = WebauthnBuilder::new(&rp_id, &rp_origin_url)
        .map_err(|e| AppError::Internal(format!("WebAuthn builder error: {e}")))?
        .rp_name("Discreet");

    builder
        .build()
        .map_err(|e| AppError::Internal(format!("WebAuthn build error: {e}")))
}

/// Load all stored passkeys for a user from the database.
async fn load_passkeys(db: &sqlx::PgPool, user_id: Uuid) -> Result<Vec<Passkey>, AppError> {
    let rows = sqlx::query!(
        "SELECT passkey_json FROM webauthn_credentials WHERE user_id = $1",
        user_id,
    )
    .fetch_all(db)
    .await?;

    let mut passkeys = Vec::with_capacity(rows.len());
    for row in &rows {
        let pk: Passkey = serde_json::from_slice(&row.passkey_json)
            .map_err(|e| AppError::Internal(format!("Stored passkey parse error: {e}")))?;
        passkeys.push(pk);
    }
    Ok(passkeys)
}

// ─── Request types ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterFinishRequest {
    pub credential: serde_json::Value,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginStartRequest {
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginFinishRequest {
    pub username: String,
    pub credential: serde_json::Value,
}

// ─── POST /auth/passkey/register/start ──────────────────────────────────────

/// Begin passkey registration. Returns a WebAuthn challenge.
/// Requires authentication (user must be logged in to add a passkey).
pub async fn register_start(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) as \"count!: i64\" FROM webauthn_credentials WHERE user_id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if count >= MAX_PASSKEYS {
        return Err(AppError::BadRequest(
            format!("Maximum of {} passkeys per account", MAX_PASSKEYS),
        ));
    }

    let existing = load_passkeys(&state.db, auth.user_id).await?;
    let exclude_ids: Vec<CredentialID> = existing
        .iter()
        .map(|pk| pk.cred_id().clone())
        .collect();
    let exclude = if exclude_ids.is_empty() { None } else { Some(exclude_ids) };

    let username = sqlx::query_scalar!(
        "SELECT username FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    let webauthn = build_webauthn()?;

    let (ccr, reg_state) = webauthn
        .start_passkey_registration(auth.user_id, &username, &username, exclude)
        .map_err(|e| AppError::Internal(format!("WebAuthn registration start: {e}")))?;

    // Store challenge state in Redis (5-minute TTL, single-use via GETDEL).
    let key = format!("webauthn:reg:{}", auth.user_id);
    let val = serde_json::to_string(&reg_state)
        .map_err(|e| AppError::Internal(format!("State serialization: {e}")))?;

    let mut redis = state.redis.clone();
    crate::discreet_error::redis_or_503::<String>(
        redis::cmd("SET")
            .arg(&key)
            .arg(&val)
            .arg("EX")
            .arg(CHALLENGE_TTL)
            .query_async(&mut redis)
            .await,
    )?;

    Ok(Json(ccr))
}

// ─── POST /auth/passkey/register/finish ─────────────────────────────────────

/// Complete passkey registration. Stores the new credential.
pub async fn register_finish(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterFinishRequest>,
) -> Result<impl IntoResponse, AppError> {
    let webauthn = build_webauthn()?;

    // Consume the challenge state.
    let key = format!("webauthn:reg:{}", auth.user_id);
    let mut redis = state.redis.clone();

    let val: Option<String> = redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut redis)
        .await
        .unwrap_or(None);

    let val = val.ok_or_else(|| {
        AppError::BadRequest("Registration challenge expired or not found".into())
    })?;

    let reg_state: PasskeyRegistration = serde_json::from_str(&val)
        .map_err(|e| AppError::Internal(format!("Challenge state parse: {e}")))?;

    let reg_response: RegisterPublicKeyCredential = serde_json::from_value(req.credential)
        .map_err(|e| AppError::BadRequest(format!("Invalid credential: {e}")))?;

    let passkey = webauthn
        .finish_passkey_registration(&reg_response, &reg_state)
        .map_err(|e| AppError::BadRequest(format!("Registration verification failed: {e}")))?;

    // Serialize the full Passkey for storage.
    let passkey_json = serde_json::to_vec(&passkey)
        .map_err(|e| AppError::Internal(format!("Passkey serialization: {e}")))?;
    let cred_id = passkey.cred_id().to_vec();
    let name = req.name.unwrap_or_else(|| "Passkey".into());

    sqlx::query!(
        "INSERT INTO webauthn_credentials
            (user_id, credential_id, public_key, counter, name, passkey_json)
         VALUES ($1, $2, $3, 0, $4, $5)",
        auth.user_id,
        &cred_id,
        &passkey_json,
        name,
        &passkey_json,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(user_id = %auth.user_id, name = %name, "PASSKEY_REGISTERED");

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "name": name,
        "created": true,
    }))))
}

// ─── POST /auth/passkey/login/start ─────────────────────────────────────────

/// Begin passkey login. Returns a WebAuthn challenge.
/// No authentication required (this IS the login flow).
pub async fn login_start(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginStartRequest>,
) -> Result<impl IntoResponse, AppError> {
    let user = sqlx::query!(
        "SELECT id FROM users WHERE username = $1",
        req.username,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid credentials".into()))?;

    let passkeys = load_passkeys(&state.db, user.id).await?;
    if passkeys.is_empty() {
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    let webauthn = build_webauthn()?;

    let (rcr, auth_state) = webauthn
        .start_passkey_authentication(&passkeys)
        .map_err(|e| AppError::Internal(format!("WebAuthn auth start: {e}")))?;

    // Store challenge state in Redis.
    let key = format!("webauthn:auth:{}", req.username.to_lowercase());
    let val = serde_json::to_string(&serde_json::json!({
        "user_id": user.id,
        "auth_state": auth_state,
    }))
    .map_err(|e| AppError::Internal(format!("State serialization: {e}")))?;

    let mut redis = state.redis.clone();
    crate::discreet_error::redis_or_503::<String>(
        redis::cmd("SET")
            .arg(&key)
            .arg(&val)
            .arg("EX")
            .arg(CHALLENGE_TTL)
            .query_async(&mut redis)
            .await,
    )?;

    Ok(Json(rcr))
}

// ─── POST /auth/passkey/login/finish ────────────────────────────────────────

/// Complete passkey login. Issues JWT + refresh token (same as password login).
pub async fn login_finish(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginFinishRequest>,
) -> Result<Response, AppError> {
    let webauthn = build_webauthn()?;

    // Consume the challenge state.
    let key = format!("webauthn:auth:{}", req.username.to_lowercase());
    let mut redis = state.redis.clone();

    let val: Option<String> = redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut redis)
        .await
        .unwrap_or(None);

    let val = val.ok_or_else(|| {
        AppError::BadRequest("Login challenge expired or not found".into())
    })?;

    let stored: serde_json::Value = serde_json::from_str(&val)
        .map_err(|e| AppError::Internal(format!("Challenge state parse: {e}")))?;

    let user_id: Uuid = stored["user_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| AppError::Internal("Malformed auth state".into()))?;

    let auth_state: PasskeyAuthentication =
        serde_json::from_value(stored["auth_state"].clone())
            .map_err(|e| AppError::Internal(format!("Auth state parse: {e}")))?;

    let auth_response: PublicKeyCredential = serde_json::from_value(req.credential)
        .map_err(|e| AppError::BadRequest(format!("Invalid credential: {e}")))?;

    let auth_result = webauthn
        .finish_passkey_authentication(&auth_response, &auth_state)
        .map_err(|_| AppError::Unauthorized("Passkey verification failed".into()))?;

    // Update counter to prevent cloning attacks.
    if auth_result.needs_update() {
        let cred_id = auth_result.cred_id().to_vec();
        sqlx::query!(
            "UPDATE webauthn_credentials SET counter = counter + 1
             WHERE credential_id = $1",
            &cred_id,
        )
        .execute(&state.db)
        .await
        .ok(); // best-effort
    }

    // ── Ban check ───────────────────────────────────────────────────────
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, created_at,
                banned_at, ban_reason, ban_expires_at
         FROM users WHERE id = $1",
        user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid credentials".into()))?;

    if user.banned_at.is_some() {
        let still_banned = match user.ban_expires_at {
            Some(expires) => chrono::Utc::now() < expires,
            None => true,
        };
        if still_banned {
            let reason = user.ban_reason.as_deref()
                .unwrap_or("Violation of terms of service");
            return Err(AppError::Forbidden(
                format!("Account suspended: {reason}"),
            ));
        }
    }

    // ── Issue session (identical to password login) ─────────────────────
    let (access_token, refresh_token, _session_id) =
        create_session(&state, user.id, Some("Passkey")).await?;

    tracing::info!(
        user_id = %user.id,
        username = %user.username,
        "PASSKEY_LOGIN_SUCCESS"
    );

    auth_response_with_cookie(
        AuthResponse {
            user: UserInfo {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                email: user.email,
                created_at: user.created_at.to_rfc3339(),
            },
            access_token,
            refresh_token: refresh_token.clone(),
            expires_in: state.config.jwt_expiry_secs,
            recovery_key: None,
            verification_pending: None,
        },
        &refresh_token,
        state.config.refresh_expiry_secs,
        StatusCode::OK,
    )
}
