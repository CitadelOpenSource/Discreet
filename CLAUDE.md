# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Discreet** is a privacy-focused, Discord-like communication platform built in Rust (backend) and React/TypeScript (web client). The core guarantee: the server stores and relays ciphertext but **cannot decrypt it**. Fully self-hostable, runs on a Raspberry Pi.

- Backend: ~14,500 lines of Rust (Axum + tokio + PostgreSQL + Redis)
- Web client: ~18,500 lines of TypeScript (React 18 + Vite)
- Crypto library: `discreet-crypto` (Rust + WASM, OpenMLS + Signal + SFrame)

## Critical Rules — READ BEFORE EVERY CHANGE
- **NEVER touch `client/index.html`** (~18,000 lines, legacy). Use Python injection scripts for targeted changes only if absolutely necessary.
- **`client-next/` is the ONLY active development target.**
- **`include_str!()` trap** — changes to HTML files require `cargo build` to take effect.
- **Legacy client is source of truth for crypto params** — never change its encryption constants.
- **Commit after EVERY fix**, not in bulk. John uses GitHub Desktop and pulls.
- **Patent filed (March 2026)** — AI agents as MLS group members with zero-knowledge server. Never suggest architectures that dilute zero-knowledge claims.
- **Budget is $0** — every infra choice must be free tier or already owned.
- **Local path:** `C:\dev\Discreet2`

## Build & Run Commands

### Backend (Rust)
```bash
cargo build                  # Debug build
cargo build --release        # Production binary
cargo run                    # Start server (needs env vars below)
cargo test                   # Run tests
cargo test <test_name>       # Run a single test
```

### Web Client
```bash
cd client-next
npm install
npm run dev      # Dev server at http://localhost:5173
npm run build    # Production bundle
```

### Mobile (React Native)
```bash
cd mobile
npm run android
npm run ios
npm start
```

### Desktop (Tauri)
```bash
cd desktop
cargo tauri dev
cargo tauri build
```

### Crypto Library (WASM)
```bash
cd discreet-crypto
wasm-pack build --target web    # Build for browser
cargo build                      # Build for native use
```

### Local Development Setup
```bash
docker compose up -d   # Start PostgreSQL + Redis

# Apply all migrations
for f in migrations/*.sql; do cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel; done

cp .env.example .env
export JWT_SECRET="$(openssl rand -hex 64)"

cd client-next && npm install && npm run build && cd ..
cargo run
```

**Access:** Web → `http://localhost:3000/next/`, API → `http://localhost:3000/api/v1/`, Health → `http://localhost:3000/health`
That's correct for now but will change when we switch Vite to root. Leave it.

### Smoke Test
```bash
./scripts/smoke_test.sh
curl http://localhost:3000/health
```

## Required Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing key (generate with `openssl rand -hex 64`) |
| `CORS_ORIGINS` | Allowed origins (optional) |
| `TOTP_ENCRYPTION_KEY` | AES key for TOTP secrets (optional) |
| `AGENT_*` | AI agent provider config (optional) |
| `AGENT_KEY_SECRET` | Master secret for encrypting agent API keys at rest |

## Architecture

### Zero-Knowledge Design
The server **only stores base64-encoded ciphertext** — it cannot decrypt any message content. Decryption happens entirely on the client using locally-held keys.

```
Client (browser/native)                 Server (Rust/Axum)               PostgreSQL + Redis
┌─────────────────────┐                 ┌───────────────────────┐        ┌──────────────┐
│ Encrypt with MLS/   │ ──ciphertext──> │ Store blob (blind)     │ ────> │ ciphertext   │
│ Signal/SFrame keys  │                 │ Relay via WebSocket    │        │ + metadata   │
│ (discreet-crypto)   │ <─ciphertext──  │ (blind)               │ <───  │              │
│ Decrypt locally     │                 │                        │        │ Redis: JWT   │
└─────────────────────┘                 └───────────────────────┘        │ sessions     │
                                                                          └──────────────┘
```

### Encryption Layers
| Channel type | Protocol | Standard |
|---|---|---|
| Group channels | MLS (Message Layer Security) | RFC 9420 |
| Direct messages | Signal Protocol (X3DH + Double Ratchet) | — |
| Voice/video | SFrame | RFC 9605 |
| Post-quantum | ML-KEM + ML-DSA | FIPS 203/204 |

