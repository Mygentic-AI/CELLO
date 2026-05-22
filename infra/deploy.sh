#!/usr/bin/env bash
# CELLO-DEPLOY-001A — Unified deployment script for all CELLO CloudFormation stacks.
#
# Usage: ./infra/deploy.sh <environment> <region>
#
#   environment  One of: dev, staging, production
#   region       AWS region (e.g. us-east-1, eu-central-1, ap-northeast-1)
#
# Post-deploy manual steps (one-time per environment):
#   1. Populate secrets: ./infra/bootstrap.sh <environment> <region>
#   2. Run Flyway migrations against the RDS instance.
#
# ECR repos and stub images are handled automatically:
#   - cello-ecr stack creates repos per-region (Step 0)
#   - Pre-flight check before ECS stacks auto-runs build-stubs.sh if needed
#
# All stacks are idempotent — safe to re-run. Stacks with no changes
# complete silently with no resources recreated.

set -euo pipefail

# ── Argument validation ──────────────────────────────────────────────────────

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

# ── Production confirmation gate (AC-008, SI-002) ────────────────────────────
# Fires on ENVIRONMENT value — not bypassable by flags or env vars.

if [[ "${ENVIRONMENT}" == "production" ]]; then
  echo ""
  echo "WARNING: Deploying to PRODUCTION in ${REGION}."
  printf "Type YES to confirm: "
  read -r CONFIRM
  if [[ "${CONFIRM}" != "YES" ]]; then
    echo "Aborted. No stacks were deployed." >&2
    exit 1
  fi
  echo ""
fi

# ── Runtime values (SI-001: no hardcoded account IDs or ARNs) ────────────────

ACCOUNT_ID=$(aws sts get-caller-identity \
  --query "Account" \
  --output text \
  --region "${REGION}")

# ECR repos are created per-region by cello-ecr stack (deployed as Step 0 below).
# IMAGE_TAG can be overridden: CELLO_IMAGE_TAG=v1.2.3 ./infra/deploy.sh dev us-east-1
IMAGE_TAG="${CELLO_IMAGE_TAG:-stub}"
DIR_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-directory:${IMAGE_TAG}"
RELAY_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-relay:${IMAGE_TAG}"

# ── VPC CIDR per region (Decision 1 from m5-infrastructure-decisions) ────────

case "${REGION}" in
  us-east-1)      VPC_CIDR="10.0.0.0/16" ;;
  eu-central-1)   VPC_CIDR="10.1.0.0/16" ;;
  ap-northeast-1) VPC_CIDR="10.2.0.0/16" ;;
  *)
    echo "WARNING: Region ${REGION} has no pre-assigned VPC CIDR. Using 10.99.0.0/16." >&2
    VPC_CIDR="10.99.0.0/16"
    ;;
esac

# ── Subdomain per region (Decision 6) ────────────────────────────────────────

case "${REGION}" in
  us-east-1)      SUBDOMAIN="directory-us1" ;;
  eu-central-1)   SUBDOMAIN="directory-eu1" ;;
  ap-northeast-1) SUBDOMAIN="directory-ap1" ;;
  *)              SUBDOMAIN="directory-${REGION}" ;;
esac

DOMAIN_NAME="cello.mygentic.ai"

# ── Environment sizing (AC-007) ───────────────────────────────────────────────
# dev/staging: db.t3.small, directory CPU 256/MEM 512
# production:  db.t3.medium, directory CPU 512/MEM 1024
# relay is always 256/512

if [[ "${ENVIRONMENT}" == "production" ]]; then
  RDS_CLASS="db.t3.medium"
  DIR_CPU="512"
  DIR_MEM="1024"
else
  RDS_CLASS="db.t3.small"
  DIR_CPU="256"
  DIR_MEM="512"
fi

RELAY_CPU="256"
RELAY_MEM="512"
# Directory node pubkey — relay needs this to authenticate directory connections.
# Override with CELLO_DIRECTORY_PUBKEY env var if deploying a different environment.
RELAY_DIRECTORY_PUBKEY="${CELLO_DIRECTORY_PUBKEY:-167ca6b145bfdd3696af8f4befd883c3dc610f4a9c8d52a30f6a22f669dc27b5}"

# Relay libp2p multiaddr — directory needs this to connect to the relay at startup.
# Override with CELLO_RELAY_MULTIADDR env var when the relay private IP or peer ID changes.
RELAY_MULTIADDR="${CELLO_RELAY_MULTIADDR:-/ip4/10.0.6.181/tcp/4001/p2p/12D3KooWHA2x2XwnhuP8bMStZ27kzUrjpdz6oxgmmG2WdPCd4WCj}"

