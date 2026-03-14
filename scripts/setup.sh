#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Discreet — Single-command deployment script for self-hosters
# ─────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="1.0.0"

# ── Banner ──────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Discreet — Encrypted Communication Platform        ║"
echo "║  Version: ${VERSION}                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Detect OS ───────────────────────────────────────────────
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        case "$ID" in
            ubuntu|debian|pop|linuxmint|elementary) echo "debian" ;;
            fedora)                                  echo "fedora" ;;
            centos|rhel|rocky|alma)                  echo "rhel"   ;;
            arch|manjaro|endeavouros)                echo "arch"   ;;
            opensuse*|sles)                          echo "suse"   ;;
            alpine)                                  echo "alpine" ;;
            *)                                       echo "linux"  ;;
        esac
    else
        echo "unknown"
    fi
}

OS=$(detect_os)

install_hint() {
    local tool="$1"
    case "$tool" in
        docker)
            case "$OS" in
                macos)  echo "  brew install --cask docker" ;;
                debian) echo "  curl -fsSL https://get.docker.com | sh" ;;
                fedora) echo "  sudo dnf install -y docker-ce docker-ce-cli containerd.io" ;;
                rhel)   echo "  sudo yum install -y docker-ce docker-ce-cli containerd.io" ;;
                arch)   echo "  sudo pacman -S docker" ;;
                suse)   echo "  sudo zypper install docker" ;;
                alpine) echo "  sudo apk add docker" ;;
                *)      echo "  https://docs.docker.com/engine/install/" ;;
            esac
            ;;
        node)
            case "$OS" in
                macos)  echo "  brew install node@20" ;;
                debian) echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
                fedora) echo "  sudo dnf install -y nodejs20" ;;
                rhel)   echo "  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y nodejs" ;;
                arch)   echo "  sudo pacman -S nodejs npm" ;;
                alpine) echo "  sudo apk add nodejs npm" ;;
                *)      echo "  https://nodejs.org/en/download/" ;;
            esac
            ;;
        cargo)
            echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
            ;;
        git)
            case "$OS" in
                macos)  echo "  brew install git" ;;
                debian) echo "  sudo apt-get install -y git" ;;
                fedora) echo "  sudo dnf install -y git" ;;
                rhel)   echo "  sudo yum install -y git" ;;
                arch)   echo "  sudo pacman -S git" ;;
                alpine) echo "  sudo apk add git" ;;
                *)      echo "  https://git-scm.com/downloads" ;;
            esac
            ;;
        openssl)
            case "$OS" in
                macos)  echo "  brew install openssl" ;;
                debian) echo "  sudo apt-get install -y openssl" ;;
                fedora) echo "  sudo dnf install -y openssl" ;;
                rhel)   echo "  sudo yum install -y openssl" ;;
                arch)   echo "  sudo pacman -S openssl" ;;
                alpine) echo "  sudo apk add openssl" ;;
                *)      echo "  https://www.openssl.org/source/" ;;
            esac
            ;;
    esac
}

# ── Check required tools ───────────────────────────────────
echo "[1/8] Checking required tools..."
MISSING=0

# Docker or Podman
CONTAINER_CMD=""
if command -v docker &>/dev/null; then
    CONTAINER_CMD="docker"
    echo "  ✓ docker $(docker --version 2>/dev/null | head -1)"
elif command -v podman &>/dev/null; then
    CONTAINER_CMD="podman"
    echo "  ✓ podman $(podman --version 2>/dev/null | head -1)"
else
    echo "  ✗ docker/podman — not found. Install with:"
    install_hint docker
    MISSING=1
fi

# Node v20+
if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$NODE_VER" -ge 20 ]]; then
        echo "  ✓ node $(node -v)"
    else
        echo "  ✗ node $(node -v) — v20+ required. Install with:"
        install_hint node
        MISSING=1
    fi
else
    echo "  ✗ node — not found. Install with:"
    install_hint node
    MISSING=1
fi

# Cargo
if command -v cargo &>/dev/null; then
    echo "  ✓ cargo $(cargo --version 2>/dev/null)"
else
    echo "  ✗ cargo — not found. Install with:"
    install_hint cargo
    MISSING=1
fi

# Git
if command -v git &>/dev/null; then
    echo "  ✓ git $(git --version 2>/dev/null)"
else
    echo "  ✗ git — not found. Install with:"
    install_hint git
    MISSING=1
fi

# OpenSSL
if command -v openssl &>/dev/null; then
    echo "  ✓ openssl $(openssl version 2>/dev/null)"
