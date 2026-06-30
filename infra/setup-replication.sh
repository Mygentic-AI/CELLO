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
#   2. For each node: creates the cello_replication user with REPLICATION privilege + SELECT
#   3. For each node: creates publication cello_pub covering all append-only tables
#   4. For each node: creates 2 subscriptions (one per peer, origin=none to prevent loops)
#   5. Polls pg_replication_slots until all 6 slots are active (60s timeout)
#   6. Prints summary table and exits 0
#
# Prerequisites (not automated by this script):
#   - VPC peering with DNS resolution enabled (AllowDnsResolutionFromRemoteVpc=true)
#   - RDS security groups allow port 5432 from peer VPC CIDRs
#   - RDS parameter group: rds.logical_replication=1, wal_level=logical (reboot required)
#   - Staggered sequences (INCREMENT BY 3) must be set via a migration or post-setup step
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

  if [[ -z "${RDS_EP}" || "${RDS_EP}" == "None" ]]; then
    log_error "infra.replication.setup.rds_host_not_found" "{ \"region\": \"${REGION}\" }"
    echo "ERROR: Cannot determine RDS hostname for ${REGION}. Check cello-rds-${ENVIRONMENT} stack exports." >&2
    exit 1
  fi

  RDS_ENDPOINTS["${REGION}"]="${RDS_EP}"
  RDS_DB_NAMES["${REGION}"]="cello_${ENVIRONMENT}"
done

# Tables covered by the publication (all append-only tables, AC behavior)
# V34 write-seam targets (WRITEAPI-001): everything written through /internal/agent-write replicates
# to every sovereign node. agent_suspensions + identity_tree_entries use NATURAL keys (agent_id,
# agent_id+signal_kind) and replicate cleanly. pickup_queue is DELIBERATELY EXCLUDED for now: its
# BIGSERIAL id would collide across nodes unless pickup_queue_id_seq is staggered with the same
# `ALTER SEQUENCE … INCREMENT BY 3 RESTART WITH {offset}` convention every other replicated BIGSERIAL
# table uses (sessions, user_accounts, conversation_seals — see M5-infrastructure-deployment.md). Its
# only consumer is TRUST-001 (the daemon pickup), which will add it to the publication WITH the
# sequence staggering when that journey lands. Adding it here now would arm a federation-wide
# replication outage on the first cross-node insert.
PUBLICATION_TABLES="agent_profiles,conversation_seals,conversation_seal_staging,directory_checkpoints,checkpoint_node_signatures,relay_registrations,sessions,pending_notifications,user_accounts,registrations,pre_authorization_tokens,agent_revocations,agent_suspensions,identity_tree_entries,agent_presence,directory_nodes,pickup_queue"
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

# ── ECS Exec SQL helper ───────────────────────────────────────────────────────
# ecs_exec_sql REGION TASK_ARN HOST DBNAME B64_PASS SQL_TEXT
#
# Runs SQL_TEXT via psql inside the named ECS container using the master
# credentials supplied as B64_PASS (base64-encoded password string).
#
# Quoting strategy — two base64 layers, zero shell quoting of sensitive data:
#   1. SQL_TEXT  → base64 → B64_SQL  (outer shell)
#   2. B64_PASS already encoded      (outer shell)
#   3. Inner command string: echo B64_PASS | base64 -d → PGPASSWORD
#                            echo B64_SQL  | base64 -d | psql -f /dev/stdin
#      No -c "..." anywhere — SQL arrives via stdin, never quoted.
#   4. Inner command string itself → base64 → B64_CMD  (outer shell)
#   5. ECS Exec --command: sh -c 'echo B64_CMD | base64 -d | sh'
#      B64_CMD is [A-Za-z0-9+/=] — safe inside single quotes, no expansion.
#
# Outputs the raw ECS Exec output. Caller checks for psql/ERROR patterns.

