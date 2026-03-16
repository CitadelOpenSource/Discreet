# Self-Hosting Discreet

Run your own end-to-end encrypted communication server. The server stores
only ciphertext — it cannot read your messages, even under legal compulsion.

## Prerequisites

| Requirement | Minimum |
|-------------|---------|
| CPU | 2 cores |
| RAM | 4 GB |
| Disk | 20 GB SSD |
| OS | Ubuntu 22.04+, Debian 12+, or any Docker-capable Linux |
| Docker | Docker Engine 24+ with Compose V2 |
| Domain | A domain with DNS A record pointing to your server |

Optional: a Resend API key for email verification, a Cloudflare Turnstile
key pair for CAPTCHA on public-facing instances.

## Quick Start

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
./scripts/setup.sh
```

The setup script will:
1. Check prerequisites (Docker, Node.js, Rust)
2. Generate cryptographic secrets (JWT, TOTP encryption key, DB password)
3. Write `.env` with secure defaults
4. Start PostgreSQL 16 and Redis 7 via Docker Compose
5. Apply all database migrations
6. Build the Vite frontend
7. Compile and start the Rust server

The server will be running at `http://localhost:3000`.

## Manual Setup

### 1. Start Infrastructure

```bash
docker compose up -d
```

This starts PostgreSQL 16 and Redis 7. Default credentials are in
`docker-compose.yml` (user: `discreet`, password: `discreet`, db: `discreet`).

### 2. Configure Environment

```bash
cp .env.example .env
```

Generate secrets:
```bash
# JWT signing key (required)
echo "JWT_SECRET=$(openssl rand -hex 64)" >> .env

# TOTP encryption key (required for production)
echo "TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# Agent key encryption (required if using AI agents)
echo "AGENT_KEY_SECRET=$(openssl rand -hex 32)" >> .env
```

### 3. Apply Migrations

```bash
for f in migrations/*.sql; do
  psql "postgres://discreet:discreet@localhost:5432/discreet" -f "$f"
done
```

### 4. Build Frontend

```bash
cd client && npm ci && npm run build && cd ..
```

### 5. Build and Run Server

```bash
cargo build --release
./target/release/discreet-server
```

## Production: Docker + Caddy

For production deployments with automatic HTTPS:

```bash
# Generate production secrets
export POSTGRES_PASSWORD=$(openssl rand -hex 32)
export JWT_SECRET=$(openssl rand -hex 64)
export CORS_ORIGINS=https://yourdomain.com

# Start everything
docker compose -f docker-compose.prod.yml up -d --build

# Apply migrations (first time only)
docker compose -f docker-compose.prod.yml exec server /migrate.sh
```

### Caddyfile

Create a `Caddyfile` in the project root:

```
yourdomain.com {
    # API and WebSocket
    handle /api/* {
        reverse_proxy server:3000
    }
    handle /ws {
        reverse_proxy server:3000
    }
    handle /health {
        reverse_proxy server:3000
    }
    handle /webhooks/* {
        reverse_proxy server:3000
    }

    # Vite client
    handle /app/* {
        reverse_proxy server:3000
    }

    # Landing page and everything else
    handle {
        reverse_proxy server:3000
    }
}
```

Caddy automatically provisions Let's Encrypt TLS certificates.

## Backups

### Automated PostgreSQL Backups

Add a cron job for daily database backups:

```bash
# Edit crontab
crontab -e

# Add daily backup at 3 AM
0 3 * * * docker exec $(docker ps -qf name=postgres) pg_dump -U discreet discreet | gzip > /backups/discreet-$(date +\%Y\%m\%d).sql.gz

# Retain 30 days of backups
0 4 * * * find /backups -name "discreet-*.sql.gz" -mtime +30 -delete
```

### Restore from Backup

```bash
gunzip -c /backups/discreet-20260316.sql.gz | docker exec -i $(docker ps -qf name=postgres) psql -U discreet discreet
```

### What to Back Up

| Data | Location | Method |
|------|----------|--------|
| Database | PostgreSQL container | `pg_dump` (cron) |
| Uploads | `./uploads/` | rsync or filesystem snapshot |
| Configuration | `.env` | Copy to secure storage |
| TLS certificates | Caddy data volume | Caddy auto-renews; back up for faster recovery |

Redis does not need backup — it contains only ephemeral rate limit counters
and short-lived cache entries that regenerate automatically.

## OpenJarvis (Local AI)

OpenJarvis provides local AI agent capabilities without sending data to
external providers. To enable:

### Docker Compose

Add to your `docker-compose.yml` or `docker-compose.prod.yml`:

```yaml
services:
  openjarvis:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    restart: unless-stopped

volumes:
  ollama_data:
```

### Environment

Add to your `.env`:

```bash
AGENTS_ENABLED=true
AGENT_LLM_ENDPOINT=http://openjarvis:11434/api/generate
```

Or if running outside Docker:

```bash
AGENT_LLM_ENDPOINT=http://localhost:11434/api/generate
```

### Pull a Model

```bash
docker exec -it $(docker ps -qf name=openjarvis) ollama pull llama3.2
```

AI agents will use the local model for all completions. No data leaves
your network. Model responses are encrypted with the channel's MLS group
key before storage — the server cannot read agent responses.

## Updating

```bash
git pull origin main
cd client && npm ci && npm run build && cd ..
cargo build --release

# Apply any new migrations
for f in migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f" 2>/dev/null || true
done

# Restart
systemctl restart discreet  # or: docker compose restart server
```

## Monitoring

The `/health` endpoint returns `OK` when the server is running. Use it
with your monitoring tool of choice:

```bash
curl -f http://localhost:3000/health || echo "Server down"
```

The `/api/v1/info` endpoint returns server version, feature flags, and
database/Redis connectivity status (requires no authentication).
