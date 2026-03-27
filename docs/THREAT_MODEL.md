# Discreet Threat Model

> Written for security researchers, cryptographers, and penetration testers.
> Last updated: 2026-03-15

## 1. Trust Boundaries

```
┌─────────────┐     TLS 1.3      ┌──────────────┐     TLS      ┌────────────┐
│   Client     │ ◄──────────────► │   Server     │ ◄──────────► │ PostgreSQL │
│  (Browser /  │                  │  (Rust/Axum) │              │   (data)   │
│   Tauri /    │                  │              │              └────────────┘
│   Mobile)    │                  │              │     TLS      ┌────────────┐
│              │                  │              │ ◄──────────► │   Redis    │
└──────┬───────┘                  └──────┬───────┘              │  (cache)   │
       │                                 │                      └────────────┘
       │  DTLS/SRTP (P2P)               │
       ◄─────────────────────────────────┘
       │                          ┌──────────────┐
       │     TURN relay           │  TURN Server │
       ◄─────────────────────────►│  (coturn)    │
                                  └──────────────┘
```

### Boundary definitions

| Boundary | Trust level | Notes |
|----------|-------------|-------|
| Client ↔ Server | TLS 1.3, JWT auth | Server sees metadata but NOT plaintext message content |
| Server ↔ PostgreSQL | Same host or TLS | Server has full DB read/write. DB stores ciphertext. |
| Server ↔ Redis | Same host or TLS | Session cache, rate limits, presence. No message content. |
| Client ↔ Client (voice) | DTLS-SRTP, optional SFrame E2EE | Voice P2P via WebRTC. Server relays ICE candidates only. |
| Client ↔ TURN | TURN relay for NAT traversal | TURN sees encrypted media packets. Cannot decrypt with SFrame. |
| Client ↔ CDN | TLS | Static assets only. No user data transits CDN. |

## 2. Attack Surfaces

### 2.1 REST API (`/api/v1/*`)

- **Auth endpoints** (`/auth/register`, `/auth/login`, `/auth/refresh`): Credential stuffing, brute force, account enumeration.
- **Mitigation**: Argon2id hashing (memory=19456, iterations=2), identical error messages for "user not found" vs "wrong password", Redis-backed rate limiting (fail-closed), CSRF double-submit cookie.

### 2.2 WebSocket (`/ws`)

- **Connection auth**: JWT passed as query parameter (TLS-only, no server-side logging of query params).
- **Attack**: Token theft via referrer leakage, browser history, proxy logs.
- **Mitigation**: Short-lived access tokens (15 min), HttpOnly refresh cookie, token not persisted to localStorage.

### 2.3 File Upload (`/channels/:id/files`)

- **Attack**: Malicious file content, path traversal, storage exhaustion.
- **Mitigation**: Base64 blob storage (not filesystem), per-tier storage limits, 35 MB body limit, content-type validation, no server-side file execution.

### 2.4 Voice/Video (WebRTC)

- **Attack**: Overbilling TURN, eavesdropping on relay, overbilling by joining many channels.
- **Mitigation**: TURN credentials are short-lived, SFrame E2EE encrypts media end-to-end (when supported), server never touches audio/video data in P2P mode.

### 2.5 Authentication

- **Password hashing**: Argon2id with memory=19456 KiB, iterations=2, parallelism=1.
- **Session management**: UUID session IDs, refresh token hashed with SHA-256, revocation via Redis set + DB column.
- **2FA**: TOTP (RFC 6238) with AES-256-GCM encrypted secret storage.

## 3. Threat Actors

### 3.1 Passive Network Observer

An attacker who can observe network traffic but cannot modify it (e.g., ISP, WiFi sniffer, government tap).

**Can access:**
- TLS connection metadata: IP addresses, connection timing, data volume
- DNS queries (unless DoH/DoT)
- That the user is communicating with Discreet servers

**Cannot access:**
- Message content (TLS 1.3 + E2EE)
- Which channels or servers the user is in
- Voice/video content (DTLS-SRTP + optional SFrame)

**Mitigations:**
- TLS 1.3 for all connections
- HSTS with preload (max-age=63072000)
- Proxy/VPN support in client settings
- No telemetry, no analytics, no third-party requests

### 3.2 Compromised Server

