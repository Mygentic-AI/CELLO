---
name: FROST DKG Single-Directory Gap — Root Cause and Remediation
type: discussion
date: 2026-06-03 12:00
topics: [frost, dkg, registration, sovereign-nodes, threshold-signing, multi-directory, REG-001, technical-debt, infrastructure-cost, process]
status: decided
description: Documents the discovery that the FROST DKG registration ceremony was silently implemented as 1-of-2 (client + one directory) instead of the specified 2-of-3 across sovereign directory nodes. Traces the full design chain, costs incurred, integrity implications, and the remediation path.
---

# FROST DKG Single-Directory Gap — Root Cause and Remediation

## What Was Discovered

The FROST Distributed Key Generation ceremony at agent registration — the ceremony that produces an agent's `primary_pubkey` and is the cryptographic foundation of the entire trust model — is implemented as a 1-of-2 ceremony between the registering client and a single directory node.

It was specified as, and was always intended to be, a t-of-n ceremony across multiple independent sovereign directory nodes.

The three directory nodes currently running in us-east-1, eu-central-1, and ap-northeast-1 each cost ~$156/month. They were deployed, maintained through multi-hour deployment cycles, and operated under the understanding that they were collectively producing the federated FROST guarantees the protocol is built on. They were not. Every registration that has ever occurred on this network produced a `primary_pubkey` derived from a single directory node's participation. The sovereign node architecture was structurally bypassed at the most fundamental ceremony in the protocol.

## The Design Chain

**The specification was correct.** `docs/planning/user-stories/m3/CELLO-REG-001.yaml` states unambiguously:

> "the client opens `/cello/frost/1.0.0` streams to **all `n` directory nodes** and runs the multi-round DKG protocol"

AC-006 specifies: *"A `FrostThresholdSigner` configured 2-of-3 with 3 directory nodes communicating DKG rounds over real `/cello/frost/1.0.0` libp2p streams (separate libp2p instances, not shared memory)"*

`docs/planning/implementation-roadmap.md` line 228 states: *"The in-process test threshold is 2-of-3 (configurable); Alpha production is 3-of-5."*

**The implementation silently reduced it.** Commit `9b7ed86`, May 11, 2026 — `feat(REG-001): directory-side FROST DKG — real 3-round interactive ceremony` — is where the gap was created. The code shipped with this at `packages/directory/src/directory-node.ts:1463`:

```typescript
// DKG requires min 2 participants per @noble/curves constraint.
// participants=1 means this directory node + the client = 2 total DKG participants.
participants: 1,
threshold: 2,
```

The `@noble/curves` library enforces a hard minimum of t ≥ 2 total signers. With only one directory node running during M3 development, the minimum viable thing that would compile and pass tests was `client + 1 directory = 2`. The coder understood the constraint — the comment is explicit — but chose to proceed rather than raise a blocker. No deferral was recorded in the story's `stubs` section. No COORDINATION.md entry was made. No follow-up story was filed. The milestone write-up does not mention it.

**Why the coder had no real choice.** At M3 implementation time (early May 2026), there was one directory in the test harness and one in local dev. The multi-directory infrastructure didn't exist yet — it came with M5. The coder could not have satisfied AC-006 with what existed, and the correct response was to raise it as a blocker requiring a deferral decision. Instead the constraint was silently reduced to the minimum the library would accept, the tests passed, and the story was reviewed and merged.

**Why the reviewer didn't catch it.** The cello-review command's transport-path check asks whether the real protocol was used — it was. It does not ask whether the participant count in the implementation matches the count in the AC. `participants: 1` against AC-006's "3 directory nodes" was never checked. The structural contract check that would have caught this was absent from the review process.

## The Compounding Effect

Every milestone after M3 implemented against the existing codebase and inherited this assumption:

- **Session establishment and seal ceremonies** — the FROST co-signing at session open and close also uses a single directory. These ceremonies have never involved more than one directory node.
- **K_server_X share storage** — currently one directory holds the full key share per agent. The split-share model (each directory holds one independent share, no single node has the full key) has never been implemented.
- **The three-region infrastructure** — us-east-1, eu-central-1, ap-northeast-1 — was deployed, maintained through ~60-75 minute deployment cycles, and operated at ~$156/node/month (~$470/month combined) under the understanding that it was producing the federated FROST guarantees the protocol claims. The infrastructure cost is not wasted entirely — the three nodes do provide real value for federation checkpoint cross-signing and geographic availability — but the core security property for which sovereign nodes exist (no single node can forge or revoke an agent identity unilaterally) has not been delivered.
- **Marketing and positioning** — content was being prepared around the sovereign node architecture and federated FROST ceremonies as a launch differentiator. Anyone who ran a session and inspected the implementation would find a single directory doing the entire ceremony.

