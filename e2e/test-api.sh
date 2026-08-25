#!/usr/bin/env bash
# Runs the API-level e2e suite against the running mock stack (see up.sh).
set -euo pipefail
cd "$(dirname "$0")"
bun --env-file=../.env test api.test.ts "$@"
