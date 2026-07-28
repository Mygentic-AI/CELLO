#!/usr/bin/env bash
#
# Run one statement against the portal (waitlist) database from INSIDE the VPC.
#
# There is no other way in. The portal RDS is not publicly accessible, and the
# directory container — which the cello-db-query skill execs into for the
# DIRECTORY database — is in a security group the portal RDS does not admit
# (verified: TCP 5432 times out from there). The waitlist Lambdas are the only
# things with a path.
#
# So this borrows one. It copies the deployed waitlist-auth package, which
# already carries psycopg2 and the shared modules, adds a one-shot handler,
# and creates a function with the SAME VPC config and execution role. It
# invokes it, prints the result, and DELETES IT — in a trap, so an error or an
# interrupt still removes it. A Lambda that runs arbitrary SQL must not outlive
# the minute it was needed for.
#
# WHY NOT THE cello-db-query SKILL. That skill execs into the directory
# container and queries from there. It does not work for this database, and the
# failure is silent — the session opens and the query simply hangs. Verified
# 2026-07-28: TCP 5432 from the directory task to the portal endpoint times out.
# The directory container's security group is not admitted by the portal RDS;
# only the waitlist Lambdas are. Do not spend time on that path again.
#
#   ./infra/scripts/portal-db-query.sh "SELECT count(*) FROM waitlist_users"
#   ./infra/scripts/portal-db-query.sh "DELETE FROM waitlist_users WHERE lower(email)='x@y.z'"
#
# SELECT FIRST, ALWAYS. This runs as portal_admin and will execute whatever it
# is given. Look at what you are about to remove before you remove it.
set -euo pipefail

SQL="${1:?usage: $0 \"<SQL>\"}"
ENV=dev
REGION=us-east-1
SRC="cello-waitlist-auth-${ENV}"
TMP_FN="cello-tmp-portal-admin-$$"
WORK="$(mktemp -d)"

cleanup() {
  if aws lambda get-function --function-name "$TMP_FN" --region "$REGION" >/dev/null 2>&1; then
    aws lambda delete-function --function-name "$TMP_FN" --region "$REGION" >/dev/null 2>&1 &&
      echo "cleaned up: $TMP_FN deleted" >&2
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

echo "borrowing package + VPC config from $SRC …" >&2
CFG="$(aws lambda get-function --function-name "$SRC" --region "$REGION")"
CODE_URL="$(printf '%s' "$CFG" | python3 -c 'import json,sys;print(json.load(sys.stdin)["Code"]["Location"])')"
ROLE="$(printf '%s' "$CFG" | python3 -c 'import json,sys;print(json.load(sys.stdin)["Configuration"]["Role"])')"
SUBNETS="$(printf '%s' "$CFG" | python3 -c 'import json,sys;print(",".join(json.load(sys.stdin)["Configuration"]["VpcConfig"]["SubnetIds"]))')"
SGS="$(printf '%s' "$CFG" | python3 -c 'import json,sys;print(",".join(json.load(sys.stdin)["Configuration"]["VpcConfig"]["SecurityGroupIds"]))')"
ENVJSON="$(printf '%s' "$CFG" | python3 -c 'import json,sys;print(json.dumps({"Variables":json.load(sys.stdin)["Configuration"]["Environment"]["Variables"]}))')"

curl -s -o "$WORK/pkg.zip" "$CODE_URL"
cd "$WORK" && unzip -qo pkg.zip -d pkg && rm pkg.zip

cat > pkg/portal_admin.py <<'PY'
"""One-shot: run the statement in the event and return rows or a rowcount."""
import os
import json
import psycopg2
import psycopg2.extras
from _dburl import portal_database_url


def lambda_handler(event, context):
    sql = (event or {}).get("sql")
    if not sql:
        return {"error": "no sql supplied"}
    conn = psycopg2.connect(
        os.environ.get("DATABASE_URL") or portal_database_url(),
        sslmode=os.environ.get("PGSSLMODE", "require"),
    )
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql)
            rows = cur.fetchall() if cur.description else None
            count = cur.rowcount
        conn.commit()
        return {"rowcount": count, "rows": json.loads(json.dumps(rows, default=str))}
    finally:
        conn.close()
PY

(cd pkg && zip -qr ../fn.zip .)

echo "creating $TMP_FN …" >&2
aws lambda create-function --function-name "$TMP_FN" --region "$REGION" \
  --runtime python3.12 --role "$ROLE" --handler portal_admin.lambda_handler \
  --zip-file "fileb://$WORK/fn.zip" --timeout 60 --memory-size 512 \
  --vpc-config "SubnetIds=$SUBNETS,SecurityGroupIds=$SGS" \
  --environment "$ENVJSON" >/dev/null

aws lambda wait function-active --function-name "$TMP_FN" --region "$REGION"

printf '%s' "{\"sql\": $(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$SQL")}" > "$WORK/payload.json"
aws lambda invoke --function-name "$TMP_FN" --region "$REGION" \
  --cli-binary-format raw-in-base64-out \
  --payload "fileb://$WORK/payload.json" "$WORK/out.json" >/dev/null

echo "── result ──"
python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1])), indent=2)[:4000])' "$WORK/out.json"
