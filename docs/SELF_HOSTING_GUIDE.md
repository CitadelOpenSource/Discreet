# Discreet — Self-Hosting Guide

> **Run your own private, encrypted communication server.**
> One command. Your data. Your rules. No phone number required.

---

## What You're Getting

Discreet is an end-to-end encrypted messaging platform. When you self-host it, you run the entire server on your own hardware. Nobody — not even us — can read your messages. The server stores encrypted blobs it cannot decrypt.

This guide will walk you through setting up your own Discreet instance. No prior server experience is required. We'll explain every step.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Quick Start (One Command)](#2-quick-start)
3. [What the Setup Script Does](#3-what-the-setup-script-does)
4. [Platform-Specific Instructions](#4-platform-specific-instructions)
   - [Linux (Ubuntu/Debian)](#linux-ubuntudebian)
   - [Linux (Fedora/RHEL)](#linux-fedorarhel)
   - [Windows](#windows)
   - [macOS](#macos)
5. [Accessing Your Instance](#5-accessing-your-instance)
6. [Adding HTTPS (Production)](#6-adding-https-production)
7. [Email Verification Setup](#7-email-verification-setup)
8. [Configuration Reference](#8-configuration-reference)
9. [Updating](#9-updating)
10. [Backup and Restore](#10-backup-and-restore)
11. [Troubleshooting](#11-troubleshooting)
12. [FAQ](#12-faq)

---

## 1. Prerequisites

You need four things installed on your machine before running Discreet. If you don't have them, follow the platform-specific instructions in Section 4 first.

| Tool | What It Does | Minimum Version |
|------|-------------|-----------------|
| **Docker** | Runs the database (PostgreSQL) and cache (Redis) in containers so you don't have to install them manually | Docker 20+ |
| **Node.js** | Builds the web interface (the part you see in your browser) | Node.js 20+ |
| **Rust** | Builds the server (the part that handles encryption, authentication, and message routing) | Rust 1.75+ |
| **Git** | Downloads the source code from GitHub | Any recent version |

**How to check if you have them:**

Open a terminal (Command Prompt on Windows, Terminal on Mac/Linux) and type:

```bash
docker --version
node --version
cargo --version
git --version
```

If any command says "not found" or "not recognized", you need to install that tool. See Section 4 for your operating system.

---

## 2. Quick Start

If you already have all four prerequisites installed, this is all you need:

```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
./scripts/setup.sh
```

That's it. The script handles everything:
- Generates unique cryptographic secrets for your instance
- Starts the database and cache
- Creates all database tables
- Builds the web interface
- Builds the server
- Starts everything

When it finishes, you'll see:

```
═══════════════════════════════════════════════════
  ✅ Discreet is ready!
  
  Open your browser to: http://localhost:3000
  
  Create your first account to get started.
  The first account you create will be a regular user.
  To make yourself an admin, see the docs.
═══════════════════════════════════════════════════
```

Open your browser, go to `http://localhost:3000`, and create an account.

---

## 3. What the Setup Script Does

You don't need to understand this to use Discreet, but if you're curious (or if something goes wrong), here's what `setup.sh` does step by step:

**Step 1 — Checks prerequisites.**
It verifies Docker, Node.js, Rust, and Git are installed. If anything is missing, it tells you exactly what to install and exits.

**Step 2 — Generates secrets.**
Every Discreet instance needs its own unique cryptographic keys. The script uses `openssl rand` to generate:
- A database password (48 random characters)
- A JWT signing key (128 random characters) — this signs your login tokens
- An agent encryption key (64 random characters) — this encrypts AI bot API keys
- A TOTP encryption key (64 random characters) — this encrypts two-factor auth secrets
- A Redis password (48 random characters)

These are saved to a `.env` file that is **never uploaded to GitHub** (it's in `.gitignore`).

**Step 3 — Starts Docker containers.**
Two containers start: PostgreSQL (the database) and Redis (the cache). They run in the background.

**Step 4 — Waits for the database.**
The script waits up to 30 seconds for PostgreSQL to be ready to accept connections. If it takes longer, something is wrong with Docker.

**Step 5 — Creates database tables.**
Discreet has 48+ migration files that create all the tables needed: users, servers, channels, messages, encryption keys, and more. The script runs them all in order.

**Step 6 — Builds the web interface.**
The script runs `npm ci` (installs JavaScript dependencies) and `npm run build` (compiles the React frontend into static files the server can serve).

**Step 7 — Builds the server.**
The script runs `cargo build --release` which compiles the Rust server. This takes 15-20 minutes the first time on most machines. Subsequent builds are much faster (3-5 minutes).

**Step 8 — Starts the server.**
The compiled server starts and listens on port 3000.

---

## 4. Platform-Specific Instructions

### Linux (Ubuntu/Debian)

This covers Ubuntu 22.04+, Debian 12+, Linux Mint, Pop!_OS, and similar distributions.

**Install Docker:**
```bash
# Update package list
sudo apt update

# Install Docker
sudo apt install -y docker.io docker-compose-v2

# Allow your user to run Docker without sudo
sudo usermod -aG docker $USER

# IMPORTANT: Log out and log back in for the group change to take effect
# Or run: newgrp docker
```

**Install Node.js 20:**
```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js
sudo apt install -y nodejs

# Verify
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x
```

**Install Rust:**
```bash
# Download and run the Rust installer
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Press 1 when prompted for the default installation

# Add Rust to your current shell session
source ~/.cargo/env

# Verify
rustc --version   # Should show 1.75+
cargo --version
```

**Install Git and build tools:**
```bash
sudo apt install -y git build-essential pkg-config libssl-dev
```

**Now run the quick start:**
```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
./scripts/setup.sh
```

---

### Linux (Fedora/RHEL)

This covers Fedora 38+, RHEL 9+, CentOS Stream 9+, Rocky Linux 9+.

**Install Docker:**
```bash
# Install Docker
sudo dnf install -y docker docker-compose

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Allow your user to run Docker without sudo
sudo usermod -aG docker $USER

# Log out and back in, or run: newgrp docker
```

**Install Node.js 20:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

**Install Rust:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

**Install build tools:**
```bash
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y openssl-devel pkg-config
```

**Now run the quick start:**
```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
./scripts/setup.sh
```

---

### Windows

**Option A — Windows Subsystem for Linux (Recommended):**

WSL gives you a real Linux environment inside Windows. This is the easiest path.

1. Open PowerShell as Administrator and run:
```powershell
wsl --install
```

2. Restart your computer when prompted.

3. Open "Ubuntu" from the Start menu. It will set up a Linux environment.

4. Follow the **Linux (Ubuntu/Debian)** instructions above inside the Ubuntu terminal.

**Option B — Native Windows (Advanced):**

1. **Install Docker Desktop:**
   - Download from https://docker.com/products/docker-desktop
   - Run the installer
   - Restart your computer
   - Open Docker Desktop and wait for it to start (whale icon in system tray turns steady)

2. **Install Node.js 20:**
   - Download from https://nodejs.org (LTS version)
   - Run the installer, accept all defaults
   - Open a NEW Command Prompt or PowerShell and verify: `node --version`

3. **Install Rust:**
   - Download from https://rustup.rs
   - Run `rustup-init.exe`
   - Accept the default installation
   - Open a NEW Command Prompt and verify: `cargo --version`

4. **Install Git:**
   - Download from https://git-scm.com/download/win
   - Run the installer, accept all defaults

5. **Clone and build:**
```powershell
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# On Windows, run the PowerShell version:
.\scripts\setup.ps1
```

Note: The `.sh` script is for Linux/Mac. On native Windows, use the `.ps1` PowerShell script (created by the setup prompt) or use WSL.

---

### macOS

**Install Homebrew (if not installed):**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**Install Docker Desktop:**
```bash
brew install --cask docker
# Open Docker Desktop from Applications and wait for it to start
```

**Install Node.js 20:**
```bash
brew install node@20
```

**Install Rust:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

**Clone and run:**
```bash
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet
./scripts/setup.sh
```

---

## 5. Accessing Your Instance

After setup completes:

**From the same machine:**
Open your browser and go to `http://localhost:3000`

**From other devices on your network:**
Find your machine's local IP address:
- Linux/Mac: `hostname -I` or `ip addr show`
- Windows: `ipconfig` (look for IPv4 Address)

Then on other devices, go to `http://YOUR_IP:3000`

Example: If your computer's IP is 192.168.1.50, go to `http://192.168.1.50:3000`

**Making yourself an admin:**
After creating your first account, connect to the database and promote yourself:

```bash
cd Discreet

# Read your database password from .env
export PG_PASS=$(grep DATABASE_URL .env | sed 's/.*:\/\/discreet:\(.*\)@.*/\1/')

# Connect and set admin role
PGPASSWORD=$PG_PASS psql -h localhost -U discreet -d discreet \
  -c "UPDATE users SET platform_role = 'admin' WHERE username = 'YOUR_USERNAME';"
```

Refresh your browser — the Admin tab will appear.

---

## 6. Adding HTTPS (Production)

For a production deployment accessible from the internet, you need HTTPS. We recommend Caddy because it handles SSL certificates automatically.

**Install Caddy:**
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

**Configure Caddy:**
```bash
sudo tee /etc/caddy/Caddyfile << 'EOF'
yourdomain.com {
    reverse_proxy localhost:3000
    encode gzip zstd
}
EOF

sudo systemctl restart caddy
```

Replace `yourdomain.com` with your actual domain. Point your domain's DNS A record to your server's IP address. Caddy will automatically obtain and renew an SSL certificate from Let's Encrypt.

**Update your .env:**
```bash
# Change CORS to your domain
nano .env
# Set: CORS_ORIGINS=https://yourdomain.com
```

---

## 7. Email Verification Setup

Email verification is optional but recommended. Without it, users can still register — they just won't have verified email addresses.

We use Resend for transactional email (3,000 free emails/month).

1. Create an account at https://resend.com
2. Add your domain and verify DNS records
3. Create an API key
4. Add to your `.env`:

```bash
nano .env
# Set: RESEND_API_KEY=re_your_api_key_here
```

5. Restart: `sudo systemctl restart discreet` (or re-run the server)

---

## 8. Configuration Reference

All configuration is in the `.env` file. Here's what each variable does:

| Variable | What It Does | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://discreet:PASSWORD@localhost:5432/discreet` |
| `REDIS_URL` | Redis connection string | `redis://:PASSWORD@127.0.0.1:6379` |
| `JWT_SECRET` | Signs authentication tokens (128 hex chars) | Auto-generated |
| `CORS_ORIGINS` | Which domains can access the API | `http://localhost:3000` or `https://yourdomain.com` |
| `AGENT_KEY_SECRET` | Encrypts AI bot API keys at rest | Auto-generated |
| `TOTP_ENCRYPTION_KEY` | Encrypts 2FA secrets at rest | Auto-generated |
| `RESEND_API_KEY` | Email service API key (optional) | `re_xxxxx` |

**Security rules:**
- Never share your `.env` file
- Never commit `.env` to Git (it's already in `.gitignore`)
- Use unique secrets for every deployment (the setup script does this automatically)
- In production, set `CORS_ORIGINS` to your exact domain, never `*`

---

## 9. Updating

When a new version of Discreet is released:

```bash
cd Discreet

# Pull the latest code
git pull

# Rebuild the client
cd client-next && npm ci && npm run build && cd ..

# Rebuild the server
cargo build --release

# Apply any new database migrations
export PG_PASS=$(grep DATABASE_URL .env | sed 's/.*:\/\/discreet:\(.*\)@.*/\1/')
for f in migrations/*.sql; do
  PGPASSWORD=$PG_PASS psql -h localhost -U discreet -d discreet \
    -f "$f" 2>&1 | tail -1
done

# Restart the server
# If using systemd:
sudo systemctl restart discreet
# If running manually, stop and re-run:
# ./target/release/citadel-server
```

---

## 10. Backup and Restore

**Create a backup:**
```bash
export PG_PASS=$(grep DATABASE_URL .env | sed 's/.*:\/\/discreet:\(.*\)@.*/\1/')
PGPASSWORD=$PG_PASS pg_dump -h localhost -U discreet discreet | gzip > backup_$(date +%Y%m%d).sql.gz
```

**Restore from backup:**
```bash
gunzip -c backup_20260314.sql.gz | \
  PGPASSWORD=$PG_PASS psql -h localhost -U discreet -d discreet
```

**Automate daily backups (Linux):**
```bash
mkdir -p ~/discreet-backups
crontab -e
# Add this line (runs at 3 AM daily, keeps 30 days):
0 3 * * * export PG_PASS=$(grep DATABASE_URL /path/to/Discreet/.env | sed 's/.*:\/\/discreet:\(.*\)@.*/\1/') && PGPASSWORD=$PG_PASS pg_dump -h localhost -U discreet discreet | gzip > ~/discreet-backups/db_$(date +\%Y\%m\%d).sql.gz && find ~/discreet-backups -name "db_*.sql.gz" -mtime +30 -delete
```

**Also back up your `.env` file** — if you lose it, you lose the ability to decrypt stored AI agent keys and TOTP secrets. Store a copy somewhere safe and encrypted.

---

## 11. Troubleshooting

### "Docker is not running"
**Linux:** Run `sudo systemctl start docker`
**Windows:** Open Docker Desktop and wait for it to start
**Mac:** Open Docker Desktop from Applications

### "Port 3000 is already in use"
Something else is using port 3000. Find it:
```bash
# Linux/Mac:
lsof -i :3000
# Windows:
netstat -ano | findstr :3000
```
Either stop that process or change Discreet's port in `.env` by adding `PORT=3001`.

### "Database connection refused"
The PostgreSQL container might not be running:
```bash
docker ps
# Should show a postgres container
# If not:
docker compose up -d
```

### "cargo build fails with out of memory"
On machines with less than 4GB RAM, the Rust compiler can run out of memory:
```bash
# Create a swap file (Linux only):
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Then retry the build:
cargo build --release
```

### "npm ci fails"
```bash
# Clear npm cache and retry:
cd client-next
rm -rf node_modules
npm cache clean --force
npm ci
```

### "Permission denied on setup.sh"
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### "Migrations fail with 'relation already exists'"
This is normal — it means that migration was already applied. The script continues to the next one.

### Something else?
- Check server logs: `sudo journalctl -u discreet --since "10 min ago"` (if using systemd)
- Check Docker logs: `docker compose logs`
- Open an issue: https://github.com/CitadelOpenSource/Discreet/issues

---

## 12. FAQ

**Q: How much does self-hosting cost?**
A: Zero. Discreet is free, open-source software (AGPL-3.0). You only pay for the server you run it on. An Oracle Cloud free-tier VM works perfectly.

**Q: Can I run this on a Raspberry Pi?**
A: Yes. Raspberry Pi 4 (4GB+) running Ubuntu Server works. ARM builds take longer (20-30 minutes first time) but run fine. Create a swap file first.

**Q: Do I need a domain name?**
A: For local use, no — `http://localhost:3000` works. For internet access with HTTPS, yes — you need a domain pointing to your server.

**Q: Can I use Nginx instead of Caddy?**
A: Yes. Any reverse proxy that supports WebSocket works. We recommend Caddy because it handles SSL automatically. For Nginx, you'll need to configure SSL certificates manually (e.g., with Certbot).

**Q: How do I connect the mobile app to my server?**
A: In the mobile app settings, change the server URL to your domain (e.g., `https://yourdomain.com`).

**Q: Is my data safe?**
A: Messages are end-to-end encrypted. The server stores only encrypted ciphertext it cannot decrypt. Your `.env` file contains the keys that protect authentication tokens and 2FA secrets — back it up securely.

**Q: Can I migrate from Discord?**
A: Not currently. Discord doesn't provide message export APIs. We plan to build import tools for platforms that do.

**Q: How do I get support?**
A: Open an issue on GitHub, or email support@discreetai.net. Enterprise support is available for organizations.

---

## License

Discreet is licensed under AGPL-3.0-or-later. If you modify and deploy Discreet as a network service, you must publish your source code under the same license.

Certain features are covered by a pending US patent. See NOTICE for details.

---

*Built with Rust, React, and a commitment to privacy.*
*https://discreetai.net | https://github.com/CitadelOpenSource/Discreet*
