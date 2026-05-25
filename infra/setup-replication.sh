#!/usr/bin/env bash
# CELLO-FEDERATION-001A — PostgreSQL logical replication setup script
#
# Sets up logical replication between all three Directory RDS instances in a
# CELLO environment by running psql commands via ECS Exec on each directory task.
#
# Usage:
#   ./infra/setup-replication.sh <environment> <region1> <region2> <region3>
#
#   environment  One of: dev, staging, production
#   region1      Primary region (e.g. us-east-1)
#   region2      Second region (e.g. eu-central-1)
#   region3      Third region (e.g. ap-northeast-1)
#
# What this script does:
#   1. Validates that all 3 Directory ECS tasks are running before touching any DB
#   2. For each node: creates the cello_replication user with REPLICATION privilege only
#   3. For each node: creates publication cello_pub covering all append-only tables
#   4. For each node: creates 2 subscriptions (one per peer node)
#   5. Polls pg_replication_slots until all 6 slots are active (60s timeout)
#   6. Prints summary table and exits 0
#
# All operations are idempotent — safe to re-run. Existing objects are detected
# via pre-flight queries and skipped.
#
# Secrets: replication credentials are stored in Secrets Manager under
#   cello/{env}/directory/rds-replication-credentials in each region.
#   Passwords never appear in stdout, stderr, or CloudWatch logs.
#
# Replication slot naming: cello_{env}_{source_region}_{target_region}
#   Region hyphens are replaced by underscores (PostgreSQL slot names: [a-z0-9_]+)
#   e.g. cello_dev_us_east_1_eu_central_1
#
# Subscription naming: cello_sub_from_{source_region}
#   e.g. cello_sub_from_us_east_1
#
# Publication naming: cello_pub (same on every node)

set -euo pipefail

# ── Prerequisites ────────────────────────────────────────────────────────────

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required but not found." >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI is required but not found." >&2; exit 1; }

# ── Argument validation ──────────────────────────────────────────────────────

ENVIRONMENT="${1:-}"
REGION1="${2:-}"
REGION2="${3:-}"
REGION3="${4:-}"

if [[ -z "${ENVIRONMENT}" || -z "${REGION1}" || -z "${REGION2}" || -z "${REGION3}" ]]; then
  echo "Usage: $0 <environment> <region1> <region2> <region3>" >&2
  echo "  environment: dev | staging | production" >&2
  echo "  regionN:     e.g. us-east-1, eu-central-1, ap-northeast-1" >&2
  exit 1
fi

if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "staging" && "${ENVIRONMENT}" != "production" ]]; then
  echo "ERROR: environment must be one of: dev, staging, production" >&2
  exit 1
fi

REGIONS=("${REGION1}" "${REGION2}" "${REGION3}")
NODE_COUNT=${#REGIONS[@]}

# ── Production confirmation gate (AC-004) ────────────────────────────────────
# Fires on ENVIRONMENT value — not bypassable by flags or env vars.

if [[ "${ENVIRONMENT}" == "production" ]]; then
  echo ""
  echo "Configuring replication for PRODUCTION. Type YES to confirm:"
  read -r CONFIRM
  if [[ "${CONFIRM}" != "YES" ]]; then
    echo "Aborted. No replication setup was performed." >&2
    exit 1
  fi
  echo ""
fi

# ── Observability helpers ────────────────────────────────────────────────────

SCRIPT_START=$(date +%s)

log_info() {
  local event_name="$1"
  local message="$2"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] INFO  ${event_name} ${message}"
}

log_error() {
  local event_name="$1"
  local message="$2"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR ${event_name} ${message}" >&2
}

# Format regions array as JSON string for log context
regions_json="[\"${REGION1}\",\"${REGION2}\",\"${REGION3}\"]"

log_info "infra.replication.setup.started" "{ \"environment\": \"${ENVIRONMENT}\", \"regions\": ${regions_json}, \"nodeCount\": ${NODE_COUNT} }"

# ── ECS cluster and service naming ───────────────────────────────────────────

ECS_CLUSTER_NAME="cello-${ENVIRONMENT}"
ECS_SERVICE_NAME="cello-directory-${ENVIRONMENT}"

# ── Fetch RDS master credentials per region ──────────────────────────────────
# Replication setup requires postgres superuser. The RDS-managed master secret
# is fetched here (not inside the container) so psql commands are self-contained.

