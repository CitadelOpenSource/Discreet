# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, **do not open a public issue.**
Email: security@discreet.chat (or DM the project maintainer)

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
| A01 | Broken Access Control | ✅ | JWT + refresh tokens, role-based permissions (7 tiers) |
| A02 | Cryptographic Failures | ✅ | MLS RFC 9420, PBKDF2-AES-256-GCM, bcrypt passwords |
| A03 | Injection | ✅ | sqlx compile-time query validation, XSS sanitization |
| A04 | Insecure Design | ✅ | Zero-knowledge architecture, E2EE by default |
| A05 | Security Misconfiguration | ✅ | CSP, HSTS, X-Frame-Options, Referrer-Policy headers |
| A06 | Vulnerable Components | ⚠️ | Cargo audit + npm audit in CI (2 moderate npm) |
| A07 | Auth Failures | ✅ | 2FA TOTP, account lockout (5 attempts), password strength |
| A08 | Data Integrity Failures | ✅ | CSRF double-submit cookie, file upload validation |
| A09 | Logging & Monitoring | ✅ | Audit log, admin dashboard, server health monitor |
| A10 | SSRF | ✅ | No server-side URL fetching (E2EE — all content is ciphertext) |

## SOC 2 Trust Principles

| Principle | How We Address It |
|-----------|-------------------|
| **Security** | E2EE, rate limiting, CSRF, CSP/HSTS headers, 2FA, account lockout |
| **Availability** | Health endpoint, server monitoring, PostgreSQL connection pooling |
| **Processing Integrity** | Compile-time SQL validation (sqlx), typed API, bracket checker |
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

- [x] JWT authentication with refresh token rotation
- [x] bcrypt password hashing (cost factor 12)
- [x] MLS RFC 9420 group end-to-end encryption
- [x] PBKDF2-AES-256-GCM fallback encryption
- [x] CSRF double-submit cookie protection
- [x] Content-Security-Policy headers
- [x] Strict-Transport-Security (HSTS)
- [x] X-Frame-Options: DENY
- [x] X-Content-Type-Options: nosniff
- [x] Referrer-Policy: strict-origin-when-cross-origin
- [x] Permissions-Policy (camera/microphone/geolocation)
- [x] Rate limiting: 120 req/min per IP (server), 30 msg/min (client)
- [x] Password strength: 8+ chars, mixed case + number
- [x] Account lockout: 5 failed attempts → 15 min Redis lock
- [x] 2FA TOTP (setup, verify, disable, login flow)
- [x] GDPR data export (GET /users/@me/export)
- [x] File upload validation (25MB max, MIME whitelist, filename sanitize)
- [x] Session invalidation on password change (Redis revoked_sessions)
- [x] Invite link expiry (configurable, default 7 days)
- [x] Email verification flow (Resend-ready)
- [x] XSS input sanitization (client-side, all inputs)
- [x] SQL injection prevention (sqlx compile-time parameterized queries)

## Planned

- [ ] Penetration testing (pre-launch)
- [ ] Post-quantum key exchange (ML-KEM-768 + X25519 hybrid)
- [ ] SFrame voice/video encryption
- [ ] Hardware security key support (WebAuthn/FIDO2)
- [ ] Bug bounty program (post-launch)
- [ ] BLE mesh proximity messaging (encrypted, no internet required)
- [ ] Wi-Fi Direct voice channels (encrypted, phone-as-server)
- [ ] Raspberry Pi relay nodes (zero-knowledge mesh extenders)
- [ ] Stealth proximity mode (passive discovery, no broadcast)
