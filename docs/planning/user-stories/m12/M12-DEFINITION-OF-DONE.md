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

## Tier I — Invariants (properties, NOT deliverables — no status tags)

> **CHANGED 2026-07-30. These nine carried ❌ tags and should never have.** An invariant is a property
> every unit must not violate — you never *build* one, so it cannot be a deliverable, and a permanent
> ❌ on a property reads as unfinished work no unit can ever finish. They are **enforced per-unit as
> reviewer lenses**: [[M12-PROCEDURE]] §2b, where every one of the nine now has a lens that fires on
> every diff. Stated once here, untagged, because they are the yardstick's fine print.

- **SOVEREIGN** [all] — no single node completes a threshold ceremony alone; no privileged node in any
  topology, sync, or deploy decision; no provider-specific networking or hardcoded endpoint in protocol
  code; a down node is routed around, never fatal.
- **THRESHOLD** [trustless-cello, cello-client] — `T = majority(validators)` everywhere.
  `consortiumNodeCount` and every threshold/DKG/kill-switch derivation counts **validator-role nodes
  only**; replicas never enter the arithmetic. All-N / T=N never appears (settled 2026-07-04).
- **SHARES-LOCAL** [trustless-cello] — `agent_key_shares` (or successor) appears in NO sync set, NO
  anti-entropy exchange, and NO off-node artifact except the node's own encrypted backup. A share never
  transits between nodes by any mechanism.
- **KILL-SWITCH** [trustless-cello] — suspension fails CLOSED and converges suspended-wins: a pause
  reaches every up node despite partition and restart; an un-suspension requires verifiably newer
  authenticated state; a tie resolves suspended. A paused agent sealing because an UP node lacked the
  state is a critical finding.
- **NODEID** [all] — every node is born `<cloud>-<region>` (`aws-use1`, `gcp-usc1`) and is never
  renamed; no two manifest entries ever hold the same FROST identifier in one manifest version.
- **NO-VPN** [trustless-cello] — no VPN, VPC peering, Private Service Access consumer, or cross-cloud
  tunnel. Directory sync happens only over the authenticated libp2p transport. Nothing external ever
  connects to a node's Postgres.
- **RELAY-EXTRACTABLE** [trustless-cello] — the relay gains no consortium state, no database, no shared
  internal config package, no directory import; config stays env-only. It remains a standalone
  shippable artifact (future enterprise private relay).
- **IAC** [trustless-cello] — every GCP and AWS resource exists in IaC; any manual emergency fix lands
  in IaC + the STATE file before its unit closes. Region-expansion test: a new region with zero manual
  steps. (Inventory discipline — `terraform plan` is the GCP inventory, [[M12-PROCEDURE]] §5.)
- **NO-SAAS / DOMAIN** [all] — no paid SaaS; all URLs are `*.cello.mygentic.ai`.

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
  untouched and functional for the AWS node until P4. — 🟡 **REGRESSED, demoted 2026-08-05.**
  The ✅ was earned: push `e8842f33` fired BOTH triggers via real push events → both SUCCESS,
  SHA-tagged; infra-only push `540fc175` fired neither (negative filter proof); review findings
  fixed (no `:latest`; gcloudignore inherits gitignore; TF-owned `_REGISTRY`). **Those builds are
  also the LAST the triggers ever produced** — 2026-07-28T07:32Z. The clause "Cloud Build builds
  the images from the GitHub repo (path-filtered triggers)" has been false since that day, so the
  line cannot hold a ✅ describing a capability nobody has. Half the cause is fixed (the CI service
  account could not create builds — Entry 83); event delivery is still dead. Registry, images and
  the no-local-push clause are unaffected and still true. Re-earns its ✅ when a push produces a
  trigger-attributed build — tracked as **M12-P11**. → Entries 3, 6, 83
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
> **SPLIT 2026-07-30 — the line below was ONE ❌ concealing ~10 built-and-reviewed sub-units.** The
> anti-entropy work decomposes into a pure logic layer, a pg-backed store, a libp2p channel, and the
> behavioral claim that rides them; keeping it as one line meant the status authority could not tell
> you where the largest unit in the milestone stood, and only the journal could — the journal that had
> just lost ten entries. Statuses below are inherited from Entries 16–25 and are deliberately
> conservative: nothing is ✅ whose reviewer verdict is not quoted ([[M12-PROCEDURE]] §2).

- **DOD-AE-PRIMITIVES-1** [trustless-cello] — the pure, transport-and-DB-agnostic logic layer:
  bucketed set-reconciliation (digest + delta), record-hash and the Tier-A per-table encoders,
  Tier-B suspension/presence merges + version summaries + version-reconcile, the round planner
  (`planRound`), handshake verification (`verifyPeerAuthFrame`), the engine (`runAntiEntropyRound`)
  over an injected `AeStoreView`, and the peer-auth TBS in `@cello-protocol/crypto` (published).
  Proven by an in-memory two-node convergence test wiring the REAL encoders and merges: divergent
  nodes converge (Tier-A union; Tier-B higher-seq-wins with monotonic burn on both) and TERMINATE —
  round 2 applies zero. — ✅ the owed verdicts are quoted (→ Entry 70). Reviewer, verbatim:
  *"SPEC: DEVIATIONS FOUND … SILENT FALLBACKS FOUND — F2 is the fail-open … HOLLOW TESTS FOUND"* —
  9 findings, 3 HIGH, **all closed**: failure containment moved out of the store into the engine, a
  withholding peer can no longer report `{0,0,0,0}` as convergence (`tierAPlanned`), and peer-advertised
  tables are filtered against the local registry so a rolling upgrade cannot kill suspension
  replication. Verified on the 3-process spine gate, 5/5 (→ Entry 70b), not only the unit suite.
  → Entries 16–25, 70, 70b
- **DOD-AE-STORE-1** [trustless-cello] — a Postgres-backed `AeStoreView`: SELECT the synced tables into
  the encoders for advertise; INSERT-if-absent / merge-upsert for apply. **It must reproduce the
  MemStore semantics the convergence proof used** — a pg store that diverges from the proven semantics
  makes the proof describe something nobody runs. `agent_revocations.signature` is BYTEA and MUST be
  hex-encoded in the SELECT (pg returns a Buffer; no type-parser override is installed). — ✅ (→ Entries 69, 71).
  Parity proven against REAL Postgres; the DoD's named BYTEA trap pinned by proving the test's own
  discriminating power. Reviewed (pass 2 of 2), verdict verbatim: *"SPEC: DEVIATIONS FOUND … SILENT
  FALLBACKS FOUND … ERROR SUBSTITUTION FOUND … HOLLOW TESTS FOUND"* — 5 findings, **all closed**: the
  kill switch could be flipped off by a mistyped `suspension_seq`; the fork alarm could never fire for
  the right reason; the generic apply path had no per-record containment; a null-`agent_id` profile is
  now refused. The reviewer's stated condition for closing — a live proof that an AE-applied row still
  chains — is met, and my first attempt at it was hollow (Entry 71).
