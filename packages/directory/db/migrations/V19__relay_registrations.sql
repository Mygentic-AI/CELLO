-- V19: Relay registration schema — relay_registrations table
-- Required by FEDERATION-003
--
-- Design decisions:
--   1. relay_registrations is an append-only hash-chained table (same pattern as V18 sessions).
--      relay_id is the hex-encoded Ed25519 public key — also serves as the public key lookup key.
--      public_key_hex stores the same value as relay_id for redundancy and query clarity.
--   2. deregistered_at is nullable — it is NOT set at initial registration time.
--      It is declared in TABLE_EXTRA_EXCLUDED in hash-chain.ts so that verifyChain works:
--      the chain_hash was computed WITHOUT deregistered_at, but SELECT * will include it as NULL.
--   3. RLS is enabled with insert_only and select_all policies (same pattern as sessions in V18).
--      cello_service gets INSERT and SELECT only — no UPDATE, no DELETE (append-only enforcement).
--
-- Idempotency: CREATE TABLE uses IF NOT EXISTS. Running V19 twice on the same database is safe.

-- ─── relay_registrations table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS relay_registrations (
  id BIGSERIAL PRIMARY KEY,
  relay_id TEXT NOT NULL UNIQUE,
  public_key_hex TEXT NOT NULL,
  region TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deregistered_at TIMESTAMPTZ,
  chain_hash TEXT NOT NULL DEFAULT ''
);

-- RLS: cello_service gets INSERT + SELECT (same pattern as V17 directory_nodes and V18 sessions)
ALTER TABLE relay_registrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'relay_registrations' AND policyname = 'relay_registrations_select'
  ) THEN
    CREATE POLICY relay_registrations_select ON relay_registrations FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'relay_registrations' AND policyname = 'relay_registrations_insert'
  ) THEN
    CREATE POLICY relay_registrations_insert ON relay_registrations FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON relay_registrations TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE relay_registrations_id_seq TO cello_service;
