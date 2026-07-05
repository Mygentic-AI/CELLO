// Cross-node topology — the discovery 3-state resolver (item 1 handler logic, pure).
// Decision table (2026-07-05 cross-node liveness decision, Option A — trust replicated online):
//   no profile row                    → unknown_agent (state 3)
//   profile + online (fresh HB)       → online + owning node, staleHeartbeat=false (state 1)
//   profile + online + STALE/missing HB → ONLINE + owning node, staleHeartbeat=TRUE (was "dark→offline";
//     now trusted — directory_nodes heartbeat replication is best-effort cross-node, discovery is
//     advisory, and the client's dial→retry is the liveness authority)
//   profile + offline / no presence row → offline (state 2)

import { describe, it, expect } from "vitest";
import { resolveDiscoveryState } from "../discovery-lookup.js";
import type { AgentPresenceLookup } from "@cello-protocol/interfaces";

const OFFLINE_NO_ROW: AgentPresenceLookup = { hasRow: false, rawOnline: false, owningNodeId: null, nodeFresh: false };

describe("resolveDiscoveryState (item 1 — the 3-state decision table)", () => {
  it("state 3: no profile row ⇒ unknown_agent (a bad address, not a transient outage)", () => {
    const d = resolveDiscoveryState(false, { hasRow: true, rawOnline: true, owningNodeId: "aws-eu-central-1", nodeFresh: true });
    expect(d.state).toBe("unknown_agent");
    expect(d.owningNodeIds).toEqual([]);
  });

  it("state 1: profile + online + fresh heartbeat ⇒ online + owning node, not stale", () => {
    const d = resolveDiscoveryState(true, { hasRow: true, rawOnline: true, owningNodeId: "aws-eu-central-1", nodeFresh: true });
    expect(d.state).toBe("online");
    expect(d.owningNodeIds).toEqual(["aws-eu-central-1"]);
    expect(d.staleHeartbeat).toBe(false);
  });

  it("online + STALE/missing owning-node heartbeat ⇒ STILL online + owning node, staleHeartbeat flagged (trusted, not darkened)", () => {
    const d = resolveDiscoveryState(true, { hasRow: true, rawOnline: true, owningNodeId: "aws-eu-central-1", nodeFresh: false });
    expect(d.state).toBe("online"); // Option A: trust the replicated online flag (advisory + dial-retry)
    expect(d.owningNodeIds).toEqual(["aws-eu-central-1"]);
    expect(d.staleHeartbeat).toBe(true); // observability only — does not change the wire answer
  });

  it("state 2: profile + presence row offline ⇒ offline (online flag is false)", () => {
    const d = resolveDiscoveryState(true, { hasRow: true, rawOnline: false, owningNodeId: "aws-eu-central-1", nodeFresh: true });
    expect(d.state).toBe("offline");
    expect(d.staleHeartbeat).toBe(false);
  });

  it("state 2: profile exists but NO presence row (never came online) ⇒ offline", () => {
    const d = resolveDiscoveryState(true, OFFLINE_NO_ROW);
    expect(d.state).toBe("offline");
    expect(d.owningNodeIds).toEqual([]);
  });

  it("online row with a NULL owning node (corrupt) ⇒ offline, never a fabricated node", () => {
    const d = resolveDiscoveryState(true, { hasRow: true, rawOnline: true, owningNodeId: null, nodeFresh: true });
    expect(d.state).toBe("offline");
    expect(d.owningNodeIds).toEqual([]);
  });
});
