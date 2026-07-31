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
| C | *unclaimed* | | |
| D | *unclaimed* | | |
| E | *unclaimed* | | |

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
- **Waitlist tables: ZERO.** None of `waitlist_signups`, `email_jobs`, `auth_tokens`, `points_ledger`,
  `waitlist_sessions`, `gallery_items`, `social_profiles` exist. The 26 waitlist migrations have not
  been applied. **This is phase 1 of your work.**

**Two things that make phase 1 easier than it looks:**

1. **The shared ledger is clean here.** On AWS `schema_migrations` held 41 rows (26 waitlist + 11
   portal + 4 orphans from renamed/removed migrations). On GCP it holds exactly the 11 portal rows,
   so applying the waitlist set lands a clean 37 — **the orphan-reconciliation item resolves itself
   by not being carried over.** Nothing to reconcile.
2. **Both migration sets start at `0001` and that is fine.** Portal has `0001_init`, waitlist has
   `0001_m11_waitlist_p0`. The ledger keys on the full stem, not the number — proven on AWS where
   both sets coexisted in one table. Do not renumber anything.

**Access note:** the portal Cloud SQL has a public IP with `authorized_networks` deliberately EMPTY,
and `ssl_mode = ENCRYPTED_ONLY`. `gcloud sql connect` will allowlist your IP to let you in — **it does
not remove it afterwards.** Clear it when you are done:
`gcloud sql instances patch cello-portal --clear-authorized-networks --quiet`.

Phases, in dependency order:
1. Waitlist schema into the GCP portal Cloud SQL — the 26 migrations, applied into the existing
   ledger alongside the portal's 11. Nothing to reconcile (see above).
2. Router + per-handler adapters; the existing 512 lines of tests call the handlers directly and
   must stay green.
3. Cloud Run + Cloud Scheduler (8 schedules) in Terraform; SES posts bounces to a Cloud Run URL.
4. Repoint the corp site's `/api/waitlist` (item D).
5. Verify a signup end to end, then delete the AWS waitlist stack.

**Keep SES.** Google has no email-sending service; the GCP ops-agent already calls SES with static
credentials and that pattern is proven.

### ❌ D — Repoint the corp site's `/api/waitlist`
The only Lightsail touchpoint. Lightsail itself stays and needs nothing else. Blocked on C phase 3.

### ❌ E — Re-register Andre's agents on GCP
They are online on `gcp-use1` with **no profile and no key share** — a socket and a presence row with
no identity behind them, because they were registered against the AWS consortium. Until this is done
day-to-day CELLO does not actually work for him. Small, and it is the one that affects him personally.

---

## 5. Not doing, and why

- **Migrating agent identities / FROST shares.** Decided: fresh agents. Shares are per-node and
  non-transferable by design; the only routes are re-registration or a resharing ceremony.
- **Keeping any AWS protocol infrastructure.** Hibernated. If it is ever woken, note that `wake.sh`
  no longer repoints `portal.*` — that guard is now on main.
- **Porting the ops dashboard** (`operations.cello.mygentic.ai`). AWS-only, rides the AWS portal ALB,
  dark while hibernated. Raise it if anyone misses it.
