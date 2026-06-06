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
# Image URIs are read from SSM (set by CI/CD pipelines) when available.
# Fallback: CELLO_IMAGE_TAG env var or "stub" for fresh deployments.
IMAGE_TAG="${CELLO_IMAGE_TAG:-stub}"
DIR_IMAGE=$(aws ssm get-parameter --name "/cello/${ENVIRONMENT}/pipeline/directory-image-uri" --region us-east-1 --query 'Parameter.Value' --output text 2>/dev/null | sed "s/\.us-east-1\./.${REGION}./" || echo "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-directory:${IMAGE_TAG}")
RELAY_IMAGE=$(aws ssm get-parameter --name "/cello/${ENVIRONMENT}/pipeline/relay-image-uri" --region us-east-1 --query 'Parameter.Value' --output text 2>/dev/null | sed "s/\.us-east-1\./.${REGION}./" || echo "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-relay:${IMAGE_TAG}")
OPS_AGENT_IMAGE=$(aws ssm get-parameter --name "/cello/${ENVIRONMENT}/pipeline/operations-agent-image-uri" --region us-east-1 --query 'Parameter.Value' --output text 2>/dev/null | sed "s/\.us-east-1\./.${REGION}./" || echo "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-operations-agent:${IMAGE_TAG}")

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

# ── Relay subdomain per region (M6B-007 AC-003) ──────────────────────────────
# relay-us1/eu1/ap1 map to the relay ALB A record in cello-route53-relay stack.
# Deployed as a second invocation of cello-route53.yaml with the relay ALB outputs.

case "${REGION}" in
  us-east-1)      RELAY_SUBDOMAIN="relay-us1" ;;
  eu-central-1)   RELAY_SUBDOMAIN="relay-eu1" ;;
  ap-northeast-1) RELAY_SUBDOMAIN="relay-ap1" ;;
  *)              RELAY_SUBDOMAIN="relay-${REGION}" ;;
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
RELAY_MULTIADDR="${CELLO_RELAY_MULTIADDR:-/ip4/10.0.85.235/tcp/4001/p2p/12D3KooWDbUVg6tnvDu1quscr6cmHJ8jke4mZsh85RNqvwT8UPy9}"

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

# ── Pre-flight checks ────────────────────────────────────────────────────────
# Validate environment state before touching any stacks. Fail fast with a clear
# error rather than discovering problems mid-deploy after 20 minutes of progress.

echo ""
echo "── Pre-flight checks ────────────────────────────────────────────────────────"

preflight_errors=0

# 1. Migration files exist — deploy.sh computes version dynamically, no hardcoded numbers.
HIGHEST_MIGRATION=$(ls "${SCRIPT_DIR}/../packages/directory/db/migrations"/V*.sql 2>/dev/null \
  | sed 's/.*\/V\([0-9]*\)__.*/\1/' | sort -n | tail -1)
if [[ -z "${HIGHEST_MIGRATION}" ]]; then
  echo "  ERROR: No V*.sql migration files found in packages/directory/db/migrations/" >&2
  preflight_errors=$((preflight_errors + 1))
else
  echo "  Migration files: highest is V${HIGHEST_MIGRATION} — will be written to SSM after deploy"
fi

# 2. Stale Route53 DNS records: warn if directory or relay records exist outside CFN.
# (We do not delete here — purge_stale_dns_record() handles deletion just before each stack.)
if [[ -n "${HOSTED_ZONE_ID}" && "${HOSTED_ZONE_ID}" != "PLACEHOLDER" ]]; then
  for subdomain in "${SUBDOMAIN}" "${RELAY_SUBDOMAIN}"; do
    fqdn="${subdomain}.${DOMAIN_NAME}."
    record=$(aws route53 list-resource-record-sets \
      --hosted-zone-id "${HOSTED_ZONE_ID}" \
      --query "ResourceRecordSets[?Name=='${fqdn}'] | [0]" \
      --output json 2>/dev/null)
    if [[ -n "${record}" && "${record}" != "null" ]]; then
      echo "  WARNING: Stale DNS record ${fqdn} exists — will be purged before route53 stack deploy."
    else
      echo "  DNS record ${fqdn}: clean — OK"
    fi
  done
