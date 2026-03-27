# Local Development Setup

Get Discreet running on your machine for development.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Git | any | https://git-scm.com |
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Rust | 1.78+ | https://rustup.rs |
| Node.js | 20+ | https://nodejs.org |

**Windows only:** Install [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload. This is required for Rust's native compilation on Windows.

## Clone and Setup

### Option A: Automated setup

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# Linux/macOS
./scripts/setup.sh

# Windows (PowerShell — run as Administrator)
.\scripts\setup.ps1
```

The script installs missing dependencies, generates secrets, starts databases, applies migrations, and builds everything.

### Option B: Manual setup

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# Copy and configure environment
cp .env.example .env
# Edit .env — at minimum, generate a JWT secret:
#   JWT_SECRET=$(openssl rand -hex 64)

# Start PostgreSQL and Redis
docker compose up -d

# Apply all database migrations (required before building)
# Linux/macOS:
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U discreet -d discreet
done

# Windows PowerShell:
Get-ChildItem migrations\*.sql | Sort-Object Name | ForEach-Object {
  Get-Content $_.FullName | docker compose exec -T postgres psql -U discreet -d discreet
}

# Build the frontend
cd client && npm install && npm run build && cd ..
```

> **Important:** sqlx validates SQL queries at compile time against the live database. Migrations **must** be applied before `cargo build` or you'll get "column does not exist" errors.

## Start Development

Terminal 1 — Backend:

```bash
cargo run
```

First build compiles ~300 crates (3-5 minutes). Subsequent builds take ~15 seconds.

Terminal 2 — Frontend (hot reload):

```bash
cd client
npm run dev
```

Open **http://localhost:5173** in your browser. The Vite dev server proxies API calls to the Rust backend on port 3000.

**Endpoints:**
- Web app: http://localhost:5173
- Health check: http://localhost:3000/health
- API base: http://localhost:3000/api/v1/

**Phone testing:** Find your local IP (`ipconfig` on Windows, `hostname -I` on Linux) and open `http://<YOUR_LOCAL_IP>:5173` on your phone. Both devices must be on the same Wi-Fi network.

## What "Server" Means

Discreet uses "server" for two different things. This trips up new contributors:

**Backend server** — The Rust/Axum process that handles HTTP requests, WebSocket connections, and database queries. This is the thing you start with `cargo run`. There is one backend server per deployment.

**Community server** — A user-created group space (like a Discord server). It has channels, roles, members, and permissions. A single backend server hosts many community servers. The code calls these "servers" in the database (`servers` table) and "guilds" nowhere — we use "server" consistently.

When you see "server" in the codebase:
- `src/discreet_server_handlers.rs` — handlers for community server CRUD
- `server_members`, `server_invites` — database tables for community servers
- `cargo run` — starts the backend server
- `discreet-server` — the compiled binary name

## How It Works for New Users

1. **Register** — Create an account with email + password, OAuth, or anonymously with a 12-word seed phrase
2. **Create a server** — Give it a name. You're now the owner with full permissions.
3. **Create channels** — Text channels for messaging, voice channels for calls
4. **Invite friends** — Generate an invite link or QR code. Share it. They join.
5. **Start talking** — Messages are encrypted on your device before they leave. The backend stores ciphertext it cannot decrypt.

## Common Fixes

**Port 3000 already in use:**
Something else is using the backend port. Either stop it (`lsof -i :3000` on Linux, `netstat -ano | findstr :3000` on Windows) or change the port: add `PORT=3001` to your `.env`.

**Port 5173 already in use:**
Another Vite instance is running. Kill it or run `npx vite --port 5174`.

**Docker not running:**
`docker compose up -d` fails with "Cannot connect to the Docker daemon." Start Docker Desktop (Windows/Mac) or `sudo systemctl start docker` (Linux).

**"column X does not exist" during cargo build:**
Migrations haven't been applied. Run the migration commands from the setup section above, then `cargo build` again.

**Black screen after login:**
The frontend build is stale. Run `cd client && npm run build && cd ..` and refresh.

**sqlx offline error:**
If you see "no DATABASE_URL" during build, the database isn't reachable. Either start Docker (`docker compose up -d`) or run `cargo sqlx prepare` to generate offline query metadata.

**Windows: "link.exe not found":**
Install Visual Studio Build Tools with the C++ workload. Rust needs MSVC on Windows.

## Next Steps

- [Deployment Guide](DEPLOYMENT.md) — deploy to production
- [Contributing Guide](CONTRIBUTING.md) — start contributing
- [API Reference](../docs/API_REFERENCE.md) — explore the API
