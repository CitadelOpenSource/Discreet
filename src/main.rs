// main.rs — Discreet server entry point.
//
// Loads configuration from environment, connects to PostgreSQL and Redis,
// registers all routes under /api/v1/*, and starts the Axum HTTP server.
//
// Middleware stack (outermost → innermost, i.e. request processing order):
//   Request
//     → CORS                 (tower_http::cors::CorsLayer)
//     → Rate Limit           (citadel_rate_limit)
//     → Security Headers     (citadel_security_headers — CSP, HSTS, X-Frame-Options, …)
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
// Unversioned routes: /health, /ws
// Versioned routes:   /api/v1/auth/*, /api/v1/servers/*, /api/v1/channels/*, etc.
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

use citadel_server::citadel_agent_handlers;
use citadel_server::citadel_audit;
use citadel_server::citadel_automod;
use citadel_server::citadel_auth_handlers;
use citadel_server::citadel_ban_handlers;
use citadel_server::citadel_bot_spawn_handlers;
use citadel_server::citadel_bug_report_handlers;
use citadel_server::citadel_channel_handlers;
use citadel_server::citadel_category_handlers;
use citadel_server::citadel_config::Config;
use citadel_server::citadel_csrf;
use citadel_server::citadel_discovery_handlers;
use citadel_server::citadel_dm_handlers;
use citadel_server::citadel_mls_handlers;
use citadel_server::citadel_email_handlers;
use citadel_server::citadel_emoji_handlers;
use citadel_server::citadel_event_handlers;
use citadel_server::citadel_file_handlers;
use citadel_server::citadel_forum_handlers;
use citadel_server::citadel_friend_handlers;
use citadel_server::citadel_group_dm_handlers;
use citadel_server::citadel_health;
use citadel_server::citadel_meeting_handlers;
use citadel_server::citadel_message_handlers;
use citadel_server::citadel_notification_handlers;
use citadel_server::citadel_pin_handlers;
use citadel_server::citadel_poll_handlers;
use citadel_server::citadel_rate_limit;
use citadel_server::citadel_reaction_handlers;
use citadel_server::citadel_role_handlers;
use citadel_server::citadel_security_headers;
use citadel_server::citadel_server_handlers;
use citadel_server::citadel_settings_handlers;
use citadel_server::citadel_soundboard_handlers;
use citadel_server::citadel_stream_handlers;
use citadel_server::citadel_state::AppState;
use citadel_server::citadel_typing;
use citadel_server::citadel_user_handlers;
use citadel_server::citadel_dev_token_handlers;
use citadel_server::citadel_platform_admin_handlers;
use citadel_server::citadel_premium;
use citadel_server::citadel_platform_settings;
use citadel_server::citadel_waitlist;
use citadel_server::citadel_websocket;
use citadel_server::discreet_ack_handlers;
use citadel_server::discreet_billing_handlers;
use citadel_server::discreet_bookmark_handlers;
use citadel_server::discreet_channel_category_handlers;
use citadel_server::discreet_playbook_handlers;
use citadel_server::discreet_report_handlers;
use citadel_server::discreet_scheduled_task_handlers;

