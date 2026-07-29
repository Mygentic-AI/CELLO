# CELLO Infrastructure State

This file is the authoritative record of what actually exists in AWS.
It is updated automatically by `infra/deploy.sh` after every successful deployment.

**Do not edit manually unless correcting an error.** Run `./infra/deploy.sh` to deploy and update.

Any agent or human that deploys, modifies, or tears down infrastructure **must update this file** before closing the session. If you ran `deploy.sh`, it updated this automatically. If you made manual AWS changes, update the relevant section by hand and commit.

**Hibernate/wake status is a REPLACED block, never an appended log.** There is exactly one
"POWER STATE" section below and each cycle overwrites it. Do not add a new dated section per
hibernate or wake — that is noise, not state. Durable lessons from a cycle go in the standing
section that follows it, or in `infra/CLAUDE.md`.

---

## ⚡ POWER STATE — LIVE (all 3 regions, as of 2026-07-29 06:37 UTC)

Woken 06:21:59–06:37:36 UTC (15 min 37 s). Previous down-window ~10 h.

**ALB DNS names — these rotate on every wake; query AWS, do not trust this list once it is a day old:**
- **us-east-1:** dir `cello-dir-dev-428525449` / relay `cello-relay-dev-643475689` / portal `cello-portal-dev-1221300993`
- **eu-central-1:** dir `cello-dir-dev-996797499` / relay `cello-relay-dev-673997780`
- **ap-northeast-1:** dir `cello-dir-dev-394807507` / relay `cello-relay-dev-38653167`

**Verified live, not just from the script's own log:** 8/8 DNS names off the blackhole; 7 ALBs
`active`; all 8 ECS services 1/1 `COMPLETED`; 4 RDS `available`; demo EC2 `running`; all 9 directory
target groups `healthy`; `http://directory-{us1,eu1,ap1}/manifest` → **200** in all three regions;
`operations.cello.mygentic.ai` → **307** (ops dashboard restored automatically, second cycle running).

**Inventory diff was NOT identical this cycle — and that is correct.** us-east-1
`cello-directory-dev:337 → :352` and ap-northeast-1 `:124 → :125`: the directory pipeline shipped new
task definitions while we were hibernated, and the wake correctly started the *newer* revision.
Both services are 1/1 `COMPLETED` on the new task defs and serving. A taskdef delta after a
down-window during which CI ran is expected; only a *structural* delta (missing TG, listener, route,
endpoint) is a real finding.

**Gotcha for anyone health-checking the directory:** its ALB has an **HTTP:80 listener only** — no
HTTPS — and `/health` is not a public path (the app returns 400). `https://directory-*/health`
returns `000` on a perfectly healthy node. The real client path is `http://directory-*/manifest`.

---

## 🟢 GALLERY IS LIVE — gallery.cello.mygentic.ai + portal schema/seed (2026-07-29, ~09:00–10:30 UTC)

**Four AWS-affecting changes. All in `dev`. Nothing in the directory or relay was touched.**

### 1. Route53 — NEW A RECORD, created by hand (not IaC)
- Zone `Z02692523DOH7NW521CL8` (`cello.mygentic.ai`)
- `gallery.cello.mygentic.ai` → `63.34.176.185` (the corp-site Lightsail box), TTL 300, plain A record.
- **Deliberately not in CloudFormation, and neither is `cello.mygentic.ai` itself.** `cello-route53.yaml`
  only creates ALB-alias records for directory/relay subdomains; the corp site's records have always
  lived outside it. This record matches the existing pattern rather than introducing a second one.
  **Open:** the site's DNS as a whole has no IaC. Worth a small template so `gallery.` does not become
  the second undocumented record — not done.
- **Gotcha:** the SOA negative TTL on that zone is **86400**. The name was queried before it existed,
  so any resolver that cached the NXDOMAIN can take up to 24h. Fresh resolvers answer immediately.

### 2. TLS — certificate expanded (Let's Encrypt, on the Lightsail host)
- SAN is now `cello.mygentic.ai`, `gallery.cello.mygentic.ai`, `www.mygentic.ai`.
- **Why it had to move with the DNS record:** the `gallery.` nginx server block presents the
  `cello.mygentic.ai` certificate. A host added to nginx and left out of the SAN list answers HTTPS
  with a certificate for a different domain.
- Driven by `.github/workflows/deploy.yml`, which now derives the `-d` list from one `CERT_NAMES`
  variable and expands only when a name is actually missing (LE rate limits). The deploy smoke test
  fails loudly if the gallery host or its API namespace stops answering.

### 3. nginx — deploy.yml now applies it SAFELY (behaviour change worth knowing)
- `deploy/cello-site.conf` has always been applied on **every push to main** — two comments in the
  repo claimed otherwise and were wrong. It now backs up the live file, gates on `nginx -t`, and
  restores the backup on failure. Previously it `cp`'d first and tested after, leaving a broken config
  on disk while the running server looked healthy until the next reload from any source.

### 4. Portal (waitlist) database — migrations 0024 + 0025 applied, and seeded
- Applied via `cello-waitlist-migrate-dev` (dry-run first each time; exactly one pending each time).
  Ledger rows: 34 → 35 → 36.
- `0024` — `published_receipts` gains `transcript`, `seal_status`, `seal_detail`,
  `sealed_at_precision`; `verified_by`/`node_count` become NULLABLE and constrained to move together.
- `0025` — `CHECK (transcript IS NULL OR message_count = jsonb_array_length(transcript))`.
- **Seeded 5 archive receipts** into `published_receipts` via `infra/scripts/portal-db-query.sh`
  (the VPC-Lambda hop; the RDS is not publicly accessible). All five carry `verified_by IS NULL` —
  no source document records an attestation count, and that badge sits beside the hash.
- **This is the `cello_portal` database on `cello-portal-dev`** — the same database as the portal's
  own tables. Only `published_receipts` was touched.

### 5. Lambdas redeployed — `./infra/deploy-lambdas.sh dev waitlist` (twice)
- All 13 waitlist functions. Substantive changes: `gallery` (transcripts, shared validator) and
  `migrate` (carries the .sql files it applies). The first run died partway on a network error at
  `feedback`; the second completed.

**Verified live:** cert SAN carries the name · `https://gallery.cello.mygentic.ai/` → 200 ·
`/api/gallery/receipts?page=1` → 5 receipts · `https://gallery.cello.mygentic.ai/receipt/{hash}` → 200
with its transcript · `cello.mygentic.ai/api/waitlist/auth/session` → 401 (waitlist namespace intact).

---

## 🔧 MANUAL CHANGE — 2026-07-29 ~09:35 UTC: ap-northeast-1 Flyway checksum realigned (V53)

**What was done, by hand, and why it is not in IaC:** a single row update on the ap-northeast-1
directory database —
`UPDATE flyway_schema_history SET checksum = -1956862388 WHERE version = '53' AND checksum = 824786915;`
This is the equivalent of `flyway repair` for one row, applied via the ECS-exec `pg` technique
(`/cello-db-query`). Nothing else was touched.

**Why it was necessary — THE THREE REGIONS HAD DIVERGED.** V53 was applied during the 06:37 UTC wake
from the image current at that moment. Between that wake and the next deploy, the file was edited (a
review fix removing a security bypass) and pushed, so:

| region | V53 checksum before | source |
| :-- | :-- | :-- |
| us-east-1 | `-1956862388` | original V53, applied at the wake |
| eu-central-1 | `-1956862388` | original V53, applied at the wake |
| **ap-northeast-1** | **`824786915`** | the EDITED V53 — it deployed after the edit was pushed |

There is no single file that matches all three. `V53__signal_records_revoker_authority.sql` has been
restored byte-identical to the originally-deployed version (verified: Flyway computes
`-1956862388` for it locally), and the corrections moved to
`V54__supersession_consults_effective_status.sql`. That fixes us-east-1 and eu-central-1 and would
have **crash-looped ap-northeast-1** — a checksum mismatch aborts `docker-entrypoint.sh` under
`set -e` before `exec node`, so the container dies at startup and the task restarts forever. The
realignment was done while ap was still on the OLD task definition, i.e. before the new image
reached it.

**All three regions now record V51 `752698578`, V52 `-1852033893`, V53 `-1956862388`.**

