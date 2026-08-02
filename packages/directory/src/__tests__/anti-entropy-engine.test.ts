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
import { computeTableDigest } from "../set-reconciliation.js";
import { tierBTableDigest } from "../ae-round.js";
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
  // Digest-first advertisement: the O(1)-per-table divergence check (design §3 step 1).
  tierATableDigest(): string { return computeTableDigest(this.tierARecordHashes()); }
  tierBTableDigest(): string { return tierBTableDigest(this.tierBVersions()); }
  tierBVersions(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, s] of this.suspensions) {
      m.set(k, encodeTierBVersion(SUSPENSION_VERSION_SPEC, this.#versionRow(s)).versionHash);
    }
    return m;
  }
  serveTierA(_t: string, hashes: readonly string[]): TierARecord[] {
    const want = new Set(hashes);
    return [...this.revocations.values()]
      .map((r) => ({ hash: encodeTierARecord(AGENT_REVOCATIONS_SPEC, r).hash, body: r }))
      .filter((rec) => want.has(rec.hash));
  }
  serveTierB(_t: string, keys: readonly string[]): TierBRecord[] {
    return keys.filter((k) => this.suspensions.has(k)).map((k) => ({ key: k, body: this.suspensions.get(k)! }));
  }
  applyTierA(_t: string, records: readonly TierARecord[]): number {
    let inserted = 0;
    for (const rec of records) {
      const r = rec.body as RevRow;
      if (!this.revocations.has(r.agent_id)) { this.revocations.set(r.agent_id, r); inserted++; } // insert-if-absent
    }
    return inserted;
  }
  applyTierB(_t: string, records: readonly TierBRecord[]): number {
    let changed = 0;
    for (const rec of records) {
      const incoming = rec.body as SuspensionRecord;
      const existing = this.suspensions.get(incoming.agent_id);
      const merged = existing ? mergeSuspension(existing, incoming) : incoming;
      // Changed iff the merge-relevant content moved (mirrors the pg store's version-hash check).
      if (!existing || JSON.stringify(merged) !== JSON.stringify(existing)) changed++;
      this.suspensions.set(incoming.agent_id, merged);
    }
    return changed;
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

/**
 * A terminated round: nothing planned, nothing pulled, nothing applied, nothing failed.
 *
 * `tierAPlanned`/`tierBPlanned` are the load-bearing additions. Asserting only that PULLED is zero
 * cannot distinguish convergence from a peer that advertised differing digests and then served
 * nothing — both produce zeros. Planned-zero says the planner found nothing to ask for, which is what
 * "converged" actually means.
 */
const TERMINATED = {
  tierAPulled: 0, tierBPulled: 0, tierAApplied: 0, tierBApplied: 0,
  tierAPlanned: 0, tierBPlanned: 0, failures: [],
};

describe("DOD-AE-APPEND-1/MUTABLE-1: two-node convergence", () => {
  it("converges divergent state in both tiers, then terminates (2nd round is a no-op)", async () => {
    const A = new MemStore();
    const B = new MemStore();
    // Tier-A: each node has a revocation the other lacks.
    A.revocations.set("agX", rev("agX"));
    B.revocations.set("agY", rev("agY"));
    // Tier-B: same agent suspended on A (seq2), cleared on B (seq3 — newer wins).
    A.suspensions.set("agZ", susp("agZ", 2, true, { reason: "pause" }));
    B.suspensions.set("agZ", susp("agZ", 3, false, { reason: "clear" }));

    // One round each direction.
    await runAntiEntropyRound(A, B);
    await runAntiEntropyRound(B, A);

    // Tier-A converged to the union:
    expect(new Set(A.revocations.keys())).toEqual(new Set(["agX", "agY"]));
    expect(new Set(B.revocations.keys())).toEqual(new Set(["agX", "agY"]));
    // Tier-B converged to the higher-seq (cleared) suspension on both:
    for (const s of [A.suspensions.get("agZ")!, B.suspensions.get("agZ")!]) {
      expect(s.suspension_seq).toBe(3);
      expect(s.paused).toBe(false);
    }

    // Termination: a further round in either direction applies nothing.
    expect(await runAntiEntropyRound(A, B)).toEqual(TERMINATED);
    expect(await runAntiEntropyRound(B, A)).toEqual(TERMINATED);
  });

  it("burn propagates and is monotonic across a round (kill switch converges irreversibly)", async () => {
    const A = new MemStore();
    const B = new MemStore();
    A.suspensions.set("agZ", susp("agZ", 5, true, { burned: true })); // burned on A
    B.suspensions.set("agZ", susp("agZ", 9, false)); // higher-seq un-pause on B, not burned

    await runAntiEntropyRound(A, B);
    await runAntiEntropyRound(B, A);

    for (const s of [A.suspensions.get("agZ")!, B.suspensions.get("agZ")!]) {
      expect(s.burned).toBe(true); // burn survived the higher-seq un-pause on BOTH nodes
      expect(s.paused).toBe(false); // higher seq's paused won
      expect(s.suspension_seq).toBe(9);
    }
    // Terminal: the equal-seq idempotent merge converged — a further round applies nothing.
    expect(await runAntiEntropyRound(A, B)).toEqual(TERMINATED);
    expect(await runAntiEntropyRound(B, A)).toEqual(TERMINATED);
  });

  it("an already-converged pair does nothing (idempotent)", async () => {
    const A = new MemStore();
    const B = new MemStore();
    A.revocations.set("agX", rev("agX"));
    B.revocations.set("agX", rev("agX"));
    expect(await runAntiEntropyRound(A, B)).toEqual(TERMINATED);
  });

  it("a same-key Tier-A fork has the DISTINCT signature pulled>0 && applied===0, every round", async () => {
    // Two nodes independently recorded a revocation for the SAME agent with different content —
    // different record hashes, same natural key. Insert-if-absent can never converge them. The
    // engine must surface this as pulled>0/applied=0 (the fork alarm signature), NOT as {0,0}
    // (which would be indistinguishable from healthy convergence).
    const A = new MemStore();
    const B = new MemStore();
    A.revocations.set("agF", rev("agF"));
    B.revocations.set("agF", { ...rev("agF"), reason: "different-content" });

    for (let round = 0; round < 2; round++) {
      const res = await runAntiEntropyRound(A, B);
      expect(res.tierAPulled).toBeGreaterThan(0); // the fork re-pulls every round…
      expect(res.tierAApplied).toBe(0); // …and never applies — the alarm signature persists
    }
  });
});

// ─── Engine-level defenses (added after the DOD-AE-PRIMITIVES-1 review) ──────────────────────────
//
// MemStore ignores its table argument (`_t`), and both nodes advertise identical single-table
// registries — so the routing defense at the top of the apply loop had NO coverage: reverting it to
// iterate `plan.tierA` left every test green while the property it protects disappeared. These
// stores record what they are ASKED for, which is the only way to see the difference.

/** A store that remembers every table name it was asked to serve or apply. */
class SpyStore extends MemStore {
  readonly served: string[] = [];
  readonly applied: string[] = [];
  override serveTierA(t: string, hashes: readonly string[]): TierARecord[] {
    this.served.push(t);
    return super.serveTierA(t, hashes);
  }
  override applyTierA(t: string, records: readonly TierARecord[]): number {
    this.applied.push(t);
    return super.applyTierA(t, records);
  }
}

/** A peer that also advertises a table this node does not track. */
class ExtraTablePeer extends SpyStore {
  override tierATables(): string[] { return ["agent_revocations", "agent_key_shares"]; }
  override tierATableDigest(t?: string): string {
    // A non-empty, differing digest for the extra table — otherwise planRound skips it as converged
    // and the test proves nothing.
    return t === "agent_key_shares" ? "f".repeat(64) : super.tierATableDigest();
  }
}

describe("engine defenses: peer-chosen table names, containment, and shortfall", () => {
  it("never serves or applies a table the LOCAL registry does not track", async () => {
    // The revert test for the routing defense. Iterating the peer's plan instead of the local
    // registry would put "agent_key_shares" into both lists — and SHARES-LOCAL forbids that name
    // reaching a store method at all.
    const local = new SpyStore();
    const peer = new ExtraTablePeer();
    peer.revocations.set("a1", { agent_id: "a1", epoch_id: "e1", reason: "r", signature: "ab", revoked_at: "1" } as never);

    const unknown: Array<[string, string]> = [];
    const res = await runAntiEntropyRound(local, peer, (tier, table) => unknown.push([tier, table]));

    expect(local.applied).not.toContain("agent_key_shares");
    expect(peer.served).not.toContain("agent_key_shares");
    // Filtered upstream of the planner, and SAID — a silently dropped table during a rolling upgrade
    // is indistinguishable from a converged one.
    expect(unknown).toContainEqual(["A", "agent_key_shares"]);
    // The legitimate table still replicated: the filter must not cost convergence.
    expect(res.tierAApplied).toBe(1);
    expect(local.revocations.has("a1")).toBe(true);
  });

  it("a Tier-A failure does NOT stop Tier-B — the kill switch keeps replicating", async () => {
    // The containment property. Before this, any throw in the Tier-A loop aborted the round before
    // agent_suspensions was touched, so one poisoned record stopped suspensions replicating from
    // that peer every round, forever.
    const local = new SpyStore();
    local.applyTierA = () => { throw new Error("poisoned record"); };
    const peer = new SpyStore();
    peer.revocations.set("a2", { agent_id: "a2", epoch_id: "e2", reason: "r", signature: "cd", revoked_at: "2" } as never);
    peer.suspensions.set("agent-x", { agent_id: "agent-x", paused: true, burned: false, suspension_seq: 4, origin_node: "n1" } as never);

    const res = await runAntiEntropyRound(local, peer);

    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]!.table).toBe("agent_revocations");
    expect(res.failures[0]!.reason).toMatch(/poisoned record/); // the cause, not an exit-point label
    expect(res.tierBApplied, "Tier-B must still have run").toBe(1);
    expect(local.suspensions.get("agent-x")?.paused).toBe(true);
  });

  it("a peer that withholds records reports a SHORTFALL, not convergence", async () => {
    // The fail-open. `pulled` counts what ARRIVED, so a peer advertising differing digests and then
    // serving nothing returned {0,0,0,0} — byte-identical to a converged round.
    const local = new SpyStore();
    const peer = new SpyStore();
    peer.revocations.set("a3", { agent_id: "a3", epoch_id: "e3", reason: "r", signature: "ef", revoked_at: "3" } as never);
    peer.serveTierA = () => []; // advertises it, then serves nothing

    const res = await runAntiEntropyRound(local, peer);

    expect(res.tierAPlanned, "the plan asked for the record").toBe(1);
    expect(res.tierAPulled, "the peer served nothing").toBe(0);
    expect(res.tierAApplied).toBe(0);
    // planned > pulled is the shortfall the sync service alarms on; without tierAPlanned this round
    // is indistinguishable from termination.
    expect(res.tierAPlanned).toBeGreaterThan(res.tierAPulled);
  });
});

