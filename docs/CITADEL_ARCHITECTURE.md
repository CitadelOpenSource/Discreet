# Citadel Architecture Document

**Version:** 0.1.0-alpha
**Status:** Active Development
**License:** AGPL-3.0-or-later
**Last Updated:** 2026-02-23

---

## 1. Mission Statement

Citadel is a community communication platform where the server is architecturally incapable of reading message content. It provides feature-equivalent functionality (servers, channels, roles, voice) with Signal-equivalent encryption (E2EE for all text, voice, video, and files).

The server is a **relay**, not an oracle. It routes encrypted blobs between authenticated clients. Cryptographic operations happen exclusively on client devices.

---

## 2. Threat Model

### What we protect against

| Threat | Mitigation |
|--------|-----------|
| Server compromise | Zero-knowledge architecture. Database contains only ciphertext. |
| Man-in-the-middle | TLS 1.3 for transport. MLS for application-layer E2EE. Identity key verification. |
| Compromised device (past) | Perfect Forward Secrecy via MLS epoch rotation. |
| Compromised device (future) | Post-Compromise Security via MLS tree-based key agreement. |
| Metadata analysis | Minimal metadata stored. IP logging configurable. Tor-compatible. |
| Rogue server operator | Cannot decrypt content. Can see metadata (who, when, where — not what). |
| Supply chain attack | AGPL-3.0 open source. Reproducible builds. Dependency auditing via `cargo-audit`. |

### What we explicitly do NOT protect against

| Threat | Reason |
|--------|--------|
| Compromised client device (active) | If malware controls the device, it can read decrypted messages. This is true of all E2EE systems. |
| Metadata timing analysis | The server knows when messages are sent and to which channels. Padding and traffic analysis resistance are future work. |
| Social engineering | Users can be tricked into accepting malicious identity keys. Safety numbers mitigate this. |
| Screenshot/screen recording | Content on the user's screen is outside the encryption boundary. |

---

## 3. Cryptographic Protocol Stack

### 3.1 Group Messaging — MLS (RFC 9420)

All channel messages use the Messaging Layer Security protocol, an IETF standard (RFC 9420).

**Why MLS over Signal Protocol for groups:**
- Signal Protocol's Sender Keys approach requires O(n) messages for group key rotation
- MLS uses a tree-based key agreement (TreeKEM) achieving O(log n) complexity
- MLS provides Post-Compromise Security: if a member's device is compromised then secured, future messages become secure after the next epoch change
- MLS is an IETF standard with formal security proofs (Alwen et al., 2020; Brzuska et al., 2021)

**Cipher suite:** `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`
- KEM: X25519 (RFC 7748)
- AEAD: AES-128-GCM (NIST SP 800-38D)
- Hash: SHA-256 (FIPS 180-4)
- Signature: Ed25519 (RFC 8032)

**Implementation:** OpenMLS (Rust, audited) — https://github.com/openmls/openmls

**Lifecycle:**
1. Channel created → Creator initializes MLS group
2. User joins channel → Creator (or any member with Commit rights) adds user via MLS Add proposal
3. Welcome message → New member receives group state via MLS Welcome
4. Message sent → Client encrypts plaintext → MLS ApplicationMessage ciphertext → sent to server
5. Message received → Server relays ciphertext → Client decrypts with group key
6. Key rotation → Periodic MLS Commit updates rotate the group key (epoch change)
7. User leaves → MLS Remove proposal → group key rotates → departed user cannot decrypt future messages

### 3.2 Direct Messages — X3DH + Double Ratchet

DMs between two users use the Signal Protocol:
- **X3DH** (Extended Triple Diffie-Hellman) for initial key agreement
- **Double Ratchet** for ongoing message encryption with forward secrecy