else
    echo "  ✗ openssl — not found. Install with:"
    install_hint openssl
    MISSING=1
fi

if [[ "$MISSING" -ne 0 ]]; then
    echo ""
    echo "ERROR: Missing required tools. Install them and re-run this script."
    exit 1
fi
echo ""

# ── Generate secrets ───────────────────────────────────────
echo "[2/8] Generating secrets..."
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 64)
AGENT_KEY_SECRET=$(openssl rand -hex 32)
TOTP_KEY=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 24)
echo "  ✓ All secrets generated (DB, JWT, Agent, TOTP, Redis)"
echo ""

# ── Write .env ─────────────────────────────────────────────
echo "[3/8] Writing .env..."
cat > .env <<EOF
# ─── Generated by scripts/setup.sh ───────────────────────
# Database
DATABASE_URL=postgres://discreet:${DB_PASSWORD}@localhost:5432/discreet

# Redis
REDIS_URL=redis://:${REDIS_PASSWORD}@127.0.0.1:6379

# JWT signing key (128 hex chars)
JWT_SECRET=${JWT_SECRET}

# Master secret for encrypting agent API keys at rest
AGENT_KEY_SECRET=${AGENT_KEY_SECRET}

# AES-256-GCM key for TOTP secret encryption
TOTP_ENCRYPTION_KEY=${TOTP_KEY}

# Allowed CORS origins
CORS_ORIGINS=http://localhost:3000
EOF
chmod 600 .env
echo "  ✓ .env written (chmod 600)"
echo ""

# ── Write docker-compose.override.yml ──────────────────────
echo "[4/8] Writing docker-compose.override.yml..."
cat > docker-compose.override.yml <<EOF
# ─── Generated by scripts/setup.sh ───────────────────────
# Overrides default docker-compose.yml with secure passwords
# and localhost-only bindings.
services:
  postgres:
    environment:
      POSTGRES_USER: discreet
      POSTGRES_PASSWORD: "${DB_PASSWORD}"
      POSTGRES_DB: discreet
    ports:
      - "127.0.0.1:5432:5432"

  redis:
    command: redis-server --requirepass "${REDIS_PASSWORD}"
    ports:
      - "127.0.0.1:6379:6379"
EOF
chmod 600 docker-compose.override.yml
echo "  ✓ docker-compose.override.yml written (chmod 600)"
echo ""

# ── Start containers ───────────────────────────────────────
echo "[5/8] Starting PostgreSQL and Redis..."
if [[ "$CONTAINER_CMD" == "podman" ]]; then
    podman compose up -d
else
    docker compose up -d
fi
echo ""

# ── Wait for PostgreSQL ────────────────────────────────────
echo "[6/8] Waiting for PostgreSQL to be ready..."
SECONDS_WAITED=0
MAX_WAIT=30
while ! pg_isready -h localhost -U discreet -q 2>/dev/null; do
    if [[ $SECONDS_WAITED -ge $MAX_WAIT ]]; then
        echo ""
        echo "ERROR: PostgreSQL did not become ready within ${MAX_WAIT}s."
        echo "Check logs with: docker compose logs postgres"
        exit 1
    fi
    printf "."
    sleep 1
    SECONDS_WAITED=$((SECONDS_WAITED + 1))
done
echo " ready! (${SECONDS_WAITED}s)"
echo ""

# ── Apply migrations ──────────────────────────────────────
echo "[7/8] Applying database migrations..."
MIGRATION_COUNT=0
for f in migrations/*.sql; do
    if [[ -f "$f" ]]; then
        PGPASSWORD="$DB_PASSWORD" psql -h localhost -U discreet -d discreet -f "$f" -q 2>/dev/null
        MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
    fi
done
echo "  ✓ Applied ${MIGRATION_COUNT} migrations"
echo ""

# ── Build client & server ─────────────────────────────────
echo "[8/8] Building..."

echo "  → Installing client dependencies..."
(cd client-next && npm ci --silent)

echo "  → Building client..."
(cd client-next && npm run build)

echo ""
echo "  → Building Rust server (release mode)..."
echo "    ⚠  This takes 15–20 minutes on first build."
cargo build --release

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓ Discreet is ready at http://localhost:3000       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "To start the server:"
echo "  ./target/release/citadel-server"
echo ""
echo "To stop the databases:"
echo "  docker compose down"
echo ""
echo "Your secrets are in .env (chmod 600). Back it up securely."
echo ""
