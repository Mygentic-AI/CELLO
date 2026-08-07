#!/usr/bin/env bash
#
# Run SQL against the GCP directory node databases.
#
# DEFAULTS TO ALL THREE NODES, and that default is the point. Directory nodes are
# sovereign and only SOME columns replicate between them, so a one-node answer can be
# confidently wrong. On 2026-08-07 `user_accounts.email_stub_hash` was present on
# gcp-usc1 and NULL on the other two — querying either of those alone "proved" an
# account did not exist when it did.
#
#   ./infra/scripts/gcp-directory-db-query.sh "SELECT count(*) FROM agent_profiles"
#   ./infra/scripts/gcp-directory-db-query.sh --node gcp-usc1 "SELECT ..."   # one node
#
set -uo pipefail

PROJECT=${PROJECT:-cello-infra}
ONLY_NODE=""
# Which credential to connect with. The default `db-app` is the node's own `cello_service` role,
# which is SELECT-only on the tables that authorize the request path — `authorized_issuers` most of
# all, because a directory process that could add to the key set it is checked against could
# authorize itself. Operator writes to those tables need `--admin`.
CRED=db-app
while [[ "${1:-}" == --* ]]; do
  case $1 in
    --node)  ONLY_NODE=$2; shift 2 ;;
    --admin) CRED=db; shift ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
done
SQL=${1:-}
[[ -z "$SQL" ]] && { echo "usage: $0 [--node gcp-use1|gcp-usc1|gcp-euw1] \"SELECT ...\"" >&2; exit 2; }

# region → zone. One node = one region; the instance NAME carries a random suffix and
# changes on every MIG replacement, so it is discovered, never hardcoded.
NODES="gcp-use1:us-east1-b gcp-usc1:us-central1-a gcp-euw1:europe-west1-b"

# Runs ON the node. The Cloud SQL instances have NO public IP and are reachable only over
# Private Service Connect from their own node's subnet — there is no route from a laptop,
# with or without credentials. The node fetches its own DB password using its attached
# workload identity, so no secret ever crosses to the caller.
REMOTE=$(cat <<'REMOTE_EOF'
SECRET=$1; shift
SEC=$(sudo docker run --rm --network host google/cloud-sdk:alpine \
      gcloud secrets versions access latest --secret="$SECRET" 2>/dev/null)
[ -z "$SEC" ] && { echo "  SECRET FETCH FAILED ($SECRET)"; exit 1; }
# Keys are dbname/host/password/port/username — "username", NOT "user". Parsing it as
# "user" silently yields empty, psql falls back to the OS user, and the DB rejects "root":
# an auth error that reads like a credentials problem and is a parsing bug.
val() { printf '%s' "$SEC" | sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
sudo docker run --rm --network host \
  -e PGHOST="$(val host)" -e PGPORT="$(val port)" -e PGUSER="$(val username)" \
  -e PGPASSWORD="$(val password)" -e PGDATABASE="$(val dbname)" \
  postgres:17-alpine psql -v ON_ERROR_STOP=1 -c "$*" 2>&1 | sed 's/^/  /'
REMOTE_EOF
)

for ENTRY in $NODES; do
  NAME=${ENTRY%%:*}; ZONE=${ENTRY##*:}
  [[ -n "$ONLY_NODE" && "$NAME" != "$ONLY_NODE" ]] && continue

  INSTANCE=$(gcloud compute instances list --project "$PROJECT" \
      --filter="name~^cello-${NAME}-" --format="value(name)" --limit=1 2>/dev/null)
  echo "───────────────────────────────────────────────── $NAME ($ZONE)"
  [[ -z "$INSTANCE" ]] && { echo "  no running instance"; continue; }

  # base64 so the caller's quoting survives the trip through gcloud + ssh + bash.
  B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
  timeout 300 gcloud compute ssh "$INSTANCE" --zone "$ZONE" --project "$PROJECT" \
    --tunnel-through-iap \
    --command "echo $B64 | base64 -d | bash -s cello-${NAME}-${CRED}-credentials $(printf '%q' "$SQL")" 2>&1 \
    | grep -vE "^WARNING|NumPy|^please see|Pulling|Waiting|^[0-9a-f]{12}: |Download complete|Verifying Checksum|Pull complete|^Digest:|^Status:|Unable to find image|fs layer"
done
