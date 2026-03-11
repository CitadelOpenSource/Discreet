// citadel_auth.rs — Authentication middleware and JWT validation.
//
// Provides the AuthUser extractor that every protected handler uses.
// Extracts and validates JWT from the Authorization header.

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

/// Authenticated user, extracted from a valid JWT.
/// Use as a handler parameter: `async fn handler(auth: AuthUser, ...)`
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub session_id: Uuid,
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

        Ok(AuthUser {
            user_id: token_data.claims.sub,
            session_id: token_data.claims.sid,
        })
    }
}
