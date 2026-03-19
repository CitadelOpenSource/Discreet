# Self-Hosting Discreet

Run your own end-to-end encrypted communication server. The server stores only ciphertext — it cannot read your messages, even under legal compulsion.

## Requirements

| Requirement | Minimum |
|-------------|---------|
| CPU | 2 cores |
| RAM | 4 GB |
| Disk | 20 GB SSD |
| OS | Ubuntu 22.04+, Debian 12+, or any Docker-capable Linux |
| Domain | A domain with a DNS A record pointing to your server |

---

## Method 1: Docker Compose (Recommended)

The fastest way to get Discreet running in production.

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
cp .env.example .env
```

Edit `.env` and fill in the required values (see [Environment Variables](#environment-variables) below), then:

```bash
docker compose up -d
```

This starts the Rust backend, PostgreSQL, Redis, and the Vite frontend. Open your domain or `http://localhost:5173` in a browser.

### Generating Secrets

```bash
# JWT signing key (required)
openssl rand -hex 64

# TOTP encryption key (required)
openssl rand -hex 32

# Agent key encryption (required if using AI agents)
openssl rand -hex 32

# PostgreSQL password (required)
openssl rand -hex 32
```

Paste each generated value into the corresponding `.env` variable.

---

## Method 2: Native Build

For maximum control or environments where Docker is not available.

### 1. Install Dependencies

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL 16
sudo apt-get install -y postgresql-16

# Redis 7
sudo apt-get install -y redis-server
```

### 2. Configure Database

```bash
sudo -u postgres createuser discreet
sudo -u postgres createdb discreet -O discreet
sudo -u postgres psql -c "ALTER USER discreet PASSWORD 'your-secure-password';"

