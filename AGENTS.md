# AGENTS.md — Codex Briefing for Discreet

## Project Overview

Discreet is an open-source, end-to-end encrypted Discord alternative built in Rust.
It combines Discord's user experience with Signal-level encryption.

- **Backend**: Rust + Axum 0.7 web framework
- **Database**: PostgreSQL (via sqlx with compile-time checked queries)
- **Cache**: Redis
- **Client**: Self-contained HTML/React served from the Rust server
- **License**: AGPL-3.0

## Architecture

- All source files are in `src/` with flat naming: `citadel_*.rs`
- The internal code prefix is `citadel_` (historical); public branding is "Discreet"
- `main.rs` has a single flat Router with all routes (no merge())
- Axum 0.7 uses `:param` syntax for path parameters (NOT `{param}`)
- All API routes are under `/api/v1/`
- WebSocket at `/ws?server_id=<uuid>`
- Web client served from `/` via `include_str!("../client/index.html")`

## Key Files

- `CITADEL_STATUS.md` — Ground truth for project state (read this for full context)
- `migrations/001_schema.sql` — Database schema (27+ tables)
- `src/main.rs` — Entry point, all route definitions
- `src/lib.rs` — Module declarations
- `client/index.html` — Self-contained web client

## Build & Test

```bash
# Prerequisites: Docker (for Postgres + Redis)
docker compose up -d

# Build
cargo build

# Run
cargo run
# Server starts on 0.0.0.0:3000

# Test
./scripts/smoke_test.sh
```

## Environment Variables

```
DATABASE_URL=postgres://citadel:citadel@localhost:5432/citadel
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=dev-secret-change-in-production
```

## Coding Standards

- Use `AppError` for all error returns (from `citadel_error.rs`)
- Use `AuthUser` extractor for authenticated endpoints (from `citadel_auth.rs`)
- All message content is stored as encrypted ciphertext (BYTEA in Postgres)
- Base64 encoding/decoding uses STANDARD (not URL_SAFE) for browser compatibility
- Handler functions follow pattern: `pub async fn handler_name(auth: AuthUser, State(state): State<Arc<AppState>>, ...) -> Result<impl IntoResponse, AppError>`
- SQL queries use `sqlx::query!` macro (compile-time checked)
- New modules must be declared in `lib.rs` and routes added to `main.rs`

## DO NOT

- Do not use Axum `{param}` syntax — we are on Axum 0.7 which uses `:param`
- Do not use `Router::merge()` — all routes are flat in main.rs
- Do not modify the encryption/crypto logic without explicit instruction
- Do not add new heavy dependencies without justification
- Do not use `unwrap()` in handler code — always use `?` with AppError
- Do not reformat existing code — keep routes as compact one-liners (e.g. `.route("/path", get(handler).post(other))`) and do not expand them into verbose multi-line blocks
- Do not run `cargo fmt` or any auto-formatter on files you didn't create — only format your NEW files

## Proximity Mesh Communication (In Progress)

Discreet supports offline encrypted messaging via BLE mesh and Wi-Fi Direct voice.

### Mobile Services
- `ProximityService.ts` — BLE discovery + encrypted messaging (AES-256-GCM over GATT)
- `WifiDirectService.ts` — Wi-Fi Direct voice channels (WebRTC over local P2P network)
- `NearbyScreen.tsx` — Proximity UI with radar animation and user list

### How It Works
1. BLE advertises encrypted presence beacon (rotating pseudonymous ID)
2. Nearby devices discover each other via BLE scan
3. Text messages: encrypted and sent over BLE GATT characteristic
4. Voice: Wi-Fi Direct group forms, WebRTC voice over local network
5. Messages queue in AsyncStorage, sync to server when internet returns

### Key Constants
- BLE Service UUID: `d15c-0001-0001-0001-d15cree70001`
- Max BLE message size: 512 bytes (fragment larger messages)
- Max Wi-Fi Direct voice participants: 8
- BLE discovery range: ~100m per hop
- Wi-Fi Direct range: ~200m
