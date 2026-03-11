# Discreet

**Zero-knowledge community chat. The server is mathematically incapable of reading your messages.**

**[discreetai.net](https://discreetai.net)** | **Patent Pending** | **AGPL-3.0**

Discreet is an open-source encrypted community platform with Signal-level end-to-end encryption. Servers, channels, roles, DMs, friends, reactions, typing indicators — all the features you expect from modern chat, with one critical difference: the server stores only encrypted ciphertext. It cannot decrypt, search, or moderate your content. Ever.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Rust](https://img.shields.io/badge/Built_with-Rust_1.93-orange.svg)](https://www.rust-lang.org/)
[![MLS](https://img.shields.io/badge/Encryption-MLS_RFC_9420-green.svg)](https://www.rfc-editor.org/rfc/rfc9420)
[![CI](https://github.com/CitadelOpenSource/Discreet/actions/workflows/ci.yml/badge.svg)](https://github.com/CitadelOpenSource/Discreet/actions)

---

## Why Discreet?

No existing platform combines all five properties:

| Platform | Community UX | E2EE | Open Source | Self-Hostable | AI Agents |
|----------|:---:|:---:|:---:|:---:|:---:|
| Discord | Yes | No | No | No | No |
| Signal | No | Yes | Yes | No | No |
| Element/Matrix | Partial | Partial | Yes | Yes | No |
| Revolt | Yes | No | Yes | Yes | No |
| Wire | Yes | Yes | Yes | Paid | No |
| **Discreet** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |

---

## Status: v0.23.1-alpha

### Platforms

| Platform | Method | Status | Binary |
|----------|--------|--------|--------|
| Web | Chrome/Firefox/Safari/Edge (PWA-ready) | Working | Served |
| Windows | Tauri .msi | Compiling + running | ~15MB |
| macOS | Tauri .dmg | Ready to build | ~15MB |
| Linux | Tauri .AppImage | Ready to build | ~15MB |
| Android | React Native APK | In progress | ~25MB |
| iOS | React Native IPA | In progress | ~25MB |

**46 TypeScript files** · **18,500+ lines React/TS** · **184 API routes** · **50+ database tables** · **14,500+ lines Rust** · **26 migrations** · **29 components**

### What Works Today

**Core Communication** — Text channels with E2EE (server stores only ciphertext), message send/receive/edit/delete with real-time WebSocket delivery, encrypted DMs and Group DMs (2-10 members), typing indicators, emoji reactions, pinned messages, Discord-style markdown (bold/italic/code/spoilers/links/blockquotes), encrypted file upload/download (50MB cap), @mentions with autocomplete, message replies with quoted context, message pagination, browser notifications, GIF picker (Tenor API), inline media display, URL preview embeds, voice messages.

**Social** — Friends system (search/request/accept/decline/remove/block), user profiles with bios and custom avatars, user settings (theme/font/privacy/notifications), per-server notification settings, real-time presence (Online/Idle/DND/Invisible) with auto-idle detection, unread message badges, member list with online/total count.

**Server Management** — Server CRUD with invite codes and vanity URLs, channel categories, 3 channel types (text, voice, forum), RBAC with 22 permission bitflags and position-based role hierarchy, ban/unban with audit logging, custom emoji (50/server), forum channels with threaded discussions, server events with RSVP, moderation panel (search & bulk delete, auto-mod rules, timeout with 8 duration options), admin members tab, bot marketplace (10 curated AI bots), immutable SHA-256 hash-chain audit ledger.

**Voice & Video** — WebRTC peer-to-peer voice channels, screen sharing / Go Live, video streaming grid, E2EE voice signaling via WebSocket, professional audio processing chain (noise gate, compressor, expander, noise suppression, echo cancellation, AGC, 5-band EQ), voice activation and push-to-talk, per-device I/O selection, encrypted RTMP streaming (patent-pending), Watch Together (synced YouTube playback), Zoom-style meetings (6-digit code join, guest access, E2EE).

**Client Features** — Home screen with quick actions and recent conversations, 18 right-click context menus with mobile long-press support, slash commands with autocomplete, emoji picker (900+ emojis), SVG avatar creator (15+ customization categories), 80+ user settings across 12 tabs with search.

**Bot System** — Bot creation endpoints, BOT badge on messages, comprehensive 5-tab bot config modal (general, behavior, personality, limits, advanced), 14 persona types, multi-language support (11 languages).

**Security** — OWASP-hardened HTTP headers, IP-based rate limiting, Argon2id + JWT + refresh tokens, TOTP 2FA, configurable CORS, password complexity enforcement, parameterized SQL (zero string interpolation), multi-device sessions, WebSocket JWT validation.

**AI Agent Framework** — Auto-spawning specialist AI agents as encrypted channel members (patent-pending).

**Deployment** — Docker Compose (primary), Raspberry Pi 4 guide ($50 hardware), cross-compilation to ARM64, Oracle Cloud free tier guide, Tailscale/Cloudflare Tunnel for remote access.

### Coming Next

- Oracle Cloud deployment (alpha hosting on free tier)
- Custom domain + SSL with Let's Encrypt
- Proximity mesh mode: encrypted BLE text + Wi-Fi Direct voice without internet
- Raspberry Pi relay nodes for mesh range extension
- Community launch

### Proximity Mesh Communication

The app that works when the internet goes down. Toggle "Proximity Mode" in settings to:

- **Discover** nearby Discreet users via Bluetooth Low Energy (~100m range)
- **Text** encrypted messages over BLE mesh — no internet, no server, no cellular
- **Voice** call over Wi-Fi Direct — your phone becomes a local encrypted server (~200m)
- **Extend range** with Raspberry Pi relay nodes
- **Auto-fallback** — seamlessly switches between online and offline modes

Messages queue offline and sync when connectivity returns. Zero-knowledge is maintained because encryption keys never leave your device.

---

## Quick Start

See the [Quickstart Guide](GUIDE/QUICKSTART.md) for detailed setup instructions.

### Linux / macOS

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git && cd Discreet
docker compose up -d
for f in migrations/*.sql; do cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel; done
export DATABASE_URL="postgres://citadel:citadel@localhost:5432/citadel"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="$(openssl rand -hex 64)"
cargo run    # http://localhost:3000
```

### Windows

```powershell
git clone https://github.com/CitadelOpenSource/Discreet.git; cd Discreet
docker compose up -d
# Apply all migrations:
Get-ChildItem migrations\*.sql | ForEach-Object { Get-Content $_.FullName | docker compose exec -T postgres psql -U citadel -d citadel }
$env:DATABASE_URL="postgres://citadel:citadel@localhost:5432/citadel"
$env:REDIS_URL="redis://localhost:6379"
$env:JWT_SECRET=(openssl rand -hex 64)
cargo run    # http://localhost:3000
```

### Verify

```bash
curl http://localhost:3000/health
./scripts/smoke_test.sh    # 38 assertions
```

---

## Architecture

```
Client (React/Tauri)           Discreet Server (Rust/Axum)         PostgreSQL + Redis
┌──────────────────┐           ┌─────────────────────────┐        ┌──────────────┐
│ Encrypt with      │──HTTPS──>│ Store ciphertext blob    │───────>│ BYTEA columns│
│ MLS/Signal keys   │          │ (CANNOT decrypt)         │        │ 50+ tables   │
│                   │<──WSS────│ Relay ciphertext         │<───────│              │
│ Decrypt locally   │          │ (CANNOT read)            │        │ Redis: cache │
└──────────────────┘           └─────────────────────────┘        └──────────────┘
```

The server is a relay, not an oracle. All cryptographic operations happen client-side.

| Layer | Protocol | Standard | Status |
|-------|----------|----------|--------|
| Group channels | MLS | RFC 9420 | Lifecycle test passed, WASM bindings ready |
| Direct messages | Signal Protocol | X3DH + Double Ratchet | Schema + handlers complete |
| Voice/video | SFrame | RFC 9605 | Planned |
| Post-quantum | ML-KEM + ML-DSA | FIPS 203/204 | Type definitions ready |

---

## Project Structure

```
Discreet/
├── GUIDE/                      Setup, deployment, contributing guides
├── ROADMAP.md                  Project roadmap
├── CONTRIBUTING.md             Contributor guide
├── Cargo.toml                  Dependencies + feature flags
├── Dockerfile                  Multi-stage production build
├── docker-compose.yml          Postgres + Redis
├── src/                        Rust backend (~14,500 lines)
│   ├── main.rs                 Entry point, router, middleware
│   ├── citadel_auth*.rs        Auth (JWT + Argon2id + sessions)
│   ├── citadel_server*.rs      Server CRUD + invites
│   ├── citadel_channel*.rs     Channels + categories
│   ├── citadel_message*.rs     Zero-knowledge messages
│   ├── citadel_dm*.rs          Encrypted DMs
│   ├── citadel_friend*.rs      Friends + blocking
│   ├── citadel_role*.rs        RBAC + permissions
│   ├── citadel_websocket.rs    Real-time events
│   └── ...                     30 modules total
├── migrations/                 26 SQL migration files (50+ tables)
├── client/                     Production web client
│   └── index.html              Monolith client
├── client-next/                Vite TypeScript client
│   └── src/                    46 files, 18,500+ lines TS/TSX
├── discreet-crypto/            MLS crypto crate (RFC 9420)
│   └── src/                    Identity, KeyPackage, Group, WASM
├── scripts/                    Build + test scripts
├── tests/                      Test suites
├── docs/                       Architecture, API reference
└── assets/                     Logo SVGs
```

---

## API Overview (184 Endpoints)

All under `/api/v1/`. Auth required unless marked *.

| Group | # | Description |
|-------|---|-------------|
| Auth | 9 | Register*, login*, logout, refresh*, sessions, revoke, 2FA |
| Servers | 12 | CRUD, join/leave, invites, members, vanity |
| Channels | 5 | CRUD within servers |
| Categories | 5 | Category CRUD + move channels |
| Messages | 4 | Send/get/edit/delete (ciphertext) |
| DMs | 4 | Create, list, send, get |
| Users | 4 | Profile CRUD, server list |
| Friends | 10 | Request/accept/decline/remove/block/search |
| Roles | 7 | CRUD, assign/unassign |
| Bans | 3 | Ban/unban/list |
| Reactions | 3 | Add/remove/list |
| Pins | 3 | Pin/unpin/list |
| Typing | 1 | Indicator + WS broadcast |
| Settings | 4 | User prefs + server notifications |
| Files | 2 | Upload/download blobs |
| Audit | 1 | Paginated log |
| Agents | 3 | Search/spawn/list |
| Health | 2 | Check + info |
| WebSocket | 1 | Real-time events |

Full reference: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)

---

## Contributing

We welcome contributions! See the [Contributing Guide](GUIDE/CONTRIBUTING.md) for guidelines, code style, and how to submit PRs.

**Priority areas:**
- OpenMLS integration
- Voice/video (WebRTC + SFrame)
- Desktop and mobile clients (Tauri + React Native)
- Security auditing
- Test coverage expansion

---

## Self-Hosting

Your instance, your rules, your data. See the [Deployment Guide](GUIDE/DEPLOYMENT.md) for step-by-step instructions including Docker Compose, Oracle Cloud free tier, and Raspberry Pi setups.

---

## Roadmap

| Platform | Technology | Status |
|----------|-----------|--------|
| **Web Client** | React + Vite TypeScript | Shipped |
| **Desktop** | Tauri 2.0 (Windows/macOS/Linux) | Planned |
| **iOS** | React Native | Planned |
| **Android** | React Native | Planned |

See [`ROADMAP.md`](ROADMAP.md) for the full roadmap.

---

## License

**AGPL-3.0-or-later** — Self-host it. Fork it. Improve it. The encryption is the product, and the encryption is free.

See [LICENSE](LICENSE) for details.
