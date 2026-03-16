# Quickstart

Get Discreet running locally in under 5 minutes.

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) (for PostgreSQL + Redis)
- [Rust](https://rustup.rs/) (1.93+)
- [Node.js](https://nodejs.org/) (18+)
- Windows only: [VS Build Tools 2022+](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" workload

## Setup

### Linux / macOS

```bash
# Clone and enter the repo
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# Start PostgreSQL and Redis
docker compose up -d

# Apply all database migrations (must complete before cargo build)
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel
done

# Configure environment
cp .env.example .env
# Edit .env — at minimum, set a random JWT_SECRET:
#   JWT_SECRET=$(openssl rand -hex 64)

# Build the Vite client
cd client && npm install && npm run build && cd ..

# Start the server
cargo run
```

### Windows (PowerShell)

```powershell
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

docker compose up -d

# Apply all migrations
Get-ChildItem migrations\*.sql | Sort-Object Name | ForEach-Object {
  Get-Content $_.FullName | docker compose exec -T postgres psql -U citadel -d citadel
}

Copy-Item .env.example .env
# Edit .env — set JWT_SECRET to a random 64+ character string

cd client; npm install; npm run build; cd ..

cargo run
```

> **Important:** sqlx validates SQL queries at compile time against the live database. Migrations **must** be applied before `cargo build` or you'll get `column "xxx" does not exist` errors.

First build takes 3-5 minutes (compiles ~300 crates). Subsequent builds are ~15 seconds.

## Access

- **Web client:** http://localhost:3000/next/
- **Health check:** http://localhost:3000/health
- **API base:** http://localhost:3000/api/v1/

### Phone Access (Local Network)

Find your PC's local IP (`ipconfig` on Windows, `hostname -I` on Linux) and open `http://192.168.x.x:3000` on your phone. Both devices must be on the same network.

## Verify

```bash
curl http://localhost:3000/health
./scripts/smoke_test.sh
```

## Development Mode (Hot Reload)

```bash
cd client
npm run dev
# Opens at http://localhost:5173/next/
# API calls proxied to http://localhost:3000
```

## Desktop App (Tauri)

```bash
cargo install tauri-cli
cd desktop && cargo tauri dev    # needs server running
```

## Mobile App (React Native)

```bash
cd mobile && npm install
npx react-native run-android     # needs Android Studio
npx react-native run-ios         # needs Xcode (Mac only)
```

## MLS Crypto Layer (Optional)

The base server uses PBKDF2-derived channel keys. For real MLS (RFC 9420) encryption, see [BUILD_MLS.md](../BUILD_MLS.md).

## Next Steps

- [Deployment Guide](DEPLOYMENT.md) — deploy to production
- [Contributing Guide](CONTRIBUTING.md) — start contributing
- [API Reference](../docs/API_REFERENCE.md) — explore the 184 endpoints
- [Troubleshooting](../TROUBLESHOOTING.md) — common errors and fixes
