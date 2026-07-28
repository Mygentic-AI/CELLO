/**
 * agent_presence merge — Tier-B liveness last-writer-wins (M12 DOD-AE-MUTABLE-1;
 * M12-ANTI-ENTROPY-DESIGN §2).
 *
 * Deliberately UNLIKE the kill-switch merge (§4, sequence-based, wall-clock forbidden): presence
 * is liveness-only, so wall-clock LWW on `updated_at` is acceptable — a skew-induced wrong
 * presence self-heals on the agent's next connect/disconnect edge, whereas a skew-induced un-pause
 * would not. `owning_node_id` is PART OF THE VALUE (ownership migrates when an agent reconnects to
 * a different node), so it travels with the winning row and is never a partition key.
 *
 * Total, deterministic, commutative, idempotent: higher numeric `updated_at` wins wholesale; an
 * exact tie is broken by a canonical serialization of the WHOLE row, so any two records converge
 * to the same one regardless of arg order — even the pathological case of two writes at the same
 * millisecond on the same node with differing `online` (a per-field tiebreak would not be
 * commutative there).
 */

export interface PresenceRecord {
  k_local_pubkey: string;
  online: boolean;
  /** The node the agent is currently homed on — migrates on reconnect; part of the value. */
  owning_node_id: string;
  /** Epoch-millis as a string (pg BIGINT). */
  last_seen_at: string;
  /** Epoch-millis as a string (pg BIGINT). LWW key — compared NUMERICALLY. */
  updated_at: string;
}

/** A total-order tiebreak key over the whole row (stable, arg-order-independent). */
function canonical(r: PresenceRecord): string {
  return JSON.stringify([r.k_local_pubkey, r.online, r.owning_node_id, r.last_seen_at, r.updated_at]);
}

/**
 * The columns this merge consults (updated_at compared; the whole row in the canonical tiebreak).
 * The Tier-B version summary's `versionColumns` MUST be a superset of this. Asserted in tests.
 */
export const PRESENCE_MERGE_COLUMNS: readonly string[] = [
  "k_local_pubkey", "online", "owning_node_id", "last_seen_at", "updated_at",
];

export function mergePresence(a: PresenceRecord, b: PresenceRecord): PresenceRecord {
  // updated_at is epoch-MILLIS (~1.7e12, safe under 2^53 — distinct ms never collapse under
  // Number()). If a nanos/micros migration ever pushes it past 2^53, revisit this compare.
  // A non-finite value (a malformed or hostile peer row — AE input comes from OTHER sovereign
  // nodes) normalizes to -Infinity so it ALWAYS loses to a valid timestamp and two invalids fall
  // to the deterministic canonical tiebreak. Without this, NaN makes `>` always-false → the merge
  // returns the second arg → non-commutative, and a bad row could persist over a valid one.
  const norm = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : -Infinity);
  const ta = norm(a.updated_at);
  const tb = norm(b.updated_at);
  if (ta !== tb) {
    return ta > tb ? a : b; // higher wall-clock wins wholesale
  }
  // Equal (incl. both-invalid): deterministic, commutative tiebreak over the entire row.
  return canonical(a) >= canonical(b) ? a : b;
}
