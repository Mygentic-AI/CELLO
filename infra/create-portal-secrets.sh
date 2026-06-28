#!/usr/bin/env bash
#
# create-portal-secrets.sh — create the portal's runtime secrets AFTER its RDS exists.
#
#   cello/{env}/portal/kms-master-key   64-hex (encrypts operator email + TOTP at rest, DOD-INV-2).
#                                       CREATE-ONCE — never regenerated if it exists (that would make
#                                       all existing ciphertext unrecoverable).
#   cello/{env}/portal/database-url     postgres://…?sslmode=no-verify (from the RDS managed master
#                                       secret + endpoint).
#
# Prints the two secret ARNs (for the app stack's *SecretArn parameters).
# Usage:  infra/create-portal-secrets.sh [dev|staging|production]
set -euo pipefail

ENV="${1:-dev}"
REGION="${AWS_REGION:-us-east-1}"
STACK="cello-portal-data-${ENV}"

get_out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

ENDPOINT="$(get_out PortalDbEndpoint)"
PORT="$(get_out PortalDbPort)"
MASTER_ARN="$(get_out PortalDbMasterSecretArn)"
[ -n "$ENDPOINT" ] && [ -n "$MASTER_ARN" ] || { echo "data stack outputs missing — is RDS up?"; exit 1; }

MASTER_JSON="$(aws secretsmanager get-secret-value --secret-id "$MASTER_ARN" --region "$REGION" \
  --query SecretString --output text)"
DB_USER="$(printf '%s' "$MASTER_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["username"])')"
DB_PASS="$(printf '%s' "$MASTER_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["password"])')"

DB_URL="postgres://${DB_USER}:${DB_PASS}@${ENDPOINT}:${PORT}/cello_portal?sslmode=no-verify"

# ── kms-master-key: create-once ──────────────────────────────────────────────
KMS_NAME="cello/${ENV}/portal/kms-master-key"
if aws secretsmanager describe-secret --secret-id "$KMS_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "kms-master-key already exists — leaving untouched (CREATE-ONCE)" >&2
  KMS_ARN="$(aws secretsmanager describe-secret --secret-id "$KMS_NAME" --region "$REGION" --query ARN --output text)"
else
  KMS_VAL="$(openssl rand -hex 32)"
  KMS_ARN="$(aws secretsmanager create-secret --name "$KMS_NAME" --region "$REGION" \
    --description "Portal envelope master key (64-hex, AES-256). DOD-INV-2." \
    --secret-string "$KMS_VAL" --query ARN --output text)"
  echo "created kms-master-key" >&2
fi

# ── database-url: create-or-update ───────────────────────────────────────────
DBURL_NAME="cello/${ENV}/portal/database-url"
if aws secretsmanager describe-secret --secret-id "$DBURL_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "$DBURL_NAME" --region "$REGION" \
    --secret-string "$DB_URL" >/dev/null
  DBURL_ARN="$(aws secretsmanager describe-secret --secret-id "$DBURL_NAME" --region "$REGION" --query ARN --output text)"
  echo "updated database-url" >&2
else
  DBURL_ARN="$(aws secretsmanager create-secret --name "$DBURL_NAME" --region "$REGION" \
    --description "Portal Postgres connection URL (incl. password)." \
    --secret-string "$DB_URL" --query ARN --output text)"
  echo "created database-url" >&2
fi

echo "KMS_MASTER_KEY_SECRET_ARN=${KMS_ARN}"
echo "DATABASE_URL_SECRET_ARN=${DBURL_ARN}"
