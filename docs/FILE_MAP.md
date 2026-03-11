# Discreet — File Map
**Last updated: March 8, 2026**

## Key Documents (Start Here)
| File | Purpose |
|------|---------|
| `LAUNCH_NOW.md` | **Master launch checklist** — setup, login, deploy, everything |
| `docs/internal/CITADEL_STATUS.md` | Full project history and timeline |
| `.env.example` | All server configuration variables |
| `README.md` | Public-facing project overview |

## Source Code
| Directory | Contents |
|-----------|----------|
| `src/` | Rust backend (44 files, 14,500+ lines) |
| `client-next/src/` | Vite/React client (46 files, 18,500+ lines) |
| `mobile/src/` | React Native mobile (16 files, 5,000+ lines) |
| `desktop/src-tauri/` | Tauri desktop wrapper |
| `discreet-crypto/` | WASM MLS crypto module |
| `migrations/` | PostgreSQL migrations (001-026) |

## Documentation
| File | Status |
|------|--------|
| `LAUNCH_NOW.md` | ✅ Current — single source of truth for launch |
| `docs/USER_MANUAL.md` | ✅ Current — end-user guide |
| `docs/API_REFERENCE.md` | ✅ Current — all 184 endpoints |
| `SECURITY.md` | ✅ Current — security architecture |
| `SETUP.md` | ⚠️ Superseded by LAUNCH_NOW.md |
| `docs/SETUP_GUIDE.md` | ⚠️ Superseded by LAUNCH_NOW.md |
| `docs/BUILD_AND_RUN.md` | ⚠️ Superseded by LAUNCH_NOW.md |
| `TROUBLESHOOTING.md` | ⚠️ Mostly resolved issues |
| `DEVELOPER_GUIDE.md` | ℹ️ Contributor reference |
| `SELF_HOSTING_GUIDE.md` | ⚠️ See LAUNCH_NOW.md Step 4 |

## Configuration
| File | Purpose |
|------|---------|
| `.env.example` | Template for server environment variables |
| `docker-compose.yml` | Postgres + Redis containers |
| `Cargo.toml` | Rust dependencies and features |
| `client-next/package.json` | Client dependencies |
| `.gitignore` | Tracked/untracked file rules |