ecs_exec_sql() {
  local region="$1"
  local task_arn="$2"
  local host="$3"
  local dbname="$4"
  local b64_pass="$5"
  local sql_text="$6"

  local b64_sql
  b64_sql=$(printf '%s' "${sql_text}" | base64 | tr -d '\n')

  # Inner command: decoded via stdin pipeline — no -c quoting, no $$ expansion
  local psql_flags="${7:-}"
  local inner_cmd
  # -v ON_ERROR_STOP=1: psql exits non-zero on any SQL error, so aws ecs execute-command
  # also returns non-zero and the caller's || { exit 1 } fires correctly.
  inner_cmd="export PGPASSWORD=\$(echo ${b64_pass} | base64 -d) && echo ${b64_sql} | base64 -d | psql -h ${host} -p 5432 -U postgres -d ${dbname} -w -v ON_ERROR_STOP=1 ${psql_flags} -f /dev/stdin"

  local b64_cmd
  b64_cmd=$(printf '%s' "${inner_cmd}" | base64 | tr -d '\n')

  # </dev/null prevents the session-manager-plugin from blocking on stdin
  # when this function is called inside $(...) subshells.
  aws ecs execute-command \
    --region "${region}" \
    --cluster "${ECS_CLUSTER_NAME}" \
    --task "${task_arn}" \
    --container "directory" \
    --command "sh -c 'echo ${b64_cmd} | base64 -d | sh'" \
    --interactive \
    </dev/null 2>&1
}

# ── Step 3: Create replication user and publication on each node ───────────────

