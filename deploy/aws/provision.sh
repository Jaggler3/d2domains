#!/usr/bin/env bash
# One-time AWS provisioning for the d2domains MVP:
#   - security group (web + mail ports, no SSH — access is via SSM)
#   - IAM role/profile (SSM management + S3 release reads + secret params)
#   - private S3 bucket for release artifacts
#   - SSM parameters for secrets under /d2domains/prod/*
#   - one t3.small EC2 instance (Ubuntu 24.04, Docker preinstalled, EIP)
#
# All resources land in $AWS_REGION (default: us-east-2, matching the repo's
# project region). Safe to re-run: existing resources are reused.
set -euo pipefail

cd "$(dirname "$0")/../.."

REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$REGION"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
SG_NAME="d2domains-prod-sg"
ROLE_NAME="d2domains-ec2"
PROFILE_NAME="d2domains-ec2-profile"
BUCKET="d2domains-deploy-${ACCOUNT}"
PARAM_PREFIX="/d2domains/prod"
INSTANCE_TAG="d2domains-prod"

echo "==> account ${ACCOUNT}, region ${REGION}"

# ---------------------------------------------------------------- secrets ---
SECRET_FILE="deploy/aws/.prod-secrets.env"
if [ ! -f "$SECRET_FILE" ]; then
  echo "==> generating $SECRET_FILE (gitignored)"
  cat > "$SECRET_FILE" <<EOF
# Values pushed to SSM SecureStrings by secrets.sh; sourced nowhere else.
INTERNAL_TOKEN=$(openssl rand -hex 32)
STALWART_ADMIN_USER=admin
STALWART_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
fi

# ------------------------------------------------------- security group -----
SG_ID="$(aws ec2 describe-security-groups \
  --filters Name=group-name,Values="$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  VPC_ID="$(aws ec2 describe-vpcs --query 'Vpcs[?IsDefault].VpcId' --output text)"
  echo "==> creating security group $SG_NAME in $VPC_ID"
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" \
    --description "d2domains production (web + mail)" --vpc-id "$VPC_ID" \
    --query GroupId --output text)"
else
  echo "==> security group exists: $SG_ID"
fi

add_rule() { # port description
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol tcp --port "$1" --cidr 0.0.0.0/0 >/dev/null 2>&1 || true
}
for port in 80 443 25 465 587 993 143; do add_rule "$port"; done
echo "==> ingress: 80 443 (web), 25 465 587 993 143 (mail)"

# ------------------------------------------------------------------- IAM ----
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "==> creating IAM role $ROLE_NAME"
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]
  }' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name d2domains-read \
  --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {\"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\"], \"Resource\": \"arn:aws:s3:::${BUCKET}/*\"},
    {\"Effect\": \"Allow\", \"Action\": [\"ssm:GetParameter\", \"ssm:GetParameters\", \"ssm:GetParametersByPath\"], \"Resource\": \"arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${PARAM_PREFIX}/*\"}
  ]
}" >/dev/null

if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" \
    --role-name "$ROLE_NAME" >/dev/null || true
  sleep 8 # propagation
fi

# -------------------------------------------------------------------- S3 ----
if ! aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "==> creating private bucket $BUCKET"
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    $([ "$REGION" != "us-east-1" ] && echo "--create-bucket-configuration LocationConstraint=$REGION") >/dev/null
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null
  aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
fi

echo "==> provisioning complete."
echo "    next: deploy/aws/secrets.sh && deploy/aws/instance.sh"
