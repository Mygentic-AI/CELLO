#!/usr/bin/env bash
# Deploy the CELLO CI/CD Lambda functions to AWS.
#
# Usage: ./infra/deploy-lambdas.sh <environment> [webhook|filter|rotation|all] [region]
#
#   environment  One of: dev, staging, production
#   target       webhook   — webhook-receiver only (us-east-1 only)
#                filter    — pipeline-filter only (us-east-1 only)
#                rotation  — rds-rotation only (all regions unless region specified)
#                all       — all targets (default)
#   region       Optional. Deploy to a specific region only.
#                If omitted: webhook/filter deploy to us-east-1 only;
#                rotation deploys to ALL regions (us-east-1, eu-central-1, ap-northeast-1).
#
# NOTE: The rds-rotation Lambda requires psycopg2-binary built for linux/amd64.
# On Apple Silicon (or any non-linux/amd64 host), this script uses Docker to
# install dependencies in a Lambda-compatible environment. Docker must be running.
# This step was intentionally left as a human-operator or CI/CD action because:
#   - psycopg2-binary requires a platform-specific compiled extension
#   - Building cross-platform locally requires Docker daemon access
#   - In CI (CodeBuild on linux/amd64), no cross-compilation is needed

set -euo pipefail

ENVIRONMENT="${1:-}"
TARGET="${2:-all}"
REGION_OVERRIDE="${3:-}"

# Webhook and filter are us-east-1-only (they serve the CI/CD pipeline which is single-region).
# Rotation must run in every region that has an RDS instance.
PRIMARY_REGION="us-east-1"
ALL_REGIONS=("us-east-1" "eu-central-1" "ap-northeast-1")

if [[ -z "${ENVIRONMENT}" ]]; then
  echo "Usage: $0 <environment> [webhook|filter|rotation|all] [region]" >&2
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
  local region="${PRIMARY_REGION}"
  local function_name="cello-github-webhook-receiver-${ENVIRONMENT}"
  local zip_path="${TMP_DIR}/webhook-receiver.zip"

  log "Packaging ${function_name}..."
  (cd "${LAMBDA_DIR}/webhook-receiver" && zip -j "${zip_path}" index.py)

  log "Deploying ${function_name} to ${region}..."
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --zip-file "fileb://${zip_path}" \
    --region "${region}" \
    --query '{FunctionName:FunctionName,CodeSize:CodeSize,LastModified:LastModified}' \
    --output json

  aws lambda wait function-updated \
    --function-name "${function_name}" \
    --region "${region}"

  log "${function_name} deployed to ${region}."
}

deploy_pipeline_filter() {
  local region="${PRIMARY_REGION}"
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

  log "Deploying ${function_name} to ${region}..."
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --zip-file "fileb://${zip_path}" \
    --region "${region}" \
    --query '{FunctionName:FunctionName,CodeSize:CodeSize,LastModified:LastModified}' \
    --output json

  aws lambda wait function-updated \
    --function-name "${function_name}" \
    --region "${region}"

  log "${function_name} deployed to ${region}."
}

deploy_rds_rotation_to_region() {
  local region="$1"
  local function_name="cello-${ENVIRONMENT}-rds-rotation"
  local zip_path="${TMP_DIR}/rds-rotation.zip"
  local stage_dir="${TMP_DIR}/rds-rotation-stage"

  # Only package once (reuse zip across regions)
  if [[ ! -f "${zip_path}" ]]; then
    log "Packaging ${function_name} (with psycopg2-binary via Docker)..."
    mkdir -p "${stage_dir}"
    cp "${LAMBDA_DIR}/rds-rotation/handler.py" "${stage_dir}/"

    # Install psycopg2-binary for linux/amd64 inside a Lambda-compatible Docker image.
    # This is required on Apple Silicon and any non-linux/amd64 build host.
    # In CodeBuild (linux/amd64) this runs natively without emulation overhead.
    docker run --rm \
      --platform linux/amd64 \
      --entrypoint pip \
      -v "${stage_dir}:/var/task" \
      public.ecr.aws/lambda/python:3.12 \
      install psycopg2-binary --target /var/task --quiet

    (cd "${stage_dir}" && zip -r "${zip_path}" .)
  fi

  log "Deploying ${function_name} to ${region}..."
  aws lambda update-function-code \
    --function-name "${function_name}" \
    --zip-file "fileb://${zip_path}" \
    --region "${region}" \
    --query '{FunctionName:FunctionName,CodeSize:CodeSize,LastModified:LastModified}' \
    --output json

  aws lambda wait function-updated \
    --function-name "${function_name}" \
    --region "${region}"

  log "${function_name} deployed to ${region}."
}

deploy_rds_rotation() {
  if [[ -n "${REGION_OVERRIDE}" ]]; then
    deploy_rds_rotation_to_region "${REGION_OVERRIDE}"
  else
    for region in "${ALL_REGIONS[@]}"; do
      deploy_rds_rotation_to_region "${region}"
    done
  fi
}

case "${TARGET}" in
  webhook)  deploy_webhook_receiver ;;
  filter)   deploy_pipeline_filter ;;
  rotation) deploy_rds_rotation ;;
  all)      deploy_webhook_receiver && deploy_pipeline_filter && deploy_rds_rotation ;;
  *)
    echo "ERROR: target must be one of: webhook, filter, rotation, all" >&2
    exit 1
    ;;
esac

log "Done."
