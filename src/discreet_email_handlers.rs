// discreet_email_handlers.rs — Email verification and password reset.
//
// Email delivery:
//   RESEND_API_KEY set → Resend HTTP API (https://api.resend.com/emails)
//   Neither set        → log-only (dev mode, token returned in response)
//
// Endpoints:
//   POST /api/v1/auth/verify-email/send    — Send verification email
//   POST /api/v1/auth/verify-email/confirm — Confirm email with token
//   POST /api/v1/auth/forgot-password      — Send password reset email
//   POST /api/v1/auth/reset-password       — Reset password with token

use axum::{extract::{Query, State, Json}, response::IntoResponse};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::{discreet_auth::AuthUser, discreet_error::AppError, discreet_state::AppState};

/// Returns true if any email delivery provider is configured (env vars present).
/// Used to decide whether dev_token / dev_link fields should be exposed.
pub fn email_provider_configured() -> bool {
    std::env::var("RESEND_API_KEY").map(|v| !v.is_empty()).unwrap_or(false)
}

#[derive(Debug, Deserialize)]
pub struct SendVerificationRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmEmailRequest {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub new_password: String,
}

// ─── POST /auth/verify-email/send ──────────────────────────────────────

pub async fn send_verification(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<SendVerificationRequest>,
) -> Result<impl IntoResponse, AppError> {
    let email = req.email.trim().to_lowercase();
    if !email.contains('@') || !email.contains('.') {
        return Err(AppError::BadRequest("Invalid email address".into()));
    }

    // Generate verification token and link
    let token = crate::discreet_auth_handlers::generate_hex_token();
    let base_url = std::env::var("BASE_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let verify_link = format!("{}/verify?token={}", base_url, token);

    // Store token with 24h expiry
    sqlx::query!(
        "INSERT INTO email_tokens (user_id, email, token, token_type, expires_at)
         VALUES ($1, $2, $3, 'verify', NOW() + INTERVAL '24 hours')
         ON CONFLICT (user_id, token_type) DO UPDATE SET token = $3, email = $2, expires_at = NOW() + INTERVAL '24 hours'",
        auth.user_id, email, token,
    )
    .execute(&state.db)
    .await?;

    let sent = send_verification_link_email(&state, &email, &verify_link).await;

    if sent {
        Ok(Json(serde_json::json!({ "message": "Verification email sent" })))
    } else if email_provider_configured() {
        // Provider configured but send failed — do NOT leak the token.
        Ok(Json(serde_json::json!({ "message": "Verification email sent" })))
    } else {
        // No email provider — return token/link so dev/test flows can proceed.
        tracing::warn!("Email provider not configured — returning token in response (dev mode only)");
        Ok(Json(serde_json::json!({ "message": "Verification email sent", "dev_token": &token, "dev_link": &verify_link })))
    }
}

// ─── POST /auth/verify-email/confirm ───────────────────────────────────

pub async fn confirm_email(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<ConfirmEmailRequest>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        "SELECT email FROM email_tokens WHERE user_id = $1 AND token_type = 'verify' AND token = $2 AND expires_at > NOW()",
        auth.user_id, req.token,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Invalid or expired verification token".into()))?;

    // Mark email as verified and upgrade tier from guest/unverified → verified.
    // Users already on a higher tier (premium, dev, admin) keep their tier.
    sqlx::query!(
        "UPDATE users
         SET email         = $1,
             email_verified = TRUE,
             account_tier   = CASE
                 WHEN account_tier IN ('guest', 'unverified') THEN 'verified'
                 ELSE account_tier
             END,
             badge_type     = CASE
                 WHEN account_tier IN ('guest', 'unverified') THEN 'shield'
                 ELSE badge_type
             END
         WHERE id = $2",
        row.email, auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Clean up token
    sqlx::query!(
        "DELETE FROM email_tokens WHERE user_id = $1 AND token_type = 'verify'",
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Invalidate cached user state so AuthUser picks up verified status immediately.
    crate::discreet_auth::invalidate_user_cache(&state, auth.user_id).await;

    // Issue a fresh access token so the client gets updated claims.
    let access_token = crate::discreet_auth_handlers::issue_access_token_pub(
        auth.user_id, auth.session_id, &state.config,
    )?;

    Ok(Json(serde_json::json!({
        "message": "Email verified successfully",
        "access_token": access_token,
        "expires_in": state.config.jwt_expiry_secs,
    })))
}

// ─── POST /auth/forgot-password ────────────────────────────────────────

pub async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ForgotPasswordRequest>,
) -> Result<impl IntoResponse, AppError> {
    let email = req.email.trim().to_lowercase();

    // Find user by email (don't reveal if email exists)
    let user = sqlx::query!(
        "SELECT id FROM users WHERE email = $1",
        email,
    )
    .fetch_optional(&state.db)
    .await?;

    if let Some(user) = user {
        let token = Uuid::new_v4().to_string();

        sqlx::query!(
            "INSERT INTO email_tokens (user_id, email, token, token_type, expires_at)
             VALUES ($1, $2, $3, 'reset', NOW() + INTERVAL '1 hour')
             ON CONFLICT (user_id, token_type) DO UPDATE SET token = $3, expires_at = NOW() + INTERVAL '1 hour'",
            user.id, email, token,
        )
        .execute(&state.db)
        .await?;

        send_email(
            &state,
            &email,
            "Reset your Discreet password",
            &format!(
                "Your password reset code: {}\n\nThis code expires in 1 hour.\n\nIf you didn't request this, ignore this email.",
                &token
            ),
        ).await;
    }

    // Always return success (don't reveal if email exists)
    Ok(Json(serde_json::json!({ "message": "If an account with that email exists, a reset email has been sent." })))
}

// ─── POST /auth/reset-password ─────────────────────────────────────────

pub async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<impl IntoResponse, AppError> {
    crate::discreet_auth_handlers::validate_password_pub(&req.new_password)?;

    let row = sqlx::query!(
        "SELECT user_id FROM email_tokens WHERE token_type = 'reset' AND token = $1 AND expires_at > NOW()",
        req.token,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Invalid or expired reset token".into()))?;

    // Hash new password with Argon2id
    let hash = crate::discreet_auth_handlers::hash_password(&req.new_password)?;

    sqlx::query!(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        hash, row.user_id,
    )
    .execute(&state.db)
    .await?;

    // Clean up token
    sqlx::query!(
        "DELETE FROM email_tokens WHERE user_id = $1 AND token_type = 'reset'",
        row.user_id,
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "message": "Password reset successfully" })))
}