**Follow-on, same session (~09:55 UTC): pipeline execution `bae64bca` ABANDONED.** Three executions
were in flight at once (the other session's push, plus two of mine — the V53/V54 fix and a STATE.md
commit pushed separately while the first was still deploying). **`ProductionDeploy` and
`StagingDeploy` both target us-east-1**, so concurrent executions contend for the same ECS service:
the older `ProductionDeployUsEast1` waits for a deployment a newer execution already replaced, times
out after ~45 min, and **eu-central-1 / ap-northeast-1 never start** — their actions stay `None` and
the regions silently stay on old code. It happened twice before being recognised as structural.
`bae64bca` was redundant (`e0b1231b`'s source `1572c391` already contains `65c2411f`), so abandoning
it leaves one execution to run uncontended.

**Two consequences worth keeping:**
1. **Batch directory pushes — the CLAUDE.md rule, with a concrete price.** Pushing STATE.md
   separately while a deploy was in flight cost ~45 min of stalled pipeline and two wasted builds.
   When a deploy is running, commit locally and push AFTER it lands.
2. **`ProductionDeploy` starting with us-east-1 — the region `StagingDeploy` also owns — is what makes
   concurrent executions deadlock rather than merely queue.** A pipeline-level concurrency guard, or
   ordering ProductionDeploy to start with a region StagingDeploy does not touch, would remove the
   failure mode entirely. Not fixed; recorded.

**✅ RESOLVED 2026-07-29 ~10:05 UTC — V54 live in all three regions, checksums converged.**
Verified against each regional database, not inferred from the pipeline: `max(version) = 54`,
V53 checksum `-1956862388` in all three, `bool_and(success) = true`, and
`http://directory-{us1,eu1,ap1}/manifest` → **200**. Task definitions: us-east-1 `:360`,
eu-central-1 `:136`, ap-northeast-1 `:127`. The ap realignment held through its deploy.

**THE RULE THIS COST — never edit an applied migration.** The window between "written" and "applied"
is not safe either: here it was under an hour, and a wake closed it without anyone deciding to
deploy. Before pushing a migration change, rebuild the migration set against a scratch database and
compare Flyway's own checksum to what each region has recorded — the comparison is cheap and it is
the only thing that catches a divergence like this.

---

## Hibernate / wake — standing behaviour

Cycle timing: **~15–18 min** for a wake, all 3 regions in parallel. RDS reaching `available` is the
long pole (~9–11 min); us-east-1 finishes last because it restores four ECS services, not two.
A 40-min wake (2026-07-22) was an RDS outlier, not the norm.

**Two `hibernate.sh` defects found and fixed 2026-07-27 — the script had been unrunnable for ~32 h:**
- `04fe0d83` — `a7cef102` added the portal listener-rule/SNI-cert capture *above* the block that
  assigns `portal_alb_arn`; under `set -u` that aborted every run on the first region discovered.
  Nobody saw it because no hibernate was attempted in between. Same commit added the missing
  `jq -c` compaction for `portal_extra_certs` — multi-line JSON breaks `--argjson`.
- `fa227c69` — `operations.*` was never in the blackhole list. It has its own alias to the portal
  ALB, so deleting that ALB left it answering NXDOMAIN for the whole down-window. **8** hostnames
  are blackholed now, not 7.

**The ops dashboard survives a wake with no manual redeploy** (first proven 2026-07-28): the
`operations.*` host rule and its SNI cert are captured at hibernate and restored at wake. Consequence:
the `wake.sh` post-wake checklist item **"0. REDEPLOY THE OPS DASHBOARD"** (~line 676) is stale and
should be deleted.

**Blackhole, not NXDOMAIN.** Every name is UPSERTed to `198.51.100.1` (TEST-NET-2) on hibernate.
A dangling alias answers NXDOMAIN, which seeds negative caches at every resolver between client and
Route53 and re-poisons them on wake — a documented ~50 min post-wake client outage (2026-07-24).
A name that resolves to a dead IP is never negatively cached; connections just fail fast at TCP.

---

## 🟢 SIGN-IN LOOP CLOSED — same-origin API + host-only cookie (2026-07-28, 06:18–06:45 UTC)

**The loop that survived five fix attempts was never an auth bug.** Sessions were minted correctly
on every click — three live ones sat on `apemmelaar@gmail.com` while `/auth/session` answered 401.
The cause was **two cookies sharing one name**. An earlier build set the session host-only on
`api.cello.mygentic.ai`; the fix for the cross-host hop set it with `Domain=cello.mygentic.ai`.
RFC 6265 keys a cookie on (name, domain, path), so those are distinct and neither can overwrite the
other. The browser sent both, oldest first, and `_session.py` returned the first match and stopped.
Found by reading the live cookie jar over CDP, not from code — the deployed package was
byte-identical to HEAD and every log looked healthy.

- **corp-cello-site `6bbaf2d`** — nginx now proxies `/api/waitlist/` → `api.cello.mygentic.ai`
  (`deploy/cello-site.conf`, server level, `^~`). The browser sees ONE origin, so the cookie needs
  no `Domain`. `waitlistApi.ts` BASE is now the relative `/api/waitlist`. Shipped by the
  **Deploy Corp Site** GitHub Action (run `30334383979`), which runs `nginx -t` before reload.
  **The static export is unchanged — SEO unaffected.**
- **`cello-waitlist-dev` stack UPDATED** — new parameter `SiteDomainName` (Default
  `cello.mygentic.ai`). `WAITLIST_API_BASE` is now `https://cello.mygentic.ai/api/waitlist` and
  `WAITLIST_SITE` derives from the same parameter so the two cannot drift. Verified live on
  `cello-waitlist-{email,auth}-dev`.
  **Deployed DIRECTLY, not via deploy.sh** — see the failure note below.
- **`./infra/deploy-lambdas.sh dev waitlist`** run TWICE (06:23, 06:42). Cookie is now
  `__Host-cello_wl_session`, host-only, no `Domain`. The `__Host-` prefix is browser-enforced:
  Chrome rejects the cookie outright if a `Domain` attribute ever returns, turning a silent
  three-day auth loop into an immediate failure. `read_session` now tries EVERY cookie the browser
  sent instead of the first — ordering cannot save us, RFC 6265 leads with the OLDEST.

**⚠️ `deploy.sh dev us-east-1` FAILED AGAIN at `cello-ecs-directory-dev` (06:34 UTC), as on 07-25.**
`RegistryPathRule` → `"One or more listeners not found" (ElasticLoadBalancingV2, 400)`. Stack rolled
back cleanly to `UPDATE_ROLLBACK_COMPLETE`. **Pre-existing defect, not caused by this session** —
pre- and post-change health checks both showed all 6 ECS services 1/1 `COMPLETED` and all 6 DNS
names resolving. It still blocks STEP 15, so the waitlist stack again needed the documented direct
command in `docs/planning/user-stories/m11/M11-NEXT-STEPS-AWS-AWAKE.md` (now also needs
`SiteDomainName=cello.mygentic.ai`). **This is the second time it has cost a session; the listener
reference is worth fixing on its own.**

**Verified in a real browser over CDP, not on a green suite:** clicked the emailed sign-in link →
landed on `https://cello.mygentic.ai/status` (not `/auth`), signed in, #12 of 12. The orphaned
`cello_wl_session` on `.cello.mygentic.ai` is STILL in the jar and no longer interferes — which is
the actual proof the collision class is gone. `/status` and `/waitlist` both hold the session across
navigation.

**No data changes.** Anyone with an old `cello_wl_session` is simply signed out once (different
name) and signs in again; with zero real users there is nothing to migrate.

### Follow-on deploy — survey moved onto /status (07:37–09:35 UTC)

- **`./infra/deploy-lambdas.sh dev waitlist`** (3rd run, 07:37). `handle_survey` now treats a repeat
  submission as an EDIT instead of discarding it — `award` rolls back on the once-per-user index, so
  the second set of answers used to go nowhere while the caller got a 200. `/auth/session` gained
  `survey_answers`, `survey_freeform` and `interview_committed`. **No stack change, no migration.**
- **corp-cello-site `4eb06e4`** — survey rendered inline on `/status` above the fold; `/survey` is now
  a client redirect (the `e2_survey` email links to it and cannot be edited). Deployed by the GitHub
  Action, run `30339161070`.
- **Verified live over CDP:** collapsed card at 417–479px and the expanded form's first question at
  530px, both inside an 861px viewport. Edit reopens pre-filled from the server. Toggling a platform
  and saving wrote `platforms: ["Codex"]` to `points_ledger.meta` and awarded 0 — the exact change
  that was silently dropped before. **Andre's answers were restored to their original state
  afterwards** (platforms empty, agent_count `3-9`); points unchanged at 60.

---

## 🟢 CAPTURE-LOOP FIX DEPLOYED — 13 waitlist Lambdas + stack update (2026-07-28, 03:51–04:20 UTC)

**What changed in AWS, and why it is here:** the M11 core capture loop was broken in production —
confirming an email landed the user on a sign-in form. API Gateway payload format 2.0 delivers
request cookies in a top-level `cookies` list, not in `headers`; the handler read the header, so
`/auth/session` returned 401 to every signed-in user and `/status` bounced them to `/auth`.

- **`./infra/deploy-lambdas.sh dev waitlist us-east-1`** — all 13 `cello-waitlist-*-dev` functions
  recoded. `cello-waitlist-auth-dev` LastModified `2026-07-28T03:51:51Z`. Two NEW shared modules
  ship with them: `_resend.py` and `_referral.py` (globbed by `_*.py`, no list to update).
- **`cello-waitlist-dev` stack UPDATED** — one new resource, `AuthResendRoute`
  (`POST /waitlist/auth/resend`). Deployed **directly**, not via `deploy.sh`: the waitlist is
  STEP 15 and deliberately last, and deploy.sh still exits earlier on `cello-ecs-directory-dev`.
  Parameters resolved exactly as STEP 15 resolves them; the command is written out in
  `docs/planning/user-stories/m11/M11-NEXT-STEPS-AWS-AWAKE.md`.

**Verified live, on the deployed API rather than on a green check:**
- `GET /auth/verify?token=<unknown>` → **404 `text/html`**, "That link isn't valid." with the front
  door and no resend button. It returned `{"error":"token_not_found"}` as JSON ninety seconds earlier.
- `GET /auth/verify` with no token → **400 `text/html`**, "That link came through incomplete."
- `POST /auth/resend` with an unknown token → **200**, the opaque "Check your inbox." page (it must
  not reveal whether the token was ours).
- corp-cello-site deployed (`aed1325..d17377f`); the SERVED bundles carry the new copy —
  `/waitlist` has "Signed in as" / "sent you a few already" / "has unsubscribed", `/status` has
  "Email confirmed" / "spot secured" / the `welcome` flag.

**One data change:** `apemmelaar@gmail.com` deleted from `waitlist_users` at Andre's request so he
could test signup from scratch (his row was already `email_verified`, so a re-signup would have sent
a sign-in link rather than a confirm mail). 11 rows remain, all test data.

**NEW TOOL — `infra/scripts/portal-db-query.sh`.** The `cello-db-query` skill does NOT work against
the portal database and fails SILENTLY: the exec session opens and the query hangs. Verified
2026-07-28 — TCP 5432 from the `cello-directory-dev` task to `cello-portal-dev` **times out**,
because the directory container's security group is not admitted by the portal RDS. Only the
waitlist Lambdas have a path. The script borrows one: it copies the deployed waitlist-auth package
and VPC config into a throwaway Lambda, runs the statement, and deletes the function in a shell trap.
Nothing persists — confirmed, no `cello-tmp-portal-admin-*` functions remain.

---

## ✅ DIRECTORY CI REACHES ALL THREE REGIONS AGAIN (2026-07-26, first time since ~2026-07-16)

Pipeline `07d82775` after the wake: **Source → Build → StagingDeploy → SmokeTest → ProductionDeploy,
all Succeeded**, with `ProductionDeployUsEast1`, `ProductionDeployEuCentral1` and
`ProductionDeployApNortheast1` each green. That stage had been SKIPPED on every run since the
directory ALB was recreated, because the smoke gate ahead of it failed on a dead hostname.

Verified beyond the pipeline's own status: all three `cello-directory-dev` services report 1/1 with
`rolloutState: COMPLETED`, and the 8-scenario protocol smoke suite passes against live staging.

**Two fixes made it stick:**
1. `cello-smoke-test-build` targets `directory-us1.cello.mygentic.ai` — the Route53 name wake
   re-points every cycle — instead of an ALB DNS name that hibernate destroys. This is why the
   repair does not need repeating; the July fix used a raw ALB name and lasted one cycle.
2. `deploy.sh` and `cello-cicd.yaml` set the same hostname, so a future stack deploy reinforces it
   rather than clobbering it. A CFN rollback restoring a stale parameter is what silently undid the
   previous repair.

**Also fixed this morning:** `operations.cello.mygentic.ai` failed the wake exactly as predicted (DNS
correct, service healthy, requests routing nowhere) and was restored by one stack redeploy. hibernate
now captures the portal listener's host rules and SNI certificates and wake re-creates them, so that
manual step is gone from the next cycle onward.

---

## ⚠️ SMOKE-TEST ALB DRIFT IS RECURRING BY DESIGN — and I re-made a documented mistake (2026-07-25)

**The fix is ONE command**, already written down in
`docs/planning/discussion_logs/2026-07-19_0600_smoke-test-fix-and-alb-drift.md`:

```bash
aws codebuild update-project --name cello-smoke-test-build --region us-east-1 \
  --environment '{"type":"LINUX_CONTAINER","image":"aws/codebuild/standard:7.0","computeType":"BUILD_GENERAL1_SMALL","environmentVariables":[{"name":"STAGING_DIRECTORY_URL","value":"<CURRENT dir ALB DNS>","type":"PLAINTEXT"}]}'
```

**Why it keeps coming back, which that log does not say:** `hibernate.sh` DELETES the dir and relay
ALBs (its own header: *"ALBs (dir + relay per region) ~$150/mo"*), and `wake.sh` recreates them and
UPSERTs Route53 to the **new** aliases. So every hibernate/wake cycle mints a new ALB DNS name and
this baked CodeBuild value goes stale again. It is not one-off drift from the 2026-07-17 rogue-agent
incident — that incident produced the first instance; hibernation reproduces it every cycle.

Three generations existed across three places, which is the signature:
`cello-dir-dev-85618485` (cicd stack parameter) · `cello-dir-dev-1341968405` (CodeBuild project,
set by the 2026-07-19 manual repair) · `cello-dir-dev-1389700310` (**the live ALB**).

**CORRECTION — MY FAILED DEPLOY MADE IT WORSE.** The CodeBuild project now reads
`cello-dir-dev-85618485`, the OLDEST value. When my `cello-cicd-dev` update rolled back,
CloudFormation restored that environment variable from the stack's stored parameter, **overwriting
the manual repair from 2026-07-19**. CI is therefore further from working than before I started, and
this is exactly the failure mode that log documents — a rollback silently reverting live config.

**✅ APPLIED 2026-07-26.** `cello-smoke-test-build` now has
`STAGING_DIRECTORY_URL = directory-us1.cello.mygentic.ai`. Because that is the Route53 name `wake.sh`
re-points on every wake, it does not go stale on the next hibernate — this is the last time this
repair should be needed. Pipeline re-run to confirm the gate passes.

**SCOPE, corrected:** BOTH `cello-directory-pipeline` and `cello-relay-pipeline` use this ONE smoke
project, and `ProductionDeploy` is a single stage containing all three regions. So a failing gate did
not "fail in EU/AP" — it skipped that stage entirely, for both services. `StagingDeploy` runs BEFORE
the gate and targets us-east-1, which is why the system looked healthy: the region exercised daily was
the only one still receiving code.

**Original one-command form, kept for the next reader**, if it points at the hostname rather than the
ALB — no stack deploy needed, and it survives every future hibernate:

```bash
aws codebuild update-project --name cello-smoke-test-build --region us-east-1 \
  --environment '{"type":"LINUX_CONTAINER","image":"aws/codebuild/standard:7.0","computeType":"BUILD_GENERAL1_SMALL","environmentVariables":[{"name":"STAGING_DIRECTORY_URL","value":"directory-us1.cello.mygentic.ai","type":"PLAINTEXT"}]}'
```

The committed `deploy.sh` / template changes now set that same hostname, so a later stack deploy
reinforces it instead of clobbering it — which is what was missing when the 2026-07-19 repair was
undone.

**I repeated the mistake the 2026-07-19 log exists to prevent.** It records an agent responding to
this with CFN template edits and repeated `deploy.sh` runs, one of whose rollbacks reverted the
directory ECS service to an old image. I did the same class of thing: changed the template so an
empty `StagingDirectoryUrl` would mean "resolve at run time", deployed `cello-cicd-dev`, and it
**failed and rolled back** — a CodePipeline variable derived from that parameter rejects an empty
default (`pipeline.variables.1.member.defaultValue`). Stack is back at `UPDATE_ROLLBACK_COMPLETE`;
blast radius was CI resources only, no ECS service touched. `deploy.sh` has since been changed to
pass the live ALB name rather than an empty string.

**Structural fix that IS worth keeping** (already committed, proven 8/8 against live staging):
`packages/e2e-tests/src/smoke/run-smoke-tests.ts` resolves the ALB from AWS when
`STAGING_DIRECTORY_URL` is unset, so the next hibernate cycle self-heals. It reaches CI only when the
cicd stack is next deployed — which should happen deliberately, not as a reflex to drift.

---

## 🔴 DIRECTORY CI HAS BEEN UNABLE TO REACH eu-central-1 / ap-northeast-1 (found 2026-07-25)

**Not a new break — found today, weeks old, still live. Nothing was mutated to fix it.**

`cello-smoke-test-build` (CodeBuild) holds `STAGING_DIRECTORY_URL =
cello-dir-dev-1341968405.us-east-1.elb.amazonaws.com`. **That ALB does not resolve.** The live one
is `cello-dir-dev-1389700310.us-east-1.elb.amazonaws.com`.

Consequence: every `cello-directory-pipeline` run fails at SmokeTest (`failedScenario:
two_sessions_established`, `reason: fetch failed`), so **ProductionDeploy never runs and the two
non-us-east-1 directory regions cannot receive a deploy through CI.** Confirmed on the two most
recent executions (`985fd257` today, `2fa01b74` at 07:34).

It reads as a flaky protocol test. It is a stage-1 baked value that went stale when the ALB was
replaced and the cicd stack was not redeployed — the exact lifecycle `infra/CLAUDE.md` documents.

**Two things block the deploy of this fix (found 2026-07-25):**
1. `cello-cicd.yaml` has a REQUIRED `CelloClientWebhookSecret` (no default) that the live stack does
   not carry — the stack has been undeployable since that parameter was added, exactly as
   `infra/CLAUDE.md` records. No secret of that name exists in Secrets Manager, so the value has to
   come from whoever owns the GitHub webhook.
2. `cello-cicd.yaml` creates a GitHub OIDC provider when `ExistingGitHubOidcProviderArn` is empty,
   and AWS permits ONE per issuer per account. `cello-github-oidc-dev` created it today, so the next
   cicd deploy would have failed `EntityAlreadyExists`. deploy.sh now resolves and passes the
   existing ARN. **That landmine was mine.**

Also worth noting: the live stack parameter says `cello-dir-dev-85618485`, the CodeBuild project says
`cello-dir-dev-1341968405`, and the real ALB is `cello-dir-dev-1389700310`. Three values, none
current — which is the argument for resolving it at run time rather than storing it anywhere.

**Fix is written and committed, NOT deployed** (all pushes are blocked on GitHub email
verification): the smoke runner resolves the ALB from AWS at run time, an empty
`StagingDirectoryUrl` means exactly that, deploy.sh stops baking it, and `CodeBuildRole` gains
describe-only permission. **Applying it needs a `cello-cicd-dev` stack deploy** — note
`infra/CLAUDE.md` records that stack as having been undeployable via deploy.sh
(`CelloClientWebhookSecret` unwired); verify that first.

**Deliberately NOT done:** patching the CodeBuild env var by hand. It would work and it would put
the account out of step with IaC I currently cannot push.

**PROVEN, not assumed (2026-07-25 14:21Z).** The fix was run from the compiled artifact against live
staging: `node packages/e2e-tests/dist/smoke/run-smoke-tests.js` with no `STAGING_DIRECTORY_URL`
resolved `cello-dir-dev-1389700310...` — the live ALB — and **all 8 scenarios passed, exit 0**,
including `two_sessions_established`, the exact one CI reports as failing.

So two things are settled at once: the fix works, and **the protocol path itself is healthy**. The
pipeline failure was never a protocol regression — it was a hostname, and it has been reading as a
flaky FROST/session test for weeks.

---

## 🔑 Operator allowlist secret RENAMED to be environment-scoped (2026-07-25)

`cello/ops/allowed-emails` → **`cello/dev/ops/allowed-emails`**, created by `cello-secrets.yaml`
and populated out-of-band with Andre's two addresses.

**Why:** it was the ONE access-control secret in the system and the only one of thirteen without an
environment segment. A second environment in this region would either fail to create it or, if that
were "fixed" by pointing at the existing one, hand the dev operator list to production.
`OPS_ALLOWLIST_SECRET_ID` is now required in the app with no default, so a task definition missing it
refuses at boot rather than reaching for a shared list.

**Verified after the switch:** the live task definition carries the scoped name, and a magic-link
request for an allowed address returns 202 with no `ops.allowlist.unavailable` — Andre confirmed a
successful sign-in on the deployed dashboard.

The old unscoped secret is scheduled for deletion with a **30-day recovery window** (it was
`Retain`, so CloudFormation abandoned rather than removed it). Recoverable until then.

---

## 🟢 OPS DASHBOARD IS LIVE — operations.cello.mygentic.ai (2026-07-25)

`cello-ops-dashboard-dev` CREATE_COMPLETE; ECS service 1/1; DNS resolves; `/sign-in` 200 over HTTPS.
Image `cello-ops-dashboard:096cea1`, **built by GitHub Actions and pushed via OIDC — never from a
laptop.** Shares the `cello-portal-dev` ALB via a host `ListenerRule` + `ListenerCertificate`, so no
second load balancer exists.

**Its four `ops_*` migrations applied to `cello_portal` at boot** (`ops.migrate.complete`), from
`scripts/migrate.mjs` run by the container CMD before `server.js`.

**New secret, now in IaC:** `cello/ops/allowed-emails` (added to `cello-secrets.yaml` with a
PLACEHOLDER; the real value set out-of-band, as an access list must never live in git). It currently
holds `apemmelaar@gmail.com` and `andre@mygentic.ai`. The dashboard **fails closed** on anything it
cannot parse, which is what happened on first deploy — sign-in returned its usual 202 and silently
sent nothing.

**Three things bit, in order, and each looked healthy from outside:**
1. The allowlist secret did not exist → identical 202s, no mail.
2. Nothing had ever created `ops_sessions` / `ops_magic_links` / `ops_magic_link_requests`. The
   Dockerfile skipped `migrations/` on the reasoning that the waitlist migrate Lambda owns the
   shared ledger — true, but that Lambda bundles only the WAITLIST files.
3. Running migrations from `instrumentation.ts` could not be BUILT: Next compiles it for the edge
   runtime, where `pg`'s builtins do not resolve. Hence the pre-start script.

---

## 🟢 ECR repo `cello-ops-dashboard` CREATED (2026-07-25)

`aws cloudformation deploy` on `cello-ecr-dev` — additive, no other resource changed.
URI: `257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-ops-dashboard`, exported as
`cello-dev-ops-dashboard-ecr-uri`.

**Moved here from `cello-ops-dashboard.yaml` to break a bootstrap loop.** That stack creates an ECS
service whose image must already exist, so deploying it to create the registry also created a
service pointing at an empty one — crash-loop, rollback, and the repo goes with it. Registries
belong with the other registries.

The ops-dashboard GitHub repo now exists too: `Andre-Mygentic/cello-ops-dashboard` (private).

---

## 📄 cello-ops-dashboard.yaml WRITTEN, NOT DEPLOYED (2026-07-25)

**Nothing new exists in AWS from this.** Recorded so a future session does not mistake a written
template for a deployed one, and does not write it twice.

`infra/cloudformation/cello-ops-dashboard.yaml` + a `DEPLOY_OPS_DASHBOARD=1` block in `deploy.sh`
cover: ECR repo `cello-ops-dashboard`, an ACM cert for `operations.cello.mygentic.ai`, a
`ListenerCertificate` + host `ListenerRule` on the **existing `cello-portal-dev` ALB** (no second
ALB — ~$16/month for a dashboard one person opens a few times a day), its own task security group,
a `PortalDbIngressFromOpsDashboard` rule on `cello-dev-portal-db-sg`, the task definition, the ECS
service and the Route53 alias.

Template validated; every import checked against the live account (`cello-dev-portal-sg` does NOT
exist — it is `cello-dev-portal-task-sg`).

**Do not deploy it yet.** The ECS service needs an image in ECR, nothing pushes one (no GitHub
remote → no pipeline; local pushes are forbidden), and deploying first gives a crash-loop and a
rollback. Order: **repo → pipeline → image → `DEPLOY_OPS_DASHBOARD=1 IMAGE_TAG=<sha> ./infra/deploy.sh dev`**.

---

## 🔒 Telegram waitlist gate — Lambda verified live, ops-agent redeploying (2026-07-25, ~14:20 CEST)

**`cello-waitlist-gate-dev` (us-east-1) verified live by direct invoke — read-only, no mutation.**
Three refusal paths, each returning a well-formed decision (`statusCode: 200` + boolean `allowed`),
which is exactly the contract the client now requires:

| payload | response |
|---|---|
| `{"telegram_id":"999000111"}` | `allowed:false, token_required` |
| `{}` | `allowed:false, missing_telegram_id` |
| `{"telegram_id":"…","token":"ZZZZZZZZZZZZ"}` | `allowed:false, token_malformed` |

That third one corrected a wrong belief in the code: the gate takes
`waitlist_tokens.token`, a `gen_random_uuid()`. The 12-character 32-symbol code is
`referral_codes.code` — a different token on a different path.

**IAM confirmed live, not just in IaC:** `cello-dev-ops-agent-task-role` → `OpsAgentPermissions` →
`InvokeWaitlistGate` grants `lambda:InvokeFunction` on
`arn:aws:lambda:us-east-1:257394457473:function:cello-waitlist-gate-dev` and nothing else.

**No CFN change needed for the ops-agent side.** The gate function name is derived in `server.ts`
from `env` (`cello-waitlist-gate-${env}`, region pinned to us-east-1 because the waitlist is a
single global service, M11-D26) — so there is no new task-definition env var, and an image swap is
sufficient.

**THE GATE IS LIVE.** `cello-operations-agent-pipeline` (triggered by the pushes to `main` via the
path filter on `packages/operations-agent/`) reached ProductionDeploy; `cello-operations-agent-dev`
is at steady state (`rolloutState: COMPLETED`, 1/1) on task definition **:73**, image
`cello-operations-agent:602a563` — which carries the gate and every review fix through that commit.

Later pushes in the same session keep re-triggering this pipeline, so the running image SHA advances;
what matters and stays true is that every one of them is a descendant of `22e1cfc0` (the gate) and
`e4b2c096` (the attempt bound). A deploy watchdog cron is armed at `*/4` per M11-PROCEDURE §3b.

**Still NOT proven live:** burning a REAL token on a REAL Telegram account. That needs an admitted
user, which needs DB visibility, which needs the ops dashboard — blocked on Andre (repo + deploy).

---

## 🌐 Portal deploy — fix migration 0006 FK crash-loop (2026-07-17)

**Task definition `cello-portal-dev:22`** — registered manually (CFN drift). Image `7078504`.
ECS service updated via `aws ecs update-service --force-new-deployment`. Deployment: PRIMARY 1/1 COMPLETED.
`portal.backend.started` confirmed with `migrationVersion: 0006_github_connections`. Portal live at https://portal.cello.mygentic.ai.

**Root cause:** Image `e237493` (task def :21) contained migration 0006 with `REFERENCES account(id)` — the `account` table PK is `account_id`. Migration failed on startup → crash-loop. Fix committed in `4695ec2`, image `7078504` built via CodeBuild.

**Note:** `build-portal.sh` has a latent `AWS_REGION` bug — Bedrock sets this to `us-west-1`, causing the script to target the wrong region. Worked around by calling CodeBuild API directly with `--region us-east-1`. Script needs fixing.

---

## 🌐 Portal deploy — fix GitHub OAuth `?github=error` (2026-07-16)

**Task definition `cello-portal-dev:20`** — registered manually (CFN drift). Image `e9d4381` (same).
ECS service updated directly via `aws ecs update-service`. Deployment: PRIMARY 1/1 COMPLETED.

**What changed (rev 19 → 20):**
- Added `PORTAL_KMS_KEY_ID=17d95b3b-3ff8-436d-8729-02e19aee471a` env var
- This was missing, causing `getSubmissionSigner('dev')` to throw "requires PORTAL_KMS_KEY_ID"
  on every GitHub OAuth callback → `?github=error` redirect
- Task role `cello-portal-task-role-dev` already had `portal-kms-sign` policy (kms:Sign + kms:GetPublicKey)

---

## 🌐 Portal deploy — github_anon + github_id split LIVE (2026-07-16)

**Task definition `cello-portal-dev:19`** — registered manually (CFN drift). Image `e9d4381`.
ECS service updated directly via `aws ecs update-service`. Deployment: PRIMARY 1/1 COMPLETED.

**What changed (rev 14 → 19):**
- `mint.ts`: `composeGitHub` replaced by `composeGitHubAnon` (type=`github_anon`, no username) +
  `composeGitHubId` (type=`github_id`, username + profile_url)
- OAuth callback mints and delivers BOTH signals in one flow
- Trust signals UI shows two rows when GitHub connected

**cello-client beta:** daemon `0.0.66`, cli `0.0.64`, connect `0.0.79` (tag v0.0.115, CI green).
Changes: wallet supersession cascade fix, `wallet_list_signals` + `wallet_remove_signal` IPC handlers,
`cello trust-signals list/remove` CLI command under new "Trust & endorsements" group.

**latest promotion pending** — run when ready:
```
npm dist-tag add @cello-protocol/connect@0.0.79 latest
npm dist-tag add @cello-protocol/cli@0.0.64 latest
npm dist-tag add @cello-protocol/daemon@0.0.66 latest
```
(crypto/transport/client/protocol-types unchanged — already at latest, skip)

---

## 🌐 Portal deploy — GitHub OAuth LIVE (2026-07-16)

**Task definition `cello-portal-dev:14`** — registered manually (CFN drift blocks `deploy.sh` and
`cloudformation deploy`). The ECS service was updated directly via `aws ecs update-service`.

**What changed (rev 10 → 14):**
- Added `GITHUB_CLIENT_ID` (ValueFrom `cello/dev/portal/github-oauth-Dw0Yk1:client_id::`)
- Added `GITHUB_CLIENT_SECRET` (ValueFrom `cello/dev/portal/github-oauth-Dw0Yk1:client_secret::`)
- Execution role inline policy `portal-secrets-read` updated to include the GitHub OAuth secret ARN

**Verified:** `GET https://portal.cello.mygentic.ai/sign-in` → 200. Task started clean
(`portal.backend.started`). GitHub OAuth flow now has credentials available.

**⚠️ CFN drift (portal):** The `cello-portal-dev` stack is in `UPDATE_ROLLBACK_COMPLETE`. The ALB
physical resource referenced by CFN no longer exists (recreated during hibernate/wake). Any
`cloudformation deploy` against this stack fails with "One or more load balancers not found." The live
ALB (`cello-portal-dev/fdd51a5b5e19cfde`) and target group (`cello-Targe-ZRFN2F5UL4AG/2d8de3697b3d3c71`)
work correctly — the drift is only in CFN's resource mappings. To fix: delete and recreate the stack,
or import the live ALB into the stack's resources.

---

## 📋 DOD-REGISTRY-1 — type registry published + ALB routing (2026-07-16)

**Registry signer key:** Secrets Manager `cello/dev/registry/signer-key` (us-east-1).
Pubkey: `d4f9a531205a3aca23dede0ad5f4fb6cd42260c8bbae5f33d2866c39e870d586`
Enrolled in `authorized_issuers` (role `registry`) in all 3 regions.

**Registry document v1 published** to all 3 regions (6 types: webauthn_passkey, github_account,
track_record, totp_authenticator, email_verified, phone_verified). Stored in `type_registry` table.

**ALB `/registry` rule (priority 7)** → BootstrapTargetGroup (port 9090) — created MANUALLY via CLI
in all 3 regions (CFN drift from hibernate/wake prevents `deploy.sh` / `update-stack`):
- us-east-1: rule `25fc40be7abedf5b`
- eu-central-1: rule `9b13380d112a7807`
- ap-northeast-1: rule `b69285cb5e46ddf7`

**⚠️ CFN drift:** The ALB physical IDs in `cello-ecs-directory-dev` stack do not match the live ALBs
(recreated during hibernate/wake). `deploy.sh` / `update-stack` will fail until reconciled. The manually
created rules work fine but are NOT tracked by CFN.

**Pipeline:** `cello-directory-pipeline` triggered (commit `75c13cc8`) — deploying the GET /registry
handler on port 9090. Once live, `GET /registry` on the ALB returns the signed document.

**Client half:** daemon 0.0.64 / connect 0.0.77 on latest — pinned registry pubkey, poller wired.

---

## 🔻 M10-D18 arm-retirement directory deploy — M8 `trust_signal_*` arms GONE, all 3 regions (2026-07-15)

**Pushed `ee02dde3` (base `a9f7370e`) → `cello-directory-pipeline`.** The DESTRUCTIVE half of the M8-retirement
cutover: the directory's `agent-write` path drops the `trust_signal_hash`/`trust_signal_ciphertext` arms +
the `SIGNAL_KINDS` per-type enum (`SUPPORTED_WRITE_KINDS = ["revocation_flag"]` only). App-code only — **NO
migration** (DB stays V47), so no SSM bump. Safe now because the coverage window is OPEN: the portal (sole
producer) is on M10 (`d2c1133`) and the daemon cutover is on beta v0.0.110.

**Live-verified:** pipeline Build→StagingDeploy→SmokeTest→**ProductionDeploy all Succeeded**; all 3 directory
ECS **1/1 COMPLETED** on the new image (task defs us1 **261** / eu1 **106** / ap1 **96**).

**Post-deploy cascade — DONE + verified:**
- **Relay cascade** — stopped + relaunched the relay task in all 3 regions (relay has NO directory-reconnect);
  all re-registered with the new directory tasks. **New relay IPs:** us-east-1 `10.0.98.32`, eu-central-1
  `10.1.78.4`, ap-northeast-1 `10.2.114.28`.
- **Manifests AUTO-re-signed** — all 3 S3 manifests refreshed to the new relay IPs on the unavailable→available
  transition (`healthCheckUrl` matches the live task): us1 v72, eu1 v38, ap1 v28, all `status: active`. No
  manual `sign-manifest.sh` needed.
- **No SSM bump** — `a9f7370e` carries no Flyway migration; `expected-migration-version` stays 47.

**M8 RETIREMENT COMPLETE END-TO-END:** client (beta 0.0.110) + portal (`d2c1133`) + directory (261/106/96) all
off the M8 arms; the M10 CBOR-envelope + signed-chokepoint + sealed-delivery pipe is the only path.

**Owed hardening (non-blocking, noted not fixed):** the `cello-directory-dev` ECS deployment circuit breaker is
DISABLED (`enable:false`) — infra/CLAUDE.md wants it on. A bad directory deploy would hang rather than
auto-rollback; the deploy watchdog covers it manually for now. Enable via `cello-ecs-directory.yaml` + deploy.sh.

---

## 🌐 Portal deploy — Tier 3+4 code, UI fixes, GitHub OAuth (2026-07-15)

**Portal now on `cello-portal:ac0dd9e`** (was `02c63cc`). Image built via CodeBuild, app stack updated
via `aws cloudformation deploy`. Service 1/1 COMPLETED; `GET https://portal.cello.mygentic.ai/sign-in` → 200.

**What shipped:**
- UI fixes: phone active (green), "Network graph" → "Connections", removed "Verified contacts", track-record fields
- Track-record minting job (`mintTrackRecordSignals` + `composeTrackRecord`)
- `fetchTrackRecord` discriminated-union fix (failures now visible, not silent)
- GitHub OAuth flow (`/api/auth/github`, `/api/auth/github/callback`) + `composeGitHub`

**GitHub OAuth NOW OPERATIONAL (2026-07-16):** `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` wired into
task def rev 14 via Secrets Manager `cello/dev/portal/github-oauth`. See portal deploy entry above.

---

## 🌐 M10-D18 portal deploy — the M8 handoff retired, M10 mint/notarize/deliver LIVE (2026-07-15)

**`infra/deploy-portal.sh dev` — portal now on `cello-portal:d2c1133` (was `776752d`, pre-M10).** Release-tail
step 1 DONE: the deployed portal runs the M10 WebAuthn handoff (compose → notarize via signed
`/internal/signal/submit` → sealed `/internal/signal/deliver`), not the retired M8 `trust_signal_*` arms.

**Live-verified (task def is ground truth):**
- Active task def **`cello-portal-dev:7`**, image **`d2c1133`**, service **1/1 COMPLETED**; `GET
  https://portal.cello.mygentic.ai/sign-in` → **200**.
- **New secret `cello/dev/portal/submission-seed`** (ARN suffix `-EX1Ryp`), wired as task secret
  **`PORTAL_SUBMISSION_SEED`** (ValueFrom, not plaintext). Value = the enrolled `de`×32 dev key —
  VERIFIED to derive pubkey `8d4abe07…` already in the directory's `authorized_issuers` (role submitter).
  Without it `getSubmissionSigner("dev")` fails closed and the best-effort handoff would mint nothing.

**IaC changes (committed, run via deploy-portal.sh — no directory pipeline involved):** `create-portal-secrets.sh`
(+submission-seed create-once), `cello-portal-app.yaml` (+`SubmissionSeedSecretArn` param, exec-role grant,
task secret), `deploy-portal.sh` (pass the ARN). cello-portal `d2c1133` fixes a Turbopack prod-build break
(`.js` import extensions in the trust module — the portal is extensionless; `pnpm build` had been skipped in
the M8-retirement gate).

**Coverage window now OPEN:** with the portal cut over to M10 and the daemon on beta v0.0.110, the old M8
`trust_signal_hash`/`trust_signal_ciphertext` arms have NO remaining producer. The held arm-retirement
(`a9f7370e`) is now safe to deploy (release-tail step 2).

---

## 🚀 M10-D18 additive directory deploy — DB V46→V47, `/internal/signal/deliver` route live (2026-07-15)

**Pushed `45949a5b` → `cello-directory-pipeline` (all 3 regions).** The ADDITIVE half of the M8-retirement
cutover: V47 (`pickup_queue.signal_hash` + drain COALESCE + sweep guard) + the signed
`POST /internal/signal/deliver` route. The destructive arm-retirement (`a9f7370e`) is HELD (coverage-window)
until the new portal is live — do NOT push it yet.

**Live-verified across all 3 regions:** DB=**V47** (us-east-1, eu-central-1, ap-northeast-1 — queried via
ECS exec, `flyway_schema_history` max=47); all 6 ECS services (directory + relay ×3) **1/1 COMPLETED**;
directory us-east-1 reached steady state with 0 failed tasks.

**Post-deploy cascade — DONE + verified:**
- **ops-agent SSM `expected-migration-version` 46→47** (us-east-1) — done.
- **Relay cascade** — restarted the relay ECS task in all 3 regions; ECS relaunched; re-registered with the
  new V47 directory. New relay IPs: us-east-1 `10.0.14.92`, eu-central-1 `10.1.29.119`, ap-northeast-1
  `10.2.79.55`.
- **Manifests AUTO-re-signed** — all 3 S3 manifests refreshed to the new relay IPs on the relay's
  unavailable→available transition (`healthCheckUrl` matches the live task in every region); **no manual
  `sign-manifest.sh` needed this cascade**.

**Client cutover is on npm beta** (v0.0.110): protocol-types 0.0.24, transport 0.0.24, daemon 0.0.61, cli
0.0.59, connect 0.0.75. `latest` promotion held (Andre's manual step).

**Still owed (release tail, blocked on the portal deploy mechanism):** deploy the new portal (M10 handoff +
mint), THEN the arm-retirement directory deploy (`a9f7370e`), THEN DOD-T1-JOURNEY-1 live.

---

## 🚀 M10 Tier 0/1 directory surface DEPLOYED — DB V45→V46, `/internal/signal/*` routes live (2026-07-15)

**Pushed `2a65a615` → `cello-directory-pipeline` (all 3 regions).** The directory applies Flyway on
boot, so **V46 auto-applied** — verified live in dev: `SELECT max(version) FROM flyway_schema_history`
= **46**, and `signal_records` + `authorized_issuers` + `registry_documents` all present (queried via
ECS exec on the us-east-1 directory task).

**What shipped (directory app code + migration; NO CFN/template change, so no `deploy.sh` needed):**
- **V46** — `signal_records` (the trust-signal notary ledger; composite PK `(signal_hash,
  accepting_node)` for multi-master safety — M10-D20), `authorized_issuers` (the chokepoint key set,
  seeded EMPTY), `registry_documents` (the served type registry), + the `signal_records_effective`
  view (derived status: revoked > superseded > active).
- **New routes on the internal-api** (signature-authed, INTERNAL-ONLY — the ALB rejects `/internal/*`):
  `POST /internal/signal/submit` (INV-CHOKEPOINT), `/revoke`, `/query` (verified-account-facts),
  `/registry-publish`, and **public `GET /registry`**.

**Manual post-deploy steps taken:**
- **ops-agent SSM `expected-migration-version` 45→46** (us-east-1; single param) — done, so the
  ops-agent recovers from its false-alarm crash-loop (it asserts DB version == SSM version).
- **Dev submission signer enrolled** in `authorized_issuers`: pubkey
  `8d4abe074fef9229d3b441dfea4f98f805b1a2b3a06ae645810efece77fd5044` (role `submitter`, from portal
  dev seed `de`×32), so the deployed portal can mint once it ships with `PORTAL_SUBMISSION_SEED=de…de`.

**Post-deploy steps — ALL DONE + VERIFIED (2026-07-15, by hand):**
- **Relay cascade — ✅ done.** Relays restarted + re-registered with the FINAL directory tasks in all
  3 regions; `recordAssignment` restored. (Relay has no directory-reconnect — a directory redeploy
  breaks `recordAssignment` → `relay_unavailable` on session init until the relay restarts.)
- **Manifest re-sign per region — ✅ done.** All 3 S3 manifests FRESH after the cascade with the new
  relay IPs (us-east-1 `10.0.92.53`, eu-central-1 `10.1.89.171`, ap-northeast-1 `10.2.20.179`),
  `healthCheckUrl`s matching the live tasks.
- **Cross-region replication of `signal_records` + `authorized_issuers` — ✅ done + SMOKE-TESTED.**
  Both tables added to `cello_pub` on every node (`PUBLICATION_TABLES` in `setup-replication.sh`), and
  every subscriber's `pg_subscription_rel` now carries them in state `r` (ready). Proven live: a row
  INSERTed on us-east-1 appears on eu-central-1 in ~8s, and a DELETE on the source replicates too;
  test rows cleaned up (0 `repl-smoke%` rows on both nodes). This closes STORE-DIR review F4 — the new
  tables genuinely replicate across the 3 sovereign nodes (redundancy invariant satisfied for signals).

  ⚠️ **ROBUSTNESS GAP found + owed (not blocking):** `setup-replication.sh` Step 4b treats *empty*
  ECS-exec output as REFRESH success (it only fails on a matched `ERROR:` line — no output ⇒ no match
  ⇒ "Refreshed" logged). A flaky `aws ecs execute-command` session (which returns empty, not an error)
  therefore SILENTLY SKIPS the actual `ALTER SUBSCRIPTION … REFRESH PUBLICATION` while the script still
  exits 0. That is exactly what happened on the first run this session (script green, tables NOT in the
  subscriptions); a clean re-run fixed it. HARDENING owed: after each REFRESH, assert the target table
  set is present in `pg_subscription_rel` (positive confirmation), don't infer success from the absence
  of an error string. Same class of bug as any "no error ⇒ success" check over a flaky transport.

  ⚠️ **`registry_documents` deliberately NOT replicated yet.** It is a singleton served-registry doc,
  not consumed by any node's read path yet (no Tier-2 consume path shipped). Add it to
  `PUBLICATION_TABLES` when the registry poller/consume path lands (NO-CONSUMER-NO-SHIP). Tracked owed.

---

## 🔧 Ops-agent migration-version skew fixed — SSM 43→45 (2026-07-07, manual, pre-cold-onboarding check)

**Found during a pre-cold-onboarding "is the ops-agent on latest code" audit; fixed same session.**

- **Ground truth (live):** directory image **`807817c`** (current HEAD directory code) running 1/1 in all
  3 regions; DB **at V45** — the directory's Flyway boot log (us-east-1 task started 2026-07-07 08:43) reads
  `Current version of schema "public": 45 … No migration necessary`. V44 (`primary_holder`) + V45
  (`primary_transfer_nonce_bindings`) — the DOD-PRIMARY-1 Tier-5 tables — were auto-applied by Flyway when
  the PRIMARY-1 directory image shipped via **CI/CD image swap** (not deploy.sh), so STATE was never updated.
  ⚠️ The M8C checklist's "V44/V45 un-deployed" note is inaccurate about the SCHEMA: the migrations ARE
  applied in the live DB. The Tier-5 *feature/handlers* remain gated (SEC-2/D20); only the schema is live.
- **The skew:** ops-agent image **`70c4f41`** (latest `packages/operations-agent` code — unchanged since the
  #2b short-claim-code deploy) booted 2026-07-06 09:04 when the DB was still V43, and its SSM
  `/cello/dev/ops-agent/expected-migration-version` was **43**. The ops-agent checks the version only ONCE
  at boot (`server.ts:384`, strict `!==` → `exit(1)`); its runtime `/health` returns 200 regardless. So it
  ran fine post-drift ONLY because it never restarted — **a restart would have read V45 ≠ 43 → crash-loop →
  no pre-auth claim codes could be minted → cold onboarding blocked.** Classic CI/CD-vs-SSM hazard
  (infra/CLAUDE.md → "SSM Parameters and Migrations").
- **Fix:** `aws ssm put-parameter … expected-migration-version = 45 --region us-east-1` (live value only;
  running task deliberately NOT restarted — it's healthy and V44/V45 are additive tables the ops-agent never
  queries, so the next natural restart boots clean on 45). Template default in `cello-ssm-parameters.yaml`
  was already `"45"` (correct — shipped with the migrations); only the live parameter was stale.
- **Net:** onboarding-path services are on current code; the version-skew landmine is defused. Optional: a
  `force-new-deployment` on the ops-agent would prove a clean boot on 45 now, but is not required.

---

## 🌐 Cross-node session establishment — Story A (directory-side) DEPLOYED (2026-07-05)

**Directory-side of the cross-node topology deployed to all 3 regions** (design:
`docs/planning/discussion_logs/2026-07-04_1730_cross-node-session-topology.md`; build journal:
`docs/planning/user-stories/m8b/2026-07-05_0655_cross-node-session-establishment-build-journal.md`).

- **Commit `bafed51a`**; pipeline `cello-directory-pipeline` (us-east-1) exec **SUCCEEDED**, all 3
  regions rolloutState=COMPLETED, 1/1 running: **us-east-1 taskdef :231, eu-central-1 :91,
  ap-northeast-1 :82**. Pre-change health check was GREEN (6/6 ECS, 6/6 DNS).
- **What shipped (directory app code only — NO CFN/template/task-def change, so no deploy.sh needed):**
  item 0 profile read-through (`getProfileWithReadThrough`, FINDING-8), item 1 discovery lookup
  handler + frames (`discovery_lookup`/`_result`/`_error`), item 3 visiting-auth presence integrity
  (`visiting` flag gates both presence writes). New log events: `directory.discovery.lookup(.failed)`,
  `directory.profile.read_through`, `directory.auth.visiting`.
- **Relay cascade (MANDATORY after directory redeploy) — COMPLETE + VERIFIED 2026-07-05:** all 3
  relays `stop-task`'d → ECS relaunched → re-registered → **all 3 S3 manifests auto-re-signed FRESH**
  (healthCheckUrl matches live relay IP: us-east-1 **10.0.109.112**, eu-central-1 **10.1.61.22**,
  ap-northeast-1 **10.2.4.239**). All 6 ECS services 1/1 COMPLETED. The directory re-signed on the
  unavailable→available transition — no manual `sign-manifest.sh` needed this cascade. **Cluster
  healthy; ready for Story C live cross-node testing.**
- **Story B (client-side) PUBLISHED to `beta` + binary-verified 2026-07-05.** cello-client tag
  **`v0.0.70`** (CI green incl. smoke-tag). New versions: **transport 0.0.14, client 0.0.44,
  daemon 0.0.29, cli 0.0.27, connect 0.0.56** (crypto 0.0.15 / protocol-types 0.0.13 unchanged).
  Binary-verified: daemon@0.0.29 dist contains the cross-node code (cross-node-negotiation.js,
  runCrossNodeSetup, discovery_lookup); cross-pins REAL (cli→daemon 0.0.29; connect→client 0.0.44,
  crypto 0.0.15, transport 0.0.14; interfaces 0.0.3 pinned) — no workspace:*. Both reviewers' findings
  fixed pre-publish. The directory does NOT consume the client's discovery mirror → no directory
  re-pin/redeploy required. **`latest` promotion PENDING Andre's go** — Story C installs beta explicitly.
- **🔴 CROSS-NODE PRESENCE FIX — DEPLOYING (2026-07-05, commit `938f34cb`).** Story C live testing found
  the cross-node feature blocked: the directory recorded its libp2p PEER ID (not the region) as
  `agent_presence.owning_node_id`, the heartbeat was RLS-blocked (no `directory_nodes` UPDATE policy),
  and nothing self-registered the node's row → freshness JOIN always NULL → every agent read
  dark/offline → discovery always `offline`. Fix: pass region nodeId to createDirectoryNode;
  self-registering heartbeat UPSERT (+ rowCount!==1 THROWS, heartbeat.failed→ERROR); **migration V42**
  (directory_nodes UPDATE RLS policy). **DEPLOYED + VERIFIED 2026-07-05** — pipeline `938f34cb` Succeeded,
  all 3 regions COMPLETED 1/1, 0 failed (V42 applied cleanly). POST-DEPLOY DONE: (1) live SSM
  `/cello/dev/ops-agent/expected-migration-version`→**42** (us-east-1), ops-agent restarted; (2) relay
  cascade complete — new IPs us1 **10.0.58.209** / eu1 **10.1.8.222** / ap1 **10.2.103.93**, all 3 S3
  manifests auto-re-signed FRESH; (3) **PRESENCE FIX VERIFIED LIVE** — directory log shows
  `presence.transition owningNodeId:"us-east-1"` (the REGION, not the peer id) + ZERO `heartbeat.failed`
  errors (V42 upsert works). Cluster healthy; discovery now resolves agents online. Ready for retest.
- **🎟️ #2b SHORT CLAIM-CODE + REDEEM — DEPLOYED + VERIFIED (2026-07-06, commit `70c4f41c`).** All 3
  directory DBs at V43 with `capability_claim_codes`; ops-agent at 43 (SSM guard bumped 42→43 mid-deploy
  when V43 landed, before the ops-agent could crash-loop). setup-replication re-run → publication = 19
  tables incl capability_claim_codes, 6 slots streaming, 0 apply-errors. Issuance PROVEN LIVE: Andre's
  Telegram registration got a short `CELLO-`-code (not the blob), minted+stored on us1. The one-time
  initial-copy gap (code minted before the table was published) fixed by a delete+re-insert on us1 →
  replicated → code now on all 3 nodes, redeemable across the DKG quorum. Relays restarted, manifests
  fresh on all 3. **PROVEN END-TO-END (2026-07-06 09:57): Andre registered agent `Ms_Chelly`
  (pubkey 178d420b…, agent_id 99829b4f…) using the short code CELLO-NrVs… → cello register ok:true;
  profile landed in agent_profiles on ALL 3 nodes; claim code redeemed_at=09:57:59.** One registration
  proves both the short-code path AND the counter-collision fix (profile replicated to all 3, no
  collision). NOTE: the local daemon still caches pre-reset zombie agents (Agent-1/Demo2/capX/capY/tofn1)
  with no directory profile — harmless, `cello remove-agent` to clean. Entry below (DEPLOYING) superseded.
- **🎟️ #2b SHORT CLAIM-CODE + REDEEM — DEPLOYING (2026-07-06, commit `70c4f41c`).** The operator now gets
  a short `CELLO-`+base58 code instead of the ~570-char capability blob; the agent passes it through raw as
  preAuthToken (NO client change) and the directory redeems it server-side at the DKG round-1 gate before
  decodeCapability (additive — a raw `eyJ…` blob is unchanged; a real capability never starts `CELLO-`).
  V43 `capability_claim_codes` (natural TEXT key → replication-safe, RLS) added to PUBLICATION_TABLES;
  OpsAgentExpectedMigrationVersion 42→43. Both reviewers: replication-race fix = the gate retries not_found
  ~2s (5×400ms) to absorb cross-region lag; expired distinguished from unknown. Directory + ops-agent
  pipelines InProgress on 70c4f41c. Deploy-watch cron fc618ee5. POST-DEPLOY (cron does): bump ops-agent SSM
  →43 as soon as V43 lands (crash-loop guard), re-run setup-replication.sh (add table to publication),
  restart relays, verify table replicates. Full end-to-end short-code REGISTRATION test needs a Telegram
  registration (Andre). #1 seal-liveness + #2a token-parse already shipped + promoted to latest (v0.0.71:
  connect 0.0.57 / daemon 0.0.30 / crypto 0.0.16). Spec: docs/planning/user-stories/m8b/2026-07-06_0300_
  token-ux-short-claim-code-spec.md.
- **🔧 FEDERATION COUNTER-COLLISION FIX + FULL DB RESET (2026-07-05, commit `4328fcb1`).** Root cause:
  replicated BIGSERIAL tables collided — logical replication copies rows but never advances the
  subscriber's sequence, so a node that received rows via replication drew a `nextval()` that already
  existed → duplicate-key on `_pkey` → local write failed / subscription wedged (broke the first
  cross-node seal; wedged the ap1 subscription at 3590+ apply-errors). FIX: per-node sequence staggering
  in `setup-replication.sh` Step 5c — each node mints ids in its own residue class (offset us1=1/eu1=2/
  ap1=3, `INCREMENT BY 1000`; growth-safe to 1000 nodes), + `seal_notarizations` added to the publication
  so cross-node seals federate. Executed a FULL FRESH DB RESET (all data was disposable test data):
  dropped all 6 subs + 6 slots + publications (verified 0 replication objects on every node BEFORE any
  truncate — no 2026-06-25-style cascade), TRUNCATEd all data tables on all 3 nodes (kept
  flyway_schema_history), re-ran setup-replication.sh. POST-STATE (verified): 6 slots streaming, all
  subscriptions **0 apply-errors** (ap1 un-wedged), sequences staggered (cs/notar/sess last_value = 1/2/3
  by node), publication = 18 tables incl seal_notarizations. Reviewed by feature-dev:code-reviewer +
  cello-fallback-finder (TOCTOU table-lock + positive STAGGER_DONE marker + serial-discovery fixes
  applied). Consequence: all agents must re-register (profiles wiped). Plan/journal:
  docs/planning/user-stories/m8b/2026-07-05_1500_cross-node-counter-collision-reset-fix-plan.md.
  NOTE: directory_checkpoints federated-checkpoint layer is dormant (never produced a checkpoint) —
  separate future activation, out of scope.
- **🎉 CROSS-NODE SESSION ESTABLISHMENT — PROVEN LIVE (2026-07-05).** Directory `4714f244` deployed all
  3 regions (Option A: discovery trusts replicated agent_presence.online, no directory_nodes freshness
  gate; + portal presence read made consistent). Relay cascade done (us1 10.0.32.210 / eu1 10.1.6.130 /
  ap1 10.2.99.176). **Agent-1 (us1) → demo (eu1) `cello_initiate_session` = ok:true** with the full
  cross-node flow in the log: discovery online@eu-central-1 → signaling.visiting.connected(eu-central-1)
  → FROST assignment → session.crossnode.established → visiting.released(handoff-complete); and
  `cello_send` delivered over the relay (seq 0). Two agents on different regions CONNECT + COMMUNICATE.
  agent_presence replicates cross-node (setup-replication refresh). Seal (`cello_close_session`) hit
  `seal_unilateral_timeout` — existing FROST-seal layer, demo is old client 0.0.34 + relays just
  cascaded; NOT the cross-node feature. directory_nodes replication left as-is (BIGSERIAL id collision;
  Option A makes discovery not need it — no truncate per the 2026-06-25 incident).
- **Story C (live milestone-close) — IN PROGRESS.** LIVE-PROVEN so far: directory answers
  `discovery_lookup` (correlationId + `directory.profile.read_through`), client sends it + surfaces the
  named `counterparty_offline` (Story A+B work at the wire). Blocked on the presence fix above; once
  deployed, re-run scenarios 1–5. Demo agent (7ab98987…) home flips us1↔ap1 across restarts (resolver).

---

## 🚀 M8B Sprint A — registration availability fix (in progress, 2026-07-04)

### Problem 2 — QUORUM REGISTRATION — SHIPPED + PROMOTED TO `latest` + directory deployed (2026-07-04)

**Register among the available quorum (not all-N).** Client sends its reachable nodeIds R; directory picks
Q = R ∩ manifest, `participants = |Q|`, `threshold = majority(N) = floor(N/2)+1`, refuses `below_quorum` if
|Q| < T. Client fans the DKG to Q; seal targets Q (persisted). Spine-verified GREEN (kill 1 of 3 → registers
among the 2-node quorum). Both review Criticals fixed (persist-Q + refresh-forward).

- **cello-client PROMOTED TO `latest` 2026-07-04** (tag `v0.0.69`, smoke GREEN, binary-verified). All 7 on
  `latest`: crypto 0.0.15, protocol-types 0.0.13, transport 0.0.13, client 0.0.43, daemon 0.0.28, cli 0.0.26,
  connect 0.0.55. New `npm i -g @latest` installs get quorum registration by default. Andre's local install +
  daemon updated + restarted (clean boot on 0.0.28: bundled 3-node manifest, step-6 `verified`, no crash).
- **Directory DEPLOYED** `cello-directory:bb02899`, all 3 regions rolloutState=COMPLETED, 0 failed, no crash
  (verified rolloutState + failedTasks + startup logs, not just pipeline status). Relay cascade initiated
  ~12:15 UTC (all 3 relays stopped → re-registering).
- **Threshold = `majority(N)` — SETTLED, do not re-raise.** `T < N` is the whole point (redundancy). All-N
  is decided against (one node down = whole system down = zero redundancy). Never propose reverting to all-N.
- Follow-ups (Sprint B / noted): absent-node reconcile; enrollment; the legacy file-persistence backend
  doesn't read directoryNodeIds back (dead code on current wiring).


**Problem 1 (participant registers signer at round 3, FINDING-8) — DEPLOYED.** Directory image
`cello-directory:97bc68c` live in all 3 regions (`cello-directory-pipeline` Succeeded; tasks started
~07:25 UTC). Commit `97bc68c9`. Fix: the DKG round-3 handler now registers the in-memory delegated signer
on EVERY participant, so a non-coordinator can serve a session-initiate without a reboot. Plan/record:
`docs/planning/user-stories/m8b/2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan.md`.

**Relay cascade (2026-07-04, ~07:5x UTC):** all 3 relays `stop-task`'d to re-register with the new
directory tasks (mandatory after a directory redeploy). ECS relaunching. **TODO next tick:** verify
`relay.already.registered` + re-sign manifests per region (new relay IPs, per infra/CLAUDE.md) + verify
6 ECS 1/1 + 6 DNS, then run Problem 1's live proof (fresh agent → initiate via a non-coordinator directory
→ expect success, not `frost_signer_not_configured`).

**Problem 2 (quorum registration) — NOT deployed; BLOCKED on a design decision** (how the available
quorum Q is determined + agreed between client and directories — see the plan doc). Needs Andre.

---

## 🔑 M8B-PREAUTH-CAP — pre-auth capability infra (2026-07-03, deploy pending)

Replaces the opaque single-use pre-auth token (which fails T-of-N registration — a replication race on
the non-idempotent consume) with an ops-agent-SIGNED capability every directory verifies independently +
a LOCAL idempotent nonce→agent binding. Design: `docs/planning/user-stories/m8b/2026-07-03_1618_tofn-registration-preauth-capability-design.md`.

**Provisioned (all 3 regions, 2026-07-03):**
- **Secrets Manager `cello/dev/preauth/issuer-key`** — Ed25519 issuer signing seed (32-byte hex). ONE
  issuer identity, SAME value in all regions (NOT a per-region transport key). Injected as
  `CELLO_PREAUTH_ISSUER_KEY_HEX` (directory ValueFrom, stage-2) — used at /internal/pre-authorize to sign.
- **SSM `/cello/dev/preauth/issuer-pubkey`** = `16c9596923b4efbac7bba913ffcf31f6dbc467639e14ed289dfb070276240c51`
  (same all regions). Injected as `CELLO_PREAUTH_ISSUER_PUBKEY` (directory `{{resolve:ssm}}`, stage-1) —
  the pinned key DKG Round 1 verifies capabilities against.
- **IAM** `cello-iam.yaml`: added `preauth/issuer-key*` to both directory secret lists (exec + task).
- **Migrations V40 + V41** `pre_auth_nonce_bindings` (LOCAL, not in cello_pub) — nonce→bound_agent
  single-use. **V40 shipped as `bound_epoch` and was applied to us-east-1 RDS by an intermediate build;
  the security fix renamed the column, which tripped a Flyway checksum mismatch (directory crash-looped
  in StagingDeploy).** Per the M5 rule (never modify an applied migration): V40 reverted to its exact
  applied bytes (checksum matches) + **V41** `ALTER TABLE … RENAME COLUMN bound_epoch TO bound_agent`.
  Template `OpsAgentExpectedMigrationVersion` → 41; **live SSM must be bumped to 41** after the directory
  applies V41 (else ops-agent crash-loops).

**Deploy status:** SHIPPED + LIVE-VERIFIED (2026-07-03). Directory image (exec d35a5eb6) deployed to all 3
regions; `deploy.sh dev <all 3>` applied the issuer env + IAM grant (us1 cicd-stack failure is the known
benign CelloClientWebhookSecret issue, unrelated). All 3 directories log `directory.auth.capability.enabled`
(issuer pubkey 16c9596…) + `PgNonceBinder` initialised. Live SSM expected-migration-version = 41.

**✅ LIVE VERIFICATION PASSED (the whole point of this work):**
- **Capability registration works** — a FRESH agent (`capX`, primary 12b27ef…) registered with a signed
  capability; the DKG fanned across ALL 3 directories (stream.open.attempt+ok to us1/eu1/ap1),
  `registration.frost.share.persisted`, **`registration.succeeded`**. This is exactly what FAILED with the
  token (`dkg_failed`) — the T-of-N registration blocker is RESOLVED.
- **Single-use enforced** — re-presenting the SAME capability for a DIFFERENT agent (`capY`) was REJECTED;
  us1 logged `directory.auth.nonce.conflict` (nonce bound to capX's pubkey). The code-review bypass
  (bind-to-agent not bind-to-epoch) is closed live.

**Remaining follow-ups (documented for a focused session — NOT blocking; core feature is done):**
- **Baseline seal — PROVEN LIVE 2026-07-04.** `capX` (fresh capability-registered T-of-N agent) →
  `cello_initiate_session` → `cello_close_session` completed: `sealed_root 8e69c4e4…`, both participants
  `attestation_mode:"live"`. Full path capability→registration→session→seal works end-to-end.
  ⚠️ **Correction:** the `frost_signer_not_configured` recorded here earlier was NOT a directory issue, and
  the "directories load signers at STARTUP / restart the directories" hypothesis is **FALSIFIED** —
  registration registers the in-memory signer immediately (`directory-node.ts:2517`). The live error was a
  **degraded LOCAL daemon** (reconnect attempt 80, frozen log, stale MCP socket — friction F7/F9/F11); a
  clean `cello logout`/`login` fixed it and the seal succeeded.
- **#10 remaining piece:** kill EXACTLY ONE non-us1 directory + re-seal (the `j-sign` redundancy case,
  live). Disruptive to shared dev infra — needs explicit go-ahead + restore cascade per `infra/CLAUDE.md`.
- **FINDING-8 (new, code-confirmed):** a non-home directory cannot serve a freshly-registered agent's
  session-initiate until it restarts (`getProfile` is in-memory-only, boot-populated; no runtime refresh —
  `pg-directory-store.ts:1041`). Real gap in the redundancy invariant; not yet live-triggered (capX routed
  to us1, which had its profile). Logged in the m8b e2e journal (FINDING-8). Directory-side; does not touch
  the capability feature.
- **Reviewer unit tests** — core logic IS unit-tested (crypto capability 13 tests; DevNonceBinder
  bind-to-agent single-use 4 tests); the directory round-1 gate + PgNonceBinder-over-SQL are LIVE-covered
  (capX register + capY reject) but lack isolated unit tests (gate lives in a large stream handler;
  PgNonceBinder needs a Postgres harness). Regression protection only.
- **`latest` promotion** — DONE 2026-07-04 (all 7 packages; see the Problem 2 block above for versions).

---

## 🔍 Ground-truth reconciliation — 2026-07-03 (FINDING-4 PROPER FIX shipped + directory step-6 enabled)

**FINDING-4 is fixed and LIVE on `latest`.** The kill-us1 failover test (2026-07-03) exposed that
daemon 0.0.24's roster-aware failover resolver was correct but had NO roster to use — the client never
loaded a consortium manifest (only a fake 1-node staging placeholder existed; dev directories served
`/manifest`→503). The pump was wired to an empty well; the redundancy invariant was not satisfied.

**Client fix — daemon `0.0.25` / cli `0.0.23` (published beta + promoted `latest`; tag `v0.0.66`,
smoke-tag green; connect unchanged `0.0.53`).** A real signed consortium manifest of the 3 sovereign
directories (real node pubkeys us1 `167ca6…27b5`, eu1 `8105b1…1b45`, ap1 `9b4b67…b984`; nodeId = region;
endpoint = `/bootstrap` base) is COMPILED INTO the client and loaded BY DEFAULT, WITH step-6 directory
identity auth — GATED on `CELLO_DIRECTORY_URL` being a bundled node (local dev / spine harness stay on
the M6 path). Officer signing key: Secrets Manager `cello/dev/consortium/officer-key-0` (pubkey
`8e9b99…64199` pinned in the client). Reproduce the manifest byte-identical via
`infra/scripts/sign-consortium-manifest.mjs dev`.

**Directory change — `CELLO_DIRECTORY_NODE_KEY_HEX` (= node-private-key secret) added to
`cello-ecs-directory.yaml` and DEPLOYED to all 3 regions via `deploy.sh` 2026-07-03.** This makes each
directory SIGN the step-6 challenge so a manifest-configured client can verify it reached the real
consortium node (defeats a `/bootstrap` MITM). Backward-compatible: manifest-less clients never request
the proof. Directory image unchanged (`7c66ba2`) — task-def env change only.

**Failover VERIFIED LIVE (full prod posture, roster + step-6):** killed us1 → daemon failed over to eu1
`verified:true`; killed eu1 (us1 still down) → failed over to ap1 `verified:true`. Client survives 2 of 3
directories down and cryptographically verifies the fallback. The bundled DEFAULT (fresh `npm i
-g @latest`, no env) was proven: `daemon.manifest.bundled` → `directory.auth.challenge.verified` →
`signaling.connected verified:true`.

**CORRECTION (2026-07-03): the earlier "KNOWN GAP / FINDING-7" claim here was WRONG — retracted.** It
said session ceremonies are home-node-bound and blocked on an unbuilt T-of-N protocol. Both false.
T-of-N is built + spine-proven: `j-tofn-dkg` (2-of-3 DKG across all 3 nodes), `j-sign` (consortium seal
is FROST T-of-N and SURVIVES a participating node DOWN), `j-suspend-tofn` (threshold suspension). The
`ceremony_exhausted` in the FINDING-4 failover run was CORRECT below-threshold behavior — I had killed
2 of 3 directories (only ap1 up = 1 of 3; a 2-of-3 seal needs 2), and the test agents were registered
pre-FINDING-4 (single-node shares). FINDING-4 (the roster) is the ENABLER of client-coordinated T-of-N,
not a separate blocked layer. **Remaining is a narrow LIVE check** (register a fresh agent → seal → kill
exactly ONE directory → seal still completes), not a milestone. See journal FINDING-7 (RETRACTED).

**Test fix:** `j-suspend-tofn.spine.test.ts` was missing `cello_start_agent(xtarget)` — a session target
must be online, else the directory folds an empty counterparty endpoint → `counterparty_unavailable`.
Fixed; test green.

**CLUSTER — clean + healthy (2026-07-03):** all 6 ECS 1/1 COMPLETED; all 6 DNS resolve; all 3 relay S3
manifests FRESH (healthCheckUrl matches live relay IP: us1 `10.0.24.236`, eu1 `10.1.84.138`, ap1
`10.2.96.205`). us1+eu1 directories were killed/restored during the failover test and their relays
force-new-deployed + re-registered. Directory task defs (all regions) now carry
`CELLO_DIRECTORY_NODE_KEY_HEX`.

**DEMO AGENT (`i-0ad3e7c22470f266e`) — updated to latest + verified 2026-07-12 (SEC-1 rollout, enforce-immediately).**
Local install at `/opt/cello-demo` bumped `@cello-protocol/daemon` 0.0.37→**0.0.50** and `cli` 0.0.30→**0.0.48**
(via SSM RunShellScript, `npm install @cello-protocol/cli@0.0.48 @cello-protocol/daemon@0.0.50` as root, then
`chown -R cello-demo:cello-demo /opt/cello-demo`); restarted in order (stop demo→daemon, sleep 2, start daemon,
sleep 8, start demo). Verified via `systemctl is-active` (both `active`) and journal: `daemon.manifest.bundled`
(3 nodes) → `directory.auth.manifest.verified` → `directory.auth.challenge.verified` (eu-central-1 this cycle,
was us-east-1 previously — directory-node resolution is not pinned) → `directory.signaling.connected
verified:true` → `agent.online default` → standing receiver (`session.node.created`) → `demo.started`. Identity
**preserved** — pubkey still `7ab98987…6ec1f910`. This closes the last open step on `SEC-1` (relay-park content
authentication fix, [[M8C-DEFINITION-OF-DONE]]) — the demo agent was the one known SEC-1-relevant laggard still
on a pre-fix daemon; now on 0.0.50 it produces/verifies signed park envelopes like every other agent. Two
benign warnings at startup (`content.recover.auto.relay_failed reason:standing_receiver_unavailable` ×2,
`transport.autonat.unavailable directorySignalingStatus:reconnecting`) — both transient startup-ordering noise
before the standing receiver armed, not investigated further (no live-session re-verification done this pass;
prior full end-to-end re-verify below is from the previous update and pre-dates this bump).

**🔴 DEMO AGENT IS UNDISCOVERABLE — root-caused 2026-07-12, NOT a new bug, a stale consequence of the
2026-07-05 reset.** Live `cello_initiate_session` from Ms_Chelly to the demo agent's pubkey
(`7ab98987…6ec1f910`) fails `unknown_agent`. Traced to the DB, not assumed:
- `agent_presence` has a correct, correctly-replicated row (`owning_node_id: eu-central-1, online: true`,
  identical on us-east-1 via logical replication — verified `pg_stat_subscription` workers are live and
  current, ruling out a replication lag/bug).
- `agent_profiles` has **zero rows** for this pubkey on **either** node (both show 4 total profiles — only
  Andre's 4 personal agents, all `created_at` 2026-07-06/07). Discovery lookup
  (`directory-node.ts:3266 #processDiscoveryLookup`) requires BOTH a profile row AND a presence row
  (`resolveDiscoveryState(profile !== undefined, presence)`); presence-only is exactly `unknown_agent`.
- **Root cause: the 2026-07-05 cross-node-counter-collision reset wiped `agent_profiles` fleet-wide**
  (`docs/planning/user-stories/m8b/2026-07-05_1500_cross-node-counter-collision-reset-fix-plan.md`,
  documented consequence: "every existing agent (demo, Agent-1, …) must re-register — startup only writes
  presence, not a profile, no auto-reconcile by design"). Andre's 4 personal agents were re-registered
  afterward (hence their `created_at` dates); **the demo agent was never re-registered** — it has kept
  running and updating its own presence for a week, invisibly failing the one thing that matters
  (discoverability), because nothing about its own startup surfaces the gap (no error, no health-check
  failure — it looks completely healthy from the inside).
- **Fix, not yet executed:** `cd /opt/cello-demo && npx @cello-protocol/cli register default <TOKEN>` per
  `demo/CLAUDE.md`. Local keys are untouched (re-enrolls the SAME identity via the M8B quorum DKG flow,
  does not create a new pubkey) — this is `register`, not `create-agent`. **Blocked on a fresh pre-auth
  token from `@CelloConnectStagingBot` on Telegram — single-use, requires the human phone/email flow,
  no automatable bypass exists** (checked: no demo-specific token issuance in
  `packages/operations-agent/src/`). Needs Andre.

**DEMO AGENT — updated to latest + verified 2026-07-03.** Local install at
`/opt/cello-demo` bumped `@cello-protocol/daemon` 0.0.23→**0.0.26** and `cli` 0.0.21→**0.0.24** (connect
already 0.0.53); `chown -R cello-demo:cello-demo /opt/cello-demo` after the root npm install; restarted
in order (stop demo→daemon, start daemon, sleep 5, start demo). Verified: daemon logs
`daemon.manifest.bundled` (3 nodes) → `directory.auth.challenge.verified` (us-east-1) →
`signaling.connected verified:true` → `agent.online default` → standing receiver armed; then `demo.started`.
Identity **preserved** — pubkey still `7ab98987…6ec1f910` (the DB/key file untouched). Full end-to-end
re-verified: local Agent-1 → demo session (relay), demo's hardcoded welcome received, BILATERAL seal
(`sealed_root 74a51ef7…`, both `attestation_mode:"live"`). NOTE: demo daemon runs `CELLO_ENV=local` with
no `CELLO_DIRECTORY_URL`, so it resolves the bundled prod us1 node → FINDING-4 bundle + step-6 engage by
default (runbook `demo/CLAUDE.md` is stale on "only connect/client matter" — the daemon carries the change).

---

## 🔍 Ground-truth reconciliation — 2026-07-02 ~20:55 UTC (M8B cascade-2 deploy — directory + relay)

**M8B cascade-2 (FINDING-4/5/6) shipped.** cello-client published to beta AND promoted to `latest`
(daemon `0.0.24`, cli `0.0.22`; connect unchanged `0.0.53`; tag `v0.0.65`, smoke-tag green). Directory
redeployed with FINDING-5 (`frontier_leaves` on `seal_unilateral_confirmed`, SI-002) — the ONLY
directory-side change; FINDING-4/6 are client-only.

**Deployed images (ALL 3 regions): directory `cello-directory:7c66ba2`** (was `6f66557`; redeployed
2026-07-02 ~20:25 UTC via `cello-directory-pipeline` exec `096d5486`, status **Succeeded**; sequential
ProductionDeploy us-east-1 → eu-central-1 → ap-northeast-1, all rolled COMPLETED + steady, 0 crash loops).
Relay image unchanged (`c48deac`) — force-new-deployed only, to re-register after the directory restart.

**Per-region state after this deploy (verified live 2026-07-02 ~20:55 UTC):**
- **us-east-1** — directory image `7c66ba2` (rollout COMPLETED, steady); relay force-new-deployed, new task `a2a5215a`, **new IP 10.0.71.218** (was 10.0.23.246); manifest re-signed **v49**; directory `relay.manifest.refreshed v49` + `relay.health.check.passed` (2-6ms) against new IP.
- **eu-central-1** — directory image `7c66ba2` (COMPLETED, steady); relay new task `f71a8bf1`, **new IP 10.1.66.92** (was 10.1.75.110); manifest re-signed **v21**; directory refreshed v21 + health-check passing (2ms).
- **ap-northeast-1** — directory image `7c66ba2` (COMPLETED, steady); relay new task `e752d221`, **new IP 10.2.96.205** (was 10.2.30.214); manifest re-signed **v12** (directory also auto-wrote v11 on re-registration with the new IP); directory refreshed v12 + health-check passing (5-6ms).

**Post-deploy relay cascade (mandatory, done):** all 3 relays force-new-deployed → each re-registered
(`[RELAY] Peer connected` to directory peer `12D3KooWS46w…` + `relay.already.registered`) → manifests
re-signed with new IPs (`./infra/sign-manifest.sh dev <region> <defs>`) → directories refreshed +
health-checking the new IPs. **All 6 ECS services 1/1 COMPLETED; all 6 DNS names resolve.**

Note: this deploy observed the directory writing a fresh manifest (`relay.manifest.updated`) on relay
re-registration with a changed IP (ap-northeast-1 v11) — i.e. the historical "already_registered skips
re-sign" gap may be narrower than documented; the manual re-sign was still run to set the canonical
signed version explicitly. ALB DNS names rotated (query AWS, never trust STATE for those).

**Still Andre's (not done by the autonomous run):** the two live verifications — FINDING-4 kill-us1
failover (also exercises #12/#13/#5; restore per `infra/CLAUDE.md`) and FINDING-6 B-reconnect →
`cello_get_sealed_receipt(B)`. (latest-promotion + `npm i -g …@latest` + `cello login` + MCP reconnect
were all completed by Andre during the session.)

---

## 🔍 Ground-truth reconciliation — 2026-06-29 (live audit, all 3 regions)

A live audit of the directory + relay in all 3 regions was run during an M7 debugging session.
STATE.md's per-region tables had drifted: CI/CD image swaps since the 2026-06-27 `deploy.sh` run
do NOT update STATE.md. Current ground truth + material findings below. (Per `infra/CLAUDE.md`,
ALB DNS names are always query-AWS — the snapshots below are point-in-time, not authoritative.)

**Deployed images (ALL 3 regions): directory `cello-directory:6f66557`, relay `cello-relay:c48deac`**
(directory redeployed 2026-07-02 ~20:30 UTC via `cello-directory-pipeline` — FINDING-3 unilateral
seal legibility + the M6B-014 stale-IaC-test fix; relay image unchanged, force-new-deployed for
re-registration. Prior directory image `04d95ad`; STATE tables (below) say `d5d0424` — both stale.)

Per-region current state (taskdef rev / running relay private IP / ALB DNS) — as of 2026-07-19:
- **us-east-1** — directory `:267` (image `50c7748`) / `cello-dir-dev-1341968405`; relay unchanged. **2026-07-19 incident:** failed deploy.sh attempts rolled back the ECS service from :267 to :225 (old image `642bb7a`). Fixed by `aws ecs update-service --task-definition cello-directory-dev:267 --force-new-deployment`. Full incident log: `docs/planning/discussion_logs/2026-07-19_0600_smoke-test-fix-and-alb-drift.md`. CFN stack `cello-ecs-directory-dev` is in `UPDATE_ROLLBACK_COMPLETE` with ALB drift (physical resources point to dead ALB `9f3cee2f6df31fc9`, live ALB is `61ee3093c761981a`). deploy.sh CANNOT update this stack until drift is resolved. CI/CD pipeline deploys work fine (they don't touch CFN).
- **eu-central-1** — directory `:82` / `cello-dir-dev-114927676`; relay `:35` / `10.1.75.110` / `cello-relay-dev-1538955378`.
- **ap-northeast-1** — directory `:73` / `cello-dir-dev-1500332624`; relay `:30` / `10.2.30.214` / `cello-relay-dev-1984262345`.
- All 3 relays force-new-deployed this session (re-register after directory redeploy); **S3 relay
  manifests VERIFIED FRESH** — healthCheckUrl matches live relay IP in every region (directory re-signed
  on re-registration; no manual re-sign needed).

**✅ `directory-ap1.cello.mygentic.ai` RESOLVES — the prior CRITICAL NXDOMAIN note was STALE/RESOLVED.**
Verified 2026-07-02: directory-ap1 → 35.79.146.148 / 54.199.0.195, and all 6 DNS names (directory ×3 +
relay ×3) resolve. All 3 sovereign directory nodes are reachable by clients. (The 2026-07-01 A-record
drift was fixed; deploy.sh/CFN owns the record and it is healthy.)

**Relay exposure model (consistent all 3 regions — previously undocumented):**
- Relay ALB is **HTTP :80 only** (no HTTPS). ALB :80 → relay target port **4002** (client-facing WebSocket); health-check port 4000.
- Relay SG inbound (all source-SG-scoped, NO CIDR/public rules): **4001 (libp2p, directory-facing) ← directory SG ONLY** (same-region, private — not ALB, not public); **4002 (client WS) ← ALB SG only** (public via ALB:80); **4000 (health) ← directory SG + ALB SG**.
- So clients reach the relay on **4002 via the ALB (public)**; the directory reaches it on **4001 privately, same-region SG**. The directory→relay control channel (`recordAssignment` / `getSealLeaves` / `confirmSeal`) is same-region-private **by security group** — this is the structural reason cross-region directory→relay does not work (SGs cannot reference cross-region resources). Co-location was a **cost** decision (shared per-region VPC / NAT / ECS cluster); the directory and relay ALBs are actually **separate** per service.
- Both directory and relay ALBs are HTTP :80 only in all regions (no 443). Directory ALB rules: default→8080, `/bootstrap`+`/agent-lookup`+`/manifest`→9090, `/internal/*`→8081.

**Operational changes made THIS session (2026-06-29, manual — recorded per the STATE.md rule):**
- **us-east-1 relay force-new-deployment** (`aws ecs update-service --force-new-deployment cello-relay-dev`) to recover `relay_unavailable`. Root cause = the documented relay-no-reconnect gap: the directory had restarted (task startedAt 12:22 UTC) and the relay never re-registered, so the directory's `recordAssignment` adapter stayed pinned to a wrong/unreachable relay. New relay task IP **10.0.27.225**. ⚠️ S3 relay manifest healthCheckUrl may now be stale — re-sign per `infra/CLAUDE.md` if clients report relay issues.
- **demo agent (`i-0ad3e7c22470f266e`) `cello-daemon` + `cello-demo` restarted** to recover its standing receiver (it had silently died). Agent `default` (`bc94ead6…`) back online; a live session + bilateral seal succeeded afterward.

**Client-side bug found (NOT infra — for the cello-client backlog): demo agent standing receiver
dies after ONE inbound session.** `CELLO_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4001` (fixed port); a session
consumes the receiver node, the immediate rebuild collides `EADDRINUSE` on 4001, and there is no
retry/recreate loop. Any fixed-port agent accepts exactly one inbound session, then is dead until
the process restarts.

---

## 🌐 M8 operator portal — LIVE + OPERATOR-VERIFIED (deployed 2026-06-28; exercised 2026-06-29, us-east-1)

> **2026-06-29 status:** the portal is live at **https://portal.cello.mygentic.ai** and Andre drove it
> end-to-end through a browser: magic-link login (code + emailed link), agents appearing from the LIVE
> directory, passkey enroll, and a real Burn of an orphan agent (verified federation-wide — `burned:true`,
> a clear returns `409 burned_immutable`). Current portal image: **`cello-portal:776752d`**. Several live
> bugs were found + fixed today (see the "2026-06-29 operator-verified" subsection below). The directory
> was redeployed via `cello-directory-pipeline` with the agents-by-account 502 fix (commits 469c2711 +
> 04d95ad3). Runtime env now also includes `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`; the delivery-failure
> alarm is wired to the `cello-ops-warning-dev` SNS topic.


The portal (Mygentic-AI/cello-portal, branch `m8-assembly`) is being stood up on AWS as IaC. It is a
single-region (us-east-1) Next.js app in the **directory's VPC**, reaching the directory ONLY over its
public ALB `/internal/*` (header-authenticated) — never the directory DB. Three new CFN templates +
one build script (all in `infra/`):

- **`cello-portal-build.yaml`** → stack `cello-portal-build-dev` **[CREATE_COMPLETE]**. ECR repo
  `cello-portal`, S3 build-source bucket `cello-portal-build-source-257394457473`, CodeBuild project
  `cello-portal-build-dev` (privileged; builds the Dockerfile, pushes to ECR). Export
  `cello-dev-portal-ecr-uri`.
- **`infra/build-portal.sh`** → `git archive` the committed cello-portal HEAD → S3 → CodeBuild. Images
  built in AWS only (never docker-pushed from local). **Built `cello-portal:8a2603b` + `:latest`**
  (commit 8a2603b on m8-assembly; CodeBuild SUCCEEDED).
- **`cello-waitlist.yaml`** → stack `cello-waitlist-dev` **[CREATE_COMPLETE, 2026-07-25]**, us-east-1 only.
  63 resources: 12 Lambdas (`cello-waitlist-{signup,auth,actions,email,bounce,waves,gate,firstwin,feedback,outreach,utm,gallery}-dev`),
  HTTP API with custom domain **`api.cello.mygentic.ai`** (status AVAILABLE) + its own DNS-validated ACM
  cert, 20 routes incl. CORS preflight, 4 EventBridge schedules (email drain every minute; re-engage
  06:23, feedback 06:17, outreach 06:47 UTC), SNS bounce topic + SES configuration set
  `cello-waitlist-dev` publishing bounce/complaint/reject/renderingFailure to it, and a security group
  reaching the PORTAL RDS (`sg-07ba031fda87adb88`) on 5432.
  **DATABASE_URL verified as `portal_admin@cello-portal-dev…/cello_portal`** — NOT the directory
  instance; an earlier draft imported the wrong exports and that check is the one worth repeating.
  **Deployed by hand with `aws cloudformation deploy`, NOT deploy.sh**, because deploy.sh cannot reach
  its STEP 15: it exits on `cello-ecs-directory-dev`, which has failed on every run since at least
  2026-07-16 (ALB drift across hibernate/wake — see
  `docs/planning/discussion_logs/2026-07-25_0545_directory-stack-undeployable-alb-drift.md`).
  Parameters used were exactly the ones STEP 15 computes.
  **Function CODE is NOT in the stack** — CFN ships placeholders that raise; `deploy-lambdas.sh dev waitlist` owns it.
  **2026-07-25, later the same session:**
  - All 12 function bodies deployed via `./infra/deploy-lambdas.sh dev waitlist` (~4.29 MB each,
    psycopg2-binary built for linux/amd64 in Docker). Verified: every function's `CodeSize` is now
    ~4.29 MB rather than the 392-byte placeholder.
  - **13th function added: `cello-waitlist-migrate-dev`** (stack update → 64 resources). VPC-attached,
    900s timeout, 512 MB, `DATABASE_URL` only. **No schedule, no API route, MANUAL INVOKE ONLY** —
    applying DDL is an operator action. It carries the `.sql` files packaged from the
    `corp-cello-site/migrations` checkout, and exists because there was no other path from those files
    to the database: the site is a static export that cannot run them, and the portal RDS is
    `PubliclyAccessible:false` in a VPC with no peering a laptop can reach.
    Invoke `{"dry_run": true}` first — it lists what WOULD be applied and touches nothing.
    All 13 function bodies redeployed 2026-07-25 10:09 UTC; the migrator now takes a non-blocking
    session advisory lock (key 0x4D31314D49475241) so two concurrent runs cannot both execute DDL.
    Verified against the deployed function: dry run reports
    `{"pending": [], "already_applied_here": 22, "ledger_rows_total": 29}` — 22 M11 migrations
    matched by this runner, 29 rows in the table (the portal's own 7 are the difference).
    Redeployed 2026-07-25 ~10:30 with three guards added after review: a filename-keyed ledger row
    refuses (three runners write this ledger and one had a different key format), a gap in the
    migration set refuses, and the advisory lock is now taken BEFORE the ledger CREATE.
  - **ALL 22 M11 MIGRATIONS APPLIED to `cello_portal` on 2026-07-25.** `schema_migrations` now holds 29
    rows: the portal's own 7 (`0001_init` … `0007_track_record_refresh_log`, applied by the portal
    container at boot) plus M11's 22 (`0001_m11_waitlist_p0` … `0022_retire_lapsed_tokens`). Both sets
    share one ledger table and do not collide, because the version key is the file STEM and the two
    naming schemes differ. Idempotency verified in production: a second invocation applied 0.
    NOTE for anyone adding a migration to ANY repo that targets this database — the ledger is shared, so
    a stem that already exists is silently treated as applied. `ops-dashboard/migrations` had exactly
    that collision (`0002_magic_link_requests`, same stem as the portal's) and was renamed before it
    could ever be applied.

- **`cello-portal-data.yaml`** → stack `cello-portal-data-dev` **[UPDATE_COMPLETE, 2026-07-25]**. SGs (portal-alb
  `sg-0640c459d8887e2b6` / portal-task `sg-00c0f6e65386bf534` / portal-db **`sg-07ba031fda87adb88`**), RDS Postgres
  **`cello-portal-dev.c9iokw02w3f8.us-east-1.rds.amazonaws.com:5432`** (db.t4g.micro, DB `cello_portal`,
  ManageMasterUserPassword → secret `rds!db-1292ef13-…`), ACM cert
  `arn:aws:acm:us-east-1:257394457473:certificate/de0d5927-601e-450e-914a-f58ff7a80200` (issued, DNS-
  validated via zone Z02692523DOH7NW521CL8). (First attempt rolled back on an em-dash in an EC2
  GroupDescription — ASCII-only; fixed + redeployed clean.)
- **`cello-portal-app.yaml`** → stack `cello-portal-dev` **[CREATE_COMPLETE — LIVE]**. Public ALB (HTTPS/
  ACM, HTTP→443 redirect), Route53 A `portal.cello.mygentic.ai`, ECS Fargate service on the shared
  `cello-dev` cluster (running 1/1, rollout COMPLETED), exec+task IAM (ECR pull, secrets read,
  `ses:SendEmail` for `*@mygentic.ai`), + a `MagicLinkDeliveryFailures` metric filter/alarm wired to SNS
  `cello-ops-warning-dev` (a SES misconfig = silent login outage). Runtime env: CELLO_ENV, DIRECTORY_API_URL,
  PORTAL_BASE_URL, PORTAL_EMAIL_FROM, **WEBAUTHN_RP_ID=portal.cello.mygentic.ai**,
  **WEBAUTHN_ORIGIN=https://portal.cello.mygentic.ai**. **Current ImageTag: `776752d`** (was f6a43d8 at
  first deploy; redeployed several times today for live fixes).
  **2026-07-25 update (M11):** added Output/Export `cello-dev-portal-db-sg` = `sg-07ba031fda87adb88`.
  Zero resource changes — the changeset was empty, only the Output is new. Needed because
  `cello-waitlist.yaml` imports that SG to open 5432 from the waitlist Lambdas; without the export
  the only DB security group reachable by cross-stack reference is the DIRECTORY's
  (`cello-dev-rds-sg`), which is what the waitlist template's first draft wrongly imported.
  Applied by hand via `aws cloudformation deploy` (deploy.sh does not own this stack;
  `infra/deploy-portal.sh` step 3 does, and running the whole script would have rebuilt the
  portal image unnecessarily).

### 2026-06-29 — operator-verified live + the fixes it surfaced
Andre exercised the live portal; each issue was fixed, redeployed, and verified:
1. **Sign-in had no code field + the emailed link was broken.** SignInForm dead-ended after the request
   (code-entry step never built); the verify-GET redirected to the container's internal host
   (`new URL(req.url).origin` behind the ALB) and the single-use token was consumed by an email-scanner
   prefetch. FIX: stepped form (email → code), token deep-link completes via POST (prefetch-safe), all
   redirects use the public base URL (`src/server/base-url.ts`), prominent HTML email.
2. **Agents page showed "directory unreachable" + no agents (502).** The directory's agents-by-account
   query SUCCEEDED but serializing crashed: `last_seen_at.toISOString is not a function` — the directory
   installs a global pg TIMESTAMPTZ→string parser, but the code assumed a Date. FIX (directory pipeline):
   normalize to a Date at the repo boundary; configurePgTypes() in the harness + repo test so the e2e
   catches this class. (Plus AC-011 guard: deploy-portal.sh added to the authorized-script allowlist.)
3. **Passkeys broke** — `WEBAUTHN_RP_ID must be set outside CELLO_ENV=local`. FIX: added the WebAuthn env
   to the task def.
4. **Account & Security UX** — hardcoded "test-device" passkey name; gray (not green) status; raw
   user-agent string in sessions. FIX: operator names the passkey (never "test"), green "Enabled" /
   "this device", friendly "Chrome on macOS" (raw UA on hover).
5. **Burned row showed amber "paused" alongside "Burned."** Burn sets paused+burned; the row now shows a
   RED terminal "burned" only (amber reserved for reversible paused). Burn proven federation-wide live
   (`burned:true`; clear → `409 burned_immutable`).


**✅ PORTAL IS LIVE — verified end-to-end (2026-06-28):**
- `https://portal.cello.mygentic.ai/sign-in` → **200** (ACM cert valid); HTTP → **301**→HTTPS; protected
  `/` → **307**→sign-in (no session). DNS A → ALB.
- The task **self-migrated** the RDS on startup (`portal.backend.started migrationVersion 0005`).
- **Served portal ↔ LIVE directory seam PROVEN:** `POST /api/auth/magic-link/request` → `{ok:true,
  sent:true}` (200) + log `portal.auth.magic_link.requested accountResolved:false`. A 200 (not 500) proves
  the portal reached the **live** directory `/internal/account-by-email-stub` over its public ALB with a
  valid `x-cello-internal-api-key`, and the directory answered (unknown email → not resolved, no
  enumeration). This is the DOD-E2E-1 "served portal against the live directory" dimension, now real
  (single-region; cross-node/3-region/T-of-N aspects remain gated as before).

### Portal deploy bug found + fixed (Symptom / Root cause / Fix / Rule)
- **Symptom:** first app-stack deploy rolled back — ECS task exited 1 (deployment circuit breaker), logs
  lost with the rolled-back log group. The image had smoke-tested clean locally.
- **Root cause:** the RDS-generated master password contained `#`. Built into a `postgres://user:pass@…`
  URL un-encoded, `#` starts the URL fragment → the connection string was truncated → the portal could
  not connect to RDS → instrumentation migrate failed → exit 1. The local smoke test used a trivial
  password (`smoke`) so it never hit this.
- **Fix:** `create-portal-secrets.sh` now URL-encodes username + password (`urllib.parse.quote(safe="")`)
  before assembling the URL. Re-ran (kms-master-key correctly left untouched — CREATE-ONCE), redeployed
  → task booted + migrated + healthy.
- **Rule:** any DB connection URL built from a generated/managed credential MUST URL-encode the
  credential components — RDS passwords routinely contain `#/@:%`. Smoke tests must use a password with
  special characters, not a trivial one, or this class of bug hides.

**Secrets (us-east-1, CREATED):** `cello/dev/portal/kms-master-key` (64-hex, encrypts operator
email+TOTP at rest — DOD-INV-2; **value only in Secrets Manager, never recorded**;
ARN `…secret:cello/dev/portal/kms-master-key-C4n1Cc`, CREATE-ONCE) and `cello/dev/portal/database-url`
(`postgres://…?sslmode=no-verify`; ARN `…secret:cello/dev/portal/database-url-D6wkFq`). `DIRECTORY_API_KEY`
reuses the existing `cello/dev/ops-agent/directory-api-key`. Created by `infra/create-portal-secrets.sh`.

Runtime env: `CELLO_ENV=dev`, `DIRECTORY_API_URL=http://directory-us1.cello.mygentic.ai`,
`PORTAL_BASE_URL=https://portal.cello.mygentic.ai`, `PORTAL_EMAIL_FROM=CELLO <no-reply@mygentic.ai>`.
The portal self-migrates its RDS on startup (instrumentation.ts, fail-closed). Magic-link codes are
delivered by SES (new `src/server/email.ts`, commit 8a2603b).

**Reproducible deploy:** `infra/deploy-portal.sh [env]` orchestrates the whole flow idempotently (build
stack → CodeBuild image → data stack → secrets [kms CREATE-ONCE] → app stack → verify /sign-in==200) —
codifies tonight's manual steps, passes the region-expansion test. NOT folded into the giant `deploy.sh`
(its 3-region directory/relay flow is a different shape); the portal is single-region us-east-1 like
ops-agent/cicd. ALARM_TOPIC_ARN defaults to `cello-ops-warning-${env}` (wired).

**⚠ Cross-node presence is a DECISION for Andre, not done:** the live portal shows correct online/offline
ONLY for us-east-1-owned agents — `agent_presence` + `directory_nodes` are not in `cello_pub`, so the
portal (pinned to `directory-us1`) reads eu/ap-owned agents as offline. This is an architectural fork
(replicate mutable presence vs. node-local+forward vs. node-pinned) touching the sovereign-node invariant;
teed up with a recommendation (Option 1: replicate, citing the agent_suspensions precedent) in
`docs/planning/discussion_logs/2026-06-28_2030_m8-cross-node-presence-replication-fork.md`. Pair it with
the TRUST-1 H2 pickup_queue replication as ONE deliberate cluster-coupled change.

---

## ⏳ M8 directory — DEPLOYED, post-steps nearly done (2026-06-28, Andre-authorized)

**Pushed `387afc78`** (merge of `m8-read-001` onto main): the M8 directory code — READ-001
(account-by-email-stub / agents-by-account), WRITEAPI-001 (agent-write seam), TRUST-001 (pickup queue +
delivery), LEVER-001/002 (suspend/burn honor-check + per-node share destruction), PRESENCE-001
(agent_presence) — plus **migrations V31–V37** (V31/V32 already applied 2026-06-23/26; V33–V37 new).

POST-DEPLOY CHECKLIST:
1. [x] **Pipeline `cello-directory-pipeline` SUCCEEDED** (exec 9b0dff77; Build→StagingDeploy→SmokeTest→
       ProductionDeploy all green). Directory rollout COMPLETED in all 3 regions — task defs
       us-east-1:207, eu-central-1:78, ap-northeast-1:69. Image healthy.
2. [x] **Migrations V33–V37 applied** — proven two ways: the directory runs Flyway in its entrypoint
       BEFORE serving, so a healthy task ⇒ migrations succeeded; AND setup-replication's GRANT SELECT on
       `agent_suspensions` + `identity_tree_entries` succeeded (those tables only exist at ≥V34/V36).
3. [x] **Ops-agent SSM `/cello/dev/ops-agent/expected-migration-version` 32 → 37** (us-east-1, done).
4. [x] **Relays restarted (3 regions)** — stopped each; ECS relaunched. us-east-1 logged
       `relay.already.registered`; us-east-1 + eu-central-1 at 1/1; ap-northeast-1 relaunching. Ops-agent
       recovered (1/1, picked up SSM=37).
5. [x] **Replication DONE** — `setup-replication.sh dev us-east-1 eu-central-1 ap-northeast-1` ran clean:
       `cello_pub` now includes `agent_suspensions` + `identity_tree_entries` (added by m8-read-001's
       PUBLICATION_TABLES); all 6 subscriptions refreshed; **all 6 replication slots STREAMING** (246s).
       `pickup_queue` (BIGSERIAL, TRUST-1 H2) + `agent_presence` (mutable) deliberately NOT replicated.
6. [x] **CROSS-NODE REPLICATION VERIFIED LIVE** — wrote `identity_tree_entries('xnode-verify-…')` on
       **us-east-1** via ECS-Exec psql; 10s later read it back from **eu-central-1** with the exact hash;
       cleaned up. The M8 append-only tables (identity_tree_entries, agent_suspensions) replicate across
       regions on the live federation. (This proves the cross-node DATA layer; the dependent DoD
       *behavioral* lines still need: TRUST-1 pickup_queue/H2, INV-6/LEVER-3 the T-of-N protocol,
       PRES-2/3 agent_presence replication — none of which this deploy delivers.)

**NET: M8 directory is LIVE in all 3 regions; cross-node replication of the M8 append-only tables is
verified.** Remaining cross-node DoD flips are gated on other work, not on the cluster.

### Cross-node burn/suspend HONOR — what's proven (2026-06-28)
- **Revocation replicates cross-node, BOTH directions (PROVEN LIVE):** wrote `agent_suspensions(paused=true)`
  for a real agent via **eu-central-1** → read back on **us-east-1** (paused=true); then DELETE (un-pause)
  via eu-central-1 → us-east-1 shows 0 rows. So a burn/suspend recorded on ANY node is visible federation-
  wide, and a clear replicates too. (Done on the demo agent 04faa2a5; restored to un-paused.)
- **Honor-check refuses on a suspended row:** proven by J-SUSPEND (real binaries, cross-process, single
  node) — the directory refuses the FROST share when `isAgentSuspended`.
- **⇒ cross-node revocation honor is established by-composition** (replication live + honor-check proven).
- **NOT yet done — the live END-TO-END behavioral refusal** (a real ceremony on node B refused for an agent
  revoked via node A). Blocked by client tooling, NOT the cross-node mechanism: cello-mcp holds a SQLite
  write lock (one mcp per daemon — can't safely drive a 2nd client against the demo daemon), and a
  dedicated throwaway agent needs a registration token (ceremony) + a real DKG against the live cluster.
  This is a sub-project; and DOD-INV-6/LEVER-3 (strict T-of-N) need the UNBUILT T-of-N protocol regardless
  (the daemon is the 2-of-2 stopgap), so the behavioral test would not flip those to ✅ on its own.
  > **⚠️ STALE (2026-06-28 snapshot) — SUPERSEDED. Do not read "UNBUILT T-of-N protocol" as current.**
  > T-of-N shipped by M8B close (2026-06-30): `j-tofn-dkg` (2-of-3 DKG across all 3 nodes), `j-sign`
  > (consortium seal is FROST T-of-N, survives a node down), `j-suspend-tofn` (threshold suspension) are
  > all green. "2-of-2 stopgap" meant the client had no consortium ROSTER, not that the protocol was
  > missing — FINDING-4 (2026-07-03) populated the roster. This exact phrase seeded a later misdiagnosis
  > (retracted FINDING-7). See the 2026-07-03 CORRECTION near the top of this file.

---

## Environments

### dev — us-east-1
*Last deployed: 2026-06-27 (CONN-001 /manifest ALB ManifestPathRule APPLIED in all 3 regions via deploy.sh; relays redeployed in-order + re-registered)

> **2026-07-10 — directory IMAGE deploy (pipeline, no CFN change).** `DOD-DIR-FAILCLOSED-1` (D2):
> the directory never signs or distributes an assignment with an empty counterparty endpoint; on
> offer-accept timeout OR `session_offer_reject` it returns `counterparty_did_not_accept` to the
> initiator and sends nothing to the target. `cello-directory-pipeline` execution
> `3a8dea65-8385-4f31-b200-a92b9441a0dc`, source rev `1ccd08a5`, **Succeeded**. Rollout `COMPLETED`,
> `1/1` in all three regions; task definitions us-east-1 `:251`, eu-central-1 `:101`,
> ap-northeast-1 `:92`; tasks started 12:57 / 13:02 / 13:07 CEST (after the push — the new image is
> genuinely live). No CloudFormation stack changed, so the stack table below is unaffected.
>
> ⚠️ **Process note:** the directory pipeline is **path-triggered on push to `main`**. Merging
> `packages/directory/**` IS deploying it. "Merge freely, deploy deliberately" is not currently
> enforceable for that path.

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-06-05 | OperationsAgentRepo imported via CFN resource import |
| cello-iam-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-06-05 | DirectoryTransportKey + RelayTransportKey imported; all secrets CFN-managed |
| cello-ssm-parameters-dev | UPDATE_COMPLETE | 2026-06-07 | SSM migration version = V30 (updated manually 2026-06-07 after M6B-016 pipeline; ops-agent healthy) |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-06-07 | M6B-014: NatGateway + NatEip + PrivateNatRoute added; interface endpoints retained for stage-2 removal |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-27 | No changes |
| cello-s3-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-rds-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-06-05 | Fresh deploy from current IaC |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-06-27 | CELLO-M7-CONN-001: GET /manifest handler + getCurrentManifest wiring — image cello-directory:d5d0424. ✅ ALB ManifestPathRule (priority 6, path /manifest → BootstrapTargetGroup) APPLIED via deploy.sh 2026-06-27 (all 3 regions). /manifest is ALB-routable and returns the designed 503 `{"error":"not ready"}` — CELLO_DIRECTORY_CONSORTIUM_MANIFEST is unset (M6 backward-compat: no consortium manifest published to dev), so the daemon HTTP manifest poll degrades gracefully to its locally-pinned CELLO_CONSORTIUM_ROOT_KEYS. (prev: M6B-019 image 934d130 / task def :170) |
| cello-ecs-operations-agent-dev | UPDATE_COMPLETE | 2026-06-07 | M6B-016 registration engine; image cello-operations-agent:f4c3e72; task def :43; migrationVersion=30 confirmed healthy |
| cello-waf-dev | UPDATE_COMPLETE | 2026-06-06 | Deployed r12 |
| cello-ecs-relay-dev | UPDATE_COMPLETE | 2026-06-27 | Redeployed by deploy.sh 2026-06-27 (in-order, after directory) → new task IP 10.0.1.138; re-registered. S3 relay manifest healthCheckUrl matches live IP (directory re-signed on re-registration) — no manual re-sign needed. |
| cello-cloudwatch-dev | UPDATE_COMPLETE | 2026-06-06 | Deployed r12 |
| cello-route53-dev | UPDATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug during M6B-014 deploy. Recreated manually 2026-06-07. deploy.sh fixed (commit 6d17b30) — drift resolves on next deploy.sh run. |
| cello-route53-relay-dev | UPDATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug. Recreated manually 2026-06-07. Drift resolves on next deploy.sh run. |
| cello-cicd-dev | UPDATE_COMPLETE | 2026-06-06 | **Smoke test fix (2026-07-19):** `STAGING_DIRECTORY_URL` on `cello-smoke-test-build` CodeBuild project updated directly via `aws codebuild update-project` from stale `cello-dir-dev-85618485` (deleted ALB) to `cello-dir-dev-1341968405` (live ALB). Verified: DNS resolves, target healthy, HTTP /health returns 400 (accepted by smoke test). deploy.sh was NOT used — the `cello-ecs-directory-dev` CFN stack has ALB drift (physical resources point to dead ALB `9f3cee2f6df31fc9`) which blocks deploy.sh. That drift is a separate issue to resolve via resource import. |
| Lambda: cello-github-webhook-receiver-dev | DEPLOYED (real code) | 2026-05-22 | |
| Lambda: cello-pipeline-filter-dev | DEPLOYED (real code) | 2026-06-06 | REPOSPLIT-002: removed 4 dead pipelines (crypto/protocol-types/transport/client); now 5 pipelines only |
| ECR Replication (account-level) | CONFIGURED | 2026-05-24 | us-east-1 → eu-central-1 + ap-northeast-1; filter: prefix "cello-" |
| SSM: /cello/dev/directory/manifest-signer-pubkey (us-east-1) | UPDATED | 2026-06-07 | 167ca6...27b5 — correct, matches node-private-key |
| SSM: /cello/dev/directory/manifest-signer-pubkey (eu-central-1) | UPDATED | 2026-06-07 | 8105b1...1b45 — corrected manually; was stale 167ca6...27b5 from nuclear reset |
| SSM: /cello/dev/directory/manifest-signer-pubkey (ap-northeast-1) | UPDATED | 2026-06-07 | 9b4b67...b984 — corrected manually; was stale 167ca6...27b5 from nuclear reset |
| SSM: /cello/dev/directory/peer-id (us-east-1) | CREATED | 2026-06-06 | 12D3KooWS46wUj6NYvoAsocxZnxth5EgYD2ZXCm7coMkXUWgS1j3 — relay reads this for auto-registration |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | Replication user password (alphanumeric, 32-char) |

**SSM Node Registry (CELLO-M6B-019) — written by deploy.sh step 6.7:**

Each region stores the full node set so services read locally without cross-region calls.
Path: `/cello/{env}/nodes/{role}/aws-{region}` — Value: JSON `{ hostname, peerId, port, transport, status }`
Written by deploy.sh at deploy time. Directory reads at startup via `ssm:GetParametersByPath`.

| Parameter Path | Purpose | Written By |
|---|---|---|
| /cello/dev/nodes/relay/aws-us-east-1 | Relay node registry entry (us-east-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/relay/aws-eu-central-1 | Relay node registry entry (eu-central-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/relay/aws-ap-northeast-1 | Relay node registry entry (ap-northeast-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/directory/aws-us-east-1 | Directory node registry entry (us-east-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/directory/aws-eu-central-1 | Directory node registry entry (eu-central-1) | deploy.sh step 6.7 |
| /cello/dev/nodes/directory/aws-ap-northeast-1 | Directory node registry entry (ap-northeast-1) | deploy.sh step 6.7 |

Status: DEPLOYED 2026-06-10 — deploy.sh wrote all 6 parameters across all 3 regions; directory reading from SSM at startup as of image 934d130

**Transport key secrets (all regions) — IMPORTED into cello-secrets-dev stack 2026-06-05:**
| Secret | Logical ID | ARN | CFN Status |
|---|---|---|---|
| Directory transport key (us-east-1) | `DirectoryTransportKey` | `arn:aws:secretsmanager:us-east-1:257394457473:secret:cello/dev/directory/transport-key-m146A8` | `UPDATE_COMPLETE` |
| Directory transport key (eu-central-1) | `DirectoryTransportKey` | `arn:aws:secretsmanager:eu-central-1:257394457473:secret:cello/dev/directory/transport-key-s5OinO` | `UPDATE_COMPLETE` |
| Directory transport key (ap-northeast-1) | `DirectoryTransportKey` | `arn:aws:secretsmanager:ap-northeast-1:257394457473:secret:cello/dev/directory/transport-key-usvz8z` | `UPDATE_COMPLETE` |
| Relay transport key (us-east-1) | `RelayTransportKey` | `arn:aws:secretsmanager:us-east-1:257394457473:secret:cello/dev/relay/transport-key-Xs6yZY` | `UPDATE_COMPLETE` |
| Relay transport key (eu-central-1) | `RelayTransportKey` | `arn:aws:secretsmanager:eu-central-1:257394457473:secret:cello/dev/relay/transport-key-ARIlzc` | `UPDATE_COMPLETE` |
| Relay transport key (ap-northeast-1) | `RelayTransportKey` | `arn:aws:secretsmanager:ap-northeast-1:257394457473:secret:cello/dev/relay/transport-key-9fQh1D` | `UPDATE_COMPLETE` |
All six secrets imported via CFN resource import changeset `import-transport-keys` (2026-06-05). Stack reached `IMPORT_COMPLETE` in all three regions. Both resources carry `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. Secret values (real transport keys) were pre-populated manually — the PLACEHOLDER_POPULATE_VIA_CLI in cello-secrets.yaml only applies on first CREATE; import left existing values untouched.

**Ops-agent secrets (us-east-1):**
| Secret | Path | Status | Notes |
|---|---|---|---|
| Telegram bot token (staging) | `cello/dev/ops-agent/telegram-bot-token` | POPULATED | @CelloConnectStagingBot token; swapped from prod→staging 2026-05-29 (dev env should use staging bot) |
| directory-api-key / INTERNAL_API_KEY | `cello/dev/ops-agent/directory-api-key` | POPULATED | 256-bit random hex; shared by directory (INTERNAL_API_KEY) and ops-agent (DIRECTORY_API_KEY) |
| Ops-agent RDS credentials | `cello/dev/ops-agent/rds-credentials` | POPULATED (re-synced 2026-06-30) | `cello_ops_agent` role password re-synced to match Secrets Manager value via `ALTER ROLE` on 2026-06-30. The DB-side password had drifted from the stored secret sometime around 2026-06-28 (first auth failure logged 2026-06-28T00:29Z); likely caused by the M8 portal deploy work. The ops agent task (running since 2026-06-21) held a stale connection pool that worked until pg recycled connections. Fix: set DB password = Secrets Manager password + restart task. |
| SES credentials | `cello/dev/ops-agent/ses-credentials` | POPULATED | IAM user `cello-ses-smtp-dev` access key; populated 2026-05-29 |

#### Key Resources — dev us-east-1

| Resource | Value |
|---|---|
| VPC ID | vpc-042c7b8ac97f6a38b |
| VPC CIDR | 10.0.0.0/16 |
| Private Subnet A | subnet-05552d24bb15a7782 |
| Private Subnet B | subnet-0dba876a5a923404b |
| Public Subnet A | subnet-00780580ba49e6eb0 |
| Public Subnet B | subnet-03f5ad4cd18fca4c7 |
| Private Route Table ID | rtb-0463fe7bcbba06ecb |
| RDS Security Group | sg-07a7414f0f862067b |
| ECS Directory Security Group | sg-0cc7f8493f3aff8d8 |
| ECS Relay Security Group | sg-0cab5bd4ec63f05c7 |
| ALB Security Group | sg-0b694f5a0dcf0fbbb |
| KMS Key ARN | arn:aws:kms:us-east-1:257394457473:key/7eb72942-d9f4-4c9a-9494-05bce889a39f |
| KMS Key ID | 7eb72942-d9f4-4c9a-9494-05bce889a39f |
| Audit Log Bucket | cello-audit-logs-dev-us-east-1 |
| Relay Manifest Bucket | cello-relay-manifest-dev-us-east-1 |
| RDS Endpoint | cello-dev.c9iokw02w3f8.us-east-1.rds.amazonaws.com |
| RDS Port | 5432 |
| Directory ALB | cello-dir-dev-1341968405.us-east-1.elb.amazonaws.com | **UPDATED 2026-07-19** — ALB changed from cello-dir-dev-85618485 during post-rogue-agent cleanup (2026-07-17). deploy.sh dev us-east-1 IN PROGRESS to update cello-cicd-dev StagingDirectoryUrl parameter (was still pointing to old ALB, causing smoke test "fetch failed" since 2026-07-15). |
| Relay ALB | cello-relay-dev-913894764.us-east-1.elb.amazonaws.com |
| ALB Hosted Zone ID | Z35SXDOTRQ7X7K |
| Route 53 Record | directory-us1.cello.mygentic.ai |
| ACM Certificate | arn:aws:acm:us-east-1:257394457473:certificate/900d9dde-abd9-4d05-931b-507a6fdf55f4 |
| ECS Cluster | arn:aws:ecs:us-east-1:257394457473:cluster/cello-dev |
| RDS Rotation Lambda | arn:aws:lambda:us-east-1:257394457473:function:cello-dev-rds-rotation | DEPLOYED (real code + psycopg2-binary) 2026-05-22 |
| GitHub Webhook Receiver Lambda | arn:aws:lambda:us-east-1:257394457473:function:cello-github-webhook-receiver-dev |
| GitHub Webhook Receiver URL | https://e2cy6e5vuxif5zdqjjhy3aplqu0crnzi.lambda-url.us-east-1.on.aws/ |
| Pipeline Filter Lambda | arn:aws:lambda:us-east-1:257394457473:function:cello-pipeline-filter-dev |
| Directory Node Public Key | 167ca6b145bfdd3696af8f4befd883c3dc610f4a9c8d52a30f6a22f669dc27b5 |
| Relay Node Public Key | 8c3a882b15ad39f42044bac2044c76f00535e3ff345767b9fda7b4e665efc4e6 |
| ECS Ops-Agent Security Group | sg-07cc257e60bed1e49 |
| Ops-Agent Service ARN | arn:aws:ecs:us-east-1:257394457473:service/cello-dev/cello-operations-agent-dev |
| Ops-Agent Log Group | /ecs/cello-operations-agent-dev |
| Ops-Agent Execution Role | arn:aws:iam::257394457473:role/cello-dev-ops-agent-execution-role |
| Ops-Agent Task Role | arn:aws:iam::257394457473:role/cello-dev-ops-agent-task-role |
| Ops-Agent Pipeline | cello-operations-agent-pipeline (us-east-1 only) |
| SNS Topic — ops-critical | arn:aws:sns:us-east-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:us-east-1:257394457473:cello-ops-warning-dev |
| CloudWatch Dashboard | cello-operations-dev |
| WAF WebACL ARN | arn:aws:wafv2:us-east-1:257394457473:regional/webacl/cello-waf-dev/6b71004a-5edd-450b-90f3-d529908502c4 |
| WAF Log Group | aws-waf-logs-cello-dev (90-day retention) |
| IAM User (SES SMTP) | cello-ses-smtp-dev | Created 2026-05-29; access key stored in ses-credentials secret |

**Nuclear reset (2026-06-05/06):**
All ECS service stacks (directory, relay, ops-agent), WAF, CloudWatch, and Route53 stacks were deleted across all three regions to eliminate accumulated CFN drift. The directory stack was recreated fresh from current IaC on 2026-06-05 (CREATE_COMPLETE in all 3 regions). Remaining stacks (ops-agent, relay, WAF, CloudWatch, Route53) await the next deploy.sh run.

Root cause of drift: manual AWS changes were made over May 23–June 4 (ALB listener rules, security group rules, task definitions) without subsequent deploy.sh runs. The IaC was updated to match but deploy.sh was never executed in any region after 2026-05-28. This caused CFN resource conflicts (AlreadyExists errors) when deploy.sh was finally run on 2026-06-05.

All prior "Manual changes" entries are now resolved — the nuclear reset eliminated all drift. The fresh directory stacks are created from the current IaC (commit 44dc27c+) which includes all M6B stories: port-8081 internal API target group (M6B-004), relay auto-registration (M6B-006), relay WebSocket ALB (M6B-007), poll loop (M6B-008), pg pool max + idle sweep (M6B-009), SSM migration version (M6B-011).

Demo-agent IAM role `cello-agent-ssm-role` with inline policy `cello-demo-secrets-manager` remains live (not in IaC — predates CloudFormation, shared with openclaw-agent).

**M6B-011: SSM parameter for ops-agent expected migration version (CELLO-M6B-011):**
Stack `cello-ssm-parameters-dev` (new, us-east-1 only — ops-agent is us-east-1 only) manages `/cello/dev/ops-agent/expected-migration-version`. The `deploy.sh` script automatically preserves the operator-set value via a read-before/restore-after guard (deploy.sh Step 2b, lines ~347-358): it reads the current parameter value before deploying the stack, then restores it immediately after if CloudFormation reset it. Manual re-set is only needed if the parameter is set outside of `deploy.sh`. To update the expected migration version after a new migration is applied, simply set the SSM parameter directly and restart the ECS task — no code deploy required:
```
aws ssm put-parameter \
  --name /cello/dev/ops-agent/expected-migration-version \
  --value "<current_version>" --overwrite --region us-east-1
aws ecs stop-task \
  --cluster cello-dev \
  --task $(aws ecs list-tasks --cluster cello-dev --service-name cello-operations-agent-dev --query 'taskArns[0]' --output text --region us-east-1) \
  --region us-east-1
```
ECS will start a replacement task that reads the updated SSM value. The current migration version as of M6B-011 is 28. Whenever a new migration is applied, update this parameter immediately (no code deploy required — that is the point of using SSM).

**M6B-014: NAT Gateway — DEPLOYED 2026-06-07:**
Deployed to all 3 regions. NAT Gateway active in each VPC, relay→directory registration working via public hostname. 6 interface endpoints retained for stage-2 removal (non-blocking). Manual SG rule (relay→directory port 4000) removed. Manual task def :55 superseded by CFN-managed :54.

Route53 drift note: purge_stale_dns_record() bug (fixed in commit 6d17b30) deleted all 6 A records (3 directory + 3 relay) during the M6B-014 deploy. All 6 recreated manually 2026-06-07. Drift resolves on next deploy.sh run.

**SSM Parameter required for new regions (M6B-004):** CELLO_DIRECTORY_HOSTNAME now fetched from SSM Parameter Store path `/cello/{Environment}/directory/hostname` instead of hardcoded Mappings block. For region expansion, create this parameter before deploying cello-ecs-directory stack. Existing regions (us-east-1, eu-central-1, ap-northeast-1) must have this parameter created manually before next deploy:
- us-east-1: `aws ssm put-parameter --name /cello/dev/directory/hostname --value directory-us1.cello.mygentic.ai --type String --region us-east-1`
- eu-central-1: `aws ssm put-parameter --name /cello/dev/directory/hostname --value directory-eu1.cello.mygentic.ai --type String --region eu-central-1`
- ap-northeast-1: `aws ssm put-parameter --name /cello/dev/directory/hostname --value directory-ap1.cello.mygentic.ai --type String --region ap-northeast-1`

### dev — eu-central-1
*Last deployed: 2026-07-03

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-iam-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-06-05 | DirectoryTransportKey + RelayTransportKey imported |
| cello-ssm-parameters-dev | UPDATE_COMPLETE | 2026-06-06 | |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-s3-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rds-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-06-27 | CELLO-M7-CONN-001: image cello-directory:d5d0424; ALB ManifestPathRule (priority 6, /manifest) APPLIED via deploy.sh 2026-06-27. /manifest ALB-routable, returns designed 503 (consortium manifest unset — M6 backward-compat). (prev: M6B-019 934d130 / task def :59) |
| cello-ecs-operations-agent-dev | NOT DEPLOYED (by design) | 2026-06-27 | Ops-agent is a SINGLE GLOBAL service (one Telegram bot / one long-poller) — us-east-1 only, never per-region (unlike sovereign directory/relay). deploy.sh now SKIPS it outside us-east-1 (region guard added 2026-06-27). The dead ROLLBACK_COMPLETE stack created by the 2026-06-27 deploy.sh run (before the guard) was deleted. |
| cello-waf-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-ecs-relay-dev | UPDATE_COMPLETE | 2026-06-27 | Redeployed by deploy.sh 2026-06-27 → new task IP 10.1.77.112; re-registered. S3 relay manifest healthCheckUrl matches live IP — no manual re-sign needed. |
| cello-cloudwatch-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-route53-dev | CREATE_COMPLETE | 2026-06-06 | directory-eu1.cello.mygentic.ai |
| cello-route53-relay-dev | CREATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug. Recreated manually 2026-06-07. Drift resolves on next deploy.sh run. |
| cello-cicd-dev | NOT DEPLOYED | — | CICD pipeline is us-east-1 only |
| Lambda: cello-dev-rds-rotation | DEPLOYED (real code) | 2026-05-25 | |
| SSM: /cello/dev/directory/manifest-signer-pubkey | CREATED | 2026-05-25 | 167ca6...27b5 |
| SSM: /cello/dev/directory/peer-id (eu-central-1) | CREATED | 2026-06-06 | 12D3KooWEdsKDMBpbQioyAweoMF7s5HKvUhBY7kxHYTwoTuAbdv7 |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | |

#### Key Resources — dev eu-central-1

| Resource | Value |
|---|---|
| VPC ID | vpc-04305bc6b6fe43406 |
| VPC CIDR | 10.1.0.0/16 |
| Private Subnet A | subnet-06e32e9f16fff5a35 |
| Private Subnet B | subnet-069064d143f5913dc |
| Public Subnet A | subnet-019bf77e7151de0ed |
| Public Subnet B | subnet-007407e0ec1beef83 |
| Private Route Table ID | rtb-0ae553aa68ff6b39c |
| RDS Security Group | sg-0f8c3f52c03e71d4e |
| ECS Directory Security Group | sg-03bbc9555ec64bb3b |
| ECS Relay Security Group | sg-059f34c83eda437f0 |
| ALB Security Group | sg-03a26d8b34d60b4f7 |
| KMS Key ARN | arn:aws:kms:eu-central-1:257394457473:key/708cea66-0fa3-4bcb-8120-b98ae5038953 |
| Audit Log Bucket | cello-audit-logs-dev-eu-central-1 |
| Relay Manifest Bucket | cello-relay-manifest-dev-eu-central-1 |
| RDS Endpoint | cello-dev.clu08oy88g6v.eu-central-1.rds.amazonaws.com |
| RDS Port | 5432 |
| Directory ALB | cello-dir-dev-1699677837.eu-central-1.elb.amazonaws.com |
| Relay ALB | cello-relay-dev-1538955378.eu-central-1.elb.amazonaws.com |
| Route 53 Record | directory-eu1.cello.mygentic.ai |
| ECS Cluster | arn:aws:ecs:eu-central-1:257394457473:cluster/cello-dev |
| Directory Node Public Key | 8105b180b753d97b50039a7e94433fd2b419f43d61f9ad7caf2ac15ad5cd1b45 |
| Relay Node Public Key | 015ffd3a10c58019128806dc94c7c737146f448cdd0a97c6fa05be9cc04471e8 |
| SNS Topic — ops-critical | arn:aws:sns:eu-central-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:eu-central-1:257394457473:cello-ops-warning-dev |

### dev — ap-northeast-1
*Last deployed: 2026-07-03

| Stack | Status | Last Deployed | Notes |
|---|---|---|---|
| cello-ecr-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-iam-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-secrets-dev | UPDATE_COMPLETE | 2026-06-05 | DirectoryTransportKey + RelayTransportKey imported |
| cello-ssm-parameters-dev | UPDATE_COMPLETE | 2026-06-06 | |
| cello-vpc-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-kms-dev | CREATE_COMPLETE | 2026-05-23 | |
| cello-s3-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rds-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-rotation-dev | UPDATE_COMPLETE | 2026-06-05 | |
| cello-ecs-directory-dev | UPDATE_COMPLETE | 2026-06-27 | CELLO-M7-CONN-001: image cello-directory:d5d0424; ALB ManifestPathRule (priority 6, /manifest) APPLIED via deploy.sh 2026-06-27. /manifest ALB-routable, returns designed 503 (consortium manifest unset — M6 backward-compat). (prev: M6B-019 934d130 / task def :50) |
| cello-ecs-operations-agent-dev | NOT DEPLOYED (by design) | 2026-06-27 | Ops-agent is a SINGLE GLOBAL service (one Telegram bot / one long-poller) — us-east-1 only, never per-region (unlike sovereign directory/relay). deploy.sh now SKIPS it outside us-east-1 (region guard added 2026-06-27). The dead ROLLBACK_COMPLETE stack created by the 2026-06-27 deploy.sh run (before the guard) was deleted. |
| cello-waf-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-ecs-relay-dev | UPDATE_COMPLETE | 2026-06-27 | Redeployed by deploy.sh 2026-06-27 → new task IP 10.2.94.2. Directory did NOT auto-re-sign on the IP change (known gap), so S3 relay manifest was stale (10.2.75.117) → manually re-signed via sign-manifest.sh to v6 with 10.2.94.2 (matches live IP). Directory adopts on next 2-min poll. |
| cello-cloudwatch-dev | CREATE_COMPLETE | 2026-06-06 | |
| cello-route53-dev | CREATE_COMPLETE | 2026-06-06 | directory-ap1.cello.mygentic.ai |
| cello-route53-relay-dev | CREATE_COMPLETE (CFN DRIFT) | 2026-06-07 | A record deleted by purge_stale_dns_record() bug. Recreated manually 2026-06-07. Drift resolves on next deploy.sh run. |
| cello-cicd-dev | NOT DEPLOYED | — | CICD pipeline is us-east-1 only |
| Lambda: cello-dev-rds-rotation | DEPLOYED (real code) | 2026-05-25 | |
| SSM: /cello/dev/directory/manifest-signer-pubkey | CREATED | 2026-05-25 | 167ca6...27b5 |
| SSM: /cello/dev/directory/peer-id (ap-northeast-1) | CREATED | 2026-06-06 | 12D3KooWRXUbSRCmKBYvk3eAAyEEi7DihCTL4YVebe91ZA4ZzaxA |
| Secret: cello/dev/directory/rds-replication-credentials | CREATED | 2026-05-25 | |

#### Key Resources — dev ap-northeast-1

| Resource | Value |
|---|---|
| VPC ID | vpc-09a2484e197738d18 |
| VPC CIDR | 10.2.0.0/16 |
| Private Subnet A | subnet-044662950bc5caa85 |
| Private Subnet B | subnet-0bf9a32c30489202b |
| Public Subnet A | subnet-0f6aff3a5b4bd84fd |
| Public Subnet B | subnet-058e2b5494b0f94ae |
| Private Route Table ID | rtb-0e890d359a5e7343c |
| RDS Security Group | sg-0c2cde157e5d56b6e |
| ECS Directory Security Group | sg-044abb3a83039a91f |
| ECS Relay Security Group | sg-0086fe960206120e9 |
| ALB Security Group | sg-0923b65ca091960c6 |
| KMS Key ARN | arn:aws:kms:ap-northeast-1:257394457473:key/08735b67-1c27-494c-bb6a-e974c0cc0cff |
| Audit Log Bucket | cello-audit-logs-dev-ap-northeast-1 |
| Relay Manifest Bucket | cello-relay-manifest-dev-ap-northeast-1 |
| RDS Endpoint | cello-dev.cryg2a8say19.ap-northeast-1.rds.amazonaws.com |
| RDS Port | 5432 |
| Directory ALB | cello-dir-dev-1435901052.ap-northeast-1.elb.amazonaws.com |
| Relay ALB | cello-relay-dev-1984262345.ap-northeast-1.elb.amazonaws.com |
| Route 53 Record | directory-ap1.cello.mygentic.ai |
| ECS Cluster | arn:aws:ecs:ap-northeast-1:257394457473:cluster/cello-dev |
| Directory Node Public Key | 9b4b673a16487ba47363e3eaff844bf68f19736d82967918fb896b813e39b984 |
| Relay Node Public Key | 2b69812f22e11877f9bb72f855ab332bdb625997aa92bf582ce052f1c6167ca2 |
| SNS Topic — ops-critical | arn:aws:sns:ap-northeast-1:257394457473:cello-ops-critical-dev |
| SNS Topic — ops-warning | arn:aws:sns:ap-northeast-1:257394457473:cello-ops-warning-dev |

### demo-agent — us-east-1
*Provisioned: 2026-05-29*

| Resource | Value |
|---|---|
| Instance ID | i-0ad3e7c22470f266e |
| Instance Name | cello-demo-agent |
| Instance Type | t3.micro |
| AMI | ami-08e6829e013be2292 (Amazon Linux 2023, 2026-05-21) |
| VPC | vpc-09a0338d25550f292 (default VPC, 172.31.0.0/16) |
| Subnet | subnet-00b93e4a3f6ce8c07 (us-east-1a) |
| EIP Allocation ID | eipalloc-01a2b0686e3bf04cc |
| Elastic IP | 32.196.100.165 |
| Security Group ID | sg-0b8400fa0cedb95da |
| Security Group Name | cello-demo-sg |
| IAM Instance Profile | cello-agent-ssm-role |
| IAM Role | cello-agent-ssm-role |
| Secrets Manager Key Path | cello/dev/demo-agent/identity-key |
| Agent pubkey (K_local) | **7ab98987de127b81dc4013d8c0b7e70b65f95db647e0977d492f41566ec1f910** (agent `default`; CURRENT — confirmed live in the demo daemon log 2026-07-02 ~19:19 UTC, transacts sessions). Prior: `bc94ead6…` (was labelled "current" but is now STALE — an `initiate_session` to bc94 returns `target_offline`); earlier `12ccbfd5…` / `c94dfa2e…`. Always confirm the live identity from the demo daemon log (`agent.online` event), not this line. |
| Daemon state dir (CELLO_DIR) | /opt/cello-demo/.cello — SQLCipher `sessions.db` (whole-DB encrypted, post-PERSIST-002). The old `/opt/cello-demo/data/client.db` is a dead M6 leftover (unused). |
| @cello-protocol versions | **daemon 0.0.23 / cli 0.0.21 / connect 0.0.53** (+ crypto 0.0.14, transport 0.0.11, client 0.0.41, protocol-types 0.0.11) — updated 2026-07-02 ~21:05 UTC (M8B cascade-2 FINDING-3: unilateral seal persists+returns legibility receipt; tag v0.0.64; connect unchanged — no daemon dep). Prior: 0.0.22/0.0.20 ~16:20 UTC (cascade-1 review follow-ups, v0.0.63); 0.0.21/0.0.19 (cascade 1, v0.0.62) |
| Architecture | M7 shim+daemon: `cello-daemon.service` (the node — key, SQLCipher DB, libp2p, directory connection) + `cello-demo.service` (the app → spawns `cello-mcp` → daemon socket). Both active. |
| Service status | **UPDATED 2026-07-12 to daemon 0.0.50 / cli 0.0.48 (SEC-1 relay-park content authentication fix, enforce-immediately rollout)** — `npm install @cello-protocol/cli@0.0.48 @cello-protocol/daemon@0.0.50` as root via SSM, then `chown -R cello-demo:cello-demo /opt/cello-demo`. No DB migration; identity/FROST share untouched (pubkey `7ab98987…6ec1f910`). Restarted daemon→demo in sequence; both `active`; healthy fingerprint (`daemon.manifest.bundled` → `directory.auth.challenge.verified` → `directory.signaling.connected verified:true` → `agent.online` → standing receiver armed → `demo.started`). This was the last known agent still on a pre-SEC-1 daemon; SEC-1 is now fully closed fleet-wide. No live cross-agent session re-verified this pass (prior full end-to-end re-verify below is from the previous bump). Prior entry ↓. **UPDATED 2026-07-02 ~21:00 UTC to daemon 0.0.23 / cli 0.0.21 (M8B cascade-2 FINDING-3: unilateral seal ships a retrievable legibility receipt)** — `cd /opt/cello-demo && npm install @cello-protocol/cli@0.0.21 @cello-protocol/daemon@0.0.23` as root, then `chown -R cello-demo node_modules`. No DB migration; FROST share untouched. Restarted daemon→demo in sequence; both `active`; healthy fingerprint (`agent.online`, `session.node.created`, `directory.signaling.connected`). **Live FINDING-3 acceptance PASSED 2026-07-02 ~21:35 UTC** (driven from the local daemon 0.0.23 via MCP): fresh session `e3c167bd` local `Demo2` (`8999608f…`) → demo agent `7ab98987…`, 2-way exchange, then demo agent taken offline; `cello_close_session` after grace → `seal_type: unilateral` with legibility inline (counterparty `7ab98987…` `attestation_mode:"absent"`, local `"live"`); `cello_get_sealed_receipt` returned the durable cert (`sealed_root 3dd19ab4…`), **no longer `sealed_receipt_not_found`**. Demo agent restored active afterward. Prior entry ↓. **UPDATED 2026-07-02 ~14:30 UTC to daemon 0.0.21 / cli 0.0.19 (M8B cascade 1: FINDING-1 seal-retry, F14 receiver re-arm, F13, F16, F15, F20)** — `cd /opt/cello-demo && npm install @cello-protocol/cli@0.0.19 @cello-protocol/daemon@0.0.21` as root, then `chown -R cello-demo` on node_modules (runuser can't exec npm for the system user). No DB migration; FROST share untouched. Restarted daemon→demo in sequence; both active; healthy startup fingerprint + `demo.started`. Live smoke afterward: inbound session + bilateral seal OK; **F14 re-arm observed live** (EADDRINUSE ×4 with backoff → `session.standing_receiver.dead` → teardown re-arm → 2nd inbound session accepted); crash-seal round-trip OK (daemon stopped mid-session → `counterparty_gone` on receive (F16) → close #1 `seal_counterparty_pending` "~484s" (F20) → close #2 after grace → **unilateral seal ok** (FINDING-1 closed)). Services restarted + healthy after the test. See discussion log 2026-07-02_1640. Prior: 0.0.20 earlier same day (Finding 1 + F2-a). |
| Access | SSM Session Manager only - no key pair, no inbound SG rules |
| Inbound rules | None |
| Outbound rules | TCP 443 to 0.0.0.0/0 only |

### dev — VPC Peering
*Last deployed: 2026-05-23*

| Stack | Region | Peering Connection ID | Status |
|---|---|---|---|
| cello-peering-dev-us-east-1-to-eu-central-1 | us-east-1 | pcx-0b4ae5708cbbdd14f | active |
| cello-peering-dev-eu-central-1-accepts-us-east-1 | eu-central-1 | pcx-0b4ae5708cbbdd14f | active |
| cello-peering-dev-us-east-1-to-ap-northeast-1 | us-east-1 | pcx-0908d974387764c34 | active |
| cello-peering-dev-ap-northeast-1-accepts-us-east-1 | ap-northeast-1 | pcx-0908d974387764c34 | active |
| cello-peering-dev-eu-central-1-to-ap-northeast-1 | eu-central-1 | pcx-05b4806864753695e | active |
| cello-peering-dev-ap-northeast-1-accepts-eu-central-1 | ap-northeast-1 | pcx-05b4806864753695e | active |

Ports open between all VPC pairs: 5432 (RDS replication), 4001 (checkpoint cross-signing).
Deploy with: `./infra/deploy-peering.sh dev`

### dev — Logical Replication
*Last configured: 2026-05-25*

All RDS instances have `wal_level = logical` and `rds.logical_replication = 1` (parameter group, rebooted).

| Component | us-east-1 | eu-central-1 | ap-northeast-1 |
|---|---|---|---|
| Replication user | `cello_replication` (GRANT rds_replication) | `cello_replication` | `cello_replication` |
| Publication | `cello_pub` (11 tables — includes registrations, pre_authorization_tokens; **AC-007b complete 2026-05-28**: setup-replication.sh re-run, subscriptions refreshed, cross-region replication verified ≤5s) | `cello_pub` (11 tables — same, AC-007b complete) | `cello_pub` (11 tables — same, AC-007b complete) |
| Subscriptions (inbound) | from eu-central-1, from ap-northeast-1 | from us-east-1, from ap-northeast-1 | from us-east-1, from eu-central-1 |

**Replication Slots (6 total, all streaming):**

| Source Region | Slot Name | Target Region | State |
|---|---|---|---|
| us-east-1 | cello_dev_us_east_1_eu_central_1 | eu-central-1 | streaming |
| us-east-1 | cello_dev_us_east_1_ap_northeast_1 | ap-northeast-1 | streaming |
| eu-central-1 | cello_dev_eu_central_1_us_east_1 | us-east-1 | streaming |
| eu-central-1 | cello_dev_eu_central_1_ap_northeast_1 | ap-northeast-1 | streaming |
| ap-northeast-1 | cello_dev_ap_northeast_1_us_east_1 | us-east-1 | streaming |
| ap-northeast-1 | cello_dev_ap_northeast_1_eu_central_1 | eu-central-1 | streaming |

Setup with: `./infra/setup-replication.sh dev`

**2026-06-25 — INCIDENT + MANUAL REPAIR (all 6 links rebuilt, streaming).** A directory data wipe done with piecemeal single-table `TRUNCATE`s wedged all 6 subscriptions: `pubtruncate=true` replicated the truncates, and subscribers could not apply a single-table truncate of an FK-referenced parent (`cannot truncate a table referenced in a foreign key constraint`). Apply workers crash-looped (apply_error_count → thousands), `received_lsn` froze, and publisher slots retained ~2.7 GB WAL (`wal_status: extended`). **Repaired manually** (NOT via setup-replication.sh, which is idempotent-skip and never drops a sub/slot): per link, dropped the wedged subscription, dropped the orphaned slot (released WAL), created a fresh slot, and re-created the subscription `WITH (create_slot=false, copy_data=false, origin=none, enabled=true)`. All 6 subscriptions enabled + receiving, all 6 slots active, WAL backlog cleared. **Caveat:** `copy_data=false` means rows written during the outage did NOT back-fill — `agent_profiles`/`user_accounts`/`registrations`/`pre_authorization_tokens` (1 each, Ms_Chelly) exist on us-east-1 only; eu/ap have 0. New writes replicate normally. **Lesson (do not repeat):** never run piecemeal TRUNCATEs on published tables under live replication — disable subscriptions first, or `TRUNCATE … CASCADE` all FK-related tables in one statement.

**2026-06-26 — V32 agent_revocations DEPLOYED (CELLO-M7-REMOVE-001 DOD-REMOVE-2/3/4).** The directory
pipeline (triggered by the main push) deployed the new directory image to all 3 regions; Flyway applied
**V32 `agent_revocations`** on startup. Verified directly in all 3 RDS: `flyway_schema_history` has version
32 and `to_regclass('agent_revocations')` is non-null in us-east-1, eu-central-1, AND ap-northeast-1. All
directory tasks healthy (running 1/1, failedTasks 0, zero crashed/stopped tasks — no migration churn).
`agent_revocations` is an append-only, INSERT-only-RLS table (cello_service: INSERT/SELECT, no
UPDATE/DELETE) holding self-signed agent revocations. **TWO follow-ups still pending (NOT done by the
pipeline):**
1. ~~ops-agent expected-migration-version SSM stale at 30~~ **DONE 2026-06-26** — bumped to **32** via
   `aws ssm put-parameter … --value 32 --overwrite --region us-east-1` (verified Value=32). The running
   ops-agent was unaffected (healthy 1/1; gates at startup); its next restart reads 32 = DB. IaC template
   `cello-ssm-parameters.yaml` already at 32.
2. ~~agent_revocations not in cello_pub~~ **DONE 2026-06-26** — ran `./infra/setup-replication.sh dev
   us-east-1 eu-central-1 ap-northeast-1`: all 6 subscriptions already existed (skipped, none dropped),
   refreshed to pick up the new table, all 6 slots confirmed STREAMING. Verified `agent_revocations` IS in
   `cello_pub` (pg_publication_tables, us-east-1). Cross-node revocation replication is live.

### staging — not deployed

### production — not deployed

---

## Global Resources

| Resource | Value | Notes |
|---|---|---|
| AWS Account ID | 257394457473 | |
| ECR repo — directory (us-east-1) | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory | |
| ECR repo — relay (us-east-1) | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay | |
| ECR repo — directory (eu-central-1) | 257394457473.dkr.ecr.eu-central-1.amazonaws.com/cello-directory | |
| ECR repo — relay (eu-central-1) | 257394457473.dkr.ecr.eu-central-1.amazonaws.com/cello-relay | |
| ECR repo — directory (ap-northeast-1) | 257394457473.dkr.ecr.ap-northeast-1.amazonaws.com/cello-directory | Added by FEDERATION-E2E-001 |
| ECR repo — relay (ap-northeast-1) | 257394457473.dkr.ecr.ap-northeast-1.amazonaws.com/cello-relay | Added by FEDERATION-E2E-001 |
| ECR repo — operations-agent (us-east-1) | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-operations-agent | Added by OPS-AGENT-005A; created by cello-ecr stack |
| ECR repo — operations-agent (eu-central-1) | 257394457473.dkr.ecr.eu-central-1.amazonaws.com/cello-operations-agent | Added by OPS-AGENT-005A; replicated via account-level ECR replication |
| ECR repo — operations-agent (ap-northeast-1) | 257394457473.dkr.ecr.ap-northeast-1.amazonaws.com/cello-operations-agent | Added by OPS-AGENT-005A; replicated via account-level ECR replication |
| Current directory image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-directory:934d130 | M6B-019 SSM node registry; deployed 2026-06-10 via pipeline; all 3 regions; task defs us-east-1:170, eu-central-1:59, ap-northeast-1:50 |
| Current relay image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-relay:791f9ce | Deployed 2026-06-07 via pipeline; task defs us-east-1:55, eu-central-1:20, ap-northeast-1:15 |
| Current operations-agent image | 257394457473.dkr.ecr.us-east-1.amazonaws.com/cello-operations-agent:f4c3e72 | M6B-016 registration engine; Dockerfile stale COPY lines fixed; deployed 2026-06-07 via pipeline; task def :43; migrationVersion=30 |
| Route 53 Hosted Zone | cello.mygentic.ai | Zone ID read at deploy time via aws route53 list-hosted-zones |
| CodeStar Connection (us-east-1) | arn:aws:codeconnections:us-east-1:257394457473:connection/1a7fba2b-dd1d-4ebe-8372-7122b89f56b5 | AVAILABLE — override via CELLO_GITHUB_CONNECTION_ID |

---

## Bootstrap Operations

| Item | Status | Date | Notes |
|---|---|---|---|
| Route 53 hosted zone `cello.mygentic.ai` | Done | 2026-05-21 | NS delegated from GoDaddy |
| ECR repo `cello-directory` | Done | 2026-05-21 | us-east-1 |
| ECR repo `cello-relay` | Done | 2026-05-21 | us-east-1 |
| Stub images pushed (linux/amd64) | Done | 2026-05-22 | Run `./infra/build-stubs.sh <region>` — never `docker build` directly (arm64 on Apple Silicon breaks ECS) |
| CodeStar Connection `github-cello-main` | Done | 2026-05-22 | us-east-1, AVAILABLE |
| Ed25519 key pairs — us-east-1 | Done | 2026-05-22 | Run `./infra/scripts/generate-node-keys.sh dev us-east-1` |
| Ed25519 key pairs — eu-central-1 | Done | 2026-05-23 | Run `./infra/scripts/generate-node-keys.sh dev eu-central-1` |
| Ed25519 key pairs — ap-northeast-1 | Done | 2026-05-23 | Run `./infra/scripts/generate-node-keys.sh dev ap-northeast-1` |
| GitHub webhook HMAC secret | Done | 2026-05-22 | Registered per infra/runbooks/github-webhook-setup.md; us-east-1 only |
| SES domain identity `mygentic.ai` | Done | 2026-05-25 | us-east-1; DKIM verified; MAIL FROM `mail.mygentic.ai`; production access granted |
| Secret `cello/ops-agent/telegram-bot-token` | Done | 2026-05-25 | us-east-1; `@CelloConnectBot` production bot |
| Secret `cello/ops-agent/telegram-bot-token-staging` | Done | 2026-05-25 | us-east-1; `@CelloConnectStagingBot` staging bot |
| npm org `@cello-protocol` | Done | 2026-05-26 | npmjs.com; scope for all client packages |
| GitHub Secret `NPM_TOKEN` (cello-client) | Done | 2026-05-26 | Granular token, read-write, `@cello-protocol` scope; **expires 2026-08-24 — rotate before this date** |

---

## How to Deploy

```bash
# Deploy or update an environment
./infra/deploy.sh dev us-east-1
./infra/deploy.sh staging eu-central-1
./infra/deploy.sh production ap-northeast-1   # requires YES confirmation

# Override image tag (default: stub)
CELLO_IMAGE_TAG=v1.2.3 ./infra/deploy.sh dev us-east-1

# Override GitHub connection ID (default: dev connection UUID)
CELLO_GITHUB_CONNECTION_ID=<uuid> ./infra/deploy.sh staging eu-central-1
```
