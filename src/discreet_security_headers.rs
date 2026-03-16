// discreet_security_headers.rs — HTTP security headers middleware.
//
// Adds OWASP-recommended security headers to every response.
//
// Headers set on ALL responses:
//   Content-Security-Policy:
//     default-src 'self'
//     script-src  'self' https://challenges.cloudflare.com
//     style-src   'self'
//     img-src     'self' data: https:
//     connect-src 'self' wss: https://api.discreetai.net
//     frame-src   https://challenges.cloudflare.com
//     font-src    'self'
//     object-src  'none'
//     base-uri    'self'
//     frame-ancestors 'none'
//
//   X-Frame-Options:            DENY
//   X-Content-Type-Options:     nosniff
//   Strict-Transport-Security:  max-age=63072000; includeSubDomains; preload
//   Referrer-Policy:            strict-origin-when-cross-origin
//   Permissions-Policy:         camera=(), microphone=(), geolocation=()
//   Cross-Origin-Opener-Policy: same-origin
//   (X-XSS-Protection intentionally omitted — deprecated)
//
// Additional behaviour:
//   Cache-Control: no-store on /auth/* and /@me responses.
//
// Placement in the Axum middleware stack (bottom-up, outermost first):
//   Request → CORS → Rate Limit → Security Headers → Trace → Compression → Body Limit → Handler

use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};

/// Tower-compatible Axum middleware that stamps security headers onto every
/// outgoing response.  Register with:
///
/// ```rust
/// .layer(axum::middleware::from_fn(discreet_security_headers::security_headers))
/// ```
///
/// Place the `.layer()` call **above** the CORS layer so that security headers
/// are applied after CORS processing but before the route handlers run.
/// (In Axum, layers added later wrap earlier ones, so "above" in source order
/// means "inner" in the stack — i.e. closer to the handler.)
pub async fn security_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    let h = response.headers_mut();

    // ── X-Content-Type-Options ──────────────────────────────────────────────
    // Prevent browsers from MIME-sniffing a response away from the declared
    // Content-Type.
    h.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );

    // ── X-Frame-Options ─────────────────────────────────────────────────────
    // Refuse to be embedded in any <frame>, <iframe>, or <object>.
    // Redundant with `frame-ancestors 'none'` in CSP, but kept for older UAs.
    h.insert("X-Frame-Options", HeaderValue::from_static("DENY"));

    // X-XSS-Protection intentionally omitted — deprecated and can cause issues
    // in modern browsers. CSP is the authoritative XSS defense.

    // ── Referrer-Policy ─────────────────────────────────────────────────────
    // Send the full URL as Referer for same-origin requests; send only the
    // origin for cross-origin requests; send nothing on downgrade (HTTPS→HTTP).
    h.insert(
        "Referrer-Policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    // ── Permissions-Policy ──────────────────────────────────────────────────
    // Deny all permissions by default. WebRTC getUserMedia works independently
    // of the Permissions-Policy header — it uses the browser permission prompt.
    h.insert(
        "Permissions-Policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );

    // ── Content-Security-Policy ─────────────────────────────────────────────
    // Strict CSP for all responses. No unsafe-inline anywhere.
    // Cloudflare Turnstile requires script-src and frame-src allowances.
    // connect-src allows the API and WSS.
    h.insert(
        "Content-Security-Policy",
        HeaderValue::from_static(
            "default-src 'self'; \
             script-src 'self' https://challenges.cloudflare.com; \
             style-src 'self'; \
             img-src 'self' data: https:; \
             connect-src 'self' wss: https://api.discreetai.net; \
             frame-src https://challenges.cloudflare.com; \
             font-src 'self'; \
             object-src 'none'; \
             base-uri 'self'; \
             frame-ancestors 'none'",
        ),
    );

    // ── Strict-Transport-Security ────────────────────────────────────────────
    // 2-year max-age with includeSubDomains and preload.
    // Eligible for HSTS preload list (https://hstspreload.org).
    h.insert(
        "Strict-Transport-Security",
        HeaderValue::from_static("max-age=63072000; includeSubDomains; preload"),
    );

    // ── Cross-Origin-Opener-Policy ────────────────────────────────────────
    // Isolate the browsing context to prevent cross-origin attacks
    // (Spectre-class side-channel mitigations).
    h.insert(
        "Cross-Origin-Opener-Policy",
        HeaderValue::from_static("same-origin"),
    );

    // ── Cache-Control on sensitive endpoints ─────────────────────────────────
    // Auth tokens and user-profile data must never be stored in shared caches.
    if path.contains("/auth/") || path.contains("/@me") {
        h.insert(
            "Cache-Control",
            HeaderValue::from_static("no-store, no-cache, must-revalidate, private"),
        );
        h.insert("Pragma", HeaderValue::from_static("no-cache"));
    }

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::get, Router};
    use tower::util::ServiceExt;

    async fn build_app() -> Router {
        Router::new()
            .route("/health", get(|| async { "OK" }))
            .layer(axum::middleware::from_fn(security_headers))
    }

    #[tokio::test]
    async fn test_security_headers_present_on_health() {
        let app = build_app().await;
        let req = Request::builder()
            .uri("/health")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();

        let h = resp.headers();
        assert_eq!(h.get("X-Content-Type-Options").unwrap(), "nosniff");
        assert_eq!(h.get("X-Frame-Options").unwrap(), "DENY");
        assert_eq!(h.get("Referrer-Policy").unwrap(), "strict-origin-when-cross-origin");
        assert!(h.get("Strict-Transport-Security").unwrap().to_str().unwrap().contains("63072000"));
        assert!(h.get("Strict-Transport-Security").unwrap().to_str().unwrap().contains("preload"));
        assert_eq!(h.get("Cross-Origin-Opener-Policy").unwrap(), "same-origin");
        assert!(h.get("Content-Security-Policy").is_some());
        assert!(h.get("Permissions-Policy").is_some());
        // X-XSS-Protection must NOT be present (deprecated)
        assert!(h.get("X-XSS-Protection").is_none());
    }

    #[tokio::test]
    async fn test_csp_includes_cloudflare() {
        let app = build_app().await;
        let req = Request::builder()
            .uri("/health")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();

        let csp = resp.headers()
            .get("Content-Security-Policy")
            .unwrap()
            .to_str()
            .unwrap();

        assert!(csp.contains("challenges.cloudflare.com"), "CSP must include Cloudflare Turnstile");
        assert!(csp.contains("script-src"), "CSP must have script-src directive");
        assert!(csp.contains("frame-src"), "CSP must have frame-src directive");
        assert!(csp.contains("object-src 'none'"), "CSP must block object-src");
        assert!(csp.contains("frame-ancestors 'none'"), "CSP must block frame-ancestors");
        assert!(csp.contains("wss:"), "CSP must allow WebSocket connections");
    }
}