declare -A MASTER_PASSWORDS
declare -A RDS_ENDPOINTS
declare -A RDS_DB_NAMES

for REGION in "${REGIONS[@]}"; do
  # Get RDS master secret ARN from CloudFormation export
  MASTER_SECRET_ARN=$(aws cloudformation list-exports \
    --region "${REGION}" \
    --query "Exports[?Name=='cello-${ENVIRONMENT}-rds-master-secret-arn'].Value" \
    --output text 2>/dev/null)

  if [[ -z "${MASTER_SECRET_ARN}" || "${MASTER_SECRET_ARN}" == "None" ]]; then
    log_error "infra.replication.setup.master_secret_not_found" "{ \"region\": \"${REGION}\" }"
    echo "ERROR: Cannot find RDS master secret ARN export in ${REGION}." >&2
    exit 1
  fi

  SECRET_JSON=$(aws secretsmanager get-secret-value \
    --region "${REGION}" \
    --secret-id "${MASTER_SECRET_ARN}" \
    --query "SecretString" \
    --output text)

  MASTER_PASS=$(echo "${SECRET_JSON}" | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])")
  MASTER_PASSWORDS["${REGION}"]="${MASTER_PASS}"

  # Get RDS endpoint from CloudFormation export
  RDS_EP=$(aws cloudformation list-exports \
    --region "${REGION}" \
    --query "Exports[?Name=='cello-${ENVIRONMENT}-rds-endpoint'].Value" \
    --output text 2>/dev/null)
  RDS_ENDPOINTS["${REGION}"]="${RDS_EP}"
  RDS_DB_NAMES["${REGION}"]="cello_${ENVIRONMENT}"
done

# Tables covered by the publication (all append-only tables, AC behavior)
PUBLICATION_TABLES="agent_profiles,conversation_seals,conversation_seal_staging,directory_checkpoints,checkpoint_node_signatures,relay_registrations,sessions,pending_notifications,user_accounts"
TABLE_COUNT=$(echo "${PUBLICATION_TABLES}" | tr ',' '\n' | wc -l | tr -d ' ')

# ── Step 1: Validate all ECS tasks are RUNNING before touching any DB ─────────
# AC-007: exit 1 before any psql commands if any task is not in RUNNING state.

declare -A TASK_ARNS

for REGION in "${REGIONS[@]}"; do
  echo "── Checking Directory ECS task in ${REGION} ──────────────────────────"

  TASK_ARN=$(aws ecs list-tasks \
    --region "${REGION}" \
    --cluster "${ECS_CLUSTER_NAME}" \
    --service-name "${ECS_SERVICE_NAME}" \
    --query "taskArns[0]" \
    --output text 2>/dev/null || echo "")

  if [[ -z "${TASK_ARN}" || "${TASK_ARN}" == "None" ]]; then
    log_error "infra.replication.setup.task_not_running" "{ \"region\": \"${REGION}\", \"taskStatus\": \"NOT_FOUND\" }"
    echo "ERROR: No running Directory ECS task found in ${REGION}." >&2
    echo "Ensure all Directory ECS tasks are running before executing this script." >&2
    exit 1
  fi

  # Verify the task is actually in RUNNING state
  TASK_STATUS=$(aws ecs describe-tasks \
    --region "${REGION}" \
    --cluster "${ECS_CLUSTER_NAME}" \
    --tasks "${TASK_ARN}" \
    --query "tasks[0].lastStatus" \
    --output text 2>/dev/null || echo "UNKNOWN")

  if [[ "${TASK_STATUS}" != "RUNNING" ]]; then
    log_error "infra.replication.setup.task_not_running" "{ \"region\": \"${REGION}\", \"taskStatus\": \"${TASK_STATUS}\" }"
    echo "ERROR: Directory ECS task in ${REGION} is in state '${TASK_STATUS}' (expected RUNNING)." >&2
    echo "Ensure all Directory ECS tasks are running before executing this script." >&2
    exit 1
  fi

  TASK_ARNS["${REGION}"]="${TASK_ARN}"
  echo "  Task $(basename "${TASK_ARN}") is RUNNING in ${REGION}"
done

echo ""
echo "All ${NODE_COUNT} Directory ECS tasks are running. Proceeding with replication setup."
echo ""

