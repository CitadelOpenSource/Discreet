# Contributing to Discreet

Thank you for considering a contribution to Discreet. Whether this is your first open-source PR or your hundredth, you are welcome here. Every contribution — a bug fix, a typo correction, a security report, or a major feature — makes encrypted communication more accessible for everyone. No Contributor License Agreement (CLA) is required. Your code is licensed under the same AGPL-3.0-or-later terms as the project.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Rust | 1.75+ | Backend server, WASM crypto module |
| Node.js | 18+ | Vite frontend build and dev server |
| Docker | Latest | PostgreSQL and Redis via Compose |

Optional:

- `cargo-sqlx` — offline query metadata (`cargo sqlx prepare`)
- `cargo-audit` — dependency vulnerability scanning
- `wasm-pack` — building the MLS crypto WASM module
- Perl (Windows only) — required by OpenSSL build scripts

## Dev Setup

```bash
# Clone the repository
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# Start PostgreSQL and Redis
docker compose up postgres redis -d

# Copy environment template and configure
cp .env.example .env

# Verify the backend compiles
cargo check

# Start the frontend dev server (hot-reloading)
cd client
npm install
npm run dev
```

The backend runs at `http://localhost:3000` and the Vite dev server at `http://localhost:5173`.

If you use VS Code or a compatible editor, a dev container configuration is available in `.devcontainer/` for a fully pre-configured environment with Rust, Node, PostgreSQL, and Redis ready to go.

## Code Standards

### Rust Backend

- `cargo clippy -- -D warnings` — zero warnings policy, enforced in CI
- No `.unwrap()` in handler code — use `?` with proper error types
- No `.unwrap_or_default()` to silence type mismatches — fix the root cause
- All database queries use `sqlx::query!` or `sqlx::query_as!` macros (compile-time validated)
- All handlers return `Result<impl IntoResponse, AppError>`
- Errors logged with `tracing::{error, warn, info, debug}` — no `println!` or `eprintln!`

### React Frontend (client/)

- TypeScript strict mode — no `any` types unless interfacing with JS libraries
- Functional components with hooks (no class components)
- No `console.log` in committed code — remove before opening a PR
- API calls wrapped in try/catch with user-visible error handling
- Loading states for every async operation

### New Files

All new source files should include the AGPL-3.0 license header:

```rust
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Citadel Open Source LLC
```

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Citadel Open Source LLC
```

## Branch Naming

Create a branch from `main` with a descriptive prefix:

| Prefix | Use case | Example |
|--------|----------|---------|
| `feat/` | New features | `feat/voice-noise-gate` |
| `fix/` | Bug fixes | `fix/websocket-reconnect` |
| `docs/` | Documentation | `docs/threat-model-update` |
| `chore/` | Tooling, CI, cleanup | `chore/update-ci-runners` |

## Commit Messages

Follow the conventional format `type: description`:

```
feat: notification inbox with unread count
fix: timezone rendering in event reminders
docs: add self-hosting backup instructions
chore: update CI to Node 20
```

Types: `feat`, `fix`, `security`, `docs`, `deps`, `quality`, `chore`, `branding`.

## Pull Request Process

1. **One concern per PR.** A bug fix and a new feature should be separate PRs.
2. **CI must pass.** All checks (clippy, tests, frontend build) must be green before review.
3. **Describe what and why.** The PR description should explain what changed and the motivation behind it. Reviewers should not need to read every line to understand the purpose.
4. **Keep it reviewable.** PRs under 400 lines get reviewed faster. If your change is larger, consider splitting it into incremental PRs.

## Testing

Before opening a PR:

```bash
# Backend
cargo sqlx prepare          # Regenerate query cache
cargo check                 # Compile check
cargo test --lib            # Unit tests
cargo clippy -- -D warnings # Zero warnings

# Frontend
cd client && npm run build  # Must complete with zero errors
```

Every new module should have at minimum 3 unit tests covering the happy path, an error path, and an edge case. Every crypto function needs encrypt/decrypt roundtrip tests and wrong-key rejection tests.

## Security Reporting

If you discover a security vulnerability:

- **Email:** security@discreetai.net
- **PGP key:** https://discreetai.net/.well-known/pgp-key.txt
- **Do NOT open a public GitHub issue for security vulnerabilities**

We follow 90-day responsible disclosure. Reports are acknowledged within 48 hours, and critical fixes ship within 7 days. We will not pursue legal action against researchers who report in good faith.

See [SECURITY.md](SECURITY.md) for our full disclosure policy, PGP fingerprint, and cryptographic specification.

## License

Discreet is licensed under [AGPL-3.0-or-later](LICENSE). By contributing, you agree that your contributions will be licensed under the same terms.

Copyright (C) 2026 Citadel Open Source LLC.
