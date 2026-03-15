// discreet_billing_handlers.rs — Billing checkout and payment webhooks.
//
// Endpoints:
//   POST /api/v1/billing/create-checkout    — Create a checkout session (Stripe or BTCPay)
//   POST /api/v1/webhooks/btcpay            — BTCPay Server payment webhook
//   POST /api/v1/webhooks/stripe            — Stripe payment webhook
//
// All webhook handlers verify signatures and log to audit.
// No secrets in code — all loaded from environment variables.

use axum::{extract::{State, Json}, http::HeaderMap, response::IntoResponse};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;
use crate::{citadel_auth::AuthUser, citadel_error::AppError, citadel_state::AppState};

// ─── Status ─────────────────────────────────────────────────────────────

/// GET /billing/status — current user's billing status.
pub async fn billing_status(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let self_hosted = std::env::var("SELF_HOSTED")
        .unwrap_or_default()
        .eq_ignore_ascii_case("true");

    if self_hosted {
        return Ok(Json(serde_json::json!({
            "self_hosted": true,
            "tier": "enterprise",
            "expires_at": null,
            "payment_method": null,
            "cancel_at_period_end": false,
        })));
    }

    let user_tier = sqlx::query_scalar!(
        "SELECT account_tier FROM users WHERE id = $1",
        auth.user_id,
    )
    .fetch_one(&state.db)
    .await?;

    let sub = sqlx::query!(
        "SELECT tier, status, payment_provider, current_period_end, cancel_at_period_end
         FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(match sub {
        Some(s) => serde_json::json!({
            "self_hosted": false,
            "tier": s.tier,
            "status": s.status,
            "expires_at": s.current_period_end.map(|t| t.to_rfc3339()),
            "payment_method": s.payment_provider,
            "cancel_at_period_end": s.cancel_at_period_end,
        }),
        None => serde_json::json!({
            "self_hosted": false,
            "tier": user_tier,
            "status": "free",
            "expires_at": null,
            "payment_method": null,
            "cancel_at_period_end": false,
        }),
    }))
}

// ─── Checkout ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateCheckoutRequest {
    /// Target tier: "pro", "teams", or "enterprise"
    pub tier: String,
    /// Payment method: "stripe" or "crypto"
    pub payment_method: String,
}

/// POST /billing/create-checkout — create a payment session.
pub async fn create_checkout(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateCheckoutRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !matches!(req.tier.as_str(), "pro" | "teams" | "enterprise") {
        return Err(AppError::BadRequest("Tier must be 'pro', 'teams', or 'enterprise'".into()));
    }
    if !matches!(req.payment_method.as_str(), "stripe" | "crypto") {
        return Err(AppError::BadRequest("Payment method must be 'stripe' or 'crypto'".into()));
    }

    let price_usd = match req.tier.as_str() {
        "pro"        => 9_99,   // $9.99/mo
        "teams"      => 24_99,  // $24.99/mo
        "enterprise" => 99_99,  // $99.99/mo
        _            => return Err(AppError::BadRequest("Invalid tier".into())),
    };

    match req.payment_method.as_str() {
        "crypto" => create_btcpay_checkout(&state, auth.user_id, &req.tier, price_usd).await,
        "stripe" => create_stripe_checkout(&state, auth.user_id, &req.tier, price_usd).await,
        _ => unreachable!(),
    }
}

// ─── BTCPay Checkout ────────────────────────────────────────────────────