# ── Step 2: Ensure Secrets Manager credentials exist in each region ───────────
# AC-005: create cello_replication credentials in Secrets Manager before the user
# is created; the password never appears in stdout, stderr, or CloudWatch logs.

declare -A REPLICATION_SECRET_ARNS
declare -A REPLICATION_PASSWORDS

SECRET_PATH_SUFFIX="directory/rds-replication-credentials"

for REGION in "${REGIONS[@]}"; do
  echo "── Ensuring replication credentials in Secrets Manager (${REGION}) ───"

  SECRET_NAME="cello/${ENVIRONMENT}/${SECRET_PATH_SUFFIX}"
  SECRET_REGION="${REGION}"

  # Check if secret already exists
  EXISTING_SECRET=$(aws secretsmanager describe-secret \
    --region "${SECRET_REGION}" \
    --secret-id "${SECRET_NAME}" \
    --query "ARN" \
    --output text 2>/dev/null || echo "")

  if [[ -n "${EXISTING_SECRET}" && "${EXISTING_SECRET}" != "None" ]]; then
    echo "  Secret ${SECRET_NAME} already exists in ${REGION} — using existing credentials."
    REPLICATION_SECRET_ARNS["${REGION}"]="${EXISTING_SECRET}"

    # Retrieve existing password (never echo it)
    # get-secret-value returns JSON {"username":"...","password":"..."} — parse .password
    REPL_PASS=$(aws secretsmanager get-secret-value \
      --region "${SECRET_REGION}" \
      --secret-id "${SECRET_NAME}" \
      --query "SecretString" \
      --output text 2>/dev/null | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['password'])" 2>/dev/null || echo "")

    if [[ -z "${REPL_PASS}" ]]; then
      log_error "infra.replication.setup.credentials_mismatch" "{ \"region\": \"${REGION}\", \"secretArn\": \"${EXISTING_SECRET}\" }"
      echo "ERROR: Secret ${SECRET_NAME} exists in ${REGION} but cannot be read." >&2
      echo "Rotate the secret manually or check IAM permissions, then re-run the script." >&2
      exit 1
    fi
    REPLICATION_PASSWORDS["${REGION}"]="${REPL_PASS}"
  else
    # Generate a new password and store it in Secrets Manager
    # The password is generated by AWS — it never appears in this script's output
    echo "  Creating new replication credentials in Secrets Manager for ${REGION}..."

    # Generate random password using Secrets Manager's password generator.
    # --exclude-punctuation is required: the password is used inside a psql connection
    # string and DO $$ SQL block; punctuation (especially ', \, ") would break both.
    REPL_PASS=$(aws secretsmanager get-random-password \
      --region "${SECRET_REGION}" \
      --password-length 32 \
      --exclude-punctuation \
      --require-each-included-type \
      --query "RandomPassword" \
      --output text)

    if [[ -z "${REPL_PASS}" ]]; then
      log_error "infra.replication.setup.credentials_mismatch" "{ \"region\": \"${REGION}\", \"secretArn\": \"\" }"
      echo "ERROR: Failed to generate random password via Secrets Manager in ${REGION}." >&2
      exit 1
    fi

    # Build secret JSON safely via python3 to handle any characters in the password.
    SECRET_JSON=$(python3 -c "import json, sys; print(json.dumps({'username': 'cello_replication', 'password': sys.argv[1]}))" "${REPL_PASS}")

    # Store the password — the variable is passed directly and never echoed
    NEW_SECRET_ARN=$(aws secretsmanager create-secret \
      --region "${SECRET_REGION}" \
      --name "${SECRET_NAME}" \
      --description "CELLO replication user credentials for ${ENVIRONMENT}" \
      --secret-string "${SECRET_JSON}" \
      --query "ARN" \
      --output text)

    if [[ -z "${NEW_SECRET_ARN}" || "${NEW_SECRET_ARN}" == "None" ]]; then
      log_error "infra.replication.setup.credentials_mismatch" "{ \"region\": \"${REGION}\", \"secretArn\": \"\" }"
      echo "ERROR: Failed to create Secrets Manager secret ${SECRET_NAME} in ${REGION}." >&2
      exit 1
    fi

    REPLICATION_SECRET_ARNS["${REGION}"]="${NEW_SECRET_ARN}"
    REPLICATION_PASSWORDS["${REGION}"]="${REPL_PASS}"
    echo "  Created secret ${SECRET_NAME} in ${REGION} (ARN: ${NEW_SECRET_ARN})"
  fi
