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

export function mergePresence(a: PresenceRecord, b: PresenceRecord): PresenceRecord {
  const ta = Number(a.updated_at);
  const tb = Number(b.updated_at);
  if (ta !== tb) {
    return ta > tb ? a : b; // higher wall-clock wins wholesale
  }
  // Exact tie: deterministic, commutative tiebreak over the entire row.
  return canonical(a) >= canonical(b) ? a : b;
}
