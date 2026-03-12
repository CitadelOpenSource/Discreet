# Security

Discreet is an encrypted communication platform. Security isn't a feature — it's the reason this project exists.

If you find a vulnerability, **please don't open a public issue.** Email security@discreetai.net instead. We'll acknowledge within 24 hours and aim to patch critical issues within 72 hours.

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
| A06 | Vulnerable Components | 7/10 | Deps pinned, audits documented, CI integration planned |
| A07 | Auth Failures | 10/10 | Argon2id + 2FA + lockout + session revocation |
| A08 | Data Integrity Failures | 9/10 | CSRF protection, file validation, compile-time SQL |
| A09 | Logging & Monitoring | 7/10 | Hash-chain audit log, health endpoint |
| A10 | SSRF | 10/10 | No server-side URL fetching |

**Total: 89/100**

The weak spots are dependency auditing in CI (planned) and centralized log aggregation (planned). We're honest about where we're not perfect yet.

## Bug bounty

We don't have a formal bug bounty program yet. If you report a valid security issue, we'll credit you in our changelog and this file (with your permission). If we ever start a paid bounty program, early reporters will be grandfathered in.

## License

AGPL-3.0-or-later. You can read every line of code that handles your data. That's the point.
