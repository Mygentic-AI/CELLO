---
name: cello-portal-db-query
description: Run SQL against the PORTAL PostgreSQL database — the live one on GCP Cloud SQL behind portal.cello.mygentic.ai, holding the portal accounts/passkeys AND the M11 waitlist tables (waitlist_users, auth_tokens, email_jobs, points_ledger, referrals, waves). Use when inspecting sign-in state, passkeys, or waitlist data. This is NOT the directory database; use cello-db-query / gcp-directory-db-query for that.
---

# Query the Portal Database

```bash
./infra/scripts/gcp-portal-db-query.sh "SELECT count(*) FROM waitlist_users"
```

That is the whole interface. It needs `cloud-sql-proxy` and `psql` (`brew install cloud-sql-proxy libpq`)
and a live gcloud login.

> ## ⚠️ The portal moved to GCP on 2026-07-31. Use the `gcp-` script.
>
> `./infra/scripts/portal-db-query.sh` — no `gcp-` — reaches the **AWS** RDS `cello-portal-dev`,
> which is **STOPPED**. It is the pre-migration database. It does not back anything that is
> serving, and querying it tells you about a system nobody is using.
>
> Its failure is a **`Connection timed out` from inside the temp Lambda** — which reads like a
> VPC/security-group problem and is actually "that instance is switched off in a cloud the portal
> left." On 2026-08-07 that cost the first ten minutes of a sign-in investigation.
>
> Keep the AWS script only for archaeology on pre-migration data (the original portal accounts and
> passkeys still live there). Start the instance first if you genuinely need it.

## Which database is this

| | directory DBs | **portal DB (this one)** |
|---|---|---|
| holds | `agent_profiles`, `user_accounts`, registrations, sessions | portal `account`, `webauthn_credentials`, `magic_link_*`, plus all `waitlist_*`, `ops_*`, `points_ledger`, `referrals`, `waves` |
| where | 3 × Cloud SQL, one per region, **no public IP** (PSC only) | one Cloud SQL `cello-portal`, us-east1 |
| script | `./infra/scripts/gcp-directory-db-query.sh` | `./infra/scripts/gcp-portal-db-query.sh` |

Since M12 the portal, the waitlist and the ops dashboard **share this one instance**
(`DOD-INV-SINGLE-DB`) — one database, additive schema, three migration prefixes.

## Two things that will waste your time if you connect by hand

**Use the Auth Proxy; do not connect to the public IP.** The instance has one, but its
authorized-network list is a single hand-added `/32` that goes stale whenever the operator's ISP
moves them (on 2026-08-07 the list said `…85` and the laptop was on `…55`). The proxy authenticates
with IAM and needs no entry in that list. Do not "fix" this by adding today's IP.

**`--quota-project cello-infra` is required.** The proxy bills the Cloud SQL Admin API to whatever
project ADC happens to name — usually a leftover from unrelated work. Without the flag you get
`accessNotConfigured` citing a project with no connection to CELLO, which reads like a permissions
problem and is a billing-attribution one.

**Do not extract the password with `sed` into `PGPASSWORD`.** The stored URL points at the Cloud Run
unix socket (`?host=/cloudsql/…`), so the host must be swapped anyway — parse it with Python and
re-encode. Round-tripping those 32 random bytes through the shell corrupts them and produces
`password authentication failed` for a password that is perfectly correct. The script does this.

## SELECT first, always

It connects as `cello_portal` and executes whatever it is given, committed. Look before you change:

```bash
# 1. see it
./infra/scripts/gcp-portal-db-query.sh \
  "SELECT waitlist_id, email, email_verified, email_status, status, created_at
     FROM waitlist_users WHERE lower(email) = 'someone@example.com'"

# 2. then act
./infra/scripts/gcp-portal-db-query.sh \
  "DELETE FROM waitlist_users WHERE lower(email) = 'someone@example.com'"

# 3. then confirm
./infra/scripts/gcp-portal-db-query.sh \
  "SELECT count(*) FROM waitlist_users WHERE lower(email) = 'someone@example.com'"
```

Deleting a `waitlist_users` row cascades to its tokens, sessions, jobs, points and referrals.

## Debugging a portal sign-in that sends no email

The response is deliberately identical for a known and an unknown email, so the UI cannot tell you
anything. These two tables can:

```bash
./infra/scripts/gcp-portal-db-query.sh \
  "SELECT count(*) FROM magic_link_requests WHERE created_at > now() - interval '1 hour'"   # attempts
./infra/scripts/gcp-portal-db-query.sh \
  "SELECT count(*) FROM magic_link_tokens WHERE created_at > now() - interval '1 hour'"     # tokens minted
```

**Requests > 0 with tokens = 0 means the directory lookup returned "no account" — nothing was ever
sent, and SES is not involved.** The portal mints no accounts of its own: it resolves
`SHA-256(lower(trim(email)))` against the directory nodes' `user_accounts.email_stub_hash`, and
mints a token only on a hit. So the next query belongs on the *directory* side:

```bash
./infra/scripts/gcp-directory-db-query.sh \
  "SELECT account_id, email_stub_hash IS NOT NULL AS has_email FROM user_accounts"
```

Run it against **all three nodes** (that script's default). `email_stub_hash` is excluded from
anti-entropy replication, so it exists only on the node that ran the registration — a one-node
answer is confidently wrong. See `/cello-db-query` for that failure in full.

## Resetting someone for an end-to-end test

Deleting the row is right **only if you need signup-from-scratch**. A user who is already
`email_verified` gets a *sign-in* link on re-signup, not a confirm mail — correct behaviour, not a
bug, and worth testing in its own right.

`auth_link_requests` is keyed by email address, not user id, so it survives the delete. Its window
is 15 minutes; check it if a fresh signup is unexpectedly throttled:

```bash
./infra/scripts/gcp-portal-db-query.sh \
  "SELECT count(*) FROM auth_link_requests
    WHERE lower(email_requested) = 'someone@example.com'
      AND requested_at > now() - interval '15 minutes'"
```

The portal's own magic link is rate-limited separately: 5 requests per 15 minutes per email, counted
in `magic_link_requests` for **every** address, resolved or not (so the 429 cannot be used to probe
who exists).
