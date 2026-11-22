#!/usr/bin/env bash
# scripts/deploy/deploy.sh — build and roll out one release on the VPS.
#
#   1. build images tagged with the current commit
#   2. backup (scripts/deploy/backup.sh), every time, whether or not web is running
#   3. run migrations (prisma migrate deploy) — stops here on any error
#   4. restart web + worker, wait for the health check
# Usage: bash scripts/deploy/deploy.sh   (from a clean checkout of the release commit)
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=docker/.env.prod
[ -r "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE missing — run bash scripts/deploy/gen-secrets.sh first" >&2; exit 2; }
if [ -n "$(git status --porcelain)" ]; then echo "ERROR: working tree not clean; deploy a committed release only" >&2; exit 2; fi
export APP_VERSION; APP_VERSION=$(git rev-parse --short HEAD)
COMPOSE=(docker compose -f docker/docker-compose.prod.yml --env-file "$ENV_FILE")

echo "== Release $APP_VERSION"
"${COMPOSE[@]}" --profile tools build migrate web worker
"${COMPOSE[@]}" up -d --wait mariadb redis
bash scripts/deploy/backup.sh
"${COMPOSE[@]}" --profile tools run --rm migrate
"${COMPOSE[@]}" up -d web worker caddy
for i in $(seq 1 40); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q web)" 2>/dev/null || echo starting)
  [ "$state" = healthy ] && { echo "== web is healthy ($APP_VERSION)"; exit 0; }
  sleep 3
done
echo "ERROR: web did not become healthy; see: docker compose -f docker/docker-compose.prod.yml logs web" >&2
exit 1
