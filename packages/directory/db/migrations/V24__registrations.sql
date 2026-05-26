-- V24__registrations.sql — Registration state machine persistence table
--
-- Stores in-flight and completed registration records for the Operations Agent
-- registration state machine.
--
-- Schema design rationale (see schema_assessment in CELLO-OPS-AGENT-000.yaml):
--
--   1. phone_stub_hash stores SHA-256(phone_stub) — never the raw phone number.
--      One active registration per phone_stub_hash enforced via partial UNIQUE index.
--
--   2. state TEXT — the current state machine state (see RegistrationState union).
--      state_data JSONB — optional channel-specific metadata; reserved for future use.
--
--   3. OTP fields are columns (not JSONB) for indexability and auditability:
--      otp_hash, otp_salt, otp_expires_at, otp_attempt_count.
--      otp_salt is fetched from the DB row at verification time — never surfaced in
--      the application-layer RegistrationRecord type (design decision in OPS-AGENT-000).
--
--   4. chain_hash formula (application-layer, not a DB trigger):
--      Root record:  chain_hash = SHA-256(id)
--      Transition:   chain_hash = SHA-256(prev_chain_hash || id || new_state || new_updated_at)
--      All inputs are UTF-8 strings; new_updated_at uses ISO 8601 format.
--      Allows post-hoc verification that state history was not tampered with.
--      A manual UPDATE to state would break chain integrity, detectable by any verifier.
--
--   5. RLS: cello_service gets INSERT, SELECT, UPDATE — NO DELETE.
--      Rows are never deleted; state transitions UPDATE in place.
--      Append-only semantics preserve the audit trail.
--      SI-002: even with a SQL injection vulnerability, the DB role cannot delete rows.
--
--   6. Partial UNIQUE index (not a table UNIQUE constraint) on phone_stub_hash:
--      Only one active registration per phone number at a time.
--      Terminal states (EXPIRED, FAILED, PRE_AUTH_TOKEN_ISSUED) are excluded — once
--      a registration completes or fails, a new one can begin with the same phone.
--
-- Query patterns supported:
--   SELECT by phone_stub_hash WHERE state NOT IN terminal — resume flow
--   SELECT by channel + channel_user_id — match inbound message to record
--   SELECT WHERE state NOT IN terminal AND expires_at < now() — expiry cleanup
--   INSERT on new registration
--   UPDATE SET state, state_data, updated_at, otp_hash, otp_salt, otp_expires_at,
--             otp_attempt_count, email_domain, chain_hash WHERE id = $1

CREATE TABLE IF NOT EXISTS registrations (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_stub_hash   TEXT         NOT NULL,
  channel           TEXT         NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'cli')),
  channel_user_id   TEXT         NOT NULL,
  state             TEXT         NOT NULL,
  state_data        JSONB        NOT NULL DEFAULT '{}',
  email_domain      TEXT,
  otp_hash          TEXT,
  otp_salt          TEXT,
  otp_expires_at    TIMESTAMPTZ,
  otp_attempt_count INTEGER      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ  NOT NULL,
  -- chain_hash = SHA256(prev_chain_hash || id || state || updated_at); root = SHA256(id)
  chain_hash        TEXT         NOT NULL
);

-- Partial UNIQUE index: one active registration per phone stub hash.
-- Terminal states are excluded so re-registration after completion/failure is permitted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_phone_stub_hash_active
  ON registrations (phone_stub_hash)
  WHERE state NOT IN ('EXPIRED', 'FAILED', 'PRE_AUTH_TOKEN_ISSUED');

-- Lookup by phone_stub_hash (all registrations, including terminal)
CREATE INDEX IF NOT EXISTS idx_registrations_phone_stub_hash
  ON registrations (phone_stub_hash);

-- Expiry cleanup job: find non-terminal registrations that have expired
CREATE INDEX IF NOT EXISTS idx_registrations_state_expires
  ON registrations (state, expires_at)
  WHERE state NOT IN ('EXPIRED', 'FAILED', 'PRE_AUTH_TOKEN_ISSUED');

-- Match inbound Telegram/WhatsApp messages to registration records
CREATE INDEX IF NOT EXISTS idx_registrations_channel_user
  ON registrations (channel, channel_user_id);

-- RLS: cello_service gets INSERT, SELECT, UPDATE — NO DELETE (SI-002)
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'registrations' AND policyname = 'insert_only'
  ) THEN
    CREATE POLICY insert_only ON registrations
      FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'registrations' AND policyname = 'select_all'
  ) THEN
    CREATE POLICY select_all ON registrations
      FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'registrations' AND policyname = 'update_only'
  ) THEN
    CREATE POLICY update_only ON registrations
      FOR UPDATE TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT, SELECT, UPDATE ON registrations TO cello_service;
-- Explicitly revoke DELETE to enforce append-only semantics (SI-002)
REVOKE DELETE ON registrations FROM cello_service;
