/**
 * DOD-AE-APPEND-1 / AE-MUTABLE-1 — round planner.
 *
 * Composes the reconciliation primitives into one round's pull decisions across all synced tables
 * (M12-ANTI-ENTROPY-DESIGN §3). For each Tier-A (append-only) table the plan pulls the record
 * hashes the peer has that the local node lacks (set-reconciliation); for each Tier-B (mutable)
 * table it pulls the keys whose version differs or the peer holds and the local node lacks
 * (version-reconcile). Tables whose advertised digest matches are skipped entirely. Pure — the
 * channel handler feeds it deserialized peer state and acts on the returned plan.
 */

import { describe, it, expect } from "vitest";
import { planRound, tierBTableDigest, type LocalRoundState, type PeerRoundState } from "../ae-round.js";
import { computeTableDigest } from "../set-reconciliation.js";

const h = (b: number, tail = "00"): string => b.toString(16).padStart(2, "0") + tail.repeat(31);

describe("DOD-AE-APPEND-1: planRound", () => {
  it("pulls Tier-A record hashes the local node lacks, per table", () => {
    const local: LocalRoundState = {
      tierA: new Map([["agent_profiles", [h(1), h(2)]]]),
      tierB: new Map(),
    };
    const peer: PeerRoundState = {
      tierA: new Map([["agent_profiles", { digest: "x", recordHashes: [h(1), h(2), h(3)] }]]),
      tierB: new Map(),
    };
    const plan = planRound(local, peer);
    expect(plan.tierA.get("agent_profiles")).toEqual([h(3)]);
  });

  it("a converged Tier-A table (matching digest) produces no pull", () => {
    // NB: the digest-match `continue` is a compute/wire optimization with NO observable difference
    // from the drill-down path (on a match the peer sends recordHashes:[], so missingLocally→[]);
    // no test can isolate the skip itself. This pins the outcome.
    const same = [h(1), h(2)];
    const local: LocalRoundState = { tierA: new Map([["t", same]]), tierB: new Map() };
    const peer: PeerRoundState = {
      tierA: new Map([["t", { digest: computeTableDigest(same), recordHashes: [] /* not sent when digest matches */ }]]),
      tierB: new Map(),
    };
    const plan = planRound(local, peer);
    expect(plan.tierA.has("t")).toBe(false); // matched digest → skipped, no pull
  });

  it("pulls Tier-B keys whose version differs or the peer holds and local lacks", () => {
    const local: LocalRoundState = {
      tierA: new Map(),
      tierB: new Map([["agent_suspensions", new Map([["ag1", "v1"], ["ag2", "v2"]])]]),
    };
    const peer: PeerRoundState = {
      tierA: new Map(),
      tierB: new Map([["agent_suspensions", { digest: "y", versions: new Map([["ag1", "v1"], ["ag2", "vCHANGED"], ["ag3", "v9"]]) }]]),
    };
    const plan = planRound(local, peer);
    expect(new Set(plan.tierB.get("agent_suspensions"))).toEqual(new Set(["ag2", "ag3"]));
  });

  it("differing digest but peer is a SUBSET → nothing to pull, table absent from plan (F2 guard)", () => {
    // Digests differ (local has an extra record), but the peer has nothing the local node lacks.
    // The `pull.length > 0` guard must omit the table (the reverse is the peer's own round).
    const local: LocalRoundState = { tierA: new Map([["t", [h(1), h(2)]]]), tierB: new Map([["u", new Map([["k1", "v1"], ["k2", "v2"]])]]) };
    const peer: PeerRoundState = {
      tierA: new Map([["t", { digest: "differs", recordHashes: [h(1)] }]]),
      tierB: new Map([["u", { digest: "differs", versions: new Map([["k1", "v1"]]) }]]),
    };
    const plan = planRound(local, peer);
    expect(plan.tierA.has("t")).toBe(false);
    expect(plan.tierB.has("u")).toBe(false);
  });

  it("an untracked table advertised EMPTY → digests match → skip (F3)", () => {
    const local: LocalRoundState = { tierA: new Map(), tierB: new Map() };
    const peer: PeerRoundState = {
      tierA: new Map([["t", { digest: computeTableDigest([]), recordHashes: [] }]]),
      tierB: new Map([["u", { digest: tierBTableDigest(new Map()), versions: new Map() }]]),
    };
    const plan = planRound(local, peer);
    expect(plan.tierA.has("t")).toBe(false);
    expect(plan.tierB.has("u")).toBe(false);
  });

  it("skips a Tier-B table whose digest matches", () => {
    const versions = new Map([["ag1", "v1"]]);
    const local: LocalRoundState = { tierA: new Map(), tierB: new Map([["agent_presence", versions]]) };
    // A matching table digest means no drill-down; use a digest the planner recomputes locally.
    const peer: PeerRoundState = {
      tierA: new Map(),
      tierB: new Map([["agent_presence", { digest: tierBTableDigest(versions), versions: new Map() }]]),
    };
    expect(planRound(local, peer).tierB.has("agent_presence")).toBe(false);
  });

  it("a table the peer advertises but the local node doesn't track is pulled wholesale (Tier-A)", () => {
    const local: LocalRoundState = { tierA: new Map(), tierB: new Map() };
    const peer: PeerRoundState = {
      tierA: new Map([["seal_notarizations", { digest: "z", recordHashes: [h(5), h(6)] }]]),
      tierB: new Map(),
    };
    expect(new Set(planRound(local, peer).tierA.get("seal_notarizations"))).toEqual(new Set([h(5), h(6)]));
  });

  it("nothing to pull when everything matches → empty plan", () => {
    const a = [h(1)];
    const v = new Map([["k", "v1"]]);
    const local: LocalRoundState = { tierA: new Map([["t", a]]), tierB: new Map([["u", v]]) };
    const peer: PeerRoundState = {
      tierA: new Map([["t", { digest: computeTableDigest(a), recordHashes: [] }]]),
      tierB: new Map([["u", { digest: tierBTableDigest(v), versions: new Map() }]]),
    };
    const plan = planRound(local, peer);
    expect(plan.tierA.size).toBe(0);
    expect(plan.tierB.size).toBe(0);
  });
});

