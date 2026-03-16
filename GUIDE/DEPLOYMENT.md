# Deployment Guide

Deploy your own Discreet instance. Zero-knowledge architecture means even you (the host) cannot read encrypted messages.

## Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Storage | 10 GB | 50 GB |
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 |
| Docker | 24.0+ | Latest |

Discreet runs on x86_64 and ARM64 (Raspberry Pi 4/5, Oracle Cloud Ampere).

---

## Quick Deploy (Docker Compose)

On any Linux server:

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
cp .env.example .env              # Edit with your domain and secrets
docker compose up -d               # Starts Postgres, Redis, and Discreet server
```

Generate a secure JWT secret: `openssl rand -hex 64`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| DATABASE_URL | postgres://citadel:citadel@localhost/citadel | PostgreSQL connection |
| REDIS_URL | redis://127.0.0.1:6379 | Redis connection |
| JWT_SECRET | (generate) | 64+ char random string |
| BIND_ADDR | 0.0.0.0:3000 | Listen address |
| CORS_ORIGINS | (your domain) | Allowed CORS origins |
| SMTP_HOST | (optional) | Email verification (Resend, SendGrid, etc.) |
| SMTP_FROM | (optional) | From address for emails |

---

## Oracle Cloud Free Tier

Oracle offers an always-free ARM instance (4 OCPU, 24GB RAM) — ideal for Discreet.

### 1. VCN Setup

The Always Free tier wizard may not be available. Create networking manually:

1. **Create VCN:** Networking > Virtual Cloud Networks > Create VCN. Name: `discreet-vcn`, CIDR: `10.0.0.0/16`
2. **Create Internet Gateway:** Inside VCN > Internet Gateways. Name: `discreet-igw`
3. **Add Route Rule:** Route Tables > Default. Destination: `0.0.0.0/0`, Target: `discreet-igw`
4. **Create Public Subnet:** Subnets > Create. Name: `discreet-public`, CIDR: `10.0.0.0/24`, Type: Public
5. **Security List Ingress Rules:**

| Source CIDR | Protocol | Dest Port | Description |
|-------------|----------|-----------|-------------|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 80 | HTTP |
| `0.0.0.0/0` | TCP | 443 | HTTPS |

### 2. Create VM Instance

1. Compute > Instances > Create Instance
2. Image: Ubuntu 22.04 (or 24.04)
3. Shape: Ampere A1.Flex (4 OCPU, 24GB RAM — free tier)
4. Networking: Select `discreet-vcn` and `discreet-public` subnet
5. Add your SSH public key
6. Under Advanced > Cloud-init script, paste:

```bash
#!/bin/bash
set -e
apt-get update && apt-get upgrade -y
apt-get install -y build-essential pkg-config libssl-dev \
  docker.io docker-compose-plugin git curl

systemctl enable docker && systemctl start docker

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Caddy for automatic HTTPS
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

### 3. Open VM Firewall

Oracle VMs have iptables rules that block traffic even after security list changes:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

### 4. SSH In and Deploy

```bash
ssh ubuntu@<YOUR_VM_PUBLIC_IP>

git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

docker compose up -d

for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel
done

cd client && npm install && npm run build && cd ..
cargo build --release
```

### 5. Environment Configuration

Create `/home/ubuntu/Discreet/.env`:

```bash
DATABASE_URL=postgres://citadel:citadel@localhost:5432/citadel
REDIS_URL=redis://localhost:6379
JWT_SECRET=<run: openssl rand -hex 64>
CORS_ORIGINS=https://yourdomain.com
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=<your Resend API key>
SMTP_FROM=noreply@yourdomain.com
```

### 6. Systemd Service

Create `/etc/systemd/system/discreet.service`:

```ini
[Unit]
Description=Discreet Server
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Discreet
EnvironmentFile=/home/ubuntu/Discreet/.env
ExecStart=/home/ubuntu/Discreet/target/release/discreet
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable discreet
sudo systemctl start discreet
```

### 7. HTTPS with Caddy

Create `/etc/caddy/Caddyfile`:

```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

Caddy automatically obtains and renews Let's Encrypt certificates.

#### Alternative: Nginx + Certbot

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

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

Get SSL: `certbot --nginx -d yourdomain.com`

### 8. DNS

Point your domain's A record to your VM's public IP. If using Cloudflare, set to "DNS only" (grey cloud) so Caddy can obtain certificates directly.

### 9. Email Setup (Resend)

1. Sign up at [resend.com](https://resend.com) (free — 3,000 emails/month)
2. Add and verify your domain (add the DNS records Resend provides)
3. Create an API key
4. Set `SMTP_PASSWORD` in your `.env` to the API key
5. Restart: `sudo systemctl restart discreet`

Discreet sends email verification, password reset links, and optional server invites. Message content is never sent via email.

---

## Raspberry Pi

Discreet runs on Raspberry Pi 4/5 (4GB+ RAM recommended). See [DEPLOY_RASPBERRY_PI.md](../DEPLOY_RASPBERRY_PI.md) for Pi-specific setup and optimizations.

---

## Verify

```bash
curl https://yourdomain.com/health
# {"status":"ok","postgres":"connected","redis":"connected"}
```

## Maintenance

```bash
# View logs
sudo journalctl -u discreet -f

# Update
cd /home/ubuntu/Discreet
git pull
cd client && npm run build && cd ..
cargo build --release
sudo systemctl restart discreet
```

## Backup

```bash
# Database backup
docker compose exec postgres pg_dump -U citadel citadel > backup_$(date +%Y%m%d).sql

# Restore
cat backup_20260307.sql | docker compose exec -T postgres psql -U citadel -d citadel
```

## Security Considerations

- Change `JWT_SECRET` from default before deploying
- Use SSL/TLS in production (Let's Encrypt via Caddy or Certbot)
- Keep Docker and OS updated
- The server is zero-knowledge — encrypted messages are opaque blobs
- File uploads stored on disk — consider encrypted filesystem (LUKS)
- Enable 2FA for admin accounts
- See [SECURITY.md](../SECURITY.md) for full security architecture
