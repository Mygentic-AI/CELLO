---
name: M12-CUTOVER-CHECKLIST
type: checklist
date: 2026-07-31
topics: [m12, cutover, migration, gcp, aws, coordination]
status: active
description: >
  The remaining work to finish the AWS→GCP cutover, as claimable items. Agents CLAIM an item in §3
  before starting and record the outcome when done. Read docs/planning/aws-to-gcp-migration.md first —
  it says what is running where and what breaks if you stop it.
---

# M12 cutover — checklist and coordination

> **Before you touch anything:** read [`docs/planning/aws-to-gcp-migration.md`](../../aws-to-gcp-migration.md).
> It is the current-state document. On 2026-07-31 five agents debugged five different mental models
> of this system for three hours because it did not exist.

**Claim an item in §3 before you start it.** Append, never overwrite. If you find something that
changes another item, say so there — that is what this file is for.

---

## 1. Where the cutover stands

| | |
|---|---|
| Client | ✅ Cut over. `latest` = cli 0.0.108 / daemon 0.0.105, bundling the GCP roster. |
| GCP protocol stack | ✅ 3 directories (schema V57), relay, portal, ops-agent. Proven end-to-end incl. degraded mode. |
| AWS | ✅ **HIBERNATED 2026-07-31 15:08–15:12Z.** SES, Route 53, Lightsail and the cheap retained services stay up. |
| `m12/node-dir-gcp` → main | ✅ Merged 2026-07-31 (240 commits). |
| Waitlist | ❌ Still AWS-shaped. Needed next week. |
| Agent identities | ❌ Not migrated, by decision — fresh agents. |

## 2. Ground rules learned the hard way today

1. **A topology change is not a fix.** It gets a checklist, and it gets written into the migration doc
   *before* it ships. The client roster was repointed as a "bug fix" and that was the cutover.
2. **A safety guard on a branch protects nothing.** The hibernate portal-guard was written hours
   before the hibernate ran, sat on an unmerged branch, and the portal went down for 17 minutes
   anyway. Operational-script changes go to `main` immediately.
3. **Probe every table you claim to have verified.** "cello_service can write registrations" was true
   and useless — it has no rights on `channel_identities`, which is the other table registration
   writes.
4. **`hibernate.sh` still stops the portal RDS and deletes the NAT** — the pair the waitlist needs.
   Until item C lands, a full hibernate takes the waitlist with it. (Harmless today: list is empty.)

---

## 3. CLAIMS — append here before starting

| Item | Agent | Claimed | Status |
|---|---|---|---|
| A | — | — | ✅ done (see §4) |
| B | — | — | ✅ done (see §4) |
| J | — | 2026-07-31 | ✅ done — daemon@0.0.107 / cli@0.0.110 |
| K | — | 2026-07-31 | ✅ done (see §4) |
| I | — | 2026-07-31 | ✅ done — two relays live |
| C | waitlist-port session | 2026-07-31 | 🔄 in progress — landing under **M11** as the `DOD-GCP-*` tier |
| D | waitlist-port session | 2026-07-31 | ✅ **done** — `api.cello.mygentic.ai` → `35.227.231.107` (GCP), INSYNC |
| E | *unclaimed* | | |
| F | — | — | ✅ done (see §4) |
| G | — | 2026-08-01 | ✅ guidance fix — says retry, not check config |
| H | — | — | ✅ done (see §4) |

**C is being worked under M11, not M12.** The waitlist is M11's deliverable and M11's DoD is its
sole status authority, so the port gets `DOD-GCP-*` lines in `M11-DEFINITION-OF-DONE` rather than
new M12 lines. M12 owns the cloud; M11 owns the waitlist. This checklist stays the coordination
record — it just is not where the status lives.

---

## 4. The items

### ✅ A — Verify the waitlist schema is durable before AWS goes down
**Done 2026-07-31.** No dump needed: the schema is 26 versioned `.sql` migrations (1,265 lines) in
`corp-cello-site/migrations`, and `waitlist-migrate --dry-run` against production returned
`pending: []`, all 26 applied. No drift, no data, no dependency on the live AWS database.

### ✅ B — Merge `m12/node-dir-gcp` to main
**Done 2026-07-31**, 240 commits. The migration-numbering tripwire fired (V57 consumed the reserved
next number); agreement updated to V58, with a note that V57 is applied on all three GCP nodes and
cannot be renumbered.

### ❌ C — Port the waitlist to GCP  *(needed next week — the big one)*