/**
 * Two Tier-A tables, advertised by the peer in the OPPOSITE order to the local registry. MemStore has
 * one table per tier, so nothing pinned apply order — and order is the loop's real remaining job now
 * that routing is filtered upstream: design §3.3 requires accounts → profiles → suspensions, because
 * each references the one before it.
 */
class TwoTableStore implements AeStoreView {
  readonly appliedOrder: string[] = [];
  constructor(
    private readonly order: string[],
    private readonly nonEmpty: Set<string> = new Set(),
    /** Tables whose local read throws, exactly as a dropped column did on 2026-08-01. */
    private readonly unreadable: Set<string> = new Set(),
  ) {}
  tierATables(): string[] { return this.order; }
  tierBTables(): string[] { return []; }
  tierARecordHashes(t: string): string[] {
    if (this.unreadable.has(t)) throw new Error(`column "subject" does not exist`);
    return this.nonEmpty.has(t) ? ["a".repeat(64)] : [];
  }
  tierATableDigest(t: string): string { return computeTableDigest(this.tierARecordHashes(t)); }
  tierBTableDigest(): string { return tierBTableDigest(new Map()); }
  tierBVersions(): Map<string, string> { return new Map(); }
  serveTierA(_t: string, hashes: readonly string[]): TierARecord[] {
    return hashes.map((h) => ({ hash: h, body: {} }));
  }
  serveTierB(): TierBRecord[] { return []; }
  applyTierA(t: string, records: readonly TierARecord[]): number {
    this.appliedOrder.push(t);
    return records.length;
  }
  applyTierB(): number { return 0; }
}

