#!/usr/bin/env bash
#
# The enforcer for DOD-GCP-SCHEMA-1 (M11 P4).
#
# Checks the line's clauses against the LIVE GCP portal Cloud SQL:
#
#   1. The checkout holds the 26 migrations the line names, EXPECTED_TABLES
#      agrees with what those files actually create, and every one of the 26
#      stems has a ledger row.
#   2. All 19 waitlist tables + the waitlist_queue view exist, and
#      queue_position is not a stored column (DOD-QUEUE-VIEW-1).
#   3. The ledger holds 11 portal + 26 waitlist rows — as a SET, not a total.
#   4. Nothing is pending: the migrator, in DRY RUN, has nothing left to apply.
#
# READ-ONLY AGAINST THE DATABASE. Clause 4 used to call the migrator in APPLY
# mode to prove "a second run applies 0". That made the checker a writer: point
# MIGRATIONS_DIR at a checkout carrying an unmerged 0027 and the check APPLIES
# it to the live portal database, then reports `not idempotent` — naming the
# migrator for what is checkout drift, after the write already happened and
# could not be undone by re-running. The dry run proves the same property. The
# handler verifies every applied checksum (rejecting an edited migration) and
# rejects any `<stem>.sql`-keyed ledger row BEFORE it returns, so all of that
# strength survives; only the write is gone.
#
# WHY THE TABLE LIST IS BOTH DERIVED AND PINNED. Each catches what the other
# cannot. The hand list fails loudly on a name that cannot exist — that is how
# `skips` died in under a minute, having been grepped out of a COMMENT reading
# "CREATE TABLE IF NOT EXISTS skips the table wholesale". But a hand list is
# also the classic hollow shape: drop a name and the loop just gets shorter,
# never red. So the files are parsed independently and diffed against the list,
# and the count is pinned so a genuinely new table has to be a decision.
#
# DO NOT rewrite the presence check as "no unexpected tables". That direction
# cannot fail on an invented name, which is the property that matters here.
#
# ACCESS: the Cloud SQL Auth Proxy, never `gcloud sql connect` — the latter
# allowlists the caller's IP on the instance and does not remove it, which turns
# reading the database into a write to its configuration.
#
#   ./infra/scripts/verify-gcp-waitlist-schema.sh
#
# Exits non-zero on the first failed clause, naming the clause and the cause.
set -euo pipefail

PROJECT="${GCP_PROJECT:-cello-infra}"
INSTANCE="${GCP_SQL_INSTANCE:-cello-infra:us-east1:cello-portal}"
DB="${GCP_DB_NAME:-cello_portal}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-${REPO_ROOT}/../corp-cello-site/migrations}"
LAMBDA_DIR="${REPO_ROOT}/infra/lambda"

# 56432, NOT 55432, and this is not arbitrary. 55432 is where the local
# `cello-portal-postgres` container binds, and waitlist_testdb.py defaults to
# `postgres://m11:m11@localhost:55432/m11_test` — the whole Python suite reaches
# for that port. Running the proxy there puts the PRODUCTION database on the
# address the tests use. Worse, both can hold it at once: Docker binds `*:55432`
# (v6) and the proxy binds `127.0.0.1:55432` (v4), so both succeed and which one
# a client reaches depends on how its resolver orders localhost.
PORT="${PROXY_PORT:-56432}"

# Pinned, not overridable. An enforcer whose assertion can be relaxed by
# exporting a variable asserts nothing. The portal set is closed at 0011; the
# waitlist count is what the DoD line says, and the file count is checked
# against it so "the line is stale" and "a migration did not apply" are
# different messages instead of the same number.
EXPECTED_PORTAL_ROWS=11
EXPECTED_WAITLIST_MIGRATIONS=26
EXPECTED_TABLE_COUNT=19

# The 19. Every name must be PRESENT — see the header for why that direction.
# Verified 2026-07-31 to have ZERO overlap with the portal's own 15 tables:
# without that, `CREATE TABLE IF NOT EXISTS` would no-op on a collision and this
# check would go green on a table the waitlist never created. `waitlist_sessions`
# vs the portal's `sessions`, and `auth_tokens` vs `magic_link_tokens`, are the
# near-misses; both are distinct.
EXPECTED_TABLES=(
  auth_link_requests auth_tokens creator_tracking email_jobs
  points_ledger post_review_queue published_receipts referral_codes
  referrals session_telemetry status_notes
  telegram_accounts waitlist_agent_links waitlist_sessions
  waitlist_social_profiles waitlist_tokens waitlist_touchpoints
  waitlist_users waves
)
EXPECTED_VIEWS=(waitlist_queue)

fail() { echo "FAIL — $*" >&2; exit 1; }

