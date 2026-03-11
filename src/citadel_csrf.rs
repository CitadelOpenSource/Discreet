// citadel_csrf.rs — CSRF protection via the double-submit cookie pattern.
//
// HOW IT WORKS
// ─────────────────────────────────────────────────────────────────────────────
// 1. On every response the middleware sets a `csrf_token` cookie.
//    The cookie is NOT HttpOnly so JavaScript can read it.
//
// 2. The client reads the cookie and echoes it back on every state-changing
//    request (POST / PUT / PATCH / DELETE) in the `X-CSRF-Token` request header.
//
// 3. The middleware compares the cookie value with the header value.
//    If they differ, or the header is absent, it short-circuits with 403.
//
// Why this works:
//    Cross-origin requests cannot read Same-Site=Strict cookies, so an attacker
//    cannot discover the token value to forge the matching header.
//
// EXEMPT PATHS (no CSRF check applied)
// ─────────────────────────────────────────────────────────────────────────────
//  /api/v1/auth/login         — no session exists yet
//  /api/v1/auth/register      — no session exists yet
//  /api/v1/auth/guest         — no session exists yet
//  /api/v1/auth/refresh       — token exchange, bearer auth only
//  /api/v1/auth/2fa/verify    — login completion, no session yet
//  /ws                        — WebSocket upgrade (GET semantics)
//  /health                    — monitoring probe (GET only)
//
// COOKIE ATTRIBUTES
// ─────────────────────────────────────────────────────────────────────────────
//  Name:     csrf_token
//  Value:    32 random bytes encoded as 64 hex characters
//  SameSite: Strict  — blocks cross-site cookie sending entirely
//  HttpOnly: (absent / false) — JS must read it to set the header
//  Secure:   present  — cookie only sent over HTTPS
//  Path:     /
//  Max-Age:  86400 (24 hours); refreshed on every response

use axum::{
    extract::Request,
    http::{header, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use rand::RngCore;

const CSRF_COOKIE_NAME: &str = "csrf_token";
const CSRF_HEADER_NAME: &str = "X-CSRF-Token";

/// Paths that are completely exempt from the CSRF check.
/// Stored as full paths; prefix-matched for `/ws` and `/health`.
const EXEMPT_PATHS: &[&str] = &[
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/guest",
    "/api/v1/auth/refresh",
    "/api/v1/auth/2fa/verify",
    "/ws",
    "/health",
];

// ─── Middleware ──────────────────────────────────────────────────────────────

/// Tower-compatible Axum middleware function.
///
/// Register with:
/// ```rust
/// .layer(axum::middleware::from_fn(citadel_csrf::csrf_middleware))
/// ```
///
/// Place the `.layer()` call **between** the security-headers layer and the
/// TraceLayer so that CSRF rejections are also covered by security headers.
pub async fn csrf_middleware(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path   = request.uri().path().to_owned();

    // Extract the CSRF token value from the incoming Cookie header (if any).
    let cookie_token = extract_csrf_cookie(request.headers());

    // ── Validation ────────────────────────────────────────────────────────
    // Only state-changing methods are checked; GET / HEAD / OPTIONS are safe
    // (no side effects) and WebSocket upgrades use GET.
    let is_mutating = matches!(
        method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );

    if is_mutating && !is_exempt(&path) {
        // Read the X-CSRF-Token header the client should have sent.
        let header_token = request
            .headers()
            .get(CSRF_HEADER_NAME)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_owned());

        // Both values must be present and identical.
        let valid = match (&cookie_token, &header_token) {
            (Some(cookie), Some(hdr)) => cookie == hdr,
            _ => false,
        };

        if !valid {
            tracing::warn!(
                method = %method,
                path   = %path,
                cookie_present = cookie_token.is_some(),
                header_present = header_token.is_some(),
                "CSRF token mismatch — request rejected",
            );
            return (
                StatusCode::FORBIDDEN,
                axum::Json(serde_json::json!({
                    "error": {
                        "code":    "CSRF_TOKEN_MISMATCH",
                        "message": "CSRF token mismatch",
                    }
                })),
            )
            .into_response();
        }
    }

    // ── Inner handler ─────────────────────────────────────────────────────
    let mut response = next.run(request).await;

    // ── Set / refresh cookie ──────────────────────────────────────────────
    // Reuse the existing token if the browser already has one; generate a new
    // one for first-time visitors.  Refreshing on every response resets the
    // Max-Age sliding window.
    let token = cookie_token.unwrap_or_else(generate_csrf_token);

    // NOTE: Secure requires HTTPS. In local development without TLS, remove
    // the `; Secure` fragment or terminate TLS at the reverse proxy.
    let cookie_str = format!(
        "{}={}; SameSite=Strict; Path=/; Max-Age=86400; Secure",
        CSRF_COOKIE_NAME, token,
    );

    if let Ok(val) = axum::http::HeaderValue::from_str(&cookie_str) {
        response.headers_mut().append(header::SET_COOKIE, val);
    }

    response
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Returns true when `path` should skip CSRF validation.
fn is_exempt(path: &str) -> bool {
    // Exact matches for /api/v1/auth/* bootstrap endpoints.
    if EXEMPT_PATHS.iter().any(|p| path == *p) {
        return true;
    }
    // Prefix matches for /ws (WebSocket) and /health (monitoring).
    path.starts_with("/ws") || path.starts_with("/health")
}

/// Parse the `csrf_token` value out of the Cookie header.
///
/// Handles multiple cookies in a single header value (semicolon-separated).
fn extract_csrf_cookie(headers: &axum::http::HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    let prefix = format!("{}=", CSRF_COOKIE_NAME);
    raw.split(';').find_map(|pair| {
        pair.trim()
            .strip_prefix(&prefix)
            .map(|val| val.to_owned())
    })
}

/// Generate a cryptographically random CSRF token: 32 bytes → 64 hex chars.
fn generate_csrf_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn exempt_exact_paths() {
        assert!(is_exempt("/api/v1/auth/login"));
        assert!(is_exempt("/api/v1/auth/register"));
        assert!(is_exempt("/api/v1/auth/refresh"));
        assert!(is_exempt("/health"));
        assert!(is_exempt("/ws"));
    }

    #[test]
    fn exempt_ws_prefix() {
        assert!(is_exempt("/ws?server_id=abc"));
        assert!(is_exempt("/ws/"));
    }

    #[test]
    fn non_exempt_paths() {
        assert!(!is_exempt("/api/v1/servers"));
        assert!(!is_exempt("/api/v1/users/@me"));
        assert!(!is_exempt("/api/v1/channels/abc/messages"));
    }

    #[test]
    fn cookie_extraction() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            "session=abc; csrf_token=deadbeef1234; other=xyz"
                .parse()
                .unwrap(),
        );
        assert_eq!(extract_csrf_cookie(&headers), Some("deadbeef1234".into()));
    }

    #[test]
    fn cookie_extraction_missing() {
        let headers = HeaderMap::new();
        assert_eq!(extract_csrf_cookie(&headers), None);
    }

    #[test]
    fn token_format() {
        let token = generate_csrf_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
