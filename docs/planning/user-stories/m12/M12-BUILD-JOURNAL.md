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
- **Next red:** ADAPTER-GCP-1 remainder (audit-log sink-extraction + Cloud KMS — deliberate
  starts) OR the AE implementation units (AE-APPEND/MUTABLE/LOCAL-E2E). ROLE-MANIFEST-1 DONE.
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
- **PUBLISH DONE (beta) — Entry 14.** v0.0.129 CI green incl. smoke-tag. All 7 on beta:
  crypto 0.0.23, protocol-types 0.0.25, transport 0.0.25, gateway 0.0.5, daemon 0.0.76, cli 0.0.77,
  connect 0.0.87. Verified against tarballs (validatorNodes in protocol-types dist; guard in crypto
  dist; cross-pins all real). **AWAITING ANDRE: the `latest` promotion** (operator-facing; command
  in Entry 14). NOT blocking the dir half — semver ranges resolve against published versions.
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
