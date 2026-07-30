---
name: M12 Build Journal
type: build-journal
date: 2026-07-28
milestone: M12
status: open
topics: [m12, gcp, migration, multi-cloud, anti-entropy, role-split, build-journal]
description: >
  Append-only audit trail and evidence home for M12 (multi-cloud rebuild). Full proofs, run
  output, and bug forensics live here, pointed to from M12-DEFINITION-OF-DONE. Never edit a
  prior entry. New file per tier (M12-BUILD-JOURNAL-T{n}.md) seeded with a resume block.
---

# M12 Build Journal

## RESUME STATE (keep current — overwrite this block only)

- **Tier:** P0 COMPLETE + AUDITED — 4/4 ✅ (done-audit: 2 earned, 2 overstated→corrected;
  Entry 7).
- **Next red:** AE-APPEND-1 part 4 — remaining Tier-A specs (DELIBERATE-START unit, see Entry 20's
  audit intelligence: non-obvious local exclusions per table). Then the /cello/anti-entropy/1.0.0
  channel + mutual handshake (crypto TBS → publish). ROLE-MANIFEST-1 DONE; AE-APPEND-1 parts 1-3 DONE.
- **Publish carry-forward for part 4 consumer:** the agent_revocations SELECT MUST hex-encode
  `signature` (pg returns BYTEA as Buffer; no type-parser override) — stated in the encoder header.
- **Blocked on Andre:** nothing now (latest promoted). Next publish is the AE channel's crypto TBS
  when that unit lands.
- **ROLE-MANIFEST-1 ✅ FULLY CLOSED** — client (beta v0.0.129) + directory (branch, reviewed).
- **Done since P0:** AE-DESIGN-1 ✅, ROLE-MANIFEST-1 client half ✅ (branch), MULTIADDR-1 ✅
  (branch), ADAPTER-GCP-1 GCS cloud-storage ✅+reviewed (branch m12/adapter-gcp e1028109).
