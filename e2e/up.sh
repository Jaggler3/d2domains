#!/usr/bin/env bash
# Brings up the full mock compose stack (fake registry) and makes sure the
# Stalwart mail server has completed its one-time bootstrap.
#
# Stalwart v0.16's setup wizard needs ONE container restart after the wizard
# payload is submitted (dove submits it automatically on boot); this script
# performs that restart when needed.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.mock.yml)
# shellcheck disable=SC1091
STALWART_ADMIN_USER="${STALWART_ADMIN_USER:-$(grep '^STALWART_ADMIN_USER=' .env | cut -d= -f2)}"
STALWART_ADMIN_PASSWORD="${STALWART_ADMIN_PASSWORD:-$(grep '^STALWART_ADMIN_PASSWORD=' .env | cut -d= -f2)}"

echo "==> building + starting stack"
"${COMPOSE[@]}" up -d --build

echo "==> waiting for hog"
for i in $(seq 1 60); do
  curl -sf http://localhost:8787/metrics >/dev/null && break
  [ "$i" = 60 ] && { echo "hog never became ready"; exit 1; }
  sleep 1
done

stalwart_normal() {
  curl -s -u "$STALWART_ADMIN_USER:$STALWART_ADMIN_PASSWORD" \
    -X POST http://localhost:18080/jmap \
    -H 'Content-Type: application/json' \
    -d '{"using":["urn:ietf:params:jmap:core","urn:stalwart:jmap"],"methodCalls":[["x:Domain/query",{"filter":null},"c0"]]}' \
    | grep -q '"x:Domain/query"'
}

if stalwart_normal; then
  echo "==> stalwart already initialized"
else
  echo "==> stalwart in bootstrap mode — letting dove submit setup, then restarting it once"
  sleep 8
  "${COMPOSE[@]}" restart stalwart
  for i in $(seq 1 60); do
    stalwart_normal && { echo "==> stalwart initialized"; break; }
    [ "$i" = 60 ] && { echo "stalwart never left bootstrap mode"; docker compose logs stalwart | tail -20; exit 1; }
    sleep 2
  done
fi

echo "==> waiting for dove"
for i in $(seq 1 60); do
  curl -sf http://localhost:8786/health >/dev/null 2>&1 && break
  # /health may not exist; fall back to TCP reachability via metrics-less ping
  curl -s -o /dev/null http://localhost:8786/ && break
  [ "$i" = 60 ] && { echo "dove never became reachable"; exit 1; }
  sleep 1
done

echo "==> stack ready"
