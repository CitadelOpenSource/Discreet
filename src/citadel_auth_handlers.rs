// citadel_auth_handlers.rs — Authentication endpoints.
//
// Real auth with Argon2id password hashing, JWT access tokens,
// SHA-256 hashed refresh tokens, and session revocation.
//
// Endpoints:
//   POST /auth/register             — Create account, return tokens
//   POST /auth/login                — Verify credentials; if 2FA enabled returns
//                                     { requires_2fa: true, session_token } instead of JWT
//   POST /auth/2fa/verify           — Complete 2FA login: accepts session_token + code, returns JWT
//   POST /auth/refresh              — Exchange refresh token for new access token
//   POST /auth/logout               — Revoke current session
//   GET  /auth/sessions             — List active sessions
//   DELETE /auth/sessions/:id       — Revoke a specific session
//
// 2FA management (user-scoped, require valid JWT):
//   POST /users/@me/2fa/setup       — Generate TOTP secret + provisioning URI
//   POST /users/@me/2fa/verify      — Validate 6-digit code to enable 2FA
//   POST /users/@me/2fa/disable     — Disable 2FA (requires valid code)
//
// Login 2FA flow:
//   1. POST /auth/login  →  { requires_2fa: true, session_token: "<token>" }
//   2. POST /auth/2fa/verify  { session_token, code }  →  full AuthResponse
//   The session_token is a random Redis key with a 5-minute TTL. It is consumed
//   on first use (GETDEL) to prevent replay.

use axum::{
    extract::{Path, State, Json},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::citadel_auth::{AuthUser, Claims};
use crate::citadel_config::Config;
use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

// ─── Request Types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    /// 3-32 chars, alphanumeric + underscores.
    pub username: String,
    /// Optional email for account recovery.
    pub email: Option<String>,
    /// Minimum 8 characters.
    pub password: String,
    /// Display name (defaults to username).
    pub display_name: Option<String>,
    /// Optional device identifier (e.g., "Firefox on Linux").
    pub device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    /// Username or email.
    pub login: String,
    /// Plaintext password.
    pub password: String,
    /// Optional device identifier.
    pub device_name: Option<String>,
}

/// Sent to POST /auth/2fa/verify to complete a two-step login.
#[derive(Debug, Deserialize)]
pub struct Login2faRequest {
    /// The opaque token returned by /auth/login when 2FA is required.
    pub session_token: String,
    /// 6-digit TOTP code from the authenticator app.
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct TotpVerifyRequest {
    /// 6-digit code from authenticator app.
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct TotpSetupResponse {
    /// Base32-encoded TOTP secret (for manual entry).
    pub secret: String,
    /// otpauth:// URI for QR code generation.
    pub provisioning_uri: String,
}

#[derive(Debug, Serialize)]
pub struct TotpStatusResponse {
    pub enabled: bool,
}

/// Returned by POST /auth/login when the user has 2FA enabled.
/// The client must follow up with POST /auth/2fa/verify.
#[derive(Debug, Serialize)]
pub struct Requires2faResponse {
    pub requires_2fa: bool,
    /// Opaque token; pass to POST /auth/2fa/verify. Expires in 5 minutes.
    pub session_token: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    /// The raw refresh token (NOT the hash). Optional — prefer HttpOnly cookie.
    pub refresh_token: Option<String>,
}

// ─── Response Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user: UserInfo,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    pub access_token: String,
    pub expires_in: u64,
}

// ── HttpOnly Refresh Token Cookie ───────────────────────────────────────
// The refresh token is set as an HttpOnly Secure SameSite=Strict cookie so
// JavaScript cannot read it (XSS-proof). The access token stays in memory.
// Mobile clients can still send refresh_token in the JSON body; the server
// checks the cookie first, then falls back to the body.

fn build_refresh_cookie(token: &str, max_age_secs: u64) -> String {
    // Secure flag only in release builds — localhost:3000 uses HTTP.
    let secure = if cfg!(debug_assertions) { "" } else { "; Secure" };
    format!(
        "d_ref={}; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age={}{}",
        token, max_age_secs, secure
    )
}

fn clear_refresh_cookie() -> String {
    let secure = if cfg!(debug_assertions) { "" } else { "; Secure" };
    format!("d_ref=; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=0{}", secure)
}

/// Wrap a JSON auth response with the Set-Cookie header for the refresh token.
fn auth_response_with_cookie(
    body: AuthResponse,
    refresh_token: &str,
    max_age_secs: u64,
    status: StatusCode,
) -> Response {
    let cookie = build_refresh_cookie(refresh_token, max_age_secs);
    let json_body = serde_json::to_string(&body).expect("AuthResponse serializes");
    let resp = Response::builder()
        .status(status)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .header(axum::http::header::SET_COOKIE, cookie)
        .body(axum::body::Body::from(json_body))
        .expect("valid response");
    resp
}

/// Extract refresh token from cookie (preferred) or JSON body (mobile fallback).
fn extract_refresh_token(
    headers: &axum::http::HeaderMap,
    body_token: Option<&str>,
) -> Result<String, AppError> {
    // 1. Try HttpOnly cookie first.
    if let Some(cookie_header) = headers.get(axum::http::header::COOKIE) {
        if let Ok(cookies) = cookie_header.to_str() {
            for part in cookies.split(';') {
                let trimmed = part.trim();
                if let Some(val) = trimmed.strip_prefix("d_ref=") {
                    if !val.is_empty() {
                        return Ok(val.to_string());
                    }
                }
            }
        }
    }
    // 2. Fall back to JSON body (mobile clients).
    body_token
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .ok_or_else(|| AppError::Unauthorized("Missing refresh token".into()))
}

#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub id: Uuid,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    /// True if this is the session making the request.
    pub current: bool,
}

