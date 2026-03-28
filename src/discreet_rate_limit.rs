//! Rate Limiting — Redis-backed sliding window with per-endpoint granularity.
//!
//! Uses Redis INCR + EXPIRE for distributed rate limiting.
//! Key format: `rl:{endpoint}:{identifier}:{window_bucket}`
//!
//! Response on limit exceeded:
//!   HTTP 429 Too Many Requests
//!   Header: Retry-After: <seconds>
//!   Body: { "error": "rate_limited", "retry_after": <seconds> }
//!
//! The middleware runs BEFORE auth for unauthenticated endpoints.
//! For authenticated endpoints, handlers call `check_user_rate_limit()`.

use axum::{
    extract::{ConnectInfo, State},
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use crate::discreet_state::AppState;

// ─── Trusted proxy configuration ─────────────────────────────────────────────
// Only trust forwarded-IP headers (cf-connecting-ip, x-forwarded-for, x-real-ip)
// when the connecting socket IP matches a trusted proxy. Without this, any client
// can spoof their IP by sending a fake cf-connecting-ip header.
//
// Set TRUSTED_PROXY_IPS to a comma-separated list of IPs or CIDRs.
// Leave empty (default) to always use the socket address — safest default.
// For Cloudflare: set to their published IP ranges (https://www.cloudflare.com/ips/).

fn parse_trusted_proxies() -> Vec<(IpAddr, u8)> {
    let raw = std::env::var("TRUSTED_PROXY_IPS").unwrap_or_default();
    if raw.is_empty() { return Vec::new(); }
    raw.split(',')
        .filter_map(|entry| {
            let entry = entry.trim();
            if entry.is_empty() { return None; }
            if let Some((ip_str, prefix_str)) = entry.split_once('/') {
                let ip: IpAddr = ip_str.parse().ok()?;
                let prefix: u8 = prefix_str.parse().ok()?;
                Some((ip, prefix))
            } else {
                let ip: IpAddr = entry.parse().ok()?;
                let prefix = if ip.is_ipv4() { 32 } else { 128 };
                Some((ip, prefix))
            }
        })
        .collect()
}

fn ip_in_cidr(ip: &IpAddr, network: &IpAddr, prefix: u8) -> bool {
    match (ip, network) {
        (IpAddr::V4(ip4), IpAddr::V4(net4)) => {
            if prefix == 0 { return true; }
            if prefix > 32 { return false; }
            let mask = !0u32 << (32 - prefix);
            (u32::from(*ip4) & mask) == (u32::from(*net4) & mask)
        }
        (IpAddr::V6(ip6), IpAddr::V6(net6)) => {
            if prefix == 0 { return true; }
            if prefix > 128 { return false; }
            let ip_bits = u128::from(*ip6);
            let net_bits = u128::from(*net6);
            let mask = !0u128 << (128 - prefix);
            (ip_bits & mask) == (net_bits & mask)
        }
        _ => false,
    }
}

fn is_trusted_proxy(peer_ip: &IpAddr, trusted: &[(IpAddr, u8)]) -> bool {
    trusted.iter().any(|(net, prefix)| ip_in_cidr(peer_ip, net, *prefix))
}

static TRUSTED_PROXIES: std::sync::LazyLock<Vec<(IpAddr, u8)>> =
    std::sync::LazyLock::new(|| {
        let proxies = parse_trusted_proxies();
        if proxies.is_empty() {
            tracing::info!("TRUSTED_PROXY_IPS not set — using socket address for rate limiting (safe default)");
        } else {
            tracing::info!("TRUSTED_PROXY_IPS: {} CIDR entries loaded", proxies.len());
        }
        proxies
    });

// ─── Rate limit rules per path ──────────────────────────────────────────────

struct Rule {
    prefix: &'static str,     // path prefix to match
    limit: u32,               // max requests in window
    window_secs: u64,         // window duration in seconds
}

/// Per-IP rate limits for unauthenticated/public endpoints.
/// Matched in order — first match wins.
const IP_RULES: &[Rule] = &[
    // Auth endpoints (per IP)
    Rule { prefix: "/auth/register-anonymous", limit: 3,  window_secs: 3600 },
    Rule { prefix: "/auth/register",          limit: 5,  window_secs: 3600 },
    Rule { prefix: "/auth/login-anonymous",   limit: 5,  window_secs: 60 },
    Rule { prefix: "/auth/login",             limit: 10, window_secs: 60 },
    Rule { prefix: "/auth/forgot-password",   limit: 3,  window_secs: 3600 },
    Rule { prefix: "/auth/reset-password",    limit: 5,  window_secs: 3600 },
    Rule { prefix: "/auth/verify-email",      limit: 5,  window_secs: 60 },
    Rule { prefix: "/auth/guest",             limit: 5,  window_secs: 3600 },
    Rule { prefix: "/auth/oauth",             limit: 20, window_secs: 60 },
    Rule { prefix: "/auth/saml",              limit: 20, window_secs: 60 },
    // Link preview
    Rule { prefix: "/link-preview",           limit: 30, window_secs: 60 },
];

/// Default global per-IP limit for any path not in IP_RULES.
const DEFAULT_IP_LIMIT: u32 = 120;
const DEFAULT_IP_WINDOW: u64 = 60;

/// Per-user rate limits (checked inside handlers via `check_user_rate_limit`).
pub struct UserRule {
    pub endpoint: &'static str,
    pub limit: u32,
    pub window_secs: u64,
}

/// Available user-scoped rules for handler-side checks.
pub const USER_RULES: &[UserRule] = &[
    // Messaging
    UserRule { endpoint: "send_message",     limit: 30,  window_secs: 60 },
    UserRule { endpoint: "edit_message",     limit: 20,  window_secs: 60 },
    UserRule { endpoint: "delete_message",   limit: 20,  window_secs: 60 },
    UserRule { endpoint: "add_reaction",     limit: 60,  window_secs: 60 },
    // Servers
    UserRule { endpoint: "create_server",    limit: 5,   window_secs: 3600 },
    UserRule { endpoint: "create_channel",   limit: 20,  window_secs: 3600 },
    UserRule { endpoint: "create_invite",    limit: 10,  window_secs: 3600 },
    // Voice
    UserRule { endpoint: "voice_join",       limit: 10,  window_secs: 60 },
    // AI
    UserRule { endpoint: "agent_prompt",     limit: 10,  window_secs: 60 },
    UserRule { endpoint: "agent_prompt_hr",  limit: 50,  window_secs: 3600 },
    // File uploads
    UserRule { endpoint: "file_upload",      limit: 10,  window_secs: 60 },
    // Admin
    UserRule { endpoint: "admin_action",     limit: 60,  window_secs: 60 },
    // Webhooks
    UserRule { endpoint: "webhook_deliver",  limit: 100, window_secs: 60 },
    // Verify code (per user)
    UserRule { endpoint: "verify_code",      limit: 5,   window_secs: 60 },
    UserRule { endpoint: "resend_code",      limit: 3,   window_secs: 3600 },
];

// ─── Extract client IP ──────────────────────────────────────────────────────

/// Extract the real client IP.
///
/// Forwarded headers (cf-connecting-ip, x-forwarded-for, x-real-ip) are ONLY
/// trusted when the connecting socket IP matches TRUSTED_PROXY_IPS. Without
/// this, any client can spoof their IP by sending a fake header.
pub fn extract_client_ip(headers: &axum::http::HeaderMap, extensions: &axum::http::Extensions) -> String {
    let peer_ip = extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip());

    // Only read forwarded headers if the direct peer is a trusted proxy.
    let trust_headers = peer_ip
        .as_ref()
        .map(|ip| is_trusted_proxy(ip, &TRUSTED_PROXIES))
        .unwrap_or(false);

    if trust_headers {
        // 1. Cloudflare real IP
        if let Some(cf_ip) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
            let trimmed = cf_ip.trim();
            if !trimmed.is_empty() { return trimmed.to_string(); }
        }
        // 2. X-Forwarded-For (leftmost = original client)
        if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(first) = xff.split(',').next() {
                let ip = first.trim();
                if !ip.is_empty() { return ip.to_string(); }
            }
        }
        // 3. X-Real-IP
        if let Some(real) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
            let trimmed = real.trim();
            if !trimmed.is_empty() { return trimmed.to_string(); }
        }
    }

    // Fallback: direct socket address (unforgeable)
    peer_ip.map(|ip| ip.to_string()).unwrap_or_else(|| "unknown".to_string())
}

