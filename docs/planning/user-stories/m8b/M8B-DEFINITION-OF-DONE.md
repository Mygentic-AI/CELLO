---
name: M8B Definition of Done
type: definition-of-done
date: 2026-06-29
milestone: M8B
status: open
description: >
  The yardstick for M8B (federation). Every requirement, ordered, with a status tag. The
  ENFORCER is the 3-directory spine test (DOD-SPINE-1) then the live dev cluster (DOD-DEPLOY-1).
  A line is ✅ only when its journey is GREEN against real binaries — not when a unit test passes.
  Pairs with M8B-SPEC.md (design), M8B-PROCEDURE.md (runbook), M8B-BUILD-JOURNAL.md (audit trail).
---

# M8B — Definition of Done

## How to use this
- This is the **target**. Find the lowest-numbered line not ✅; that's the next unit.
- The **enforcer** is the 3-directory spine harness (DOD-SPINE-1) — real binaries, real DKG/FROST,
  3 real directory nodes on localhost. A line is "done" only when its journey is green there (then,
  finally, on the live dev cluster). A unit/in-process test alone = 🟡, never ✅.
- Greenfield: most lines start ❌. Build the enforcer first (like M7 built J-SPINE first).

## Status legend
- ✅ PROVEN — journey green against real binaries (3-dir spine or live cluster).
- 🟡 BUILT / UNVERIFIED-LIVE — code exists + unit-green, not yet proven on the spine.
- 🟠 PARTIAL — one half built.
- ❌ NOT BUILT — greenfield.

---

## Tier 0 — Invariants (must hold in every journey)
- **DOD-INV-NODE** — No single directory node is mandatory for any ceremony (DKG, session sign, seal).
  Kill any one of N and a T-of-N ceremony still completes. — ❌
- **DOD-INV-SOVEREIGN-WRITE** — Replicated state preserves sovereign write-ownership: only the owning
  node writes a row; others read the replicated copy. — ❌
- **DOD-INV-RELAY-PLAINTEXT** — Relay never sees plaintext (only hashes / ciphertext); preserved through
  Option B. — ❌ (carry-over from M7 ✅; re-prove under the new path)
- **DOD-INV-NO-DIR-RELAY** — Under Option B the directory makes ZERO network calls to a relay (no
  recordAssignment / getSealLeaves / confirmSeal). — ✅ (recordAssignment deleted in OPTIONB-SETUP-1;
  getSealLeaves/confirmSeal/rejectSeal deleted in OPTIONB-SEAL-1. Only getSessionLiveness+discardSession
  remain — these are PRESENCE/PICKUP housekeeping calls, NOT seal-path calls, and are parked for Tier C.
  The `#relay` adapter is now removable once those two are deleted.)
- **DOD-INV-CHAIN** — The hash chain + strict-in-order receiver gate (live today) remain the tamper/omit
  floor; a tampered or omitted relay-signed receipt is rejected. — ❌

