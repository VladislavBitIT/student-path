#!/bin/sh
set -eu

smoke_state=${PERSISTENCE_SMOKE_STATE:-/private/tmp/pervye30-persistence-smoke.json}

cleanup_smoke() {
  if [ -f "$smoke_state" ]; then
    pnpm demo:persistence:cleanup || true
  fi
}
trap cleanup_smoke EXIT INT TERM

echo '[verify:p0] format, lint, types, content, i18n, unit/component tests'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm validate:content
pnpm validate:i18n
pnpm test:unit

echo '[verify:p0] OpenAPI freshness, deterministic generation, and repeated check'
pnpm openapi:check
pnpm openapi:generate
pnpm openapi:check

echo '[verify:p0] production builds'
pnpm build

echo '[verify:p0] Docker Compose config, build, startup, and health'
sh scripts/docker-compose-safe.sh --profile test config --quiet
sh scripts/docker-compose-safe.sh --profile test build
sh scripts/docker-compose-safe.sh --profile test up -d --wait

echo '[verify:p0] PostgreSQL integration tests'
TEST_DATABASE_URL=postgresql://pervye30:dev-only-test-password@localhost:54330/pervye30_test pnpm test:integration

echo '[verify:p0] mock demo smoke'
pnpm demo:smoke

echo '[verify:p0] prepare persisted state and due reminder'
pnpm demo:persistence:prepare

echo '[verify:p0] full Compose restart and health wait'
sh scripts/docker-compose-safe.sh --profile test restart
sh scripts/docker-compose-safe.sh --profile test up -d --wait

echo '[verify:p0] restart persistence and exactly-once delivery (repeated verification)'
pnpm demo:persistence:verify
pnpm demo:persistence:verify
pnpm demo:persistence:cleanup

trap - EXIT INT TERM
echo '[verify:p0] all checks passed'
