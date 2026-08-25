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
if [ -n "$CONTACT_ID" ]; then
  put SPACESHIP_REGISTRANT_CONTACT_ID "$CONTACT_ID"
fi

# Payments: STRIPE keys from .env are TEST-mode keys, so pushing them turns
# on the real Stripe flow without real money. Remove them from .env (or this
# script) to fall back to wombat's fake processor.
STRIPE_SECRET_VALUE="$(get_env STRIPE_SECRET_KEY)"
if [ -n "$STRIPE_SECRET_VALUE" ]; then
  put STRIPE_SECRET_KEY "$STRIPE_SECRET_VALUE"
fi
WEBHOOK_SECRET_VALUE="$(get_env STRIPE_WEBHOOK_SECRET)"
if [ -n "$WEBHOOK_SECRET_VALUE" ]; then
  put STRIPE_WEBHOOK_SECRET "$WEBHOOK_SECRET_VALUE"
fi
PUBLISHABLE_VALUE="$(get_env STRIPE_PUBLISHABLE_KEY)"
if [ -n "$PUBLISHABLE_VALUE" ]; then
  # Baked into the client bundle at image build time (Next.js public env).
  put NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY "$PUBLISHABLE_VALUE"
fi
put FAKE_PAYMENT_FAIL_MIN_CENTS "0"

# Runtime flags (non-secret but convenient to manage alongside)
put COOKIE_SECURE "true"
put APP_ENV       "production"
# MAIL_HOST override: point customer MX records at the EC2 host via sslip.io
# wildcard DNS until a real mail hostname (d2domains.com) is available.
MAIL_HOST_VALUE="${D2_MAIL_HOST:-$(get_env MAIL_HOST)}"
[ -n "$MAIL_HOST_VALUE" ] || MAIL_HOST_VALUE="mail.d2domains.dev"
put MAIL_HOST "$MAIL_HOST_VALUE"

echo "==> done."