# ── GitHub CodeStar Connection ARN ────────────────────────────────────────────
# Set CELLO_GITHUB_CONNECTION_ID to the UUID of the CodeStar connection in us-east-1.
# Find it: aws codestar-connections list-connections --region us-east-1
# Current dev connection: 1a7fba2b-dd1d-4ebe-8372-7122b89f56b5

GITHUB_CONNECTION_ID="${CELLO_GITHUB_CONNECTION_ID:-1a7fba2b-dd1d-4ebe-8372-7122b89f56b5}"
GITHUB_CONNECTION_ARN="arn:aws:codeconnections:us-east-1:${ACCOUNT_ID}:connection/${GITHUB_CONNECTION_ID}"

# ── Route 53 Hosted Zone ID (read at runtime) ─────────────────────────────────

HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name "${DOMAIN_NAME}" \
  --query "HostedZones[0].Id" \
  --output text 2>/dev/null | sed 's|/hostedzone/||' || echo "")

if [[ -z "${HOSTED_ZONE_ID}" || "${HOSTED_ZONE_ID}" == "None" ]]; then
  echo "WARNING: Hosted zone for ${DOMAIN_NAME} not found. Route53 stack will fail." >&2
  HOSTED_ZONE_ID="PLACEHOLDER"
fi

# ── Observability helpers ─────────────────────────────────────────────────────

# cello-cicd deploys to us-east-1 only — adjust count per region
# +1 for cello-rotation (SECOPS-004)
if [[ "${REGION}" == "us-east-1" ]]; then
  STACK_COUNT=12
else
  STACK_COUNT=11
fi
DEPLOY_START=$(date +%s)

log_event() {
  local event_name="$1"
  local message="$2"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ${event_name} ${message}"
}

log_event "infra.deploy.started" "{ \"environment\": \"${ENVIRONMENT}\", \"region\": \"${REGION}\", \"stackCount\": ${STACK_COUNT} }"

# ── Stack deployment helper ───────────────────────────────────────────────────
# deploy_stack STACK_NAME TEMPLATE_FILE [param=value ...]
# Exits non-zero with a clear error on any failure (AC-009).
# Handles "No changes to deploy" as success (AC-005).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFN_DIR="${SCRIPT_DIR}/cloudformation"

