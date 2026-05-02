#!/bin/bash
# =============================================================================
# INFRA-001: Deploy updated cello-pipeline-filter Lambda
#
# Packages infra/lambda/pipeline-filter/index.py and updates the live Lambda.
# The updated Lambda adds 8 CELLO package folder mappings and a root-config rule
# (tsconfig.base.json, pnpm-workspace.yaml, package.json → all 8 pipelines).
#
# Prerequisites:
#   - 26-cello-package-pipelines.sh complete (pipelines exist)
#   - zip available on $PATH
#
# Usage:
#   AWS_PROFILE=mygentic ./infra/27-update-pipeline-filter.sh
# =============================================================================

set -euo pipefail

REGION="eu-west-1"
FUNCTION_NAME="cello-pipeline-filter"
LAMBDA_SRC="$(dirname "$0")/lambda/pipeline-filter/index.py"
TMP_ZIP="/tmp/cello-pipeline-filter-update.zip"

if [ ! -f "$LAMBDA_SRC" ]; then
  echo "ERROR: Lambda source not found at $LAMBDA_SRC"
  exit 1
fi

echo "Packaging $LAMBDA_SRC → $TMP_ZIP"
cd "$(dirname "$LAMBDA_SRC")"
zip -j "$TMP_ZIP" index.py
cd - > /dev/null

echo "Deploying to $FUNCTION_NAME in $REGION"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$TMP_ZIP" \
  --region "$REGION" \
  --query '{FunctionName:FunctionName,CodeSize:CodeSize,LastModified:LastModified}' \
  --output json

rm -f "$TMP_ZIP"

echo ""
echo "=== COMPLETE ==="
echo "Lambda $FUNCTION_NAME updated with CELLO package mappings."
