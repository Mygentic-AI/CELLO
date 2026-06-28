-- V35 — TRUST-001: pickup_queue.signal_kind, so the daemon-pickup delivery can verify against the
-- AUTHORITATIVE identity-tree hash.
-- CELLO-M8-TRUST-001 (follows V34, which created pickup_queue without it).
--
-- The pipe: the portal writes the signal HASH to identity_tree_entries (keyed by agent_id +
-- signal_kind) AND the sealed ciphertext to pickup_queue. When the daemon pulls a ciphertext, it
-- must verify openSealed(ciphertext) recomputes to the directory's hash (TRUST-001 AC-001). The
-- authoritative hash lives in identity_tree_entries — so the pickup row needs signal_kind to JOIN to
-- it at drain time (the hash is NOT denormalized onto the queue; the identity tree stays the single
-- source of truth). V34's pickup_queue has only (id, agent_id, ciphertext), so add the column here
-- rather than modify the already-applied V34.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Existing rows (none in practice — the queue is ephemeral)
-- get NULL signal_kind and would simply not join a hash; the daemon re-mints on a miss (D1).

ALTER TABLE pickup_queue ADD COLUMN IF NOT EXISTS signal_kind TEXT;
