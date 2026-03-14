<!-- LOGO: Replace with <img src="assets/logo.png" width="200"> when ready -->

<h1 align="center">DISCREET</h1>

<p align="center">
  <strong>End-to-end encrypted communication for communities, organizations, and operations.</strong>
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="AGPL-3.0" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-1.93-orange.svg?logo=rust" alt="Rust 1.93" /></a>
  <a href="https://www.rfc-editor.org/rfc/rfc9420"><img src="https://img.shields.io/badge/MLS-RFC_9420-green.svg" alt="MLS RFC 9420" /></a>
  <img src="https://img.shields.io/badge/Tests-68_passing-brightgreen.svg" alt="Tests 68 passing" />
  <img src="https://img.shields.io/badge/Patent-Pending-yellow.svg" alt="Patent Pending" />
</p>

<p align="center">
  <a href="https://discreetai.net">discreetai.net</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="GUIDE/QUICKSTART.md">Quick Start</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="docs/API_REFERENCE.md">API Reference</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

---

<!-- SCREENSHOT: Replace with <img src="assets/screenshot.png" width="800"> after deploy -->

<p align="center"><em>Live demo at <a href="https://discreetai.net">discreetai.net</a></em></p>

---

## Why Discreet?

Signal gives you encryption but no communities — no servers, no channels, no roles, no bots. Discord gives you communities but no encryption — every message sits in plaintext on servers you don't control. Element gives you both, if you're willing to become a Matrix sysadmin. Telegram's "Secret Chats" are 1:1 only; group chats are server-encrypted with keys Telegram holds. Every existing platform forces you to choose between privacy and functionality. That trade-off is the problem Discreet exists to eliminate.

Discreet is the first platform that combines full community features — servers, channels, categories, roles, permissions, voice, video, threads, bots, moderation — with MLS end-to-end encryption (RFC 9420) across every layer. AI agents participate as real MLS group members holding their own leaf secrets and rotating keys with the group (patent pending). An offline BLE proximity mesh enables field communication when infrastructure is unavailable. The entire stack is open source: 14,500 lines of Rust backend, 18,500 lines of TypeScript client, a shared Rust-to-WASM crypto library, 184 API endpoints, and 68 tests — over 100,000 lines of auditable code built from scratch. It self-hosts on a Raspberry Pi.

Discreet is built for three audiences. **Communities** that want the Discord experience without surrendering every message to a third party. **Organizations** that need encrypted collaboration with audit trails, compliance-ready architecture, and zero-knowledge guarantees that hold up under legal scrutiny. And **operations** — defense, intelligence, journalism, activism — that need tactical edge communications where the server is untrusted by design, devices operate offline, and forward secrecy is non-negotiable.

## Features

- **E2EE Messaging** — Every message encrypted with MLS (RFC 9420) using AES-256-GCM before it leaves your device; the server stores and relays ciphertext it cannot read.
- **Community Servers** — Channels, threads, categories, roles with granular permissions, reactions, custom emoji, polls, and events — the full community toolkit, fully encrypted.
- **AI Agents** — LLM-powered bots that hold MLS leaf secrets and participate in group key exchange as real cryptographic group members with AES-256-GCM encrypted episodic memory (patent pending).
- **Encrypted Voice & Video** — WebRTC calls with per-frame SFrame encryption (RFC 9605), noise suppression, push-to-talk, and screen sharing — the server relays opaque media frames.
- **Proximity Mesh** — Offline BLE communication with X25519 ECDH key agreement and short authentication string (SAS) verification for air-gapped environments.
- **Self-Hostable** — One setup command, runs on ARM and x86, deploys to a Raspberry Pi, Oracle Cloud free tier, or any Docker host with 1 GB of RAM.
- **Tamper-Evident Audit** — SHA-256 hash-chained audit log where each entry references the previous hash, making retroactive modification detectable.
- **Two-Factor Auth** — TOTP second factor with secrets encrypted at rest via AES-256-GCM, passwords hashed with Argon2id, and one-time recovery keys.
- **Invite System** — Domain-aware invite links with configurable expiry, offline QR code exchange for air-gapped onboarding, and external link blocking per server.
- **Open Source** — AGPL-3.0 licensed, 100,000+ lines of auditable Rust and TypeScript, zero telemetry, zero tracking, no phone number required.

## How It Compares

