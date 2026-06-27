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
export async function ackPickupDelete(db: Queryable, id: string): Promise<void> {
  await db.query(`DELETE FROM pickup_queue WHERE id = $1`, [id]);
}
