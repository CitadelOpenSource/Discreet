Discreet — End-to-end encrypted messaging with the community features you actually want.

---

***Discord's servers and channels without the data harvesting. Signal's encryption without the bare-bones UX. Slack's organization without the enterprise tax. Discreet is what happens when you refuse to choose between privacy and usability — you build both from scratch, in Rust, and open source it.***

***Built by one developer. No VC funding, no growth metrics, no "freemium" dark patterns. Sign up with an email and a password — no phone number, no ID verification, no address book upload. Pay with Bitcoin if you want premium. Post-quantum key exchange is already behind a feature flag. Sixteen languages including Pashto, Kurdish, Burmese, and Ukrainian because the people who need encrypted communication the most shouldn't have to read it in English. AI agents run inside E2EE channels with kill switches and rate limits.***

[![build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/CitadelOpenSource/Discreet/actions)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![version](https://img.shields.io/badge/version-v1.0.0--alpha-orange)](https://github.com/CitadelOpenSource/Discreet/releases)
[![languages](https://img.shields.io/badge/languages-16-blueviolet)](#)
[![rust](https://img.shields.io/badge/made%20with-Rust-dea584?logo=rust)](https://www.rust-lang.org/)

---

## What's inside

[See the complete feature list](docs/FEATURES.md) — 150+ features across backend, frontend, crypto, and infrastructure.

The short version:

- **Encrypted voice & video** — peer-to-peer WebRTC with SFrame (RFC 9605), audio never touches the server
- **Friends-only mode** — only decrypt messages from people you trust, everyone else sees a placeholder
- **Import your history** — bring conversations from Signal, WhatsApp, iMessage, and Android SMS
- **16 languages** — English, Arabic, Farsi, Hebrew, Kurdish, Pashto, Burmese, Ukrainian, Russian, and 7 more
- **AI agents with a kill switch** — multi-provider LLM support inside encrypted channels, platform admin can shut it all down instantly
- **Self-hostable** — three commands, runs on a $5 VPS, your data stays on your hardware

## Security model

- **Messages**: MLS (RFC 9420) group encryption via OpenMLS 0.8.1 — forward secrecy, AES-256-GCM with key commitment tags
- **Voice & video**: SFrame (RFC 9605) encrypts every audio and video frame before it leaves your device
- **Symmetric crypto**: AES-256-GCM everywhere, HKDF-SHA256 for key derivation, Argon2id for passwords
- **Post-quantum**: ML-KEM-768 (FIPS 203) and ML-DSA-65 (FIPS 204) available behind the `pq` feature flag

Full threat model, wire format spec, and OWASP compliance: **[SECURITY.md](SECURITY.md)**

## Run your own

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
cp .env.example .env   # then fill in your secrets
docker compose up -d
```

Open `localhost:5173`. That's PostgreSQL, Redis, the Rust backend, and the Vite frontend — all running.

Full production deployment guide (Caddy, systemd, TLS, backups): **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**

## Compare

| | Discreet | Discord | Signal | Element |
|---|:---:|:---:|:---:|:---:|
| E2EE messages | ✅ | ❌ | ✅ | ✅ |
| E2EE voice/video | ✅ | ❌ | ✅ | ❌ |
| Self-hostable | ✅ | ❌ | ❌ | ✅ |
| No phone required | ✅ | ✅ | ❌ | ✅ |
| AI integration | ✅ | ❌ | ❌ | ❌ |
| Open source | ✅ | ❌ | ✅ | ✅ |
| Post-quantum | ✅ | ❌ | ❌ | ❌ |

## Contribute

Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the branch workflow and code standards. Building a bot? **[docs/BOT_SDK.md](docs/BOT_SDK.md)** has the REST API, WebSocket events, and a working Python example.

## Business

Enterprise licensing, self-hosted support, and partnership inquiries: **[dev@discreetai.net](mailto:dev@discreetai.net)**

---

AGPL-3.0-or-later. Every line is open for audit. If you modify and deploy, you share your changes.

Patent pending. Copyright © 2024–2026 Discreet contributors.
