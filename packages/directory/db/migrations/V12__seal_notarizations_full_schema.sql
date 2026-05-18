-- CELLO-PERSIST-018 — seal_notarizations full column schema
--
-- V10__missing_table_stubs.sql (PERSIST-016) created the seal_notarizations table
-- as a minimal stub with only id + created_at. This migration adds the actual
-- columns required for production use.
--
-- Stores the FROST threshold co-signature for each sealed session.
-- Together with conversation_seals (PERSIST-007 / V5), allows a third party
-- to verify both the Merkle integrity (via sealed_root in conversation_seals)
-- and the FROST threshold co-signature (via frost_signature here) without any
-- further directory query.
--
-- Design rules:
--   1. Append-only — a session can be sealed at most once.
--      UNIQUE constraint on session_id enforces this.
--   2. RLS already enabled in V10 (PERSIST-016).
--      cello_service: INSERT + SELECT only. UPDATE and DELETE are impossible.
--   3. chain_hash enforcement (PERSIST-004) — computed application-side,
--      never accepted from external callers. Stored as TEXT (hex-encoded SHA-256),
--      consistent with all other hash-chained tables.
--   4. id BIGSERIAL is required by the hash chain verifier (ORDER BY id ASC).
--   5. session_id BYTEA has a UNIQUE constraint for fast lookups by session.
--
-- SI-001: frost_signature and chain_hash are computed by the directory service.
--   frost_signature comes from the FROST ceremony coordinated by directory-node.ts.
--   chain_hash is computed by PgDirectoryStore#insertWithChain — never from caller input.
--
-- SI-002: this write is issued atomically with the conversation_seals write
--   (see directory-node.ts seal handler). A connection failure after one but
--   before the other rolls back both via the outer transaction.
--
-- References:
--   - PERSIST-018 story YAML
--   - PERSIST-004 hash chain protocol
--   - PERSIST-007 conversation_seals table

ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS session_id           BYTEA  NOT NULL DEFAULT '\x00';
ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS sealed_root          BYTEA  NOT NULL DEFAULT '\x00';
ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS participant_a_pubkey BYTEA  NOT NULL DEFAULT '\x00';
ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS participant_b_pubkey BYTEA  NOT NULL DEFAULT '\x00';
ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS close_timestamp      BIGINT NOT NULL DEFAULT 0;
ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS frost_signature      BYTEA  NOT NULL DEFAULT '\x00';
ALTER TABLE seal_notarizations ADD COLUMN IF NOT EXISTS chain_hash           TEXT   NOT NULL DEFAULT '';

-- Add UNIQUE constraint on session_id (enforces append-only: one seal per session).
-- Use DO block to make this idempotent.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'seal_notarizations_session_id_key'
      AND conrelid = 'seal_notarizations'::regclass
  ) THEN
    ALTER TABLE seal_notarizations ADD CONSTRAINT seal_notarizations_session_id_key UNIQUE (session_id);
  END IF;
END $$;

-- Remove the temporary defaults now that the constraint is in place.
-- Any rows inserted by the V10 stub (unlikely — stubs are for CI gate only) would
-- have the placeholder values; production starts clean.
ALTER TABLE seal_notarizations ALTER COLUMN session_id           DROP DEFAULT;
ALTER TABLE seal_notarizations ALTER COLUMN sealed_root          DROP DEFAULT;
ALTER TABLE seal_notarizations ALTER COLUMN participant_a_pubkey DROP DEFAULT;
ALTER TABLE seal_notarizations ALTER COLUMN participant_b_pubkey DROP DEFAULT;
ALTER TABLE seal_notarizations ALTER COLUMN close_timestamp      DROP DEFAULT;
ALTER TABLE seal_notarizations ALTER COLUMN frost_signature      DROP DEFAULT;
ALTER TABLE seal_notarizations ALTER COLUMN chain_hash           DROP DEFAULT;