# Apply migrations
for f in migrations/*.sql; do
  psql "postgres://discreet:your-secure-password@localhost:5432/discreet" -f "$f"
done
```

### 3. Build and Run

```bash
cp .env.example .env
# Edit .env with your values

# Build frontend
cd client && npm ci && npm run build && cd ..

# Build backend (release mode)
cargo build --release

# Run
./target/release/discreet-server
```

### 4. Configure systemd

Create `/etc/systemd/system/discreet.service`:

```ini
[Unit]
Description=Discreet Server
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=discreet
WorkingDirectory=/opt/discreet
EnvironmentFile=/opt/discreet/.env
ExecStart=/opt/discreet/target/release/discreet-server
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable discreet
sudo systemctl start discreet
```

---

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgres://discreet:password@localhost:5432/discreet` |
| `REDIS_URL` | Yes | Redis connection string | `redis://:password@127.0.0.1:6379` |
| `JWT_SECRET` | Yes | JWT signing key (64 hex bytes) | `openssl rand -hex 64` |
| `TOTP_ENCRYPTION_KEY` | Yes | AES-256-GCM key for TOTP secrets at rest | `openssl rand -hex 32` |
| `AGENT_KEY_SECRET` | Yes (if agents) | Master secret for per-agent API key encryption | `openssl rand -hex 32` |
| `CORS_ORIGINS` | Yes (prod) | Allowed CORS origins, comma-separated | `https://yourdomain.com` |
| `PUBLIC_URL` | Optional | Public-facing URL for emails and metadata | `https://discreetai.net` |
| `APP_URL` | Optional | Frontend URL, used as default CORS origin | `https://app.discreetai.net` |
| `API_URL` | Optional | API base URL for self-hosted instances | `https://api.discreetai.net/api/v1` |
| `SELF_HOSTED` | Optional | If `true`, all users get enterprise tier | `true` |
| `HOST` | Optional | Bind address | `0.0.0.0` |
| `PORT` | Optional | Server port | `3000` |
| `DATABASE_MAX_CONNECTIONS` | Optional | PostgreSQL connection pool size | `20` |
| `JWT_EXPIRY_SECS` | Optional | Access token lifetime in seconds | `900` |
| `REFRESH_EXPIRY_SECS` | Optional | Refresh token lifetime in seconds | `604800` |
| `RATE_LIMIT_PER_MINUTE` | Optional | Global rate limit per IP | `60` |
| `LOG_FORMAT` | Optional | `pretty` (default) or `json` (for SIEM) | `pretty` |
| `RESEND_API_KEY` | Optional | Resend API key for email delivery | `re_xxx` |
| `SMTP_FROM` | Optional | From address for emails | `noreply@yourdomain.com` |
| `TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile public key | `0x...` |
| `TURNSTILE_SECRET_KEY` | Optional | Cloudflare Turnstile secret key | `0x...` |
| `TURN_SECRET` | Optional | HMAC-SHA1 shared secret for TURN credentials | `openssl rand -hex 32` |
| `TURN_URLS` | Optional | Comma-separated TURN server URLs | `turn:turn.example.com:3478` |
| `TURN_TTL` | Optional | TURN credential lifetime in seconds | `86400` |
| `PQ_ENABLED` | Optional | Enable post-quantum key exchange (ML-KEM) | `false` |
| `FEDERATION_ENABLED` | Optional | Enable server federation | `false` |
| `AGENTS_ENABLED` | Optional | Enable AI agent system | `true` |
| `AGENT_LLM_ENDPOINT` | Optional | Default LLM endpoint for agents | `http://localhost:11434/api/generate` |
| `OPENJARVIS_URL` | Optional | OpenJarvis API endpoint | `http://localhost:8000` |

---

## Reverse Proxy: Caddy

Caddy provides automatic HTTPS via Let's Encrypt. Create a `Caddyfile`:

```
yourdomain.com {
    # Security headers
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # API, WebSocket, and webhooks
    handle /api/* {
        reverse_proxy localhost:3000
    }
    handle /ws {
        reverse_proxy localhost:3000
    }
    handle /health {
        reverse_proxy localhost:3000
    }
    handle /webhooks/* {
        reverse_proxy localhost:3000
    }

    # Frontend and everything else
    handle {
        reverse_proxy localhost:3000
    }
}
```

```bash
sudo apt install caddy
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Caddy automatically provisions and renews TLS certificates from Let's Encrypt.

---

## Backup Strategy

### PostgreSQL

Use `pg_dump` with the custom format for efficient, compressed backups:

```bash
# Manual backup
pg_dump --format=custom -U discreet discreet > /backups/discreet-$(date +%Y%m%d).dump

# Restore
pg_restore --clean --if-exists -U discreet -d discreet /backups/discreet-20260319.dump
```

Automate with cron:

```bash
crontab -e

# Daily backup at 3 AM, retain 30 days
0 3 * * * pg_dump --format=custom -U discreet discreet > /backups/discreet-$(date +\%Y\%m\%d).dump
0 4 * * * find /backups -name "discreet-*.dump" -mtime +30 -delete
```

If running PostgreSQL in Docker:

```bash
docker exec $(docker ps -qf name=postgres) pg_dump --format=custom -U discreet discreet > /backups/discreet-$(date +%Y%m%d).dump
```

### Redis

Redis data is ephemeral (rate limit counters, session cache) and regenerates automatically. If you want to preserve it:

```bash
redis-cli SAVE
cp /var/lib/redis/dump.rdb /backups/redis-$(date +%Y%m%d).rdb
```

### Voice Files and Uploads

Voice messages and file uploads are stored on disk. Archive them with tar:

```bash
tar czf /backups/uploads-$(date +%Y%m%d).tar.gz ./uploads/
```

### What to Back Up

| Data | Location | Method | Priority |
|------|----------|--------|----------|
| Database | PostgreSQL | `pg_dump --format=custom` | Critical |
| Configuration | `.env` | Copy to secure, offline storage | Critical |
| Uploads | `./uploads/` | `tar` or rsync | Important |
| Redis | `/var/lib/redis/dump.rdb` | `redis-cli SAVE` + copy | Optional |
| TLS certificates | Caddy data volume | Caddy auto-renews; back up for faster recovery | Optional |

---

## Email (SMTP)

### Resend (Recommended)

[Resend](https://resend.com) provides a simple HTTP API for transactional email.

1. Create an account at resend.com and generate an API key
2. Add your sending domain and verify DNS records (Resend provides the exact records)
3. If using Cloudflare DNS, add the DKIM, SPF, and DMARC records Resend provides
4. Add to `.env`:

```bash
RESEND_API_KEY=re_your_api_key_here
SMTP_FROM=noreply@yourdomain.com
```

Discreet uses email for account verification, password reset, and admin security alerts.

### Postal (Self-Hosted Alternative)

For fully self-hosted email delivery with no third-party dependencies:

1. Deploy [Postal](https://github.com/postalserver/postal) on a separate server or subdomain
2. Configure DNS records (MX, SPF, DKIM, DMARC) for your sending domain
3. Create an SMTP credential in Postal
4. Add to `.env`:

```bash
RESEND_API_KEY=          # Leave empty to disable Resend
SMTP_HOST=postal.yourdomain.com
SMTP_PORT=25
SMTP_USER=your-postal-credential
SMTP_PASS=your-postal-password
SMTP_FROM=noreply@yourdomain.com
```

---

## Monitoring

### Health Endpoint

The `/health` endpoint returns `200 OK` when the server is running and can reach PostgreSQL and Redis. Use it with any uptime monitoring service:

```bash
curl -sf http://localhost:3000/health || echo "Server down"
```

### UptimeRobot or Similar

1. Create a free account at [UptimeRobot](https://uptimerobot.com) (or Uptime Kuma for self-hosted)
2. Add an HTTP monitor pointing to `https://yourdomain.com/health`
3. Set check interval to 5 minutes
4. Configure email or webhook alerts for downtime

### Server Info

The `/api/v1/info` endpoint returns server version, feature flags, and connectivity status (no authentication required). Useful for dashboards.

---

## AI Agents

Discreet supports AI agents that participate as real members in encrypted channels. Each agent holds its own cryptographic keys.

| Provider | Type | Data leaves your network? |
|----------|------|--------------------------|
| OpenJarvis / Ollama | Local | No |
| Anthropic | Cloud | Yes (HTTPS) |
| OpenAI | Cloud | Yes (HTTPS) |
| Google Gemini | Cloud | Yes (HTTPS) |
| Custom endpoint | Configurable | Depends on endpoint |

For local AI setup, add to `.env`:

```bash
AGENTS_ENABLED=true
OPENJARVIS_URL=http://localhost:8000
```

Start local AI services alongside Discreet:

```bash
docker compose --profile openjarvis up -d
docker exec -it $(docker ps -qf name=ollama) ollama pull qwen3:8b
```

Cloud provider API keys are encrypted with AES-256-GCM (HKDF-SHA256, salt `discreet-agent-v1`) before storage. The plaintext key is never written to disk or logged.

---

## Healthcare Deployments

Discreet's end-to-end encryption, audit logging, and data retention policies make it suitable for healthcare environments that require HIPAA compliance.

A Business Associate Agreement (BAA) template is available at [docs/BAA_TEMPLATE.md](BAA_TEMPLATE.md). Consult your legal team before deploying in a regulated environment.

---

## Updating

```bash
git pull origin main

# Rebuild frontend
cd client && npm ci && npm run build && cd ..

# Rebuild backend
cargo build --release

# Apply new migrations (idempotent — safe to re-run)
for f in migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f" 2>/dev/null || true
done

# Restart
sudo systemctl restart discreet
# or: docker compose restart
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `503 Service Unavailable` on all requests | Redis is down or unreachable. Rate limiting is fail-closed. Check `REDIS_URL` and Redis service status. |
| Migrations fail | Ensure PostgreSQL is running and `DATABASE_URL` is correct. Migrations use `IF NOT EXISTS` and are safe to re-run. |
| No emails sent | Check `RESEND_API_KEY` is set and valid. Verify DNS records (SPF, DKIM) for your sending domain. |
| WebSocket disconnects | Ensure your reverse proxy supports WebSocket upgrades. Caddy handles this automatically. |
| CORS errors in browser | Set `CORS_ORIGINS` to your exact domain (e.g., `https://yourdomain.com`). Never use `*` in production. |
