# Discreet — Troubleshooting Guide

**Last updated: March 3, 2026**

Common errors, their root causes, and step-by-step fixes. Organized by
the error message you actually see.

---

## 1. `error: error returned from database: column "xxx" does not exist`

**This is the #1 most common build error.** It means a migration hasn't been applied.

### Why this happens

Discreet uses **sqlx** which validates every SQL query against the **live PostgreSQL
database at compile time**. If a migration adds a column (like `show_shared_servers`)
but you haven't run that migration against your local database yet, `cargo build`
fails — even though the Rust code is correct.

### Fix

Apply the missing migration(s). You do NOT need `sqlx-cli` installed — pipe the
SQL directly through Docker:

```powershell
# Windows (PowerShell):
Get-Content migrations\006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel
```

```bash
# Linux/macOS:
cat migrations/006_channel_perms_ttl.sql | docker compose exec -T postgres psql -U citadel -d citadel
cat migrations/007_search_privacy.sql | docker compose exec -T postgres psql -U citadel -d citadel
```

Then rebuild:

```powershell
cargo build --release
```

### How to tell which migration you're missing

The error message tells you the column name. Match it:

| Missing column | Migration file |
|----------------|----------------|
| `locked`, `min_role_position`, `slowmode_seconds`, `nsfw`, `message_ttl_seconds` | `006_channel_perms_ttl.sql` |
| `show_shared_servers` | `007_search_privacy.sql` |
| `totp_secret`, `totp_enabled` | `005_totp.sql` |

### If you're not sure what's been applied

```powershell
# List all tables (should be ~35):
echo "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" | docker compose exec -T postgres psql -U citadel -d citadel

# Check if a specific column exists:
echo "SELECT column_name FROM information_schema.columns WHERE table_name='channels' AND column_name='locked';" | docker compose exec -T postgres psql -U citadel -d citadel
```

If the column query returns 0 rows, that migration hasn't been applied.

---

## 2. `sqlx: The term 'sqlx' is not recognized`

### Why this happens

`sqlx-cli` is a separate tool from the `sqlx` Rust crate. The Rust crate compiles
into your project automatically via `Cargo.toml`. The CLI tool (`sqlx migrate run`)
is optional and must be installed separately.

### Fix

**Option A: Don't install it (recommended for development)**

You don't need `sqlx-cli`. Apply migrations manually through Docker instead:

```powershell
Get-Content migrations\001_schema.sql | docker compose exec -T postgres psql -U citadel -d citadel
# ... repeat for each migration file
```

**Option B: Install sqlx-cli (optional)**

```powershell
cargo install sqlx-cli --no-default-features --features postgres
```

This takes a few minutes. Once installed:

```powershell
$env:DATABASE_URL = "postgres://citadel:citadel@localhost:5432/citadel"
sqlx migrate run --source migrations
```

---

## 3. `error[E0063]: missing fields in initializer of 'ChannelInfo'`

### Why this happens

The Rust struct `ChannelInfo` has been updated with new fields (like `locked`,
`nsfw`, etc.) but the SQL queries that build it haven't been updated to SELECT
those columns, or the migration adding those columns hasn't been applied.

### Fix

1. `git pull origin main` to get the latest code with all query fixes
2. Apply migrations (see §1 above)
3. `cargo build --release`

---

## 4. `error[E0282]: type annotations needed`

### Why this happens

Rust can't infer the type of a variable, usually from an `sqlx::query_scalar!`
call. This was fixed in commit `df18ad5`.

### Fix

```powershell
git pull origin main
cargo build --release
```

---

## 5. `error[E0308]: mismatched types` (expected Value, found Vec)

### Why this happens

A handler function has inconsistent return types between different code branches.
This was fixed in commit `df18ad5`.

### Fix

```powershell
git pull origin main
cargo build --release
```

---

## 6. `connection refused` or `database "citadel" does not exist`

### Why this happens

Docker containers aren't running, or Postgres hasn't finished initializing.

### Fix

