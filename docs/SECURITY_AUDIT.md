# Security Audit Report

**Project:** Discreet — End-to-End Encrypted Communication Platform
**Date:** March 19, 2026
**Scope:** Complete source code, infrastructure, cryptographic architecture
**Standards:** OWASP Top 10 2025, HIPAA Technical Safeguards (45 CFR 164), SOC 2 Trust Service Criteria
**Status:** Pre-release internal review. Independent third-party audit planned for post-alpha.

---

## Third-Party Audit Status

Independent third-party security audit by **Cure53** or **Trail of Bits** is planned for the post-alpha phase. An **NLnet grant application** is in progress which includes funded security audit as a deliverable. This document represents an internal review and should not be treated as a substitute for professional penetration testing.

---

## Findings Summary

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| DIS-001 | High | Legacy client CSP allows `unsafe-inline` for scripts | Remediated — legacy client retired, Vite client serves all routes with strict CSP |
| DIS-002 | Medium | Fallback encryption (HKDF-AES-256-GCM) lacks forward secrecy | Remediated — MLS RFC 9420 now active with epoch-based forward secrecy |
| DIS-003 | Medium | Voice channels used DTLS-SRTP only (relay can inspect media) | Remediated — SFrame (RFC 9605) implemented for E2EE voice/video |
| DIS-004 | Medium | X-Forwarded-For trusted without verification behind reverse proxy | Remediated — Caddy configured to overwrite (not append) X-Forwarded-For |
| DIS-005 | Medium | Rate limiter was in-memory only (reset on restart, no multi-instance sync) | Remediated — migrated to Redis-backed sliding window, fail-closed (503 if Redis down) |
| DIS-006 | Low | SECURITY.md referenced "bcrypt" but code uses Argon2id | Remediated — all references corrected to Argon2id |
| DIS-007 | Low | No `cargo audit` or `npm audit` in CI pipeline | Remediated — both run on every push, every PR, and weekly cron |
| DIS-008 | Low | File uploads stored as PostgreSQL BYTEA (scaling concern) | Deferred — acceptable for current scale, object storage planned for post-launch |
| DIS-009 | Low | No automated intrusion detection system | Open — planned for post-alpha, auto-lockdown on brute-force (20 failures) implemented |
| DIS-010 | Info | HS256 (symmetric) JWT signing; RS256 preferred for microservices | Deferred — HS256 is correct for monolith architecture, no action needed |
| DIS-011 | Info | TOTP uses SHA1 per RFC 6238 default | Deferred — SHA1 is the standard for TOTP; all authenticator apps expect it |

---

## Cryptographic Primitives

| Function | Algorithm | Crate / Library | Version | Standard |
|----------|-----------|-----------------|---------|----------|
| Group messaging | MLS | `openmls` | 0.8.1 | RFC 9420 |
| MLS crypto backend | X25519, Ed25519, AES-128-GCM | `openmls_rust_crypto` | 0.5.1 | — |
| Channel key derivation | HKDF-SHA256 | `hkdf` | 0.12 | RFC 5869 |
| Symmetric encryption | AES-256-GCM with key commitment | `aes-gcm` | 0.10 | NIST SP 800-38D |
| Password hashing | Argon2id | `argon2` | 0.5 | OWASP recommendation |
| TOTP 2FA | HMAC-SHA1, 6-digit, 30-second | `totp-rs` | 5.x | RFC 6238 |
| JWT signing | HMAC-SHA256 (HS256) | `jsonwebtoken` | 9.x | RFC 7519 |
| Passkeys | FIDO2 WebAuthn Level 2 | `webauthn-rs` | 0.5 | W3C WebAuthn |
| Voice/video encryption | SFrame + AES-256-GCM | Client-side (Web Crypto) | — | RFC 9605 |
| Transport encryption | TLS 1.3 | `rustls` (via `axum`) | 0.23 | RFC 8446 |
| Random number generation | OS entropy | `rand` + `OsRng` | 0.8 | — |
| Agent key encryption | AES-256-GCM + HKDF-SHA256 | `aes-gcm` + `hkdf` | 0.10 / 0.12 | — |
| TOTP secret storage | AES-256-GCM at rest | `aes-gcm` | 0.10 | — |
| Post-quantum KEM (feature flag `pq`) | ML-KEM-768 | `ml-kem` | 0.2 | FIPS 203 |
| Post-quantum signatures (feature flag `pq`) | ML-DSA-65 | `ml-dsa` | 0.1 | FIPS 204 |