// ─── Redis rate limit check ─────────────────────────────────────────────────

/// Check rate limit using Redis INCR + EXPIRE. Returns Ok(()) or Err(retry_after_secs).
///
/// Uses fixed time buckets — at a bucket boundary a client can send `limit`
/// requests at the end of one window and `limit` more at the start of the next,
/// effectively 2x burst over a brief interval. Acceptable for current threat
/// model; sliding window (sorted sets) tracked for post-launch hardening.
async fn redis_check(
    redis: &mut redis::aio::ConnectionManager,
    key: &str,
    limit: u32,
    window_secs: u64,
) -> Result<(), u64> {
    let bucket = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / window_secs;

    let full_key = format!("{key}:{bucket}");

    // INCR + EXPIRE in a pipeline
    let mut pipe = redis::pipe();
    pipe.atomic()
        .cmd("INCR").arg(&full_key)
        .cmd("EXPIRE").arg(&full_key).arg(window_secs as i64);

    let count: u32 = match pipe.query_async::<Vec<i64>>(redis).await {
        Ok(results) => results.first().copied().unwrap_or(1) as u32,
        Err(_) => {
            // Redis unreachable — fail open (allow request)
            return Ok(());
        }
    };

    if count > limit {
        // Calculate retry_after: seconds until current bucket expires
        let elapsed_in_bucket = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            % window_secs;
        let retry_after = window_secs.saturating_sub(elapsed_in_bucket).max(1);
        Err(retry_after)
    } else {
        Ok(())
    }
}

