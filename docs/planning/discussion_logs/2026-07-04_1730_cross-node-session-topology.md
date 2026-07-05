---
name: cross-node-session-topology
type: design
date: 2026-07-04
topics: [cross-node, session-establishment, directory-topology, presence, sovereign-nodes, federation, discovery, handoff]
status: active
description: Topology for cross-node session establishment — discover the target's home node from replicated presence, open a second transient client connection to that node, then let the existing same-node session flow run. Directories never talk to each other. Chosen over every-agent-on-every-directory and over inter-directory messaging. Reviewed 2026-07-05 — visiting-auth presence integrity identified as a third build item (blocker), discovery made advisory-with-retry, escalation branch and rollout/observability added.
---

# Cross-node session establishment — topology design

## Decision (TL;DR)

To connect to an agent homed on a *different* directory node, the client **moves to the target's node** rather than routing across nodes:

1. **Discover** the target's home node from replicated presence — ask your own directory "where is X?" The answer is **advisory** — the target node's own live check remains the authority; on miss, re-discover and retry (bounded).
2. **Open a second, transient signaling connection** from your client to the target's home directory (keeping your own home connection for your inbound). The transient connection authenticates as **visiting** — it must NOT write presence, or it clobbers the agent's real home record (see "Visiting auth" below — this is a required build item, not hardening).
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
2. **Second connection.** Alice's daemon opens a **second** authenticated signaling connection to **eu1**, keeping its us1 connection for Alice's own inbound. eu1 can verify Alice's identity — it is already replicated to eu1 — but the connection must authenticate as **visiting**: today's auth hook unconditionally upserts presence with this node as owner, which would falsely re-home Alice to eu1 (see "Visiting auth — presence integrity"). This connection is **transient** (for the setup only).
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

## Discovery — how the daemon asks "where is X?", and the states it must distinguish

**Who does it ask? Its own directory — the one it is currently connected to. No polling.** Because identity and presence are *fully replicated*, whatever node the daemon is connected to (its home, or a survivor it already failed over to) can answer authoritatively for *any* agent. There is never a reason to poll all N directories.

**Three distinct states** (today's `target_offline` wrongly collapses them — the same conflation as F4):

| State | How the node determines it | Answer to the daemon |
|---|---|---|
| **1. Online — here's where** | `agent_profiles` has the pubkey **and** `agent_presence.online = true` **and** the owning node's heartbeat is fresh | `owning_node_id` (→ open a second connection there) |
| **2. Known but offline** | `agent_profiles` has the pubkey, but `agent_presence.online = false` (or no presence row) | `offline` — the agent exists, just isn't reachable now (retry later / notify) |
| **3. Unknown / wrong address** | `agent_profiles` has **no** row for the pubkey | `unknown_agent` — no such agent; a bad address, not a transient outage |

**Edge (4th nuance, already handled by READ-001):** the presence row says online but the **owning node is dark** (stale/NULL `last_heartbeat_at`) — the agent's home died and it hasn't re-homed yet. Treat as "not currently reachable," distinct from a clean offline. The freshness rule lives in `agent-presence-repository.ts` (READ-001).

**The readers already exist** — this is a new *handler* wrapping two existing point-reads, not new storage:
- Existence: `SELECT 1 FROM agent_profiles WHERE k_local_pubkey = $1` (`pg-directory-store.ts:365`).
- Presence: `agent_presence` is keyed on `k_local_pubkey` (PK) with `owning_node_id`/`online`/`last_seen_at` — a trivial point read (`agent-presence-repository.ts`; upsert-on-connect at `:29`, dark-node freshness at READ-001 `:99`).

**Discovery is advisory — the target node stays the authority.** Replicated presence lags (logical replication) and the target can re-home or go offline between discovery and the session request. The `#streams` check at the discovered node remains the only authoritative liveness test. Client rule: on `target_offline` at a node discovery pointed to, **re-discover → retry**, bounded (e.g. 2–3 attempts with backoff), then surface state 2 ("known but offline") to the caller. Never treat a discovery answer as a guarantee, and never fail hard on the first miss.

**Response shape — list, not scalar.** Return `owning_node_ids: string[]` (length 1 today). The future `k>1` homing knob (below) then extends the payload, not the protocol. Costs nothing now; avoids a frame-format break later.

**Existence oracle — deliberate.** The handler lets anyone holding a pubkey distinguish `offline` from `unknown_agent`, i.e. confirm an agent exists. This is accepted by design: the pubkey *is* the address (high-entropy, unguessable), so existence is only learnable by someone who was given the address — same disclosure model as the session request itself.

**Validate before dialing.** The discovered `owning_node_id` must resolve through the **signed manifest** (`manifestNodesToEndpoints`) before the client dials. A lying or compromised directory can then at worst misdirect to another legitimate node (→ `target_offline` → retry elsewhere), never to an attacker endpoint.

## FROST ceremony and seal — who coordinates them (answering "is it EU1?")

**No — neither the ceremony nor the seal is done by the broker directory.** They are **client-coordinated**. Each agent's own daemon reconstructs its threshold signer and opens fresh `/cello/frost/1.0.0` streams **directly to its own consortium roster** — the directories it registered its share with (its persist-Q holders) — not to whatever node brokered the session (`session-ceremony.ts:117` `hydrateShareAndStubs` → `getConsortiumEndpoints()` roster → `directoryNodeStubs`; the seal at `:325` `runSealCeremony` uses the same). This is why signing already survives a node outage and is unrelated to the target-presence gate.

Consequences for this topology (Alice on us1, transiently connected to eu1, reaching Bob on eu1):
- **Session-setup assignment signature:** coordinated by **Alice's** client (the broker delegates the signature back to the initiator via `ClientDelegatedSigner.participateInCeremony`). This round-trip runs over Alice's connection to eu1, so **the transient connection must stay up through setup** (until the assignment is signed and the relay handoff completes).
- **The seal at close:** bilateral, and **each party seals over its own roster** — Alice over her share-holders (which include *her* home), Bob over his. **Neither depends on the transient eu1 connection.** So eu1 is the *broker/rendezvous* for setup, never "the node that seals."
- **Therefore the transient connection's lifecycle is settled:** hold it through session setup; release it after the relay handoff. The seal needs nothing from it.
- **Except the escalation branch.** The negotiation can block on a human (`escalation_expires_at` — potentially hours, over Telegram). Holding a cross-region transient connection for hours is the same state-holding problem that disqualified inter-directory proxying, relocated to the client. The lifecycle rule for this branch: on escalation, the client **releases the transient connection and re-initiates** when the escalation resolves (or expires) — the pending request lives with the *target's* daemon/human, not on the wire. What "notify on resolve" looks like (poll on retry vs. push via Alice's home inbound) is an implementation decision for the story; holding the connection open for the whole window is not an acceptable answer.