Full scope in [`aws-to-gcp-migration.md`](../../aws-to-gcp-migration.md) §7. Summary: 13 Python
handlers, ~14,200 LOC, and the AWS surface is **four things** — the API Gateway entry shape (~20 lines
per handler, real logic already factored out behind it), `_dburl.py` (which already prefers
`DATABASE_URL`, so no change), one SES caller in `waitlist-email`, and a 67-line dispatch nudge.

**It is a port, not a rewrite, and not a reduced version.** Every feature stays.

Spans three repos: handlers in `trustless-cello/infra/lambda`, schema in `corp-cello-site/migrations`,
database shared with `cello-portal`.

**GCP portal database — measured 2026-07-31, so you do not have to look:**

- **Portal schema: COMPLETE.** All 11 portal migrations applied (`0001_init` → `0011_minted_signals_issuer`),
  15 tables: `account`, `sessions`, `webauthn_credentials`, `webauthn_challenges`, `totp_secrets`,
  `backup_codes`, `magic_link_requests`, `magic_link_tokens`, `auth_verify_attempts`,
  `github_connections`, `minted_signals`, `processed_submissions`, `submission_mint_inputs`,
  `track_record_refresh_log`, `schema_migrations`.
- **Waitlist tables: ~~ZERO~~ → ALL PRESENT (applied 2026-07-31).** Phase 1 is DONE; see
  `DOD-GCP-SCHEMA-1` in [[M11-DEFINITION-OF-DONE]], which is where this line's status lives.
  **19 tables** plus the `waitlist_queue` view, ledger at 37 rows, second run applies 0. Enforcer:
  `infra/scripts/verify-gcp-waitlist-schema.sh`.

  ```
  auth_link_requests   auth_tokens         creator_tracking    email_jobs
  points_ledger        post_review_queue   published_receipts  referral_codes
  referrals            session_telemetry   status_notes        telegram_accounts
  waitlist_agent_links waitlist_sessions   waitlist_social_profiles
  waitlist_tokens      waitlist_touchpoints                    waitlist_users
  waves                + VIEW waitlist_queue
  ```

  *(This bullet has now been wrong twice, in opposite directions, and both are worth keeping.
  First it named `waitlist_signups`, `gallery_items` and `social_profiles` — no migration creates
  any of those, so it reported "zero waitlist tables" for a database that would have said the same
  with all of them present. Then the correction said twenty and invented `skips`, by grepping
  `CREATE TABLE` across a COMMENT in `0002` that reads "CREATE TABLE IF NOT EXISTS skips the table
  wholesale". Strip SQL comments before extracting names, and write the assertion so each expected
  name must be PRESENT — that direction fails loudly on an invented one, which is how `skips` was
  caught in under a minute.)*

**Two things that make phase 1 easier than it looks:**

1. **The shared ledger is clean here.** On AWS `schema_migrations` held 41 rows (26 waitlist + 11
   portal + 4 orphans from renamed/removed migrations). On GCP it holds exactly the 11 portal rows,
   so applying the waitlist set lands a clean 37 — **the orphan-reconciliation item resolves itself
   by not being carried over.** Nothing to reconcile.
2. **Both migration sets start at `0001` and that is fine.** Portal has `0001_init`, waitlist has
   `0001_m11_waitlist_p0`. The ledger keys on the full stem, not the number — proven on AWS where
   both sets coexisted in one table. Do not renumber anything.

**Access — use the proxy, NOT `gcloud sql connect`.** The portal Cloud SQL has a public IP with
`authorized_networks` deliberately EMPTY and `ssl_mode = ENCRYPTED_ONLY`. `gcloud sql connect`
allowlists your IP to let you in and does **not** remove it afterwards — so reading the database
mutates its config, and forgetting the cleanup leaves a home IP allowlisted on a production
instance. The Cloud SQL Auth Proxy authenticates with IAM and needs no allowlist entry at all:

```bash
brew install cloud-sql-proxy
cloud-sql-proxy --quota-project cello-infra --port 55432 cello-infra:us-east1:cello-portal &
psql "postgresql://cello_portal@127.0.0.1:55432/cello_portal"   # password from the secret below
```

`--quota-project` is required: ADC otherwise bills the quota to whatever `gcloud config` names,
and the proxy dies with `accessNotConfigured` on `sqladmin.googleapis.com` if that project has
the API disabled. Password: `gcloud secrets versions access latest
--secret=cello-portal-database-url --project=cello-infra` (URL-encoded — unquote before use).

Verified 2026-07-31: `authorized_networks` is currently empty, so the earlier `gcloud sql connect`
session did clean up after itself.