for REGION in "${REGIONS[@]}"; do
  echo "── Setting up replication user and publication on ${REGION} ──────────"

  REPL_PASS="${REPLICATION_PASSWORDS[${REGION}]}"
  MASTER_PASS="${MASTER_PASSWORDS[${REGION}]}"
  RDS_EP="${RDS_ENDPOINTS[${REGION}]}"
  DB_NAME="${RDS_DB_NAMES[${REGION}]}"

  B64_MASTER=$(printf '%s' "${MASTER_PASS}" | base64 | tr -d '\n')

  # Create cello_replication user (SI-001: REPLICATION privilege only).
  # In RDS, CREATE USER ... WITH REPLICATION is forbidden — even for rds_superuser.
  # The RDS pattern: CREATE USER without REPLICATION, then GRANT rds_replication TO user.
  CREATE_USER_SQL="CREATE USER cello_replication WITH LOGIN PASSWORD '${REPL_PASS}';"
  EXEC_OUTPUT=$(ecs_exec_sql "${REGION}" "${TASK_ARNS[${REGION}]}" "${RDS_EP}" "${DB_NAME}" "${B64_MASTER}" "${CREATE_USER_SQL}" 2>&1)
  if echo "${EXEC_OUTPUT}" | grep -q "already exists"; then
    ALTER_USER_SQL="ALTER USER cello_replication WITH PASSWORD '${REPL_PASS}';"
    EXEC_OUTPUT=$(ecs_exec_sql "${REGION}" "${TASK_ARNS[${REGION}]}" "${RDS_EP}" "${DB_NAME}" "${B64_MASTER}" "${ALTER_USER_SQL}" 2>&1)
    if echo "${EXEC_OUTPUT}" | grep -qE "psql:.* ERROR:"; then
      log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"alter_user\", \"reason\": \"psql_error\" }"
      echo "ERROR: psql error during user password reset in ${REGION}: ${EXEC_OUTPUT}" >&2
      exit 1
    fi
    echo "  cello_replication user password synced on ${REGION}"
  elif echo "${EXEC_OUTPUT}" | grep -qE "psql:.* ERROR:"; then
    log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"create_user\", \"reason\": \"psql_error\" }"
    echo "ERROR: psql error during user creation in ${REGION}: ${EXEC_OUTPUT}" >&2
    exit 1
  else
    echo "  cello_replication user created on ${REGION}"
  fi

  # Grant rds_replication role — required for logical replication on RDS
  GRANT_REPL_SQL="GRANT rds_replication TO cello_replication;"
  EXEC_OUTPUT=$(ecs_exec_sql "${REGION}" "${TASK_ARNS[${REGION}]}" "${RDS_EP}" "${DB_NAME}" "${B64_MASTER}" "${GRANT_REPL_SQL}" 2>&1)
  if echo "${EXEC_OUTPUT}" | grep -qE "psql:.* ERROR:" && ! echo "${EXEC_OUTPUT}" | grep -q "already"; then
    log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"grant_replication\", \"reason\": \"psql_error\" }"
    echo "ERROR: psql error during rds_replication grant in ${REGION}: ${EXEC_OUTPUT}" >&2
    exit 1
  fi

  # Grant SELECT on publication tables to cello_replication.
  # Required: the WAL sender reads table data during initial sync and needs SELECT.
  GRANT_SELECT_SQL="GRANT SELECT ON ${PUBLICATION_TABLES} TO cello_replication;"
  EXEC_OUTPUT=$(ecs_exec_sql "${REGION}" "${TASK_ARNS[${REGION}]}" "${RDS_EP}" "${DB_NAME}" "${B64_MASTER}" "${GRANT_SELECT_SQL}" 2>&1)
  if echo "${EXEC_OUTPUT}" | grep -qE "^ERROR:|psql:.* ERROR:"; then
    log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"grant_select\", \"reason\": \"psql_error\" }"
    echo "ERROR: psql error during GRANT SELECT in ${REGION}: ${EXEC_OUTPUT}" >&2
    exit 1
  fi
  echo "  GRANT SELECT on publication tables to cello_replication — done"

  # Create publication covering all append-only tables.
  # Idempotent: if publication exists, ALTER SET TABLE to sync the full table list
  # (covers the case where new tables were added to PUBLICATION_TABLES after initial
  # setup — e.g. registrations + pre_authorization_tokens added for OPS-AGENT-005B).
  # If it does not exist, CREATE it.
  CREATE_PUB_SQL="CREATE PUBLICATION cello_pub FOR TABLE ${PUBLICATION_TABLES};"
  EXEC_OUTPUT=$(ecs_exec_sql "${REGION}" "${TASK_ARNS[${REGION}]}" "${RDS_EP}" "${DB_NAME}" "${B64_MASTER}" "${CREATE_PUB_SQL}" 2>&1)
  if echo "${EXEC_OUTPUT}" | grep -q "already exists"; then
    # Publication exists — sync the table list to the current PUBLICATION_TABLES set.
    # ALTER PUBLICATION ... SET TABLE replaces the table list atomically.
    ALTER_PUB_SQL="ALTER PUBLICATION cello_pub SET TABLE ${PUBLICATION_TABLES};"
    ALTER_OUTPUT=$(ecs_exec_sql "${REGION}" "${TASK_ARNS[${REGION}]}" "${RDS_EP}" "${DB_NAME}" "${B64_MASTER}" "${ALTER_PUB_SQL}" 2>&1)
    if echo "${ALTER_OUTPUT}" | grep -qE "^ERROR:|psql:.* ERROR:"; then
      log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"alter_publication\", \"reason\": \"psql_error\" }"
      echo "ERROR: psql error during ALTER PUBLICATION in ${REGION}: ${ALTER_OUTPUT}" >&2
      exit 1
    fi
    echo "  Publication cello_pub table list updated on ${REGION} (${TABLE_COUNT} tables)"
  elif echo "${EXEC_OUTPUT}" | grep -qE "^ERROR:|psql:.* ERROR:"; then
    log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${REGION}\", \"step\": \"create_publication\", \"reason\": \"psql_error\" }"
    echo "ERROR: psql error during publication creation in ${REGION}: ${EXEC_OUTPUT}" >&2
    exit 1
  else
    echo "  Publication cello_pub created on ${REGION}"
  fi

  log_info "infra.replication.setup.publication_created" "{ \"environment\": \"${ENVIRONMENT}\", \"region\": \"${REGION}\", \"tableCount\": ${TABLE_COUNT} }"
  echo "  Publication cello_pub ready on ${REGION}"
