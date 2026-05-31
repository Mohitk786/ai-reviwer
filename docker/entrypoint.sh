#!/bin/sh
# =============================================================================
# Container entrypoint — runs DB migrations + seed before starting the app.
#
# Used by both the `web` and `worker` images. Concurrent boots are safe:
#   - Prisma `migrate deploy` uses an advisory lock; only one container migrates
#     at a time, others wait then no-op.
#   - The seed is idempotent — Plans/FeatureFlags use upsert.
#
# After migration + seed, the script exec's into the CMD (so signals reach the
# Node process for clean shutdown).
# =============================================================================

set -e

# Skip migrations when explicitly told (e.g., a one-off debug shell).
if [ "$SKIP_DB_INIT" = "1" ]; then
  echo "entrypoint: SKIP_DB_INIT=1, not running migrations"
  exec "$@"
fi

echo "entrypoint: applying Prisma migrations"
npx prisma migrate deploy --schema=./packages/db/prisma/schema.prisma

# Apply pgvector index + tsvector trigger (idempotent — uses IF NOT EXISTS).
# Only runs if psql is available in the image (web image only has it indirectly
# via the Prisma engine; worker has the same setup). If we ever ship without
# psql, swap to a Node script that runs the SQL via Prisma.$executeRawUnsafe.
if command -v psql >/dev/null 2>&1; then
  echo "entrypoint: applying SQL extras (HNSW index + tsvector trigger)"
  psql "$DATABASE_URL" -f ./packages/db/prisma/extras.sql || \
    echo "entrypoint: extras.sql had a non-fatal error (likely already applied)"
else
  echo "entrypoint: psql not available; skipping extras.sql (apply manually once)"
fi

# Optional: only run seed when env says to. Default on (idempotent).
if [ "$SKIP_SEED" != "1" ]; then
  echo "entrypoint: seeding plans + feature flags"
  node packages/db/dist/prisma/seed.js 2>/dev/null || \
    npx tsx packages/db/prisma/seed.ts 2>/dev/null || \
    echo "entrypoint: seed step failed; ensure tsx is available or pre-build the seed"
fi

echo "entrypoint: launching: $@"
exec "$@"
