-- CELLO-PERSIST-007 — MMR single-node construction
--
-- Adds full column definitions to the stub tables created in V2:
--   conversation_proof_leaves   — one row per sealed conversation
--   conversation_proof_mmr_nodes — internal MMR tree nodes
--   directory_checkpoints        — confirmed checkpoints with MMR state
--
-- And creates a new ephemeral staging table:
--   conversation_seal_staging    — accumulates seals between checkpoints
--
-- Design rules (inherited from V2):
--   1. conversation_proof_leaves and conversation_proof_mmr_nodes are append-only
--      with RLS (inherited from V2). Their chain_hash columns are added here.
--   2. directory_checkpoints is append-only with RLS (inherited from V2).
--      Full columns added here.
--   3. conversation_seal_staging is NOT append-only — rows are cleared after each
--      checkpoint (checkpoint_id assignment is atomic per SI-003). It requires
--      UPDATE privilege on checkpoint_id and DELETE privilege after confirmation.
--      cello_service gets INSERT, SELECT, UPDATE, DELETE on this table only.
--
-- Leaf hash formula (SI-002):
--   leaf_hash = SHA-256(`${leaf_index}:${seal_merkle_root}:${recorded_at}`)
--   Computed by application code — never from caller input.
--
-- References:
--   - CELLO meta-Merkle design: docs/planning/discussion_logs/2026-04-13_1400_meta-merkle-tree-design.md
--   - PERSIST-007 story YAML

-- ─── conversation_proof_leaves — full column definitions ──────────────────────

ALTER TABLE conversation_proof_leaves
  ADD COLUMN IF NOT EXISTS leaf_index     BIGINT      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mmr_position   BIGINT      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seal_merkle_root TEXT       NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS leaf_hash      TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS session_id     UUID                 ,
  ADD COLUMN IF NOT EXISTS checkpoint_id  UUID                 ,
  ADD COLUMN IF NOT EXISTS recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS chain_hash     TEXT                 ;

-- leaf_index must be unique across all leaves
ALTER TABLE conversation_proof_leaves
  ADD CONSTRAINT IF NOT EXISTS conversation_proof_leaves_leaf_index_unique UNIQUE (leaf_index);

-- session_id index for proof lookups by session
CREATE INDEX IF NOT EXISTS idx_cpl_session_id ON conversation_proof_leaves (session_id);

-- ─── conversation_proof_mmr_nodes — full column definitions ──────────────────

ALTER TABLE conversation_proof_mmr_nodes
  ADD COLUMN IF NOT EXISTS mmr_position   BIGINT      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hash           TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS height         INT         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS chain_hash     TEXT                 ;

-- mmr_position must be unique
ALTER TABLE conversation_proof_mmr_nodes
  ADD CONSTRAINT IF NOT EXISTS cpmn_mmr_position_unique UNIQUE (mmr_position);

-- ─── directory_checkpoints — full column definitions ─────────────────────────

ALTER TABLE directory_checkpoints
  ADD COLUMN IF NOT EXISTS checkpoint_id  UUID        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS mmr_leaf_count BIGINT      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peak_hash      TEXT        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS staged_seal_count INT      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_hash     TEXT                 ;

-- checkpoint_id must be unique
ALTER TABLE directory_checkpoints
  ADD CONSTRAINT IF NOT EXISTS directory_checkpoints_checkpoint_id_unique UNIQUE (checkpoint_id);

-- ─── conversation_seal_staging — new ephemeral table ─────────────────────────
-- NOT append-only: rows have checkpoint_id stamped (UPDATE) then deleted after confirmation.
-- cello_service gets full DML on this table — it is not a permanent record.

CREATE TABLE IF NOT EXISTS conversation_seal_staging (
  id               BIGSERIAL   PRIMARY KEY,
  session_id       UUID        NOT NULL UNIQUE,
  seal_merkle_root TEXT        NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  checkpoint_id    UUID                                 -- NULL until checkpoint initiated
);

-- Enable RLS for cello_service access control
ALTER TABLE conversation_seal_staging ENABLE ROW LEVEL SECURITY;

-- Staging needs INSERT (new seals), SELECT (checkpoint initiation), UPDATE (checkpoint_id stamping),
-- DELETE (post-confirmation cleanup) — this table is NOT append-only.
CREATE POLICY staging_service ON conversation_seal_staging TO cello_service USING (true) WITH CHECK (true);
GRANT INSERT, SELECT, UPDATE, DELETE ON conversation_seal_staging TO cello_service;
GRANT USAGE ON SEQUENCE conversation_seal_staging_id_seq TO cello_service;
