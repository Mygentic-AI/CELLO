---
name: M11 next steps — the AWS half, in order
type: plan
date: 2026-07-25
topics: [m11, waitlist, deployment, aws]
status: active
description: The ordered list of AWS-dependent steps that convert M11's 🟡 lines to ✅, written while infra was hibernated so none of it could be run.
---

# M11 — what to run now that infra is awake

> ## ⚠️ 2026-07-28 — DO THIS FIRST, AND IN THIS ORDER
>
> The core capture loop was **broken at the check, not at the mint**, and is fixed in code only.
> API Gateway payload format 2.0 delivers request cookies in a top-level `cookies` list, not in
> `headers`; `cookie_from()` read the header, so `/auth/session` 401'd every signed-in user and
> `/status` bounced them to `/auth`. Both doors led back to the sign-in form. Nothing below has run
> against the deployed API.
>
> **1. Trace before trusting.** Sign up a simulator address, drain the email queue, then follow one
> real token with `curl -i` — capture the `Set-Cookie` and the `Location`, then call
> `/waitlist/auth/session` with that cookie and read the CORS headers. Three fixes shipped on
> untraced hypotheses before this one; do not add a fourth.
>
> **2. `./infra/deploy.sh`** — `cello-waitlist.yaml` gained `POST /waitlist/auth/resend`. Without it
> the one button on every dead-link page 404s. (Note the standing blocker below: deploy.sh exits on
> `cello-ecs-directory-dev`. The waitlist stack can be deployed directly, as it was on 07-25.)
>
> **3. Deploy the Lambdas** — `./infra/deploy-lambdas.sh dev`. Shared `_resend.py` and `_referral.py`
> are new; auth, signup, actions and gallery all changed.
>
> **4. ONLY THEN push corp-cello-site.** Commits `63fe0d4` and `81518b3` are deliberately UNPUSHED.
> The page now expects `sent` and `returning` from `POST /waitlist/signup`; against the old endpoint a
> repeat address still returns 409 and would surface as a red error instead of a screen. Pushing
> `main` there auto-deploys the live site, so the order is not advisory.
>
> **5. While you are in the Lambda console:** set `PORTAL_DB_SECRET_ID` on all 13 waitlist functions
> and deploy the ops dashboard, so the next RDS rotation does not repeat 2026-07-26. The URL must keep
> `?sslmode=no-verify`.
>
> **6. `operations.cello.mygentic.ai` needs one redeploy after every wake** — its host rule and SNI
> cert live on the portal ALB, which hibernate deletes.
>
> Full account: `discussion_logs/2026-07-27_2030_waitlist-auth-flow-design-and-death-loop.md` and the
> 2026-07-27 journal entry.


> **STATUS 2026-07-25 07:40 UTC — §0 through §4 are DONE.** SES production access confirmed, the stack
> deployed, all 12 function bodies plus a 13th (migrate) shipped, all 22 migrations applied, a real
> signup and a real send completed, and the bounce path proven end to end. What remains is §5 (ops
> dashboard deploy), §6 (gallery subdomain, then the receipt footer), §7 (live end-to-end), and
> everything past the confirmation click — all of which need either an outward action or a real inbox.
> The detail below is left intact because the reasoning still applies to staging and production.
>
> **One blocker found on the way:** `deploy.sh` cannot complete — it exits on `cello-ecs-directory-dev`,
> which has failed identically since at least 2026-07-16 (ALB drift across hibernate/wake). The waitlist
> stack was deployed directly with the parameters STEP 15 computes. Anything else ordered after directory
> in `deploy.sh` is currently unshippable in dev. See
> [[2026-07-25_0545_directory-stack-undeployable-alb-drift]].

Every M11 DoD line is built. 56 of them sit at 🟡 BUILT/UNVERIFIED-LIVE, which means the code exists and
its enforcer needs AWS. This is that list, in dependency order, with the reason each step comes where it
does.

**None of this was runnable while it was written** (infra hibernated 2026-07-24 evening → 2026-07-25
04:58 UTC). It is written down precisely so the next person does not have to re-derive the order from
forty-nine journal entries.

---

## 0. Before anything — two prerequisites that are NOT code

**SES production access.** `DOD-SES-PROD-1` and `DOD-EMAIL-INFRA-1` both hang on this, and it is the one
item nobody can answer by reading the repo: whether the account is out of the SES sandbox. In the
sandbox, mail only reaches verified addresses, so every email enforcer below will appear to work in
testing and silently fail for real users.