deploy_stack() {
  local stack_name="$1"
  local template_file="$2"
  shift 2
  local params=("$@")

  local param_overrides=""
  for param in "${params[@]}"; do
    param_overrides="${param_overrides} ${param}"
  done
  param_overrides="${param_overrides# }"  # trim leading space

  local stack_start
  stack_start=$(date +%s)

  echo ""
  echo "── Deploying ${stack_name} ──────────────────────────────────────────"

  # If the stack is in ROLLBACK_COMPLETE it cannot be updated — delete it first.
  local stack_status
  stack_status=$(aws cloudformation describe-stacks \
    --region "${REGION}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].StackStatus" \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

  if [[ "${stack_status}" == "ROLLBACK_COMPLETE" ]]; then
    echo "  Stack is in ROLLBACK_COMPLETE — deleting before recreating..."
    aws cloudformation delete-stack --region "${REGION}" --stack-name "${stack_name}"
    aws cloudformation wait stack-delete-complete --region "${REGION}" --stack-name "${stack_name}"
    echo "  Deleted. Proceeding with fresh create."
  fi

  local deploy_output
  local deploy_exit=0

  # aws cloudformation deploy exits 255 when there are no changes — that is success.
  deploy_output=$(aws cloudformation deploy \
    --region "${REGION}" \
    --stack-name "${stack_name}" \
    --template-file "${CFN_DIR}/${template_file}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    ${param_overrides:+--parameter-overrides ${param_overrides}} \
    2>&1) || deploy_exit=$?

  if [[ ${deploy_exit} -ne 0 ]]; then
    echo "${deploy_output}" >&2
    echo "" >&2
    echo "ERROR: Stack ${stack_name} failed to deploy (exit ${deploy_exit})" >&2
    # Print the most recent failure events for diagnosis
    aws cloudformation describe-stack-events \
      --region "${REGION}" \
      --stack-name "${stack_name}" \
      --query "StackEvents[?ResourceStatus=='CREATE_FAILED'||ResourceStatus=='UPDATE_FAILED'||ResourceStatus=='ROLLBACK_FAILED'].{Resource:LogicalResourceId,Reason:ResourceStatusReason}" \
      --output table 2>/dev/null || true
    log_event "infra.stack.failed" "{ \"stackName\": \"${stack_name}\", \"environment\": \"${ENVIRONMENT}\", \"region\": \"${REGION}\", \"reason\": \"see events above\" }"
    exit 1
  fi

  local stack_end
  stack_end=$(date +%s)
  local duration_ms=$(( (stack_end - stack_start) * 1000 ))

  if echo "${deploy_output}" | grep -q "No changes to deploy"; then
    echo "  No changes (${duration_ms}ms)"
  else
    echo "${deploy_output}"
  fi

  log_event "infra.stack.deployed" "{ \"stackName\": \"${stack_name}\", \"environment\": \"${ENVIRONMENT}\", \"region\": \"${REGION}\", \"durationMs\": ${duration_ms} }"
}

# ── Stack output reader ───────────────────────────────────────────────────────
# read_output STACK_NAME OUTPUT_KEY

read_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --region "${REGION}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOYMENT SEQUENCE — 11 stacks in dependency order
# ═══════════════════════════════════════════════════════════════════════════════

# ── STEP 0: cello-ecr — ECR repos (no dependencies, must exist before ECS) ──

deploy_stack "cello-ecr-${ENVIRONMENT}" "cello-ecr.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 1: cello-iam — IAM roles (no dependencies) ──────────────────────────

deploy_stack "cello-iam-${ENVIRONMENT}" "cello-iam.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 2: cello-secrets — Secrets Manager placeholders (no dependencies) ───

deploy_stack "cello-secrets-${ENVIRONMENT}" "cello-secrets.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 3: cello-vpc — VPC, subnets, security groups, endpoints ─────────────

deploy_stack "cello-vpc-${ENVIRONMENT}" "cello-vpc.yaml" \
  "Environment=${ENVIRONMENT}" \
  "VpcCidr=${VPC_CIDR}"

# ── STEP 4: cello-kms — KMS key (depends on: cello-iam) ─────────────────────

deploy_stack "cello-kms-${ENVIRONMENT}" "cello-kms.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 5: cello-s3 — S3 buckets (depends on: cello-iam) ───────────────────

deploy_stack "cello-s3-${ENVIRONMENT}" "cello-s3.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 6: cello-rds — RDS PostgreSQL (depends on: cello-vpc) ───────────────

deploy_stack "cello-rds-${ENVIRONMENT}" "cello-rds.yaml" \
  "Environment=${ENVIRONMENT}" \
  "InstanceClass=${RDS_CLASS}"

# ── STEP 6a: cello-rotation — RDS credential rotation Lambda ─────────────────
# depends on: cello-vpc, cello-secrets, cello-iam, cello-rds
# Must deploy BEFORE cello-ecs-directory so that the rotation Lambda ARN export
# (cello-${ENVIRONMENT}-rds-rotation-lambda-arn) is available when cello-secrets.yaml
# references it via !ImportValue in the RotationLambdaARN property.
#
# NOTE: cello-secrets.yaml imports the rotation Lambda ARN. This means cello-rotation
# must deploy before cello-secrets is updated with rotation config. However, cello-secrets
# was deployed in Step 2 without rotation config (to avoid a circular dependency on
# first deploy). On subsequent deploys, Step 2 updates cello-secrets with the rotation
# ARN from cello-rotation. The sequence is correct for re-deployments.
# On first deploy: cello-secrets deploys with no rotation config (placeholder).
#                  cello-rotation deploys and exports the Lambda ARN.
#                  cello-secrets update (Step 2 re-run or manual) wires in the ARN.
# On re-deploy: cello-secrets picks up the ARN from the already-deployed cello-rotation.

deploy_stack "cello-rotation-${ENVIRONMENT}" "cello-rotation.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 6.5: Pre-flight — ensure container images exist in ECR ──────────────
# If the image tag doesn't exist, build and push stubs automatically.
# This prevents ECS tasks from failing to start on a fresh deployment.

echo ""
echo "── Pre-flight: verifying container images in ECR ─────────────────────"

image_exists() {
  aws ecr describe-images \
    --region "${REGION}" \
    --repository-name "$1" \
    --image-ids imageTag="${IMAGE_TAG}" \
    >/dev/null 2>&1
}

if image_exists "cello-directory" && image_exists "cello-relay"; then
  echo "  Images exist: cello-directory:${IMAGE_TAG}, cello-relay:${IMAGE_TAG}"
else
  echo "  Images not found for tag '${IMAGE_TAG}' — building and pushing stubs..."
  "${SCRIPT_DIR}/build-stubs.sh" "${REGION}"
fi

# ── STEP 7: cello-ecs-directory — directory ECS service ──────────────────────
# depends on: cello-iam, cello-kms, cello-vpc, cello-ecr

deploy_stack "cello-ecs-directory-${ENVIRONMENT}" "cello-ecs-directory.yaml" \
  "Environment=${ENVIRONMENT}" \
  "Cpu=${DIR_CPU}" \
  "Memory=${DIR_MEM}" \
  "ImageUri=${DIR_IMAGE}" \
  "RelayMultiaddr=${RELAY_MULTIADDR}"

# ── STEP 8: Read ALB outputs from cello-ecs-directory (AC-006) ───────────────
# ALB DNS name and hosted zone ID are runtime values — not knowable at script-write time.
# We read them via describe-stacks to pass to cello-route53. No hardcoded ALB values.

echo ""
echo "── Reading ALB outputs from cello-ecs-directory-${ENVIRONMENT} ─────────────"

ALB_DNS_NAME=$(read_output "cello-ecs-directory-${ENVIRONMENT}" "AlbDnsName" || echo "")
ALB_HOSTED_ZONE_ID=$(read_output "cello-ecs-directory-${ENVIRONMENT}" "AlbHostedZoneId" || echo "")

if [[ -z "${ALB_DNS_NAME}" || "${ALB_DNS_NAME}" == "None" ]]; then
  echo "WARNING: AlbDnsName output not found in cello-ecs-directory-${ENVIRONMENT}." >&2
  echo "         Route53 stack may fail. Ensure the ECS service has an attached ALB." >&2
  ALB_DNS_NAME="PLACEHOLDER"
  ALB_HOSTED_ZONE_ID="PLACEHOLDER"
else
  echo "  AlbDnsName:       ${ALB_DNS_NAME}"
  echo "  AlbHostedZoneId:  ${ALB_HOSTED_ZONE_ID}"
fi

# ── STEP 9: cello-ecs-relay — relay ECS service ───────────────────────────────
# depends on: cello-iam, cello-vpc, cello-ecs-directory (for cluster ARN)

deploy_stack "cello-ecs-relay-${ENVIRONMENT}" "cello-ecs-relay.yaml" \
  "Environment=${ENVIRONMENT}" \
  "Cpu=${RELAY_CPU}" \
  "Memory=${RELAY_MEM}" \
  "ImageUri=${RELAY_IMAGE}" \
  "DirectoryNodePubkey=${RELAY_DIRECTORY_PUBKEY}"

# ── STEP 10: cello-route53 — Route 53 ALIAS records and ACM certs ────────────
# depends on: cello-ecs-directory (ALB outputs read in Step 8)

deploy_stack "cello-route53-${ENVIRONMENT}" "cello-route53.yaml" \
  "Environment=${ENVIRONMENT}" \
  "DomainName=${DOMAIN_NAME}" \
  "HostedZoneId=${HOSTED_ZONE_ID}" \
  "AlbDnsName=${ALB_DNS_NAME}" \
  "AlbHostedZoneId=${ALB_HOSTED_ZONE_ID}" \
  "Subdomain=${SUBDOMAIN}"

# ── STEP 11: cello-cicd — CI/CD infrastructure (us-east-1 only) ──────────────

if [[ "${REGION}" == "us-east-1" ]]; then
  deploy_stack "cello-cicd-${ENVIRONMENT}" "cello-cicd.yaml" \
    "Environment=${ENVIRONMENT}" \
    "GitHubConnectionArn=${GITHUB_CONNECTION_ARN}"
else
  echo ""
  echo "── Skipping cello-cicd (us-east-1 only, current region: ${REGION}) ──────"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOYMENT COMPLETE — print summary
# ═══════════════════════════════════════════════════════════════════════════════

DEPLOY_END=$(date +%s)
TOTAL_DURATION_MS=$(( (DEPLOY_END - DEPLOY_START) * 1000 ))

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  CELLO deployment complete: ${ENVIRONMENT} / ${REGION}"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "Key outputs:"

RDS_ENDPOINT=$(read_output "cello-rds-${ENVIRONMENT}" "RdsEndpoint" 2>/dev/null || echo "(unavailable)")
KMS_KEY_ARN=$(read_output "cello-kms-${ENVIRONMENT}" "KmsKeyArn" 2>/dev/null || echo "(unavailable)")

echo "  RDS endpoint:   ${RDS_ENDPOINT}"
echo "  KMS key ARN:    ${KMS_KEY_ARN}"
echo "  ALB DNS name:   ${ALB_DNS_NAME}"
echo ""
echo "Stacks deployed:"
for stack in \
  "cello-ecr-${ENVIRONMENT}" \
  "cello-iam-${ENVIRONMENT}" \
  "cello-secrets-${ENVIRONMENT}" \
  "cello-vpc-${ENVIRONMENT}" \
  "cello-kms-${ENVIRONMENT}" \
  "cello-s3-${ENVIRONMENT}" \
  "cello-rds-${ENVIRONMENT}" \
  "cello-rotation-${ENVIRONMENT}" \
  "cello-ecs-directory-${ENVIRONMENT}" \
  "cello-ecs-relay-${ENVIRONMENT}" \
  "cello-route53-${ENVIRONMENT}"; do
  echo "  ${stack}"
done
if [[ "${REGION}" == "us-east-1" ]]; then
  echo "  cello-cicd-${ENVIRONMENT}"
fi

echo ""
echo "Next steps (one-time, if first deploy):"
echo "  1. Populate secrets: ./infra/bootstrap.sh ${ENVIRONMENT} ${REGION}"
echo "  2. Run Flyway migrations against the RDS endpoint: ${RDS_ENDPOINT}"
echo ""


# ── Update infra/STATE.md ─────────────────────────────────────────────────────

update_state() {
  local state_file="${SCRIPT_DIR}/STATE.md"
  local today
  today=$(date -u '+%Y-%m-%d')

  # Read all stack statuses for this environment/region
  local stack_statuses
  stack_statuses=$(aws cloudformation describe-stacks     --region "${REGION}"     --query "Stacks[?starts_with(StackName, \`cello-\`)].{Name:StackName,Status:StackStatus}"     --output json 2>/dev/null || echo "[]")

  # Read key outputs
  local rds_endpoint
  rds_endpoint=$(aws cloudformation describe-stacks     --region "${REGION}" --stack-name "cello-rds-${ENVIRONMENT}"     --query "Stacks[0].Outputs[?OutputKey=='RdsEndpoint'].OutputValue"     --output text 2>/dev/null || echo "pending")

  local alb_dns
  alb_dns=$(aws cloudformation describe-stacks     --region "${REGION}" --stack-name "cello-ecs-directory-${ENVIRONMENT}"     --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue"     --output text 2>/dev/null || echo "pending")

  # Rewrite the state file header and env section
  # Strategy: append a dated deploy record — full rewrite happens via deploy.sh on each full deploy
  local marker="### ${ENVIRONMENT} — ${REGION}"
  if grep -q "${marker}" "${state_file}" 2>/dev/null; then
    # Update last deployed date in-place using Python for reliable multiline edit
    python3 - "${state_file}" "${ENVIRONMENT}" "${REGION}" "${today}" "${rds_endpoint}" "${alb_dns}" << 'PYEOF_INNER'
import sys, re

state_file, env, region, today, rds_endpoint, alb_dns = sys.argv[1:]
with open(state_file) as f:
    content = f.read()

# Update last deployed date
content = re.sub(
    rf"(### {re.escape(env)} — {re.escape(region)}\n\*Last deployed:) [^\n]+",
    rf"\1 {today}",
    content
)

# Update RDS endpoint if not pending
if rds_endpoint and rds_endpoint != "pending" and rds_endpoint != "None":
    content = re.sub(r"\| RDS Endpoint \|[^\n]+", f"| RDS Endpoint | {rds_endpoint} |", content)

# Update ALB if not pending
if alb_dns and alb_dns != "pending" and alb_dns != "None":
    content = re.sub(r"\| Directory ALB \|[^\n]+", f"| Directory ALB | {alb_dns} |", content)

with open(state_file, "w") as f:
    f.write(content)
PYEOF_INNER
  fi
  echo "infra/STATE.md updated."
}

update_state

log_event "infra.deploy.completed" "{ \"environment\": \"${ENVIRONMENT}\", \"region\": \"${REGION}\", \"totalDurationMs\": ${TOTAL_DURATION_MS}, \"stackCount\": ${STACK_COUNT} }"
