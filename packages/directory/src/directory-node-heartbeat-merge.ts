/**
 * directory_nodes heartbeat merge — Tier-B node-liveness last-writer-wins (DOD-M15-HEARTBEAT-1).
 *
 * A heartbeat is a freshness signal and nothing else, so the freshest value is the correct one and
 * wall-clock LWW is the right rule — the same reasoning `presence-merge` records, and deliberately
 * UNLIKE the kill-switch merge (sequence-based, wall-clock forbidden as an input). A skewed clock
 * here costs at most a wrong liveness read that the owning node's next heartbeat corrects; a skewed
 * clock in the kill switch would un-pause an agent, which nothing corrects.
 *
 * WHAT TRAVELS, AND WHAT DOES NOT. `last_heartbeat_at` is the only REPLICATED column: it is the only
 * one this merge can move and the only one `applyTierB`'s UPDATE writes. `region` stays with the
 * Tier-A spec for `directory_nodes` and `endpoint` travels nowhere at all. That split is load-bearing
 * rather than incidental: Tier-A apply is insert-if-absent, so a peer cannot rewrite a node's
 * identity, while this merge can only ever move a timestamp. If `region` rode this merge instead, a
 * peer could overwrite our record of another node's region by winning an LWW comparison. A node's
 * dialable address must come from the SIGNED manifest — an endpoint learned from a replicated row is
 * an unsigned address to dial.
 *
 * `status` IS CARRIED, AND IS NEVER MERGED (DOD-M15-FORKQUIET-1). It rides the record so the two
 * nodes can COMPARE it — that comparison is the table's only real divergence signal, see
 * `directoryNodeHeartbeatStillDivergent` below — and the merge always keeps the RECEIVING node's
 * value. So the asymmetry is deliberate: `status` is a witness, and a witness the witnessed party
 * could overwrite by winning a timestamp comparison would be worth nothing. Commutativity is a
 * property of the replicated field, which is what convergence rests on; the witness is a local fact
 * that anti-entropy reads and never writes.
 *
 * The replicated half is total, deterministic, commutative and idempotent: higher numeric
 * `last_heartbeat_at` wins wholesale; an exact tie falls to a canonical serialization, so any two
 * records converge to the same timestamp regardless of argument order.
 */

export interface DirectoryNodeHeartbeatRecord {
  /** The node's stable identifier — the natural key. Never `region`, which is a separate fact. */
  node_id: string;
  /**
   * The node's operational status (`active` by default; both production insert paths write it).
   * A WITNESS, never merged and never written by anti-entropy — see the header. Two nodes
   * disagreeing here is a real, unresolvable fork, which is what makes it the divergence signal
   * that survives ignoring the heartbeat.
   */
  status: string;
  /**
   * Epoch-millis as a string (pg BIGINT). `0` means "registered, never heartbeated" — the DB column
   * is nullable and the AE SELECT coalesces NULL to 0, so both encode paths agree on one
   * representation. A freshness comparison rejects 0 exactly as it rejected NULL.
   */
  last_heartbeat_at: string;
}

/** A total-order tiebreak key over the REPLICATED columns (stable, arg-order-independent). */
function canonical(r: DirectoryNodeHeartbeatRecord): string {
  return JSON.stringify([r.node_id, r.last_heartbeat_at]);
}

/**
 * Does this key stay DIVERGENT after the apply — the convergence verdict `RoundResult.unconverged`
 * and the `fork_suspected` alarm are computed from (DOD-M15-FORKQUIET-1)?
 *
 * **It ignores `last_heartbeat_at` entirely, and that is the whole fix.** Every node rewrites its
 * own heartbeat every ~30s, so a dialer always holds a strictly fresher value for its OWN row than
 * any peer does: the version hashes differ, the row is pulled, the LWW merge correctly confirms the
 * local copy already won, and nothing applies. Judged as "pulled but not applied" that is the fork
 * signature — and it fired at ERROR every three minutes, indefinitely, on a completely healthy fleet
 * (measured 2026-09-04). A difference that is only a heartbeat is not a disagreement.
 *
 * What is left is `status`, and it is a stronger signal than the one it replaces rather than a
 * weaker one: the merge never reconciles it, so two nodes disagreeing about whether a node is
 * `active` can never converge on their own and SHOULD alarm until a human intervenes. The table is
 * not muted — a same-key/different-content fork on the identity columns (`node_id`, `region`) is
 * caught by the same table's Tier-A spec, which is unchanged.
 *
 * **Bound on the claim:** this detects ACCIDENTAL divergence between honest nodes. A peer that
 * wanted the alarm silent could simply serve our own status back, exactly as it could withhold a
 * divergent Tier-A row — no fork detector in this design constrains a lying peer, and this one does
 * not either.
 */
export function directoryNodeHeartbeatStillDivergent(
  local: DirectoryNodeHeartbeatRecord,
  incoming: DirectoryNodeHeartbeatRecord,
): boolean {
  return local.status !== incoming.status;
}

/**
 * The columns this merge consults. The Tier-B version summary's `versionColumns` MUST be a superset
 * of this, or two nodes could hold rows the merge treats as different while their version hashes
 * agree — no pull would ever fire and the divergence would be permanent. Asserted in tests.
 */
export const DIRECTORY_NODE_HEARTBEAT_MERGE_COLUMNS: readonly string[] = [
  "node_id", "status", "last_heartbeat_at",
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
  // `status` is pinned to `a` — the RECEIVING node's own value — on every branch below. `applyTierB`
  // calls this as merge(local, incoming) and its UPDATE writes only `last_heartbeat_at`, so the
  // merge output and the row that lands in the database agree by construction. A peer that reports a
  // newer heartbeat therefore moves the timestamp and nothing else.
  if (ta !== tb) {
    const winner = ta > tb ? a : b; // freshest heartbeat wins wholesale
    return { ...winner, status: a.status };
  }
  // Equal (including both-invalid): deterministic, commutative tiebreak over the replicated columns.
  const winner = canonical(a) >= canonical(b) ? a : b;
  return { ...winner, status: a.status };
}
