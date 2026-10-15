#!/usr/bin/env bash
# Starts the image with empty volumes and checks it serves the API and the
# web app. Usage: scripts/docker-smoke-test.sh <image>
set -euo pipefail

IMAGE="$1"
NAME="recipe-maker-smoke-$$"
PORT=18787

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

docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:8787" \
  -e AUTH_MODE=header -e ADMIN_USERS=alice \
  "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/api/health" | grep -q '"status":"ok"'
curl -fsS "http://127.0.0.1:${PORT}/" | grep -q 'id="root"'
test "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/me")" = "401"
curl -fsS -H 'Remote-User: alice' "http://127.0.0.1:${PORT}/api/me" | grep -q '"isAdmin":true'
curl -fsS -H 'Remote-User: alice' "http://127.0.0.1:${PORT}/api/recipes?scope=all" | grep -q '"recipes":\[\]'

echo "smoke test passed"
