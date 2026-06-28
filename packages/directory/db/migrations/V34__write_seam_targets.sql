-- V34 — WRITEAPI-001: the directory write-seam target tables.
-- CELLO-M8-WRITEAPI-001 (blocks CELLO-M8-LEVER-001, CELLO-M8-TRUST-001).
--
-- The portal is mostly a read surface; its few writes go through ONE authenticated, account-scoped
-- seam (POST /internal/agent-write) that accepts ONLY hashes, flags, and sealed ciphertext — never
-- plaintext, PII, or tokens (DOD-INV-2, WRITEAPI-001 SI-001). Everything written here REPLICATES to
-- every sovereign node, so the only things that may land are safe-to-replicate by construction.
--
-- Schema-first (M5 rule #4): this one migration reserves ALL three target tables up front, so the
-- two consumers can build in parallel without reactive mid-milestone migrations:
--   agent_suspensions     — LEVER-001 reversible PAUSE flag (the honest-node FROST honor-check reads it).
--   identity_tree_entries — TRUST-001 trust-signal HASH (the directory-side identity tree).
--   pickup_queue          — TRUST-001 sealed ciphertext the agent's daemon pulls, openSeals, ACKs, deletes.
--
-- Replication note: agent_suspensions + identity_tree_entries use natural keys and join cello_pub now.
-- pickup_queue's BIGSERIAL id is NOT yet replicated — TRUST-001 must add it to the publication WITH the
-- `ALTER SEQUENCE pickup_queue_id_seq INCREMENT BY 3 RESTART WITH {node_offset}` staggering that every
-- other replicated BIGSERIAL table uses (sessions, user_accounts, …), or a cross-node insert would
-- collide ids and halt the subscription. See infra/setup-replication.sh.
--
-- Idempotency: CREATE ... IF NOT EXISTS; RLS policy creation guarded by pg_policies existence check;
-- GRANT is idempotent. Running V34 twice on the same database is safe.

-- ─── agent_suspensions — MUTABLE reversible pause flag ───────────────────────────
-- Mirrors agent_presence (V33): a mutable, edge-triggered, one-row-per-agent table — NOT an
-- append-only chain record. A PAUSE must be CLEARABLE (un-pause restores signing), so it cannot
-- live in agent_revocations (V32), which is an append-only PERMANENT tombstone. Burn/retire are
-- permanent and stay in agent_revocations; only the reversible pause lives here.
--
-- Keyed by agent_id (the directory-assigned stable id in agent_profiles.agent_id) — the same key
-- agent_revocations uses, so the honor-check can consult both stores by one key. authorized_by_account
-- records WHICH account authorized the pause (ownership is proven at write time against
-- agent_profiles.account_id); it is NOT used for scoping the read (the flag applies to the agent).
CREATE TABLE IF NOT EXISTS agent_suspensions (
  agent_id               TEXT        NOT NULL,
  paused                 BOOLEAN     NOT NULL DEFAULT false,
  reason                 TEXT,
  authorized_by_account  UUID        NOT NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_suspensions_pkey PRIMARY KEY (agent_id)
);
-- Partial index over currently-paused agents — the hot lookup for the honor-check's in-memory load.
CREATE INDEX IF NOT EXISTS idx_agent_suspensions_paused
  ON agent_suspensions (agent_id) WHERE paused;

-- ─── identity_tree_entries — trust-signal HASH (one current hash per agent + signal kind) ─────
-- The directory holds ONLY the hash; the sealed payload (if any) goes to pickup_queue. UPSERT on
-- re-write (a re-enrolled signal replaces the prior hash). signal_hash is a 64-char SHA-256 hex —
-- the write seam rejects anything that is not (so plaintext/PII can never occupy this slot).
CREATE TABLE IF NOT EXISTS identity_tree_entries (
  agent_id     TEXT        NOT NULL,
  signal_kind  TEXT        NOT NULL,
  signal_hash  TEXT        NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT identity_tree_entries_pkey PRIMARY KEY (agent_id, signal_kind)
);

-- ─── pickup_queue — sealed ciphertext awaiting the agent's daemon ────────────────
-- Append a row per sealed payload; the agent's daemon pulls by agent_id, openSeals, ACKs by id,
-- and the directory DELETES the row (TRUST-001). ciphertext is OPAQUE sealed bytes — the directory
-- has no key and must never read it. The write seam rejects payloads that are not plausibly sealed
-- (too short, or all-printable like a raw email/token), so plaintext can never occupy this slot.
CREATE TABLE IF NOT EXISTS pickup_queue (
  id           BIGSERIAL   PRIMARY KEY,
  agent_id     TEXT        NOT NULL,
  ciphertext   BYTEA       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at     TIMESTAMPTZ
);
-- Unacked rows for one agent — the daemon's pull query (TRUST-001).
CREATE INDEX IF NOT EXISTS idx_pickup_queue_agent_unacked
  ON pickup_queue (agent_id) WHERE acked_at IS NULL;

-- ─── RLS + grants (match V33: permissive cello_service policy; app-level account-scoping) ─────
-- Account-scoping is enforced in application code (the write seam proves agent ownership against
-- agent_profiles.account_id before any INSERT/UPDATE) — RLS stays permissive for the shared
-- cello_service role, matching every other directory table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_suspensions','identity_tree_entries','pickup_queue'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_service'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I TO cello_service USING (true) WITH CHECK (true)',
        t || '_service', t
      );
    END IF;
    EXECUTE format('GRANT INSERT, SELECT, UPDATE, DELETE ON %I TO cello_service', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE pickup_queue_id_seq TO cello_service;
