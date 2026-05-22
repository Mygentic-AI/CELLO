#!/usr/bin/env bash
# Deploy the CELLO CI/CD Lambda functions to AWS.
#
# Usage: ./infra/deploy-lambdas.sh <environment> [webhook|filter|all]
#
#   environment  One of: dev, staging, production
#   target       webhook — webhook-receiver only
#                filter  — pipeline-filter only
#                all     — both (default)

set -euo pipefail

ENVIRONMENT="${1:-}"
TARGET="${2:-all}"
REGION="us-east-1"

if [[ -z "${ENVIRONMENT}" ]]; then
  echo "Usage: $0 <environment> [webhook|filter|all]" >&2
  exit 1
fi

if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "staging" && "${ENVIRONMENT}" != "production" ]]; then
  echo "ERROR: environment must be one of: dev, staging, production" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="${SCRIPT_DIR}/lambda"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

deploy_webhook_receiver() {
  local function_name="cello-github-webhook-receiver-${ENVIRONMENT}"
  local zip_path="${TMP_DIR}/webhook-receiver.zip"

  log "Packaging ${function_name}..."
  (cd "${LAMBDA_DIR}/webhook-receiver" && zip -j "${zip_path}" index.py)

  log "Deploying ${function_name}..."
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --zip-file "fileb://${zip_path}" \
    --region "${REGION}" \
    --query '{FunctionName:FunctionName,CodeSize:CodeSize,LastModified:LastModified}' \
    --output json

  aws lambda wait function-updated \
    --function-name "${function_name}" \
    --region "${REGION}"

  log "${function_name} deployed."
}

deploy_pipeline_filter() {
  local function_name="cello-pipeline-filter-${ENVIRONMENT}"
  local zip_path="${TMP_DIR}/pipeline-filter.zip"
  local stage_dir="${TMP_DIR}/pipeline-filter-stage"

  log "Packaging ${function_name}..."
  mkdir -p "${stage_dir}"
  cp "${LAMBDA_DIR}/pipeline-filter/index.py" "${stage_dir}/"
  # Resolve symlink — pipeline-mappings.json is a symlink to infra/pipeline-mappings.json.
  # Copy the real file so /var/task/pipeline-mappings.json is a regular file in the archive.
  cp "${SCRIPT_DIR}/pipeline-mappings.json" "${stage_dir}/pipeline-mappings.json"
  (cd "${stage_dir}" && zip -j "${zip_path}" index.py pipeline-mappings.json)

  log "Deploying ${function_name}..."
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --zip-file "fileb://${zip_path}" \
    --region "${REGION}" \
    --query '{FunctionName:FunctionName,CodeSize:CodeSize,LastModified:LastModified}' \
    --output json

  aws lambda wait function-updated \
    --function-name "${function_name}" \
    --region "${REGION}"

  log "${function_name} deployed."
}

case "${TARGET}" in
  webhook) deploy_webhook_receiver ;;
  filter)  deploy_pipeline_filter ;;
  all)     deploy_webhook_receiver && deploy_pipeline_filter ;;
  *)
    echo "ERROR: target must be one of: webhook, filter, all" >&2
    exit 1
    ;;
esac

log "Done."