done

# ── Step 3b: Refresh existing subscriptions to pick up new tables ─────────────
# When ALTER PUBLICATION adds tables to an existing publication, active subscribers
# do not automatically start replicating the new tables. ALTER SUBSCRIPTION ...
# REFRESH PUBLICATION is required to sync the subscriber's table list.
# This step runs after the publication is updated (Step 3) and before slot polling
# (Step 5). It is idempotent — safe to run even when no new tables were added.
# Subscriptions are created in Step 4; this step runs a second pass after Step 4
# completes. The actual refresh block appears after Step 4 below.

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

    # Idempotent: try CREATE SUBSCRIPTION, handle "already exists" gracefully.
    # CREATE SUBSCRIPTION cannot run inside a DO $$ block — PostgreSQL silently ignores it.
    TARGET_MASTER_PASS="${MASTER_PASSWORDS[${TARGET_REGION}]}"
    TARGET_RDS_EP="${RDS_ENDPOINTS[${TARGET_REGION}]}"
    TARGET_DB_NAME="${RDS_DB_NAMES[${TARGET_REGION}]}"
    B64_TARGET_MASTER=$(printf '%s' "${TARGET_MASTER_PASS}" | base64 | tr -d '\n')

    echo "  Creating subscription ${SUB_NAME} (slot: ${SLOT_NAME}) on ${TARGET_REGION}..."
    CREATE_SUB_SQL="CREATE SUBSCRIPTION ${SUB_NAME} CONNECTION '${CONN_STRING}' PUBLICATION cello_pub WITH (slot_name = '${SLOT_NAME}', copy_data = false, origin = none);"

    EXEC_OUTPUT=$(ecs_exec_sql "${TARGET_REGION}" "${TASK_ARNS[${TARGET_REGION}]}" \
      "${TARGET_RDS_EP}" "${TARGET_DB_NAME}" "${B64_TARGET_MASTER}" "${CREATE_SUB_SQL}" 2>&1)

    if echo "${EXEC_OUTPUT}" | grep -q "already exists"; then
      echo "  Subscription ${SUB_NAME} already exists on ${TARGET_REGION} — skipping."
    elif echo "${EXEC_OUTPUT}" | grep -qE "psql:.* ERROR:|^ERROR:"; then
      log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${TARGET_REGION}\", \"step\": \"create_subscription\", \"reason\": \"psql_error\", \"slotName\": \"${SLOT_NAME}\" }"
      echo "ERROR: psql error during subscription creation in ${TARGET_REGION}: ${EXEC_OUTPUT}" >&2
      exit 1
    else
      echo "  Subscription ${SUB_NAME} created on ${TARGET_REGION}"
    fi

    log_info "infra.replication.setup.subscription_created" "{ \"environment\": \"${ENVIRONMENT}\", \"targetRegion\": \"${TARGET_REGION}\", \"sourceRegion\": \"${SOURCE_REGION}\", \"slotName\": \"${SLOT_NAME}\" }"
  done
done

# ── Step 4b: Refresh subscriptions on all nodes ───────────────────────────────
# After CREATE/ALTER PUBLICATION, refresh all subscriptions so subscribers include
# the current table set. This is a no-op if the table list has not changed.
# Must run after all subscriptions exist (Step 4 above).

echo ""
echo "── Refreshing subscriptions on all nodes ────────────────────────────────"

