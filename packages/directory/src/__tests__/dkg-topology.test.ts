/**
 * DOD-ROLE-MANIFEST-1 (directory half) — computeDkgTopology tests.
 *
 * The DKG threshold arithmetic must count VALIDATOR-role nodes only (DOD-INV-THRESHOLD).
 * Replicas hold no shares and take no part in a DKG. A manifest with nodes but zero validators
 * is rejected loudly. Backward compat: a role-less manifest counts every node as a validator, so
 * today's production behavior is byte-for-byte unchanged.
 */

import { describe, it, expect } from "vitest";
import type { ConsortiumNode } from "@cello-protocol/protocol-types";
import { computeDkgTopology } from "../dkg-topology.js";

const node = (nodeId: string, role?: "validator" | "replica"): ConsortiumNode => ({
  nodeId,
  pubkey: "a".repeat(64),
  region: "us-east-1",
  provider: "aws",
  endpoint: "https://x.example.com",
  ...(role ? { role } : {}),
});

describe("DOD-ROLE-MANIFEST-1 dir: computeDkgTopology", () => {
  it("no manifest → single-node 2-of-2 back-compat (unchanged)", () => {
    const t = computeDkgTopology([], undefined);
    expect(t).toMatchObject({
      hasManifest: false,
      replicaOnly: false,
      consortiumNodeCount: 1,
      dkgThreshold: 2,
      dkgParticipants: 1,
      belowQuorum: false,
    });
  });

  it("role-less 3-node manifest (today's production) → N=3, T=2, all counted", () => {
    const t = computeDkgTopology([node("a"), node("b"), node("c")], undefined);
    expect(t.consortiumNodeCount).toBe(3);
    expect(t.dkgThreshold).toBe(2);
    expect(t.dkgParticipants).toBe(3);
    expect(t.quorumNodeIds).toEqual(["a", "b", "c"]);
    expect(t.belowQuorum).toBe(false);
  });

  it("validators + replicas → only validators enter N and the quorum", () => {
    const t = computeDkgTopology(
      [node("v1", "validator"), node("v2", "validator"), node("v3", "validator"), node("r1", "replica"), node("r2", "replica")],
      undefined,
    );
    expect(t.consortiumNodeCount).toBe(3); // 3 validators, replicas excluded
    expect(t.dkgThreshold).toBe(2); // majority(3)
    expect(t.quorumNodeIds).toEqual(["v1", "v2", "v3"]); // no replicas
    expect(t.dkgParticipants).toBe(3);
  });

  it("reachable set intersects VALIDATORS only (a reachable replica is never a participant)", () => {
    const t = computeDkgTopology(
      [node("v1", "validator"), node("v2", "validator"), node("v3", "validator"), node("r1", "replica")],
      ["v1", "v2", "r1"], // r1 reachable but is a replica → excluded
    );
    expect(t.quorumNodeIds).toEqual(["v1", "v2"]);
    expect(t.dkgParticipants).toBe(2);
    expect(t.dkgThreshold).toBe(2); // majority(3 validators)
    expect(t.belowQuorum).toBe(false); // 2 >= 2
  });

  it("below quorum: too few reachable validators for T", () => {
    const t = computeDkgTopology(
      [node("v1", "validator"), node("v2", "validator"), node("v3", "validator")],
      ["v1"], // only 1 reachable, T=2
    );
    expect(t.dkgParticipants).toBe(1);
    expect(t.dkgThreshold).toBe(2);
    expect(t.belowQuorum).toBe(true);
  });

  it("replica-only manifest → replicaOnly=true (caller rejects loudly, no consortium)", () => {
    const t = computeDkgTopology([node("r1", "replica"), node("r2", "replica")], undefined);
    expect(t.replicaOnly).toBe(true);
    expect(t.hasManifest).toBe(true);
    expect(t.consortiumNodeCount).toBe(1); // clamped; irrelevant, caller rejects on replicaOnly
  });

  it("single validator manifest → 2-of-2 (matches single-node semantics)", () => {
    const t = computeDkgTopology([node("only", "validator")], undefined);
    expect(t.consortiumNodeCount).toBe(1);
    expect(t.dkgThreshold).toBe(2);
    expect(t.replicaOnly).toBe(false);
  });
});
