#!/usr/bin/env bash
#
# Run SQL against the LIVE portal database — GCP Cloud SQL `cello-portal` / `cello_portal`.
#
# This is the database behind https://portal.cello.mygentic.ai and behind the waitlist
# (`api.cello.mygentic.ai`). Since M12 the portal, the waitlist and the ops dashboard all
# share this one instance (`DOD-INV-SINGLE-DB`).
#
#   ./infra/scripts/gcp-portal-db-query.sh "SELECT count(*) FROM waitlist_users"
#
# The AWS script next door (`portal-db-query.sh`) reaches a DIFFERENT, STOPPED database.
# See the header there.
#
set -uo pipefail

PROJECT=${PROJECT:-cello-infra}
INSTANCE=${INSTANCE:-cello-infra:us-east1:cello-portal}
PORT=${PORT:-5433}
SQL=${1:-}
[[ -z "$SQL" ]] && { echo "usage: $0 \"SELECT ...\"" >&2; exit 2; }

command -v cloud-sql-proxy >/dev/null || { echo "need cloud-sql-proxy (brew install cloud-sql-proxy)" >&2; exit 1; }
command -v psql            >/dev/null || { echo "need psql (brew install libpq)" >&2; exit 1; }

# The instance HAS a public IP, but its authorized-network list is a single hand-added
# /32 that goes stale every time the operator's ISP moves them. Do not connect directly and
# do not "fix" it by adding today's IP — the Auth Proxy authenticates with IAM and needs no
# entry in that list at all.
#
# --quota-project is REQUIRED: the proxy bills the Cloud SQL Admin API to whatever project
# ADC names, which is usually a leftover from unrelated work. Without it you get
# `accessNotConfigured` naming a project that has nothing to do with CELLO, which reads like
# a permissions problem and is a billing-attribution one.
cloud-sql-proxy --port "$PORT" --quota-project "$PROJECT" "$INSTANCE" > /tmp/cello-sql-proxy.$$.log 2>&1 &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null; rm -f /tmp/cello-sql-proxy.$$.log' EXIT

for _ in $(seq 1 30); do nc -z 127.0.0.1 "$PORT" 2>/dev/null && break; sleep 1; done
nc -z 127.0.0.1 "$PORT" 2>/dev/null || { echo "proxy did not come up:"; tail -5 /tmp/cello-sql-proxy.$$.log; exit 1; }

# Build the URI in Python and re-encode the password. The stored URL points at the Cloud Run
# unix socket (`?host=/cloudsql/...`), so the host must be swapped for the proxy. Do NOT pull
# the password out with sed into PGPASSWORD — it is 32 random bytes and round-tripping it
# through the shell corrupts it, producing `password authentication failed` for a password
# that is perfectly correct.
URI=$(gcloud secrets versions access latest --secret=cello-portal-database-url --project "$PROJECT" 2>/dev/null \
      | PORT="$PORT" python3 -c '
import sys, os, urllib.parse as u
p = u.urlparse(sys.stdin.read().strip())
port = os.environ["PORT"]
user = u.quote(p.username)
pw = u.quote(p.password, safe="")
print("postgresql://" + user + ":" + pw + "@127.0.0.1:" + port + "/cello_portal")
')
[[ -z "$URI" ]] && { echo "could not read cello-portal-database-url" >&2; exit 1; }

psql "$URI" -v ON_ERROR_STOP=1 -c "$SQL"