// ─── POST /auth/register ────────────────────────────────────────────────

pub async fn register(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<RegisterRequest>,
) -> Result<impl IntoResponse, AppError> {
    // ── IP-based registration rate limit (max 3 per IP per 24 h) ──────────
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    let reg_count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM registrations_log \
         WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '24 hours'",
        ip,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    if reg_count >= 3 {
        return Err(AppError::RateLimited(
            "Too many registrations from this address. Try again later.".into(),
        ));
    }

    // Validate username.
    validate_username(&req.username)?;
    validate_password(&req.password)?;

    // Validate email format if provided.
    if let Some(ref email) = req.email {
        if !email.contains('@') || email.len() < 5 {
            return Err(AppError::BadRequest("Invalid email format".into()));
        }
    }

    // Check username uniqueness.
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)",
        req.username,
    )
    .fetch_one(&state.db)
    .await?;

    if exists.unwrap_or(false) {
        return Err(AppError::Conflict("Username already taken".into()));
    }

    // Check email uniqueness if provided.
    if let Some(ref email) = req.email {
        let email_exists = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)",
            email,
        )
        .fetch_one(&state.db)
        .await?;

        if email_exists.unwrap_or(false) {
            return Err(AppError::Conflict("Email already registered".into()));
        }
    }

    // Hash password with Argon2id.
    let password_hash = hash_password(&req.password)?;

    // Create user.
    let display_name = req.display_name.unwrap_or_else(|| req.username.clone());
    let mut user_id = Uuid::new_v4();

    // Prevent cryptographic key reuse: regenerate if UUID was previously deleted.
    for _ in 0..5 {
        let tombstoned = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM deleted_user_ids WHERE user_id = $1)",
            user_id,
        )
        .fetch_one(&state.db)
        .await?
        .unwrap_or(false);
        if !tombstoned {
            break;
        }
        tracing::warn!(user_id = %user_id, "UUID collision with deleted account — regenerating");
        user_id = Uuid::new_v4();
    }

    sqlx::query!(
        "INSERT INTO users (id, username, display_name, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)",
        user_id,
        req.username,
        display_name,
        req.email,
        password_hash,
    )
    .execute(&state.db)
    .await?;

    // Record this registration for IP rate-limiting (best-effort, non-fatal).
    sqlx::query!(
        "INSERT INTO registrations_log (ip_address) VALUES ($1)",
        ip,
    )
    .execute(&state.db)
    .await
    .ok();

    // ── Recovery key ──────────────────────────────────────────────────────
    let recovery_key = generate_recovery_key();
    let recovery_hash = hash_recovery_key(&recovery_key);
    sqlx::query(
        "UPDATE users SET recovery_key_hash = $1 WHERE id = $2",
    )
    .bind(&recovery_hash)
    .bind(user_id)
    .execute(&state.db)
    .await
    .ok(); // best-effort — don't fail registration

    // ── Email verification ────────────────────────────────────────────────
    // Only triggered when the user supplied an email address.
    if let Some(ref email) = req.email {
        let smtp_configured = !std::env::var("SMTP_HOST").unwrap_or_default().is_empty();

        if smtp_configured {
            // Production: store a 24-hour token and send a clickable link.
            let token = generate_hex_token();
            let base_url = std::env::var("BASE_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string());
            let verify_link = format!("{}/verify?token={}", base_url, token);

            // Store token (upsert so re-registration replaces any stale token).
            sqlx::query!(
                "INSERT INTO email_tokens (user_id, email, token, token_type, expires_at)
                 VALUES ($1, $2, $3, 'verify', NOW() + INTERVAL '24 hours')
                 ON CONFLICT (user_id, token_type) DO UPDATE
                     SET token = $3, email = $2, expires_at = NOW() + INTERVAL '24 hours'",
                user_id, email, token,
            )
            .execute(&state.db)
            .await?;

            // Fire-and-forget — never fail registration because of SMTP.
            let _ = crate::citadel_email_handlers::send_verification_link_email(
                &state, email, &verify_link,
            )
            .await;
        } else {
            // Development mode: auto-verify and log the token so developers
            // can see it without needing an SMTP server.
            sqlx::query!(
                "UPDATE users
                 SET email_verified = TRUE,
                     account_tier = CASE
                         WHEN account_tier IN ('guest', 'unverified') THEN 'verified'
                         ELSE account_tier
                     END,
                     badge_type = CASE
                         WHEN account_tier IN ('guest', 'unverified') THEN 'shield'
                         ELSE badge_type
                     END
                 WHERE id = $1",
                user_id,
            )
            .execute(&state.db)
            .await?;

            tracing::info!(
                user_id  = %user_id,
                email    = %email,
                "[DEV] SMTP not configured — email address auto-verified. \
                 Set SMTP_HOST in production to send real verification emails.",
            );
        }
    }

    // Create session and tokens.
    let (access_token, refresh_token, _session_id) =
        create_session(&state, user_id, req.device_name.as_deref()).await?;

    tracing::info!(user_id = %user_id, username = %req.username, "User registered");

    Ok(auth_response_with_cookie(
        AuthResponse {
            user: UserInfo {
                id: user_id,
                username: req.username,
                display_name: Some(display_name),
                email: req.email,
                created_at: chrono::Utc::now().to_rfc3339(),
            },
            access_token,
            refresh_token: refresh_token.clone(),
            expires_in: state.config.jwt_expiry_secs,
            recovery_key: Some(recovery_key),
        },
        &refresh_token,
        state.config.refresh_expiry_secs,
        StatusCode::CREATED,
    ))
}

