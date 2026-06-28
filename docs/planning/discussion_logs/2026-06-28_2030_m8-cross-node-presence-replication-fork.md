---
name: M8 Cross-Node Presence Replication Fork
type: discussion
date: 2026-06-28
topics: [presence, replication, sovereign-nodes, m8, directory, design-decision]
status: open
description: >
  Cross-node agent_presence read does not work today, and the M8 DoD ("replicated, readable
  from a different node") contradicts the build journal ("deliberately NOT replicated"). This is
  a real architectural fork touching the sovereign-node invariant. Captures the evidence, three
  options, and a recommendation — for Andre to decide. NOT resolved unilaterally (it changes the
  live federation's replication topology).
---

# M8 Cross-Node Presence — Replication Fork (decision needed)

## The problem, in one sentence

The portal shows an agent's online/offline dot, but in the live 3-region federation that dot is
**only correct for agents owned by the node the portal queries** (`directory-us1`); agents owned by
eu-central-1 or ap-northeast-1 always read **offline**, because `agent_presence` is not replicated.

## Evidence (verified in code, not assumed)

- `agent_presence` (migration **V33**, PK `k_local_pubkey`, columns `owning_node_id`, `online`,
  `last_seen_at`, mutable) is **absent** from `infra/setup-replication.sh` `PUBLICATION_TABLES`. So is
  `directory_nodes` (which holds `last_heartbeat_at`). Only append-only-ish tables + `agent_suspensions`
  replicate.
- The read rule (`agent-presence-repository.ts` `listAccountAgentsWithPresence`):
  `COALESCE(ap.online AND dn.last_heartbeat_at > now() - fresh, false)` with
  `LEFT JOIN agent_presence ap … LEFT JOIN directory_nodes dn ON dn.node_id = ap.owning_node_id`.
  On a node that doesn't own the agent, `ap.*` is NULL → the COALESCE yields **offline**.
- The portal's `DIRECTORY_API_URL` is `http://directory-us1.cello.mygentic.ai` (one fixed node). So
  today presence is correct for us-east-1-owned agents only.
- The in-code comment "Read from replicated state; works from any node" is therefore **false today**.
- The existing tests (`presence-001-repository.test.ts`) are single-transaction/single-node and never
  probe a node-B-reads-node-A's-agent scenario.

## The contradiction to resolve

- **DoD DOD-PRES-1** says: "agent_presence: mutable, edge-triggered, **replicated** … **readable from a
  different node**." Journey `02-agents.md` D4 says "a new **replicated** agent_presence table."
- **Build journal** (2026-06-28) says: "agent_presence is **deliberately NOT replicated** (mutable) →
  cross-node presence not enabled."

One of these is wrong. The code matches the journal (not replicated); the DoD/journey intend replication.

## Options

**Option 1 — Replicate `agent_presence` (+ `directory_nodes`) into `cello_pub`.** Matches the DoD/journey
intent. Add both tables to `PUBLICATION_TABLES`; `agent_presence` has a NATURAL PK (`k_local_pubkey`), so
unlike `pickup_queue` there is **no BIGSERIAL-stagger problem** — it replicates like `agent_suspensions`
(which is itself mutable: paused/unpaused/burned, and already replicated). Sovereign write-ownership is
**preserved**: only the owning node writes (the `WHERE owning_node_id` scope is unchanged); other nodes only
READ the replicated copy. `directory_nodes` replication makes the owning-node-fresh check work cross-node.
  - Cost: write amplification (2 writes per session connect/disconnect — bounded, edge-triggered, not
    per-heartbeat; plus `directory_nodes` heartbeat ~every 45s × N nodes — low). Requires deploying a
    `setup-replication.sh` change to the live cluster (a live operation) and confirming UPDATE replication
    (REPLICA IDENTITY defaults to the PK, which exists).
  - This is the **recommended** option: it matches stated intent, has a direct precedent
    (`agent_suspensions` = mutable + replicated + sovereign-write), and the "mutable → don't replicate"
    deferral appears to have conflated presence with `pickup_queue`'s serial-collision issue, which presence
    does not have.

**Option 2 — Keep presence node-local; read cross-node by forwarding to the owning node.** The read endpoint
detects "agent owned by another node" and forwards/queries that node. Preserves strict node-local mutable
state, but adds latency + an availability coupling (node A must be reachable to know if its agent is online)
— which fights the redundancy/"read from any node" goal. More moving parts.

**Option 3 — Node-pinned agents; the portal reads only its node.** Treat agents as bound to their origin
node (no failover), and the portal queries the owning node per agent. This is an architectural pivot away
from "any node serves any agent" and likely contradicts the client-failover redundancy invariant.

## Recommendation

**Option 1.** It is the smallest change that satisfies the DoD/journey intent, it preserves the sovereign
write-ownership invariant (writes stay owner-only; replication is read-only fan-out), it has a working
precedent in `agent_suspensions`, and presence's natural PK avoids the serial-stagger blocker that justified
deferring `pickup_queue`. Concretely: add `agent_presence` + `directory_nodes` to `cello_pub`, confirm
REPLICA IDENTITY (PK) for UPDATE replication, run `setup-replication.sh` on the cluster, then the live
≥2-node test (agent online on node A reads online from node B) closes DOD-PRES-1/2/3 + the presence half of
READ-1/2.

## Why this is teed up, not done

Adding mutable tables to the live federation's logical-replication publication is a topology change to a
running 3-region system and reverses a decision the build journal explicitly recorded. That is Andre's call,
not an autonomous overnight change. The DoD note for DOD-PRES-1 has been corrected to reflect reality (the
cross-node read is unbuilt + decision-blocked, not merely "close-gate-pending"). Pair the chosen option with
the [[2026-06-28_… ]] TRUST-1 H2 migration work as the single deliberate cluster-coupled replication change.

Related: [[project_sovereign_nodes]], [[project_threshold_t_of_n_not_2_of_2]], the M8 DoD (DOD-PRES-1/2/3,
DOD-READ-1/2), and the M8 build journal cross-node entries.
