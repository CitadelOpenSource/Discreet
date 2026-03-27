# Developer Guide

> **New here?** See [GUIDE/QUICKSTART.md](../GUIDE/QUICKSTART.md) for setup, [GUIDE/CONTRIBUTING.md](../GUIDE/CONTRIBUTING.md) for contribution workflow, and [GUIDE/DEPLOYMENT.md](../GUIDE/DEPLOYMENT.md) for production deployment.

Welcome to Discreet — an end-to-end encrypted community platform. This guide covers architecture, code style, and development patterns.

## Architecture Overview

Discreet is a monorepo with four independent platform targets sharing one Rust API backend:

```
Discreet/
├── src/                  → Rust/Axum backend (44 modules, 184 routes)
├── client/          → Vite + React web client (29 components)
├── mobile/               → React Native (Android + iOS)
├── desktop/              → Tauri v2 (Windows/macOS/Linux)
├── discreet-crypto/      → MLS WASM crypto library
└── migrations/           → PostgreSQL schema (26 migrations)
```

Each platform builds independently. They communicate only through the REST API and WebSocket — no shared filesystem imports.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust 1.93+, Axum, sqlx (compile-time SQL) |
| Database | PostgreSQL 16, Redis 7 |
| Web client | Vite, React 18, TypeScript, Babel JSX |
| Desktop | Tauri v2 (wraps web client in native WebView) |
| Mobile | React Native, AsyncStorage, react-native-webrtc |
| Crypto | OpenMLS (RFC 9420), PBKDF2-AES-256-GCM fallback |
| Real-time | WebSocket (Axum ws), WebRTC (voice/video) |

## Development Setup

### Prerequisites
- Rust 1.93+ (`rustup update`)
- Docker Desktop (PostgreSQL + Redis)
- Node.js 18+ and npm
- VS Build Tools 2022+ (Windows)

### Quick Start
```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
docker compose up -d              # Postgres + Redis
cat migrations/*.sql | docker compose exec -T postgres psql -U discreet -d discreet
cd client && npm install && npm run build && cd ..
cargo build && cargo run           # Server at localhost:3000
```

Web UI: `http://localhost:3000/next/`

### Desktop
```bash
cargo install tauri-cli
cd desktop && cargo tauri dev      # needs server running
```

### Mobile
```bash
cd mobile && npm install
npx react-native run-android       # needs Android Studio
```

## Code Style

### Rust
- Module naming: `citadel_{domain}_{type}.rs` (e.g., `citadel_channel_handlers.rs`)
- All SQL queries use sqlx compile-time validation
- Error handling: `CitadelError` enum with `impl IntoResponse`
- Apply migrations BEFORE `cargo build` — sqlx validates at compile time

### TypeScript
- Single-file components (no separate CSS/JS files)
- State management: React hooks (useState, useEffect, useRef)
- API calls: `CitadelAPI.ts` class methods
- Theme: `theme.ts` constants (T.bg, T.sf, T.tx, T.ac, etc.)
- Icons: lucide-react (MIT, 1,400+ icons)

### Naming Conventions
- Rust: snake_case for everything
- TypeScript: camelCase for variables/functions, PascalCase for components
- SQL: snake_case, plural table names (users, channels, messages)
- CSS: inline styles via style objects (no CSS modules)

## Database

### Adding a Migration
```bash
# Create file: migrations/027_your_feature.sql
# Apply to running container:
Get-Content migrations\027_your_feature.sql | docker compose exec -T postgres psql -U discreet -d discreet
# Then rebuild Rust (sqlx needs the schema):
cargo build
```

### Current Schema
26 migrations, 50+ tables. Key tables: users, servers, channels, messages, members, roles, bots, bot_configs, events, polls, reactions, friend_requests, dm_conversations, dm_messages.

## Testing

```bash
cargo test                          # Rust unit tests
./smoke_test.sh                     # API smoke test (curl-based)
cd client && npm run build     # TypeScript compilation check
```

## Pull Request Process

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes, test locally
4. Update docs if adding features (README, API_REFERENCE, USER_MANUAL)
5. Open a PR with clear description of what changed and why
6. Ensure `cargo build` succeeds (sqlx compile-time checks catch schema issues)

## Common Gotchas

1. **sqlx "column does not exist"** — Apply migration to Docker Postgres BEFORE building Rust
2. **Client changes not showing** — Run `npm run build` in client/, then restart cargo
3. **WebSocket auth** — Token sent via query param (browsers can't set WS headers)
4. **Bracket imbalance** — Use the Node.js bracket-checker script after large client edits
5. **Desktop build** — Tauri needs `client/dist/` to exist for production builds

## Proximity Mesh Architecture

Discreet supports offline communication via BLE mesh and Wi-Fi Direct. This is a mobile-first feature.

### Transport Layers
| Transport | Protocol | Range | Speed | Use Case |
|-----------|----------|-------|-------|----------|
| Internet | WebSocket + REST | Global | ~100 Mbps | Normal operation |
| BLE Mesh | GATT over BLE 5.0 | ~100m/hop | ~1 Mbps | Offline text |
| Wi-Fi Direct | P2P over Wi-Fi | ~200m | ~250 Mbps | Offline voice |

### Key Files
- `mobile/src/services/ProximityService.ts` — BLE discovery + encrypted messaging
- `mobile/src/services/WifiDirectService.ts` — Wi-Fi Direct voice channels
- `mobile/src/screens/NearbyScreen.tsx` — Proximity UI

### How Proximity Discovery Works
1. Device advertises a BLE service (UUID: `d15c-0001-...`)
2. Beacon contains rotating pseudonymous ID (SHA-256 of userId + hourly timestamp)
3. Scanning devices detect beacons and extract pseudonymous IDs
4. Mutual authentication via challenge-response using shared server credentials
5. Encrypted GATT channel established for messaging
6. Messages encrypted with AES-256-GCM, keys derived via ECDH

### Offline Message Sync
Messages created while offline are stored in AsyncStorage under `proximity_outbox`. When internet connectivity returns (detected via NetInfo), the app automatically uploads queued messages to the server and downloads any missed messages, merging by timestamp.

### Testing
Proximity features require physical devices — BLE and Wi-Fi Direct don't work in emulators. Minimum test setup: 2 Android phones within BLE range (~10-100m depending on environment).
