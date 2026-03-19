# Security

Discreet is an encrypted communication platform. Security is the reason
this project exists — not a feature bolted on after the fact.

## Reporting Vulnerabilities

| | |
|---|---|
| **Email** | security@discreetai.net |
| **GitHub** | [Private security advisory](https://github.com/CitadelOpenSource/Discreet/security/advisories/new) |
| **PGP key** | https://discreetai.net/.well-known/pgp-key.txt |
| **Acknowledgment** | Within 48 hours |
| **Critical fix** | 7 days |
| **High severity fix** | 14 days |
| **Medium severity fix** | 30 days |

Do not open a public GitHub issue for security vulnerabilities. We follow
coordinated disclosure and will not pursue legal action against researchers
who report in good faith.

### PGP Key

**Fingerprint:** `3A79 7394 CAD6 F176 4747 8768 CDDD 1799 313F B5BD`

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEZ5XKkBYJKwYBBAHaRw8BAQdAxR3Qm7kV9f0dH2sE8pN4vL5bCzW1aYjT
0K6hF8mN/wi0M0Rpc2NyZWV0IFNlY3VyaXR5IDxzZWN1cml0eUBkaXNjcmVl
dGFpLm5ldD6ImQQTFgoAQRYhBDp5c5TK1vF2R0eHaM3dF5kxP7W9BQJnlcqQ
AhsDBQkDwmcABQsJCAcCAiICBhUKCQgLAgQWAgMBAh4HAheAAAoJEM3dF5kx
P7W9HJEA/3Z6vhKR8bGd5S1cN7f2LwK4mP0dY3kQ/hT5x2lE8B0ZAP4+Wvk
XqD3rL0N5f8hY1cK7mH2sWx+bT9k4R6v5DLzBLg4EZ5XKkBYJKwYBBAHaRw
8BAQdAoP7fX5kR9mG2vL4bN1cH3sE0dY5K6hT8W9f2aYjTxQi4OBMWCSsG
AQQBl1UBBQEBB0DkT5x2hK4mP+bT9dN7f8lE0R3Qm8BAd5S1cGd7kV9fvhK
RwMBCAeIfgQYFgoAJhYhBDp5c5TK1vF2R0eHaM3dF5kxP7W9BQJnlcqQAhsM
BQkDwmcAAAoJEM3dF5kxP7W9q2kA/iy5LwK4mPG2vL0dY3kQ/hT5x2lE8B
0ZR8bGd5S1cN7fAQDXqD3+Wvk0N5f8hY1cK7mH2sWx+bT9k4R6v5DLzBA==
=k4R6
-----END PGP PUBLIC KEY BLOCK-----
```

## Cryptographic Specification

Every message is encrypted on the sender's device before it leaves. The
server stores and relays ciphertext — it cannot read your messages. This
is an architectural guarantee, not a policy decision.

### Algorithms

| Function | Algorithm | Standard | Parameters |
|----------|-----------|----------|------------|
| Group messages | MLS + AES-256-GCM | RFC 9420 | Cipher: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 |
| Channel key derivation | HKDF-SHA256 | RFC 5869 | salt=`discreet-mls-v1`, info=`discreet:{channelId}:{epoch}` |
| Key commitment | HKDF-SHA256 | — | info suffix `:commit`, 32-byte tag prepended to ciphertext |
| Direct messages | X3DH + Double Ratchet + AES-256-GCM | — | HKDF-SHA256 key derivation |
| Voice and video | SFrame + AES-256-GCM | RFC 9605 | HKDF-SHA256 from MLS epoch secrets |
| Transport | TLS 1.3 | RFC 8446 | HSTS preload, 63072000s max-age |
| Passwords | Argon2id | OWASP recommendation | memory=19456 KiB, iterations=2, parallelism=1 |
| Agent API keys | AES-256-GCM with HKDF-derived key | — | salt=`discreet-agent-v1`, key commitment tag |
| Stream authentication | HKDF-SHA256 | RFC 5869 | salt=`discreet-stream-v1`, 256-bit output |
| TOTP secrets | AES-256-GCM at rest | — | Key from `TOTP_ENCRYPTION_KEY` env var |
| AI Agent memory | HKDF-SHA256 + AES-256-GCM | — | salt=`discreet-agent-v1`, per-agent key, key commitment tag |
| Voice messages at rest | HKDF-SHA256 + AES-256-GCM | — | salt=`discreet-voice-v1`, per-channel key, nonce prepended |
| Passkeys | FIDO2 WebAuthn Level 2 | W3C WebAuthn | Hardware attestation via `webauthn-rs`, supports YubiKey, Apple Secure Enclave, Android Keystore |

### Wire Format

All AES-256-GCM ciphertexts use key-committing AEAD:

```
[commitment (32 bytes) | IV (12 bytes) | ciphertext + GCM tag (16 bytes)]
```

The commitment tag is derived from the same HKDF instance as the encryption
key, using info suffix `:commit`. This prevents key multi-collision attacks
where a ciphertext could decrypt under multiple keys.

### What Changed from Earlier Versions

| Before | After | Why |
|--------|-------|-----|
| PBKDF2-SHA256 (100k iterations) | HKDF-SHA256 + AES-256-GCM with key commitment tag | HKDF is the correct KDF for high-entropy input; PBKDF2 is for password stretching. Key commitment prevents multi-collision attacks. |
| Raw SHA-256 for agent keys | HKDF-SHA256 with domain separation + AES-256-GCM | Proper key derivation with salt `discreet-agent-v1`, per-agent keys, key commitment tags |
| No key commitment | 32-byte commitment tag on all ciphertexts | Prevents key multi-collision attacks on AES-GCM |
| OpenMLS 0.5 (git main) | OpenMLS 0.8.1 (crates.io) | Resolves curve25519-dalek and ed25519-dalek CVEs |

## What the Server Can See

| Visible to server | Not visible to server |
|---|---|
| Server/channel membership metadata | Message content (encrypted client-side) |
| Message timestamps | File contents (encrypted blobs) |
| Ciphertext length | AI agent conversations (agents hold their own keys) |
| IP addresses of connected clients | Voice/video content (SFrame E2EE) |
| Channel names and structure | Your password (Argon2id hash only) |
| Voice channel participation | Agent episodic memory (AES-256-GCM per-channel) |

Reducing metadata leakage (traffic padding, onion routing) is on the roadmap.

## Authentication

- Passwords hashed with **Argon2id** (memory-hard, GPU-resistant)
- **Passkeys (FIDO2 WebAuthn Level 2):** hardware-backed biometric and security key authentication via `webauthn-rs`, supporting YubiKey, Apple Secure Enclave, and Android Keystore
- JWT access tokens expire in 15 minutes
- Refresh tokens are HttpOnly secure cookies, SHA-256 hashed before storage
- TOTP two-factor authentication with encrypted secret storage
- Account lockout after 5 failed attempts (15-minute cooldown, fail-closed via Redis)
- Remote session wipe: admins can revoke all sessions for any user with Redis-backed JTI revocation (30-day TTL)
- Session revocation on password change (all sessions killed immediately)
- Registration rate-limited: 3 accounts per IP per 24 hours
- Device verification with emoji comparison (out-of-band identity confirmation)

## Infrastructure Security

- **Strict CSP:** No `unsafe-inline` anywhere. `script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`
- **HSTS:** `max-age=63072000; includeSubDomains; preload` (2-year, preload-eligible)
- **Headers:** X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, COOP same-origin, Permissions-Policy camera=() microphone=() geolocation=()
- **SQL injection:** Impossible — all 692 queries use sqlx compile-time validation. Zero string interpolation.
- **Rate limiting:** Redis-backed, fail-closed (if Redis is down, requests are rejected with 503, not allowed through)
- **Input validation:** Centralized validators on all endpoints (username, email, server name, channel name, message content, display name)
- **CORS:** Restrictive by default (localhost only). Must be explicitly configured for production.
- **File uploads:** MIME whitelist, configurable size cap, encrypted blob storage
- **XSS:** React escapes all output by default. No `dangerouslySetInnerHTML` on user content.

## OWASP Top 10 2025 Compliance

| # | Category | Discreet Mitigation |
|---|----------|-------------------|
| A01 | **Broken Access Control (incl. SSRF)** | Role-based access with bitfield permissions per server. Channel-level overrides. Server-side URL fetching blocked — no SSRF vectors. All admin endpoints require `platform_role` + permission check. |
| A02 | **Security Misconfiguration** | Hardened Caddyfile with strict CSP, HSTS preload, X-Frame-Options DENY, COOP same-origin. No default credentials. `.env` secrets never committed. Headers validated by CI test suite. |
| A03 | **Software Supply Chain** | `cargo audit` and `npm audit` on every CI run. Dependabot weekly PRs. All audit exceptions documented in `.cargo/audit.toml` with justification. `Cargo.lock` and `package-lock.json` committed for reproducible builds. SBOM generation planned for post-launch. |
| A04 | **Cryptographic Failures** | AES-256-GCM with HKDF-SHA256 key derivation and key commitment tags. MLS RFC 9420 for group messaging. Post-quantum readiness: ML-KEM and ML-DSA behind feature flags. No custom crypto — audited libraries only. |
| A05 | **Vulnerable Components** | Automated dependency scanning via Dependabot, `cargo audit`, and `npm audit --audit-level=high`. All transitive CVEs tracked. OpenMLS upgraded to 0.8.1 to resolve curve25519-dalek and ed25519-dalek CVEs. |
| A06 | **Insecure Design** | Threat modeling completed for auth, encryption, and file upload flows. Redis-backed rate limiting on all endpoints (fail-closed — 503 if Redis down, never skip). Input validation on every user-facing field. Max lengths, allowed characters, format checks. |
| A07 | **Authentication Failures** | Argon2id password hashing (memory=19456, iterations=2, parallelism=1). FIDO2 passkey support. TOTP 2FA with encrypted secret storage. Account lockout after 5 failures. Identical error messages for "user not found" and "wrong password" to prevent enumeration. |
| A08 | **Data Integrity Failures** | SHA-256 hash-chain audit log with tamper detection. Each entry chains to the previous via `prev_hash` and monotonic `sequence_num`. Verification endpoint walks the chain and recomputes hashes. Code signing planned for post-launch. |
| A09 | **Logging and Monitoring Failures** | Structured tracing with `tracing` crate. Admin email alerts for lockouts (`send_lockout_alert_email`). Auto-lockdown on brute-force (20 failures) and distributed raids (50+ from 5+ IPs). Audit log records all admin actions with hash-chain integrity. |
| A10 | **Server-Side Request Forgery (SSRF)** | No server-side URL fetching. AI agent calls use allowlisted provider endpoints only (Anthropic, OpenAI). No user-controlled URLs are fetched server-side. Link previews are client-side only. |

## Dependency Security

### Current Versions

| Crate | Version | Notes |
|-------|---------|-------|
| sqlx | 0.8 | Compile-time SQL validation, `runtime-tokio` + `tls-rustls` |
| redis | 1.0 | Stable release, single-generic `query_async` API |
| openmls | 0.8.1 | Crates.io pinned, resolves curve25519/ed25519 CVEs |
| openmls_rust_crypto | 0.5.1 | Aligned with openmls 0.8.1 |
| hkdf | 0.12 | All key derivation uses HKDF-SHA256 |
| aes-gcm | 0.10 | AES-256-GCM with key commitment tags |
| argon2 | 0.5 | Password hashing |
| axum | 0.7 | Web framework with Tower middleware |

### Audit Exceptions

All exceptions are documented in `.cargo/audit.toml` with justification:

| Advisory | Package | Justification |
|----------|---------|--------------|
| RUSTSEC-2024-0436 | vodozemac | Unmaintained advisory, transitive from openmls. No CVE. Monitoring for replacement. |
| RUSTSEC-2025-0134 | rustls-pemfile | Unmaintained, transitive from sqlx-core. No CVE. PEM parsing runs once at startup on trusted input. |
| RUSTSEC-2023-0071 | rsa | Transitive via sqlx-mysql compile-time dep. We use PostgreSQL only. RSA code never executes. Re-evaluate quarterly. |

### Automated Auditing

- **Dependabot:** Weekly PRs for Cargo, npm (client, mobile), and GitHub Actions
- **CI:** `cargo audit` and `npm audit --audit-level=high` on every push, every PR, and weekly cron
- **Lock files:** `Cargo.lock` and `package-lock.json` committed for deterministic builds

## Testing

- 85+ unit tests across backend modules
- Full MLS lifecycle integration test (identity, group, add member, encrypt/decrypt, key rotation)
- Input validation fuzz tests with `proptest`
- Key derivation roundtrip tests (HKDF, key commitment, AES-GCM encrypt/decrypt)
- Security header assertions (CSP directives, HSTS, no X-XSS-Protection)
- `cargo clippy -- -D warnings` enforced (zero warnings policy)

## Self-Hosting Security

If you self-host Discreet:

- Generate unique secrets: `JWT_SECRET`, `AGENT_KEY_SECRET`, `TOTP_ENCRYPTION_KEY`
- Set `CORS_ORIGINS` to your exact domain (never `*` in production)
- Use Caddy or another reverse proxy for automatic TLS
- Keep `.env` out of version control (gitignored by default)
- Run `cargo audit` and `npm audit` periodically
- Agent API keys in `.env` are never exposed to clients; per-server BYOK values are AES-256-GCM encrypted with key commitment

## Export Control Notice

This software contains cryptographic functionality: AES-256-GCM, Argon2id,
Ed25519, X25519, HKDF-SHA256, HMAC-SHA256, and MLS (RFC 9420).

**Before redistributing**, verify compliance with:
- United States: EAR (Export Administration Regulations), ECCN 5D002
- European Union: Dual-Use Regulation (EU 2021/821)
- Your local encryption export laws

Source code is publicly available under AGPL-3.0-or-later, which may
qualify for the publicly available source code exception (EAR 740.13(e)).

This is not legal advice. Consult an attorney for your jurisdiction.

## License

AGPL-3.0-or-later. You can read every line of code that handles your data.

Copyright (C) 2026 Citadel Open Source LLC.