- **DOD-AE-CHANNEL-1** [trustless-cello] — the `/cello/anti-entropy/1.0.0` libp2p handler: dial and
  reconnect, the mutual handshake over the stream (`verifyPeerAuthFrame` plus our own signed frame),
  and the digest→detail→pull round protocol with write-hints. Manifest gains `peerId` population and
  the directory VERIFIES its manifest at load (design §1a/§1b). Peers failing identity verification are
  refused with the cause named. — ✅ (→ Entries 70b, 72). Reviewed, verdict verbatim:
  *"SPEC: DEVIATIONS FOUND … SILENT FALLBACKS FOUND … ERROR SUBSTITUTION FOUND … HOLLOW TESTS FOUND"* —
  10 findings, **all closed** (→ Entry 72b — I flipped this tag when 7 were closed and said "all";
  the remaining three, plus a hollow sovereign-isolation test, were closed after). `write-hints` is
  deferred with its cost stated (`M12-D-AE-WRITE-HINTS`).
  The reviewer's own summary of the auth path: *"the handshake, the fail-closed discipline, the
  cause-naming and the manifest-verification wiring are the strongest parts of the M12 code I have
  read, and I could not break the auth path."* 14/14 over the wire; re-verified on the 3-process spine
  gate 5/5 AFTER the fixes, since they changed wire behaviour.
- **DOD-AE-APPEND-1** [trustless-cello] — **the behavioral claim, riding the three above:** append-only
  tables sync between directories over the authenticated libp2p channel via root-comparison + delta
  pull; divergence detection is O(compare), transfer is delta-only; peers that fail identity
  verification are refused. Proven by a multi-process integration test, not unit tests. — ✅ the
  multi-process proof EXISTS and is green: `j-antientropy.spine.test.ts` 5/5 across **three real
  directory processes** over Noise (→ Entry 70b) — divergent state converges on all three, a node absent
  for a burst catches up on rejoin with no operator action, and both kill-switch clauses hold across a
  real partition. Clause evidence: O(compare) by frame count (a converged round sends digests and
  nothing else), delta-only by the bucket-walk test, identity refusal by six fail-closed cases. AE-CHANNEL-1's verdict is now in
  and its 10 findings are closed, and the spine gate was re-run green AFTER those fixes — so the layer
  this claim rides is no longer the open question. ✅
- **DOD-AE-CHAINED-TABLES-1** [trustless-cello] — the two hash-chained Tier-A tables
  (`seal_notarizations`, `user_accounts`) serve AND apply through anti-entropy, so a seal receipt no
  longer exists only on the directory that recorded it. Chain columns are node-local: an applying node
  recomputes them against its own tip. — ✅ **2026-07-31 — the owed live cross-node proof is in.**
  Reviewer verdict, quoted: *"SPEC: FAITHFUL — every clause implemented; the one unproven clause is
  journaled (Entry 64) and correctly carries 🟡, not ✅. Do not flip it without the live cross-node
  proof."* Its three blocking findings — *"SILENT FALLBACKS FOUND"* (hex truncation the chain would
  have certified), *"ERROR SUBSTITUTION"*, *"HOLLOW TESTS FOUND"* — were closed earlier.

  **The proof, on the live fleet after the V57 roll:**

  | node | seals | accounts | seal `fd96bc5b4e8be5` chain_hash |
  |---|---|---|---|
  | gcp-use1 | 14 | 47 | `21b1dcd122255b` |
  | gcp-usc1 | 14 | 47 | `c8b09a63f6b23d` |
  | gcp-euw1 | 14 | 47 | `2c6b755f803b31` |

  Both clauses, separately:
  - **A seal receipt no longer exists only on the directory that recorded it.** Identical counts and
    identical `sealed_root` values on all three.
  - **Chain columns are node-local.** The SAME seal carries a DIFFERENT `chain_hash` on each node —
    which is what recomputing against your own tip looks like. Had the column been replicated
    verbatim the three would be identical, and the chain would be asserting a predecessor that node
    never had.

  **Why this particular seal is the strongest case available:** `fd96bc5b…` is the seal produced
  during the degraded-mode run, while **gcp-euw1 was down**. euw1 holds it now, and holds it under
  its own chain — acquired entirely through anti-entropy after it came back, with no operator step.
  → Entries 64, 66, 75
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
- **DOD-PARK-DRAIN-1** [cello-client] — parked store-and-forward content is delivered to a
  RUNNING receiver daemon, no restart: drain on every successful standing-receiver
  (re)build (covers the watchdog rebuild path where parking actually happens), ensure→drain
  ordering fixed on signaling reconnect (today they race, 102 `standing_receiver_unavailable`
  failures in one log), slow periodic backstop drain, error serialization fixed
  (`[object Object]`). Proven across two daemons on two machines against a deliberately
  flapping relay link. Discovered 2026-08-04: every cross-machine message stalled until the
  receiving daemon was restarted. Full diagnosis + fix spec:
  [[relay-keepalive-parked-drain-workorder]]. — 🟡 BUILT, LIVE CLAUSE OPEN.
  All four fix clauses land; E1 proves the headline claim locally — a message deposited on a real
  `/cello/content-park` relay WHILE the daemon runs is unsealed, SEC-1 gated, leafed and
  confirm-deleted, no restart. **Open:** "two daemons on two machines against a deliberately
  flapping relay link" needs a deploy this session did not do. Reviewer: 7 findings (1 HIGH —
  concurrent drains could double-append a leaf; 1 unproven removal), all closed.
  **Shipped 2026-08-05:** daemon **0.0.121** on `latest`, merged to `main`, and now running on
  BOTH machines. **Live run 2026-08-05 — the drain half PASSES, the claim does not.** Parked
  content was deposited, pulled, verified and correctly HELD on an ordering gap, all against a
  daemon that never restarted (same pid throughout). It never reached the operator: the previous
  message's park deposit had failed with `standing_receiver_unavailable` and was never retried, so
  `nextExpected` can never be satisfied and every later message in that session is stranded. A
  SENDER-side durability hole, distinct from this line's four receiver-side clauses — **M12-P12**.
  **M12-P12 BUILT + 2 review passes (the cap) + MERGED 2026-08-05** (`af1473b`): the refusal now
  enqueues durably WITH the relay's ordering record, on both park triggers; the sender re-park rides
  the standing-receiver rebuild and the reconnect, not just a restart; and `cello_send` stops telling
  the operator "queued, will be retried" about a message that is gone. Two gaps recorded, not closed:
  the `daemon.ts` drain-hook line has no unit test (needs a live relay — the two-machine run covers
  it), and the awaiting queue's content-only dedupe key can still drop a duplicate message (logged).
  **Published 0.0.123 + both machines upgraded (from `@beta`) 2026-08-05; the fix is verified present
  in the built artifact.** Its failure path could NOT be reproduced on demand: `set-agent-offline`
  does not stop an open session's node (measured — delivery still succeeded), and the CLI refuses a
  send from an offline agent, so the sender-side refusal is a rebuild-window race with no CLI lever.
  **SENDER HALF PROVEN 2026-08-05** with a purpose-built fault lever (`m12/park-fault`), daemon pid
  unchanged throughout: `content.park.deposit.failed cause=standing_receiver_creating` →
  `content.park.deferred selfOrdering=true` → `content.recover.drain.triggered
  reason=standing_receiver_ready` → `content.park.flush.completed parkedCount=1` → receiver pulls and
  `content.recover.verified`. **Blocked from ✅ by M12-P13**, not by anything in this line: the
  receiver holds it at `nextExpected=0` because its OWN away-response failed to send and was never
  retried. → Entries 88, 89.
  → Entries 78, 81, 82, 83, 84, 85, 86

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
  verification passes against the new manifest. — ✅ **2026-07-31 — both owed halves closed.** Manifest signed over the
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
  production. ~~**Owed:** the AE handshake, and the cello-client bundled-manifest half.~~

  **BOTH CLOSED 2026-07-31 (Entries 74-75).**

  **1. Anti-entropy completes in production** — proven three independent ways on the live fleet, each
  a different tier of the store:
  - Tier-A immutable: 45 agent profiles identical on all three nodes, **including one registered
    while gcp-euw1 was down** — it acquired that row on rejoin with no operator step.
  - Tier-A chained: 14 seal notarizations on each, same `sealed_root`, node-local `chain_hash`
    (see `DOD-AE-CHAINED-TABLES-1`).
  - Tier-B mutable: a kill-switch pause written on gcp-use1 alone read
    `paused=true seq=1 origin=gcp-use1` on all three.

  **2. The cello-client bundled-manifest half** — the roster in the published client now names the
  three `gcp-*` validators, verified in the TARBALL (`daemon@0.0.103`), not merely on main. A client
  built from it resolves `declaredNodes: 3, resolvedNodes: 3` and completes registration, DKG,
  session, seal against the live fleet. The manifest also moved to **v2** so it carries `intake_key`;
  v1 was the same roster without it, which a client accepts and then refuses every trust-signal
  submission against. → Entries 24-26, 74-75
