---
name: cross-node-session-topology
type: design
date: 2026-07-04
topics: [cross-node, session-establishment, directory-topology, presence, sovereign-nodes, federation, discovery, handoff]
status: active
description: Topology for cross-node session establishment — discover the target's home node from replicated presence, open a second transient client connection to that node, then let the existing same-node session flow run. Directories never talk to each other. Chosen over every-agent-on-every-directory and over inter-directory messaging.
---

# Cross-node session establishment — topology design

## Decision (TL;DR)

To connect to an agent homed on a *different* directory node, the client **moves to the target's node** rather than routing across nodes:

1. **Discover** the target's home node from replicated presence — ask your own directory "where is X?"
2. **Open a second, transient signaling connection** from your client to the target's home directory (keeping your own home connection for your inbound).
3. Both agents are now locally present on that one directory → **the existing same-node session flow runs unchanged** (offer/accept → FROST-signed assignment → relay handoff).
4. Drop the transient connection after the handoff; the conversation runs peer-to-peer over the relay.

**Directories never talk to each other.** The client spans nodes on demand. Chosen over (a) every-agent-connects-to-every-directory and (b) inter-directory messaging.

## The problem

Session routing is **local-only**. `#processSessionRequest` checks `this.#streams.get(targetHex)` — an in-memory map of agents with a live signaling stream to *that* node — and returns `target_offline` if the target isn't locally connected (`packages/directory/src/directory-node.ts:2964`, `:3046`). It never consults replicated state. So two agents homed on different directories cannot start a session. It works today only because everyone defaults to us1 and is therefore coincidentally co-located.

**Root cause.** Agent *data* (identity, and the future trust-score hashes) was always designed to be **fully replicated** — every node holds every agent's rows, keyed on the agent's public key, no PII. But for *connecting* to work, the original (unwritten) assumption was that every agent was connected to every directory — a full mesh. That mesh was never stated and never built; single-home was. So the data federated; the reachability did not. Every T-of-N gap we hit (registration-all-N, signer-on-participants, FINDING-8 profile cache, FINDING-9 session-after-failover) is a facet of this one thing.

## Key insight

Full replication means **verification data is already everywhere** — any node can answer "who is this / are their credentials authentic" locally. The *only* thing that cannot be replicated is a **live connection**. So the entire cross-node problem reduces to a single question: *how do you reach the target's live connection?* And the cleanest answer is not to route to it, but to **bring the client to the node that already holds it** — turning every cross-node session into a same-node session, which is the case that already works.

## The topology (mechanism)

Alice (homed to us1) wants Bob (homed to eu1):

1. **Discover.** Alice's daemon asks us1 "where is Bob?" us1 answers from **replicated presence** (`agent_presence.owning_node_id`, replicated since V38): "Bob is on eu1." (New: a lookup handler; see "What's new".)
2. **Second connection.** Alice's daemon opens a **second** authenticated signaling connection to **eu1**, keeping its us1 connection for Alice's own inbound. eu1 authenticates Alice with no special case — Alice's identity is already replicated to eu1. This connection is **transient** (for the setup only).
3. **Same-node establishment.** From eu1's point of view, Alice and Bob are now two locally-connected agents — the current happy path. The **existing** flow runs unchanged: eu1 runs the offer/accept handshake with Bob, builds and FROST-signs the `SessionAssignment` (Bob's session endpoint + a relay rendezvous), and hands it to both. No new server-side session or relay machinery.
4. **Relay handoff.** Alice and Bob establish over the relay exactly as they do today, and the directories drop out. Alice's transient eu1 connection can be released after the handoff.

An agent therefore holds: **one home connection** (its inbound anchor) **plus a transient connection per active outbound reach**. Never all N.

## Why this shape — and what we rejected

**Why:**
- **Reuse.** Converting cross-node → same-node means the hard, proven server-side machinery (offer/accept, assignment, relay handoff) is untouched. The build is two small steps *in front* of the existing flow.
- **Sovereign.** Directories never talk to or trust each other — no inter-directory channel, no node acting on another's word. The client is the only thing that spans nodes.
- **Scalable.** Connections per agent = 1 home + transient outbound, not N. Avoids both the multi-home connection ceiling and inter-directory complexity.
- **Future-proof.** The connection is brokered on the target's home node, which is exactly where trust verification will live (see M10/11 fit).

**Rejected — every agent connects to every directory (full mesh / "multi-home").** Makes presence trivially consortium-wide and needs almost no directory-side change, BUT connections scale as agents × N and every directory carries every online agent — a hard ceiling. This was the *original* implicit design; we are deliberately not resurrecting it.

