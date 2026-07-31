#!/usr/bin/env bash
#
# The enforcer for DOD-GCP-SCHEMA-1 (M11 P4).
#
# Checks the three clauses of the line against the LIVE GCP portal Cloud SQL,
# not against a local database and not against the migration files:
#
#   1. All 20 waitlist tables exist.
#   2. The shared ledger holds exactly 37 rows (11 portal + 26 waitlist).
#   3. Re-running the migrator applies 0 (idempotent).
#
# Clause 3 is the one that cannot be checked by looking. It runs the real
# migrator a second time and asserts the applied count is zero — the property
# that separates "the tables are there" from "the ledger and the schema agree".
#
# WHY THE TABLE LIST IS SPELLED OUT rather than counted. The first pass at this
# check on 2026-07-31 asked whether `waitlist_signups`, `gallery_items` and
# `social_profiles` existed. None of those names appear in any migration, so it
# reported "zero waitlist tables" — correctly, and for a database that held all
# twenty it would have said the same thing. A check whose names cannot exist
# passes for the wrong reason. These twenty are extracted from the migration
# files; if a migration adds a table, add it here and the count moves with it.
#
# ACCESS: the Cloud SQL Auth Proxy, never `gcloud sql connect` — the latter
# allowlists the caller's IP on the instance and does not remove it, which makes
# reading the database a write to its configuration.
#
#   ./infra/scripts/verify-gcp-waitlist-schema.sh
#
# Exits non-zero on the first failed clause, naming which one and what it saw.
set -euo pipefail

PROJECT="${GCP_PROJECT:-cello-infra}"
INSTANCE="${GCP_SQL_INSTANCE:-cello-infra:us-east1:cello-portal}"
PORT="${PROXY_PORT:-55432}"
DB="${GCP_DB_NAME:-cello_portal}"
DB_USER="${GCP_DB_USER:-cello_portal}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/../corp-cello-site/migrations}"
LAMBDA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lambda"

# Nineteen. Derived by stripping SQL comments FIRST and then matching CREATE
# TABLE — because not doing so is how this list first said twenty. A comment in
# 0002 reads "CREATE TABLE IF NOT EXISTS skips the table wholesale", and a naive
# grep read `skips` as a table name. It failed loudly here rather than passing
# vacuously, which is the only reason it was cheap: this check requires each
# name to be PRESENT, so an invented one fails. A check written the other way
# round — "no unexpected tables" — would have swallowed it.
EXPECTED_TABLES=(
  auth_link_requests auth_tokens creator_tracking email_jobs
  points_ledger post_review_queue published_receipts referral_codes
  referrals session_telemetry status_notes
  telegram_accounts waitlist_agent_links waitlist_sessions
  waitlist_social_profiles waitlist_tokens waitlist_touchpoints
  waitlist_users waves
)
# Not a table, and load-bearing: DOD-QUEUE-VIEW-1 requires queue_position to be
# COMPUTED, never a stored column. If this view is absent the status page and E1
# have no position to render.
EXPECTED_VIEWS=(waitlist_queue)
EXPECTED_LEDGER_ROWS="${EXPECTED_LEDGER_ROWS:-37}"

fail() { echo "FAIL — $*" >&2; exit 1; }

command -v cloud-sql-proxy >/dev/null || fail "cloud-sql-proxy not installed (brew install cloud-sql-proxy)"
command -v psql >/dev/null || fail "psql not installed"
[ -d "$MIGRATIONS_DIR" ] || fail "migrations dir not found: $MIGRATIONS_DIR"