- **DOD-SEAL-BROKER-1** [trustless-cello] — **the relay asks the BROKERING directory, per session,
  not a configured one.** Today `relay_primary_directory` pins the relay to one directory for every
  conversation in the consortium, chosen at deploy time and unrelated to who is talking — so the
  directory asked to produce a receipt may be the home directory of one participant, or of neither.
  Everything downstream is recovery from an arbitrary choice.
  The information needed already exists: the signed session assignment carries the owning directory
  and is delivered to both agents. The relay is the only participant not told.
  **Done means:** (a) the directory identifies itself when it hands a session to the relay;
  (b) the relay records that per session and uses it when it needs a receipt produced, falling back
  to the configured directory ONLY when absent, so existing single-directory deployments are
  unaffected; (c) a cross-directory conversation seals with the relay pinned to a directory that is
  the home of NEITHER participant — the case that is currently untested and worst;
  (d) no directory-to-directory message forwarding is introduced, and the notification queue is not
  replicated. — ✅ **ALL FOUR MET (Entry 59).** Live enforcer `j-gcp-live.spine.test.ts` GREEN in 151s
  with agents on `gcp-usc1`+`gcp-euw1` and the relay pinned to `gcp-use1` — the home of neither.
  `relay.seal.broker.resolved` → `delivered` → `notarization.recorded`, no redirect, no forwarding.
  **Reviewed (Entry 60), 9 findings, all closed.** The live run alone did NOT earn clause (c): revert
  the broker selection and the configured directory still redirects, the seal still completes, and
  every assertion in the live enforcer still passes — it proves cross-directory sealing works, not
  that the relay asked the broker. Now enforced offline by
  `relay/src/__tests__/m12-seal-broker-selection.test.ts` (5/5), which asserts the TARGET
  `processSeal` is called with. Revert-tested twice: removing the broker record turns 3 red, and
  dropping `directoryEndpointsByPubkey` in the factory — the bug that actually cost a deploy cycle —
  turns the same 3 red.
  **F1 was a new single point of failure** and is fixed: an up-but-unreachable broker rejected the
  seal outright (processSeal dials only its given target and returns no redirect), where before the
  configured directory would have been asked and would have redirected. That violated the redundancy
  invariant — one unreachable node making CELLO unusable. Also fixed: the leaked broker map that the
  teardown-parity helper could not see (F5), the broker recorded before `recordSession` succeeded
  (F7), a rejected seal whose cause was discarded (F6), and an endpoint parser that deferred a config
  typo to a per-seal fallback instead of a startup fatal (F9).
  **Why it was not built:** relay SELECTION (directory picks a relay per session, health-aware) was
  built — `pickRelay()`. The return direction was deferred to a config value and never revisited.
  The asymmetry is the defect: dynamic outbound, hardcoded inbound.
  **Not covered by this line:** delivering the finished receipt to BOTH agents. The brokering
  directory reliably holds one participant's connection, not both.
  **CORRECTION (Entry 60) — the premise recorded here was false.** This said a fetch would suffice
  "because receipts already replicate to every directory". They do not. `seal_notarizations` is
  declared in `TIER_A_SPECS` but is NOT in the pg store's sync registry — it needs the canonical
  chain writer (`insertWithChain`) and was left out deliberately rather than half-wired
  (`pg-ae-store.ts` "Scope"). So a receipt exists only on the directory that recorded it, and the
  `seal_result_request` fetch can only be answered by that same directory — the one that already
  tried to deliver it. The fetch is therefore near-useless until receipts replicate, which makes
  the chain-writer unit its prerequisite, not an unrelated follow-up. Now asserted in
  `m12-inv-shares-local.test.ts`, so this cannot be mis-stated again: when the chain-writer lands,
  that test goes red and forces both the registry list and this assumption to be revisited.

- **DOD-MOVE-OPSAGENT-1** [trustless-cello] — ops-agent runs on GCP; email via the SES HTTPS API
  (WIF or SigV4 credentials handled without SA keys — no key files exist, org-enforced); its
  DB-access pattern redesigned so it needs NO cross-cloud database connection (per-node health
  via node-local API or equivalent — resolve in the unit, journal the design). — ✅ **2026-07-31,
  reviewed and all blocking findings closed.**

  **Why it was not optional:** registering an agent needs a pre-authorization capability, and this
  Telegram bot is the ONLY thing that issues one to a human. Without it on GCP, nobody new can
  register at all.

  Cloud Run, min = max = 1, `cpu_idle = false` — a long-polling bot that scales to zero stops
  answering, and two instances would race for the same update. No cross-cloud DB connection: it
  reads gcp-use1's Cloud SQL over PSC. Per-node health reads every node's `/health` rather than
  opening three database connections, because a monitor holding admin credentials for every
  sovereign node's database would be a standing cross-node privilege in a system built to have none.
  **Verified live: `ops_agent.nodes.ok — 3/3 nodes at schema 56`.**

  **DEVIATION, journaled and accepted:** OTP delivery uses the SES HTTPS API (SigV4-signed by the
  SDK) but with STATIC AWS credentials from Secret Manager, not WIF. No GCP service-account key
  exists, so the org policy holds — but this is a live AWS dependency in a system otherwise off AWS
  and must be replaced before that account closes.

  **The review found three defects in code written to prevent the very thing that then happened**,
  all fixed and re-verified live:
  - The second-poller guard could never fire — the conflict window was zeroed by any non-409
    response (including a 429, which is evidence you do NOT hold the poll), and a real second poller
    alternates rather than conflicting continuously. Two ops agents could have run forever.
  - A sick directory could take down registration: the per-node timeout bounded the response
    HEADERS only, and the sweep was awaited before the health port opened, so one half-responsive
    node could hold the port shut past the startup probe and get the instance killed on a loop.
  - The DB credential was the schema OWNER, which bypasses every RLS policy — handing a process
    that writes registration rows the ability to mutate `conversation_seals`, `attestations` and
    `agent_key_shares`. Now `cello_service`, verified against the live database.

  Also closed: `unreachable` and `database: failed` both collapsed several distinct causes into one
  exit-point label (the same class the unit was opened to fix); the sweep ran once at boot and went
  silent when unconfigured; and the two secrets carried from AWS were referenced but never declared
  in IaC — now declared and imported.
