/**
 * Cross-node discovery — the 3-state decision (build item 1).
 *
 * Pure, database-free logic that turns "does a profile row exist?" + a presence point-read into the
 * settled 3-state answer the daemon acts on. Kept out of the big directory-node stream handler so the
 * decision table is unit-testable in isolation (see cross-node-discovery-state.test.ts).
 *
 * Decision table (docs/planning/discussion_logs/2026-07-04_1730_cross-node-session-topology.md):
 *   no profile row                       → unknown_agent  (a bad address, not a transient outage)
 *   profile + online + fresh heartbeat   → online + owning node (open a second connection there)
 *   profile + online + STALE heartbeat   → offline, darkNode flagged (state 4 collapses to offline
 *                                          on the wire; the distinction is server-side logging only)
 *   profile + offline / no presence row  → offline (known but not reachable now)
 */
import type { AgentPresenceLookup, DirectoryStore } from "@cello-protocol/interfaces";
import type { DiscoveryLookupState } from "./directory-types.js";

export type { AgentPresenceLookup };

export interface DiscoveryDecision {
  state: DiscoveryLookupState;
  /** Non-empty only when state = "online" (length 1 until the k>1 homing knob lands). */
  owningNodeIds: string[];
  /** True when the presence row says online but the owning node's heartbeat is stale — logged
   *  server-side as reason "owning_node_dark"; the wire answer is identical to a clean offline. */
  darkNode: boolean;
}

export function resolveDiscoveryState(
  profileExists: boolean,
  presence: AgentPresenceLookup,
): DiscoveryDecision {
  if (!profileExists) {
    return { state: "unknown_agent", owningNodeIds: [], darkNode: false };
  }
  if (presence.hasRow && presence.rawOnline && presence.nodeFresh && presence.owningNodeId) {
    return { state: "online", owningNodeIds: [presence.owningNodeId], darkNode: false };
  }
  // rawOnline with a stale owning-node heartbeat is a "dark node": the home died and the agent has
  // not re-homed yet. Not a clean offline — but the client's action is identical, so it goes on the
  // wire as offline and the distinction survives only in the server log.
  const darkNode = presence.hasRow && presence.rawOnline && !presence.nodeFresh;
  return { state: "offline", owningNodeIds: [], darkNode };
}

/** The store surface the discovery handler needs — a narrowing of DirectoryStore for testability. */
export type DiscoveryStore = Pick<DirectoryStore, "getProfileWithReadThrough" | "getAgentPresenceForDiscovery">;
