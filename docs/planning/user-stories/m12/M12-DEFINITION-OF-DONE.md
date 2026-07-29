---
name: M12 Multi-Cloud Rebuild Definition of Done
type: definition-of-done
date: 2026-07-28
milestone: M12
status: open
topics: [m12, gcp, migration, multi-cloud, anti-entropy, role-split, frost-threshold, infrastructure]
description: >
  The yardstick for M12 — the multi-cloud rebuild: GCP nodes, libp2p anti-entropy replacing the
  Postgres mesh, the full-node/validator role split, CI on Cloud Build, workload moves, and AWS
  teardown. Sole status authority. Spec-of-record is the 2026-07-28 GCP rebuild decision record.
---

# M12 — Definition of Done

## How to use this
- Find the lowest-numbered line not ✅ in the active tier — that is the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`.
  Full run output lives in the journal. This document stays a scoreboard.
- **Four enforcers** (defined in [[M12-PROCEDURE]] §1): local convergence · GCP standalone ·
  outage claim · IaC region-expansion. A line naming an enforcer is ✅ only when that enforcer ran.
- Tier order is a dependency order, not a calendar. P0 (capability) and P1 (protocol code) can
  interleave; P2 needs both; P3 needs P2; P4 needs P3 **plus Andre's per-stack go**.

## Repo Legend
| Tag | Local path | Notes |
|-----|-----------|-------|
| `trustless-cello` | `/Users/andrep/Documents/code/trustless-cello` | Directory, relay, ALL IaC, ops-agent, e2e-tests, CI |
| `cello-client` | `/Users/andrep/Documents/code/cello-client` | Manifest role parsing, validator selection, bundled manifest. Ships via `/cello-publish` + semver re-pin — never `workspace:*` |
| `cello-portal` | `/Users/andrep/Documents/code/cello-portal` | Portal-move unit only (P2) |

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Tier I — Invariants (must hold in every phase, every line)

- **DOD-INV-SOVEREIGN** [all] — no single node can complete a threshold ceremony alone; no
  privileged node exists in any topology, sync, or deploy decision; no provider-specific
  networking or hardcoded endpoint enters protocol code; a down node is routed around, never
  fatal. — ❌
- **DOD-INV-THRESHOLD** [trustless-cello, cello-client] — `T = majority(validators)` everywhere.
  `consortiumNodeCount` and every threshold/DKG/kill-switch derivation counts **validator-role
  nodes only**; replicas never enter the arithmetic. All-N / T=N never appears (settled
  2026-07-04). — ❌
- **DOD-INV-SHARES-LOCAL** [trustless-cello] — `agent_key_shares` (or successor) appears in NO
  sync set, NO anti-entropy exchange, and NO off-node artifact except the node's own encrypted
  backup. A share never transits between nodes by any mechanism. — ❌
- **DOD-INV-KILL-SWITCH** [trustless-cello] — suspension state fails CLOSED and converges
  suspended-wins: a pause reaches every up node despite partition and restart; an un-suspension
  requires verifiably newer authenticated state; a tie resolves suspended. A paused agent sealing
  because an UP node lacked the state is a critical finding. — ❌
- **DOD-INV-NODEID** [all] — every node is born `<cloud>-<region>` (e.g. `aws-use1`, `gcp-usc1`)
  and is never renamed; no two manifest entries ever hold the same FROST identifier in one
  manifest version. — ❌
- **DOD-INV-NO-VPN** [trustless-cello] — no VPN, VPC peering, Private Service Access consumer, or
  any cross-cloud network tunnel is created. Directory sync happens only over the authenticated
  libp2p transport. Nothing external ever connects to a node's Postgres. — ❌
- **DOD-INV-RELAY-EXTRACTABLE** [trustless-cello] — the relay gains no consortium state, no
  database, no shared internal config package, no directory import; config stays env-only. It
  remains a standalone shippable artifact (future enterprise private relay). — ❌
- **DOD-INV-IAC** [trustless-cello] — every GCP and AWS resource exists in IaC; any manual
  emergency fix lands in IaC + the STATE file (`infra/STATE.md` / `infra/GCP-STATE.md`,
  updated immediately per action, never batched) before its unit closes. Region-expansion test:
  a new region with zero manual steps. — ❌
- **DOD-INV-NO-SAAS / DOD-INV-DOMAIN** [all] — no paid SaaS; all URLs are
  `*.cello.mygentic.ai`. — ❌

---

## Tier P0 — GCP capability + CI

- **DOD-GCP-PROJECT-1** [trustless-cello] — `cello-infra` project exists, linked to billing
  account `012EFA-590A2E-2A82B4`, with ONLY the needed APIs enabled (compute, artifactregistry,
  cloudbuild, sqladmin, secretmanager, storage, logging, monitoring — final list recorded);
  custom-mode VPC created (no default network); `infra/GCP-STATE.md` created in M11's STATE.md
  format and committed. — 🟡 all clauses done live 2026-07-28 (project 955736313934, billing
  linked via slot swap — see the ledger in GCP-STATE.md; 11 APIs; default net deleted,
  `cello-vpc` custom-mode). — ✅ owed import done: APIs/VPC/state bucket Terraform-managed,
  plan clean. Done-audit correction: "only needed APIs" was live-false (33 enabled incl.
  project-creation defaults); defaults disabled → 20 live = 11 managed + 9 undisable-able
  platform deps, recorded in GCP-STATE → Entries 1, 2, 7
- **DOD-GCP-IAM-1** [trustless-cello] — per-workload service accounts (directory-node, relay-node,
  ops-agent, portal, cloud-build) with explicit minimal grants; the compute default SA is used by
  nothing; every grant is recorded in IaC. Org constraints (no SA keys — WIF only; zero default
  grants) are documented in GCP-STATE.md so the silent-403 trap is expected, not discovered. —
  ✅ 5 SAs live via `infra/terraform/iam.tf`, plan clean; unit review run and ALL findings
  fixed (secret access per-secret only; CI bucket-scoped; tfstate hardened; drift caveat
  documented). Done-audit correction: one out-of-band grant found and removed (legacy Cloud
  Build SA `builds.builder`, Google auto-grant, unused) — the F3 tier-boundary audit doing its
  job → Entries 2, 3, 7
- **DOD-CI-REGISTRY-1** [trustless-cello] — Artifact Registry repo exists; Cloud Build builds the
  directory and relay images from the GitHub repo (path-filtered triggers per package) and pushes
  to Artifact Registry. No local docker push is possible or needed. AWS CodePipeline remains
  untouched and functional for the AWS node until P4. — ✅ full trigger-path evidence: push
  `e8842f33` (touching both cloudbuild YAMLs) fired BOTH triggers via real push events →
  both SUCCESS, images tagged with the commit SHA; infra-only push `540fc175` fired neither
  (negative filter proof); review findings fixed (no `:latest`; gcloudignore inherits
  gitignore; TF-owned `_REGISTRY`) → Entries 3, 6
- **DOD-IAC-BASE-1** [trustless-cello] — the IaC skeleton (tool per M12-D2) stands up and tears
  down one disposable COS VM in a MIG(size 1) with a static IP, firewall rule, and attached
  service account, entirely from code. IaC enforcer green on this skeleton. — ✅ enforcer green
  both directions; unit review: SPEC FAITHFUL, nothing blocking, all three suggested edits
  applied (copy-trap comment on the block, no-surge policy, CIDR scheme as `region_subnets`
  map, deliberate SA reuse = M12-D3) → Entries 4, 5

## Tier P1 — Protocol code (local-provable, no cloud dependency)

- **DOD-ROLE-MANIFEST-1** [cello-client, trustless-cello] — manifest entries carry
  `role: validator | replica`; directory and client both parse and enforce it;
  `consortiumNodeCount` derives from validator count, decoupled from `manifest.nodes.length`;
  DKG participant selection, seal arithmetic, and kill-switch honoring exclude replicas; a
  replica-only manifest is rejected loudly (no validators = no consortium). Version-bump ACs:
  cello-client packages published to beta via `/cello-publish`, trustless-cello re-pinned. — ✅
  BOTH halves done+reviewed: client (role/peerId + validatorNodes + replica-only guard, published
  beta v0.0.129) and directory (re-pin ^0.0.25; `computeDkgTopology` counts validators only;
  replica-only rejected loudly; behavior byte-for-byte preserved for role-less manifests — review
  confirmed; seal/kill-switch validator-scoped structurally). F1 handler-rejection test added.
  → Entries 10, 14, 15. Owed operator-side only: Andre's `latest` promotion (Entry 14).
- **DOD-AE-DESIGN-1** [trustless-cello] — anti-entropy design doc in the vault: which tables sync
  (append-only set vs mutable set), Merkle/root comparison mechanism (reusing
  `V5__mmr_tables.sql` / `directory_checkpoints` where it fits), conflict rules per mutable table
  (`agent_suspensions` suspended-wins with authenticated recency; `agent_presence`,
  `primary_holder` rules stated), the directory↔directory channel's identity verification
  (manifest-pinned keys, step-6-style), and the retirement list for the mesh
  (`setup-replication.sh`, slots, SEQ_INCREMENT machinery). Reviewed before implementation
  starts. — ✅ `M12-ANTI-ENTROPY-DESIGN.md` + two research maps; adversarial review (all code
  claims verified), 3 blocking amendments applied (total-order suspension merge; honest
  burn/trust-model + M12-P6; retirement list gains replication creds/params/5432 path) plus
  6 non-blocking → Entries 8, 9 (see M12-P5, checkpoint scope)
- **DOD-AE-APPEND-1** [trustless-cello] — append-only tables sync between directories over the
  authenticated libp2p channel via root-comparison + delta pull; divergence detection is
  O(compare), transfer is delta-only; peers that fail identity verification are refused. — ✅ all
  four clauses now earned. **Root-comparison / O(compare):** `ae_state` carries ONE DIGEST per
  table and nothing else; detail is fetched only for tables whose digests differ, and a Tier-A
  difference then walks buckets (256-entry vector → hashes for ONLY the differing buckets, which
  makes `differingBuckets` a live production path rather than dead code). Pinned by a test that
  counts wire frames: a converged round sends `ae_state_req` and NOTHING else — no bucket walk, no
  hash list, no version map, no body pull. **Delta-only transfer:** bodies pulled by hash; a
  divergent table with 40 shared + 1 differing record pulls exactly 1. **Identity verification
  refuses:** 19 fail-closed assertions (wrong key, relayed frames, unknown node, wrong-node answer,
  self-dial, stale timestamp, pre-auth round frames). **Authenticated channel:** live in
  J-ANTIENTROPY. Enforcer re-run green against the digest-first protocol (5/5). Done-audit
  2026-07-28 correctly ruled the earlier ✅ overstated on O(compare); this closes it. → Entries 9-17

- **DOD-AE-MUTABLE-1** [trustless-cello] — mutable-table sync with per-table conflict rules per
  the design doc; `agent_suspensions` convergence proven adversarially: pause during partition,
  node restart mid-sync, stale-node rejoin, un-pause requiring newer authenticated state, tie →
  suspended. — ✅ per-table rules implemented (suspension = seq-based monotonic-burn merge;
  presence = wall-clock LWW); V49 adds `suspension_seq`/`origin_node` and the write seam mints them
  atomically. All five adversarial scenarios have a named test: **pause during partition** →
  J-ANTIENTROPY "a PAUSE written while a node is partitioned converges on heal" (Tier-B, live);
  **restart mid-sync / stale-node rejoin** → J-ANTIENTROPY burst-catch-up (live) + the
  `FOR UPDATE`-preserves-a-concurrent-burn pg test; **un-pause needs newer state** → live
  (`true:false:9` on all three) + `suspension-merge` stale-lower-seq-clear; **tie → suspended** →
  `suspension-merge` (both arg orders). Wall-clock cannot be a merge input BY CONSTRUCTION
  (`updated_at` absent from `SuspensionRecord`). Reviewed; 2 HIGH kill-switch findings found +
  fixed. Parked (design §4 hardening, not one of the five): "restart, then serve a ceremony before
  the first completed round". → Entries 9-15

- **DOD-AE-LOCAL-E2E-1** [trustless-cello] — **local convergence enforcer:** three directory
  processes on loopback with divergent seeded state converge; kill one mid-sync → restart →
  catch-up; a node absent for a burst of writes converges on rejoin. Runs in e2e-tests via the
  standard live-binary fixture (extend `spine/live-harness.ts`, never a from-scratch fixture —
  the DoD originally said `session-fixture.ts`, which does not exist in either repo; `live-harness`
  is the spine enforcer harness ~30 `j-*.spine.test.ts` files use). — ✅ ENFORCER RAN, 5/5 green:
  `packages/e2e-tests/src/spine/j-antientropy.spine.test.ts` — three REAL directory binaries,
  separate processes + separate DBs, real TCP/Noise. Divergent seeded state converges on all three;
  a node absent for a **60-record burst** converges on rejoin (asserted present on the writer first,
  so the all-present assertion is not vacuous); a Tier-B pause written during the partition
  converges on heal. Extends `live-harness` (`directoryFixedTransport` → deterministic PeerIds +
  fixed ws ports so a peerId-pinned manifest can be written pre-boot); no from-scratch fixture.
  → Entries 14-15

- **DOD-MULTIADDR-1** [trustless-cello] — the advertised bootstrap multiaddr is configuration,
  not the hardcoded `/dns4/{host}/tcp/80/ws` template (`directory.ts:1095`); an
  `https`/`wss`-shaped endpoint round-trips through client bootstrap (closes the unverified
  `https://` manifest question). — ✅ `buildBootstrapMultiaddr` extracted + configurable
  (explicit override > hostname+port+transport > ws fallback; defaults reproduce the AWS string
  byte-for-byte, reviewer-confirmed); https round-trip covered both sides (client
  `mapEndpointToBootstrapBase` accepts https, existing test; directory returns wss). Reviewed,
  F1 empty-env trap fixed. Branch `m12/multiaddr` afe12032 → Entry 12
