#!/usr/bin/env bash
# Builds a release artifact from the current git HEAD and uploads it to S3.
# Refuses to ship a dirty tree — commit first (the pipeline ships commits).
set -euo pipefail

cd "$(dirname "$0")/../.."

REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$REGION"
BUCKET="d2domains-deploy-$(aws sts get-caller-identity --query Account --output text)"

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash before deploying."
  exit 1
fi

SHA="$(git rev-parse --short HEAD)"
ARTIFACT="/tmp/d2domains-${SHA}.tar.gz"

echo "==> building artifact for ${SHA}"
git archive --format=tar.gz --prefix="" -o "$ARTIFACT" HEAD

echo "==> uploading to s3://${BUCKET}/releases/"
aws s3 cp "$ARTIFACT" "s3://${BUCKET}/releases/${SHA}.tar.gz" >/dev/null
aws s3 cp "$ARTIFACT" "s3://${BUCKET}/releases/latest.tar.gz" >/dev/null
rm -f "$ARTIFACT"
echo "==> uploaded latest.tar.gz (${SHA})"