describe("apply ORDER follows the LOCAL registry, not the peer's advertisement", () => {
  it("applies accounts before profiles even when the peer advertises the reverse", async () => {
    // FK-dependency ordering (design §3.3). If the loop iterated the peer's plan, a peer could
    // reorder our inserts — and once account_id joins the profiles sync set that is a 23503 mid-round,
    // which under the containment fix now degrades to a skipped table rather than a crash, i.e. it
    // would be quiet.
    const local = new TwoTableStore(["user_accounts", "agent_profiles"]);
    const peer = new TwoTableStore(["agent_profiles", "user_accounts"], new Set(["agent_profiles", "user_accounts"]));

    await runAntiEntropyRound(local, peer);

    expect(local.appliedOrder).toEqual(["user_accounts", "agent_profiles"]);
  });
});

/**
 * M12-P9 (dialer half) — a table THIS node cannot read must not stop it pulling the others.
 *
 * The responder-side fix (ae-channel `buildWireState`) isolates what we ADVERTISE. This covers the
 * half that actually converges: anti-entropy is pull-driven, and `localState` built the local
 * comparison basis with the same unisolated loop, over the same SQL (`tierATableDigest` is
 * literally `computeTableDigest(await tierARecordHashes(table))`). On 2026-08-01 all three nodes
 * ran the same bad spec, so every node was a broken DIALER — isolating only the responder would
 * have left that outage's blast radius exactly as it was.
 *
 * The correct degradation here is NOT the responder's. Omitting a table from `LocalRoundState`
 * would hit `local.tierA.get(table) ?? []` in planRound and read as "we hold zero rows" — planning
 * a full pull of a table we just proved we cannot read. That is the storm the responder fix exists
 * to avoid, arrived at from the other side. The table must leave the PLAN, not default to empty.
 */
