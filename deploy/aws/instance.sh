#!/usr/bin/env bash
# Creates (or reuses) the production EC2 instance and its Elastic IP, then
# bootstraps it: latest release artifact + secrets -> running compose stack.
set -euo pipefail

cd "$(dirname "$0")/../.."

REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$REGION"
SG_NAME="d2domains-prod-sg"
PROFILE_NAME="d2domains-ec2-profile"
BUCKET="d2domains-deploy-$(aws sts get-caller-identity --query Account --output text)"
INSTANCE_TAG="d2domains-prod"
EIP_TAG="d2domains-prod-eip"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"

SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text)"

existing_id="$(aws ec2 describe-instances \
  --filters Name=tag-key,Values=Name Name=tag-value,Values="$INSTANCE_TAG" \
            Name=instance-state-name,Values=running,pending,stopped,stopping \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)"

if [ -n "$existing_id" ] && [ "$existing_id" != "None" ]; then
  INSTANCE_ID="$existing_id"
  echo "==> reusing instance $INSTANCE_ID"
else
  AMI_ID="$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/ami-id \
    --query Parameter.Value --output text)"
  echo "==> launching $INSTANCE_TYPE on $AMI_ID"
  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --security-group-ids "$SG_ID" \
    --iam-instance-profile Name="$PROFILE_NAME" \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3,DeleteOnTermination=true}' \
    --metadata-options 'HttpTokens=required,HttpPutResponseHopLimit=2' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_TAG}]" \
    --user-data file://deploy/aws/user-data.sh \
    --query 'Instances[0].InstanceId' --output text)"
fi

# Elastic IP (stable public hostname for sslip.io + future domain)
ALLOC_ID="$(aws ec2 describe-addresses \
  --filters Name=tag-key,Values=Name Name=tag-value,Values="$EIP_TAG" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)"
if [ -z "$ALLOC_ID" ] || [ "$ALLOC_ID" = "None" ]; then
  ALLOC_ID="$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$EIP_TAG}]" \
    --query AllocationId --output text)"
fi
PUBLIC_IP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"

ASSOC="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].AssociationId' --output text 2>/dev/null || true)"
if [ "$ASSOC" = "None" ] || [ -z "$ASSOC" ]; then
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
fi

echo "==> waiting for instance to be running + status ok"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID" || true

echo ""
echo "==============================================================="
echo " instance:   $INSTANCE_ID"
echo " public ip:  $PUBLIC_IP"
echo " web host:   ${PUBLIC_IP//./-}.sslip.io   (until d2domains.com lands)"
echo "==============================================================="

# First bootstrap: push artifact+secrets and install the stack.
"$PWD/deploy/aws/push-artifact.sh"
"$PWD/deploy/aws/deploy-remote.sh"