```powershell
# Check container status:
docker compose ps

# If not running:
docker compose up -d

# Wait 5 seconds, then verify:
docker compose exec postgres psql -U citadel -d citadel -c "SELECT 1"
# Should return: 1

# If "database does not exist":
docker compose down -v
docker compose up -d
# Wait 5 seconds, then apply all migrations (see SETUP.md Step 3)
```

---

## 7. `error: cargo build` takes forever / re-compiles everything

### Why this happens

A full release build compiles ~300 crates and takes 3-5 minutes. Subsequent
**incremental** builds should take ~15-30 seconds. If it's re-compiling everything:

- You switched between `cargo run` (debug) and `cargo run --release` — each profile
  has a separate build cache.
- The `target/` directory was deleted.
- Rust was updated (`rustup update`).

### Fix

Pick one profile and stick with it during development:

```powershell
# For development (faster compile, slower runtime):
cargo run

# For testing performance (slower compile, faster runtime):
cargo run --release
```

---

## 8. Port 3000 already in use

### Fix (Windows)

```powershell
netstat -ano | findstr :3000
# Note the PID in the last column
taskkill /PID <pid> /F
```

### Fix (Linux/macOS)

```bash
lsof -i :3000
kill -9 <pid>
```

### Alternative: change the port

Set `PORT=3001` in your `.env` file.

---

## 9. `cargo run` fails with OpenSSL error

### Why this happens

Some systems don't have OpenSSL development headers. Discreet uses `rustls`
(pure Rust TLS) so this shouldn't happen, but dependency chains can pull in
the `openssl` crate on some platforms.

### Fix

```bash
# Ubuntu/Debian:
sudo apt install -y pkg-config libssl-dev

# macOS:
brew install openssl
export OPENSSL_DIR=$(brew --prefix openssl)

# Windows: Usually not needed — rustls handles TLS
```

---

## 10. Old messages show "encrypted (old key)"

### Why this happens

Messages created before the base64 encoding fix (Session 11) were encrypted
with a different key derivation. New messages encrypt/decrypt correctly.

### Fix

There's no way to recover old messages. If the ghost messages bother you:

```powershell
# Nuclear option — wipes ALL data:
docker compose down -v
docker compose up -d
# Re-apply all migrations (see SETUP.md Step 3)
```

---

## 11. WebSocket disconnects / messages not appearing in real-time

### Why this happens

WebSocket connections can drop due to network changes, laptop sleep, or proxy
timeouts.

### Fix

Hard-refresh the browser: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (macOS).
The client auto-reconnects on page load.

---

## 12. `NOTICE: relation "xxx" already exists, skipping`

### This is NOT an error

This means the migration was already applied. The `IF NOT EXISTS` clauses in our
migrations make them safe to re-run. You can ignore these notices.

---

## 13. Docker Desktop not starting / whale icon not green

### Fix (Windows)

1. Open Task Manager → Services → look for "Docker Desktop Service"
2. Right-click → Start
3. If it fails: restart your computer, then open Docker Desktop
4. Wait for the whale icon in system tray to turn green (~30 seconds)

### Fix (WSL2 issues)

```powershell
wsl --update
wsl --shutdown
# Restart Docker Desktop
```

---

## Build Order Cheat Sheet

When in doubt, follow this exact sequence:

```
1. docker compose up -d            ← Start containers
2. Wait 5 seconds                  ← Let Postgres initialize
3. Apply all migrations            ← BEFORE building Rust
4. cargo build --release           ← Now sqlx can validate queries
5. cargo run --release             ← Start the server
6. Open http://localhost:3000      ← Use the app
```

**The #1 mistake is building before migrating.** sqlx checks queries at compile
time, so the database schema must match what the code expects.

---

## 14. Rollback / Recovery — If Something Breaks

Every major change is tagged on GitHub. If a build fails or the app breaks after pulling new code:

```powershell
# See all available rollback points
git tag -l

# Revert to a known-good state
git checkout v0.11.1-fix-dupes   # Latest stable (recommended)
cargo build
cargo run

# Other safe rollback points:
# git checkout v0.10.0-stable     # Before MLS wiring — all UI features, PBKDF2 crypto
# git checkout v0.11.0-mls-wired  # MLS endpoints added, backward compatible
```

