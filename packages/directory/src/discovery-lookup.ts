/**
 * Cross-node discovery — the 3-state decision (build item 1).
 *
 * Pure, database-free logic that turns "does a profile row exist?" + a presence point-read into the
 * settled 3-state answer the daemon acts on. Kept out of the big directory-node stream handler so the
 * decision table is unit-testable in isolation (see cross-node-discovery-state.test.ts).
 *
 * Decision table (2026-07-05 cross-node-liveness decision, Option A — supersedes the original READ-001
 * dark-node collapse; see the cross-node build journal):
 *   no profile row                          → unknown_agent (a bad address, not a transient outage)
 *   profile + online (fresh HB)             → online + owning node (open a second connection there)
 *   profile + online + STALE/missing HB     → ONLINE + owning node, staleHeartbeat flagged (trusted —
 *                                             the freshness check was cross-node-unreliable and
 *                                             discovery is advisory; dial→retry is the liveness authority)
 *   profile + offline / no presence row     → offline (known but not reachable now)
 */
import type { AgentPresenceLookup, DirectoryStore } from "@cello-protocol/interfaces";
import type { DiscoveryLookupState } from "./directory-types.js";

export type { AgentPresenceLookup };

export interface DiscoveryDecision {
  state: DiscoveryLookupState;
  /** Non-empty only when state = "online" (length 1 until the k>1 homing knob lands). */
  owningNodeIds: string[];
  /** True when we returned online for an agent whose owning-node heartbeat is stale/missing. Kept for
   *  server-side observability (a node we're trusting despite a stale heartbeat) — it does NOT change
   *  the wire answer. See the online branch for why the freshness check is not a gate. */
  staleHeartbeat: boolean;
}

export function resolveDiscoveryState(
  profileExists: boolean,
  presence: AgentPresenceLookup,
): DiscoveryDecision {
  if (!profileExists) {
    return { state: "unknown_agent", owningNodeIds: [], staleHeartbeat: false };
  }
  // CROSS-NODE LIVENESS (2026-07-05 decision, Option A): trust the replicated presence.online flag —
  // do NOT darken an online agent when its owning node's heartbeat is stale/missing. The dark-node
  // freshness check only ever fires for a REMOTE owning node (a node's own heartbeat is always fresh),
  // and it depends on directory_nodes replication, which is best-effort cross-node (its BIGSERIAL id
  // collides, so a remote node's heartbeat may never land). Requiring freshness therefore darkened
  // EVERY cross-node lookup. Discovery is ADVISORY by design: the target node's live #streams check is
  // authoritative, the owning_node is manifest-validated before any dial, and a stale "online" just
  // triggers the client's bounded re-discover→retry (which surfaces counterparty_offline if the node
  // is genuinely dead). So online-with-stale-heartbeat is safe to report as online. staleHeartbeat is
  // recorded for observability only.
  if (presence.hasRow && presence.rawOnline && presence.owningNodeId) {
    return { state: "online", owningNodeIds: [presence.owningNodeId], staleHeartbeat: !presence.nodeFresh };
  }
  return { state: "offline", owningNodeIds: [], staleHeartbeat: false };
}

/** The store surface the discovery handler needs — a narrowing of DirectoryStore for testability. */
export type DiscoveryStore = Pick<DirectoryStore, "getProfileWithReadThrough" | "getAgentPresenceForDiscovery">;
