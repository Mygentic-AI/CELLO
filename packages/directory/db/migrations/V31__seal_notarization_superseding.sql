-- V31 — DOD-UP-1 (CELLO-M7-UPGRADE-001): allow a BILATERAL seal to SUPERSEDE a prior
-- UNILATERAL one, append-only.
--
-- Today seal_notarizations enforces one row per session via
-- `seal_notarizations_session_id_key UNIQUE(session_id)` (V12). That constraint IS the
-- PERSIST-015 SI-002 "once sealed, no second notarization" behaviour. DOD-UP-1 inverts it:
-- when the previously-ABSENT party returns, recovers + verifies the content, and signs its
-- OWN ack leaf over the sealed root, the directory writes a NEW bilateral notarization row
-- that SUPERSEDES the unilateral one WITHOUT mutating it (AC-006, append-only).
--
-- This migration:
--   1. adds `seal_type` ('unilateral' | 'bilateral') so the two rows are discriminated,
--   2. adds `supersedes_notarization_id` (FK to the superseded unilateral row),
--   3. drops the global UNIQUE(session_id), replacing it with UNIQUE(session_id, seal_type)
--      — at most one unilateral + one bilateral row per session (still no unbounded growth).
--
-- Idempotent (guarded ALTER/DROP) so it is safe to re-run. Fresh DBs have no rows to
-- back-fill; the `seal_type` default only satisfies NOT NULL for any pre-existing rows —
-- recordNotarization sets it explicitly going forward.

ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS seal_type TEXT NOT NULL DEFAULT 'bilateral'
  CHECK (seal_type IN ('unilateral', 'bilateral'));

ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS supersedes_notarization_id BIGINT
  REFERENCES seal_notarizations(id);

-- Drop the one-row-per-session constraint (it blocks the superseding row).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'seal_notarizations_session_id_key'
      AND conrelid = 'seal_notarizations'::regclass
  ) THEN
    ALTER TABLE seal_notarizations DROP CONSTRAINT seal_notarizations_session_id_key;
  END IF;
END $$;

-- Replace it with one-row-per-(session, type): a session may hold at most one unilateral
-- and one bilateral notarization. The bilateral row references the unilateral via
-- supersedes_notarization_id; the unilateral row is never mutated.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'seal_notarizations_session_seal_type_key'
      AND conrelid = 'seal_notarizations'::regclass
  ) THEN
    ALTER TABLE seal_notarizations ADD CONSTRAINT seal_notarizations_session_seal_type_key
      UNIQUE (session_id, seal_type);
  END IF;
END $$;
