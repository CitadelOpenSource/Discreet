<h1 align="center">Discreet</h1>

<p align="center">
  <strong>Communication Without Compromise</strong>
</p>

<p align="center">
  <a href="https://github.com/CitadelOpenSource/Discreet/actions"><img src="https://img.shields.io/github/actions/workflow/status/CitadelOpenSource/Discreet/ci.yml?branch=main&label=CI&logo=github" alt="CI" /></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/Release-Alpha-orange.svg" alt="Alpha" />
</p>

<p align="center">
  <a href="https://discreetai.net">Website</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="docs/SELF_HOSTING.md">Self-Host</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="CONTRIBUTING.md">Contribute</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="SECURITY.md">Security</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="docs/BAA_TEMPLATE.md">BAA Template</a>
</p>

---

Discreet is an open-source, end-to-end encrypted messenger that combines Discord-quality community features with Signal-grade cryptography. Every message is encrypted on the sender's device before it leaves — the server stores and relays ciphertext it cannot decrypt. No phone number required. No tracking. No analytics. Fully self-hostable on a single server with Docker Compose.

## Features

| Feature | Details |
|---------|---------|
| E2EE messaging | MLS (RFC 9420) group encryption via OpenMLS, HKDF-SHA256 + AES-256-GCM with key commitment tags |
| Encrypted voice and video | Peer-to-peer WebRTC with SFrame (RFC 9605) media encryption |
| AI agents | Multi-provider support (Anthropic, OpenAI, Google Gemini, Ollama, custom endpoints) with per-agent encryption keys |
| Authentication | Passkeys (FIDO2 WebAuthn), OAuth 2.0 (Google, GitHub, Discord, Apple), TOTP 2FA, SAML SSO |
| Post-quantum cryptography | ML-KEM and ML-DSA behind feature flags for forward-secure key exchange |
| Themes and layouts | 4 built-in themes (Midnight, Dawn, Terminal, Obsidian) with 3 layout density modes and a custom theme editor |
| Disappearing messages | Per-channel TTL with automatic server-side cleanup and enterprise data retention policies |
| Sticker packs and translation | Custom sticker uploads with multi-language message translation via AI agents |
| Servers and channels | Roles, permissions, categories, threads, polls, events, bookmarks, and pinned messages |
| Admin dashboard | Platform-wide analytics, audit logs with hash-chain integrity, CSV/PDF export, remote session wipe |
| Direct messages | X3DH + Double Ratchet with zero-knowledge architecture |
| Self-hostable | Single binary + Docker Compose, runs on a $5 VPS with automatic TLS via Caddy |

## How Discreet Compares

| Feature | Signal | Discord | Element | Wire | Discreet |
|---------|--------|---------|---------|------|----------|
| E2EE by default | Yes | No | Yes | Yes | Yes |
| Servers and channels | No | Yes | Yes (Spaces) | No | Yes |
| AI agents | No | Bots (unencrypted) | No | No | Yes (E2EE) |
| OAuth login | No | Yes | No | No | Yes |
| Passkeys (FIDO2) | No | No | No | No | Yes |
| No phone number required | No | Yes | Yes | No | Yes |
| Self-hostable | No | No | Yes | No | Yes |
| Post-quantum ready | No | No | No | No | Yes |
| Open source | Yes | No | Yes | Partial | Yes |

## Quick Start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
cp .env.example .env
docker compose up -d
```

Open [localhost:5173](http://localhost:5173) in your browser. The default Docker Compose starts PostgreSQL, Redis, the Rust backend, and the Vite dev server.

## Developer Setup

For hot-reloading and development tooling:

```bash
docker compose -f docker-compose.dev.yml up
```

Run the test suite before submitting changes:

```bash
cargo test --lib              # Unit tests
cargo clippy -- -D warnings   # Zero warnings policy
cd client && npm run build    # Frontend must compile clean
```

## Architecture

```
 Client (React 18 / Vite 5)       Server (Rust / Axum 0.7)        Storage
┌──────────────────────────┐    ┌──────────────────────────┐    ┌──────────────┐
│  MLS (RFC 9420) via WASM │───▷│  Axum + Tower middleware │───▷│  PostgreSQL   │
│  HKDF-SHA256 + AES-256-GCM│   │  JWT + Passkey auth      │    │  (ciphertext  │
│  key commitment tags     │    │  Redis rate limiting     │    │   only)       │
│  SFrame (RFC 9605)       │    │  Input validation        │    ├──────────────┤
│  voice/video encryption  │    │  Security headers        │───▷│  Redis        │
│                          │    │  Audit logging           │    │  (rate limits │
│  Tauri desktop           │    │  WebSocket relay         │    │   + sessions) │
│  React Native mobile     │    │  AI agent orchestration  │    │              │
└──────────────────────────┘    └──────────────────────────┘    └──────────────┘
         │                               │
         │       WebRTC (peer-to-peer)   │
         └───────────────────────────────┘
              Voice/Video — never touches server
```

## Documentation

| Document | Description |
|----------|-------------|
| [SECURITY.md](SECURITY.md) | Cryptographic specification, wire format, OWASP compliance, dependency audit |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branch workflow, code standards, commit conventions |
| [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) | Production deployment guide with Caddy, systemd, and backup procedures |
| [docs/BAA_TEMPLATE.md](docs/BAA_TEMPLATE.md) | Business Associate Agreement template for healthcare deployments |

## License

**AGPL-3.0-or-later** — You can read, audit, and verify every line of code that handles your data. If you modify and deploy Discreet, you must share your changes under the same license.

Patent Pending. Copyright (C) 2026 Citadel Open Source LLC.
