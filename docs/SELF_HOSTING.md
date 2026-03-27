# Self-Hosting Discreet

Run your own end-to-end encrypted communication server. Full platform: servers, channels, voice/video, AI agents, 150+ features. The server stores only ciphertext — it cannot read your messages.

## Requirements

| Resource | Minimum |
|----------|---------|
| CPU | 2 cores |
| RAM | 4 GB |
| Disk | 20 GB SSD |
| OS | Ubuntu 22.04+, Debian 12+, or any Docker-capable Linux |
| Docker | Docker Engine 24+ and Docker Compose v2 |
| Domain | A domain with DNS A record pointing to your server |

You also need a [Resend](https://resend.com) account (free tier) for email verification.

## Quick Start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
./scripts/setup.sh
```

Open `http://localhost:5173` and create your first account.

## What setup.sh Does

The setup script runs these steps in order:

1. Checks for Docker, Rust, and Node.js — installs what's missing
2. Copies `.env.example` to `.env` and generates random secrets (JWT, TOTP, agent key)
3. Starts PostgreSQL and Redis via Docker Compose
4. Waits for PostgreSQL to become ready
5. Applies all database migrations (`migrations/*.sql`)
6. Runs `cargo sqlx prepare` to generate the offline query cache
7. Builds the Rust backend (`cargo build --release`)
8. Builds the Vite frontend (`cd client && npm install && npm run build`)

After setup completes, start the server with:

```bash
./target/release/discreet-server
```

## Manual Setup

If you prefer full control over each step:

### 1. Install dependencies

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Clone and configure

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
cp .env.example .env
```

Edit `.env` and fill in your secrets:

```bash
DATABASE_URL=postgres://discreet:<DB_PASSWORD>@localhost:5432/discreet
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -hex 64)
TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)
AGENT_KEY_SECRET=$(openssl rand -hex 32)
```

### 3. Start databases

```bash
docker compose up -d
```

### 4. Apply migrations

```bash
# Linux/macOS
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U discreet -d discreet
done

# Windows PowerShell
Get-ChildItem migrations\*.sql | ForEach-Object {
  Get-Content $_.FullName | docker compose exec -T postgres psql -U discreet -d discreet
}
```

### 5. Build

```bash
# Prepare SQLx offline cache
cargo sqlx prepare

# Build backend
cargo build --release

# Build frontend
cd client && npm install && npm run build && cd ..
```

### 6. Start

```bash
./target/release/discreet-server
```

The server listens on port 3000 by default. The frontend is served at `/app`.

## Making Yourself Admin

After creating your account through the web interface, promote it to admin:

```bash
docker compose exec -T postgres psql -U discreet -d discreet \
  -c "UPDATE users SET account_tier = 'admin', platform_role = 'admin' WHERE username = '<YOUR_USERNAME>';"
```

Restart the server. You now have access to the admin dashboard.

## Email Setup

Discreet uses the [Resend](https://resend.com) HTTP API for email verification and password resets.

1. Create a free Resend account at https://resend.com
2. Add and verify your domain (add the DNS records Resend provides)
3. Create an API key
4. Add to your `.env`:

```bash
RESEND_API_KEY=<your-resend-api-key>
SMTP_FROM=noreply@<YOUR_DOMAIN>
```

5. Restart the server

No SMTP relay configuration is needed — the code calls the Resend HTTP API directly.

## HTTPS with Caddy

[Caddy](https://caddyserver.com) handles automatic HTTPS via Let's Encrypt.

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Create `/etc/caddy/Caddyfile`:

```
<YOUR_DOMAIN> {
    encode gzip zstd
    root * /opt/discreet/client/dist
    try_files {path} /index.html
    file_server
    header {
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
    @static path *.js *.css *.woff2 *.png *.svg *.webp
    header @static Cache-Control "public, max-age=31536000, immutable"
}

api.<YOUR_DOMAIN> {
    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Set your `.env` accordingly:

```bash
APP_URL=https://<YOUR_DOMAIN>
API_URL=https://api.<YOUR_DOMAIN>
ALLOWED_ORIGINS=https://<YOUR_DOMAIN>
```

Restart Caddy and the server:

```bash
sudo systemctl restart caddy
sudo systemctl restart discreet
```

A production systemd service file is included at `docs/discreet.service`.

## TURN Server (optional)

TURN relay servers allow voice and video calls to work behind restrictive NATs. Without TURN, approximately 10-15% of users cannot connect peer-to-peer.

See **[docs/TURN_SETUP.md](TURN_SETUP.md)** for step-by-step coturn installation.

Quick summary for `.env`:

```bash
TURN_SECRET=<openssl rand -hex 32>
TURN_HOST=turn.<YOUR_DOMAIN>
```

The TURN secret must match the `static-auth-secret` in your coturn configuration.

## Updating

```bash
cd /opt/discreet
git pull

# Apply any new migrations
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U discreet -d discreet
done

# Rebuild
cargo sqlx prepare
cargo build --release
cd client && npm install && npm run build && cd ..

# Restart
sudo systemctl restart discreet
```

## Backups

Back up the PostgreSQL database daily:

```bash
# Add to crontab: crontab -e
0 3 * * * docker compose -f /opt/discreet/docker-compose.yml exec -T postgres \
  pg_dump -U discreet -d discreet | gzip > /opt/discreet/backups/discreet-$(date +\%Y\%m\%d).sql.gz
```

Keep at least 7 days of backups. Test restores periodically:

```bash
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U discreet -d discreet
```

For full disaster recovery procedures, see **[docs/DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)**.

## Troubleshooting

**Port 3000 already in use:**
Change the port in `.env` with `PORT=3001` and restart.

**Docker Compose won't start:**
Check Docker is running: `docker info`. On Ubuntu, `sudo systemctl start docker`.

**Migrations fail with "relation already exists":**
This is safe — migrations use `IF NOT EXISTS`. The error is informational.

**CORS errors in the browser:**
Set `ALLOWED_ORIGINS=https://<YOUR_DOMAIN>` in `.env`. The origin must match exactly (including protocol and no trailing slash).

**WebSocket connection refused:**
Ensure your reverse proxy forwards WebSocket upgrades. Caddy handles this automatically. For nginx, add `proxy_set_header Upgrade $http_upgrade` and `proxy_set_header Connection "upgrade"`.

**"sqlx: no DATABASE_URL" during build:**
Run `cargo sqlx prepare` first, or set `SQLX_OFFLINE=true` for offline builds.

**Voice/video calls fail:**
Most call failures are caused by missing TURN server configuration. See the TURN Server section above.