## Visiting auth — presence integrity (blocker, verified in code 2026-07-05)

The original draft claimed directory auth of a visiting agent "needs no change." **That is wrong.** The signaling auth hook (`directory-node.ts:1647–1649`) unconditionally calls `#recordPresence("online")` → `upsertPresenceOnline`, whose `ON CONFLICT` **reassigns `owning_node_id` to this node** (`agent-presence-repository.ts:29–37`). Two consortium-wide corruptions follow from Alice's transient eu1 connection:

1. **Wrong-home:** Alice's presence row flips to `owning_node_id = eu1`. Anyone discovering Alice is now sent to eu1, where she has no standing inbound → `target_offline` for an online agent.
2. **False-offline:** when Alice releases the transient connection, eu1's offline write *passes* the sovereign-scoping check (`WHERE owning_node_id = $2` — eu1 now owns the row) and marks her **offline consortium-wide while her real us1 home connection is alive**. Presence is edge-triggered (PRESENCE-001), so us1 never corrects it until she reconnects.

**Fix:** the signaling auth handshake carries a **`visiting` flag** (client sets it on the transient connection). A visiting auth gets the `#streams` entry (so the same-node session flow sees the agent) but **skips both presence writes** — connect and disconnect. Only the designated-home connection writes presence. This is build item 3 below — required for correctness, not hardening.

## What's new to build

1. **Discovery lookup handler** (see the table above) — directory-side signaling handler returning the 3-state answer from the two existing point-reads; client-side call before initiating when the target isn't already on the current node, with the advisory-retry rule.
2. **On-demand second directory connection.** Client-side: given the target's `owning_node_id` (manifest-validated), open + authenticate a second signaling connection to that node with the `visiting` flag, submit the session request there, hold through setup, release after the relay handoff (escalation branch: release + re-initiate). Copy the existing per-agent connection pattern.
3. **Visiting-auth presence integrity** (section above) — `visiting` flag in the signaling auth; visiting connections get `#streams` but never write presence.

Everything downstream (offer/accept, assignment, relay, FROST, seal) is reused as-is.

## Edge cases the implementation must handle

