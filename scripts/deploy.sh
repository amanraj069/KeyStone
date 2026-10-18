#!/usr/bin/env bash
# Deploy the latest commit to the EC2 instance (docs/deploy.md, "Redeploying").
#
#   scripts/deploy.sh ubuntu@203.0.113.10
#   DEPLOY_HOST=ubuntu@203.0.113.10 DEPLOY_SSH_KEY=~/.ssh/keystone.pem scripts/deploy.sh
#
# On the instance: git pull, rebuild and restart the stack, then GET https://API_DOMAIN/health
# from here (through Caddy and TLS). Fails loudly unless the status is "up" or "seeding".
#
# Optional env: DEPLOY_SSH_KEY (private key file), DEPLOY_DIR (checkout on the instance,
# default keystone, relative to the home directory), HEALTH_WAIT_SECONDS (default 180).
set -euo pipefail

HOST="${1:-${DEPLOY_HOST:-}}"
if [[ -z "$HOST" ]]; then
  echo "usage: scripts/deploy.sh user@host   (or set DEPLOY_HOST)" >&2
  exit 2
fi
DIR="${DEPLOY_DIR:-keystone}"
WAIT="${HEALTH_WAIT_SECONDS:-180}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15)
[[ -n "${DEPLOY_SSH_KEY:-}" ]] && SSH+=(-i "$DEPLOY_SSH_KEY")

fail() {
  echo "" >&2
  echo "DEPLOY FAILED: $*" >&2
  exit 1
}

# The image build skips type checking (it needs more memory than a 1 GB instance has),
# so check the types here first.
echo "==> Type-checking the API (laptop)"
pnpm --filter @keystone/shared build >/dev/null || fail "packages/shared does not build"
pnpm --filter @keystone/api typecheck || fail "type errors in apps/api (output above); fix them before deploying"

echo "==> Deploying to $HOST:~/$DIR"
# The remote script is quoted ('REMOTE'), so nothing in it is expanded here; DIR is passed as $1.
"${SSH[@]}" "$HOST" bash -s -- "$DIR" <<'REMOTE' || fail "the remote build or restart failed (output above)"
set -euo pipefail
cd "$HOME/$1"
[[ -f .env.prod ]] || { echo ".env.prod is missing in $PWD (see docs/deploy.md)" >&2; exit 1; }
# docker compose reads FALKOR_PASSWORD and API_DOMAIN from .env for interpolation.
[[ -e .env ]] || ln -s .env.prod .env
[[ -f data/artifacts.jsonl ]] || { echo "data/artifacts.jsonl is missing: copy data/ first (docs/deploy.md)" >&2; exit 1; }
# Below 2 GB of RAM the build next to the running stack needs swap, or it is OOM-killed.
mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
swap_kb=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
if (( mem_kb < 2000000 && swap_kb < 1000000 )); then
  echo "This instance has $((mem_kb / 1024)) MB of RAM and $((swap_kb / 1024)) MB of swap: add a 2 GB swap file first (docs/deploy.md, \"Small instances\")" >&2
  exit 1
fi
echo "--> git pull"
git pull --ff-only
echo "--> docker compose up -d --build"
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f >/dev/null
docker compose -f docker-compose.prod.yml ps
REMOTE

# The value of API_DOMAIN in the instance's .env.prod, without quotes or spaces.
DOMAIN="$("${SSH[@]}" "$HOST" "sed -n 's/^API_DOMAIN=//p' ~/$DIR/.env.prod | head -1" | tr -d "\"' \r")"
[[ -n "$DOMAIN" ]] || fail "API_DOMAIN is empty in ~/$DIR/.env.prod"
URL="https://$DOMAIN/health"

echo "==> Waiting for $URL (up to ${WAIT}s)"
deadline=$((SECONDS + WAIT))
body=""
status=""
while (( SECONDS < deadline )); do
  # The API restarts during the deploy, so 502s and timeouts are expected for a few seconds.
  if body="$(curl -fsS --max-time 10 "$URL" 2>/dev/null)"; then
    status="$(printf '%s' "$body" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p' | head -1)"
    [[ "$status" == "up" || "$status" == "seeding" ]] && break
  fi
  sleep 5
done

case "$status" in
  up) echo "==> OK: $URL reports \"up\"" ;;
  seeding) echo "==> OK: $URL reports \"seeding\"; it turns \"up\" when the graph is ready (docker compose logs -f api)" ;;
  "") fail "$URL did not answer within ${WAIT}s. On the instance: docker compose -f docker-compose.prod.yml logs --tail 100 api caddy" ;;
  *) fail "$URL reports \"$status\": $body" ;;
esac
