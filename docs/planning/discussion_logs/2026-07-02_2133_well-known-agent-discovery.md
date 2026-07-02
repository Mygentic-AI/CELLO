---
name: well-known-agent-discovery
type: discussion
date: 2026-07-02
topics: [directory, discovery, naming, demo-agent, consortium-manifest, onboarding, sovereign-nodes]
status: open
description: A user cannot discover the demo agent's address without instance access; design a signed, consortium-published well-known-agents registry resolved by stable handle.
---

# Well-Known Agent Discovery — publishing the demo agent's address

## Problem

To open a session in CELLO you must supply the counterparty's raw 64-hex Ed25519 pubkey
(`cello_initiate_session(target_pubkey: …)`). There is **no way to discover an agent's address
by name.** For a *demo* agent — whose entire purpose is to be a public "try the protocol"
counterparty — this is an onboarding dead end: a prospective user has no path to the value at all.

This surfaced live on 2026-07-02 while running the FINDING-3 unilateral-seal verification. Two
tangled failures:

1. **The identity rotated with no discovery channel.** The demo agent's pubkey had changed
   `bc94ead6…` → `7ab98987…` (agent `default`). Nothing authoritative tracked the current value:
   `infra/STATE.md` still labelled `bc94ead6…` "current," and an `initiate_session` to it returned
   `target_offline`. The *only* way to find the live identity was to SSM into the EC2 instance and
   grep the daemon log for the `agent.online` event. **A real user cannot do that.**

2. **Why did it rotate at all?** `STATE.md` lists a persisted Secrets Manager identity key
   (`cello/dev/demo-agent/identity-key`), yet the pubkey still changed. If the demo identity is
   meant to be durable, something regenerated it. Root cause unknown — needs investigation. A
   *stable* identity shrinks the whole problem (publish once, stays valid).

## Why this belongs in the directory

The directory is already the three things a discovery mechanism needs:

- **Presence authority** — it knows which agents are online (`/agent-lookup`, `/bootstrap`).
- **Lookup surface** — clients already talk to it for bootstrap and agent resolution.
- **A signer** — it holds a node identity and already signs the relay manifest.

So "the demo agent's address" is not new infrastructure; it is a capability the directory is
uniquely positioned to own. Andre's framing: *"maybe it's a specialized directory thing."* Agreed.

## Core shape — handle → pubkey resolution

A **stable handle** (a name that never changes, e.g. `demo`) that the directory resolves to
whatever pubkey currently holds it. Key rotation becomes invisible to users:

```
cello_initiate_session(target: "demo")
  → client asks the directory to resolve the handle "demo"
  → directory returns the current signed { handle, pubkey, … } record
  → client initiates to that pubkey
```

The failure hit on 2026-07-02 (stale pubkey → `target_offline`) simply disappears.

## Two design forces that make this a *CELLO* feature, not a lookup table

1. **It must be signed, not just served.** A newcomer connecting to "the demo" must get a mapping
   they can **verify against the consortium root keys they already pin** — otherwise a hostile or
   compromised node substitutes its own pubkey and hands the newcomer to an impostor on their very
   first session. The directory already has the signing machinery. This keeps discovery trustless
   and consistent with the SI-002 posture (directory-attested, client-verifiable) rather than
   trusting the transport.

2. **It must be consortium-scoped, not single-node.** If `demo` resolves only at the node that
   happens to host it, we reintroduce a single point of failure and region lock-in — a direct
   violation of the sovereign-node invariant (redundancy + choice). The well-known registry should
   be a **replicated, signed artifact every node can serve.** This points squarely at the
   **consortium manifest** (currently unset in dev): a "well-known / featured agents" section in
   the signed consortium manifest is very likely the natural vehicle.

## Options considered

- **A — Well-known discovery endpoint (near-term).** Demo self-publishes its current pubkey to an
  authoritative place the onboarding surface reads live (directory route or public signed JSON).
  Always-current, zero instance access, survives rotation. Demo-specific, small.
- **B — Fix identity durability (foundational).** Make the demo load its key from Secrets Manager
  and never regenerate; find and kill whatever rotated it. Combined with A, the published address is
  both correct *and* stable.
- **C — Human-readable handles in the directory (long-term).** A general naming layer — `demo`
  today, `alice@org` later — rotation-proof, the real UX destination. Milestone-sized (ownership,
  claims, verification). A/B are stepping stones toward it.

## Recommendation

**A + B now, C as the design it deserves.** Specifically: a **signed, consortium-manifest-published
well-known-agents registry, resolved by stable handle**, seeded with the demo agent — plus a
root-cause + fix for the demo identity rotation so the published address stays stable. Start
specialized (a curated set of featured agents the consortium publishes), generalize to
user-claimed handles later, reusing the same signed-resolution path.

## Open questions / next steps

- [ ] **Root-cause the demo identity rotation** (`bc94ead6…` → `7ab98987…`). Why did a
      Secrets-Manager-persisted key change? Is the demo regenerating on some failure path?
- [ ] Registry as a **section of the consortium manifest** vs a **standalone signed directory
      artifact** — decide the carrier. Consortium manifest is the leading candidate (replication +
      signing already in scope).
- [ ] Client-side handle resolution: new `cello_initiate_session(target: <handle>)` path +
      verification against pinned consortium root keys.
- [ ] Handle namespace + claim model for the general case (C) — who owns `demo`, how a handle is
      bound to a pubkey, how rebinding (rotation) is authorized.
- [ ] Onboarding surface (corp site / portal) consumes the resolved handle so the "connect to the
      demo" instructions are always live.

## Related

- [[protocol-map]] — discovery/naming is currently a gap across the 9 domains.
- [[2026-07-02_1807_m8b-cascade-2-finding3-implementation-and-deploy-plan]] — the FINDING-3 verify
  during which this surfaced.
- `infra/STATE.md` — demo-agent identity line (corrected 2026-07-02: current pubkey `7ab98987…`).
