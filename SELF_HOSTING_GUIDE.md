# Self-Hosting Guide

> **⚠️ For the latest Oracle Cloud deployment guide, see [`LAUNCH_NOW.md`](LAUNCH_NOW.md) → Step 4.**

Deploy your own Discreet instance with full control over your data. Zero-knowledge architecture means even you (the host) cannot read encrypted messages.

## Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Storage | 10 GB | 50 GB |
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 |
| Docker | 24.0+ | Latest |

Discreet runs on x86_64 and ARM64 (Raspberry Pi 4/5, Oracle Cloud Ampere).

## Quick Deploy (Docker Compose)

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
cp .env.example .env          # Edit with your domain and secrets
docker compose up -d           # Starts Postgres, Redis, and Discreet server
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| DATABASE_URL | postgres://citadel:citadel@localhost/citadel | PostgreSQL connection |
| REDIS_URL | redis://127.0.0.1:6379 | Redis connection |
| JWT_SECRET | (generate) | 64+ char random string |
| BIND_ADDR | 0.0.0.0:3000 | Listen address |
| SMTP_HOST | (optional) | Email verification (Resend, SendGrid, etc.) |
| SMTP_FROM | (optional) | From address for emails |

Generate a secure JWT secret: `openssl rand -hex 64`

## Reverse Proxy (Nginx + SSL)

```nginx
server {
    listen 443 ssl http2;
    server_name discreet.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/discreet.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/discreet.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;  # WebSocket keepalive
    }
}
```

Get SSL: `certbot --nginx -d discreet.yourdomain.com`

## Oracle Cloud Free Tier

Oracle offers an always-free ARM instance (4 OCPU, 24GB RAM) — ideal for Discreet:

1. Create account at cloud.oracle.com
2. Create a "VM.Standard.A1.Flex" instance (ARM, Ubuntu 22.04)
3. Open ports 80, 443 in the security list
4. SSH in, install Docker, clone repo, deploy
5. See `docs/DEPLOY_ORACLE.md` for detailed steps

## Raspberry Pi

Discreet runs on Raspberry Pi 4/5 (4GB+ RAM recommended):

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Deploy
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet && docker compose up -d
```

For Pi-specific optimizations, see `DEPLOY_RASPBERRY_PI.md`.

## Updating

```bash
cd Discreet
git pull
docker compose down
docker compose up -d --build
```

New migrations are applied automatically on startup.

## Backup

```bash
# Database backup
docker compose exec postgres pg_dump -U citadel citadel > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20260307.sql | docker compose exec -T postgres psql -U citadel -d citadel
```

## Security Considerations

- Change `JWT_SECRET` from default before deploying
- Use SSL/TLS in production (Let's Encrypt is free)
- Keep Docker and OS updated
- The server is zero-knowledge — encrypted messages are opaque blobs
- File uploads stored on disk — consider encrypted filesystem (LUKS)
- Enable 2FA for admin accounts
- Review `SECURITY.md` for full security architecture

## Monitoring

The `/health` endpoint returns server status:
```bash
curl https://discreet.yourdomain.com/health
# {"status":"ok","postgres":"connected","redis":"connected","uptime":86400}
```

The admin dashboard (available to server owners) shows real-time metrics at `/next/` when logged in as admin.

## Raspberry Pi as Proximity Relay Node (Coming Soon)

A Raspberry Pi can serve double duty: host a Discreet server AND act as a BLE mesh relay node that extends proximity messaging range for nearby mobile users.

### Hardware
| Component | Cost | Purpose |
|-----------|------|---------|
| Raspberry Pi 4/5 (4GB) | $35-55 | Server + BLE relay |
| Pi Zero 2W | $15 | Relay-only (no server) |
| Solar panel (6W) | $10 | Outdoor autonomous power |
| Battery pack (10000mAh) | $5-15 | Overnight operation |
| Weatherproof case | $10 | Outdoor deployment |

### Relay Node Architecture
```
Mobile A ←(BLE 100m)→ [Pi Relay] ←(BLE 100m)→ Mobile B
                          ↑
                    Zero-knowledge
                 (encrypted passthrough)
```

The relay receives encrypted BLE advertisements and retransmits them. It cannot read message contents due to end-to-end encryption. Total extended range: ~300m with one relay, ~500m with two relays in chain.

### Setup (when available)
```bash
# Install relay daemon
docker pull discreet/relay:latest
docker run -d --privileged --net=host discreet/relay

# Or native install
sudo apt install bluez
./discreet-relay --ble-relay --power high
```

The `--privileged` flag is required for Bluetooth hardware access. `--net=host` enables BLE advertising on the host's Bluetooth adapter.
