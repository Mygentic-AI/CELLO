-- V30__registration_data_integrity.sql — Registration data integrity fixes (M6B-016)
--
-- Fixes three gaps discovered in the Sybil defense audit:
--
--   Gap 1: email_domain → email_stub_hash
--     The registrations table stored only the domain half of the verified email.
--     The full email hash is required for email continuity enforcement on re-registration.
--     email_stub_hash = SHA-256(normalize(full_email)) where normalize lowercases and trims.
--
--   Gap 3: channel_identities table
--     Permanent mapping from verified phone to channel contact ID.
--     Required for out-of-band notifications (security alerts, key rotation, etc.)
--     after registration completes.
--
-- Schema changes:
--   1. registrations: DROP email_domain, ADD email_stub_hash TEXT
--   2. pre_authorization_tokens: DROP email_domain, ADD email_stub_hash TEXT
--   3. CREATE TABLE channel_identities with RLS + grants for cello_ops_agent
--
-- No backward compatibility shim — alpha, single operator, clean cut.

-- ─── 1. registrations: replace email_domain with email_stub_hash ─────────────

ALTER TABLE registrations
  DROP COLUMN IF EXISTS email_domain,
  ADD COLUMN email_stub_hash TEXT;

-- ─── 2. pre_authorization_tokens: replace email_domain with email_stub_hash ──

ALTER TABLE pre_authorization_tokens
  DROP COLUMN IF EXISTS email_domain,
  ADD COLUMN email_stub_hash TEXT;

-- ─── 3. channel_identities table ─────────────────────────────────────────────

-- Permanent mapping from verified phone to channel contact ID.
-- Populated on successful registration completion (PRE_AUTH_TOKEN_ISSUED).
-- One row per (phone_stub_hash, channel) pair — UPSERT on re-registration.
--
-- Security:
--   - channel_user_id stored in plaintext (required for notification delivery)
--   - phone_stub_hash is the same SHA-256 stub used in registrations
--   - No DELETE: append-only; re-registration UPDATEs the channel_user_id
--   - RLS: cello_ops_agent INSERT, SELECT, UPDATE — NO DELETE (SI-002 pattern)
--
-- This table is the ops-agent's permanent contact book.
-- It MUST NOT be replicated to the directory — the directory never sees
-- channel_user_id or phone numbers.

CREATE TABLE IF NOT EXISTS channel_identities (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_stub_hash   TEXT         NOT NULL,
  channel           TEXT         NOT NULL CHECK (channel IN ('telegram', 'whatsapp', 'cli')),
  channel_user_id   TEXT         NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One active channel identity per (phone, channel) pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identities_phone_channel
  ON channel_identities (phone_stub_hash, channel);

-- Lookup by channel_user_id (for incoming message routing if needed later)
CREATE INDEX IF NOT EXISTS idx_channel_identities_channel_user
  ON channel_identities (channel, channel_user_id);

ALTER TABLE channel_identities ENABLE ROW LEVEL SECURITY;

-- RLS policies for cello_ops_agent (same pattern as registrations/pre_auth_tokens)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'channel_identities' AND policyname = 'insert_ops_agent') THEN
    CREATE POLICY insert_ops_agent ON channel_identities
      FOR INSERT TO cello_ops_agent WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'channel_identities' AND policyname = 'select_ops_agent') THEN
    CREATE POLICY select_ops_agent ON channel_identities
      FOR SELECT TO cello_ops_agent USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename = 'channel_identities' AND policyname = 'update_ops_agent') THEN
    CREATE POLICY update_ops_agent ON channel_identities
      FOR UPDATE TO cello_ops_agent USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT, SELECT, UPDATE ON channel_identities TO cello_ops_agent;
REVOKE DELETE ON channel_identities FROM cello_ops_agent;
