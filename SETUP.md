# Discreet — Complete Setup Guide

> **⚠️ For the latest setup, login, deployment, and launch instructions, see [`LAUNCH_NOW.md`](LAUNCH_NOW.md).**
> This file is kept for migration history reference. LAUNCH_NOW.md is the current source of truth.

**Last updated: March 3, 2026 — Session 24 (30+ modules, 101 endpoints, 35 tables)**

This is the single source of truth for getting Discreet running. It covers
prerequisites, database setup, building the server, and accessing the web client.
If anything in the build process changes, this file gets updated in the same commit.

See also: **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** for common errors and fixes.

---

## Quick Reference (Returning Developers)

Already set up? Here's the daily workflow:

```powershell
cd <your-clone-path>
docker compose up -d                          # Start Postgres + Redis
cargo run                                     # Start Discreet server
# Open http://localhost:3000 in your browser
# Phone access: http://<your-local-ip>:3000
```

If you pulled new code that changed `migrations/`:

```powershell
# ⚠️  CRITICAL: Migrations MUST be applied BEFORE cargo build.
# sqlx checks SQL queries against the live database at compile time.
# If the DB schema is out of date, cargo build WILL fail.

# Option A: Apply only the new migration(s) — NON-DESTRUCTIVE
Get-Content migrations\006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\008_bots_and_member_label.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\009_reply_and_mentions.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\010_group_dms.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\011_file_attachments.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\012_custom_emoji.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\013_forum_channels.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\014_events.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\015_email_tokens.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\016_server_discovery.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\017_soundboard.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\018_account_tiers.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\019_bot_channels.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\020_meetings.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\021_polls.sql | docker compose exec -T postgres psql -U citadel -d citadel

# Option B: Wipe and rebuild from scratch (loses all data)
docker compose down -v
docker compose up -d
# Wait 5 seconds, then apply ALL migrations:
Get-Content migrations\001_schema.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\002_reactions.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\003_friends.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\004_codex_schema_sync.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\005_totp.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\008_bots_and_member_label.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\009_reply_and_mentions.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\010_group_dms.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\011_file_attachments.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\012_custom_emoji.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\013_forum_channels.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\014_events.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\015_email_tokens.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\016_server_discovery.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\017_soundboard.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\018_account_tiers.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\019_bot_channels.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\020_meetings.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\021_polls.sql | docker compose exec -T postgres psql -U citadel -d citadel
cargo build --release
```

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Rust** | 1.93+ (stable) | Server language |
| **Docker Desktop** | Latest | Runs PostgreSQL 16 + Redis 7 |
| **Git** (or GitHub Desktop) | Latest | Source control |
| **VS Build Tools 2022/2026** | With "Desktop development with C++" workload | Rust compilation on Windows |

### Install Rust (if not installed)

**Windows (PowerShell):**
```powershell
winget install Rustlang.Rustup
# Close and reopen PowerShell, then verify:
rustc --version    # Should be 1.7x+
cargo --version
```

**Linux/macOS:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### Install Docker Desktop

Download from https://www.docker.com/products/docker-desktop/ and install.
Make sure the Docker whale icon is green in your system tray before proceeding.

---

## Step 1: Clone the Repository

```powershell
# Via GitHub Desktop: Clone CitadelOpenSource/Discreet
# Or via command line:
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
```

Your local clone path (wherever you cloned the repo)

---

## Step 2: Configure Environment

Copy the example environment file:

```powershell
# Windows:
Copy-Item .env.example .env

# Linux/macOS:
cp .env.example .env
```

Edit `.env` and change `JWT_SECRET` to something random (at least 32 characters):

```env
DATABASE_URL=postgres://citadel:citadel@localhost:5432/citadel
REDIS_URL=redis://localhost:6379
JWT_SECRET=replace-with-a-random-string-at-least-32-characters-long
```

Optional settings (defaults are fine for development):

```env
# HOST=0.0.0.0           # Listen on all interfaces (needed for phone access)
# PORT=3000               # Server port
# RATE_LIMIT_PER_MINUTE=120
```

---

## Step 3: Start Database Services

```powershell
docker compose up -d
```

Expected output:
```
✔ Container discreet-postgres-1  Started
✔ Container discreet-redis-1     Started
```

Wait 5 seconds for PostgreSQL to initialize, then apply all migrations in order:

> **⚠️  CRITICAL:** sqlx does compile-time query checking. Migrations **MUST** be applied
> to the running database **BEFORE** running `cargo build`. If you skip this step,
> you'll get `error: error returned from database: column "xxx" does not exist`.
> See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for details.

