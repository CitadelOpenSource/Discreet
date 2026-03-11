# Discreet

**The server can't read your messages. Not "won't." Can't.**

**[discreetai.net](https://discreetai.net)** | **Patent Pending** | **AGPL-3.0**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Rust](https://img.shields.io/badge/Built_with-Rust_1.93-orange.svg)](https://www.rust-lang.org/)
[![MLS](https://img.shields.io/badge/Encryption-MLS_RFC_9420-green.svg)](https://www.rfc-editor.org/rfc/rfc9420)

Discreet is Discord, but encrypted. Servers, channels, roles, DMs, voice, bots, the whole thing. The difference is that the server only ever sees ciphertext. Keys live on your device. The server is a dumb relay that can't decrypt anything, even if compromised.

Built in Rust. ~14,500 lines of backend, ~18,500 lines of TypeScript client. 184 API routes. Self-hostable. Runs on a Raspberry Pi.

## How it compares

| | Community UX | E2EE | Open Source | Self-Host | AI Agents |
|-|:---:|:---:|:---:|:---:|:---:|
| Discord | Yes | No | No | No | No |
| Signal | No | Yes | Yes | No | No |
| Element | Partial | Partial | Yes | Yes | No |
| **Discreet** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |

## What's working (v0.24.0-alpha)

E2EE text channels and DMs, voice and video (WebRTC), screen sharing, file uploads, friends, reactions, typing indicators, markdown, forum channels, custom emoji, polls, events, bots with LLM integration, 2FA, role-based permissions, moderation tools, and more. The web client ships today. Desktop (Tauri) and mobile (React Native) are in progress.

Proximity mesh is coming: encrypted BLE text and Wi-Fi Direct voice that work without internet. Raspberry Pi relay nodes extend the range. Messages queue offline and sync when you reconnect.

Full feature breakdown in [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md).

## Quick Start

Full guide: [GUIDE/QUICKSTART.md](GUIDE/QUICKSTART.md)

**Linux / macOS**

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git && cd Discreet
docker compose up -d
for f in migrations/*.sql; do cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel; done
export DATABASE_URL="postgres://citadel:citadel@localhost:5432/citadel"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="$(openssl rand -hex 64)"
cargo run    # http://localhost:3000
```

**Windows**

```powershell
git clone https://github.com/CitadelOpenSource/Discreet.git; cd Discreet
docker compose up -d
Get-ChildItem migrations\*.sql | Sort-Object Name | ForEach-Object { Get-Content $_.FullName | docker compose exec -T postgres psql -U citadel -d citadel }
$env:DATABASE_URL="postgres://citadel:citadel@localhost:5432/citadel"
$env:REDIS_URL="redis://localhost:6379"
$env:JWT_SECRET=(openssl rand -hex 64)
cargo run    # http://localhost:3000
```

```bash
curl http://localhost:3000/health
```

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

The server is a relay, not an oracle. All crypto happens client-side.

| Layer | Protocol | Standard |
|-------|----------|----------|
| Group channels | MLS | RFC 9420 |
| Direct messages | Signal Protocol | X3DH + Double Ratchet |
| Voice/video | SFrame | RFC 9605 (planned) |
| Post-quantum | ML-KEM + ML-DSA | FIPS 203/204 (types ready) |

## API (184 endpoints)

Everything under `/api/v1/`. Full reference: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)

| Group | Routes | Group | Routes |
|-------|--------|-------|--------|
| Auth | 9 | Friends | 10 |
| Servers | 12 | Roles | 7 |
| Channels | 5 | Bans, Pins, Reactions | 9 |
| Messages | 4 | Settings, Files, Audit | 7 |
| DMs | 4 | Agents, Health, WS | 6 |

## Contributing

See [GUIDE/CONTRIBUTING.md](GUIDE/CONTRIBUTING.md) for the full guide.

We need help with OpenMLS integration, WebRTC voice/video, Tauri desktop, React Native mobile, and security auditing. If any of that sounds interesting, open a PR.

## Deploying

See [GUIDE/DEPLOYMENT.md](GUIDE/DEPLOYMENT.md). Covers Docker Compose, Oracle Cloud free tier (runs great on their free ARM instance), and Raspberry Pi.

## License

AGPL-3.0-or-later. Self-host it. Fork it. The encryption is the product, and the encryption is free.