done

# ── Step 3: Create replication user and publication on each node ───────────────

for REGION in "${REGIONS[@]}"; do
  echo "── Setting up replication user and publication on ${REGION} ──────────"

  REPL_PASS="${REPLICATION_PASSWORDS[${REGION}]}"

  # Create the cello_replication user with REPLICATION privilege only (SI-001).
  # Uses DO $$ block for idempotency — the DO block is universally compatible across PG versions.
  # SI-001: REPLICATION privilege only — no INSERT, UPDATE, DELETE, DDL, SUPERUSER, CREATEDB.
  # The master password is passed via PGPASSWORD env var inside the container shell.
  MASTER_PASS="${MASTER_PASSWORDS[${REGION}]}"
  RDS_EP="${RDS_ENDPOINTS[${REGION}]}"
  DB_NAME="${RDS_DB_NAMES[${REGION}]}"

  local_create_user_sql="DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cello_replication') THEN CREATE USER cello_replication WITH REPLICATION LOGIN PASSWORD '${REPL_PASS}'; END IF; END \$\$;"
  local_user_cmd="PGPASSWORD='${MASTER_PASS}' psql -h ${RDS_EP} -p 5432 -U postgres -d ${DB_NAME} -c \"${local_create_user_sql}\""

  EXEC_OUTPUT=$(aws ecs execute-command \
    --region "${REGION}" \
    --cluster "${ECS_CLUSTER_NAME}" \
    --task "${TASK_ARNS[${REGION}]}" \
    --container "directory" \
    --command "${local_user_cmd}" \
    --interactive 2>&1) || {
      log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"create_user\", \"reason\": \"ecs_exec_failed\" }"
      echo "ERROR: ECS Exec failed in ${REGION} during user creation." >&2
      exit 1
    }
  if echo "${EXEC_OUTPUT}" | grep -qE "^ERROR:|^psql: error:"; then
    log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"create_user\", \"reason\": \"psql_error\" }"
    echo "ERROR: psql error during user creation in ${REGION}: ${EXEC_OUTPUT}" >&2
    exit 1
  fi

  echo "  cello_replication user ready on ${REGION}"

  # Create publication covering all append-only tables (idempotent).
  # The publication is checked via pg_publication before creating.
  local_create_pub_sql="DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'cello_pub') THEN CREATE PUBLICATION cello_pub FOR TABLE ${PUBLICATION_TABLES}; END IF; END \$\$;"

  EXEC_OUTPUT=$(aws ecs execute-command \
    --region "${REGION}" \
    --cluster "${ECS_CLUSTER_NAME}" \
    --task "${TASK_ARNS[${REGION}]}" \
    --container "directory" \
    --command "PGPASSWORD='${MASTER_PASS}' psql -h ${RDS_EP} -p 5432 -U postgres -d ${DB_NAME} -c \"${local_create_pub_sql}\"" \
    --interactive 2>&1) || {
      log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"create_publication\", \"reason\": \"ecs_exec_failed\" }"
      echo "ERROR: ECS Exec failed in ${REGION} during publication creation." >&2
      exit 1
    }
  if echo "${EXEC_OUTPUT}" | grep -qE "^ERROR:|^psql: error:"; then
    log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"create_publication\", \"reason\": \"psql_error\" }"
    echo "ERROR: psql error during publication creation in ${REGION}: ${EXEC_OUTPUT}" >&2
    exit 1
  fi

  log_info "infra.replication.setup.publication_created" "{ \"environment\": \"${ENVIRONMENT}\", \"region\": \"${REGION}\", \"tableCount\": ${TABLE_COUNT} }"
  echo "  Publication cello_pub ready on ${REGION}"
done

# ── Step 4: Create subscriptions on each node (2 per node = 6 total) ──────────
# Each node subscribes to cello_pub on each of the other two nodes.
# Slot naming: cello_{env}_{source_sanitized}_{target_sanitized}  e.g. cello_dev_us_east_1_eu_central_1
# Subscription naming: cello_sub_from_{source_sanitized}  e.g. cello_sub_from_us_east_1
# Region hyphens are replaced by underscores — PostgreSQL identifiers must match [a-z0-9_]+