- **DOD-MOVE-PORTAL-1** [cello-portal, trustless-cello] — portal serves from GCP. **Coupling
  clause:** the portal RDS also carries the M11 waitlist tables, and the waitlist (Lambdas, SES
  hooks) STAYS on AWS — the unit must resolve app-first vs move-both vs defer-DB explicitly
  against M12-P2 (parked decision) before touching anything. — ✅ **2026-07-31.**

  **Coupling clause resolved: APP-FIRST with a NEW GCP database**, decided explicitly and written
  into `infra/terraform/portal.tf`'s header rather than drifted into. The waitlist tables and their
  SES-hooked Lambdas stay on AWS; nothing a customer touches depends on them.

  **Live at https://portal.cello.mygentic.ai** — the SAME hostname it had on AWS, and that is
  load-bearing, not sentiment: the GitHub OAuth callback is registered against it and WEBAUTHN_RP_ID
  is part of what every passkey is cryptographically bound to, so serving from the run.app URL would
  have invalidated every enrolled passkey permanently. A Cloud Run domain mapping needs the domain
  user-verified (a manual console step), so a global external ALB fronts it instead — proof of
  control is the DNS record, which is already ours. Managed cert ACTIVE, :80 redirects to :443
  because WebAuthn requires a secure origin.

  **Signs with Cloud KMS Ed25519** (`EC_SIGN_ED25519`), so the revision holds no private key —
  M10-D6 preserved across the move rather than traded for a seed in an env var. Public half enrolled
  as `submitter` in all three directories' `authorized_issuers`, verified present on each.

  **Portal→directory proven THROUGH THE APP**, not just at the network layer: `POST
  /api/internal/ingress/drain` → `{"ok":true, …, "nodeErrors":[]}`, and refuses 401 without the
  trigger secret. Reaching the directories at all required two fixes found by running it — 8081 was
  dropped by the COS host firewall while every cloud rule read correct, and the client factory
  refused a correctly-configured deployment because "configured" meant *a* key rather than a key per
  directory (one key across three nodes authenticates to at most one, so failover fails closed at
  exactly the moment it is needed).
- **DOD-E2E-GCP-1** [trustless-cello, cello-client] — **GCP standalone enforcer:** with AWS
  unreachable, on the rebuilt system: fresh registration → DKG → seal → live two-agent session →
  kill one directory → sealing continues (T−1=1) → client failover → anti-entropy convergence
  verified → kill-switch pause bites across all three nodes. — 🟡 PARTIAL — **every behavioural
  clause is now proven; what remains is that it is a MANUAL sequence, not a CI enforcer.**

  **FULL DEGRADED-MODE RUN, 2026-07-31, on the published client (`daemon@0.0.102`):**
  `gcp-euw1` stopped (container down, `:9090` unreachable from outside, exactly T=2 of 3 left).
  With it down: an existing pair opened a session over the relay, exchanged messages BOTH
  directions (`delivered: true`), and **sealed** — `sealed_root fd96bc5b…`, `attestation_mode: live`
  for both participants. Then a BRAND-NEW agent registered by DKG at exactly T
  (`M12_Degraded`, `agent_id 9b07e502…`) and came online, `directory_signaling: connected`.
  euw1 restarted → all three nodes converged to 45 profiles with identical rows, INCLUDING the
  agent registered while euw1 was dark — picked up by anti-entropy with no manual step.
  This is the outage claim, demonstrated rather than asserted: existing agents keep working AND
  new ones can still be created with one of three sovereign nodes down.
  **Proven manually on the live GCP system (Entries 37–38), AWS contributing nothing:**
  fresh registration → 3-node FROST DKG → cross-node discovery → presence replication →
  cross-node brokering → threshold signing → **session established over the GCP relay**, both
  US↔US (`gcp-use1`↔`gcp-usc1`) and **US↔Europe** (`gcp-use1`↔`gcp-euw1`); content read by
  sequence number on the far side; anti-entropy `applied > 0` with a lookup that changed answer;
  shares survive a full fleet restart (`sharesLoaded 2`, was 0).
  **Still owed — the parts NOT yet demonstrated, and the reason this is not ✅:**
  (a) it is a MANUAL sequence, not an automated enforcer — the DoD asks for a test that fails
  loudly in CI, and a hand-run session proves the system works today, not that it stays working;
  (b) **kill one directory → threshold holds** — ✅ EXERCISED: `gcp-usc1` stopped (TERMINATED),
  session still established on 2-of-3 (`T = majority(3) = 2`). Sealing itself still not exercised;
  (c) **client failover** to another directory — ✅ EXERCISED, and it found a real defect: failover
  triggered only on UNREACHABILITY, so a directory that resolves but belongs to another consortium
  was a permanent black hole. Fixed against DECLARED manifest membership; verified live with NO
  pinned URL (`not_in_consortium` → `failover to gcp-use1` → `auth.challenge.verified`);
  (d) **kill-switch pause biting across all three nodes** — ✅ **EXERCISED 2026-07-31.** Fired on
  `gcp-use1` ONLY, via `/internal/agent-write` `{writeKind: "revocation_flag", payload: {mode: "pause"}}`
  → `HTTP 200 {"ok":true}`. All three nodes then read
  `paused=true burned=false seq=1 origin=gcp-use1` — it reached usc1 and euw1 by anti-entropy
  (Tier-B mutable merge), not by being written three times. And it BITES rather than merely being
  recorded: a session request to the paused agent is refused
  `{"ok":false,"reason":"agent_suspended"}`. Note en route: `mode: "paused"` was rejected
  structurally with `invalid_payload` before any DB write — the validator is doing its job.
  (e) **seal** — ✅ PROVEN AND FIXED (Entries 44, 52–55, 58–59), including the neither-home case. Was intermittent because every seal was
  adjudicated by ONE relay-pinned directory that could only reach agents homed there; the relay now
  follows a redirect to the node holding the seal initiator's stream. Cross-node seal completes in
  ~280ms where it previously timed out after 11 minutes. Bilateral seal completed across GCP with an identical
  `sealed_root efabec57bc12e8122ef61635a075086efb4b8761ece461a866ca8978cd0d9a28` returned to BOTH
  sides, a notarized legibility certificate, and `sealed-receipt` retrievable. Earlier text kept
  below for the history of how it got there:
  ~~❓ UNPROVEN, not broken (Entry 41 corrected by Entry 42). Bidirectional content
  delivered (`sequence_number 2, delivered true`) and BOTH sides submitted seal leaves, but no
  session has been OBSERVED reaching `sealed` — `sealed-receipt` returns `not_sealed_yet` in every
  attempt so far. The earlier "wedged forever, no escape" reading was WRONG: the bilateral wait is
  `CELLO_SEAL_BILATERAL_TIMEOUT_MS`, default **660 s (11 min)**, deliberately longer than the
  directory's 600 s grace window, and `close-session --force` is an explicit escape. Every test
  used a client timeout of 300–400 s, so the CLI was killed while the daemon was still legitimately
  waiting; the subsequent `seal_interrupted_in_progress` was then CORRECT behaviour, not a wedge.
  **Real (smaller) findings that stand:** the `seal_interrupted_in_progress` guidance names a
  timeout without saying it is ~11 minutes and never mentions `--force`; and `inbox` listed a
  session under `sealed_unread` that `sealed-receipt` reports as `not_sealed_yet` — those two
  disagree and one of them is wrong.~~
  **OPEN, and the reason (e) took so long:** the same two agents could NOT seal before a directory
  restart and COULD after it, with no code change in between. Root cause NOT established — see
  Entry 44. Until it is, a directory restart is an undocumented precondition for sealing a
  recently-registered agent, which is launch-relevant.