// ─── GET /auth/verify-email?token={token} ──────────────────────────────
//
// Unauthenticated link-click endpoint. The verification email points here.
// Looks up the token, sets email_verified = TRUE, then deletes the token.

#[derive(Debug, Deserialize)]
pub struct VerifyEmailQuery {
    pub token: String,
}

pub async fn verify_email_by_token(
    State(state): State<Arc<AppState>>,
    Query(q): Query<VerifyEmailQuery>,
) -> Result<impl IntoResponse, AppError> {
    // Look up the token — must be a 'verify' type and not yet expired.
    let row = sqlx::query!(
        "SELECT user_id FROM email_tokens
         WHERE token_type = 'verify' AND token = $1 AND expires_at > NOW()",
        q.token,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Invalid or expired verification token".into()))?;

    // Mark the account as verified and upgrade tier from guest/unverified → verified.
    // Users already on a higher tier (premium, dev, admin) keep their tier.
    sqlx::query!(
        "UPDATE users
         SET email_verified = TRUE,
             account_tier   = CASE
                 WHEN account_tier IN ('guest', 'unverified') THEN 'verified'
                 ELSE account_tier
             END,
             badge_type     = CASE
                 WHEN account_tier IN ('guest', 'unverified') THEN 'shield'
                 ELSE badge_type
             END
         WHERE id = $1",
        row.user_id,
    )
    .execute(&state.db)
    .await?;

    // Consume the token so it can't be reused.
    sqlx::query!(
        "DELETE FROM email_tokens WHERE token_type = 'verify' AND token = $1",
        q.token,
    )
    .execute(&state.db)
    .await?;

    tracing::info!(user_id = %row.user_id, "Email verified via link token");

    Ok(Json(serde_json::json!({ "message": "Email verified successfully" })))
}

// ─── POST /auth/resend-verification ────────────────────────────────────
//
// JWT-authenticated. Generates a fresh token and resends the verification
// email. Rate-limited to 3 requests per hour per user via Redis.

pub async fn resend_verification(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    // ── Rate limit: 3 per hour ──────────────────────────────────────────
    let rate_key = format!("resend_verify:{}", auth.user_id);
    let mut redis_conn = state.redis.clone();

    let count: i64 = crate::discreet_error::redis_or_503(
        redis::cmd("INCR")
            .arg(&rate_key)
            .query_async::<Option<i64>>(&mut redis_conn)
            .await
    )?.unwrap_or(1);

    if count == 1 {
        // Set a 1-hour sliding window on the first increment.
        let _: Result<bool, _> = redis::cmd("EXPIRE")
            .arg(&rate_key)
            .arg(3600_i64)
            .query_async(&mut redis_conn)
            .await;
    }

    if count > 3 {
        return Err(AppError::RateLimited(
            "Too many verification emails requested. Please wait up to an hour before trying again.".into(),
        ));
    }

    // ── Guard: not already verified, has an email ───────────────────────
    let user = sqlx::query!(
        "SELECT email, email_verified FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    if user.email_verified {
        return Err(AppError::BadRequest("Email address is already verified".into()));
    }

    let email = user
        .email
        .ok_or_else(|| AppError::BadRequest("No email address on file. Update your profile first.".into()))?;

    // ── Generate and store a fresh 24-hour token ────────────────────────
    let token = crate::discreet_auth_handlers::generate_hex_token();
    let base_url = std::env::var("BASE_URL")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let verify_link = format!("{}/verify?token={}", base_url, token);

    sqlx::query!(
        "INSERT INTO email_tokens (user_id, email, token, token_type, expires_at)
         VALUES ($1, $2, $3, 'verify', NOW() + INTERVAL '24 hours')
         ON CONFLICT (user_id, token_type) DO UPDATE
             SET token = $3, email = $2, expires_at = NOW() + INTERVAL '24 hours'",
        auth.user_id, email, token,
    )
    .execute(&state.db)
    .await?;

    // ── Send or log ─────────────────────────────────────────────────────
    let sent = send_verification_link_email(&state, &email, &verify_link).await;

    if sent {
        tracing::info!(user_id = %auth.user_id, "Verification email resent (attempt {})", count);
        Ok(Json(serde_json::json!({ "message": "Verification email sent" })))
    } else if email_provider_configured() {
        // Provider configured but send failed — do NOT leak the token.
        tracing::warn!(user_id = %auth.user_id, "Verification email send failed (provider configured)");
        Ok(Json(serde_json::json!({ "message": "Verification email sent" })))
    } else {
        // No email provider configured — return token/link so dev flows can proceed.
        tracing::info!(
            user_id = %auth.user_id,
            token   = %token,
            link    = %verify_link,
            "[DEV] Email provider not configured — verification link logged here.",
        );
        Ok(Json(serde_json::json!({
            "message": "Verification email sent",
            "dev_token": token,
            "dev_link":  verify_link,
        })))
    }
}

// ─── Public helper: send a verification-link email ─────────────────────
//
// Called from register (discreet_auth_handlers) and resend_verification.
// Returns true if the email was dispatched, false if SMTP is unconfigured.

pub async fn send_verification_link_email(state: &AppState, to: &str, link: &str) -> bool {
    send_email(
        state,
        to,
        "Verify your Discreet account",
        &format!(
            "Welcome to Discreet!\n\n\
             Please verify your email address by clicking the link below:\n\n\
             {}\n\n\
             This link expires in 24 hours.\n\n\
             If you did not create a Discreet account, you can safely ignore this email.",
            link
        ),
    )
    .await
}

// ─── Email Sender ──────────────────────────────────────────────────────
//
// Priority:
//   1. RESEND_API_KEY set → POST to Resend HTTP API (https://api.resend.com/emails)
//   2. Neither configured  → log and return false (dev mode)

async fn send_email(_state: &AppState, to: &str, subject: &str, body: &str) -> bool {
    // ── Resend HTTP API ───────────────────────────────────────────────
    if let Ok(api_key) = std::env::var("RESEND_API_KEY") {
        if !api_key.is_empty() {
            let from = std::env::var("SMTP_FROM")
                .unwrap_or_else(|_| "noreply@discreetai.net".to_string());

            let html = format!("<p>{}</p>", body.replace('\n', "<br>"));

            let payload = serde_json::json!({
                "from":    from,
                "to":      to,
                "subject": subject,
                "html":    html,
            });

            match reqwest::Client::new()
                .post("https://api.resend.com/emails")
                .header("Authorization", format!("Bearer {api_key}"))
                .json(&payload)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    tracing::info!(to = to, subject = subject, "Email sent via Resend");
                    return true;
                }
                Ok(resp) => {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    tracing::error!(
                        to = to,
                        status = %status,
                        body = %body,
                        "Resend API error"
                    );
                    return false;
                }
                Err(e) => {
                    tracing::error!(to = to, error = %e, "Resend API request failed");
                    return false;
                }
            }
        }
    }

    // ── No provider configured — dev mode ─────────────────────────────
    tracing::info!(
        "Email provider not configured — email to {} would have subject: {}",
        to,
        subject
    );
    false
}

