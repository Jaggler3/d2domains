#!/usr/bin/env bash
# Triggers a deployment on the EC2 instance over SSM (no SSH needed):
# uploads the current commit as a release artifact, then tells the instance
# to fetch + run deploy/aws/on-server-deploy.sh from the artifact.
set -euo pipefail

cd "$(dirname "$0")"
./push-artifact.sh

cd ../..
REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$REGION"
BUCKET="d2domains-deploy-$(aws sts get-caller-identity --query Account --output text)"

INSTANCE_ID="$(aws ec2 describe-instances \
  --filters Name=tag-key,Values=Name Name=tag-value,Values=d2domains-prod \
            Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)"
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  echo "no running d2domains instance found"; exit 1
fi

REGION="${AWS_REGION:-us-east-2}"
PUBLIC_IP="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
if [ -z "$PUBLIC_IP" ] || [ "$PUBLIC_IP" = "None" ]; then
  echo "instance has no public IP"; exit 1
fi
PUBLIC_HOST="${PUBLIC_IP//./-}.sslip.io"
SHA="$(git rev-parse --short HEAD)"
PARAMETERS=$(printf '{
  "commands": [
    "set -eux",
    "mkdir -p /srv/d2domains",
    "cd /srv/d2domains",
    "aws s3 cp s3://%s/releases/latest.tar.gz /tmp/release.tar.gz",
    "tar xzf /tmp/release.tar.gz -C /srv/d2domains",
    "rm -f /tmp/release.tar.gz",
    "chmod +x deploy/aws/on-server-deploy.sh",
    "deploy/aws/on-server-deploy.sh %s %s"
  ]
}' "$BUCKET" "$REGION" "$PUBLIC_HOST")

COMMAND_ID="$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "d2domains deploy ${SHA}" \
  --timeout-seconds 1800 \
  --parameters "$PARAMETERS" \
  --query Command.CommandId --output text)"

echo "==> command $COMMAND_ID; waiting for completion…"
for i in $(seq 1 90); do
  STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" --query Status --output text)" || true
  case "$STATUS" in
    Success) break ;;
    Failed|Cancelled|TimedOut)
      aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
        --query '{Output:StandardOutputContent[-3000:],Error:StandardErrorContent[-3000:]}' --output json
      exit 1 ;;
  esac
  [ "$i" = 90 ] && { echo "timed out waiting for command"; exit 1; }
  sleep 10
done

aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text | tail -25
echo "==> deploy of ${SHA} succeeded"
