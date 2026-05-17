-- V9__agent_profiles.sql — Agent registration profiles
--
-- Stores the profile created after a successful FROST DKG ceremony.
-- The profile is the authoritative record that an agent is registered and
-- what keys they hold.
--
-- Lookup patterns:
--   1. By k_local_pubkey (own_pubkey / Ed25519 identity) — used by most protocol paths
--   2. By primary_pubkey (FROST group key) — used by connection pre-check
--
-- Append-only: profiles are never deleted or updated once created.
-- A new DKG creates a new row (new primary_pubkey, same k_local_pubkey conflicts and is ignored).

CREATE TABLE IF NOT EXISTS agent_profiles (
  id                BIGSERIAL    PRIMARY KEY,
  k_local_pubkey    TEXT         NOT NULL,
  primary_pubkey    TEXT         NOT NULL,
  ml_dsa_pubkey     TEXT         NOT NULL DEFAULT '',
  phone_stub_hash   TEXT         NOT NULL DEFAULT '',
  registered_at     BIGINT       NOT NULL DEFAULT 0,
  status            TEXT         NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  chain_hash        TEXT,
  CONSTRAINT agent_profiles_k_local_unique UNIQUE (k_local_pubkey),
  CONSTRAINT agent_profiles_primary_unique UNIQUE (primary_pubkey)
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_primary_pubkey ON agent_profiles (primary_pubkey);

ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY insert_only ON agent_profiles
  FOR INSERT TO cello_service WITH CHECK (true);

CREATE POLICY select_all ON agent_profiles
  FOR SELECT TO cello_service USING (true);

GRANT INSERT, SELECT ON agent_profiles TO cello_service;
GRANT USAGE ON SEQUENCE agent_profiles_id_seq TO cello_service;