- **Connection-aware client dispatch.** Session-setup responses (offer/accept progress, assignment, the delegated-signer round-trip) arrive on the **transient** connection while home traffic continues on the other. The daemon's inbound frame routing must not assume one connection per agent — audit `SignalingManager` for singleton assumptions before "copying the pattern."
- **FINDING-8 applies to the broker, not just the signer path.** If eu1 booted before Alice registered, any in-memory profile/registration-gated step on eu1 (`#requireRegistration`, connection gate, delegated-signer setup) can't see her despite the rows being in eu1's DB. A **cache-miss → DB read-through** on the broker (or the deferred absent-node reconcile) is a *dependency check* for this design — verify which broker-side steps consult boot-time caches before calling the reuse claim safe.
- **Transient-connection refcounting.** Two concurrent outbound sessions to agents both homed on eu1: one shared transient connection, released when the *last* setup completes — or strictly per-session connections. Pick one and make release refcounted accordingly; a shared connection torn down by the first session to finish strands the second mid-setup.
- **Simultaneous mutual initiation.** Alice→Bob and Bob→Alice at the same time ride two *different* brokers (eu1 and us1) — no single node sees both. Confirm duplicate-session handling doesn't assume one broker observes both directions; two parallel sessions is an acceptable outcome, a deadlock or crash is not.
- **Mid-setup broker failure.** If eu1 dies during setup, Bob re-homes via existing failover; Alice's retry loop (re-discover → new owning node → new transient connection) must cover this without special-casing.

## Rollout ordering and observability

