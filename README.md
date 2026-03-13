<p align="center">
  <img src="docs/assets/logo.png" alt="Discreet" width="80" />
</p>

<h1 align="center">Discreet</h1>

<p align="center">
  <strong>The server can't read your messages. Not "won't." Can't.</strong>
</p>

<p align="center">
  <a href="https://discreetai.net">discreetai.net</a>&nbsp;&nbsp;·&nbsp;&nbsp;Patent Pending&nbsp;&nbsp;·&nbsp;&nbsp;<a href="GUIDE/QUICKSTART.md">Quick Start</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="docs/API_REFERENCE.md">API Reference</a>
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="AGPL-3.0" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-1.93+-orange.svg?logo=rust" alt="Rust" /></a>
  <a href="https://www.rfc-editor.org/rfc/rfc9420"><img src="https://img.shields.io/badge/MLS-RFC_9420-green.svg" alt="MLS" /></a>
  <a href="https://www.rfc-editor.org/rfc/rfc9605"><img src="https://img.shields.io/badge/SFrame-RFC_9605-green.svg" alt="SFrame" /></a>
  <a href="https://csrc.nist.gov/pubs/fips/203/final"><img src="https://img.shields.io/badge/Post--Quantum-FIPS_203%2F204-purple.svg" alt="Post-Quantum" /></a>
</p>

---

## What is Discreet?

Discreet is an open-source, end-to-end encrypted communication platform with the community features of Discord and the cryptographic guarantees of Signal. Servers, channels, roles, DMs, voice, video, bots — all of it encrypted so the server operator stores and relays ciphertext but **cannot decrypt any content**, even under compulsion.

Built from scratch in Rust. 14,500 lines of backend, 18,500 lines of TypeScript client. 184 API endpoints. Self-hostable on hardware as small as a Raspberry Pi.

The cryptographic design uses standards ratified by the IETF and NIST — not proprietary protocols:

