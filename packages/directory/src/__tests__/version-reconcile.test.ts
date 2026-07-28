/**
 * DOD-AE-MUTABLE-1 — Tier-B version-map reconciliation.
 *
 * The mutable-table counterpart to set-reconciliation's `missingLocally` (M12-ANTI-ENTROPY-DESIGN
 * §3 step 4). For Tier-A (append-only), a key the local node lacks is the only thing to pull. For
 * Tier-B, both nodes may hold the same KEY with a different version hash (a mutation), so the local
 * node must pull a key when: the peer has a key it lacks, OR the peer's version hash for a shared
 * key differs from its own. Pulled keys are then resolved by the table's merge. Pure set logic.
 */

import { describe, it, expect } from "vitest";
import { versionKeysToPull } from "../version-reconcile.js";

const m = (o: Record<string, string>): Map<string, string> => new Map(Object.entries(o));

describe("DOD-AE-MUTABLE-1: versionKeysToPull", () => {
  it("pulls keys the peer has that the local node lacks", () => {
    const mine = m({ a: "v1" });
    const peer = m({ a: "v1", b: "v9", c: "v9" });
    expect(new Set(versionKeysToPull(mine, peer))).toEqual(new Set(["b", "c"]));
  });

  it("pulls a SHARED key whose version differs (a mutation the peer holds)", () => {
    const mine = m({ a: "v1", b: "v2" });
    const peer = m({ a: "v1", b: "vDIFFERENT" });
    expect(versionKeysToPull(mine, peer)).toEqual(["b"]);
  });

  it("pulls nothing when every shared key agrees and the peer has no extras", () => {
    const mine = m({ a: "v1", b: "v2", c: "v3" });
    const peer = m({ a: "v1", b: "v2" });
    expect(versionKeysToPull(mine, peer)).toEqual([]);
  });

  it("does NOT pull keys the local node has but the peer lacks (peer pulls those from us)", () => {
    const mine = m({ a: "v1", b: "v2" });
    const peer = m({ a: "v1" });
    expect(versionKeysToPull(mine, peer)).toEqual([]); // reconciliation is one-directional per call
  });

  it("combines both: missing keys and changed shared keys together", () => {
    const mine = m({ a: "v1", b: "v2", d: "v4" });
    const peer = m({ a: "vX", b: "v2", c: "v3" }); // a changed, c new, d only-local, b same
    expect(new Set(versionKeysToPull(mine, peer))).toEqual(new Set(["a", "c"]));
  });

  it("empty peer → pull nothing; empty local → pull all peer keys", () => {
    expect(versionKeysToPull(m({ a: "v1" }), m({}))).toEqual([]);
    expect(new Set(versionKeysToPull(m({}), m({ a: "v1", b: "v2" })))).toEqual(new Set(["a", "b"]));
  });
});