**Rejected — inter-directory messaging (directories forward/broker between themselves).** Scales, but adds a brand-new node-to-node trust surface (a node in the path can deny/misroute), reintroduces a home-node availability dependency, and — critically — the connection request carries a **bounded but real negotiation** (see [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow]]: one round of accept/ask-more/decline, plus a possible human escalation with `escalation_expires_at`). Proxying that — possibly waiting on a human over Telegram — through a directory-to-directory channel is exactly the state you do not want infrastructure holding. Moving the client to the target's node keeps that whole exchange local to one directory.

## What's already built (reuse — do not rebuild)

- **Full identity replication** (day one) and **presence replication** (`V38__presence_replication.sql`; `agent_presence` + `directory_nodes` in `cello_pub`; `infra/setup-replication.sh` `PUBLICATION_TABLES`).
- **Failover + re-establish:** roster-aware resolver reconnects to a survivor on home failure (`daemon.ts:474`, FINDING-4); reconnect re-runs the full auth handshake (`signaling-connect.ts:135`); the directory upserts `agent_presence` online with its own `owning_node_id` on auth (`directory-node.ts:657`, PRESENCE-001), so presence flips to the new home. Code-complete; live-confirm pending.
- **The same-node session flow + relay:** offer/accept, FROST-signed assignment, location-independent relay pool (one signed S3 manifest read by all), circuit-relay dial — all existing and unchanged.
- **The client already opens multiple directory connections at once** (the FROST ceremony fans streams to every node). A second, on-demand signaling connection extends an existing behavior, not a new paradigm.

## What's new to build

1. **Discovery lookup.** Directory-side: a handler that answers "where is agent X?" from replicated `agent_presence` (returns `owning_node_id`, and — if adopted — a reachability hint). Client-side: call it before initiating when the target isn't on the current node.
2. **On-demand second directory connection.** Client-side: given the target's home, open + authenticate a second signaling connection to that node, submit the session request there, and release it after the relay handoff. Manage its lifecycle alongside the home connection.

Everything downstream (offer/accept, assignment, relay) is reused as-is.

## Trust layer (M10/11) fit — designed to slot on, not retrofit

Trust scores are deliberately postponed (≈M10/11) and will be designed *around* this topology. They slot on cleanly:
- The connection is brokered on the target's home node, which — via full replication — holds every agent's trust-score hashes. So when Alice submits her request there, **her home node** (or the brokering node) verifies her submitted scores against the replicated hashes and issues a **signed attestation** ("authentic, and complete — including all mandatory signals"), which Alice carries into the request.
- **Mandatory-signal enforcement is preserved** because the signing node has all of Alice's hashes and knows which signals are mandatory, so a complete attestation cannot omit her behavioral track record — the guarantee the [[2026-04-14_1300_connection-request-flow-and-trust-relay|April connection-request design]] protected, kept without any directory forwarding.
- No topology change is required when trust scores land — only the attestation step is added.

## Home failure / re-establishment

Covered by existing code (validated 2026-07-04): when the home stops responding, the roster-aware resolver reconnects the client to a survivor, re-authenticates, and the survivor upserts presence with its own `owning_node_id` — so the agent is re-established and re-findable on the new node. FINDING-9's `target_offline` was **not** a re-establishment failure (the agent did re-establish); it was the cross-node routing gap this design closes.

## Open items, assumptions, dependencies

- **Relay reachability (assumed; validated by art/tests).** The design assumes the target is dialable via the relay once assigned. Not re-litigated here — it's the existing same-node behavior and will be covered by acceptance tests.
- **FINDING-8 (profile cache boot-only)** — the brokering node holds the target locally, but confirm the initiator-side signer path doesn't need a profile the brokering node lacks. Signer half fixed (Problem 1); profile half is the deferred absent-node reconcile.
- **`k` redundancy knob (home to >1 node).** Baseline k=1; homing to 2–3 nodes for inbound redundancy (survive a home dying without a re-home window) is a future tunable, not needed for the first build.
- **Transient-connection lifecycle** — drop immediately after the relay handoff vs. hold for the session's lifetime (e.g. if any teardown/seal signaling wants it). Implementation detail; default to dropping after handoff, revisit if a signaling need surfaces.
- **Presence write is best-effort / not retried** (`directory-node.ts:646`) — a DB hiccup during failover is logged and swallowed. Fine at small scale; a robustness follow-up if it ever bites.

## Related documents

- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — the (fully-replicated-assuming) connection negotiation this topology carries; the attestation approach preserves its mandatory-signal guarantee.
- [[2026-07-04_1600_directory-node-selection-strategy|Directory node-selection strategy]] — how a client picks *which* node to home to / route through (random at launch, P2C later); composes with this topology (the "which home" and "which node to reach into" choice).
- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — FINDING-9 (session/seal after failover) and FINDING-8 (non-home node can't serve a fresh agent until restart), the live symptoms this topology addresses.
- [[2026-06-26_1030_per-agent-directory-connections-and-manifest-over-http|Per-agent directory connections]] — the one-authenticated-stream-per-agent model this extends to on-demand second connections.