// ─── POST /auth/guest ──────────────────────────────────────────────────

/// Create a guest account with zero friction.
/// No username, no password, no email. Just a random identity and instant access.
/// Guest accounts can join public servers, voice channels, and browse.
/// They auto-expire after 30 days of inactivity.
/// Guests can upgrade to registered (add username+password) or verified (add email).
#[derive(Debug, serde::Deserialize, Default)]
pub struct GuestRegisterRequest {
    pub captcha_token: Option<String>,
}

pub async fn register_guest(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    body: Option<Json<GuestRegisterRequest>>,
) -> Result<impl IntoResponse, AppError> {
    let captcha_token = body.and_then(|Json(b)| b.captcha_token);

    // ── Cloudflare Turnstile CAPTCHA (optional) ───────────────────────────
    // Only enforced when TURNSTILE_SECRET_KEY is set AND the client sends a
    // captcha_token. Self-hosted, offline, and proximity mesh deployments
    // work without CAPTCHA by simply not setting the env var.
    if let Ok(secret) = std::env::var("TURNSTILE_SECRET_KEY") {
        if !secret.is_empty() {
            if let Some(ref token) = captcha_token {
                let resp = reqwest::Client::new()
                    .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
                    .form(&[("secret", secret.as_str()), ("response", token.as_str())])
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("CAPTCHA verification request failed: {e}")))?;

                #[derive(serde::Deserialize)]
                struct TurnstileResponse {
                    success: bool,
                }

                let result: TurnstileResponse = resp.json().await
                    .map_err(|e| AppError::Internal(format!("CAPTCHA response parse error: {e}")))?;

                if !result.success {
                    return Err(AppError::BadRequest("CAPTCHA verification failed".into()));
                }
            }
        }
    }

    // Rate limit: max 10 guest accounts per IP per 24 hours
    let ip = headers.get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .or_else(|| headers.get("x-real-ip").and_then(|v| v.to_str().ok()).map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM guest_rate_limits WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '24 hours'",
        ip,
    ).fetch_one(&state.db).await?.unwrap_or(0);

    if count >= 10 {
        return Err(AppError::RateLimited("Guest account limit reached (10 per day). Please register for unlimited access.".into()));
    }

    // Record this creation
    sqlx::query!(
        "INSERT INTO guest_rate_limits (ip_address) VALUES ($1)",
        ip,
    ).execute(&state.db).await.ok();

    let mut user_id = Uuid::new_v4();

    // Prevent cryptographic key reuse: regenerate if UUID was previously deleted.
    for _ in 0..5 {
        let tombstoned = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM deleted_user_ids WHERE user_id = $1)",
            user_id,
        )
        .fetch_one(&state.db)
        .await?
        .unwrap_or(false);
        if !tombstoned {
            break;
        }
        tracing::warn!(user_id = %user_id, "UUID collision with deleted account — regenerating");
        user_id = Uuid::new_v4();
    }

    // Generate display name from the guest_name_pool (e.g. "SwiftFox247").
    // Falls back to the UUID-prefix format if the pool is empty.
    let guest_name = {
        let pool_row = sqlx::query!(
            "SELECT adjective, noun FROM guest_name_pool ORDER BY RANDOM() LIMIT 1"
        )
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        match pool_row {
            Some(row) => {
                let n: u16 = rand::thread_rng().gen_range(100..=999);
                format!("{}{}{}", row.adjective, row.noun, n)
            }
            None => format!("Guest-{}", &user_id.to_string()[..8]),
        }
    };

    sqlx::query!(
        "INSERT INTO users (id, username, display_name, password_hash, account_tier, is_guest, last_active_at)
         VALUES ($1, $2, $3, $4, 'guest', TRUE, NOW())",
        user_id, guest_name, guest_name,
        "$argon2id$v=19$m=19456,t=2,p=1$GUEST_NO_PASSWORD$0000000000000000000000", // placeholder, cannot be used to login
    )
    .execute(&state.db)
    .await?;

    let (access_token, refresh_token, _) =
        create_session(&state, user_id, Some("guest")).await?;

    tracing::info!(user_id = %user_id, "Guest account created: {}", guest_name);

    Ok(auth_response_with_cookie(
        AuthResponse {
            user: UserInfo {
                id: user_id,
                username: guest_name.clone(),
                display_name: Some(guest_name),
                email: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            },
            access_token,
            refresh_token: refresh_token.clone(),
            expires_in: state.config.jwt_expiry_secs,
            recovery_key: None,
        },
        &refresh_token,
        state.config.refresh_expiry_secs,
        StatusCode::CREATED,
    ))
}

// ─── POST /auth/upgrade ────────────────────────────────────────────────

/// Upgrade a guest account to a registered account by setting username + password.
/// Or upgrade a registered account to verified by confirming email.
#[derive(Debug, Deserialize)]
pub struct UpgradeRequest {
    pub username: Option<String>,
    pub password: Option<String>,
    pub email: Option<String>,
}

