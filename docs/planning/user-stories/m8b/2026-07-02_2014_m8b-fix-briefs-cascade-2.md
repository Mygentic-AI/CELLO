---
name: M8B fix briefs — cascade 2 (FINDING-4, FINDING-5, FINDING-6)
type: discussion
date: 2026-07-02
topics: [m8b, fix-briefs, diagnosis, directory-failover, unilateral-seal, receipts, cello-client, directory, handoff]
status: active
description: >
  Root-cause diagnoses and implementation-ready fix briefs for the M8B cascade-2 fix batch.
  FINDING-4 (bootstrap directory failover / SPOF) is fully diagnosed from code. FINDING-5
  (unilateral frontier SI-002 asymmetry) and FINDING-6 (absent-party receipt) are characterized
  with fix sketches; the implementer confirms the leaf-derivability + stub-session mechanics.
  Handoff artifact for the implementing session/coder. Companion to the test-results journal.
---

# M8B Fix Briefs — Cascade 2

Handoff artifact: same shape as [[2026-07-02_1514_m8b-fix-briefs-cascade-1]]. Every brief names
exact files/symbols, the violated invariant, the fix spec, falsification checks, and the tests to
write FIRST (SPARC — red before implementation).

**Unlike cascade 1, this cascade spans BOTH repos.** FINDING-4 is `cello-client`-only. FINDING-5 and
FINDING-6 have `cello-client` (daemon) parts AND directory parts (`trustless-cello/packages/directory`).
Batch discipline: ONE client version-bump/publish for all daemon changes; ONE directory deploy
(~25-30 min) for all directory changes. Do not ship the directory pieces one at a time.

Source references are `/Users/andrep/Documents/code/cello-client` at commit `1698c59`
(**FINDING-3 already landed here** — "persist + return the unilateral seal's legibility receipt";
current published daemon 0.0.22, this commit will publish as the next bump). Cite by SYMBOL first —
line numbers below are approximate at `1698c59` and will drift; re-confirm against HEAD.

Companions: [[2026-07-02_1122_m8b-e2e-test-results-journal]] (FINDING-4/5/6 evidence + threat models),
[[2026-07-02_1130_m8b-e2e-ux-friction-log]].

---

## BRIEF 1 — FINDING-4: no entry-point directory failover (bootstrap SPOF)

**Status: ROOT CAUSE CONFIRMED by code read (2026-07-02). `cello-client`-only. Violates the
sovereign-node REDUNDANCY invariant ("if a node is unreachable, the client falls back to others").**

### Root cause

The client has a single entry coordinate and the signaling dialer never consults the roster it
already holds:

1. `resolveDirectoryUrl()` (`core/daemon/src/directory-bootstrap.ts`) returns `CELLO_DIRECTORY_URL`
   or the hardcoded `PRODUCTION_DIRECTORY_URL = "http://directory-us1.cello.mygentic.ai"`. No list
   of alternates.
2. `createDirectoryEndpointResolver(opts)` (same file) binds ONE `directoryUrl`; its returned
   `getDirectoryEndpoint()` only ever probes that one URL's `/bootstrap`. On failure it returns
   `lastGood` (the SAME node) or null — never another node.
3. `createSignalingConnect` (`core/daemon/src/signaling-connect.ts`) `connect()` calls
   `getDirectoryEndpoint()` only. Its deps type `SignalingConnectDeps` has **no** roster/consortium
   field at all. On failure it throws → the transport `SignalingManager` catches → schedules a
   reconnect → calls `connect()` → resolves the SAME single us1 URL. Loops forever.
4. `signaling-manager.ts` has ZERO references to `getConsortiumEndpoints`; the roster is consumed
   only by the ceremony/registration fan-out, which needs an already-established signaling
   connection — useless precisely when us1 (the signaling entry) is the down node.

The roster IS available and already resolved: the consortium manifest is a **bundled JSON file**
(`core/transport/src/manifest-interfaces.ts:43`), and at startup `manifestNodesToEndpoints` resolves
the reachable nodes into `consortiumEndpoints` (`daemon.ts:403`); `resolveConsortiumRoster()`
(`daemon.ts:453`) re-resolves per call. `ConsortiumEndpoint = {nodeId, pubkey, peerId, multiaddr}`
maps directly onto `DirectoryEndpoint = {peerId, multiaddr}`.

