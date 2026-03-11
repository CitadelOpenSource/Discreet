# 🏰 Citadel

**A zero-knowledge community platform. The server is designed to be incapable of reading message content.**

Citadel is building a Discord-like product with Signal-like guarantees:
- Servers, channels, invites, and real-time events
- End-to-end encryption performed on clients (MLS planned)
- Server stores and relays opaque ciphertext blobs
- AI agent channels that can auto-spawn specialist agents (alpha pipeline)

## Current scope of this repo

This repository currently contains:
- A Rust (Axum) HTTP API server
- PostgreSQL schema (single migration)
- Redis connection (reserved for pubsub/rate limiting)
- A React UI prototype (not wired to the API yet)

### What works today (v0.3.0-alpha)

- ✅ Auth: register/login/refresh/logout + session revocation
- ✅ Servers: create/list/get/update/delete + join/leave + invites
- ✅ Channels: create/list/get/update/delete
- ✅ Messages: send/get/edit/delete (server stores ciphertext bytes only)
- ✅ WebSocket (alpha): server-scoped event push via `/ws?server_id=<uuid>`
- ✅ AI agent channels (alpha): query → spawn pipeline → creates channel + agent records

### What is intentionally **not** implemented yet

- ❌ Client-side encryption (MLS/OpenMLS) — clients are not in this repo yet
- ❌ PQ + federation handlers (types exist; endpoints not wired)
- ❌ File blobs + voice/video
- ❌ Roles/permissions

## Quick start (local dev)

### 1) Start Postgres + Redis and apply schema

```bash
cp .env.example .env
# Set JWT_SECRET in .env (generate with: openssl rand -hex 64)

./scripts/dev_up.sh
```

### 2) Build + run the server

**Important:** `sqlx::query!` macros need `DATABASE_URL` at **compile time**, unless you generate offline metadata in `.sqlx/`.

For the simplest dev loop:

```bash
export DATABASE_URL=postgres://citadel:citadel@localhost:5432/citadel
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=change-me-to-a-64-hex-secret

cargo run
```

Server runs at `http://localhost:3000`.

Health check:

```bash
curl http://localhost:3000/health
```

## WebSocket (alpha)

Connect:
- `GET /ws?server_id=<uuid>`
- Must include `Authorization: Bearer <JWT>`

You’ll receive JSON event envelopes (e.g. `message_create`, `message_update`, `message_delete`, `agent_channel_created`).

## Project roadmap

The roadmap and changelog live in `CITADEL_STATUS.md`. Treat it as the single source of truth.

## License

AGPL-3.0-or-later. See `LICENSE`.
