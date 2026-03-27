# Security Policy

## Reporting Vulnerabilities

| | |
|---|---|
| **Email** | security@discreetai.net |
| **GitHub** | [Private security advisory](https://github.com/CitadelOpenSource/Discreet/security/advisories/new) |
| **PGP key** | https://discreetai.net/.well-known/pgp-key.txt |
| **Acknowledgment** | Within 24 hours |
| **Detailed response** | Within 72 hours |

Do NOT open a public GitHub issue for security vulnerabilities. We follow coordinated disclosure and will not pursue legal action against researchers who report in good faith.

## Cryptographic Architecture

### Message Encryption
- Protocol: MLS RFC 9420 (Messaging Layer Security)
- Cipher suite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519
- Symmetric cipher: AES-256-GCM
- Key derivation: HKDF-SHA256
- Salt format: `discreet:{channelId}:{epoch}`
- Key commitment: 32-byte HKDF tag prepended to every ciphertext

### Post-Quantum Cryptography
- Key encapsulation: ML-KEM-768 (FIPS 203)
- Implementation: libcrux-ml-kem 0.0.8 (Cryspen)
- Verification: Formally verified for panic freedom, correctness, and secret independence using hax and F*
- Same team that verified Signal's PQXDH protocol and discovered the KyberSlash timing vulnerability
- Key validation: FIPS 203 mandatory validation before encapsulation (fail-closed on invalid keys)
- Hybrid architecture: X25519 (classical) + ML-KEM-768 (post-quantum) — both must be broken to compromise

### Voice/Video Encryption
- Protocol: SFrame RFC 9605
- Cipher: AES-256-GCM
- Implementation: WebRTC Insertable Streams + Web Worker

### Wire Format

All AES-256-GCM ciphertexts use key-committing AEAD:

```
[commitment (32 bytes) | IV (12 bytes) | ciphertext + GCM tag (16 bytes)]
```

The commitment tag is derived from the same HKDF instance as the encryption key, using info suffix `:commit`. This prevents key multi-collision attacks where a ciphertext could decrypt under multiple keys.

### Authentication
- Passwords: Argon2id (memory=19456, iterations=2, parallelism=1)
- Passkeys: FIDO2 WebAuthn Level 2 (webauthn-rs), supports YubiKey, Apple Secure Enclave, Android Keystore
- OAuth: PKCE flow (Google, GitHub, Apple, Discord)
- SAML: SSO for enterprise
- TOTP: RFC 6238 with AES-256-GCM encrypted secret storage
- Anonymous: BIP-39 12-word seed phrase (Argon2id hashed, never stored plaintext)
- JWT access tokens: 15-minute expiry, RS256
- Refresh tokens: HttpOnly secure cookies, SHA-256 hashed before storage
- Account lockout: 5 failed attempts, 15-minute cooldown, fail-closed via Redis
- Session revocation: immediate on password change (all sessions killed via Redis)

### Security Kernel (WASM)
- Isolated execution in Web Worker (separate thread, separate memory)
- Rate-limited oracle protection against brute-force decryption attempts
- Non-extractable WebCrypto keys for sealed storage
- Capability-based render model (structured permissions, not raw HTML)
- Trusted Types enforcement on all DOM sinks
- 156 tests covering all security boundaries (119 unit + 37 integration)

## What the Server Can See

| Visible to server | Not visible to server |
|---|---|
| Server/channel membership metadata | Message content (encrypted client-side) |
| Message timestamps | File contents (encrypted blobs) |
| Ciphertext length | AI agent conversations (agents hold their own keys) |
| IP addresses of connected clients | Voice/video content (SFrame E2EE) |
| Channel names and structure | Your password (Argon2id hash only) |
| Voice channel participation | Agent episodic memory (AES-256-GCM per-channel) |

## Security Practices

### What We Do
- All 692 database queries use compile-time validated sqlx macros (zero string interpolation)
- All user input validated (length, format, allowed characters)
- All endpoints rate-limited (Redis sliding window, fail-closed)
- SSRF protection on all URL-accepting endpoints (private IP ranges blocked)
- Security headers on every response (HSTS preload, CSP, X-Frame-Options DENY, COOP, CORP)
- Zero external requests on page load (all fonts self-hosted, no CDN, no analytics)
- `cargo audit`: zero vulnerabilities (3 documented unmaintained-advisory exceptions)
- `npm audit`: zero vulnerabilities

### What We Don't Do
- We don't collect analytics or telemetry
- We don't use tracking pixels or third-party CDNs
- We don't store plaintext passwords or seed phrases
- We don't serve ads or sell data
- We don't have access to encrypted message content
- We don't require a phone number, ever

## Known Limitations

Tracked in `docs/internal/SECURITY_KNOWN_ISSUES.md` (7 entries, reviewed monthly):

1. **CSP unsafe-inline in style-src** — required by React's inline style injection. Standard React limitation.
2. **Crypto fallback path** — if the WASM kernel fails to load, the app falls back to JavaScript crypto. Must be removed before production deploy.
3. **Redis fail-open on rate limiting** — if Redis is down, rate limits are skipped. Acceptable for alpha; circuit breaker planned.
4. **JWT in WebSocket query params** — token may appear in server logs. Mitigated: 15-minute expiry, TLS only, server does not log query params.
5. **Web Worker isolation** — depends on browser implementation of the Web Workers spec.
6. **WASM memory unencrypted** — WASM linear memory is unencrypted in browser process memory.
7. **vodozemac unmaintained** — transitive dependency from OpenMLS. No CVE. Monitoring for replacement.

## OWASP Top 10 2025 Compliance

| # | Category | Mitigation |
|---|----------|-----------|
| A01 | **Broken Access Control** | Role-based permissions with 22-bit bitfield per server. Channel-level overrides. All admin endpoints require platform_role check. |
| A02 | **Security Misconfiguration** | Hardened Caddyfile with strict CSP, HSTS preload, X-Frame-Options DENY, COOP same-origin. No default credentials. |
| A03 | **Software Supply Chain** | `cargo audit` + `npm audit` on every CI run. All exceptions documented. Lock files committed. |
| A04 | **Cryptographic Failures** | AES-256-GCM with key commitment, HKDF-SHA256, MLS RFC 9420, formally verified ML-KEM-768. No custom crypto. |
| A05 | **Vulnerable Components** | Automated scanning. OpenMLS 0.8.1 (resolved curve25519-dalek CVEs). ML-KEM replaced with formally verified libcrux. |
| A06 | **Insecure Design** | Threat model completed. Redis fail-closed rate limiting. Input validation on every field. |
| A07 | **Authentication Failures** | Argon2id, FIDO2 passkeys, TOTP 2FA, lockout after 5 failures, identical error messages to prevent enumeration. |
| A08 | **Data Integrity Failures** | SHA-256 hash-chain audit log with tamper detection and monotonic sequence numbers. |
| A09 | **Logging and Monitoring** | Structured tracing. Admin alerts on lockouts. Auto-lockdown on brute-force (20 failures) and distributed raids. |
| A10 | **SSRF** | All URL-accepting endpoints validate against private IP ranges (127.0.0.0/8, 10.0.0.0/8, 169.254.169.254, etc.). |

## Audit Status

No independent security audit has been performed yet. We are applying to NLnet NGI Zero Commons Fund for a funded Cure53 audit.

## Dependency Versions

| Crate | Version | Purpose |
|-------|---------|---------|
| axum | 0.8 | Web framework |
| sqlx | 0.8 | Compile-time validated SQL |
| libcrux-ml-kem | 0.0.8 | ML-KEM-768 (formally verified) |
| openmls | 0.8.1 | MLS RFC 9420 |
| aes-gcm | 0.10 | Symmetric encryption |
| hkdf | 0.12 | Key derivation |
| argon2 | 0.5 | Password hashing |
| webauthn-rs | 0.5 | FIDO2 passkeys |
| jsonwebtoken | 10 | JWT signing/verification |

## Testing

- 110 backend unit tests
- 156 kernel tests (119 unit + 37 integration)
- 266 total tests passing
- Full MLS lifecycle integration test
- Input validation fuzz tests with `proptest`
- Key derivation roundtrip tests
- Security header assertions
- `cargo clippy -- -D warnings` enforced (zero warnings)

## Self-Hosting Security

If you self-host Discreet:

- Generate unique secrets: `JWT_SECRET`, `AGENT_KEY_SECRET`, `TOTP_ENCRYPTION_KEY`
- Set `CORS_ORIGINS` to your exact domain (never `*` in production)
- Use Caddy or another reverse proxy for automatic TLS
- Keep `.env` out of version control (gitignored by default)
- Run `cargo audit` and `npm audit` periodically

## Export Control Notice

This software contains cryptographic functionality: AES-256-GCM, Argon2id, Ed25519, X25519, ML-KEM-768, HKDF-SHA256, HMAC-SHA256, and MLS (RFC 9420).

**Before redistributing**, verify compliance with:
- United States: EAR (Export Administration Regulations), ECCN 5D002
- European Union: Dual-Use Regulation (EU 2021/821)
- Your local encryption export laws

Source code is publicly available under AGPL-3.0-or-later, which may qualify for the publicly available source code exception (EAR 740.13(e)). This is not legal advice.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.4.0-alpha | ✅ |

## License

AGPL-3.0-or-later. You can read every line of code that handles your data.

Copyright (C) 2024-2026 Discreet contributors.
