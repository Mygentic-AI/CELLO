// Cross-node topology — the discovery 3-state resolver (item 1 handler logic, pure).
// Encodes the settled decision table from the design doc §"Discovery":
//   no profile row              → unknown_agent  (state 3)
//   profile + online + fresh    → online + owning node (state 1)
//   profile + online + stale HB → offline, darkNode=true (state 4 collapses to offline on the wire)
//   profile + offline/no row    → offline (state 2)

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

  it("state 1: profile + online + fresh heartbeat ⇒ online + owning node", () => {
    const d = resolveDiscoveryState(true, { hasRow: true, rawOnline: true, owningNodeId: "aws-eu-central-1", nodeFresh: true });
    expect(d.state).toBe("online");
    expect(d.owningNodeIds).toEqual(["aws-eu-central-1"]);
    expect(d.darkNode).toBe(false);
  });

  it("state 4: profile + online row but STALE owning-node heartbeat ⇒ offline, darkNode flagged", () => {
    const d = resolveDiscoveryState(true, { hasRow: true, rawOnline: true, owningNodeId: "aws-eu-central-1", nodeFresh: false });
    expect(d.state).toBe("offline");
    expect(d.owningNodeIds).toEqual([]);
    expect(d.darkNode).toBe(true);
  });

  it("state 2: profile + presence row offline ⇒ offline", () => {
    const d = resolveDiscoveryState(true, { hasRow: true, rawOnline: false, owningNodeId: "aws-eu-central-1", nodeFresh: true });
    expect(d.state).toBe("offline");
    expect(d.darkNode).toBe(false);
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
