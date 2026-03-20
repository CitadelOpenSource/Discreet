// discreet_metrics.rs — Monitoring endpoints and request instrumentation.
//
// Endpoints:
//   GET /health/detailed  — JSON with version, uptime, connectivity, live gauges
//   GET /metrics          — Prometheus text exposition format
//
// Middleware:
//   metrics_middleware    — Increments request counter and tracks latency

use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use crate::discreet_state::AppState;

// ─── GET /health/detailed ───────────────────────────────────────────────

/// Detailed health check returning server version, uptime, connectivity
/// status, and live gauge values as JSON.
pub async fn health_detailed(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // Uptime.
    let uptime_secs = state.started_at.elapsed().as_secs();

    // Database connectivity.
    let db_ok = sqlx::query_scalar!("SELECT 1 as alive")
        .fetch_one(&state.db)
        .await
        .is_ok();

    // Redis connectivity.
    let redis_ok = {
        let mut conn = state.redis.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .is_ok()
    };

    // Live gauges from shared state.
    let ws_connections = state.ws_buses.read().await.len();
    let online_users = state.presence.read().await.len();
    let voice_sessions = state.voice_state.read().await.len();

    // Aggregate counters from DB.
    let total_users: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM users")
        .fetch_one(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

    let total_messages: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM messages")
        .fetch_one(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

    axum::Json(serde_json::json!({
        "status": if db_ok && redis_ok { "healthy" } else { "degraded" },
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_seconds": uptime_secs,
        "connectivity": {
            "database": db_ok,
            "redis": redis_ok,
        },
        "gauges": {
            "ws_connections": ws_connections,
            "online_users": online_users,
            "voice_sessions": voice_sessions,
        },
        "totals": {
            "users": total_users,
            "messages": total_messages,
            "http_requests": state.http_requests_total.load(Ordering::Relaxed),
            "ws_messages": state.ws_messages_total.load(Ordering::Relaxed),
        },
    }))
}

// ─── GET /metrics ───────────────────────────────────────────────────────

/// Prometheus text exposition format.
///
/// Exports gauges (current values) and counters (monotonic totals).
/// Scrape interval: recommended 15-30 seconds.
pub async fn prometheus_metrics(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let uptime = state.started_at.elapsed().as_secs();
    let requests = state.http_requests_total.load(Ordering::Relaxed);
    let ws_msgs = state.ws_messages_total.load(Ordering::Relaxed);
    let duration_us = state.request_duration_us_total.load(Ordering::Relaxed);

    // Live gauges (hold read locks briefly).
    let ws_conns = state.ws_buses.read().await.len();
    let online = state.presence.read().await.len();
    let voice = state.voice_state.read().await.len();

    // DB pool stats from sqlx.
    let pool = &state.db;
    let pool_size = pool.size();
    let pool_idle = pool.num_idle();

    // Compute average request latency in seconds.
    let avg_latency_s = if requests > 0 {
        (duration_us as f64 / requests as f64) / 1_000_000.0
    } else {
        0.0
    };

    let body = format!(
        "# HELP discreet_up Server health (1 = healthy).\n\
         # TYPE discreet_up gauge\n\
         discreet_up 1\n\
         \n\
         # HELP discreet_uptime_seconds Seconds since server start.\n\
         # TYPE discreet_uptime_seconds gauge\n\
         discreet_uptime_seconds {uptime}\n\
         \n\
         # HELP discreet_http_requests_total Total HTTP requests served.\n\
         # TYPE discreet_http_requests_total counter\n\
         discreet_http_requests_total {requests}\n\
         \n\
         # HELP discreet_ws_messages_total Total WebSocket messages relayed.\n\
         # TYPE discreet_ws_messages_total counter\n\
         discreet_ws_messages_total {ws_msgs}\n\
         \n\
         # HELP discreet_request_duration_seconds_total Cumulative request duration.\n\
         # TYPE discreet_request_duration_seconds_total counter\n\
         discreet_request_duration_seconds_total {duration_s:.6}\n\
         \n\
         # HELP discreet_request_duration_seconds_avg Average request latency.\n\
         # TYPE discreet_request_duration_seconds_avg gauge\n\
         discreet_request_duration_seconds_avg {avg_latency_s:.6}\n\
         \n\
         # HELP discreet_ws_connections Active WebSocket server buses.\n\
         # TYPE discreet_ws_connections gauge\n\
         discreet_ws_connections {ws_conns}\n\
         \n\
         # HELP discreet_online_users Users currently online.\n\
         # TYPE discreet_online_users gauge\n\
         discreet_online_users {online}\n\
         \n\
         # HELP discreet_voice_sessions Active voice channel sessions.\n\
         # TYPE discreet_voice_sessions gauge\n\
         discreet_voice_sessions {voice}\n\
         \n\
         # HELP discreet_db_pool_size Database connection pool size.\n\
         # TYPE discreet_db_pool_size gauge\n\
         discreet_db_pool_size {pool_size}\n\
         \n\
         # HELP discreet_db_pool_idle Idle database connections.\n\
         # TYPE discreet_db_pool_idle gauge\n\
         discreet_db_pool_idle {pool_idle}\n",
        duration_s = duration_us as f64 / 1_000_000.0,
    );

    (
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        body,
    )
}

// ─── Middleware ──────────────────────────────────────────────────────────

/// Middleware that increments the HTTP request counter and tracks cumulative
/// request duration. Uses `AtomicU64` with `Relaxed` ordering for minimal
/// overhead on the hot path.
pub async fn metrics_middleware(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let start = std::time::Instant::now();

    let response = next.run(request).await;

    let elapsed_us = start.elapsed().as_micros() as u64;
    state
        .http_requests_total
        .fetch_add(1, Ordering::Relaxed);
    state
        .request_duration_us_total
        .fetch_add(elapsed_us, Ordering::Relaxed);

    response
}