An attacker who has full read/write access to the Discreet server process and database.

**Can access:**
- All metadata: who sent messages, when, in which channel, to whom
- Message ciphertext (but NOT plaintext)
- User account data: usernames, email hashes, hashed passwords
- Server/channel structure, membership lists
- File attachment ciphertext
- Session tokens (can impersonate users for API calls)
- TOTP secrets (AES-256-GCM encrypted, but key is on the server)

**Cannot access:**
- Message plaintext (encrypted client-side with MLS/PBKDF2 keys)
- Voice/video content (P2P with DTLS-SRTP, SFrame when active)
- User passwords (Argon2id hashed, not reversible)

**Cannot do (without detection):**
- Inject messages that pass client-side signature verification (when MLS is active)
- Modify message history without breaking the audit log chain hash

**Mitigations:**
- Client-side encryption using MLS RFC 9420 (OpenMLS)
- PBKDF2 fallback when MLS group isn't established
- Tamper-evident audit log with chained SHA-256 hashes
- Server never sees encryption keys

**Known limitation:** The server CAN serve malicious JavaScript to the web client. A compromised server could modify the client bundle to exfiltrate keys. Mitigation: Subresource Integrity (SRI), reproducible builds (planned), desktop/mobile apps with pinned builds.

### 3.3 Malicious User

A registered user who attempts to abuse the platform.

**Can access:**
- Their own messages and channels they're a member of
- Public server discovery listings
- Other users' display names and online status (per privacy settings)

**Cannot access:**
- Messages in channels they haven't joined
- Other users' DMs
- Other users' email addresses
- Server administration functions (without appropriate role)

**Attack vectors and mitigations:**

| Attack | Mitigation |
|--------|------------|
| Spam / flood | Per-IP and per-user rate limiting (Redis, fail-closed) |
| @everyone abuse | Server-configurable mention permissions (admin/mod/everyone) |
| Malicious file upload | Content validation, size limits, no server-side execution |
| XSS in messages | React auto-escaping, no dangerouslySetInnerHTML on user content |
| Account enumeration | Login returns identical errors regardless of failure reason |
| Invite abuse | Rate-limited invite creation, expiring invites, max-use limits |

### 3.4 Malicious Platform Admin

A platform administrator (`platform_role = 'admin'`) who abuses their access.

**Can access:**
- All metadata (same as compromised server)
- User account management (ban, role changes)
- Compliance exports (ciphertext only)
- Platform settings (maintenance mode, kill switches)

**Cannot access:**
- Message plaintext (compliance export returns ciphertext hex)
- User passwords (hashed)
- Voice/video content

**Mitigations:**
- Compliance exports are audit-logged with actor, timestamp, and scope
- Compliance exports rate-limited to 1 per hour
- All admin actions recorded in tamper-evident audit log
- Admin role is separate from server ownership

**Known limitation:** A malicious admin can ban users, disable services, or modify platform settings. These actions are logged but not preventable by the system. Organizational controls (multi-admin approval, access reviews) are recommended.

### 3.5 Supply Chain Attacker

An attacker who compromises a dependency (Rust crate, npm package).

**Mitigations:**
- `cargo audit` required to show zero vulnerabilities
- AGPL-compatible licenses only (GPL, MIT, Apache 2.0, BSD)
- `Cargo.lock` and `package-lock.json` committed and reviewed
- Minimal dependency philosophy: prefer stdlib solutions
- No client-side analytics, tracking, or third-party scripts
- CSP headers restrict script sources

**Resolved:** OpenMLS upgraded to 0.8.1 with curve25519-dalek 4.x, resolving all known CVEs in the prior 0.5.x dependency chain.

## 4. Cryptographic Guarantees

### What E2EE protects

| Property | Protected | Notes |
|----------|-----------|-------|
| Message content confidentiality | Yes | AES-256-GCM via MLS or PBKDF2-derived keys |
| Message integrity | Yes | GCM authentication tag, MLS transcript hash |
| Forward secrecy | Partial | MLS provides forward secrecy per epoch; PBKDF2 fallback does NOT |
| Post-compromise security | Partial | MLS key rotation; requires active group management |
| Sender authentication | Yes (MLS) | MLS signing keys verify sender identity within the group |
| Voice/video confidentiality | Yes (SFrame) | When SFrame is active; falls back to DTLS-SRTP otherwise |