- **ADAPTER-GCP-1 remaining — BOTH need deliberate starts, not tail-of-session mirrors:**
  (a) GCS audit-log-shipper is NOT a mirror — `S3AuditLogShipper` is ~300 lines of cloud-agnostic
  degraded-buffer + backoff-retry + flush-concurrency logic with only `#putToS3` S3-specific.
  Right approach: EXTRACT the cloud-put into an injected sink (`put(key, body, contentType)`) so
  S3 + GCS are both thin; a refactor of TESTED audit code where a subtle regression silently loses
  audit entries — behavior-preservation review required. (b) Cloud KMS envelope key is
  crypto-at-rest-severe (reviewer's caution): wrong not-found/permission mapping corrupts share
  encryption, not a benign empty pool. Re-verify the KMS SDK error taxonomy against installed
  source; typed/coded errors, not message-substring.
- **PUBLISH FULLY COMPLETE — Entry 14/18.** v0.0.129 beta + **`latest` promoted by Andre
  2026-07-28** (all 7 `+latest:` confirmed; latest now resolves connect 0.0.87 / cli 0.0.77 /
  daemon 0.0.76 / transport 0.0.25 / protocol-types 0.0.25 / crypto 0.0.23 / gateway 0.0.5). Andre
  reinstalled cli+connect@latest, logout/login — operator on the new binary. Nothing owed.
- **Tier:** P1 — AE-DESIGN-1 ✅, ROLE-MANIFEST-1 client half ✅ (reviewed+fixed, Entry 10);
  remaining P1: ROLE-MANIFEST-1 dir half, AE-APPEND/MUTABLE/LOCAL-E2E, MULTIADDR, ADAPTER-GCP.
- **Branches:** cello-client `m12/role-manifest` (3ca8560, reviewed green, unmerged);
  trustless-cello `m12/role-manifest` (empty so far).
- **Blocked on Andre:** nothing.
- **HEAD:** trustless-cello `main` (see git log); cello-client untouched by M12 so far.
- **Cloud state:** AWS = 3 regions awake (woken 2026-07-28, see infra/STATE.md). GCP =
  `cello-infra` live (project + billing + 11 APIs + empty custom `cello-vpc`); authoritative
  record in `infra/GCP-STATE.md`, incl. the billing 5-slot ledger.
- **Parked:** M12-P1 (demo agent), M12-P2 (portal/waitlist DB coupling), M12-P3 (enrollment,
  out of scope), M12-P4 (replica nodes at launch).
- **Blocked on Andre:** nothing.

---

## Entry 0 — 2026-07-28 — Milestone scaffolded; pre-work evidence carried in

**What exists before any unit:**

- Spec-of-record committed: `2026-07-28_0700_gcp-rebuild-decision-record.md` (11 decisions +
  waves). Derivations in the superseded `2026-07-25_1034` log.
- **Live GCP recon (gcloud, 2026-07-28, account andre@mygentic.ai):**
  - Billing account `012EFA-590A2E-2A82B4` open; 5 projects linked; Andre holds `billing.admin`;
    `projectCreator` + `billing.creator` are domain-wide org grants → `cello-infra` creation and
    linking verified possible. Credits ~$23k to Nov 2027 (Andre) — GCP cost is never a factor.
  - Quotas per region (us-east1, us-central1, europe-west1, europe-west3, asia-northeast1):
    200 CPUs (24 E2), 8 static IPs, 4 TB disk, zero usage — no quota requests needed.
  - Org policies (org 376185218056): SA key creation AND upload disabled (enforced) → WIF only
    for cross-cloud auth; automatic IAM grants for default SAs disabled → every grant explicit,
    silent-403 failure mode; no external-IP ban; domain-member restriction allows all.
- **Live AWS evidence (2026-07-25, ECS Exec read-only):** 5 agents / 5 shares / 5 epochs in the
  us-east-1 directory DB — the rebuild-from-zero decision rests on this. Replication mesh healthy
  (2 slots active, lag ~1.1 KB). `directory_nodes` anomaly: only the self row present —
  diagnose during P1/P2, don't just observe its absence on the fresh system.
- **Milestone numbering (M12-D1):** this milestone took M12; former roadmap M12–M17 renumbered
  M13–M18 in `implementation-roadmap.md` + `ROADMAP.md`.

**Next:** DOD-GCP-PROJECT-1.

---

## Entry 1 — 2026-07-28 — DOD-GCP-PROJECT-1: cello-infra live; the billing 5-slot cap is real

**The billing constraint Andre hit before is confirmed and now understood.** `gcloud billing
projects link cello-infra` failed with `FAILED_PRECONDITION: Cloud billing quota exceeded` — the
account caps at **5 linked projects**. My §8 claim in the superseded plan ("linking a sixth is
very likely fine") was **wrong**; Andre's lived experience was right. The fix took one command,
not days, because the cap is a *slot* limit, not a wall: unlink `claude-code-vertex-mygentic`
(empty — zero resources, verified) → slot freed → `cello-infra` linked successfully.
`billingEnabled: true` confirmed. Full slot ledger recorded in `infra/GCP-STATE.md`.

**Clause checklist:**
- Project created: `cello-infra`, number 955736313934, org 376185218056 ✓
- Billing linked (via slot swap) ✓
- APIs: exactly 11 enabled, list in GCP-STATE.md (compute, artifactregistry, cloudbuild,
  sqladmin, secretmanager, storage, logging, monitoring, cloudresourcemanager, iam,
  serviceusage). No Vertex surface, no servicenetworking (PSA stays out per DOD-INV-NO-VPN —
  note: Cloud SQL private-IP *inside* GCP uses PSA plumbing; whether the invariant permits
  intra-GCP PSA or we use the Cloud SQL connector/auth-proxy path instead is a design point for
  DOD-AE-DESIGN-1/DOD-NODE-DIR-GCP-1, journaled here so it is not discovered late) ✓
- Default network + its 4 default firewall rules deleted; custom-mode `cello-vpc` created,
  zero subnets (per-region subnets come with node IaC) ✓
- `infra/GCP-STATE.md` created and committed ✓

**Owed for ✅:** import project/APIs/VPC into Terraform at DOD-IAC-BASE-1 (bootstrap was raw
gcloud, which is acceptable only as the documented bootstrap layer).

**Next:** DOD-GCP-IAM-1.

---

## Entry 2 — 2026-07-28 — DOD-GCP-IAM-1 via Terraform (seeds DOD-IAC-BASE-1)

Terraform chosen per M12-D2; doing IAM through it lands both lines' groundwork at once.

- **State backend:** `gs://cello-infra-tfstate` (us-east1, versioned, UBLA) — bucket
  bootstrap-created then imported, so TF manages its own state home.
- **Adopted bootstrap:** 11 APIs as `google_project_service` (disable_on_destroy=false),
  `cello-vpc` imported, project as data source (the one permanent bootstrap-layer object).
- **DOD-GCP-IAM-1 clauses:** 5 per-workload SAs (`cello-directory-node`, `cello-relay-node`,
  `cello-ops-agent`, `cello-portal`, `cello-cloud-build`) + 17 project-level minimal bindings
  (secretAccessor / cloudsql.client / logWriter / metricWriter per workload; AR writer for CI).
  Default compute SA: attached to nothing, granted nothing. Tightening to resource-scoped
  bindings as resources appear is expected; WIDENING needs a journal entry.
- **Evidence:** `terraform apply` — 33 added, 0 changed, 0 destroyed; follow-up
  `terraform plan` — **No changes** (live == code). SA list verified via gcloud.
- DOD-GCP-PROJECT-1's owed import → done → flipped ✅.

**Next:** unit review on the terraform diff, then DOD-CI-REGISTRY-1.

---

## Entry 3 — 2026-07-28 — IAM review findings fixed; first Cloud Build images; GitHub connection pending OAuth

**Unit review (cello-unit-reviewer, no model override) on DOD-GCP-IAM-1: SPEC FAITHFUL, 6
findings, ALL addressed:**
- **F1 (medium):** project-level `secretmanager.secretAccessor` on 4 workload SAs would let any
  workload read any other's key material once secrets exist, and no 403 would ever prompt
  tightening. **Fixed by removal** — secret access is now granted per-secret in the unit that
  creates each secret; a missing grant fails loud, which makes minimality self-enforcing.
- **F2 (medium):** CI's project-wide `storage.objectViewer` included the tfstate bucket (all
  historical state versions). **Fixed:** replaced with a bucket-scoped grant on the Cloud Build
  staging bucket only.
- **F3 (low):** additive `iam_member` means plan-clean ≠ no out-of-band grants. **Fixed:** caveat
  + audit command in GCP-STATE.md; audit at tier boundaries.
- **F4 (low):** tfstate bucket now `prevent_destroy` + `public_access_prevention=enforced`.
- **F5 (minor):** .gitignore covers tfvars/override/crash files.
- **F6 (note):** ops-agent has no `cloudsql.client` yet — intentional; its DB-access pattern is
  redesigned in DOD-MOVE-OPSAGENT-1 (no cross-cloud DB), so the grant is decided there.
Post-fix: apply clean, `terraform plan` No changes. IAM-1 → ✅.

**DOD-CI-REGISTRY-1 progress:**
- Artifact Registry `cello` (us-east1) via TF.
- **First CELLO image ever built on GCP:** `gcloud builds submit` (source → Cloud Build →
  Artifact Registry; no local docker) → `directory:manual-dedc55ac` **SUCCESS**, run as the
  `cello-cloud-build` SA. Relay build `dd2ba947` running.
- Silent-403 class hit twice in one hour, exactly as predicted (Entry 0): Cloud Build's P4SA had
  NO roles (org strips service-agent auto-grants). Fixed in TF: `cloudbuild.serviceAgent` +
  `secretmanager.admin` (the latter is the documented requirement for 2nd-gen GitHub
  connections — the P4SA creates/manages the OAuth-token secret).
- `cello-github` connection created, state **PENDING_USER_OAUTH** — Andre must open the
  authorization link (printed in terminal; also retrievable via
  `gcloud builds connections describe cello-github --region=us-east1`). Path-filtered triggers
  for `packages/directory/**` and `packages/relay/**` are the remaining clause.
- `.gcloudignore` added (keeps `gcloud builds submit` uploads to Dockerfile-relevant sources).

**Next:** DOD-IAC-BASE-1 (disposable MIG proof) while OAuth waits.

---

## Entry 4 — 2026-07-28 — DOD-IAC-BASE-1 enforcer green; relay image done

- **Relay image built by Cloud Build:** `relay:manual-50e06e3d` SUCCESS → Artifact Registry.
  Both node images now exist on GCP, built without a single local docker command.
- **Disposable probe (probe.tf, gated by `disposable_probe` var, default false):**
  - `apply -var disposable_probe=true` → 5 added: `cello-probe-r4c7` **RUNNING** in us-east1-b,
    static IP 34.26.220.192, COS-stable, e2-small, directory-node SA attached, IAP-only SSH
    firewall + the permanent `cello-us-east1` subnet (10.10.0.0/24).
  - `apply` (default false) → 4 destroyed; zero instances, zero addresses; plan **No changes**.
  - Known-and-recorded: the probe pins the static IP in the instance template — fine at size 1,
    deadlocks on rolling replace; the real node units use a stateful-IP MIG policy instead
    (stated in probe.tf's header so nobody copies the probe pattern).
- Unit review dispatched; findings land in Entry 5.

**Next:** fix review findings; triggers unit blocked on Andre's GitHub OAuth.

---

## Entry 5 — 2026-07-28 — Probe review: nothing blocking; fixes applied; IAC-BASE-1 ✅

Review verdict: SPEC FAITHFUL, no silent fallbacks, enforcer survives the revert test. Edits:
- F1: copy-trap comment moved onto the `access_config` block itself + explicit no-surge
  `update_policy` (OPPORTUNISTIC/REPLACE/surge 0) so "never surge" is declared, not defaulted.
- F2: subnets are now a `region_subnets` map (`10.10.<n>.0/24`, n in region-add order) —
  region expansion is structurally one map entry, zero manual steps. `terraform state mv` for
  the address change; plan clean.
- F3: SA reuse recorded as deliberate (M12-D3).
- Carried forward from review: first DOD-NODE-* unit must include ONE `--tunnel-through-iap`
  login as evidence (the IAP firewall path was created but never exercised).

Also logged M12-D4 (Andre): parallel-run strategy — GCP system stands up beside the live AWS
dev system; client toggles via bootstrap manifest endpoint + separate daemon DB; P1+ code on
story branches rebased from main; AWS never runs M12 code until Wave 2 cutover.

---

## Entry 6 — 2026-07-28 — DOD-CI-REGISTRY-1 ✅: trigger-path evidence complete; P0 closed

Andre completed the GitHub OAuth (app installation 149532787, Mygentic-AI, repo CELLO only).
Connection imported into TF; repo link + both triggers created via TF (branch `^main$`,
per-package path filters, cello-cloud-build SA, TF-injected `_REGISTRY`).

**Unit review highlights (all findings fixed):**
- F1: `:latest` dropped from both images — out-of-order finishes could leave it older than
  main; every consumer pins the commit-SHA tag. Comment in both YAMLs.
- F2: `.gcloudignore` now starts with `#!include:.gitignore` — gitignored files can never ride
  into the staging bucket.
- F3: `_REGISTRY` injected from the trigger so TF owns the registry path.
- Reviewer's key catch: the manual `builds submit` successes proved the Dockerfiles, NOT the
  GitHub-sourced path — they would still pass with the whole unit deleted (revert test). The ✅
  waited for real push evidence.

**The evidence (revert-test-proof):**
- Manual trigger run `ce24c926` (relay) SUCCESS — connection + repo fetch work.
- Push `e8842f33` (touches both YAMLs → in both filters) fired BOTH triggers via real push
  events → directory `0883f838` SUCCESS, relay `e38e3d3b` SUCCESS, tags = full commit SHA
  (trigger-side substitution expansion confirmed).
- Infra-only push `540fc175` fired NEITHER trigger — negative path-filter proof.

**P0 is complete: 4/4 ✅.** Parallel-coder note: commit `e4ae7712` (not mine) landed on main
mid-unit; fast-forward push worked — M12-D4's rebase discipline already exercised.

**Next:** tier-boundary checkpoint (`cello-done-auditor` on the four P0 flips), then P1 on a
story branch: DOD-ROLE-MANIFEST-1 + DOD-AE-DESIGN-1.

---

## Entry 7 — 2026-07-28 — P0 done-audit: 2 EARNED, 2 OVERSTATED; all corrections applied

Auditor anchored to live GCP state + admin activity logs + fresh `terraform plan`, not journal
prose. IAC-BASE-1 and CI-REGISTRY-1 EARNED outright (probe up/down proven from GCP's own audit
log; trigger evidence incl. timing check on the negative case). Two overstatements, both
failures of clauses the lines themselves wrote:

- **PROJECT-1 "only needed APIs":** live project had **33** enabled — project-creation defaults
  (BigQuery suite, Datastore, Trace, dataform/dataplex/analyticshub, the `cloudapis` bundle)
  nobody disabled. Entry 1's "exactly 11 ✓" was never live-true. **Fixed:** defaults disabled
  (the `cloudapis` meta-bundle had to go first — it "depends on" its members); final live set =
  **20** = 11 TF-managed + 9 undisable-able platform deps, recorded with rationale in GCP-STATE.
- **IAM-1 "every grant recorded in IaC":** live policy had `cloudbuild.builds.builder` →
  legacy Cloud Build SA — Google's auto-grant on API enablement, in neither iam.tf nor
  GCP-STATE, used by nothing (all builds ran as cello-cloud-build). **Fixed: removed.** This was
  caught by exactly the `get-iam-policy` tier-boundary audit that review finding F3 prescribed.
- **CI cleanup:** stale `directory:latest`/`relay:latest` tags (pre-F1 builds) deleted — they
  pointed at older-than-main images, the precise hazard F1 named. GCP-STATE registry row had a
  phantom `relay:manual-50e06e3d` (real tag: `manual-dedc55ac`) — corrected.
- **Carry-forward rescued:** the IAP-tunneled-login requirement now lives IN the
  DOD-NODE-DIR-GCP-1 line, not just Entry 5's body.

Post-fix: `terraform plan` No changes. **P0 closes at 4/4 ✅, audit-corrected.**

**Next:** P1 story branch — DOD-AE-DESIGN-1 + DOD-ROLE-MANIFEST-1.

---

## Entry 8 — 2026-07-28 — DOD-AE-DESIGN-1: surface maps + design doc drafted

Two explorers mapped the ground (persisted in `research/`): the 21-table publication set with
per-table lifecycles, and the libp2p/identity surface. Design-changing discoveries:

- Table-wide hash chains fork by construction under multi-master (ORDER BY local id) — already
  knowingly unverified cross-node. → chains become node-local audit; cross-node integrity =
  content addressing + MMR.
- **Cross-node checkpoint signing has never worked** (MMR tables never replicated; peer list
  empty in every env; responder-supplied pubkeys trusted). → M12-P5 parked; the
  unauthenticated checkpoint channel is retired by the design.
- A spurious `burned=true` destroys FROST shares irreversibly; naive LWW on `updated_at` can
  un-pause on clock skew; the honor-check fails OPEN on missing profile (documented gap). →
  §4 of the design: seq-based monotonic merge, burn=OR, tie→suspended, wall-clock never a
  merge input, pubkey denormalized into the suspension row.
- primary_holder must never sync (V44 security argument); pickup_queue needs ack-tombstones so
  deleted ciphertext can't resurrect; signal_records is the content-addressed pattern to copy.
- The manifest pins node keys but NOT PeerIds (those are unsigned SSM) → manifest gains
  `peerId` alongside `role` (one schema bump with ROLE-MANIFEST-1); directory starts VERIFYING
  manifest signatures (today it explicitly doesn't); mutual step-6-style handshake with a new
  domain (`cello-ae-peer-auth-v1`), both PeerIds in the TBS (channel binding), fail CLOSED.

Deliverable: `M12-ANTI-ENTROPY-DESIGN.md` (channel, 3-tier sync sets with per-table merge
rules, bucketed-digest reconciliation + write-hints, kill-switch convergence rules + the
adversarial scenario list for DOD-AE-MUTABLE-1, checkpoint scope ruling, observability ACs,
mesh retirement list). Unit review dispatched — the DoD line requires review before
implementation starts.

---

## Entry 9 — 2026-07-28 — AE logic layer complete; pg-store (DB half) built + reviewed; V49 prerequisite

**Logic layer — DONE and PROVEN.** Entries 10–25's detail lives in the git commit messages (the
prepend-anchor integrity note above). Net state of the transport-/DB-agnostic AE stack, all unit-
reviewed with every finding fixed:
- `record-hash.ts` (content addressing; `number` forbidden — BIGINT>2^53 aliasing), `set-reconciliation.ts`
  (256-bucket digests + `validatedSet`), `ae-table-encoders.ts` (Tier-A immutable/mutable column split),
  `ae-mutable-version.ts` (Tier-B version summaries; suspension EXCLUDES updated_at, presence INCLUDES).
- Merges: `suspension-merge.ts` (kill switch — burn=OR monotonic, higher-seq-wins, equal-seq
  suspended-wins + content tiebreak, wall-clock NEVER an input), `presence-merge.ts` (LWW, NaN→-Infinity
  commutativity fix).
- `ae-handshake.ts` + crypto `ae-peer-auth.ts` (manifest-pinned mutual handshake, both PeerIds channel-
  bound in the TBS, gates on the nonce WE minted — the H1 replay fix, fails closed).
- `anti-entropy-engine.ts` + the two-node in-memory convergence test wiring the REAL encoders + merges:
  Tier-A union, Tier-B higher-seq merge, monotonic burn on BOTH nodes, and **termination** (a further
  round applies 0). This is the convergence proof the reviewers deferred to "the e2e unit."

**pg-store — the DB half (this entry's build).** `pg-ae-store.ts` + `pg-ae-store.live.test.ts` (9 tests,
green against docker pg :5433). Round-trips the four tables it can advertise+serve+apply with no external
coupling: Tier-A `agent_profiles`/`agent_revocations` (insert-if-absent by natural key, ON CONFLICT DO
NOTHING, returns rows actually inserted), Tier-B `agent_suspensions` (kill switch) + `agent_presence`
(atomic merge-upsert: per-key `pg_advisory_xact_lock` on a dedicated connection → read locked row → audited
merge → upsert; returns rows that actually CHANGED, so a converged re-apply = 0 = termination signal). Type
obligations owned HERE (the only pg-aware layer): BYTEA `encode/decode(_,'hex')`; timestamps `AT TIME ZONE
'UTC'` epoch-millis on read AND write (the columns are `timestamp` without tz → session-TZ-independent);
BIGINT/UUID→string, boolean native. Deliberately EXCLUDES the two hash-chained Tier-A tables
(`user_accounts`, `seal_notarizations`) rather than half-wire them — their apply must reuse the canonical
local chain writer (`insertWithChain`; chains are node-local audit trails per design §2). That is the next unit.

**Schema prerequisite — V49 (additive, applied to docker pg, idempotent).** The suspension merge/version
reference `suspension_seq` + `origin_node`, absent from V34. `V49__agent_suspensions_ae_seq.sql` adds them
(`ADD COLUMN IF NOT EXISTS`, `suspension_seq BIGINT NOT NULL DEFAULT 0`, `origin_node TEXT`). Existing rows
→ seq 0 (safe: merge falls to suspended-wins + tiebreak, a pause is never lost). `OpsAgentExpectedMigrationVersion`
bumped 48→49 in `cello-ssm-parameters.yaml` (skipping this crash-loops the ops-agent on deploy). STILL OWED:
the pause/burn WRITE path must mint `suspension_seq = max(local)+1` + set `origin_node` (today it doesn't
touch these columns) — the next unit alongside the chained-table apply.

Unit review dispatched on the pg-store (security-critical write path) — commit after findings are fixed.

---

## Entry 10 — 2026-07-28 — Both AE-DB units reviewed; 2 HIGH kill-switch bugs found + fixed

Two `cello-unit-reviewer` passes (Opus) returned on the Entry-9 units.

**Write-path (seq minting) — SPEC FAITHFUL.** All five weighted properties hold: every accepted
write advances suspension_seq once, no-op clears don't, `current+1` is a sound `max(local)+1` (agent_id
PK = one row), pre-V49 seq=0 rows advance via the DO UPDATE branch (never skip +1), burn stays
terminal. The reviewer confirmed `INSERT … ON CONFLICT DO UPDATE SET seq = seq+1` is atomic under
READ COMMITTED (the loser blocks on the row lock and re-reads the committed seq → {1,2}, never {1,1}).
Only gap was test teeth: added a **two-concurrent-pauses → distinct-seqs** test.

**pg-store — 2 HIGH + 1 MEDIUM, all fixed (kill-switch correctness).**
- **HIGH — un-lock race (un-burn).** applyTierB read was a plain `SELECT`; the write-seam mutates the
  same row without the AE lock, so an AE apply of a losing record could revert a concurrent burn
  (burned→false, seq regress). **Fix:** `SELECT … FOR UPDATE` + existing→UPDATE / absent→INSERT-with-
  unique-violation-**retry** (the retry finds the row under FOR UPDATE and merges it, so a burn that
  lands in the insert window is preserved by the merge's OR). No merge logic duplicated in SQL, seam
  unchanged. Removed the old advisory lock (it only serialized AE-vs-AE; FOR UPDATE subsumes it).
  Teeth: a test holds an uncommitted seam burn, fires the AE apply (blocks on FOR UPDATE), commits →
  asserts burned stays true, seq stays 6.
- **HIGH — origin_node NULL↔'' split.** Advertise hashed the RAW row (`null`) while serve/apply went
  through rowToBody (`''`), so a pre-V49 (null-origin) row advertised a different version than a peer
  computed → perpetual re-pull on the kill-switch table. **Fix:** `COALESCE(origin_node,'')` at the
  SELECT so all three paths encode `''`. Teeth: assert advertise-version == served-body-version for a
  NULL-origin row.
- **MEDIUM — presence timestamp TZ.** The columns are TIMESTAMPTZ (not `timestamp` as the header
  wrongly said); the `AT TIME ZONE 'UTC'` on the WRITE down-cast to a bare timestamp and reinterpreted
  it in the session TZ → instant corruption + version divergence on a non-UTC node. **Fix:** dropped
  `AT TIME ZONE` on both read (`EXTRACT(EPOCH FROM col)*1000`) and write (`to_timestamp(ms/1000.0)`) —
  correct + TZ-independent for TIMESTAMPTZ. Teeth: a second pool pinned to `America/New_York` writes +
  reads the exact millis; a UTC pool reads the same millis for that row.
- Also added the agent_profiles Tier-A insert-if-absent coverage the reviewer flagged.

Result: pg-ae-store 12 live tests green, write-path 5 green; typecheck/lint/build clean. Both units'
findings fully resolved. Ready to commit once the full directory suite confirms no regression.

---

## Entry 11 — 2026-07-28 — engine↔pg bridge (+fork signature) and §1b manifest verify-at-load

**Bridge (cc354cc0).** AeStoreView went sync→MaybePromise so the async PgAeStore can implement it
(compile-pinned `implements`); names aligned (serveTierA/B); apply methods return CHANGED counts.
A real `runAntiEntropyRound` with PgAeStore as local is proven over docker pg (pull lands, round 2
is empty). Review found one blocking gap: with only changed-counts, a permanent same-key Tier-A
fork (two nodes, same natural key, different content — insert-if-absent can never converge it)
reported `{0,0}` — indistinguishable from convergence. **Fixed:** RoundResult now reports
pulled AND applied; termination tests pin `pulled: 0`; a new test asserts the fork signature
(`pulled>0 && applied===0`) persists across rounds. The transport handler must treat that repeating
signature as `ae.round.fork_suspected`, never as health. Also restored (as a proof, not an
obligation) why no advertise/serve snapshot txn is needed: Tier-A is append-only and Tier-B apply
re-reads FOR UPDATE and merges — a mid-round write costs one extra round, never divergence.

**§1b manifest verify-at-load (fdd2a996).** "The store is only a transport" ends: with verify opts
(officer rootKeys+threshold — env names shared with the client daemon), FileDirectoryManifestStore
enforces at construction AND on reload: verifyManifest (RFC 8032 threshold), §1c distinctness (no
duplicate nodeId/pubkey/peerId — the handshake's anti-reflection guarantee), anti-rollback (a
validly-signed OLDER version is refused — it could resurrect retired node keys). Bad at boot →
exit 1; bad on reload → `directory.manifest.verify.failed` naming the cause, last VERIFIED manifest
stays active. bin fails loud if the manifest path is set without the anchor (no unverified
fallback). Infra rides the same branch so Wave 2 deploys both sides together:
`/cello/{env}/consortium/root-keys` + `root-threshold` SSM params (IaC, public officer pubkey
matching the client's bundled constants) resolved into the directory task env; deploy.sh ordering
(ssm-params step 2b → directory step 7) already correct. 8 new tests, real Ed25519 signatures over
the real canonicalManifestBody — no mocked crypto. Review dispatched.

Next: §1a — populate `peerId` in the manifest entries (schema already carries the field from
ROLE-MANIFEST-1) + then the `/cello/anti-entropy/1.0.0` channel handler.

---

## Entry 12 — 2026-07-28 — Channel + libp2p face complete; transport 0.0.27 cascade; review hardening

**The AE channel is now built end to end** (branch m12/ae-append, a9f39a0a): wire protocol
(cebdd6df, handshake + rounds over frames, reviewed), the pg store, the engine, and the new
`AeSyncService` (streamWire lp+CBOR adapter, responder registration, per-peer dial loop, §6 events,
fork alarm, §1c rotation-skew retry-once). 54 AE tests green. Remaining for DOD-AE-*: registration
in `CelloDirectoryNode.start()` + composition-root construction (a ~20-line wiring diff), then the
DOD-AE-LOCAL-E2E-1 three-process loopback enforcer.

**Cross-repo: transport 0.0.27 published** (cello-client 0d32506; cascade c450f54 → tag v0.0.131;
smoke-tag green; binary verified — dist carries `connection?.remotePeer?.toString()`; cross-pins
real). `handle()` now passes the connection's Noise-authenticated remote PeerId as an optional
second handler arg — the seam the responder's channel binding requires (frost's `peerIdString` wire
claim is exactly what this replaces). trustless-cello re-pinned ^0.0.27 (directory + relay).
**`latest` promotion NOT run — Andre's step** (daemon 0.0.78 / cli 0.0.79 / connect 0.0.89 are on
beta; nothing here blocks on promotion since trustless-cello pins by version).

**Channel review (Opus) — 2 HIGH fixed:** (1) key/body-mismatch lock bypass on applyTierB (a
malicious authenticated peer could un-burn an agent by writing through a differently-keyed body) —
refused outright; (2) served records applied unvalidated — applyTierA recomputes every hash from
the body; RemoteStoreView keeps only requested records. Defense-in-depth: responder never signs a
wire-claimed peerIdA; regex error classifier removed; per-frame deadlines + 250k wire bounds;
`node_id_mismatch` split from `peerid_mismatch` (so the §1c retry can't fire on a wrong-endpoint
dial); engine applies in LOCAL table order; responder-side verification got its own revert-proof
test.

**Decisions logged:**
- **M12-D7 — expired-in-place manifest:** if the manifest expires while the process runs with no
  replacement, the store serves the last VERIFIED manifest and warns loudly on every reload
  (`directory.manifest.verify.failed`). AE continues on it — halting sync would stop kill-switch
  propagation, which is worse than pinning against once-valid keys; the warn is the operator's
  alarm. (A fresh boot with an expired manifest still fails hard.)
- **O(compare) advertisement deferred:** `ae_state` carries full hash lists/version maps per round
  (correctness proven); the bucketed-digest short-circuit (§3 step 1-2 wire form) is a wire-
  efficiency optimization owed before table counts grow — not a launch blocker at dev data sizes.
- **§1c previous-manifest acceptance owed:** the retry-once-on-re-read half is implemented; the
  "accept the immediately-previous manifest during rollout" half needs previous-manifest retention
  on both sides. Owed with the manifest-rotation work (DOD-MANIFEST-GCP-1).
- **Anti-rollback floor is process-lifetime** (review finding, accepted trade): a restart accepts
  any validly-signed manifest; the same SSM privilege domain controls the anchor itself, and the
  client's compiled-in anchor is the real backstop.

---

## Entry 13 — 2026-07-28 — AE wired into the node; §1b broke a J-AUTH invariant — FIX DESIGNED, NOT YET APPLIED

**Done + green:** AeSyncService wired into `CelloDirectoryNode.start()`/`stopAeSync()` and the
composition root (2d8c5ab6). Own peerId comes from the live transport, never config. AE turns on
when the three trust legs exist (verified manifest store + node key + pg pool) — no env flag,
because a pre-M12 manifest has no peerIds, so the dial loop no-ops and inbound handshakes fail
closed until the signed rotation lands. Also green + uncommitted→committed here: `manifestEntryMultiaddr`
now emits `/ip4/` for an IPv4-literal host (the loopback e2e needs it; `/dns4/127.0.0.1` does not
resolve), and the spine harness passes the officer anchor whenever it sets a manifest path (§1b
made a path-without-anchor a fail-loud exit(1)).

**⚠️ OPEN — one FAILING test, root cause understood, fix designed but NOT applied.**
`packages/e2e-tests/src/spine/j-auth.spine.test.ts` → "DOD-AUTH-2 (poll rejects forged)" now fails
(5 of 6 pass). NOT flaky, NOT pre-existing: my §1b change caused it.

- **Cause:** the test writes a FORGED manifest to the directory's served file and expects the
  directory to SERVE it, so the daemon can prove it independently rejects it (logs
  `directory.auth.manifest.signature.invalid` at version 9). §1b made `getCurrentManifest()` verify,
  so the forged file is refused and the directory serves last-good instead → the daemon never sees
  v9 → 20s timeout.
- **Why the test is right:** M7 DOD-AUTH-2 deliberately makes the directory a DUMB TRANSPORT for the
  manifest. That is a real invariant, for two reasons: clients must never trust the directory (the
  test is the proof), and a manifest signed by a ROTATED officer set must still reach clients whose
  anchor is newer than the directory's — otherwise officer rotation is blocked by a stale node.
- **Why §1b is also right:** the manifest is the AE channel's trust anchor; the directory must not
  ACT on an unverified one.
- **Fix (M12-D8, decided — apply next):** these are two ROLES, not one. Split the store:
  `getCurrentManifest()` reverts to pure transport semantics (serve on-disk; last-good only on
  read/parse error — no verification), and a new `getVerifiedManifest()` carries the §1b checks
  (threshold signatures, validity window, §1c distinctness, anti-rollback; construction still
  throws in verify mode). Then point each call site at the role it actually needs:
  - SERVE (transport, unverified): `manifest_poll_request` response (`directory-node.ts:2363`) and
    the HTTP `/manifest` endpoint (`bin/directory.ts:1163`).
  - USE (must be verified): the AE anchor (`bin/directory.ts:955`) and — a pre-existing latent
    weakness worth closing in the same change — the **DKG quorum derivation** at
    `directory-node.ts:2848`, which today derives participants/threshold from an UNVERIFIED
    manifest.
  `getVerifiedManifest()` becomes a required method on the `DirectoryManifestStore` interface
  (`packages/interfaces/src/manifest.ts`) so `TestDirectoryManifestStore` must implement it too — no
  optional method with a silent fallback to the unverified getter.

Next after that: re-run j-auth (expect 6/6) and the wider spine suite, then DOD-AE-LOCAL-E2E-1
(three-process loopback convergence via the extended harness — the harness already provisions one DB
per sovereign node, which is the substrate that enforcer needs).

---

## Entry 14 — 2026-07-28 — DOD-AE-LOCAL-E2E-1 GREEN: three live directories converge on loopback

**The enforcer passes.** `packages/e2e-tests/src/spine/j-antientropy.spine.test.ts`, 4/4 against three
REAL directory binaries (separate OS processes, separate databases, real TCP + Noise):
1. peers authenticate against the manifest-pinned identity (and no node logs an auth failure —
   without this gate every convergence assertion below would be vacuous);
2. divergent seeded state converges to the union on ALL THREE nodes (Tier-A);
3. a node killed mid-sync catches up on restart, no operator action (the outage-tolerance the
   sovereign-node model promises);
4. a burn written on ONE node converges to the others and STAYS burned against a concurrent
   higher-seq un-pause — `burned=true paused=false seq=9` on all three. That is the §4 kill-switch
   property proven across a federation, which is the whole reason this milestone exists.

Harness extended (never a from-scratch fixture): `directoryFixedTransport` gives each node a fixed
transport seed → deterministic PeerId and a fixed ws port, so a peerId-pinned manifest can be
written BEFORE any node boots (AE channel-binds against exactly those values); `onDirectoryUrlsReady`
now also yields the AE dial identities; `spineDirectoryNode` takes role+peerId. `CELLO_AE_INTERVAL_MS`
is tightened to 2s for tests.

**Note on the one red run: the product was right, the test was wrong.** The suspension assertion
compared psql's `boolean || text` output to `t:9`; that cast renders `true`, not `t`. Diagnostics
printed the real per-node state and showed correct convergence on all three nodes. Fixed the
assertion (now `true:false:9`, which also pins `paused`), and the diagnostics helper stayed in — a
convergence timeout should always print what each node actually holds.

**M12-D8 review (Opus) — fixes applied:**
- **HIGH (empirically reproduced by the reviewer):** `CELLO_AE_INTERVAL_MS` was bounded below but
  not above, and Node coerces any `setInterval` delay > 2^31−1 to **1 ms** — so a plausible
  "30 days" produced the exact busy loop the guard existed to prevent. Now bounded both ends
  (integer, 1000 … 2147483647) and reported as `adapter.config.invalid` (the key is present but bad).
- **Expiry is no longer conflated with tampering:** an expired-but-validly-signed manifest now
  raises `directory.manifest.expired.serving_stale` with a `staleSinceMs` age, so an alarm on
  forgery/rollback is not drowned by routine staleness.
- **A same-version content swap is no longer silent:** the reload event keys on a node-set
  fingerprint, not the version, so republishing different peerIds/pubkeys at the same version can
  never swap the AE anchor + DKG quorum invisibly.
- **`dkg_failed` now carries `manifestVersion`,** correlating the client-facing label with the
  manifest warn that actually caused it (the operator was being sent to debug FROST).

**M12-D9 — boot stays FATAL on an unverifiable manifest (reviewer proposed otherwise; declined,
with reasoning).** The reviewer argued construction should succeed so the SERVE role survives, since
§1b's rotation rationale says a rotated manifest must still reach clients. That rationale is about a
node ALREADY RUNNING. Extending it to boot would leave `getVerifiedManifest()` with nothing to
return, and the DKG quorum path treats an empty node set as single-node back-compat — i.e. a SILENT
THRESHOLD DOWNGRADE, which is strictly worse than a loud crash loop. An officer rotation must update
`CELLO_CONSORTIUM_ROOT_KEYS` on every node anyway (IaC/SSM, stage-1), so a node that cannot verify at
boot is a half-finished rotation and should be loud. Recorded in the store's class doc so the file no
longer contradicts itself.

**DKG-quorum routing now pinned (the reviewer's strongest remaining point, closed).**
`registration.test.ts` → "M12-D8: DKG quorum derives from getVerifiedManifest()" drives a real
register_request against a TWO-FACED store: SERVE advertises 3 nodes, USE advertises only this one.
Routed correctly the ceremony reaches `dkg_ready` on the single-node path; mis-routed it would hunt
a 3-node quorum, find one reachable directory and refuse with `dkg_failed`. So the assertion is
BEHAVIORAL, not just a call-spy (it also asserts the served getter was never consulted).
**Revert-verified:** flipping that one line to `getCurrentManifest()` makes it fail, then restored.

**Still owed (smaller):** `stopAeSync()`-in-shutdown and the `CELLO_AE_INTERVAL_MS` bounds have no
tests of their own — both are boot/shutdown wiring whose failure mode is loud, so they rank below
the remaining P1/P2 DoD lines.

---

## Entry 15 — 2026-07-28 — Done-audit: 3 flips OVERSTATED. Two fixed with real tests, one demoted.

Ran `cello-done-auditor` on the three AE status flips before committing them. Verdict: **0 EARNED,
3 OVERSTATED** — it independently reproduced both suites green (4/4 spine, 69/69 unit) and then
found that each line had a named AC clause with no test behind it. The tags ran one notch ahead of
the work. Nothing dishonest reached the repo: the flips were still uncommitted.

**Fixed with real tests (both now earned):**
- **"a node absent for a BURST of writes converges on rejoin"** — the test seeded ONE record.
  "Burst" is the load word in that clause and one record proves reconnection, not catch-up. Now
  seeds **60** records while node 0 is down, asserts they landed on the WRITER first (so the
  all-present assertion cannot pass vacuously), then asserts the full set after rejoin. Live: green.
- **"pause during partition"** — was UNPROVEN. The only down-node test seeded `agent_revocations`
  (Tier-A); suspensions are Tier-B, a different merge and a different sync path, so Tier-A
  catch-up proved nothing about the kill switch. Added: a PAUSE written while node 0 is
  partitioned, converging to it on heal. That also removes the auditor's double-count (restart and
  stale-rejoin were the same Tier-A test cited twice). Live: green. **Enforcer now 5/5.**

**Demoted to 🟠 — DOD-AE-APPEND-1.** The AC says "root-comparison + delta pull; divergence
detection is **O(compare)**". Delta pull is real (bodies are pulled by hash), but `buildWireState`
sends the FULL Tier-A hash list and Tier-B version map every round, per peer, per table, converged
or not — **no digest crosses the wire**. The receiver recomputes a digest from a list it already
paid to download, so the "root comparison" saves zero bytes. The bucketed machinery §3 specifies
exists but is DEAD in the ship path: `differingBuckets` has no production caller, its only
references are its own tests — dead code backed solely by its own test, in a repo whose
readability is itself a trust signal. My earlier framing ("wire-efficiency optimization owed, not
a correctness gap") was wrong: divergence detection is BY DEFINITION what you pay before you know
you diverge, and that cost is paid on the wire. Owed: digest-first `ae_state`, bucket walk only
for tables whose digests differ — which also makes `differingBuckets` live.

Also corrected in the DoD: the LOCAL-E2E line named `session-fixture.ts` as the standard fixture.
That file does not exist in either repo. `spine/live-harness.ts` is the live-binary harness ~30
`j-*.spine.test.ts` files use, and the AE enforcer EXTENDS it (+67 lines) rather than forking —
which is what fixture discipline actually asks for.

---

## Entry 16 — 2026-07-28 — DOD-ADAPTER-GCP-1: the three GCP adapters, built + wired

Per M12-D6: `GcsCloudStorageProvider`, `GcsAuditLogShipper`, `KmsEnvelopeKeyProvider`. All behind
the EXISTING `packages/interfaces` contracts, all with injected clients so 10 unit tests run with
no credentials and no network. `@google-cloud/storage` + `@google-cloud/kms` added to the directory
package per M12-D5 (server-side only, never shipped to operators) and imported LAZILY, so an AWS
node or a local run never loads them.

The adapters are thin; the value is BEHAVIORAL PARITY, because the composition root swaps them and
nothing downstream knows which it got. The tests pin the differences that actually bite:
- GCS signals "missing object" with a 404-coded generic error where S3 throws a typed `NoSuchKey`.
  404 → `undefined` (the interface's contract); **every other error propagates** — masking a 403 as
  "not found" would make a permissions mistake read as an empty relay pool, and every session
  assignment would fail with no cause named anywhere.
- The audit shipper mirrors the S3 shipper's semantics rather than inventing simpler ones: ships
  write-through per entry (batch-on-flush loses everything a crash interrupts), buffers on failure
  instead of dropping, RETAINS the buffer across a failed flush, and stays degraded while the
  buffer is non-empty so ordering is preserved. A dropped audit entry is unrecoverable AND
  invisible — nothing downstream ever notices a missing row.
- The KMS provider FAILS CLOSED on decrypt. A fail-open envelope provider is the worst shape here:
  the share store would hand out bytes that look like a real K_server share and the failure would
  surface much later as an unrelated-looking ceremony error. `rotate()` is a documented no-op —
  Cloud KMS rotates versions server-side and `decrypt` resolves the version from the ciphertext.

Composition root: new `CELLO_CLOUD` (`aws`|`gcp`), default `aws` so every existing deployment is
byte-identical with no env change. An invalid value exits 1 — a typo must not silently fall back to
AWS adapters on a node with no AWS credentials, which would surface as opaque SDK timeouts.

Status 🟡 not ✅: these are unit-proven, not live-proven. Live GCS/KMS verification belongs to
DOD-NODE-DIR-GCP-1 along with the IaC for the bucket and key ring.

Note: `persist-001-composition-root.test.ts` has ONE failing case ("exits 1 with
migration.out.of.date…") — verified pre-existing by stashing the diff and re-running; it fails
identically on a clean tree.

---

## Entry 17 — 2026-07-28 — DOD-AE-APPEND-1 ✅: digest-first wire + bucket walk (the audited gap, closed)

The done-audit's one remaining OVERSTATED clause is now genuinely implemented rather than argued
away. Before: `ae_state` carried the full Tier-A hash list and Tier-B version map every round, per
peer, per table, converged or not — the receiver recomputed a digest from a list it had already paid
to download, so "root comparison" saved nothing and `differingBuckets` sat in the tree with no
production caller.

Now, per design §3 steps 1-2:
1. **Digest exchange** — `ae_state` is `table → digest`, one hash per table. That is the whole
   advertisement.
2. **Bucket walk**, only for a Tier-A table whose digest differs — `ae_buckets_req` returns the
   256-entry bucket-digest vector, `differingBuckets` localises the difference, and
   `ae_bucket_hashes_req` fetches hashes for ONLY those buckets. A bucket whose digest matches has
   byte-identical contents on both sides, so skipping it is exact, not approximate. Tier-B fetches
   its version map for a differing table (`ae_versions_req`).

The mechanism that makes this work is small and worth naming: `PeerRoundState`'s detail is now a
LAZY THUNK, so `planRound`'s pre-existing digest-match skip actually prevents the fetch instead of
happening after it. Digests moved onto the store (`tierATableDigest`/`tierBTableDigest`) — a remote
store view returns the peer's ADVERTISED digest without fetching anything, which is precisely what
makes detection O(compare) on the wire.

Pinned by two new tests: a converged round sends `ae_state_req` and **nothing else** (frame types
counted on the wire — the previous implementation would fail this), and a divergent table with 40
shared + 1 differing record pulls exactly 1. Enforcer re-run against the new protocol: **5/5 green**,
so the change is proven across three live processes, not just in-process.

DOD-AE-APPEND-1 → ✅. All three AE DoD lines are now audited-earned.

---

## Entry 18 — 2026-07-28 — GCP adapter review: 5 HIGH fixed, 1 blocking hollow test closed

Review of the adapters found real defects. Fixed:
- **The fail-closed KMS guard was HOLLOW** [blocking]. The "THROWS on a failed decrypt" test passed
  because the fake CLIENT threw — it never reached the null guard. Deleting the guard left all 10
  tests green while `decrypt` returned `new Uint8Array(undefined)`: a ZERO-LENGTH buffer handed to
  the share store as if it were real K_server material. Added tests that return a well-formed-but-
  empty KMS response (`[{}]` and `[{plaintext: null}]`) so the guard itself is what fails.
  **Revert-verified:** deleting the guard now turns those two tests red.
- **A missing BUCKET read as "nothing published yet."** GCS 404s a missing bucket exactly as it
  404s a missing object (S3 distinguishes NoSuchBucket from NoSuchKey). A mistyped
  `RELAY_MANIFEST_BUCKET` — the likeliest first-boot error on a GCP node whose bucket IaC is still
  owed — surfaced as `relay.manifest.not_found { reason: "no manifest published yet" }` at INFO,
  which the loader treats as a designed benign state and never retries: the node boots healthy and
  assigns no relays forever. Now a 404 checks `bucket.exists()` and throws naming the bucket.
- **`save()` silently disabled retries for the whole client.** `File.save()` without preconditions
  sets `maxRetries=0` AND mutates `retryOptions.autoRetry=false` on the SHARED `Storage` instance —
  so one manifest upload would strip retries from every later download, including the 120s poll
  loop. Both call sites now construct with `IdempotencyStrategy.RetryAlways`.
- **`flush()` erased entries enqueued during its own await** (`buffer.length = 0` after an async
  write) while reporting success. Now `splice(0, pending.length)`.
- **Audit key collision.** `audit/${ISO}-${perInstanceSeq}` + `save()`'s default overwrite meant two
  tasks booting in the same millisecond silently destroyed one another's audit object — in a bucket
  whose purpose is tamper-evidence. Now date-partitioned with a UUID and `ifGenerationMatch: 0`.
- **Event-name parity.** First-failure logged a GCS-only `audit.shipper.failed`; an alarm keyed on
  the S3 shipper's `audit.shipper.degraded` would never have matched. Same event + field set now,
  and the test asserts the NAME rather than "something was logged".
- `#bufferOldestTs` is re-based after an overflow drop (it reported the age of a deleted entry).
- The `CELLO_CLOUD` comment claimed "every dev+ adapter family". It is not: the RDS credential path
  is still AWS Secrets Manager, so a GCP dev node cannot boot until DOD-NODE-DIR-GCP-1 wires Cloud
  SQL. Comment corrected to say so.

**Still owed (journaled, not silently dropped):** the S3 shipper's backoff RETRY loop and
`audit.shipper.recovered` have no GCS equivalent — one transient 503 parks the shipper in degraded
mode for the process lifetime; KMS crc32c is neither sent nor verified; the `as never` cast on the
real KMS client erases the only structural check that unit has; `nodeId`/`region` default to
`AWS_REGION` so a GCP node mislabels itself; and the SSM-registry failure prints AWS remediation
advice on a node that has no SSM by design. All are latent today because **nothing calls
`AuditLogShipper.ship()` in production** — a pre-existing no-consumer gap across all three shippers.

---

## Entry 19 — 2026-07-28 — STANDING STATE (read this first after a compaction)

Capstone entry. Entries 1-18 are the narrative; this one is the machine state a cold context needs
before touching anything.

### Where the code lives — WORKTREES (changed 2026-07-28, do not get this wrong)

An endorsements agent runs overnight in the PRIMARY checkouts. M12 work moved into worktrees so we
do not fight over branch switching:

| Repo | Primary checkout (endorsements agent — DO NOT USE) | M12 worktree (use this) | Branch |
|---|---|---|---|
| trustless-cello | `/Users/andrep/Documents/code/trustless-cello` → `main` | `/Users/andrep/Documents/code/trustless-cello-m12` | `m12/ae-append` |
| cello-client | `/Users/andrep/Documents/code/cello-client` → `main` | `/Users/andrep/Documents/code/cello-client-m12` | `m12/ae-client` (fresh, no commits yet) |

`cello-client-m9` (`m9-switch-on`) also exists — unrelated, leave it.
The M12 worktree needed `packages/interfaces` built locally (`cd packages/interfaces && npx tsc
--build`) before `tsc --noEmit` passes in `packages/directory`; vitest works without it (TS source).

### Branch state — NOTHING IS MERGED

`m12/ae-append` HEAD = `4357697c`. Unmerged M12 branches awaiting ONE batched directory deploy at
Wave 2 (deploys take 25-30 min across 3 regions — never ship these one at a time):
`m12/role-manifest`, `m12/multiaddr`, `m12/adapter-gcp`, `m12/ae-append`.

### Published to npm beta from cello-client MAIN (already live, already pinned)

`transport 0.0.27`, `daemon 0.0.78`, `cli 0.0.79`, `connect 0.0.89`, tag `v0.0.131` (CI green,
binary-verified). trustless-cello pins `@cello-protocol/transport ^0.0.27`. **Next free tag is
`v0.0.132`** — the endorsements agent must not reuse `v0.0.131`.
**`latest` promotion NOT run — that is Andre's step, always.** Nothing here blocks on it.
Note: those two commits went to cello-client `main` directly. Andre ruled that acceptable (nothing
live, pre-launch) but M12 client work is on `m12/ae-client` from now on.

### Crons: NONE ARMED. Re-arm both on resume

The M12 heartbeat + "have you stopped?" defibrillator were session-scoped and are gone. M12-PROCEDURE
§3b expects them.

### DoD status — P1 (protocol code) is COMPLETE

All ✅ and audited: `GCP-PROJECT-1`, `GCP-IAM-1`, `CI-REGISTRY-1`, `IAC-BASE-1` (P0);
`ROLE-MANIFEST-1`, `AE-DESIGN-1`, `AE-APPEND-1`, `AE-MUTABLE-1`, `AE-LOCAL-E2E-1`, `MULTIADDR-1` (P1).
`ADAPTER-GCP-1` is 🟡 BUILT-not-live-verified (unit-proven with injected clients; real GCS/KMS proof
belongs to `DOD-NODE-DIR-GCP-1`).

**NEXT LINE: `DOD-NODE-DIR-GCP-1`** — first GCP directory live (`gcp-<region>`): MIG(1) + COS running
the CI-built image, its own Cloud SQL (node-only access), Secret Manager secrets, IAP-login, and a
live EMPTY-REGISTRY BOOT (the thing M12-D6 said to confirm in P2). This is also where the GCP
adapters finally get real-cloud proof, and it needs IaC for the GCS bucket + KMS key ring.

### How to verify the AE stack in one command each

```
# unit (fast) — from the M12 worktree, packages/directory
CELLO_ENV=local DATABASE_URL="postgresql://postgres:dev@localhost:5433/cello_dev" \
  npx vitest run src/__tests__/ae-*.test.ts src/__tests__/anti-entropy-engine.test.ts \
  src/__tests__/pg-ae-store.live.test.ts src/__tests__/gcp-adapters.test.ts

# the enforcer (3 real directory binaries, ~5 min) — from packages/e2e-tests
CELLO_ENV=local npx vitest run --config vitest.spine.config.ts src/spine/j-antientropy.spine.test.ts
```
Both need docker postgres on :5433 (`docker compose up -d`).

### Owed items — journaled, NOT forgotten

- **GCS audit shipper has no RETRY loop** (the S3 one has backoff + `audit.shipper.recovered`). One
  transient 503 parks it in degraded mode for the process lifetime. Latent: **nothing calls
  `AuditLogShipper.ship()` in production** — a pre-existing no-consumer gap across all 3 shippers.
- KMS **crc32c** neither sent nor verified; the `as never` cast on the real KMS client erases the
  only structural check that unit has (the real `encrypt` returns a 3-tuple, `KmsLike` declares 1).
- `nodeId`/`region` default to `AWS_REGION`, so a GCP node self-labels `us-east-1` on every log line.
- The SSM-registry failure prints AWS remediation advice on a GCP node that has no SSM by design.
- `CELLO_CLOUD=gcp` + `CELLO_ENV=dev` **cannot boot**: the RDS credential path is still AWS Secrets
  Manager. Cloud SQL wiring belongs to `DOD-NODE-DIR-GCP-1`.
- §1c "accept the immediately-previous manifest during rotation" — the retry-once half is built; the
  previous-manifest-retention half is owed with `DOD-MANIFEST-GCP-1`.
- Two hash-chained Tier-A tables (`user_accounts`, `seal_notarizations`) are deliberately NOT synced:
  their apply must reuse the canonical local chain writer (`insertWithChain`).
- `stopAeSync()`-in-shutdown and the `CELLO_AE_INTERVAL_MS` bounds have no tests of their own.

### Decisions this run (full text in the DoD's decision list)

- **M12-D8** — the manifest has TWO roles. `getCurrentManifest()` SERVE = dumb transport (clients
  verify independently; officer rotation must not be blocked by this node's anchor);
  `getVerifiedManifest()` USE = threshold-verified, windowed, distinct, anti-rollback. Collapsing
  them broke J-AUTH. Both required on the interface — no optional method that silently degrades.
- **M12-D9** — boot stays FATAL on an unverifiable manifest. Booting serve-only would leave the DKG
  quorum deriving from an empty node set, which the code treats as single-node back-compat: a SILENT
  THRESHOLD DOWNGRADE is worse than a loud crash loop.

### Process note that earned its place

The `cello-done-auditor` ruled all three AE status flips **OVERSTATED** before they were committed —
each had a named AC clause with no test behind it. Two were fixed with real tests, one (APPEND-1's
O(compare)) was demoted, then genuinely implemented in Entry 17. **Run the auditor on every status
flip; it caught what three unit reviews did not.**

---

## Entry 20 — 2026-07-28 — Integration branch + a green floor: three boot defects fixed before touching GCP

Opening `DOD-NODE-DIR-GCP-1`. Before writing any GCP code I needed a runnable M12 node and a
trustworthy gate. Neither existed.

### The four P1 branches do not stack — none of them is a deployable M12 node

Entry 19 recorded "four branches awaiting Wave 2" as if they were sequential. They are not: each
was cut from a different base, and none contains the others.

| branch | base (merge-base with ae-append) | contains |
|---|---|---|
| `m12/role-manifest` | `d9da3f0d` | `computeDkgTopology`, replica-only guard |
| `m12/multiaddr` | `a060395c` | `buildBootstrapMultiaddr` |
| `m12/adapter-gcp` | `a7c2cc21` | **early draft — superseded** |
| `m12/ae-append` | — | anti-entropy + the FULL GCP adapter set |

So `m12/node-dir-gcp` is an integration branch off `ae-append` with role-manifest and multiaddr
merged in (**M12-D11**). `m12/adapter-gcp` is NOT merged and never will be (**M12-D10**): diffing
it against HEAD removes 486 lines and adds 48 — it has no KMS provider and no audit shipper at
all, and its one unique file (`gcs-cloud-storage-provider.test.ts`) is subsumed by
`gcp-adapters.test.ts`, which covers all three adapters. Entry 19's branch list was wrong; three
branches are live, not four.

**The one semantic conflict, in `directory-node.ts`.** role-manifest routed the DKG topology
through `computeDkgTopology(getCurrentManifest().nodes)`; ae-append had changed the same read to
`getVerifiedManifest()` (M12-D8). Taking either side wholesale silently drops the other's
security property. Resolved to `computeDkgTopology(getVerifiedManifest()?.nodes ?? [])` — validator-
only counting AND the verified node set. A merge that "auto-resolves" this cleanly is a merge that
lost something.

### Establishing the baseline BEFORE claiming anything

Full directory suite on the merged tree: **9 failures**. Rather than attribute them, I checked out
`m12/ae-append` and ran the same six files: **the same 9 failures, identical list.** The merge
introduced zero. That is the only way the rest of this entry is honest.

Isolation note: the primary checkout already owns port 5433 and an endorsements agent is using
that database, so this worktree runs its own Postgres on **5434** (`COMPOSE_PROJECT_NAME=cellom12`
plus a `ports: !override` file — compose *appends* port lists by default, which is why a naive
override tried to bind both). Four of the nine failures were that isolation: tests shelling out to
`docker compose` / `docker logs` resolve the DEFAULT project. Exporting `COMPOSE_PROJECT_NAME` and
`COMPOSE_FILE` for the run fixes those without touching code.

### Three real defects, and one of them was aimed at tonight

**1. An unreachable database killed the node with a raw stack and no CELLO event.**
`await s.loadProfiles()` was unguarded in both branches of the store factory. Reproduced directly:

```
{"event":"adapter.initialised", ... "implementation":"LocalAuditLogShipper"}
/…/pg-pool/index.js:45
    Error.captureStackTrace(err)
error: database "cello_nonexistent_test_db" does not exist
    at async PgDirectoryStore.loadProfiles (…/pg-directory-store.ts:233:20)
```

No `directory.*` event at all. This is *the* first-boot failure mode for a node pointed at a
freshly provisioned managed database — wrong host, wrong password, missing network grant — and on
a COS VM it lands in the serial console as an unattributable crash. I would have debugged it blind
tonight. Now: `directory.db.unavailable` carrying host, port, database and reason. The connection
string is never logged; it carries the password.

**2. The AC-010 schema-version guard was unreachable.** It ran *after* the store had loaded the
profile cache, so an un-migrated database always failed earlier on `relation "agent_profiles" does
not exist` — the symptom — and the guard whose entire job is to name the cause never ran. Moved
into `openStore()` ahead of the first schema read, behind an explicit `SELECT 1` probe so
"cannot connect" and "schema behind" remain **different causes with different events**. Confirmed
by the fix sequence itself: with the connectivity guard in but the reorder not yet done, an empty
database reported `directory.db.unavailable … reason: relation "agent_profiles" does not exist` —
right event mechanism, wrong cause. That output is what proved the ordering was the real bug.

**3. `DEPLOY-002 SI-002` was violated by the GCP adapter work.** The `CELLO_CLOUD` validation
interpolated `process.env["CELLO_CLOUD"]` directly inside a `logger.error` call. The rule is
enforced on the *syntax*, not on whether that particular key holds a secret — that is the point of
it. Hoisted to a local.

**Tests, corrected to test what they claim.** `persist-001` and `persist-002` both pointed at a
*non-existent* database while asserting `migration.out.of.date` — two different causes conflated.
Both now create a real un-migrated database and drop it after. `persist-001` gains the
connectivity case, which asserts the named event, asserts the credentials do **not** appear in the
output, and asserts it is not an unhandled rejection. Both derive Postgres coordinates from
`DATABASE_URL`, so a second worktree stops silently testing the other checkout's database.

`DEPLOY-001`'s key scan had flagged the consortium officer ROOT **public** key, which belongs in
the template. The blind "every 64-hex literal must be zeros or PLACEHOLDER" rule cannot tell a
public key from a private one, so it now consults an allowlist of exact literals, each documented
with where its private counterpart lives. Teeth preserved: a private key pasted anywhere — including
into that same parameter — still fails.

### Where it stands

**9 → 2.** The remaining two are `account-001` AC-005/AC-007, parked as **M12-P7** with the root
cause proven, not guessed: `verifyChain` recomputes each row's hash from its predecessor starting
at `CHAIN_GENESIS`, and ~10 test files `DELETE FROM user_accounts` as cleanup. Measured mid-run on
a *fresh* database: 2 surviving rows, at `id` 10 and 37 — 35 deleted. A whole-table chain assertion
cannot hold on a table the suite deletes from, so the test is green or red depending on file order
and database history. The product is correct; the defect is that tests delete from a table the
design calls append-only.

`pnpm run lint` clean, `tsc --noEmit` clean on the directory package.

**NEXT:** the unit proper — Cloud SQL credential path for `CELLO_CLOUD=gcp` (a `gcp`+`dev` node
still cannot boot), then the Terraform node module.

---

## Entry 21 — 2026-07-28 — DOD-NODE-DIR-GCP-1: the first GCP directory, and what it took to boot one

### The blocker Entry 19 named, closed

`CELLO_CLOUD=gcp` + `CELLO_ENV=dev` could not boot: the only database-credential path was AWS
Secrets Manager. `gcp-boot-env` now resolves the node's secrets from GCP Secret Manager with the
VM's attached workload identity and emits shell `export` lines the entrypoint evaluates — once,
before Flyway, so Flyway and the node share one fetch instead of two paths that drift.

Why the node fetches rather than being injected: Container-Optimized OS takes container
environment from instance metadata, and metadata is readable by anything holding
`compute.instances.get`. Key material must not travel that way. Metadata carries secret RESOURCE
NAMES; the values never appear in it.

Two Entry 19 owed items closed alongside: `nodeId`/`region` no longer derive from `AWS_REGION`
(which configures where AWS SDK clients talk, not where a node is — a GCP node was stamping
`us-east-1` on every log line and every `directory_nodes` row), and the SSM registry is skipped on
GCP naming the cause rather than reaching for an API that deliberately does not exist there.

### Three defects found before writing any GCP code, one aimed squarely at tonight

Establishing a green floor first turned up nine failures on the merged tree. Checking out
`m12/ae-append` and re-running gave **the same nine** — the merge introduced none. That baseline is
the only reason the rest is honest.

The one that mattered: **an unreachable database killed the node with a raw `pg-pool` stack and no
CELLO event at all.** `loadProfiles()` threw out of an unhandled rejection. On a cloud VM that is
an unattributable crash in a serial console — and it is the most likely first-boot failure against
a freshly provisioned managed database. I would have debugged it blind tonight. Related: the
AC-010 schema guard was **unreachable**, sitting after the profile cache load, so an un-migrated
database always failed earlier on `relation "agent_profiles" does not exist` and the guard whose
job is to name the cause never ran. Both fixed; `directory.db.unavailable` and
`migration.out.of.date` are now distinct causes behind an explicit `SELECT 1` probe.

### The unit review earned its keep — two blocking findings in the untested seam

Both were in the seam between the TypeScript and the shell, the half that had no tests:

**`set -e` does not abort on a failed `eval "$(cmd)"`.** The script's status is `eval`'s, and
`eval ""` succeeds, so the command substitution's failure is discarded. Every secret-resolution
failure was swallowed; the script then printed a `boot_env.resolved` success event that was false,
and the node died forty lines later claiming `RDS_CREDENTIALS_SECRET_ARN not available` — an AWS
Secrets Manager ARN, on a node holding no AWS credentials, blaming a migration that never ran.
Textbook error substitution.

**The exported `FLYWAY_URL` was dead.** The AWS derivation rebuilt it from `DATABASE_URL`,
appending `?sslmode=no-verify` — a libpq value that pgjdbc rejects outright (`Invalid sslmode
value`). The first migration on the first GCP node would have failed.

Eight further findings fixed (silent `NODE_ID` default violating DOD-INV-NODEID; two key purposes
silently allowed to share one secret; the unenforced stdout contract; a mandatory pre-auth issuer
key that would have forced a cross-region signing identity into every node; case-sensitivity
mismatch; a connection-class error reported as a schema cause; no flush before `process.exit`;
unencoded URL components). Three tests were called out and replaced: one passed whether or not the
code under test existed, one stayed green if two rows of the binding table were swapped (booting a
node with its identity seed as its transport key), and the `eval` line had no tests at all.
`gcp-entrypoint` now EXECUTES the script with a stubbed `node`; reverting the two blocking fixes
fails 3 and 1 of its assertions respectively.

The new tests also caught something unprompted: the `DATABASE_URL` `sed` expressions used GNU BRE
(`\(ql\)\?`), which **BSD sed silently does not match** — the AWS derivation was a no-op on macOS.

### Two more things that would only have failed later

**`RELAY_MANIFEST_SIGNER_PUBKEY` is `requireEnv` on every non-local node**, and a first node in a
new region has nothing to inherit it from. On AWS the value is set per region by `deploy.sh` from
that region's own node key, so it has always meant "this node's own public key". The node now
derives it and logs `relay.manifest.signer.derived`. This is a derivation, not a fallback, and the
safety argument is the failure direction: if a node were meant to trust a manifest signed by a
DIFFERENT node, deriving self makes it REJECT that manifest. No input widens what it accepts.

**The backup script was not in the image.** cloud-init's timer overrides the entrypoint to reach
`/app/packages/directory/scripts/pg-backup-to-gcs.sh`; the Dockerfile copied `dist/`, the
migrations and the entrypoint, and nothing else. It would have surfaced at 04:17 UTC as a backup
that silently never ran — and that backup is the only copy of a node's FROST shares off the VM
(anti-entropy never syncs `agent_key_shares`; Cloud SQL's own backups die with the instance).
`gcp-image-contents` now extracts every `/app` path the systemd units execute and asserts each
ships.

### The infrastructure

`terraform apply`: **43 added, 0 changed, 0 destroyed**, then 5 more. Everything `for_each`'d over a
map keyed by REGION, so two nodes in one region is unrepresentable and adding a region is adding
one entry — that is the DOD-INV-IAC region-expansion test, not a claim about it.

**Cloud SQL over Private Service Connect, not private IP.** Private IP requires Private Service
Access, which is a VPC peering into Google's producer network, and DOD-INV-NO-VPN forbids peering
outright. PSC creates no peering, no reserved range, no transitive route: the consumer end is a
forwarding rule in the node's own subnet. With `ipv4_enabled=false` there is no public IP to reach
at all. Live: the instance answers only at **10.10.0.3**, inside `cello-us-east1`.

Per node: its own Cloud SQL, its own KMS key ring and envelope key (a shared key would mean one
compromised node unwraps every other node's shares), its own three buckets with asymmetric grants
(**objectCreator** on audit and backups — write, never delete — so a compromised node cannot erase
its own trail), its own secrets replicated only to its own region, its own static IP.

Node address: **34.75.172.108**. Protocol ports 4000/8080 are open to the internet on purpose —
libp2p is Noise-encrypted and manifest-pinned, so the transport authenticates its own peers. That
is precisely what lets directories reconcile across clouds with no tunnel. The health port is not
in that rule.

One apply failure worth recording: the KMS key ring failed with a 403 because Terraform enabled
`cloudkms.googleapis.com` in the **same** apply and the enablement had not propagated. Re-apply
succeeded. Enabling an API and using it in one run is a race, not a config error.

### IAP SSH — the Entry 5 carry-forward, exercised

```
=== IAP LOGIN OK: cello-gcp-use1-8cpn Tue Jul 28 21:07:28 UTC 2026 ===
```

`gcloud compute ssh --tunnel-through-iap` works; port 22 is reachable only from 35.235.240.0/20.
The same session confirmed `docker-credential-gcr configure-docker` succeeds, so Artifact Registry
auth via workload identity is live, and showed the service in `activating (auto-restart)` with
`docker pull …:m12-ae76c386` exiting 1 — the image was still building. The retry loop behaves as
designed.

### Where it stands

The node is provisioned and its restart loop is healthy; it is waiting on its image. Still owed
before this line can flip: the live boot itself, the EMPTY-REGISTRY BOOT confirmation M12-D6 asked
for, and real-cloud proof for the three GCP adapters (which is what makes `DOD-ADAPTER-GCP-1` 🟡
today). DNS (`directory-gcp-use1.cello.mygentic.ai`) is deliberately not created — Route53 is in
AWS, which is hibernated, and the node does not need it to boot.

Directory suite: 2 failures of 1380, both the parked **M12-P7** chain assertion. lint + tsc clean.

---

## Entry 22 — 2026-07-28 — `gcp-use1` is LIVE, and the four things that stood between it and a boot

### Live evidence

```
HEALTH: {"status":"ok","nodeId":"gcp-use1","schemaVersion":49}
{"event":"directory.service.started","nodeId":"gcp-use1","region":"us-east1","environment":"dev","schemaVersion":49}
{"event":"adapter.initialised","adapterName":"BootstrapEndpoint",
 "multiaddr":"/dns4/directory-gcp-use1.cello.mygentic.ai/tcp/8080/ws/p2p/12D3KooWMH58hm8xpuwgwaNSvnvXBuc126jfuUMVbrGNcU2MeEAX"}
```

MIG instance health **HEALTHY**. Public address 34.75.172.108. Cloud SQL reachable only at the PSC
address 10.10.0.3, from this node's subnet, with no public IP and no peering.

`nodeId: gcp-use1` and `region: us-east1` — not `us-east-1`, which is what the `AWS_REGION` fix was
for. And the peerId is **unchanged across three instance replacements**, because the transport key
comes from Secret Manager rather than being generated per boot. That is the property that makes a
MIG safe for a stateful identity.

**EMPTY-REGISTRY BOOT confirmed** (M12-D6 asked for this in P2): `node.registry.skipped` with the
reason named, no relay in the pool, node healthy and serving. A GCP directory boots and functions
with no Parameter-Store equivalent, exactly as the decision predicted.

**IAP login** (Entry 5 carry-forward): `=== IAP LOGIN OK: cello-gcp-use1-8cpn Tue Jul 28 21:07:28 UTC 2026 ===`

### Four failures between "applied" and "booting", none of which reading would have found

**1. The node could not pull its own image.** `artifactregistry.reader` is not implicit — org policy
strips every automatic grant. Crash loop before a line of CELLO code ran.

**2. `objectViewer` does not include `storage.buckets.get`.** `GcsCloudStorageProvider` probes
`bucket.exists()` on a 404 because GCS 404s a missing BUCKET exactly as it 404s a missing OBJECT,
and returning "not found" for a mistyped bucket would report a config error as "no manifest
published yet" — which the relay-pool loader treats as benign and never retries. The probe is
deliberate, so `storage.bucketViewer` is the fix rather than removing it.

**3. Container-Optimized OS drops everything at the HOST firewall.** This is the one worth
remembering:

```
Chain INPUT (policy DROP)
1 ACCEPT all  state RELATED,ESTABLISHED
2 ACCEPT all
3 ACCEPT icmp
4 ACCEPT tcp  dpt:22
```

The VPC firewall rules were correct and useless — the packet is allowed onto the wire and then
dropped by the host. Every symptom pointed somewhere else: MIG health probes timed out, the
autohealer reset the instance on a loop, `nc` to 4000/8080 hung, and the SSH host key changed on
every attempt (COS regenerates host keys each boot from its read-only `/etc` overlay, so the
host-key churn was a *symptom of the reset loop*, not a separate problem). `cello-firewall.service`
now opens 4000/8080/9090, ordered `Before=cello-directory.service` so the probe path is open while
the container is still pulling — otherwise a slow first pull looks like an unhealthy node and the
autohealer fights the boot.

**4. The advertised bootstrap address was undialable.** The node published `/tcp/80/ws`, which
describes the AWS shape where an ALB fronts 80 → 8080. A GCP node has no load balancer and listens
on 8080 itself. Nothing would have caught this until `DOD-MANIFEST-GCP-1`, as clients failing to
connect with the cause two units away.

### The GCP adapters, proven against real cloud

Run inside the node's own container, as its own workload identity, against its own resources —
which is the only version of this proof that means anything.

**Cloud KMS** — `{"kms_roundtrip_ok":true,"plaintext_bytes":32,"ciphertext_bytes":112,"ciphertext_is_not_plaintext":true}`
and, on garbage ciphertext, `{"fail_closed":true,"threw":"3 INVALID_ARGUMENT: Decryption failed: the ciphertext is invalid."}`.
Share material wraps and unwraps; a bad ciphertext throws rather than yielding substitute bytes.

**GCS storage** — `{"missing_object_is_undefined":true,"missing_bucket_throws":true}`. The
distinction the adapter exists to make, holding against the real service.

**GCS audit shipper** — object present in `gs://cello-audit-gcp-use1/audit/2026-07-28/…jsonl` (123
bytes), verified from OUTSIDE the node.

A process note: my first audit proof reported `audit_shipped_without_error: true` while the bucket
stayed empty. The script had passed a logger whose `warn` was a no-op, and `ship()` reports a failed
write via `warn("audit.shipper.degraded")` — so I had written a hollow assertion into my own proof.
The bucket, checked independently, is what caught it. **Check the artifact, not the reporter.**

### The backup timer: run it, do not merely install it

Triggering `cello-backup.service` by hand found two independent defects, either of which alone
produces a nightly backup containing nothing — on the only copy of a node's FROST shares that
exists off the VM:

- The image shipped **pg_dump 15** (bookworm's default) against **Cloud SQL 17**. pg_dump refuses on
  a major mismatch. Fixed by installing `postgresql-client-17` from PGDG.
- The failure was **masked**: `pg_dump … | gzip > f || fail` reports the status of the LAST command
  in the pipeline. gzip compressed nothing and succeeded. Only the plausibility floor caught it —
  `dump is implausibly small (20 bytes) — refusing to upload it` — a guard written as
  belt-and-braces that turned out to be the only thing between this and a bucket of valid-looking
  empty backups.

Writing the tests then found the **same masking idiom a third time** in this unit, in the backup
script's own credential parsing: `eval "$(python3 …)"` swallowed `missing field: host` and surfaced
it as `DB_HOST: unbound variable`. Three instances of one shell idiom — `eval "$(cmd)"` and
`a | b || fail` both report the wrong command's status — is not a coincidence. It is the idiom, and
it is now tested by execution in three places rather than trusted by reading.

### Suite

2 failures of **1389**, both the parked M12-P7 chain assertion. lint + tsc clean.

---

## Entry 23 — 2026-07-28 — The reviews were right and the flip was wrong

Two reviews and one done-audit landed on `DOD-NODE-DIR-GCP-1` tonight. Between them they found
the two defects that mattered most in the whole unit, and both were in code I had already called
done. Recording that plainly, because the process point is the entry.

### I flipped the line while a reviewer was still running

The unit reviewer on the IaC half had not reported when I committed `✅ LIVE`. It came back with a
finding that **the live node's tamper-evidence guarantee was off** — which is exactly what the
"DONE means written AND reviewed" rule exists to prevent. The done-auditor then ruled both flips
non-earned and gave a clause-by-clause account. Both tags are demoted; neither returns to ✅ until
the fixes are applied and the remaining evidence is real.

### The two findings worth the whole review round

**One service account served every directory node.** Every per-node grant in `secrets.tf`,
`kms.tf` and `storage.tf` was `for_each`'d over the node map and bound to the SAME principal. The
resources were per-node; the access was not. At region 2 the VM in region B would hold
`secretAccessor` on region A's transport key, node key and database password, plus
`cryptoKeyEncrypterDecrypter` on region A's envelope key — one host able to unwrap every other
node's shares, which is precisely the single point of failure the sovereign-node topology exists
to remove. Each file's comment asserted the opposite. Invisible at N=1; automatic at N=2.

**The node connected to Postgres as the schema owner.** `V2__directory_schema.sql` builds the
append-only guarantee around `cello_service`: RLS policies are `TO cello_service`, and
`UPDATE`/`DELETE` are `REVOKE`d from it. The owner bypasses all of it — no table declares
`FORCE ROW LEVEL SECURITY` — so on `gcp-use1`, `conversation_seals`, `conversation_attestations`
and `agent_key_shares` were freely mutable by the application process. Two enforcement layers on
AWS, one on GCP, and nothing anywhere saying so. AWS has separate `cello_service` and `postgres`
secrets; GCP had one, and it was the owner's. Now two roles, two secrets, and an absent app
credential REFUSES rather than falling back — a fallback would silently restore the exact
configuration the split removes.

### And the reason "entirely from IaC" was false

`terraform.tfvars` — the whole `directory_nodes` map and the image tag — was **gitignored**, while
its own header read *"Committed on purpose: this file IS the answer to what exists."* A fresh clone
could not produce this node. The region-expansion test failed at step zero, and I had cited it as
evidence. The done-audit found this by checking `git ls-files`, not by reading the file.

Also demoted honestly: the running image was a **hand-run `gcloud builds submit` of the local
tree** — no trigger, no `repoSource`, no commit SHA, under a tag the registry does not enforce as
immutable. The project's own `DOD-CI-REGISTRY-1` defines CI-built as trigger-fired from a real push.
It is not that. And the backup timer never fired on its own schedule; I ran the unit by hand, with
zero agents registered, so `agent_key_shares` had no rows — the clause's actual subject was never
in the dump. The size guard cannot catch that case either: a data-empty schema dump is already 16 KB,
well over the 1 KB floor.

### Everything else the review turned up

- Cloud Build's P4SA held **project-level `secretmanager.admin`** — stronger than `secretAccessor`,
  over every secret in the project. So CI could read every node's keys, defeating through the front
  door the tfstate-scoping argument `secrets.tf` uses to justify generating them there. Scoped to
  the GitHub connection's own token secret.
- `update_policy = OPPORTUNISTIC` meant bumping the image tag produced a clean `terraform apply`
  while the node kept running the old image — and its cloud-init had the old tag baked into
  `ExecStartPre`, so it would pull that tag forever. State and reality disagreed with no signal,
  which is the same "which code is live" question the immutable-tag rule exists to answer. Now
  `PROACTIVE`.
- `prevent_destroy` was on the recoverable resources and absent from the unrecoverable ones. Added
  to the node secrets (**the transport key IS the peer id** — a re-apply mints a different one and
  strands a database of wrapped shares nobody can serve), the static IP (clients pin it), and the
  audit bucket, whose whole value is that the trail cannot be erased — including by Terraform.
- The backups bucket had a bare `age = 30` Delete. If the timer broke, the bucket emptied thirty
  days later and looked identical to a node that had never backed up: **the failure deleted its own
  evidence.** Now keeps the most recent dumps regardless of age.
- Region expansion claimed one entry and needed two. The subnet CIDR now derives from the node's
  own `subnet_index`, so the claim is true.
- `CELLO_BACKUP_DBNAME` was config with no consumer — the script takes the name from the credential
  secret. Deleted, so the dump and the node cannot disagree about which database they mean.
- Corrected the "node-only access" comment. The network facts are solid and I verified them
  independently of the Terraform meant to produce them — **0 VPC peerings, 0 VPN tunnels, Cloud SQL
  `ipv4Enabled=false`, `pscEnabled=true`, no IP address at all** — so DOD-INV-NO-VPN holds by
  construction. But subnets inside one VPC are mutually routable: placement constrains the ADDRESS,
  the credential constrains ACCESS. Claiming otherwise in the file an auditor reads to confirm it is
  worse than not claiming it.
- A stray 20-byte truncated gzip, an artifact of the failed `pg_dump`, had been committed at the
  repo root. Caught by the audit, not by me.

### What I take from this

The done-auditor has now overturned status flips on this milestone twice — Entry 15 and here — and
both times the unit reviews had already passed. The failure mode is not sloppy testing; it is
**believing a clause because the work behind it was real**, when the clause said something slightly
stronger than the work. "Proven on real cloud" for an adapter with no production caller. "Entirely
from IaC" for a node whose topology lived in one untracked file. Both were written in good faith
straight after doing genuinely hard work, which is exactly when the check is most needed.

The other rule that earned itself: **run the thing, do not merely install it.** Every defect in
Entries 22 and 23 came from running something — the timer, the boot, the adapters against real
cloud — and none from reading.

---

## Entry 24 — 2026-07-29 — N=3 across two continents, and anti-entropy running between them

The consortium exists. Three directory nodes, three regions, a signed manifest they all verify,
and a full anti-entropy mesh between them.

```
gcp-use1   us-east1      34.75.172.108    HEALTHY  schemaVersion 50
gcp-usc1   us-central1   34.136.176.190   HEALTHY  schemaVersion 50
gcp-euw1   europe-west1  34.34.166.245    HEALTHY  schemaVersion 50

{"event":"directory.manifest.store.loaded","manifestVersion":1,"verified":true}
{"event":"antientropy.round.started","peerNodeId":"gcp-usc1"}   from gcp-use1
{"event":"antientropy.round.started","peerNodeId":"gcp-euw1"}   from gcp-use1
{"event":"antientropy.round.started","peerNodeId":"gcp-use1"}   from gcp-usc1
{"event":"antientropy.round.started","peerNodeId":"gcp-euw1"}   from gcp-usc1
{"event":"antientropy.round.started","peerNodeId":"gcp-use1"}   from gcp-euw1
{"event":"antientropy.round.started","peerNodeId":"gcp-usc1"}   from gcp-euw1
```

Every node reconciling with both peers, over the authenticated libp2p channel, across two
continents, with **no VPN, no VPC peering and no Private Service Access** — verified against live
state, not against the Terraform meant to produce it: `networks peerings list` → 0 items,
`vpn-tunnels list` → 0 items, and each Cloud SQL instance has `ipv4Enabled=false`,
`pscEnabled=true` and no IP address at all. That is the whole thesis of the milestone working.

### The region-expansion test, measured

Nodes 2 and 3 were added as **one `directory_nodes` map entry each**. The apply created **99
resources** and **not one new resource block was written**. Each node got its own Cloud SQL over
PSC, KMS key ring and envelope key, three buckets, five secrets, a service account, a static IP, a
MIG and its cloud-init. Deriving the subnet CIDR from the node's own `subnet_index` is what turned
"two coordinated entries" into one.

### The manifest pipeline, and why nothing in it is typed by hand

`gcp-node-identities.sh` reads each node's key seeds from Secret Manager and pipes them into the
existing derivers on stdin (never argv — SI-001). Its output was checked against the running nodes:
the offline derivation of `gcp-use1` produced `7969e22a…113c` and `12D3KooWMH58hm8x…`, **byte-identical
to what that node logged for itself at boot**. That equality is the entire basis for trusting a
manifest built offline, and it is why the signer takes no hand-entered values.

`sign-gcp-consortium-manifest.mjs` then fails closed on the three ways a roster goes quietly wrong:
it verifies its own signature before emitting, refuses a duplicate `nodeId` (two entries under one
FROST identifier), and refuses two nodes sharing a signing key (one host answering as two members
of a quorum).

A **fresh officer key** in GCP Secret Manager, not the AWS one — M12-D4 requires zero shared runtime
state, and a shared officer would mean a manifest signed for one consortium verifies against the
other. It is granted to **no workload**: everything verifies with the public key, and a node that
could read the seed could mint a roster naming itself the whole consortium.

### The two failures on the way, both worth keeping

**Switching the node to `cello_service` immediately proved the split was real** — and broke the
startup guard, which queries `flyway_schema_history`. That table is owned by whoever ran the
migration; on AWS the node and Flyway are the same role so it is readable by construction, on GCP
they are deliberately different. Worse, the guard reported the denial as
`migration.out.of.date currentVersion 0` — a permissions fault wearing a schema fault's name,
sending an operator to re-run migrations that had already run. V50 grants SELECT (and nothing
more — a node that could write that table could rewrite the evidence of which schema it runs), and
the guard now separates the three causes it can actually see.

**Terraform's `indent()` does not indent the first line.** The manifest's opening brace landed at
column 0 inside a YAML block scalar, and cloud-init reported `Invalid format at line 66 column 1`.
The part worth remembering: **a cloud-config that fails to parse writes NOTHING.** The node came up
with no systemd units at all — `Unit cello-directory.service could not be found`, empty journal.
A total absence, rather than an error pointing at the file that caused it.

### Where the critical path stands

`DOD-NODE-DIR-GCP-2` and `-3` are ✅. `MANIFEST-GCP-1` is 🟡 — the directory half is live and
verified; the cello-client half (bundled manifest constant + publish) is owed. The relay is applied
and coming up. After that the path to a testable system is `E2E-GCP-1` itself.

---

## Entry 25 — 2026-07-29 — A real client reaches the GCP consortium; registration stops one step short

Drove the actual client against the live GCP system. Everything up to the DKG works; registration
does not yet complete. Recording the exact frontier rather than a summary, because the next session
should start from the evidence and not re-derive it.

### What is PROVEN working, client-side

```
directory.auth.manifest.verified   manifestVersion 1, signerCount 1
directory.consortium.resolved      declaredNodes 3, resolvedNodes 3
directory.bootstrap.resolved       http://34.75.172.108:9090 → 12D3KooWMH58hm8x…
directory.auth.challenge.verified  directoryNodeId gcp-use1
directory.signaling.connected      verified: true, manifestVersion 1
```

The client verified the officer-signed manifest, resolved **all three** GCP directories from it,
bootstrapped, and completed **step-6 directory identity auth** — the directory signed the client's
challenge with its node key and the client verified it against the manifest. Confirmed from both
sides; the directory logged `directory.auth.challenge.signed` for the same agent at the same
instant. That is `DOD-MANIFEST-GCP-1`'s step-6 clause, live.

### The frontier

```
directory.signaling.stream.ended   {"expected": true}
registration.failed                {"reason": "signaling_lost"}
```

The stream ends — and the client marks it **expected** — then registration fails one second later.
The directory shows no `register_request` or DKG event for that agent, so the ceremony never
started. What is NOT the cause, established rather than assumed: the dial works, Noise works, the
manifest verifies, identity auth passes, and all three nodes resolve.

### Four defects fixed getting this far, each invisible until the previous one was

Every one of these looked correct in isolation, which is the point:

1. **The manifest pointed at the libp2p port.** `endpoint: http://IP:8080` — 8080 speaks the
   WebSocket upgrade and answers plain HTTP with **400**. A correctly signed manifest resolved to
   ZERO reachable nodes. `/bootstrap` lives on 9090, which I had restricted to Google's probers. On
   AWS the ALB hides this with path-selective rules onto the same port.
2. **The advertised multiaddr named a host that does not exist.** `/dns4/directory-gcp-use1.cello.mygentic.ai/…`
   — those Route53 records live on hibernated AWS and were never created. Well-formed, reachable
   endpoint, undialable address. Fixed with `CELLO_DIRECTORY_BOOTSTRAP_MULTIADDR` — the seam
   `DOD-MULTIADDR-1` exists for.
3. **Capability checking was OFF** (Entry 24's commit) — and had I not found it, this test would
   have registered without a capability and the pass would have looked like evidence.
4. **The CLI could never pass a capability.** `register-agent` gated on `CELLO-`/`DEV-` prefixes; a
   capability is base64url JSON. `preauth-capability.ts` says it is "pasted into `cello register`",
   so a capability could be minted, signed and accepted by every directory and never get past the
   client. Fixed in cello-client (`cc994c1`) with a shape check that does NOT import
   `@cello-protocol/crypto` — the CLI does not depend on it, and adding a package to an operator's
   install for a paste-error guard is the wrong trade.

### Notes for whoever picks this up

- The whole test needs **no npm publish**: `CELLO_DIR` isolates the daemon profile and
  `CELLO_CONSORTIUM_MANIFEST` overrides the roster (M12-D4). The bundled manifest stays AWS.
- Run the CLI from `core/cli/dist/bin/cello.js` in the cello-client worktree to pick up the
  capability fix without publishing.
- Mint capabilities with `infra/scripts/mint-preauth-capability.mjs`. Verified against the
  **published** `@cello-protocol/crypto`: accepts the real one, rejects a flipped signature byte,
  rejects a different issuer.
- A unix socket path has a ~104-char limit — a `CELLO_DIR` under the scratchpad fails with
  `listen EINVAL`. Use a short path like `/tmp/cg2`.
- Andre's own daemon runs on `~/.cello/daemon.sock`; `CELLO_DIR` gives a separate socket, so this
  never touches it. Verified before starting anything.

---

## Entry 26 — 2026-07-29 — Correction: anti-entropy has never completed a round in production

**Entry 24 overstated it, and I repeated the overstatement to Andre.** I reported "a full
anti-entropy mesh across two continents" on the strength of `antientropy.round.started` from every
node to both peers. Rounds STARTING is not rounds COMPLETING. The same output carried
`antientropy.peer.auth_failed` and I attributed those to peers being mid-roll without checking.

Current, measured over a 10-minute window on `gcp-usc1`:

```
antientropy.round.started    6
antientropy.round.failed     0
antientropy.peer.auth_failed 12
    peerNodeId gcp-use1  reason protocol_error
    peerNodeId gcp-euw1  reason protocol_error
    peerNodeId unproven  reason "wire closed while waiting for ae_auth_a"
```

Symmetric: every node dials both peers, and every handshake fails. `protocol_error` is the
dialer's view, `wire closed while waiting for ae_auth_a` the responder's, of the same exchange.

This is the third time on this milestone that a status claim outran its evidence, and the shape is
identical each time: **a real thing happened, and I named something slightly stronger than the
thing.** Adapters initialised → "proven on real cloud". Topology applied → "entirely from IaC".
Rounds started → "a working mesh". The tell is always the same — the log line I quoted is upstream
of the property I claimed.

### What IS established, and what it cost to establish

The dial itself now works, and that was a genuinely separate defect worth its own entry:
`manifestEntryMultiaddr` derived the peer address from the manifest's `endpoint`, taking its port
verbatim. On AWS one ALB port fronts both `/bootstrap` and the WebSocket upgrade, so that was
correct by coincidence. On a node with no load balancer they are different listeners — so when I
moved `endpoint` to 9090 to make `/bootstrap` reachable for clients, anti-entropy began dialling
the HTTP server. Manifest, endpoint, peerId and signature were each individually correct.

Fixed by having a manifest entry carry an explicit `multiaddr`, authoritative when present, with
the derivation unchanged when absent so AWS and pre-M12 manifests are byte-for-byte unaffected.

And the failure had been reporting its cause as `"[object Object]"` — libp2p throws aggregates
rather than Errors, and `String({})` produces exactly that. `describeThrown` now unwraps
AggregateError's inner reasons and surfaces code/message from plain objects. Without that fix the
line above would still read `[object Object]` and this entry could not have been written.

### The frontier, precisely

Everything up to the AE handshake works: three directories healthy, manifest verified and
officer-signed, `/bootstrap` reachable, peers dialable, a live client completing step-6 identity
auth in both directions, and a relay registered.

Two things remain, and they are independent:

1. **The AE §1c handshake** — `protocol_error`. Both ends fail symmetrically. Start from
   `ae-channel.ts`'s `ae_auth_a` exchange and the responder's `buildAePeerAuthTbs` binding; the
   local convergence enforcer passes, so this is something the loopback harness does not reproduce.
2. **Client registration** — `signaling_lost` after a verified connect (Entry 25). The directory
   sees the stream open, presence go online, then close 0.4s later.

Neither is a config problem at this point; both are protocol-level and want a fresh session rather
than hour eighteen of this one.

---

## Entry 27 — 2026-07-29 — The AE failure is NOT the handshake; it dies at `ae_state`

Adding the dropped `detail` field changed the diagnosis completely, in one deploy.

**Before** (all the log carried): `reason: "protocol_error"` — the exit-point class. Three nodes,
twelve failures, one generic word, nothing actionable.

**After**:

```
{"event":"antientropy.peer.auth_failed","peerNodeId":"gcp-use1",
 "reason":"protocol_error","detail":"wire closed while waiting for ae_state"}
```

So the §1c mutual handshake **completes** — `ae_hello` → `ae_auth_b` → `ae_auth_a` all exchanged,
signatures verified, channel bound. The round then dies waiting for `ae_state`, the digest
advertisement that opens reconciliation. Entry 26 called this a handshake failure; it is not.

That reframes it entirely: manifest-pinned peer authentication works across regions in production.
What fails is the first round frame after it.

### Where to start next session

`ae-channel.ts`, the transition from handshake into `rounds` — the dialer builds a
`RemoteStoreView` and requests state; the responder should answer `ae_state` (one digest per
table). The responder's own log for these connections shows `wire closed while waiting for
ae_auth_a`, which is a DIFFERENT directed channel (every node dials both peers, so there are six),
not the other half of the same one. Pair them by `correlationId` before drawing conclusions.

The local convergence enforcer exercises this exact path and passes, so whatever differs is not in
the frame logic itself — candidates are the WS transport's framing under real latency, an
`maxInboundStreams` interaction, or a timeout the loopback never reaches.

### CORRECTED (same session): the migration guard is FINE — the harness was misconfigured

What follows was wrong, and is kept because the wrong conclusion is the instructive part.

`live-harness` hardcoded `localhost:5433` for both `DATABASE_URL` and `spineDbUrl`. `docker
compose` honours `COMPOSE_FILE`, so this worktree PROVISIONED and migrated its spine databases on
its own Postgres (5434) and then started the directory processes against the OTHER checkout's
(5433), where another agent's branch is applied. A directory counted THIS branch's migration files
(50) and read THAT branch's applied history (49). Measured both: `5434 max_rank=50`,
`5433 max_rank=49`.

So the guard was correct throughout and I nearly rewrote it. "The startup check that gates every
node in every environment is wrong" is a far more expensive conclusion than "the test harness is
misconfigured", and I reached for the expensive one because the cheap one required noticing another
agent shares this machine. Fixed the same way as persist-001: derive from `DATABASE_URL`.
`j-antientropy` is green again, 5/5.

### ORIGINAL, INCORRECT diagnosis follows

The enforcer currently fails to start its directories:

```
Successfully applied 50 migrations to schema "public", now at version v50   (×3, all DBs)
{"event":"migration.out.of.date","currentVersion":49,"requiredVersion":50}
```

Verified independently — `cello_spine_0` holds `count=50, max(installed_rank)=50`. The guard
compares `MAX(installed_rank)` against the migration FILE COUNT, and those are not the same
quantity: `installed_rank` is a per-database insertion sequence, not a version. This is the second
misfire from the same comparison (the first surfaced as a permissions denial reported as a stale
schema, fixed in V50/Entry 24's commit).

**The guard should compare the highest applied VERSION to the highest migration file version**, not
a row counter to a file count. Deliberately NOT changed at hour eighteen of this session: it gates
every node's startup on every environment, and getting it wrong strands the whole consortium. It is
the first thing to fix next session, and it currently blocks the local AE enforcer from running at
all.

### State

All three directories and the relay are healthy and serving on `m12-64ed4da5`. Nothing is merged;
everything is on `m12/node-dir-gcp` (and `m12/ae-client` for the CLI capability fix).

---

## Entry 28 — 2026-07-29 — AE has NEVER authenticated in production; four hypotheses falsified

A harder fact than Entry 26 had:

```
antientropy.peer.authenticated  0
antientropy.round.started      54
antientropy.peer.auth_failed  101
```

Zero successes since boot. This is not degradation over time — anti-entropy has **never completed a
round in production**. (`authenticated` is logged only after handshake AND rounds succeed, so zero
is consistent with dying at `ae_state` rather than proving the handshake fails.)

### Falsified, each by measurement rather than reasoning

1. **Inbound stream leak.** I believed `#serveInbound` never closed on the success path, exhausting
   `maxInboundStreams` after minutes — it fitted every symptom, including why a sub-minute local
   enforcer could not reproduce it. I wrote the fix and a test. **The revert test failed to fail:**
   removing the close left all three green, because `serveAeResponder` closes the wire in its own
   `finally`. The comment I doubted was right. Fix and test both DELETED rather than shipped — a
   redundant fix with a hollow test is worse than neither, because the next reader trusts both.
2. **Connection accumulation.** libp2p reuses per-peer connections; `dial` is idempotent.
3. **The restricted `cello_service` role cannot READ the AE tables.** Measured every one directly as
   that role: `agent_profiles`, `agent_revocations` (63 rows), `seal_notarizations`, `user_accounts`,
   `agent_suspensions`, `agent_presence` — all readable.
4. **The role cannot WRITE what Tier-B merge needs.** Also measured, and the grants turn out to be
   exactly right: the mutable tables carry `UPDATE`, while `user_accounts` and `seal_notarizations`
   do not — so the append-only guarantee holds AND anti-entropy can do its job. No conflict between
   the two, which was worth establishing on its own.

### Still standing

The responder throws `Cannot write to a stream that is closed`; the dialer sees the wire close while
waiting for `ae_state`. Deployed a `stage` marker through the responder's serve loop
(`awaiting_first_request` / `handling_<frame>` / `sending_ae_state`) so the next read says which
moment, not just which mechanism — the same technique that turned `protocol_error` into
`wire closed while waiting for ae_state`.

The local convergence enforcer is green again (5/5) after the harness port fix, so there IS a
working control to diff against. What differs between it and production is now a short list:
real WAN latency, three separate hosts, and simultaneous bidirectional dials on the same 60s tick.

---

## Entry 29 — 2026-07-29 — The AE failure, located exactly: streams reset mid-exchange, stage-independent

The stage marker settled it in one deploy:

```
"Cannot write to a stream that is closed (stage: sending_ae_state)"
"wire closed while waiting for ae_auth_a (stage: handshake)"
```

Read together with the dialer's `wire closed while waiting for ae_state`, the picture is complete
and it is NOT what any of the earlier hypotheses said:

- The responder **authenticates successfully**, receives `ae_state_req`, and **computes the digests
  without error** — `buildWireState` returns, since the stage advanced to `sending_ae_state`.
- The write of `ae_state` then fails: the stream is already closed.
- On a different directed channel the responder dies at `stage: handshake`, waiting for an
  `ae_auth_a` the dialer never sent.
- Both endpoints report that the OTHER closed.

So streams are being reset **at whatever point they happen to have reached** — stage-independent,
symmetric, and never once succeeding (`authenticated=0` across 54 rounds before this deploy). That
is a transport-level reset, not an endpoint decision. No amount of protocol-logic reading would
have found it, which is why the diagnostic mattered more than the reasoning.

### The leading hypothesis, and why it fits

**Simultaneous bidirectional dials.** Every node dials every peer on its own 60s tick, so A dials B
while B dials A. Two connections come into existence between the same peer pair; libp2p collapses
duplicates, and every stream on the losing connection is reset — at whatever stage it had reached.

It fits each observation: symmetric (both directions lose), stage-independent (the reset is
unrelated to protocol state), immediate (dedup happens at connection setup), permanent (every tick
recreates the race), and absent locally (the enforcer's three nodes converge in one pass rather
than sustaining a mutual 60s dial loop).

It is a hypothesis, and it is labelled as one. What is now established beyond it: the handshake
logic, the digest computation, the manifest, the peer identities, the database role and the dial
address are all correct — each verified by measurement rather than inspection.

### What the diagnostics cost and returned

Three small changes turned an undiagnosable failure into a located one:
`describeThrown` (a thrown non-Error rendered as `[object Object]`), logging the handshake's
`detail` (dropped at the log site), and the responder `stage` marker. Each took one deploy, and
each was necessary — without the first, the second could not be read; without the second, the third
had nothing to attach to.

The corresponding rule, earned three times on this milestone: **when a failure names its exit point
instead of its cause, fix the naming before forming another hypothesis.** I formed four hypotheses
against the un-named version and falsified all four.

---

## Entry 30 — 2026-07-29 — Mechanism found: closing the AE stream tears down the whole CONNECTION

libp2p's own trace, captured by running the container by hand with `DEBUG=libp2p*` (no deploy, no
IaC change — the node was stopped for 105s and restarted):

```
06:57:13.472  yamux:outbound:3  negotiating [ '/cello/anti-entropy/1.0.0' ]
06:57:13.543  yamux:outbound:3  negotiated protocol /cello/anti-entropy/1.0.0
06:57:13.603  yamux:outbound:3  closed writable end gracefully
06:57:13.603  yamux            sending GoAway reason=NormalTermination
06:57:13.605  yamux            underlying stream closed with status closed and 3 streams
06:57:13.605  yamux:outbound:3  transport closed
```

The protocol negotiates cleanly — both peers advertise `/cello/anti-entropy/1.0.0` (confirmed in
identify). Sixty milliseconds later the stream's writable end closes and **yamux immediately sends
GoAway, terminating the entire connection and all three streams on it** — including identify and
autonat, which had nothing to do with anti-entropy.

`streamWire.close()` calls `stream.close()`. On this transport that is not a stream-scoped close:
it takes the connection with it. And because `transport.dial()` REUSES connections (the same trace
shows `had an existing connection to 12D3KooW…`), every later round inherits a connection that was
already torn down — which is why the failure is 100% and stage-independent rather than a race.

It also explains the symmetry neatly: whichever side closes first destroys the shared connection,
so the other side's next read or write fails, and each honestly reports that the peer closed.

### Why the local enforcer never caught it

Same code, same protocol, same frames. The enforcer converges within its run and its assertions
read the DATABASES, so a torn-down connection after convergence changes no assertion. Production
runs indefinitely on a 60s tick, so the second round onwards always inherits the dead connection.
Time-to-second-round, not a code path, is the discriminator — the same shape as the earlier
falsified stream-leak theory, which is worth noting because I reached for a code-path explanation
twice before looking at lifetime.

### Next action (not yet made)

Close the STREAM without closing the connection — the libp2p idiom is to close the writable end and
let the reader drain, rather than `stream.close()` where that is connection-scoped. That change
belongs with a test that asserts a SECOND round succeeds on a reused connection, which is precisely
what no existing test covers: the enforcer must keep dialing past convergence for the assertion to
mean anything.

Everything up to this point is verified working in production: manifest signing and verification,
peer identity binding, protocol negotiation, the handshake, digest computation, the database role,
and the dial address.

---

## Entry 31 — 2026-07-29 — ROOT CAUSE: AutoNAT closes the shared connection out from under anti-entropy

libp2p's own trace, and it is unambiguous:

```
13.543  yamux:outbound:3  negotiated protocol /cello/anti-entropy/1.0.0
13.599  auto-nat          incoming request from 12D3KooWExQ… (gcp-usc1)
13.600  auto-nat          dial multiaddrs /ip4/34.136.176.190/tcp/8080/ws/p2p/12D3KooWExQ…
13.601  connection-mgr    had an EXISTING connection to 12D3KooWExQ…
13.601  auto-nat          successfully dialed 12D3KooWExQ…
13.602  connection        closing connection to /ip4/34.136.176.190/…      ← AutoNAT's cleanup
13.603  yamux:outbound:3  closed writable end gracefully                    ← our AE stream
13.603  yamux             sending GoAway reason=NormalTermination
13.605  yamux             underlying stream closed with status closed and 3 streams
```

A peer asks this node to verify ITS reachability (the AutoNAT dial-back). AutoNAT asks the
connection manager to dial that peer; the manager returns the **existing** connection — the one
already carrying our anti-entropy stream — AutoNAT records the address as reachable, and then
**closes the connection** as probe cleanup. Every stream on it dies, including AE, identify and
autonat's own. `@libp2p/autonat` logs the identical `Cannot write to a stream that is closed` from
`askPeerToVerify`, which is the same message the AE responder was reporting.

AutoNAT assumes the connection it "dialed" is its own to dispose of. When the manager hands it a
shared one, that assumption destroys other protocols' work.

### Why every earlier hypothesis failed, and why the local enforcer cannot see it

- **Not a race.** AutoNAT probes on essentially every new connection, so failure is 100%, which is
  exactly what `authenticated=0` across 54 rounds showed and what killed the simultaneous-dial idea.
- **Not stream lifecycle.** Both endpoints close correctly; the CONNECTION is destroyed beneath them.
- **Stage-independent** because the teardown is unrelated to protocol state — it lands wherever the
  exchange had got to, which is why the stage marker showed both `sending_ae_state` and `handshake`.
- **Locally invisible** because AutoNAT does not probe loopback/private addresses. The enforcer's
  three nodes are on 127.0.0.1, so the interaction cannot occur. **Public addressing is the
  discriminator** — not latency, not host count, not timing.

### The fix, and where it belongs

Directory nodes have public static IPs and known addresses. They do not need NAT detection at all —
AutoNAT exists for peers that must discover whether they are reachable. Disabling it for
server-role nodes removes the interaction rather than working around it.

That is a `@cello-protocol/transport` change (`autoNAT()` is unconditional in `createLibp2p`), so it
needs a server/client switch in `CelloNode` plus a directory-side opt-in — and it ships through
`/cello-publish` with the usual version cast. The alternative (give anti-entropy its own dedicated
connection) is strictly worse: it leaves a live footgun for every other CELLO protocol sharing a
connection, and FROST and signaling share connections too.

**This is the one that matters beyond M12:** any long-lived CELLO stream between two publicly
addressed peers is exposed to the same teardown. Anti-entropy surfaced it because it is the first
protocol to run continuously between two directory nodes.

---

## Entry 32 — 2026-07-29 — The AutoNAT fix is one flag; and the "flyway conflict" was a shared Postgres

Two fixes, unrelated causes, both of which had been wearing someone else's name.

### 1. `force: true` — the whole AutoNAT fix

Entry 31 established the root cause. I recorded the fix as a `@cello-protocol/transport` change
needing a server/client role switch and a publish cascade, and parked it as a genuine design fork
because directories SERVE the dial-back that client NAT detection depends on — so "just turn
autonat off on directories" would move a load-bearing piece of `DOD-NAT-REACHABILITY-1`.

Reading the library instead of reasoning about it collapsed the fork. `@libp2p/autonat`'s responder:

```js
connection = await this.components.connectionManager.openConnection(multiaddr, options);
...
finally { if (connection != null) { await connection.close(); } }
```

`openConnection` returns an EXISTING connection when one is open to that peer. `@libp2p/interface`
documents `force?: boolean` as "open a new connection to the remote even if one already exists".
A pnpm patch adding `{ ...options, force: true }` fixes it.

The part worth keeping: **`force: true` is what the code should always have done.** AutoNAT exists
to verify that a NEW inbound dial succeeds. Reusing an already-open connection proves nothing about
dialability — so the bug was not only destroying connections, it was answering the question it
exists to ask without testing anything. One flag, both defects. That is also why this beats all
three options I had parked: nothing moves architecturally, directories keep serving dial-back, and
FROST and signaling stop carrying a footgun that AE merely hit first because it runs continuously.

Guard added, because a patch that fails to apply is invisible: the Dockerfile copies `patches/`
into BOTH install stages and then greps the production tree for `force: true`, failing the build if
it is absent. Without the COPY the image builds clean and silently runs unpatched.

**Not provable locally.** The loopback enforcer cannot reach this path by construction —
autonat skips peers on the same host (`autonat.js:235`). Live deploy is the only proof.

### 2. The "flyway conflict" was never about migrations

Andre asked whether I was doing database upgrades, because it was causing conflicts on both sides.
It was, and the cause was not the migration files.

**Migration numbers were never in conflict.** `main` holds V45–48 + V51–54; this branch holds
V49–50. Disjoint, and they merge into a complete sequence. Nothing to renumber.

The real conflict: `docker-compose.yml` pinned the host port to `5433:5432`, so both worktrees
tried to bind one port. The second either died with "port is already allocated" or connected to
the FIRST checkout's server — and `ensurePostgres` does `DROP DATABASE ... WITH (FORCE)` +
`CREATE DATABASE` + Flyway V1→V{N} from scratch. Two agents therefore kept re-migrating a single
server to two different heads, and each saw the other's head as a broken startup guard.

The tell I missed: the comment at `live-harness.ts:242` describes this exact failure, because I
had already fixed **half** of it — the harness CONNECTS to whatever `DATABASE_URL` names. But the
compose file was still pinned, so a second worktree could not bring up a server of its own to
connect to. A half-fix to a symmetric problem looks like a fix and behaves like the bug.

`DATABASE_URL` is now the single knob: the harness derives `CELLO_PG_HOST_PORT` from it and passes
it to all seven `docker compose` invocations. Default stays 5433, so nothing on `main` changes.

**Running spine tests in this worktree** requires naming the port explicitly, e.g.
`DATABASE_URL=postgresql://postgres:dev@localhost:5434/cello_dev`. There is no ambient default that
would pick a free port — deliberately, since guessing is how the two checkouts collided.

### Where this leaves the critical path

The AE blocker has a fix in hand that has not yet run anywhere. Next is deploy + confirm
`antientropy.peer.authenticated` goes non-zero, then the registration `signaling_lost` frontier
(Entry 25) — worth re-testing after this lands, since a stream ending "expected" on a connection
somebody else closed is the same signature.

---

## Entry 33 — 2026-07-29 — Anti-entropy converges in production; the fix was one flag

`ae-autonat-f148aa27` rolled to all three directories. Steady state, 6-minute window:

```
antientropy.round.started      24
antientropy.round.completed    24
antientropy.peer.authenticated 24
antientropy.peer.auth_failed    0
```

Against a prior state of **0 authenticated and 100% failure**. Full mesh — 10 completed rounds
against each of `gcp-use1`, `gcp-usc1`, `gcp-euw1`, so every node reconciles with every peer
across two continents.

Stated precisely, because this milestone has three times had a claim outrun its evidence: what is
proven is that rounds COMPLETE and peers AUTHENTICATE. Production convergence of DIVERGENT state
is NOT proven by this — the local enforcer proves the algorithm, this proves the transport and
handshake, and neither proves that a write on one node lands on the others in production. That
remains `DOD-E2E-GCP-1`.

The 185 `auth_failed` in the wider 25-minute window are the pre-rollout instances. Reading only
that window would have shown "improved but still broken" and sent the next session chasing a fixed
bug — the narrow post-rollout window is the one that answers the question.

### What the two-day hunt actually cost, and the cheaper path

The bug was three lines of a dependency, and the fix was one flag already documented in
`@libp2p/interface`. What made it expensive was that every observable pointed away from it: the
failure was symmetric, stage-independent, total, and absent on loopback — which reads like a
protocol bug in the code I had just written, not a library tearing down a connection underneath it.

The step that finally worked was reading `@libp2p/autonat`'s source. I had reasoned about what
autonat *does* (probe reachability, both roles, no split) and parked a design fork on that
reasoning. The source said something different: it reuses an open connection and then closes it.
**Reasoning about a dependency's behaviour produced a fork; reading it produced a one-line fix.**

Same lesson as the `pnpm patch` guard: assert on the artifact, not on the intent. The Dockerfile
now greps the production tree for `force: true`, because a patch that fails to apply builds clean.

### Also fixed: the shared-Postgres "flyway conflict"

Andre asked whether I was running database upgrades, because it was causing conflicts on both
sides. It was — but not via the migrations. Numbers were disjoint (`main` V45–48 + V51–54, this
branch V49–50). `docker-compose.yml` pinned the host port, so two worktrees shared one server that
the spine harness DROPs and re-migrates from scratch. `DATABASE_URL` is now the single knob;
verified by running the AE enforcer on 5434 (all 5 green, V1→V50 on its own server) while the other
checkout's 5433 was untouched.

---

## Entry 34 — 2026-07-29 — Registration works against the GCP consortium; the same bug, on the other side

`signaling_lost` (Entry 25's frontier) is fixed. Four consecutive registrations against the live
GCP consortium, each a real 3-node FROST DKG — `directory.dkg.participant.signer.registered` from
`gcp-use1`, `gcp-usc1` AND `gcp-euw1`. Every node holds a share; no single-node fallback.

### It was AutoNAT again — on the client this time

The same defect as M12-P8, mirrored. `@libp2p/autonat`'s responder answers a dial-back by calling
`openConnection(peer)` — which returns an ALREADY-OPEN connection — and closes it in a `finally`.
On a client that is the connection carrying directory signaling. The yamux wire, which is what
finally settled it:

```
yamux:inbound:4  negotiated /libp2p/autonat/1.0.0   <- the DIRECTORY asks us to dial it back
yamux:outbound:3 closed writable end gracefully     <- the signaling stream
yamux sending GoAway reason=NormalTermination       <- whole connection, 3 live streams
directory.signaling.stream.ended
```

**I called AutoNAT falsified an hour before this, and I was wrong.** `DEBUG=libp2p:autonat*`
produced no output, and I read that as "autonat is not involved" — but the module logs under a
different namespace, so absence of logs was never absence of autonat. The correct reading of that
evidence was "this probe tells me nothing", not "hypothesis refuted". Only `libp2p:yamux*`, which
shows the actual protocol negotiated on each stream, could answer it.

### The fix, and the first attempt that failed

Directories and clients need OPPOSITE things, so the fix differs by side:
- **Directory** (trustless-cello): keeps the responder — clients' prober half depends on it — with
  the `force: true` pnpm patch so it stops closing connections it did not open.
- **Client** (cello-client): drops the responder entirely via `unhandle()`. The prober half opens
  OUTBOUND streams and needs no inbound handler, so `getDialability()` is unaffected. A client is
  not infrastructure; it has no reason to answer dial-back at all.

**A pnpm patch cannot be the client's fix.** Patches are workspace-local and applied at install
time; they do NOT ship to operators through npm. The directory can use one because its image is
built in this repo. cello-client needs a fix in its own source, which is why `unhandle()`.

The first attempt gated on `nodeType !== undefined`. It built, linted, and still failed — the
directory-signaling node is a long-lived CLIENT that deliberately leaves `nodeType` unset (its own
comment says so, and it already opts out of `relayServer` explicitly for the same reason). So the
gate was false on exactly the node being destroyed. The shipped version mirrors `relayServer` with
an explicit `autonatResponder: { enabled: false }`.

That is the falsification step from the debugging discipline — *does the fix location match where
responsibility actually lives?* — and skipping it cost a full test cycle. Green build, green lint,
same failure.

### Verified with the patch REMOVED

The decisive run deleted the pnpm patch from cello-client and reinstalled, confirming
`@libp2p/autonat` was unpatched on disk, before re-testing. Otherwise the patch would have been
carrying the result and the shipped fix would have been unproven.

### Owed
- **`dkg_failed` appeared once** and did not reproduce across four subsequent runs. Not chased;
  recorded because an intermittent DKG failure is not acceptable at launch. The client failed at
  `43.279` while the third node was still verifying the capability at `43.692`, which points at a
  client-side deadline rather than a node fault.
- **The DKG failure reason is not logged client-side** — `dkg_failed` with no detail, and
  `frost.directory.stream.open.retry` logs `error: "[object Object]"`. Both make the next
  intermittent failure harder to diagnose than it needs to be.
- The client fix ships through `/cello-publish`; not yet published.

---

## Entry 35 — 2026-07-29 — Anti-entropy replicates for real; sessions reach the last mile and stop

Ran a two-daemon, two-directory session to check whether the AutoNAT client fix (Entry 34) breaks
anything before proposing a publish. It does not — and the run proved two bigger things and found
one new blocker.

### Anti-entropy replication is CONFIRMED end-to-end (closes Entry 33's open claim)

`bob` registered against **gcp-usc1**. `aetestA`, connected to **gcp-use1**, first got
`unknown_agent` — then, after an anti-entropy cycle, found him. A write on one sovereign node
became readable on another with no operator action. Backed by counts on the wire:

```
antientropy.round.completed  applied: 2  peerNodeId gcp-usc1
antientropy.round.completed  applied: 1  peerNodeId gcp-use1
```

Entry 33 deliberately refused to claim this on the strength of rounds completing. This is the
evidence that was missing: `applied > 0`, and a lookup that changed answer because of it.

### Also proven in the same run

- **Cross-node registration** — `bob` registered through a directory that is not `aetestA`'s.
- **Cross-node brokering** — `session.crossnode.initiated brokerNode gcp-usc1`: the initiator
  VISITS the counterparty's home node to broker.
- **FROST threshold SIGNING** — `frost.directory.sign.start` →
  `session.ceremony.participated ok:true`. Distinct from the DKG; this is a live threshold
  signature over a real session.

### NEW BLOCKER: `assignment_parse_failed` — the two sides disagree about success

The directory believes it delivered:

```
session.assignment.delivery.complete  fullyEstablished: true
                                      initiatorGotAssignment: true, targetGotAssignment: true
```

The client cannot parse what arrived:

```
session.crossnode.failed  reason: assignment_parse_failed  brokerNode: gcp-usc1
```

Reproduced 3/3. It is NOT a timeout and NOT `session_request_error` — a frame arrived within
~0.3s and `parseSessionAssignment()` returned null (or the frame carried no `assignment` key), so
this is a SCHEMA disagreement on the cross-node/visiting assignment path, not transport.

**Not caused by the AutoNAT change.** The failure is at CBOR frame parsing, after the transport
carried the frame and after the signing ceremony succeeded. The AutoNAT fix governs whether the
connection survives; here it plainly did.

**Worth its own note:** `fullyEstablished: true` on the directory while the client fails is an
observability defect in its own right. A node reporting success for an exchange the counterparty
rejected is exactly the shape that makes a dashboard say healthy while nothing works.

### Where this leaves `DOD-E2E-GCP-1`

Everything up to the final assignment parse is green: register → discover across nodes → broker
cross-node → threshold-sign. The session does not establish. That parse is the next thing.

---

## Entry 36 — 2026-07-29 — The relay pool was never published; `assignment_parse_failed` is fixed

`assignment_parse_failed` (Entry 35) was never a client bug. The chain, end to end:

1. No `relay-manifest.json` existed in ANY of the three GCP buckets — the relay pool manifest had
   never been published for GCP.
2. Every directory logged `relay.manifest.not_found` and wired NO RelayPoolManager.
3. Session assignments were therefore issued with no `relay_endpoint`.
4. The client requires it (`session-assignment-parser`: `if (!relayEndpoint) return null`) and
   rejected the assignment — three hops from the cause, and on the wrong side of the wire.

Fixed with `infra/scripts/publish-gcp-relay-manifest.mjs` (new): derives the relay's identity from
Secret Manager, builds the manifest, signs it **once per node with that node's own key**, uploads
to that node's bucket.

### One manifest per node is not redundancy — it is the sovereignty invariant

`RELAY_MANIFEST_SIGNER_PUBKEY` is unset on these nodes, so `resolveRelayManifestSigner` falls back
to each node's OWN directory pubkey: every node verifies the relay roster against itself and will
not accept one because a peer signed it. A single shared manifest cannot work, and making one work
would mean giving all three a common signer — deleting the property deliberately.

### Two infrastructure defects found on the way

**The relay's health port admitted only Google's prober ranges.** The DIRECTORY health-checks each
relay before assigning a session to it, from a directory subnet — so every check would have timed
out, the relay marked unavailable, and the pool emptied even with a valid manifest. Added
`cello-relay-allow-health-internal`, sourced from the subnets themselves so a new region cannot be
forgotten. Confirmed by `relay.health.check.passed` afterwards.

**A directory that boots before its manifest exists can NEVER acquire one.** On `manifest not
found` the composition root does `mgr.stop(); return undefined` — the poll loop never starts. The
120s poll only helps nodes that had a manifest at boot. Publishing to a running fleet therefore
required a rolling restart. That is a real gap: the recovery path for "relay published later" is
an operator restart, and nothing says so.

### The mistake worth recording: I deleted a manifest that was correct

The first upload used a DEEP canonical sort; `buildCanonicalPayload` sorts **top-level keys only**.
Every node rejected it — and a bad signature is `process.exit(1)`, not a soft skip, so the fleet
crash-looped. I fixed the sort and republished, then read `relay.manifest.invalid` events inside a
`--freshness` window and concluded the fix had failed, so I deleted all three manifests.

Those events were the OLD manifest still cycling through the crash loop. The corrected manifest had
in fact loaded — proven afterwards by `relay.health.check.passed`, which only runs for a relay
already in the pool. **A time-windowed query is not a causal one:** `--freshness=4m` answers "were
there failures recently", never "did MY change fail". Every check after a fix now filters on
`timestamp > <recorded upload time>`, which is what finally showed `relay.manifest.refreshed
version 3, relayCount 1`.

The publisher now derives its canonical form to match `buildCanonicalPayload` exactly, verified
byte-for-byte against the real exported function before uploading.

### Where the session flow now stands

Each failure gave way to the next real one:

```
unknown_agent            -> anti-entropy replicated the profile
assignment_parse_failed  -> relay pool published (this entry)
counterparty_offline     -> presence replicated across nodes
ceremony_exhausted       <- CURRENT
```

`counterparty_offline` clearing is itself notable: **presence replicates across sovereign nodes**,
so a node learns that an agent homed elsewhere is online.

### NEW BLOCKER: `AGENT_NOT_BOOTSTRAPPED` after a node restart

```
frost.directory.commitment.response  ok:false  reason: AGENT_NOT_BOOTSTRAPPED   (gcp-euw1)
frost.debug.generateCommitment.no_share x9
adapter.profiles.loaded  6              <- profiles DO load
```

The node has the agent's PROFILE but no SHARE. aetestA's DKG registered signers on all three nodes
before the restarts; afterwards at least two report no share. Shares are deliberately never
replicated (`DOD-INV-SHARES-LOCAL`), so anti-entropy cannot heal this by design — which is exactly
the deferred **M8B enrollment / absent-node reconcile** problem arriving in production.

Not yet established, and the next thing to settle: whether the share is absent from the node's
DATABASE (dealt but never persisted) or present in the DB but missing from an in-memory structure
that only populates during a live ceremony. Those have completely different fixes, and the log
above cannot distinguish them.

---

## Entry 37 — 2026-07-29 — A SESSION COMPLETES ON GCP: two agents, two directories, one relay

```
initiate-session -> {"ok":true,"sessionId":"df2bf90a…","transportMode":"relay"}
receive          -> {"ok":true,"sequence_number":1,"senderPubkey":"09a391ed…"}
```

`alice` registered through **gcp-use1**, `carol` through **gcp-usc1**, in separate daemons and
separate OS processes. Alice discovered Carol across sovereign nodes, brokered the session, and
content crossed over the GCP relay. That is the core of `DOD-E2E-GCP-1` on the multi-cloud stack,
with AWS contributing nothing.

The received body is the auto-AWAY reply, which is correct: neither agent has an attending client,
so the daemon answers on the away path. The proof here is the TRANSPORT and the sequence number —
a frame was signed, relayed, and read by sequence on the far side.

### What had to be true, in order

Every one of these was broken earlier today and is now proven on the live system:

| capability | evidence |
|---|---|
| registration across the consortium | 3-node FROST DKG, all validators |
| cross-node discovery | `unknown_agent` cleared by anti-entropy |
| presence replication | `counterparty_offline` cleared |
| relay pool | manifest published, `relay.health.check.passed` |
| session brokering | `session.crossnode.initiated brokerNode gcp-usc1` |
| threshold signing | `session.ceremony.participated ok:true` |
| relay transport | `transportMode: "relay"` |

### The discriminator that made the previous failure legible

`ceremony_exhausted` / `AGENT_NOT_BOOTSTRAPPED` (Entry 36) did NOT reproduce with agents registered
AFTER the directory restarts. Fresh agents complete the identical flow that `aetestA` and `bob`
could not. So the defect is not in the session path at all — it is that agents registered BEFORE a
directory restart lose their usability, which is a far more serious claim and a different fix.

Stated as a hypothesis, not a finding: shares are dealt at DKG and are deliberately never
replicated (`DOD-INV-SHARES-LOCAL`), so if they do not survive a node restart, **every deploy
strands every existing agent.** That is launch-blocking if true. Not yet proven — the restart test
is next, and the crash-loop the fleet went through is a competing explanation that has to be ruled
out before blaming ordinary restarts.

---

## Entry 38 — 2026-07-29 — LAUNCH-BLOCKER: no FROST share had ever been persisted on GCP

Entry 37's hypothesis was right, and the cause was worse than "restarts lose shares".

```
adapter.write.failed  EncryptedPgShareStore
  ciphertext structural check failed: expected 1154 bytes (1126 + 28 overhead), got 1209
```

`SI-003` demanded `ciphertext.length === plaintext + 28` — raw AES-256-GCM. GCP Cloud KMS
`encrypt()` returns its OWN wrapped blob carrying key metadata, so its length is not a fixed
function of plaintext length. **Every share write on GCP threw.** `agent_key_shares` was empty,
and `sharesLoaded: 0` on all three nodes.

### Why nothing ever said so

`PersistentShareStore.storeShare` is **fire-and-forget** — `void this.#encrypted.storeShare(...)`.
So the surface everyone reads stayed green: registration returned `ok:true`, the DKG reported all
three validators as signers, and the agent worked *for as long as the directory process lived*.
The share existed only in the in-memory cache. Any restart, and:

```
sharesLoaded 0 -> generateCommitment.no_share -> AGENT_NOT_BOOTSTRAPPED -> ceremony_exhausted
```

Every agent registered before a restart was permanently unusable. **A single deploy would have
done that to every real user**, with a green registration path and no alarm.

### The fix

The equality bought nothing the bounds do not. SI-003 exists to catch a provider returning empty,
truncated, or unencrypted bytes — now checked directly, and one of those checks is strictly
STRONGER than what it replaced: `ciphertext === plaintext` catches a no-op "encryption" that an
exact-length rule could never catch for a same-length provider. Passthrough is tested before the
length bound, so it reports "returned the PLAINTEXT unchanged" rather than sending an operator
after a truncation bug.

### Verified, in order, on the live fleet

| step | before | after |
|---|---|---|
| share write | `adapter.write.failed` every time | no failures |
| `sharesLoaded` after restart | **0** | **2** |
| session for a PRE-restart agent | `ceremony_exhausted` | `{"ok":true,"transportMode":"relay"}` |

### What this says about the class of bug

Three failures today shared one shape: **a green surface over a broken write.** The relay manifest
was absent and the directory logged `not_found` and carried on. The share write failed and
registration returned `ok`. Both were fire-and-forget or soft-fallback paths where the only honest
answer was to fail loudly. The AutoNAT bug was the same shape from the other side — libp2p closed
a connection and both peers logged a clean EOF.

**Still owed:** the fire-and-forget write itself. A share write failure STILL cannot fail a
registration — the fix removes today's cause, not the mechanism that hid it. Registration should
not report success until the share is durable, or should at minimum raise an alarm that is not a
debug line nobody reads.

---

## Entry 39 — 2026-07-29 — Durable shares, and a US↔Europe session on GCP alone

`dkgRound3` now awaits `storeShareDurable()` (which already existed for DOD-REFRESH-1) and FAILS
the ceremony if the share cannot be persisted. A share this node cannot persist is a share it will
not have after any restart, so failing is the honest answer — the agent retries registration
instead of receiving an identity that quietly expires with the process. Deployed as
`durable-share-d963b31a`; `sharesLoaded: 2` after rollout, 1127 directory tests green.

Then the widest test yet, on GCP with AWS contributing nothing:

```
zoe  registered via gcp-use1  (US East)
yuri registered via gcp-euw1  (Europe West)
initiate-session -> {"ok":true,"sessionId":"e1b2233c…","transportMode":"relay"}
```

Two agents, two continents, two sovereign directories, one relay.

### `DOD-E2E-GCP-1` is 🟡 PARTIAL, deliberately not ✅

The happy path is proven end to end. Four clauses of that DoD line are NOT:

- kill one directory → sealing continues at T−1
- client failover to another directory
- kill-switch pause biting across all three nodes
- seal (sessions were established and messaged, never sealed to completion)

And the line asks for an **enforcer**, not a manual run. What exists today is a sequence I drove by
hand; it proves the system works now, not that it stays working. Marking this ✅ on the strength of
a green manual session would be the same overstatement this milestone has already made three times
— and the failure clauses are precisely the ones that protect the sovereign-node invariant, so
they are the LAST ones to take on trust.

### The through-line of today

Six defects, one shape: **a green surface over a broken write or a silent teardown.**

| defect | what lied |
|---|---|
| AutoNAT closes a shared connection | both peers logged a clean EOF |
| relay manifest never published | directory logged `not_found` and carried on |
| relay health port firewalled | pool would have emptied silently |
| SI-003 rejected every share write | registration returned `ok` |
| fire-and-forget persistence | DKG named every validator a signer |
| directory reports `fullyEstablished: true` | client had rejected the assignment |

Every one was invisible from the side that reported success. The lesson that actually generalises:
**when two components disagree about whether something worked, believe the one that says it
failed** — and go read the other one's write path.

---

## Entry 40 — 2026-07-29 — Threshold tolerance proven; failover was a black hole, now fixed

Two of `DOD-E2E-GCP-1`'s unexercised clauses, taken in order.

### (b) Kill a directory — the threshold holds

`cello-gcp-usc1` stopped (TERMINATED), then a fresh session between agents homed on the other two:

```
initiate-session -> {"ok":true,"sessionId":"1ac6abcf…","transportMode":"relay"}
```

2-of-3 with `T = majority(3) = 2`. The redundancy the sovereign-node invariant is FOR, on the live
system rather than in a unit test. Node restored afterwards.

### (c) Client failover — exercised, and it was broken

Running a daemon with the GCP manifest and NO `CELLO_DIRECTORY_URL`, registration failed with
`directory_signaling_timeout` while the log showed the same thing over and over:

```
directory.bootstrap.resolved     http://directory-us1.cello.mygentic.ai
directory.auth.challenge.failed  us-east-1  key_not_in_manifest
directory.auth.challenge.failed  us-east-1  key_not_in_manifest
```

The roster-aware resolver's step 3 (fail over) runs only when the primary resolver returns NULL —
i.e. when the primary's `/bootstrap` is UNREACHABLE. The AWS directory is perfectly reachable; it
is simply not a member of this consortium. So the primary resolved forever and failover never ran,
while `key_not_in_manifest` — an unambiguous "I am not in your consortium" — was ignored as a
failover signal. **A reachable non-member is strictly worse than an unreachable node**, and it was
the only case the design could not route around. Exactly the compiled-in default URL after a
consortium move, which is the case the bundled manifest exists to survive.

### The first fix was wrong, and the tests said so

I first checked the primary against the reachable ROSTER. Three existing tests failed — correctly.
The roster is *who answered /bootstrap just now*; a genuine member that is momentarily restarting
is absent from it, so that check turns a blip into a failover and routes around a node that is
merely coming back. I had conflated reachability with membership, which is the same mistake the
original code made in the other direction.

The shipped fix checks DECLARED manifest membership: local, no probe, and it cannot confuse "down"
with "not one of us". It is also cheaper than what was there before — the healthy path now costs
zero roster probes.

Verified live, no pinned URL:

```
directory.bootstrap.primary.not_in_consortium  memberCount 3
directory.bootstrap.failover                   to gcp-use1
directory.auth.challenge.verified              gcp-use1
registration ok
```

Merged to `main` alongside the other agent's `DOD-END-SURFACE-1`; gate green at 2127 tests.

**Worth keeping:** the three broken tests were the most valuable output of that attempt. A fix that
builds and passes the new test it came with is not verified — it is verified when the tests it did
NOT anticipate still pass.

---

## Entry 41 — 2026-07-29 — Messaging works both ways; the SEAL wedges and cannot be escaped

Continued through `DOD-E2E-GCP-1`'s remaining clauses. Clause (e) is broken, and the failure mode
is worse than "does not seal".

### What works

zoe (`gcp-use1`) ↔ yuri (`gcp-euw1`), both on failover-selected directories, no pinned URL:

```
send    -> {"ok":true,"sequence_number":2,"delivered":true}
receive -> {"ok":true,"sequence_number":0,"content":"Dispatched."}
```

Real bidirectional content, US↔Europe, over the GCP relay. The protocol's own guards behaved
correctly along the way — `session_not_current` refused a send while a message was unread, and
`sessions` showed the session ACTIVE on both sides with matching ids.

### What is broken: the seal-interrupted path has no exit

```
session.seal.leaf.submit.failed   reason: relay_submit_send_failed
session.seal.autoack.skipped      reason: relay_submit_send_failed
session.seal.broker.reconnected   brokerNode: gcp-euw1
session.seal.leaf.submitted       sequenceNumber: 5          <- both sides reached this
```

The reconnect path RECOVERED — both sides submitted their seal leaf after it. But the session never
reaches `sealed`, `sealed-receipt` returns `not_sealed_yet` indefinitely, and every subsequent
`close-session` on EITHER side returns:

```
seal_interrupted_in_progress — "Wait for session.interrupted.sealed … or times out"
```

`session.interrupted.sealed` never appears and the attempt never times out. **The session cannot be
sealed and cannot be closed.** The guidance names an escape that does not exist, which is the
worst kind of error message: it tells an operator to wait for something that will never happen.

Not chased to root cause — recorded with the exact evidence instead, because it is a self-contained
sub-investigation and the surrounding facts are what the next session needs.

### Where DOD-E2E-GCP-1 stands

| clause | state |
|---|---|
| fresh registration → DKG | ✅ |
| live two-agent session | ✅ (US↔US and US↔Europe) |
| kill one directory → threshold holds | ✅ 2-of-3 |
| client failover | ✅ (after fixing the non-member black hole) |
| anti-entropy convergence | ✅ `applied > 0`, lookup changed answer |
| **seal** | ❌ **wedges, no escape** |
| kill-switch pause across all three | ❌ not exercised |
| automated enforcer | ❌ still a manual sequence |

The happy path of the multi-cloud rebuild is proven end to end. What remains is the failure and
finalisation machinery — and one of those, the seal, is now known broken rather than unknown.

---

## Entry 42 — 2026-07-29 — CORRECTION to Entry 41: the seal is unproven, not broken

Entry 41 claimed the seal-interrupted path "wedges", that `session.interrupted.sealed` "never
arrives and the attempt never times out", and that a session "cannot be sealed and cannot be
closed". **That was wrong, and it was wrong in the specific way this milestone keeps repeating: I
named something stronger than the evidence supported.**

What the code actually does:

```js
const bilateralTimeoutMs = Number(process.env["CELLO_SEAL_BILATERAL_TIMEOUT_MS"]) || 660_000;
const sealedCompletion = await Promise.race([sealedP, timeoutP]);
```

**660 seconds — 11 minutes**, deliberately longer than the directory's 600 s delivery-grace window
so a bilateral timeout always expires AFTER the grace expires. And `close-session --force` exists
as an explicit operator escape for a half-open session.

Every one of my close attempts used a client-side timeout of 300–400 s. So I killed the CLI while
the daemon was still legitimately waiting, and the `seal_interrupted_in_progress` I then read as a
wedge was the concurrency guard doing its job — the `add`/`delete` pair is correctly bracketed in a
`try/finally`.

**The tell I ignored:** the guidance itself said "or times out". I quoted that line while asserting
no timeout existed, instead of going to look for the constant. Reading the message and reading the
code are not the same act, and I did the first while claiming the second.

### What is actually true about the seal

- No session has been OBSERVED reaching `sealed`; `sealed-receipt` returns `not_sealed_yet` in
  every attempt. That is where it stands — **unproven, not broken.**
- Both sides DO submit seal leaves, and the `relay_submit_send_failed` →
  `session.seal.broker.reconnected` → `session.seal.leaf.submitted` recovery works.
- Two smaller findings survive the correction and are real:
  1. The `seal_interrupted_in_progress` guidance names a timeout without saying it is ~11 minutes,
     and never mentions `--force`. An operator reading it has no way to know how long to wait or
     that an escape exists.
  2. `inbox` listed session `1ac6abcf…` under `sealed_unread` while `sealed-receipt` reported
     `not_sealed_yet` for the same id. Those two disagree; one is wrong.

### The rule this earns

**A timeout you did not wait out is not a timeout that does not exist.** Before calling a wait
"infinite", find the constant. The distinction is not academic — "wedged with no escape" would have
sent the next session rewriting a state machine that is behaving as designed.

---

## Parallel-branch entries (AE branch numbering) — PRESERVED FROM A MERGE

The `m12/ae-append` branch kept its own journal and numbered entries independently, so its
Entries 21–25 COLLIDE with the mainline Entries 21–25 above while describing different work.
Both are kept: discarding either loses a real record, and renumbering would break every
cross-reference already written against them. When a reference is ambiguous, the mainline
entries above are the ones the DoD and later entries point at.

## Journal integrity note (2026-07-28)

Entries below this line are APPENDED at end-of-file (reliable), not prepended. Several earlier
prepend edits (`python s.replace` with shifting anchors) silently no-op'd, so the detailed prose
for **Entries 9, 11, 12, 13, 15, 16, 17, 18, 19, 21** is not inline here — but each is preserved
verbatim in its git commit message (`git log -- docs/planning/user-stories/m12/M12-BUILD-JOURNAL.md`
and the feature commits). The DoD (status authority) and the RESUME STATE block at the top are
current; no status or code was lost. Commit log is the durable audit trail for those numbers.

## Entry 21 — 2026-07-28 — AE-APPEND-1 part 4: user_accounts + seal_notarizations specs (in review)

Two more Tier-A specs on the reviewed framework (branch m12/ae-append, commits f080faa8 +
2098007b), each audited against schema + every production UPDATE:
- **user_accounts** (key account_id): hashes account_id + phone_stub_hash; EXCLUDES
  email_stub_hash (nullable, absent from initial INSERT, backfilled — hash-chain.ts already
  excludes it from the chain → mutable → Tier B).
- **seal_notarizations** (key session_id+seal_type): hashes the immutable notarization content;
  EXCLUDES supersedes_notarization_id (BIGINT FK to another row's local BIGSERIAL id → forks) and
  correlation_id (per-flow). Append-only in production (supersession INSERTs a new row).
Spec-hygiene FORBIDDEN set extended. Fixed a real defect: a literal NUL byte had leaked into the
composite-key separator (git saw both files as binary) → replaced with the unicode escape (0 NUL
bytes remain). Directory suite 754 green; typecheck + lint clean. Review in flight.

Still owed (deferred with reasons): relay_registrations (deregistered_at flip), signal_records
(status amend), conversation_seals (+children), checkpoint tables (parked M12-P5). These need
Tier-B logic or the checkpoint decision first.

## Entry 22 — 2026-07-28 — AE pure-primitive layer complete (append + mutable) on m12/ae-append

The full publish-independent pure foundation of the AE data plane is built + (being) reviewed on
branch m12/ae-append. All are transport/DB-agnostic → unit-tested with no libp2p, no cloud:

- **set-reconciliation** (Entry 16) — bucketed digest + delta. Reviewed ✅.
- **record-hash** (Entry 17) — domain+table-separated content address. Reviewed ✅.
- **Tier-A encoders** (Entries 19/21) — append-only per-table specs (agent_profiles,
  agent_revocations, user_accounts, seal_notarizations), column classification schema-audited.
  Reviewed ✅ (part 4 fixes applied).
- **suspension-merge** (this session) — the kill-switch convergence (§4): burn=monotonic OR,
  higher seq wins, equal-seq suspended-wins + record-hash tiebreak, wall-clock type-excluded.
  Reviewed ✅ (semilattice proven by hand; hardening applied — INFO-1 invariant comment,
  tied-max-seq fold test).
- **presence-merge** (this session) — Tier-B liveness LWW (numeric updated_at, owning_node_id
  travels with the value, whole-row tiebreak). Review in flight.
- **ae-mutable-version** (this session) — Tier-B version summaries so a mutation on a shared key
  is detected; versionColumns == the merge-consulted set (suspension excludes wall-clock, presence
  includes it). Review in flight.

Known consumer obligation surfacing across the mutable primitives: paused/burned/online are
BOOLEAN columns — the consumer MUST normalize pg's JS-boolean vs string consistently before
hashing, or version hashes diverge (flagged to the version-summary reviewer; will document the
contract per the verdict).

**What remains for the AE data plane (all integration, not pure primitives):**
- The `/cello/anti-entropy/1.0.0` channel + mutual manifest-pinned handshake — needs a new crypto
  TBS builder in @cello-protocol/crypto → the NEXT publish cascade (Andre's `latest` step at the end).
- The apply transaction (insert-if-absent Tier A; pull-by-key + merge Tier B) — DB integration.
- pickup_queue/notification tombstones with bounded GC (§2 Tier B).
- The local 3-process convergence enforcer (DOD-AE-LOCAL-E2E-1) — ties it together.

## Entry 23 — 2026-07-28 — AE peer-auth TBS (crypto) + full AE foundation complete; three Tier-B reviews resolved

Tier-B merge reviews all returned and their BLOCKING findings are fixed (branch m12/ae-append):
- presence-merge: non-finite `updated_at` (malformed/hostile peer row) broke commutativity — NaN
  made `>` always-false so the merge returned the 2nd arg unconditionally. Fixed: normalize
  non-finite → -Infinity (valid always wins; two invalids → canonical tiebreak). +2 tests.
- ae-mutable-version: BLOCKING representation coercion — paused/burned/online are BOOLEAN
  (pg→JS boolean), last_seen_at/updated_at are TIMESTAMPTZ (pg→JS Date), NOT strings. Mixed
  reps across nodes → divergent version hashes → silent divergence. Fixed: normalize at the
  chokepoint (boolean→"true"/"false", Date→epoch-millis string). Plus the hollow-test gap: each
  merge module now EXPORTS its consulted-column set and the version test asserts
  `versionColumns ⊇ merge-consulted` (the load-bearing direction). +2 tests. Also fixed the
  literal-NUL-byte→escape in this file (was binary to git).
- suspension-merge: correct, no blocking; hardening applied (invariant comment + tied-max-seq fold).

New: **AE peer-auth TBS** in cello-client crypto (branch m12/ae-peer-auth, commit 4a4f0d2) — the
shared TBS for the directory↔directory handshake (design §1c): binds both nodeIds, both PeerIds
(channel binding), both nonces, timestamp; new domain cello-ae-peer-auth-v1; asymmetric (no
reflection); verify fails closed. 7 tests; crypto suite 287 green. Review in flight.

**The AE data-plane foundation is now COMPLETE (all pure + crypto pieces, each reviewed):**
reconciliation · record-hash · Tier-A encoders (agent_profiles, agent_revocations, user_accounts,
seal_notarizations) · suspension merge · presence merge · Tier-B version summaries · peer-auth TBS.

**What remains = integration only:**
1. Publish crypto to BETA (ships the peer-auth TBS) + re-pin directory — a `/cello-publish`
   cascade; the directory build resolves beta versions without the `latest` promotion (that stays
   operator-facing / Andre's). This is the next step, gated on the TBS review going clean.
2. The `/cello/anti-entropy/1.0.0` channel in the directory — libp2p handler + dial/reconnect +
   the handshake (consumes the published TBS) + the round driver (calls reconciliation + version
   summaries + merges + apply). The big integration unit.
3. The apply transaction (Tier-A insert-if-absent FK-ordered; Tier-B pull-by-key + merge; tombstones).
4. DOD-AE-LOCAL-E2E-1: the 3-process loopback convergence enforcer (partition/restart/rejoin).

## Entry 24 — 2026-07-28 — AE foundation reviews all resolved; crypto TBS publishing (v0.0.130)

version-reconcile review: FAITHFUL, no findings (reviewer confirmed termination rests on merge
IDEMPOTENCY, not just commutativity — carried to the e2e unit: assert round-2 pulls nothing).

AE peer-auth TBS review: SPEC faithful; fix-before-ship security items applied (the primitive
ships ahead of its channel, must self-defend): F1 injective TBS — reject embedded newlines + pin
nonces to 32-byte hex so the newline-join can't alias two param sets (verify fails CLOSED on a
bad set); F2 reject A==B (a self-handshake let one sig satisfy both directions); F3 extracted
shared hex.ts (manifest.ts now imports it, its 46 tests green); F4 documented the channel's
non-enforceable obligations (CSPRNG nonce, single-use store, timestamp window, peerIds from the
LOCAL Noise connection). crypto suite 291 green.

**Every AE foundation unit is now built + reviewed + findings fixed.** Publishing the crypto TBS:
merged cello-client m12/ae-peer-auth → main, bumped the 7-pkg cascade (crypto 0.0.24,
protocol-types 0.0.26, transport 0.0.26, gateway 0.0.6, daemon 0.0.77, cli 0.0.78, connect
0.0.88), tagged v0.0.130 — CI publishing beta now. This ships buildAePeerAuthTbs/verifyAePeerAuth
so the directory anti-entropy channel can compile against them.

Next after beta verify: re-pin trustless-cello directory to crypto ^0.0.24, then build the
`/cello/anti-entropy/1.0.0` channel (libp2p handler + dial/reconnect + the mutual handshake +
the round driver wiring reconciliation/version-summaries/merges/apply). The `latest` promotion
for v0.0.130 is operator-facing (Andre's) and NOT needed for the channel build.

## Entry 25 — 2026-07-28 — AE logic layer COMPLETE + two-node convergence proven

Beta v0.0.130 published (crypto AE TBS) + verified against the tarball; directory re-pinned to
crypto ^0.0.24 (buildAePeerAuthTbs importable, directory typechecks). Then built the remaining
logic-layer units on m12/ae-append, each reviewed or in review:

- **round planner** (planRound) — composes reconciliation + version-diff into per-table pull
  decisions; digest-match skip both tiers. Reviewed: no blocking, no false-convergence hole; 3 LOW
  test-teeth fixes applied.
- **handshake verification** (verifyPeerAuthFrame) — the channel security core: manifest-pinned
  pubkey + PeerId channel-binding + nonce + timestamp + signature, cause-naming reasons, fail
  closed. Review in flight.
- **anti-entropy engine** (runAntiEntropyRound) — one round of pull-and-apply over an injected
  AeStoreView. Review in flight.
- **two-node convergence PROOF** — in-memory test wiring the REAL encoders + merges: divergent
  nodes converge (Tier-A union; Tier-B higher-seq-wins with monotonic burn on BOTH nodes) and
  TERMINATE (2nd round applies 0). This is the convergence claim the earlier reviews deferred to
  "the e2e unit", now proven at the logic level.

Full directory suite: **806 passed, 0 failed.**

**The entire logic-level AE data plane is built + proven:** reconciliation, record-hash, Tier-A
encoders (4 specs), suspension/presence merges, Tier-B version summaries, version-reconcile,
peer-auth TBS (published), round planner, handshake verification, and the engine + convergence
proof. ~27 review passes across the session, every finding fixed, 2 publishes (v0.0.129 ROLE-
MANIFEST, v0.0.130 AE TBS).

**Remaining = infrastructure integration (needs the directory's live libp2p + Postgres):**
1. A pg-backed AeStoreView (SELECT the synced tables → the encoders for advertise; INSERT-if-absent
   / merge-upsert for apply — the pg store MUST replicate the MemStore semantics the proof used;
   agent_revocations BYTEA `signature` hex-encoded per the encoder header).
2. The `/cello/anti-entropy/1.0.0` libp2p handler: dial/reconnect, the handshake over the stream
   (verifyPeerAuthFrame + our own signed frame), the digest→detail→pull round protocol + write-hints.
3. Manifest gains `peerId` population + the directory VERIFYING its manifest at load (design §1a/§1b).
4. DOD-AE-LOCAL-E2E-1: the live 3-process loopback enforcer (partition/restart/rejoin; assert
   round-2 pulls nothing per the idempotency-termination note).
This phase is proven by a multi-process integration test, not unit tests — a distinct mode from
the logic layer above.

---

## Entry 43 — 2026-07-29 — Published to beta and promoted; the seal's root cause is the ABSENT-NODE PROFILE gap

### The publish shipped and is verified against the binaries

`v0.0.134` → transport **0.0.29**, daemon **0.0.81**, cli **0.0.82**, connect **0.0.91**
(crypto/protocol-types/gateway unchanged — no source changes). CI green including
`Published-artifact smoke test (tag)`, which is the clean-install signal rather than a green
pipeline. Verified on the TARBALLS, not the local tree:

- `transport@0.0.29` → `autonatResponder`, `unhandle` present
- `daemon@0.0.81` → `not_in_consortium`, `getManifestPeerIds`, **and `consent_notified_at`**
- every cross-pin a real version, no `workspace:*` anywhere

`consent_notified_at` matters beyond my own work: npm `daemon@0.0.80` had been stale against two
committed daemon changes. 0.0.81 is what actually ships them, and a re-publish at 0.0.80 would
have looked green and shipped nothing.

Andre promoted all seven to `latest` and restarted his daemon. **Live validation on AWS
production**: `directory_signaling: connected`, all five agents online, every standing receiver
armed, zero errors in the following window. The AutoNAT responder removal does not regress the
client against a consortium that is not GCP.

The publish guard also did its job: my first `git tag` was BLOCKED because I had loaded
`/cello-publish` for the PREPARATION, not for this publish. Loaded-once really is not covered.

### The seal: root cause identified, and it is a known deferred defect

Both sides return `seal_unilateral_timeout` — *"the directory could not verify the reported root,
**or the certificate failed verification**"*. The second clause is the true one.

Directory-side, for the whole flow, exactly one event:

```
seal.certificate.legibility.built   participantCount 2, finalMessageAnswered false
```

No notarization event, and — decisively — **no `seal.single_key.anomaly`**. That warn fires only
when a profile EXISTS but yields no primary pubkey. Its absence means `getProfile(initiator)`
returned `undefined` outright. The directory then takes the documented fallback:

> "No primary_pubkey registered for this initiator — fall back to M1 single-key notarization …
> The single-key path **will be rejected by M2 clients**."

So the directory notarizes with a single key, the client correctly refuses it, and the client's
only symptom is a timeout. **The seal machinery is working; it is being fed a missing profile.**

`agent_profiles` (which carries `primary_pubkey`) IS in the anti-entropy table set, so the DATA
replicates. What does not is the node's IN-MEMORY view — and that is the deferred M8B item recorded
in `.claude/CLAUDE.md` verbatim:

> "**Absent-node reconcile:** a node that stayed up but wasn't in the quorum should pick up an
> agent's identity from replication into memory without a restart (today the in-memory profile
> cache only loads at boot)."

`adapter.profiles.loaded 6` fires once at boot; `sam` and `tess` registered after it. A node that
was not in their DKG quorum therefore has no in-memory profile for them until it restarts — and if
that node is the one asked to seal, the seal degrades to single-key and fails.

**Not yet proven, and the next step:** confirm that the sealing node is specifically one that was
absent from the agent's DKG quorum, and that restarting it makes the same seal succeed. That
experiment distinguishes "cache never populated" from "profile genuinely absent from this node's
DB", which have different fixes — and the second would mean anti-entropy is not carrying profiles
as intended, which is a much larger claim.

### Also owed, found on the way

The relay ships only `[RELAY] Peer connected/disconnected` to Cloud Logging — no structured events
for seal-leaf submission. That hop is opaque, and it is exactly the hop between "client submitted"
and "directory never saw it". Diagnosing anything that crosses the relay currently requires
guessing.

---

## Entry 44 — 2026-07-29 — THE SEAL COMPLETES on GCP; but I could not prove WHY it started working

### The result

```
close-session (tess) -> {"ok":true,"sealed_root":"efabec57bc12e8122ef61635a075086efb4b8761ece461a866ca8978cd0d9a28", ...}
close-session (sam)  -> {"ok":true,"sealed_root":"efabec57bc12e8122ef61635a075086efb4b8761ece461a866ca8978cd0d9a28", ...}
sealed-receipt       -> ok:true, legibility certificate attached
```

**Identical sealed root on both sides**, a notarized legibility certificate, and a retrievable
receipt. `DOD-E2E-GCP-1`'s seal clause is met. The complete chain now runs on GCP with AWS
contributing nothing:

register → 3-node FROST DKG → cross-node discovery → presence replication → cross-node brokering →
threshold signing → relay session → bidirectional messages → **bilateral seal + notarized receipt**.

### What I got wrong on the way, and did not ship

Entry 43 named the cause as the boot-only in-memory profile cache, quoting the deferred M8B
"absent-node reconcile" item — which fits the symptom perfectly and is written down in CLAUDE.md as
a known gap. It was the obvious answer.

**It is also wrong, and reading the code rather than the symptom is what showed it.** The seal path
calls `#resolvePrimaryPubkey`, and that already uses `getProfileWithReadThrough` — a DB query whose
own docblock describes exactly this bug and says "fixing it at the store layer fixes every
getProfile consumer at once". A read-through would have found the row if the row existed. So the
boot-only cache cannot be the explanation.

Which leaves the row genuinely absent from the sealing node's DATABASE at the time — anti-entropy
replication lag, not a cache. The restart is then a red herring: ~30 minutes also passed, which is
plenty of anti-entropy cycles.

**I cannot distinguish those two from the evidence I have**, and the restart confounded the
experiment by changing both variables at once. Saying "the cache was the cause" would have been the
third time this milestone I named something the evidence did not support — and it would have sent
someone to fix a cache that is already fixed.

### The experiment that settles it

Register a fresh agent, then IMMEDIATELY attempt a seal brokered by a node that was not in its DKG
quorum, with no restart:
- fails, then succeeds minutes later on its own → **replication lag**
- fails until that node restarts → **the cache path is not being taken**, and the read-through is
  not reaching this call site the way the code suggests

One run, one variable. Until then the honest statement is: **a recently-registered agent may fail
to seal on a node that was not in its DKG quorum, and the window closes on its own or on restart.**

### Launch relevance

Not cosmetic. Registrations are continuous in production, and the sealing node is whichever one
brokered — frequently not one of the DKG quorum. If the window is replication lag it is bounded and
probably tolerable; if it needs a restart it is not. That is the whole reason the distinction is
worth one clean experiment rather than a guess.

---

## Entry 45 — 2026-07-29 — The relay never got the AutoNAT patch; and three more traps behind it

### 1. The relay was running UNPATCHED autonat the whole time

The relay is a SERVICE node, so it KEEPS the AutoNAT dial-back responder. Unpatched, that responder
answers a probe by calling `openConnection(peer)` — returning the ALREADY-OPEN connection — and
closing it. For a client, that connection is its relay link.

Live evidence before the fix:

```
session.standing_receiver.reservation.lost  x31   reason: relay_connection_gone
[RELAY] Peer connected / Peer disconnected         (constant churn, seconds apart)
close-session -> relay_stream_closed
initiate-session -> counterparty_did_not_accept
```

The same `reservation.lost / relay_connection_gone` pair appears in Andre's PRODUCTION daemon.

**Why it was missed:** when the patch landed I fixed `packages/directory/Dockerfile` and never looked
at `packages/relay/Dockerfile`. Without `COPY patches/`, pnpm installs the UNPATCHED package and the
image builds perfectly clean. The relay had been shipping unpatched since the patch existed. Both
stages now copy `patches/` and assert `force: true` in the production tree, so an unpatched relay
fails the BUILD.

Post-deploy the peer churn stopped.

### 2. My relay manifest publisher baked in an EPHEMERAL private IP

`healthCheckUrl` used the relay's private IP, correct at publish time — and the VPC-internal address
is exactly right, since the public one is firewalled to Google's probers. But a MIG instance
replacement changes it: `10.10.0.14` → `10.10.0.27`. Every directory's health check then failed, the
pool emptied, and sessions returned `relay_unavailable`.

Republishing at v4 fixed it, but that is an operational trap, not a fix: **any relay replacement
silently breaks every session until someone re-runs the publisher.** The durable fix is a STATIC
INTERNAL address (`google_compute_address` with `address_type = "INTERNAL"`) pinned into the
instance, so the value in the manifest cannot go stale. **Owed.**

### 3. Cross-region relay health checks abort

```
relay.health.check.failed   "This operation was aborted"
relay.pool.unavailable      x2
```

The check has a 5 s timeout (`relay-pool-manager.ts:153`). Cross-region latency inside the VPC is
~30–90 ms, so 5 s is not tight — an abort means the request HUNG, not that it was slow. Some nodes
pass while others fail, so it is not a blanket firewall block. Undiagnosed; recorded with the exact
signature. **Owed.**

### 4. The seal question: BOTH branches of the decisive test were falsified

A Fable subagent traced the profile path from source and established, with file:line evidence:
- `primary_pubkey` is `TEXT NOT NULL`, written in ONE atomic INSERT, and `agent_profiles` has no
  UPDATE grant — so a row-exists-but-key-missing window CANNOT occur. That kills the cache theory.
- Anti-entropy DOES carry `primary_pubkey` (`AGENT_PROFILES_SPEC.immutableColumns`).
- Its decisive probe: look for `directory.profile.read_through` around the failed seal.
  `read_through_miss` → the row was genuinely absent; line ABSENT → the build predates the fix.

I ran it. For the failing initiator the line **never fired at all** — and the deployed build is
current, so it does contain the read-through. **Both branches are falsified**, which means the seal
path did not reach `#resolvePrimaryPubkey` the way both of us assumed. The honest state is that the
mechanism is still unknown, and the next probe must start from "which call actually produced the
single-key fallback", not from the profile store.

### 5. Where the ceremony now fails, and why it is probably EXPECTED

Latest run: `ceremony_exhausted` for an agent registered AFTER the last restart. Shares are
deliberately never replicated (`DOD-INV-SHARES-LOCAL`), and a DKG runs over a QUORUM, not all N — so
a node outside that quorum legitimately holds no share and cannot co-sign. If the broker picks that
node, the ceremony fails. That is the deferred **M8B enrollment / Problem 3** item arriving in
production, not a new bug:

> "a node that was down/absent during a DKG holds **no share** and can't co-sign for that agent
> until it gets one via a *resharing ceremony*"

Stated as the leading explanation, NOT as established — confirming it means showing the failing
node was outside that specific agent's DKG quorum.

---

## Entry 46 — 2026-07-29 — Reliability measured properly; two claims of mine retracted, one new divergence found

### Retraction 1: the enrollment gap is NOT the cause of `ceremony_exhausted`

I named M8B "enrollment / Problem 3" as the cause twice — in Entry 45 and to Andre — on
pattern-match, not evidence: "no share" resembled the no-share problem I already knew about.
Andre asked me to be precise about what I meant, which forced the check I should have run first:

```
directory.dkg.participant.signer.registered  ->  gcp-use1, gcp-usc1, gcp-euw1   (ALL THREE)
```

Every node holds a share for every agent registered here. No node is absent, so enrollment cannot
apply. **Enrollment is a real, documented, deliberately-unbuilt feature (the resharing ceremony) —
it is simply not what was failing.**

### Retraction 2: `ceremony_exhausted` is no longer occurring at all

Across the last two hours: every `frost.debug.generateCommitment.share_lookup` reports
`shareFound: true` with a consistent `:epoch:1`, and there are **zero** `no_share` events. The
epoch-mismatch theory I floated next is also unsupported. The instances I saw are fully explained
by the SI-003 share-persistence bug (Entry 38) — a CLOSED cause. My "~60% reliably green, one
defect explains it" was stale and overconfident on the diagnosis.

### What the system actually does now, measured

| test | result |
|---|---|
| sessions, client freshly connected | **3/3** |
| sessions after a directory instance REPLACEMENT, client NOT restarted | **3/3** |
| sessions while one directory is TERMINATED (2-of-3) | ✅ |
| `directory_below_threshold` | only when Terraform replaced ALL THREE directories + the relay at once — the client recovered on its own afterwards |

**The client recovers from a rolling directory replacement without a restart.** That is the
redundancy half of the sovereign-node invariant, demonstrated rather than assumed.

### NEW: the initiator accumulates sessions the counterparty never received

```
sam  (initiator): 12 sessions, ALL "active"
tess (target)   :  4 sessions, ONE active — and that one still in pending_session_requests
```

`initiate-session` returns a sessionId and the initiator marks the session ACTIVE, while the target
has no record of it. The initiator then cannot seal — `close-session` on the target returns
`session_not_found` for a session the initiator considers live. This is the same shape as the
directory logging `session.assignment.delivery.complete fullyEstablished: true` for an assignment
the client rejected (Entry 35): **one side declares success for a two-sided fact.**

Partly harness-induced — my loop created sessions faster than the target accepted them, which a
real operator would not do. But two things are NOT harness artifacts and are worth fixing:
1. the initiator marks a session `active` on an assignment the target may never have acted on, and
2. those phantom sessions ACCUMULATE with no expiry, so the initiator's session list drifts
   permanently away from reality.

There is an `expired_session_requests` bucket on the inbox, so an expiry concept exists on the
TARGET side; the initiator appears to have no equivalent.

### The rule this session keeps re-teaching

Three times today I named a cause that the evidence did not support — AutoNAT "falsified" by a
silent debug namespace, the seal "wedged forever" against an 11-minute timeout, and enrollment as
the ceremony failure. Each time the tell was the same: **I reached for a mechanism I already knew
about instead of the one the logs pointed at.** The check that would have caught all three costs
one query.

---

## Entry 47 — 2026-07-29 — Entry 46's "divergence" was an ABUSE BOUND working correctly; the seal is intermittent

### Retraction 3: the initiator/target session divergence is not a defect

Entry 46 reported that sam held 12 "active" sessions while tess had 4, and framed it as the
initiator marking sessions active that the target never received. The target's own log says
otherwise:

```
session.inbound.accept.failed   reason: "abuse_bound_sessions_per_sender"   x8
```

`perSenderCap = resolveTierBound(agentName, tier, "max_sessions")` — a TIER-BASED cap, and sam is
an unknown/untrusted contact to tess. tess was refusing sessions because an untrusted sender had
too many open with her. **That is the trust-tier abuse protection doing exactly its job**, and my
loop tripped it by opening a dozen sessions without closing any.

Proven by clearing it: `close-session --force` on tess's four stale sessions, and the very next
`initiate-session` was received normally (`ok:true`, no `session_not_found`). Then a full exchange
worked — `delivered:true`, and tess read `"Clean end-to-end validation. [[WRAP]]"` by sequence.

**One real finding survives:** the directory logged `targetGotAssignment: true, fullyEstablished:
true` for sessions the target REFUSED. `targetGotAssignment` evidently means "we wrote the frame to
the target's stream", not "the target accepted". A refusal is invisible to both the initiator and
the directory's telemetry, which is the same shape as Entry 35's `fullyEstablished` problem.

### The seal is INTERMITTENT — this is the honest headline

Confirmed successes, both sides, matching roots:
- `656e71c4324461a5286abce9d3a830256f2a92c2d6289e3bb3a0ad4cc266e31d`
- and one earlier bilateral seal with a retrievable receipt

Confirmed failures, including the clean run above with no abuse bound in play and content
verifiably delivered both ways:
```
sam  -> seal_unilateral_timeout
tess -> seal_unilateral_timeout
```

So sealing is not a missing feature and not a broken path — it succeeds sometimes and times out
other times, under conditions I have not isolated. Everything upstream of it is reliable:
registration, discovery, presence, brokering, threshold signing, relay transport, and bidirectional
messaging all passed repeatedly today, including 3/3 through a directory instance replacement with
the client untouched.

### Corrected reliability picture

| stage | state |
|---|---|
| register → DKG → discover → session → message | reliable (3/3, 3/3 post-replacement) |
| tolerate one directory down / replaced | reliable |
| **seal** | **intermittent — the one thing standing between "runs" and "runs every time"** |

### Three retractions in one day

Enrollment as the ceremony cause (Entry 46), the boot-only profile cache as the seal cause
(Entry 44), and now the session divergence. Each was a mechanism I already knew about, reached for
because it resembled the symptom. The pattern is now unmistakable enough to state as a rule:
**when a symptom resembles a known problem, that resemblance is the reason to check harder, not
the reason to stop checking.**

---

## Entry 48 — 2026-07-29 — Seal path traced; and I killed the production daemon with an unscoped pkill

### Operational mistake, recorded because it has a rule attached

I used `pkill -f "cello-daemon.js"` to cycle my throwaway GCP test daemons. That pattern is NOT
scoped — it killed **Andre's production daemon**, repeatedly. All five live agents went offline each
time and the Claude Code MCP connection died with `ipc_connection_lost`. I only noticed because an
inbound CELLO event failed.

**`CELLO_DIR` isolates a test daemon's socket and database. It does NOT isolate it from a process
name.** I had a memory telling me to prefer `cello logout`/`login`, and I read it as being about
teaching operators a clean workflow rather than about not breaking the live machine. Restored with
`cello login` and verified: daemon running, signaling connected, all five agents online with
standing receivers armed, prior session state intact. Memory rewritten as a hard rule with the
consequence attached.

Separately, macOS cleaned `/tmp` mid-session, taking the test daemons' `CELLO_DIR`s — and therefore
their registered agents and databases — along with the signed manifest. The rig now lives in the
session scratchpad. **Test state that must survive should never sit in `/tmp`.**

### Sealing WORKS on AWS — so the failure is environment-specific, not a broken feature

`cello_inbox` surfaced a sealed session on `CELLO_Feedback` (`5b07cd90…`, the DOD-RECEIVE-GUIDANCE-1
live proof from 2026-07-23) with a complete four-message transcript. That session sealed. Whatever
is failing on GCP, the seal machinery itself is sound.

### The seal path, traced (correcting my own earlier reading)

1. `submitSealLeaf` sends the leaf to the **relay**, which acts as seal witness
   (`session-node-manager.ts:3136` — `if (!entry.relayClient) return relay_unavailable`).
2. On escalation the client sends a UNILATERAL seal request to the directory, and it **CARRIES the
   leaves in the request** — `directory-node.ts:4129`: `const leafData: RelaySealData = { leaves:
   carried.leaves, … }`. The directory does NOT fetch them from the relay.
3. The directory rebuilds the CONTENT-HASH merkle root from each leaf's `s2.content_hash` and
   compares it to the reported root (`:4326`); mismatch → `unilateral_root_unverifiable`.

**This matters for diagnosis.** I had assumed the directory pulls seal data from the relay, which
would have made a directory→relay reachability problem the natural suspect. It doesn't. Since the
leaves are carried, and failing seals produce **zero** directory-side seal events, the unilateral
request is not arriving at the directory at all — the failure is upstream of any root verification,
and the client's error text ("the directory could not verify the reported root") describes a
verification that never ran.

### Next probe, stated so it is not re-derived

Rebuild the rig, reproduce a failing seal, and determine whether the client ever emits the unilateral
request and whether the directory logs receiving it. The two outcomes have different fixes:
- request sent, no directory event → transport/routing between client and directory on the seal path
- request never sent → the client abandons before escalating, and the timeout is a symptom of the
  bilateral wait, not of directory verification

Also owed from this entry: the client's `seal_unilateral_timeout` guidance names a cause
("the directory could not verify the reported root") that the code cannot have reached in this
failure mode. A message that asserts a specific upstream cause it did not observe sends the reader
to the wrong component — the same class as `fullyEstablished: true` for a refused session.

---

## Entry 49 — 2026-07-29 — The seal bug LOCALIZED: legibility fires, then nothing

A cross-review session with Ms_Chelly (M9) produced a cheap test that killed two hypotheses in an
hour — one hers, one mine-because-I-accepted-hers — and localized the real defect without
reproducing anything.

### Correction to Entry 48

Entry 48 recorded, as established, that failing seals produce ZERO directory-side seal events, and
reasoned from there that the unilateral request never arrives. **False.** I had queried a
25-minute window. At 240 minutes, `notarization.recorded` exists for sessions I had filed as
failures. The mechanism was never wrong — the FRAME was. Those are the expensive ones, because the
conclusion looks derived rather than assumed.

### The timestamps

```
13:03:28.636  seal.certificate.legibility.built   03c3d9a1
13:03:31.239  notarization.recorded               (+2.6s)
13:03:31.297  conversation.seal.recorded

13:56:16.722  seal.certificate.legibility.built   9f36817c
13:56:19.211  notarization.recorded               (+2.5s)
13:56:19.258  conversation.seal.recorded
```

Both successes are strictly sequential, ~2.5s apart. **Not two writers racing** — the hypothesis
that symmetric single-event loss implied unordered writers is refuted.

### The failures are TWO unrelated modes, not one symmetric one

```
notarization + conversation.seal.recorded, NO legibility   -> 7bd1cb39, e397a715
legibility ONLY, nothing after                             -> ad9315b6, 9faa39c3
```

The first pair are **not failures**. Those are the abuse-bound sessions the counterparty never
joined, so the directory recorded a UNILATERAL seal with no bilateral legibility — correct
behaviour that I had bucketed as failure because the client returned an error. My "symmetric loss"
was an artifact of my own bucketing.

**Only `legibility ONLY` is the bug.**

### Localization

In both successes, notarization follows legibility within 2.6s. For `ad9315b6` the log stops dead
at `legibility.built` 14:33:53. The step between those two events is `#resolvePrimaryPubkey` — and
for that same failing seal, `directory.profile.read_through` **never fired at all**, on a build that
contains the read-through and reaches it on every cache miss.

A call that leaves no trace and produces no subsequent event is a call that did not return. Working
hypothesis, now narrow enough to be worth stating: `legibility.built` → `#resolvePrimaryPubkey`
hangs → notarization never happens → the client waits out its bilateral window and reports a
verification that never ran.

### Owed, and its own defect

The client's `seal_unilateral_timeout` guidance says "the directory could not verify the reported
root". In this failure mode the directory never reached verification. **A message asserting an
upstream cause it did not observe** sends the reader to the wrong component — same class as
`fullyEstablished: true` for a refused session, and as a `mode:"enforcing"` label on a socket
nothing had exercised.

Also owed, and worth doing FIRST because it changes what every later log line means: a member node
that holds no share for a given agent has no error code of its own. It surfaces as
`AGENT_NOT_BOOTSTRAPPED`, which reads as a client fault, so the operator debugs the client while the
truth is on the other side. That is error substitution. One code names it.

### The gate this earns

The fix for the SI-003 share bug (Entry 38) currently asserts that the encrypted WRITE succeeds.
That is still green about the wrong noun, just a nearer one: **the write succeeding is not the share
surviving.** Only a process that no longer holds the value in memory can distinguish them. The gate
to write is: register → restart the node → require a ceremony to complete.

---

## Entry 50 — 2026-07-29 — Entry 49's localization was wrong; the seal stalls on a CO-SIGNATURE, not a hang

### The correction

Entry 49 localized the seal defect to `#resolvePrimaryPubkey` hanging, on the reasoning that
`directory.profile.read_through` never fired for the failing seal even though the deployed build
contains the read-through. **That inference was wrong, and reading the function instead of grepping
around it is what showed it:**

```ts
async #resolvePrimaryPubkey(kLocalPubkeyHex, correlationId) {
  const cached = this.#primaryPubkeys.get(kLocalPubkeyHex);
  if (cached) return cached;                                    // <-- returns, logs NOTHING
  const profile = await this.#store.getProfileWithReadThrough(...);  // <-- only this logs
```

A missing `read_through` means the in-memory cache **HIT**, not that anything hung. Confirmed
against a 6-hour window: 22 `read_through` events exist, every one `cache_hit`, every one for a
single unrelated pubkey. So `resolvePrimaryPubkey` returned a key promptly for my agents, and the
stall is downstream of it.

Same failure shape as the earlier one, one level up: I read the ABSENCE of a log as evidence of a
stall, when the code has an earlier return that logs nothing. **An absent log is only evidence if
every path through the code would have logged.**

### Where the seal actually stalls

Directly after the primary-pubkey resolution, in the threshold branch:

```
// SESSION-005: Push seal_verified to initiator; wait for seal_frost_signature.
```

The directory **cannot notarize alone**. It pushes `seal_verified` to the initiator and waits for
the client to return `seal_frost_signature`. No co-signature → no `notarization.recorded`. That is
not a hang inside the directory; it is a bilateral handshake with one side never answering.

This fits every observation without strain:
- `legibility.built` fires (the broker did its half)
- `notarization.recorded` never does (still waiting on the client)
- the client reports `seal_unilateral_timeout` (it was waiting too)
- intermittent, because it depends on whether the frame reaches the client at all

### The prime suspect, already documented in the codebase

`close-session-handler.ts` carries this, verbatim:

> "Fix #1 (cross-node seal-liveness): if this session was brokered by another node, the
> `seal_verified` + `session_sealed` frames are pushed by that BROKER — but the initiator released
> its visiting connection after setup, so on the home stream they never arrive and close times out.
> Re-open a transient visiting connection to the broker … for the duration of the seal."

A known failure with a known fix — and `session.seal.broker.reconnected` DID appear in a client log
earlier today, so that path runs. The question is now narrow and concrete: **does the transient
visiting connection reliably come up, and does `seal_verified` arrive on it?** Every seal I ran was
cross-node (agents deliberately homed on different directories), which is exactly the population
this fix exists for.

### Next probe

Client-side, on a failing seal, look for `seal_verified` arriving and `seal_frost_signature` being
sent. Three outcomes, three different fixes:
- `seal_verified` never arrives → the visiting connection is the defect (Fix #1 not holding)
- it arrives and no co-signature is sent → the client-side seal responder
- both happen and notarization still doesn't → the directory's receive path

Not guessing between them. The client logs carry it, and the rig now lives in the scratchpad rather
than `/tmp`, so the next run's logs will survive to be read.

---

## Entry 51 — 2026-07-29 — Seal reproduced with logs that survive: `seal_verified` never reaches the client

Rebuilt the rig (see the socket note below), reproduced a failing cross-node seal, and captured
both sides. Entry 50's prediction was right and the three-way probe resolves to branch 1.

### Proven: the client's seal_verified handler NEVER RUNS

Every path through that handler logs something — `session.seal.ceremony.abort`,
`.ceremony.participated`, `.ceremony.failed`, `.frost.signature.sent`, or `.frost.signature.send.failed`.
**None appear in the initiator's log.** This is the case where an absent log IS evidence, precisely
because Entry 50's trap does not apply: there is no silent early return.

So the directory is waiting for a co-signature the client was never asked for.

### The timeline, cross-referenced

```
18:19:35.619  session.seal.leaf.submitted        client (ann)
18:19:35.619  session.seal.autoacknowledged      client
18:19:35.628  seal.certificate.legibility.built  DIRECTORY (gcp-euw1)   <- 9ms later
              (directory pushes seal_verified to the initiator around here)
18:19:42.962  session.seal.broker.reconnected    client, brokerNode gcp-euw1  <- 7.3s LATER
              (nothing after; no notarization ever recorded)
```

The directory acts on the seal leaf within 9ms. The initiator's transient visiting connection to
the broker — the one `Fix #1` exists to provide, because the initiator RELEASED its visiting
connection after session setup — is not up until 7.3 seconds later.

### What is proven vs inferred

**Proven:** the handler never ran; the directory built legibility and never notarized; the broker
reconnect happened 7.3s after the directory had already processed the leaf; both closes hung and
returned nothing.

**Inferred, and NOT yet established:** that the push lands in the gap. The ordering is consistent
with the directory pushing `seal_verified` before the client's listener exists, but I have not
confirmed the directory actually attempted the push, nor on which stream. `session.seal.autoacknowledged`
at the same millisecond as the leaf submission suggests this trace mixes the auto-ack path
(responding to the OTHER side's close, which I launched 3s earlier) with this side's explicit close
— so the two events at 35.619 may not both belong to ann's own close. That has to be untangled
before naming a race, and it is exactly the kind of "obvious" reading that has cost me four
retractions today.

**Next probe, narrow:** a directory-side log at the push site. `legibility.built` fires and
`notarization.recorded` does not; there is no event in between saying whether `seal_verified` was
sent, to which peer, and on which stream. One log line there converts the whole inference into a
fact — and its absence is why this took a full reproduction to get this far.

### Rig note, because this cost a cycle

`CELLO_DIR` under the session scratchpad FAILS: the daemon dies with
`listen EINVAL: invalid argument …/daemon.sock` because the unix socket path is 134 chars and the
platform limit is ~104. I recorded this in Entry 25 this morning and walked into it again this
evening. `/tmp` is short enough but macOS cleaned it mid-session and destroyed the agents' databases.
The rig now lives at `~/.cellorig` — short AND durable. Both properties are required and neither
`/tmp` nor the scratchpad has both.

---

## Entry 52 — 2026-07-29 — SEAL ROOT CAUSE: Fix #1 was applied to one of the two paths that submit seal leaves

The instrumentation added in Entry 51's "next probe" paid off on the first run. Root cause is
proven end to end, to the millisecond, and reproduced twice.

### The trace

```
18:41:56.555  CLIENT     session.seal.leaf.submitted   + session.seal.autoacknowledged
18:41:56.612  DIRECTORY  seal.certificate.legibility.built              (+57ms)
18:41:56.615  DIRECTORY  seal.certificate.deferred  initiator_stream_absent   (+60ms)
18:42:01.529  CLIENT     session.seal.broker.reconnected  gcp-euw1     (+4.97s — TOO LATE)
```

Earlier run, same shape, 7.3s late. The new `seal.certificate.deferred` event is what made this
legible: before it, the directory's failure branch was a bare `enqueueNotification` with no log.

### The chain

1. B closes. The directory asks A (the initiator) to AUTO-ACKNOWLEDGE.
2. A's auto-ack path calls `submitSealLeaf` **directly** —
   `session-node-manager.ts:3286`: `void this.submitSealLeaf(agentName, sessionId, correlationId)`
   — with no visiting connection to the broker, and fire-and-forget.
3. The directory acts on that leaf within 60ms, builds the certificate, and goes to push
   `seal_verified` to the initiator. `#streams.get(initiatorHex)` is **undefined**: A reached the
   broker over a VISITING connection it released after session setup.
4. The frame is ENQUEUED instead of sent. The directory then blocks in `#pendingFrostSeals` waiting
   for a co-signature it has just declined to ask for.
5. ~5 seconds later A's own explicit close runs, and THAT path does re-open the broker connection
   (`session.seal.broker.reconnected`) — too late; the frame is already in the queue.
6. Both sides wait out their windows. The client reports `seal_unilateral_timeout`, naming a
   directory verification that never ran.

### The defect in one sentence

`close-session-handler.ts` carries "Fix #1 (cross-node seal-liveness)", which re-opens a transient
visiting connection to the broker for the duration of the seal — **and it was applied only to the
explicit-close path.** The auto-acknowledge path submits a seal leaf over a connection that does not
exist, and it is the path that fires FIRST whenever the counterparty closes first.

That is why sealing is intermittent rather than broken: whoever closes second takes the auto-ack
path and loses. The two successes earlier today were the orderings where the initiator's connection
happened to still be up.

### Why it took a full day

Every layer reported success about something adjacent to the thing that failed:
- the client's `seal_unilateral_timeout` names directory verification, which never ran
- the directory logged `legibility.built` and then nothing at all
- the auto-ack path `void`s its submission, so nothing awaits or reports it
- and the deferral branch — the actual failure — had no log whatsoever

Four retractions came out of that fog (enrollment, profile cache, session divergence, and Entry 49's
`resolvePrimaryPubkey`). Every one was a mechanism I already knew, reached for because it resembled
the symptom. The thing that finally worked was adding one log at the exact point where two
components disagree, and it took ten minutes.

### Fix

Apply Fix #1 to the auto-acknowledge path: ensure the broker visiting connection exists BEFORE
submitting the seal leaf, not after. Next entry.

---

## Entry 53 — 2026-07-29 — The seal fix landed the ordering and exposed the real gap: the RESPONDER has no broker entry

My Entry 52 fix works and is not sufficient. Both halves are worth recording because the second is
architectural, not a race.

### The ordering race IS closed

```
19:07:54.577  B: seal.leaf.submitted                 (B closes first)
19:07:57.155  A: seal.autoack.broker.reconnected     <- the fix: connection open BEFORE submitting
19:07:57.496  DIRECTORY: seal.certificate.deferred   <- 341ms AFTER it opened
19:07:57.498  A: seal.leaf.submitted
```

Previously the reconnect landed ~5s AFTER the directory had already deferred. It now lands 341ms
BEFORE. The race is gone, and the deferral persists — so the timing was never the whole story.

### The real gap

The deferral names the initiator whose stream is missing: `d48a9b802e3ba6bf` = **bob2**, not ann.

- **bob2** is homed on `gcp-euw1`
- the seal was processed by `gcp-use1` (instance `..853249`) — **ann's** home
- `crossNodeBrokerBySession` is populated for the session INITIATOR only: ann visited bob2's home
  node to broker the session, so ann has a broker entry and **bob2 has none**

So Fix #1 — and my extension of it — no-op entirely for bob2, because there is no broker to
reconnect to. Yet the moment bob2 closes FIRST it becomes the **seal** initiator, and the directory
processing the seal pushes `seal_verified` to bob2 on a node bob2 has never had a stream on.

Two different "initiator" roles were being conflated:
- **session initiator** (ann) — has a visiting connection to the counterparty's home, tracked in
  `crossNodeBrokerBySession`
- **seal initiator** (whoever closes first — here bob2) — is who `processSeal` pushes
  `seal_verified` to, and has no such tracking at all

Fix #1 guards the first role. The frame is addressed to the second.

### Why it presents as intermittent

Whoever closes first becomes the seal initiator. If that is the session initiator (ann), Fix #1
applies and the seal completes — the two successes earlier today. If it is the responder (bob2),
there is no broker entry, no connection, and the frame is deferred. **A coin flip on close ordering.**

### The fix is NOT another reconnect

Opening yet another visiting connection would mean guessing which node will process the seal, and
the responder has no reason to know. The candidates, in order of how much they change:

1. **Directory-side**: `processSeal` runs on a node that, by construction, has the OTHER party's
   stream (it just received their leaf). Route `seal_verified` through the node that does hold the
   seal initiator's stream, rather than requiring it locally — the consortium already replicates
   enough to know where an agent is homed (`agent_presence` carries `owning_node_id`).
2. **Client-side**: have the responder register a broker entry too, so Fix #1 applies symmetrically.
   Cheaper, but it only works if the responder can predict the processing node.
3. **Deferred-delivery**: the frame IS enqueued and the initiator DOES reconnect seconds later.
   If the queue drained on reconnect the seal would complete late rather than never. Worth checking
   why it does not — this may be the smallest real fix.

(3) is the next thing to test, because the machinery already exists and the observed behaviour
suggests it is simply not draining.

### Kept from Entry 52

`seal.certificate.deferred` is what made all of this legible. Before it, this failure was a bare
`enqueueNotification` with no log, and the client's timeout blamed directory verification that never
ran. One WARN at the point where two components disagree turned a day of guessing into two runs.

---

## Entry 54 — 2026-07-29 — SEAL ROOT CAUSE, final: every seal is processed by ONE directory, and it can only reach agents homed there

Entry 53 framed this as the responder lacking a broker entry. That was true but downstream. The
actual cause is one line of infrastructure config meeting one line of relay code.

### The mechanism

The relay drives the bilateral seal: two ctrl leaves in the log → it calls the directory's
`processSeal`. `network-directory-adapter.ts` sends that to **`this.#directoryPeerId`** — a SINGLE
configured directory. Infrastructure pins it:

```
infra/terraform/terraform.tfvars:81   relay_primary_directory = "gcp-use1"
```

So **every seal in the consortium is processed by `gcp-use1`**, wherever the participants live.
`processSeal` then pushes `seal_verified` to the seal initiator out of its LOCAL `#streams` map.

| seal initiator | homed on | seal processed by | outcome |
|---|---|---|---|
| ann  | gcp-use1 | gcp-use1 | ✅ stream present — today's two successes |
| bob2 | gcp-euw1 | gcp-use1 | ❌ `initiator_stream_absent` → deferred forever |

The seal initiator is **whoever closes first**, not the session initiator. That is the entire source
of the apparent randomness.

### It is structural, not probabilistic

`notification_queue` is **not** in the anti-entropy table set (`agent_profiles`,
`agent_revocations`, `agent_suspensions`, `agent_presence`, `seal_notarizations`). The queued frame
is local to `gcp-use1`, and `drainNotifications` only fires when a peer authenticates ON THAT NODE.
bob2 is homed on `gcp-euw1` and has no reason to ever connect to `gcp-use1`. **The frame is
unreachable by construction, not merely late** — which kills Entry 53's option (3).

So with one relay pinned to one directory, ANY agent not homed on that directory can never complete
a seal it initiates. It looked intermittent only because my two test agents were deliberately split
across nodes — the very cross-node property M12 exists to prove.

### Why the earlier fixes were right but insufficient

- Entry 52 (auto-ack broker connection) closed a genuine 5-second ordering race and is worth keeping;
  the reconnect now lands 341ms BEFORE the directory looks instead of 5s after.
- Neither it nor Fix #1 can help here: both open a connection to the SESSION broker, and the frame
  is addressed by the SEAL processor, which is a different node chosen by relay config.

### The fix, and what it costs

There is **no node-to-node frame forwarding** in the directory today — I checked. So the candidates:

1. **Relay routes `processSeal` to the seal initiator's home node.** The relay already holds the
   sender pubkeys of both ctrl leaves; the directory knows homing via `agent_presence.owning_node_id`,
   which IS replicated. Smallest change that respects the sovereign-node model — no new cross-node
   channel, just a better choice of which directory to call.
2. **Directory forwards `seal_verified` to the owning node.** Correct in general and the largest
   change: it introduces directory→directory frame delivery, which does not exist yet.
3. **Every agent maintains a stream on the relay's primary directory.** Rejected on sight — it
   re-centralises exactly what the consortium exists to avoid.

(1) is the one to build. It also removes a hidden single point of failure that has nothing to do
with sealing: today `relay_primary_directory` makes one node load-bearing for every seal in the
consortium, which contradicts DOD-INV-SOVEREIGN's redundancy clause.

### Owed

The `relay_primary_directory` variable deserves a comment saying what it actually governs. It reads
as "which directory the relay registers with" and is in fact "which directory adjudicates every seal
in the consortium."

---

## Entry 55 — 2026-07-30 — THE SEAL WORKS CROSS-NODE: 280ms, on the ordering that never succeeded

```
A: sealed_root 37e239e80b7fa4407d1606d6ce5d84f68b8a064614333f65e081ca7bfc0dc9f8
B: sealed_root 37e239e80b7fa4407d1606d6ce5d84f68b8a064614333f65e081ca7bfc0dc9f8
```

Identical roots, both sides, with the RESPONDER closing first — the exact case that produced
`initiator_stream_absent` and an 11-minute timeout on every previous attempt.

### The redirect, in the trace

```
04:51:24.076  legibility.built                                       gcp-use1  (relay's pinned node)
04:51:24.104  undeliverable   homedOn gcp-usc1, processedBy gcp-use1            <- refuse + redirect
04:51:24.354  legibility.built                                       gcp-usc1  (redirect target)
04:51:24.357  delivered                                                        <- stream present
04:51:28.192  notarization.recorded
04:51:28.227  conversation.seal.recorded
```

**280ms** from first attempt to completed seal. The node that could not deliver said so and named
who could; the relay followed once; the node holding the initiator's stream finished it.

Stronger than intended: the initiator turned out to be homed on `gcp-usc1`, not `euw1` — bob2's home
moved when its daemon reconnected through failover after I cleared sessions. So the redirect resolved
a node that was configured NOWHERE, on either side. Exactly what it is for.

### What made this fixable

The whole day's difficulty was that every layer reported success about something adjacent to the
failure. What broke the deadlock was, in order:
1. `seal.certificate.deferred` — one WARN at the point where two components disagreed (Entry 51).
2. Separating "offline, enqueue is correct" from "online elsewhere, enqueue is a black hole" using
   REPLICATED presence — the directory always had the information to tell those apart (Entry 54).
3. A self-describing redirect, so the relay needed no new configuration and stayed extractable.

### Also proven in this run

The pinned relay internal address held at `10.10.0.28` across a full instance replacement — the fix
from earlier today doing its job unattended. Before it, a replacement silently broke every session
until someone re-ran the manifest publisher.

### Six defects fixed today, all verified live

| defect | shape |
|---|---|
| relay shipped UNPATCHED autonat (Dockerfile skipped `patches/`) | connection torn down under it |
| no FROST share ever persisted (SI-003 vs Cloud KMS ciphertext) | write returned ok, nothing stored |
| failover only on unreachability, not non-membership | reachable non-member = black hole |
| relay health address was ephemeral | replacement broke every session |
| `seal_verified` deferral was silent AND returned ok:true | relay told the seal succeeded |
| every seal adjudicated by one relay-pinned directory | unreachable initiator by construction |

Every one had the same signature: **a green surface over a broken write or a silent teardown.**

### What remains on DOD-E2E-GCP-1

- kill-switch pause biting across all three nodes — still never exercised
- the automated enforcer — the sequence is still driven by hand

---

## Entry 56 — 2026-07-30 — The enforcer earned its keep on its first real run

Wrote `j-gcp-live.spine.test.ts` — the DOD-E2E-GCP-1 enforcer. It drives two real client daemons
against the three live GCP directories and the live relay, mints its own capabilities, and closes
with the RESPONDER first (the ordering that regressed). Opt-in behind `CELLO_GCP_E2E=1`.

**It failed on its first real run, and the failure is a genuine product bug my manual testing
missed.** That is the whole argument for having it.

### The bug: I fixed the request, not the result

The fleet SEALED successfully:

```
09:33:02.727  relay.seal.redirected          <- Entry 55's fix working
09:33:05.636  notarization.recorded
09:33:05.675  conversation.seal.recorded
```

The initiator reported `seal_unilateral_timeout`.

`session_sealed` is delivered by `#deliverOrEnqueue` (`directory-node.ts:5304`):

```ts
const stream = this.#streams.get(pubkeyHex);
if (stream) { this.#sendFrame(stream, encoded); return; }
if (pubkeyHex) this.#store.enqueueNotification(pubkeyHex, event, correlationId);
```

The same per-node, non-replicated queue as before. Entry 55 fixed delivery of the seal REQUEST
(`seal_verified`) by redirecting to the node holding the seal initiator's stream. But the RESULT
(`session_sealed`) goes to BOTH participants, and after a redirect the adjudicating node holds at
most one of their streams. The other participant is enqueued into a queue it will never drain.

**This is worse than the request case.** There the seal had not happened, so a timeout was
recoverable by retry. Here the seal IS notarized and durable — `conversation.seal.recorded` — and one
party simply never learns. Retrying cannot help; there is nothing left to do. The agent holds a
session it believes failed, against a receipt that exists.

### Why my manual runs passed

Both sides returned `sealed_root` in Entry 55 because the redirect happened to land on a node holding
the stream that mattered for that particular homing. The enforcer varies nothing deliberately — it
just ran a different homing draw and hit the case I had not. **A hand-driven test samples one
ordering; the bug lives in the others.**

### Two test-harness bugs fixed getting here, both worth remembering

1. **`execFileSync` blocks the event loop.** Two closes scheduled with `setTimeout` ran strictly
   sequentially, so the first waited out its full 660s bilateral window for a second close that could
   not start until it returned — an 812-second "failure" for a seal the fleet completed in 3s. A
   bilateral ceremony cannot be driven by synchronous calls; the closes now use `spawn`.
2. **A harness timeout shorter than the protocol's own wait.** My 600s cap sat under
   `CELLO_SEAL_BILATERAL_TIMEOUT_MS` (660s), so a slow-but-correct seal was reported as a failure.
   Now 780s.

Also: the CLI prints JSON followed by human prose, so slicing from the first `{` to end-of-output
never parses — and it fails SILENTLY, as a missing `ok` that reads exactly like the command failing.
Registration had succeeded while the assertion said it failed. Now brace-matched.

### The fix

`#deliverOrEnqueue` needs the same treatment as the request path: when the participant is online but
homed elsewhere, enqueuing locally is a black hole. Options — forward to the owning node (needs
directory→directory delivery, still absent), or replicate `notification_queue` via anti-entropy
(it is deliberately not in the set today), or have the CLIENT poll for its own seal result rather
than depend on a push it may never receive. The third is the smallest and the most robust: the seal
is already durable and queryable, so the receipt does not need to be pushed to be learned.

---

## Entry 57 — 2026-07-30 — The seal RESULT half: made visible, and the durable fix is a local read, not a push

### Landed now

`#deliverOrEnqueue`'s enqueue branch was silent. It now logs `seal.result.undelivered` at ERROR,
naming the session, the stranded participant, and the consequence. Directory suite green (940).

That converts an invisible failure into an alarmable one. It does NOT fix it — deliberately, because
the correct fix is a protocol change and half-building one at the end of a long session is how the
original defect got shipped.

### Why this half is worse than the request half

| | seal REQUEST (`seal_verified`) | seal RESULT (`session_sealed`) |
|---|---|---|
| state when it strands | seal has NOT happened | seal IS notarized and durable |
| is retry useful? | yes — the ceremony can rerun | **no — there is nothing left to do** |
| what the client reports | `seal_unilateral_timeout` | `seal_unilateral_timeout` |

Same error string, opposite truths. In the second case the agent holds a session it believes failed
against a receipt that demonstrably exists (`conversation.seal.recorded`). An error naming a
verification that in fact SUCCEEDED is the most misleading state in the system so far.

### The enabling fact, which changes the fix

**`seal_notarizations` is a Tier-A anti-entropy table** — natural key `(session_id, seal_type)`,
append-only, listed in `M12-ANTI-ENTROPY-DESIGN.md:119` and encoded in `ae-table-encoders.ts:95`.
`notification_queue` is NOT.

So the notarization ALREADY replicates to the stranded participant's own home node. The receipt does
not need to be pushed across nodes — **it can be learned locally.** That kills the two expensive
options and leaves a cheap one:

1. ~~directory→directory forwarding~~ — new cross-node channel, does not exist
2. ~~replicate `notification_queue`~~ — deliberately excluded from the AE set, and it is a queue,
   not a fact; replicating delivery state invites double-delivery
3. **the client learns the result locally** — on bilateral timeout, ask its OWN home directory
   whether a notarization exists for the session before escalating to unilateral

(3) needs: a store read (`seal_notarizations` by `session_id` — schema has `sealed_root`,
`participant_a/b_pubkey`, `close_timestamp`, `frost_signature`, `chain_hash`, `seal_type`), one
request/response frame pair, and a client-side check in the timeout path.

**One design snag found while scoping it:** `SessionSealedWithLegibility` requires the `legibility`
certificate, which is DERIVED and not stored in `seal_notarizations`. So the response cannot simply
reuse the existing `session_sealed` event and inherit the client's existing handler — either
legibility is re-derived at query time from the stored leaves, or the response carries a narrower
"seal exists, here is the notarization" shape and the client treats it as proof-of-completion rather
than as a full certificate. That choice wants deciding before coding, not during.

### Enforcer status

`j-gcp-live.spine.test.ts` currently FAILS, correctly, on exactly this. It is the regression guard
for the fix and should stay red until the fix lands — a red enforcer naming a real defect is worth
more than a green one that skips it.

---

## Entry 58 — 2026-07-30 — DOD-SEAL-BROKER-1 WORKS: the relay asks the brokering directory, no redirect needed

Andre's reframing was right and the fix is smaller than either option I had proposed.

### What changed

The relay was pinned to one directory for every conversation in the consortium. It already knew which
directory brokered each session and threw that away — `recordAssignment` verified the assignment
signature with `.some()` over the consortium pubkeys and discarded which one matched. Now `.find()`,
recorded per session, and used when a receipt is needed.

Address resolution deliberately does NOT come from the client-presented assignment: a client could
then name any address it liked. The relay learns the broker from the SIGNATURE it already verifies,
and resolves the address from its own environment (`CELLO_DIRECTORY_ENDPOINTS`, pubkey=multiaddr) —
the same public-data trust source as `CELLO_DIRECTORY_PUBKEYS`. That also avoided extending the
signed assignment payload, which would have been a coordinated directory+relay+client change with
version-skew risk.

### Proven on the case that had never been tested

Agents on `gcp-usc1` and `gcp-euw1`; the relay's configured directory is `gcp-use1` — **the home of
NEITHER participant.** Before and after, same conversation shape:

```
BEFORE  relay.seal.broker.address_unknown
        seal.certificate.undeliverable   homedOn gcp-euw1, processedBy gcp-use1
        relay.seal.redirected
        (then legibility + delivered on euw1)

NOW     relay.seal.broker.resolved  9cb77b68…   (= gcp-euw1)
        seal.certificate.legibility.built
        seal.certificate.delivered
        notarization.recorded
```

No `undeliverable`, no redirect, no wasted round trip. The redirect from Entry 55 remains as the
safety net for a broker whose address is unconfigured; it is no longer the mechanism.

### One silent hand-off, again

`createRelayNode` copies options field by field into the node, so `directoryEndpointsByPubkey` was
dropped on the floor. The env parsed correctly, the resolver ran, the map was empty — and the relay
logged `broker.address_unknown` for a pubkey whose address was demonstrably present in its own
metadata. Cost a full build-deploy-test cycle.

That is the same shape as most of today's defects: **every layer correct, one silent hand-off in
between.** Six of them now: patches/ not copied into an image, a share write that returned ok, a
failover that never triggered, an ephemeral IP baked into a manifest, a deferral that returned
success, and a factory that dropped an option.

### And the question this answered that I had not settled

I hoped the broker fix might make the fetch unnecessary — reasoning that the brokering directory is
the counterparty's home AND holds the initiator's visiting connection, so it might reach both. **It
does not.** The enforcer still fails with the initiator timing out while
`conversation.seal.recorded` is in the log. So the visiting connection is not available at delivery
time, and the receipt fetch is genuinely required rather than a workaround for a fixable gap.

Good that I tested it instead of building on the assumption; that was one deploy cycle against
possibly a day of protocol work aimed at the wrong thing.

### Next: the receipt fetch

The seal is notarized and durable, and `seal_notarizations` IS a Tier-A anti-entropy table — so the
stranded participant's own home directory already holds its receipt. It needs a read, a
request/response frame, and a client-side check on timeout. Andre chose the proof-only shape
(signature + root, no re-derived readable certificate) over rebuilding the certificate, because a
subtly mismatched rebuild is a hidden failure while an asymmetry is a visible one.

---

## Entry 59 — 2026-07-30 — THE LIVE ENFORCER PASSES; and Entry 58's conclusion was drawn from a broken build

### The result

`j-gcp-live.spine.test.ts` GREEN in 151s. Agents on `gcp-usc1` and `gcp-euw1`; the relay pinned to
`gcp-use1` — **the home of neither participant**. Responder closes first. Full path: register on two
different directories → cross-node discovery → session over the relay → content both ways →
**bilateral seal with matching roots on both sides**.

```
13:58:02.631  relay.seal.broker.resolved  9cb77b68…   (= gcp-euw1)
13:58:03.225  seal.certificate.legibility.built
13:58:03.227  seal.certificate.delivered
13:58:06.214  notarization.recorded
13:58:06.270  conversation.seal.recorded
```

`DOD-SEAL-BROKER-1` acceptance (a)–(d) all met. No redirect, no directory-to-directory forwarding, no
replicated queue.

### Correction: the receipt fetch was never needed

Entry 58 stated the receipt fetch was "genuinely required rather than a workaround for a fixable gap",
on the evidence that the enforcer still failed after the broker fix. **That evidence was invalid.** At
that point `createRelayNode` was dropping `directoryEndpointsByPubkey`, so broker selection could not
work — the seal was completing via the REDIRECT, and after a redirect the adjudicating node holds only
one participant's stream. I measured the redirect path and attributed the result to the broker path.

With broker selection actually working, the adjudicating directory is the counterparty's home AND holds
the initiator's visiting connection, so it reaches BOTH. `seal.result.served` never fires. The
hypothesis I tested and wrongly concluded against was correct.

**I built a protocol addition — store read, contract change, frame pair, client timeout hook — on a
conclusion drawn from a build I knew was broken.** I even wrote in Entry 58 that testing beat building
on an assumption. Then the very next thing I did was build on one, because the test appeared to have
settled it. A test run against a build with a known dropped option settles nothing.

### What to do with the fetch

Keep it, but demote it in the record from "the fix" to "a safety net", and be clear it is UNPROVEN in
production because nothing has exercised it:
- it covers the redirect path, where the adjudicating node genuinely holds one stream
- it covers a broker whose address is unconfigured
- it removes the worst state in the system — an agent reporting failure for a durable seal

It is also the only part of today's work with no live evidence behind it. That belongs in its own
acceptance line rather than riding on this one.

### The shape of today, once more

Seven defects, one signature: **every layer correct, one silent hand-off between them.** patches/ not
copied into an image; a share write returning ok while nothing persisted; a failover that never
triggered; an ephemeral IP baked into a signed manifest; a deferral returning success; a factory
dropping an option; and a queue that cannot reach the peer it is queued for.
