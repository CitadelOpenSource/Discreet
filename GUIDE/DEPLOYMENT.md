# Production Deployment Guide

Deploy your own Discreet instance. The server stores only ciphertext — even you (the host) cannot read encrypted messages.

## 1. Prerequisites

| Resource | Minimum |
|----------|---------|
| CPU | 2 cores |
| RAM | 4 GB |
| Disk | 20 GB SSD |
| OS | Ubuntu 22.04+ or Debian 12+ |

You also need:
- A **domain** with DNS control (Cloudflare recommended)
- A **Cloudflare account** (free tier) for DNS and SSL
- A **Resend account** (free tier) for email verification — https://resend.com

## 2. Server Setup

SSH into your server and install dependencies:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Caddy (reverse proxy with automatic HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Build tools
sudo apt install -y build-essential pkg-config libssl-dev
```

## 3. Clone and Configure

```bash
cd /opt
sudo git clone https://github.com/CitadelOpenSource/Discreet.git discreet
sudo chown -R $USER:$USER /opt/discreet
cd /opt/discreet

# Generate production secrets (interactive — prompts for domain and Resend key)
./scripts/generate-secrets.sh
```

The script creates `.env` and `docker-compose.override.yml` with generated credentials, URLs, TURN configuration, and Cloudflare Turnstile placeholder.

Review `.env` and verify these critical fields:

```bash
DATABASE_URL=postgres://discreet:<generated>@localhost:5432/discreet
REDIS_URL=redis://:<generated>@127.0.0.1:6379
JWT_SECRET=<generated-128-char-hex>
RESEND_API_KEY=<your-resend-api-key>
SMTP_FROM=noreply@<YOUR_DOMAIN>
APP_URL=https://<YOUR_DOMAIN>
API_URL=https://api.<YOUR_DOMAIN>
ALLOWED_ORIGINS=https://<YOUR_DOMAIN>
```

## 4. Build

```bash
cd /opt/discreet

# Start PostgreSQL and Redis
docker compose up -d

# Wait for Postgres to be ready
sleep 5

# Apply all database migrations
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U discreet -d discreet
done

# Generate SQLx offline cache
cargo sqlx prepare

# Build the backend (release mode, ~5-10 minutes first time)
cargo build --release

# Build the frontend
cd client && npm install && npm run build && cd ..
```

## 5. Caddy and Systemd

### Caddyfile

Copy the production Caddyfile:

```bash
sudo cp docs/Caddyfile.production /etc/caddy/Caddyfile
```

Edit it — replace `<YOUR_DOMAIN>` with your actual domain:

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

### Systemd service

```bash
sudo cp docs/discreet.service /etc/systemd/system/discreet.service
sudo systemctl daemon-reload
sudo systemctl enable --now discreet
```

Verify it's running:

```bash
sudo systemctl status discreet
curl http://localhost:3000/health
```

Restart Caddy:

```bash
sudo systemctl restart caddy
```

## 6. Email

Discreet uses the Resend HTTP API for email verification and password resets. No SMTP relay is needed.

1. Create a free account at https://resend.com
2. Add your domain and configure the DNS records Resend provides (SPF, DKIM, DMARC)
3. Create an API key
4. Set in `.env`:

```bash
RESEND_API_KEY=<your-resend-api-key>
SMTP_FROM=noreply@<YOUR_DOMAIN>
```

5. Restart: `sudo systemctl restart discreet`

## 7. DNS (Cloudflare)

Create these DNS records in your Cloudflare dashboard:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `@` | `<YOUR_SERVER_IP>` | Proxied (orange) |
| A | `api` | `<YOUR_SERVER_IP>` | Proxied (orange) |
| A | `turn` | `<YOUR_SERVER_IP>` | **DNS only (gray)** |

**Important:** The `turn` subdomain must be DNS-only (gray cloud). Cloudflare does not proxy UDP traffic, and TURN requires direct UDP connectivity.

In Cloudflare SSL/TLS settings, set encryption mode to **Full (Strict)**.

## 8. TURN Server (optional)

TURN relay allows voice and video calls to work behind restrictive NATs. Without it, ~10-15% of users cannot connect peer-to-peer.

See **[docs/TURN_SETUP.md](../docs/TURN_SETUP.md)** for step-by-step coturn installation.

Quick summary — add to `.env`:

```bash
TURN_SECRET=<generated-by-setup-script>
TURN_HOST=turn.<YOUR_DOMAIN>
```

The secret must match `static-auth-secret` in your coturn config.

## 9. Verification Checklist

After deployment, verify each component:

```bash
# Backend health
curl https://api.<YOUR_DOMAIN>/health
# Should return: OK

# Frontend loads
curl -s https://<YOUR_DOMAIN> | head -5
# Should return HTML

# Registration works
# Open https://<YOUR_DOMAIN> in a browser, create an account

# Make yourself admin
docker compose exec -T postgres psql -U discreet -d discreet \
  -c "UPDATE users SET account_tier = 'admin', platform_role = 'admin' WHERE username = '<YOUR_USERNAME>';"
sudo systemctl restart discreet

# Voice/video (if TURN configured)
# Start a voice channel call between two browsers
```

## 10. Updating

```bash
cd /opt/discreet
git pull

# Apply new migrations
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

## 11. Troubleshooting

**Caddy fails to get certificate:**
Ensure ports 80 and 443 are open in your firewall and cloud provider security group. Caddy needs both for the ACME challenge.

**502 Bad Gateway:**
The backend isn't running. Check `sudo systemctl status discreet` and `journalctl -u discreet -f` for errors.

**CORS errors in browser:**
`ALLOWED_ORIGINS` in `.env` must exactly match your domain including `https://` and no trailing slash.

**Migrations fail with "relation already exists":**
Safe to ignore — migrations use `IF NOT EXISTS`.

**"sqlx: no DATABASE_URL" during build:**
Run `cargo sqlx prepare` first, or ensure `DATABASE_URL` is set in the environment.

**Voice calls fail:**
Install coturn (see section 8). Without TURN, users behind symmetric NATs cannot connect.

**WebSocket disconnects immediately:**
Check that Caddy is forwarding WebSocket upgrades (it does by default). Verify `ALLOWED_ORIGINS` includes your exact domain.

**High memory usage:**
Set `MemoryMax=2G` in the systemd unit (already configured in `docs/discreet.service`). Reduce `DATABASE_MAX_CONNECTIONS` in `.env` if needed.

---

For daily backup configuration and disaster recovery, see **[docs/DISASTER_RECOVERY.md](../docs/DISASTER_RECOVERY.md)**.
