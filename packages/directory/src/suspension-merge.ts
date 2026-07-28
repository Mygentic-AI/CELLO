/**
 * agent_suspensions merge — the kill-switch convergence core (M12 DOD-AE-MUTABLE-1;
 * M12-ANTI-ENTROPY-DESIGN §4).
 *
 * This is the single most security-critical merge in the milestone. `agent_suspensions` is the
 * kill switch: a lost `paused=true` lets a compromised agent keep sealing, and a spurious
 * `burned=true` irreversibly destroys FROST share material. Two nodes that accept independent
 * writes for the same agent both mint `suspension_seq = max(local)+1`, so equal-seq/differing-
 * content is reachable — the merge MUST be a total, deterministic, COMMUTATIVE order or the
 * security table re-exchanges forever and never converges.
 *
 * The order (applied in full, every merge):
 *   1. `burned` = OR — monotonic, irreversible. A burn is never un-burned by any merge, and it is
 *      OR'd INDEPENDENTLY of the seq contest (a burn on the losing-seq record still sticks).
 *   2. Higher `suspension_seq` wins outright — it is strictly-newer authenticated state and
 *      carries `paused`/`reason`/`authorized_by_account`/`origin_node`.
 *   3. Equal `suspension_seq`: `paused` resolves suspended-wins (true dominates); the remaining
 *      non-flag fields come wholesale from the record with the greater tiebreak hash (so the row
 *      stays internally consistent, not a field-level mix); the tie seq is kept.
 *   4. Wall-clock (`updated_at`) is NEVER a merge input — clock skew must not be able to un-pause.
 *      It is intentionally absent from this type; callers keep it for display only.
 *
 * Commutativity: OR is commutative; higher-seq-wins picks the same record regardless of arg order;
 * the equal-seq tiebreak is a content hash (same record → same hash → same winner either way).
 */

import { recordHash } from "./record-hash.js";

/** The merge-relevant columns of an agent_suspensions row. `updated_at` is deliberately absent. */
export interface SuspensionRecord {
  agent_id: string;
  paused: boolean;
  /** Monotonic — once true, never false. Drives irreversible FROST share destruction. */
  burned: boolean;
  reason: string | null;
  authorized_by_account: string | null;
  /** Per-write monotonic-per-node sequence: `max(local_seq)+1` at write time. */
  suspension_seq: number;
  /** The node that accepted the write. Advisory provenance; part of the tie-broken value. */
  origin_node: string;
}

/** Deterministic tiebreak hash over the content of a suspension record (excludes the flags the
 *  order resolves separately: burned via OR, paused via suspended-wins). */
function tiebreakHash(r: SuspensionRecord): string {
  return recordHash("agent_suspensions.tiebreak", {
    agent_id: r.agent_id,
    reason: r.reason,
    authorized_by_account: r.authorized_by_account,
    origin_node: r.origin_node,
    suspension_seq: String(r.suspension_seq),
  });
}

/**
 * Merge two suspension records for the same agent into their converged value. Total, deterministic,
 * commutative, idempotent. See the file header for the order.
 */
export function mergeSuspension(a: SuspensionRecord, b: SuspensionRecord): SuspensionRecord {
  // Rule 1: burn is monotonic OR, applied regardless of which record wins the seq contest.
  const burned = a.burned || b.burned;

  // Rule 2: higher seq wins outright.
  if (a.suspension_seq !== b.suspension_seq) {
    const winner = a.suspension_seq > b.suspension_seq ? a : b;
    return { ...winner, burned };
  }

  // Rule 3: equal seq. paused = suspended-wins; other non-flag fields from the greater tiebreak
  // hash (wholesale, so the row is internally consistent); keep the tie seq.
  //
  // COMMUTATIVITY INVARIANT — do not break: the set of fields copied below MUST be exactly the set
  // hashed by tiebreakHash (agent_id, reason, authorized_by_account, origin_node, suspension_seq).
  // That equality is what makes `>=` safe: when the two hashes are equal, every copied field is
  // provably equal on both records, so merge(a,b) and merge(b,a) pick different objects but emit
  // identical bytes. Adding a copied field that isn't hashed (or vice versa) silently breaks
  // convergence on the kill-switch table. paused/burned are excluded here — resolved separately by OR.
  const paused = a.paused || b.paused;
  const winner = tiebreakHash(a) >= tiebreakHash(b) ? a : b;
  return {
    agent_id: winner.agent_id,
    paused,
    burned,
    reason: winner.reason,
    authorized_by_account: winner.authorized_by_account,
    suspension_seq: winner.suspension_seq,
    origin_node: winner.origin_node,
  };
}
