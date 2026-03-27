# Discreet — File Map

**Last updated: March 2026**

## Key Documents

| File | Purpose |
|------|---------|
| `README.md` | Public-facing project overview |
| `FEATURES.md` | Complete feature list (150+ features with status) |
| `ROADMAP.md` | Project roadmap — shipped, in progress, next |
| `GUIDE/QUICKSTART.md` | Local development setup |
| `GUIDE/DEPLOYMENT.md` | Production deployment guide |
| `GUIDE/CONTRIBUTING.md` | Contributing workflow and code standards |
| `docs/SELF_HOSTING.md` | Self-hosting reference (canonical) |
| `.env.example` | All server configuration variables |

## Source Code

| Directory | Contents |
|-----------|----------|
| `src/` | Rust backend (50+ modules) |
| `client/src/` | React/Vite frontend (1,392 modules, 6 themes, 3 layout modes) |
| `discreet-crypto/` | WASM MLS crypto module |
| `migrations/` | PostgreSQL migrations (001–107) |
| `scripts/` | Setup, build, migration, deployment, and secret generation scripts |

## Documentation

| File | Status |
|------|--------|
| `GUIDE/QUICKSTART.md` | Current — local dev setup |
| `GUIDE/DEPLOYMENT.md` | Current — production deployment |
| `GUIDE/CONTRIBUTING.md` | Current — contributor guide |
| `docs/SELF_HOSTING.md` | Current — self-hosting reference |
| `docs/USER_MANUAL.md` | Current — end-user guide |
| `docs/API_REFERENCE.md` | Current — all API endpoints |
| `docs/BOT_SDK.md` | Current — bot/agent REST API and WebSocket events |
| `docs/TURN_SETUP.md` | Current — coturn setup for voice/video |
| `docs/ARCHITECTURE.md` | Current — system architecture |
| `docs/DISASTER_RECOVERY.md` | Current — backup and restore procedures |
| `docs/DEVELOPER_GUIDE.md` | Current — architecture and code style |
| `docs/INCIDENT_RESPONSE.md` | Current — security incident procedures |
| `docs/Caddyfile.production` | Current — production reverse proxy config |
| `docs/discreet.service` | Current — systemd unit file |
| `SECURITY.md` | Current — security architecture and threat model |
| `CONTRIBUTING.md` | Current — contributor guide (root) |
| `ROADMAP.md` | Current — project roadmap |
| `docs/BUILD_MLS.md` | Reference — MLS crypto layer build |
| `docs/DEPLOY_RASPBERRY_PI.md` | Reference — Raspberry Pi deployment |
| `docs/TROUBLESHOOTING.md` | Reference — common errors and fixes |
| `docs/BAA_TEMPLATE.md` | Reference — HIPAA Business Associate Agreement |

## Configuration

| File | Purpose |
|------|---------|
| `.env.example` | Template for all environment variables |
| `.env.production.example` | Production-specific template |
| `docker-compose.yml` | PostgreSQL + Redis containers |
| `Cargo.toml` | Rust dependencies, features, and binary config |
| `client/package.json` | Frontend dependencies |
| `client/vite.config.ts` | Vite build configuration (base path: /app/) |
| `.gitignore` | Tracked/untracked file rules |
| `.cargo/audit.toml` | cargo-audit exception documentation |