- **DOD-RELAY-KEEPALIVE-1** [trustless-cello, cello-client] — the daemon↔relay link
  survives ≥30 min carrying an idle session, zero `relay_connection_gone`. Prime suspect
  (verify first with `DEBUG=libp2p:connection-monitor*`): libp2p 3.3.2's default
  ConnectionMonitor — 10s pings, adaptive timeout, `abortConnectionOnPingFailure: true` on
  BOTH ends — killing healthy WAN links; matches the 2,061 untraced "aborted due to
  timeout" errors in [[launch-triage]]. Fix: `abortConnectionOnPingFailure: false` for
  relay links both sides (keep the ping traffic — it doubles as keepalive), preserve
  session-peer liveness detection, remove the legacy default-limits `startRelay` factory
  (`packages/relay/src/index.ts:89`). Cross-machine live delivery then succeeds without
  store-and-forward fallback. Full diagnosis: [[relay-keepalive-parked-drain-workorder]].
  — ✅ Relay: abort off + legacy `startRelay` deleted. Daemon:
  abort KEPT with a 30s WAN floor — per-node config makes "relay links only" unavailable and
  liveness must survive; see **M12-D18**. Verification substituted (no live infra): mechanism
  proven locally, attribution still circumstantial — the incident string is Node's generic
  AbortSignal text, shared by ~10 timeouts on the relay path. Reviewer: 7 findings, 2 HIGH and
  both OUTSIDE the diff — the relay fix was a silent no-op against the published transport, and
  session liveness called the counterparty dead whenever the relay churned. All closed.
  **Shipped 2026-08-05:** transport **0.0.44** + daemon 0.0.121 on `latest`; relay pinned to
  0.0.44 and merged. **DEPLOYED + PROVEN 2026-08-05** (both relays on `a84659eb…`): Mac↔EC2, both
  NAT'd, `transportMode: relay` — 30 min 10 s idle with **zero** `reservation.lost` /
  `relay_connection_gone` on either daemon, then live delivery (`content.delivery.acked`, no park
  event). Still zero **80 minutes on**, and zero reservation/reader-ended churn on the relay side
  too — the requirement is ≥30 min; the measured window is longer and one-sided in the right
  direction. `DEBUG=libp2p:connection-monitor*` ran: **zero output**, and the monitor logs before every
  abort — so M12-D18's "reverse if" does NOT fire. On the 0.0.123 build the monitor DID fire: 7
  aborts, ALL `UnexpectedEOFError`/`ConnectionClosedError` (connections already dead), **zero
  timeout-shaped**, and zero reservation lost alongside them. The original attribution is therefore
  positively unsupported, and this line rests on the measured zero-loss window, not on it.
  → Entries 79, 81, 82, 83, 84, 88