/// Middleware: maintenance mode gate.
/// If maintenance_mode is enabled in platform_settings (cached in Redis),
/// reject all requests except /health and /api/v1/admin/* with 503.
async fn maintenance_middleware(
    State(state): State<Arc<AppState>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = request.uri().path().to_string();

    // Always allow admin endpoints and health check through.
    if path == "/health" || path.starts_with("/api/v1/admin/") {
        return next.run(request).await;
    }

    // Check Redis for cached maintenance flag (avoids DB hit).
    // Single GET — parse both maintenance_mode and maintenance_message from the same JSON.
    let mut redis = state.redis.clone();
    let cached: Option<serde_json::Value> = redis::cmd("GET")
        .arg("platform_settings")
        .query_async::<_, Option<String>>(&mut redis)
        .await
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok());

    let in_maintenance = cached
        .as_ref()
        .and_then(|v| v.get("maintenance_mode")?.as_bool())
        .unwrap_or(false);

    if in_maintenance {
        let message = cached
            .as_ref()
            .and_then(|v| v.get("maintenance_message")?.as_str().map(String::from))
            .unwrap_or_else(|| "Discreet is undergoing scheduled maintenance. Please try again shortly.".into());

        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "error": {
                    "code": "SERVICE_UNAVAILABLE",
                    "message": message,
                },
                "maintenance": true,
            })),
        )
            .into_response();
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
        .unwrap_or_else(|_| "citadel_server=debug,tower_http=debug".into());

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

    // Warn if TOTP encryption key is missing in production-like environments.
    // The server still starts (key is derived from JWT_SECRET as fallback),
    // but a dedicated key is strongly recommended for production.
    if config.totp_encryption_key.is_none() {
        let cors = std::env::var("CORS_ORIGINS").unwrap_or_default();
        let is_prod = (cors != "*" && !cors.is_empty()) || config.host == "0.0.0.0";
        if is_prod {
            tracing::warn!(
                "TOTP_ENCRYPTION_KEY is not set — TOTP secrets are encrypted with a key \
                 derived from JWT_SECRET. Set a dedicated 64-hex-char key in production: \
                 TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)"
            );
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
                        .query_async::<_, Option<String>>(&mut r)
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
                    let _ = citadel_audit::log_action(
                        &db,
                        citadel_audit::AuditEntry {
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
        tokio::spawn(citadel_event_handlers::reminder_dispatcher(db, st));
    }

    // Background task: execute scheduled tasks (channel monitors, announcements, etc.) every 60 seconds.
    {
        let db = state.db.clone();
        let st = state.clone();
        tokio::spawn(citadel_server::discreet_task_executor::task_executor_loop(db, st));
    }

    // Build the versioned API sub-router.
    // ALL routes registered on a single Router to avoid Axum merge() conflicts
    // with overlapping path prefixes (e.g. /servers/:id + /servers/:id/channels).
    let api_v1 = axum::Router::new()
        // ── Auth ──
        .route("/auth/register", axum::routing::post(citadel_auth_handlers::register))
        .route("/auth/guest", axum::routing::post(citadel_auth_handlers::register_guest))
        .route("/auth/login", axum::routing::post(citadel_auth_handlers::login))
        .route("/auth/upgrade", axum::routing::post(citadel_auth_handlers::upgrade_account))
        .route("/auth/recover-account", axum::routing::post(citadel_auth_handlers::recover_account))
        // Email verification & password reset
        .route("/auth/verify-email/send", axum::routing::post(citadel_email_handlers::send_verification))
        .route("/auth/verify-email/confirm", axum::routing::post(citadel_email_handlers::confirm_email))
        // Link-based verification (GET with ?token=... — no JWT needed, used from emails)
        .route("/auth/verify-email", axum::routing::get(citadel_email_handlers::verify_email_by_token))
        // Resend verification email (JWT required, max 3/hour)
        .route("/auth/resend-verification", axum::routing::post(citadel_email_handlers::resend_verification))
        // 6-digit code verification (JWT required)
        .route("/auth/verify-code", axum::routing::post(citadel_auth_handlers::verify_registration_code))
        .route("/auth/resend-code", axum::routing::post(citadel_auth_handlers::resend_registration_code))
        .route("/auth/forgot-password", axum::routing::post(citadel_email_handlers::forgot_password))
        .route("/auth/reset-password", axum::routing::post(citadel_email_handlers::reset_password))
        // Server discovery
        .route("/discover", axum::routing::get(citadel_discovery_handlers::discover_servers))
        .route("/servers/:server_id/publish", axum::routing::post(citadel_discovery_handlers::publish_server))
        .route("/servers/:server_id/unpublish", axum::routing::post(citadel_discovery_handlers::unpublish_server))
        .route("/auth/refresh", axum::routing::post(citadel_auth_handlers::refresh))
        .route("/auth/me/refresh", axum::routing::get(citadel_auth_handlers::refresh_claims))
        .route("/auth/logout", axum::routing::post(citadel_auth_handlers::logout))
        .route("/auth/verify-password", axum::routing::post(citadel_auth_handlers::verify_password_endpoint))
        .route("/auth/sessions", axum::routing::get(citadel_auth_handlers::list_sessions))
        .route("/auth/sessions/all-others", axum::routing::delete(citadel_auth_handlers::revoke_all_other_sessions))
        .route("/auth/sessions/:id", axum::routing::delete(citadel_auth_handlers::revoke_session))
        .route("/auth/sessions/:id/verify", axum::routing::post(citadel_auth_handlers::initiate_verify))
        .route("/auth/sessions/:id/confirm", axum::routing::post(citadel_auth_handlers::confirm_verify))
        // ── 2FA (login completion — no JWT required) ──
        .route("/auth/2fa/verify", axum::routing::post(citadel_auth_handlers::complete_2fa_login))
        // ── 2FA management (JWT required) ──
        .route("/users/@me/2fa/setup", axum::routing::post(citadel_auth_handlers::setup_2fa))
        .route("/users/@me/2fa/verify", axum::routing::post(citadel_auth_handlers::verify_2fa))
        .route("/users/@me/2fa/disable", axum::routing::post(citadel_auth_handlers::disable_2fa))
        // ── Servers ──
        .route("/servers", axum::routing::post(citadel_server_handlers::create_server).get(citadel_server_handlers::list_servers))
        .route("/servers/:server_id", axum::routing::get(citadel_server_handlers::get_server).patch(citadel_server_handlers::update_server).delete(citadel_server_handlers::delete_server))
        .route("/servers/:server_id/join", axum::routing::post(citadel_server_handlers::join_server))
        .route("/servers/:server_id/leave", axum::routing::post(citadel_server_handlers::leave_server))
        .route("/servers/:server_id/members", axum::routing::get(citadel_server_handlers::list_members))
        .route("/servers/:server_id/invites", axum::routing::post(citadel_server_handlers::create_invite).get(citadel_server_handlers::list_invites))
        .route("/servers/:server_id/vanity", axum::routing::post(citadel_server_handlers::set_server_vanity))
        .route("/invites/:code", axum::routing::get(citadel_server_handlers::resolve_invite_code))
        .route("/servers/:server_id/audit-log", axum::routing::get(citadel_audit::list_audit_log))
        .route("/servers/:server_id/audit-log/verify", axum::routing::get(citadel_audit::verify_audit_chain))
        .route("/servers/:server_id/audit-log/:entry_id", axum::routing::get(citadel_audit::get_audit_entry))
        // Custom emoji
        .route("/servers/:server_id/emojis", axum::routing::get(citadel_emoji_handlers::list_emojis).post(citadel_emoji_handlers::upload_emoji))
        .route("/servers/:server_id/emojis/:id", axum::routing::delete(citadel_emoji_handlers::delete_emoji))
        // Events
        .route("/servers/:server_id/events", axum::routing::get(citadel_event_handlers::list_events).post(citadel_event_handlers::create_event))
        .route("/events/:event_id", axum::routing::put(citadel_event_handlers::update_event).delete(citadel_event_handlers::delete_event))
        .route("/events/:event_id/rsvp", axum::routing::post(citadel_event_handlers::rsvp_event))
        .route("/events/:event_id/rsvps", axum::routing::get(citadel_event_handlers::list_rsvps))
        .route("/events/:event_id/remind", axum::routing::post(citadel_event_handlers::remind_event))
        // Notifications
        .route("/notifications", axum::routing::get(citadel_notification_handlers::list_notifications))
        .route("/notifications/unread-count", axum::routing::get(citadel_notification_handlers::unread_count))
        .route("/notifications/read-all", axum::routing::post(citadel_notification_handlers::mark_all_read))
        .route("/notifications/:notification_id/read", axum::routing::patch(citadel_notification_handlers::mark_read))
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
        .route("/servers/:server_id/automod", axum::routing::get(citadel_automod::get_automod_config).put(citadel_automod::update_automod_config))
        .route("/servers/:server_id/soundboard", axum::routing::get(citadel_soundboard_handlers::list_clips).post(citadel_soundboard_handlers::upload_clip))
        .route("/servers/:server_id/soundboard/:id", axum::routing::delete(citadel_soundboard_handlers::delete_clip))
        .route("/servers/:server_id/soundboard/:id/play", axum::routing::post(citadel_soundboard_handlers::play_clip))
        // AI Bot Spawn (Patent-Pending)
        .route("/bots/personas", axum::routing::get(citadel_bot_spawn_handlers::list_personas))
        .route("/bots/spawn", axum::routing::post(citadel_bot_spawn_handlers::spawn_bot_channel))
        .route("/bots/channels", axum::routing::get(citadel_bot_spawn_handlers::list_bot_channels))
        .route("/bots/channels/:id", axum::routing::delete(citadel_bot_spawn_handlers::close_bot_channel))
        .route("/servers/:server_id/ai-bots", axum::routing::get(citadel_bot_spawn_handlers::list_server_bots).post(citadel_bot_spawn_handlers::add_bot_to_server))
        .route("/servers/:server_id/ai-bots/:bot_id", axum::routing::patch(citadel_bot_spawn_handlers::update_bot_config).delete(citadel_bot_spawn_handlers::remove_bot_from_server))
        .route("/servers/:server_id/ai-bots/:bot_id/prompt", axum::routing::post(citadel_bot_spawn_handlers::prompt_bot))
        .route("/servers/:server_id/ai-bots/:bot_id/config", axum::routing::get(citadel_bot_spawn_handlers::get_agent_config).put(citadel_bot_spawn_handlers::update_agent_config))
        .route("/servers/:server_id/ai-bots/:bot_id/memory", axum::routing::delete(citadel_bot_spawn_handlers::delete_agent_memory))
        // Meetings (Zoom-style)
        .route("/meetings", axum::routing::post(citadel_meeting_handlers::create_meeting).get(citadel_meeting_handlers::list_my_meetings))
        .route("/meetings/:code", axum::routing::get(citadel_meeting_handlers::get_meeting_info).delete(citadel_meeting_handlers::end_meeting))
        .route("/meetings/:code/join", axum::routing::post(citadel_meeting_handlers::join_meeting))
        // Polls
        .route("/channels/:channel_id/polls", axum::routing::post(citadel_poll_handlers::create_poll).get(citadel_poll_handlers::list_polls))
        .route("/polls/:poll_id", axum::routing::get(citadel_poll_handlers::get_poll).delete(citadel_poll_handlers::delete_poll))
        .route("/polls/:poll_id/vote", axum::routing::post(citadel_poll_handlers::vote_poll))
        // ── Categories ──
        .route("/servers/:server_id/categories", axum::routing::post(citadel_category_handlers::create_category).get(citadel_category_handlers::list_categories))
        .route("/servers/:server_id/categories/:id", axum::routing::patch(citadel_category_handlers::update_category).delete(citadel_category_handlers::delete_category))
        .route("/servers/:server_id/channels/:id/move", axum::routing::patch(citadel_category_handlers::move_channel_to_category))
        // ── Channels ──
        .route("/servers/:server_id/channels", axum::routing::post(citadel_channel_handlers::create_channel).get(citadel_channel_handlers::list_channels))
        .route("/channels/:channel_id", axum::routing::get(citadel_channel_handlers::get_channel).patch(citadel_channel_handlers::update_channel).delete(citadel_channel_handlers::delete_channel))
        // ── Messages ──
        .route("/channels/:channel_id/messages", axum::routing::post(citadel_message_handlers::send_message).get(citadel_message_handlers::get_messages))
        .route("/channels/:channel_id/messages/search", axum::routing::get(citadel_message_handlers::search_messages))
        .route("/messages/:id", axum::routing::patch(citadel_message_handlers::edit_message).delete(citadel_message_handlers::delete_message))
        .route("/messages/:id/ack", axum::routing::post(discreet_ack_handlers::ack_message))
        .route("/messages/:id/acks", axum::routing::get(discreet_ack_handlers::get_acks))
        // ── Pins ──
        .route("/servers/:server_id/channels/:channel_id/pins/:message_id", axum::routing::post(citadel_pin_handlers::pin_message).delete(citadel_pin_handlers::unpin_message))
        .route("/servers/:server_id/channels/:channel_id/pins", axum::routing::get(citadel_pin_handlers::list_pinned_messages))
        // ── Reactions ──
        .route("/channels/:channel_id/messages/:msg_id/reactions/:emoji", axum::routing::put(citadel_reaction_handlers::add_reaction).delete(citadel_reaction_handlers::remove_reaction))
        .route("/channels/:channel_id/messages/:msg_id/reactions", axum::routing::get(citadel_reaction_handlers::list_reactions))
        // ── Typing ──
        .route("/channels/:channel_id/typing", axum::routing::post(citadel_typing::start_typing))
        // ── Files ──
        .route("/channels/:channel_id/files", axum::routing::post(citadel_file_handlers::upload_file_blob))
        .route("/files/:id", axum::routing::get(citadel_file_handlers::download_file_blob))
        // ── Roles ──
        .route("/servers/:server_id/roles", axum::routing::post(citadel_role_handlers::create_role).get(citadel_role_handlers::list_roles))
        .route("/roles/:role_id", axum::routing::patch(citadel_role_handlers::update_role).delete(citadel_role_handlers::delete_role))
        .route("/servers/:server_id/members/:user_id/nickname", axum::routing::put(citadel_server_handlers::set_nickname))
        .route("/servers/:server_id/members/:user_id/roles/:role_id", axum::routing::put(citadel_role_handlers::assign_role).delete(citadel_role_handlers::unassign_role))
        .route("/servers/:server_id/members/:user_id/roles", axum::routing::get(citadel_role_handlers::list_member_roles))
        // ── Bans ──
        .route("/servers/:server_id/bans", axum::routing::post(citadel_ban_handlers::ban_member).get(citadel_ban_handlers::list_bans))
        .route("/servers/:server_id/bans/:user_id", axum::routing::delete(citadel_ban_handlers::unban_member))
        // ── Agents ──
        .route("/agents/search", axum::routing::post(citadel_agent_handlers::search_or_spawn))
        .route("/agents/spawn/:id/status", axum::routing::get(citadel_agent_handlers::get_spawn_status))
        .route("/servers/:server_id/agents", axum::routing::get(citadel_agent_handlers::list_agents))
        // ── Bots ──
        .route("/servers/:server_id/bots", axum::routing::post(citadel_server_handlers::create_bot).get(citadel_server_handlers::list_bots))
        .route("/servers/:server_id/archive", axum::routing::post(citadel_server_handlers::archive_server))
        .route("/servers/:server_id/schedule-deletion", axum::routing::post(citadel_server_handlers::schedule_server_deletion))
        // ── Users ──
        .route("/users/@me", axum::routing::get(citadel_user_handlers::get_me).patch(citadel_user_handlers::update_me).delete(citadel_user_handlers::delete_account))
        .route("/users/@me/servers", axum::routing::get(citadel_user_handlers::list_my_servers))
        .route("/users/@me/export", axum::routing::get(citadel_user_handlers::export_my_data))
        .route("/users/@me/status", axum::routing::put(citadel_user_handlers::update_status))
        .route("/users/@me/settings", axum::routing::get(citadel_settings_handlers::get_my_settings).patch(citadel_settings_handlers::patch_my_settings))
        .route("/settings/timezone", axum::routing::post(citadel_settings_handlers::set_timezone))
        .route("/servers/:server_id/notification-settings", axum::routing::get(citadel_settings_handlers::get_server_notification_settings).patch(citadel_settings_handlers::patch_server_notification_settings))
        .route("/servers/:server_id/notification-level", axum::routing::patch(citadel_server_handlers::set_notification_level))
        .route("/servers/:server_id/visibility", axum::routing::patch(citadel_server_handlers::set_visibility_override))
        .route("/users/search", axum::routing::get(citadel_friend_handlers::search_users))
        .route("/users/:id", axum::routing::get(citadel_user_handlers::get_user))
        .route("/users/:id/block", axum::routing::post(citadel_friend_handlers::block_user).delete(citadel_friend_handlers::unblock_user))
        // ── Friends ──
        .route("/friends", axum::routing::get(citadel_friend_handlers::list_friends))
        .route("/friends/request", axum::routing::post(citadel_friend_handlers::send_friend_request))
        .route("/friends/requests", axum::routing::get(citadel_friend_handlers::list_incoming_requests))
        .route("/friends/outgoing", axum::routing::get(citadel_friend_handlers::list_outgoing_requests))
        .route("/friends/:id/accept", axum::routing::post(citadel_friend_handlers::accept_friend_request))
        .route("/friends/:id/decline", axum::routing::post(citadel_friend_handlers::decline_friend_request))
        .route("/friends/:id", axum::routing::delete(citadel_friend_handlers::remove_friend))
        // ── DMs ──
        .route("/dms", axum::routing::post(citadel_dm_handlers::create_dm).get(citadel_dm_handlers::list_dms))
        .route("/dms/:id/messages", axum::routing::post(citadel_dm_handlers::send_dm).get(citadel_dm_handlers::get_dm_messages))
        // Group DMs
        .route("/group-dms", axum::routing::post(citadel_group_dm_handlers::create_group_dm).get(citadel_group_dm_handlers::list_group_dms))
        .route("/group-dms/:id", axum::routing::patch(citadel_group_dm_handlers::update_group_dm))
        .route("/group-dms/:id/messages", axum::routing::post(citadel_group_dm_handlers::send_group_dm).get(citadel_group_dm_handlers::get_group_dm_messages))
        .route("/group-dms/:id/members", axum::routing::post(citadel_group_dm_handlers::add_group_dm_member))
        .route("/group-dms/:id/members/:uid", axum::routing::delete(citadel_group_dm_handlers::remove_group_dm_member))
        // Streaming (Patent-Pending: Encrypted RTMP within MLS groups)
        .route("/channels/:channel_id/stream/start", axum::routing::post(citadel_stream_handlers::start_stream))
        .route("/channels/:channel_id/stream", axum::routing::delete(citadel_stream_handlers::stop_stream).get(citadel_stream_handlers::stream_status))
        // Forum channels
        .route("/channels/:channel_id/threads", axum::routing::get(citadel_forum_handlers::list_threads).post(citadel_forum_handlers::create_thread))
        .route("/threads/:thread_id", axum::routing::get(citadel_forum_handlers::get_thread).patch(citadel_forum_handlers::update_thread).delete(citadel_forum_handlers::delete_thread))
        .route("/threads/:thread_id/messages", axum::routing::get(citadel_forum_handlers::list_thread_messages).post(citadel_forum_handlers::post_thread_message))
        // ── MLS Key Distribution (RFC 9420) ──
        .route("/key-packages", axum::routing::post(citadel_mls_handlers::upload_key_packages))
        .route("/key-packages/:user_id", axum::routing::get(citadel_mls_handlers::claim_key_package))
        .route("/channels/:channel_id/mls/commit", axum::routing::post(citadel_mls_handlers::submit_commit))
        .route("/channels/:channel_id/mls/welcome", axum::routing::post(citadel_mls_handlers::relay_welcome))
        .route("/channels/:channel_id/mls/info", axum::routing::get(citadel_mls_handlers::mls_channel_info))
        .route("/identity-keys", axum::routing::post(citadel_mls_handlers::upload_identity_key))
        // ── Info ──
        .route("/info", axum::routing::get(citadel_health::server_info))
        // ── Premium / Subscription ──
        .route("/subscription", axum::routing::get(citadel_premium::get_subscription)
            .post(citadel_premium::create_subscription)
            .delete(citadel_premium::cancel_subscription))
        // ── Billing ──
        .route("/billing/status", axum::routing::get(discreet_billing_handlers::billing_status))
        .route("/billing/create-checkout", axum::routing::post(discreet_billing_handlers::create_checkout))
        // ── Waitlist ──
        .route("/waitlist", axum::routing::post(citadel_waitlist::join_waitlist))
        // ── Developer API Tokens ──
        .route("/dev/tokens", axum::routing::post(citadel_dev_token_handlers::create_token)
            .get(citadel_dev_token_handlers::list_tokens))
        .route("/dev/tokens/:id", axum::routing::delete(citadel_dev_token_handlers::revoke_token))
        // ── Platform identity & admin ──
        // /platform/*       — any authenticated user
        // /admin/* /dev/*   — require platform_role = 'admin' or 'dev'
        //                     (enforced inside each handler via require_staff_role)
        .route("/platform/me", axum::routing::get(citadel_platform_admin_handlers::platform_me))
        .route("/admin/stats", axum::routing::get(citadel_platform_admin_handlers::admin_stats))
        .route("/admin/users", axum::routing::get(citadel_platform_admin_handlers::list_users))
        .route("/admin/users/:user_id/role", axum::routing::post(citadel_platform_admin_handlers::set_user_role))
        .route("/admin/registrations", axum::routing::get(citadel_platform_admin_handlers::registration_trend))
        .route("/admin/generate-dev-accounts", axum::routing::post(citadel_platform_admin_handlers::generate_dev_accounts))
        .route("/admin/users/:user_id/ban", axum::routing::post(citadel_platform_admin_handlers::ban_user)
            .delete(citadel_platform_admin_handlers::unban_user))
        // ── Bug Reports ──
        .route("/bug-reports", axum::routing::post(citadel_bug_report_handlers::submit_bug_report))
        .route("/admin/bug-reports", axum::routing::get(citadel_bug_report_handlers::list_bug_reports))
        // ── Platform settings (kill switches) ──
        // Content reports
        .route("/reports", axum::routing::post(discreet_report_handlers::create_report))
        .route("/admin/reports", axum::routing::get(discreet_report_handlers::list_reports))
        .route("/admin/reports/:report_id", axum::routing::patch(discreet_report_handlers::resolve_report))
        .route("/admin/export", axum::routing::post(citadel_platform_admin_handlers::compliance_export))
        .route("/admin/settings", axum::routing::get(citadel_platform_settings::get_settings)
            .put(citadel_platform_settings::update_settings))
        // ── Server lifecycle admin ──
        .merge(citadel_server_handlers::server_admin_routes())
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
    // Not set   → allow only http://localhost:3000 and http://127.0.0.1:3000
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
            tracing::info!("CORS_ORIGINS not set — allowing localhost:3000 only");
            let allowed: Vec<_> = [
                "http://localhost:3000",
                "http://127.0.0.1:3000",
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
    };

    // Build the top-level router with middleware stack.
    let app = axum::Router::new()
        // Unversioned endpoints — registered before the catch-all SPA service.
        .route("/health", axum::routing::get(|| async { "OK" }))
        .route("/manifest.json", axum::routing::get(|| async {
            (
                [("content-type", "application/manifest+json")],
                include_str!("../client/manifest.json"),
            )
        }))
        .route("/ws", axum::routing::get(citadel_websocket::ws_connect))
        // Payment webhooks (unversioned — called by external services)
        .route("/webhooks/btcpay", axum::routing::post(discreet_billing_handlers::btcpay_webhook))
        .route("/webhooks/stripe", axum::routing::post(discreet_billing_handlers::stripe_webhook))
        // Legacy client — emergency fallback only.
        .route(
            "/legacy/",
            axum::routing::get(|| async {
                axum::response::Html(include_str!("../client/index.html"))
            }),
        )
        // Versioned API.
        .nest("/api/v1", api_v1)
        // Invite deep-links — serve Vite client so it can handle /invite/:code
        .route(
            "/invite/:code",
            axum::routing::get(|| async {
                match tokio::fs::read_to_string("client-next/dist/index.html").await {
                    Ok(html) => axum::response::Html(html).into_response(),
                    Err(_) => axum::response::Redirect::temporary("/app").into_response(),
                }
            }),
        )
        // Vite client — serves client-next/dist/ at /app and returns index.html
        // for any path that doesn't match a static asset, enabling
        // React Router client-side navigation.
        .nest_service(
            "/app",
            tower_http::services::ServeDir::new("client-next/dist")
                .fallback(tower_http::services::ServeFile::new("client-next/dist/index.html")),
        )
        // Landing page — static HTML at root.
        .nest_service(
            "/",
            tower_http::services::ServeDir::new("static")
                .fallback(tower_http::services::ServeFile::new("static/index.html")),
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
        .layer(axum::middleware::from_fn(citadel_csrf::csrf_middleware))
        .layer(axum::middleware::from_fn(
            citadel_security_headers::security_headers,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            citadel_rate_limit::rate_limit_middleware,
        ))
        .layer(cors);

    // Start listening.
    let listener = TcpListener::bind(&bind_addr).await?;
    tracing::info!("Discreet server listening on {bind_addr}");
    tracing::info!("  API:        http://{bind_addr}/api/v1/");
    tracing::info!("  WebSocket:  ws://{bind_addr}/ws?server_id=<uuid>");
    tracing::info!("  Health:     http://{bind_addr}/health");
    tracing::info!("  Info:       http://{bind_addr}/api/v1/info");
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