**After reverting**, you can return to the latest code with:
```powershell
git checkout main
git pull
cargo build
```

**Nuclear option** — full reset if everything is broken:
```powershell
git stash                          # Save any local changes
docker compose down -v             # Wipe all DB data
docker compose up -d               # Fresh containers
# Wait 5 seconds for Postgres to initialize
# Re-apply ALL migrations in order:
Get-Content migrations\001_schema.sql | docker compose exec -T postgres psql -U citadel -d citadel
Get-Content migrations\002_friends.sql | docker compose exec -T postgres psql -U citadel -d citadel
# ... continue for all migrations through 012
cargo build
cargo run
```

---

## 15. MLS Crypto — Setup & Troubleshooting

### What is `wasm32-unknown-unknown`?

This is a **valid Rust target triple** — it's NOT an error. The format is `arch-vendor-os`:
- `wasm32` = WebAssembly 32-bit architecture
- `unknown` = no specific vendor
- `unknown` = no operating system (WASM runs in a sandbox)

This is the standard target for compiling Rust to WebAssembly for browsers.

### MLS Setup Steps (Windows PowerShell)

```powershell
# Step 1: Verify the crypto crate compiles and tests pass
cd C:\dev\Discreet2\discreet-crypto
cargo test
# Expected: "Full MLS lifecycle test passed!" with 6 green checkmarks

# Step 2: Add WASM target + install wasm-pack (one-time setup)
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Step 3: Build WASM module for the browser
wasm-pack build --target web --features wasm --no-default-features
# Creates: discreet-crypto/pkg/ with .wasm + .js + .d.ts files

# Step 4: Apply the MLS database migration
cd C:\dev\Discreet2
Get-Content migrations\012_mls_key_distribution.sql | docker compose exec -T postgres psql -U citadel -d citadel
# Expected: CREATE TABLE (x4), CREATE INDEX (x4), DO

# Step 5: Rebuild the server with MLS endpoints
cargo build
cargo run
```

### MLS Troubleshooting

**`error[E0405]: cannot find trait 'OpenMlsCryptoProvider'`**
→ FIXED. OpenMLS v0.7 renamed it to `OpenMlsProvider`. Pull latest: `git pull && cargo test`.

**`error[E0433]: failed to resolve: use of undeclared type 'CryptoConfig'`**
→ FIXED. Removed in OpenMLS v0.7. Pull latest: `git pull && cargo test`.

**`error[E0277]: there are multiple different versions of crate 'openmls_traits'`**
→ FIXED. Root cause: `openmls_rust_crypto` v0.3 and `openmls_basic_credential` v0.3 depended on `openmls_traits` v0.3, but `openmls` v0.7 needs v0.4. This caused TWO versions of the same trait crate, making every trait bound fail. Fix: switched all OpenMLS sub-crates to git dependencies pinned to the same branch. Pull latest: `git pull && cd discreet-crypto && cargo test`.

**`error[E0308]: expected 'CommitMessageBundle', found '(_, _, _)'`**
→ FIXED. `self_update()` return type changed in v0.7 from tuple to `CommitMessageBundle`. Code rewritten to use `bundle.commit()`.

**`error[E0599]: no method named 'into_protocol_message'`**
→ FIXED. Renamed to `try_into_protocol_message()` in v0.7.

**`error[E0433]: failed to resolve: use of undeclared crate`** when building discreet-crypto
→ You're building with wrong features. Use `cargo test` (uses default "native" feature) or `wasm-pack build --features wasm --no-default-features` (for WASM).

**`wasm-pack` fails with "error: could not compile"**
→ Make sure you added the WASM target: `rustup target add wasm32-unknown-unknown`

**`cargo test` fails in discreet-crypto**
→ Check that `openmls` version matches Cargo.toml. Try `cargo update` then `cargo test` again.

**MLS migration "already exists" warnings**
→ Harmless. The `IF NOT EXISTS` guards handle re-running migrations.

**Channels still using PBKDF2 after MLS setup**
→ Expected! Existing channels stay on `mls_version=0` (PBKDF2). Only new channels created after MLS activation use `mls_version=1`. The client auto-detects which mode to use per-channel.