- **DOD-ADAPTER-GCP-1** [trustless-cello] — GCP adapters behind the existing interfaces
  (`packages/interfaces/`), selected by `CELLO_ENV`/config at the composition root, lazy-imported
  (M12-D5), with local stubs. Set per M12-D6: **GCS cloud-storage + GCS audit-log + Cloud KMS
  envelope key** (Parameter Manager dropped — the directory boots from the manifest + relay
  self-registration; empty-registry is non-fatal). — 🟡 PARTIALLY PROVEN LIVE. All three
  adapters implemented behind the existing interfaces with injected clients, 10 unit tests green:
  `GcsCloudStorageProvider` (404→`undefined` parity with S3's NoSuchKey; a 403 PROPAGATES rather
  than masquerading as an empty bucket), `GcsAuditLogShipper` (write-through per entry like the S3
  shipper — buffers on failure, never drops, retains the buffer across a failed flush, stays
  degraded to preserve ordering), `KmsEnvelopeKeyProvider` (round-trips share material; FAILS
  CLOSED on decrypt — never returns empty/substitute bytes; `rotate()` a documented no-op since
  Cloud KMS rotates versions server-side). Composition root selects on a new `CELLO_CLOUD`
  (`aws`|`gcp`, default `aws` so every existing deployment is unchanged; an invalid value exits 1
  rather than silently falling back to AWS adapters on a node with no AWS credentials). All GCP
  imports are lazy (M12-D5) so no AWS node or local run loads the GCP SDK. — ✅ **REAL-CLOUD PROOF
  RUN** on the live `gcp-use1` node, inside its own container, as its own workload identity, against
  its own resources. **KMS:** `{"kms_roundtrip_ok":true,"plaintext_bytes":32,"ciphertext_bytes":112,
  "ciphertext_is_not_plaintext":true}` and, on garbage ciphertext, `{"fail_closed":true,
  "threw":"3 INVALID_ARGUMENT: Decryption failed: the ciphertext is invalid."}`. **GCS storage:**
  `{"missing_object_is_undefined":true,"missing_bucket_throws":true}` — the S3-parity distinction
  holding against the real service. **GCS audit:** object present at
  `gs://cello-audit-gcp-use1/audit/2026-07-28/…jsonl` (123 bytes), verified from OUTSIDE the node.
  IaC for the buckets + key ring landed with DOD-NODE-DIR-GCP-1 (`storage.tf`, `kms.tf`). The
  `as never` cast on the real KMS client is gone — `KmsLike` now declares the client's real
  3-tuple return, so the adapter has a structural check again.
  **Done-audit correction — ✅ was OVERSTATED.** Live proof covers KMS (round-trip + fail-closed)
  and the GCS missing-object/missing-bucket distinction. It does NOT cover: the audit shipper's
  degraded/buffer/flush-retention/ordering contract (unit-green only, against an injected failing
  fake); write-through *per entry* (one object proves one write, not the no-batching rule); the
  **403-propagation** guarantee — the one permissions-shaped claim in the line, and the only kind an
  injected client cannot reproduce; and `rotate()`. The audit object that does exist carries
  `correlationId: "proof"` — written by an ad-hoc script, not by the node doing its job, because
  **`ship()` still has no production caller** (Entry 19's gap, re-verified: `grep -rn "\.ship("`
  hits only `__tests__/`; the sole production reference is `flush()` in the SIGTERM handler, which
  short-circuits on an always-empty buffer). An adapter no production path invokes is not "proven".
  → Entries 16, 18, 22