| Feature | Discreet | Signal | Element | Discord | Slack |
|---------|:--------:|:------:|:-------:|:-------:|:-----:|
| E2EE by default | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| No phone required | :white_check_mark: | :x: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| Community servers | :white_check_mark: | :x: | :white_check_mark: | :white_check_mark: | :x: |
| Self-hostable | :white_check_mark: | :x: | :white_check_mark: | :x: | :x: |
| AI agents (E2EE) | :white_check_mark: | :x: | :x: | :x: | :x: |
| Proximity mesh | :white_check_mark: | :x: | :x: | :x: | :x: |
| Encrypted voice | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| Open source | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| Tamper-evident audit | :white_check_mark: | :x: | :x: | :x: | :x: |
| No government ID | :white_check_mark: | :x: | :white_check_mark: | :white_check_mark: | :white_check_mark: |

## Quick Start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
./scripts/setup.sh
```

Windows: `scripts\setup.ps1`

Open **http://localhost:3000/next/** — register, create a server, start messaging.

Full self-hosting guide: **[docs/SELF_HOSTING_GUIDE.md](docs/SELF_HOSTING_GUIDE.md)**

## Architecture

```
                    ┌─────────────┐
                    │ Cloudflare  │
                    │ DDoS · CDN  │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │    Caddy    │
                    │  Auto TLS   │
                    └──────┬──────┘
                           │
┌──────────────┐    ┌──────┴──────┐    ┌──────────────┐
│ React 18     │◄──►│ Rust / Axum │◄──►│ PostgreSQL   │
│ Tauri v2     │    │ 184 routes  │    │ 50+ tables   │
│ React Native │    │ WebSocket   │    ├──────────────┤
│              │    │ Agent sub.  │    │ Redis        │
│ discreet-    │    └─────────────┘    │ Sessions ·   │
│ crypto WASM  │                       │ Rate limits  │
└──────────────┘                       └──────────────┘
  Encrypt/decrypt                        Ciphertext only
  happens here                           server is blind
```

| Layer | Protocol | Standard |
|-------|----------|----------|
| Group messaging | MLS (TreeKEM) | [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420) |
| Direct messages | Double Ratchet | Signal Protocol (X3DH) |
| Voice & video | SFrame | [RFC 9605](https://www.rfc-editor.org/rfc/rfc9605) |
| Post-quantum | ML-KEM + ML-DSA | [FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) / [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final) |

Full diagrams (Mermaid): **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

## Security

Discreet's threat model assumes a **fully compromised server**. An attacker with root access to the database sees only ciphertext — no plaintext, no keys, no content.

- **MLS (RFC 9420)** — Group keys rotate via TreeKEM with O(log n) cost; forward secrecy and post-compromise security by default
- **AES-256-GCM** — TOTP secrets, agent API keys, and episodic memory facts encrypted at rest with unique nonces per row
- **Argon2id** — Memory-hard, GPU-resistant password hashing with random salts
- **Hash-chain audit log** — Each entry includes the SHA-256 hash of the previous entry; retroactive tampering is detectable
- **CSRF protection** — Origin validation, security headers, and per-session tokens on all state-changing endpoints
- **Compile-time SQL** — All queries validated at build time via sqlx; no string concatenation, no injection surface
- **OWASP 2026 Top 10** — Injection, auth, access control, cryptographic failures, SSRF, and security misconfiguration addressed

**Patent pending** (March 2026): AI agents as MLS group members with zero-knowledge server architecture.

**Found a vulnerability?** Email **security@discreetai.net** — we acknowledge within 48 hours and coordinate disclosure. Full policy: **[SECURITY.md](SECURITY.md)**

## Self-Hosting

Discreet runs on any machine with Docker — a Raspberry Pi, an Oracle Cloud free-tier VM, or a dedicated server. One command to deploy, five environment variables to configure.

Full guide: **[docs/SELF_HOSTING_GUIDE.md](docs/SELF_HOSTING_GUIDE.md)**

## Contributing

We need help in these areas:

- **Cryptography** — MLS protocol review, post-quantum module wiring, SFrame optimization, formal verification
- **React Native** — Feature parity with the web client, push notifications, biometric auth
- **Tauri Desktop** — System tray, auto-update, native notifications, OS keychain integration
- **Proximity Mesh** — BLE transport hardening, multi-hop relay, range testing across devices
- **Documentation** — Threat model review, deployment guides, API examples, translations

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup instructions, coding standards, and how to submit a PR.

## License

**[AGPL-3.0-or-later](LICENSE)**

Certain features are covered by a US Patent Application filed March 2026 by Citadel Open Source LLC.

Self-host it. Fork it. Audit it. The encryption is the product, and the encryption is free.

## Links

<p align="center">
  <a href="https://discreetai.net">discreetai.net</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://twitter.com/DiscreetAI">@DiscreetAI</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://github.com/CitadelOpenSource/Discreet">GitHub</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="mailto:support@discreetai.net">support@discreetai.net</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="mailto:security@discreetai.net">security@discreetai.net</a>
</p>

<!-- TODO: star history chart after 100 stars -->
