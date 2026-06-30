/**
 * TRUST-001 — pickup queue drain + ACK (the daemon-delivery half of the trust-signal pipe).
 *
 * Mirrors the existing notification path (pg-notification-queue: enqueue → drain → acknowledge): on
 * signaling reconnect the directory drains an agent's unacked sealed signals, delivers each over the
 * stream, and on the daemon's ACK DELETES the row — so after ACK the queue holds NO ciphertext for
 * that signal (DOD-TRUST-1/AC-002). Each delivered item carries the AUTHORITATIVE identity-tree hash
 * (joined by agent_id + signal_kind), so the daemon can verify openSealed(ciphertext) recomputes to
 * it (AC-001). The hash stays single-sourced in identity_tree_entries — never copied onto the queue.
 */

import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

export interface PickupItem {
  /** pickup_queue.id — the ACK handle (BIGSERIAL, read back as a string by node-postgres). */
  id: string;
  signalKind: string | null;
  /** The opaque sealed ciphertext — only the agent's k_local can open it. */
  ciphertext: Buffer;
  /** The authoritative directory hash for this signal (from the identity tree); null if no anchor. */
  signalHash: string | null;
}

/** Drain an agent's unacked sealed signals, oldest first, each with its authoritative identity-tree hash. */
export async function drainPickupForAgent(db: Queryable, agentId: string): Promise<PickupItem[]> {
  const res = await db.query<{ id: string; signal_kind: string | null; ciphertext: Buffer; signal_hash: string | null }>(
    `SELECT pq.id::text AS id,
            pq.signal_kind,
            pq.ciphertext,
            it.signal_hash
       FROM pickup_queue pq
       LEFT JOIN identity_tree_entries it
         ON it.agent_id = pq.agent_id AND it.signal_kind = pq.signal_kind
      WHERE pq.agent_id = $1 AND pq.acked_at IS NULL
      ORDER BY pq.created_at ASC, pq.id ASC`,
    [agentId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    signalKind: r.signal_kind,
    ciphertext: r.ciphertext,
    signalHash: r.signal_hash,
  }));
}

/**
 * ACK a delivered signal: DELETE the row. The story is explicit — "the directory deletes the
 * ciphertext" after ACK; AC-002 asserts the queue is empty for that signal. DELETE (not a soft
 * acked_at flag) guarantees no sealed ciphertext lingers in the replicated store. Idempotent: a
 * re-ACK of an already-deleted id is a no-op.
 */
export async function ackPickupDelete(db: Queryable, id: string, agentId: string): Promise<void> {
  // ACCOUNT-SCOPED: the delete is bound to the ACK'ing agent's own agent_id, NOT id alone. pickup_queue.id
  // is a sequential BIGSERIAL, so an id-only delete would let any authenticated agent wipe OTHER agents'
  // undelivered sealed signals by looping ids (cross-tenant data destruction). WHERE id AND agent_id
  // makes an ACK only able to delete a row addressed to the ACK'ing agent.
  await db.query(`DELETE FROM pickup_queue WHERE id = $1 AND agent_id = $2`, [id, agentId]);
}

/**
 * Sweep genuinely-ORPHANED pickups: pending (acked_at IS NULL) ciphertext that has NO identity-tree
 * anchor for its (agent_id, signal_kind) and is older than ttlHours. The portal writes the hash and the
 * ciphertext as two calls; if the hash write never lands, the ciphertext is undeliverable forever — the
 * drain can neither verify nor ACK it, so it lingers (the skip is logged, not silent). This backstop
 * deletes such rows once they are unambiguously orphaned (default 24h, matching the pending-connection
 * TTL). It targets ONLY anchor-LESS rows: a row whose anchor merely MISMATCHES (a stale/poisoned hash) is
 * left to the supersede path (a re-enrollment replaces it) — it is not orphaned. Returns the row count.
 * No-op for an agent whose anchors all exist.
 *
 * NULL signal_kind (fallback-finder #1): such a row is undeliverable BY CONSTRUCTION — drainPickupForAgent's
 * LEFT JOIN on `it.signal_kind = pq.signal_kind` yields UNKNOWN for NULL, so it never joins an anchor; the
 * `NOT EXISTS` here is likewise UNKNOWN→empty→true, so a NULL-kind row past TTL is correctly swept as the
 * orphan it is. This relies on the write seam ALWAYS setting signal_kind (validateWritePayload rejects any
 * kind not in the closed SIGNAL_KINDS set; enqueuePickup types it `string`), so a NULL-kind row cannot be
 * produced today — only V34-era leftovers (none in practice) would match.
 *
 * REPLICATION GATE (fallback-finder #3 — load-bearing for the H2 work): this sweep is safe ONLY because
 * pickup_queue is NODE-LOCAL today (NOT in cello_pub) while identity_tree_entries IS replicated and never
 * deleted in production — so every node re-checks anchor existence against the same converged anchor set at
 * delete time. When H2 adds pickup_queue to cello_pub, this per-node, per-cadence DELETE becomes UNSAFE: a
 * node whose identity_tree replica has not yet converged could see an anchor as absent, delete a deliverable
 * ciphertext, and replicate that delete federation-wide. H2 MUST gate the sweep before publishing
 * pickup_queue — owning-node ownership of the sweep, or a convergence check — never per-node on a replicated queue.
 */
export async function sweepUndeliverablePickups(db: Queryable, owningNodeId: string, ttlHours = 24): Promise<number> {
  const res = await db.query(
    `DELETE FROM pickup_queue pq
      WHERE pq.acked_at IS NULL
        AND pq.owning_node_id = $2
        AND pq.created_at < now() - make_interval(hours => $1)
        AND NOT EXISTS (
          SELECT 1 FROM identity_tree_entries it
           WHERE it.agent_id = pq.agent_id AND it.signal_kind = pq.signal_kind
        )`,
    [ttlHours, owningNodeId],
  );
  return res.rowCount ?? 0;
}