// ─── Public API for handler-side checks ─────────────────────────────────────

// ─── Rate limit multiplier per user role ─────────────────────────────────────

/// Returns a multiplier for the rate limit based on user tier and server permissions.
/// Cached in Redis for 60 seconds per user+server pair.
///
/// - Platform admin/tester: 100x (effectively unlimited)
/// - Server owner: 3x in that server only
/// - ADMINISTRATOR permission: 3x in that server only
/// - MANAGE_MESSAGES permission: 2x in that server only
/// - Anonymous users: 0.5x (stricter)
/// - Everyone else: 1x
pub async fn get_rate_limit_multiplier(
    state: &AppState,
    user_id: &str,
    server_id: Option<&str>,
) -> f64 {
    // Check Redis cache first
    let cache_key = format!("rl:mult:{}:{}", user_id, server_id.unwrap_or("global"));
    let mut conn = state.redis.clone();
    if let Ok(cached) = redis::AsyncCommands::get::<_, String>(&mut conn, &cache_key).await {
        if let Ok(mult) = cached.parse::<f64>() {
            return mult;
        }
    }

    let mult = compute_multiplier(state, user_id, server_id).await;

    // Cache for 60 seconds
    let _: Result<(), _> = redis::AsyncCommands::set_ex::<_, _, ()>(
        &mut conn, &cache_key, &mult.to_string(), 60,
    ).await;

    mult
}

async fn compute_multiplier(state: &AppState, user_id: &str, server_id: Option<&str>) -> f64 {
    let uid: uuid::Uuid = match user_id.parse() {
        Ok(u) => u,
        Err(_) => return 1.0,
    };

    // Look up account tier
    let tier: String = sqlx::query_scalar!(
        "SELECT account_tier FROM users WHERE id = $1",
        uid,
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "registered".to_string());

    // Platform admin or tester: 100x
    if tier == "admin" || tier == "tester" {
        return 100.0;
    }

    // Anonymous: 0.5x
    if tier == "anonymous" || tier == "guest" {
        return 0.5;
    }

    // Server-scoped checks (only for verified+ tiers)
    if let Some(sid_str) = server_id {
        let sid: uuid::Uuid = match sid_str.parse() {
            Ok(s) => s,
            Err(_) => return 1.0,
        };

        // Server owner check
        let is_owner: bool = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2) as \"exists!\"",
            sid, uid,
        )
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

        if is_owner {
            return 3.0;
        }

        // Check role permissions in this server
        let perms: i64 = sqlx::query_scalar!(
            "SELECT COALESCE(BIT_OR(r.permissions), 0) as \"perms!\"
             FROM server_members sm
             JOIN member_roles mr ON mr.server_id = sm.server_id AND mr.user_id = sm.user_id
             JOIN roles r ON r.id = mr.role_id
             WHERE sm.server_id = $1 AND sm.user_id = $2",
            sid, uid,
        )
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

        if perms & (1_i64 << 40) != 0 { // ADMINISTRATOR
            return 3.0;
        }
        if perms & (1_i64 << 10) != 0 { // MANAGE_MESSAGES
            return 2.0;
        }
    }

    1.0
}

// ─── Public API for handler-side checks ─────────────────────────────────────

