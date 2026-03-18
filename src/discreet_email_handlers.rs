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
    let base_url = std::env::var("APP_URL")
        .or_else(|_| std::env::var("PUBLIC_URL"))
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
    let base_url = std::env::var("APP_URL")
        .or_else(|_| std::env::var("PUBLIC_URL"))
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
// send_html_email    — dispatches pre-built HTML via the Resend API.
// send_email         — wraps plain text in <p> tags, then delegates.
// branded_html_email — wraps inner content in the Discreet branded template.
//
// Priority:
//   1. RESEND_API_KEY set → POST to Resend HTTP API (https://api.resend.com/emails)
//   2. Neither configured  → log and return false (dev mode)

/// Wraps inner HTML content in the Discreet branded email template.
///
/// Provides: dark background (#0a0e17), centered card (#141922) with logo,
/// and a footer with support/dev contact links and copyright.
fn branded_html_email(inner: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0e17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e17;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#141922;border-radius:12px;">
<tr><td style="padding:32px;">
<div style="font-size:24px;font-weight:bold;color:#00D4AA;margin-bottom:24px;">Discreet</div>
{inner}
</td></tr>
</table>
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
<tr><td style="padding:24px 32px;text-align:center;">
<p style="font-size:12px;color:#64748b;line-height:1.6;margin:0 0 8px 0;">Need help? <a href="mailto:support@discreetai.net" style="color:#00D4AA;text-decoration:none;">support@discreetai.net</a> &#183; Report a bug: <a href="mailto:dev@discreetai.net" style="color:#00D4AA;text-decoration:none;">dev@discreetai.net</a></p>
<p style="font-size:12px;color:#64748b;margin:0;">&#169; 2026 Discreet</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"#,
        inner = inner,
    )
}

/// Sends a pre-built HTML email via the configured email provider.
async fn send_html_email(_state: &AppState, to: &str, subject: &str, html: &str) -> bool {
    if let Ok(api_key) = std::env::var("RESEND_API_KEY") {
        if !api_key.is_empty() {
            let from = std::env::var("SMTP_FROM")
                .unwrap_or_else(|_| "noreply@discreetai.net".to_string());

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

    tracing::info!(
        "Email provider not configured — email to {} would have subject: {}",
        to,
        subject
    );
    false
}

/// Sends a plain-text email by wrapping the body in basic HTML.
async fn send_email(state: &AppState, to: &str, subject: &str, body: &str) -> bool {
    let html = format!("<p>{}</p>", body.replace('\n', "<br>"));
    send_html_email(state, to, subject, &html).await
}

// ─── 6-digit verification code helpers ──────────────────────────────────

/// Generate a cryptographically random 6-digit code (100000–999999).
pub fn generate_verification_code() -> String {
    use rand::Rng;
    let code: u32 = rand::thread_rng().gen_range(100_000..1_000_000);
    code.to_string()
}

/// Send a branded HTML verification code email.
/// Codes resist email-forwarding phishing because there's nothing to click.
pub async fn send_verification_code_email(state: &AppState, to: &str, code: &str) -> bool {
    let inner = format!(
        r#"<h2 style="font-size:20px;font-weight:600;color:#e2e8f0;margin:0 0 20px 0;">Your verification code</h2>
<div style="text-align:center;padding:16px 0;margin:0 0 24px 0;background-color:#0a0e17;border-radius:8px;">
<span style="font-size:32px;font-weight:bold;font-family:'Courier New',Courier,monospace;color:#00D4AA;letter-spacing:8px;">{code}</span>
</div>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px 0;">This code expires in 10 minutes.</p>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0;">If you did not create this account, you can safely ignore this email.</p>"#,
        code = code,
    );
    let html = branded_html_email(&inner);
    send_html_email(state, to, "Your Discreet verification code", &html).await
}

/// Send a branded HTML lockout alert when an account hits 20 failed login attempts.
pub async fn send_lockout_alert_email(state: &AppState, to: &str, ip: &str, login: &str) -> bool {
    let login_esc = login.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let ip_esc = ip.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let inner = format!(
        r#"<h2 style="font-size:20px;font-weight:600;color:#e2e8f0;margin:0 0 20px 0;">Account locked</h2>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 16px 0;">Your Discreet account (<strong>{login}</strong>) has been temporarily locked for 24 hours due to 20 failed login attempts from IP address <strong style="font-family:'Courier New',Courier,monospace;">{ip}</strong>.</p>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 16px 0;">If this was you, wait 24 hours and try again. If you forgot your password, use your recovery key to reset it.</p>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0;">If this was <strong>not</strong> you, someone may be trying to access your account. Your password was not compromised &#8212; the lockout prevented further attempts. Consider changing your password after the lockout expires.</p>"#,
        login = login_esc,
        ip = ip_esc,
    );
    let html = branded_html_email(&inner);
    send_html_email(state, to, "Security Alert: Your Discreet account has been locked", &html).await
}
