#!/usr/bin/env bash
# Runs the Playwright browser journey against the running mock stack.
set -euo pipefail
cd "$(dirname "$0")/../client"
HOG_URL="${HOG_URL:-http://127.0.0.1:8787}" npx playwright test tests/journey.spec.ts "$@"
