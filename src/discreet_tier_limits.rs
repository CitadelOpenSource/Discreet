// discreet_tier_limits.rs — Backend tier limit enforcement.
//
// Each account tier has hard limits on resource creation.
// If SELF_HOSTED=true (env var), all limits are enterprise-tier.
// These checks are called from create_server, join_server, upload_file, and add_bot.

use uuid::Uuid;

/// Hard limits per account tier.
#[derive(Debug, Clone)]
pub struct TierLimits {
    pub max_servers: i64,
    pub max_members_per_server: i64,
    pub max_upload_mb: i64,
    pub max_agents: i64,
}

/// Resolve limits for a given tier string.
/// If SELF_HOSTED=true, always returns enterprise limits.
pub fn get_limits(tier: &str) -> TierLimits {
    if std::env::var("SELF_HOSTED").unwrap_or_default().eq_ignore_ascii_case("true") {
        return enterprise();
    }
    match tier {
        "pro" => TierLimits {
            max_servers: 20,
            max_members_per_server: 500,
            max_upload_mb: 100,
            max_agents: 5,
        },
        "enterprise" | "teams" => enterprise(),
        // free / guest / unverified / verified — all get free-tier limits
        _ => TierLimits {
            max_servers: 5,
            max_members_per_server: 50,
            max_upload_mb: 25,
            max_agents: 1,
        },
    }
}

fn enterprise() -> TierLimits {
    TierLimits {
        max_servers: 9999,
        max_members_per_server: 9999,
        max_upload_mb: 500,
        max_agents: 99,
    }
}

/// Error body returned when a tier limit is hit.
pub fn tier_limit_error(limit_name: &str, limit: i64, tier: &str) -> serde_json::Value {
    serde_json::json!({
        "code": "TIER_LIMIT",
        "message": format!("You have reached the {} limit for the {} tier", limit_name, tier),
        "limit": limit,
        "tier": tier,
    })
}

/// Check: can this user create another server?
pub async fn check_server_create(
    db: &sqlx::PgPool,
    user_id: Uuid,
    tier: &str,
) -> Result<(), crate::citadel_error::AppError> {
    let limits = get_limits(tier);
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM servers WHERE owner_id = $1"#,
        user_id,
    )
    .fetch_one(db)
    .await?;

    if count >= limits.max_servers {
        return Err(crate::citadel_error::AppError::TierLimit(
            tier_limit_error("server", limits.max_servers, tier),
        ));
    }
    Ok(())
}

/// Check: can this server accept another member?
pub async fn check_member_join(
    db: &sqlx::PgPool,
    server_id: Uuid,
    owner_tier: &str,
) -> Result<(), crate::citadel_error::AppError> {
    let limits = get_limits(owner_tier);
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM server_members WHERE server_id = $1"#,
        server_id,
    )
    .fetch_one(db)
    .await?;

    if count >= limits.max_members_per_server {
        return Err(crate::citadel_error::AppError::TierLimit(
            tier_limit_error("members per server", limits.max_members_per_server, owner_tier),
        ));
    }
    Ok(())
}

/// Check: is this upload within the tier's size limit?
pub fn check_upload_size(
    bytes: usize,
    tier: &str,
) -> Result<(), crate::citadel_error::AppError> {
    let limits = get_limits(tier);
    let max_bytes = limits.max_upload_mb as usize * 1024 * 1024;
    if bytes > max_bytes {
        return Err(crate::citadel_error::AppError::TierLimit(
            tier_limit_error("upload size MB", limits.max_upload_mb, tier),
        ));
    }
    Ok(())
}

/// Check: can this server have another agent/bot?
pub async fn check_agent_create(
    db: &sqlx::PgPool,
    server_id: Uuid,
    owner_tier: &str,
) -> Result<(), crate::citadel_error::AppError> {
    let limits = get_limits(owner_tier);
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM bot_configs WHERE server_id = $1"#,
        server_id,
    )
    .fetch_one(db)
    .await?;

    if count >= limits.max_agents {
        return Err(crate::citadel_error::AppError::TierLimit(
            tier_limit_error("agents per server", limits.max_agents, owner_tier),
        ));
    }
    Ok(())
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_free_tier_limits() {
        let limits = get_limits("verified");
        assert_eq!(limits.max_servers, 5);
        assert_eq!(limits.max_members_per_server, 50);
        assert_eq!(limits.max_upload_mb, 25);
        assert_eq!(limits.max_agents, 1);
    }

    #[test]
    fn test_pro_tier_limits() {
        let limits = get_limits("pro");
        assert_eq!(limits.max_servers, 20);
        assert_eq!(limits.max_members_per_server, 500);
        assert_eq!(limits.max_upload_mb, 100);
        assert_eq!(limits.max_agents, 5);
    }

    #[test]
    fn test_enterprise_tier_limits() {
        let limits = get_limits("enterprise");
        assert_eq!(limits.max_servers, 9999);
        assert_eq!(limits.max_members_per_server, 9999);
        assert_eq!(limits.max_upload_mb, 500);
        assert_eq!(limits.max_agents, 99);
    }
}
