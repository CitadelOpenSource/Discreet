// discreet_security_headers.rs — HTTP security headers middleware.
//
// Adds OWASP-recommended security headers to every response.
//
// Headers set on ALL responses:
//   Content-Security-Policy    (strict, documented inline)
//   Strict-Transport-Security  max-age=63072000; includeSubDomains; preload
//   X-Content-Type-Options     nosniff
//   X-Frame-Options            DENY
//   Referrer-Policy            strict-origin-when-cross-origin
//   Permissions-Policy         camera=(self), microphone=(self), geolocation=(), payment=()
//   Cross-Origin-Opener-Policy  same-origin
//   Cross-Origin-Resource-Policy same-origin
//   (X-XSS-Protection intentionally omitted — deprecated)
//
// Additional behaviour:
//   Cache-Control: no-store on /auth/* and /@me responses.
//
// Placement in the Axum middleware stack (bottom-up, outermost first):
//   Request → CORS → Rate Limit → Security Headers → Trace → Compression → Body Limit → Handler

use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};

/// Tower-compatible Axum middleware that stamps security headers onto every
/// outgoing response.
pub async fn security_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    let h = response.headers_mut();

    // ── X-Content-Type-Options ──────────────────────────────────────────────
    h.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );

    // ── X-Frame-Options ─────────────────────────────────────────────────────
    h.insert("X-Frame-Options", HeaderValue::from_static("DENY"));

    // ── Referrer-Policy ─────────────────────────────────────────────────────
    h.insert(
        "Referrer-Policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    // ── Permissions-Policy ──────────────────────────────────────────────────
    // camera=(self) and microphone=(self) allow our origin for voice/video.
    // geolocation and payment denied entirely.
    h.insert(
        "Permissions-Policy",
        HeaderValue::from_static("camera=(self), microphone=(self), geolocation=(), payment=()"),
    );

    // ── Content-Security-Policy ─────────────────────────────────────────────
    // script-src: 'self' + Cloudflare Turnstile. No 'unsafe-eval', no 'unsafe-inline'.
    // worker-src: restricts Web Workers to same origin (kernel Worker).
    // style-src: 'unsafe-inline' required for theme CSS variable injection
    //   via element.style.setProperty().
    // font-src: 'self' only — all fonts self-hosted, no external CDN.
    // connect-src: wildcard wss/https for *.discreetai.net (WebSocket + API).
    // media-src: blob: for voice message playback.
    // trusted-types: only the discreet-default policy may be created.
    // require-trusted-types-for: enforces Trusted Types on all DOM XSS sinks.
    h.insert(
        "Content-Security-Policy",
        HeaderValue::from_static(
            "default-src 'self'; \
             script-src 'self' https://challenges.cloudflare.com; \
             worker-src 'self'; \
             style-src 'self' 'unsafe-inline'; \
             font-src 'self'; \
             img-src 'self' blob: data:; \
             connect-src 'self' wss://*.discreetai.net https://*.discreetai.net; \
             frame-src https://challenges.cloudflare.com; \
             media-src 'self' blob:; \
             object-src 'none'; \
             base-uri 'self'; \
             form-action 'self'; \
             frame-ancestors 'none'; \
             trusted-types discreet-default; \
             require-trusted-types-for 'script'; \
             upgrade-insecure-requests",
        ),
    );

    // ── Strict-Transport-Security ────────────────────────────────────────────
    h.insert(
        "Strict-Transport-Security",
        HeaderValue::from_static("max-age=63072000; includeSubDomains; preload"),
    );

    // ── Cross-Origin-Opener-Policy ────────────────────────────────────────
    h.insert(
        "Cross-Origin-Opener-Policy",
        HeaderValue::from_static("same-origin"),
    );

    // ── Cross-Origin-Resource-Policy ──────────────────────────────────────
    h.insert(
        "Cross-Origin-Resource-Policy",
        HeaderValue::from_static("same-origin"),
    );

    // ── Cache-Control on sensitive endpoints ─────────────────────────────────
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
    use tower::ServiceExt;

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
        assert_eq!(h.get("Cross-Origin-Resource-Policy").unwrap(), "same-origin");
        assert!(h.get("Content-Security-Policy").is_some());
        assert!(h.get("Permissions-Policy").is_some());
        // X-XSS-Protection must NOT be present (deprecated)
        assert!(h.get("X-XSS-Protection").is_none());
    }

    #[tokio::test]
    async fn test_csp_directives() {
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
        assert!(csp.contains("worker-src 'self'"), "CSP must restrict worker-src to self");
        assert!(csp.contains("frame-src"), "CSP must have frame-src directive");
        assert!(csp.contains("object-src 'none'"), "CSP must block object-src");
        assert!(csp.contains("frame-ancestors 'none'"), "CSP must block frame-ancestors");
        assert!(csp.contains("wss://"), "CSP must allow WebSocket connections");
        assert!(csp.contains("'unsafe-inline'"), "CSP style-src must allow unsafe-inline for theme system");
        assert!(!csp.contains("fonts.googleapis.com"), "CSP must not reference external font CDN");
        assert!(!csp.contains("fonts.gstatic.com"), "CSP must not reference external font CDN");
        assert!(csp.contains("font-src 'self'"), "CSP font-src must be self-only");
        assert!(csp.contains("media-src"), "CSP must have media-src for voice messages");
        assert!(csp.contains("form-action 'self'"), "CSP must restrict form-action");
        assert!(csp.contains("upgrade-insecure-requests"), "CSP must upgrade insecure requests");
        assert!(csp.contains("trusted-types discreet-default"), "CSP must define trusted-types policy");
        assert!(csp.contains("require-trusted-types-for 'script'"), "CSP must enforce trusted types");
        assert!(!csp.contains("unsafe-eval"), "CSP must never allow unsafe-eval");

        // Verify 'unsafe-inline' is in style-src only, not in script-src
        let script_src = csp.split(';')
            .find(|d| d.trim().starts_with("script-src"))
            .expect("CSP must have script-src directive");
        assert!(!script_src.contains("unsafe-inline"), "script-src must not contain unsafe-inline");
    }

    #[tokio::test]
    async fn test_permissions_policy_allows_camera_microphone() {
        let app = build_app().await;
        let req = Request::builder()
            .uri("/health")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();

        let pp = resp.headers()
            .get("Permissions-Policy")
            .unwrap()
            .to_str()
            .unwrap();

        assert!(pp.contains("camera=(self)"), "Permissions-Policy must allow camera for voice/video");
        assert!(pp.contains("microphone=(self)"), "Permissions-Policy must allow microphone for voice/video");
        assert!(pp.contains("geolocation=()"), "Permissions-Policy must deny geolocation");
        assert!(pp.contains("payment=()"), "Permissions-Policy must deny payment");
    }
}
