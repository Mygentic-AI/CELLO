---
name: cello-db-query
description: Run SQL queries against the CELLO directory PostgreSQL database via ECS exec. Use when you need to inspect agent_profiles, registrations, sessions, or any other directory table on the live dev/staging database.
---

# Query the Directory Database

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
