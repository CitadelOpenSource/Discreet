# Deployment Guide

Deploy Discreet to Oracle Cloud (free tier) with Cloudflare DNS and Resend email.

## Overview

- **Compute:** Oracle Cloud Always Free VM (ARM64, 4 OCPU, 24GB RAM)
- **Domain:** discreetai.net via Cloudflare
- **HTTPS:** Caddy (automatic Let's Encrypt)
- **Email:** Resend SMTP for transactional email

---

## 1. Oracle Cloud VCN Setup

The Always Free tier wizard may not be available. Create networking manually:

### Create VCN

1. Go to **Networking > Virtual Cloud Networks > Create VCN**
2. Name: `discreet-vcn`
3. CIDR block: `10.0.0.0/16`

### Create Internet Gateway

1. Inside your VCN, go to **Internet Gateways > Create Internet Gateway**
2. Name: `discreet-igw`

### Add Route Rule

1. Go to **Route Tables > Default Route Table**
2. Add route rule:
   - Destination: `0.0.0.0/0`
   - Target type: Internet Gateway
   - Target: `discreet-igw`

### Create Public Subnet

1. Go to **Subnets > Create Subnet**
2. Name: `discreet-public`
3. CIDR block: `10.0.0.0/24`
4. Subnet type: Public
5. Route table: Default (with the internet gateway rule)

### Add Security List Rules

1. Go to **Security Lists > Default Security List**
2. Add **Ingress Rules**:

| Source CIDR | Protocol | Dest Port | Description |
|-------------|----------|-----------|-------------|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 80 | HTTP |
| `0.0.0.0/0` | TCP | 443 | HTTPS |

---

## 2. Create VM Instance

1. Go to **Compute > Instances > Create Instance**
2. Image: Ubuntu 22.04 (or 24.04)
3. Shape: Ampere A1.Flex (4 OCPU, 24GB RAM — free tier)
4. Networking: Select `discreet-vcn` and `discreet-public` subnet
5. Add your SSH public key
6. Under **Advanced > Cloud-init script**, paste:

```bash
#!/bin/bash
set -e

# System packages
apt-get update && apt-get upgrade -y
apt-get install -y build-essential pkg-config libssl-dev \
  docker.io docker-compose-plugin git curl

# Enable Docker
systemctl enable docker && systemctl start docker

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install Caddy
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

---

## 3. SSH In and Deploy

```bash
ssh ubuntu@<YOUR_VM_PUBLIC_IP>

# Clone and build
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# Start databases
docker compose up -d

# Apply migrations
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel
done

# Build client
cd client-next && npm install && npm run build && cd ..

# Build server (release mode)
cargo build --release
```

---

## 4. Environment Configuration

Create `/home/ubuntu/Discreet/.env`:

```bash
DATABASE_URL=postgres://citadel:citadel@localhost:5432/citadel
REDIS_URL=redis://localhost:6379
JWT_SECRET=<run: openssl rand -hex 64>
CORS_ORIGINS=https://discreetai.net
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=<your Resend API key>
SMTP_FROM=noreply@discreetai.net
```

---

## 5. Systemd Service

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

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable discreet
sudo systemctl start discreet
```

---

## 6. Caddy HTTPS

Create `/etc/caddy/Caddyfile`:

```
discreetai.net {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

Caddy automatically obtains and renews Let's Encrypt certificates.

---

## 7. Cloudflare DNS

1. Add your domain `discreetai.net` to Cloudflare
2. Update nameservers at your registrar to Cloudflare's
3. Add DNS records:

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `@` | `<VM_PUBLIC_IP>` | DNS only (grey cloud) |
| A | `www` | `<VM_PUBLIC_IP>` | DNS only (grey cloud) |

Use "DNS only" (not proxied) so Caddy can obtain certificates directly.

---

## 8. Resend Email Setup

1. Sign up at [resend.com](https://resend.com)
2. Add and verify domain `discreetai.net` (add the DNS records Resend provides)
3. Create an API key
4. Set `SMTP_PASSWORD` in your `.env` to the API key
5. Restart the service: `sudo systemctl restart discreet`

---

## Verify

```bash
curl https://discreetai.net/health
```

## Maintenance

```bash
# View logs
sudo journalctl -u discreet -f

# Update
cd /home/ubuntu/Discreet
git pull
cd client-next && npm run build && cd ..
cargo build --release
sudo systemctl restart discreet
```
