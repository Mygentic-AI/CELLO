/**
 * DOD-AE-MUTABLE-1 — agent_suspensions merge (the kill-switch convergence core).
 *
 * The security-critical merge (M12-ANTI-ENTROPY-DESIGN §4). A total, deterministic, COMMUTATIVE
 * order so two nodes that accept independent writes for the same agent converge to identical
 * bytes — the security table must never diverge:
 *   1. burned = OR (monotonic, irreversible — a burn can never be un-burned).
 *   2. Higher suspension_seq wins outright (carries paused/reason/authorized_by_account).
 *   3. Equal seq: paused resolves suspended-wins; remaining non-flag fields from the greater
 *      record-hash; the tie seq is kept.
 *   4. Wall-clock updated_at is NEVER a merge input (clock skew cannot un-pause).
 */

import { describe, it, expect } from "vitest";
import { mergeSuspension, type SuspensionRecord } from "../suspension-merge.js";

const rec = (o: Partial<SuspensionRecord>): SuspensionRecord => ({
  agent_id: "agent-1",
  paused: false,
  burned: false,
  reason: null,
  authorized_by_account: null,
  suspension_seq: 0,
  origin_node: "gcp-usc1",
  ...o,
});

describe("DOD-AE-MUTABLE-1: mergeSuspension", () => {
  it("burned is monotonic OR — a burn survives a higher-seq un-pause (irreversible)", () => {
    const burned = rec({ burned: true, paused: true, suspension_seq: 1 });
    const unpause = rec({ burned: false, paused: false, suspension_seq: 9 }); // newer, tries to clear
    const m = mergeSuspension(burned, unpause);
    expect(m.burned).toBe(true); // burn can never be un-burned
    expect(m.paused).toBe(false); // but the higher-seq paused value does win
    expect(m.suspension_seq).toBe(9);
  });

  it("higher suspension_seq wins outright (newer authenticated state)", () => {
    const older = rec({ paused: true, reason: "old", suspension_seq: 2, authorized_by_account: "acct-a" });
    const newer = rec({ paused: false, reason: "cleared", suspension_seq: 5, authorized_by_account: "acct-b" });
    const m = mergeSuspension(older, newer);
    expect(m.suspension_seq).toBe(5);
    expect(m.paused).toBe(false);
    expect(m.reason).toBe("cleared");
    expect(m.authorized_by_account).toBe("acct-b");
  });

  it("equal seq, conflicting paused → suspended WINS (the DoD tie rule)", () => {
    const a = rec({ paused: true, suspension_seq: 3 });
    const b = rec({ paused: false, suspension_seq: 3 });
    expect(mergeSuspension(a, b).paused).toBe(true);
    expect(mergeSuspension(b, a).paused).toBe(true); // commutative
  });

  it("equal seq, differing non-flag fields → deterministic + commutative (record-hash tiebreak)", () => {
    const a = rec({ paused: true, suspension_seq: 3, reason: "reason-A", authorized_by_account: "acct-A" });
    const b = rec({ paused: true, suspension_seq: 3, reason: "reason-B", authorized_by_account: "acct-B" });
    const ab = mergeSuspension(a, b);
    const ba = mergeSuspension(b, a);
    expect(ab).toEqual(ba); // COMMUTATIVE — no perpetual re-exchange on the security table
    // and it picks one side wholesale (not a mix), so the row is internally consistent:
    expect([["reason-A", "acct-A"], ["reason-B", "acct-B"]]).toContainEqual([ab.reason, ab.authorized_by_account]);
  });

  it("is idempotent — merging a record with itself returns the same record", () => {
    const a = rec({ paused: true, burned: true, suspension_seq: 4, reason: "x" });
    expect(mergeSuspension(a, a)).toEqual(a);
  });

  it("a stale LOWER-seq clear cannot un-pause (wall-clock is excluded at the type level)", () => {
    // updated_at is absent from SuspensionRecord, so wall-clock can't be a merge input by
    // construction — the real guarantee. This pins the seq-ordering half: a seq-older clear loses.
    const paused = rec({ paused: true, suspension_seq: 5 });
    const staleClear = rec({ paused: false, suspension_seq: 4 });
    expect(mergeSuspension(paused, staleClear).paused).toBe(true);
    expect(mergeSuspension(staleClear, paused).paused).toBe(true);
  });

  it("paused ORs over ONLY the records at the max seq, in any fold order (LOW-3)", () => {
    // Two records tied at the global max seq (5) with conflicting paused, plus a lower-seq clear.
    // Correct result: paused=true (suspended-wins among the max-seq pair); a naive
    // 'paused=winner.paused' would fail depending on fold order.
    const pMax = rec({ paused: true, suspension_seq: 5, reason: "pause", origin_node: "n-a" });
    const cMax = rec({ paused: false, suspension_seq: 5, reason: "clear", origin_node: "n-b" });
    const cLow = rec({ paused: false, suspension_seq: 3 });
    const folds = [
      mergeSuspension(mergeSuspension(pMax, cMax), cLow),
      mergeSuspension(mergeSuspension(cMax, cLow), pMax),
      mergeSuspension(mergeSuspension(cLow, pMax), cMax),
      mergeSuspension(pMax, mergeSuspension(cMax, cLow)),
      mergeSuspension(cLow, mergeSuspension(pMax, cMax)),
    ];
    for (const f of folds) {
      expect(f).toEqual(folds[0]); // one fixpoint regardless of order
      expect(f.paused).toBe(true); // suspended-wins among the max-seq records
      expect(f.suspension_seq).toBe(5);
    }
  });

  it("converges under any arrival order of three writes (order-independent)", () => {
    const p = rec({ paused: true, suspension_seq: 1, reason: "pause" });
    const burn = rec({ paused: true, burned: true, suspension_seq: 2 });
    const clear = rec({ paused: false, suspension_seq: 3, reason: "clear" });
    const orders = [
      mergeSuspension(mergeSuspension(p, burn), clear),
      mergeSuspension(mergeSuspension(clear, p), burn),
      mergeSuspension(mergeSuspension(burn, clear), p),
      mergeSuspension(p, mergeSuspension(burn, clear)),
    ];
    for (const o of orders) expect(o).toEqual(orders[0]); // associative+commutative → one fixpoint
    // Final state: cleared (seq 3 highest) but burned (monotonic).
    expect(orders[0].paused).toBe(false);
    expect(orders[0].burned).toBe(true);
    expect(orders[0].suspension_seq).toBe(3);
  });

  it("a pause with the highest seq bites (compromised agent cannot be un-paused by stale state)", () => {
    const pauseNew = rec({ paused: true, suspension_seq: 10, reason: "compromise" });
    const clearOld = rec({ paused: false, suspension_seq: 7 });
    expect(mergeSuspension(clearOld, pauseNew).paused).toBe(true);
  });
});