command -v cloud-sql-proxy >/dev/null || fail "cloud-sql-proxy not installed (brew install cloud-sql-proxy)"
command -v psql >/dev/null || fail "psql not installed"
[ -d "$MIGRATIONS_DIR" ] || fail "migrations dir not found: $MIGRATIONS_DIR"

# ── Clause 1a: the checkout is the one the DoD line describes ────────────────
# MIGRATIONS_DIR points into a sibling working tree at whatever commit it
# happens to be on. Every database clause below is measured against that
# pointer, so it is checked FIRST and by itself — a stale checkout is not a
# database finding and must not be reported as one.
STEMS=()
while IFS= read -r line; do STEMS+=("$line"); done < <(cd "$MIGRATIONS_DIR" && ls -1 *.sql | sed 's/\.sql$//' | sort)
[ "${#STEMS[@]}" -eq "$EXPECTED_WAITLIST_MIGRATIONS" ] || fail \
  "clause 1 — ${MIGRATIONS_DIR} holds ${#STEMS[@]} migrations, the DoD line says ${EXPECTED_WAITLIST_MIGRATIONS}. \
That checkout is stale or ahead of the line. This is NOT a database finding — fix the checkout, or update the line."

# ── Clause 1b: EXPECTED_TABLES still matches what the files create ───────────
# Comments stripped FIRST (/* */ then --). Not doing that is how `skips` got in.
DERIVED=()
while IFS= read -r line; do DERIVED+=("$line"); done < <(
  cat "$MIGRATIONS_DIR"/*.sql \
    | perl -0pe 's{/\*.*?\*/}{}gs; s{--[^\n]*}{}g' \
    | grep -oEi 'CREATE TABLE( IF NOT EXISTS)? [a-z0-9_]+' \
    | awk '{print $NF}' | sort -u
)
[ "${#DERIVED[@]}" -eq "$EXPECTED_TABLE_COUNT" ] || fail \
  "clause 1 — the migrations now create ${#DERIVED[@]} tables, the DoD line says ${EXPECTED_TABLE_COUNT}. \
A table was added, or the extraction broke. Decide which, then update BOTH the line and this number."
if ! diff <(printf '%s\n' "${DERIVED[@]}") <(printf '%s\n' "${EXPECTED_TABLES[@]}" | sort) >/dev/null; then
  fail "clause 1 — EXPECTED_TABLES has drifted from the migration files:
