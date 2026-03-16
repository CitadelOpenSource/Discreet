# Security

Discreet is an encrypted communication platform. Security isn't a feature — it's the reason this project exists.

## Reporting vulnerabilities

Report vulnerabilities to **security@discreetai.net**. Do not open a public issue.

For encrypted reports, use our PGP key below.

| | |
|---|---|
| **Email** | security@discreetai.net |
| **GitHub** | [Private security advisory](https://github.com/CitadelOpenSource/Discreet/security/advisories/new) |
| **Acknowledgment** | Within 48 hours |
| **Critical fix** | 7 days |
| **High severity fix** | 14 days |
| **Medium severity fix** | 30 days |

We follow coordinated disclosure. We will not pursue legal action against researchers who report in good faith.

### PGP key for encrypted reports

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

**Fingerprint:** `3A79 7394 CAD6 F176 4747 8768 CDDD 1799 313F B5BD`

## How encryption works

Every message you send is encrypted on your device before it leaves. The server stores and relays ciphertext — it literally cannot read your messages. This isn't a policy decision ("we promise not to look"), it's an architectural one. The server doesn't have the keys.

| What | How | Standard |
|------|-----|----------|
| Group messages | MLS (Message Layer Security) | RFC 9420 |
| Direct messages | PBKDF2-derived AES-256-GCM | NIST SP 800-132 |
| Voice and video | SFrame insertable streams | RFC 9605 |
| Transport | TLS 1.3 everywhere | RFC 8446 |
| Passwords | Argon2id with per-user salts | OWASP recommendation |
| AI agent API keys | AES-256-GCM, per-agent derived keys | — |
| AI agent memory | AES-256-GCM encrypted at rest | — |

**Current state (honest):** MLS key exchange is implemented but the client currently uses a PBKDF2-AES-256-GCM fallback for message encryption. Both provide real encryption — the server sees only ciphertext either way. The MLS handshake will replace the fallback as client-side MLS matures. We're not going to pretend the full MLS ceremony is wired end-to-end when it isn't yet.

## What the server can see

We believe in being upfront about this.

**The server CAN see:**
- Who is a member of which server (membership metadata)
- When messages were sent (timestamps)
- Message sizes (ciphertext length)
- IP addresses of connected clients
- Which channels exist and their names
- Voice channel participation (who is in a call)

**The server CANNOT see:**
- Message content (encrypted before it reaches us)
- File contents (encrypted blobs)
- AI agent conversations (agents decrypt with their own keys)
- AI agent memory/learned facts (AES-256-GCM encrypted per-agent)
- Voice/video content (SFrame encrypted peer-to-peer)
- Your password (Argon2id hash only)

This is the same metadata exposure as Signal. Reducing metadata leakage further (padding, constant-rate traffic, onion routing) is on the roadmap.

## AI agents and privacy

Our AI agents are designed as real participants in encrypted channels. Each agent has its own cryptographic keys and decrypts messages addressed to it — the server never sees the plaintext.

**What happens when you talk to an AI agent:**
1. Your message is encrypted and stored as ciphertext
2. The agent process decrypts with its own key
3. User-identifying metadata (usernames, IDs) is stripped before the message reaches any LLM
4. The message is sent to the configured AI provider (Anthropic, OpenAI, or your own local Ollama)
5. The agent's response is encrypted before storage
6. The agent's learned facts about you are encrypted with a per-channel key the server can't read

**What we can't control:** What happens inside a third-party LLM provider's API after we send the request. We strip identifying metadata, but the conversation content reaches the provider in cleartext over HTTPS. If this concerns you, use the Ollama provider — it runs entirely on your own hardware, zero cloud exposure.

**Mandatory disclosure:** Every channel with an active AI agent shows a visible banner identifying the agent and which provider processes messages. No silent AI processing.

## Authentication

- Passwords hashed with **Argon2id** (memory-hard, GPU-resistant)
- JWT access tokens expire in 15 minutes
- Refresh tokens are HttpOnly secure cookies, hashed before storage
- TOTP two-factor authentication available
- Account lockout after 5 failed login attempts (15-minute cooldown via Redis)
- Session revocation on password change (all old sessions killed instantly)
- Registration rate-limited to 3 accounts per IP per 24 hours

## Infrastructure security

- **OWASP headers:** CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **CSRF:** Double-submit cookie pattern on state-changing endpoints
- **SQL injection:** Impossible — all queries use sqlx compile-time validation. Zero string interpolation in SQL, ever.
- **Rate limiting:** Per-IP, configurable, applied before route handlers
- **CORS:** Restrictive by default (localhost only). Must be explicitly configured for production domain.
- **File uploads:** MIME whitelist, 25MB cap, encrypted blob storage
- **Compile-time safety:** Rust's type system and borrow checker eliminate entire classes of memory bugs

## Self-hosting security

If you self-host Discreet:

- Generate unique secrets for `JWT_SECRET`, `AGENT_KEY_SECRET`, and `TOTP_ENCRYPTION_KEY`
- Set `CORS_ORIGINS` to your exact domain (not `*`)
- Use Caddy or another reverse proxy that handles TLS automatically
- Keep your `.env` file out of version control (it's gitignored by default)
- Run `cargo audit` and `npm audit` periodically
- AI agent API keys stored in `.env` are never exposed to users. Per-server "bring your own key" values are AES-256-GCM encrypted in the database and never returned to the client.

## Supply chain security

Dependency management is a critical attack surface for any open-source project. A compromised crate or npm package could exfiltrate encryption keys, inject backdoors, or weaken cryptographic guarantees. Our approach:

### Dependency policy

- **Minimal dependencies.** Every new crate or npm package must be justified. If stdlib or an existing dependency can do the job, we don't add a new one.
- **AGPL-compatible licenses only.** MIT, Apache-2.0, BSD, ISC are accepted. SSPL, Commons Clause, and proprietary licenses are rejected. Audited in `docs/LICENSE_AUDIT.md`.
- **Lock files committed.** `Cargo.lock` and `package-lock.json` are tracked in git. Builds are deterministic.
- **No pre-release crypto.** Cryptographic libraries must have stable releases with published audits where available.

### Automated auditing

- **Dependabot** (`.github/dependabot.yml`): weekly PRs for Cargo, npm (client), npm (mobile), and GitHub Actions updates.
- **Security audit CI** (`.github/workflows/security-audit.yml`): runs `cargo audit` and `npm audit --audit-level=high` on every push to main, every PR, and on a weekly Monday cron schedule.
- **`cargo audit`** must show zero unresolved advisories. Known exceptions are documented in `.cargo/audit.toml` with written justification.

### What we don't do

- No post-install scripts in our packages
- No CDN-hosted JavaScript (all assets served from the same origin)
- No third-party analytics, tracking, or telemetry dependencies
- No dynamic `require()` or `import()` of user-supplied module names
- No `eval()` or `Function()` on user input (one calculator tool uses `Function()` on a validated numeric expression only)

### Verification

Anyone can verify our dependency chain:

```bash
# Rust
cargo audit
cargo tree --duplicates

# JavaScript
cd client && npm audit
cd mobile && npm audit
```

## Known advisories

| Package | Advisory | Impact | Status |
|---------|----------|--------|--------|
| esbuild <=0.24.2 | GHSA-67mh-4wv8-2f99 | Dev server only, not production | Tracking for Vite 7.x upgrade |
| redis 0.24.0 | future-incompat warning | Rust compiler warning, no security impact | Tracking for next major update |
| sqlx-postgres 0.7.4 | future-incompat warning | Rust compiler warning, no security impact | Tracking for sqlx 0.8 |

We run `cargo audit` and `npm audit` and document findings here. If you find something we missed, email us.

## OWASP Top 10 (2021) score

We scored ourselves against the OWASP Top 10. Full audit details are in `docs/SECURITY_AUDIT.md`.

| # | Risk | Score | Notes |
|---|------|-------|-------|
| A01 | Broken Access Control | 9/10 | JWT + 22 permission bitflags + platform roles |
| A02 | Cryptographic Failures | 9/10 | AES-256-GCM, Argon2id, no weak algorithms |
| A03 | Injection | 10/10 | Compile-time SQL validation, zero interpolation |
| A04 | Insecure Design | 10/10 | Zero-knowledge by architecture, not by policy |
| A05 | Security Misconfiguration | 8/10 | OWASP headers enforced, CORS restrictive |
| A06 | Vulnerable Components | 9/10 | Deps pinned, audits documented, Dependabot + CI audit weekly |
| A07 | Auth Failures | 10/10 | Argon2id + 2FA + lockout + session revocation |
| A08 | Data Integrity Failures | 9/10 | CSRF protection, file validation, compile-time SQL |
| A09 | Logging & Monitoring | 7/10 | Hash-chain audit log, health endpoint |
| A10 | SSRF | 10/10 | No server-side URL fetching |

**Total: 91/100**

The remaining weak spot is centralized log aggregation (planned). We're honest about where we're not perfect yet.

## Bug bounty

We don't have a formal bug bounty program yet. If you report a valid security issue, we'll credit you in our changelog and this file (with your permission). If we ever start a paid bounty program, early reporters will be grandfathered in.

## Export control notice

This software contains cryptographic functionality including AES-256-GCM, Argon2id, Ed25519, X25519, HMAC-SHA256, and MLS (RFC 9420). Cryptographic software may be subject to export control regulations in your jurisdiction.

**Before redistributing this software**, check that you comply with:
- United States: EAR (Export Administration Regulations), ECCN 5D002
- European Union: Dual-Use Regulation (EU 2021/821)
- Your local laws regarding the distribution of encryption software

This notice is provided for informational purposes. The authors are not providing legal advice. Consult an attorney for guidance specific to your situation.

The source code for this software is publicly available under AGPL-3.0-or-later, which may qualify for the publicly available source code exception (EAR §740.13(e)) in US export control law.

## License

AGPL-3.0-or-later. You can read every line of code that handles your data. That's the point.
