#!/bin/sh
# CELLO Directory Service — ECS task entrypoint (DEPLOY-002)
#
# SI-001: set -e ensures any non-zero exit from flyway migrate
# aborts the script before the directory service process starts.
#
# Flow:
#   1. Resolve DATABASE_URL (direct or via Secrets Manager credentials + RDS env vars)
#   2. Run flyway migrate against the database
#   3. If flyway exits non-zero → script aborts (set -e), task fails health check
#   4. If flyway succeeds → exec the directory service process
#
# Environment variables:
#   DATABASE_URL                — direct connection string (used in CELLO_ENV=local)
#   RDS_CREDENTIALS_SECRET_ARN — Secrets Manager ARN for {username, password} (used in ECS)
#   RDS_ENDPOINT                — RDS hostname (injected from CloudFormation export)
#   RDS_PORT                    — RDS port (injected from CloudFormation export)
#   RDS_DB_NAME                 — database name (injected from CloudFormation export)
#   AWS_REGION                  — AWS region for Secrets Manager calls (default: us-east-1)
#   CELLO_ENV                   — local | dev | staging | production

set -e

# ─── Resolve DATABASE_URL ──────────────────────────────────────────────────
# If DATABASE_URL is not set but RDS_CREDENTIALS_SECRET_ARN is, fetch credentials
# from Secrets Manager using the AWS CLI and combine with RDS_ENDPOINT/PORT/DB_NAME.

if [ -z "$DATABASE_URL" ] && [ -n "$RDS_CREDENTIALS_SECRET_ARN" ]; then
  REGION="${AWS_REGION:-us-east-1}"

  if [ -z "$RDS_ENDPOINT" ] || [ -z "$RDS_PORT" ] || [ -z "$RDS_DB_NAME" ]; then
    echo '{"event":"migration.failed","level":"error","reason":"RDS_ENDPOINT, RDS_PORT and RDS_DB_NAME are required when using RDS_CREDENTIALS_SECRET_ARN"}'
    exit 1
  fi

  SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$RDS_CREDENTIALS_SECRET_ARN" \
    --region "$REGION" \
    --query SecretString \
    --output text)

  if [ -z "$SECRET_JSON" ]; then
    echo '{"event":"directory.secrets.unavailable","level":"error","reason":"empty secret value"}'
    exit 1
  fi

  DB_USER=$(echo "$SECRET_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['username'])")
  DB_PASS=$(echo "$SECRET_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])")

  # URL-encode password for connection string
  DB_PASS_ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$DB_PASS")

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASS_ENCODED}@${RDS_ENDPOINT}:${RDS_PORT}/${RDS_DB_NAME}"
  export DATABASE_URL
fi

if [ -z "$DATABASE_URL" ]; then
  echo '{"event":"migration.failed","level":"error","reason":"DATABASE_URL not set and RDS_CREDENTIALS_SECRET_ARN not available"}'
  exit 1
fi

# ─── Parse DATABASE_URL for Flyway JDBC format ─────────────────────────────
# DATABASE_URL format: postgresql://user:pass@host:port/dbname
# Flyway JDBC format:  jdbc:postgresql://host:port/dbname

DB_HOST_PORT_NAME=$(echo "$DATABASE_URL" | sed 's|^postgres\(ql\)\?://[^@]*@||')
FLYWAY_URL="jdbc:postgresql://${DB_HOST_PORT_NAME}"
FLYWAY_USER=$(echo "$DATABASE_URL" | sed 's|^postgres\(ql\)\?://||' | sed 's|:.*||')
FLYWAY_PASSWORD=$(echo "$DATABASE_URL" | sed 's|^postgres\(ql\)\?://[^:]*:||' | sed 's|@.*||')

export FLYWAY_URL
export FLYWAY_USER
export FLYWAY_PASSWORD
export FLYWAY_LOCATIONS="filesystem:/flyway/sql"
export FLYWAY_CONNECT_RETRIES=5

# ─── Run Flyway migrations ─────────────────────────────────────────────────
echo '{"event":"migration.starting","level":"info"}'
flyway migrate

echo '{"event":"migration.complete","level":"info"}'

# ─── Start directory service ───────────────────────────────────────────────
exec node /app/packages/directory/dist/bin/directory.js