| Layer | Protocol | Standard | Published |
|-------|----------|----------|-----------|
| Group messaging | Message Layer Security | [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420) | July 2023 |
| Direct messages | Signal Protocol | X3DH + Double Ratchet | — |
| Voice & video | SFrame | [RFC 9605](https://www.rfc-editor.org/rfc/rfc9605) | August 2024 |
| Post-quantum key exchange | ML-KEM | [FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) | August 2024 |
| Post-quantum signatures | ML-DSA | [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final) | August 2024 |

MLS replaces the O(n) pairwise sessions of Signal's group protocol with a binary ratchet tree (TreeKEM), reducing key update cost to O(log n). This makes E2EE practical for groups of hundreds or thousands of members. SFrame encrypts individual media frames before they reach the selective forwarding unit, keeping voice and video content opaque to the server while preserving routing capability.

ML-KEM and ML-DSA (finalized by NIST in August 2024 after an eight-year standardization process) defend against harvest-now-decrypt-later attacks by quantum adversaries. Discreet implements these as type-safe Rust modules ready for integration alongside classical key exchange.

## Features

| Category | What's included |
|----------|----------------|
| **Messaging** | E2EE text channels, DMs, group DMs, threads, reply chains, markdown, message editing and deletion |
| **Voice & Video** | WebRTC peer-to-peer calls with SFrame encryption, screen sharing, per-user mute controls |
| **Community** | Servers, categories, channels (text, voice, forum, announcement), roles with granular permissions, invites |
| **AI Agents** | LLM-powered bots that hold MLS leaf secrets and participate in group key exchange (patent pending). Multi-provider: Anthropic, OpenAI, Ollama. Encrypted memory with AES-256-GCM |
| **Moderation** | Bans, kicks, slowmode, channel locking, audit log, automod, platform-level admin dashboard |
| **Social** | Friends, presence, custom status, user profiles, reactions, custom emoji, polls, events calendar |
| **Files** | Encrypted file uploads with per-tier storage quotas, image previews, GIF picker |
| **Security** | Argon2id password hashing, TOTP 2FA, one-time recovery keys, CSRF protection, per-connection WebSocket rate limiting, Redis-backed session revocation, banned-user live disconnect |
| **Clients** | Web (React 18 + Vite), Desktop (Tauri v2), Mobile (React Native) |
| **Deployment** | Docker Compose, Raspberry Pi, Oracle Cloud free tier. Single binary, 5 env vars to start |

## How it compares

|  | E2EE Messages | E2EE Voice | Community UX | Open Source (full stack) | Self-Host | AI Agents |
|--|:---:|:---:|:---:|:---:|:---:|:---:|
| **Discreet** | **Yes (MLS)** | **Yes (SFrame)** | **Yes** | **Yes** | **Yes** | **Yes** |
| Discord | No | No | Yes | No | No | No |
| Signal | Yes | Yes | No | Yes | No&sup1; | No |
| Element / Matrix | Partial&sup2; | Yes | Partial | Yes | Yes | No |
| Telegram | No&sup3; | 1:1 only | Partial | No&sup4; | No | No |
| Slack | No | No | Yes | No | No | No |
| WhatsApp | Yes | Yes | No | No | No | No |

<sub>&sup1; Signal Server is open source but requires Signal's infrastructure for phone registration and push delivery — not practically self-hostable.</sub><br/>
<sub>&sup2; Element enables E2EE by default for private rooms; public rooms are not encrypted. Uses Megolm/Olm, not MLS.</sub><br/>
<sub>&sup3; Telegram's "Secret Chats" are E2EE (MTProto 2.0) but only for 1:1. Standard and group chats are server-encrypted — Telegram holds the keys.</sub><br/>
<sub>&sup4; Telegram's client is partially open source; the server is closed source.</sub>

## Architecture

```
Client (browser / native)            Discreet Server (Rust + Axum)           Storage
┌────────────────────────┐           ┌──────────────────────────┐          ┌──────────────┐
│ MLS / Signal / SFrame  │──HTTPS──> │ Store ciphertext blob    │────────> │ PostgreSQL   │
│ Key material on device │           │ Cannot decrypt anything  │          │ 50+ tables   │
│                        │<──WSS──── │ Relay via WebSocket      │ <─────── │              │
│ All crypto client-side │           │ Cannot read content      │          │ Redis: JWT   │
└────────────────────────┘           └──────────────────────────┘          │ sessions     │
                                                                           └──────────────┘
```

The server is a relay, not an oracle. It stores base64-encoded ciphertext and routes WebSocket events. Decryption keys never leave client devices.

## Quick Start

Full guide: **[GUIDE/QUICKSTART.md](GUIDE/QUICKSTART.md)**

### Linux / macOS

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git && cd Discreet
docker compose up -d
for f in migrations/*.sql; do cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel; done
cp .env.example .env
export JWT_SECRET="$(openssl rand -hex 64)"
cd client-next && npm install && npm run build && cd ..
cargo run
```

### Windows (PowerShell)

```powershell
git clone https://github.com/CitadelOpenSource/Discreet.git; cd Discreet
docker compose up -d
Get-ChildItem migrations\*.sql | Sort-Object Name | ForEach-Object {
  Get-Content $_.FullName | docker compose exec -T postgres psql -U citadel -d citadel
}
copy .env.example .env
$env:JWT_SECRET = (openssl rand -hex 64)
cd client-next; npm install; npm run build; cd ..
cargo run
```

Open **http://localhost:3000/next/** — register, create a server, start messaging.

```bash
curl http://localhost:3000/health    # verify the server is running
```

### Other platforms

| Platform | Guide |
|----------|-------|
| Docker Compose (production) | [GUIDE/DEPLOYMENT.md](GUIDE/DEPLOYMENT.md) |
| Raspberry Pi | [docs/DEPLOY_RASPBERRY_PI.md](docs/DEPLOY_RASPBERRY_PI.md) |
| Desktop (Tauri) | `cd desktop && cargo tauri dev` |
| Mobile (React Native) | `cd mobile && npm run android` |

## Security

Discreet's threat model assumes a **fully compromised server**. Even an attacker with root access to the database sees only ciphertext and key material that cannot reconstruct plaintext.

| Measure | Implementation |
|---------|---------------|
| Password storage | Argon2id (memory-hard, side-channel resistant) |
| Session management | Redis-backed JWT with per-session revocation, 30-second ban polling on WebSocket |
| 2FA | TOTP with AES-256-GCM encrypted secrets at rest |
| Account recovery | One-time 24-character recovery key, SHA-256 hashed, invalidated on use |
| API keys (agents) | AES-256-GCM encrypted per-row with unique nonces |
| Rate limiting | Per-IP REST limits, per-connection WebSocket limits (120 msg/min, 1 MiB/min) |
| Transport | TLS 1.3, CORS origin validation, CSRF tokens, security headers |
| Key rotation | MLS epoch-based forward secrecy via TreeKEM self-update |

If you find a vulnerability, please email **security@discreetai.net** before disclosing publicly.

## Contributing

See **[GUIDE/CONTRIBUTING.md](GUIDE/CONTRIBUTING.md)** for the full contributor guide.

Areas where contributions have the most impact:

- **Cryptography** — MLS integration testing, post-quantum module wiring, SFrame optimization
- **Voice/Video** — WebRTC reliability, ogg/mp4 recording, noise suppression
- **Mobile** — React Native feature parity with the web client
- **Desktop** — Tauri v2 system tray, notifications, auto-update
- **Security auditing** — penetration testing, protocol review, threat modeling

```bash
cargo test --lib         # backend tests
cd client-next && npm run build   # frontend type check
```

## Support the project

Discreet is built and maintained independently with a $0 infrastructure budget. If you find it useful:

**GitHub Sponsors**
[github.com/sponsors/CitadelOpenSource](https://github.com/sponsors/CitadelOpenSource)

**Cryptocurrency**
| Currency | Address |
|----------|---------|
| Bitcoin | `bc1qDiscreetBTC` |
| Ethereum | `0xDiscreetETH` |
| Monero | `4DiscreetXMR` |

<sub>Placeholder addresses — real addresses will be published at [discreetai.net/donate](https://discreetai.net/donate).</sub>

Every dollar goes directly to server costs, security audits, and development tooling.

## License

**[AGPL-3.0-or-later](LICENSE)**

Self-host it. Fork it. Audit it. The encryption is the product, and the encryption is free.

If you modify Discreet and offer it as a network service, the AGPL requires you to publish your changes under the same license. This ensures every deployment remains auditable.

---

<p align="center">
  <a href="https://discreetai.net">discreetai.net</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://github.com/CitadelOpenSource/Discreet/issues">Issues</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="docs/API_REFERENCE.md">API Docs</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="GUIDE/QUICKSTART.md">Quick Start</a>
</p>