- **DOD-GCP-RELAY-DRIFT-1** [trustless-cello] — GCP relay config drift vs AWS closed:
  `RELAY_SESSION_MAX_IDLE_MS` 1800000→86400000 in `relay-cloud-init.yaml:69` (30 min vs
  AWS's 24 h), plus a GCP-terraform regression test asserting relay idle/timeout config
  (the AWS side has `test_m6b_007.py`; the GCP side has nothing, which is why the drift
  shipped). [[relay-keepalive-parked-drain-workorder]] §5. — ✅
  Value fixed; `infra/tests/test_gcp_relay_config.py` (5 tests) asserts both clouds AND that they
  agree. **Premise corrected:** `test_m6b_007.py` asserts the AWS *ALB* idle timeout, not the
  session sweep — the sweep was asserted on NEITHER cloud, which is the real reason it drifted.
  Reviewer: SPEC FAITHFUL, one hollow test (parser read the whole YAML, not the env-file heredoc —
  bypass demonstrated and closed). `WAL_DIR` drift found and parked as M12-P10.
  **LIVE 2026-08-05** — both relays rolled one region at a time onto `a84659eb…`, each reporting
  it itself at boot: `relay.config.idle_sweep maxIdleMs=86400000` (us-east1 05:00:53Z,
  europe-west1 05:04:55Z). → Entries 80, 82, 83, 84

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

### M12-D18 (2026-08-04) — the daemon keeps the ping ABORT; only the relay gives it up

DOD-RELAY-KEEPALIVE-1 says `abortConnectionOnPingFailure: false` **for relay links both sides**.
Built: relay side false, **daemon side keeps the abort** and gets a 30s ping-timeout floor instead
of libp2p's 5s.

**Why the literal reading is unavailable.** libp2p configures the connection monitor **per node** —
one AdaptiveTimeout and one abort flag for the whole node, fed by every connection's ping. There is
no per-connection policy. Nor is there a per-node-role split to fall back on: the standing receiver
is *handed off and becomes* the session node (`reuseStandingReceiver`), and session nodes dial the
relay as their Structure-2 witness. Every daemon node that carries a counterparty also carries a
relay link. The unit reviewer checked this independently and confirmed there is no seam.

So on the daemon, `false` would not mean "relay links" — it would mean *all* links, taking out
`counterparty_liveness → 'gone'` for a peer that vanishes without a FIN. The same DoD line requires
that detection be preserved, and the work order authorises the alternative in its own words: "or at
minimum a generous fixed `pingTimeout` replacing the AdaptiveTimeout for WAN links."

**The cost, stated.** Detection of a silently-dead counterparty moves from ~15s (10s interval + 5s)
to ~40s (10s + 30s). The unilateral-seal gate reads that verdict, so it must tolerate a ~40s window.
If it ever cannot, lower the ping INTERVAL rather than the floor — the floor is what a slow WAN
round trip needs; the interval is how often we ask.

**Reverse if:** the live `DEBUG=libp2p:connection-monitor*` run shows the daemon's own monitor is
what severs the relay link even at 30s. The daemon would then need a dedicated relay-only node so
the policy can be split by node after all — a structural change, not a flag.

### M12-D-V49-V50-ORDER (2026-07-31) — merge is safe with `outOfOrder=true` for ONE AWS deploy

Entry 68b left a question open: why did a directory image run cleanly against a database holding
migrations its own image did not carry? **Answered, from measurement rather than a doc claim.**

Flyway is 10.21.0 (`packages/directory/Dockerfile`), invoked as a bare `flyway migrate` with no config
overrides. The observation that settles it: images whose highest local migration was V50 ran
successfully against a GCP database already at V55. That is only possible if migrations *above* the
local maximum are tolerated — Flyway calls those FUTURE, and tolerating them is the default. So there
was never a mystery: my images ignored V51–V55 as future, and nothing ran that should have failed.

**The AWS case is different in kind, and the risk stands.** After merging, a main-built image RESOLVES
V49/V50 as files, while the AWS database has them neither applied nor above its high-water mark (V55).
That is OUT-OF-ORDER, not future — a resolved migration below the max applied — and `outOfOrder`
defaults to false, so `flyway migrate` aborts under `set -e` and the task never starts.

**Recommendation: one deploy with `outOfOrder=true`, then back to the default.** V49 adds two columns
to `agent_suspensions` (`ADD COLUMN IF NOT EXISTS`, both additive); V50 is a single GRANT. Neither is
referenced by V51–V56 — verified: no file in that range mentions `agent_suspensions` — so applying them
late cannot corrupt anything that ran ahead of them.

Rejected: renumbering to V57/V58 (GCP has V49/V50 APPLIED, so the files would go missing there —
trading an AWS-only problem for a fleet-wide one); and `repair`/`baseline`, which rewrite history to
paper over a discrepancy that is real and harmless.

Cost if we do nothing: none until AWS wakes with the merge in place. If AWS is torn down without
waking, this never fires.

### M12-D-AE-WRITE-HINTS (2026-07-30) — `ae_hint` deferred, with the latency it costs stated

`DOD-AE-CHANNEL-1` says "the digest→detail→pull round protocol **with write-hints**". digest→detail→pull
is implemented; `ae_hint {table, keys[]}` (design §3 "Cadence") is **not**, and until now that was an
un-journaled simplification of a clause the DoD spells out — which is exactly the shape a reviewer is
right to block on.

**What it costs, precisely:** hints exist so a local write PUSHES rather than waits. Without them a
suspension written on node A reaches B on B's next scheduled round — up to `intervalMs`, currently
**60 s, unjittered** (the design says 30 s jittered). So the kill switch converges in up to a minute
rather than immediately. It still converges, fails closed, and is proven to do so across a real
partition (`j-antientropy`, Entry 70b) — this is latency, not correctness.

**Deferred rather than built**, because a hint frame is a new wire message with its own auth and
flood-control questions (an authenticated peer that can make us pull on demand is a cheap amplifier),
and the correctness it would buy is already there. Revisit when the kill switch has a stated propagation
SLA — that is the requirement that makes a minute unacceptable, and it does not exist yet.

### M12-D-NULL-AGENTID (2026-07-30) — refuse at the door; the fleet backfill is owed and is NOT code

Adding `agent_id` to `AGENT_PROFILES_SPEC` (so the kill-switch join works on replicas) also put it in
the CONTENT ADDRESS. A node holding `(k1, agent_id=NULL)` and one holding `(k1, agent_id=X)` therefore
hash the same agent differently, and Tier-A apply is insert-if-absent — `ON CONFLICT DO NOTHING` keeps
the NULL forever. Neither the fork nor the broken gate can be repaired by a later round.

**Chosen: refuse a profile body with a null `agent_id` at apply.** Least likely to need reversing — it
stops the state spreading, and with the per-record containment now in place it fails loudly per record
instead of taking the round (and Tier-B, and the kill switch) down with it.

**Rejected: modelling `agent_id` as Tier-B.** It is not mutable; it is *absent* on some rows. Encoding
"missing" as "mutable" would licence overwriting a populated identity with a null one, which is worse
than the bug.

**Owed, and it is data repair, not code:** the live GCP fleet already holds NULL-`agent_id` profiles
(four of eight observed on `gcp-usc1`). Those rows still fork, and this guard does not heal them —
nothing in AE can. They are throwaway enforcer agents, so the cheap fix is to delete them and let AE
re-replicate correctly. **Not done autonomously:** deleting rows from a live directory's
`agent_profiles` is destructive and irreversible, and "it is only test data" is exactly the assumption
worth checking with Andre before acting on. Needs his go.

### M12-D-MERGE-HOLD (2026-07-30) — `m12/node-dir-gcp` does NOT merge to main yet

§2e says a reviewed-green unit merges rather than sits, and this branch is reviewed and green. It is
held anyway, for a reason that outranks the sitting cost:

`pipeline-mappings.json` maps `packages/directory/` → `cello-directory-pipeline` and
`packages/relay/` → `cello-relay-pipeline`, and `get-pipeline-state` reports the directory pipeline
live (`Succeeded`). This branch changes both packages heavily, so a merge **fires AWS pipelines while
AWS is hibernated** — which the standing rule forbids touching — and the V49/V50 out-of-order blocker
(Entry 68/68b) lands the moment a task actually starts.

Least-likely-to-need-reversing: hold. Merging is one command whenever AWS is awake or torn down;
un-firing a pipeline against hibernated infrastructure is not. Unblocks on either the AWS teardown
decision or a wake — and the Flyway question in Entry 68b should be answered first either way.

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

### PARKED — DOD-INV-NODEID clause 2 ("never renamed"), 2026-07-30

**Not implemented, deliberately.** A guard would compare the configured `NODE_ID` against what this
node's persisted state was written under. There is nowhere to read that from today: `directory_nodes`
carries rows for PEERS as well as self (the presence-freshness JOIN depends on that), so "a row exists
under a different node_id" is the normal state, not evidence of a rename. The shares are keyed by
agent and epoch, not by node. So the guard needs a dedicated single-row identity table — which means a
Flyway migration, which per the milestone rules must also bump `OpsAgentExpectedMigrationVersion` in
`cello-ssm-parameters.yaml` or the ops-agent crash-loops on fresh deployments. That file is AWS-side,
and AWS is hibernated.

**Weighed against the actual consequence, which is mild and already loud.** Signing reads the
identifier from the STORED share, not a re-derivation, so a rename does NOT invalidate existing shares
or silently corrupt a ceremony — it breaks the anti-entropy handshake with `manifest_pubkey_mismatch`,
which names its cause. A guard here is defense-in-depth on a failure that already fails loudly, and it
costs a migration touching hibernated infrastructure to get it.

**Revisit** when the next migration ships for another reason (fold it in then, near-free), or if the
consequence ever stops being loud.

### PARKED — NULL-`agent_id` cleanup, blocked on `gcloud auth login` (2026-07-31)

Andre gave the go-ahead; the fleet deploy of `aefix-50bc7a2a` completed on all three nodes, and then
the gcloud tokens expired: *"Reauthentication failed. cannot prompt during non-interactive execution."*
Reaching the rows needs IAP SSH, so this is a browser OAuth flow — reason 1 under §Decision Theatre
(a), not a judgement call.

Ready to run the moment auth is back: the probe carries a `nullids` command (enumerate, for Andre to
eyeball) and a `delnull` command (delete). The plan is enumerate first, confirm they are the throwaway
enforcer agents, then delete and let anti-entropy re-replicate them with a populated `agent_id`.

Not urgent: new NULL-`agent_id` profiles are already refused at the door by the required-columns guard,
so the set cannot grow. What remains is the existing rows, which fork and cannot heal.

## Parked

- **M12-P14** — **A local-only teardown declares the session `interrupted`, and the counterparty
  correctly refuses to seal it.** Measured 2026-08-05 on two sessions (`4c28edcd…`, `dcd0aadc…`).
  Trace: `session.content.sent` → `session.liveness.changed liveness=gone` →
  `session.liveness.unrelated_peer_disconnect` → `session.node.destroyed reason=interrupted`, all
  within one millisecond — and then `content.park.deposited` **21 seconds later**, i.e. the content
  the counterparty needed landed *after* we had already given up on the session. The counterparty's
  view was complete, so it answered the seal-interrupted request with `session_not_interrupted`
  (12:14, again at 12:17). There is no reconciliation path from there: `force:true` abandon is the
  only exit, and it yields **no notarized receipt**. Both sessions ended that way.
  The interruption decision reads only LOCAL transport state and never asks whether the
  counterparty's view is actually incomplete — a laptop lid, a wifi drop, or a daemon restart
  produces it. Launch-critical class: the sealed receipt is the artifact CELLO exists to produce.
  → Entry 90
- **M12-P13** — ✅ **FIXED 2026-08-05** (`1f75937`, branch `m12/p13-durable-leaf`) — **a queued
  message's leaf was never committed, so the sender stranded its own session.** Originally filed as
  "the away-response has no backstop"; the backstop was only half of it, and the root cause is
  sharper. `sendContent` submits the content hash to the relay witness BEFORE attempting direct
  delivery, so the canonical sequence is committed whether or not the send lands. Both send callers
  appended the session leaf **only on success**. `nextExpected` is literally
  `getSessionTree(...).size()` (`session-node-manager.ts:4178`) — so a failed-but-queued message
  leaves the local tree one short of a sequence the counterparty will receive at, and everything
  after it is held behind a gap nothing can fill.
  Measured: one millisecond after a session opened, the receiving daemon logged
  `session.away.response.failed kind=request reason=session_stream_unavailable`. That reply holds
  witnessed sequence **0**. No leaf, so the tree stayed at size 0 and a message recovered perfectly
  from the relay park and cryptographically verified was held at `nextExpected=0` forever. The
  receiver stranded *itself*.
  Fix: `sendContent`'s failure result now carries `durable` as a **field** (M12-P12 had shipped that
  distinction inside the `guidance` English sentence only, so no caller could act on it). Both
  callers commit the leaf + transcript when durable, and never when lost — a leaf for content that
  will never arrive is a permanent root mismatch. The away path's lost branch is now an `error`
  naming the consequence, not the bare `warn` that read as routine churn when it fired live.
  **Three callers, not two** — the away-inbox one-shot rejection was the one missed on the first
  pass, and the sharpest, because `submitSealLeaf` runs immediately after it.
  **Review pass (one, findings fixed, not re-reviewed):** the blocking finding was that the fix
  repeated the defect — `durable` was *asserted* on the line after an optional call, so an unwired
  hook or a deduped enqueue both claimed durability and would have committed a leaf for content in
  no queue. Durability is now observed from the enqueue's own return. Also fixed: the undrained
  nonce-queue double-write, and `cause` being discarded at the mapping site.
  **Merged to main 2026-08-05** (`291a80c`, fast-forward). **Published to beta:** daemon `0.0.124`,
  cli `0.0.127`, connect `0.0.121` (tag `v0.0.184`, commit `51c527a`, `smoke-tag` green). Verified
  against the TARBALL, not CI status — `content.park.durable_enqueue.unwired` / `.dropped`,
  `session.away.response.deferred` and `session.content.queued.committed` are all present in
  `package/dist/`, and cli@0.0.127 cross-pins daemon@0.0.124 as a real version.
  **`latest` promotion: Andre's to run.** **Live re-run on two machines: NOT YET** — that is the
  only thing still standing between this and DOD-PARK-DRAIN-1 going ✅.
  → Entries 89, 90, 91
