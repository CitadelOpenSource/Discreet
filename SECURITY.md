# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, **do not open a public issue.**
Email: security@discreetai.net

We aim to acknowledge reports within 24 hours and patch critical issues within 72 hours.

## Encryption Architecture

| Layer | Protocol | Standard |
|-------|----------|----------|
| Group messages | MLS | RFC 9420 |
| Direct messages | Signal Protocol | X3DH + Double Ratchet |
| Voice/Video | SFrame | RFC 9605 (planned) |
| Transport | TLS 1.3 | RFC 8446 |
| Fallback | PBKDF2-AES-256-GCM | NIST SP 800-132 |
| Proximity text | AES-256-GCM over BLE | Bluetooth SIG Mesh Spec |
| Proximity voice | DTLS-SRTP over Wi-Fi Direct | RFC 5764 |

The server is **zero-knowledge** — it stores only ciphertext and is architecturally incapable of decrypting message content.

## OWASP Top 10 Coverage

| # | Risk | Status | Implementation |
|---|------|--------|---------------|
| A01 | Broken Access Control | ✅ | JWT + refresh tokens, role-based permissions (22 bitflags) |
| A02 | Cryptographic Failures | ✅ | MLS RFC 9420, PBKDF2-AES-256-GCM, Argon2id passwords |
| A03 | Injection | ✅ | sqlx compile-time query validation, XSS sanitization |
| A04 | Insecure Design | ✅ | Zero-knowledge architecture, E2EE by default |
| A05 | Security Misconfiguration | ✅ | CSP, HSTS, X-Frame-Options, Referrer-Policy headers |
| A06 | Vulnerable Components | ⚠️ | Cargo audit + npm audit recommended for CI |
| A07 | Auth Failures | ✅ | 2FA TOTP, account lockout (5 attempts), password strength |
| A08 | Data Integrity Failures | ✅ | CSRF double-submit cookie, file upload validation (25MB, MIME whitelist) |
| A09 | Logging & Monitoring | ✅ | SHA-256 hash-chain audit log, admin dashboard, server health monitor |
| A10 | SSRF | ✅ | No server-side URL fetching (E2EE — all content is ciphertext) |

## SOC 2 Trust Principles

| Principle | How We Address It |
|-----------|-------------------|
| **Security** | E2EE, rate limiting, CSRF, CSP/HSTS headers, 2FA, account lockout |
| **Availability** | Health endpoint, server monitoring, PostgreSQL connection pooling |
| **Processing Integrity** | Compile-time SQL validation (sqlx), typed API |
| **Confidentiality** | Zero-knowledge server, no plaintext storage, AGPL transparency |
| **Privacy** | No ads, no data selling, GDPR export, account deletion planned |

## HIPAA Considerations

For healthcare deployments:
- E2EE satisfies encryption at-rest and in-transit requirements
- Audit logs track access patterns (who accessed what, when)
- Self-hosting gives organizations full data control
- Zero-knowledge architecture means the hosting provider cannot access PHI
- BAA (Business Associate Agreement) available for enterprise tier (planned)

## Implemented Security Features

- [x] Argon2id password hashing (memory-hard, GPU/ASIC resistant)
- [x] JWT authentication with refresh token rotation
- [x] Refresh tokens SHA-256 hashed before database storage
- [x] HttpOnly Secure SameSite=Lax refresh cookies
- [x] MLS RFC 9420 group end-to-end encryption
- [x] PBKDF2-AES-256-GCM fallback encryption
- [x] CSRF double-submit cookie (SameSite=Strict, 32-byte random token)
- [x] Content-Security-Policy headers (path-conditional: strict for Vite, compat for legacy)
- [x] Strict-Transport-Security (HSTS, 1 year, includeSubDomains)
- [x] X-Frame-Options: DENY
- [x] X-Content-Type-Options: nosniff
- [x] Referrer-Policy: strict-origin-when-cross-origin
- [x] Permissions-Policy (camera/microphone self, geolocation denied)
- [x] Rate limiting: configurable per IP, stricter on auth endpoints (30/min)
- [x] Password strength: 8+ chars, mixed case + digit, common password blocklist
- [x] Account lockout: 5 failed attempts → 15 min Redis lock
- [x] 2FA TOTP (setup, verify, disable, login flow with single-use Redis token)
- [x] TOTP secrets encrypted at rest (AES-256-GCM)
- [x] GDPR data export (GET /users/@me/export)
- [x] File upload validation (25MB max, MIME whitelist, magic byte check, filename sanitize)
- [x] Request body limit: 35MB (25MB file + base64 encoding overhead)
- [x] Session invalidation on password change (Redis revoked_sessions)
- [x] Invite link expiry (configurable, default 7 days, max uses)
- [x] Email verification flow (Resend-ready, dev auto-verify)
- [x] XSS input sanitization (client-side, all inputs)
- [x] SQL injection prevention (sqlx compile-time parameterized queries — zero string interpolation)
- [x] SHA-256 hash-chain tamper-evident audit log
- [x] WebSocket JWT validation on upgrade
- [x] Guest user privilege restrictions (no server creation, voice, friend requests)
- [x] Cache-Control: no-store on auth and profile endpoints

## What We Don't Claim

- Not SOC 2 certified (yet). The architecture aligns with SOC 2 controls, but formal certification requires 6-12 months of audited compliance evidence.
- Not HIPAA certified (yet). The zero-knowledge architecture and E2EE satisfy technical safeguards, but a BAA and formal assessment are required before handling PHI.
- Not formally penetration tested (yet). Scheduled before public beta.
- Metadata (who sent a message, when, to which channel) is visible to the server. Message content is not.
- Active device compromise (malware on the user's device) is out of scope for any E2EE system.

## Planned

- [ ] Penetration testing (pre-beta)
- [ ] cargo-audit + npm audit in CI pipeline
- [ ] Post-quantum key exchange (ML-KEM-768 + X25519 hybrid)
- [ ] SFrame voice/video encryption (RFC 9605)
- [ ] Hardware security key support (WebAuthn/FIDO2)
- [ ] Account deletion endpoint (DELETE /users/@me)
- [ ] Privacy policy and Terms of Service
- [ ] Bug bounty program (post-launch)
- [ ] SOC 2 Type II certification