**Implementation:** libsignal-protocol (Rust bindings) or vodozemac (Matrix's Rust implementation)

### 3.3 Voice/Video — WebRTC + SFrame

Voice and video use WebRTC with encryption at the media frame level:
- Standard WebRTC for NAT traversal (ICE/STUN/TURN)
- **SFrame** (RFC 9605) for encrypting individual media frames
- Frame encryption keys derived from the MLS group epoch secret
- The TURN relay server handles encrypted frames it cannot decrypt

### 3.4 File Attachments

Files are encrypted client-side before upload:
1. Generate random 256-bit file key
2. Encrypt file with AES-256-GCM using the file key
3. Upload ciphertext blob to server
4. Encrypt the file key within the MLS ApplicationMessage alongside the message text
5. Recipients decrypt message → extract file key → download and decrypt blob

---

## 4. Server Architecture

### 4.1 Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | Rust 1.77+ | Memory safety without GC. Fearless concurrency. Performance. |
| Web framework | Axum 0.7 | async/await, tower middleware, WebSocket support |
| Database | PostgreSQL 16 | ACID transactions, JSONB, full-text search on metadata |
| Cache/Pubsub | Redis 7 | WebSocket fan-out, session cache, rate limiting |
| Voice relay | CoTURN | STUN/TURN for NAT traversal |
| Reverse proxy | Caddy 2 | Automatic HTTPS via Let's Encrypt |
| Container | Docker + Compose | One-command deployment |

### 4.2 API Design

REST for CRUD operations. WebSocket for real-time events. All endpoints require JWT authentication except `/health`, `/api/v1/info`, `/api/v1/auth/register`, and `/api/v1/auth/login`.

**Authentication flow:**
1. Client registers with username + password (Argon2id hash stored)
2. Client logs in → receives JWT (15-min expiry) + refresh token (7-day expiry)
3. JWT included in `Authorization: Bearer <token>` header
4. Refresh token used to obtain new JWT without re-entering password

**WebSocket protocol:**
1. Client connects to `GET /ws?server_id=<uuid>` with JWT in the `Authorization: Bearer <token>` header
2. Server validates JWT, associates connection with user
3. Server subscribes connection to relevant channels (based on server membership)
4. Events are JSON objects with `type` field:

```json
{
  "type": "message_create",
  "channel_id": "uuid",
  "message": {
    "id": "uuid",
    "author_id": "uuid",
    "content_ciphertext": "base64...",
    "mls_epoch": 42,
    "created_at": "2026-02-23T12:00:00Z"
  }
}
```

### 4.3 Database Schema Principles

- `content_ciphertext` columns store ONLY encrypted blobs (MLS ApplicationMessage)
- The server NEVER has columns for plaintext message content
- Metadata columns (timestamps, user IDs, channel IDs) are the minimum needed for routing
- All UUIDs are v4 (random) to prevent enumeration
- Passwords are Argon2id hashes (memory: 64MB, iterations: 3, parallelism: 4)
- Sessions are tracked for multi-device support and revocation

### 4.4 Message Flow (detailed)

```
Client A                    Server                     Client B
   |                          |                          |
   |-- encrypt(plaintext) --> |                          |
   |   MLS ApplicationMessage |                          |
   |                          |                          |
   |-- POST /messages ------> |                          |
   |   { ciphertext, epoch }  |                          |
   |                          |-- store in PostgreSQL    |
   |                          |   (ciphertext only)      |
   |                          |                          |
   |                          |-- WS: message_create --> |
   |                          |   { ciphertext, epoch }  |
   |                          |                          |
   |                          |   decrypt(ciphertext) <--|
   |                          |   MLS group key          |
   |                          |                          |
   |                          |   --> plaintext          |
```

---

## 5. Client Architecture

### 5.1 Platform Strategy

| Platform | Technology | Crypto Library |
|----------|-----------|---------------|
| Windows/Mac/Linux | Tauri 2 (Rust + WebView) | OpenMLS (native Rust) |
| iOS/Android | React Native | OpenMLS via rust-ffi bridge |
| Web | React SPA | OpenMLS compiled to WASM |

The crypto layer is always the same Rust code (OpenMLS), compiled for each target. This eliminates the risk of cryptographic implementation differences between platforms.

### 5.2 Multi-Device Support

Each device has its own MLS KeyPackage. When a user has 3 devices, they appear as 3 leaves in each MLS group tree. A message encrypted to the group is decryptable by all 3 devices independently.

**Device linking flow:**
1. New device generates identity key pair
2. User authenticates on new device (password + optional 2FA)
3. New device uploads KeyPackages to server
4. Existing devices are notified and can verify the new device's identity key
5. For each channel the user belongs to, a member issues an MLS Add for the new device's KeyPackage

### 5.3 Local Storage

Each client maintains:
- SQLite database of decrypted messages (for search and offline access)
- MLS group state for each channel
- Signal Protocol session state for each DM
- Identity keys (encrypted at rest with device-local key derived from user password)

**Key export/import:** Users can export their identity keys as an encrypted backup file, protected by a passphrase. This is required to restore message history on a new device.

---

## 6. Permissions Model

Bitfield-based permissions (community-compatible model):

```
SEND_MESSAGES      = 0x0001
READ_MESSAGES      = 0x0002
MANAGE_MESSAGES    = 0x0004
MANAGE_CHANNELS    = 0x0008
MANAGE_SERVER      = 0x0010
MANAGE_ROLES       = 0x0020
KICK_MEMBERS       = 0x0040
BAN_MEMBERS        = 0x0080
CONNECT_VOICE      = 0x0100
SPEAK_VOICE        = 0x0200
STREAM_VIDEO       = 0x0400
UPLOAD_FILES       = 0x0800
CREATE_INVITES     = 0x1000
MANAGE_THREADS     = 0x2000
MENTION_EVERYONE   = 0x4000
ADMINISTRATOR      = 0x8000
```

**Resolution order:** User permissions = @everyone role | all assigned role permissions | channel-specific overrides

**E2EE implication for moderation:** Since the server cannot read messages, moderation works through user reports (the reporter includes decrypted content) and client-side filtering. Bans and kicks operate on accounts, not message content.

---

## 7. Compliance & Transparency

### What the server operator CAN provide to law enforcement (with valid legal order):
- Account metadata: username, email, creation date, last login
- Connection logs: IP addresses, timestamps
- Server membership: which servers a user belongs to
- Message metadata: timestamps, channel IDs, message sizes
- Moderation actions: bans, kicks (from audit log)

### What the server operator CANNOT provide (by mathematical design):
- Message content (stored as MLS ciphertext; server has no decryption keys)
- File contents (encrypted before upload)
- Voice/video recordings (never recorded; encrypted in transit only)

### Transparency infrastructure:
- Public transparency report at `/api/v1/transparency/report`
- Warrant canary at `/api/v1/transparency/canary`
- Immutable audit log of all moderation actions

---

## 8. Scalability Path

### Phase 1: Single Instance (0–50K users)
Docker Compose on a single server. PostgreSQL + Redis on the same host.

### Phase 2: Separated Services (50K–500K users)
- Dedicated PostgreSQL with read replicas
- Redis Cluster for pub/sub fan-out
- Multiple Citadel server instances behind load balancer
- Sticky WebSocket sessions via consistent hashing on user ID

### Phase 3: Horizontal Scale (500K–10M+ users)
- Kubernetes with HPA
- CockroachDB or Citus for distributed PostgreSQL
- Message sharding by channel_id
- Regional TURN server clusters
- CDN for static assets and encrypted blob downloads

---

## 9. Development Roadmap

### Alpha (Current → Month 3)
- [x] Database schema
- [x] Project structure and build system
- [ ] Authentication (register, login, JWT, sessions)
- [ ] Server/channel CRUD
- [ ] WebSocket real-time message relay
- [ ] Basic text messaging (plaintext initially, E2EE by alpha end)
- [ ] MLS integration via OpenMLS
- [ ] React web client with basic UI
- [ ] Docker deployment

### Beta (Month 3–6)
- [ ] Voice channels with SFrame E2EE
- [ ] File attachments (encrypted upload/download)
- [ ] Roles and permissions
- [ ] Multi-device support
- [ ] Tauri desktop client
- [ ] React Native mobile client (iOS + Android)
- [ ] Invite system

### Release Candidate (Month 6–9)
- [ ] Bot framework
- [ ] Rich content (markdown, embeds, reactions)
- [ ] Threads
- [ ] Client-side search (SQLite FTS5)
- [ ] 2FA (TOTP)
- [ ] Security audit by independent firm

### 1.0 (Month 9–12)
- [ ] Federation protocol (Citadel-to-Citadel)
- [ ] Tor hidden service support
- [ ] Matrix bridge
- [ ] Performance benchmarks and optimization
- [ ] Accessibility (WCAG 2.1 AA)

---

## 10. Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and PR process.

**Priority areas for contributors:**
1. **Cryptography review** — Review MLS integration, key management, protocol implementation
2. **Rust backend** — API endpoints, WebSocket handling, database queries
3. **React frontend** — UI components, state management, real-time updates
4. **Mobile** — React Native client, rust-ffi crypto bridge
5. **Infrastructure** — Docker, CI/CD, deployment automation
6. **Documentation** — User guides, API reference, translations

---

## References

1. RFC 9420 — The Messaging Layer Security (MLS) Protocol. IETF, July 2023.
2. RFC 7748 — Elliptic Curves for Security (X25519). IETF, January 2016.
3. RFC 8032 — Edwards-Curve Digital Signature Algorithm (Ed25519). IETF, January 2017.
4. RFC 9605 — Secure Frame (SFrame). IETF, August 2024.
5. Alwen et al. — "On The Insider Security of MLS." CRYPTO 2020.
6. Brzuska et al. — "Security Analysis of the MLS Key Derivation." IEEE S&P 2021.
7. Cohn-Gordon et al. — "A Formal Security Analysis of the Signal Messaging Protocol." EuroS&P 2017.
8. OpenMLS — https://github.com/openmls/openmls (Rust MLS implementation, audited by Cure53)

---

## Proximity Communication Architecture (In Progress)

### Multi-Transport Design
```
┌───────────────────────────────────────────────────┐
│                    User Device                     │
├───────────────────────────────────────────────────┤
│                Message Router                      │
│   Selects transport based on connectivity:         │
│   1. WebSocket (internet available)                │
│   2. BLE Mesh (Bluetooth only)                     │
│   3. Wi-Fi Direct (voice, file transfer)           │
├───────────────────────────────────────────────────┤
│  WebSocket      │  BLE Stack       │  Wi-Fi P2P   │
│  ↕ Server       │  ↕ Peers         │  ↕ Peers     │
│  TLS 1.3        │  AES-256-GCM     │  DTLS-SRTP   │
│  MLS/PBKDF2     │  ECDH keys       │  WebRTC      │
└───────────────────────────────────────────────────┘
```

### BLE Mesh Topology
```
[Phone A] ←BLE→ [Phone B] ←BLE→ [Phone C]
                     ↕
              [RPi Relay Node]
                     ↕
                 [Phone D]
```

Each hop: ~100m range, max 7 hops = ~700m in dense environments.
All messages encrypted end-to-end — relay nodes are zero-knowledge.

### Offline → Online Sync Flow
```
1. Internet drops → NetInfo detects
2. Proximity Mode activates (if enabled)
3. Messages sent via BLE → stored in AsyncStorage outbox
4. Internet returns → NetInfo detects
5. Outbox messages uploaded to server (POST /proximity/sync)
6. Missed messages downloaded (GET /proximity/missed)
7. Messages merged by timestamp into channel history
```
