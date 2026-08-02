/**
 * Anti-entropy round planner (M12 DOD-AE-APPEND-1 / DOD-AE-MUTABLE-1; M12-ANTI-ENTROPY-DESIGN §3).
 *
 * Composes the pure reconciliation primitives into one round's pull decisions across every synced
 * table:
 *  - **Tier A (append-only):** pull the record hashes the peer holds that the local node lacks
 *    (`missingLocally`). A table whose advertised table digest matches the local one is skipped —
 *    converged in a single comparison, no per-bucket drill-down.
 *  - **Tier B (mutable):** pull the keys whose version hash differs or that the peer holds and the
 *    local node lacks (`versionKeysToPull`). Same digest-match skip.
 *
 * Pure and transport-agnostic: the `/cello/anti-entropy/1.0.0` handler feeds deserialized peer
 * state in and acts on the returned plan (fetch the listed records/keys, then apply — Tier-A
 * insert-if-absent, Tier-B merge). The bucket-vector exchange the design describes is a
 * wire-efficiency detail beneath this decision; the SET the local node must pull is what this
 * computes.
 */

import { createHash } from "node:crypto";
import { computeTableDigest, missingLocally } from "./set-reconciliation.js";
import { versionKeysToPull } from "./version-reconcile.js";

/** Local per-table state: Tier-A record-hash lists, Tier-B key→versionHash maps. */
export interface LocalRoundState {
  tierA: ReadonlyMap<string, readonly string[]>;
  tierB: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /**
   * Tables whose LOCAL read threw this round (M12-P9). They are excluded from the plan entirely.
   *
   * This exists because "absent from `tierA`" and "locally unreadable" must not mean the same
   * thing. The `?? []` below deliberately reads an absent table as the empty set — correct for a
   * table this node genuinely holds no rows in, and catastrophic for one whose read failed: the
   * empty digest differs from the peer's, so the planner would ask for the WHOLE table it just
   * proved it cannot read. Optional because a caller that had no read failure has nothing to
   * declare; `localState` is the only producer, and it always sets them.
   */
  unreadableA?: ReadonlySet<string>;
  unreadableB?: ReadonlySet<string>;
}

/**
 * What a peer advertises per table: a table DIGEST, plus a LAZY fetcher for the detail.
 *
 * The laziness is the AC, not an optimization: "divergence detection is O(compare)" means a
 * CONVERGED table must cost one digest — so the detail fetcher is only invoked for tables whose
 * digests differ. An eager `recordHashes: string[]` here would force the full list across the wire
 * before `planRound` ever got the chance to skip, making detection O(table) no matter what.
 */
export interface PeerRoundState {
  tierA: ReadonlyMap<string, { digest: string; recordHashes: () => Promise<readonly string[]> }>;
  tierB: ReadonlyMap<string, { digest: string; versions: () => Promise<ReadonlyMap<string, string>> }>;
}

export interface RoundPlan {
  /** table → record hashes to pull (Tier A). */
  tierA: Map<string, string[]>;
  /** table → keys to pull (Tier B). */
  tierB: Map<string, string[]>;
}

/**
 * Canonical Tier-B table digest over a key→versionHash map: SHA-256 of the entries sorted by key.
 * Sorting makes it order-independent so two nodes with the same map agree. Kept here (not in
 * version-reconcile) because it is a round-level, wire-facing summary.
 */
export function tierBTableDigest(versions: ReadonlyMap<string, string>): string {
  const sorted = [...versions.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}

/** Plan one anti-entropy round: what THIS node must pull from the peer, per table. */
export async function planRound(local: LocalRoundState, peer: PeerRoundState): Promise<RoundPlan> {
  const plan: RoundPlan = { tierA: new Map(), tierB: new Map() };

  for (const [table, adv] of peer.tierA) {
    // Excluded BEFORE the `?? []` below, which would otherwise turn an unreadable table into a
    // full-table pull. See LocalRoundState.unreadableA.
    if (local.unreadableA?.has(table)) continue;
    const localHashes = local.tierA.get(table) ?? [];
    // Digest match → converged, skip WITHOUT fetching the detail. A table the local node doesn't
    // track has a local digest over the empty set, which won't match a non-empty peer → falls
    // through to pull.
    if (adv.digest === computeTableDigest(localHashes)) continue;
    const pull = missingLocally(localHashes, await adv.recordHashes());
    if (pull.length > 0) plan.tierA.set(table, pull);
  }

  for (const [table, adv] of peer.tierB) {
    if (local.unreadableB?.has(table)) continue;
    const localVersions = local.tierB.get(table) ?? new Map<string, string>();
    if (adv.digest === tierBTableDigest(localVersions)) continue;
    const pull = versionKeysToPull(localVersions, await adv.versions());
    if (pull.length > 0) plan.tierB.set(table, pull);
  }

  return plan;
}
