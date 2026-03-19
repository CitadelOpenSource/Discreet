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

## AI Agents

Discreet supports AI agents powered by multiple LLM providers. You can
use cloud providers (OpenAI, Anthropic) or run models locally with zero
data leaving your network.

### Supported Providers

| Provider | Type | API Key | Default Endpoint |
|----------|------|---------|-----------------|
| OpenAI | Cloud | Required | `https://api.openai.com` |
| Anthropic | Cloud | Required | `https://api.anthropic.com` |
| OpenJarvis | Local | Not needed | `http://localhost:8000` |
| Ollama | Local | Not needed | `http://localhost:11434` |
| vLLM | Local | Not needed | `http://localhost:8000` |
| Custom | Any | Optional | User-configured |

### Local AI with Docker Compose (OpenJarvis / Ollama)

The `docker-compose.yml` includes optional services behind the `openjarvis`
profile. These do NOT start with the default `docker compose up`.

**Start local AI services:**

```bash
docker compose --profile openjarvis up -d
```

This starts:
- **Ollama** on port 11434 — runs local LLM models on your hardware (GPU supported)
- **OpenJarvis API** on port 8000 — OpenAI-compatible proxy for Ollama

**Pull a model:**

```bash
docker exec -it $(docker ps -qf name=ollama) ollama pull qwen3:8b
```

Popular models: `qwen3:8b` (fast, multilingual), `llama3` (Meta), `mistral` (7B),
`codellama` (code), `phi3` (Microsoft, small), `gemma2` (Google).

**Configure in Discreet:**

1. Go to your server's **Settings → AI Bots** or **Settings → Agents**
2. Add a new agent with:
   - **Provider:** OpenJarvis (Local) or Ollama (Local)
   - **Endpoint:** `http://localhost:8000` (OpenJarvis) or `http://localhost:11434` (Ollama)
   - **Model:** the model you pulled (e.g., `qwen3:8b`)
3. No API key is needed for local models

**Environment variables** (add to `.env`):

```bash
AGENTS_ENABLED=true
OPENJARVIS_URL=http://localhost:8000
```

If running the Discreet server inside Docker alongside OpenJarvis, use the
Docker network hostnames instead:

```bash
OPENJARVIS_URL=http://openjarvis-server:8000
```

### Cloud Providers (OpenAI / Anthropic)

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys) or
   [Anthropic](https://console.anthropic.com/)
2. In server settings, add an agent with the cloud provider
3. Enter your API key — it is encrypted with AES-256-GCM before storage
   (HKDF-SHA256, salt `discreet-agent-v1`)
4. The plaintext key is never stored on disk or logged

### Privacy Guarantee

All agent responses are encrypted with the channel's MLS group key before
storage. The server cannot read agent responses. When using local providers
(OpenJarvis, Ollama, vLLM), no data leaves your network at any point.

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
