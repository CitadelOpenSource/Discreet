#!/usr/bin/env bash
set -euo pipefail

# Generate SQLx offline metadata into ./.sqlx
#
# Requires:
#   cargo install sqlx-cli --no-default-features --features postgres,rustls
#   A reachable Postgres with schema applied (see scripts/dev_up.sh)
#   DATABASE_URL set in your environment

: "${DATABASE_URL:?DATABASE_URL must be set}"

cargo sqlx prepare

echo "SQLx offline metadata generated in ./.sqlx"
