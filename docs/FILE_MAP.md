# Discreet — File Map
**Last updated: March 10, 2026**

## Key Documents (Start Here)
| File | Purpose |
|------|---------|
| `GUIDE/QUICKSTART.md` | **Local setup** — get running in 5 minutes |
| `GUIDE/DEPLOYMENT.md` | **Production deployment** — Oracle Cloud, Docker, SSL |
| `GUIDE/CONTRIBUTING.md` | **Contributing** — workflow, code standards, PRs |
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
| `migrations/` | PostgreSQL migrations (001-027) |

## Documentation
| File | Status |
|------|--------|
| `GUIDE/QUICKSTART.md` | Primary setup guide |
| `GUIDE/DEPLOYMENT.md` | Primary deployment guide |
| `GUIDE/CONTRIBUTING.md` | Primary contributor guide |
| `docs/USER_MANUAL.md` | End-user guide |
| `docs/API_REFERENCE.md` | All 184 endpoints |
| `SECURITY.md` | Security architecture |
| `DEVELOPER_GUIDE.md` | Architecture and code style reference |
| `BUILD_MLS.md` | MLS crypto layer build instructions |
| `DEPLOY_RASPBERRY_PI.md` | Raspberry Pi deployment |
| `TROUBLESHOOTING.md` | Common errors and fixes |
| `ROADMAP.md` | Project roadmap |

## Configuration
| File | Purpose |
|------|---------|
| `.env.example` | Template for server environment variables |
| `docker-compose.yml` | Postgres + Redis containers |
| `Cargo.toml` | Rust dependencies and features |
| `client-next/package.json` | Client dependencies |
| `.gitignore` | Tracked/untracked file rules |
