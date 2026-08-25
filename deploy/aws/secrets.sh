#!/usr/bin/env bash
# Pushes secrets into SSM SecureStrings under /d2domains/prod/*.
# Sources registry credentials from the repo .env (never committed) and the
# generated deploy/aws/.prod-secrets.env. Re-runnable; values are overwritten.
set -euo pipefail

cd "$(dirname "$0")/../.."

REGION="${AWS_REGION:-us-east-2}"
export AWS_DEFAULT_REGION="$REGION"
PARAM_PREFIX="/d2domains/prod"
SECRET_FILE="deploy/aws/.prod-secrets.env"
[ -f "$SECRET_FILE" ] || { echo "run provision.sh first"; exit 1; }
# shellcheck disable=SC1090
source "$SECRET_FILE"

get_env() { # key — reads from root .env without echoing values
  grep "^$1=" .env | head -1 | cut -d= -f2-
}

put() { # name value
  aws ssm put-parameter --name "$PARAM_PREFIX/$1" --type SecureString \
    --value "$2" --overwrite >/dev/null
  echo "  $PARAM_PREFIX/$1"
}

echo "==> pushing SSM parameters"
put INTERNAL_TOKEN        "$INTERNAL_TOKEN"
put STALWART_ADMIN_USER   "$STALWART_ADMIN_USER"
put STALWART_ADMIN_PASSWORD "$STALWART_ADMIN_PASSWORD"

put SPACESHIP_USERNAME    "$(get_env SPACESHIP_USERNAME)"
put SPACESHIP_TOKEN       "$(get_env SPACESHIP_TOKEN)"
CONTACT_ID="$(get_env SPACESHIP_REGISTRANT_CONTACT_ID)"
[ -n "$CONTACT_ID" ] && put SPACESHIP_REGISTRANT_CONTACT_ID "$CONTACT_ID"

# Payments stay on wombat's FAKE processor for launch: no real money moves
# until STRIPE_SECRET_KEY is deliberately pushed here.
put STRIPE_SECRET_KEY     ""
put STRIPE_WEBHOOK_SECRET ""
put FAKE_PAYMENT_FAIL_MIN_CENTS "0"

# Runtime flags (non-secret but convenient to manage alongside)
put COOKIE_SECURE "true"
put APP_ENV       "production"
put MAIL_HOST     "$(grep '^MAIL_HOST=' .env | cut -d= -f2-)"

echo "==> done."