```powershell
# Windows (PowerShell):
Get-Content migrations\001_schema.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\002_reactions.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\003_friends.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\004_codex_schema_sync.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\005_totp.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel
```

```bash
# Linux/macOS:
cat migrations/001_schema.sql | docker compose exec -T postgres psql -U citadel -d citadel
cat migrations/002_reactions.sql | docker compose exec -T postgres psql -U citadel -d citadel
cat migrations/003_friends.sql | docker compose exec -T postgres psql -U citadel -d citadel
cat migrations/004_codex_schema_sync.sql | docker compose exec -T postgres psql -U citadel -d citadel
cat migrations/005_totp.sql | docker compose exec -T postgres psql -U citadel -d citadel
cat migrations/006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
cat migrations/007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel
```

You should see `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE` lines. That's correct.
`NOTICE: column "xxx" already exists, skipping` is also fine (means migration was already applied).

**Migration inventory (must be applied in order):**

| File | Purpose |
|------|---------|
| `001_schema.sql` | Core schema: users, sessions, servers, channels, messages, DMs, roles, bans, categories, pins, settings, audit log, agents, files, reactions |
| `002_reactions.sql` | Reaction constraints and indexes |
| `003_friends.sql` | Social graph: friend requests, accept/decline/block |
| `004_codex_schema_sync.sql` | Codex Wave 1-3 schema sync (audit_log, categories, pins, settings) |
| `005_totp.sql` | TOTP 2FA columns (totp_secret, totp_enabled) |
| `006_channel_perms_ttl.sql` | Channel lock/hide/slowmode/NSFW/TTL, permission overrides table, file metadata |
| `007_search_privacy.sql` | User privacy toggle (show_shared_servers), search indexes |

---

## Step 4: Build and Run the Server

```powershell
cargo run
```

First build takes 3-5 minutes (compiles ~300 crates). Subsequent builds take ~15 seconds.

When successful, you'll see:

```
Discreet server listening on 0.0.0.0:3000
  API:        http://localhost:3000/api/v1/
  WebSocket:  ws://localhost:3000/ws?server_id=<uuid>
  Health:     http://localhost:3000/health
  Web Client: http://localhost:3000/
  Rate limit: 120/min per IP
  Zero-knowledge architecture active
```

---

## Step 5: Access the Web Client

Open your browser to **http://localhost:3000**

The self-contained web client (React 18 + Babel, served via `include_str!()`) loads automatically.

### First-time Setup

1. **Register** — Create an account (username + password)
2. **Create a server** — Click the + button in the server rail
3. **Create a channel** — Click "Add Channel" in the sidebar
4. **Send a message** — Type in the message box and press Enter
5. **Invite friends** — Click server name → Overview → Generate Invite Code

### Phone Access (Local Network)

Find your PC's local IP:
```powershell
# Windows:
ipconfig | Select-String "IPv4"
# Look for something like 192.168.x.x
```

On your phone, open: `http://192.168.x.x:3000`
(Replace with your actual IP. Both devices must be on the same WiFi network.)

---

## Architecture Overview

```
Browser (React 18 + WebCrypto)
  └─ AES-GCM encryption happens here
  └─ Private keys never leave the device
  └─ Client-side search (E2EE — queries never leave browser)

Discreet Server (Rust/Axum)
  └─ 101 API endpoints across 30+ modules
  └─ Stores only encrypted ciphertext
  └─ Cannot decrypt anything
  └─ WebSocket real-time events

Infrastructure
  └─ PostgreSQL 16 (~35 tables)
  └─ Redis 7 (session cache, rate limiting)
  └─ Docker Compose for services
```

---

## Current Feature Status

### Working in Web Client (v5, ~3,100 lines)

- Login / Register with encrypted sessions
- Create/join servers via invite codes
- Text channels with E2EE (AES-GCM via WebCrypto)
- Voice channels (WebRTC, VAD/PTT, audio device selection)
- Direct messages (encrypted)
- Friends system (search, request, accept, decline, remove, message)
- Channel categories (collapsible groups)
- Message actions (edit, delete, pin, react — hover to reveal)
- Emoji quick-react picker
- Typing indicators ("X is typing...")
- Server settings (overview, channels, roles, bans, audit log — 5 tabs)
- User settings (appearance, voice, profile, privacy, notifications, about — 6 tabs)
- Pinned messages panel
- File upload with inline image preview (expand/collapse)
- Message markdown (bold, italic, code, spoilers, links)
- Styled confirmation dialogs for all destructive actions
- Channel settings modal (lock, hide, slowmode, TTL, NSFW — 3 tabs)
- Channel visibility filtering (min role position)
- Sidebar lock/TTL icons, locked-channel input barrier
- **Search panel (Ctrl+F)**: messages (client-side E2EE), members, global users
- Advanced search syntax: `from:user in:#channel before:date after:date`
- Shared server badges on user search results
- Privacy toggle: show/hide shared servers

