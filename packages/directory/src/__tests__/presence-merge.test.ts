/**
 * DOD-AE-MUTABLE-1 — agent_presence merge (Tier-B liveness LWW).
 *
 * Unlike the kill switch (§4, seq-based, wall-clock forbidden), agent_presence is liveness-only,
 * so last-writer-wins on `updated_at` is acceptable (M12-ANTI-ENTROPY-DESIGN §2): a skew-induced
 * wrong presence self-heals on the next connect/disconnect edge. `owning_node_id` is PART OF THE
 * VALUE — ownership legitimately migrates when an agent reconnects to a different node — so it
 * travels with the winning row, never a partition key. Deterministic + commutative.
 */

import { describe, it, expect } from "vitest";
import { mergePresence, type PresenceRecord } from "../presence-merge.js";

const rec = (o: Partial<PresenceRecord>): PresenceRecord => ({
  k_local_pubkey: "aa".repeat(32),
  online: true,
  owning_node_id: "gcp-usc1",
  last_seen_at: "1000",
  updated_at: "1000",
  ...o,
});

describe("DOD-AE-MUTABLE-1: mergePresence (LWW)", () => {
  it("higher updated_at wins, carrying all fields (incl. owning_node_id)", () => {
    const older = rec({ online: true, owning_node_id: "gcp-usc1", updated_at: "1000" });
    const newer = rec({ online: false, owning_node_id: "aws-use1", updated_at: "2000" });
    const m = mergePresence(older, newer);
    expect(m.updated_at).toBe("2000");
    expect(m.online).toBe(false);
    expect(m.owning_node_id).toBe("aws-use1"); // ownership migrated with the newer write
  });

  it("is commutative — arg order does not change the result", () => {
    const a = rec({ online: true, owning_node_id: "n1", updated_at: "5000" });
    const b = rec({ online: false, owning_node_id: "n2", updated_at: "3000" });
    expect(mergePresence(a, b)).toEqual(mergePresence(b, a));
  });

  it("numeric-string updated_at compares NUMERICALLY, not lexicographically (100 < 9)", () => {
    // "9" > "100" lexicographically but 9 < 100 numerically — must use numeric compare.
    const nine = rec({ owning_node_id: "n-9", updated_at: "9", online: true });
    const hundred = rec({ owning_node_id: "n-100", updated_at: "100", online: false });
    expect(mergePresence(nine, hundred).updated_at).toBe("100");
    expect(mergePresence(nine, hundred).owning_node_id).toBe("n-100");
  });

  it("equal updated_at → deterministic, commutative tiebreak (no perpetual re-exchange)", () => {
    const a = rec({ owning_node_id: "n-a", online: true, updated_at: "7" });
    const b = rec({ owning_node_id: "n-b", online: false, updated_at: "7" });
    const ab = mergePresence(a, b);
    const ba = mergePresence(b, a);
    expect(ab).toEqual(ba);
    expect(["n-a", "n-b"]).toContain(ab.owning_node_id); // one row wins wholesale
  });

  it("is idempotent", () => {
    const a = rec({ online: false, owning_node_id: "n1", updated_at: "42", last_seen_at: "40" });
    expect(mergePresence(a, a)).toEqual(a);
  });

  it("order-independent across three writes (converges to the max updated_at)", () => {
    const w1 = rec({ updated_at: "1", online: true, owning_node_id: "n1" });
    const w2 = rec({ updated_at: "2", online: false, owning_node_id: "n2" });
    const w3 = rec({ updated_at: "3", online: true, owning_node_id: "n3" });
    const o1 = mergePresence(mergePresence(w1, w2), w3);
    const o2 = mergePresence(w3, mergePresence(w1, w2));
    const o3 = mergePresence(mergePresence(w3, w1), w2);
    expect(o1).toEqual(o2);
    expect(o1).toEqual(o3);
    expect(o1.updated_at).toBe("3");
    expect(o1.owning_node_id).toBe("n3");
  });
});