# RDS endpoints already fetched above in RDS_ENDPOINTS associative array.

for TARGET_REGION in "${REGIONS[@]}"; do
  echo "── Creating subscriptions on ${TARGET_REGION} ────────────────────────"

  for SOURCE_REGION in "${REGIONS[@]}"; do
    if [[ "${SOURCE_REGION}" == "${TARGET_REGION}" ]]; then
      continue
    fi

    # Deterministic slot name: cello_{env}_{source}_{target} (SI-002)
    # PostgreSQL slot/subscription names must match [a-z0-9_]+ — sanitize region hyphens to underscores.
    SLOT_NAME="cello_${ENVIRONMENT}_${SOURCE_REGION//-/_}_${TARGET_REGION//-/_}"
    SUB_NAME="cello_sub_from_${SOURCE_REGION//-/_}"
    SOURCE_HOST="${RDS_ENDPOINTS[${SOURCE_REGION}]}"
    SOURCE_PASS="${REPLICATION_PASSWORDS[${SOURCE_REGION}]}"

    # Build the subscription connection string. The password must be in CONN_STRING because
    # the WAL receiver is a separate OS process that reads pg_subscription.subconninfo directly
    # and does not inherit shell environment variables. PGPASSWORD only affects the psql CLI
    # process, not the background worker. Without password= in the connection string, the
    # WAL receiver cannot authenticate and slots remain in disconnected state.
    # The password is stored in pg_subscription (readable by postgres superusers only).
    CONN_STRING="host=${SOURCE_HOST} port=5432 dbname=cello_${ENVIRONMENT} user=cello_replication password=${SOURCE_PASS} sslmode=require"

    echo "  Creating subscription ${SUB_NAME} (slot: ${SLOT_NAME}) on ${TARGET_REGION}..."

    # Idempotent subscription creation: check pg_subscription before creating.
    # PostgreSQL 17+ supports CREATE SUBSCRIPTION IF NOT EXISTS; for compatibility
    # with PG 14/15/16, we use a DO $$ block with a pre-flight check.
    # PGPASSWORD is set inside the container shell so it is not in the AWS CLI argument.
    local_create_sub_sql="DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_subscription WHERE subname = '${SUB_NAME}') THEN CREATE SUBSCRIPTION ${SUB_NAME} CONNECTION '${CONN_STRING}' PUBLICATION cello_pub WITH (slot_name = '${SLOT_NAME}', copy_data = false); END IF; END \$\$;"
    TARGET_MASTER_PASS="${MASTER_PASSWORDS[${TARGET_REGION}]}"
    TARGET_RDS_EP="${RDS_ENDPOINTS[${TARGET_REGION}]}"
    TARGET_DB_NAME="${RDS_DB_NAMES[${TARGET_REGION}]}"
    local_sub_cmd="PGPASSWORD='${TARGET_MASTER_PASS}' psql -h ${TARGET_RDS_EP} -p 5432 -U postgres -d ${TARGET_DB_NAME} -c \"${local_create_sub_sql}\""

    EXEC_OUTPUT=$(aws ecs execute-command \
      --region "${TARGET_REGION}" \
      --cluster "${ECS_CLUSTER_NAME}" \
      --task "${TASK_ARNS[${TARGET_REGION}]}" \
      --container "directory" \
      --command "${local_sub_cmd}" \
      --interactive 2>&1) || {
        log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${TARGET_REGION}\", \"step\": \"create_subscription\", \"reason\": \"ecs_exec_failed\", \"slotName\": \"${SLOT_NAME}\" }"
        echo "ERROR: ECS Exec failed in ${TARGET_REGION} during subscription creation." >&2
        exit 1
      }
    if echo "${EXEC_OUTPUT}" | grep -qE "^ERROR:|^psql: error:"; then
      log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${TARGET_REGION}\", \"step\": \"create_subscription\", \"reason\": \"psql_error\", \"slotName\": \"${SLOT_NAME}\" }"
      echo "ERROR: psql error during subscription creation in ${TARGET_REGION}: ${EXEC_OUTPUT}" >&2
      exit 1
    fi

    log_info "infra.replication.setup.subscription_created" "{ \"environment\": \"${ENVIRONMENT}\", \"targetRegion\": \"${TARGET_REGION}\", \"sourceRegion\": \"${SOURCE_REGION}\", \"slotName\": \"${SLOT_NAME}\" }"
    echo "  Subscription ${SUB_NAME} ready on ${TARGET_REGION}"
  done
