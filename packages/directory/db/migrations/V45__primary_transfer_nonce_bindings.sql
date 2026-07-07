-- V45: primary_transfer_nonce_bindings — local anti-replay for M8C-PRIMARY-1 transfer attestations.
--
-- Mirrors V40/V41's pre_auth_nonce_bindings pattern exactly (same rationale: NOT replicated —
-- see V40's own comment for why a nonce-binding table must bind LOCALLY per node, not via a
-- replicated table that would make N nodes write the same key concurrently). Deliberately a
-- SEPARATE table from pre_auth_nonce_bindings — that table is scoped to pre-auth capability
-- tokens (a different protocol); reusing it here would conflate two unrelated nonce namespaces
-- under one column, risking a cross-protocol nonce collision that neither protocol's own
-- single-use logic accounts for.
--
-- Consumption is an idempotent INSERT, same shape as PgNonceBinder:
--   INSERT INTO primary_transfer_nonce_bindings (nonce, bound_daemon_id, chain_hash)
--     VALUES ($1, $2, $3) ON CONFLICT (nonce) DO NOTHING RETURNING nonce;
--   • RETURNING a row                        → first bind on this node → accepted
--   • no row, existing bound_daemon_id = $2  → idempotent re-presentation (same daemon retried)
--   • no row, existing bound_daemon_id ≠ $2  → replay/reuse → rejected (nonce_reused)

CREATE TABLE primary_transfer_nonce_bindings (
  nonce            TEXT         PRIMARY KEY,
  bound_daemon_id  TEXT         NOT NULL,      -- the new_daemon_id this nonce authorized
  bound_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- local timestamp (table is not replicated)
  chain_hash       TEXT         NOT NULL       -- SHA-256(nonce || bound_daemon_id), tamper-evidence convention
);

ALTER TABLE primary_transfer_nonce_bindings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'primary_transfer_nonce_bindings' AND policyname = 'insert_only'
  ) THEN
    CREATE POLICY insert_only ON primary_transfer_nonce_bindings
      FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'primary_transfer_nonce_bindings' AND policyname = 'select_all'
  ) THEN
    CREATE POLICY select_all ON primary_transfer_nonce_bindings
      FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

GRANT INSERT, SELECT ON primary_transfer_nonce_bindings TO cello_service;
-- Append-only: no UPDATE, no DELETE (mirrors V40's SI-002 rationale — a bind is immutable).
REVOKE UPDATE, DELETE ON primary_transfer_nonce_bindings FROM cello_service;