async fn create_btcpay_checkout(
    state: &AppState,
    user_id: Uuid,
    tier: &str,
    price_cents: u64,
) -> Result<Json<serde_json::Value>, AppError> {
    let btcpay_url = std::env::var("BTCPAY_URL")
        .map_err(|_| AppError::NotConfigured("BTCPAY_URL not configured".into()))?;
    let store_id = std::env::var("BTCPAY_STORE_ID")
        .map_err(|_| AppError::NotConfigured("BTCPAY_STORE_ID not configured".into()))?;
    let api_key = std::env::var("BTCPAY_API_KEY")
        .map_err(|_| AppError::NotConfigured("BTCPAY_API_KEY not configured".into()))?;

    let client = reqwest::Client::new();
    let invoice_url = format!("{}/api/v1/stores/{}/invoices", btcpay_url.trim_end_matches('/'), store_id);

    let body = serde_json::json!({
        "amount": format!("{:.2}", price_cents as f64 / 100.0),
        "currency": "USD",
        "metadata": {
            "user_id": user_id.to_string(),
            "tier": tier,
        },
        "checkout": {
            "redirectURL": format!("{}/app?billing=success", std::env::var("APP_URL").unwrap_or_default()),
        },
    });

    let resp = client
        .post(&invoice_url)
        .header("Authorization", format!("token {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("BTCPay request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(status = %status, body = %body, "BTCPay invoice creation failed");
        return Err(AppError::Internal("Failed to create crypto checkout".into()));
    }

    let data: serde_json::Value = resp.json().await
        .map_err(|e| AppError::Internal(format!("BTCPay response parse error: {e}")))?;

    let checkout_url = data.get("checkoutLink")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Audit log
    let _ = sqlx::query!(
        "INSERT INTO audit_log (server_id, actor_id, action, changes)
         VALUES ('00000000-0000-0000-0000-000000000000'::uuid, $1, 'BILLING_CHECKOUT', $2)",
        user_id,
        serde_json::json!({ "tier": tier, "method": "crypto", "provider": "btcpay" }),
    )
    .execute(&state.db)
    .await;

    Ok(Json(serde_json::json!({
        "checkout_url": checkout_url,
        "provider": "btcpay",
        "tier": tier,
    })))
}

// ─── Stripe Checkout ────────────────────────────────────────────────────

async fn create_stripe_checkout(
    state: &AppState,
    user_id: Uuid,
    tier: &str,
    _price_cents: u64,
) -> Result<Json<serde_json::Value>, AppError> {
    let stripe_key = std::env::var("STRIPE_SECRET_KEY")
        .map_err(|_| AppError::NotConfigured("STRIPE_SECRET_KEY not configured".into()))?;

    let price_id = match tier {
        "pro"        => std::env::var("STRIPE_PRICE_PRO").unwrap_or_default(),
        "teams"      => std::env::var("STRIPE_PRICE_TEAMS").unwrap_or_default(),
        "enterprise" => std::env::var("STRIPE_PRICE_ENTERPRISE").unwrap_or_default(),
        _            => return Err(AppError::BadRequest("Invalid tier".into())),
    };

    if price_id.is_empty() {
        return Err(AppError::NotConfigured(format!("Stripe price ID not configured for {} tier", tier)));
    }

    let app_url = std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".into());

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.stripe.com/v1/checkout/sessions")
        .header("Authorization", format!("Bearer {}", stripe_key))
        .form(&[
            ("mode", "subscription"),
            ("line_items[0][price]", &price_id),
            ("line_items[0][quantity]", "1"),
            ("success_url", &format!("{}/app?billing=success", app_url)),
            ("cancel_url", &format!("{}/app?billing=cancel", app_url)),
            ("client_reference_id", &user_id.to_string()),
            ("metadata[user_id]", &user_id.to_string()),
            ("metadata[tier]", tier),
        ])
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Stripe request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!(status = %status, body = %body, "Stripe session creation failed");
        return Err(AppError::Internal("Failed to create Stripe checkout".into()));
    }

    let data: serde_json::Value = resp.json().await
        .map_err(|e| AppError::Internal(format!("Stripe response parse error: {e}")))?;

    let session_url = data.get("url").and_then(|v| v.as_str()).unwrap_or("");

    // Audit log
    let _ = sqlx::query!(
        "INSERT INTO audit_log (server_id, actor_id, action, changes)
         VALUES ('00000000-0000-0000-0000-000000000000'::uuid, $1, 'BILLING_CHECKOUT', $2)",
        user_id,
        serde_json::json!({ "tier": tier, "method": "stripe", "provider": "stripe" }),
    )
    .execute(&state.db)
    .await;

    Ok(Json(serde_json::json!({
        "checkout_url": session_url,
        "provider": "stripe",
        "tier": tier,
    })))
}

// ─── BTCPay Webhook ─────────────────────────────────────────────────────

/// POST /webhooks/btcpay — called by BTCPay Server when an invoice is paid.
/// Verifies HMAC-SHA256 signature using BTCPAY_WEBHOOK_SECRET.
pub async fn btcpay_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, AppError> {
    let secret = std::env::var("BTCPAY_WEBHOOK_SECRET")
        .map_err(|_| AppError::NotConfigured("BTCPAY_WEBHOOK_SECRET not set".into()))?;

    // Verify HMAC signature
    let sig_header = headers
        .get("btcpay-sig")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let expected_sig = {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
            .map_err(|_| AppError::Internal("HMAC key error".into()))?;
        mac.update(&body);
        let result = mac.finalize();
        format!("sha256={}", hex::encode(result.into_bytes()))
    };

    if !constant_time_eq(sig_header.as_bytes(), expected_sig.as_bytes()) {
        tracing::warn!("BTCPay webhook signature mismatch");
        return Err(AppError::Unauthorized("Invalid webhook signature".into()));
    }

    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {e}")))?;

    let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if event_type == "InvoiceSettled" || event_type == "InvoiceProcessing" {
        let metadata = payload.get("metadata").cloned().unwrap_or_default();
        let user_id_str = metadata.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
        let tier = metadata.get("tier").and_then(|v| v.as_str()).unwrap_or("pro");

        if let Ok(user_id) = user_id_str.parse::<Uuid>() {
            activate_subscription(&state.db, user_id, tier, "btcpay").await?;

            tracing::info!(
                user_id = %user_id,
                tier = %tier,
                event = %event_type,
                "BTCPay payment confirmed — subscription activated"
            );
        }
    }

    Ok(axum::http::StatusCode::OK)
}