## Tier P2 — Wave 1: complete CELLO on GCP, standalone

- **DOD-NODE-DIR-GCP-1** [trustless-cello] — first GCP directory live (`gcp-<region>`): MIG(1) +
  COS running the CI-built image, its own Cloud SQL (node-only access), Secret Manager secrets,
  fresh transport key (`openssl rand -hex 32`, never copied), static IP, `pg_dump`-to-GCS backup
  timer (shares exist nowhere else). Entirely from IaC. **Evidence must include one
  `gcloud compute ssh --tunnel-through-iap` login** — the IAP firewall path has never been
  exercised (Entry 5 carry-forward). — 🟡 LIVE, NOT IaC-COMPLETE, NOT REVIEW-CLOSED. `{"status":"ok","nodeId":"gcp-use1","schemaVersion":49}`,
  MIG instance HEALTHY, `directory.service.started nodeId=gcp-use1 region=us-east1`. **Node-only DB
  access verified independently of the IaC that produced it:** 0 VPC peerings, 0 VPN tunnels, Cloud
  SQL `ipv4Enabled=false`, `pscEnabled=true`, **no IP address at all** — DOD-INV-NO-VPN holds by
  construction, not by assertion. **Transport key never copied, never regenerated:** peerId
  `12D3KooWMH58hm8xpuwgwaNSvnvXBuc126jfuUMVbrGNcU2MeEAX` unchanged across FOUR instance
  replacements, because it comes from Secret Manager rather than per-boot generation. **Backup timer
  PROVEN, not merely installed:** `gs://cello-backups-gcp-use1/gcp-use1/20260728T214552Z.sql.gz`,
  16179 bytes, read back and decompressed from OUTSIDE the node, carrying the core CELLO schema.
  **IAP login:** `=== IAP LOGIN OK: cello-gcp-use1-8cpn Tue Jul 28 21:07:28 UTC 2026 ===`.
  **EMPTY-REGISTRY BOOT confirmed** (M12-D6 deferred this to P2): `node.registry.skipped`, no relay
  in the pool, node healthy and serving. Six defects stood between "applied" and "working" — two
  missing implicit grants, the COS HOST firewall (policy DROP; a VPC rule alone reaches nothing), an
  undialable advertised address, and two in the backup (pg_dump 15 vs server 17, and a pipeline
  reporting gzip's exit status).
  **Done-audit correction — ✅ was NOT EARNED, flipped while the IaC review was still in flight.**
  Three clauses fail. (a) **"Entirely from IaC" is false:** `terraform.tfvars` — which holds the
  whole `directory_nodes` map and the image tag — was UNTRACKED at the flip commit, excluded by
  `*.tfvars` in `.gitignore`. A fresh clone could not produce this node; the region-expansion test
  fails at step zero. (b) **"running the CI-built image" is false:** build
  `32c90af6` has no `buildTriggerId`, no `repoSource` and no commit SHA — a hand-run
  `gcloud builds submit` of the local tree, under a tag the registry does not enforce as immutable.
  The triggers fire on `^main$` and this branch is not main. (c) **"node-only access" is
  overstated:** the network facts hold (0 peerings, 0 tunnels, no IP — DOD-INV-NO-VPN is solid), but
  subnets within one VPC are mutually routable, and at flip time ONE shared `cello-directory-node`
  SA held every per-node grant. Also: the timer never fired (the backup was run by hand) and the
  dump contained zero share rows, so the clause's actual subject was never exercised.
  **The reviewer's own finding is the sharpest:** the live node connects as `postgres`, the schema
  owner, so RLS and the UPDATE/DELETE revokes that make the seal tables append-only are NOT in force
  on it. Fixes for all of this are in `m12/node-dir-gcp`; the line returns to ✅ when they are
  applied, the image is trigger-built from main, and the timer has fired on its own schedule with a
  registered agent's share in the dump. → Entries 21, 22, 23
- **DOD-NODE-DIR-GCP-2** [trustless-cello] — second GCP directory in a different region; same
  artifact, zero manual steps (IaC enforcer green on the repeat). — ✅ `gcp-usc1` (us-central1)
  HEALTHY. **IaC enforcer green on the repeat, measured not asserted:** added as ONE
  `directory_nodes` map entry; the apply created 99 resources across nodes 2 and 3 with **zero new
  resource blocks written**. Subnet CIDR derives from the node's own `subnet_index`, which is what
  made it one entry rather than two. → Entry 24
- **DOD-NODE-DIR-GCP-3** [trustless-cello] — third GCP directory (temporary Wave-1 member so the
  standalone consortium is N=3; displaced or re-rolled as replica when AWS joins in P3). — ✅
  `gcp-euw1` (europe-west1) HEALTHY. Another continent on purpose: at N=3 with T=majority=2 the
  third node is what decides whether a US-wide event drops the consortium below threshold. → Entry 24
- **DOD-NODE-RELAY-GCP-1** [trustless-cello] — at least one GCP relay live: MIG(1) + COS,
  persistent disk for the WAL dir, two secrets, static IP. No code changes expected — flag any
  that turn out to be needed. — ✅ `gcp-relay-use1` LIVE at 34.139.119.165.
  `{"relayId":"8492fffe…51b0","status":"ok"}`, `relay.service.started`, listening
  `/ip4/…/tcp/4001/ws/p2p/12D3KooWJXHpnWQhGk3jXBJYdXMmeLxEhRqzwZCYd1bxSUh4pg83`. **Registered with
  the consortium:** the directory logged `relay.registered` and `relay.adapter.multiaddr.updated`,
  which is what makes sessions brokerable at all. WAL on its own persistent disk (`/dev/sdb` on
  `/mnt/disks/cello-wal`), format guarded by a `blkid` check so an instance replacement cannot
  silently mkfs away journalled frames. Two secrets, per-relay, never copied.
  **NO relay code changed** — the clause asked for that to be flagged, and it held: the GCP secret
  plumbing lives in cloud-init, so the relay stayed a standalone artifact with env-only config
  (DOD-INV-RELAY-EXTRACTABLE). Two config-shape defects found by running it: it requires a single
  registration TARGET (`CELLO_DIRECTORY_PUBKEY`) as well as the accept-set, and its two libp2p
  listeners cannot share a port (`CELLO_RELAY_LISTEN_ADDR` defaults to 4001, colliding with WS).
  → Entry 24
- **DOD-MANIFEST-GCP-1** [cello-client, trustless-cello] — fresh consortium manifest signed:
  three `gcp-*` validators with roles, adopted by clients via poll; step-6 directory identity
  verification passes against the new manifest. — 🟡 DIRECTORY HALF DONE. Manifest signed over the
  three validators (`role: validator`, T = majority(3) = 2) with a FRESH officer key generated in
  GCP Secret Manager — not the AWS one, per M12-D4's zero-shared-state rule, which also keeps this
  off a hibernated AWS account. Live on all three nodes:
  `directory.manifest.store.loaded { manifestVersion: 1, verified: true }`. Nothing hand-entered —
  identities come from `gcp-node-identities.sh` and were verified byte-identical to what each node
  logs for itself at boot. **Step-6 client verification PROVEN** (Entry 25): a live client verified the
  manifest, resolved all 3 nodes, and completed directory identity auth — `directory.auth.challenge.verified`
  on the client, `directory.auth.challenge.signed` on the directory, same agent, same instant.
  **CORRECTION (Entry 26): anti-entropy is NOT yet proven.** Entry 24 claimed a working mesh on the
  strength of `antientropy.round.started`; rounds STARTING is not rounds COMPLETING, and the §1c
  handshake is failing (`protocol_error` dialside, `wire closed while waiting for ae_auth_a`
  responder-side). Dialling now works — that was a separate defect — but no round has completed in
  production. **Owed:** the AE handshake, and the cello-client bundled-manifest half. → Entries 24-26
- **DOD-MOVE-OPSAGENT-1** [trustless-cello] — ops-agent runs on GCP; email via the SES HTTPS API
  (WIF or SigV4 credentials handled without SA keys — no key files exist, org-enforced); its
  DB-access pattern redesigned so it needs NO cross-cloud database connection (per-node health
  via node-local API or equivalent — resolve in the unit, journal the design). — ❌
- **DOD-MOVE-PORTAL-1** [cello-portal, trustless-cello] — portal serves from GCP. **Coupling
  clause:** the portal RDS also carries the M11 waitlist tables, and the waitlist (Lambdas, SES
  hooks) STAYS on AWS — the unit must resolve app-first vs move-both vs defer-DB explicitly
  against M12-P2 (parked decision) before touching anything. — ❌
- **DOD-E2E-GCP-1** [trustless-cello, cello-client] — **GCP standalone enforcer:** with AWS
  unreachable, on the rebuilt system: fresh registration → DKG → seal → live two-agent session →
  kill one directory → sealing continues (T−1=1) → client failover → anti-entropy convergence
  verified → kill-switch pause bites across all three nodes. — ❌

## Tier P3 — Wave 2: AWS rejoins + the launch claim

- **DOD-AWS-NODE-1** [trustless-cello] — fresh `aws-use1` directory + relay pair (rebuilt, no
  data carried over), joining the consortium over anti-entropy only (DOD-INV-NO-VPN holds — no
  tunnel exists). AWS side stays on CodePipeline CI until P4. — ❌
- **DOD-MANIFEST-FINAL-1** [cello-client, trustless-cello] — final launch manifest: N=3
  validators = 1 AWS + 2 GCP (+ any replicas), adopted by poll; the displaced Wave-1 GCP node is
  removed or re-rolled as replica in the SAME manifest version. — ❌
- **DOD-CLAIM-1** [trustless-cello] — **outage-claim enforcer:** with both GCP directories
  blocked, an existing agent seals via the AWS node alone; new registration refuses loudly
  (|Q| ≥ T unmet) with a cause-naming error. The honest claim — "existing agents keep working
  through a GCP-wide outage" — is recorded verbatim in the journal with the run output. — ❌

## Tier P4 — Wave 3: teardown (each stack gated on Andre's explicit go)

- **DOD-TEARDOWN-NODES-1** [trustless-cello] — eu-central-1 and ap-northeast-1 stacks removed;
  hibernate/wake scripts and deploy.sh updated to the new topology; STATE.md reflects reality. — ❌
- **DOD-TEARDOWN-USE1-1** [trustless-cello] — old us-east-1 directory/relay/RDS stacks replaced
  by the rebuilt pair's stacks; moved workloads' old AWS resources (ops-agent task, portal ECS/
  ALB/RDS per the P2 portal decision) removed. Waitlist + SES stay. — ❌
- **DOD-TEARDOWN-CI-1** [trustless-cello] — AWS CodePipeline/CodeBuild/ECR reduced to exactly
  what the AWS node needs (or replaced by Cloud Build + WIF cross-push if the unit proves that
  simpler); the four dead REPOSPLIT pipelines removed from `cello-cicd.yaml` +
  `pipeline-mappings.json` (+ `deploy-lambdas.sh dev filter`). — ❌
- **DOD-TEARDOWN-MESH-1** [trustless-cello, cello-client] — the Postgres mesh is fully retired
  from the CODE: `setup-replication.sh`, slot/SEQ machinery, mesh-only config deleted with
  removal-integrity review (proven deadness, built-artifact absence, deleted-test triage by
  subject). — ❌

---

## Decisions

- **M12-D1** (2026-07-28, Andre): Milestone ID is **M12**. The rebuild has nothing to do with the
  waitlist, so an M11 suffix would confuse; it is big enough to take a number. The former roadmap
  M12–M17 (Social Trust … Federation) are renumbered M13–M18 — `implementation-roadmap.md` and
  `ROADMAP.md` updated in the same commit; historical discussion logs and journals keep the old
  numbers (they are records, not living docs).
- **M12-D2** (2026-07-28): **IaC tool for GCP = Terraform** (CloudFormation does not exist on
  GCP; gcloud-script IaC has no state/drift model; Terraform is the practice least likely to need
  reversing and can eventually absorb the AWS side). Overturn before DOD-IAC-BASE-1 if Andre
  objects.
- **M12-D3** (2026-07-28): the disposable probe deliberately runs as the real `directory-node`
  SA — the probe exists to prove the exact node shape including workload identity; lifecycle is
  minutes; org blocks SA keys so the exposure window is IAP-SSH only.
- **M12-D4** (2026-07-28, Andre): **the GCP system runs in PARALLEL with the live AWS dev
  system until Wave 2 cutover.** Zero shared runtime state: own project, own images, own
  Cloud SQL, own signed manifest, own DNS names. The client-side toggle is the bootstrap
  manifest endpoint (+ a separate local daemon DB profile — a different consortium means a
  fresh registration, which is the rebuild test anyway). Protocol-code units (P1+) happen on
  story branches rebased from main regularly — parallel AI coders keep working on main; Cloud
  Build builds test images FROM the story branch; merge to main only when units close. The AWS
  system never runs M12 code until Wave 2.
- **M12-D5** (2026-07-28): GCP SDK deps (`@google-cloud/storage`, Cloud KMS) go in the
  **directory package (server-side, runs on the node VM)**, lazy-`import`ed exactly like the
  AWS SDK (`bin/directory.ts` uses `await import("../adapters/s3-...")` so local mode never
  loads it). They are NOT shipped to operators (that's the cello-client/cello-mcp concern), so
  the CLAUDE.md install-size rule does not apply.
- **M12-D6** (2026-07-28): **The Parameter Manager adapter is NOT needed for M12** — resolving
  DOD-ADAPTER-GCP-1's open question. Evidence in `bin/directory.ts`: the SSM node registry
  (`parseNodeRegistryEntries`) emits `node.registry.empty` as a NON-FATAL error and returns an
  empty set; the relay pool is seeded from the CloudStorageProvider manifest (→ GCS adapter),
  not the registry, and relays self-register at runtime via libp2p `relay_register`. So a GCP
  directory boots and functions from the GCS-backed manifest + live self-registration with no
  Parameter-Store equivalent. Confirm with a live empty-registry boot in P2 (DOD-NODE-DIR-GCP-1);
  until then the adapter set is **GCS cloud-storage + GCS audit-log + Cloud KMS envelope key**
  (three, not four).
- **M12-D10** (2026-07-28): **`m12/adapter-gcp` is SUPERSEDED — do not merge it.** Entry 19 listed
  four branches awaiting Wave 2; there are three. The branch is an early draft that lacks the KMS
  provider and the audit shipper entirely and carries an older GCS provider; the shipped, reviewed
  adapter set lives on `m12/ae-append` (Entries 16, 18). Verified: `git diff HEAD m12/adapter-gcp`
  removes 486 lines and adds 48, and the one file it holds that HEAD lacks
  (`gcs-cloud-storage-provider.test.ts`) is subsumed by `gcp-adapters.test.ts`, which covers all
  three adapters. Live branches: `m12/role-manifest`, `m12/multiaddr`, `m12/ae-append`, and now
  `m12/node-dir-gcp` (the integration branch — the other three are merged into it). → Entry 20
- **M12-D11** (2026-07-28): **the first GCP node's boot code merges all M12 branches rather than
  deploying from one.** The four P1 units were built on independent branches off different bases,
  so no single one produces a runnable M12 node. `m12/node-dir-gcp` is that integration branch.
  The semantic merge that mattered: `computeDkgTopology` (role-manifest, validator-only counting)
  now takes its node set from `getVerifiedManifest()` (M12-D8), not the served copy — both
  concerns survive rather than one silently winning. → Entry 20
- Decisions 1–11 of the spec-of-record are restated there, not here — this section holds only
  decisions made DURING the milestone.

## Parked

- **M12-P1** — **Demo agent move** (EC2 `i-0ad3e7c22470f266e`, not in IaC). Candidate, not
  decided. Easiest workload to move (systemd units), but every SSM runbook line breaks. Decide at
  P2; write IaC for it whichever cloud it lands on.
- **M12-P2** — **Portal/waitlist DB coupling.** The portal's RDS carries the waitlist tables;
  waitlist stays on AWS while the portal moves. App-first (portal on GCP, DB stays on AWS RDS over
  TLS), move-both-later, or split the schemas — resolve at DOD-MOVE-PORTAL-1, not before.
- **M12-P3** — **Enrollment** (client-side resharing orchestration + may-enroll credential) —
  explicitly OUT of M12 (Decision 10). Required before N ever grows past 3. Directory half
  already exists (`frost-handler.ts:892,915`).
- **M12-P5** — **Cross-signed checkpoints have NEVER worked** (MMR tables never replicated →
  every node's peaks differ → verifyAndSign refuses; CHECKPOINT_PEER_ADDRS empty everywhere;
  identity_merkle_root never computed — surface-map findings). M12 syncs checkpoint records as
  data, retires the unauthenticated `/cello/checkpoint/1.0.0` channel, and leaves cross-signing
  visibly parked. Rebuild post-M12 on the authenticated AE channel with a deterministic shared
  leaf order.
- **M12-P6** — **Suspension records are node-attested, not owner-authorized** (design review F2):
  one compromised in-roster node can mint `burned=true`/spurious un-pause for any agent, and
  burn-OR propagates it irreversibly. No worse than today's mesh, but the real trust boundary.
  Hardening = end-to-end owner-signed suspension authorization, mirroring the M8B FROST-stream
  auth deferral. Out of M12.
- **M12-P8 — AutoNAT tears down the connection anti-entropy runs on. ✅ FIXED AND VERIFIED LIVE.**
  autonat's responder calls `openConnection(multiaddr, options)` — which RETURNS AN EXISTING
  connection when one is open to that peer — and then closes it in a `finally`, killing every
  stream multiplexed on it. Explains 100% AE failure, symmetric, stage-independent, and why the
  loopback enforcer never reproduced it (autonat skips same-host peers, so PUBLIC ADDRESSING is
  the discriminator). Fixed by a pnpm patch passing `force: true`, which is also semantically
  correct: reusing a connection made the reachability check vacuous as well as destructive.
  Kept directories serving dial-back, so client NAT detection (DOD-NAT-REACHABILITY-1) is
  untouched, and needed no transport change or publish cascade. The Dockerfile copies `patches/`
  into both install stages and ASSERTS the patch is in the production tree.
  **Live evidence** (image `ae-autonat-f148aa27`, 6-minute steady-state window after rollout):
  24 `round.started`, 24 `round.completed`, 24 `peer.authenticated`, **0 `auth_failed`** — against
  a prior state of 0 authenticated and 100% failure. Full mesh: 10 completed rounds against each
  of `gcp-use1`, `gcp-usc1`, `gcp-euw1`, so every node reconciles with every peer.
  Not provable locally — the loopback enforcer cannot reach this path by construction.
  **Still owed for `DOD-E2E-GCP-1`:** production convergence of DIVERGENT state. Rounds completing
  proves the transport and the handshake; the local enforcer proves the algorithm. Neither proves
  a write on one node lands on the others in production.
  **Watch:** cello-client also runs autonat; if a client-side stream shows the same teardown, it
  needs the same patch there. → Entry 31, Entry 32
- **M12-P9 — two worktrees shared ONE local Postgres.** `docker-compose.yml` pinned the host port,
  so a second checkout either failed to bind or silently used the first's server — and the spine
  harness DROPs and re-migrates from scratch. Two branches re-migrating one server to two heads
  (main V54, this branch V50) produced a bogus `migration.out.of.date` that read like a broken
  startup guard. `DATABASE_URL` is now the single knob for both bring-up and connect. → Entry 32
- **M12-P7** — **`verifyChain('user_accounts')` cannot pass on a shared test database.**
  `account-001` AC-005/AC-007 verify the chain over the WHOLE table, but ~10 test files
  `DELETE FROM user_accounts` as cleanup, and `verifyChain` recomputes each row's hash from its
  predecessor starting at `CHAIN_GENESIS` — so one deleted row invalidates every row after it.
  Measured on a fresh database mid-run: 2 rows survive, at `id` 10 and 37. The assertion is
  therefore order- and history-dependent, which is why it is green in one checkout and red in
  another. **The product is correct** — the defect is that tests delete from a table the design
  calls append-only. Fix is either hermetic isolation (point the store's pool at a scratch
  `search_path` holding a `LIKE public.user_accounts INCLUDING ALL` copy) or stopping the deletes.
  Not in M12's path; recorded so the two reds are known-and-explained, not ambient. → Entry 20
- **M12-P4** — **Replica nodes at launch.** The role split ships in P1, but whether any
  replica-role nodes actually deploy at launch (vs the capability lying dormant) is undecided —
  zero replicas is a valid launch shape.

---

## Related Documents
- [[M12-PROCEDURE]] — how to work this milestone (read first)
- [[M12-BUILD-JOURNAL]] — evidence home
- [[2026-07-28_0700_gcp-rebuild-decision-record]] — spec-of-record