describe("M12-P9: a locally unreadable table is contained, not fatal and not a full pull", () => {
  it("the round SURVIVES and every readable table still pulls", async () => {
    const local = new TwoTableStore(["user_accounts", "agent_profiles"], new Set(), new Set(["agent_profiles"]));
    const peer = new TwoTableStore(["user_accounts", "agent_profiles"], new Set(["user_accounts", "agent_profiles"]));

    // Before the fix this REJECTED: the throw escaped localState and took the whole round.
    const result = await runAntiEntropyRound(local, peer);

    expect(local.appliedOrder).toEqual(["user_accounts"]); // the readable one reconciled...
    expect(result.tierAApplied).toBe(1);
  });

  it("the unreadable table is dropped from the PLAN, not read as empty and fully pulled", async () => {
    // The load-bearing assertion. `?? []` in planRound means a table missing from LocalRoundState
    // compares as the empty set, differs from the peer's non-empty digest, and gets pulled WHOLE.
    // Planned-count is what distinguishes "excluded" from "asked for everything".
    const local = new TwoTableStore(["user_accounts", "agent_profiles"], new Set(), new Set(["agent_profiles"]));
    const peer = new TwoTableStore(["user_accounts", "agent_profiles"], new Set(["user_accounts", "agent_profiles"]));

    const result = await runAntiEntropyRound(local, peer);

    expect(result.tierAPlanned).toBe(1); // ONLY user_accounts — not 2.
    expect(local.appliedOrder).not.toContain("agent_profiles");
  });

  it("REPORTS the containment, naming the table and the underlying cause", async () => {
    // The property separating containment from a silent fallback: a table that has stopped
    // reconciling must be nameable from a log line, and the pg text is what points at the schema.
    const local = new TwoTableStore(["user_accounts", "agent_profiles"], new Set(), new Set(["agent_profiles"]));
    const peer = new TwoTableStore(["user_accounts", "agent_profiles"], new Set(["user_accounts", "agent_profiles"]));

    const result = await runAntiEntropyRound(local, peer);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.tier).toBe("A");
    expect(result.failures[0]!.table).toBe("agent_profiles");
    expect(result.failures[0]!.reason).toContain("does not exist");
  });

  it("a fully readable store reports no failures — containment is not chatty", async () => {
    const local = new TwoTableStore(["user_accounts", "agent_profiles"]);
    const peer = new TwoTableStore(["user_accounts", "agent_profiles"], new Set(["user_accounts"]));

    expect((await runAntiEntropyRound(local, peer)).failures).toEqual([]);
  });
});