### Backend Module Structure (`src/`)

All Rust files are prefixed `citadel_`. Key modules:

**Core infrastructure:**
- `main.rs` — Server init, middleware stack (CORS → Rate Limit → Security Headers → Tracing → Compression), route registration
- `lib.rs` — Module declarations for all 50+ modules
- `citadel_state.rs` — `AppState`: DB pool, Redis, per-server WS broadcast buses, voice state, presence
- `citadel_config.rs` — Environment-based config loader
- `citadel_auth.rs` — JWT validation, `AuthUser` extractor, Redis-backed session revocation
- `citadel_error.rs` — Unified `AppError` type used across all handlers
- `citadel_permissions.rs` — Permission flag constants and checking logic

**Feature handlers** (follow naming pattern `citadel_<feature>_handlers.rs`):
- Messages, DMs, group DMs — zero-knowledge ciphertext storage
- Servers, channels, categories — guild-style organization
- Voice meetings (`citadel_meeting_handlers.rs`) — WebRTC signaling via WebSocket
- Agents (`citadel_agent_handlers.rs`, `_config.rs`, `_memory.rs`, `_provider.rs`) — LLM agents as MLS group members

**AI Agent subsystem** (newest, migration 028):
NOTE: Agent files exist in src/ but are not yet wired. Modules need registering in lib.rs, AGENT_KEY_SECRET config field needs adding, and prompt_bot still returns placeholder responses.
- `citadel_agent_config.rs` — Agent config + AES-256-GCM encrypted API key storage
- `citadel_agent_memory.rs` — Sliding window + summary memory modes for conversation context
- `citadel_agent_provider.rs` — Multi-provider abstraction: Anthropic, OpenAI, local Ollama, MCP servers


**WebSocket (`citadel_websocket.rs`):** Per-server broadcast channels for real-time events, typing indicators, voice signaling. Clients authenticate via JWT query param on `/ws?server_id=<uuid>`.

### Database Migrations (`migrations/`)

28 numbered SQL migration files (`001_schema.sql` through `028_agent_provider_columns.sql`). Run in order — they are not idempotent individually. Migration 026 adds MLS key material tables; 028 adds AI agent provider config and context summary tables.

### Cargo Feature Flags

```toml
[features]
default = []
mls = ["dep:openmls", "dep:openmls_rust_crypto"]
post-quantum = ["dep:ed25519-dalek", "dep:x25519-dalek", "dep:hkdf"]
```

Enable with `cargo build --features mls,post-quantum`.

### Crypto Library (`discreet-crypto/`)

Compiled to both native (server-side key validation) and WASM (browser-side encryption). Key modules:
- `identity.rs` — User/device identity and key material
- `group.rs` / `keypackage.rs` / `message.rs` — MLS group operations
- `sframe_voice.rs` — SFrame voice frame encryption
- `wasm_bindings.rs` — `#[wasm_bindgen]` exports for the web client

## Key Design Patterns

- **Type-safe Axum handlers** — All handlers use extractors (`AuthUser`, `Path<Uuid>`, `Json<T>`) with compile-time route validation.
- **AppError propagation** — Return `Result<impl IntoResponse, AppError>` everywhere; `AppError` maps to HTTP status codes.
- **Broadcast buses** — `tokio::sync::broadcast::Sender<WsEvent>` stored per server in `AppState` for fan-out to WebSocket clients.
- **AES-256-GCM for stored secrets** — API keys and TOTP secrets encrypted at rest with unique nonces per row.
- **Agents as MLS members** — AI agents hold actual MLS leaf secrets and participate in group key exchange (patent-aligned design).

## Documentation

- `GUIDE/QUICKSTART.md` — 5-minute local setup
- `GUIDE/DEPLOYMENT.md` — Production deployment
- `docs/CITADEL_ARCHITECTURE.md` — System design deep dive
- `docs/API_REFERENCE.md` — All 184 API endpoints
- `docs/CITADEL_STATUS.md` — Feature completion status
- `DEPLOY_RASPBERRY_PI.md` — Pi-specific deployment