$(diff <(printf '%s\n' "${DERIVED[@]}") <(printf '%s\n' "${EXPECTED_TABLES[@]}" | sort) | sed 's/^/    /')
  (< = in the files, > = in this script's list)"
fi
echo "ok   clause 1a/1b — ${#STEMS[@]} migrations in the checkout, creating the expected ${#DERIVED[@]} tables"

# ── the proxy ────────────────────────────────────────────────────────────────
# Refuse a port somebody already holds rather than binding beside them on
# another address family and letting the caller's resolver choose.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "port $PORT is already in use — refusing to start the proxy beside it. \
Something else holds it, and sharing the port means callers reach whichever one their resolver picks. \
Free it, or set PROXY_PORT."
fi

cloud-sql-proxy --quota-project "$PROJECT" --port "$PORT" "$INSTANCE" >/tmp/gcp-schema-proxy.log 2>&1 &
PROXY_PID=$!
cleanup() { kill -0 "$PROXY_PID" 2>/dev/null && kill "$PROXY_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Break the moment the proxy dies, rather than sleeping 30s over a bind error it
# reported in the first 50ms.
for _ in $(seq 1 30); do
  grep -q "ready for new connections" /tmp/gcp-schema-proxy.log 2>/dev/null && break
  kill -0 "$PROXY_PID" 2>/dev/null || break
  sleep 1
done
grep -q "ready for new connections" /tmp/gcp-schema-proxy.log \
  || fail "proxy did not start — $(tail -3 /tmp/gcp-schema-proxy.log)"

# One parse, one source, and an assertion that it matched. `sed s///` passes its
# input through UNCHANGED on a non-match, so a secret whose shape ever differs
# would silently make PGPASSWORD the whole connection string — surfacing as
# "cannot reach the database" and sending the operator to Cloud SQL IAM over a
# regex four lines up. `[^@]+` also truncates at the first `@`, so a rotation to
# a password containing one would break the same way.
SECRET="$(gcloud secrets versions access latest --secret=cello-portal-database-url --project="$PROJECT")"
read -r DB_USER PGPASSWORD < <(printf '%s' "$SECRET" | python3 -c '
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.stdin.read().strip())
print(u.username or "", u.password or "")
')
export PGPASSWORD
[ -n "$DB_USER" ] && [ -n "$PGPASSWORD" ] || fail \
  "cello-portal-database-url did not parse as postgresql://user:pass@… — the secret's shape changed. \
This is NOT a credentials failure."

URL="postgresql://${DB_USER}@127.0.0.1:${PORT}/${DB}"
psql "$URL" -tAc "SELECT 1" >/dev/null || fail "cannot reach $DB through the proxy on port $PORT"

# ── Clause 2: the tables, the view, and the absent stored column ─────────────
missing=()
for t in "${EXPECTED_TABLES[@]}"; do
  found="$(psql "$URL" -tAc "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='${t}'")"
  [ "$found" = "1" ] || missing+=("$t")
done
[ ${#missing[@]} -eq 0 ] || fail "clause 2 — ${#missing[@]} of ${#EXPECTED_TABLES[@]} waitlist tables missing: ${missing[*]}"

for v in "${EXPECTED_VIEWS[@]}"; do
  found="$(psql "$URL" -tAc "SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='${v}'")"
  [ "$found" = "1" ] || fail "clause 2 — view ${v} missing (DOD-QUEUE-VIEW-1)"
done

# queue_position must be COMPUTED. A stored column of that name would satisfy
# "the tables are there" while breaking the line it belongs to.
stored="$(psql "$URL" -tAc \
  "SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='waitlist_users' AND column_name='queue_position'")"
[ -z "$stored" ] || fail "clause 2 — waitlist_users.queue_position exists as a STORED column; DOD-QUEUE-VIEW-1 requires it computed"
echo "ok   clause 2 — ${#EXPECTED_TABLES[@]} tables + ${#EXPECTED_VIEWS[@]} view present, position not stored"

# ── Clause 3: the ledger as a SET, not a total ───────────────────────────────
# `count(*) = 37` is an arithmetic identity: 12 portal + 25 waitlist also makes
# 37, and so do 37 rows written by hand. The DoD asserts a composition, so the
# composition is what gets checked — every waitlist stem present by name.
absent="$(psql "$URL" -tAc "
  SELECT string_agg(s, ', ' ORDER BY s) FROM unnest(ARRAY[$(printf "'%s'," "${STEMS[@]}" | sed 's/,$//')]) s
   WHERE s NOT IN (SELECT version FROM schema_migrations)")"
[ -z "$absent" ] || fail "clause 3 — waitlist migrations missing from the ledger: $absent"

total="$(psql "$URL" -tAc "SELECT count(*) FROM schema_migrations")"
expected_total=$(( EXPECTED_PORTAL_ROWS + ${#STEMS[@]} ))
[ "$total" = "$expected_total" ] || fail \
  "clause 3 — ledger holds $total rows, expected $expected_total (${EXPECTED_PORTAL_ROWS} portal + ${#STEMS[@]} waitlist). \
All ${#STEMS[@]} waitlist stems ARE present, so this is an unexpected EXTRA row — not a missing migration."
echo "ok   clause 3 — all ${#STEMS[@]} waitlist stems in the ledger, $total rows total (${EXPECTED_PORTAL_ROWS} portal + ${#STEMS[@]} waitlist)"

# ── Clause 4: nothing pending — DRY RUN, never apply ─────────────────────────
# PGSSLMODE=disable is NOT a downgrade. The Cloud SQL Auth Proxy is the TLS
# client: it holds an ephemeral-certificate mutual-TLS session to the instance
# and validates the server against the instance CA. This flag governs only the
# loopback hop, and the proxy listens on 127.0.0.1 by default, so nothing is
# exposed off-host. (On a SHARED or CI host, prefer `--auto-iam-authn`, which
# removes the password from the flow entirely rather than sending it over
# loopback — this script's default assumes a single-user machine.)
pending="$(cd "$LAMBDA_DIR" && \
  DATABASE_URL="$URL" PGSSLMODE=disable PGPASSWORD="$PGPASSWORD" \
  MIGRATIONS_DIR="$MIGRATIONS_DIR" PYTHONPATH="$LAMBDA_DIR" \
  python3 -c '
import json, sys
sys.path.insert(0, "waitlist-migrate")
import handler
r = handler.lambda_handler({"dry_run": True}, None)
b = json.loads(r["body"]) if isinstance(r.get("body"), str) else r
# NO .get default. `b.get("pending", [])` would default to the PASSING value,
# so any change to the return shape reports the schema green off an error.
print(json.dumps(b["pending"]))
')"
count="$(printf '%s' "$pending" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
[ "$count" = "0" ] || fail \
  "clause 4 — ${count} migration(s) are PENDING against ${INSTANCE}: ${pending}. \
Either the checkout at ${MIGRATIONS_DIR} is ahead of the database, or a migration did not apply. \
Nothing was written — this check is read-only."
echo "ok   clause 4 — nothing pending (dry run, no write)"

echo
echo "DOD-GCP-SCHEMA-1: all clauses green against ${INSTANCE}"
