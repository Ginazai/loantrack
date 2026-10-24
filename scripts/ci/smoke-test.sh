#!/usr/bin/env bash
# Boots the freshly built backend + frontend images next to a real Postgres and runs
# assert-stack.sh against them. Catches what unit tests cannot: a broken Dockerfile,
# a migration that fails on an empty database, a bad entrypoint, a mis-templated nginx
# config, a missing runtime dependency in the slim image.
#
#   BACKEND_IMAGE   default loantrack-backend:ci
#   FRONTEND_IMAGE  default loantrack-frontend:ci
set -euo pipefail

BACKEND_IMAGE="${BACKEND_IMAGE:-loantrack-backend:ci}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-loantrack-frontend:ci}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUFFIX="$$"
NET="loantrack-smoke-$SUFFIX"
PG="smoke-pg-$SUFFIX"
API="smoke-api-$SUFFIX"
WEB="smoke-web-$SUFFIX"

# Throwaway credentials, generated per run. Never reused, never leave this job.
DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
SECRET_KEY="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
export SMOKE_EMAIL="smoke-admin@example.com"
SMOKE_PASSWORD="Aa1-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
export SMOKE_PASSWORD

cleanup() {
  status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "::group::container logs (smoke test failed)"
    for c in "$API" "$WEB" "$PG"; do echo "--- $c ---"; docker logs --tail 80 "$c" 2>&1 || true; done
    echo "::endgroup::"
  fi
  docker rm -f "$WEB" "$API" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

wait_until() {  # description, tries, command...
  local what=$1 tries=$2; shift 2
  for i in $(seq 1 "$tries"); do
    if "$@" >/dev/null 2>&1; then echo "✓ $what ready (try $i)"; return 0; fi
    sleep 2
  done
  echo "✗ timed out waiting for $what" >&2
  return 1
}

docker network create "$NET" >/dev/null

docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_DB=smoke -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  postgres:16-alpine >/dev/null
wait_until "postgres" 30 docker exec "$PG" pg_isready -U smoke -d smoke

# The network alias "backend" is the hostname the frontend image's nginx proxies to by default.
# The container entrypoint runs `alembic upgrade head` + seed before starting uvicorn, so a
# healthy API here also proves migrations apply cleanly on an empty database.
docker run -d --name "$API" --network "$NET" --network-alias backend -p 127.0.0.1:18000:8000 \
  -e DATABASE_URL="postgresql+asyncpg://smoke:${DB_PASSWORD}@${PG}:5432/smoke" \
  -e SECRET_KEY="$SECRET_KEY" \
  -e SEED_ADMIN_EMAIL="$SMOKE_EMAIL" -e SEED_ADMIN_PASSWORD="$SMOKE_PASSWORD" \
  -e UVICORN_WORKERS=1 -e ALLOWED_ORIGINS='["http://localhost"]' \
  "$BACKEND_IMAGE" >/dev/null

docker run -d --name "$WEB" --network "$NET" -p 127.0.0.1:18080:8080 "$FRONTEND_IMAGE" >/dev/null

wait_until "backend" 45 curl -fsS http://127.0.0.1:18000/api/v1/health
wait_until "frontend" 20 curl -fsS http://127.0.0.1:18080/health

API_URL=http://127.0.0.1:18000 WEB_URL=http://127.0.0.1:18080 bash "$HERE/assert-stack.sh"
