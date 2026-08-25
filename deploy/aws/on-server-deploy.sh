#!/usr/bin/env bash
# Runs ON the EC2 instance (via SSM). Rebuilds .env from SSM, unpacks the
# latest release already placed at /srv/d2domains by the caller, and re-ups
# the compose stack. Public hostname is derived from instance metadata.
set -euo pipefail

cd /srv/d2domains

REGION="${1:?usage: on-server-deploy.sh <region> <public-host>}"
PUBLIC_HOST="${2:?usage: on-server-deploy.sh <region> <public-host>}"
export AWS_DEFAULT_REGION="$REGION"

echo "==> rebuilding .env from SSM"
umask 077
: > .env
for p in $(aws ssm get-parameters-by-path --path /d2domains/prod --recursive \
            --query 'Parameters[].Name' --output text); do
  key="$(basename "$p")"
  val="$(aws ssm get-parameter --name "$p" --with-decryption --query Parameter.Value --output text)"
  printf '%s=%s\n' "$key" "$val" >> .env
done

# Sanity: without INTERNAL_TOKEN the whole stack crash-loops.
if ! grep -q '^INTERNAL_TOKEN=.' .env; then
  echo "FATAL: no parameters found under /d2domains/prod — check instance role policy"
  exit 1
fi

cat >> .env <<'ENVEOF'
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/d2gres
WEASEL_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/d2weasel
WOMBAT_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/d2wombat
OTTER_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/d2otter
PIGEON_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/d2pigeon
DOVE_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/d2dove
DOVE_PGHOST=postgres
DOVE_PGPORT=5432
DOVE_PGUSER=postgres
DOVE_PGPASSWORD=postgres
DOVE_PGDATABASE=d2dove
REDIS_URL=redis://redis:6379
REGISTRY_URL=http://heron:8783
WEASEL_URL=http://weasel:8781
WOMBAT_URL=http://wombat:8782
OTTER_URL=http://otter:8784
PIGEON_URL=http://pigeon:8785
DOVE_URL=http://dove:8786
HOG_URL=http://hog:8787
STALWART_URL=http://stalwart:8080
ENVEOF

{
  echo "D2_PUBLIC_HOST=$PUBLIC_HOST"
  echo "CLIENT_ORIGIN=https://$PUBLIC_HOST"
} >> .env

echo "==> deploying (public host: $PUBLIC_HOST)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker image prune -f

# Stalwart v0.16 one-time setup: dove submits the wizard payload on boot;
# the server then needs ONE restart to leave bootstrap mode.
ADMIN_USER="$(grep '^STALWART_ADMIN_USER=' .env | cut -d= -f2-)"
ADMIN_PASS="$(grep '^STALWART_ADMIN_PASSWORD=' .env | cut -d= -f2-)"
stalwart_normal() {
  curl -s -u "$ADMIN_USER:$ADMIN_PASS" -X POST http://localhost:18080/jmap \
    -H 'Content-Type: application/json' \
    -d '{"using":["urn:ietf:params:jmap:core","urn:stalwart:jmap"],"methodCalls":[["x:Domain/query",{"filter":null},"c0"]]}' \
    | grep -q '"x:Domain/query"'
}
sleep 8
if ! stalwart_normal; then
  echo "==> stalwart in bootstrap mode — submitting wait + single restart"
  sleep 10 # give dove time to POST x:Bootstrap/set
  docker compose -f docker-compose.yml -f docker-compose.prod.yml restart stalwart
fi

docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
