// discreet_platform_permissions.rs — Platform-level role and permission system.
//
// TWO SEPARATE PERMISSION LAYERS exist in this application:
//   Layer 1 (this file): Platform-level — who you are on the platform
//   Layer 2 (discreet_permissions.rs): Server-level — what you can do in a community
//
// PlatformRole maps to both the users.account_tier and users.platform_role columns.
// account_tier   — the tier every user has (Guest → Unverified → Verified → Premium)
// platform_role  — internal staff designation, NULL for ordinary users (Dev, Admin)
//
// check_platform_permission queries platform_role_permissions + platform_permissions
// to decide if a role has a named permission (e.g. "ACCESS_ADMIN_DASHBOARD").
//
// PlatformUser is a richer Axum extractor than AuthUser: it validates the JWT and
// session (by delegating to AuthUser), then loads account_tier, platform_role,
// badge_type, and email_verified from the users table in a single extra query.

use std::fmt;
use std::str::FromStr;
use std::sync::Arc;

use axum::{extract::FromRequestParts, http::request::Parts};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::discreet_auth::AuthUser;
use crate::discreet_error::AppError;
use crate::discreet_state::AppState;

// ─── PlatformRole ────────────────────────────────────────────────────────────

/// All platform tiers and staff roles, ordered from lowest to highest privilege.
/// Used for both `users.account_tier` and `users.platform_role`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlatformRole {
    Guest,
    Unverified,
    Verified,
    Premium,
    Dev,
    Admin,
}

impl PlatformRole {
    /// Returns true if this role is at least as privileged as `other`.
    pub fn at_least(self, other: PlatformRole) -> bool {
        self >= other
    }
}

impl fmt::Display for PlatformRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            PlatformRole::Admin     => "admin",
            PlatformRole::Dev       => "dev",
            PlatformRole::Premium   => "premium",
            PlatformRole::Verified  => "verified",
            PlatformRole::Unverified => "unverified",
            PlatformRole::Guest     => "guest",
        };
        f.write_str(s)
    }
}

impl FromStr for PlatformRole {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "admin"      => Ok(PlatformRole::Admin),
            "dev"        => Ok(PlatformRole::Dev),
            "premium"    => Ok(PlatformRole::Premium),
            "verified"   => Ok(PlatformRole::Verified),
            "unverified" => Ok(PlatformRole::Unverified),
            "guest"      => Ok(PlatformRole::Guest),
            _            => Err(()),
        }
    }
}

// ─── Permission check ────────────────────────────────────────────────────────

/// Returns `true` if the user's `platform_role` grants `permission_name`.
///
/// Returns `false` when:
///   - the user has no platform_role (NULL — ordinary users)
///   - the named permission does not exist
///   - the role does not have that permission
///   - any database error occurs (logged at error level)
///
/// Permission names match the `platform_permissions.name` column
/// (e.g. "ACCESS_ADMIN_DASHBOARD", "BYPASS_RATE_LIMITS").
pub async fn check_platform_permission(
    pool: &PgPool,
    user_id: Uuid,
    permission_name: &str,
) -> bool {
    let result = sqlx::query_scalar!(
        r#"SELECT EXISTS(
            SELECT 1
            FROM users u
            JOIN platform_role_permissions prp ON prp.role_name = u.platform_role
            JOIN platform_permissions pp ON pp.id = prp.permission_id
            WHERE u.id = $1
              AND pp.name = $2
              AND u.platform_role IS NOT NULL
        ) AS "has_permission!""#,
        user_id,
        permission_name,
    )
    .fetch_one(pool)
    .await;

    match result {
        Ok(has) => has,
        Err(e) => {
            tracing::error!(
                user_id = %user_id,
                permission = %permission_name,
                "check_platform_permission query failed: {e}"
            );
            false
        }
    }
}

// ─── PlatformUser extractor ──────────────────────────────────────────────────

/// An authenticated user with full platform profile loaded.
///
/// Validates the JWT and session exactly like `AuthUser`, then fetches
/// `account_tier`, `platform_role`, `badge_type`, and `email_verified`
/// from the `users` table in a single query.
///
/// Use in place of `AuthUser` when a handler needs to gate on tier or role:
///
/// ```rust
/// async fn admin_handler(caller: PlatformUser, ...) -> Result<...> {
///     if caller.platform_role != Some(PlatformRole::Admin) {
///         return Err(AppError::Forbidden("Admins only".into()));
///     }
///     ...
/// }
/// ```
#[derive(Debug, Clone)]
pub struct PlatformUser {
    pub user_id:        Uuid,
    pub session_id:     Uuid,
    pub account_tier:   PlatformRole,
    pub platform_role:  Option<PlatformRole>,
    pub badge_type:     Option<String>,
    pub email_verified: bool,
}

impl PlatformUser {
    /// Convenience: check whether this user has a named platform permission
    /// without an extra DB round-trip if `platform_role` is already known to be NULL.
    pub async fn has_permission(&self, pool: &PgPool, permission_name: &str) -> bool {
        if self.platform_role.is_none() {
            return false;
        }
        check_platform_permission(pool, self.user_id, permission_name).await
    }
}

impl FromRequestParts<Arc<AppState>> for PlatformUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        // Delegate JWT decode + Redis revocation + session validity to AuthUser.
        let auth = AuthUser::from_request_parts(parts, state).await?;

        // Load the platform profile columns in one query.
        let row = sqlx::query!(
            r#"SELECT account_tier,
                      platform_role,
                      badge_type,
                      email_verified
               FROM users
               WHERE id = $1"#,
            auth.user_id,
        )
        .fetch_optional(&state.db)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to load user profile: {e}")))?
        .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

        let account_tier: PlatformRole = row.account_tier.parse().unwrap_or(PlatformRole::Guest);

        let platform_role = row
            .platform_role
            .as_deref()
            .and_then(|s| s.parse().ok());

        Ok(PlatformUser {
            user_id:        auth.user_id,
            session_id:     auth.session_id,
            account_tier,
            platform_role,
            badge_type:     row.badge_type,
            email_verified: row.email_verified,
        })
    }
}
