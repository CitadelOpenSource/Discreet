# Contributing to Discreet

We're building an encrypted Discord alternative — and we want your help.

## Quick start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
docker compose up -d
cd client-next && npm install && npm run build && cd ..
cargo build && cargo run
```

Open `http://localhost:3000` and you're running.

## What we need help with

**High impact, approachable:**
- UI polish — the Vite client works but could look better
- Translation files — we have 12 languages started in `client-next/src/i18n/`, most need native speaker review
- Documentation improvements — typos, clarity, missing examples
- Test coverage — we have compile-time SQL validation but need more integration tests

**Medium complexity:**
- Desktop builds — Tauri is configured but needs production testing on macOS and Linux
- Mobile polish — React Native app works on Android, needs iOS testing
- Voice quality — WebRTC + SFrame E2EE works but could use optimization
- Accessibility — screen reader support, keyboard navigation, ARIA labels

**Deep work (experienced contributors):**
- MLS integration — wiring OpenMLS for real key exchange (currently using PBKDF2 fallback)
- Post-quantum crypto — ML-KEM and ML-DSA types are defined, need implementation
- Federation — types exist, protocol needs design
- Proximity mesh — BLE + Wi-Fi Direct encrypted communication (P1-P8 in roadmap)

## How to contribute

1. Fork the repo
2. Create a branch: `git checkout -b fix/your-thing`
3. Make your changes
4. Test locally: `cargo check && cd client-next && npm run build`
5. Open a PR with a clear description of what changed and why

## Code style

**Rust:**
- All files are prefixed `citadel_` (historical, we're keeping it)
- Handlers return `Result<impl IntoResponse, AppError>`
- SQL uses `sqlx::query!` compile-time macros — your database must be running for `cargo check`
- No `unwrap()` in handlers. Ever. Use `?` or handle the error.

**TypeScript:**
- Single-file components in `client-next/src/components/`
- State management via React hooks (useState, useEffect, useRef)
- Theme constants from `theme.ts` (T.bg, T.sf, T.tx, T.ac)
- No external state libraries — keep it simple

**Commits:**
- One logical change per commit
- Prefix: `feat:`, `fix:`, `security:`, `docs:`, `refactor:`, `deps:`
- Example: `feat: add Korean translation file`

## Architecture overview

```
Discreet/
├── src/                  → Rust/Axum backend (44 modules, 184+ routes)
├── client-next/          → Vite + React web client
├── mobile/               → React Native (Android + iOS)
├── desktop/              → Tauri v2 (Windows/macOS/Linux)
├── discreet-crypto/      → MLS + SFrame WASM crypto library
└── migrations/           → PostgreSQL schema (33+ migrations)
```

The server stores only ciphertext. It cannot decrypt messages, files, or AI agent conversations.

## Security

If you find a vulnerability, **do not open a public issue.** Email security@discreetai.net. We take this seriously — see SECURITY.md for details.

When contributing crypto-related code:
- Never introduce new encryption without discussing in an issue first
- Don't weaken existing encryption parameters
- Document any trust boundary changes
- The legacy client (`client/index.html`) is the source of truth for encryption constants — don't change them

## Developer accounts

If you need a developer account for testing, reach out to the maintainers. Dev accounts have wrench badges and access to debug panels.

## License

AGPL-3.0-or-later. By contributing, you agree that your contributions will be licensed under the same terms.

## Questions?

Open a discussion on GitHub or reach out to the maintainers. We're friendly.
