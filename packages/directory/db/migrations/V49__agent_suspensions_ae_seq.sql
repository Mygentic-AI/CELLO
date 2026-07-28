-- V49 — agent_suspensions: add suspension_seq + origin_node for M12 anti-entropy convergence.
--
-- The M12 kill-switch merge (DOD-AE-MUTABLE-1; M12-ANTI-ENTROPY-DESIGN §4) converges the
-- replicated agent_suspensions table with a sequence-based, wall-clock-free rule: higher
-- suspension_seq wins, equal seq resolves suspended-wins, burned is monotonic OR. That requires
-- two columns the original V34 table lacks:
--
--   suspension_seq BIGINT — a per-agent monotonic sequence stamped by the accepting node at each
--     write (suspension_seq = max(local)+1). It is the merge's ordering key; wall-clock updated_at
--     is deliberately NOT a merge input (clock skew must never un-pause a compromised agent).
--   origin_node TEXT — advisory provenance (which node accepted the write); part of the tie-broken
--     value at equal seq, never a security input.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS, defaults) — cannot break existing rows. Existing
-- rows get suspension_seq = 0 / origin_node = NULL; the write path (a follow-up) begins minting real
-- sequences, and the merge treats all pre-migration rows as seq 0 (suspended-wins + hash tiebreak),
-- which is the safe direction (a pause is never lost).

ALTER TABLE agent_suspensions ADD COLUMN IF NOT EXISTS suspension_seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE agent_suspensions ADD COLUMN IF NOT EXISTS origin_node    TEXT;