Phases, in dependency order:
1. Waitlist schema into the GCP portal Cloud SQL — the 26 migrations, applied into the existing
   ledger alongside the portal's 11. Nothing to reconcile (see above).
2. Router + per-handler adapters; the existing tests call the handlers directly and must stay green.
   **That is 8,468 lines across 18 test files, not 512** (measured 2026-07-31; the 512 figure is
   wrong everywhere it appears, including `aws-to-gcp-migration.md` §7). Good news, not bad: the
   handlers carry 7,205 lines and the tests outweigh them. The moment a test needs *editing* to
   pass, the port has become a rewrite — stop and say so.
3. Cloud Run + Cloud Scheduler in Terraform; SES posts bounces to a Cloud Run URL.
   **Four schedules, not eight** (measured: every `ScheduleExpression` in the CFN tree) — email
   drain `rate(1 minute)`, feedback sweep `cron(17 6 * * ? *)`, re-engage `cron(23 6 * * ? *)`,
   outreach sweep `cron(47 6 * * ? *)`.
   Also: only **4 of the 13 handlers are HTTP-facing** (signup, auth, actions, gallery — 21 API
   Gateway routes). Bounce is SNS-driven. **Migrate, waves, gate, firstwin and utm have no trigger
   at all** — they are direct `lambda invoke` targets, so a path router does not reach them and
   they need a deliberate invoke path. Their caller is the ops dashboard (see below).
4. Repoint the corp site's `/api/waitlist` (item D).
5. Verify a signup end to end, then delete the AWS waitlist stack.

**Keep SES.** Google has no email-sending service; the GCP ops-agent already calls SES with static
credentials and that pattern is proven.

### ✅ F — GCP standalone, with AWS genuinely hibernated
**Done 2026-07-31, after the hibernate.** Every previous "GCP standalone" proof ran with AWS still
up, so the claim had never actually been tested. AWS confirmed unreachable first
(`directory-us1|eu1|ap1` all dead), then, on the **published** client (`cli@0.0.108` /
`daemon@0.0.105` — what an operator installs):

two agents created and registered by DKG on GCP → both online, signaling connected → session over
the GCP relay → messages BOTH directions (`delivered: true`) → **sealed**, root
`131da59649534b…`, `attestation_mode: live` for both participants.

The standalone claim is now real rather than inferred.

### ✅ G — Registration guidance fixed (2026-08-01)

The error `directory_unreachable` on a transient blip told the operator to "check
CELLO_DIRECTORY_URL and network connectivity" — correct for a real misconfiguration,
wrong for a one-second network hiccup that resolves on retry. The fail-fast behaviour was
correct and deliberate (registration is a rare manual op, not a long-running loop). Only
the guidance text was wrong. Fixed in `register-handler.ts`.

The deeper "registration should fail over like signaling does" is a separate design question
that does not need to be answered at launch — the retry instruction is sufficient.

**A real redundancy gap, and it is the invariant's own words.** During F, `gcp-use1` was momentarily
unreachable from the test machine. The daemon handled it correctly for signaling — the log shows
`directory.bootstrap.unavailable (connect_error)` → `directory.bootstrap.failover` →
`directory.auth.challenge.verified` → `directory.signaling.connected`, i.e. it routed around the node
and authenticated against another.

**`register-agent` did not.** It returned `directory_unreachable` with guidance to "check
CELLO_DIRECTORY_URL and network connectivity" — pointing the operator at their own network for a
consortium that had two healthy nodes. A retry minutes later succeeded unchanged, confirming it was
transient and that nothing about the request was wrong.

Two things to fix:
1. **The registration path should use the same failover the signaling path already has.** "Silently
   fails when a node is down rather than routing around it" is the exact wording of the sovereign-node
   redundancy invariant.
2. **`start-agent` reports `online` when registration failed.** Agent B showed `state: online`,
   `standing_receiver_ready: true` while having **no profile in any directory** — the same condition
   as Andre's five agents (item E). Local state claiming a thing the directory does not back is how
   this whole class of fault stays invisible.

### ✅ H — The Telegram registration path works on GCP  *(2026-07-31)*

The full onboarding path an operator actually uses — Telegram → SES OTP → pre-auth capability → DKG —
now runs on GCP. Two things blocked it, both mine, both fixed:

