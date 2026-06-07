#!/usr/bin/env bash
# Audits current AWS state against expected CELLO infrastructure.
#
# Usage: ./infra/audit-state.sh [environment]
#   environment  dev (default) | staging | production
#
# Checks each region for:
#   - CloudFormation stack statuses
#   - ECS service health (desired == running)
#   - Route53 A records exist and point to the correct ALB
#   - manifest-signer-pubkey SSM parameter matches derived pubkey from node-private-key secret
#
# Output: one line per check, color-coded PASS/WARN/FAIL
# Exit code: 0 if all pass, 1 if any FAIL

set -euo pipefail

ENVIRONMENT="${1:-dev}"
REGIONS=("us-east-1" "eu-central-1" "ap-northeast-1")

# ── Color codes ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[0;33m'
CYN='\033[0;36m'
RST='\033[0m'

FAIL_COUNT=0
WARN_COUNT=0

pass()  { echo -e "  ${GRN}PASS${RST}  $*"; }
fail()  { echo -e "  ${RED}FAIL${RST}  $*"; (( FAIL_COUNT++ )) || true; }
warn()  { echo -e "  ${YEL}WARN${RST}  $*"; (( WARN_COUNT++ )) || true; }
info()  { echo -e "  ${CYN}INFO${RST}  $*"; }
header(){ echo -e "\n${CYN}── $* ──${RST}"; }

# ── Expected stacks per region ───────────────────────────────────────────────

ALL_STACKS=(
  "cello-ecr-${ENVIRONMENT}"
  "cello-iam-${ENVIRONMENT}"
  "cello-secrets-${ENVIRONMENT}"
  "cello-ssm-parameters-${ENVIRONMENT}"
  "cello-vpc-${ENVIRONMENT}"
  "cello-kms-${ENVIRONMENT}"
  "cello-s3-${ENVIRONMENT}"
  "cello-rds-${ENVIRONMENT}"
  "cello-rotation-${ENVIRONMENT}"
  "cello-ecs-directory-${ENVIRONMENT}"
  "cello-waf-${ENVIRONMENT}"
  "cello-ecs-relay-${ENVIRONMENT}"
  "cello-cloudwatch-${ENVIRONMENT}"
  "cello-route53-${ENVIRONMENT}"
  "cello-route53-relay-${ENVIRONMENT}"
)

# Stacks that only exist in us-east-1
US_EAST_1_ONLY_STACKS=(
  "cello-ecs-operations-agent-${ENVIRONMENT}"
  "cello-cicd-${ENVIRONMENT}"
)

# ── Helpers ──────────────────────────────────────────────────────────────────

cfn_status() {
  local stack="$1" region="$2"
  aws cloudformation describe-stacks \
    --stack-name "${stack}" --region "${region}" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND"
}

ecs_service_counts() {
  local service="$1" region="$2"
  aws ecs describe-services \
    --cluster "cello-${ENVIRONMENT}" \
    --services "${service}" \
    --region "${region}" \
    --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,status:status,rollout:deployments[0].rolloutState}' \
    --output json 2>/dev/null || echo "null"
}

route53_record_value() {
  local hosted_zone_id="$1" fqdn="$2"
  aws route53 list-resource-record-sets \
    --hosted-zone-id "${hosted_zone_id}" \
    --query "ResourceRecordSets[?Name=='${fqdn}.']|[0].AliasTarget.DNSName" \
    --output text 2>/dev/null || echo "None"
}

alb_dns_for_service() {
  local name_fragment="$1" region="$2"
  aws elbv2 describe-load-balancers \
    --region "${region}" \
    --query "LoadBalancers[?contains(LoadBalancerName,\`${name_fragment}\`)].DNSName | [0]" \
    --output text 2>/dev/null || echo "None"
}

ssm_manifest_signer_pubkey() {
  local region="$1"
  aws ssm get-parameter \
    --name "/cello/${ENVIRONMENT}/directory/manifest-signer-pubkey" \
    --region "${region}" \
    --query 'Parameter.Value' --output text 2>/dev/null || echo "NOT_FOUND"
}

derive_pubkey_from_secret() {
  local region="$1"
  local priv
  priv=$(aws secretsmanager get-secret-value \
    --secret-id "cello/${ENVIRONMENT}/directory/node-private-key" \
    --region "${region}" \
    --query 'SecretString' --output text 2>/dev/null) || { echo "ERROR"; return; }
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  printf '%s' "${priv}" | node "${script_dir}/scripts/derive-pubkey.js" 2>/dev/null || echo "ERROR"
}

# ── Get Route53 hosted zone ID ───────────────────────────────────────────────

HOSTED_ZONE_ID=$(aws route53 list-hosted-zones \
  --query "HostedZones[?Name=='cello.mygentic.ai.'].Id | [0]" \
  --output text | sed 's|/hostedzone/||')