- **M12-P12** — **A failed park deposit drops the message with no retry, and the gap strands the
  session.** `sendContent`'s dial-failure path calls `#untrackAwaitingAck` first (deliberately —
  so a never-delivered frame cannot fire a spurious TTF park), then attempts `#parkContent`. When
  that attempt fails, the durable awaiting entry is already gone and nothing holds the message:
  `#parkContent` logs and returns `false` with no enqueue, no backoff, no retry — even though a
  working `startup_flush` re-park path exists and the sender's own standing receiver came up
  seconds later. The recipient then holds every subsequent message behind the missing sequence,
  permanently, and neither side is told. Also: the hook's `standing_receiver_unavailable` names the
  SENDER's receiver (`daemon.ts:1358`, no agent argument — unlike the crash backstop at `:1441`),
  which an operator reads as "the recipient is away" — the exact condition parking exists for.
  Found by the cross-machine run that DOD-PARK-DRAIN-1 requires; it is why that line stays 🟡.
  Launch-critical class: two agents stop communicating silently. → Entry 84
- **M12-P11** — **The `cello-relay-image` / `cello-directory-image` Cloud Build triggers have not
  fired since 2026-08-01.** Found 2026-08-05 while deploying the relay fix: a merge to `main` that
  touched `packages/relay/**` produced no build, and the newest build in region **us-east1** (the
  triggers are regional — a `gcloud builds list` without `--region` returns a different, stale set
  and will mislead you) predates it. Either they are not wired to push events or they are disabled.
  Scope beyond this unit: every merge since then has shipped no image, so "merged to main" has not
  meant "image built" for anyone. Diagnose before hand-rolling a build — a hand-run
  `gcloud builds submit` of a local tree already cost one demoted claim in this milestone.
  **NARROWED 2026-08-05 to event delivery.** The silent half is FIXED: `cello-cloud-build@` held no
  permission to create builds, so every push-triggered build died at creation leaving no record;
  `roles/cloudbuild.builds.builder` is now declared in `infra/terraform/iam.tf`. Still open: a push
  touching an `includedFiles` path produces no build AND no denied-attempt audit entry, so the event
  never reaches Cloud Build. Ruled out: App installation, connection state, `includedFiles`, and
  trigger state (both recreated via `terraform -replace`). **Also falsified 2026-08-05: the connection's
  stored OAuth token is NOT expired** — the `ghu_` secret answers `200` on both `/user` and
  `/repos/Mygentic-AI/CELLO`, so re-running the browser OAuth flow (the obvious next move, and the one
  thing here that would need Andre) would achieve nothing. Do not spend that gate.
  Meanwhile CI builds run from a revision:
  `gcloud builds submit <repository-resource> --revision=<SHA>` — source from GitHub, never a local
  tree. → Entries 82, 83