---

## Cargo Audit Summary

`cargo audit` runs on every CI push, every PR, and on a weekly cron schedule. Current status: **zero unaddressed vulnerabilities**.

### Documented Exceptions

All exceptions are recorded in `.cargo/audit.toml` with written justification:

| Advisory | Package | Severity | Justification |
|----------|---------|----------|---------------|
| RUSTSEC-2024-0436 | `vodozemac` | Low | Unmaintained advisory, transitive dependency from `openmls`. No CVE assigned. No known exploit. Monitoring for replacement. |
| RUSTSEC-2025-0134 | `rustls-pemfile` | Low | Unmaintained, transitive from `sqlx-core`. No CVE. PEM parsing runs once at startup on trusted input only. |
| RUSTSEC-2023-0071 | `rsa` | Low | Transitive via `sqlx-mysql` compile-time dependency. Discreet uses PostgreSQL exclusively — RSA code path never executes. Re-evaluated quarterly. |

### npm Audit

`npm audit --audit-level=high` runs in CI alongside `cargo audit`. Zero high or critical vulnerabilities in the client dependency tree.

---

## OWASP Top 10 2025 Compliance

| # | Category | Score | Discreet Implementation |
|---|----------|-------|------------------------|
| A01 | Broken Access Control (incl. SSRF) | 10/10 | JWT auth on all protected endpoints. RBAC with 22 permission bitflags + channel-level overrides. No server-side URL fetching (zero SSRF surface). All admin endpoints require `platform_role` check. Guest privilege restrictions enforced. |
| A02 | Security Misconfiguration | 9/10 | Strict CSP (`script-src 'self'`, no `unsafe-inline`). HSTS preload (2-year, includeSubDomains). X-Frame-Options DENY. COOP same-origin. No default credentials. `.env` secrets never committed. |
| A03 | Software Supply Chain | 8/10 | `cargo audit` and `npm audit` on every CI run. Dependabot weekly PRs. All audit exceptions documented with justification. Lock files committed for reproducible builds. SBOM generation planned. |
| A04 | Cryptographic Failures | 10/10 | AES-256-GCM with HKDF-SHA256 and key commitment tags. MLS RFC 9420 for group messaging. SFrame RFC 9605 for voice/video. Post-quantum readiness (ML-KEM, ML-DSA) behind feature flags. No custom crypto. |
| A05 | Vulnerable Components | 8/10 | Automated scanning via Dependabot, `cargo audit`, `npm audit`. All transitive CVEs tracked. OpenMLS upgraded from 0.5 to 0.8.1 to resolve curve25519-dalek and ed25519-dalek CVEs. |
| A06 | Insecure Design | 10/10 | Zero-knowledge architecture — server stores only ciphertext. E2EE is default, not opt-in. Redis rate limiting is fail-closed (503 if Redis down). Input validation on every user-facing field. |
| A07 | Authentication Failures | 10/10 | Argon2id password hashing. FIDO2 passkeys. TOTP 2FA with encrypted secret storage. Account lockout after 5 failures. Identical error messages for "user not found" and "wrong password". OAuth 2.0 with PKCE. |
| A08 | Data Integrity Failures | 9/10 | SHA-256 hash-chain audit log with tamper detection. Each entry chains to previous via `prev_hash` and monotonic `sequence_num`. CSRF double-submit cookie protection. Compile-time SQL validation. |
| A09 | Logging and Monitoring | 8/10 | Structured tracing with `tracing` crate. Admin email alerts for lockouts. Auto-lockdown on brute-force (20 failures) and distributed raids (50+ from 5+ IPs). Audit log records all admin actions. |
| A10 | Server-Side Request Forgery | 10/10 | No server-side URL fetching. AI agent calls use allowlisted provider endpoints only. No user-controlled URLs fetched server-side. Link previews are client-side only. |

