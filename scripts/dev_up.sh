#!/usr/bin/env bash
set -euo pipefail

# Bring up Postgres + Redis for local development.
#
# This script is intentionally minimal and dependency-free.
# It uses `docker compose` and the Postgres container's own psql.

docker compose up -d postgres redis

echo "Waiting for Postgres to be ready..."
until docker compose exec -T postgres pg_isready -U citadel -d citadel >/dev/null 2>&1; do
  sleep 1
done

echo "Applying schema (migrations/001_schema.sql)..."
docker compose exec -T postgres psql -U citadel -d citadel < migrations/001_schema.sql

echo "Done."
echo
cat <<'NEXT'
Next:
  1) cp .env.example .env
  2) edit .env (set JWT_SECRET)
  3) export DATABASE_URL=postgres://citadel:citadel@localhost:5432/citadel
     export REDIS_URL=redis://localhost:6379
     export JWT_SECRET=... (must match .env or your environment)
  4) cargo run
NEXT