fi

# 3. Required secrets must exist (not necessarily populated — just present).
for secret in \
  "cello/${ENVIRONMENT}/relay/transport-key" \
  "cello/${ENVIRONMENT}/directory/transport-key" \
  "cello/${ENVIRONMENT}/directory/node-private-key"; do
  result=$(aws secretsmanager describe-secret --secret-id "${secret}" --region "${REGION}" \
    --query 'Name' --output text 2>/dev/null)
  if [[ -z "${result}" || "${result}" == "None" ]]; then
    echo "  ERROR: Required secret missing: ${secret}" >&2
    preflight_errors=$((preflight_errors + 1))
  else
    echo "  Secret ${secret}: exists — OK"
  fi
done

if [[ ${preflight_errors} -gt 0 ]]; then
  echo ""
  echo "ERROR: ${preflight_errors} pre-flight check(s) failed. Fix above errors before deploying." >&2
  exit 1
fi

echo "  Pre-flight checks passed."
echo ""

# ── Observability helpers ─────────────────────────────────────────────────────

# cello-cicd deploys to us-east-1 only — adjust count per region.
# +1 for cello-ecs-operations-agent (OPS-AGENT-005A)
# +1 for cello-route53-relay (M6B-007 AC-003) — relay DNS stack deploys in every region
# +1 for cello-ssm-parameters (M6B-011 AC-004) — SSM Parameter Store values
if [[ "${REGION}" == "us-east-1" ]]; then
  STACK_COUNT=17
