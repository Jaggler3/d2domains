#!/bin/bash
# Deploys d2domains production.
#
# AWS path (current): uploads the committed HEAD as an S3 release artifact
# and runs deploy/aws/on-server-deploy.sh on the instance over SSM — no SSH.
#
# Usage:
#   ./deploy.sh            # artifact + remote deploy + status output

set -euo pipefail
cd "$(dirname "$0")"

exec deploy/aws/deploy-remote.sh "$@"