if [[ -z "${HOSTED_ZONE_ID}" ]]; then
  echo "ERROR: Could not find hosted zone for cello.mygentic.ai" >&2
  exit 1
fi

echo ""
echo "CELLO Infrastructure Audit — ${ENVIRONMENT}"
echo "Hosted zone: ${HOSTED_ZONE_ID}"
echo "Regions: ${REGIONS[*]}"
echo "============================================================"

# ── Region-level checks ──────────────────────────────────────────────────────

for REGION in "${REGIONS[@]}"; do

  header "${REGION}"

  # Region suffix for subdomain (us-east-1 → us1, eu-central-1 → eu1, ap-northeast-1 → ap1)
  case "${REGION}" in
    us-east-1)      REGION_SUFFIX="us1" ;;
    eu-central-1)   REGION_SUFFIX="eu1" ;;
    ap-northeast-1) REGION_SUFFIX="ap1" ;;
    *)              REGION_SUFFIX="${REGION}" ;;
  esac

  # ── 1. CFN stack statuses ────────────────────────────────────────────────

  echo "  [CloudFormation stacks]"
  STACKS_TO_CHECK=("${ALL_STACKS[@]}")
  if [[ "${REGION}" == "us-east-1" ]]; then
    STACKS_TO_CHECK+=("${US_EAST_1_ONLY_STACKS[@]}")
  fi

  for STACK in "${STACKS_TO_CHECK[@]}"; do
    STATUS=$(cfn_status "${STACK}" "${REGION}")
    case "${STATUS}" in
      CREATE_COMPLETE|UPDATE_COMPLETE|IMPORT_COMPLETE)
        pass "${STACK} → ${STATUS}" ;;
      UPDATE_ROLLBACK_COMPLETE|ROLLBACK_COMPLETE|CREATE_FAILED|UPDATE_FAILED|DELETE_FAILED)
        fail "${STACK} → ${STATUS}" ;;
      NOT_FOUND)
        # ops-agent and cicd are expected absent outside us-east-1
        if [[ "${REGION}" != "us-east-1" && \
              ("${STACK}" == "cello-ecs-operations-agent-${ENVIRONMENT}" || \
               "${STACK}" == "cello-cicd-${ENVIRONMENT}") ]]; then
          info "${STACK} → not deployed (us-east-1 only — expected)"
        else
          fail "${STACK} → NOT_FOUND"
        fi ;;
      *)
        warn "${STACK} → ${STATUS}" ;;
    esac
  done

  # ── 2. ECS service health ─────────────────────────────────────────────────

  echo "  [ECS services]"
  ECS_SERVICES=("cello-directory-${ENVIRONMENT}" "cello-relay-${ENVIRONMENT}")
  if [[ "${REGION}" == "us-east-1" ]]; then
    ECS_SERVICES+=("cello-operations-agent-${ENVIRONMENT}")
  fi

  for SERVICE in "${ECS_SERVICES[@]}"; do
    COUNTS=$(ecs_service_counts "${SERVICE}" "${REGION}")
    if [[ "${COUNTS}" == "null" ]]; then
      fail "${SERVICE} → not found in ECS"
      continue
    fi
    DESIRED=$(echo "${COUNTS}" | jq -r '.desired // 0')
    RUNNING=$(echo "${COUNTS}" | jq -r '.running // 0')
    PENDING=$(echo "${COUNTS}" | jq -r '.pending // 0')
    STATUS=$(echo "${COUNTS}"  | jq -r '.status // "UNKNOWN"')
    ROLLOUT=$(echo "${COUNTS}" | jq -r '.rollout // "UNKNOWN"')

    if [[ "${STATUS}" == "ACTIVE" && "${RUNNING}" == "${DESIRED}" && "${DESIRED}" -gt 0 ]]; then
      pass "${SERVICE} → ${RUNNING}/${DESIRED} running (${ROLLOUT})"
    elif [[ "${STATUS}" == "ACTIVE" && "${PENDING}" -gt 0 ]]; then
      warn "${SERVICE} → ${RUNNING}/${DESIRED} running, ${PENDING} pending"
    elif [[ "${STATUS}" == "ACTIVE" && "${RUNNING}" == "0" && \
            "${SERVICE}" == "cello-operations-agent-${ENVIRONMENT}" && \
            "${REGION}" != "us-east-1" ]]; then
      info "${SERVICE} → 0 running (placeholder secrets — expected outside us-east-1)"
    else
      fail "${SERVICE} → ${RUNNING}/${DESIRED} running, ${PENDING} pending — status: ${STATUS} rollout: ${ROLLOUT}"
    fi
  done

  # ── 3. Route53 A records + ALB alignment ─────────────────────────────────

  echo "  [Route53 + ALB alignment]"

  # Directory
  DIR_FQDN="directory-${REGION_SUFFIX}.cello.mygentic.ai"
  DIR_RECORD=$(route53_record_value "${HOSTED_ZONE_ID}" "${DIR_FQDN}")
  DIR_ALB=$(alb_dns_for_service "cello-dir-${ENVIRONMENT}" "${REGION}")

  if [[ "${DIR_RECORD}" == "None" || -z "${DIR_RECORD}" ]]; then
    fail "${DIR_FQDN} → A record MISSING"
  elif [[ "${DIR_ALB}" == "None" || -z "${DIR_ALB}" ]]; then
    warn "${DIR_FQDN} → A record exists but could not find directory ALB to verify target"
  else
    # Normalize: Route53 appends a trailing dot; strip it
    DIR_RECORD_CLEAN="${DIR_RECORD%.}"
    DIR_ALB_CLEAN="${DIR_ALB%.}"
    if [[ "${DIR_RECORD_CLEAN,,}" == "${DIR_ALB_CLEAN,,}" ]]; then
      pass "${DIR_FQDN} → ${DIR_RECORD_CLEAN}"
    else
      fail "${DIR_FQDN} → record points to ${DIR_RECORD_CLEAN} but ALB is ${DIR_ALB_CLEAN}"
    fi
  fi

  # Relay
  RELAY_FQDN="relay-${REGION_SUFFIX}.cello.mygentic.ai"
  RELAY_RECORD=$(route53_record_value "${HOSTED_ZONE_ID}" "${RELAY_FQDN}")
  RELAY_ALB=$(alb_dns_for_service "cello-relay-${ENVIRONMENT}" "${REGION}")

  if [[ "${RELAY_RECORD}" == "None" || -z "${RELAY_RECORD}" ]]; then
    fail "${RELAY_FQDN} → A record MISSING"
  elif [[ "${RELAY_ALB}" == "None" || -z "${RELAY_ALB}" ]]; then
    warn "${RELAY_FQDN} → A record exists but could not find relay ALB to verify target"
  else
    RELAY_RECORD_CLEAN="${RELAY_RECORD%.}"
    RELAY_ALB_CLEAN="${RELAY_ALB%.}"
    if [[ "${RELAY_RECORD_CLEAN,,}" == "${RELAY_ALB_CLEAN,,}" ]]; then
      pass "${RELAY_FQDN} → ${RELAY_RECORD_CLEAN}"
    else
      fail "${RELAY_FQDN} → record points to ${RELAY_RECORD_CLEAN} but ALB is ${RELAY_ALB_CLEAN}"
    fi
  fi

  # ── 4. Manifest signer pubkey — SSM must match node-private-key ─────────────

  echo "  [Manifest signer key alignment]"
  SSM_PUBKEY=$(ssm_manifest_signer_pubkey "${REGION}")
  if [[ "${SSM_PUBKEY}" == "NOT_FOUND" ]]; then
    fail "/cello/${ENVIRONMENT}/directory/manifest-signer-pubkey → SSM parameter MISSING"
  else
    DERIVED_PUBKEY=$(derive_pubkey_from_secret "${REGION}")
    if [[ "${DERIVED_PUBKEY}" == "ERROR" ]]; then
      warn "/cello/${ENVIRONMENT}/directory/manifest-signer-pubkey → could not derive pubkey from secret (check permissions)"
    elif [[ "${SSM_PUBKEY}" == "${DERIVED_PUBKEY}" ]]; then
      pass "/cello/${ENVIRONMENT}/directory/manifest-signer-pubkey → matches node-private-key (${SSM_PUBKEY:0:16}...)"
    else
      fail "/cello/${ENVIRONMENT}/directory/manifest-signer-pubkey → MISMATCH: SSM=${SSM_PUBKEY:0:16}... derived=${DERIVED_PUBKEY:0:16}... — run: aws ssm put-parameter --name /cello/${ENVIRONMENT}/directory/manifest-signer-pubkey --value \${DERIVED} --type String --overwrite --region ${REGION}"
    fi
  fi

done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "============================================================"
if [[ "${FAIL_COUNT}" -eq 0 && "${WARN_COUNT}" -eq 0 ]]; then
  echo -e "${GRN}All checks passed.${RST}"
elif [[ "${FAIL_COUNT}" -eq 0 ]]; then
  echo -e "${YEL}${WARN_COUNT} warning(s), 0 failures.${RST}"
else
  echo -e "${RED}${FAIL_COUNT} failure(s), ${WARN_COUNT} warning(s).${RST}"
fi
echo ""

[[ "${FAIL_COUNT}" -eq 0 ]]
