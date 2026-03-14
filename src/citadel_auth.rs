// citadel_auth.rs — Authentication middleware and JWT validation.
//
// Provides the AuthUser extractor that every protected handler uses.
// Extracts and validates JWT from the Authorization header, then loads
// current user state from Redis cache (30s TTL) or database.
//
// AuthUser includes live account_tier, email_verified, is_banned, etc.
// so that permission changes take effect within 30 seconds without re-login.

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::citadel_error::AppError;
use crate::citadel_state::AppState;

// sqlx and redis are used for session revocation checks in the AuthUser extractor.

/// JWT claims embedded in every access token.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// User ID (UUID).
    pub sub: Uuid,
    /// Expiration timestamp (Unix epoch seconds).
    pub exp: u64,
    /// Issued-at timestamp.
    pub iat: u64,
    /// Session ID (for revocation).
    pub sid: Uuid,
}

/// Cached user state loaded on every authenticated request.
/// Stored in Redis with 30-second TTL keyed by `auth_user:{user_id}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedUserState {
    pub account_tier: String,
    pub email_verified: bool,
    pub phone_verified: bool,
    pub platform_role: Option<String>,
    pub is_banned: bool,
    pub is_guest: bool,
}

const USER_STATE_TTL: u64 = 5;

/// Authenticated user, extracted from a valid JWT.
/// Use as a handler parameter: `async fn handler(auth: AuthUser, ...)`
///
/// Fields beyond user_id/session_id are loaded from DB/Redis cache
/// on every request so that tier upgrades, bans, and verification
/// take effect within 30 seconds.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub account_tier: String,
    pub email_verified: bool,
    pub phone_verified: bool,
    pub platform_role: Option<String>,
    pub is_banned: bool,
    pub is_guest: bool,
}

/// Load user state from Redis cache or database.
/// Caches for 30 seconds so permission changes propagate quickly
/// without a DB hit on every request.
pub async fn load_user_state(
    state: &AppState,
    user_id: Uuid,
) -> Result<CachedUserState, AppError> {
    let cache_key = format!("auth_user:{}", user_id);
    let mut redis_conn = state.redis.clone();

    // 1. Try Redis cache.
    let cached: Option<String> = redis::cmd("GET")
        .arg(&cache_key)
        .query_async(&mut redis_conn)
        .await
        .unwrap_or(None);

    if let Some(json_str) = cached {
        if let Ok(us) = serde_json::from_str::<CachedUserState>(&json_str) {
            return Ok(us);
        }
    }

    // 2. Load from DB.
    let row = sqlx::query!(
        "SELECT account_tier, email_verified, phone_verified, platform_role, is_banned, is_guest
         FROM users WHERE id = $1",
        user_id,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(format!("User state load failed: {e}")))?
    .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

    let us = CachedUserState {
        account_tier: row.account_tier,
        email_verified: row.email_verified,
        phone_verified: row.phone_verified,
        platform_role: row.platform_role,
        is_banned: row.is_banned,
        is_guest: row.is_guest,
    };

    // 3. Cache in Redis with TTL.
    if let Ok(json_str) = serde_json::to_string(&us) {
        let _: Result<(), _> = redis::cmd("SET")
            .arg(&cache_key)
            .arg(&json_str)
            .arg("EX")
            .arg(USER_STATE_TTL)
            .query_async(&mut redis_conn)
            .await;
    }

    Ok(us)
}

/// Invalidate the cached user state so the next request loads fresh data.
/// Call this after any mutation that changes tier, verification, or ban status.
pub async fn invalidate_user_cache(state: &AppState, user_id: Uuid) {
    let cache_key = format!("auth_user:{}", user_id);
    let mut redis_conn = state.redis.clone();
    let _: Result<(), _> = redis::cmd("DEL")
        .arg(&cache_key)
        .query_async(&mut redis_conn)
        .await;
}

#[async_trait]
impl FromRequestParts<std::sync::Arc<AppState>> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &std::sync::Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".into()))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format".into()))?;

        let key = DecodingKey::from_secret(state.config.jwt_secret.as_bytes());
        let validation = Validation::default();

        let token_data = decode::<Claims>(token, &key, &validation)
            .map_err(|e| AppError::Unauthorized(format!("Invalid token: {e}")))?;

        // ── Fast-path: Redis revocation check ──────────────────────────────
        // After a password change, all old session IDs are written to the
        // Redis SET "revoked_sessions:{user_id}" with a 24-hour TTL.
        // Check here first to reject them immediately without a DB round-trip.
        {
            let revoked_key = format!("revoked_sessions:{}", token_data.claims.sub);
            let sid_str = token_data.claims.sid.to_string();
            let mut redis_conn = state.redis.clone();

            let is_revoked: i32 = redis::cmd("SISMEMBER")
                .arg(&revoked_key)
                .arg(&sid_str)
                .query_async::<_, Option<i32>>(&mut redis_conn)
                .await
                .unwrap_or(None)
                .unwrap_or(0);

            if is_revoked == 1 {
                return Err(AppError::Unauthorized(
                    "Session revoked — please log in again".into(),
                ));
            }
        }

        // Check session revocation — if user logged out, this session is dead.
        let session_valid = sqlx::query_scalar!(
            "SELECT EXISTS(
                SELECT 1 FROM sessions
                WHERE id = $1 AND user_id = $2
                  AND revoked_at IS NULL
                  AND expires_at > NOW()
            )",
            token_data.claims.sid,
            token_data.claims.sub,
        )
        .fetch_one(&state.db)
        .await
        .map_err(|e| AppError::Internal(format!("Session check failed: {e}")))?;

        if !session_valid.unwrap_or(false) {
            return Err(AppError::Unauthorized("Session expired or revoked".into()));
        }

        // ── Update last_active_at (throttled: at most once per 60s) ────────
        {
            let throttle_key = format!("session_active:{}", token_data.claims.sid);
            let mut rc = state.redis.clone();
            let already: bool = redis::cmd("GET")
                .arg(&throttle_key)
                .query_async::<_, Option<String>>(&mut rc)
                .await
                .unwrap_or(None)
                .is_some();
            if !already {
                // Set throttle flag (60s TTL) and fire-and-forget DB update.
                let _: Result<(), _> = redis::cmd("SET")
                    .arg(&throttle_key)
                    .arg("1")
                    .arg("EX")
                    .arg(60_u64)
                    .query_async(&mut rc)
                    .await;
                let db = state.db.clone();
                let sid = token_data.claims.sid;
                tokio::spawn(async move {
                    let _ = sqlx::query!(
                        "UPDATE sessions SET last_active_at = NOW() WHERE id = $1",
                        sid,
                    )
                    .execute(&db)
                    .await;
                });
            }
        }

        // ── Load live user state (cached 30s in Redis) ─────────────────────
        let user_state = load_user_state(state, token_data.claims.sub).await?;

        // Reject banned users immediately.
        if user_state.is_banned {
            return Err(AppError::Unauthorized("Account is banned".into()));
        }

        Ok(AuthUser {
            user_id: token_data.claims.sub,
            session_id: token_data.claims.sid,
            account_tier: user_state.account_tier,
            email_verified: user_state.email_verified,
            phone_verified: user_state.phone_verified,
            platform_role: user_state.platform_role,
            is_banned: user_state.is_banned,
            is_guest: user_state.is_guest,
        })
    }
}