**Net:** the client comes up, verifies the bundled manifest, resolves eu1/ap1 as alive — and still
can't get online, because the signaling connection only ever dials us1. Not "can't find the others"
— "holds the others and refuses to dial them." The failover data + ~90% of the machinery exist; the
last wire (dial a reachable roster member when the primary is down) was never connected.

### Fix spec (all `cello-client` daemon)

1. Make the signaling endpoint resolver **roster-aware**. Extend `createDirectoryEndpointResolver`
   (or add a resolver) that also takes `getConsortiumRoster: () => Promise<ConsortiumEndpoint[]>`
   (wire `resolveConsortiumRoster` from `daemon.ts`). Per `getDirectoryEndpoint()` call:
   - **Sticky:** if currently connected to node X and X still resolves, keep X (no flapping).
   - **Primary-first:** else try the configured node (`resolveDirectoryUrl`'s) `/bootstrap`.
   - **Fallback:** if the primary fails, iterate the roster's OTHER reachable members (use the
     pre-resolved `consortiumEndpoints` multiaddr, or re-probe `/bootstrap`), return the first
     reachable. **Randomize the fallback order** across the roster so clients don't stampede one node.
   - Return null only when NO node resolves.
2. Map `ConsortiumEndpoint → DirectoryEndpoint` ({peerId, multiaddr}).
3. Log the selected node + emit a distinct `directory.bootstrap.failover` event when it changes, so
   an operator sees the client is running on a non-home node.
4. **Identity (do not skip the wire):** when dialing a fallback node, if `challengeVerifier` is set,
   it must verify THAT node's identity — the roster carries per-node `pubkey`. Production runs with
   `challengeVerifier` off today, so this is not blocking for v1, but thread the selected node's
   pubkey through so enabling step-5/6 later is a drop-in, not a rework.

### Falsification / the sufficiency caveat (READ THIS)

The dialer fix is NECESSARY but its SUFFICIENCY is unproven: for the client to actually WORK on eu1,
the rest of the flow — presence resolution, relay assignment, the FROST ceremony — must function
against a **non-home** directory. That is exactly what tests **#12/#13 (any-directory / cross-node)**
would prove, and they have **never run**. Do NOT assume the whole flow works on eu1. The live
verification below IS #12/#13/#5; if presence/relay-assignment turns out home-node-bound, that is a
SEPARATE finding to log, not something to paper over.

### Tests to write first (red)

1. Primary endpoint unreachable, roster has a reachable member → `getDirectoryEndpoint()` returns
   that member and `connect()` succeeds against it. (Red today: null / us1-only.)
2. Sticky: once connected to eu1, subsequent calls keep eu1 while it is reachable.
3. Primary recovers while connected to a fallback → recommend **sticky-until-fail** (do NOT churn
   back to primary); assert no reconnect storm.
4. All nodes down → null (unchanged failure mode, no crash).
5. Regression: primary reachable → primary selected, behaves exactly as today.

Extend `packages/e2e-tests/src/session-fixture.ts` via `opts` — never a from-scratch fixture.

### Live verification (the real proof — also runs #12/#13/#5)

After publish + updating the local/EC2 daemon: set us1 unreachable (down the us-east-1 directory ECS
task), confirm the client **fails over to eu1/ap1**, comes `online`, and completes a real
session + seal on the fallback node. Restore per the `infra/CLAUDE.md` cascade (relay re-register +
manifest re-sign). If the session/seal fails on the fallback even though signaling connected → log
the any-directory-routing gap as a new finding.

---

## BRIEF 2 — FINDING-5: unilateral legibility frontier is directory-attested, not client-re-derived

**Status: characterized; implementer confirms the leaf-derivability split + whether the directory
must ship `frontier_leaves` on the unilateral frame. Security hardening (SI-002 parity). Depends on
FINDING-3 (landed at `1698c59`).**

### Root cause

