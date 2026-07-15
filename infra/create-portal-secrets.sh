#!/usr/bin/env bash
#
# create-portal-secrets.sh — create the portal's runtime secrets AFTER its RDS exists.
#
#   cello/{env}/portal/kms-master-key   64-hex (encrypts operator email + TOTP at rest, DOD-INV-2).
#                                       CREATE-ONCE — never regenerated if it exists (that would make
#                                       all existing ciphertext unrecoverable).
#   cello/{env}/portal/database-url     postgres://…?sslmode=no-verify (from the RDS managed master
#                                       secret + endpoint).
#   cello/{env}/portal/submission-seed  32-byte hex Ed25519 seed for the M10 trust-signal submission
#                                       signer (M10-D6). CREATE-ONCE — its PUBLIC key is enrolled in
#                                       the directory's authorized_issuers (role submitter); rotating
#                                       it would orphan the enrollment and every mint would be
#                                       rejected. dev value is the enrolled 'de'×32 key (pubkey
#                                       8d4abe07…). staging/production sign via KMS, not this secret.
#
# Prints the three secret ARNs (for the app stack's *SecretArn parameters).
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

# Build the URL in python and URL-ENCODE the username + password. RDS-generated passwords routinely
# contain URL-unsafe characters (#, /, @, :, ?, %); an un-encoded '#' truncates the connection string
# at the fragment, so the portal silently connects to the wrong/no DB. quote(safe="") encodes them all.
DB_URL="$(ENDPOINT="$ENDPOINT" PORT="$PORT" python3 - "$MASTER_JSON" <<'PY'
import json, os, sys, urllib.parse
m = json.loads(sys.argv[1])
u = urllib.parse.quote(m["username"], safe="")
p = urllib.parse.quote(m["password"], safe="")
print(f'postgres://{u}:{p}@{os.environ["ENDPOINT"]}:{os.environ["PORT"]}/cello_portal?sslmode=no-verify')
PY
)"

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

# ── submission-seed: create-once (dev = the enrolled 'de'×32 key) ─────────────
# CREATE-ONCE with a FIXED value: the pubkey derived from this seed is already enrolled in the
# directory's authorized_issuers. A random seed would derive an UN-enrolled pubkey and every mint
# would be rejected (signal_not_authorized). Never regenerate. dev only — staging/production sign
# via KMS and getSubmissionSigner FAILS CLOSED there rather than reading this secret.
SEED_NAME="cello/${ENV}/portal/submission-seed"
if aws secretsmanager describe-secret --secret-id "$SEED_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "submission-seed already exists — leaving untouched (CREATE-ONCE; pubkey is enrolled)" >&2
  SEED_ARN="$(aws secretsmanager describe-secret --secret-id "$SEED_NAME" --region "$REGION" --query ARN --output text)"
else
  # dev enrolled key. Any future non-dev env must instead wire KMS (never create this secret there).
  SEED_VAL="$(printf 'de%.0s' $(seq 1 32))"
  SEED_ARN="$(aws secretsmanager create-secret --name "$SEED_NAME" --region "$REGION" \
    --description "Portal M10 trust-signal submission signer seed (32-byte hex, Ed25519). Pubkey enrolled in authorized_issuers. CREATE-ONCE." \
    --secret-string "$SEED_VAL" --query ARN --output text)"
  echo "created submission-seed (dev enrolled key)" >&2
fi

echo "KMS_MASTER_KEY_SECRET_ARN=${KMS_ARN}"
echo "DATABASE_URL_SECRET_ARN=${DBURL_ARN}"
echo "SUBMISSION_SEED_SECRET_ARN=${SEED_ARN}"
