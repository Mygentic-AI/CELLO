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
  recordAssignment / getSealLeaves / confirmSeal). — ❌
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
  one group key. 2-of-3 DKG completes against 3 directory nodes. *(FED-DKG-001)* — ❌
- **DOD-SIGN-1** — T-of-N session signing + seal: client coordinates with any T of N; one node down ⇒
  still signs (exclusion/retry). Byte-identical sealed root. The single-key fallback (`directory-node.ts:3964`)
  is removed/guarded — FROST whenever DKG exists. *(FED-SIGN-001)* — ❌
- **DOD-SUSPEND-1** — Quorum-aware refusal: with ≥ N−T+1 nodes honoring a suspension no signature forms;
  with fewer it still signs — proving threshold-refusal ≠ single-node-refusal. *(FED-SUSPEND-001)* — ❌
- **DOD-REFRESH-1** — Proactive share refresh / resharing + real epoch rollover: a refresh rotates all
  shares to a new epoch, old shares no longer sign, group pubkey unchanged; a node compromised in epoch e
  holds nothing usable in e+1. *(FED-REFRESH-001)* — ❌

## Tier B — Directory↔relay (Option B) — depends on Tier A group key + DOD-MANIFEST-1
- **DOD-RELAYSIG-1** — Relay signs its ordering record (Structure2) + PERSIST-012 signed-ACK + immutable
  receipt store ported from dead `core/client` into the live daemon; client verifies + durably stores the
  receipt; a forged sequence is rejected. *(FED-RELAYSIG-001)* — ❌
- **DOD-OPTIONB-SETUP-1** — Client presents the directory-signed assignment to its chosen relay; relay
  verifies vs the group key; `recordAssignment`/`#relay` pin deleted. Session establishes with NO
  directory→relay dial; any relay the client picks works; `relays[0]` pin + restart-breakage gone.
  *(FED-OPTIONB-SETUP-001)* — ❌
- **DOD-OPTIONB-SEAL-1** — Client carries relay-signed receipts to the directory; directory rebuilds +
  verifies the tree offline and FROST-seals (T-of-N); `getSealLeaves`/`confirmSeal` directory→relay calls
  deleted. Full seal with NO directory→relay connection; chain + strict-in-order preserved; tampered/omitted
  receipt rejected. *(FED-OPTIONB-SEAL-001)* — ❌

## Tier C — Cross-node directory state (independent)
- **DOD-PRESENCE-1** — `agent_presence` + `directory_nodes` in `cello_pub` (REPLICA IDENTITY confirmed for
  UPDATE replication); agent online on node A reads online from node B. *(FED-PRESENCE-001)* — ❌
- **DOD-PICKUP-1** — `pickup_queue.id` → UUID; in `cello_pub`; `sweepUndeliverablePickups` gated to the
  owning node. Ciphertext written on node A drains on a daemon connected to node B; sweep never deletes a
  deliverable row on an unconverged replica. *(FED-PICKUP-001)* — ❌

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
