---
name: directory-node-selection-strategy
type: discussion
date: 2026-07-04
topics: [node-selection, load-balancing, directory, sovereign-nodes, p2c, availability, launch-triage]
status: active
description: How a client chooses WHICH directory node to use among the N sovereign nodes. Decision — random uniform at launch (kill the single-node concentration), Power-of-Two-Choices over a signed load signal after launch.
---

# Directory node selection strategy

## Decision (TL;DR)

- **Launch:** the client picks a directory **at random (uniform)** from the reachable nodes in the signed
  consortium manifest — optionally biased to the lowest-latency / nearest region. Zero node cooperation,
  zero new trust surface. This removes the current single-node concentration.
- **After launch:** upgrade to **Power of Two Choices (P2C)** over a **node-signed load signal** — the
  correct, herd-free way to do "route to the freest node." Build this only when N grows or capacity gets
  uneven; do not build it for 3 evenly-sized nodes.

This follows the launch-triage principle (CLAUDE.md): do the simple thing that delivers the value now;
defer the sophisticated thing until it actually pays for itself.

## The problem (current behavior, 2026-07-04)

Selection today is **primary-first with a single hardcoded default**:

- `resolveDirectoryUrl()` returns `CELLO_DIRECTORY_URL ?? PRODUCTION_DIRECTORY_URL`, and
  `PRODUCTION_DIRECTORY_URL = "http://directory-us1.cello.mygentic.ai"` (`core/daemon/src/directory-bootstrap.ts`).
- `createRosterAwareEndpointResolver` is **primary-first**: while the primary resolves, it returns without
  even probing the roster. It only falls over to a (randomly-shuffled) survivor when the primary is
  **unreachable**.

Net: in steady state (all nodes healthy) **every client lands on us1**. Distribution happens only on
failover, and only then is it random. So one node carries all normal-operation traffic — a concentration
problem, not a redundancy problem (failover itself works — see FINDING-4). For a "federated system with
sovereign nodes" this also undersells the model: everyone talks to one node by default.

## Principle / requirements

Node selection must be:
1. **Client-side, coordinator-free.** No central load balancer — that would violate the sovereign-node
   model. The client chooses from the signed manifest it already fetches.
2. **Distributing.** Steady-state traffic should spread across the N nodes, not pile on one.
3. **Sovereignty- and choice-preserving.** No provider-specific networking, no hardcoded single endpoint.
4. **Minimal trust at launch.** A selection that requires trusting a node's self-reported metrics is a new
   attack surface; avoid it until it's worth it.

## Phase 1 — launch: random uniform (optionally latency-nearest)

Change the **default** path (not just the failover path) to shuffle the manifest's reachable nodes and take
the first that resolves — the same mechanism the failover path already uses, applied up front.

- Uniform random across N is good distribution in expectation and needs **no node cooperation and no
  trust**. For N=3 it is genuinely sufficient.
- Optional refinement: prefer the **lowest measured RTT / nearest region** (the client already probes each
  node's `/bootstrap`, so it can time them), with random tie-breaking. Improves latency AND spreads by
  geography. Reasonable to include at launch; not required.

This is a small change and removes the concentration outright.

## Phase 2 — post-launch: Power of Two Choices over a signed load signal

This is the "directories advertise how free they are, client picks the freest" idea — done the way the
industry actually does it (Envoy, Nginx, HAProxy, Finagle all converged here).

- Each directory advertises a cheap **load metric** (open connections / queue depth / a 0–1 free-capacity
  score), as an **EWMA** (decaying average, not an instantaneous spike).
- The client **samples two nodes at random and picks the lighter one.**

**Why P2C and NOT naive "pick the single least-loaded":** naive least-loaded causes a **thundering herd** —
every client sees the same momentarily-idle node and stampedes it until the next metric refresh, oscillating.
P2C gets ~90% of the balancing benefit with none of the herding, and it is provably good (Mitzenmacher,
"The Power of Two Choices in Randomized Load Balancing"). This is the specific best-practice worth adopting.

### CELLO-specific: where the load signal lives, and trust

- **Not in the signed consortium manifest** — that manifest is static-ish and officer-signed; embedding
  volatile load in it is awkward and would require constant re-signing. Instead, each node advertises its
  **own** load **live**, signed with its **step-6 node key** (already built). A load claim is then
  attributable to the node that made it.
- **Manipulation:** a node could lie about its load to attract or shed traffic. Phase 1 (random) needs no
  trust at all. Phase 2's P2C limits manipulation (sampling, not blindly trusting one claim), and signing
  makes lies attributable/auditable. The security posture reinforces the same order: random first,
  signed-load P2C later.

## Out of scope for launch / triggers for Phase 2

- Do **not** build the load-signaling machinery for 3 evenly-sized nodes — it does not pay off.
- Revisit Phase 2 when: N grows beyond a handful, node capacities become **uneven**, or steady-state load
  on the busiest node becomes a real bottleneck.

## References

- Mitzenmacher, "The Power of Two Choices in Randomized Load Balancing."
- Envoy `weighted least request` (P2C + EWMA), Nginx/HAProxy `random(2)`, Finagle P2CEwma — production
  precedents for coordinator-free client/proxy-side load balancing.

---

## Related Documents

- [[2026-07-04_1730_cross-node-session-topology|Cross-node session topology]] — composes with this strategy: node selection answers "which home / which node to route through," the topology answers how a session reaches an agent homed elsewhere.
- [[2026-06-26_1030_per-agent-directory-connections-and-manifest-over-http|Per-agent directory connections]] — the manifest + per-agent connection model the selection strategy picks endpoints from.