else
  STACK_COUNT=16
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

  # Templates larger than 51,200 bytes must be uploaded via S3.
  # Use the existing cloudformation-templates prefix in the artifacts bucket.
  local template_size
  template_size=$(wc -c < "${CFN_DIR}/${template_file}" 2>/dev/null || echo 0)
  local s3_bucket_arg=""
  if [[ "${template_size}" -gt 51200 ]]; then
    local cfn_bucket="cello-audit-logs-${ENVIRONMENT}-${REGION}"
    s3_bucket_arg="--s3-bucket ${cfn_bucket} --s3-prefix cloudformation-templates"
  fi

  # aws cloudformation deploy exits 255 when there are no changes — that is success.
  deploy_output=$(aws cloudformation deploy \
    --region "${REGION}" \
    --stack-name "${stack_name}" \
    --template-file "${CFN_DIR}/${template_file}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    ${s3_bucket_arg} \
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

# purge_stale_dns_record: delete a Route53 record if it exists outside CFN ownership.
# Route53 records survive stack deletion (the hosted zone is never torn down).
# CFN can only CREATE a record it doesn't already own — a pre-existing record causes
# CREATE_FAILED with "record set already exists". We delete it so CFN can own it cleanly.
purge_stale_dns_record() {
  local hosted_zone_id="$1"
  local fqdn="$2."   # Route53 stores names with trailing dot
  if [[ -z "${hosted_zone_id}" || "${hosted_zone_id}" == "PLACEHOLDER" ]]; then
    return 0
  fi
  local record
  record=$(aws route53 list-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --query "ResourceRecordSets[?Name=='${fqdn}'] | [0]" \
    --output json 2>/dev/null)
  if [[ -z "${record}" || "${record}" == "null" ]]; then
    return 0
  fi
  echo "  Pre-flight: stale DNS record ${fqdn} exists — deleting before CFN create..."
  local change_batch
  change_batch=$(printf '{"Changes":[{"Action":"DELETE","ResourceRecordSet":%s}]}' "${record}")
  aws route53 change-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --change-batch "${change_batch}" \
    --output json > /dev/null
  echo "  Deleted stale DNS record ${fqdn}."
}

# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOYMENT SEQUENCE — 16 stacks in dependency order (17 in us-east-1 with cello-cicd)
#
# Step 0:  cello-ecr                    — ECR repos
# Step 1:  cello-iam                    — IAM roles
# Step 2:  cello-secrets                — Secrets Manager placeholders
# Step 2b: cello-ssm-parameters         — SSM Parameter Store values (M6B-011)
# Step 3:  cello-vpc                    — VPC, subnets, security groups
# Step 4:  cello-kms                    — KMS key
# Step 5:  cello-s3                     — S3 buckets
# Step 6:  cello-rds                    — RDS PostgreSQL
# Step 6a: cello-rotation               — RDS credential rotation Lambda
# Step 6.5: pre-flight image check
# Step 6.6: SSM parameters (imperative put-parameter for manifest-signer-pubkey)
# Step 7:  cello-ecs-directory          — directory ECS service + ALB
# Step 8:  read directory ALB outputs
# Step 8a: Ops Agent RDS rotation check — first-deploy credential setup
# Step 9:  cello-ecs-operations-agent   — Operations Agent ECS service
# Step 10: cello-waf                    — WAF WebACL for directory ALB
# Step 11: cello-ecs-relay              — relay ECS service + relay ALB (M6B-007)
# Step 12: cello-cloudwatch             — CloudWatch alarms + dashboards
# Step 13: cello-route53                — directory Route 53 ALIAS records + ACM certs
# Step 13b: cello-route53-relay         — relay Route 53 ALIAS records + ACM cert (M6B-007)
# Step 14: cello-cicd                   — CI/CD pipelines (us-east-1 only)
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

# ── STEP 2b: cello-ssm-parameters — SSM Parameter Store values (M6B-011) ─────
# Creates /cello/${Environment}/ops-agent/expected-migration-version used by
# the Operations Agent ECS task definition (ValueFrom reference). This stack
# has no dependencies and must exist before cello-ecs-operations-agent deploys.
#
# The migration version is computed dynamically from the highest V{N}.sql file
# in packages/directory/db/migrations/. No hardcoded version numbers anywhere.
# After every deploy, SSM is set to this computed value — CFN template default
# is irrelevant and ignored.

echo ""
echo "── Setting SSM migration version from migration files ────────────────"
COMPUTED_MIGRATION_VERSION=$(ls "${SCRIPT_DIR}/../packages/directory/db/migrations"/V*.sql 2>/dev/null \
  | sed 's/.*\/V\([0-9]*\)__.*/\1/' | sort -n | tail -1)

if [[ -z "${COMPUTED_MIGRATION_VERSION}" ]]; then
  echo "  ERROR: No V*.sql migration files found in packages/directory/db/migrations/" >&2
  exit 1
fi
echo "  Highest migration file: V${COMPUTED_MIGRATION_VERSION}"

deploy_stack "cello-ssm-parameters-${ENVIRONMENT}" "cello-ssm-parameters.yaml" \
  "Environment=${ENVIRONMENT}"

# Always write the computed value — overrides whatever CFN just set.
aws ssm put-parameter \
  --name "/cello/${ENVIRONMENT}/ops-agent/expected-migration-version" \
  --value "${COMPUTED_MIGRATION_VERSION}" \
  --type String \
  --overwrite \
  --region "${REGION}" \
  --output text --query Version >/dev/null 2>&1
echo "  SSM /cello/${ENVIRONMENT}/ops-agent/expected-migration-version = ${COMPUTED_MIGRATION_VERSION}"

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

image_exists_by_uri() {
  local uri="$1"
  local repo_name=$(echo "$uri" | sed 's|.*/||' | cut -d: -f1)
  local tag=$(echo "$uri" | cut -d: -f2)
  aws ecr describe-images \
    --region "${REGION}" \
    --repository-name "$repo_name" \
    --image-ids imageTag="$tag" \
    >/dev/null 2>&1
}

if image_exists_by_uri "$DIR_IMAGE" && image_exists_by_uri "$RELAY_IMAGE" && image_exists_by_uri "$OPS_AGENT_IMAGE"; then
  echo "  Images exist: ${DIR_IMAGE##*/}, ${RELAY_IMAGE##*/}, ${OPS_AGENT_IMAGE##*/}"
else
  echo "  Images not found — building and pushing stubs..."
  "${SCRIPT_DIR}/build-stubs.sh" "${REGION}"
  DIR_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-directory:stub"
  RELAY_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-relay:stub"
  OPS_AGENT_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/cello-operations-agent:stub"
fi

# ── STEP 6.6: Ensure SSM parameters exist for ECS task definitions ──────────
# The manifest-signer-pubkey is derived from the directory node private key.
# It's consumed by cello-ecs-directory.yaml via ssm:resolve. Created here so
# deploy.sh is self-contained — no manual SSM parameter creation required.

echo ""
echo "── Ensuring SSM parameters exist ───────────────────────────────────"

aws ssm put-parameter \
  --name "/cello/${ENVIRONMENT}/directory/manifest-signer-pubkey" \
  --value "${RELAY_DIRECTORY_PUBKEY}" \
  --type String \
  --overwrite \
  --region "${REGION}" \
  --output text --query Version >/dev/null 2>&1 \
  && echo "  /cello/${ENVIRONMENT}/directory/manifest-signer-pubkey: OK"

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

# ── STEP 8a: First-deploy detection for Ops Agent RDS credentials (AC-009e) ──
# The cello_ops_agent PostgreSQL role is created by Flyway migration V25 (OPS-AGENT-000).
# However, Flyway is NOT run automatically by this script — it is a manual post-deploy
# step (see "Next steps" at the end of this script and infra/scripts/run-flyway.sh).
#
# NOTE: In a new-region deploy, Flyway MUST be applied before this step. If the
# cello_ops_agent role does not exist, the rotation Lambda will fail with a clear error.
# Run Flyway first: ./infra/scripts/run-flyway.sh ${ENVIRONMENT} ${REGION} (or equivalent).
#
# Detection: check if cello/{env}/ops-agent/rds-credentials still contains the placeholder.
# If so: trigger rotation and poll until AWSCURRENT changes (rotation complete).
# Then: deploy the cello-ecs-operations-agent stack.
# If not (subsequent deploys): skip rotation and deploy directly.
#
# This logic is in deploy.sh code, not a manual runbook step — required for
# the region-expansion goal: "zero manual steps in a brand-new region after Flyway".
# M5 Rule 7: every fix must pass "would this work in a brand-new region with zero manual steps?"

OPS_AGENT_RDS_SECRET_ID="cello/${ENVIRONMENT}/ops-agent/rds-credentials"

echo ""
echo "── Checking Ops Agent RDS credential rotation (AC-009e) ────────────────"

ops_agent_rds_secret_current=$(aws secretsmanager get-secret-value \
  --secret-id "${OPS_AGENT_RDS_SECRET_ID}" \
  --region "${REGION}" \
  --query "SecretString" \
  --output text 2>/dev/null || echo "MISSING")

if [[ "${ops_agent_rds_secret_current}" == "MISSING" ]]; then
  echo "  WARNING: ${OPS_AGENT_RDS_SECRET_ID} not found — skipping rotation check."
  echo "           Run bootstrap.sh first to provision the placeholder."
elif echo "${ops_agent_rds_secret_current}" | grep -q "PLACEHOLDER_POPULATE_VIA_CLI"; then
  echo "  Ops Agent RDS secret contains PLACEHOLDER — triggering initial rotation..."
  echo "  This sets the cello_ops_agent PostgreSQL role password (created by Flyway V25)."

  OPS_AGENT_RDS_SECRET_ARN=$(aws secretsmanager describe-secret \
    --secret-id "${OPS_AGENT_RDS_SECRET_ID}" \
    --region "${REGION}" \
    --query "ARN" \
    --output text 2>/dev/null || echo "")

  if [[ -z "${OPS_AGENT_RDS_SECRET_ARN}" ]]; then
    echo "  ERROR: Cannot resolve ARN for ${OPS_AGENT_RDS_SECRET_ID}. Aborting rotation." >&2
    exit 1
  fi

  aws secretsmanager rotate-secret \
    --secret-id "${OPS_AGENT_RDS_SECRET_ARN}" \
    --region "${REGION}" >/dev/null

  echo "  Rotation triggered. Polling until AWSCURRENT changes (up to 5 minutes)..."
  ROTATION_TIMEOUT=300
  ROTATION_POLL_INTERVAL=10
  ROTATION_ELAPSED=0
  ROTATION_DONE=false

  while [[ ${ROTATION_ELAPSED} -lt ${ROTATION_TIMEOUT} ]]; do
    current_val=$(aws secretsmanager get-secret-value \
      --secret-id "${OPS_AGENT_RDS_SECRET_ID}" \
      --region "${REGION}" \
      --query "SecretString" \
      --output text 2>/dev/null || echo "")

    if ! echo "${current_val}" | grep -q "PLACEHOLDER_POPULATE_VIA_CLI"; then
      echo "  Rotation complete (${ROTATION_ELAPSED}s). Ops Agent RDS credential is live."
      ROTATION_DONE=true
      break
    fi

    sleep ${ROTATION_POLL_INTERVAL}
    ROTATION_ELAPSED=$(( ROTATION_ELAPSED + ROTATION_POLL_INTERVAL ))
    echo "  Waiting for rotation... (${ROTATION_ELAPSED}s / ${ROTATION_TIMEOUT}s)"
  done

  if [[ "${ROTATION_DONE}" != "true" ]]; then
    echo "ERROR: Ops Agent RDS rotation did not complete within ${ROTATION_TIMEOUT}s." >&2
    echo "       Check the rotation Lambda logs: /aws/lambda/cello-${ENVIRONMENT}-rds-rotation" >&2
    echo "       Common causes: Flyway V25 not applied (cello_ops_agent role does not exist)," >&2
    echo "       Lambda VPC connectivity issues, or rotation Lambda code not deployed." >&2
    exit 1
  fi
else
  echo "  Ops Agent RDS secret already populated — skipping rotation."
fi

# ── STEP 9: cello-ecs-operations-agent — Operations Agent ECS service ─────────
# depends on: cello-iam, cello-ecr, cello-vpc, cello-ecs-directory (cluster ARN, ALB DNS)
# Position: after directory (provides cluster + ALB DNS name) and before WAF (no dep).
# AC-001: public subnet, AssignPublicIp: ENABLED; no ALB; MinimumHealthyPercent=0.
# NON-FATAL: ops-agent is a Telegram bot — not required for CELLO protocol operation.
# A crash-loop here must not block relay, WAF, CloudWatch, and Route53 from deploying.

ops_agent_exit=0
(
  deploy_stack "cello-ecs-operations-agent-${ENVIRONMENT}" "cello-ecs-operations-agent.yaml" \
    "Environment=${ENVIRONMENT}" \
    "ImageUri=${OPS_AGENT_IMAGE}"
) || ops_agent_exit=$?

if [[ ${ops_agent_exit} -ne 0 ]]; then
  echo ""
  echo "WARNING: cello-ecs-operations-agent-${ENVIRONMENT} failed (exit ${ops_agent_exit})." >&2
  echo "         Ops-agent health check issue is tracked separately. Continuing deployment." >&2
  echo ""
fi

# ── STEP 10: cello-waf — WAF WebACL associated with directory ALB ────────────
# depends on: cello-ecs-directory (imports cello-${ENVIRONMENT}-alb-arn via
# cross-stack reference; CloudFormation enforces ordering automatically)
# GeoBlockingEnabled defaults to "false" — geo-blocking is a manual operator
# action, not part of automated deployments. See AC-004, AC-005.

deploy_stack "cello-waf-${ENVIRONMENT}" "cello-waf.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 11: cello-ecs-relay — relay ECS service ─────────────────────────────
# depends on: cello-iam, cello-vpc, cello-ecs-directory (for cluster ARN)

deploy_stack "cello-ecs-relay-${ENVIRONMENT}" "cello-ecs-relay.yaml" \
  "Environment=${ENVIRONMENT}" \
  "Cpu=${RELAY_CPU}" \
  "Memory=${RELAY_MEM}" \
  "ImageUri=${RELAY_IMAGE}" \
  "DirectoryNodePubkey=${RELAY_DIRECTORY_PUBKEY}"

# ── STEP 12: cello-cloudwatch — CloudWatch alarms and dashboards ─────────────
# depends on: cello-ecs-directory, cello-ecs-relay (alarm dimensions reference ECS services)
# NOTE: RelayAlb5xxAlarm uses !ImportValue "cello-${Environment}-relay-alb-arn" from Step 11
# (cello-ecs-relay). Never deploy cello-cloudwatch before cello-ecs-relay in a new region —
# CloudFormation will fail with "Export not found".

deploy_stack "cello-cloudwatch-${ENVIRONMENT}" "cello-cloudwatch.yaml" \
  "Environment=${ENVIRONMENT}"

# ── STEP 13: cello-route53 — Route 53 ALIAS records and ACM certs ────────────
# depends on: cello-ecs-directory (ALB outputs read in Step 8)

# Pre-flight: delete stale DNS record if it exists outside CFN.
# Route53 records survive stack deletion (hosted zone is not torn down).
# CFN can only CREATE a record it doesn't already own — a pre-existing record
# causes CREATE_FAILED. We delete it so CFN can create it cleanly.
purge_stale_dns_record "${HOSTED_ZONE_ID}" "${SUBDOMAIN}.${DOMAIN_NAME}"

deploy_stack "cello-route53-${ENVIRONMENT}" "cello-route53.yaml" \
  "Environment=${ENVIRONMENT}" \
  "DomainName=${DOMAIN_NAME}" \
  "HostedZoneId=${HOSTED_ZONE_ID}" \
  "AlbDnsName=${ALB_DNS_NAME}" \
  "AlbHostedZoneId=${ALB_HOSTED_ZONE_ID}" \
  "Subdomain=${SUBDOMAIN}"

# ── STEP 13b: cello-route53-relay — Route 53 ALIAS record for relay ALB ──────
# M6B-007 AC-003: deploys cello-route53.yaml a second time per region as
# cello-route53-relay-${ENVIRONMENT} with the relay ALB outputs.
# Must deploy AFTER cello-ecs-relay (Step 11) so the relay ALB DNS name is available.
# Creates an ACM certificate for relay-{region}.cello.mygentic.ai (DNS-validated)
# and an A record ALIAS to the relay ALB.

echo ""
echo "── Reading relay ALB outputs from cello-ecs-relay-${ENVIRONMENT} ───────────"

RELAY_ALB_DNS=$(read_output "cello-ecs-relay-${ENVIRONMENT}" "RelayAlbDnsName" || echo "")
RELAY_ALB_ZONE=$(read_output "cello-ecs-relay-${ENVIRONMENT}" "RelayAlbHostedZoneId" || echo "")

if [[ -z "${RELAY_ALB_DNS}" || "${RELAY_ALB_DNS}" == "None" ]]; then
  echo "WARNING: RelayAlbDnsName output not found in cello-ecs-relay-${ENVIRONMENT}." >&2
  echo "         cello-route53-relay stack may fail. Ensure cello-ecs-relay deployed the ALB." >&2
  RELAY_ALB_DNS="PLACEHOLDER"
  RELAY_ALB_ZONE="PLACEHOLDER"
else
  echo "  RelayAlbDnsName:       ${RELAY_ALB_DNS}"
  echo "  RelayAlbHostedZoneId:  ${RELAY_ALB_ZONE}"
fi

# Pre-flight: delete stale relay DNS record if it exists outside CFN.
purge_stale_dns_record "${HOSTED_ZONE_ID}" "${RELAY_SUBDOMAIN}.${DOMAIN_NAME}"

deploy_stack "cello-route53-relay-${ENVIRONMENT}" "cello-route53.yaml" \
  "Environment=${ENVIRONMENT}" \
  "DomainName=${DOMAIN_NAME}" \
  "HostedZoneId=${HOSTED_ZONE_ID}" \
  "AlbDnsName=${RELAY_ALB_DNS}" \
  "AlbHostedZoneId=${RELAY_ALB_ZONE}" \
  "Subdomain=${RELAY_SUBDOMAIN}"

# ── STEP 14: cello-cicd — CI/CD infrastructure (us-east-1 only) ─────────────
# DEPLOY-005 AC-009: STAGING_DIRECTORY_URL is read from cello-ecs-directory stack outputs
# here (ALB_DNS_NAME was already populated in Step 8) and passed to the cello-cicd stack
# as a parameter. The CodeBuild SmokeTestBuild project receives it via EnvironmentVariables
# at pipeline invocation time. No ALB DNS name is hardcoded anywhere in infra/.

if [[ "${REGION}" == "us-east-1" ]]; then
  # Pass STAGING_DIRECTORY_URL from stack output so CodePipeline can inject it into
  # the smoke test CodeBuild action (AC-009: no hardcoded .elb.amazonaws.com strings)
  STAGING_DIRECTORY_URL="${ALB_DNS_NAME}"
  deploy_stack "cello-cicd-${ENVIRONMENT}" "cello-cicd.yaml" \
    "Environment=${ENVIRONMENT}" \
    "GitHubConnectionArn=${GITHUB_CONNECTION_ARN}" \
    "StagingDirectoryUrl=${STAGING_DIRECTORY_URL}"
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
  "cello-ssm-parameters-${ENVIRONMENT}" \
  "cello-vpc-${ENVIRONMENT}" \
  "cello-kms-${ENVIRONMENT}" \
  "cello-s3-${ENVIRONMENT}" \
  "cello-rds-${ENVIRONMENT}" \
  "cello-rotation-${ENVIRONMENT}" \
  "cello-ecs-directory-${ENVIRONMENT}" \
  "cello-ecs-operations-agent-${ENVIRONMENT}" \
  "cello-waf-${ENVIRONMENT}" \
  "cello-ecs-relay-${ENVIRONMENT}" \
  "cello-cloudwatch-${ENVIRONMENT}" \
  "cello-route53-${ENVIRONMENT}" \
  "cello-route53-relay-${ENVIRONMENT}"; do
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

  local relay_alb_dns
  relay_alb_dns=$(aws cloudformation describe-stacks     --region "${REGION}" --stack-name "cello-ecs-relay-${ENVIRONMENT}"     --query "Stacks[0].Outputs[?OutputKey=='RelayAlbDnsName'].OutputValue"     --output text 2>/dev/null || echo "pending")

  # Rewrite the state file header and env section
  # Strategy: append a dated deploy record — full rewrite happens via deploy.sh on each full deploy
  local marker="### ${ENVIRONMENT} — ${REGION}"
  if grep -q "${marker}" "${state_file}" 2>/dev/null; then
    # Update last deployed date in-place using Python for reliable multiline edit
    python3 - "${state_file}" "${ENVIRONMENT}" "${REGION}" "${today}" "${rds_endpoint}" "${alb_dns}" "${relay_alb_dns}" << 'PYEOF_INNER'
import sys, re

state_file, env, region, today, rds_endpoint, alb_dns, relay_alb_dns = sys.argv[1:]
with open(state_file) as f:
    content = f.read()

# Locate the section for this env/region and update only within it.
# Strategy: split on section headers, update the matching section, reassemble.
section_header = f"### {env} — {region}"
parts = re.split(r"(?=### )", content)
updated_parts = []
for part in parts:
    if part.startswith(section_header):
        # Update last deployed date
        part = re.sub(
            rf"({re.escape(section_header)}\n\*Last deployed:) [^\n]+",
            rf"\1 {today}",
            part
        )
        # Update RDS endpoint if not pending
        if rds_endpoint and rds_endpoint != "pending" and rds_endpoint != "None":
            part = re.sub(r"\| RDS Endpoint \|[^\n]+", f"| RDS Endpoint | {rds_endpoint} |", part)
        # Update Directory ALB if not pending
        if alb_dns and alb_dns != "pending" and alb_dns != "None":
            part = re.sub(r"\| Directory ALB \|[^\n]+", f"| Directory ALB | {alb_dns} |", part)
        # Update Relay ALB if not pending
        if relay_alb_dns and relay_alb_dns != "pending" and relay_alb_dns != "None":
            part = re.sub(r"\| Relay ALB \|[^\n]+", f"| Relay ALB | {relay_alb_dns} |", part)
    updated_parts.append(part)

with open(state_file, "w") as f:
    f.write("".join(updated_parts))
PYEOF_INNER
  fi
  echo "infra/STATE.md updated."
}

update_state

log_event "infra.deploy.completed" "{ \"environment\": \"${ENVIRONMENT}\", \"region\": \"${REGION}\", \"totalDurationMs\": ${TOTAL_DURATION_MS}, \"stackCount\": ${STACK_COUNT} }"