### Backend Complete, Not Yet in Client

- Vanity invite URLs (`POST /servers/:id/vanity`)
- Invite resolution (`GET /invites/:code`)
- File download
- Per-channel notification settings
- Channel permission override CRUD

---

## Codebase Summary

| Metric | Count |
|--------|-------|
| Rust modules | 30+ |
| API endpoints | 101 |
| Database tables | ~35 |
| Rust source lines | ~10,000 |
| Client lines | ~3,100 |
| Migration files | 7 |

---

## Troubleshooting

See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** for a comprehensive list of common
errors, their causes, and step-by-step fixes. Quick hits:

- **`column "xxx" does not exist`** → Migrations not applied. See TROUBLESHOOTING.md §1.
- **`sqlx` is not recognized** → You don't need sqlx-cli. Use `docker compose exec` instead.
- **`cargo build` fails after `git pull`** → Apply new migrations first, then build.
- **`connection refused`** → Docker containers not running. `docker compose up -d`.
- **Port 3000 in use** → `netstat -ano | findstr :3000` then kill the PID, or set `PORT=3001` in `.env`.

---

## Development Workflow

### Daily

```powershell
cd <your-clone-path>
git pull origin main
docker compose up -d
# If migrations changed: apply new ones BEFORE building (see Step 3)
cargo run
```

### After pulling code with new migrations

```powershell
# Check what's new:
git log --oneline --name-only -- migrations/

# Apply only the NEW migration(s) — preserves your data:
Get-Content migrations\006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel

# Then rebuild:
cargo build --release
cargo run --release
```

### Nuclear option (wipe everything and start fresh)

```powershell
docker compose down -v               # Removes volumes (wipes ALL data)
docker compose up -d                 # Fresh Postgres + Redis
# Wait 5 seconds, apply ALL 7 migrations in order (see Step 3)
cargo build --release
cargo run --release
```

### Running tests

```bash
# Start server first, then in another terminal:
cargo test
```

---

## MLS Crypto Layer (Optional — Real E2EE)

The base server works with PBKDF2-derived channel keys. To activate real MLS (RFC 9420) encryption:

```powershell
# 1. Test the crypto crate
cd discreet-crypto
cargo test
# Should print: "Full MLS lifecycle test passed!"

# 2. One-time: add WASM target and install wasm-pack
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# 3. Build WASM module
wasm-pack build --target web --features wasm --no-default-features
# Creates: discreet-crypto/pkg/

# 4. Apply MLS migration
cd ..
Get-Content migrations\012_mls_key_distribution.sql | docker compose exec -T postgres psql -U citadel -d citadel

# 5. Rebuild server
cargo build
```

See `BUILD_MLS.md` for detailed instructions and `TROUBLESHOOTING.md` section 15 for issues.

**Note:** `wasm32-unknown-unknown` is the standard Rust target for WebAssembly compilation. The two "unknown" values are normal — they mean "no vendor, no OS" because WASM runs in a browser sandbox.

---

## Docker Deployment (Production)

For Oracle Cloud or any Linux server:

```bash
# Build the Docker image
cargo sqlx prepare    # Generate offline query metadata first
docker build -t discreet-server .

# Run with docker-compose
docker compose -f docker-compose.yml up -d
```

See `docs/DEPLOY_ORACLE.md` for Oracle Cloud free tier specifics.

---

*This file is updated whenever the build process, dependencies, migrations, or
infrastructure change. If SETUP.md doesn't match reality, it's a bug — fix it.*

---

## Vite Client (COMPLETE — 8,819 lines, 33 files)

The Vite client at `client-next/` is a full encrypted communication + community platform.
33 TypeScript files, 8,819 lines. Includes: E2EE messaging, voice/video, events, gamification,
polls, AI bots, profanity filter, calculator, and 12-tab settings.