// ─── Stripe Webhook ─────────────────────────────────────────────────────

/// POST /webhooks/stripe — called by Stripe for subscription events.
/// Verifies Stripe-Signature header.
pub async fn stripe_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, AppError> {
    let secret = std::env::var("STRIPE_WEBHOOK_SECRET")
        .map_err(|_| AppError::NotConfigured("STRIPE_WEBHOOK_SECRET not set".into()))?;

    // Stripe signature verification: t=timestamp,v1=signature
    let sig_header = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let mut timestamp = "";
    let mut signature = "";
    for part in sig_header.split(',') {
        let part = part.trim();
        if let Some(t) = part.strip_prefix("t=") { timestamp = t; }
        if let Some(s) = part.strip_prefix("v1=") { signature = s; }
    }

    let signed_payload = format!("{}.{}", timestamp, std::str::from_utf8(&body).unwrap_or(""));
    let expected_sig = {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        type HmacSha256 = Hmac<Sha256>;
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
            .map_err(|_| AppError::Internal("HMAC key error".into()))?;
        mac.update(signed_payload.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    };

    if !constant_time_eq(signature.as_bytes(), expected_sig.as_bytes()) {
        tracing::warn!("Stripe webhook signature mismatch");
        return Err(AppError::Unauthorized("Invalid webhook signature".into()));
    }

    let payload: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {e}")))?;

    let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if event_type == "checkout.session.completed" {
        let session = payload.get("data").and_then(|d| d.get("object")).cloned().unwrap_or_default();
        let user_id_str = session.get("client_reference_id").and_then(|v| v.as_str())
            .or_else(|| session.get("metadata").and_then(|m| m.get("user_id")).and_then(|v| v.as_str()))
            .unwrap_or("");
        let tier = session.get("metadata").and_then(|m| m.get("tier")).and_then(|v| v.as_str()).unwrap_or("pro");

        if let Ok(user_id) = user_id_str.parse::<Uuid>() {
            activate_subscription(&state.db, user_id, tier, "stripe").await?;

            tracing::info!(
                user_id = %user_id,
                tier = %tier,
                "Stripe checkout completed — subscription activated"
            );
        }
    }

    if event_type == "customer.subscription.deleted" {
        let sub = payload.get("data").and_then(|d| d.get("object")).cloned().unwrap_or_default();
        let user_id_str = sub.get("metadata").and_then(|m| m.get("user_id")).and_then(|v| v.as_str()).unwrap_or("");

        if let Ok(user_id) = user_id_str.parse::<Uuid>() {
            sqlx::query!(
                "UPDATE users SET account_tier = 'verified' WHERE id = $1",
                user_id,
            )
            .execute(&state.db)
            .await?;

            sqlx::query!(
                "UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1",
                user_id,
            )
            .execute(&state.db)
            .await?;

            tracing::info!(user_id = %user_id, "Stripe subscription cancelled — downgraded to verified");
        }
    }

    Ok(axum::http::StatusCode::OK)
}

// ─── Shared helpers ─────────────────────────────────────────────────────

/// Activate or update a subscription and upgrade the user's account tier.
async fn activate_subscription(
    db: &sqlx::PgPool,
    user_id: Uuid,
    tier: &str,
    provider: &str,
) -> Result<(), AppError> {
    // Upsert subscription
    sqlx::query!(
        "INSERT INTO subscriptions (user_id, tier, status, payment_provider, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', $3, NOW(), NOW() + INTERVAL '30 days')
         ON CONFLICT (user_id) DO UPDATE SET
             tier = $2,
             status = 'active',
             payment_provider = $3,
             current_period_start = NOW(),
             current_period_end = NOW() + INTERVAL '30 days'",
        user_id,
        tier,
        provider,
    )
    .execute(db)
    .await?;

    // Upgrade account tier
    sqlx::query!(
        "UPDATE users SET account_tier = $1 WHERE id = $2",
        tier,
        user_id,
    )
    .execute(db)
    .await?;

    // Audit log
    let _ = sqlx::query!(
        "INSERT INTO audit_log (server_id, actor_id, action, changes)
         VALUES ('00000000-0000-0000-0000-000000000000'::uuid, $1, 'SUBSCRIPTION_ACTIVATED', $2)",
        user_id,
        serde_json::json!({ "tier": tier, "provider": provider }),
    )
    .execute(db)
    .await;

    Ok(())
}

/// Constant-time comparison to prevent timing attacks on signatures.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
