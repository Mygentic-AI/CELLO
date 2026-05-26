-- V25__pre_authorization_tokens.sql — Pre-authorization token store
--
-- Stores issued pre-authorization tokens awaiting agent presentation during FROST DKG.
-- Created in OPS-AGENT-000 (design and contract story).
-- Consumed by OPS-AGENT-001 (directory pre-authorization API).
--
-- Schema design rationale (see schema_assessment in CELLO-OPS-AGENT-000.yaml):
--
--   1. token TEXT UNIQUE — the pre-authorization token string.
--      Format: "CELLO-" + 33 base58 chars (production), "DEV-CELLO-" + 16 hex (dev stub).
--      The UNIQUE constraint is the single-use enforcement mechanism:
--        UPDATE ... WHERE token = $1 AND consumed_at IS NULL returns rowCount.
--        Only one UPDATE can return rowCount=1 when two agents present the same token
--        concurrently — atomic single-use via database-level uniqueness + conditional update.
--
--   2. chain_hash formula (application-layer, not a DB trigger):
--      Root record:  chain_hash = SHA-256(id)
--      Transition:   chain_hash = SHA-256(prev_chain_hash || id || token || issued_at)
--      Same scheme as the registrations table — maintains tamper-evidence for token records.
--
--   3. registration_id FK → registrations(id):
--      Links each token to the registration ceremony that authorized it.
--      Provides traceability: which phone/email verification produced this token.
--
--   4. RLS: cello_service gets INSERT, SELECT, UPDATE — NO DELETE (SI-002).
--      consumed_at is updated once, on token consumption. Row is never deleted.
--      Expired-but-unconsumed tokens remain in the table for audit purposes.
--
-- Query patterns supported:
--   SELECT by token WHERE consumed_at IS NULL AND expires_at > now() — validate
--   UPDATE SET consumed_at = now() WHERE token = $1 AND consumed_at IS NULL — atomic consume
--   SELECT WHERE expires_at < now() AND consumed_at IS NULL — cleanup expired

CREATE TABLE IF NOT EXISTS pre_authorization_tokens (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  token            TEXT         NOT NULL UNIQUE,
  phone_stub_hash  TEXT         NOT NULL,
  email_domain     TEXT         NOT NULL,
  registration_id  UUID         NOT NULL REFERENCES registrations(id),
  issued_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ  NOT NULL,
  consumed_at      TIMESTAMPTZ,
  -- chain_hash = SHA256(prev_chain_hash || id || token || issued_at); root = SHA256(id)
  chain_hash       TEXT         NOT NULL
);

-- Fast token lookup (primary query pattern: validate by token value)
CREATE INDEX IF NOT EXISTS idx_pre_auth_tokens_token
  ON pre_authorization_tokens (token);

-- Expiry cleanup job: find unconsumed tokens past their expiry
CREATE INDEX IF NOT EXISTS idx_pre_auth_tokens_expires
  ON pre_authorization_tokens (expires_at)
  WHERE consumed_at IS NULL;

-- RLS: cello_service gets INSERT, SELECT, UPDATE — NO DELETE (SI-002)
ALTER TABLE pre_authorization_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_authorization_tokens' AND policyname = 'insert_only'
  ) THEN
    CREATE POLICY insert_only ON pre_authorization_tokens
      FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_authorization_tokens' AND policyname = 'select_all'
  ) THEN
    CREATE POLICY select_all ON pre_authorization_tokens
      FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_authorization_tokens' AND policyname = 'update_consumed_at'
  ) THEN
    CREATE POLICY update_consumed_at ON pre_authorization_tokens
      FOR UPDATE TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT, SELECT, UPDATE ON pre_authorization_tokens TO cello_service;
-- Explicitly revoke DELETE to enforce append-only semantics (SI-002)
REVOKE DELETE ON pre_authorization_tokens FROM cello_service;