```powershell
# Build the Vite client
cd client-next
npm install
npm run build

# Rebuild the server (to serve /next/ route)
cd ..
cargo build
cargo run

# Access:
# Production client: http://localhost:3000/
# Vite client:       http://localhost:3000/next/
```

Or use the build script:
```powershell
.\scripts\build-client.ps1
```

### Development Mode (Hot Reload)
```powershell
cd client-next
npm run dev
# Opens at http://localhost:5173/next/
# API calls proxied to http://localhost:3000
```

---

## Complete Build Order (All Components)

When building everything from scratch:

```powershell
cd C:\dev\Discreet2

# 1. Start Docker containers
docker compose up -d

# 2. Apply ALL migrations
Get-Content migrations\001_schema.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\002_reactions.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\003_friends.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\004_codex_schema_sync.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\005_totp.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\008_bots_and_member_label.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\009_reply_and_mentions.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\010_group_dms.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\011_file_attachments.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\012_mls_key_distribution.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\012_custom_emoji.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\013_forum_channels.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\014_events.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\015_email_tokens.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\016_server_discovery.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\017_soundboard.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\018_account_tiers.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\019_bot_channels.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\020_meetings.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\021_polls.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\023_totp.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\024_bot_config_expand.sql | docker compose exec -T postgres psql -U citadel -d citadel

# 3. Build WASM crypto module (optional — PBKDF2 fallback works without it)
cd discreet-crypto
cargo test                                                          # Verify MLS lifecycle passes
wasm-pack build --target web --features wasm --no-default-features  # Build WASM for browser
cd ..

# 4. Build Vite client (optional — production monolith works without it)
cd client-next
npm install
npm run build
cd ..

# 5. Build and run server
cargo build
cargo run

# Access:
# Production client:  http://localhost:3000/
# Vite client (new):  http://localhost:3000/next/
# API:                http://localhost:3000/api/v1/
# WebSocket:          ws://localhost:3000/ws?server_id=<uuid>
# Health check:       http://localhost:3000/health
```

---

## WASM Build Troubleshooting

**Error: `uuid` needs randomness feature**
```
error: to use `uuid` on `wasm32-unknown-unknown`, specify a source of randomness
```
Fix: `uuid` dependency in `discreet-crypto/Cargo.toml` needs `"js"` feature. Already fixed in v0.14.1+.

**Error: `into_welcome()` not found / type mismatches in wasm_bindings.rs**
The WASM bindings must match the core API. If `group.rs` functions take `&[u8]`, the bindings must pass bytes, not `MlsMessageIn`. Already fixed in v0.14.1+.

**Error: Borrow checker in wasm_bindings.rs (E0502)**
Use `state.signer.clone().ok_or_else()` instead of `state.signer.as_ref()?.clone()` — the latter keeps an immutable borrow alive across the `?` operator, blocking `get_mut()`.

---

## Desktop App (Tauri v2)

### One-time setup
```powershell
cargo install tauri-cli
```

### Development (needs server running)
```powershell
cd desktop
cargo tauri dev
```

### Production build
```powershell
cd client-next && npm run build && cd ..
cd desktop && cargo tauri build
```
Output in `desktop/src-tauri/target/release/bundle/`

## Mobile App (React Native)

### One-time setup
```bash
cd mobile
npm install
```
Also need: Android Studio (for Android SDK), Xcode (for iOS, Mac only)

### Development
```bash
npx react-native run-android   # Android
npx react-native run-ios        # iOS (Mac only)
```

### Server URL
Edit `mobile/src/api/CitadelAPI.ts`:
```typescript
export const SERVER_URL = 'https://your-domain.com';
```

---

## Mobile App — Proximity Features

### Additional Dependencies (BLE + Wi-Fi Direct)
```bash
cd mobile
npm install react-native-ble-plx react-native-wifi-p2p @react-native-community/netinfo
```

### Android Permissions Required
Add to `mobile/android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" />
```

### iOS Permissions Required
Add to `mobile/ios/Discreet/Info.plist`:
```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Discreet uses Bluetooth to discover and message nearby users without internet.</string>
<key>NSLocalNetworkUsageDescription</key>
<string>Discreet uses local networking for proximity voice calls.</string>
```

### Testing Proximity Features
- BLE: Requires 2+ physical devices (emulator doesn't support BLE)
- Wi-Fi Direct: Requires 2+ physical Android devices
- iOS: Uses MultipeerConnectivity (Apple's BLE/Wi-Fi hybrid)
- Range test: BLE ~100m line of sight, Wi-Fi Direct ~200m
