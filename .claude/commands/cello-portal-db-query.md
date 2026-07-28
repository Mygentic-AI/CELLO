---
name: cello-portal-db-query
description: Run SQL against the PORTAL PostgreSQL database — the one the M11 waitlist tables live in (waitlist_users, auth_tokens, email_jobs, points_ledger, referrals, waves). Use when inspecting or resetting waitlist data. This is NOT the directory database; cello-db-query does not work here.
---

# Query the Portal (Waitlist) Database

```bash
./infra/scripts/portal-db-query.sh "SELECT count(*) FROM waitlist_users"
```

That is the whole interface. `ENV` and `REGION` override the defaults (`dev`, `us-east-1`).

## Which database is this

| | directory DB | **portal DB (this one)** |
|---|---|---|
| holds | `agent_profiles`, registrations, sessions | `waitlist_users`, `auth_tokens`, `email_jobs`, `points_ledger`, `referrals`, `waves` |
| instance | `cello-dev` | `cello-portal-dev` |
| exports | `cello-${env}-rds-*` | `cello-${env}-portal-db-*` |
| skill | `/cello-db-query` | **this one** |

The export names are one word apart. Using the directory pair here produces
`42P01 undefined_table` on `waitlist_users` — an error that sends you to the migration
subsystem when the actual fault is that you are connected to the wrong database.

## Do not try the cello-db-query technique here

It does not work, and **it fails silently**: the exec session opens, prints
`Starting session with SessionId: …`, and then the query simply hangs until you kill it.

Verified 2026-07-28 — TCP 5432 from the `cello-directory-dev` task to the `cello-portal-dev`
endpoint **times out**. The directory container's security group is not admitted by the portal
RDS; only the waitlist Lambdas have a path in. Twenty minutes went into that dead end once;
that is why this skill exists.

## How the script gets in

The portal RDS is not publicly accessible, so there is no route from a laptop. The script
borrows the one thing that does have a route:

1. Resolves `cello-${env}-portal-db-{endpoint,port,master-secret-arn}` from CloudFormation
   exports, and reads the password from the RDS-managed secret at run time.
2. Downloads the deployed `cello-waitlist-auth-${env}` package — it already carries psycopg2
   and the shared modules.
3. Adds a one-shot handler that runs the statement from its event payload.
4. Creates a temp Lambda with the **same** VPC config, subnets, security groups and execution
   role as waitlist-auth. That is what buys the network path.
5. Invokes it, prints rows or a rowcount.
6. **Deletes the function in a shell trap** — an error or a Ctrl-C still removes it. A Lambda
   that runs arbitrary SQL must not outlive the minute it was needed for.

Nothing persists. Confirm with:
```bash
aws lambda list-functions --region us-east-1 \
  --query "Functions[?contains(FunctionName,'tmp-portal-admin')].FunctionName" --output text
```

## SELECT first, always

It runs as `portal_admin` and executes whatever it is given, inside a transaction that commits.
Look at what you are about to change before you change it:

```bash
# 1. see it
./infra/scripts/portal-db-query.sh \
  "SELECT waitlist_id, email, email_verified, email_status, status, created_at
     FROM waitlist_users WHERE lower(email) = 'someone@example.com'"

# 2. then act
./infra/scripts/portal-db-query.sh \
  "DELETE FROM waitlist_users WHERE lower(email) = 'someone@example.com'"

# 3. then confirm
./infra/scripts/portal-db-query.sh \
  "SELECT count(*) FROM waitlist_users WHERE lower(email) = 'someone@example.com'"
```

Deleting a `waitlist_users` row cascades to its tokens, sessions, jobs, points and referrals.

## Resetting someone for an end-to-end test

Deleting the row is the right move **only if you need signup-from-scratch**. A user who is
already `email_verified` will get a *sign-in* link on re-signup, not a confirm mail — which is
correct behaviour, not a bug, and is itself worth testing.

`auth_link_requests` is keyed by email address, not by user id, so it survives the delete. Its
window is 15 minutes; check it if a fresh signup is unexpectedly throttled:

```bash
./infra/scripts/portal-db-query.sh \
  "SELECT count(*) FROM auth_link_requests
    WHERE lower(email_requested) = 'someone@example.com'
      AND requested_at > now() - interval '15 minutes'"
```