```bash
aws sesv2 get-account --region us-east-1 --query 'ProductionAccessEnabled'
```

If `false`, request production access before anything in §3. This gates six lines.

**A Route53 hosted zone that is not PLACEHOLDER.** `deploy.sh` substitutes `PLACEHOLDER` when the zone
lookup fails and continues. The waitlist step now refuses on that value (it became load-bearing when the
ACM certificate moved inside the stack), but check it first rather than discovering it mid-deploy.

---

## 1. Deploy the waitlist stack — `cello-waitlist.yaml`

```bash
./infra/deploy.sh dev us-east-1
```

`STEP 15` is us-east-1-only and non-fatal by design; its outcome is printed in the closing summary next
to the stack list, so read that line rather than assuming a green banner covers it.

**Expect the first run to be slow.** The stack creates a DNS-validated ACM certificate for
`api.cello.mygentic.ai` and blocks until ACM issues. This is deliberate — the previous design looked the
certificate up and skipped the stack forever when it found nothing.

**What to verify after, before moving on:**

- The Lambdas are attached to the PORTAL database, not the directory's. This is the one that got shipped
  wrong (Entry 40) and it fails as `42P01 undefined_table`, an error that points at the migration
  subsystem rather than at the connection.
  ```bash
  aws lambda get-function-configuration --function-name cello-waitlist-signup-dev \
    --region us-east-1 --query 'Environment.Variables.DATABASE_URL'
  # MUST contain portal_admin@ … /cello_portal — NEVER postgres@ … /cello_dev
  ```
- `api.cello.mygentic.ai` resolves and serves. Until it does, the SameSite=Lax session cookie cannot
  attach and `/status` will loop against `/auth` forever.

## 2. Deploy the function CODE — CloudFormation ships placeholders

The template's `ZipFile` bodies deliberately `raise NotImplementedError`, so a half-deployed stack cannot
look healthy.

```bash
./infra/deploy-lambdas.sh dev waitlist
```

Requires Docker (psycopg2-binary for linux/amd64). The packaging asserts every local import landed in the
zip and names anything missing.

## 3. Apply the migrations to the portal RDS

`corp-cello-site/migrations/0001` … `0021`, via `scripts/migrate.js`, which keeps a checksum ledger and
fails loudly on an edited applied migration.

**This is the "migration deployed" half of the schema enforcer** — the half that could not run locally.
`0012` is the one to watch: it failed on the first database that held real data, which is exactly the
condition that only exists here.

Converts: `DOD-SCHEMA-1` and the eight lines whose owed item reads "portal RDS (M11-D22)".

## 4. Run the email enforcer — a real SES send

With §0, §1, §2, §3 done, sign up a real address end to end and confirm E1 arrives, the verify link lands
on `/status`, and the session cookie sticks.

Converts: `DOD-E1-1`, `DOD-EMAIL-INFRA-1`, `DOD-AUTH-1`, `DOD-STATUS-PAGE-1`.

**Then the bounce path**, which has never been exercised: send to an SES simulator address
(`bounce@simulator.amazonses.com`, `complaint@simulator.amazonses.com`) and confirm `email_status`
changes. The configuration set is what makes this work at all — SES emits no events to the topic for mail
sent without it, and the dispatcher now refuses to send without one for exactly that reason.

## 5. Deploy the ops dashboard

Repo: `/Users/andrep/Documents/code/ops-dashboard` — **local only, no GitHub remote**. Creating one is an
outward action and was deliberately left to Andre.

Two constraints the code imposes, neither checkable locally (both in its README):

- **A persistent Node process, not Lambda.** The sign-in link is sent fire-and-forget, which is the
  no-enumeration property; on a serverless runtime the response returns and the container can freeze
  before SES is invoked, so links would silently never send.
- **`OPS_PUBLIC_URL` at BUILD time.** `config.ts` validates at module load, so `next build` and any
  Docker build fail without it.

Also needs the Secrets Manager key `cello/ops/allowed-emails` (JSON array) — the dashboard's only access
control, and it fails closed in every direction, so an absent secret admits nobody.

Converts: the six `DOD-OPS-*` lines, and `DOD-INV-WAVE-GATE` from 🟠, since until it runs nothing but IAM
restricts who invokes the wave function.

## 6. The gallery subdomain, then the receipt footer — in that order

