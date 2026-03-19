// main.rs — Discreet server entry point.
//
// Loads configuration from environment, connects to PostgreSQL and Redis,
// registers all routes under /api/v1/*, and starts the Axum HTTP server.
//
// Middleware stack (outermost → innermost, i.e. request processing order):
//   Request
//     → CORS                 (tower_http::cors::CorsLayer)
//     → Rate Limit           (discreet_rate_limit)
//     → Security Headers     (discreet_security_headers — CSP, HSTS, X-Frame-Options, …)
//     → Request ID           (request_id_middleware — UUID span + X-Request-ID header)
//     → Tracing              (tower_http::trace::TraceLayer)
//     → Compression          (tower_http::compression::CompressionLayer)
//     → Body Limit           (axum::extract::DefaultBodyLimit, 100 MB)
//     → Handler
//
// In Axum, .layer() calls wrap in reverse order: the LAST .layer() becomes
// the outermost layer (first to process the request).  Security headers sit
// between Rate Limit and Tracing — after CORS, before route handlers.
//
// Landing page:     /               (client/public/landing.html)
// Vite SPA:         /app/*          (client/dist/ with index.html fallback)
// Unversioned:      /health, /ws
// Versioned API:    /api/v1/auth/*, /api/v1/servers/*, /api/v1/channels/*, etc.
//
// Usage:
//   DATABASE_URL=postgres://... REDIS_URL=redis://... JWT_SECRET=... cargo run

use std::sync::Arc;
use axum::extract::State;
use axum::response::IntoResponse;
use tokio::net::TcpListener;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use uuid::Uuid;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use discreet_server::discreet_admin_invite_handlers;
use discreet_server::discreet_agent_handlers;
use discreet_server::discreet_announcement_handlers;
use discreet_server::discreet_audit;
use discreet_server::discreet_automod;
use discreet_server::discreet_auth_handlers;
use discreet_server::discreet_ban_handlers;
use discreet_server::discreet_bot_spawn_handlers;
use discreet_server::discreet_bug_report_handlers;
use discreet_server::discreet_channel_handlers;
use discreet_server::discreet_category_handlers;
use discreet_server::discreet_config::Config;
use discreet_server::discreet_csrf;
use discreet_server::discreet_discovery_handlers;
use discreet_server::discreet_dm_handlers;
use discreet_server::discreet_mls_handlers;
use discreet_server::discreet_email_handlers;
use discreet_server::discreet_export_handlers;
use discreet_server::discreet_emoji_handlers;
use discreet_server::discreet_event_handlers;
use discreet_server::discreet_file_handlers;
use discreet_server::discreet_forum_handlers;
use discreet_server::discreet_friend_handlers;
use discreet_server::discreet_group_dm_handlers;
use discreet_server::discreet_health;
use discreet_server::discreet_meeting_handlers;
use discreet_server::discreet_passkey;
use discreet_server::discreet_message_handlers;
use discreet_server::discreet_notification_handlers;
use discreet_server::discreet_pin_handlers;
use discreet_server::discreet_poll_handlers;
use discreet_server::discreet_rate_limit;
use discreet_server::discreet_reaction_handlers;
use discreet_server::discreet_role_handlers;
use discreet_server::discreet_security_headers;
use discreet_server::discreet_server_handlers;
use discreet_server::discreet_settings_handlers;
use discreet_server::discreet_soundboard_handlers;
use discreet_server::discreet_stream_handlers;
use discreet_server::discreet_state::AppState;
use discreet_server::discreet_turn;
use discreet_server::discreet_typing;
use discreet_server::discreet_user_handlers;
use discreet_server::discreet_voice_handlers;
use discreet_server::discreet_dev_token_handlers;
use discreet_server::discreet_disappearing_handlers;
use discreet_server::discreet_platform_admin_handlers;
use discreet_server::discreet_premium;
use discreet_server::discreet_qr_handlers;
use discreet_server::discreet_platform_settings;
use discreet_server::discreet_waitlist;
use discreet_server::discreet_websocket;
use discreet_server::discreet_ack_handlers;
use discreet_server::discreet_billing_handlers;
use discreet_server::discreet_bookmark_handlers;
use discreet_server::discreet_channel_category_handlers;
use discreet_server::discreet_playbook_handlers;
use discreet_server::discreet_report_handlers;
use discreet_server::discreet_scheduled_task_handlers;

/// Middleware: lockdown + maintenance mode gate.
///
/// Checked BEFORE auth so unauthenticated requests see 503 instantly.
/// Modes (Redis key `platform:lockdown`):
///   "full"          — 503 all non-admin requests
///   "readonly"      — allow GET, block POST/PUT/DELETE/PATCH for non-admins
///   "registrations" — block new signups only (anti-raid)
///   "off" / absent  — normal operation
///
/// Falls back to platform_settings.maintenance_mode for legacy compat.
async fn maintenance_middleware(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();

    // Always allow admin endpoints and health check through.
    if path == "/health" || path.starts_with("/api/v1/admin/") {
        return next.run(request).await;
    }

    // ── Check lockdown state (Redis first, then platform_settings fallback) ──
    let mut redis = state.redis.clone();

    // Try lockdown key first (new system)
    let lockdown: Option<serde_json::Value> = redis::cmd("GET")
        .arg("platform:lockdown")
        .query_async::<Option<String>>(&mut redis)
        .await
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok());

    let mode = lockdown.as_ref()
        .and_then(|v| v.get("mode")?.as_str())
        .unwrap_or("off");

    let reason = lockdown.as_ref()
        .and_then(|v| v.get("reason")?.as_str())
        .unwrap_or("Service temporarily unavailable");

    let retry_after = lockdown.as_ref()
        .and_then(|v| v.get("retry_after_seconds")?.as_u64())
        .unwrap_or(900); // default 15 min

    match mode {
        "full" => {
            return (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(serde_json::json!({
                    "error": { "code": "LOCKDOWN", "message": reason },
                    "lockdown": true,
                    "mode": "full",
                    "retry_after_seconds": retry_after,
                })),
            ).into_response();
        }
        "readonly" => {
            if method != axum::http::Method::GET && method != axum::http::Method::HEAD && method != axum::http::Method::OPTIONS {
                return (
                    axum::http::StatusCode::SERVICE_UNAVAILABLE,
                    axum::Json(serde_json::json!({
                        "error": { "code": "LOCKDOWN_READONLY", "message": reason },
                        "lockdown": true,
                        "mode": "readonly",
                        "retry_after_seconds": retry_after,
                    })),
                ).into_response();
            }
        }
        "registrations" => {
            if path.contains("/auth/register") || path.contains("/auth/guest") {
                return (
                    axum::http::StatusCode::SERVICE_UNAVAILABLE,
                    axum::Json(serde_json::json!({
                        "error": { "code": "REGISTRATIONS_LOCKED", "message": reason },
                        "lockdown": true,
                        "mode": "registrations",
                        "retry_after_seconds": retry_after,
                    })),
                ).into_response();
            }
        }
        _ => {} // "off" or unknown — continue normally
    }

    // ── Legacy: check platform_settings.maintenance_mode ──
    if mode == "off" {
        let cached: Option<serde_json::Value> = redis::cmd("GET")
            .arg("platform_settings")
            .query_async::<Option<String>>(&mut redis)
            .await
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok());

        let in_maintenance = cached.as_ref()
            .and_then(|v| v.get("maintenance_mode")?.as_bool())
            .unwrap_or(false);

        if in_maintenance {
            let message = cached.as_ref()
                .and_then(|v| v.get("maintenance_message")?.as_str().map(String::from))
                .unwrap_or_else(|| "Discreet is undergoing scheduled maintenance. Please try again shortly.".into());

            return (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(serde_json::json!({
                    "error": { "code": "SERVICE_UNAVAILABLE", "message": message },
                    "maintenance": true,
                })),
            ).into_response();
        }
    }

    next.run(request).await
}

