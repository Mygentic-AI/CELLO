#!/bin/sh
# CELLO directory backup — pg_dump to GCS (DOD-NODE-DIR-GCP-1).
#
# The node's FROST key shares live in its own database and NOWHERE ELSE — no other node holds them,
# and anti-entropy deliberately never syncs `agent_key_shares` (DOD-INV-SHARES-LOCAL). Cloud SQL's
# own automated backups are in-place: they die with the instance. This is the only copy of a node's
# shares that exists off the VM, so a silent failure here is a silent loss of every agent that node
# co-signs for. Every step below therefore fails loud.
#
# Runs as a systemd oneshot from the node's cloud-init, in the directory image (which already has
# pg_dump, python3 and curl). Credentials come from Secret Manager via the VM's workload identity —
# the same secret the node itself reads, so a rotation cannot leave the backup behind.
#
# Required environment (from /etc/cello/backup.env):
#   CELLO_GSM_DB_CREDENTIALS  Secret Manager version resource holding {username,password,host,port,dbname}
#   CELLO_BACKUP_BUCKET       destination GCS bucket
#   NODE_ID                   node identifier, used in the object name

set -eu

log() {
  # Same JSON shape the node emits, so `journalctl` and the node's own output read as one stream.
  printf '{"event":"%s","level":"%s","nodeId":"%s","reason":"%s"}\n' "$1" "$2" "${NODE_ID:-unknown}" "$3"
}

fail() {
  log "directory.backup.failed" "error" "$1"
  exit 1
}

[ -n "${CELLO_GSM_DB_CREDENTIALS:-}" ] || fail "CELLO_GSM_DB_CREDENTIALS is not set"
[ -n "${CELLO_BACKUP_BUCKET:-}" ] || fail "CELLO_BACKUP_BUCKET is not set"

METADATA="http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"

TOKEN=$(curl -sf -H 'Metadata-Flavor: Google' "$METADATA" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])') \
  || fail "could not obtain an access token from the metadata server"
[ -n "$TOKEN" ] || fail "metadata server returned an empty access token"

SECRET_JSON=$(curl -sf -H "Authorization: Bearer $TOKEN" \
  "https://secretmanager.googleapis.com/v1/${CELLO_GSM_DB_CREDENTIALS}:access" \
  | python3 -c 'import base64,json,sys; print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())') \
  || fail "could not read the database credentials from Secret Manager (check the per-secret accessor grant)"
[ -n "$SECRET_JSON" ] || fail "database credential secret is empty"

# Parsed in one pass so a malformed blob fails here rather than as four confusing empty variables.
#
# Captured BEFORE evaluating, for the same reason as docker-entrypoint.sh: `eval "$(cmd)"` reports
# eval's status, not cmd's, so a parse failure would be swallowed and surface further down as
# `DB_HOST: unbound variable` — a symptom, naming nothing.
DB_VARS=$(printf '%s' "$SECRET_JSON" | python3 -c '
import json,shlex,sys
c = json.load(sys.stdin)
for f in ("username", "password", "host", "port", "dbname"):
    if not c.get(f):
        sys.exit("missing field: " + f)
print("DB_USER=" + shlex.quote(str(c["username"])))
print("DB_PASS=" + shlex.quote(str(c["password"])))
print("DB_HOST=" + shlex.quote(str(c["host"])))
print("DB_PORT=" + shlex.quote(str(c["port"])))
print("DB_NAME=" + shlex.quote(str(c["dbname"])))
') || fail "database credential secret is not the expected {username,password,host,port,dbname} JSON"
eval "$DB_VARS"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OBJECT="${NODE_ID:-unknown}/${STAMP}.sql.gz"
RAW="/tmp/cello-backup-${STAMP}.sql"
DUMP="/tmp/cello-backup-${STAMP}.sql.gz"

log "directory.backup.started" "info" "$OBJECT"

# NOT piped straight into gzip. A shell pipeline reports the LAST command's status, so
# `pg_dump … | gzip > f || fail` reports GZIP's success and swallows pg_dump's failure entirely —
# which is exactly how a server-version mismatch produced a 20-byte "backup" that only the size
# guard below caught. Dump to a file, check the status, then compress.
#
# --no-owner/--no-acl: the roles are created by the migrations, not carried in the dump, so a
# restore into a fresh instance does not fail on roles that do not exist yet.
PGPASSWORD="$DB_PASS" pg_dump \
  --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" \
  --no-owner --no-acl --format=plain > "$RAW" || fail "pg_dump failed — see its error above"

gzip -9 -c "$RAW" > "$DUMP" || fail "gzip failed"
rm -f "$RAW"

# A zero-length or trivially small dump means pg_dump wrote nothing useful; uploading it would
# replace a real backup history with a plausible-looking empty one.
# `wc -c` pads its output with spaces on BSD; the value is interpolated into the failure message,
# so trim it rather than reporting "     624 bytes".
SIZE=$(wc -c < "$DUMP" | tr -d ' ')
[ "$SIZE" -gt 1024 ] || fail "dump is implausibly small (${SIZE} bytes) — refusing to upload it as a backup"

curl -sf -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/gzip" \
  --data-binary "@${DUMP}" \
  "https://storage.googleapis.com/upload/storage/v1/b/${CELLO_BACKUP_BUCKET}/o?uploadType=media&name=$(printf '%s' "$OBJECT" | sed 's|/|%2F|g')" \
  > /dev/null || fail "upload to gs://${CELLO_BACKUP_BUCKET}/${OBJECT} failed"

rm -f "$DUMP"
log "directory.backup.complete" "info" "gs://${CELLO_BACKUP_BUCKET}/${OBJECT} (${SIZE} bytes)"