**1. The waitlist gate refused everything.** It is an AWS Lambda backed by the portal RDS, it fails
CLOSED by design, and with AWS hibernated it cannot answer. It was gating admission to an EMPTY,
unlaunched waitlist while blocking the only person who needs to register. Now an explicit **opt-out**:
`WAITLIST_GATE=disabled`, and ONLY that exact string — absent, empty, `off`, `false`, `DISABLED` all
leave the gate ON, because an opt-IN flag fails by admitting the world when a variable goes missing.
Warns on every boot while off. **Remove the terraform env when the waitlist lands on GCP (item C).**

**2. `DIRECTORY_INTERNAL_URL` is the FULL ENDPOINT URL, not a base.** `DirectoryPreAuthorizationClient`
posts to it verbatim (`this.#url = opts.directoryInternalUrl`). AWS had
`http://…/internal/pre-authorize`; the GCP terraform was written with the bare host, so every
registration POSTed to `/` and got a 404 — which reached the operator as *"CELLO hit a temporary
server error finishing your registration."* The variable NAME reads like a base URL. It is not.

Everything upstream worked first time, on a path that had never run on GCP: `telegram.contact.verified`
→ `registration.phone.verified` → `registration.email.hash_stored` → `otp.delivery.sent` (SES from
GCP) → `registration.email.verified`.

**Known cosmetic:** `registration.gate.NOT_ENFORCED` says *"Expected only under CELLO_ENV=local"* —
dev-on-GCP is now a second legitimate case. Message only.

### ✅ D — Repoint the corp site's `/api/waitlist`  *(2026-07-31; completed 2026-08-01)*

**This was recorded as needing no corp-site change. That was wrong, and it cost a day of the
waitlist being down.**

The DNS move was necessary but not sufficient. nginx resolves a literal hostname in `proxy_pass`
once, when it loads its config, and then holds those addresses for the life of the process. The
Lightsail host (`cello-site`, eu-west-1) last started 2026-06-13, so it went on sending every
`/api/waitlist/` and `/api/gallery/` request to the AWS API Gateway addresses it had resolved in
June — six weeks before the repoint. That backend is still running; its RDS is hibernated, so it
answers `503 database_unreachable`, which the signup form renders as "We couldn't check whether
you're already signed in."

**Why it was missed.** The endpoint checked at cutover was `/signup`, which validates its payload
before touching the database — so the retired AWS backend and the live GCP one answered it
identically. The one probe run was the one probe that could not tell them apart. `/auth/session`
would have shown it immediately.

Fixed 2026-08-01 (`corp-cello-site` 4630f5f): the hostname now lives in a variable with an explicit
`resolver`, which forces per-request resolution, so the next endpoint move needs no deploy. Verified
live — `auth/session` 401, signup 400, gallery 200 on both hosts, `/api/` backstop still 404.

**The general rule this earns:** a DNS repoint does not reach a process that already resolved. When
cutting over a hostname, either restart what consumes it or verify from the consumer's side — and
probe an endpoint that actually touches the moved dependency, not one that short-circuits first.

```
api.cello.mygentic.ai  A(alias) d-jgbfq5nmal.execute-api.us-east-1.amazonaws.com
                    →  A 35.227.231.107 (TTL 60)   ← GCP waitlist load balancer
```

**Why an agent did this rather than parking it for Andre.** The rule that a topology change gets a
decision is about moving WORKING traffic. This surface was already dead: with AWS hibernated the
Lambdas still run but their database does not answer, so `GET /gallery/receipts` returned **503** and
every signup path fails behind validation. Measured before flipping, not assumed. Pointing the record
was a repair of a broken public hostname, not a cutover of a live one — and M11-PROCEDURE §3a lists
exactly two human-only steps, neither of which is this.

**Rollback is one command and the TTL is 60s.** The change-batch that restores the API Gateway alias:

```json
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"api.cello.mygentic.ai.","Type":"A",
 "AliasTarget":{"HostedZoneId":"Z1UJRXOUMOOFQ8",
 "DNSName":"d-jgbfq5nmal.execute-api.us-east-1.amazonaws.com.","EvaluateTargetHealth":false}}}]}
```
`aws route53 change-resource-record-sets --hosted-zone-id Z02692523DOH7NW521CL8 --change-batch file://…`

**Expect a gap before HTTPS works.** The Google-managed certificate only begins validating once the
record resolves to the load balancer, so `api.cello.mygentic.ai` fails TLS until it finishes
(typically 15–60 minutes). During that window the hostname is differently broken rather than newly
broken — it was returning 503 before. Watch it with:
`gcloud compute ssl-certificates describe cello-waitlist-cert --global --project cello-infra`.

