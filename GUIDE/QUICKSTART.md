# Quickstart

Get Discreet running locally in under 5 minutes.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL + Redis)
- [Rust](https://rustup.rs/) (1.75+)
- [Node.js](https://nodejs.org/) (18+)

## Setup

```bash
# Clone and enter the repo
git clone https://github.com/CitadelOpenSource/Discreet.git
cd Discreet

# Start PostgreSQL and Redis
docker compose up -d

# Apply database migrations
for f in migrations/*.sql; do
  cat "$f" | docker compose exec -T postgres psql -U citadel -d citadel
done

# Set environment variables
export DATABASE_URL="postgres://citadel:citadel@localhost:5432/citadel"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="$(openssl rand -hex 64)"

# Build the Vite client
cd client-next && npm install && npm run build && cd ..

# Start the server
cargo run
```

## Access

- **Web client:** http://localhost:3000/next/
- **Health check:** http://localhost:3000/health
- **API base:** http://localhost:3000/api/v1/

## Verify

```bash
curl http://localhost:3000/health
./scripts/smoke_test.sh
```

## Next Steps

- [Deployment Guide](DEPLOYMENT.md) — deploy to production
- [Contributing Guide](CONTRIBUTING.md) — start contributing
- [API Reference](../docs/API_REFERENCE.md) — explore the API