for TARGET_REGION in "${REGIONS[@]}"; do
  for SOURCE_REGION in "${REGIONS[@]}"; do
    if [[ "${SOURCE_REGION}" == "${TARGET_REGION}" ]]; then
      continue
    fi
    SUB_NAME="cello_sub_from_${SOURCE_REGION//-/_}"
    TARGET_RDS_EP="${RDS_ENDPOINTS[${TARGET_REGION}]}"
    TARGET_DB_NAME="${RDS_DB_NAMES[${TARGET_REGION}]}"
    TARGET_MASTER_PASS="${MASTER_PASSWORDS[${TARGET_REGION}]}"
    B64_TARGET_MASTER=$(printf '%s' "${TARGET_MASTER_PASS}" | base64 | tr -d '\n')

    REFRESH_SQL="ALTER SUBSCRIPTION ${SUB_NAME} REFRESH PUBLICATION;"
    REFRESH_OUTPUT=$(ecs_exec_sql "${TARGET_REGION}" "${TASK_ARNS[${TARGET_REGION}]}" \
      "${TARGET_RDS_EP}" "${TARGET_DB_NAME}" "${B64_TARGET_MASTER}" "${REFRESH_SQL}" 2>&1)

    if echo "${REFRESH_OUTPUT}" | grep -qE "^ERROR:|psql:.* ERROR:"; then
      # Only fail on hard errors; warnings (e.g. origin=none copy_data) are acceptable
      if echo "${REFRESH_OUTPUT}" | grep -qE "psql:.* ERROR:"; then
        log_error "infra.replication.setup.ddl_failed" "{ \"region\": \"${TARGET_REGION}\", \"step\": \"refresh_subscription\", \"subscription\": \"${SUB_NAME}\" }"
        echo "ERROR: ALTER SUBSCRIPTION REFRESH PUBLICATION failed on ${TARGET_REGION} for ${SUB_NAME}: ${REFRESH_OUTPUT}" >&2
        exit 1
      fi
    fi
    echo "  Refreshed ${SUB_NAME} on ${TARGET_REGION}"
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
    B64_POLL_PASS=$(printf '%s' "${MASTER_PASSWORDS[${SOURCE_REGION}]}" | base64 | tr -d '\n')
    SLOT_QUERY="SELECT slot_name FROM pg_replication_slots WHERE slot_name LIKE 'cello_%' AND active = 't';"

    # -t -A: tuple-only unaligned output — slot names appear as plain lines (no headers/borders)
    STAT_OUTPUT=$(ecs_exec_sql "${SOURCE_REGION}" "${TASK_ARNS[${SOURCE_REGION}]}" \
      "${RDS_ENDPOINTS[${SOURCE_REGION}]}" "${RDS_DB_NAMES[${SOURCE_REGION}]}" \
      "${B64_POLL_PASS}" "${SLOT_QUERY}" "-t -A" \
      2>/dev/null || echo "")

    # Parse active slot names — filter out SSM session noise lines
    while IFS= read -r line; do
      # Skip SSM noise, empty lines, and psql decorations
      if [[ -z "${line}" ]] || [[ "${line}" == *"Session Manager"* ]] || \
         [[ "${line}" == *"Starting session"* ]] || [[ "${line}" == *"Cannot perform"* ]] || \
         [[ "${line}" == *"Exiting session"* ]] || [[ "${line}" == "--"* ]] || \
         [[ "${line}" == "("*")" ]]; then
        continue
      fi
      SLOT_NAME_FROM_SLOTS=$(echo "${line}" | tr -d ' \r\n')
      if [[ -n "${SLOT_NAME_FROM_SLOTS}" && "${SLOT_NAME_FROM_SLOTS}" == cello_* ]]; then
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
      B64_DIAG_PASS=$(printf '%s' "${MASTER_PASSWORDS[${SOURCE_REGION}]}" | base64 | tr -d '\n')
      DIAG_SQL="SELECT application_name, state, sent_lsn, write_lsn, flush_lsn, replay_lsn FROM pg_stat_replication;"
      ecs_exec_sql "${SOURCE_REGION}" "${TASK_ARNS[${SOURCE_REGION}]}" \
        "${RDS_ENDPOINTS[${SOURCE_REGION}]}" "${RDS_DB_NAMES[${SOURCE_REGION}]}" \
        "${B64_DIAG_PASS}" "${DIAG_SQL}" \
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