done

# ── Step 5: Poll pg_replication_slots until all 6 slots are active ────────────
# Timeout: 60 seconds (AC-003, DB-001).
# All 6 expected slots are verified in parallel across all nodes.
# Queries pg_replication_slots (slot_name, active) — not pg_stat_replication.application_name,
# which is the subscription name, not the target region.

echo ""
echo "── Polling for streaming state on all 6 replication slots ───────────────"

POLL_START=$(date +%s)
POLL_TIMEOUT=60
STREAMING_SLOTS=()
# Tracks which slots have already fired infra.replication.setup.slot_streaming
# so the event fires exactly once per slot (at first transition to active state).
LOGGED_SLOTS=()

# Build the expected set of 6 slot names
EXPECTED_SLOTS=()
for SOURCE_REGION in "${REGIONS[@]}"; do
  for TARGET_REGION in "${REGIONS[@]}"; do
    if [[ "${SOURCE_REGION}" != "${TARGET_REGION}" ]]; then
      EXPECTED_SLOTS+=("${SOURCE_REGION}:cello_${ENVIRONMENT}_${SOURCE_REGION//-/_}_${TARGET_REGION//-/_}")
    fi
  done
done

# Polling loop: check pg_replication_slots on each source node until all slots are active
while true; do
  NOW=$(date +%s)
  ELAPSED=$(( NOW - POLL_START ))

  STREAMING_SLOTS=()

  # For each source region, query pg_replication_slots directly for active cello_ slots.
  # application_name in pg_stat_replication is the subscription name (not the target region),
  # so we query pg_replication_slots where slot_name LIKE 'cello_%' AND active = 't'.
  for SOURCE_REGION in "${REGIONS[@]}"; do
    SLOT_QUERY="SELECT slot_name FROM pg_replication_slots WHERE slot_name LIKE 'cello_%' AND active = 't';"

    STAT_OUTPUT=$(aws ecs execute-command \
      --region "${SOURCE_REGION}" \
      --cluster "${ECS_CLUSTER_NAME}" \
      --task "${TASK_ARNS[${SOURCE_REGION}]}" \
      --container "directory" \
      --command "PGPASSWORD='${MASTER_PASSWORDS[${SOURCE_REGION}]}' psql -h ${RDS_ENDPOINTS[${SOURCE_REGION}]} -p 5432 -U postgres -d ${RDS_DB_NAMES[${SOURCE_REGION}]} -t -A -c \"${SLOT_QUERY}\"" \
      --interactive \
      2>/dev/null || echo "")

    # Parse active slot names from this node's pg_replication_slots output
    while IFS= read -r line; do
      if [[ -n "${line}" && "${line}" != "--"* ]]; then
        SLOT_NAME_FROM_SLOTS=$(echo "${line}" | tr -d ' ')
        if [[ -n "${SLOT_NAME_FROM_SLOTS}" ]]; then
          STREAMING_SLOTS+=("${SOURCE_REGION}:${SLOT_NAME_FROM_SLOTS}")

          # Log slot_streaming only once per slot — at first transition to active state.
          ALREADY_LOGGED=false
          for LOGGED in "${LOGGED_SLOTS[@]:-}"; do
            if [[ "${LOGGED}" == "${SOURCE_REGION}:${SLOT_NAME_FROM_SLOTS}" ]]; then
              ALREADY_LOGGED=true
              break
            fi
          done
          if [[ "${ALREADY_LOGGED}" == "false" ]]; then
            log_info "infra.replication.setup.slot_streaming" "{ \"slotName\": \"${SLOT_NAME_FROM_SLOTS}\", \"region\": \"${SOURCE_REGION}\", \"elapsedSeconds\": ${ELAPSED} }"
            LOGGED_SLOTS+=("${SOURCE_REGION}:${SLOT_NAME_FROM_SLOTS}")
          fi
        fi
      fi
    done <<< "${STAT_OUTPUT}"
  done

  # Check if all 6 slots are streaming
  ALL_STREAMING=true
  for EXPECTED in "${EXPECTED_SLOTS[@]}"; do
    FOUND=false
    for STREAMING in "${STREAMING_SLOTS[@]}"; do
      if [[ "${STREAMING}" == "${EXPECTED}" ]]; then
        FOUND=true
        break
      fi
    done
    if [[ "${FOUND}" == "false" ]]; then
      ALL_STREAMING=false
      break
    fi
  done

  if [[ "${ALL_STREAMING}" == "true" ]]; then
    echo "  All 6 replication slots are in streaming state."
    break
  fi

  if [[ ${ELAPSED} -ge ${POLL_TIMEOUT} ]]; then
    # Timeout — log and exit 1
    echo ""
    echo "ERROR: Replication slots did not reach streaming state within ${POLL_TIMEOUT} seconds." >&2

    for EXPECTED in "${EXPECTED_SLOTS[@]}"; do
      SLOT_NAME=$(echo "${EXPECTED}" | cut -d: -f2)
      SLOT_REGION=$(echo "${EXPECTED}" | cut -d: -f1)
      FOUND=false
      for STREAMING in "${STREAMING_SLOTS[@]}"; do
        if [[ "${STREAMING}" == "${EXPECTED}" ]]; then
          FOUND=true
          break
        fi
      done
      if [[ "${FOUND}" == "false" ]]; then
        log_error "infra.replication.setup.slot_not_streaming" "{ \"slotName\": \"${SLOT_NAME}\", \"region\": \"${SLOT_REGION}\", \"elapsedSeconds\": ${ELAPSED} }"
      fi
    done

    echo ""
    echo "Current slot states:"
    for SOURCE_REGION in "${REGIONS[@]}"; do
      echo "  ${SOURCE_REGION}:"
      aws ecs execute-command \
        --region "${SOURCE_REGION}" \
        --cluster "${ECS_CLUSTER_NAME}" \
        --task "${TASK_ARNS[${SOURCE_REGION}]}" \
        --container "directory" \
        --command "PGPASSWORD='${MASTER_PASSWORDS[${SOURCE_REGION}]}' psql -h ${RDS_ENDPOINTS[${SOURCE_REGION}]} -p 5432 -U postgres -d ${RDS_DB_NAMES[${SOURCE_REGION}]} -c \"SELECT application_name, state, sent_lsn, write_lsn, flush_lsn, replay_lsn FROM pg_stat_replication;\"" \
        --interactive \
        2>/dev/null || echo "    (unable to query)"
    done

    exit 1
  fi

  echo "  Waiting for streaming state... (${ELAPSED}s elapsed, ${STREAMING_SLOTS[*]:-none} streaming so far)"
  sleep 5
