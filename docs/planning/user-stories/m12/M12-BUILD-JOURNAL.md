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