**Rollout.** The discovery frame is a new signaling frame type: **directories deploy first, client publishes second.** An old client against a new directory is unaffected (never sends the frame). A new client against an old directory must degrade gracefully (unknown-frame → treat as "discovery unavailable," fall back to today's behavior) — but the real rule is sequencing: batch the directory change, deploy all regions (~25–30 min), then publish the client. Bilateral compat is a blocking AC per the cross-repo rules.

**Observability ACs (M4+ rules — the stories must carry these).** One correlationId minted at `cello_initiate_session`, threaded through the whole chain. Named events, minimum set:
- `directory.discovery.lookup` (+ `.failed`) — target pubkey (short), 3-state answer, owning node, correlationId
- `signaling.visiting.connected` / `signaling.visiting.released` — node id, reason (handoff-complete | escalation | failure), correlationId
- `session.crossnode.initiated` / `.established` / `.failed` — initiator home, broker node, retry count, correlationId
- Error paths: discovery-said-online-but-target_offline (the retry trigger), manifest-validation failure, visiting-auth failure.

## Acceptance scenarios (the live test that closes this)

1. **Cross-node session (FINDING-9 topology):** Alice homed us1, Bob homed eu1 — session establishes, conversation runs over the relay, both seals succeed. Multi-process, real regions.
2. **Presence integrity:** after Alice's transient eu1 connection closes, Alice is still discoverable at us1 (state 1, `owning_node_id = us1`, online) — catches the visiting-auth blocker directly.
3. **Stale-discovery retry:** kill Bob's home mid-window (after discovery, before the session request) — Bob re-homes, Alice's retry loop lands the session on the survivor.
4. **Known-but-offline and unknown-agent:** discovery returns state 2 / state 3 respectively; the client surfaces distinct errors (no retry storm on state 3).

## Trust layer (M10/11) fit — designed to slot on, not retrofit

Trust scores are deliberately postponed (≈M10/11) and will be designed *around* this topology. They slot on cleanly:
- The connection is brokered on the target's home node, which — via full replication — holds every agent's trust-score hashes. So when Alice submits her request there, **her home node** (or the brokering node) verifies her submitted scores against the replicated hashes and issues a **signed attestation** ("authentic, and complete — including all mandatory signals"), which Alice carries into the request.
- **Mandatory-signal enforcement is preserved** because the signing node has all of Alice's hashes and knows which signals are mandatory, so a complete attestation cannot omit her behavioral track record — the guarantee the [[2026-04-14_1300_connection-request-flow-and-trust-relay|April connection-request design]] protected, kept without any directory forwarding.
- No topology change is required when trust scores land — only the attestation step is added.

## Home failure / re-establishment

Covered by existing code (validated 2026-07-04): when the home stops responding, the roster-aware resolver reconnects the client to a survivor, re-authenticates, and the survivor upserts presence with its own `owning_node_id` — so the agent is re-established and re-findable on the new node. FINDING-9's `target_offline` was **not** a re-establishment failure (the agent did re-establish); it was the cross-node routing gap this design closes.

## Open items, assumptions, dependencies

- **Relay reachability (assumed; validated by art/tests).** The design assumes the target is dialable via the relay once assigned. Not re-litigated here — it's the existing same-node behavior and will be covered by acceptance tests.
- **FINDING-8 (profile cache boot-only) — elevated to a dependency check** (see "Edge cases"): not just the initiator-side signer path — audit every broker-side step that consults a boot-time cache (registration gate, connection gate, delegated-signer setup) for an agent registered after the broker's boot. Read-through-on-miss or absent-node reconcile may be a prerequisite, not a deferred nicety.
- **`k` redundancy knob (home to >1 node).** Baseline k=1; homing to 2–3 nodes for inbound redundancy (survive a home dying without a re-home window) is a future tunable, not needed for the first build. The lookup response is list-valued from day one so this lands without a protocol break.
- **Presence write is best-effort / not retried** (`directory-node.ts:646`) — a DB hiccup during failover is logged and swallowed. Fine at small scale; a robustness follow-up if it ever bites.
- **Visiting-connection rate limits.** A client can open transient connections to any node at will; caps/rate-limiting on visiting auths is post-launch hardening (forgivable), noted so it isn't forgotten.

*(Resolved during design: the transient-connection lifecycle — hold through setup, release after the relay handoff, with the escalation branch releasing early and re-initiating; the seal is client-coordinated over each party's own roster and needs nothing from it. See "FROST ceremony and seal" above. Resolved during review 2026-07-05: visiting auth must not write presence — promoted to build item 3.)*

## Implementation starting points (for a coder)

**New piece 1 — discovery lookup:**
- *Directory-side handler:* add a signaling-frame handler alongside session-request in `packages/directory/src/directory-node.ts` (`#processSessionRequest` at `:2926` is the sibling to model). It returns the 3-state answer from: existence read `SELECT 1 FROM agent_profiles WHERE k_local_pubkey` (`adapters/pg-directory-store.ts:365`) + a presence point-read on `agent_presence` (`agent-presence-repository.ts`; apply the READ-001 heartbeat-freshness rule at `:99`). Add the frame type in `directory-types.ts` / `directory-frames.ts`.
- *Client-side:* call it from the `cello_initiate_session` path in `cello-client/core/daemon/src/daemon.ts:2400` before dialing, when the target isn't on the current node.

**New piece 2 — on-demand second directory connection:**
- The existing per-agent connection is `createSignalingConnect` / `SignalingManager` (`cello-client/core/daemon/src/signaling-connect.ts:134` `connect()`, endpoint resolved at `:135`, auth handshake / `peer_info_announce` at `:236`). A second connection reuses this against a *chosen* endpoint (the target's home) instead of the failover resolver's pick.
- Endpoint resolution: `directory-bootstrap.ts` (`manifestNodesToEndpoints`, `ConsortiumEndpoint`) maps a `node_id` from the manifest to a dialable `/bootstrap` endpoint — use it to turn the discovered `owning_node_id` into something to dial.
- Directory auth of a "visiting" agent **does need a change** (see "Visiting auth — presence integrity"): the auth hook (`directory-node.ts:1647`) sets `#streams` (keep) but also calls `#recordPresence` (`:1649` → `:650`) which reassigns `owning_node_id` (`agent-presence-repository.ts:31–32`) — gate both presence writes behind `!visiting`.

**New piece 3 — visiting flag:**
- Add `visiting?: boolean` to the client's auth response frame (`signaling-connect.ts` handshake / `directory-frames.ts`); the transient connection sets it. Directory-side: thread it to the `#recordPresence` calls on connect (`directory-node.ts:1649`) and disconnect, skipping both when visiting. `#streams` behavior unchanged.

**Reused, do not touch:** `#processSessionRequest` offer/accept + assignment (`directory-node.ts:2926–3337`), the relay pool + circuit dial (`relay-pool-manager.ts`, `cello-client/core/daemon/src/cello-node-transport-dialer.ts`), the FROST ceremony + seal (`cello-client/core/daemon/src/session-ceremony.ts`), presence replication (`V38__presence_replication.sql`, `infra/setup-replication.sh`), failover/re-establish (`daemon.ts:474`, `signaling-connect.ts:135`, `directory-node.ts:657`).

## Related documents

- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — the (fully-replicated-assuming) connection negotiation this topology carries; the attestation approach preserves its mandatory-signal guarantee.
- [[2026-07-04_1600_directory-node-selection-strategy|Directory node-selection strategy]] — how a client picks *which* node to home to / route through (random at launch, P2C later); composes with this topology (the "which home" and "which node to reach into" choice).
- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — FINDING-9 (session/seal after failover) and FINDING-8 (non-home node can't serve a fresh agent until restart), the live symptoms this topology addresses.
- [[2026-06-26_1030_per-agent-directory-connections-and-manifest-over-http|Per-agent directory connections]] — the one-authenticated-stream-per-agent model this extends to on-demand second connections.