pub async fn upgrade_account(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpgradeRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Guest → Registered: requires username + password
    if let (Some(ref username), Some(ref password)) = (&req.username, &req.password) {
        validate_username(username)?;
        validate_password(password)?;

        let exists = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username = $1 AND id != $2)",
            username, auth.user_id,
        ).fetch_one(&state.db).await?.unwrap_or(false);
        if exists { return Err(AppError::Conflict("Username taken".into())); }

        let hash = hash_password(password)?;
        sqlx::query!(
            "UPDATE users SET username = $1, password_hash = $2, account_tier = 'unverified', is_guest = FALSE WHERE id = $3",
            username, hash, auth.user_id,
        ).execute(&state.db).await?;

        tracing::info!(user_id = %auth.user_id, "Guest upgraded to unverified: {}", username);
        return Ok(Json(serde_json::json!({ "tier": "unverified", "username": username })));
    }

    // Registered → Verified: email confirmation handled by verify-email endpoints
    if let Some(ref email) = req.email {
        sqlx::query!(
            "UPDATE users SET email = $1 WHERE id = $2",
            email, auth.user_id,
        ).execute(&state.db).await?;
        return Ok(Json(serde_json::json!({ "message": "Email set. Use /auth/verify-email/send to verify." })));
    }

    Err(AppError::BadRequest("Provide username+password to upgrade from guest, or email to start verification".into()))
}

// ─── POST /auth/login ───────────────────────────────────────────────────

pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Response, AppError> {
    // Find user by username or email.
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, password_hash, created_at, totp_enabled,
                banned_at, ban_reason, ban_expires_at
         FROM users
         WHERE username = $1 OR email = $1",
        req.login,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid credentials".into()))?;

    // ── Account ban check ─────────────────────────────────────────────────────
    if user.banned_at.is_some() {
        // Check if the ban has expired.
        let still_banned = match user.ban_expires_at {
            Some(expires) => chrono::Utc::now() < expires,
            None => true, // permanent ban
        };
        if still_banned {
            let reason = user.ban_reason.as_deref().unwrap_or("Violation of terms of service");
            return Err(AppError::Forbidden(
                format!("Account suspended: {reason}"),
            ));
        }
        // Ban expired — clear it.
        sqlx::query!(
            "UPDATE users SET banned_at = NULL, ban_reason = NULL, ban_expires_at = NULL WHERE id = $1",
            user.id,
        )
        .execute(&state.db)
        .await
        .ok();
    }

    // ── IP ban check ──────────────────────────────────────────────────────────
    {
        let ip = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
            .or_else(|| {
                headers
                    .get("x-real-ip")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());

        let ip_banned = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM platform_ip_bans WHERE ip_address = $1 AND (expires_at IS NULL OR expires_at > NOW()))",
            ip,
        )
        .fetch_one(&state.db)
        .await?
        .unwrap_or(false);

        if ip_banned {
            return Err(AppError::Forbidden(
                "Access denied from this network".into(),
            ));
        }
    }

    // ── Account lockout (Redis) ──────────────────────────────────────────────
    // Track failed password attempts per user. After 5 consecutive failures,
    // block login for 15 minutes. The counter is cleared on success.
    let lockout_key = format!("login_attempts:{}", user.id);
    let mut redis_conn = state.redis.clone();

    let attempts: i64 = redis::cmd("GET")
        .arg(&lockout_key)
        .query_async::<_, Option<String>>(&mut redis_conn)
        .await
        .unwrap_or(None)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    if attempts >= 5 {
        return Err(AppError::RateLimited(
            "Account temporarily locked. Try again in 15 minutes.".into(),
        ));
    }

    // Verify password.
    if !verify_password(&req.password, &user.password_hash)? {
        // Increment the failure counter and (re)set a 15-minute expiry.
        let _: Result<i64, _> = redis::cmd("INCR")
            .arg(&lockout_key)
            .query_async(&mut redis_conn)
            .await;
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&lockout_key)
            .arg(900_i64)
            .query_async(&mut redis_conn)
            .await;
        // Same error message to prevent username enumeration.
        return Err(AppError::Unauthorized("Invalid credentials".into()));
    }

    // Clear the failure counter on successful password verification.
    let _: Result<i64, _> = redis::cmd("DEL")
        .arg(&lockout_key)
        .query_async(&mut redis_conn)
        .await;

    // ── Two-step 2FA challenge ────────────────────────────────────────────────
    // If 2FA is enabled, issue a short-lived pending token instead of a real
    // session. The client must POST /auth/2fa/verify with this token + a TOTP
    // code to receive the actual JWT.
    if user.totp_enabled {
        let pending_token = generate_refresh_token(); // cryptographically random
        let pending_key = format!("totp_pending:{}", pending_token);
        let pending_value = serde_json::json!({
            "user_id":     user.id,
            "device_name": req.device_name,
        })
        .to_string();

        // Store for 5 minutes; single-use (consumed by GETDEL in complete_2fa_login).
        let _: Result<String, _> = redis::cmd("SET")
            .arg(&pending_key)
            .arg(&pending_value)
            .arg("EX")
            .arg(300_i64)
            .query_async(&mut redis_conn)
            .await;

        tracing::info!(user_id = %user.id, "2FA challenge issued");

        return Ok(Json(Requires2faResponse {
            requires_2fa: true,
            session_token: pending_token,
        })
        .into_response());
    }

    // ── No 2FA — create session directly ─────────────────────────────────────
    let (access_token, refresh_token, _session_id) =
        create_session(&state, user.id, req.device_name.as_deref()).await?;

    tracing::info!(user_id = %user.id, username = %user.username, "User logged in");

    Ok(auth_response_with_cookie(
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
        },
        &refresh_token,
        state.config.refresh_expiry_secs,
        StatusCode::OK,
    ))
}

