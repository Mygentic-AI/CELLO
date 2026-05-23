#!/usr/bin/env bash
# CELLO VPC Peering — deploys all 6 peering stacks across 3 regions.
#
# Usage: ./infra/deploy-peering.sh <environment>
#
#   environment  One of: dev, staging, production
#
# What this does:
#   Creates 3 VPC peering pairs (6 stacks total):
#     us-east-1  ↔ eu-central-1
#     us-east-1  ↔ ap-northeast-1
#     eu-central-1 ↔ ap-northeast-1
#
#   For each pair:
#     1. Requester stack (source region): creates the peering connection,
#        adds outbound route, adds SG ingress rules for peer CIDR
#     2. Accepter stack (destination region): accepts the connection,
#        adds return route, adds SG ingress rules for peer CIDR
#
# Prerequisites:
#   - deploy.sh must have completed for all three regions (VPCs must exist)
#   - All three cello-vpc-${env} stacks must be at CREATE/UPDATE_COMPLETE
#
# Ports opened between all VPCs:
#   5432 — PostgreSQL logical replication
#   4001 — Directory inter-node checkpoint signing (libp2p)
#
# Idempotent — safe to re-run. Stacks with no changes complete silently.

set -euo pipefail

ENVIRONMENT="${1:-}"

if [[ -z "${ENVIRONMENT}" ]]; then
  echo "Usage: $0 <environment>" >&2
  echo "  environment: dev | staging | production" >&2
  exit 1
fi

if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "staging" && "${ENVIRONMENT}" != "production" ]]; then
  echo "ERROR: environment must be one of: dev, staging, production" >&2
  exit 1
fi

if [[ "${ENVIRONMENT}" == "production" ]]; then
  echo ""
  echo "WARNING: Deploying VPC Peering to PRODUCTION."
  printf "Type YES to confirm: "
  read -r CONFIRM
  if [[ "${CONFIRM}" != "YES" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFN_DIR="${SCRIPT_DIR}/cloudformation"
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text --region us-east-1)

log_event() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1 $2"
}

# ── Read VPC outputs from a deployed stack ────────────────────────────────────

read_vpc_output() {
  local region="$1"
  local key="$2"
  aws cloudformation describe-stacks \
    --region "${region}" \
    --stack-name "cello-vpc-${ENVIRONMENT}" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
    --output text
}

# ── Deploy a peering stack ────────────────────────────────────────────────────

