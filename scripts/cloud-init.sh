#!/bin/bash
# ============================================
# Discreet — Oracle Cloud VM Bootstrap Script
# ============================================
#
# This script auto-installs all dependencies when used as a
# cloud-init script during Oracle Cloud VM creation.
#
# Usage:
#   Option A: Paste into Oracle Cloud "Initialization script"
#             box when creating a VM instance.
#   Option B: Run manually on a fresh Ubuntu 22.04+ server:
#             chmod +x cloud-init.sh && sudo ./cloud-init.sh
#
# What it installs:
#   - Docker (for PostgreSQL + Redis)
#   - Rust (for the Discreet server)
#   - Node.js 20 (for the Vite client build)
#   - Caddy (reverse proxy with automatic HTTPS)
#
# After this script finishes, follow GUIDE/DEPLOYMENT.md
# to clone the repo, configure .env, build, and launch.
#
# Estimated run time: 5-10 minutes on ARM, 3-5 on x86.
# ============================================

set -e

echo "=== Discreet server bootstrap starting ==="

# ── Firewall (Oracle Cloud Ubuntu blocks ports by default) ──
# These rules must be inserted BEFORE the default REJECT rule
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
netfilter-persistent save
echo "[1/6] Firewall ports 80 and 443 opened"

# ── System packages ──
apt update && apt upgrade -y
apt install -y build-essential pkg-config libssl-dev git curl \
  debian-keyring debian-archive-keyring apt-transport-https
echo "[2/6] System packages installed"

# ── Docker ──
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
echo "[3/6] Docker installed (log out and back in for group)"

# ── Node.js 20 ──
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo "[4/6] Node.js $(node --version) installed"

# ── Rust (installed for the ubuntu user, not root) ──
su - ubuntu -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y'
echo "[5/6] Rust installed for ubuntu user"

# ── Caddy (reverse proxy + auto HTTPS) ──
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
echo "[6/6] Caddy installed"

# ── Done ──
touch /home/ubuntu/SETUP_COMPLETE
echo ""
echo "=== Bootstrap complete ==="
echo "SSH in and run: ls ~/SETUP_COMPLETE"
echo "If that file exists, everything installed correctly."
echo "Next: follow GUIDE/DEPLOYMENT.md to deploy Discreet."