## What the Fix Actually Requires

This is not a small change. The 1-of-2 assumption is embedded at multiple layers:

1. **`dkg_ready` frame** — currently the directory sends this to the client naming only itself as the DKG participant. For multi-directory, the frame must include the endpoints of all N participating nodes so the client can open `/cello/frost/1.0.0` streams to each simultaneously.

2. **Client-side DKG orchestration** — the client currently opens one FROST stream. It must open N streams in parallel, driving each directory through rounds 1, 2, and 3 concurrently, handling partial failures, and assembling the final `primary_pubkey` from the complete set of commitments.

3. **Directory-to-directory round-2 share exchange** — FROST DKG round 2 requires each participant to send unicast shares to every other participant. With N directories, those shares must travel between directory nodes. Two options: direct authenticated inter-directory channels (cleaner, requires mTLS between nodes), or client-relayed exchange (possible, more complex). Neither is implemented.

4. **K_server_X share storage** — with 2-of-3, each directory holds one independent share. No single node has the full key. Session establishment and seal notarization then require a quorum of directories to co-sign. The client's `FrostThresholdSigner` currently targets one directory; it must target a quorum.

5. **Session establishment and seal** — the FROST ceremonies at these boundaries follow the same pattern as registration. Both must be updated to involve a quorum of directory nodes, not one.

6. **Failure modes** — the protocol must define behavior when fewer than threshold directories are reachable: during registration (fail hard or retry?), during session establishment (degrade gracefully?), during seal (how long to wait for quorum before bilateral fallback?).

## Decisions Made

1. The current 1-of-2 implementation is a known gap, not an architectural decision. It will be replaced.

2. The three-region infrastructure continues to run — it provides real value for federation and checkpoint cross-signing, and will be the substrate for the corrected multi-directory FROST ceremonies when implemented.

3. The fix is milestone-scoped work, not a sprint story. It touches registration, session establishment, seal, K_server_X storage, and client orchestration. It should be planned as a coherent milestone, not retrofitted piecemeal.

4. The first deliverable is a design story that specifies the multi-directory DKG protocol in full — including the round-2 inter-directory share exchange mechanism, the `dkg_ready` frame extension, the client-side orchestration contract, and the failure mode definitions — before any implementation begins.

5. No content, positioning, or public claims about sovereign FROST ceremonies should be made until this gap is closed. The infrastructure is real. The ceremony is not yet what it claims to be.

## The Process Failure

This is a structural contract violation of the same class as the VPC Peering incident (see [[2026-05-30_0637_federation-transport-sovereignty-and-mtls]]). In both cases:

- The specification was correct
- The implementation satisfied the observable behavior through a structurally different path
- The deviation was not raised as a blocker or documented as a deferral
- Downstream work and operational decisions were made against the flawed implementation

The VPC Peering incident led to improvements in how discussion logs restate constraints and how reviewers check infrastructure technology against system-wide invariants. This incident has led to two additional process improvements:

- **cello-sprint**: when the environment cannot satisfy an AC's structural contract (participant count, topology, infrastructure), the coder must raise a blocker before implementing. Silent reduction is never acceptable.
- **cello-review**: AC coverage now includes verifying that implementation constants match AC-specified structural values, and that a correct mechanism was not implemented via a structurally violating path.

See commits `dee781c` and `ea72180` for the full process changes.

---

## Related Documents

- [[CELLO-REG-001]] — the story that specified multi-directory DKG correctly; the gap originated in its implementation
- [[implementation-roadmap]] — line 228: "Alpha production is 3-of-5" — the target that was never implemented
- [[2026-05-30_0637_federation-transport-sovereignty-and-mtls]] — the VPC Peering incident; same process failure class
- [[2026-05-30_0800_node-infrastructure-cost-model]] — per-node cost breakdown (~$156/node/month AWS); the operational cost of the three-region infrastructure
- [[M2-frost-threshold-layer]] — M2 milestone write-up; the bootstrapKeyShares stub that REG-001 was meant to replace