# --quota-project is required. Without it ADC bills the quota to whatever
# `gcloud config` happens to name, and the proxy dies with accessNotConfigured
# on sqladmin.googleapis.com if that project has the API disabled.
cloud-sql-proxy --quota-project "$PROJECT" --port "$PORT" "$INSTANCE" >/tmp/gcp-schema-proxy.log 2>&1 &
PROXY_PID=$!
cleanup() { kill "$PROXY_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 30); do
  grep -q "ready for new connections" /tmp/gcp-schema-proxy.log 2>/dev/null && break
  sleep 1
done
grep -q "ready for new connections" /tmp/gcp-schema-proxy.log \
  || fail "proxy did not start — $(tail -3 /tmp/gcp-schema-proxy.log)"

PGPASSWORD="$(gcloud secrets versions access latest \
  --secret=cello-portal-database-url --project="$PROJECT" \
  | sed -E 's#^postgresql://[^:]+:([^@]+)@.*$#\1#' \
  | python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))')"
export PGPASSWORD
URL="postgresql://${DB_USER}@127.0.0.1:${PORT}/${DB}"

psql "$URL" -tAc "SELECT 1" >/dev/null || fail "cannot reach $DB through the proxy"

# ── Clause 1: all 20 waitlist tables exist ───────────────────────────────────
missing=()
for t in "${EXPECTED_TABLES[@]}"; do
  found="$(psql "$URL" -tAc \
    "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='${t}'")"
  [ "$found" = "1" ] || missing+=("$t")
done
if [ ${#missing[@]} -ne 0 ]; then
  fail "clause 1 — ${#missing[@]} of ${#EXPECTED_TABLES[@]} waitlist tables missing: ${missing[*]}"
fi
for v in "${EXPECTED_VIEWS[@]}"; do
  found="$(psql "$URL" -tAc \
    "SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='${v}'")"
  [ "$found" = "1" ] || fail "clause 1 — view ${v} missing (DOD-QUEUE-VIEW-1)"
done
# queue_position must be COMPUTED. A stored column of that name means someone
# materialised the ranking, which DOD-QUEUE-VIEW-1 forbids outright.
stored="$(psql "$URL" -tAc \
  "SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='waitlist_users'
      AND column_name='queue_position'")"
[ -z "$stored" ] || fail "clause 1 — waitlist_users.queue_position exists as a STORED column; DOD-QUEUE-VIEW-1 requires it computed"
echo "ok   clause 1 — all ${#EXPECTED_TABLES[@]} waitlist tables + the ${#EXPECTED_VIEWS[@]} view present, position not stored"

# ── Clause 2: the shared ledger holds exactly 37 rows ────────────────────────
rows="$(psql "$URL" -tAc "SELECT count(*) FROM schema_migrations")"
[ "$rows" = "$EXPECTED_LEDGER_ROWS" ] \
  || fail "clause 2 — ledger holds $rows rows, expected $EXPECTED_LEDGER_ROWS (11 portal + 26 waitlist)"
echo "ok   clause 2 — ledger holds $rows rows"

# ── Clause 3: a second run applies 0 ─────────────────────────────────────────
# The real migrator, not a reimplementation of it.
#
# PGSSLMODE=disable is NOT a downgrade, and it is the knob the handler already
# exposes for this. The handler defaults to `require` because on AWS it talks to
# the RDS endpoint directly. Here the hop is to 127.0.0.1 — the Cloud SQL Auth
# Proxy is the TLS client, and it holds the mutual-TLS session to the instance.
# Demanding SSL on the loopback leg fails with "server does not support SSL",
# which reads like a misconfigured database and is actually a correctly
# configured proxy. The wire to Google is encrypted either way.
second="$(cd "$LAMBDA_DIR" && \
  DATABASE_URL="$URL" \
  PGSSLMODE=disable \
  PGPASSWORD="$PGPASSWORD" \
  MIGRATIONS_DIR="$MIGRATIONS_DIR" \
  PYTHONPATH="$LAMBDA_DIR" \
  python3 -c '
import json, sys
sys.path.insert(0, "waitlist-migrate")
import handler
print(json.dumps(handler.lambda_handler({}, None)))
')"
applied="$(printf '%s' "$second" | python3 -c '
import json,sys
body = json.load(sys.stdin)
if isinstance(body.get("body"), str):
    body = json.loads(body["body"])
print(len(body.get("applied", [])))
')"
[ "$applied" = "0" ] || fail "clause 3 — a second run applied $applied migrations, expected 0. Not idempotent."
echo "ok   clause 3 — second run applied 0"

echo
echo "DOD-GCP-SCHEMA-1: all three clauses green against ${INSTANCE}"
