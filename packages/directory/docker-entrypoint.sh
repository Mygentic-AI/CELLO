#!/bin/sh
# CELLO Directory Service — ECS task entrypoint (DEPLOY-002)
#
# SI-001: set -e ensures any non-zero exit from flyway migrate
# aborts the script before the directory service process starts.
#
# Flow:
#   1. Run flyway migrate against the regional RDS instance
#   2. If flyway exits non-zero → script aborts (set -e), task fails health check
#   3. If flyway succeeds → exec the directory service process
#
# Environment variables expected:
#   DATABASE_URL — PostgreSQL connection string (from Secrets Manager via ECS)
#   CELLO_ENV   — local | dev | staging | production

set -e

# ─── Parse DATABASE_URL for Flyway JDBC format ─────────────────────────────
# DATABASE_URL format: postgresql://user:pass@host:port/dbname
# Flyway JDBC format:  jdbc:postgresql://host:port/dbname

if [ -z "$DATABASE_URL" ]; then
  echo '{"event":"migration.failed","level":"error","reason":"DATABASE_URL not set"}'
  exit 1
fi

# Extract components from DATABASE_URL
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
