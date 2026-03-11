# CITADEL v0.3.0-alpha — Modules Overview

This document is a developer-facing map of what exists **in this repository today** (not aspirational).

For the roadmap + changelog, see `../CITADEL_STATUS.md`.

---

## 1) Core Server API (Axum + SQLx)

**Goal:** Provide community-grade primitives (servers/channels/messages) while treating message content as opaque ciphertext.

### Files

- `src/main.rs` — bootstrap: config → state → migrations → routes
- `src/citadel_config.rs` — env config (dotenvy + envy)
- `src/citadel_state.rs` — shared state: Postgres + Redis + WS fan-out
- `src/citadel_error.rs` — AppError → HTTP mapping

### Implemented route groups

- `src/citadel_auth_handlers.rs` — register/login/logout/refresh/sessions/revoke
- `src/citadel_server_handlers.rs` — servers CRUD + membership + invites
- `src/citadel_channel_handlers.rs` — channels CRUD
- `src/citadel_message_handlers.rs` — encrypted message send/get/edit/delete

**Important:** The server stores only `content_ciphertext` bytes. Clients are responsible for encryption.

---

## 2) WebSocket Real-Time Events (Alpha)

**Goal:** Push small event envelopes to clients (e.g., “message created”), without inspecting ciphertext.

### Files

- `src/citadel_websocket.rs` — GET `/ws?server_id=<uuid>` (JWT auth header)

### What it does

- Validates the connecting user is a member of the requested `server_id`
- Subscribes the socket to an in-process broadcast bus for that server
- Forwards JSON event envelopes emitted by handlers via `AppState::ws_broadcast(server_id, payload)`

### What’s next

- Multi-server subscriptions on one socket
- Redis pubsub fan-out (for multiple Citadel instances)
- Presence + typing indicators (metadata-only)

---

## 3) AI Agent Framework (Alpha pipeline)

**Goal:** Auto-create specialized “AI agent channels” from a user search query.

### Files

- `src/citadel_agent_types.rs` — agent identity + specialization + spawn engine
- `src/citadel_agent_handlers.rs` — search/spawn + spawn status + list agents

### Current limitations

- Crypto key generation and MLS KeyPackages are **stubs** (tracked in `CITADEL_STATUS.md`)
- No agent runtime exists in this repo yet (no model execution, no RAG store)

---

## 4) Post-Quantum and Federation (Types only)

These modules define types and placeholders for later phases:

- `src/citadel_post_quantum.rs`
- `src/citadel_federation.rs`

Endpoints are not wired yet.

---

## 5) Client Prototypes (Not wired)

- `client/citadel-client.jsx` — React UI prototype
- `client/citadel-landing-page.html` — landing page prototype

---

## 6) Database

- `migrations/001_schema.sql` — single source of truth for tables + indexes

---

## 7) Contributing “First Tasks”

If you want to help immediately:

1. WebSocket: add multi-server subscribe protocol + Redis pubsub
2. MLS: integrate OpenMLS for real client E2EE
3. Add tests: auth/session revocation, server membership constraints
4. Improve Docker: CI build, `cargo clippy`, `cargo test`
