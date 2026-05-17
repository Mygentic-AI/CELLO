-- V4__agent_key_shares.sql — KMS envelope encryption for K_server_X shares (PERSIST-005)
--
-- Stores encrypted K_server_X FROST key shares for each agent/epoch.
-- The plaintext share NEVER appears here — only ciphertext from EnvelopeKeyProvider.encrypt().
--
-- This table is NOT in the append-only set: the application may re-encrypt the
-- encrypted_share column during key rotation. Row deletion is still not permitted
-- for cello_service — the existence of a key share is a permanent record.
--
-- Security properties enforced at the application layer (EncryptedPgShareStore):
--   - Ciphertext structural check before INSERT (SI-003)
--   - No plaintext share bytes ever reach this table
--
-- Note: agent_key_shares is intentionally excluded from the append-only RLS policy set.
-- The cryptographic integrity guarantee comes from envelope encryption, not append-only
-- enforcement.

CREATE TABLE IF NOT EXISTS agent_key_shares (
  id              BIGSERIAL    PRIMARY KEY,
  agent_id        TEXT         NOT NULL,
  epoch_id        TEXT         NOT NULL,
  encrypted_share BYTEA        NOT NULL,
  key_version     TEXT         NOT NULL DEFAULT 'v1',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (agent_id, epoch_id)
);

-- Index for fast lookup by agent_id + epoch_id
CREATE INDEX IF NOT EXISTS idx_agent_key_shares_agent_epoch
  ON agent_key_shares (agent_id, epoch_id);

-- cello_service needs INSERT and SELECT for normal operations.
-- A separate GRANT covers the mutable encrypted_share column for key rotation.
GRANT INSERT, SELECT ON agent_key_shares TO cello_service;
GRANT UPDATE (encrypted_share, key_version, updated_at) ON agent_key_shares TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE agent_key_shares_id_seq TO cello_service;
