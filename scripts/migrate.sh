#!/bin/bash
# migrate.sh — Apply all database migrations in order
# Usage: ./migrate.sh (or: docker compose exec server /migrate.sh)

set -e

DB_URL="${DATABASE_URL:-postgres://citadel:citadel@postgres:5432/citadel}"

echo "🔧 Applying migrations to $DB_URL ..."

for f in /migrations/*.sql; do
  echo "  → $(basename $f)"
  psql "$DB_URL" -f "$f" 2>&1 | grep -v "already exists" || true
done

echo "✅ All migrations applied."
