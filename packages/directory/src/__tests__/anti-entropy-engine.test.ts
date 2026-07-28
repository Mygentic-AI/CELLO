/**
 * DOD-AE-APPEND-1 / DOD-AE-MUTABLE-1 — two-node convergence (logic-level).
 *
 * The proof the reviewers deferred to "the e2e unit": drive two nodes with divergent state through
 * anti-entropy rounds and assert they converge, then that a further round is a no-op (termination,
 * which rests on merge idempotency). Uses an in-memory AeStoreView wiring the REAL encoders
 * (record-hash / version) and the REAL merges (suspension) — so this exercises the whole logic
 * stack minus libp2p/pg.
 */

import { describe, it, expect } from "vitest";
import { runAntiEntropyRound, type AeStoreView, type TierARecord, type TierBRecord } from "../anti-entropy-engine.js";
import { encodeTierARecord, AGENT_REVOCATIONS_SPEC } from "../ae-table-encoders.js";
import { encodeTierBVersion, SUSPENSION_VERSION_SPEC } from "../ae-mutable-version.js";
import { mergeSuspension, type SuspensionRecord } from "../suspension-merge.js";

type RevRow = { agent_id: string; epoch_id: string | null; reason: string | null; signature: string; revoked_at: string };

/** An in-memory directory store for one node, wiring the real encoders + merges. */
class MemStore implements AeStoreView {
  revocations = new Map<string, RevRow>(); // agent_id → row (Tier A, append-only)
  suspensions = new Map<string, SuspensionRecord>(); // agent_id → record (Tier B, merged)

  tierATables(): string[] { return ["agent_revocations"]; }
  tierBTables(): string[] { return ["agent_suspensions"]; }

  tierARecordHashes(): string[] {
    return [...this.revocations.values()].map((r) => encodeTierARecord(AGENT_REVOCATIONS_SPEC, r).hash);
  }
  tierBVersions(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, s] of this.suspensions) {
      m.set(k, encodeTierBVersion(SUSPENSION_VERSION_SPEC, this.#versionRow(s)).versionHash);
    }
    return m;
  }
  getTierARecords(_t: string, hashes: readonly string[]): TierARecord[] {
    const want = new Set(hashes);
    return [...this.revocations.values()]
      .map((r) => ({ hash: encodeTierARecord(AGENT_REVOCATIONS_SPEC, r).hash, body: r }))
      .filter((rec) => want.has(rec.hash));
  }
  getTierBRecords(_t: string, keys: readonly string[]): TierBRecord[] {
    return keys.filter((k) => this.suspensions.has(k)).map((k) => ({ key: k, body: this.suspensions.get(k)! }));
  }
  applyTierA(_t: string, records: readonly TierARecord[]): void {
    for (const rec of records) {
      const r = rec.body as RevRow;
      if (!this.revocations.has(r.agent_id)) this.revocations.set(r.agent_id, r); // insert-if-absent
    }
  }
  applyTierB(_t: string, records: readonly TierBRecord[]): void {
    for (const rec of records) {
      const incoming = rec.body as SuspensionRecord;
      const existing = this.suspensions.get(incoming.agent_id);
      this.suspensions.set(incoming.agent_id, existing ? mergeSuspension(existing, incoming) : incoming);
    }
  }

  // suspension_seq is BIGINT-as-string for the version hash (recordHash forbids raw number).
  #versionRow(s: SuspensionRecord): Record<string, string | boolean | null> {
    return {
      agent_id: s.agent_id, paused: s.paused, burned: s.burned, reason: s.reason,
      authorized_by_account: s.authorized_by_account, suspension_seq: String(s.suspension_seq), origin_node: s.origin_node,
    };
  }
}

const rev = (id: string): RevRow => ({ agent_id: id, epoch_id: "e1", reason: "compromise", signature: "ab".repeat(64), revoked_at: "1785200000000" });
const susp = (agent_id: string, seq: number, paused: boolean, extra?: Partial<SuspensionRecord>): SuspensionRecord => ({
  agent_id, paused, burned: false, reason: null, authorized_by_account: null, suspension_seq: seq, origin_node: "n", ...extra,
});

describe("DOD-AE-APPEND-1/MUTABLE-1: two-node convergence", () => {
  it("converges divergent state in both tiers, then terminates (2nd round is a no-op)", () => {
    const A = new MemStore();
    const B = new MemStore();
    // Tier-A: each node has a revocation the other lacks.
    A.revocations.set("agX", rev("agX"));
    B.revocations.set("agY", rev("agY"));
    // Tier-B: same agent suspended on A (seq2), cleared on B (seq3 — newer wins).
    A.suspensions.set("agZ", susp("agZ", 2, true, { reason: "pause" }));
    B.suspensions.set("agZ", susp("agZ", 3, false, { reason: "clear" }));

    // One round each direction.
    runAntiEntropyRound(A, B);
    runAntiEntropyRound(B, A);

    // Tier-A converged to the union:
    expect(new Set(A.revocations.keys())).toEqual(new Set(["agX", "agY"]));
    expect(new Set(B.revocations.keys())).toEqual(new Set(["agX", "agY"]));
    // Tier-B converged to the higher-seq (cleared) suspension on both:
    for (const s of [A.suspensions.get("agZ")!, B.suspensions.get("agZ")!]) {
      expect(s.suspension_seq).toBe(3);
      expect(s.paused).toBe(false);
    }

    // Termination: a further round in either direction applies nothing.
    expect(runAntiEntropyRound(A, B)).toEqual({ tierAApplied: 0, tierBApplied: 0 });
    expect(runAntiEntropyRound(B, A)).toEqual({ tierAApplied: 0, tierBApplied: 0 });
  });

  it("burn propagates and is monotonic across a round (kill switch converges irreversibly)", () => {
    const A = new MemStore();
    const B = new MemStore();
    A.suspensions.set("agZ", susp("agZ", 5, true, { burned: true })); // burned on A
    B.suspensions.set("agZ", susp("agZ", 9, false)); // higher-seq un-pause on B, not burned

    runAntiEntropyRound(A, B);
    runAntiEntropyRound(B, A);

    for (const s of [A.suspensions.get("agZ")!, B.suspensions.get("agZ")!]) {
      expect(s.burned).toBe(true); // burn survived the higher-seq un-pause on BOTH nodes
      expect(s.paused).toBe(false); // higher seq's paused won
      expect(s.suspension_seq).toBe(9);
    }
    // Terminal: the equal-seq idempotent merge converged — a further round applies nothing.
    expect(runAntiEntropyRound(A, B)).toEqual({ tierAApplied: 0, tierBApplied: 0 });
    expect(runAntiEntropyRound(B, A)).toEqual({ tierAApplied: 0, tierBApplied: 0 });
  });

  it("an already-converged pair does nothing (idempotent)", () => {
    const A = new MemStore();
    const B = new MemStore();
    A.revocations.set("agX", rev("agX"));
    B.revocations.set("agX", rev("agX"));
    expect(runAntiEntropyRound(A, B)).toEqual({ tierAApplied: 0, tierBApplied: 0 });
  });
});
