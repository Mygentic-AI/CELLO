-- V18: Federation schema — sessions table + directory_checkpoints and checkpoint_node_signatures additions
-- Required by FEDERATION-001
--
-- Design decisions:
--   1. sessions is a hash-chained append-only table with owning_node_id TEXT NOT NULL.
--      Each session row is written by the owning directory node; only that node may extend
--      the hash chain for that session (enforced at the application layer via ownership check).
--   2. directory_checkpoints gains mmr_peaks, identity_merkle_root, checkpoint_hash, and
--      coordinator_node_id columns via idempotent ALTER TABLE ADD COLUMN.
--   3. checkpoint_node_signatures (stub from V2) gains full columns via idempotent ALTER TABLE ADD COLUMN.
--
-- Idempotency: every CREATE uses IF NOT EXISTS; every ALTER TABLE ADD COLUMN uses the
-- DO $$ BEGIN IF NOT EXISTS (...) THEN ALTER TABLE ... ADD COLUMN ...; END IF; END $$ pattern.
-- Running V18 twice on the same database is safe and produces no error.

-- ─── sessions table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE,
  owning_node_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chain_hash TEXT NOT NULL DEFAULT ''
);

-- RLS: cello_service gets INSERT + SELECT (same pattern as V17 directory_nodes)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'sessions_select'
  ) THEN
    CREATE POLICY sessions_select ON sessions FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sessions' AND policyname = 'sessions_insert'
  ) THEN
    CREATE POLICY sessions_insert ON sessions FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON sessions TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE sessions_id_seq TO cello_service;

-- Add chain_hash column if sessions was previously created without it (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions' AND column_name = 'chain_hash'
  ) THEN
    ALTER TABLE sessions ADD COLUMN chain_hash TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

-- ─── directory_checkpoints additions ─────────────────────────────────────────
-- V5 created directory_checkpoints with: checkpoint_id UUID, mmr_leaf_count BIGINT,
-- peak_hash TEXT, staged_seal_count INT, chain_hash TEXT.
-- V18 adds: mmr_peaks JSONB, identity_merkle_root TEXT, checkpoint_hash TEXT,
-- coordinator_node_id TEXT.
-- peak_hash (TEXT from V5) is retained for backwards compatibility.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directory_checkpoints' AND column_name = 'mmr_peaks'
  ) THEN
    ALTER TABLE directory_checkpoints ADD COLUMN mmr_peaks JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directory_checkpoints' AND column_name = 'identity_merkle_root'
  ) THEN
    ALTER TABLE directory_checkpoints ADD COLUMN identity_merkle_root TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directory_checkpoints' AND column_name = 'checkpoint_hash'
  ) THEN
    ALTER TABLE directory_checkpoints ADD COLUMN checkpoint_hash TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'directory_checkpoints' AND column_name = 'coordinator_node_id'
  ) THEN
    ALTER TABLE directory_checkpoints ADD COLUMN coordinator_node_id TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

-- ─── checkpoint_node_signatures full schema ───────────────────────────────────
-- V2 created checkpoint_node_signatures as a stub with only (id BIGSERIAL PRIMARY KEY).
-- V18 adds: checkpoint_id UUID, node_id TEXT, node_signature TEXT, signed_at TIMESTAMPTZ.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkpoint_node_signatures' AND column_name = 'checkpoint_id'
  ) THEN
    ALTER TABLE checkpoint_node_signatures
      ADD COLUMN checkpoint_id UUID NOT NULL DEFAULT gen_random_uuid()
      REFERENCES directory_checkpoints(checkpoint_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkpoint_node_signatures' AND column_name = 'node_id'
  ) THEN
    ALTER TABLE checkpoint_node_signatures ADD COLUMN node_id TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkpoint_node_signatures' AND column_name = 'node_signature'
  ) THEN
    ALTER TABLE checkpoint_node_signatures ADD COLUMN node_signature TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checkpoint_node_signatures' AND column_name = 'signed_at'
  ) THEN
    ALTER TABLE checkpoint_node_signatures ADD COLUMN signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;