The bilateral seal enforces "the client does NOT trust the directory for the frontier VALUE" — it
re-derives each party's `content_frontier_seq` from signed leaves and REJECTS an inflated directory
frontier (`daemon.ts` DOD-LEG-2 path: `reDeriveFrontiers`, `findInflatedFrontier`,
`seal.certificate.frontier.unverifiable`, ~`:1818-1882`). The unilateral path (now persisted by
FINDING-3) has NO equivalent guard — the counterparty can't co-sign, so the legibility is
FROST-notarized by the **directory consortium only** and the client re-derives nothing. The directory
is trusted for the frontier values on the receipt-of-last-resort.

**Threat model:** a compromised/buggy directory consortium inflates the ABSENT party's
received-frontier — forging evidence the absent party received content it didn't, on the receipt a
wronged party relies on and the absent party isn't present to contest. Bounded surface: the
`sealed_root` itself is FROST-signed + client-verified (SI-003), so CONTENT integrity holds; only the
legibility frontier METADATA is at risk.

### The real asymmetry (why this is separable, not a simple reuse)

- The present party's OWN frontier is always re-derivable from content it carried → re-derive + reject
  inflation (cheap; reuse the bilateral guard).
- The absent party's AUTHORED frontier (content the present party received FROM it) is re-derivable
  from carried leaves → re-derive.
- The absent party's RECEIVED frontier (its acks of the present party's content) may be **inherently
  un-derivable** by the present party (that evidence lives with the absent party who never provided
  it) → this remainder stays directory-attested, but must be **explicitly marked**, never silently
  trusted.

### Fix spec

1. `cello-client` daemon: in the unilateral confirmation handler (where FINDING-3 now persists the
   cert), apply the bilateral frontier guard (`reDeriveFrontiers` + `findInflatedFrontier`) to every
   party whose signed leaves the present party carries. Reject/override an inflated value; do not
   persist a cert with an unverifiable claimed frontier.
2. Directory: confirm whether `seal_unilateral_confirmed` already ships `frontier_leaves` (the
   bilateral `seal` frame does — `frame["frontier_leaves"]`). If NOT, the directory must include them
   so the client can re-derive → directory change (fold into the cascade-2 directory deploy).