deploy_peering_stack() {
  local stack_name="$1"
  local template_file="$2"
  local region="$3"
  shift 3
  local params=("$@")

  local param_overrides=""
  for param in "${params[@]}"; do
    param_overrides="${param_overrides} ${param}"
  done
  param_overrides="${param_overrides# }"

  echo ""
  echo "── Deploying ${stack_name} (${region}) ──────────────────────────────────────────"

  local stack_status
  stack_status=$(aws cloudformation describe-stacks \
    --region "${region}" \
    --stack-name "${stack_name}" \
    --query "Stacks[0].StackStatus" \
    --output text 2>/dev/null || echo "DOES_NOT_EXIST")

  if [[ "${stack_status}" == "ROLLBACK_COMPLETE" ]]; then
    echo "  Stack is in ROLLBACK_COMPLETE — deleting before recreating..."
    aws cloudformation delete-stack --region "${region}" --stack-name "${stack_name}"
    aws cloudformation wait stack-delete-complete --region "${region}" --stack-name "${stack_name}"
    echo "  Deleted. Proceeding with fresh create."
  fi

  local deploy_output
  local deploy_exit=0

  deploy_output=$(aws cloudformation deploy \
    --region "${region}" \
    --stack-name "${stack_name}" \
    --template-file "${CFN_DIR}/${template_file}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    ${param_overrides:+--parameter-overrides ${param_overrides}} \
    2>&1) || deploy_exit=$?

  if [[ ${deploy_exit} -ne 0 ]]; then
    echo "${deploy_output}" >&2
    echo "ERROR: Stack ${stack_name} in ${region} failed (exit ${deploy_exit})" >&2
    aws cloudformation describe-stack-events \
      --region "${region}" \
      --stack-name "${stack_name}" \
      --query "StackEvents[?ResourceStatus=='CREATE_FAILED'||ResourceStatus=='UPDATE_FAILED'].{Resource:LogicalResourceId,Reason:ResourceStatusReason}" \
      --output table 2>/dev/null || true
    exit 1
  fi

  if echo "${deploy_output}" | grep -q "No changes to deploy"; then
    echo "  No changes"
  else
    echo "${deploy_output}"
  fi

  log_event "infra.peering.stack.deployed" "{ \"stackName\": \"${stack_name}\", \"region\": \"${region}\" }"
}

# ── Read peering connection ID from requester stack output ────────────────────

read_peering_id() {
  local region="$1"
  local accepter_region="$2"
  aws cloudformation describe-stacks \
    --region "${region}" \
    --stack-name "cello-peering-${ENVIRONMENT}-${region}-to-${accepter_region}" \
    --query "Stacks[0].Outputs[?OutputKey=='PeeringConnectionId'].OutputValue" \
    --output text
}

# ═══════════════════════════════════════════════════════════════════════════════
# COLLECT VPC RESOURCE IDs FROM ALL THREE REGIONS
# ═══════════════════════════════════════════════════════════════════════════════

log_event "infra.peering.started" "{ \"environment\": \"${ENVIRONMENT}\" }"

echo ""
echo "Reading VPC outputs from all three regions..."

USE1_VPC_ID=$(read_vpc_output "us-east-1" "VpcId")
USE1_CIDR=$(read_vpc_output "us-east-1" "VpcCidr")
USE1_RTB=$(read_vpc_output "us-east-1" "PrivateRouteTableId")
USE1_RDS_SG=$(read_vpc_output "us-east-1" "RdsSecurityGroupId")
USE1_DIR_SG=$(read_vpc_output "us-east-1" "EcsDirectorySecurityGroupId")

EUC1_VPC_ID=$(read_vpc_output "eu-central-1" "VpcId")
EUC1_CIDR=$(read_vpc_output "eu-central-1" "VpcCidr")
EUC1_RTB=$(read_vpc_output "eu-central-1" "PrivateRouteTableId")
EUC1_RDS_SG=$(read_vpc_output "eu-central-1" "RdsSecurityGroupId")
EUC1_DIR_SG=$(read_vpc_output "eu-central-1" "EcsDirectorySecurityGroupId")

APN1_VPC_ID=$(read_vpc_output "ap-northeast-1" "VpcId")
APN1_CIDR=$(read_vpc_output "ap-northeast-1" "VpcCidr")
APN1_RTB=$(read_vpc_output "ap-northeast-1" "PrivateRouteTableId")
APN1_RDS_SG=$(read_vpc_output "ap-northeast-1" "RdsSecurityGroupId")
APN1_DIR_SG=$(read_vpc_output "ap-northeast-1" "EcsDirectorySecurityGroupId")

echo "  us-east-1:      VPC=${USE1_VPC_ID} CIDR=${USE1_CIDR}"
echo "  eu-central-1:   VPC=${EUC1_VPC_ID} CIDR=${EUC1_CIDR}"
echo "  ap-northeast-1: VPC=${APN1_VPC_ID} CIDR=${APN1_CIDR}"

# ═══════════════════════════════════════════════════════════════════════════════
# PAIR 1: us-east-1 ↔ eu-central-1
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══ PAIR 1: us-east-1 ↔ eu-central-1 ═══════════════════════════════════════"

# Requester: us-east-1 → eu-central-1
deploy_peering_stack \
  "cello-peering-${ENVIRONMENT}-us-east-1-to-eu-central-1" \
  "cello-vpc-peering.yaml" \
  "us-east-1" \
  "Environment=${ENVIRONMENT}" \
  "RequesterVpcId=${USE1_VPC_ID}" \
  "RequesterPrivateRouteTableId=${USE1_RTB}" \
  "AccepterVpcId=${EUC1_VPC_ID}" \
  "AccepterVpcCidr=${EUC1_CIDR}" \
  "AccepterRegion=eu-central-1" \
  "AccepterAccountId=${ACCOUNT_ID}" \
  "RdsSecurityGroupId=${USE1_RDS_SG}" \
  "EcsDirectorySecurityGroupId=${USE1_DIR_SG}"

# Read peering connection ID created above
PEERING_USE1_EUC1=$(read_peering_id "us-east-1" "eu-central-1")
echo "  PeeringConnectionId: ${PEERING_USE1_EUC1}"

# Accepter: eu-central-1 accepts us-east-1
deploy_peering_stack \
  "cello-peering-${ENVIRONMENT}-eu-central-1-accepts-us-east-1" \
  "cello-vpc-peering-accepter.yaml" \
  "eu-central-1" \
  "Environment=${ENVIRONMENT}" \
  "PeeringConnectionId=${PEERING_USE1_EUC1}" \
  "RequesterVpcCidr=${USE1_CIDR}" \
  "AccepterPrivateRouteTableId=${EUC1_RTB}" \
  "RdsSecurityGroupId=${EUC1_RDS_SG}" \
  "EcsDirectorySecurityGroupId=${EUC1_DIR_SG}" \
  "RequesterRegion=us-east-1"

# ═══════════════════════════════════════════════════════════════════════════════
# PAIR 2: us-east-1 ↔ ap-northeast-1
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══ PAIR 2: us-east-1 ↔ ap-northeast-1 ════════════════════════════════════"

# Requester: us-east-1 → ap-northeast-1
deploy_peering_stack \
  "cello-peering-${ENVIRONMENT}-us-east-1-to-ap-northeast-1" \
  "cello-vpc-peering.yaml" \
  "us-east-1" \
  "Environment=${ENVIRONMENT}" \
  "RequesterVpcId=${USE1_VPC_ID}" \
  "RequesterPrivateRouteTableId=${USE1_RTB}" \
  "AccepterVpcId=${APN1_VPC_ID}" \
  "AccepterVpcCidr=${APN1_CIDR}" \
  "AccepterRegion=ap-northeast-1" \
  "AccepterAccountId=${ACCOUNT_ID}" \
  "RdsSecurityGroupId=${USE1_RDS_SG}" \
  "EcsDirectorySecurityGroupId=${USE1_DIR_SG}"

PEERING_USE1_APN1=$(read_peering_id "us-east-1" "ap-northeast-1")
echo "  PeeringConnectionId: ${PEERING_USE1_APN1}"

# Accepter: ap-northeast-1 accepts us-east-1
deploy_peering_stack \
  "cello-peering-${ENVIRONMENT}-ap-northeast-1-accepts-us-east-1" \
  "cello-vpc-peering-accepter.yaml" \
  "ap-northeast-1" \
  "Environment=${ENVIRONMENT}" \
  "PeeringConnectionId=${PEERING_USE1_APN1}" \
  "RequesterVpcCidr=${USE1_CIDR}" \
  "AccepterPrivateRouteTableId=${APN1_RTB}" \
  "RdsSecurityGroupId=${APN1_RDS_SG}" \
  "EcsDirectorySecurityGroupId=${APN1_DIR_SG}" \
  "RequesterRegion=us-east-1"

# ═══════════════════════════════════════════════════════════════════════════════
# PAIR 3: eu-central-1 ↔ ap-northeast-1
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══ PAIR 3: eu-central-1 ↔ ap-northeast-1 ═════════════════════════════════"

# Requester: eu-central-1 → ap-northeast-1
deploy_peering_stack \
  "cello-peering-${ENVIRONMENT}-eu-central-1-to-ap-northeast-1" \
  "cello-vpc-peering.yaml" \
  "eu-central-1" \
  "Environment=${ENVIRONMENT}" \
  "RequesterVpcId=${EUC1_VPC_ID}" \
  "RequesterPrivateRouteTableId=${EUC1_RTB}" \
  "AccepterVpcId=${APN1_VPC_ID}" \
  "AccepterVpcCidr=${APN1_CIDR}" \
  "AccepterRegion=ap-northeast-1" \
  "AccepterAccountId=${ACCOUNT_ID}" \
  "RdsSecurityGroupId=${EUC1_RDS_SG}" \
  "EcsDirectorySecurityGroupId=${EUC1_DIR_SG}"

PEERING_EUC1_APN1=$(read_peering_id "eu-central-1" "ap-northeast-1")
echo "  PeeringConnectionId: ${PEERING_EUC1_APN1}"

# Accepter: ap-northeast-1 accepts eu-central-1
deploy_peering_stack \
  "cello-peering-${ENVIRONMENT}-ap-northeast-1-accepts-eu-central-1" \
  "cello-vpc-peering-accepter.yaml" \
  "ap-northeast-1" \
  "Environment=${ENVIRONMENT}" \
  "PeeringConnectionId=${PEERING_EUC1_APN1}" \
  "RequesterVpcCidr=${EUC1_CIDR}" \
  "AccepterPrivateRouteTableId=${APN1_RTB}" \
  "RdsSecurityGroupId=${APN1_RDS_SG}" \
  "EcsDirectorySecurityGroupId=${APN1_DIR_SG}" \
  "RequesterRegion=eu-central-1"

# ═══════════════════════════════════════════════════════════════════════════════
# VERIFY — all 6 peering connections active
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "═══ Verifying peering connections ══════════════════════════════════════════"

for region in us-east-1 eu-central-1 ap-northeast-1; do
  echo ""
  echo "  ${region}:"
  aws ec2 describe-vpc-peering-connections \
    --region "${region}" \
    --filters "Name=tag:Project,Values=cello" "Name=status-code,Values=active" \
    --query 'VpcPeeringConnections[*].{ID:VpcPeeringConnectionId,Requester:RequesterVpcInfo.Region,Accepter:AccepterVpcInfo.Region,Status:Status.Code}' \
    --output table 2>&1
done

log_event "infra.peering.completed" "{ \"environment\": \"${ENVIRONMENT}\", \"pairs\": 3, \"stacks\": 6 }"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  VPC Peering complete: ${ENVIRONMENT}"
echo "  Ports 5432 (RDS replication) and 4001 (checkpoint signing) open"
echo "  between all three VPCs in both directions."
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "Next step: run setup-replication.sh to configure PostgreSQL logical replication"
echo "  ./infra/setup-replication.sh ${ENVIRONMENT} us-east-1 eu-central-1 ap-northeast-1"
echo ""
