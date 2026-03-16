# Contributing to Discreet

Thank you for your interest in contributing to Discreet. This project is an
end-to-end encrypted community platform licensed under AGPL-3.0-or-later.
Every contribution — code, documentation, bug reports, security research —
makes the platform stronger for everyone.

We do not require a Contributor License Agreement (CLA). Your contributions
are licensed under the same AGPL-3.0-or-later terms as the project.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Rust | 1.85+ | Backend server, WASM crypto module |
| Node.js | 20+ | Vite frontend build |
| Docker | Latest | PostgreSQL 16 and Redis 7 (via Compose) |
| PostgreSQL | 16 | Primary database (runs in Docker) |
| Redis | 7 | Rate limiting, caching, presence (runs in Docker) |

Optional:
- `wasm-pack` — for building the MLS crypto WASM module
- `cargo-audit` — for dependency vulnerability scanning
- `cargo-sqlx` — for offline query metadata (`cargo sqlx prepare`)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# Start PostgreSQL and Redis
docker compose up -d

# Apply database migrations
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done

# Build and run the backend
cp .env.example .env   # Edit with your local settings
cargo build
cargo run

# In a separate terminal — build the frontend
cd client
npm install
npm run build
```

The server starts at `http://localhost:3000`. The Vite client is served at `/app`.

## Branch Workflow

Create a branch from `main` with a descriptive prefix:

| Prefix | Use case | Example |
|--------|----------|---------|
| `feat/` | New features | `feat/voice-noise-gate` |
| `fix/` | Bug fixes | `fix/websocket-reconnect` |
| `security/` | Security improvements | `security/input-validation` |
| `docs/` | Documentation only | `docs/threat-model-update` |
| `deps/` | Dependency updates | `deps/openmls-0.8` |
| `quality/` | Refactoring, cleanup | `quality/extract-message-list` |

Commit messages follow `type: description` format:
```
feat: notification inbox with unread count
fix: timezone rendering in event reminders
security: input validation on all auth endpoints
deps: redis 1.0 + audit exception for rsa
```

## Code Standards

### Rust Backend

- All handlers return `Result<impl IntoResponse, AppError>`
- All database queries use `sqlx::query!` or `sqlx::query_as!` macros (compile-time validated)
- No `.unwrap()` in handler code — use `?` with proper error types
- No `.unwrap_or_default()` to silence type mismatches — fix the root cause
- Errors logged with `tracing::{error, warn, info, debug}` — no `println!`
- `cargo clippy -- -D warnings` must pass with zero warnings

### Cryptography

- All key derivation uses HKDF-SHA256 — no raw SHA-256 hashing for key material
- All AES-256-GCM ciphertexts include a 32-byte key commitment tag
- Commitment info string: append `:commit` to the HKDF info parameter
- Wire format: `[commitment(32) | iv(12) | ciphertext+tag]`
- No custom cryptographic primitives — use audited libraries only
- WASM crypto module: `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`

### React Frontend (client/)

- TypeScript strict mode — no `any` types unless interfacing with JS libraries
- Functional components with hooks (no class components)
- API calls wrapped in try/catch with user-visible error handling
- Loading states for every async operation
- No `console.log` in committed code

### CSS / Styling

- Use existing CSS variables and theme system (`T.ac`, `T.bg`, `T.sf`, etc.)
- Dark theme is default — test all changes in dark mode first

## Testing

### Before Every Pull Request

```bash
# Backend
cargo sqlx prepare          # Regenerate query cache
cargo check                 # Compile check
cargo test --lib            # Unit tests
cargo clippy -- -D warnings # Zero warnings

# Frontend
cd client && npm run build  # Must complete with zero errors
```

### What to Test

- Every crypto function: encrypt/decrypt roundtrip, wrong key rejection
- Every input validator: valid input passes, invalid input rejected
- Every new module: at minimum 3 unit tests (happy path, error path, edge case)
- Rate limiters: verify they fail-closed when Redis is unavailable

## Security Reporting

If you discover a security vulnerability, please report it responsibly:

- **Email:** security@discreetai.net
- **PGP key:** Available at https://discreetai.net/.well-known/pgp-key.txt
- **Do not** open a public GitHub issue for security vulnerabilities
- We aim to acknowledge reports within 48 hours and provide a fix within 7 days

See [SECURITY.md](SECURITY.md) for our full disclosure policy.

## License

Discreet is licensed under [AGPL-3.0-or-later](LICENSE). By contributing,
you agree that your contributions will be licensed under the same terms.

Copyright (C) 2026 Citadel Open Source LLC.
