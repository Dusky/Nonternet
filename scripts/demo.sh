#!/bin/sh
# Boots a throwaway copy of the whole site with a small demo community, so you can look around (docs/19).
#   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres scripts/demo.sh
# Needs a Postgres you can create databases on (a Redis is optional). Add ergo and evennia to the PATH to switch chat and the
# MUD on. Press Ctrl+C to stop; the demo database is dropped.
set -e
cd "$(dirname "$0")/.."
: "${TEST_DATABASE_URL:=postgres://postgres@localhost:5432/postgres}"
export TEST_DATABASE_URL
export E2E_SITE_NAME="${E2E_SITE_NAME:-Demo Site}"
if [ ! -f apps/core/dist/main.cjs ] || [ ! -f apps/shell/dist/index.html ] || [ ! -f apps/bbs/dist/main.cjs ]; then
  echo "Building first (a minute or two)…"
  pnpm build
fi
exec pnpm --filter @app/core exec tsx ../../e2e/support/demo.ts
