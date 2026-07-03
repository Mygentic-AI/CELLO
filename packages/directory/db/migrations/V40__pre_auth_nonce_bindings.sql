-- V40__pre_auth_nonce_bindings.sql — local anti-replay for pre-auth capabilities (M8B-PREAUTH-CAP).
--
-- Replaces the single-use enforcement of pre_authorization_tokens.consumed_at for T-of-N registration.
-- A pre-auth CAPABILITY is a signed permission slip every directory verifies independently (no DB
-- lookup); single-use is enforced by binding the capability's `nonce` to the DKG epoch it authorizes:
-- one nonce ⇒ one agent.
--
-- CRITICAL — this table is DELIBERATELY NOT in cello_pub (not replicated). A T-of-N registration has
-- all N directories act on the SAME nonce concurrently; replicating that would make N nodes write the
-- same key at once, which HALTS logical replication (the very failure this design removes — see
-- V25/the design doc). Each node binds LOCALLY. Single-use still holds:
--   • all-N ceremony  → every participating node binds locally; a replay for another epoch is rejected
--                       at every node, so its DKG cannot complete.
--   • quorum ceremony → a required quorum > N/2 means any two attempts share ≥1 node (majority sets
--                       intersect); that overlap node bound the first epoch and rejects the second.
--
-- Consumption is an idempotent INSERT:
--   INSERT INTO pre_auth_nonce_bindings (nonce, bound_epoch, chain_hash)
--     VALUES ($1,$2,$3) ON CONFLICT (nonce) DO NOTHING RETURNING nonce;
--   • RETURNING a row  → first bind on this node → OK.
--   • no row + existing bound_epoch = $2 → idempotent re-presentation (same agent) → OK.
--   • no row + existing bound_epoch ≠ $2 → NONCE_ALREADY_BOUND (replay into a different agent) → reject.
--
-- chain_hash = SHA-256(nonce || bound_epoch) — application-layer, deterministic self-hash for
-- tamper-evidence, matching the pre_authorization_tokens / registrations convention.
--
-- RLS: cello_service gets INSERT + SELECT only — NO UPDATE, NO DELETE (append-only, SI-002). A binding
-- is immutable once written; expired/stale rows remain for audit.

CREATE TABLE IF NOT EXISTS pre_auth_nonce_bindings (
  nonce        TEXT         PRIMARY KEY,   -- the capability's 128-bit nonce (hex). NOT a secret.
  bound_epoch  TEXT         NOT NULL,      -- the DKG epochId this nonce authorized (one epoch ⇒ one agent)
  bound_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- local timestamp (table is not replicated)
  chain_hash   TEXT         NOT NULL       -- SHA-256(nonce || bound_epoch)
);

ALTER TABLE pre_auth_nonce_bindings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_auth_nonce_bindings' AND policyname = 'insert_only'
  ) THEN
    CREATE POLICY insert_only ON pre_auth_nonce_bindings
      FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_auth_nonce_bindings' AND policyname = 'select_all'
  ) THEN
    CREATE POLICY select_all ON pre_auth_nonce_bindings
      FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

GRANT INSERT, SELECT ON pre_auth_nonce_bindings TO cello_service;
-- Append-only: no UPDATE, no DELETE (SI-002). A bind is immutable.
REVOKE UPDATE, DELETE ON pre_auth_nonce_bindings FROM cello_service;
