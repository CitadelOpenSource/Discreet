// citadel_security_headers.rs — HTTP security headers middleware.
//
// Adds OWASP-recommended security headers to every response.
//
// Headers set on ALL responses:
//   Content-Security-Policy:
//     default-src 'self'
//     script-src  'self' 'unsafe-inline'
//     style-src   'self' 'unsafe-inline'
//     connect-src 'self' ws: wss:
//     img-src     'self' data: blob:
//     media-src   'self' data: blob:
//     font-src    'self'
//     frame-src   https://www.youtube-nocookie.com
//     object-src  'none'
//     frame-ancestors 'none'
//     base-uri    'self'
//     form-action 'self'
//
//   X-Frame-Options:            DENY
//   X-Content-Type-Options:     nosniff
//   X-XSS-Protection:           0  (CSP is authoritative; legacy header disabled)
//   Strict-Transport-Security:  max-age=31536000; includeSubDomains
//   Referrer-Policy:            strict-origin-when-cross-origin
//   Permissions-Policy:         camera=(self), microphone=(self), geolocation=()
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
/// .layer(axum::middleware::from_fn(citadel_security_headers::security_headers))
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

    // ── X-XSS-Protection ────────────────────────────────────────────────────
    // Explicitly disable the legacy XSS auditor present in some older browsers.
    // Modern browsers rely on CSP instead.
    h.insert("X-XSS-Protection", HeaderValue::from_static("0"));

    // ── Referrer-Policy ─────────────────────────────────────────────────────
    // Send the full URL as Referer for same-origin requests; send only the
    // origin for cross-origin requests; send nothing on downgrade (HTTPS→HTTP).
    h.insert(
        "Referrer-Policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    // ── Permissions-Policy ──────────────────────────────────────────────────
    // camera=(self)      — required for in-app video calls
    // microphone=(self)  — required for voice channels
    // geolocation=()     — not used; deny entirely
    h.insert(
        "Permissions-Policy",
        HeaderValue::from_static("camera=(self), microphone=(self), geolocation=()"),
    );

    // ── Content-Security-Policy ─────────────────────────────────────────────
    // Path-conditional CSP:
    //   /next/*  (Vite client) → STRICT: no 'unsafe-inline' for scripts
    //   /        (legacy client) → COMPAT: 'unsafe-inline' for Babel JSX
    //
    // When the Vite client replaces the legacy client at /, the strict policy
    // will become the only policy and the legacy branch can be deleted.
    let csp = if path.starts_with("/next") || path.starts_with("/api") {
        // Strict CSP for the production Vite client and API responses.
        "default-src 'self'; \
         script-src 'self'; \
         style-src 'self' 'unsafe-inline'; \
         connect-src 'self' ws: wss:; \
         img-src 'self' data: blob:; \
         media-src 'self' data: blob:; \
         font-src 'self'; \
         frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com; \
         object-src 'none'; \
         frame-ancestors 'none'; \
         base-uri 'self'; \
         form-action 'self'"
    } else {
        // Legacy client needs 'unsafe-inline' for in-browser Babel/JSX.
        "default-src 'self'; \
         script-src 'self' 'unsafe-inline'; \
         style-src 'self' 'unsafe-inline'; \
         connect-src 'self' ws: wss:; \
         img-src 'self' data: blob:; \
         media-src 'self' data: blob:; \
         font-src 'self'; \
         frame-src https://www.youtube-nocookie.com; \
         object-src 'none'; \
         frame-ancestors 'none'; \
         base-uri 'self'; \
         form-action 'self'"
    };
    h.insert(
        "Content-Security-Policy",
        HeaderValue::from_str(csp).expect("valid CSP string"),
    );

    // ── Strict-Transport-Security ────────────────────────────────────────────
    // Tell browsers to use HTTPS exclusively for the next year and to apply
    // the policy to all subdomains.  Reverse proxies with TLS termination
    // (nginx, Caddy, AWS ALB) will forward this header to clients.
    h.insert(
        "Strict-Transport-Security",
        HeaderValue::from_static("max-age=31536000; includeSubDomains"),
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