// ─── 6-digit verification code helpers ──────────────────────────────────

/// Generate a cryptographically random 6-digit code (100000–999999).
pub fn generate_verification_code() -> String {
    use rand::Rng;
    let code: u32 = rand::thread_rng().gen_range(100_000..1_000_000);
    code.to_string()
}

/// Send a 6-digit verification code email (not a clickable link).
/// Codes resist email-forwarding phishing because there's nothing to click.
pub async fn send_verification_code_email(state: &AppState, to: &str, code: &str) -> bool {
    send_email(
        state,
        to,
        "Your Discreet verification code",
        &format!(
            "Your verification code is:\n\n\
             {}\n\n\
             Enter this code in the Discreet app to verify your email.\n\
             This code expires in 10 minutes.\n\n\
             If you did not create a Discreet account, you can safely ignore this email.",
            code
        ),
    )
    .await
}

/// Send a lockout alert when an account hits 20 failed login attempts.
pub async fn send_lockout_alert_email(state: &AppState, to: &str, ip: &str, login: &str) -> bool {
    send_email(
        state,
        to,
        "Security Alert: Your Discreet account has been locked",
        &format!(
            "Your Discreet account ({login}) has been temporarily locked for 24 hours \
             due to 20 failed login attempts from IP address {ip}.\n\n\
             If this was you, wait 24 hours and try again. If you forgot your password, \
             use your recovery key to reset it.\n\n\
             If this was NOT you, someone may be trying to access your account. \
             Your password was NOT compromised — the lockout prevented further attempts. \
             Consider changing your password after the lockout expires.\n\n\
             — Discreet Security"
        ),
    )
    .await
}
