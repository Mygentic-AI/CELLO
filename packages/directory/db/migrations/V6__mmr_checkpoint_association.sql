-- CELLO-PERSIST-007 (review fixes) — MMR checkpoint association join table
--
-- Problem (review finding [critical]):
--   conversation_proof_leaves.checkpoint_id is set NULL on INSERT and the column can
--   never be updated — cello_service has INSERT+SELECT only (UPDATE was REVOKED in V2).
--   The SI-003 invariant (leaf appears in at most one checkpoint) requires a durable,
--   queryable link from a leaf to its checkpoint that does not require UPDATE on an
--   append-only table.
--
-- Solution:
--   Add an INSERT-only join table conversation_proof_leaf_checkpoints.
--   Each row records (leaf_id → checkpoint_id) at checkpoint confirmation time.
--   The table is governed by the same RLS pattern as every other append-only table.
--   cello_service can INSERT a row and SELECT all rows — never UPDATE or DELETE.
--
-- The checkpoint_id column on conversation_proof_leaves is intentionally left in place
-- (it is part of the public schema and existing queries may reference it), but it will
-- always be NULL — checkpoint association is read through this join table instead.
--
-- Removal of DEFAULT values from V4 columns (review finding [low]):
--   DEFAULT 0 and DEFAULT '' on leaf_index, mmr_position, hash, leaf_hash,
--   seal_merkle_root, and height allow silent bad-data insertion. Dropping the
--   defaults causes a NOT NULL constraint error if the application omits a column,
--   which is the desired behaviour for an append-only trust ledger.

-- ─── conversation_proof_leaf_checkpoints ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_proof_leaf_checkpoints (
  id            BIGSERIAL   PRIMARY KEY,
  leaf_id       BIGINT      NOT NULL REFERENCES conversation_proof_leaves(id),
  checkpoint_id UUID        NOT NULL REFERENCES directory_checkpoints(checkpoint_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Each leaf belongs to at most one checkpoint (SI-003)
  CONSTRAINT cplc_leaf_unique UNIQUE (leaf_id)
);

CREATE INDEX IF NOT EXISTS idx_cplc_checkpoint_id ON conversation_proof_leaf_checkpoints (checkpoint_id);

ALTER TABLE conversation_proof_leaf_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_proof_leaf_checkpoints FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON conversation_proof_leaf_checkpoints FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON conversation_proof_leaf_checkpoints TO cello_service;
REVOKE UPDATE, DELETE ON conversation_proof_leaf_checkpoints FROM cello_service;
GRANT USAGE ON SEQUENCE conversation_proof_leaf_checkpoints_id_seq TO cello_service;

-- ─── Remove DEFAULT values that mask application bugs ────────────────────────
-- These columns are NOT NULL; a missing value should error, not silently insert 0 or ''.

ALTER TABLE conversation_proof_leaves
  ALTER COLUMN leaf_index    DROP DEFAULT,
  ALTER COLUMN mmr_position  DROP DEFAULT,
  ALTER COLUMN seal_merkle_root DROP DEFAULT,
  ALTER COLUMN leaf_hash     DROP DEFAULT;

ALTER TABLE conversation_proof_mmr_nodes
  ALTER COLUMN mmr_position  DROP DEFAULT,
  ALTER COLUMN hash          DROP DEFAULT;

-- height DEFAULT 1 is also wrong for leaves (height=0); drop it.
ALTER TABLE conversation_proof_mmr_nodes
  ALTER COLUMN height        DROP DEFAULT;

-- directory_checkpoints: mmr_leaf_count=0 and peak_hash='' are meaningless defaults.
ALTER TABLE directory_checkpoints
  ALTER COLUMN mmr_leaf_count DROP DEFAULT,
  ALTER COLUMN peak_hash      DROP DEFAULT;