// ─── POST /auth/2fa/verify (login completion) ───────────────────────────
//
// Second step of the two-factor login flow. Accepts the opaque session_token
// returned by POST /auth/login and a 6-digit TOTP code. On success, creates
// a real session and returns the full AuthResponse. The pending token is
// consumed on first use (GETDEL) and expires after 5 minutes regardless.

pub async fn complete_2fa_login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<Login2faRequest>,
) -> Result<impl IntoResponse, AppError> {
    let pending_key = format!("totp_pending:{}", req.session_token);
    let mut redis_conn = state.redis.clone();

    // Atomically read and delete the pending token so it cannot be replayed.
    let pending_json: Option<String> = redis::cmd("GETDEL")
        .arg(&pending_key)
        .query_async(&mut redis_conn)
        .await
        .unwrap_or(None);

    let pending_json = pending_json
        .ok_or_else(|| AppError::Unauthorized("Invalid or expired session token".into()))?;

    let pending: serde_json::Value = serde_json::from_str(&pending_json)?;

    let user_id: Uuid = pending["user_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| AppError::Internal("Malformed pending session".into()))?;

    let device_name = pending["device_name"].as_str().map(|s| s.to_string());

    // Fetch the user and their TOTP secret.
    let user = sqlx::query!(
        "SELECT id, username, display_name, email, totp_secret, created_at
         FROM users WHERE id = $1",
        user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let secret = user
        .totp_secret
        .ok_or_else(|| AppError::Internal("2FA enabled but no secret stored".into()))?;

    let decrypted = decrypt_totp_secret(&secret, &state.config)?;

    if !verify_totp(&decrypted, &req.code)? {
        return Err(AppError::Unauthorized("Invalid 2FA code".into()));
    }

    // Issue a real session now that the TOTP code is verified.
    let (access_token, refresh_token, _session_id) =
        create_session(&state, user_id, device_name.as_deref()).await?;

    tracing::info!(user_id = %user_id, "User completed 2FA login");

    Ok(auth_response_with_cookie(
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
        },
        &refresh_token,
        state.config.refresh_expiry_secs,
        StatusCode::OK,
    ))
}

// ─── POST /auth/refresh ─────────────────────────────────────────────────

pub async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(req): Json<RefreshRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Extract refresh token from HttpOnly cookie (web) or body (mobile).
    let raw_token = extract_refresh_token(&headers, req.refresh_token.as_deref())?;
    let token_hash = hash_refresh_token(&raw_token);

    // Find the session with this refresh token.
    let session = sqlx::query!(
        "SELECT id, user_id, expires_at, revoked_at
         FROM sessions
         WHERE refresh_token_hash = $1",
        token_hash,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("Invalid refresh token".into()))?;

    // Check revocation.
    if session.revoked_at.is_some() {
        return Err(AppError::Unauthorized("Session has been revoked".into()));
    }

    // Check expiration.
    if session.expires_at < chrono::Utc::now() {
        return Err(AppError::Unauthorized("Refresh token expired".into()));
    }

    // Issue a new access token (same session).
    let access_token = issue_access_token(
        session.user_id,
        session.id,
        &state.config,
    )?;

    Ok(Json(RefreshResponse {
        access_token,
        expires_in: state.config.jwt_expiry_secs,
    }))
}

// ─── POST /auth/logout ──────────────────────────────────────────────────

pub async fn logout(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    // Revoke the current session.
    let result = sqlx::query!(
        "UPDATE sessions SET revoked_at = NOW()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        auth.session_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Session not found or already revoked".into()));
    }

    tracing::info!(
        user_id = %auth.user_id,
        session_id = %auth.session_id,
        "User logged out"
    );

    // Clear the HttpOnly refresh token cookie.
    let mut resp = StatusCode::NO_CONTENT.into_response();
    resp.headers_mut().insert(
        axum::http::header::SET_COOKIE,
        clear_refresh_cookie().parse().expect("valid cookie"),
    );
    Ok(resp)
}

// ─── POST /auth/recover-account ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RecoverAccountRequest {
    pub username: String,
    pub recovery_key: String,
    pub new_password: String,
}

pub async fn recover_account(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RecoverAccountRequest>,
) -> Result<impl IntoResponse, AppError> {
    validate_password(&req.new_password)?;

    // Look up user by username
    let user = sqlx::query(
        "SELECT id, recovery_key_hash FROM users WHERE username = $1",
    )
    .bind(&req.username)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("DB error: {e}")))?
    .ok_or_else(|| AppError::Unauthorized("Invalid username or recovery key".into()))?;

    let user_id: Uuid = sqlx::Row::get(&user, "id");
    let stored_hash: Option<String> = sqlx::Row::get(&user, "recovery_key_hash");

    let stored_hash = stored_hash
        .ok_or_else(|| AppError::Unauthorized("Invalid username or recovery key".into()))?;

    // Verify recovery key
    let provided_hash = hash_recovery_key(&req.recovery_key);
    if provided_hash != stored_hash {
        return Err(AppError::Unauthorized("Invalid username or recovery key".into()));
    }

    // Reset password and invalidate recovery key (one-time use)
    let new_hash = hash_password(&req.new_password)?;
    sqlx::query(
        "UPDATE users SET password_hash = $1, recovery_key_hash = NULL WHERE id = $2",
    )
    .bind(&new_hash)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("DB error: {e}")))?;

    // Revoke all existing sessions
    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL")
        .bind(user_id)
        .execute(&state.db)
        .await
        .ok();

    tracing::info!(user_id = %user_id, "Account recovered via recovery key");

    Ok((StatusCode::OK, Json(serde_json::json!({
        "message": "Password reset successful. Please log in with your new password."
    }))))
}

