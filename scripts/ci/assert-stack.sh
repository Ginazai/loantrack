#!/usr/bin/env bash
# Black-box checks against a running LoanTrack stack. Used by smoke-test.sh (CI, Docker)
# and the post-deploy verification in cd.yml. Needs only bash, curl and python3.
#
#   API_URL         required  e.g. http://127.0.0.1:18000   (backend, no trailing slash)
#   WEB_URL         optional  e.g. http://127.0.0.1:18080   (nginx frontend; adds proxy checks)
#   SMOKE_EMAIL     required  seeded admin email
#   SMOKE_PASSWORD  required  seeded admin password
set -euo pipefail

: "${API_URL:?API_URL is required}"
: "${SMOKE_EMAIL:?SMOKE_EMAIL is required}"
: "${SMOKE_PASSWORD:?SMOKE_PASSWORD is required}"

fail() { echo "✗ $*" >&2; exit 1; }
pass() { echo "✓ $*"; }

json_field() { python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }

login() {  # $1 = base url  ->  prints access token
  local body
  body=$(python3 -c 'import json,os; print(json.dumps({"email": os.environ["SMOKE_EMAIL"], "password": os.environ["SMOKE_PASSWORD"]}))')
  # Capture first: piping curl straight into python would print a JSON traceback on a 401.
  local resp
  resp=$(curl -fsS -X POST "$1/api/v1/auth/login" -H 'Content-Type: application/json' -d "$body") || return 1
  printf '%s' "$resp" | json_field access_token
}

# 1. Backend is up (implies: migrations applied, app imported, DB reachable at boot)
code=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/v1/health" || true)
[[ "$code" == "200" ]] || fail "backend /api/v1/health returned '$code' (expected 200)"
pass "backend health"

# 2. Seeded admin can log in (implies: seed ran, DB read/write works, password hashing + JWT work)
token=$(login "$API_URL") || fail "login against backend failed"
[[ -n "$token" ]] || fail "login returned an empty access token"
pass "login returns an access token"

# 3. The token is actually accepted by a protected route
me=$(curl -fsS "$API_URL/api/v1/auth/me" -H "Authorization: Bearer $token") || fail "/auth/me rejected a freshly issued token"
[[ "$(printf '%s' "$me" | json_field email)" == "$SMOKE_EMAIL" ]] || fail "/auth/me returned a different user"
pass "token accepted by /auth/me"

# 4. Frontend container: static serving + the /api reverse proxy (the nginx template's whole job)
if [[ -n "${WEB_URL:-}" ]]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL/health" || true)
  [[ "$code" == "200" ]] || fail "frontend /health returned '$code'"
  pass "frontend health"

  curl -fsS "$WEB_URL/" | grep -q 'id="root"' || fail "frontend / did not serve the SPA shell"
  pass "frontend serves the SPA shell"

  token_via_proxy=$(login "$WEB_URL") || fail "login through the nginx /api proxy failed"
  [[ -n "$token_via_proxy" ]] || fail "proxy login returned an empty token"
  pass "login works through the nginx proxy"
fi

echo "All smoke checks passed."
