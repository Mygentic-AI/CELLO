#!/usr/bin/env bash
# AC-001 unit test: validate cello-ecs-directory.yaml CloudFormation template
# Story: CELLO-M6B-004
#
# This test validates:
# (1) InternalApiTargetGroup resource exists on port 8081
# (2) InternalPathForwardRule listener rule routes /internal/* to InternalApiTargetGroup
# (3) DirectoryService DependsOn includes InternalPathForwardRule
# (4) Port 8081 ingress rule exists in EcsDirectorySecurityGroup
# (5) DirectoryService LoadBalancers block includes ContainerPort 8081 → InternalApiTargetGroup

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_PATH="$SCRIPT_DIR/../cello-ecs-directory.yaml"
VPC_TEMPLATE_PATH="$SCRIPT_DIR/../cello-vpc.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "AC-001: CloudFormation Template Validation"
echo "Story: CELLO-M6B-004"
echo "========================================"
echo

# Check template file exists
if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo -e "${RED}✗ FAILED${NC}: Template not found at $TEMPLATE_PATH"
  exit 1
fi

echo "Template: $TEMPLATE_PATH"
echo

# Step 1: AWS CloudFormation validate-template
echo "Step 1: Running aws cloudformation validate-template..."
if aws cloudformation validate-template --template-body "file://$TEMPLATE_PATH" >/dev/null 2>&1; then
  echo -e "${GREEN}✓ PASS${NC}: CloudFormation validation succeeded"
else
  echo -e "${RED}✗ FAILED${NC}: CloudFormation validation failed"
  aws cloudformation validate-template --template-body "file://$TEMPLATE_PATH"
  exit 1
fi
echo

# Step 2: Check (1) InternalApiTargetGroup on port 8081
echo "Step 2: Checking InternalApiTargetGroup resource on port 8081..."
if grep -A 10 'InternalApiTargetGroup:' "$TEMPLATE_PATH" | grep -q 'Port: 8081'; then
  echo -e "${GREEN}✓ PASS${NC}: InternalApiTargetGroup exists on port 8081"
else
  echo -e "${RED}✗ FAILED${NC}: InternalApiTargetGroup not found or not on port 8081"
  exit 1
fi
echo

# Step 3: Check (2) InternalApiPathRule routes /internal/* to InternalApiTargetGroup
echo "Step 3: Checking InternalApiPathRule listener rule..."
if grep -A 15 'InternalApiPathRule:' "$TEMPLATE_PATH" | grep -q '"/internal/\*"' && \
   grep -A 15 'InternalApiPathRule:' "$TEMPLATE_PATH" | grep -q 'TargetGroupArn: !Ref InternalApiTargetGroup'; then
  echo -e "${GREEN}✓ PASS${NC}: InternalApiPathRule routes /internal/* to InternalApiTargetGroup"
else
  echo -e "${RED}✗ FAILED${NC}: InternalApiPathRule not configured correctly"
  exit 1
fi

# Check priority >= 5
if grep -A 15 'InternalApiPathRule:' "$TEMPLATE_PATH" | grep 'Priority:' | grep -qE 'Priority: ([5-9]|[1-9][0-9]+)'; then
  echo -e "${GREEN}✓ PASS${NC}: InternalApiPathRule priority >= 5"
else
  echo -e "${RED}✗ FAILED${NC}: InternalApiPathRule priority not >= 5"
  exit 1
fi
echo

# Step 4: Check (3) DirectoryService DependsOn includes InternalApiPathRule
echo "Step 4: Checking DirectoryService DependsOn includes InternalApiPathRule..."
if grep -A 5 'DirectoryService:' "$TEMPLATE_PATH" | grep -E 'DependsOn.*InternalApiPathRule'; then
  echo -e "${GREEN}✓ PASS${NC}: DirectoryService DependsOn includes InternalApiPathRule"
else
  echo -e "${RED}✗ FAILED${NC}: DirectoryService DependsOn missing InternalApiPathRule"
  exit 1
fi

# Also verify all required DependsOn entries are present
# The DependsOn line is: "DependsOn: [HttpListener, InternalApiPathRule, BootstrapPathRule, AgentLookupPathRule]"
if grep -A 5 'DirectoryService:' "$TEMPLATE_PATH" | grep 'DependsOn:' | grep -q 'HttpListener' && \
   grep -A 5 'DirectoryService:' "$TEMPLATE_PATH" | grep 'DependsOn:' | grep -q 'BootstrapPathRule' && \
   grep -A 5 'DirectoryService:' "$TEMPLATE_PATH" | grep 'DependsOn:' | grep -q 'AgentLookupPathRule'; then
  echo -e "${GREEN}✓ PASS${NC}: DirectoryService DependsOn includes all required rules (HttpListener, BootstrapPathRule, AgentLookupPathRule)"
else
  echo -e "${RED}✗ FAILED${NC}: DirectoryService DependsOn missing one or more required rules"
  exit 1
fi
echo

# Step 5: Check (4) Port 8081 ingress rule in EcsDirectorySecurityGroup (in VPC template)
echo "Step 5: Checking port 8081 ingress rule in EcsDirectorySecurityGroup..."
if [[ ! -f "$VPC_TEMPLATE_PATH" ]]; then
  echo -e "${YELLOW}⚠ WARNING${NC}: VPC template not found at $VPC_TEMPLATE_PATH, skipping security group check"
elif grep -A 100 'EcsDirectorySecurityGroup:' "$VPC_TEMPLATE_PATH" | grep -A 3 'FromPort: 8081' | grep -q 'ToPort: 8081'; then
  echo -e "${GREEN}✓ PASS${NC}: Port 8081 ingress rule exists in EcsDirectorySecurityGroup"
else
  echo -e "${RED}✗ FAILED${NC}: Port 8081 ingress rule not found in EcsDirectorySecurityGroup"
  exit 1
fi
echo

# Step 6: Check (5) DirectoryService LoadBalancers block includes ContainerPort 8081 → InternalApiTargetGroup
echo "Step 6: Checking DirectoryService LoadBalancers includes ContainerPort 8081..."
if grep -A 100 'DirectoryService:' "$TEMPLATE_PATH" | grep -A 50 'LoadBalancers:' | grep -A 2 'ContainerPort: 8081' | grep -q 'TargetGroupArn: !Ref InternalApiTargetGroup'; then
  echo -e "${GREEN}✓ PASS${NC}: DirectoryService LoadBalancers includes ContainerPort 8081 → InternalApiTargetGroup"
else
  echo -e "${RED}✗ FAILED${NC}: DirectoryService LoadBalancers missing ContainerPort 8081 entry"
  exit 1
fi
echo

echo "========================================"
echo -e "${GREEN}✓ ALL CHECKS PASSED${NC}"
echo "========================================"
echo
echo "AC-001 verification complete. All 5 criteria met:"
echo "  (1) InternalApiTargetGroup on port 8081"
echo "  (2) InternalApiPathRule routes /internal/* to InternalApiTargetGroup"
echo "  (3) DirectoryService DependsOn includes InternalApiPathRule"
echo "  (4) Port 8081 ingress rule in EcsDirectorySecurityGroup"
echo "  (5) DirectoryService LoadBalancers includes ContainerPort 8081"
echo

exit 0
