#!/usr/bin/env bash
# Deploy the CELLO CI/CD Lambda functions to AWS.
#
# Usage: ./infra/deploy-lambdas.sh <environment> [webhook|filter|rotation|all] [region]
#
#   environment  One of: dev, staging, production
#   target       webhook   — webhook-receiver only (us-east-1 only)
#                filter    — pipeline-filter only (us-east-1 only)
#                rotation  — rds-rotation only (all regions unless region specified)
#                waitlist  — all 12 M11 waitlist functions (us-east-1 only)
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
  echo "Usage: $0 <environment> [webhook|filter|rotation|waitlist|all] [region]" >&2
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

# ── M11 waitlist Lambdas ─────────────────────────────────────────────────────
#
# Twelve functions sharing three modules that live one directory up
# (_logging.py, _session.py, _sqlstate.py). Nothing here is a hand-maintained
# file list: the sources are globbed, and after staging we ASSERT that every
# local import the staged code makes is present in the archive. A hand list is
# how a new shared module gets forgotten and the function ImportErrors on its
# first real invocation — cold, in production, with no test that could have
# caught it because tests import from the repo where the file does exist.
WAITLIST_FUNCTIONS=(actions auth bounce email feedback firstwin gallery gate outreach signup utm waves)

# Built once and reused: psycopg2-binary for linux/amd64, same constraint and
# same Docker workaround as the rotation Lambda above.
waitlist_build_deps() {
  local deps_dir="$1"
  [[ -d "${deps_dir}/psycopg2" ]] && return 0
  log "Building psycopg2-binary for linux/amd64 (once, shared by all waitlist functions)..."
  mkdir -p "${deps_dir}"
  docker run --rm \
    --platform linux/amd64 \
    --entrypoint pip \
    -v "${deps_dir}:/var/task" \
    public.ecr.aws/lambda/python:3.12 \
    install psycopg2-binary --target /var/task --quiet
}

# Every module the staged sources import that is NOT a third-party package must
# exist as a file in the stage. Anything missing is a hard failure, named.
waitlist_assert_imports_resolve() {
  local stage_dir="$1" name="$2"
  python3 - "${stage_dir}" "${name}" <<'PY'
import ast, pathlib, sys

stage, name = pathlib.Path(sys.argv[1]), sys.argv[2]
present = {p.stem for p in stage.glob("*.py")}
# Everything else is either stdlib or vendored into the stage by pip.
vendored = {p.name for p in stage.iterdir()} | {p.stem for p in stage.glob("*.py")}

missing = set()
for src in stage.glob("*.py"):
    tree = ast.parse(src.read_text(), filename=str(src))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            root = node.module.split(".")[0]
        elif isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                # A sibling module in this repo always starts with '_' or is a
                # known local name; third-party and stdlib never do.
                if root.startswith("_") and root not in present:
                    missing.add(root)
            continue
        else:
            continue
        if root.startswith("_") and root not in present:
            missing.add(root)

if missing:
    print(
        f"FAIL: waitlist-{name} imports {sorted(missing)} but those modules are not in the "
        f"package. The zip would deploy and then ImportError on first invocation.",
        file=sys.stderr,
    )
    sys.exit(1)
PY
}

deploy_waitlist_function() {
  local name="$1"
  local region="${PRIMARY_REGION}"
  local function_name="cello-waitlist-${name}-${ENVIRONMENT}"
  local src_dir="${LAMBDA_DIR}/waitlist-${name}"
  local stage_dir="${TMP_DIR}/waitlist-${name}-stage"
  local zip_path="${TMP_DIR}/waitlist-${name}.zip"
  local deps_dir="${TMP_DIR}/waitlist-deps"

  if [[ ! -d "${src_dir}" ]]; then
    echo "ERROR: ${src_dir} does not exist — WAITLIST_FUNCTIONS names a function with no source." >&2
    exit 1
  fi

  waitlist_build_deps "${deps_dir}"

  log "Packaging ${function_name}..."
  rm -rf "${stage_dir}"
  cp -R "${deps_dir}" "${stage_dir}"

  # Globbed, not listed. Tests are excluded — they import pytest, which is not
  # in the package, and shipping them would put the fixture DB URL in the zip.
  local copied=0
  for src in "${src_dir}"/*.py; do
    [[ "$(basename "${src}")" == test_* ]] && continue
    cp "${src}" "${stage_dir}/"
    copied=$((copied + 1))
  done
  if [[ "${copied}" -eq 0 ]]; then
    echo "ERROR: ${src_dir} contains no non-test .py source." >&2
    exit 1
  fi

  # The shared modules, also globbed.
  for shared in "${LAMBDA_DIR}"/_*.py; do
    cp "${shared}" "${stage_dir}/"
  done

  waitlist_assert_imports_resolve "${stage_dir}" "${name}"

  (cd "${stage_dir}" && zip -qr "${zip_path}" . -x '*__pycache__*')

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

# us-east-1 only, and that is deliberate rather than an oversight. These read and
# write the single portal RDS instance; a second regional copy would be a second
# writer to the same rows with no coordination. The sovereign-node rule governs
# directory and relay nodes — the waitlist is not one, it is a single global
# service like the ops-agent.
deploy_waitlist() {
  if [[ -n "${REGION_OVERRIDE}" && "${REGION_OVERRIDE}" != "${PRIMARY_REGION}" ]]; then
    echo "ERROR: waitlist Lambdas are ${PRIMARY_REGION}-only; refusing to deploy to ${REGION_OVERRIDE}." >&2
    exit 1
  fi
  for name in "${WAITLIST_FUNCTIONS[@]}"; do
    deploy_waitlist_function "${name}"
  done
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
  waitlist) deploy_waitlist ;;
  all)      deploy_webhook_receiver && deploy_pipeline_filter && deploy_rds_rotation && deploy_waitlist ;;
  *)
    echo "ERROR: target must be one of: webhook, filter, rotation, waitlist, all" >&2
    exit 1
    ;;
esac

log "Done."
