#!/usr/bin/env bash
# Starts the image with empty volumes and checks it serves the API and the
# web app. Usage: scripts/docker-smoke-test.sh <image>
set -euo pipefail

IMAGE="$1"
NAME="recipe-maker-smoke-$$"
PORT=18787
BASE="http://127.0.0.1:${PORT}"

# On failure show the container logs first, otherwise CI only shows a curl error.
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "smoke test failed; container logs:" >&2
    docker logs "$NAME" 2>&1 | tail -n 200 >&2 || true
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# get <path> [curl args...]: prints the body, fails on a non-2xx status.
get() {
  local path=$1
  shift
  curl -fsS --max-time 10 "$@" "${BASE}${path}"
}

# expect_body <name> <pattern> <path> [curl args...]
expect_body() {
  local name=$1 pattern=$2 path=$3 body
  shift 3
  body=$(get "$path" "$@") || fail "$name: request to $path failed"
  grep -q -- "$pattern" <<<"$body" || fail "$name: $path did not match '$pattern'; body: ${body:0:500}"
}

# Short health intervals so Docker's own HEALTHCHECK command (not just curl)
# reports healthy within the wait below.
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8787" \
  --health-interval=2s --health-start-period=1s \
  -e ADMIN_USERS=alice \
  "$IMAGE" >/dev/null

health=""
for _ in $(seq 1 60); do
  health=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo missing)
  [ "$health" = "healthy" ] && break
  sleep 1
done
[ "$health" = "healthy" ] || fail "container health is '$health', not healthy"

expect_body "health" '"storage":"ready"' /api/health
expect_body "web app" 'id="root"' /
asset=$(get / | grep -o '/assets/[^"]*\.js' | head -n 1) || fail "no /assets/*.js script in index.html"
content_type=$(curl -fsS --max-time 10 -o /dev/null -w '%{content_type}' "${BASE}${asset}") || fail "bundle $asset not served"
case "$content_type" in
  *javascript*) ;;
  *) fail "bundle $asset served as '$content_type'" ;;
esac
# AUTH_MODE is not passed: the image default must be header mode.
status=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "${BASE}/api/me")
[ "$status" = "401" ] || fail "/api/me without Remote-User returned $status, not 401"
expect_body "admin identity" '"isAdmin":true' /api/me -H 'Remote-User: alice'
expect_body "empty recipe list" '"recipes":\[\]' '/api/recipes?scope=all' -H 'Remote-User: alice'

echo "smoke test passed"
