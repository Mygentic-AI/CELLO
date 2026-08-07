---
name: cello-db-query
description: Run SQL queries against the CELLO directory PostgreSQL database via ECS exec. Use when you need to inspect agent_profiles, registrations, sessions, or any other directory table on the live dev/staging database.
---

# Query the Directory Database

> ## ⚠️ The live directories are on GCP. This ECS technique is AWS-only and AWS is torn down.
>
> Use **`./infra/scripts/gcp-directory-db-query.sh "SELECT ..."`**. It reaches all three live nodes
> (us-east1, us-central1, europe-west1) over IAP + each node's own workload identity.
>
> **It queries ALL THREE NODES by default, and that default is load-bearing.** Directory nodes are
> sovereign and **only some columns replicate**. `user_accounts` replicates as
> `(account_id, phone_stub_hash)` ONLY — `email_stub_hash` never crosses, and neither does the
> agent→account link. On 2026-08-07 an operator's email hash was present on `gcp-usc1` and NULL on
> the other two; querying either of those alone "proved" the account did not exist when it did, and
> the portal's sign-in was failing for exactly that reason. **A one-node answer about a partially
> replicated column is confidently wrong.** Always compare across nodes before concluding a row is
> missing.
>
> Everything below applies only to the retired AWS ECS deployment.

> **This is the DIRECTORY database — `agent_profiles`, registrations, sessions.** The M11
> waitlist tables (`waitlist_users`, `auth_tokens`, `email_jobs`, …) live in the PORTAL database,
> and this technique **does not reach it**: TCP 5432 from the directory task to `cello-portal-dev`
> times out, because that container's security group is not admitted by the portal RDS. The
> failure is silent — the session opens and the query hangs. Use `/cello-portal-db-query`.

The directory runs on ECS Fargate. There is no DATABASE_URL env var, no psql binary, and `require('pg')` fails because the container is ESM. Follow this exact sequence.

## Step 1: Get credentials locally

```bash
REGION=us-east-1  # or eu-central-1 or ap-northeast-1

CONN_STRING=$(aws secretsmanager get-secret-value \
  --secret-id cello/dev/directory/rds-credentials \
  --region $REGION --query 'SecretString' --output text | \
  python3 -c "
import json, sys, urllib.parse
d = json.loads(sys.stdin.read())
pw = urllib.parse.quote(d['password'], safe='')
print(f\"postgresql://{d['username']}:{pw}@{d['host']}:{d['port']}/{d['dbname']}?sslmode=no-verify\")
")
```

## Step 2: Get the task ID

```bash
TASK_ID=$(aws ecs list-tasks --cluster cello-dev \
  --service-name cello-directory-dev \
  --region $REGION --query 'taskArns[0]' --output text | \
  grep -oE '[^/]+$')
```

## Step 3: Run the query

```bash
aws ecs execute-command \
  --cluster cello-dev \
  --task $TASK_ID \
  --container directory \
  --interactive \
  --region $REGION \
  --command "node -e \"const pg=require('/app/node_modules/.pnpm/pg@8.18.0/node_modules/pg');const p=new pg.Pool({connectionString:'$CONN_STRING'});p.query('SELECT k_local_pubkey, agent_id FROM agent_profiles').then(r=>{console.log(JSON.stringify(r.rows,null,2));p.end()}).catch(e=>{console.error(e.message);p.end()})\""
```

Replace the SQL in `p.query('...')` with your query.

## Gotchas

- **pg path changes with version.** If require fails, run: `aws ecs execute-command ... --command "find /app/node_modules -name index.js -path */pg/*"` to find the current path.
- **No shell features in --command.** Pipes (`|`), redirects (`>`), and heredocs do not work — they're interpreted literally by the exec shim.
- **Password has special chars.** The python3 step URL-encodes it. Never paste the raw password into a URL.
- **Parameterized queries.** Use `$1` syntax but be aware the shell may interpolate `$1` — wrap the entire node -e in double quotes as shown.
- **Output filtering.** Ignore the "Session Manager plugin was installed successfully" and "Cannot perform start session: EOF" lines — they're noise from the exec shim. Your query result is between them.
- **Container name** is always `directory`.
- **Regions:** us-east-1 (primary), eu-central-1, ap-northeast-1.
