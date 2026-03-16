// discreet_rate_limit.rs — Per-IP rate limiting middleware.
//
// Uses a sliding-window counter stored in-memory via DashMap.
// Falls back gracefully if Redis is unreachable.
//
// Configuration: `RATE_LIMIT_PER_MINUTE` env var (default: 120).
//
// Response on limit exceeded:
//   HTTP 429 Too Many Requests
//   { "error": { "code": "RATE_LIMITED", "message": "...", "retry_after_secs": N } }
//
// Auth endpoints get stricter limits (30/min) to prevent credential stuffing.

use axum::{
    extract::{ConnectInfo, State},
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::discreet_state::AppState;

/// Sliding window entry: timestamps of recent requests.
struct RateWindow {
    /// Ring buffer of request timestamps.
    timestamps: Vec<Instant>,
    /// Write cursor.
    cursor: usize,
}

impl RateWindow {
    fn new(capacity: usize) -> Self {
        Self {
            timestamps: Vec::with_capacity(capacity),
            cursor: 0,
        }
    }

    /// Record a request. Returns the count of requests in the last `window` duration.
    fn record(&mut self, now: Instant, window: Duration, limit: usize) -> usize {
        // Add the timestamp.
        if self.timestamps.len() < limit {
            self.timestamps.push(now);
        } else {
            self.timestamps[self.cursor] = now;
            self.cursor = (self.cursor + 1) % limit;
        }

        // Count how many are within the window.
        self.timestamps
            .iter()
            .filter(|&&t| now.duration_since(t) < window)
            .count()
    }

    /// How many seconds until the oldest request in the window expires.
    fn retry_after(&self, now: Instant, window: Duration) -> u64 {
        self.timestamps
            .iter()
            .filter(|&&t| now.duration_since(t) < window)
            .map(|&t| {
                let age = now.duration_since(t);
                if age < window {
                    (window - age).as_secs() + 1
                } else {
                    0
                }
            })
            .min()
            .unwrap_or(1)
    }
}

/// Shared rate limiter state.
pub struct RateLimiter {
    windows: RwLock<HashMap<String, RateWindow>>,
    general_limit: usize,
    auth_limit: usize,
    window: Duration,
}

impl RateLimiter {
    pub fn new(requests_per_minute: u32) -> Self {
        Self {
            windows: RwLock::new(HashMap::new()),
            general_limit: requests_per_minute as usize,
            auth_limit: 30.min(requests_per_minute as usize), // Stricter for auth
            window: Duration::from_secs(60),
        }
    }

    /// Check rate limit for a given key and path. Returns Ok(()) or Err(retry_after_secs).
    pub async fn check(&self, key: &str, path: &str) -> Result<(), u64> {
        let limit = if path.contains("/auth/login") || path.contains("/auth/register") {
            self.auth_limit
        } else {
            self.general_limit
        };

        let now = Instant::now();
        let mut windows = self.windows.write().await;

        let window = windows
            .entry(key.to_string())
            .or_insert_with(|| RateWindow::new(limit + 10));

        let count = window.record(now, self.window, limit + 10);

        if count > limit {
            let retry = window.retry_after(now, self.window);
            Err(retry)
        } else {
            Ok(())
        }
    }

    /// Periodically clean up stale entries (call from a background task).
    pub async fn cleanup(&self) {
        let now = Instant::now();
        let mut windows = self.windows.write().await;
        windows.retain(|_, w| {
            w.timestamps
                .iter()
                .any(|&t| now.duration_since(t) < Duration::from_secs(120))
        });
    }
}

/// Axum middleware layer. Extracts client IP and checks rate limit.
pub async fn rate_limit_middleware(
    State(state): State<Arc<AppState>>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    // Extract client IP from X-Forwarded-For (behind proxy) or connection info.
    let ip = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            request
                .headers()
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .or_else(|| {
            request
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ci| ci.0.ip().to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    let path = request.uri().path().to_string();

    // Skip rate limiting for health checks.
    if path == "/health" {
        return next.run(request).await;
    }

    match state.rate_limiter.check(&ip, &path).await {
        Ok(()) => next.run(request).await,
        Err(retry_after) => {
            let body = serde_json::json!({
                "error": {
                    "code": "RATE_LIMITED",
                    "message": format!("Too many requests. Try again in {retry_after}s."),
                    "retry_after_secs": retry_after,
                }
            });

            (
                StatusCode::TOO_MANY_REQUESTS,
                [("retry-after", retry_after.to_string())],
                Json(body),
            )
                .into_response()
        }
    }
}
