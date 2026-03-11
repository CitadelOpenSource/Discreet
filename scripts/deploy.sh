#!/bin/bash
# deploy.sh — One-command deployment for Oracle Cloud / any VPS
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - Port 80 and 443 open in firewall
#   - (Optional) Domain pointing to server IP
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/CitadelOpenSource/Discreet/main/scripts/deploy.sh | bash
#   OR
#   git clone https://github.com/CitadelOpenSource/Discreet.git && cd Discreet && ./scripts/deploy.sh

set -e

echo ""
echo "  🏰 CITADEL DEPLOYMENT"
echo "  Zero-knowledge encrypted communication"
echo ""

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "📦 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "⚠️  Docker installed. Please log out and back in, then re-run this script."
  exit 1
fi

# Check Docker Compose
if ! docker compose version &>/dev/null; then
  echo "❌ Docker Compose not found. Please install Docker Compose v2."
  exit 1
fi

# Generate secrets if not set
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(openssl rand -hex 64)
  echo "🔑 Generated JWT_SECRET"
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
  export POSTGRES_PASSWORD=$(openssl rand -hex 16)
  echo "🔑 Generated POSTGRES_PASSWORD"
fi

# Save secrets to .env for persistence
cat > .env << EOF
JWT_SECRET=$JWT_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DOMAIN=${DOMAIN:-localhost}
CORS_ORIGINS=${CORS_ORIGINS:-*}
EOF
echo "📝 Saved secrets to .env"

# Domain setup
if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ]; then
  echo "🌐 Domain: $DOMAIN"
  sed -i "s/{\$DOMAIN:localhost}/$DOMAIN/" Caddyfile 2>/dev/null || true
else
  echo "🌐 No domain set — running on port 80 (HTTP only)"
  echo "   Set DOMAIN=your.domain.com and re-run for HTTPS"
fi

# Build and start
echo ""
echo "🔨 Building Citadel..."
docker compose -f docker-compose.prod.yml up -d --build

# Wait for postgres
echo "⏳ Waiting for database..."
sleep 5

# Apply migrations
echo "📊 Applying database migrations..."
for f in migrations/*.sql; do
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U citadel -d citadel < "$f" 2>&1 | grep -v "already exists" || true
done

echo ""
echo "  ✅ CITADEL IS RUNNING!"
echo ""
if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ]; then
  echo "  🌐 https://$DOMAIN"
else
  echo "  🌐 http://$(hostname -I | awk '{print $1}'):3000"
fi
echo ""
echo "  📱 Share this URL with friends to get started."
echo "  🔒 All messages are end-to-end encrypted."
echo "  📋 Logs: docker compose -f docker-compose.prod.yml logs -f"
echo "  🛑 Stop: docker compose -f docker-compose.prod.yml down"
echo ""
