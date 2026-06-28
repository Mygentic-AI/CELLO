-- V37 — TRUST-001: enforce ONE pending pickup per (agent_id, signal_kind).
-- CELLO-M8-TRUST-001 (follows V35, which added pickup_queue.signal_kind).
--
-- enqueuePickup supersedes a prior UNDELIVERED ciphertext for an (agent, kind) so a re-enrolled signal
-- cannot leave a stale row that hashes to the SUPERSEDED identity-tree anchor and re-fires hash_mismatch
-- forever (the poison pill). App-level supersede alone is best-effort: under two concurrent
-- same-(agent,kind) enqueues at READ COMMITTED, neither statement sees the other's uncommitted INSERT,
-- so BOTH rows survive — silently re-arming the poison pill while the write API reports success
-- (code-reviewer + fallback-finder, 2026-06-28). This partial UNIQUE index makes the "one current
-- sealed value per kind" invariant DB-ENFORCED; enqueuePickup upserts via ON CONFLICT against it.
--
-- It mirrors identity_tree_entries' PK (agent_id, signal_kind) — the single anchor per kind — so the
-- queue and the anchor agree on cardinality. Scoped to acked_at IS NULL (delivered rows are hard-DELETEd
-- by ACK, so this is the set of pending rows). NULL signal_kind rows (none in practice — the seam always
-- sets it) are treated as distinct by the partial index, matching the dedupe's `=` semantics below.
--
-- Idempotent: dedupe is safe to re-run; CREATE UNIQUE INDEX IF NOT EXISTS. The queue is ephemeral so in
-- practice there are no duplicates, but the append-era code could have left some and the index creation
-- would fail otherwise — so collapse any duplicate UNACKED rows per (agent_id, signal_kind), keeping the
-- newest (max id), BEFORE creating the index.

DELETE FROM pickup_queue p
 USING pickup_queue q
 WHERE p.agent_id = q.agent_id
   AND p.signal_kind = q.signal_kind
   AND p.acked_at IS NULL
   AND q.acked_at IS NULL
   AND p.id < q.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_queue_one_pending_per_kind
  ON pickup_queue (agent_id, signal_kind) WHERE acked_at IS NULL;