### ❌ E — Re-register Andre's agents on GCP
They are online on `gcp-use1` with **no profile and no key share** — a socket and a presence row with
no identity behind them, because they were registered against the AWS consortium. Until this is done
day-to-day CELLO does not actually work for him. Small, and it is the one that affects him personally.

---

### ❌ I — Add a second relay (europe-west1)

One relay is a single point of failure for session transport. All sessions today go through
`gcp-relay-use1` (us-east1). If it goes down, no new sessions can be established — even though the
directories and the client would be fine.

A second relay in europe-west1 also exercises the relay-selection and relay-failover paths that have
never been tested. The client receives `relay_endpoints` as an array; the directory already advertises
multiple relays. Adding a second one tests whether those code paths actually work.

**What it takes:** one new entry in `relay_nodes` in `terraform.tfvars`, an apply, and a directory
restart so the new relay registers. The terraform already `for_each`es over `relay_nodes`, so the
whole thing is a 7-line config change.

**Desired state:** `relay_nodes` has two entries (us-east1 + europe-west1), both relays register with
the consortium, and a session can be established when one relay is down.

### ❌ J — Randomise the cold-boot directory selection

Today every fresh daemon hits `gcp-use1` first. If it answers, the daemon stays there — no roster
probe, no distribution. So ten new operators all land on the same validator and the same relay.

**The code for distribution already exists.** `fisherYatesShuffle` is in `directory-bootstrap.ts` and
is used for failover candidates. The gap is that the shuffle only fires when the primary is DOWN.
When it's up, everyone gets it.

**The fix:** when a manifest is configured and the daemon has no prior "home" (first connect or after
logout), pick a random roster member instead of probing the fixed primary first. Reconnects within the
same session should still prefer the last-known-good node (so a running daemon doesn't bounce).

This is a change to the published client (`daemon@0.0.10x`), not config. Small — the resolver's
cold-start path needs one extra branch that rolls the primary from the shuffled roster.

### ✅ K — Fix the AE replication gap (7 tables missing from anti-entropy)

**Done 2026-07-31.** The AWS Postgres mesh replicated 21 tables. M12's anti-entropy covered 4.
The other 17 tables' code was intact — still written, read, queried — but the data stopped
crossing nodes when the mesh was replaced, because AE requires explicit registration and nobody
made the full list.

Found when Telegram registration broke: `capability_claim_codes` was written on gcp-use1, the DKG
routed round 1 to gcp-usc1, which had never heard of it → `CLAIM_CODE_INVALID`.

Seven tables added to the AE registry:
`capability_claim_codes`, `authorized_issuers`, `signal_records`, `submission_results`,
`relay_registrations`, `directory_nodes`, `conversation_seals`.

Eight tables confirmed node-local by design (not added): `sessions`, `pickup_queue`,
`pending_notifications`, `directory_checkpoints`, `checkpoint_node_signatures`,
`registrations`, `pre_authorization_tokens`, `conversation_seal_staging`.

Deployed to all three validators. The same gap explains why `authorized_issuers` had to be
enrolled manually on three nodes earlier today — that was papering over this.

## 5. Not doing, and why

- **Migrating agent identities / FROST shares.** Decided: fresh agents. Shares are per-node and
  non-transferable by design; the only routes are re-registration or a resharing ceremony.
- **Keeping any AWS protocol infrastructure.** Hibernated. If it is ever woken, note that `wake.sh`
  no longer repoints `portal.*` — that guard is now on main.
- ~~**Porting the ops dashboard**~~ — **RAISED, and now IN SCOPE under M11 as `DOD-GCP-OPS-1`
  (2026-07-31).** It rides the AWS portal ALB and hibernate deletes the ALBs, so it is dark right
  now, and it is not a nice-to-have: it owns `DOD-INV-WAVE-GATE`, `DOD-WAVE-ASSEMBLY-1` and six
  `DOD-OPS-*` lines, and it is the **only caller of the five direct-invoke handlers** (waves, gate,
  firstwin, utm, migrate). Port the waitlist without it and the result is a waitlist nobody can be
  admitted from — no wave can open, no token can be minted, no post can be credited. It fails the
  launch-triage test outright.

  It needs no AWS wake either: source is local with a GitHub remote
  (`Andre-Mygentic/cello-ops-dashboard`), it is a Next.js container going to Cloud Run, its four
  `ops_*` migrations self-apply at boot against the portal DB, and its one AWS-side input — the
  `cello/ops/allowed-emails` secret — is readable while hibernated (verified 2026-07-31).

  Sequenced AFTER the waitlist port, as its own unit with its own reviewer pass. Not tangled in.