/// Check rate limit for an authenticated user on a specific action.
/// Applies the role-based multiplier automatically.
///
/// Example: `check_user_rate_limit(&state, &auth.user_id.to_string(), "send_message").await?;`
pub async fn check_user_rate_limit(
    state: &AppState,
    user_id: &str,
    endpoint: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let rule = match USER_RULES.iter().find(|r| r.endpoint == endpoint) {
        Some(r) => r,
        None => return Ok(()), // No rule = no limit
    };

    let mult = get_rate_limit_multiplier(state, user_id, None).await;
    let effective_limit = ((rule.limit as f64) * mult).ceil() as u32;

    let key = format!("rl:user:{endpoint}:{user_id}");
    let mut conn = state.redis.clone();

    match redis_check(&mut conn, &key, effective_limit, rule.window_secs).await {
        Ok(()) => Ok(()),
        Err(retry_after) => {
            tracing::warn!(
                endpoint = endpoint,
                user_id = user_id,
                effective_limit = effective_limit,
                multiplier = mult,
                "Rate limit exceeded for user"
            );
            Err(rate_limit_response(retry_after))
        }
    }
}

/// Check rate limit for a compound key (e.g., per-channel per-user).
/// `scope` is an additional identifier like a channel_id or server_id.
/// Applies role-based multiplier using `scope` as the server_id for permission checks.
pub async fn check_scoped_rate_limit(
    state: &AppState,
    user_id: &str,
    scope: &str,
    endpoint: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let rule = match USER_RULES.iter().find(|r| r.endpoint == endpoint) {
        Some(r) => r,
        None => return Ok(()),
    };

    let mult = get_rate_limit_multiplier(state, user_id, Some(scope)).await;
    let effective_limit = ((rule.limit as f64) * mult).ceil() as u32;

    let key = format!("rl:scoped:{endpoint}:{user_id}:{scope}");
    let mut conn = state.redis.clone();

    match redis_check(&mut conn, &key, effective_limit, rule.window_secs).await {
        Ok(()) => Ok(()),
        Err(retry_after) => {
            tracing::warn!(
                endpoint = endpoint,
                user_id = user_id,
                scope = scope,
                effective_limit = effective_limit,
                multiplier = mult,
                "Scoped rate limit exceeded"
            );
            Err(rate_limit_response(retry_after))
        }
    }
}

/// Build the standard 429 response.
fn rate_limit_response(retry_after: u64) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "error": "rate_limited",
            "retry_after": retry_after,
        })),
    )
}

// ─── Middleware (per-IP, runs before auth) ───────────────────────────────────

/// Global rate limit middleware. Runs BEFORE auth middleware.
/// Uses per-IP limits for all endpoints, with stricter rules for auth paths.
pub async fn rate_limit_middleware(
    State(state): State<Arc<AppState>>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();

    // Skip rate limiting for health checks and metrics.
    if path == "/health" || path == "/health/detailed" || path == "/metrics" {
        return next.run(request).await;
    }

    let ip = extract_client_ip(request.headers(), request.extensions());

    // Find matching rule for this path (prefix match, not substring).
    let (limit, window_secs) = IP_RULES
        .iter()
        .find(|r| path.starts_with(r.prefix))
        .map(|r| (r.limit, r.window_secs))
        .unwrap_or((DEFAULT_IP_LIMIT, DEFAULT_IP_WINDOW));

    let key = format!("rl:ip:{path_tag}:{ip}", path_tag = path_tag(&path));
    let mut conn = state.redis.clone();

    match redis_check(&mut conn, &key, limit, window_secs).await {
        Ok(()) => next.run(request).await,
        Err(retry_after) => {
            tracing::warn!(
                path = %path,
                ip = %ip,
                limit = limit,
                window_secs = window_secs,
                "IP rate limit exceeded"
            );

            (
                StatusCode::TOO_MANY_REQUESTS,
                [("retry-after", retry_after.to_string())],
                Json(serde_json::json!({
                    "error": "rate_limited",
                    "retry_after": retry_after,
                })),
            )
                .into_response()
        }
    }
}

/// Normalize path to a stable tag for Redis keys (strip UUIDs and IDs).
fn path_tag(path: &str) -> String {
    let segments: Vec<&str> = path.split('/').collect();
    segments
        .iter()
        .map(|s| {
            // Replace UUID-like segments with ":id"
            if s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4 {
                ":id"
            } else if s.parse::<u64>().is_ok() {
                ":n"
            } else {
                s
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}