**OWASP Total: 92/100**

---

## HIPAA Technical Safeguards (45 CFR 164.312)

| Requirement | Section | Status | Implementation |
|-------------|---------|--------|----------------|
| Unique user identification | 164.312(a)(2)(i) | Pass | UUID-based user IDs, username uniqueness enforced |
| Emergency access procedure | 164.312(a)(2)(ii) | Pass | Admin remote session wipe, platform-level emergency lockdown |
| Automatic logoff | 164.312(a)(2)(iii) | Pass | JWT access tokens expire in 15 minutes, configurable idle timeout |
| Encryption and decryption | 164.312(a)(2)(iv) | Pass | AES-256-GCM E2EE — server cannot decrypt |
| Audit controls | 164.312(b) | Pass | Hash-chain audit log, CSV/PDF export, tamper detection |
| Integrity controls | 164.312(c)(1) | Pass | Compile-time SQL validation, hash-chain integrity, CSP headers |
| Authentication | 164.312(d) | Pass | Argon2id, TOTP 2FA, FIDO2 passkeys, account lockout |
| Transmission security | 164.312(e)(1) | Pass | TLS 1.3, HSTS preload, SFrame E2EE for voice/video |

For healthcare deployments, see [BAA_TEMPLATE.md](BAA_TEMPLATE.md) for a Business Associate Agreement template.

---

## SOC 2 Trust Service Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| CC6.1 Logical Access Controls | 9/10 | RBAC, JWT, MFA (TOTP + passkeys), lockout, session revocation. SAML SSO implemented. |
| CC6.2 System Operations | 8/10 | Rate limiting (Redis, fail-closed), security headers, CSRF, input validation, file upload validation. `cargo audit` + `npm audit` in CI. |
| CC6.3 Change Management | 7/10 | Git version control, CI via GitHub Actions. Formal code review process via PR requirements. Staging environment planned. |
| CC6.6 Encryption | 10/10 | MLS E2EE, SFrame voice, AES-256-GCM with key commitment, TLS 1.3, TOTP encrypted at rest, refresh tokens hashed. |
| CC6.7 Vulnerability Management | 7/10 | `cargo audit` + `npm audit` in CI. Dependabot enabled. Penetration testing and bug bounty planned for post-alpha. |
| CC7.2 Monitoring | 8/10 | Hash-chain audit log, health endpoint, admin email alerts, auto-lockdown on brute-force. Centralized log aggregation planned. |

---

## Architectural Strengths

Security reviewers should note the following design decisions:

1. **Compile-time SQL validation** — All 692+ queries use `sqlx::query!` macros verified against the live PostgreSQL schema at build time. SQL injection is structurally impossible.

2. **Zero-knowledge architecture** — The server stores `BYTEA` ciphertext columns. Even with full database access, an attacker gets encrypted data that cannot be reversed by a policy change, subpoena, or insider threat.

3. **Hash-chain audit log** — Each entry contains SHA-256 of the previous entry with monotonic sequence numbers. Tampering with any record breaks the chain. Verification endpoint recomputes and validates the entire chain.

4. **Key-committing AEAD** — All AES-256-GCM ciphertexts include a 32-byte HKDF-derived commitment tag, preventing multi-key attacks where a ciphertext could decrypt under multiple keys.

5. **Fail-closed rate limiting** — If Redis is unavailable, requests are rejected with 503, not allowed through. Security controls never silently degrade.

6. **Refresh tokens hashed before storage** — Database compromise yields SHA-256 hashes of tokens, which are computationally infeasible to reverse.

---

## Recommendations

| Priority | Recommendation | Status |
|----------|---------------|--------|
| High | Independent third-party penetration test (Cure53 / Trail of Bits) | Planned — NLnet grant application includes funded audit |
| Medium | Formal SOC 2 Type II audit via Vanta or Drata | Planned for post-launch |
| Medium | Bug bounty program (HackerOne or self-hosted) | Planned for post-beta |
| Low | SBOM generation for supply chain transparency | Planned |
| Low | Reproducible builds with documented build environment | Planned |