- **M12-P10** — **`WAL_DIR` drifts across clouds and nothing asserts it.** AWS puts the relay's
  write-ahead log at `/tmp/wal` (Fargate task-ephemeral — gone on every task replacement); GCP puts
  it on `/mnt/disks/cello-wal` (a persistent disk that survives instance replacement). The relay
  journals in-flight session frames there, and cloud-init's own header states the stake: losing them
  drops messages agents believe were delivered. Found by the DOD-GCP-RELAY-DRIFT-1 reviewer (F4) as
  the same failure class that line closed — a per-cloud value with no cross-cloud assertion — but a
  DURABILITY knob, not an idle/timeout one, so it is deliberately not folded into that unit. Needs
  its own line: decide whether AWS should have durable WAL storage, then assert the pair the way
  `test_gcp_relay_config.py` asserts the idle sweep. → Entry 80
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
- **M12-P9 — One bad Tier-A column stops ALL replication, on every node.** `handling_ae_state_req`
  builds a digest per Tier-A table with no per-table isolation, so a single table's query throwing
  aborts the whole request and the peer's entire round dies. `SIGNAL_RECORDS_SPEC` naming a column
  V55 had dropped therefore halted replication of all eleven tables across all three nodes —
  silently, as a `warn` on hosts nobody tails, surfacing days later and one layer away as
  `CLAIM_CODE_INVALID` during Telegram registration. **The spec bug is fixed and guarded
  (`DOD-M12-AE-SCHEMA-1`); the fragility that turned a typo into a fleet-wide outage is NOT.**
  Hardening = per-table try/catch so a bad table degrades to one noisy warning and the other ten
  keep replicating. Deliberately deferred, not overlooked. → Entry 76

  **FIXED IN CODE 2026-08-02 — merged to main (`bb408f5d` + `bd21e3d7`), NOT YET DEPLOYED.**
  Both loops are isolated: the responder's advertisement (`buildWireState`) and the dialer's
  comparison basis (`localState`). The first commit did only the responder; review caught, with a
  reproduction, that this fixes the wrong node — anti-entropy is PULL-driven, `localState` ran the
  same query with the same missing isolation, and all three nodes ran the same bad spec, so every
  node was a broken dialer. Responder-only would have left the outage's blast radius untouched.

  **The two halves degrade differently, and that asymmetry is the load-bearing part.** The responder
  OMITS the table from its advertisement, so it leaves the peer's table list and is simply not
  reconciled. The dialer cannot do the same: `planRound` reads `local.tierA.get(t) ?? []`, so an
  omitted table looks like "we hold zero rows", differs from the peer's digest, and plans a pull of
  the WHOLE table just proved unreadable — the storm the responder fix exists to avoid, reached
  from the other side. Unreadable tables are named (`unreadableA`/`unreadableB`) and dropped from
  the PLAN. `tierAPlanned` is the assertion, since a pulled-count cannot tell "excluded" from
  "asked for everything and got nothing". `antientropy.table.skipped` is `error`, not `warn` — a
  table whose read FAILS is not a bad round, it fails every round until a human intervenes.

  **Still open, recorded not fixed** (become ACs on whatever unit next touches anti-entropy):
  - No detector for a peer advertising FEWER tables than we track. The skip is loud only on the
    host whose store is broken; the node that silently stops RECEIVING that table logs nothing and
    still reports `antientropy.round.completed` with healthy-looking counts. This is what would
    make the degradation visible from a healthy host — a set-diff against `store.tierATables()`
    after `remote.refresh()`.
  - `onTableError` is optional on `AeResponderInput`, so the isolation degrades to a bare swallow
    if a future caller omits it. Enforced by a doc comment, not the compiler. One production caller
    exists and it is wired, so this is structural, not live.
  - The detail-frame handlers (`ae_buckets_req` / `ae_bucket_hashes_req` / `ae_pull_a`) still call
    the store unisolated, so a version-skewed or misbehaving peer can ask for an omitted table and
    kill the responder's stream. Costs one round. Pre-existing.
- **M12-P4** — **Replica nodes at launch.** The role split ships in P1, but whether any
  replica-role nodes actually deploy at launch (vs the capability lying dormant) is undecided —
  zero replicas is a valid launch shape.

### DOD-M12-AE-SCHEMA-1 — every Tier-A spec column exists in the schema at HEAD ✅

**Why it exists:** `SIGNAL_RECORDS_SPEC` listed `subject`, created in V46 and dropped in V55. The
spec was written from V46's `CREATE TABLE` without reading the nine migrations after it. Unit tests
pin the Tier-A table LIST and ORDER, not columns, and no type can check a SQL identifier — so
nothing in the gate could catch it, and anti-entropy died fleet-wide with no test turning red.

- `ae-spec-schema.test.ts` replays every migration in numeric order (`CREATE TABLE`, `ADD COLUMN`,
  `DROP COLUMN`) and asserts every `naturalKey` + `immutableColumns` entry of every `TIER_A_SPECS`
  member survives to HEAD. Static; no database.
- It asserts the parser honours `DROP COLUMN` (`subject_kind` present, `subject` absent), so it
  cannot pass vacuously on the very bug it exists to catch, and asserts a floor on tables parsed so
  a regex that silently matches nothing fails loudly.
- Revert-tested: restoring `subject` to the spec fails with the blast radius named in the message.
- Live: `auth_failed_count=0`, rounds completing, `pulled:3 applied:3` on first convergence. → Entry 76

### DOD-M12-REREG-1 — a returning user can add a second agent ✅

**Why it exists:** two independent defects made this impossible, and the second made fixing the
first look like a no-op. `handleExistingUser` inserted in `INITIAL` under a comment promising a
transition to `AWAITING_CONTACT` that was never written — `const awaitingRecord = record` only made
it look done. And `INITIAL`/`PHONE_CONFIRMED` re-prompted for contact while returning the record
unchanged, so the state never moved and no message — including a fresh `CONFIRM` — could escape.

- `handleExistingUser` inserts directly into `AWAITING_CONTACT`, as `handleNewUser` already did.
- `INITIAL` recovers to `AWAITING_CONTACT` and then handles the message the user actually sent;
  `PHONE_CONFIRMED` advances to `AWAITING_EMAIL` rather than re-requesting PII already hashed.
- **`INITIAL` re-asks the gate before healing.** `AWAITING_CONTACT` is the state that requests a
  phone number; promoting unconditionally would hand the PII prompt to a record that may be there
  *because* it was refused. Refused → `AWAITING_WAITLIST_TOKEN`. Pinned by its own test — this is
  the way the fix could have caused real harm.
- Tests drive the REAL record returned by `handleExistingUser` through `handleMessage`, which is
  precisely what the prior tests did not do. All revert-tested against the old code.
- **Live evidence:** greenfield databases, then two agents registered through the real Telegram bot
  — `Miss_Chelly` (`06c94560`) and `CELLO_Coder_1` (`80e8f3ce`), both `online` with
  `standing_receiver_ready`, both on all three nodes (`profiles=2 shares=2 presence=2`, one FROST
  share per node). No long-form token, no database surgery. → Entry 76

**Caveat, stated plainly:** this ran with `WAITLIST_GATE=disabled`. The re-registration path was
only reachable because the gate was off; admission is not being checked and must go back on before
launch.

---

## Related Documents
- [[M12-PROCEDURE]] — how to work this milestone (read first)
- [[M12-BUILD-JOURNAL]] — evidence home
- [[2026-07-28_0700_gcp-rebuild-decision-record]] — spec-of-record