---

## Still stuck?

1. Check `docker compose logs postgres` for database errors
2. Check `docker compose logs redis` for cache errors  
3. Try the nuclear option: `docker compose down -v && docker compose up -d` + re-apply all migrations
4. Open an issue at https://github.com/CitadelOpenSource/Discreet/issues

---

## 16. VersionMismatch(N) on `cargo run`

```
Error: VersionMismatch(12)
```

**Cause:** `sqlx::migrate!()` was auto-running migrations at startup and tracking checksums. A migration file was modified after initial application, causing a checksum mismatch.

**Fix (already applied):** `sqlx::migrate!()` is commented out in main.rs. Migrations are applied manually per SETUP.md. This is the permanent workflow.

---

## 17. WASM build: `uuid` needs randomness

```
error: to use `uuid` on `wasm32-unknown-unknown`, specify a source of randomness
```

**Fix:** In `discreet-crypto/Cargo.toml`, ensure uuid has the `"js"` feature:
```toml
uuid = { version = "1", features = ["v4", "serde", "js"] }
```

---

## 18. WASM build: type mismatches in wasm_bindings.rs

```
expected `&[u8]`, found `MlsMessageIn`
```

**Cause:** The core API functions (`join_from_welcome`, `process_commit`) were updated to take `&[u8]` bytes in Session 30, but the WASM bindings still deserialized to `MlsMessageIn` first.

**Fix:** Pass `&welcome_bytes` / `&commit_bytes` directly. Don't deserialize to `MlsMessageIn` in the bindings — the core functions handle deserialization internally.

---

## 19. WASM build: borrow checker (E0502)

```
cannot borrow `state` as mutable because it is also borrowed as immutable
```

**Cause:** `state.signer.as_ref()?.clone()` keeps an immutable borrow on `state` alive across the `?` operator. Then `state.groups.get_mut()` tries to take a mutable borrow — conflict.

**Fix:** Use `state.signer.clone().ok_or_else(...)` — this clones the `Option<SignatureKeyPair>` directly without an intermediate borrow on `state`.

---

## 20. Client: `notes.slice is not a function`

**Cause:** The Quick Notes widget used `localStorage.getItem("d_notes")` which collided with the profile card's per-user notes (stored as an object `{}`). The widget expects an array `[]`.

**Fix:** Widget renamed to `d_todos` key. Also wrapped in `Array.isArray()` guard. Notes are now encrypted as `d_todos_enc`.

---

## 21. CSS zoom breaks layout

**Cause:** Using CSS `zoom` on `.app-root` for font scaling changes the effective viewport size. 100vh becomes smaller than the actual viewport, causing content to overflow and hide the bottom of the screen.

**Fix:** Reverted to CSS custom property `--app-font-size` on body. Note: inline pixel values (e.g. `fontSize:13`) in the monolith won't be affected — this is a fundamental limitation that the Vite migration (with rem units) solves.

---

*This file is updated whenever new error patterns are discovered.*

---

## Tauri Desktop App

### "feature `shell-open` does not exist"
Tauri v2 moved shell to a plugin. In `desktop/src-tauri/Cargo.toml`:
```toml
tauri = { version = "2", features = [] }    # NOT ["shell-open"]
tauri-plugin-shell = "2"                     # This handles it
```

### "Waiting for your frontend dev server"
Start the Rust server first (`cargo run` in project root), then `cargo tauri dev` in `desktop/`.

### frontendDist path
Resolves from `desktop/src-tauri/`. Must be `../../client-next/dist` (two levels up).

### Window close doesn't quit
By design — it hides to system tray. Right-click tray icon → Quit.

## React Native Mobile

### CSRF token errors
React Native doesn't use browser cookies. Mobile CitadelAPI reads Set-Cookie header and stores token in AsyncStorage.

### WebSocket disconnects in background
By design — stays alive 5 min in background, then disconnects. Reconnects instantly on foreground with exponential backoff.

### "Cannot find module @react-native-firebase"
Run `npm install` in `mobile/` first. Firebase requires native linking — follow `@react-native-firebase` setup guide for Android/iOS.