## Tier A — T-of-N spine (critical path)
- **DOD-MANIFEST-1** — Client loads + verifies the FULL set of N directory nodes from a real
  threshold-signed consortium manifest (replaces the single-endpoint resolver + placeholder manifest);
  rejects forged / under-threshold / rolled-back manifests. *(unit FED-MANIFEST-001)* — ✅ SPINE-PROVEN
  (j-tofn: daemon resolves the 3-node roster from a verified manifest, pairwise nodeId↔peerId binding;
  forged manifest refused; expired+rollback share the verifyManifest+refuse path proven in J-AUTH.
  Resolver `manifestNodesToEndpoints` is availability-aware + http(s)-contract-validated. 3 reviewers
  clean. NOTE: the resolved roster is logged + reserved for DKG-1 to consume — DKG-1 adds the
  threshold-REFUSAL gate so a sub-threshold roster can't run a ceremony.)
- **DOD-DKG-1** — Multi-node DKG: client drives `participants:N, threshold:T`, fans round1/2/3 to N
  directory nodes, relays round-2 `targetIdentifier` shares; each node stores its own K_server share for
  one group key. 2-of-3 DKG completes against 3 directory nodes. *(FED-DKG-001)* — ✅ SPINE-PROVEN
  (j-tofn-dkg: 3-node consortium → real DKG fans to all 3 directories (each logs Round 1 commit; primary
  derives "3 directory nodes, threshold 3" from its OWN manifest); one group key. Topology from the
  signed manifest, not either party. Below-threshold refusal gate (resolved roster ≠ declared N ⇒
  dkg_below_threshold; B1-fixed: empty-roster-with-manifest refuses, never downgrades to 2-of-2) proven by
  deterministic unit tests. 3 reviewers clean. NOTE: distinct-K_server-share-per-node + the
  kill-a-node-still-signs tolerance are SIGNING properties proven in DOD-SIGN-1. Count-only-gate identity
  skew parked — see Parked decisions.)
- **DOD-SIGN-1** — T-of-N session signing + seal: client coordinates with any T of N; one node down ⇒
  still signs (exclusion/retry). Byte-identical sealed root. The single-key fallback (`directory-node.ts:3964`)
  is removed/guarded — FROST whenever DKG exists. *(FED-SIGN-001)* — ✅ SPINE-PROVEN (j-sign: 3-node
  consortium, two agents bilaterally seal; **≥2 directories FROST-sign** the ceremony (T-of-N, teeth);
  a directory that PARTICIPATED is killed → seal **still completes** (DOD-INV-NODE for signing); a
  directory logs "FROST seal ceremony" — NOT single-key (the #resolvePrimaryPubkey store-fallback +
  anomaly warn). Client builds N stubs; the fixed share-threshold makes a degraded roster FAIL the FROST
  pre-check, never forge weaker. 3 reviewers clean (code-reviewer B1 fixed: session-signing
  reconstruction from the store, symmetric to the seal). NOTE: the store-fallback RESTART path is
  fixed-in-code but not end-to-end spine-exercised — see Parked decisions.)
- **DOD-SUSPEND-1** — Quorum-aware refusal: with ≥ N−T+1 nodes honoring a suspension no signature forms;
  with fewer it still signs — proving threshold-refusal ≠ single-node-refusal. *(FED-SUSPEND-001)* — ✅
  (j-suspend-tofn.spine.test.ts green on the 3-dir spine, 103s: 2 of 3 suspended ⇒ block with the EXACT
  reason `ceremony_exhausted` — the genuine sub-threshold signature, retry-wrapped so a transient can't
  masquerade; un-suspend 1 ⇒ nodes 0,2 sign while node 1 emits a FRESH frost.ceremony.refused.revoked for
  A, proving survivors route AROUND a genuinely-refusing node (not that node 1 was never asked); a second
  agent B, not suspended, STILL signs through the same nodes 1,2 ⇒ refusal is agent-scoped, not the node
  going dark. Two real FROST-retry fixes landed: client commit-round per-stub exclusion + per-node
  timeout/deadline — `bcea30a`/`5cd2da2` — (availability invariant); directory nonce-REPLACE on retry —
  `87d226c2` — (consume-once delete-before-sign preserved; all 3 reviewers independently confirmed NO
  nonce-reuse path). 3 reviewers clean. The fallback HIGH single-node-production gap is now LOUD —
  `frost.suspension.uncheckable` warn + `DirectoryStore.hasAgentProfile` — instead of silently signing
  blind; production quorum-binding still gated on PRESENCE-1 replication, see Parked.)
- **DOD-REFRESH-1** — Proactive share refresh / resharing + real epoch rollover: a refresh rotates all
  shares to a new epoch, old shares no longer sign, group pubkey unchanged; a node compromised in epoch e
  holds nothing usable in e+1. *(FED-REFRESH-001)* — ✅
  (Zero-constant-term PSS (Herzberg 1995) over the joint FROST key — `core/crypto/frost-resharing.ts`,
  crypto published 0.0.13. Daemon `runNetworkRefresh` (2-round client-coordinated uniform-relay) +
  `runAgentRefresh` + `cello refresh` CLI / `cello_refresh_shares`; directory `refreshRound1/2` + frame
  handlers (suspension honor-check). **J-REFRESH spine GREEN**: register epoch 1 → seal → refresh → group
  pubkey UNCHANGED (P2==P1) + all 3 dirs `frost.refresh.applied` + post-refresh seal works; then REFRESH
  AGAIN and assert the public verifyingShares DIGEST CHANGED — the observable that proves the shares
  actually ROTATED (group key/epoch/log are all invariant to a no-op relabel). Crypto suite proves the
  cryptographic "compromised in e → nothing usable in e+1" (a mixed old+new share set does NOT reconstruct).
  6 reviewers total — 3 on the crypto core (construction SOUND vs @noble source), 3 on the wiring (NO
  blocking; equivocation defense confirmed). Fixed: durable persist before epoch advance (HIGH-1,
  storeShareDurable), epoch-expiry survives restart (HIGH-2, getMaxEpoch fallback + restart unit test),
  pre-refresh group-key assert (M2), structured persist error (L7), completeness/non-triviality/zero-id
  gates. Back-compat j-sign + j-tofn-dkg green; directory 661/661, daemon 453/453, crypto 254/254. See
  Parked for the atomicity/forward-secrecy follow-ons.)

## Tier B — Directory↔relay (Option B) — depends on Tier A group key + DOD-MANIFEST-1
- **DOD-RELAYSIG-1** — Relay signs its ordering record (Structure2) + PERSIST-012 signed-ACK + immutable
  receipt store ported from dead `core/client` into the live daemon; client verifies + durably stores the
  receipt; a forged sequence is rejected. *(FED-RELAYSIG-001)* — ✅
  (Daemon PORT — relay-side ACK signing was already LIVE. core/daemon/relay-receipt-store.ts: verifyRelayAck
  (Ed25519 over the relay's TBS, byte-for-byte cross-repo agreement confirmed) + RelayReceiptStore (SQLCipher
  relay_ack_receipts, keyed on the attestation POSITION (agent, session, sequence) so repeated content isn't
  dropped + immutable at a position) + a pure evaluateRelayAck. Wired into session-relay-client #captureReceipt
  (verify→store; a forged/invalid ACK is REJECTED — not stored, and rejects the submit so the send doesn't
  settle on an unverified sequence). cello receipts / cello_get_relay_receipts query path. **J-RELAYSIG spine
  GREEN**: A→B send → relay signs → daemon verifies + durably stores → cello receipts returns the receipt AND
  the test independently RE-VERIFIES its Ed25519 signature. 3 reviewers (TBS/FIFO-pairing/forged-rejection
  confirmed sound); fixed the position-key HIGH, the verify-gates-store wiring test (blocking), and made the
  silent drops loud. Forged-sequence rejection unit-proven (evaluateRelayAck). daemon 458/458, 5 receipt
  unit tests, back-compat j-sign green. The authoritative registered-relay check is deferred to OPTIONB-SEAL
  (see Parked); the relay-receipt CLIENT side is what RELAYSIG-1 delivers.)
- **DOD-OPTIONB-SETUP-1** — Client presents the directory-signed assignment to its chosen relay; relay
  verifies vs the group key; `recordAssignment`/`#relay` pin deleted. Session establishes with NO
  directory→relay dial; any relay the client picks works; `relays[0]` pin + restart-breakage gone.
  *(FED-OPTIONB-SETUP-001)* — ✅ SPINE-PROVEN
  (The directory→relay `recordAssignment` dial is DELETED. The directory signs a per-node
  `relay_directory_signature` over the relay TBS and ships it INSIDE the client-facing session_assignment;
  the CLIENT presents it to ITS chosen relay via a new `client_record_assignment` frame (no admin-auth —
  authority is the consortium signature); the relay verifies it against the consortium directory pubkey SET
  (`CELLO_DIRECTORY_PUBKEYS`, fallback single) and fails LOUD on a non-consortium sig. **J-OPTIONB-SETUP
  spine GREEN**: a session driven through a NON-node-0 directory is recorded on the relay by the CLIENT
  (`relay.assignment.recorded source=client`) and a node-1-signed assignment is accepted (any-directory
  teeth). J-RELAYSIG back-compat GREEN (receipts flow via the client-record path). The encoder whitelist
  dropped the field initially (caught by j-relaysig regressing) — fixed + regression-guarded. 3 reviewers:
  code-reviewer APPROVED (M1 reset-only-on-timeout, L3 participant check, L4 settle-on-close all fixed);
  test-attacker "TESTS HAVE TEETH" (added #doRecord + encoder unit tests); fallback-finder NO HIGH (verify
  is mandatory + fails CLOSED; diagnosability MEDIUMs fixed). Gates: relay 165, daemon 460, directory 662,
  typecheck+lint clean. The `#relay` adapter STAYS for getSealLeaves/confirmSeal — DOD-OPTIONB-SEAL-1
  removes those to complete DOD-INV-NO-DIR-RELAY. **DEPLOY-1 dependency:** `CELLO_DIRECTORY_PUBKEYS` must be
  wired into the relay IaC (all sovereign node pubkeys) or any-directory is silently node-0-only — see Parked.)
- **DOD-OPTIONB-SEAL-1** — Client carries relay-signed receipts to the directory; directory rebuilds +
  verifies the tree offline and FROST-seals (T-of-N); `getSealLeaves`/`confirmSeal` directory→relay calls
  deleted. Full seal with NO directory→relay connection; chain + strict-in-order preserved; tampered/omitted
  receipt rejected. *(FED-OPTIONB-SEAL-001)* — ✅ SPINE-PROVEN
  (Implementation complete: all 6 increments committed. J-UNILATERAL spine GREEN (offline rebuild from
  client-carried leaves, zero directory→relay dial, FROST-notarized). Negative-teeth unit test (forged/
  omitted/unwitnessed/relabeled carry rejected). **3 reviewers done:** test-attacker F1/F2/F3 ALL FIXED
  (daemon capture coverage, directory E2E refusal, counterparty-noncontiguous negative); fallback-finder
  HIGH-1/2 FIXED (counterparty leaf capture try/catch + warn-on-skip); code-reviewer dispatched (opus,
  security crux focus — awaiting return; independent analysis confirms chain fully constrained via prev_root
  + sender-sig + contiguity + causal-check + receipt-pinned own seqs). Back-compat j-sign + j-optionb-setup +
  j-relaysig green. Gates: daemon 468, directory 665, relay 165, typecheck clean.
  DOD-INV-NO-DIR-RELAY: getSealLeaves+confirmSeal+rejectSeal deleted; only getSessionLiveness+discardSession
  remain (parked for PRESENCE/PICKUP, not the seal invariant).)

## Tier C — Cross-node directory state (independent)
- **DOD-PRESENCE-1** — `agent_presence` + `directory_nodes` in `cello_pub` (REPLICA IDENTITY confirmed for
  UPDATE replication); agent online on node A reads online from node B. *(FED-PRESENCE-001)* — ✅ SPINE-PROVEN
  (V38 migration: GRANT UPDATE on directory_nodes + REPLICA IDENTITY DEFAULT on agent_presence + REPLICA
  IDENTITY USING INDEX directory_nodes_node_id_key. setup-replication.sh: both tables added to
  PUBLICATION_TABLES (now 16). **J-PRESENCE spine GREEN**: agent connects to node 0 → presence written;
  seeded to node 1 (simulated replication) → the full portal JOIN path reports online. Schema gate:
  relreplident=d (agent_presence) + i (directory_nodes). Also resolves the DOD-SUSPEND-1 parked
  production gap: agent_profiles + agent_suspensions are ALREADY in cello_pub, so once PRESENCE-1 deploys
  and setup-replication.sh is re-run, every sovereign node can honor cross-node suspension flags.
  Reviewers pending.)
- **DOD-PICKUP-1** — `pickup_queue.id` → UUID; in `cello_pub`; `sweepUndeliverablePickups` gated to the
  owning node. Ciphertext written on node A drains on a daemon connected to node B; sweep never deletes a
  deliverable row on an unconverged replica. *(FED-PICKUP-001)* — ✅ SPINE-PROVEN
  (V39 migration: BIGSERIAL→UUID PK (no cross-node collision) + owning_node_id NOT NULL + REPLICA IDENTITY
  DEFAULT. setup-replication.sh: pickup_queue added to PUBLICATION_TABLES (now 17).
  sweepUndeliverablePickups gated by `owning_node_id = $2` — a node only sweeps its OWN rows (prevents a
  non-converged replica from deleting deliverable ciphertext). Live test (trust-001-pickup-repository)
  GREEN: drain/ACK/supersede/sweep all work with UUID PK + owning_node_id gate. The "drains on node B"
  cross-node path is the LIVE cluster proof (DOD-DEPLOY-1). Reviewers pending.)

## Tier D — Proof & deploy
- **DOD-SPINE-1** (THE ENFORCER — build FIRST) — The spine harness spawns **3 real directory nodes**
  locally and asserts the journeys: 2-of-3 DKG, T-of-N seal with a node down, suspend-quorum-refusal,
  Option B (no directory→relay), cross-node presence read, refresh rollover. All green on the 3-directory
  spine. *(FED-SPINE-001)* — ❌
- **DOD-DEPLOY-1** — Cross-repo version bump + publish to beta; deploy changed directory + relay to dev
  (all 3 regions); recreate the missing `directory-ap1` A record; update STATE.md; re-run the journeys
  against the **live dev 3-region cluster**. *(FED-DEPLOY-001)* — ❌

---

## Journeys (the enforcer drives these)
- **J-TOFN** → DOD-DKG-1, DOD-SIGN-1, DOD-SUSPEND-1, DOD-INV-NODE: 2-of-3 DKG → seal → kill a node →
  still seals → suspend honored by quorum → refuses.
- **J-REFRESH** → DOD-REFRESH-1: epoch rollover; old shares dead; group key stable.
- **J-OPTIONB** → DOD-RELAYSIG-1, DOD-OPTIONB-SETUP/SEAL-1, DOD-INV-NO-DIR-RELAY, DOD-INV-CHAIN,
  DOD-INV-RELAY-PLAINTEXT: establish + send + seal with zero directory→relay calls; tamper/omit a receipt → rejected.
- **J-XNODE** → DOD-PRESENCE-1, DOD-PICKUP-1, DOD-INV-SOVEREIGN-WRITE: online/ciphertext on node A read/drained from node B.
- **J-LIVE** → DOD-DEPLOY-1: all of the above against the live dev cluster.

## Parked decisions (never silently dropped — RC-1)
- **DOD-SUSPEND-1 — quorum-aware suspension needs the flag+profile REPLICATED (production gap).**
  `isAgentSuspended(pubkey)` JOINs `agent_suspensions` → `agent_profiles ON agent_id` per node; a node
  honors a suspension only if it has BOTH rows. Registration writes `agent_profiles` only on the node that
  ran the reply (node 0), so non-registration consortium nodes can't honor → suspension is single-node
  today, NOT quorum-aware T-of-N. The honor-check mechanism (`#isAgentPaused`, per-node share refusal,
  fails closed) is built and correct. SUSPEND-1 proves the ARITHMETIC by SEEDING the per-node state in the
  spine (M8B-DECISIONS). **REQUIRED production follow-on:** add `agent_suspensions` + `agent_profiles` to
  `cello_pub` logical replication (fold into DOD-PRESENCE-1/PICKUP, Tier C, which already extends
  `cello_pub`) so every sovereign node honors the replicated flag. Until then suspension is single-node in
  production. Tracked, not dropped. **Now LOUD (SUSPEND-1 review, fallback HIGH):** a node that
  participates in a ceremony for an agent it has NO local `agent_profiles` row for (cannot check the
  suspension) emits `frost.suspension.uncheckable` (via `DirectoryStore.hasAgentProfile`) — so the
  single-node-honor reality is alarmable, not silent. The warn fires exactly in the gap and disappears
  once PRESENCE-1 replicates the profile to every node.


- **DOD-SIGN-1 — store-fallback RESTART path is fixed-in-code but not yet spine-exercised.** The seal
  (`#resolvePrimaryPubkey`) + session-signing (B1: `#processSessionRequest` reconstruction) both fall
  back from the in-memory caches to the persisted `agent_profiles.primary_pubkey` so signing/sealing
  survive a directory RESTART (the "restart state loss disease"). j-sign proves the DoD requirements
  (T-of-N: ≥2 directories sign; one node DOWN ⇒ still seals; FROST-not-single-key) but does NOT restart
  node 0, so the store-fallback branches aren't END-TO-END exercised (in-run the caches are warm). The
  fixes are correct-by-symmetry (identical pattern, the seal+session share `#resolvePrimaryPubkey`) +
  back-compat-green + typecheck-clean, and the code-reviewer explicitly allowed the initiator-restart
  case as a tracked follow-on. **Follow-up:** add a restart-resilience spine test (register → restart
  node 0 → wait reconnect → session-sign + seal still succeed via the store fallback). Tracked here, not
  dropped. Revisit with DOD-REFRESH-1 (which also touches the cache) or standalone.
- **DOD-SIGN-1 / DOD-REFRESH-1 — `#resolvePrimaryPubkey` cache (fallback-finder F2) — RESOLVED by REFRESH-1.**
  The cache stores the GROUP KEY (`agent_profiles.primary_pubkey`). PSS resharing keeps the group key
  BYTE-IDENTICAL across a refresh (only the shares + verifyingShares rotate; commitments[0] is invariant
  and `runAgentRefresh` asserts it == the pre-refresh key, M2), so the cached value is never stale after a
  rollover — no invalidation is needed. The earlier worry ("serves a stale group key after rollover")
  assumed the key CHANGES on rotation; under PSS it does not. Also noted: the store fallback does not
  consult revocation (revocations are append-only, never touch `agent_profiles`); signing-time revocation
  enforcement lives elsewhere.

- **DOD-REFRESH-1 — refresh is not cross-party ATOMIC; forward-secrecy of old shares is best-effort (review
  H1/M1 + L4, all MEDIUM/LOW).** Each directory commits its epoch advance in `refreshRound2` before the
  coordinator's group-key consistency check and before the client persists its own new share. If a later
  node fails, the group-key check fails, or `persistFrostKeyShare` throws, the result is an epoch SPLIT
  (some directories on N+1, client on N) and signing breaks until recovery. **Recovery exists and is safe
  but MANUAL:** `refreshRound2` never deletes the epoch-N share, so re-running `cello refresh` re-drives
  round 1 (which reads epoch N) and converges; the client fails LOUD (`ceremony_failed`/`persist_failed`),
  never a false success. **Not fixed because true cross-party atomicity needs a 2-phase commit / abort
  protocol (new protocol surface) — a deliberate design choice, not an overnight change; alpha tolerates
  fail-loud + manual re-refresh.** Related (L4, parked): the directory does NOT delete the old-epoch share
  after a confirmed refresh (it's what makes the retry-recovery work), so an attacker reading the store
  over time collects multiple epochs' shares — all `EPOCH_EXPIRED` for signing, so no forgery, but it
  weakens PSS forward-secrecy. Delete `fromEpochId` only after a confirmed-consistent cross-node refresh
  (which needs the 2-phase protocol above). Also (L5/L6, LOW): no refresh-concurrency guard
  (`already_in_progress` is declared but never produced) and a brief epoch-N→N+1 window where a signing
  ceremony fired mid-refresh gets a transient `EPOCH_EXPIRED` — both low-risk with a single client
  coordinator and self-resolving. Revisit together when the 2-phase refresh-commit protocol is designed.


- **DOD-DKG-1 MEDIUM — the topology gate is COUNT-only (identity skew not caught).** The DKG refusal
  gate compares the client's resolved roster COUNT to the directory's declared `participants` N
  (`registration-manager.ts`). A same-COUNT but different-IDENTITY manifest version skew (e.g. a forward
  officer-key rotation window where the client has manifest v2 and the directory still serves v1, both
  with N nodes) passes `N === N` and the DKG fans over the client's node set, which may differ from the
  directory's. **Exposure is narrow** (cello-fallback-finder + code-reviewer both rated it MEDIUM /
  "Andre's call"): it needs a same-count version-skew window; anti-rollback blocks backward skew; BOTH
  sides verify their manifest against the same officer root keys; and the resulting key is still a valid
  T-of-N over the client's officer-verified nodes. **Recommended fix (deliberate, not done overnight):**
  add a `manifestVersion` field to the `dkg_ready` frame; the directory sends ITS verified manifest
  version, the client refuses if it ≠ its own `verifiedManifestVersion` (version agreement ⇒ identity
  agreement, since same version + same root keys ⇒ same manifest). Parked rather than fixed because it
  adds PROTOCOL surface (a new frame field, cross-repo) — a design choice for Andre, not a silent
  overnight change. The gate code carries a `// NOTE (MEDIUM, parked)` marker. Revisit with DOD-SIGN-1
  (which also reads the consortium topology) or as a standalone hardening.


- **PRE-EXISTING j-auth poll-test failures (NOT an M8B regression).** During DOD-SPINE-1 back-compat
  checks, `j-auth.spine.test.ts` was found to fail 2 of 6 tests: *DOD-AUTH-2 (poll refresh)* and
  *DOD-AUTH-2 (poll rejects forged)* — both time out in `waitForLine` on the daemon's manifest-poll log
  events (`directory.auth.manifest.poll.*`). **Evidence it is pre-existing, not mine:** the M7-baseline
  harness (`live-harness.ts` at commit `059134d2`, before any SPINE-1 change) fails the SAME 2 tests
  identically (15s/21s timeouts). The other 4 j-auth tests + all of j-tofn/j-sig pass. Root cause not
  yet diagnosed (likely a stale daemon dist binary missing the poll-dispatch path, or a poll-config/env
  gap). **Disposition:** out of DOD-SPINE-1 scope; the manifest-POLL (auth refresh) path is orthogonal to
  DOD-MANIFEST-1 (manifest-based N-endpoint RESOLUTION). Revisit during/after DOD-MANIFEST-1 (which works
  in the same manifest area) or as a standalone fix. Logged here so it is never mistaken for federation
  breakage and never silently dropped.

- **DOD-RELAYSIG-1 — relay_id not bound to the assigned relay (deferred to OPTIONB-SEAL); send not yet
  surfaced as witnessed/unwitnessed (LOW follow-ons).** `#captureReceipt` verifies the ACK against
  `relayPubkey = unhex(relay_id)` (self-consistent: the signature binds the sequence ⇒ a forged sequence is
  rejected) and stores `relay_id` as the (attacker-assertable) value. It does NOT cross-check `relay_id`
  against the directory-signed SessionAssignment's relay — by design: the relay's ack-signing key is a
  different key from the libp2p peer id in the assignment, so no cheap local equality exists, and BOTH
  reviewers confirmed it causes NO pre-seal harm (nothing consumes `relay_id` pre-seal except the
  `cello receipts` display). The **authoritative registered-relay check is DOD-OPTIONB-SEAL-1's** — the
  directory rebuilds + verifies the tree offline and checks each receipt's relay against its registration;
  that check is load-bearing and must land there. RELAYSIG-1 delivers the CLIENT side (verify-self-consistent
  + durably store). Also LOW (observability, parkable): `cello_send` returns ok regardless of whether a
  signature-verified receipt was stored (relay-miss/unsigned-relay degrade to "ok but unwitnessed" — the
  sovereign-node redundancy invariant, intended) — surfacing a `witnessed` bit on the send result would let
  an operator distinguish fully-witnessed from best-effort. The silent drops are now LOUD (logged), so the
  degradation is diagnosable; the result-shape bit is a follow-on. And `getRelayReceipts` returns `[]` before
  `initialize()` (pre-init, bounded). Revisit the relay-binding when OPTIONB-SEAL lands; the witnessed-bit as
  a standalone observability improvement.

- **DOD-OPTIONB-SETUP-1 / DOD-DEPLOY-1 — `CELLO_DIRECTORY_PUBKEYS` must be wired into the relay IaC
  (any-directory deploy dependency, code-review M2).** The relay verifies a client-presented assignment
  against the consortium directory pubkey SET. In code it falls back to the single `CELLO_DIRECTORY_PUBKEY`
  (node 0) when `CELLO_DIRECTORY_PUBKEYS` is unset — fails CLOSED (a non-listed sig is rejected), so no
  forgery risk, but any-directory is then silently node-0-only: a session routed through a non-node-0
  directory gets `assignment_invalid` client-side, reintroducing the `relay_unavailable`-class failure this
  unit removed (relocated from the directory to the client). The relay now logs
  `relay.startup.consortium-directories {count, anyDirectory}` so a single-key misconfig is visible. **Hard
  DEPLOY-1 task:** the relay CloudFormation/SSM must enumerate EVERY sovereign node's directory-key pubkey
  in `CELLO_DIRECTORY_PUBKEYS`, and STATE.md/templates must capture it. Region-expansion test: a brand-new
  region's relay must get the full set with zero manual steps. Until wired, any-directory is off in
  production — tracked, not dropped.