/// Middleware: generate a UUID request ID, add it to the tracing span,
/// and return it as X-Request-ID on the response.
async fn request_id_middleware(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use tracing::Instrument;

    let request_id = Uuid::new_v4().to_string();
    let span = tracing::info_span!("request", request_id = %request_id);
    let rid = request_id.clone();

    let mut resp = next.run(req).instrument(span).await;
    resp.headers_mut().insert(
        axum::http::HeaderName::from_static("x-request-id"),
        axum::http::HeaderValue::from_str(&rid).unwrap(),
    );
    resp
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize structured logging.
    // LOG_FORMAT=json → machine-readable JSON lines (for SIEM / log aggregators).
    // LOG_FORMAT=pretty (default) → human-readable colored output.
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "discreet_server=debug,tower_http=debug".into());

    let log_format = std::env::var("LOG_FORMAT").unwrap_or_default();
    if log_format.eq_ignore_ascii_case("json") {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
    }

    // Load configuration.
    let config = Config::from_env();
    let bind_addr = format!("{}:{}", config.host, config.port);

    // ── Production credential validation ─────────────────────────────────
    // Refuse to start with weak/default credentials in production.
    // Skipped when SELF_HOSTED=true (self-hosters manage their own secrets).
    {
        let rust_env = std::env::var("RUST_ENV").unwrap_or_default();
        let self_hosted = std::env::var("SELF_HOSTED").unwrap_or_default();
        let is_production = rust_env.eq_ignore_ascii_case("production")
            || self_hosted.ne("true");

        if is_production {
            tracing::info!("Running production credential checks...");

            // Check DATABASE_URL for default passwords
            let db_url = std::env::var("DATABASE_URL").unwrap_or_default();
            let weak_passwords = ["citadel", "discreet", "password", "postgres", "changeme", "CHANGE_ME"];
            for weak in &weak_passwords {
                if db_url.contains(&format!(":{}@", weak)) {
                    tracing::info!("Check: DATABASE_URL password strength");
                    panic!(
                        "FATAL: DATABASE_URL contains default password '{}'. \
                         Generate a secure password: openssl rand -hex 32",
                        weak
                    );
                }
            }
            tracing::info!("Check: DATABASE_URL password — OK");

            // Check JWT_SECRET length
            tracing::info!("Check: JWT_SECRET length (minimum 32 chars)");
            if config.jwt_secret.len() < 32 {
                panic!(
                    "FATAL: JWT_SECRET is only {} chars (minimum 32). \
                     Generate with: openssl rand -hex 64",
                    config.jwt_secret.len()
                );
            }
            tracing::info!("Check: JWT_SECRET length — OK ({} chars)", config.jwt_secret.len());

            // Check TOTP_ENCRYPTION_KEY is set
            tracing::info!("Check: TOTP_ENCRYPTION_KEY presence");
            if config.totp_encryption_key.is_none() {
                panic!(
                    "FATAL: TOTP_ENCRYPTION_KEY is not set. Required in production. \
                     Generate with: openssl rand -hex 32"
                );
            }
            tracing::info!("Check: TOTP_ENCRYPTION_KEY — OK");

            tracing::info!("All production credential checks passed");
        }
    }

    // Initialize shared state (connects to Postgres + Redis).
    let state = Arc::new(AppState::new(config).await?);

    // Migrations are applied manually — see SETUP.md and TROUBLESHOOTING.md.
    // sqlx::migrate!("./migrations").run(&state.db).await?;
    // To re-enable auto-migrate, ensure all migration files have IF NOT EXISTS guards.

    // Background task: clean up stale rate limit entries every 2 minutes.
    {
        let limiter = state.rate_limiter.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(120));
            loop {
                interval.tick().await;
                limiter.cleanup().await;
            }
        });
    }

    // Background task: clean up stale typing cooldown entries every 30 seconds.
    {
        let typing = state.typing_cooldown.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                typing.cleanup().await;
            }
        });
    }

    // Background task: message retention cleanup every 60 seconds.
    // Handles: channel TTL, per-message expires_at (disappearing messages),
    // and three-tier retention (channel > server > global).
    // PROTECTED DATA: audit_log rows are never purged.
    {
        let db = state.db.clone();
        let redis = state.redis.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;

                // 1) Channel-level TTL (legacy message_ttl_seconds).
                match sqlx::query!(
                    "DELETE FROM messages WHERE id IN (
                        SELECT m.id FROM messages m
                        JOIN channels c ON c.id = m.channel_id
                        WHERE c.message_ttl_seconds > 0
                          AND m.created_at < NOW() - (c.message_ttl_seconds || ' seconds')::interval
                    )"
                )
                .execute(&db)
                .await
                {
                    Ok(r) => { if r.rows_affected() > 0 { tracing::info!("TTL cleanup: deleted {} messages", r.rows_affected()); } }
                    Err(e) => tracing::warn!("TTL cleanup error: {}", e),
                }

                // 2) Per-message disappearing (expires_at).
                match sqlx::query!(
                    "DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < NOW()"
                )
                .execute(&db)
                .await
                {
                    Ok(r) => { if r.rows_affected() > 0 { tracing::info!("Disappearing cleanup: deleted {} messages", r.rows_affected()); } }
                    Err(e) => tracing::warn!("Disappearing cleanup error: {}", e),
                }

                // 3) Three-tier retention (runs every cycle, but heavy query — only
                //    deletes messages past their effective retention period).
                //    Channel retention overrides server, server overrides global.
                //    0 or NULL = inherit from parent tier. Global 0 = forever.
                let global_days: i32 = {
                    let mut r = redis.clone();
                    let cached: Option<String> = redis::cmd("GET")
                        .arg("platform_settings")
                        .query_async::<Option<String>>(&mut r)
                        .await
                        .ok()
                        .flatten();
                    cached
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        .and_then(|v| v.get("default_retention_days")?.as_i64())
                        .unwrap_or(0) as i32
                };

                if global_days > 0 {
                    // Delete messages older than global retention where no tighter
                    // server/channel override exists.
                    let res: Result<sqlx::postgres::PgQueryResult, sqlx::Error> = sqlx::query!(
                        "DELETE FROM messages WHERE id IN (
                            SELECT m.id FROM messages m
                            JOIN channels c ON c.id = m.channel_id
                            JOIN servers s ON s.id = c.server_id
                            WHERE m.created_at < NOW() - make_interval(days => $1)
                              AND COALESCE(c.message_retention_days, s.message_retention_days, $1) <= $1
                              AND m.created_at < NOW() - make_interval(days => COALESCE(c.message_retention_days, s.message_retention_days, $1))
                        )",
                        global_days,
                    )
                    .execute(&db)
                    .await;
                    match res {
                        Ok(r) => { if r.rows_affected() > 0 { tracing::info!("Retention cleanup: deleted {} messages (global {} days)", r.rows_affected(), global_days); } }
                        Err(e) => tracing::warn!("Retention cleanup error: {}", e),
                    }
                }

                // Server-level retention (where global is forever but server has a limit).
                match sqlx::query!(
                    "DELETE FROM messages WHERE id IN (
                        SELECT m.id FROM messages m
                        JOIN channels c ON c.id = m.channel_id
                        JOIN servers s ON s.id = c.server_id
                        WHERE s.message_retention_days IS NOT NULL
                          AND s.message_retention_days > 0
                          AND c.message_retention_days IS NULL
                          AND m.created_at < NOW() - make_interval(days => s.message_retention_days)
                    )"
                )
                .execute(&db)
                .await
                {
                    Ok(r) => { if r.rows_affected() > 0 { tracing::info!("Server retention cleanup: deleted {} messages", r.rows_affected()); } }
                    Err(e) => tracing::warn!("Server retention cleanup error: {}", e),
                }

                // Channel-level retention override.
                match sqlx::query!(
                    "DELETE FROM messages WHERE id IN (
                        SELECT m.id FROM messages m
                        JOIN channels c ON c.id = m.channel_id
                        WHERE c.message_retention_days IS NOT NULL
                          AND c.message_retention_days > 0
                          AND m.created_at < NOW() - make_interval(days => c.message_retention_days)
                    )"
                )
                .execute(&db)
                .await
                {
                    Ok(r) => { if r.rows_affected() > 0 { tracing::info!("Channel retention cleanup: deleted {} messages", r.rows_affected()); } }
                    Err(e) => tracing::warn!("Channel retention cleanup error: {}", e),
                }
            }
        });
    }

    // Background task: disappearing messages (read-then-expire) every 60 seconds.
    // Soft-deletes channel and DM messages where ttl_seconds is set,
    // the message has been acknowledged, and acked_at + ttl_seconds < now.
    {
        let db = state.db.clone();
        let redis = state.redis.clone();
        tokio::spawn(discreet_disappearing_handlers::disappearing_cleanup_loop(db, redis));
    }

    // Background task: execute scheduled server deletions every 5 minutes.
    // Servers past their scheduled_deletion_at are fully deleted:
    // messages/channels/roles removed, audit tombstone preserved.
    {
        let db = state.db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
            loop {
                interval.tick().await;

                // Find servers past their deletion date.
                let due = match sqlx::query!(
                    "SELECT id, name, owner_id FROM servers WHERE scheduled_deletion_at IS NOT NULL AND scheduled_deletion_at <= NOW()"
                )
                .fetch_all(&db)
                .await
                {
                    Ok(rows) => rows,
                    Err(e) => { tracing::warn!("Scheduled deletion query error: {}", e); continue; }
                };

                for server in due {
                    tracing::info!(server_id = %server.id, name = %server.name, "Executing scheduled server deletion");

                    // Insert audit tombstone before deletion.
                    let _ = discreet_audit::log_action(
                        &db,
                        discreet_audit::AuditEntry {
                            server_id: server.id,
                            actor_id: server.owner_id,
                            action: "SERVER_DELETED_SCHEDULED",
                            target_type: Some("server"),
                            target_id: Some(server.id),
                            changes: Some(serde_json::json!({ "name": server.name, "reason": "scheduled_deletion" })),
                            reason: Some("Automated: 30-day scheduled deletion"),
                        },
                    ).await;

                    // CASCADE delete removes messages, channels, roles, members, invites.
                    match sqlx::query!("DELETE FROM servers WHERE id = $1", server.id)
                        .execute(&db)
                        .await
                    {
                        Ok(_) => tracing::info!(server_id = %server.id, "Scheduled server deletion complete"),
                        Err(e) => tracing::error!(server_id = %server.id, error = %e, "Scheduled server deletion failed"),
                    }
                }
            }
        });
    }

    // Background task: dispatch pending event reminders every 60 seconds.
    {
        let db = state.db.clone();
        let st = state.clone();
        tokio::spawn(discreet_event_handlers::reminder_dispatcher(db, st));
    }

    // Background task: execute scheduled tasks (channel monitors, announcements, etc.) every 60 seconds.
    {
        let db = state.db.clone();
        let st = state.clone();
        tokio::spawn(discreet_server::discreet_task_executor::task_executor_loop(db, st));
    }

    // Build the versioned API sub-router.
    // ALL routes registered on a single Router to avoid Axum merge() conflicts
    // with overlapping path prefixes (e.g. /servers/:id + /servers/:id/channels).
    let api_v1 = axum::Router::new()
        // ── Auth ──
        .route("/auth/register", axum::routing::post(discreet_auth_handlers::register))
        .route("/auth/guest", axum::routing::post(discreet_auth_handlers::register_guest))
        .route("/auth/login", axum::routing::post(discreet_auth_handlers::login))
        .route("/auth/upgrade", axum::routing::post(discreet_auth_handlers::upgrade_account))
        .route("/auth/recover-account", axum::routing::post(discreet_auth_handlers::recover_account))
        // Email verification & password reset
        .route("/auth/verify-email/send", axum::routing::post(discreet_email_handlers::send_verification))
        .route("/auth/verify-email/confirm", axum::routing::post(discreet_email_handlers::confirm_email))
        // Link-based verification (GET with ?token=... — no JWT needed, used from emails)
        .route("/auth/verify-email", axum::routing::get(discreet_email_handlers::verify_email_by_token))
        // Resend verification email (JWT required, max 3/hour)
        .route("/auth/resend-verification", axum::routing::post(discreet_email_handlers::resend_verification))
        // 6-digit code verification (JWT required)
        .route("/auth/verify-code", axum::routing::post(discreet_auth_handlers::verify_registration_code))
        .route("/auth/resend-code", axum::routing::post(discreet_auth_handlers::resend_registration_code))
        .route("/auth/forgot-password", axum::routing::post(discreet_email_handlers::forgot_password))
        .route("/auth/reset-password", axum::routing::post(discreet_email_handlers::reset_password))
        // Passkey (WebAuthn)
        .route("/auth/passkey/register/start", axum::routing::post(discreet_passkey::register_start))
        .route("/auth/passkey/register/finish", axum::routing::post(discreet_passkey::register_finish))
        .route("/auth/passkey/login/start", axum::routing::post(discreet_passkey::login_start))
        .route("/auth/passkey/login/finish", axum::routing::post(discreet_passkey::login_finish))
        // Server discovery
        .route("/discover", axum::routing::get(discreet_discovery_handlers::discover_servers))
        .route("/servers/:server_id/publish", axum::routing::post(discreet_discovery_handlers::publish_server))
        .route("/servers/:server_id/unpublish", axum::routing::post(discreet_discovery_handlers::unpublish_server))
        .route("/auth/refresh", axum::routing::post(discreet_auth_handlers::refresh))
        .route("/auth/me/refresh", axum::routing::get(discreet_auth_handlers::refresh_claims))
        .route("/auth/logout", axum::routing::post(discreet_auth_handlers::logout))
        .route("/auth/verify-password", axum::routing::post(discreet_auth_handlers::verify_password_endpoint))
        .route("/auth/sessions", axum::routing::get(discreet_auth_handlers::list_sessions))
        .route("/auth/sessions/all-others", axum::routing::delete(discreet_auth_handlers::revoke_all_other_sessions))
        .route("/auth/sessions/:id", axum::routing::delete(discreet_auth_handlers::revoke_session))
        .route("/auth/sessions/:id/verify", axum::routing::post(discreet_auth_handlers::initiate_verify))
        .route("/auth/sessions/:id/confirm", axum::routing::post(discreet_auth_handlers::confirm_verify))
        // ── 2FA (login completion — no JWT required) ──
        .route("/auth/2fa/verify", axum::routing::post(discreet_auth_handlers::complete_2fa_login))
        // ── 2FA management (JWT required) ──
        .route("/users/@me/2fa/setup", axum::routing::post(discreet_auth_handlers::setup_2fa))
        .route("/users/@me/2fa/verify", axum::routing::post(discreet_auth_handlers::verify_2fa))
        .route("/users/@me/2fa/disable", axum::routing::post(discreet_auth_handlers::disable_2fa))
        // ── Servers ──
        .route("/servers", axum::routing::post(discreet_server_handlers::create_server).get(discreet_server_handlers::list_servers))
        .route("/servers/:server_id", axum::routing::get(discreet_server_handlers::get_server).patch(discreet_server_handlers::update_server).delete(discreet_server_handlers::delete_server))
        .route("/servers/:server_id/join", axum::routing::post(discreet_server_handlers::join_server))
        .route("/servers/:server_id/leave", axum::routing::post(discreet_server_handlers::leave_server))
        .route("/servers/:server_id/members", axum::routing::get(discreet_server_handlers::list_members))
        .route("/servers/:server_id/invites", axum::routing::post(discreet_server_handlers::create_invite).get(discreet_server_handlers::list_invites))
        .route("/servers/:server_id/invite-qr", axum::routing::get(discreet_qr_handlers::server_invite_qr))
        .route("/servers/:server_id/vanity", axum::routing::post(discreet_server_handlers::set_server_vanity))
        .route("/invites/:code", axum::routing::get(discreet_server_handlers::resolve_invite_code))
        .route("/servers/:server_id/audit-log", axum::routing::get(discreet_audit::list_audit_log))
        .route("/servers/:server_id/audit-log/verify", axum::routing::get(discreet_audit::verify_audit_chain))
        .route("/servers/:server_id/audit-log/:entry_id", axum::routing::get(discreet_audit::get_audit_entry))
        // Custom emoji
        .route("/servers/:server_id/emojis", axum::routing::get(discreet_emoji_handlers::list_emojis).post(discreet_emoji_handlers::upload_emoji))
        .route("/servers/:server_id/emojis/:id", axum::routing::delete(discreet_emoji_handlers::delete_emoji))
        // Events
        .route("/servers/:server_id/events", axum::routing::get(discreet_event_handlers::list_events).post(discreet_event_handlers::create_event))
        .route("/events/:event_id", axum::routing::put(discreet_event_handlers::update_event).delete(discreet_event_handlers::delete_event))
        .route("/events/:event_id/rsvp", axum::routing::post(discreet_event_handlers::rsvp_event))
        .route("/events/:event_id/rsvps", axum::routing::get(discreet_event_handlers::list_rsvps))
        .route("/events/:event_id/remind", axum::routing::post(discreet_event_handlers::remind_event))
        // Notifications
        .route("/notifications", axum::routing::get(discreet_notification_handlers::list_notifications))
        .route("/notifications/unread-count", axum::routing::get(discreet_notification_handlers::unread_count))
        .route("/notifications/read-all", axum::routing::post(discreet_notification_handlers::mark_all_read))
        .route("/notifications/:notification_id/read", axum::routing::patch(discreet_notification_handlers::mark_read))
        // Bookmarks
        .route("/bookmarks", axum::routing::post(discreet_bookmark_handlers::create_bookmark).get(discreet_bookmark_handlers::list_bookmarks))
        .route("/bookmarks/:message_id", axum::routing::delete(discreet_bookmark_handlers::delete_bookmark))
        // Channel categories (user-level custom folders)
        .route("/servers/:server_id/channel-categories", axum::routing::get(discreet_channel_category_handlers::list_categories).post(discreet_channel_category_handlers::create_category))
        .route("/channel-categories/:cat_id", axum::routing::patch(discreet_channel_category_handlers::update_category).delete(discreet_channel_category_handlers::delete_category))
        .route("/channel-categories/:cat_id/channels/:channel_id", axum::routing::put(discreet_channel_category_handlers::add_channel_to_category).delete(discreet_channel_category_handlers::remove_channel_from_category))
        // Playbooks
        .route("/servers/:server_id/playbooks", axum::routing::post(discreet_playbook_handlers::create_playbook).get(discreet_playbook_handlers::list_playbooks))
        .route("/playbooks/:playbook_id", axum::routing::get(discreet_playbook_handlers::get_playbook).delete(discreet_playbook_handlers::delete_playbook))
        .route("/playbooks/:playbook_id/steps", axum::routing::post(discreet_playbook_handlers::add_step))
        .route("/playbooks/:playbook_id/steps/:step_id/complete", axum::routing::patch(discreet_playbook_handlers::complete_step))
        // Scheduled tasks
        .route("/servers/:server_id/tasks", axum::routing::post(discreet_scheduled_task_handlers::create_task).get(discreet_scheduled_task_handlers::list_tasks))
        .route("/tasks/:task_id", axum::routing::delete(discreet_scheduled_task_handlers::delete_task))
        .route("/tasks/:task_id/toggle", axum::routing::patch(discreet_scheduled_task_handlers::toggle_task))
        // Soundboard
        .route("/servers/:server_id/automod", axum::routing::get(discreet_automod::get_automod_config).put(discreet_automod::update_automod_config))
        .route("/servers/:server_id/soundboard", axum::routing::get(discreet_soundboard_handlers::list_clips).post(discreet_soundboard_handlers::upload_clip))
        .route("/servers/:server_id/soundboard/:id", axum::routing::delete(discreet_soundboard_handlers::delete_clip))
        .route("/servers/:server_id/soundboard/:id/play", axum::routing::post(discreet_soundboard_handlers::play_clip))
        // AI Bot Spawn (Patent-Pending)
        .route("/bots/personas", axum::routing::get(discreet_bot_spawn_handlers::list_personas))
        .route("/bots/spawn", axum::routing::post(discreet_bot_spawn_handlers::spawn_bot_channel))
        .route("/bots/channels", axum::routing::get(discreet_bot_spawn_handlers::list_bot_channels))
        .route("/bots/channels/:id", axum::routing::delete(discreet_bot_spawn_handlers::close_bot_channel))
        .route("/servers/:server_id/ai-bots", axum::routing::get(discreet_bot_spawn_handlers::list_server_bots).post(discreet_bot_spawn_handlers::add_bot_to_server))
        .route("/servers/:server_id/ai-bots/:bot_id", axum::routing::patch(discreet_bot_spawn_handlers::update_bot_config).delete(discreet_bot_spawn_handlers::remove_bot_from_server))
        .route("/servers/:server_id/ai-bots/:bot_id/prompt", axum::routing::post(discreet_bot_spawn_handlers::prompt_bot))
        .route("/servers/:server_id/ai-bots/:bot_id/config", axum::routing::get(discreet_bot_spawn_handlers::get_agent_config).put(discreet_bot_spawn_handlers::update_agent_config))
        .route("/servers/:server_id/ai-bots/:bot_id/memory", axum::routing::delete(discreet_bot_spawn_handlers::delete_agent_memory))
        // Voice / TURN
        .route("/voice/turn-credentials", axum::routing::get(discreet_turn::turn_credentials))
        // Meetings (Zoom-style)
        .route("/meetings", axum::routing::post(discreet_meeting_handlers::create_meeting).get(discreet_meeting_handlers::list_my_meetings))
        .route("/meetings/:code", axum::routing::get(discreet_meeting_handlers::get_meeting_info).delete(discreet_meeting_handlers::end_meeting))
        .route("/meetings/:code/join", axum::routing::post(discreet_meeting_handlers::join_meeting))
        // Polls
        .route("/channels/:channel_id/polls", axum::routing::post(discreet_poll_handlers::create_poll).get(discreet_poll_handlers::list_polls))
        .route("/polls/:poll_id", axum::routing::get(discreet_poll_handlers::get_poll).delete(discreet_poll_handlers::delete_poll))
        .route("/polls/:poll_id/vote", axum::routing::post(discreet_poll_handlers::vote_poll))
        // ── Categories ──
        .route("/servers/:server_id/categories", axum::routing::post(discreet_category_handlers::create_category).get(discreet_category_handlers::list_categories))
        .route("/servers/:server_id/categories/:id", axum::routing::patch(discreet_category_handlers::update_category).delete(discreet_category_handlers::delete_category))
        .route("/servers/:server_id/channels/:id/move", axum::routing::patch(discreet_category_handlers::move_channel_to_category))
        // ── Channels ──
        .route("/servers/:server_id/channels", axum::routing::post(discreet_channel_handlers::create_channel).get(discreet_channel_handlers::list_channels))
        .route("/channels/:channel_id", axum::routing::get(discreet_channel_handlers::get_channel).patch(discreet_channel_handlers::update_channel).delete(discreet_channel_handlers::delete_channel))
        .route("/channels/:channel_id/ttl", axum::routing::put(discreet_disappearing_handlers::set_channel_ttl))
        .route("/channels/:channel_id/export", axum::routing::get(discreet_export_handlers::export_channel_zip))
        // ── Messages ──
        .route("/channels/:channel_id/messages", axum::routing::post(discreet_message_handlers::send_message).get(discreet_message_handlers::get_messages))
        .route("/channels/:channel_id/messages/search", axum::routing::get(discreet_message_handlers::search_messages))
        .route("/messages/:id", axum::routing::patch(discreet_message_handlers::edit_message).delete(discreet_message_handlers::delete_message))
        .route("/messages/:id/ack", axum::routing::post(discreet_ack_handlers::ack_message))
        .route("/messages/:id/acks", axum::routing::get(discreet_ack_handlers::get_acks))
        // ── Pins ──
        .route("/servers/:server_id/channels/:channel_id/pins/:message_id", axum::routing::post(discreet_pin_handlers::pin_message).delete(discreet_pin_handlers::unpin_message))
        .route("/servers/:server_id/channels/:channel_id/pins", axum::routing::get(discreet_pin_handlers::list_pinned_messages))
        // ── Reactions ──
        .route("/channels/:channel_id/messages/:msg_id/reactions/:emoji", axum::routing::put(discreet_reaction_handlers::add_reaction).delete(discreet_reaction_handlers::remove_reaction))
        .route("/channels/:channel_id/messages/:msg_id/reactions", axum::routing::get(discreet_reaction_handlers::list_reactions))
        // ── Typing ──
        .route("/channels/:channel_id/typing", axum::routing::post(discreet_typing::start_typing))
        // ── Files ──
        .route("/channels/:channel_id/files", axum::routing::post(discreet_file_handlers::upload_file_blob))
        .route("/files/:id", axum::routing::get(discreet_file_handlers::download_file_blob))
        // ── Voice ──
        .route("/channels/:channel_id/voice", axum::routing::post(discreet_voice_handlers::send_voice_message))
        .route("/channels/:channel_id/voice/:message_id", axum::routing::get(discreet_voice_handlers::get_voice_audio))
        // ── Roles ──
        .route("/servers/:server_id/roles", axum::routing::post(discreet_role_handlers::create_role).get(discreet_role_handlers::list_roles))
        .route("/roles/:role_id", axum::routing::patch(discreet_role_handlers::update_role).delete(discreet_role_handlers::delete_role))
        .route("/servers/:server_id/members/:user_id/nickname", axum::routing::put(discreet_server_handlers::set_nickname))
        .route("/servers/:server_id/members/:user_id/roles/:role_id", axum::routing::put(discreet_role_handlers::assign_role).delete(discreet_role_handlers::unassign_role))
        .route("/servers/:server_id/members/:user_id/roles", axum::routing::get(discreet_role_handlers::list_member_roles))
        // ── Bans ──
        .route("/servers/:server_id/bans", axum::routing::post(discreet_ban_handlers::ban_member).get(discreet_ban_handlers::list_bans))
        .route("/servers/:server_id/bans/:user_id", axum::routing::delete(discreet_ban_handlers::unban_member))
        // ── Agents ──
        .route("/agents/search", axum::routing::post(discreet_agent_handlers::search_or_spawn))
        .route("/agents/spawn/:id/status", axum::routing::get(discreet_agent_handlers::get_spawn_status))
        .route("/servers/:server_id/agents", axum::routing::get(discreet_agent_handlers::list_agents))
        // ── Bots ──
        .route("/servers/:server_id/bots", axum::routing::post(discreet_server_handlers::create_bot).get(discreet_server_handlers::list_bots))
        .route("/servers/:server_id/archive", axum::routing::post(discreet_server_handlers::archive_server))
        .route("/servers/:server_id/schedule-deletion", axum::routing::post(discreet_server_handlers::schedule_server_deletion))
        // ── Users ──
        .route("/users/@me", axum::routing::get(discreet_user_handlers::get_me).patch(discreet_user_handlers::update_me).delete(discreet_user_handlers::delete_account))
        .route("/users/@me/servers", axum::routing::get(discreet_user_handlers::list_my_servers))
        .route("/users/@me/export", axum::routing::get(discreet_user_handlers::export_my_data))
        .route("/users/@me/export-zip", axum::routing::get(discreet_export_handlers::export_user_zip))
        .route("/users/@me/status", axum::routing::put(discreet_user_handlers::update_status))
        .route("/users/@me/qr", axum::routing::get(discreet_qr_handlers::user_qr))
        .route("/connect/:code", axum::routing::get(discreet_qr_handlers::resolve_connect_code))
        .route("/users/@me/settings", axum::routing::get(discreet_settings_handlers::get_my_settings).patch(discreet_settings_handlers::patch_my_settings))
        .route("/settings/timezone", axum::routing::post(discreet_settings_handlers::set_timezone))
        .route("/servers/:server_id/notification-settings", axum::routing::get(discreet_settings_handlers::get_server_notification_settings).patch(discreet_settings_handlers::patch_server_notification_settings))
        .route("/servers/:server_id/notification-level", axum::routing::patch(discreet_server_handlers::set_notification_level))
        .route("/servers/:server_id/visibility", axum::routing::patch(discreet_server_handlers::set_visibility_override))
        .route("/users/search", axum::routing::get(discreet_friend_handlers::search_users))
        .route("/users/:id", axum::routing::get(discreet_user_handlers::get_user))
        .route("/users/:id/block", axum::routing::post(discreet_friend_handlers::block_user).delete(discreet_friend_handlers::unblock_user))
        // ── Friends ──
        .route("/friends", axum::routing::get(discreet_friend_handlers::list_friends))
        .route("/friends/request", axum::routing::post(discreet_friend_handlers::send_friend_request))
        .route("/friends/requests", axum::routing::get(discreet_friend_handlers::list_incoming_requests))
        .route("/friends/outgoing", axum::routing::get(discreet_friend_handlers::list_outgoing_requests))
        .route("/friends/:id/accept", axum::routing::post(discreet_friend_handlers::accept_friend_request))
        .route("/friends/:id/decline", axum::routing::post(discreet_friend_handlers::decline_friend_request))
        .route("/friends/:id", axum::routing::delete(discreet_friend_handlers::remove_friend))
        // ── DMs ──
        .route("/dms", axum::routing::post(discreet_dm_handlers::create_dm).get(discreet_dm_handlers::list_dms))
        .route("/dms/:id/messages", axum::routing::post(discreet_dm_handlers::send_dm).get(discreet_dm_handlers::get_dm_messages))
        .route("/conversations/:id/ttl", axum::routing::put(discreet_disappearing_handlers::set_conversation_ttl))
        .route("/dms/:id/ttl", axum::routing::put(discreet_disappearing_handlers::set_conversation_ttl))
        // Group DMs
        .route("/group-dms", axum::routing::post(discreet_group_dm_handlers::create_group_dm).get(discreet_group_dm_handlers::list_group_dms))
        .route("/group-dms/:id", axum::routing::patch(discreet_group_dm_handlers::update_group_dm))
        .route("/group-dms/:id/messages", axum::routing::post(discreet_group_dm_handlers::send_group_dm).get(discreet_group_dm_handlers::get_group_dm_messages))
        .route("/group-dms/:id/members", axum::routing::post(discreet_group_dm_handlers::add_group_dm_member))
        .route("/group-dms/:id/members/:uid", axum::routing::delete(discreet_group_dm_handlers::remove_group_dm_member))
        // Streaming (Patent-Pending: Encrypted RTMP within MLS groups)
        .route("/channels/:channel_id/stream/start", axum::routing::post(discreet_stream_handlers::start_stream))
        .route("/channels/:channel_id/stream", axum::routing::delete(discreet_stream_handlers::stop_stream).get(discreet_stream_handlers::stream_status))
        // Forum channels
        .route("/channels/:channel_id/threads", axum::routing::get(discreet_forum_handlers::list_threads).post(discreet_forum_handlers::create_thread))
        .route("/threads/:thread_id", axum::routing::get(discreet_forum_handlers::get_thread).patch(discreet_forum_handlers::update_thread).delete(discreet_forum_handlers::delete_thread))
        .route("/threads/:thread_id/messages", axum::routing::get(discreet_forum_handlers::list_thread_messages).post(discreet_forum_handlers::post_thread_message))
        // ── MLS Key Distribution (RFC 9420) ──
        .route("/key-packages", axum::routing::post(discreet_mls_handlers::upload_key_packages))
        .route("/key-packages/:user_id", axum::routing::get(discreet_mls_handlers::claim_key_package))
        .route("/channels/:channel_id/mls/commit", axum::routing::post(discreet_mls_handlers::submit_commit))
        .route("/channels/:channel_id/mls/welcome", axum::routing::post(discreet_mls_handlers::relay_welcome))
        .route("/channels/:channel_id/mls/info", axum::routing::get(discreet_mls_handlers::mls_channel_info))
        .route("/identity-keys", axum::routing::post(discreet_mls_handlers::upload_identity_key))
        // ── Info ──
        .route("/info", axum::routing::get(discreet_health::server_info))
        // ── Premium / Subscription ──
        .route("/subscription", axum::routing::get(discreet_premium::get_subscription)
            .post(discreet_premium::create_subscription)
            .delete(discreet_premium::cancel_subscription))
        // ── Billing ──
        .route("/billing/status", axum::routing::get(discreet_billing_handlers::billing_status))
        .route("/billing/create-checkout", axum::routing::post(discreet_billing_handlers::create_checkout))
        // ── Waitlist ──
        .route("/waitlist", axum::routing::post(discreet_waitlist::join_waitlist))
        // ── Developer API Tokens ──
        .route("/dev/tokens", axum::routing::post(discreet_dev_token_handlers::create_token)
            .get(discreet_dev_token_handlers::list_tokens))
        .route("/dev/tokens/:id", axum::routing::delete(discreet_dev_token_handlers::revoke_token))
        // ── Platform identity & admin ──
        // /platform/*       — any authenticated user
        // /admin/* /dev/*   — require platform_role = 'admin' or 'dev'
        //                     (enforced inside each handler via require_staff_role)
        .route("/platform/me", axum::routing::get(discreet_platform_admin_handlers::platform_me))
        .route("/admin/stats", axum::routing::get(discreet_platform_admin_handlers::admin_stats))
        .route("/admin/users", axum::routing::get(discreet_platform_admin_handlers::list_users))
        .route("/admin/users/:user_id/role", axum::routing::post(discreet_platform_admin_handlers::set_user_role))
        .route("/admin/registrations", axum::routing::get(discreet_platform_admin_handlers::registration_trend))
        .route("/admin/generate-dev-accounts", axum::routing::post(discreet_platform_admin_handlers::generate_dev_accounts))
        .route("/admin/users/:user_id/ban", axum::routing::post(discreet_platform_admin_handlers::ban_user)
            .delete(discreet_platform_admin_handlers::unban_user))
        // ── Lockdown ──
        .route("/admin/lockdown", axum::routing::post(discreet_platform_admin_handlers::set_lockdown)
            .get(discreet_platform_admin_handlers::get_lockdown))
        // ── Bug Reports ──
        .route("/bug-reports", axum::routing::post(discreet_bug_report_handlers::submit_bug_report))
        .route("/admin/bug-reports", axum::routing::get(discreet_bug_report_handlers::list_bug_reports))
        // ── Platform settings (kill switches) ──
        // Content reports
        .route("/reports", axum::routing::post(discreet_report_handlers::create_report))
        .route("/admin/reports", axum::routing::get(discreet_report_handlers::list_reports))
        .route("/admin/reports/:report_id", axum::routing::patch(discreet_report_handlers::resolve_report))
        .route("/admin/export", axum::routing::post(discreet_platform_admin_handlers::compliance_export))
        .route("/admin/settings", axum::routing::get(discreet_platform_settings::get_settings)
            .put(discreet_platform_settings::update_settings))
        // Admin invite codes
        .route("/admin/invites", axum::routing::post(discreet_admin_invite_handlers::create_invite)
            .get(discreet_admin_invite_handlers::list_invites))
        .route("/admin/invites/:invite_id", axum::routing::delete(discreet_admin_invite_handlers::delete_invite))
        // Admin announcements
        .route("/admin/announcements", axum::routing::post(discreet_announcement_handlers::create_announcement)
            .get(discreet_announcement_handlers::list_announcements))
        // ── Server lifecycle admin ──
        .merge(discreet_server_handlers::server_admin_routes())
        // ── API 404 fallback — consistent JSON for unknown routes ──
        .fallback(|| async {
            (
                axum::http::StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "The requested API endpoint does not exist",
                    }
                })),
            )
        });

    // CORS: configurable via CORS_ORIGINS env var.
    // Not set   → use APP_URL if set, otherwise allow localhost:{PORT} only
    // "*"       → allow all origins (use only in development)
    // URL(s)    → allow only those origins (comma-separated)
    let cors = match std::env::var("CORS_ORIGINS").ok().as_deref() {
        Some("*") => {
            tracing::warn!("CORS_ORIGINS=* — allowing all origins (development mode)");
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers(Any)
        }
        Some(origins) => {
            let allowed: Vec<_> = origins.split(',').filter_map(|o| o.trim().parse().ok()).collect();
            CorsLayer::new()
                .allow_origin(allowed)
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers(Any)
        }
        None => {
            // No CORS_ORIGINS — derive from APP_URL, or fall back to localhost dev defaults.
            if let Some(ref app_url) = state.config.app_url {
                tracing::info!("CORS_ORIGINS not set — using APP_URL: {}", app_url);
                let allowed: Vec<_> = [app_url.as_str()]
                    .iter()
                    .filter_map(|o| o.parse().ok())
                    .collect();
                CorsLayer::new()
                    .allow_origin(allowed)
                    .allow_methods(Any)
                    .allow_headers(Any)
                    .expose_headers(Any)
            } else {
                tracing::info!(
                    "CORS_ORIGINS not set — allowing localhost:{} only",
                    state.config.port
                );
                let allowed: Vec<_> = [
                    format!("http://localhost:{}", state.config.port),
                    format!("http://127.0.0.1:{}", state.config.port),
                ]
                .iter()
                .filter_map(|o| o.parse().ok())
                .collect();
                CorsLayer::new()
                    .allow_origin(allowed)
                    .allow_methods(Any)
                    .allow_headers(Any)
                    .expose_headers(Any)
            }
        }
    };

    // Build the top-level router with middleware stack.
    let app = axum::Router::new()
        // Unversioned endpoints — registered before the catch-all SPA service.
        .route("/health", axum::routing::get(|| async { "OK" }))
        .route("/manifest.json", axum::routing::get(|| async {
            (
                [("content-type", "application/manifest+json")],
                include_str!("../client/public/manifest.json"),
            )
        }))
        .route("/ws", axum::routing::get(discreet_websocket::ws_connect))
        // Payment webhooks (unversioned — called by external services)
        .route("/webhooks/btcpay", axum::routing::post(discreet_billing_handlers::btcpay_webhook))
        .route("/webhooks/stripe", axum::routing::post(discreet_billing_handlers::stripe_webhook))
        // Versioned API.
        .nest("/api/v1", api_v1)
        // Invite deep-links — serve Vite client so it can handle /invite/:code
        .route(
            "/invite/:code",
            axum::routing::get(|| async {
                match tokio::fs::read_to_string("client/dist/index.html").await {
                    Ok(html) => axum::response::Html(html).into_response(),
                    Err(_) => axum::response::Redirect::temporary("/app").into_response(),
                }
            }),
        )
        // Vite client — serves client/dist/ at /app and returns index.html
        // for any path that doesn't match a static asset, enabling
        // React Router client-side navigation.
        .nest_service(
            "/app",
            tower_http::services::ServeDir::new("client/dist")
                .fallback(tower_http::services::ServeFile::new("client/dist/index.html")),
        )
        // Landing page — single-file HTML at root (client/public/landing.html).
        // No external assets required; falls back to /app if file is missing.
        .route(
            "/",
            axum::routing::get(|| async {
                match tokio::fs::read_to_string("client/public/landing.html").await {
                    Ok(html) => axum::response::Html(html).into_response(),
                    Err(_) => axum::response::Redirect::temporary("/app").into_response(),
                }
            }),
        )
        // Shared state.
        .with_state(state.clone())
        // Middleware stack — .layer() calls are applied bottom-up in Axum,
        // so the LAST call here (.layer(cors)) is the OUTERMOST wrapper and
        // the first to process each incoming request.
        //
        // Processing order:
        //   CORS → Rate Limit → Security Headers → CSRF → Request ID → Maintenance → Trace → Compression → Body Limit → Handler
        //
        // Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy,
        // Permissions-Policy, X-Content-Type-Options) are injected after CORS
        // preflight handling and before the route handlers run, ensuring every
        // response — including error responses — carries the full header set.
        //
        // CSRF (double-submit cookie) sits after Security Headers so that 403
        // CSRF rejection responses also carry all security headers.  Exempt
        // paths: /api/v1/auth/login, /register, /refresh, /ws, /health.
        // Body limit: config max_upload_bytes * 1.4 (base64 overhead) + 1 MB for JSON wrapper.
        // Per-endpoint validators enforce tighter limits. Oversized requests get 413 before full read.
        .layer(axum::extract::DefaultBodyLimit::max(state.config.max_upload_bytes * 14 / 10 + 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn_with_state(state.clone(), maintenance_middleware))
        .layer(axum::middleware::from_fn(request_id_middleware))
        .layer(axum::middleware::from_fn(discreet_csrf::csrf_middleware))
        .layer(axum::middleware::from_fn(
            discreet_security_headers::security_headers,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            discreet_rate_limit::rate_limit_middleware,
        ))
        .layer(cors);

    // Start listening.
    let listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!("Discreet server listening on {bind_addr}");
    tracing::info!("  API:        http://{bind_addr}/api/v1/");
    tracing::info!("  WebSocket:  ws://{bind_addr}/ws?server_id=<uuid>");
    tracing::info!("  Health:     http://{bind_addr}/health");
    tracing::info!("  Info:       http://{bind_addr}/api/v1/info");
    if let Some(ref url) = state.config.public_url {
        tracing::info!("  PUBLIC_URL: {}", url);
    }
    if let Some(ref url) = state.config.app_url {
        tracing::info!("  APP_URL:    {}", url);
    }
    if let Some(ref url) = state.config.api_url {
        tracing::info!("  API_URL:    {}", url);
    }
    if state.config.self_hosted {
        tracing::info!("  Mode:       self-hosted (enterprise tier, same-origin API)");
    }
    tracing::info!(
        "  Rate limit: {}/min per IP",
        state.config.rate_limit_per_minute
    );
    tracing::info!("  Zero-knowledge architecture active");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