3. The un-derivable remainder (absent party's received-frontier) stays directory-attested but is
   marked as such in `attestation_mode` (FINDING-3 already marks the absent party ABSENT — extend the
   semantics so a consumer can tell client-verified from directory-attested per FIELD, not just per
   party, if the two frontier kinds differ in provenance).
4. **Fold in the running code-reviewer's verdict** on this exact point — if it judges the
   frontier-trust exploitable enough to block, this escalates from hardening to must-fix-now.

### Tests to write first (red)

1. Unilateral seal where the directory publishes an INFLATED present-party frontier → client
   rejects/overrides; does not persist the inflated value. (Red: no guard today.)
2. Absent-party AUTHORED frontier re-derived from carried leaves; inflation rejected.
3. Un-derivable absent-party RECEIVED frontier persisted but marked directory-attested (provenance
   explicit), never as client-verified.

---

## BRIEF 3 — FINDING-6: absent party's (B's) unilateral receipt is not persisted client-side

**Status: characterized (added to the journal by the cascade-2 reviewer as Critical 2). Split into
3a (priority, tractable) and 3b (harder, separable) per agreement 2026-07-02.**

### Root cause

Same underlying defect as FINDING-3, seen from B's side: `recordSealCertificate` has exactly ONE call
site (`daemon.ts:1886`, the bilateral `sealed.received` handler). B (the absent party) learns of the
seal via `seal_unilateral_notification` on reconnect → `registerUnilateralUpgradeListener` →
`attemptSealUpgrade` (DOD-UP-1, ~`:1978+`); that path never persists a receipt. So B's
`cello_get_sealed_receipt` returns `sealed_receipt_not_found` even though (per cascade-2) the directory
now ships the legibility on the notification over BOTH the in-memory `#pendingNotifications` and the
durable Pg `#notificationQueue` (`legibility_cbor_hex`).

### Sub-case 3a — successful upgrade → bilateral, B STILL gets no receipt (PRIORITY, tractable)

On a successful seal upgrade the seal becomes BILATERAL and B should get the BILATERAL receipt — but
`seal_upgrade_confirmed` carries no legibility today. This is a happy-path functional hole in the
returning-party flow, and it is the clean half.

**Fix:** (directory) add the legibility to `seal_upgrade_confirmed`. (client) after
`attemptSealUpgrade` succeeds AND the KERNEL content-recovery/verify gate passes, `normalizeLegibility`
+ `recordSealCertificate` the BILATERAL cert against B's (possibly stub) session row.
Directory change → cascade-2 directory deploy.

### Sub-case 3b — B never fully ratifies: unilateral-only receipt with a different trust basis (harder)

B **cannot** channel-independently verify the unilateral cert's FROST signature — it lacks the
initiator's group key; `attemptSealUpgrade` accepts R1 on the authenticated Noise channel. So B's
receipt has a DIFFERENT trust basis than A's, and B should persist a receipt only AFTER it recovers +
integrity-verifies the content behind R1 (the KERNEL gate) — persisting before that manufactures a
fresh "looks-done-but-isn't" (a receipt for content B never verified).

**Fix:** in the notification handler, after the KERNEL gate passes, `normalizeLegibility(frame["legibility"])`
+ `recordSealCertificate` against B's stub session row. Handle the stub-session lifecycle:
`recordSealCertificate` silently no-ops if B has no local `sessions` row (a reconnecting absent party
may not have one). Client-only (the notification legibility already ships).

### Tests to write first (red)

1. **3a:** B reconnects, upgrade succeeds → bilateral → `cello_get_sealed_receipt(B)` returns the
   bilateral cert (A recorded present, B's own recovered frontier). (Red: `seal_upgrade_confirmed` has
   no legibility → not_found.)
2. **3b:** B reconnects post-restart → drains the DURABLE notification → after the KERNEL verify gate
   → `cello_get_sealed_receipt(B)` returns the unilateral cert (A present, B's recovered frontier,
   provenance marked). (Red today.)
3. Regression: do NOT persist before the KERNEL gate — a tampered/unrecoverable content case yields
   NO receipt (never a receipt for unverified content).

---

## Sequencing & scope

- **FINDING-4:** `cello-client` daemon only.
- **FINDING-5:** `cello-client` daemon + possibly directory (`frontier_leaves` on the unilateral frame).
- **FINDING-6 3a:** directory (`seal_upgrade_confirmed` legibility) + `cello-client` daemon.
  **3b:** `cello-client` daemon only.
- FINDING-3 already landed (`1698c59`) → these build on a clean base, no collision.
- **Batch:** ONE `cello-client` publish for all daemon changes; ONE directory deploy for all directory
  changes (FINDING-5 frontier_leaves if needed + FINDING-6 3a `seal_upgrade_confirmed` legibility).
- **Recommended order:** FINDING-4 first (unblocks the paused test matrix — the node-down/any-directory
  tests are moot until the client can route around a down node), then FINDING-5 + FINDING-6 as the
  receipt-family batch. FINDING-4 can ship in its own client publish ahead of the directory-touching
  work if the receipt work isn't ready.

## Publish procedure for the implementing session

Run `/cello-publish` — do not publish from memory. Full SPARC per brief; gate sequence
(`test → lint → typecheck → build`) + code review before each commit. Client changes span
`core/daemon` (+ `core/transport` if the resolver/manifest interfaces are touched for FINDING-4).
Directory changes require `deploy.sh` (~25-30 min, all 3 regions — batch them). After publish: update
the EC2 demo agent + local daemon to the new versions and run the live verifications named in each
brief (esp. FINDING-4's kill-us1 failover and FINDING-6's B-reconnect receipt).

---

## Related Documents

- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — FINDING-4/5/6 evidence, threat models, and the sub-case split this brief implements.
- [[2026-07-02_1514_m8b-fix-briefs-cascade-1|M8B fix briefs — cascade 1]] — the format this brief mirrors; FINDING-1/F14/F13/F16 (shipped daemon 0.0.21/0.0.22).
- [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish|M8B cascade 1 — implementation, publish, live verification]] — cascade-1 outcome; cascade-2 continues the receipt-persistence family (FINDING-3 → 5 → 6) plus the orthogonal FINDING-4.
- [[2026-07-01_0900_m8b-closed-e2e-testing-phase|M8B closed — E2E testing phase kickoff]] — the test matrix; #12/#13 (any-directory) are the FINDING-4 sufficiency check.
