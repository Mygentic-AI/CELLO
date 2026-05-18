-- CELLO-PERSIST-020 — connections full column schema
--
-- V10 (PERSIST-016) created a minimal stub for the connections table (id BIGSERIAL, created_at).
-- This migration adds the full column definitions required by PERSIST-020:
--
--   connection_id  TEXT NOT NULL UNIQUE  — logical primary key (16-byte hex CSPRNG)
--   participant_a  TEXT NOT NULL         — hex-encoded K_local pubkey of the requester
--   participant_b  TEXT NOT NULL         — hex-encoded K_local pubkey of the acceptor
--   established_at BIGINT NOT NULL       — Unix milliseconds timestamp
--   status         TEXT NOT NULL DEFAULT 'active'  — lifecycle state (revocation deferred)
--   chain_hash     TEXT NOT NULL         — PERSIST-004 SHA-256 chain hash
--
-- The BIGSERIAL id column (from V10) is retained as the ordering key for the hash chain.
-- chain_hash is indexed over rows ordered by id ASC in verifyChain.
--
-- Row-level security:
--   INSERT and SELECT policies already exist (from V10).
--   No UPDATE or DELETE policy is created — connection records are permanent once written.
--   Status changes (revocation, expiry) are handled by a separate table in a future milestone.
--
-- Indexes:
--   Two composite indexes enable symmetric hasConnection() lookups without a full table scan:
--     (participant_a, participant_b) — forward lookup: A→B
--     (participant_b, participant_a) — reverse lookup: B→A
--   Both indexes allow hasConnection(A,B) and hasConnection(B,A) to use the same OR query
--   without application-layer normalization of pubkey order.
--
-- Hash chain:
--   connections is added to the hash-chained table set in this migration.
--   chain_hash = SHA-256(serialize(row_contents) || previous_chain_hash)
--   Serialization excludes: id, created_at, chain_hash (auto-generated / circular).
--
-- References: PERSIST-004 (hash chain protocol), CONTEXT.md §"K_local"

-- ─── Add columns to existing stub ────────────────────────────────────────────

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS connection_id  TEXT   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS participant_a  TEXT   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS participant_b  TEXT   NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS established_at BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status         TEXT   NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS chain_hash     TEXT   NOT NULL DEFAULT '';

-- Remove the temporary defaults after column creation
-- (rows added after this point must supply all values; no existing rows exist in a fresh DB)
ALTER TABLE connections
  ALTER COLUMN connection_id  DROP DEFAULT,
  ALTER COLUMN participant_a  DROP DEFAULT,
  ALTER COLUMN participant_b  DROP DEFAULT,
  ALTER COLUMN established_at DROP DEFAULT,
  ALTER COLUMN chain_hash     DROP DEFAULT;

-- Unique constraint on connection_id (logical primary key)
-- Guard: only add if it doesn't already exist (idempotent for databases where V10 pre-applied this)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connections_connection_id_unique'
      AND conrelid = 'connections'::regclass
  ) THEN
    ALTER TABLE connections
      ADD CONSTRAINT connections_connection_id_unique UNIQUE (connection_id);
  END IF;
END
$$;

-- ─── Composite indexes for symmetric hasConnection() queries ─────────────────

-- Forward lookup: hasConnection(A, B) → uses this index
CREATE INDEX IF NOT EXISTS idx_connections_a_b ON connections (participant_a, participant_b);

-- Reverse lookup: hasConnection(B, A) → uses this index
CREATE INDEX IF NOT EXISTS idx_connections_b_a ON connections (participant_b, participant_a);

-- ─── No additional RLS changes ────────────────────────────────────────────────
-- V10 already created: insert_only (FOR INSERT), select_all (FOR SELECT).
-- No UPDATE or DELETE policy — these are intentionally absent (append-only table).
-- REVOKE UPDATE, DELETE already applied in V10.
