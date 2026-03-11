# Citadel Deployment — Oracle Cloud Free Tier

## Quick Deploy (One Command)

After creating your Oracle Cloud instance and SSH-ing in:
```bash
git clone https://github.com/CitadelOpenSource/Discreet.git && cd Discreet
DOMAIN=your.domain.com ./scripts/deploy.sh
```
This handles Docker, secrets, build, migrations, and HTTPS automatically.
For manual setup, continue below.

---

## What You Get (Free Forever)

Oracle Cloud Free Tier includes:
- **2x AMD VM** (1 OCPU, 1 GB RAM each) — or **1x ARM VM** (4 OCPU, 24 GB RAM)
- **200 GB** block storage
- **10 TB/month** egress bandwidth
- **2x Autonomous DB** (20 GB each — we'll use this for Postgres-compatible)

The ARM instance is insanely powerful for free. That's what we'll use.

---

## Step-by-Step

### 1. Sign Up + Create Instance

1. Go to https://cloud.oracle.com/free
2. Sign up (credit card required but never charged for Always Free resources)
3. Region: Choose the nearest (e.g., `us-ashburn-1`)
4. Navigate: **Compute → Instances → Create Instance**
5. Configure:
   - **Name**: `citadel-alpha`
   - **Image**: Ubuntu 22.04 (or 24.04)
   - **Shape**: Ampere A1 (ARM) — select 2 OCPU, 12 GB RAM (free tier allows up to 4/24)
   - **Boot volume**: 100 GB
   - **SSH key**: Upload your public key (or generate one)
   - **Networking**: Create VCN with public subnet, assign public IP

6. Click **Create** and wait ~2 minutes

### 2. Configure Firewall (Security List)

OCI uses Security Lists (not just iptables). You need to open ports:

1. **VCN → Security Lists → Default Security List**
2. Add **Ingress Rules**:

| Source CIDR | Protocol | Dest Port | Description |
|-------------|----------|-----------|-------------|
| 0.0.0.0/0 | TCP | 80 | HTTP |
| 0.0.0.0/0 | TCP | 443 | HTTPS |
| 0.0.0.0/0 | TCP | 22 | SSH |

3. Save

4. Also open ports in the VM's iptables:
```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

### 3. SSH In + Install Dependencies

```bash
ssh -i ~/.ssh/citadel_key ubuntu@<PUBLIC_IP>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

# Install system deps
sudo apt install -y \
  build-essential pkg-config libssl-dev \
  postgresql postgresql-contrib redis-server \
  nginx certbot python3-certbot-nginx git

# Start and enable services
sudo systemctl enable --now postgresql redis-server nginx
```

### 4. Configure PostgreSQL

```bash
# Create citadel user and database
sudo -u postgres psql -c "CREATE USER citadel WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE citadel OWNER citadel;"

# Allow local password auth
sudo sed -i 's/local   all             all                                     peer/local   all             all                                     md5/' /etc/postgresql/*/main/pg_hba.conf
sudo systemctl restart postgresql

# Test connection
psql -U citadel -d citadel -c "SELECT 1;"
```

### 5. Clone + Build Citadel

```bash
cd ~
git clone https://github.com/YOUR_USER/citadel.git
cd citadel

# Apply schema
psql -U citadel -d citadel < migrations/001_schema.sql

# Create .env
cat > .env << 'EOF'
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgres://citadel:CHANGE_ME_STRONG_PASSWORD@localhost:5432/citadel
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -hex 64)
AGENTS_ENABLED=true
PQ_ENABLED=false
FEDERATION_ENABLED=false
EOF

# Generate actual JWT secret
JWT=$(openssl rand -hex 64)
sed -i "s/\$(openssl rand -hex 64)/$JWT/" .env

# Export for sqlx compile-time checks
export DATABASE_URL=postgres://citadel:CHANGE_ME_STRONG_PASSWORD@localhost:5432/citadel

# Build (release mode — this takes 5-10 min on ARM)
cargo build --release
```

### 6. Create Systemd Service

```bash
sudo tee /etc/systemd/system/citadel.service > /dev/null << 'EOF'
[Unit]
Description=Citadel Server
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/citadel
EnvironmentFile=/home/ubuntu/citadel/.env
ExecStart=/home/ubuntu/citadel/target/release/citadel-server
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/ubuntu/citadel

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now citadel

# Verify it's running
curl http://localhost:3000/health
# Should return: OK
```

### 7. Set Up Domain + TLS

Point your domain's DNS A record to the OCI public IP:
```
alpha.citadel.rs  →  A  →  <PUBLIC_IP>
```

Configure Nginx as reverse proxy:

```bash
sudo tee /etc/nginx/sites-available/citadel > /dev/null << 'EOF'
server {
    listen 80;
    server_name alpha.citadel.rs;

    # API + WebSocket proxy
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/citadel /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Get TLS cert (free, auto-renewing)
sudo certbot --nginx -d alpha.citadel.rs --non-interactive --agree-tos -m your@email.com
```

### 8. Verify

```bash
# Health check
curl https://alpha.citadel.rs/health
# → OK

# Register
curl -X POST https://alpha.citadel.rs/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"MySecurePassword123!"}'

# Run the full smoke test
./scripts/smoke_test.sh https://alpha.citadel.rs
```

---

## Updating

```bash
cd ~/citadel
git pull
cargo build --release
sudo systemctl restart citadel
```

## Monitoring

```bash
# Logs
sudo journalctl -u citadel -f

# Status
sudo systemctl status citadel

# DB size
psql -U citadel -d citadel -c "SELECT pg_size_pretty(pg_database_size('citadel'));"
```

## Cost: $0.00/month

Everything above runs on Oracle Cloud Always Free tier.
The ARM A1 instance with 2 OCPU + 12 GB RAM will comfortably handle
hundreds of concurrent users for an alpha.

---

## What to Post on Hacker News

Title: **Show HN: Citadel – Open-source encrypted alternative with Signal-level E2EE**

Body:
```
Live demo: https://alpha.citadel.rs
GitHub: https://github.com/YOUR_USER/citadel

Citadel is a zero-knowledge community platform. The server literally cannot
read your messages — it stores only MLS ciphertext blobs.

- Community UX: servers, channels, invites, roles
- Signal-like crypto: MLS (RFC 9420), AES-256-GCM, Argon2id
- Post-quantum ready: ML-KEM + ML-DSA key types defined
- AI agents that join E2EE channels as MLS group members
- Self-hostable, AGPL-3.0, written in Rust

Built because competing platforms had data breaches and mandatory age verification,
and no existing tool combines Community UX + Signal-grade crypto + open source + self-hosting.

Stack: Rust/Axum, PostgreSQL, Redis, WebSocket, Web Crypto API

Looking for contributors, especially on:
- MLS/OpenMLS integration
- Tauri desktop client
- React Native mobile client
```

---

## SMTP Email Setup (Required for Email Verification + Password Reset)

### Recommended: Resend.com (Free Tier — 3,000 emails/month)

1. Sign up at https://resend.com (free, no credit card)
2. Add your domain and verify DNS records (SPF, DKIM, DMARC)
3. Get your API key from the dashboard

Add to your `.env` on the Oracle instance:
```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_YOUR_API_KEY_HERE
SMTP_FROM=noreply@yourdomain.com
```

### Alternative: Mailtrap.io (Free Tier — 1,000 emails/month)

1. Sign up at https://mailtrap.io
2. Go to Email Sending → Sending Domains → Add your domain
3. Get SMTP credentials from the integration tab

```bash
SMTP_HOST=live.smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=api
SMTP_PASS=YOUR_API_TOKEN
SMTP_FROM=noreply@yourdomain.com
```

### What Discreet Sends via Email

- **Email verification** — confirm account ownership
- **Password reset** — one-time reset links (expire in 15 minutes)
- **Server invites** — optional, users can share invite codes instead

**Security note:** Discreet NEVER sends message content via email. Emails contain only verification codes, reset links, and invite URLs. All message content stays E2EE within the app.

### Future: Self-Hosted (Stalwart Mail Server)

When budget allows, replace the external SMTP with Stalwart — a Rust-based, AGPL-licensed mail server that runs on the same Oracle instance:
```bash
# Stalwart is written in Rust like Discreet — same ecosystem
docker run -d --name stalwart -p 25:25 -p 465:465 stalwartlabs/mail-server
```
