#!/usr/bin/env bash
# CELLO bootstrap — one-time post-deploy setup for a new environment.
#
# Populates Secrets Manager secrets that CloudFormation creates as empty
# placeholders. Run this ONCE after deploy.sh completes for a new environment.
#
# Usage: ./infra/bootstrap.sh <environment> <region>
#
# Prerequisites:
#   - deploy.sh has completed successfully (secrets placeholders exist)
#   - AWS CLI configured with appropriate credentials
#
# What this does:
#   1. Generates Ed25519 key pair for the directory node
#   2. Generates Ed25519 key pair for the relay node
#   3. Generates a random HMAC secret for GitHub webhooks
#   4. Generates RDS credentials (random password)
#   5. Stores the KMS key ARN in its secret for application use
#
# What this does NOT do (truly manual):
#   - Create Route 53 hosted zone (requires domain registrar)
#   - Create CodeStar Connection (requires GitHub OAuth in AWS console)
#   - Run Flyway migrations (requires network access to RDS)

set -euo pipefail

ENVIRONMENT="${1:-}"
REGION="${2:-}"

if [[ -z "${ENVIRONMENT}" || -z "${REGION}" ]]; then
  echo "Usage: $0 <environment> <region>" >&2
  echo "  environment: dev | staging | production" >&2
  echo "  region:      e.g. us-east-1, eu-central-1, ap-northeast-1" >&2
  exit 1
fi

if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "staging" && "${ENVIRONMENT}" != "production" ]]; then
  echo "ERROR: environment must be one of: dev, staging, production" >&2
  exit 1
fi

echo ""
echo "CELLO Bootstrap: ${ENVIRONMENT} / ${REGION}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Helper: put secret value if not already populated ────────────────────────

put_secret_if_empty() {
  local secret_id="$1"
  local secret_value="$2"
  local description="$3"

  # Check if the secret exists and has a value
  local current
  current=$(aws secretsmanager get-secret-value \
    --secret-id "${secret_id}" \
    --region "${REGION}" \
    --query "SecretString" \
    --output text 2>/dev/null || echo "")

  if [[ -n "${current}" && "${current}" != "PLACEHOLDER" && "${current}" != "PLACEHOLDER_POPULATE_VIA_CLI" && "${current}" != "" ]]; then
    echo "  SKIP: ${description} (already populated)"
    return 0
  fi

  # Secret may not exist yet (not created by CloudFormation) — create or update
  if aws secretsmanager describe-secret --secret-id "${secret_id}" --region "${REGION}" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value \
      --secret-id "${secret_id}" \
      --secret-string "${secret_value}" \
      --region "${REGION}" >/dev/null 2>&1
  else
    aws secretsmanager create-secret \
      --name "${secret_id}" \
      --secret-string "${secret_value}" \
      --region "${REGION}" >/dev/null 2>&1
  fi

  echo "  SET:  ${description}"
}

# ── 1. Directory node Ed25519 private key ────────────────────────────────────

echo "Generating directory node key pair..."
DIR_PRIVATE_KEY=$(openssl genpkey -algorithm ed25519 2>/dev/null | openssl pkey -outform DER 2>/dev/null | tail -c 32 | xxd -p -c 64)
put_secret_if_empty \
  "cello/${ENVIRONMENT}/directory/node-private-key" \
  "${DIR_PRIVATE_KEY}" \
  "Directory node Ed25519 private key"

# ── 2. Relay node Ed25519 private key ────────────────────────────────────────

echo "Generating relay node key pair..."
RELAY_PRIVATE_KEY=$(openssl genpkey -algorithm ed25519 2>/dev/null | openssl pkey -outform DER 2>/dev/null | tail -c 32 | xxd -p -c 64)
put_secret_if_empty \
  "cello/${ENVIRONMENT}/relay/node-private-key" \
  "${RELAY_PRIVATE_KEY}" \
  "Relay node Ed25519 private key"

# ── 3. RDS credentials ──────────────────────────────────────────────────────

echo "Generating RDS credentials..."
RDS_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
RDS_CREDS=$(printf '{"username":"cello_app","password":"%s"}' "${RDS_PASSWORD}")
put_secret_if_empty \
  "cello/${ENVIRONMENT}/directory/rds-credentials" \
  "${RDS_CREDS}" \
  "RDS application credentials"

RDS_ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
RDS_ADMIN_CREDS=$(printf '{"username":"cello_admin","password":"%s"}' "${RDS_ADMIN_PASSWORD}")
put_secret_if_empty \
  "cello/${ENVIRONMENT}/directory/rds-admin-credentials" \
  "${RDS_ADMIN_CREDS}" \
  "RDS admin credentials"

# ── 4. KMS key ARN ──────────────────────────────────────────────────────────

echo "Reading KMS key ARN from stack outputs..."
KMS_KEY_ARN=$(aws cloudformation describe-stacks \
  --region "${REGION}" \
  --stack-name "cello-kms-${ENVIRONMENT}" \
  --query "Stacks[0].Outputs[?OutputKey=='KmsKeyArn'].OutputValue" \
  --output text 2>/dev/null || echo "")

if [[ -n "${KMS_KEY_ARN}" && "${KMS_KEY_ARN}" != "None" ]]; then
  put_secret_if_empty \
    "cello/${ENVIRONMENT}/directory/kms-key-arn" \
    "${KMS_KEY_ARN}" \
    "KMS key ARN"
else
  echo "  WARN: KMS key ARN not found — deploy cello-kms stack first"
fi

# ── 5. Directory envelope key (AES-256) ─────────────────────────────────────

echo "Generating directory envelope key..."
ENVELOPE_KEY=$(openssl rand -hex 32)
put_secret_if_empty \
  "cello/${ENVIRONMENT}/directory/envelope-key" \
  "${ENVELOPE_KEY}" \
  "Directory envelope encryption key (AES-256)"

# ── 6. GitHub webhook HMAC secret ───────────────────────────────────────────

echo "Generating GitHub webhook HMAC secret..."
HMAC_SECRET=$(openssl rand -hex 32)
put_secret_if_empty \
  "cello/${ENVIRONMENT}/pipeline/github-hmac-secret" \
  "${HMAC_SECRET}" \
  "GitHub webhook HMAC secret"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Bootstrap complete: ${ENVIRONMENT} / ${REGION}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Remaining manual steps:"
echo "  1. Create CodeStar Connection in AWS console (GitHub OAuth)"
echo "     Only needed once per account — reuse across regions."
echo "  2. Run Flyway migrations against RDS:"
echo "     Endpoint: $(aws cloudformation describe-stacks \
       --region "${REGION}" \
       --stack-name "cello-rds-${ENVIRONMENT}" \
       --query "Stacks[0].Outputs[?OutputKey=='RdsEndpoint'].OutputValue" \
       --output text 2>/dev/null || echo "(deploy RDS first)")"
echo "  3. Register the HMAC secret in GitHub repo webhook settings"
echo ""
