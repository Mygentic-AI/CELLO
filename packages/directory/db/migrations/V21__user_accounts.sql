-- V21: user_accounts table — account grouping layer for M6 onboarding
-- Required by CELLO-ACCOUNT-001
--
-- Design decisions:
--   1. account_id is a UUID PRIMARY KEY — human operators are identified by UUID,
--      not by phone number or email. The human-readable identifiers are hashed.
--   2. phone_stub_hash is UNIQUE NOT NULL — one account per phone stub (deduplication guard).
--      SHA-256(phone_stub) per FIPS 180-4, same convention as agent_profiles.phone_stub_hash.
--   3. email_stub_hash is nullable — email is optional at account creation time.
--   4. chain_hash: genesis is SHA-256('CELLO_CHAIN_GENESIS'); insertWithChain handles this
--      automatically when the table is empty.
--   5. id BIGSERIAL — internal row ordering for hash chain; not exposed to callers.
--   6. RLS: cello_service gets INSERT + SELECT only — append-only from the service role.
--      No UPDATE or DELETE. The table is immutable once written.
--
-- Idempotency: CREATE uses IF NOT EXISTS; every policy add and GRANT are safe to re-run.
-- Running V21 twice on the same database is safe.

-- ─── user_accounts table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_accounts (
  id             BIGSERIAL                NOT NULL,
  account_id     UUID                     PRIMARY KEY,
  phone_stub_hash TEXT                   UNIQUE NOT NULL,
  email_stub_hash TEXT,
  created_at     TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  chain_hash     TEXT                     NOT NULL
);

-- RLS: cello_service gets INSERT + SELECT (append-only, same pattern as other hash-chained tables)
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_accounts' AND policyname = 'insert_only'
  ) THEN
    CREATE POLICY insert_only ON user_accounts FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_accounts' AND policyname = 'select_all'
  ) THEN
    CREATE POLICY select_all ON user_accounts FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON user_accounts TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE user_accounts_id_seq TO cello_service;
