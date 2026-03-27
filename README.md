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
  <a href="docs/SECURITY_KERNEL.md">Security</a>
  &nbsp;&bull;&nbsp;
  <a href="CONTRIBUTING.md">Contribute</a>
  <br /><br />
  <img src="https://img.shields.io/badge/Made%20in-USA-blue?style=flat-square" alt="Made in USA" />
  &nbsp;
  <img src="https://img.shields.io/badge/Patent-Pending-orange?style=flat-square" alt="Patent Pending" />
  &nbsp;
  <img src="https://img.shields.io/badge/Security-WASM%20Kernel-green?style=flat-square" alt="WASM Security Kernel" />
  &nbsp;
  <img src="https://img.shields.io/badge/License-AGPL--3.0-purple?style=flat-square" alt="AGPL-3.0" />
  <br /><br />
</div>

Discreet is an open-source messenger that gives you servers, channels, roles, voice, video, and AI agents — all end-to-end encrypted. You can sign up with an email, a 12-word seed phrase, or not at all. The server never sees your messages, and the code is public so you can verify that yourself.

## What You Get

| Feature | Discreet | Signal | Discord | Element |
|---|:---:|:---:|:---:|:---:|
| E2EE messages | ✅ | ✅ | ❌ | ✅ |
| E2EE voice and video | ✅ | ✅ | ❌ | ❌ |
| Servers and channels | ✅ | ❌ | ✅ | ✅ |
| Anonymous signup (no phone/email) | ✅ | ❌ | ❌ | ❌ |
| Self-hostable | ✅ | ❌ | ❌ | ✅ |
| AI agents in E2EE channels | ✅ | ❌ | ❌ | ❌ |
| Post-quantum key exchange | ✅ | ❌ | ❌ | ❌ |
| Open source | ✅ | ✅ | ❌ | ✅ |
| Custom themes | ✅ | ❌ | ❌ | ❌ |
| EXIF stripping on uploads | ✅ | ✅ | ❌ | ❌ |
| Disappearing messages | ✅ | ✅ | ❌ | ❌ |
| FIDO2 passkeys | ✅ | ❌ | ❌ | ❌ |
| 16+ languages | ✅ | ✅ | ✅ | Planned |
| File sharing | ✅ | ✅ | ✅ | ✅ |
| WASM Security Kernel | ✅ | ❌ | ❌ | ❌ |
| Mobile apps | Planned | ✅ | ✅ | ✅ |

## How It Works

Messages are encrypted on your device using MLS (RFC 9420) with AES-256-GCM before they leave. Voice and video use SFrame (RFC 9605) to encrypt every audio and video frame peer-to-peer. Passwords are hashed with Argon2id. Keys are derived with HKDF-SHA256. Post-quantum key exchange (ML-KEM-768) is available behind a feature flag. The server stores ciphertext and cannot decrypt anything.

You can sign up three ways: email and password, OAuth (Google, GitHub, Discord, Apple), or anonymously with a BIP-39 12-word seed phrase that acts as your only credential. No phone number is ever required. No address book is uploaded. No tracking pixels, no analytics, no telemetry.

The whole thing is AGPL-3.0 and runs on any Linux box with 2 cores and 4GB of RAM. PostgreSQL, Redis, one Rust binary, one Vite frontend. You can have it running in three commands.

## Quick Start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet && cp .env.example .env && docker compose up -d
```

Open `http://localhost:5173` and create your first server.

For production deployment with TLS, Caddy, and systemd: **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**

## Features

[150+ features documented with status. See the complete list.](FEATURES.md)

The highlights:

- Encrypted voice and video calls (WebRTC + SFrame, peer-to-peer)
- Servers with channels, roles, permissions, threads, polls, and events
- Anonymous accounts with BIP-39 seed phrases — no email, no phone
- AI agents inside encrypted channels with platform kill switch
- 7 themes including Phosphor (CRT scanlines) and Arcade (pixel art)
- 16 languages including Hebrew, Kurdish, Burmese, and Pashto
- Disappearing messages with server-enforced retention policies
- FIDO2 passkeys and TOTP two-factor authentication
- Automatic EXIF metadata stripping on all image uploads
- Post-quantum cryptography (ML-KEM-768, ML-DSA-65) behind `--features pq`
- WebAssembly Security Kernel — all cryptography, input validation, content sanitization, and permission evaluation runs inside an isolated Rust/WASM module. The JavaScript UI layer never touches cryptographic keys or unsanitized data.

## What's Next

Mobile apps (React Native), desktop apps (Tauri), BLE proximity mesh for offline messaging, subscription billing with Bitcoin, and an independent security audit. See the full plan: **[ROADMAP.md](ROADMAP.md)**

## Security

All cryptography uses audited libraries — OpenMLS, aes-gcm, hkdf, argon2. No hand-rolled crypto. `cargo audit` and `npm audit` both report zero known vulnerabilities. Responsible disclosure: **security@discreetai.net**. Full threat model and wire format spec: **[SECURITY.md](SECURITY.md)**

## Stack

**Rust** · Axum · PostgreSQL · Redis · React · TypeScript · MLS · SFrame

## Contributing

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow. Building a bot? **[docs/BOT_SDK.md](docs/BOT_SDK.md)** has the REST API and a working Python example.

## License

AGPL-3.0-or-later. The code stays open, forever.

---

AGPL-3.0-or-later · https://discreetai.net
