<h1 align="center">Discreet</h1>

<p align="center">
  <strong>End-to-end encrypted communication for communities.</strong>
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="AGPL-3.0" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-1.85+-orange.svg?logo=rust" alt="Rust" /></a>
  <a href="https://www.rfc-editor.org/rfc/rfc9420"><img src="https://img.shields.io/badge/MLS-RFC_9420-green.svg" alt="MLS RFC 9420" /></a>
  <img src="https://img.shields.io/badge/Tests-85+-brightgreen.svg" alt="Tests" />
  <img src="https://img.shields.io/badge/Patent-Pending-yellow.svg" alt="Patent Pending" />
</p>

<p align="center">
  <a href="https://discreetai.net">Website</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="docs/SELF_HOSTING.md">Self-Host</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="CONTRIBUTING.md">Contribute</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="SECURITY.md">Security</a>
</p>

---

## What is Discreet?

Discreet is an open-source, end-to-end encrypted messaging platform that
combines community features with verifiable cryptography. The server stores
only ciphertext — it cannot read your messages, even under legal compulsion.

## Features

| | |
|---|---|
| **Encrypted messaging** | HKDF-SHA256 + AES-256-GCM with key commitment tags |
| **MLS group encryption** | RFC 9420 via OpenMLS 0.8.1 with forward secrecy |
| **E2EE voice and video** | Peer-to-peer WebRTC with SFrame (RFC 9605) |
| **AI agents** | 5 providers, local-first with OpenJarvis, agents hold their own keys |
| **Servers and channels** | Roles, permissions, categories, threads, polls, events |
| **Direct messages** | X3DH + Double Ratchet, zero-knowledge architecture |
| **Live streaming** | Standard RTMP ingest, re-encrypted with MLS group keys |
| **Desktop and mobile** | Tauri desktop shell, React Native mobile app |
| **Self-hostable** | Single binary + Docker Compose, runs on a $5 VPS |

## Quick Start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
docker compose up -d          # PostgreSQL + Redis
cp .env.example .env          # Configure secrets
cargo run                     # Start server at localhost:3000
```

See [GUIDE/QUICKSTART.md](GUIDE/QUICKSTART.md) for detailed setup instructions.

## Architecture

```
 Client (React/Vite)          Server (Rust/Axum)           Storage
┌─────────────────────┐    ┌──────────────────────┐    ┌──────────────┐
│                     │    │                      │    │              │
│  HKDF-SHA256        │───▷│  Axum + Tower        │───▷│  PostgreSQL  │
│  AES-256-GCM        │    │  middleware stack     │    │  (ciphertext │
│  key commitment     │    │                      │    │   only)      │
│                     │    │  JWT auth             │    │              │
│  MLS (RFC 9420)     │    │  Rate limiting        │    ├──────────────┤
│  via WASM module    │    │  Input validation     │    │              │
│                     │    │  Security headers     │───▷│  Redis       │
│  SFrame (RFC 9605)  │    │  Audit logging        │    │  (rate limit │
│  voice encryption   │    │                      │    │   + cache)   │
│                     │    │  WebSocket relay      │    │              │
└─────────────────────┘    └──────────────────────┘    └──────────────┘
         │                          │
         │    WebRTC (P2P)          │
         └──────────────────────────┘
              Voice/Video
         (never touches server)
```

**Stack:** Rust 1.85+ / Axum 0.7, PostgreSQL 16, Redis 7, React 18 / Vite 5,
OpenMLS 0.8.1, sqlx 0.8 (compile-time validated queries).

## Security

All cryptographic operations happen on the client. The server is a
relay for ciphertext it cannot decrypt.

| Layer | Algorithm | Standard |
|-------|-----------|----------|
| Key derivation | HKDF-SHA256 | RFC 5869 |
| Symmetric encryption | AES-256-GCM with 32-byte key commitment | NIST SP 800-38D |
| Group key exchange | MLS | RFC 9420 |
| Voice/video frames | SFrame | RFC 9605 |
| Password hashing | Argon2id | OWASP recommendation |
| Transport | TLS 1.3 with HSTS preload | RFC 8446 |

Key commitment prevents multi-key attacks on AES-GCM. Every ciphertext
is prefixed with a 32-byte HKDF-derived commitment tag verified before
decryption.

Rate limiting is fail-closed: if Redis is unavailable, requests are
rejected (503), not allowed through. All 692 SQL queries are compile-time
validated — SQL injection is structurally impossible.

Full details: [SECURITY.md](SECURITY.md) | [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)

## AI Agents

AI agents participate as real members in encrypted channels. Each agent
holds its own cryptographic keys and decrypts only messages addressed to it.

| Provider | Type | Data leaves your network? |
|----------|------|--------------------------|
| OpenJarvis (Ollama) | Local | No |
| Anthropic | Cloud | Yes (HTTPS, metadata stripped) |
| OpenAI | Cloud | Yes (HTTPS, metadata stripped) |
| Google Gemini | Cloud | Yes (HTTPS, metadata stripped) |
| Custom endpoint | Configurable | Depends on endpoint |

Every channel with an active agent displays a visible disclosure banner.
Agent responses are encrypted with the channel's group key before storage.
Agent episodic memory is AES-256-GCM encrypted per-channel.

For fully offline AI: deploy OpenJarvis (Ollama) alongside Discreet.
Zero data leaves your infrastructure.

## Self-Hosting

Discreet runs on any Linux server with Docker:

```bash
./scripts/setup.sh
```

Minimum: 2 CPU, 4 GB RAM, domain with DNS. The setup script generates
secrets, starts infrastructure, applies migrations, and builds the client.

Full guide: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)

## Contributing

We welcome contributions. No CLA required — your code is licensed under
the same AGPL-3.0-or-later terms as the project.

```bash
cargo test --lib              # 85+ tests must pass
cargo clippy -- -D warnings   # Zero warnings
cd client && npm run build    # Frontend must compile
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch workflow, code standards,
and security reporting instructions.

## License

**AGPL-3.0-or-later** — You can read, audit, and verify every line of code
that handles your data. If you modify and deploy Discreet, you must share
your changes under the same license.

Patent Pending. Copyright (C) 2026 Citadel Open Source LLC.