// ─── GET /auth/sessions ─────────────────────────────────────────────────

pub async fn list_sessions(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let rows = sqlx::query!(
        "SELECT id, device_name, ip_address, created_at, expires_at
         FROM sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC",
        auth.user_id,
    )
    .fetch_all(&state.db)
    .await?;

    let sessions: Vec<SessionInfo> = rows
        .into_iter()
        .map(|r| SessionInfo {
            id: r.id,
            device_name: r.device_name,
            ip_address: r.ip_address.map(|ip| ip.to_string()),
            created_at: r.created_at.to_rfc3339(),
            expires_at: r.expires_at.to_rfc3339(),
            current: r.id == auth.session_id,
        })
        .collect();

    Ok(Json(sessions))
}

// ─── DELETE /auth/sessions/:id ──────────────────────────────────────────

pub async fn revoke_session(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<Uuid>,
) -> Result<impl IntoResponse, AppError> {
    // Users can only revoke their own sessions.
    let result = sqlx::query!(
        "UPDATE sessions SET revoked_at = NOW()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        session_id,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Session not found or already revoked".into()));
    }

    tracing::info!(
        user_id = %auth.user_id,
        revoked_session = %session_id,
        "Session revoked"
    );

    Ok(StatusCode::NO_CONTENT)
}

// ─── POST /auth/2fa/setup ──────────────────────────────────────────────
/// Generate a TOTP secret and provisioning URI. The secret is stored in the
/// DB but 2FA is NOT enabled until the user verifies with a valid code via
/// POST /auth/2fa/verify.
pub async fn setup_2fa(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    // Check if 2FA is already enabled.
    let already = sqlx::query_scalar!(
        "SELECT totp_enabled FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if already {
        return Err(AppError::Conflict("2FA is already enabled".into()));
    }

    // Generate a new TOTP secret.
    let secret = totp_rs::Secret::generate_secret();
    let secret_b32 = secret.to_encoded().to_string();

    let totp = totp_rs::TOTP::new(
        totp_rs::Algorithm::SHA1,
        6,
        1,
        30,
        secret.to_bytes().map_err(|e| AppError::Internal(format!("TOTP secret error: {e}")))?,
        Some("Discreet".to_string()),
        format!("user:{}", auth.user_id),
    )
    .map_err(|e| AppError::Internal(format!("TOTP creation error: {e}")))?;

    let provisioning_uri = totp.get_url();

    // Encrypt secret at rest before storing.
    let encrypted_secret = encrypt_totp_secret(&secret_b32, &state.config)?;

    sqlx::query!(
        "UPDATE users SET totp_secret = $1 WHERE id = $2",
        encrypted_secret,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(user_id = %auth.user_id, "2FA setup initiated");

    Ok(Json(TotpSetupResponse {
        secret: secret_b32,
        provisioning_uri,
    }))
}

// ─── POST /auth/2fa/verify ─────────────────────────────────────────────
/// Verify a TOTP code against the stored secret to enable 2FA. This must
/// be called after /auth/2fa/setup. The user provides the 6-digit code from
/// their authenticator app to confirm they've saved the secret.
pub async fn verify_2fa(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<TotpVerifyRequest>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        "SELECT totp_enabled, totp_secret FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if row.totp_enabled {
        return Err(AppError::Conflict("2FA is already enabled".into()));
    }

    let secret = row.totp_secret.ok_or_else(|| {
        AppError::BadRequest("Call /auth/2fa/setup first".into())
    })?;

    // Decrypt the stored secret.
    let decrypted = decrypt_totp_secret(&secret, &state.config)?;

    if !verify_totp(&decrypted, &req.code)? {
        return Err(AppError::Unauthorized("Invalid TOTP code".into()));
    }

    // Enable 2FA.
    sqlx::query!(
        "UPDATE users SET totp_enabled = TRUE WHERE id = $1",
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(user_id = %auth.user_id, "2FA enabled");

    Ok(Json(TotpStatusResponse { enabled: true }))
}

// ─── POST /auth/2fa/disable ────────────────────────────────────────────
/// Disable 2FA. Requires a valid TOTP code to prevent unauthorized disabling.
pub async fn disable_2fa(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<TotpVerifyRequest>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        "SELECT totp_enabled, totp_secret FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    if !row.totp_enabled {
        return Err(AppError::BadRequest("2FA is not enabled".into()));
    }

    let secret = row.totp_secret.ok_or_else(|| {
        AppError::Internal("2FA enabled but no secret stored".into())
    })?;

    let decrypted = decrypt_totp_secret(&secret, &state.config)?;

    if !verify_totp(&decrypted, &req.code)? {
        return Err(AppError::Unauthorized("Invalid TOTP code".into()));
    }

    // Disable 2FA and clear the secret.
    sqlx::query!(
        "UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1",
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(user_id = %auth.user_id, "2FA disabled");

    Ok(Json(TotpStatusResponse { enabled: false }))
}

// ─── Shared Auth Helpers ────────────────────────────────────────────────

/// Create a new session: generates access + refresh tokens, stores session in DB.
pub async fn create_session(
    state: &AppState,
    user_id: Uuid,
    device_name: Option<&str>,
) -> Result<(String, String, Uuid), AppError> {
    let session_id = Uuid::new_v4();

    // Generate a cryptographically random refresh token.
    let refresh_token = generate_refresh_token();
    let refresh_hash = hash_refresh_token(&refresh_token);

    // Calculate refresh token expiry.
    let expires_at = chrono::Utc::now()
        + chrono::Duration::seconds(state.config.refresh_expiry_secs as i64);

    // Store session.
    // ip_address is NULL for alpha — requires ConnectInfo middleware setup.
    sqlx::query!(
        "INSERT INTO sessions (id, user_id, refresh_token_hash, device_name, expires_at)
         VALUES ($1, $2, $3, $4, $5)",
        session_id,
        user_id,
        refresh_hash,
        device_name,
        expires_at,
    )
    .execute(&state.db)
    .await?;

    // Issue access token.
    let access_token = issue_access_token(user_id, session_id, &state.config)?;

    Ok((access_token, refresh_token, session_id))
}

/// Issue a signed JWT access token.
fn issue_access_token(user_id: Uuid, session_id: Uuid, config: &Config) -> Result<String, AppError> {
    use jsonwebtoken::{encode, EncodingKey, Header};

    let now = chrono::Utc::now().timestamp() as u64;
    let claims = Claims {
        sub: user_id,
        exp: now + config.jwt_expiry_secs,
        iat: now,
        sid: session_id,
    };

    let key = EncodingKey::from_secret(config.jwt_secret.as_bytes());
    encode(&Header::default(), &claims, &key)
        .map_err(|e| AppError::Internal(format!("JWT encoding failed: {e}")))
}

/// Generate a cryptographically random refresh token (URL-safe base64).
fn generate_refresh_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    // URL-safe base64 without padding.
    base64_url_encode(&bytes)
}

