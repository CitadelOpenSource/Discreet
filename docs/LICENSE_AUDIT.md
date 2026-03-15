# Dependency License Audit

> Discreet is licensed under AGPL-3.0-or-later.
> All dependencies must be AGPL-compatible.
> Last audited: 2026-03-15

## Compatibility Rules

AGPL-3.0-or-later is compatible with:
- **MIT** — permissive, compatible
- **Apache-2.0** — permissive, compatible
- **BSD-2-Clause / BSD-3-Clause** — permissive, compatible
- **ISC** — permissive, compatible
- **MPL-2.0** — weak copyleft, compatible (file-level)
- **Zlib** — permissive, compatible
- **Unlicense / CC0** — public domain, compatible
- **BSL-1.0** (Boost) — permissive, compatible

NOT compatible:
- **SSPL** — Server Side Public License (MongoDB)
- **Commons Clause** — restricts commercial use
- **Proprietary / No License** — incompatible
- **EUPL** — potentially incompatible with AGPL
- **CC-BY-NC** — non-commercial restriction

---

## Rust Dependencies (Cargo.toml)

### Web Framework

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| axum | 0.7 | MIT | OK |
| axum-extra | 0.9 | MIT | OK |
| tower | 0.4 | MIT | OK |
| tower-http | 0.5 | MIT | OK |
| hyper | 1.0 | MIT | OK |
| tokio | 1 | MIT | OK |

### Serialization

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| serde | 1 | MIT OR Apache-2.0 | OK |
| serde_json | 1 | MIT OR Apache-2.0 | OK |

### Database

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| sqlx | 0.7 | MIT OR Apache-2.0 | OK |

### Cache

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| redis | 0.24 | BSD-3-Clause | OK |

### Auth

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| argon2 | 0.5 | MIT OR Apache-2.0 | OK |
| jsonwebtoken | 9 | MIT | OK |

### Cryptography

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| sha2 | 0.10 | MIT OR Apache-2.0 | OK |
| hmac | 0.12 | MIT OR Apache-2.0 | OK |
| rand | 0.8 | MIT OR Apache-2.0 | OK |
| base64 | 0.22 | MIT OR Apache-2.0 | OK |
| totp-rs | 5 | MIT | OK |
| hex | 0.4 | MIT OR Apache-2.0 | OK |
| aes-gcm | 0.10 | MIT OR Apache-2.0 | OK |

### Cryptography (optional, behind feature flags)

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| ed25519-dalek | 2 | BSD-3-Clause | OK |
| x25519-dalek | 2 | BSD-3-Clause | OK |
| hkdf | 0.12 | MIT OR Apache-2.0 | OK |
| openmls | 0.5 | MIT | OK |
| openmls_rust_crypto | 0.2 | MIT | OK |

### Utilities

| Crate | Version | License | Status |
|-------|---------|---------|--------|
| uuid | 1 | MIT OR Apache-2.0 | OK |
| chrono | 0.4 | MIT OR Apache-2.0 | OK |
| tracing | 0.1 | MIT | OK |
| tracing-subscriber | 0.3 | MIT | OK |
| thiserror | 1 | MIT OR Apache-2.0 | OK |
| dotenvy | 0.15 | MIT | OK |
| envy | 0.4 | MIT | OK |
| async-trait | 0.1 | MIT OR Apache-2.0 | OK |
| regex-lite | 0.1 | MIT OR Apache-2.0 | OK |
| reqwest | 0.12 | MIT OR Apache-2.0 | OK |

### Rust Summary

- **Total direct dependencies**: 30
- **All MIT, Apache-2.0, or BSD-3-Clause**: YES
- **SSPL/Commons Clause/Proprietary**: NONE FOUND
- **Status**: ALL CLEAR

---

## JavaScript Dependencies (client-next/package.json)

### Production Dependencies

