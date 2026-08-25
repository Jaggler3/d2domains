#!/usr/bin/env bash
# Tears down the mock stack. FRESH=1 also deletes volumes (postgres, redis,
# stalwart, mockingbird data) for a from-scratch next run.
set -euo pipefail
cd "$(dirname "$0")/.."

ARGS=(down --remove-orphans)
if [ "${FRESH:-0}" = "1" ]; then
  ARGS+=(-v)
  echo "==> tearing down stack AND volumes"
else
  echo "==> tearing down stack (volumes kept)"
fi

docker compose -f docker-compose.yml -f docker-compose.mock.yml "${ARGS[@]}"