/// Generate a cryptographically random 32-byte token encoded as lowercase hex.
/// Used for email verification links (64-char hex string, URL-safe without encoding).
pub fn generate_hex_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generate a 24-char recovery key as 4 groups of 6 alphanumeric chars
/// separated by dashes (e.g., "A1B2C3-D4E5F6-G7H8J9-K1L2M3").
/// Excludes ambiguous characters (0/O, 1/I/l) for readability.
fn generate_recovery_key() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    let mut groups = Vec::with_capacity(4);
    for _ in 0..4 {
        let group: String = (0..6)
            .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
            .collect();
        groups.push(group);
    }
    groups.join("-")
}

/// SHA-256 hash a recovery key for storage.
fn hash_recovery_key(key: &str) -> String {
    use sha2::{Sha256, Digest};
    // Hash the key without dashes for consistency
    let normalized: String = key.chars().filter(|c| *c != '-').collect();
    let hash = Sha256::digest(normalized.as_bytes());
    hex::encode(hash)
}

/// Hash a refresh token with SHA-256 before storing in DB.
/// We never store raw refresh tokens — if the DB leaks, tokens are useless.
fn hash_refresh_token(token: &str) -> String {
    use sha2::{Sha256, Digest};
    let hash = Sha256::digest(token.as_bytes());
    hex::encode(hash)
}

/// URL-safe base64 encoding (no padding).
fn base64_url_encode(data: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.encode(data)
}

// ─── TOTP Verification ──────────────────────────────────────────────────

/// Verify a 6-digit TOTP code against a base32-encoded secret.
fn verify_totp(secret_b32: &str, code: &str) -> Result<bool, AppError> {
    let secret = totp_rs::Secret::Encoded(secret_b32.to_string());
    let secret_bytes = secret
        .to_bytes()
        .map_err(|e| AppError::Internal(format!("Invalid TOTP secret: {e}")))?;

    let totp = totp_rs::TOTP::new(
        totp_rs::Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        Some("Discreet".to_string()),
        String::new(),
    )
    .map_err(|e| AppError::Internal(format!("TOTP creation error: {e}")))?;

    Ok(totp.check_current(code).unwrap_or(false))
}

// ─── Password Hashing (Argon2id) ────────────────────────────────────────

/// Hash a password with Argon2id (memory-hard, GPU-resistant).
pub fn hash_password(password: &str) -> Result<String, AppError> {
    use argon2::{
        password_hash::{rand_core::OsRng, SaltString, PasswordHasher},
        Argon2,
    };

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("Password hashing failed: {e}")))
}

/// Verify a password against an Argon2id hash.
pub fn verify_password_pub(password: &str, hash: &str) -> Result<bool, AppError> {
    verify_password(password, hash)
}

/// Public wrapper for password validation rules (length, complexity).
pub fn validate_password_pub(password: &str) -> Result<(), AppError> {
    validate_password(password)
}

fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    use argon2::{
        password_hash::{PasswordHash, PasswordVerifier},
        Argon2,
    };

    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("Invalid stored hash: {e}")))?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

// ─── Validation ─────────────────────────────────────────────────────────

