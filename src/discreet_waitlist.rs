// discreet_waitlist.rs — Waitlist signup endpoint.
//
// Endpoints:
//   POST /api/v1/waitlist  — Add email to launch waitlist (no auth required)
//
// On successful signup, sends a branded confirmation email with the
// user's position, total count, and a unique referral link.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::discreet_email_handlers::{build_branded_email, send_html_email};
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

#[derive(Debug, Deserialize)]
pub struct WaitlistRequest {
    pub email: String,
}

/// Generate a short alphanumeric referral code (8 characters).
fn generate_referral_code() -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..8).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

pub async fn join_waitlist(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WaitlistRequest>,
) -> Result<impl IntoResponse, AppError> {
    let email = req.email.trim().to_lowercase();

    // Basic email validation: must contain @ and a dot after @
    let at_pos = email.find('@');
    let valid = match at_pos {
        Some(pos) => pos > 0 && email[pos + 1..].contains('.'),
        None => false,
    };
    if !valid {
        return Err(AppError::BadRequest("Invalid email address".into()));
    }

    // Check if already registered
    let exists = sqlx::query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM waitlist WHERE email = $1)",
        email,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(false);

    if exists {
        return Ok((StatusCode::OK, Json(serde_json::json!({ "status": "already_registered" }))));
    }

    // Insert with referral code
    let code = generate_referral_code();
    sqlx::query!(
        "INSERT INTO waitlist (email, referral_code) VALUES ($1, $2)",
        email,
        code,
    )
    .execute(&state.db)
    .await?;

    // Query position and total for the confirmation email
    let position: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM waitlist WHERE created_at <= (SELECT created_at FROM waitlist WHERE email = $1)",
        email,
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(1);

    let total: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM waitlist",
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(1);

    // Send branded confirmation email
    let referral_link = format!("https://discreetai.net/?ref={}", code);
    let body = format!(
        r#"<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 20px 0;">Your position: <strong>{position}</strong> of <strong>{total}</strong></p>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 8px 0;">Your referral link:</p>
<div style="background:#1a2030;padding:12px;border-radius:8px;margin:0 0 20px 0;">
<span style="font-family:'Courier New',Courier,monospace;font-size:13px;color:#00D4AA;word-break:break-all;">{referral_link}</span>
</div>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px 0;">Share this link with friends. Each friend who joins moves you up 1 spot.</p>
<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0;">We will notify you when your spot opens.</p>"#,
        position = position,
        total = total,
        referral_link = referral_link,
    );
    let html = build_branded_email("Welcome to the Discreet Waitlist", &body);
    send_html_email(&state, &email, "You're on the Discreet waitlist!", &html).await;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "status": "ok",
        "position": position,
        "total": total,
        "referral_code": code,
    }))))
}
