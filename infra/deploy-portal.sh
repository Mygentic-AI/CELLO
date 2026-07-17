#!/usr/bin/env bash
#
# deploy-portal.sh — idempotent, reproducible deploy of the M8 operator portal (us-east-1).
#
# Codifies the full portal deploy as IaC so it passes the region-expansion test ("would this work
# in a brand-new environment with zero manual steps?"). Orchestrates, in order:
#   1. build stack   (ECR + S3 source + CodeBuild)        — cello-portal-build.yaml
#   2. image build   (CodeBuild from the committed tree)  — build-portal.sh  (NEVER docker push from local)
#   3. data stack    (SGs + RDS + ACM cert)               — cello-portal-data.yaml
#   4. secrets       (kms-master-key CREATE-ONCE, db-url) — create-portal-secrets.sh
#   5. app stack     (ALB/HTTPS + Route53 + ECS + alarm)  — cello-portal-app.yaml
#   6. verify        (HTTPS /sign-in == 200)
#
# Idempotent: re-running updates each stack in place; the KMS master key is never regenerated.
# The portal reaches the directory over its PUBLIC ALB /internal/* (header-authenticated) — it does
# NOT need to be in the directory VPC for directory access, only for its own RDS.
#
# Usage:  infra/deploy-portal.sh [dev|staging|production]
#   env:  CELLO_REGION (default us-east-1), PORTAL_DIR (default ../cello-portal),
#         ALARM_TOPIC_ARN (optional SNS topic for the delivery-failure alarm)
set -euo pipefail

ENV="${1:-dev}"
# Never read AWS_REGION — Bedrock injects it as us-west-1. Use CELLO_REGION.
REGION="${CELLO_REGION:-us-east-1}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CFN="$HERE/cloudformation"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ALARM_TOPIC_ARN="${ALARM_TOPIC_ARN:-arn:aws:sns:${REGION}:${ACCOUNT}:cello-ops-warning-${ENV}}"

say() { printf '\n=== %s ===\n' "$1"; }

# ── 1. build stack ────────────────────────────────────────────────────────────
say "1/6 build stack (ECR + S3 source + CodeBuild)"
aws cloudformation deploy \
  --template-file "$CFN/cello-portal-build.yaml" \
  --stack-name "cello-portal-build-${ENV}" \
  --parameter-overrides "Environment=${ENV}" \
  --capabilities CAPABILITY_NAMED_IAM --region "$REGION"

# ── 2. image build (CodeBuild) ────────────────────────────────────────────────
say "2/6 image build via CodeBuild"
SHORT="$(cd "${PORTAL_DIR:-/Users/andrep/Documents/code/cello-portal}" && git rev-parse --short HEAD)"
"$HERE/build-portal.sh" "$ENV"
BID="$(aws codebuild list-builds-for-project --project-name "cello-portal-build-${ENV}" \
  --region "$REGION" --query 'ids[0]' --output text)"
echo "waiting for $BID ..."
while :; do
  S="$(aws codebuild batch-get-builds --ids "$BID" --region "$REGION" --query 'builds[0].buildStatus' --output text | head -1 | tr -d '[:space:]')"
  [ "$S" != "IN_PROGRESS" ] && break
  sleep 15
done
[ "$S" = "SUCCEEDED" ] || { echo "CodeBuild $S"; exit 1; }
echo "image cello-portal:${SHORT} pushed"

# ── 3. data stack (RDS + ACM + SGs) ───────────────────────────────────────────
say "3/6 data stack (SGs + RDS + ACM cert)"
aws cloudformation deploy \
  --template-file "$CFN/cello-portal-data.yaml" \
  --stack-name "cello-portal-data-${ENV}" \
  --parameter-overrides "Environment=${ENV}" \
  --capabilities CAPABILITY_NAMED_IAM --region "$REGION"

# ── 4. secrets (kms-master-key CREATE-ONCE, database-url) ──────────────────────
say "4/6 secrets"
SECRETS_OUT="$("$HERE/create-portal-secrets.sh" "$ENV")"
echo "$SECRETS_OUT"
KMS_ARN="$(echo "$SECRETS_OUT" | sed -n 's/^KMS_MASTER_KEY_SECRET_ARN=//p')"
DBURL_ARN="$(echo "$SECRETS_OUT" | sed -n 's/^DATABASE_URL_SECRET_ARN=//p')"
SEED_ARN="$(echo "$SECRETS_OUT" | sed -n 's/^SUBMISSION_SEED_SECRET_ARN=//p')"
[ -n "$KMS_ARN" ] && [ -n "$DBURL_ARN" ] && [ -n "$SEED_ARN" ] || { echo "secret ARNs missing"; exit 1; }
GITHUB_OAUTH_ARN="$(aws secretsmanager describe-secret --secret-id "cello/${ENV}/portal/github-oauth" \
  --region "$REGION" --query 'ARN' --output text 2>/dev/null || true)"
[ -n "$GITHUB_OAUTH_ARN" ] || { echo "WARN: cello/${ENV}/portal/github-oauth not found — GitHub OAuth will be unavailable"; }

# Submission signer KMS key ID — required for all non-local envs (getSubmissionSigner fails closed).
SUBMISSION_KMS_KEY_ID="$(aws kms describe-key --key-id "alias/cello-${ENV}-submission-signer" \
  --region "$REGION" --query 'KeyMetadata.KeyId' --output text 2>/dev/null || true)"
[ -n "$SUBMISSION_KMS_KEY_ID" ] || { echo "WARN: alias/cello-${ENV}-submission-signer not found — GitHub OAuth and WebAuthn minting will fail"; }

# ── 5. app stack (ALB/HTTPS + Route53 + ECS + alarm) ──────────────────────────
say "5/6 app stack (ALB + ECS + Route53 + alarm), image=${SHORT}"
aws cloudformation deploy \
  --template-file "$CFN/cello-portal-app.yaml" \
  --stack-name "cello-portal-${ENV}" \
  --parameter-overrides \
    "Environment=${ENV}" \
    "ImageTag=${SHORT}" \
    "DatabaseUrlSecretArn=${DBURL_ARN}" \
    "KmsMasterKeySecretArn=${KMS_ARN}" \
    "SubmissionSeedSecretArn=${SEED_ARN}" \
    "GitHubOAuthSecretArn=${GITHUB_OAUTH_ARN}" \
    "SubmissionSignerKmsKeyId=${SUBMISSION_KMS_KEY_ID}" \
    "AlarmTopicArn=${ALARM_TOPIC_ARN}" \
  --capabilities CAPABILITY_NAMED_IAM --region "$REGION"

# ── 6. verify ─────────────────────────────────────────────────────────────────
say "6/6 verify"
HOST="$(aws cloudformation describe-stacks --stack-name "cello-portal-${ENV}" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='PortalUrl'].OutputValue" --output text)"
echo "portal: $HOST"
for i in $(seq 1 20); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "${HOST}/sign-in" --max-time 10 || echo 000)"
  echo "[$i] GET ${HOST}/sign-in -> $CODE"
  [ "$CODE" = "200" ] && { echo "PORTAL LIVE"; exit 0; }
  sleep 10
done
echo "portal did not return 200 — check ECS service events + /ecs/cello-portal-${ENV} logs"; exit 1