fn validate_username(username: &str) -> Result<(), AppError> {
    if username.len() < 3 || username.len() > 32 {
        return Err(AppError::BadRequest(
            "Username must be 3-32 characters".into()
        ));
    }
    if !username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::BadRequest(
            "Username may only contain letters, numbers, underscores, and hyphens".into()
        ));
    }
    // Block reserved prefixes used by system/bot accounts.
    let lower = username.to_lowercase();
    let blocked_prefixes = ["bot-", "system-", "dev_", "guest_"];
    for prefix in &blocked_prefixes {
        if lower.starts_with(prefix) {
            return Err(AppError::BadRequest("This username prefix is reserved".into()));
        }
    }
    // Block fully reserved names.
    let reserved = [
        "admin", "system", "citadel", "discreet", "mod", "moderator", "root",
        "everyone", "here", "deleted", "ghost", "support", "help", "security",
        "bot", "api", "www", "mail", "noreply", "abuse", "postmaster",
        "webmaster", "info", "contact", "staff", "team", "official",
    ];
    if reserved.contains(&lower.as_str()) {
        return Err(AppError::BadRequest("This username is reserved".into()));
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.len() < 8 {
        return Err(AppError::BadRequest(
            "Password must be at least 8 characters".into()
        ));
    }
    if password.len() > 128 {
        return Err(AppError::BadRequest(
            "Password must not exceed 128 characters".into()
        ));
    }
    // Require at least one uppercase, one lowercase, one digit.
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    if !has_upper || !has_lower || !has_digit {
        return Err(AppError::BadRequest(
            "Password must contain at least one uppercase letter, one lowercase letter, and one digit".into()
        ));
    }
    // Block extremely common passwords.
    let common = [
        "password", "12345678", "123456789", "qwerty123", "password1",
        "iloveyou", "abcdefgh", "1234567890", "baseball1", "football1",
        "welcome1", "letmein1", "admin123", "passw0rd", "abc12345",
        "hello123", "changeme1", "password123", "trustno1",
    ];
    let lower = password.to_lowercase();
    if common.iter().any(|c| lower == *c) {
        return Err(AppError::BadRequest(
            "This password is too common. Please choose a stronger password.".into()
        ));
    }
    Ok(())
}

// ─── TOTP Secret Encryption ─────────────────────────────────────────────
// Encrypts TOTP secrets at rest using AES-256-GCM so a database breach
// does not expose raw TOTP seeds.

/// Derive the 32-byte AES key from config.
fn totp_aes_key(config: &crate::citadel_config::Config) -> Result<[u8; 32], AppError> {
    if let Some(ref hex_key) = config.totp_encryption_key {
        let bytes = hex::decode(hex_key)
            .map_err(|_| AppError::Internal("TOTP_ENCRYPTION_KEY must be valid hex".into()))?;
        if bytes.len() != 32 {
            return Err(AppError::Internal("TOTP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)".into()));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(key)
    } else {
        // Fallback: derive from JWT_SECRET via SHA-256 (acceptable for dev).
        use sha2::{Sha256, Digest};
        let hash = Sha256::digest(config.jwt_secret.as_bytes());
        let mut key = [0u8; 32];
        key.copy_from_slice(&hash);
        Ok(key)
    }
}

/// Encrypt a TOTP base32 secret. Returns "nonce_hex:ciphertext_hex".
pub fn encrypt_totp_secret(plaintext: &str, config: &crate::citadel_config::Config) -> Result<String, AppError> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
    use aes_gcm::Nonce;
    use rand::RngCore;

    let key_bytes = totp_aes_key(config)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| AppError::Internal(format!("AES key error: {e}")))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Internal(format!("TOTP encrypt error: {e}")))?;

    Ok(format!("{}:{}", hex::encode(nonce_bytes), hex::encode(ciphertext)))
}

/// Decrypt a TOTP secret from "nonce_hex:ciphertext_hex" format.
pub fn decrypt_totp_secret(encrypted: &str, config: &crate::citadel_config::Config) -> Result<String, AppError> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
    use aes_gcm::Nonce;

    let key_bytes = totp_aes_key(config)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| AppError::Internal(format!("AES key error: {e}")))?;

    let parts: Vec<&str> = encrypted.splitn(2, ':').collect();
    if parts.len() != 2 {
        return Err(AppError::Internal("Malformed encrypted TOTP secret".into()));
    }

    let nonce_bytes = hex::decode(parts[0])
        .map_err(|_| AppError::Internal("Invalid TOTP nonce hex".into()))?;
    let ciphertext = hex::decode(parts[1])
        .map_err(|_| AppError::Internal("Invalid TOTP ciphertext hex".into()))?;

    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| AppError::Internal("TOTP decrypt failed — key may have changed".into()))?;

    String::from_utf8(plaintext)
        .map_err(|_| AppError::Internal("Decrypted TOTP is not valid UTF-8".into()))
}

// ─── Route Registration ─────────────────────────────────────────────────

/// Construct the auth sub-router. Merged into the main router.
pub fn auth_routes() -> axum::Router<Arc<AppState>> {
    use axum::routing::{get, post, delete};
    axum::Router::new()
        // Public (no AuthUser required).
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh))
        // Protected (AuthUser extracted from JWT).
        .route("/auth/logout", post(logout))
        .route("/auth/sessions", get(list_sessions))
        .route("/auth/sessions/{id}", delete(revoke_session))
}
