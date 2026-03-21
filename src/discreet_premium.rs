// discreet_premium.rs — Premium gate helpers and subscription endpoints.
//
// Provides:
//   require_tier(auth, needed)    — returns PremiumRequired if the user's
//                                   tier is below `needed`.
//   GET  /api/v1/subscription     — current user's subscription status
//   POST /api/v1/subscription     — placeholder for webhook / manual upgrade
//   DELETE /api/v1/subscription   — cancel (marks cancel_at_period_end)
//
// The actual payment flow will be wired when a payment processor (Stripe,
// Paddle, etc.) is chosen.  Until then, admins can manually set tiers
// via POST /subscription with { "tier": "pro" }.

use axum::{
    extract::State,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::discreet_auth::{invalidate_user_cache, AuthUser};
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ── Tier ordering (matches frontend tiers.ts) ─────────────────────────────

const TIER_ORDER: &[&str] = &["guest", "unverified", "anonymous", "verified", "pro", "team", "admin"];

fn tier_rank(t: &str) -> usize {
    TIER_ORDER.iter().position(|&x| x == t).unwrap_or(0)
}

/// Check whether `auth` has at least the `needed` tier.
/// Returns `Ok(())` if the user qualifies, or `Err(AppError::PremiumRequired)`
/// with the needed tier name so the client can show the upgrade nudge.
pub fn require_tier(auth: &AuthUser, needed: &str) -> Result<(), AppError> {
    if tier_rank(&auth.account_tier) >= tier_rank(needed) {
        Ok(())
    } else {
        Err(AppError::PremiumRequired {
            current: auth.account_tier.clone(),
            needed: needed.to_string(),
        })
    }
}

/// Require at least `verified` OR `anonymous` (seed-phrase accounts have
/// full access without email verification).
pub fn require_verified(auth: &AuthUser) -> Result<(), AppError> {
    if auth.account_tier == "anonymous" {
        return Ok(()); // Anonymous users have full access
    }
    require_tier(auth, "verified")
}

/// Convenience: require at least `pro`.
pub fn require_pro(auth: &AuthUser) -> Result<(), AppError> {
    require_tier(auth, "pro")
}

/// GET /api/v1/subscription — current user's subscription.
pub async fn get_subscription(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let row = sqlx::query!(
        "SELECT tier, status, payment_provider, current_period_end, cancel_at_period_end
         FROM subscriptions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1",
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?;

    match row {
        Some(r) => Ok(Json(serde_json::json!({
            "subscription": {
                "tier": r.tier,
                "status": r.status,
                "payment_provider": r.payment_provider,
                "current_period_end": r.current_period_end.map(|t| t.to_rfc3339()),
                "cancel_at_period_end": r.cancel_at_period_end,
            }
        }))),
        None => Ok(Json(serde_json::json!({
            "subscription": null
        }))),
    }
}

// ── Manual / webhook upgrade ──────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateSubscriptionRequest {
    pub tier: String,
    /// Optional: payment provider ref (set by webhook).
    pub provider: Option<String>,
    pub provider_customer_id: Option<String>,
    pub provider_subscription_id: Option<String>,
}

/// POST /api/v1/subscription — create or update subscription.
///
/// For now this is admin-only (platform_role = admin | dev).
/// When a payment processor is wired, webhooks will call this internally.
pub async fn create_subscription(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateSubscriptionRequest>,
) -> Result<impl IntoResponse, AppError> {
    // Gate: only admins can manually set tiers until payment is wired.
    let role = auth.platform_role.as_deref().unwrap_or("");
    if role != "admin" && role != "dev" {
        return Err(AppError::Forbidden(
            "Manual tier changes require admin privileges. Payment integration coming soon.".into(),
        ));
    }

    let valid_tiers = ["pro", "teams", "enterprise"];
    if !valid_tiers.contains(&req.tier.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid tier '{}'. Must be one of: pro, teams, enterprise",
            req.tier
        )));
    }

    // Upsert subscription row.
    let sub = sqlx::query!(
        "INSERT INTO subscriptions (user_id, tier, status, payment_provider, provider_customer_id, provider_subscription_id)
         VALUES ($1, $2, 'active', $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
            tier = EXCLUDED.tier,
            status = 'active',
            payment_provider = EXCLUDED.payment_provider,
            provider_customer_id = EXCLUDED.provider_customer_id,
            provider_subscription_id = EXCLUDED.provider_subscription_id,
            cancel_at_period_end = FALSE,
            updated_at = NOW()
         RETURNING tier, status",
        auth.user_id,
        req.tier,
        req.provider,
        req.provider_customer_id,
        req.provider_subscription_id,
    )
    .fetch_one(&state.db)
    .await?;

    // Promote user's account_tier and badge.
    sqlx::query!(
        "UPDATE users SET account_tier = $1, badge_type = 'gem', updated_at = NOW() WHERE id = $2",
        req.tier,
        auth.user_id,
    )
    .execute(&state.db)
    .await?;

    // Bust auth cache so the new tier takes effect immediately.
    invalidate_user_cache(&state, auth.user_id).await;

    Ok(Json(serde_json::json!({
        "subscription": {
            "tier": sub.tier,
            "status": sub.status,
        },
        "message": format!("Upgraded to {}", req.tier),
    })))
}

/// DELETE /api/v1/subscription — cancel subscription (end-of-period).
pub async fn cancel_subscription(
    auth: AuthUser,
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let updated = sqlx::query!(
        "UPDATE subscriptions
         SET cancel_at_period_end = TRUE, updated_at = NOW()
         WHERE user_id = $1 AND status = 'active'
         RETURNING tier",
        auth.user_id,
    )
    .fetch_optional(&state.db)
    .await?;

    match updated {
        Some(r) => Ok(Json(serde_json::json!({
            "message": format!("Your {} plan will end at the current billing period", r.tier),
            "cancel_at_period_end": true,
        }))),
        None => Err(AppError::NotFound("No active subscription found".into())),
    }
}
