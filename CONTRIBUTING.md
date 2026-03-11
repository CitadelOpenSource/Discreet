# Contributing to Discreet

Thanks for your interest! This is an open-source E2EE Discord alternative.
The canonical roadmap/changelog is **`CITADEL_STATUS.md`** — read it first.

## Ground Rules

1. **Update `CITADEL_STATUS.md` with every PR** — it's our history book
2. **Never modify `client/index.html`** — it's the legacy monolith (archived)
3. All new client work goes in `client-next/src/` (TypeScript + Vite)
4. Backend changes require `cargo build` to pass with no errors
5. Run `cargo test` in `discreet-crypto/` before touching crypto code

## Quick Setup

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
docker compose up -d

# Apply all migrations
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel
done

# Build Vite client
cd client-next && npm install && npm run build && cd ..

# Build and run server
cargo build && cargo run
# http://localhost:3000/next/
```

## Project Structure

- `src/*.rs` — Rust/Axum backend (~13,500 lines)
- `client-next/src/` — Vite TypeScript client (30 files, ~7,260 lines)
- `discreet-crypto/` — MLS RFC 9420 crypto crate (WASM-ready)
- `migrations/` — PostgreSQL migrations (apply in order)
- `CITADEL_STATUS.md` — Development timeline + feature tracker

## Where to Contribute

Check [Issues](https://github.com/CitadelOpenSource/Discreet/issues) for "good first issue" labels.

Priority areas:
- **Forum channels** — port from monolith to Vite client
- **Testing** — unit tests for API endpoints, integration tests
- **Mobile** — React Native client using shared API + crypto
- **Security audit** — review crypto implementation
- **Accessibility** — screen reader support, keyboard navigation
- **i18n** — internationalization framework

## Using Claude Code

See `CLAUDE.md` for project-specific setup. Claude Code can read the codebase
and create typed TypeScript files directly.

## PR Checklist

- [ ] `CITADEL_STATUS.md` updated
- [ ] `npm run build` passes in `client-next/`
- [ ] `cargo build` passes (if backend changed)
- [ ] `cargo test` passes in `discreet-crypto/` (if crypto changed)
- [ ] No `client/index.html` modifications

## License

AGPL-3.0-or-later. By contributing, you agree your code is under this license.

## Areas for Contribution

### High Impact
- **Proximity Mesh** — BLE and Wi-Fi Direct testing on diverse Android/iOS devices
- **MLS WASM** — Help stabilize the OpenMLS WASM build for browser crypto
- **iOS MultipeerConnectivity** — Port Wi-Fi Direct proximity to iOS native
- **Raspberry Pi relay** — BlueZ daemon for BLE mesh relay
- **Post-quantum crypto** — ML-KEM-768 + X25519 hybrid key exchange

### Good First Issues
- UI polish and accessibility improvements
- Additional language translations
- Documentation improvements
- Test coverage for API endpoints
- Mobile responsive CSS fixes

### Testing Help Needed
- BLE proximity requires physical devices (no emulator support)
- Cross-device testing across Android manufacturers (Samsung, Pixel, OnePlus, etc.)
- iOS BLE behavior differs from Android — needs dedicated testing
- Wi-Fi Direct compatibility varies by Android version and manufacturer