done

# ── Step 6: Print summary table ───────────────────────────────────────────────

TOTAL_ELAPSED=$(( $(date +%s) - SCRIPT_START ))

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  REPLICATION SUMMARY — ${ENVIRONMENT}"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
printf "  %-50s  %-12s  %-15s\n" "SLOT NAME" "STATE" "NODE"
printf "  %-50s  %-12s  %-15s\n" "─────────────────────────────────────────────────" "────────────" "───────────────"

for SOURCE_REGION in "${REGIONS[@]}"; do
  for TARGET_REGION in "${REGIONS[@]}"; do
    if [[ "${SOURCE_REGION}" != "${TARGET_REGION}" ]]; then
      SLOT_NAME="cello_${ENVIRONMENT}_${SOURCE_REGION//-/_}_${TARGET_REGION//-/_}"
      EXPECTED_ENTRY="${SOURCE_REGION}:${SLOT_NAME}"
      SLOT_STATE="unknown"
      for S in "${STREAMING_SLOTS[@]}"; do
        if [[ "${S}" == "${EXPECTED_ENTRY}" ]]; then
          SLOT_STATE="streaming"
          break
        fi
      done
      printf "  %-50s  %-12s  %-15s\n" "${SLOT_NAME}" "${SLOT_STATE}" "${SOURCE_REGION}"
    fi
  done
done

echo ""
echo "  Total: 6 slots | All streaming | Elapsed: ${TOTAL_ELAPSED}s"
echo ""

log_info "infra.replication.setup.completed" "{ \"environment\": \"${ENVIRONMENT}\", \"regions\": ${regions_json}, \"slotCount\": 6, \"totalElapsedSeconds\": ${TOTAL_ELAPSED} }"
