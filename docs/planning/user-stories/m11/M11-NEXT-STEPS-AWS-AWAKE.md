---
name: M11 next steps — the AWS half, in order
type: plan
date: 2026-07-25
topics: [m11, waitlist, deployment, aws]
status: active
description: The ordered list of AWS-dependent steps that convert M11's 🟡 lines to ✅, written while infra was hibernated so none of it could be run.
---

# M11 — what to run now that infra is awake

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
