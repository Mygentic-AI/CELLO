/**
 * directory_nodes heartbeat merge — Tier-B node-liveness last-writer-wins (DOD-M15-HEARTBEAT-1).
 *
 * A heartbeat is a freshness signal and nothing else, so the freshest value is the correct one and
 * wall-clock LWW is the right rule — the same reasoning `presence-merge` records, and deliberately
 * UNLIKE the kill-switch merge (sequence-based, wall-clock forbidden as an input). A skewed clock
 * here costs at most a wrong liveness read that the owning node's next heartbeat corrects; a skewed
 * clock in the kill switch would un-pause an agent, which nothing corrects.
 *
 * WHAT TRAVELS, AND WHAT DOES NOT. The record carries `node_id` and `last_heartbeat_at` only.
 * `region` stays with the Tier-A spec for `directory_nodes`, and `endpoint`/`status` replicate
 * nowhere. That split is load-bearing rather than incidental: Tier-A apply is insert-if-absent, so a
 * peer cannot rewrite a node's identity, while this merge can only ever move a timestamp. If
 * `region` rode this merge instead, a peer could overwrite our record of another node's region by
 * winning an LWW comparison. A node's dialable address must come from the SIGNED manifest — an
 * endpoint learned from a replicated row is an unsigned address to dial.
 *
 * Total, deterministic, commutative, idempotent: higher numeric `last_heartbeat_at` wins wholesale;
 * an exact tie falls to a canonical serialization of the whole row, so any two records converge to
 * the same one regardless of argument order.
 */

export interface DirectoryNodeHeartbeatRecord {
  /** The node's stable identifier — the natural key. Never `region`, which is a separate fact. */
  node_id: string;
  /**
   * Epoch-millis as a string (pg BIGINT). `0` means "registered, never heartbeated" — the DB column
   * is nullable and the AE SELECT coalesces NULL to 0, so both encode paths agree on one
   * representation. A freshness comparison rejects 0 exactly as it rejected NULL.
   */
  last_heartbeat_at: string;
}

/** A total-order tiebreak key over the whole row (stable, arg-order-independent). */
function canonical(r: DirectoryNodeHeartbeatRecord): string {
  return JSON.stringify([r.node_id, r.last_heartbeat_at]);
}

/**
 * The columns this merge consults. The Tier-B version summary's `versionColumns` MUST be a superset
 * of this, or two nodes could hold rows the merge treats as different while their version hashes
 * agree — no pull would ever fire and the divergence would be permanent. Asserted in tests.
 */
export const DIRECTORY_NODE_HEARTBEAT_MERGE_COLUMNS: readonly string[] = [
  "node_id", "last_heartbeat_at",
];

export function mergeDirectoryNodeHeartbeat(
  a: DirectoryNodeHeartbeatRecord,
  b: DirectoryNodeHeartbeatRecord,
): DirectoryNodeHeartbeatRecord {
  // Epoch-MILLIS (~1.7e12, safely under 2^53 — distinct milliseconds never collapse under Number()).
  // A non-finite value normalizes to -Infinity so it ALWAYS loses to a real timestamp: anti-entropy
  // input arrives from OTHER sovereign nodes, and authentication is not honesty. Without this, NaN
  // makes `>` always-false, the merge returns its second argument, and it stops being commutative —
  // a malformed row could then displace a valid one depending only on argument order.
  const norm = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : -Infinity);
  const ta = norm(a.last_heartbeat_at);
  const tb = norm(b.last_heartbeat_at);
  if (ta !== tb) {
    return ta > tb ? a : b; // freshest heartbeat wins wholesale
  }
  // Equal (including both-invalid): deterministic, commutative tiebreak over the entire row.
  return canonical(a) >= canonical(b) ? a : b;
}
