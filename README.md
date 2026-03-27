<div align="center">
  <br />
  <img src="docs/assets/discreet-shield.svg" alt="Discreet" width="80" />
  <h1>Discreet</h1>
  <p><strong>Communication Without Compromise</strong></p>
  <p>End-to-end encrypted messaging with Discord-quality UX and Signal-grade cryptography.</p>
  <br />
  <a href="https://discreetai.net">Website</a>
  &nbsp;&bull;&nbsp;
  <a href="FEATURES.md">Features</a>
  &nbsp;&bull;&nbsp;
  <a href="docs/SECURITY_KERNEL.md">Security Kernel</a>
  &nbsp;&bull;&nbsp;
  <a href="CONTRIBUTING.md">Contribute</a>
  <br /><br />
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="AGPL-3.0" />
  &nbsp;
  <img src="https://img.shields.io/badge/Rust-1.80+-orange" alt="Rust 1.80+" />
  &nbsp;
  <img src="https://img.shields.io/badge/Tests-266_passing-brightgreen" alt="266 tests passing" />
  &nbsp;
  <img src="https://img.shields.io/badge/Post--Quantum-ML--KEM--768-7C3AED" alt="Post-Quantum ML-KEM-768" />
  &nbsp;
  <img src="https://img.shields.io/badge/Made_in-USA-red" alt="Made in USA" />
  &nbsp;
  <img src="https://img.shields.io/badge/Patent-Pending-yellow" alt="Patent Pending" />
  <br /><br />
</div>

Discreet is an open-source messenger that gives you servers, channels, roles, voice, video, and AI agents — all end-to-end encrypted. You can sign up with an email, a 12-word seed phrase, or not at all. The server never sees your messages, and the code is public so you can verify that yourself.

## Why Discreet?

Discreet is for people who refuse to choose between community and privacy.

| | Signal | Discord | Wire | Discreet |
|---|:---:|:---:|:---:|:---:|
| End-to-end encryption | ✅ | ❌ | ✅ | ✅ |
| MLS RFC 9420 | ❌ | ❌ | ✅ | ✅ |
| Post-quantum crypto | ✅ (SPQR) | ❌ | ❌ | ✅ (ML-KEM-768) |
| Formally verified PQ | ✅ | ❌ | ❌ | ✅ (libcrux) |
| Community servers | ❌ | ✅ | ❌ | ✅ |
| Voice/video E2EE | ✅ | ❌ | ✅ | ✅ (SFrame) |
| No phone number required | ❌ | ✅ | ✅ | ✅ (BIP-39) |
| AI agents inside E2EE | ❌ | ❌ | ❌ | ✅ (patent pending) |
| BLE proximity mesh | ❌ | ❌ | ❌ | ✅ (patent pending) |
| WASM security kernel | ❌ | ❌ | ❌ | ✅ |
| Open source | ✅ | ❌ | ✅ | ✅ (AGPL-3.0) |
| Self-hostable | ❌ | ❌ | ✅ | ✅ |

## How It Works

Messages are encrypted on your device using MLS (RFC 9420) with AES-256-GCM before they leave. Voice and video use SFrame (RFC 9605) to encrypt every audio and video frame peer-to-peer. Passwords are hashed with Argon2id. Keys are derived with HKDF-SHA256. Hybrid post-quantum key exchange (X25519 + ML-KEM-768) protects against harvest-now-decrypt-later quantum attacks. The server stores ciphertext and cannot decrypt anything.

You can sign up three ways: email and password, OAuth (Google, GitHub, Discord, Apple), or anonymously with a BIP-39 12-word seed phrase that acts as your only credential. No phone number is ever required. No address book is uploaded. No tracking pixels, no analytics, no telemetry.

## Technical Highlights

**Cryptography**
- MLS RFC 9420 for scalable group E2EE (TreeKEM, log(N) operations)
- Hybrid post-quantum: X25519 + ML-KEM-768 (FIPS 203)
- ML-KEM implementation: libcrux (Cryspen) — formally verified for panic freedom, correctness, and secret independence
- AES-256-GCM + HKDF-SHA256 for symmetric encryption
- SFrame RFC 9605 for voice/video E2EE
- Argon2id password hashing, FIDO2/WebAuthn passkeys

**Security Kernel** (discreet-kernel/)
- Rust compiled to WebAssembly, runs in isolated Web Worker
- Rate-limited oracle protection (novel, zero prior art)
- Non-extractable WebCrypto sealed storage
- 12 input validators with HTML sanitization
- Glassworm/Shai-Hulud PUA character detection
- 156 tests (119 unit + 37 integration)

**Stack**
- Backend: Rust / Axum 0.8 (50+ modules, 110 tests)
- Frontend: React / TypeScript / Vite (1,384 modules)
- Database: PostgreSQL 16 + Redis 7
- 108 database migrations
- 10 themes including structural skins
- 16 languages (including Kurdish, Burmese, Pashto)
- Zero external tracking, zero analytics, zero CDN font requests

## Quick Start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet && cp .env.example .env && docker compose up -d
```

Open `http://localhost:5173` and create your first server.

For production deployment with TLS, Caddy, and systemd: **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**

## Features

[150+ features documented with status.](FEATURES.md) The highlights:

- Encrypted voice and video calls (WebRTC + SFrame, peer-to-peer)
- Servers with channels, roles, permissions, threads, polls, and events
- Anonymous accounts with BIP-39 seed phrases — no email, no phone
- AI agents inside encrypted channels with platform kill switch
- 10 themes including structural skins (Phosphor, Pixel, Cipher, Neon)
- 16 languages including Hebrew, Kurdish, Burmese, and Pashto
- Disappearing messages with server-enforced retention policies
- FIDO2 passkeys and TOTP two-factor authentication
- Automatic EXIF metadata stripping on all image uploads
- WebAssembly Security Kernel — all cryptography, input validation, content sanitization, and permission evaluation runs inside an isolated Rust/WASM module

## What's Next

Mobile apps (React Native), desktop apps (Tauri), BLE proximity mesh for offline messaging, subscription billing with Bitcoin, and an independent security audit. See the full plan: **[ROADMAP.md](ROADMAP.md)**

## Security

All cryptography uses audited, formally verified libraries — libcrux-ml-kem, OpenMLS, aes-gcm, hkdf, argon2. No hand-rolled crypto. `cargo audit` and `npm audit` both report zero known vulnerabilities. Responsible disclosure: **security@discreetai.net**. Full threat model: **[SECURITY.md](SECURITY.md)**

## Contributing

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow. Building a bot? **[docs/BOT_SDK.md](docs/BOT_SDK.md)** has the REST API and a working Python example.

## License

AGPL-3.0-or-later. The code stays open, forever.

---

AGPL-3.0-or-later · https://discreetai.net