`gallery.cello.mygentic.ai` needs a DNS record and a site deploy; the nginx server block already exists in
`corp-cello-site/deploy/cello-site.conf`.

**Only after it serves a real receipt** should the cello-client sealed-receipt footer be built (Entry 47).
Shipping it first makes every sealed session advertise a URL that 404s, on a product whose entire claim is
verifiability.

## 7. Live end-to-end

Two agents connect, exchange messages, seal. Converts `DOD-FIRST-WIN-1` — which still needs its call site
written, since the seal event originates in the operator's daemon and that daemon holds no AWS
credentials. The function is deployed with **no invoker** and its CFN Description says so.

---

## What is NOT on this list, and why

- **`corp-cello-site` main is never pushed** — it auto-deploys the live public site. All M11 site work is
  on branch `m11/review-fixes`.
- **The `latest` npm dist-tag** is Andre's, always.
- **A cello-client publish** is only needed for §6's footer, and nothing else in M11 touches that repo.

## Known gaps, stated rather than hidden

- **E-re mails a daily visitor.** "No activity" means no points and no sign-in; nothing writes a
  touchpoint after signup, so page views cannot count. Closing it needs a post-signup pageview writer
  (Entry 48).
- **A rotated RDS master password stales all twelve Lambdas** until `deploy.sh` runs again (M11-D28). The
  reversal condition is a second IAM principal *or* the first observed rotation — whichever comes first.
- **`status_notes` has two `kind` values with no producer** (`wave_admitted`, `first_win`) and no
  `dismissed_at` writer. The reader handles all of it; the producers are simply not written yet.


---

## Appendix — two things that will look like failures and are not

**`aws sesv2 get-account` reports `SentLast24Hours: 0.0` after successful sends.** It lags and does not
move promptly for simulator traffic. Do not read it as "nothing was sent". The reliable evidence is
`aws ses get-send-statistics`, whose 15-minute datapoints did show `Bounces: 1` matching the simulator
test — and, more conclusively, the bounce Lambda logging `waitlist.email.suppressed` against the exact
`waitlist_id` that signed up. That chain is impossible unless SES really sent.

**The dispatcher can return `{"sent": 0, "failed": 0}` while a job appears to be waiting.** A job that
failed earlier goes back with `attempts` incremented and is not re-claimed immediately. Enqueue a fresh
one (sign up again) rather than concluding the drain is broken.


---

# WHO IS BLOCKED ON WHAT (2026-07-25, after the live deploy)

The backend is deployed and proven. Almost everything still 🟡 is waiting on one of three
**outward actions only Andre can take** — not on further work. Written down because several DoD
lines named the wrong blocker, which made them look like agent work when they were not.

## A. ~~Waiting on the corp-cello-site deploy~~ — DONE (2026-07-25)

Andre gave the go-ahead mid-session. `m11/review-fixes` fast-forwarded onto `main` (clean, 35
commits, no divergence), the Deploy Corp Site workflow succeeded, and the Lightsail rsync landed.

Verified on the live site, not on the branch: `/waitlist`, `/status`, `/survey`, `/invite`,
`/confirm` and `/gallery` all serve 200, and the served JS chunk contains
`https://api.cello.mygentic.ai/waitlist` — so the deployed page targets the deployed API rather than
a stale host.

`DOD-LANDING-1` · `DOD-TRACKING-1` · `DOD-SIGNUP-1` · `DOD-AUTH-1` · `DOD-STATUS-PAGE-1` ·
`DOD-SURVEY-1` · `DOD-READINESS-1` · `DOD-CONTENT-ALERTS-1` · `DOD-DYNAMIC-ESTIMATOR-1` ·
`DOD-STATUS-STUB-1` · `DOD-GALLERY-INDEX-1` are no longer blocked on a deploy.

**What each still owes is a BROWSER run**, which is a different thing and must not be waved through:
the API half is proven with curl, but curl does not execute JavaScript, so the client-side halves —
localStorage touchpoints, the `ref` extraction, the session cookie round-trip, the copy buttons —
have never once run in a browser. Do not mark these ✅ on the strength of a 200.

## B. Waiting on the ops-dashboard existing somewhere

The repo is local-only — **creating its GitHub remote is an outward action** — and it then needs a
container deploy. One constraint is in its README and still holds: it needs a persistent Node
process, because the fire-and-forget sign-in send IS the no-enumeration property and a frozen
serverless container would never send.

