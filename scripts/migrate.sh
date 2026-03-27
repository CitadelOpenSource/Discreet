#!/bin/bash
# ARCHIVED — Migrations are applied by scripts/setup.sh (step 8).
# For manual migration: see GUIDE/QUICKSTART.md or GUIDE/DEPLOYMENT.md.
# Delete with: git rm scripts/migrate.sh
echo "Use setup.sh for migrations, or run manually:"
echo "  for f in migrations/*.sql; do cat \"\$f\" | docker compose exec -T postgres psql -U discreet -d discreet; done"
exit 1