### What E2EE does NOT protect

| Property | Status | Notes |
|----------|--------|-------|
| Message metadata | NOT protected | Server sees: sender, recipient, timestamp, channel, message size |
| Timing analysis | NOT protected | Server can correlate send/receive timing across channels |
| Message size | NOT protected | Ciphertext length reveals approximate plaintext length |
| Online status | NOT protected | Server tracks presence for real-time features |
| Typing indicators | NOT protected | Server broadcasts typing events (user can disable) |
| Channel membership | NOT protected | Server maintains membership lists for access control |
| File attachment metadata | NOT protected | Filename, size, MIME type visible to server |
| Group membership changes | NOT protected | Server manages MLS group add/remove operations |
| Deleted message existence | NOT protected | Server knows a message existed even after deletion |

### Encryption parameters

| Parameter | Value |
|-----------|-------|
| Symmetric cipher | AES-256-GCM |
| Key derivation (fallback) | PBKDF2-SHA256, 100,000 iterations |
| Key derivation (MLS) | MLS RFC 9420 key schedule |
| Password hashing | Argon2id (memory=19456, iterations=2, parallelism=1) |
| Key exchange (fallback) | X25519 |
| Signing (MLS) | Ed25519 |
| TOTP secret encryption | AES-256-GCM with server-side key |
| API key encryption | AES-256-GCM with configurable server key |
| Audit log integrity | SHA-256 chained hashes |
| Transport | TLS 1.3 (HSTS preload) |
| Voice transport | DTLS-SRTP with optional SFrame |
| Salt for key derivation | `mls-group-secret` (per-channel) |
| Key identifier format | `discreet:{channelId}:{epoch}` |

## 5. Known Limitations

### 5.1 Web client trust

The web client is served by the same server that stores ciphertext. A compromised server can serve a modified client that exfiltrates encryption keys. This is an inherent limitation of web-based E2EE.

**Planned mitigations:** Subresource Integrity (SRI), reproducible builds, code signing for desktop/mobile apps, browser extension for client verification.

### 5.2 PBKDF2 fallback

When MLS groups are not established (first message, key package unavailable), the system falls back to PBKDF2-derived symmetric keys. This provides confidentiality but NOT forward secrecy — compromise of the channel ID and epoch reveals all messages encrypted under that key.

**Mitigation:** MLS group establishment is automatic. PBKDF2 is a transitional measure.

### 5.3 Metadata leakage

The server necessarily sees communication metadata to route messages. This includes who communicates with whom, when, and how often. No practical mitigation exists for a real-time messaging system without introducing unacceptable latency.

### 5.4 JWT in WebSocket query params

WebSocket connections pass the JWT as a query parameter (`?token=...`). This token may appear in server access logs, proxy logs, or browser history.

**Mitigations:** Access tokens are short-lived (15 min), server does not log query parameters, TLS encrypts the URL in transit, tokens are memory-only (not persisted).

### 5.5 Single-server architecture

Discreet currently runs as a single server instance. There is no federation, no multi-region replication, and no distributed trust. The server operator has full metadata access.

### 5.6 OpenMLS transitive dependencies

OpenMLS 0.8.1 resolved the curve25519-dalek and ed25519-dalek CVEs present in 0.5.x. Remaining transitive advisories (vodozemac unmaintained, libcrux-poly1305 panic, libcrux-sha3 SHAKE output) are documented in `.cargo/audit.toml` — none affect Discreet's code paths. Re-evaluated monthly.

### 5.7 Bot message content

AI bot messages are stored as plaintext bytes in the `content_ciphertext` column (bots are not MLS group members). Bot responses are visible to the server. Users should be aware that conversations with bots are not end-to-end encrypted.

## 6. Reporting Vulnerabilities

If you discover a security vulnerability in Discreet, please report it responsibly:

- **Email:** security@discreetai.net
- **GitHub:** Open a private security advisory at github.com/CitadelOpenSource/Discreet
- **Do NOT** open a public issue for security vulnerabilities

We aim to acknowledge reports within 48 hours and provide a fix timeline within 7 days.

---

Copyright (C) 2026 Citadel Open Source LLC. Licensed under AGPL-3.0-or-later.