**The second constraint is gone (2026-07-25).** The README said it needed `OPS_PUBLIC_URL` at
*build* time. That was not a constraint, it was a defect: `config.ts` and `db.ts` threw at module
load, `next build` imports every route module, and so **the dashboard did not build at all** — 53
tests passed and the thing had never once been built. Build and boot are now separate: the values
stand in during a build, and `src/instrumentation.ts` refuses at server start (verified on the
image — no env exits 1, env set serves `/sign-in` 200).

**What now exists:** a Dockerfile (built and run), `infra/cloudformation/cello-ops-dashboard.yaml`
and a `DEPLOY_OPS_DASHBOARD=1` step in deploy.sh covering ECR, cert, a host rule on the existing
portal ALB, its own security group, the DB ingress rule, the service and DNS. Validated, imports
checked against the live account, **deployed: no.**

**Strict order, and only the first step is Andre's:**
1. Create the GitHub remote and push. *(outward — Andre)*
2. Add a pipeline (source → CodeBuild → ECR push). Cannot be written blind: it needs the repo's
   real owner/name.
3. Let CodeBuild push an image. Nothing may push from a laptop.
4. `DEPLOY_OPS_DASHBOARD=1 IMAGE_TAG=<sha> ./infra/deploy.sh dev`. Before an image exists this
   crash-loops and rolls back.

`DOD-OPS-SHELL-1` · `DOD-OPS-POST-REVIEW-1` · `DOD-OPS-WAVE-MGMT-1` · `DOD-OPS-FEEDBACK-1` ·
`DOD-OPS-CONTENT-ALERT-1` · `DOD-OPS-TELEGRAM-1` · `DOD-OPS-UTM-1` · `DOD-INV-WAVE-GATE`

**This also blocks agent verification**, which is worth knowing: the ops dashboard is the sanctioned
read path to the portal database. Without it, `DOD-INV-TOKEN-SINGLE-USE` and `DOD-INV-POINTS-CAPS`
cannot be proven live, because both need a verified user and a token that only a database read can
produce. Their code and local proofs are done.

## C. Other outward actions

- `gallery.cello.mygentic.ai` DNS record — the nginx block already exists. Blocks `DOD-GALLERY-1`,
  and **must land before** the cello-client receipt footer (Entry 47), or every sealed session
  advertises a 404.
- Google Search Console verification + the GA4 script — `DOD-BLOG-INFRA-1`.
- Submitting the openclaw skill to the directory — `DOD-OPENCLAW-SKILL-1`.

## D. Genuinely still work

- **One fork, three faces** — `DOD-FIRST-WIN-1`'s missing invoker, `waitlist_agent_links`' missing
  writer (`DOD-TELEGRAM-GATE-1` clause 4, now marked PARTIAL) and `DOD-FEEDBACK-DETECTION-1`'s
  missing telemetry writer are the same gap: a fact that originates on the operator's machine, a
  daemon holding no AWS credentials, and no path between them. Parked as ONE fork in the DoD with
  its options, so it gets one decision instead of three. Not an agent's call overnight — one option
  needs a ruling on `DOD-INV-NO-DIRECTORY-RELAY`, the other adds a public authenticated surface to
  the trust layer.
- **The legacy confirm link is broken in production** — `/beta/apply` and `/agent/interest` mail a
  link that 404s, and the page reports a valid token as invalid. Retire the funnel or route it under
  the custom domain; that is a product call. Parked in the DoD with the evidence.
- `DOD-FEEDBACK-OUTREACH-1` — the `CELLO_FEEDBACK` agent's provisioning half. Its session-initiation
  half depends on the fork above.
- `DOD-E-INV-1` / `DOD-E-WIN-1` / `DOD-E-RE-1` — need a real SES send, which needs a job row, which
  needs the database write path, which is (B).

## E. Done since this document was written (2026-07-25)

- **The Telegram gate is LIVE.** `cello-operations-agent-dev` runs it; the gate Lambda is verified
  by direct invoke on three refusal paths; IAM confirmed on the live role. Reviewed twice — the
  first pass found the feature had shipped **dead** (no deserializer case, 13 tests passing over a
  faked repository), the second found the attempt bound charging users for our own outages.
- **`DOD-INV-DOMAIN`'s scan** covered only the directories M11 touched while the clause says "all
  repos"; it now scans the corp site entire, which is how the broken confirm link surfaced.