| Package | Version | License | Status |
|---------|---------|---------|--------|
| react | ^18.2.0 | MIT | OK |
| react-dom | ^18.2.0 | MIT | OK |
| lucide-react | ^0.263.1 | ISC | OK |
| i18next | ^25.8.18 | MIT | OK |
| react-i18next | ^16.5.8 | MIT | OK |
| discreet-crypto | file:../discreet-crypto/pkg | AGPL-3.0 (own code) | OK |

### Dev Dependencies (not shipped to users)

| Package | Version | License | Status |
|---------|---------|---------|--------|
| @types/react | ^18.2.43 | MIT | OK |
| @types/react-dom | ^18.2.17 | MIT | OK |
| @vitejs/plugin-react | ^4.2.1 | MIT | OK |
| typescript | ^5.2.2 | Apache-2.0 | OK |
| vite | ^5.1.0 | MIT | OK |
| vite-plugin-top-level-await | ^1.4.1 | MIT | OK |
| vite-plugin-wasm | ^3.3.0 | MIT | OK |

### JavaScript Summary

- **Total production dependencies**: 6 (including own WASM module)
- **All MIT, ISC, or AGPL-3.0**: YES
- **SSPL/Commons Clause/Proprietary**: NONE FOUND
- **Third-party analytics/tracking scripts**: NONE
- **Status**: ALL CLEAR

---

## Transitive Dependencies

Transitive (indirect) dependencies inherit the license compatibility of their
parent crates. The Rust ecosystem's standard libraries (RustCrypto, Tokio,
Serde, etc.) are consistently licensed under MIT OR Apache-2.0.

Notable transitive dependencies and their licenses:
- **ring** (via rustls/tokio-rustls): ISC — OK
- **rustls** (via sqlx, reqwest): MIT OR Apache-2.0 — OK
- **webpki** (via rustls): ISC — OK
- **mio** (via tokio): MIT — OK
- **bytes** (via hyper, axum): MIT — OK
- **http** (via hyper, axum): MIT OR Apache-2.0 — OK
- **pin-project** (via tokio, tower): MIT OR Apache-2.0 — OK
- **proc-macro2** (via serde, thiserror): MIT OR Apache-2.0 — OK

---

## Known Issues

### OpenMLS curve25519-dalek CVE (Pre-existing)

OpenMLS 0.5.x depends on curve25519-dalek 3.x which has known CVEs
(RUSTSEC-2024-0344). This is documented in CLAUDE.md and the threat model.
Upgrade to OpenMLS 0.8.x (which uses curve25519-dalek 4.x) is required
before production deployment.

**Mitigation**: MLS feature is behind an opt-in feature flag (`mls`), not
enabled by default.

### No SSPL Dependencies

The project explicitly avoids MongoDB, Elastic, and other SSPL-licensed
databases. PostgreSQL (PostgreSQL License, permissive) and Redis (BSD-3-Clause)
are both AGPL-compatible.

---

## External Services (Not Dependencies)

These are optional external services accessed via HTTP API. They are NOT
bundled with the application and do NOT affect license compliance:

| Service | Usage | License Impact |
|---------|-------|----------------|
| Stripe API | Payment processing | None (API client only) |
| BTCPay Server | Crypto payments | MIT (self-hosted) |
| Cloudflare Turnstile | CAPTCHA | None (optional, client-side) |
| TURN/STUN servers | WebRTC relay | None (protocol, not code) |

---

## Audit Process

1. Reviewed `Cargo.toml` direct dependencies and their published licenses on crates.io
2. Reviewed `client-next/package.json` production and dev dependencies
3. Verified no SSPL, Commons Clause, or proprietary licenses in the dependency tree
4. Confirmed all cryptographic libraries use standard permissive licenses
5. Verified no third-party analytics, tracking, or telemetry dependencies

## Next Audit

Schedule the next audit when:
- Any dependency is added or updated
- Before any production release
- Quarterly as part of security review

---

Copyright (C) 2026 Citadel Open Source LLC. Licensed under AGPL-3.0-or-later.
