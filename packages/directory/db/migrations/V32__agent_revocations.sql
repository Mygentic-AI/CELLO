-- V32: agent_revocations — append-only, self-signed agent revocation facts.
-- Required by CELLO-M7-REMOVE-001 (DOD-REMOVE-2/3/4).
--
-- Design decisions (authority: discussion_logs/2026-06-25_2109_agent-identity-lifecycle-discovery.md
-- §5 removal = revocation-not-erasure, §13 guardrails 1/5; story CELLO-M7-REMOVE-001 DEC-3):
--   1. Removal is RECORDED as an APPEND-ONLY, SIGNED fact — never an UPDATE of agent_profiles and
--      never a DELETE. The agent_profiles row (the identity binding agent_id↔key↔account) is left
--      untouched so it stays resolvable forever (accountability survives — guardrail #5, SI-002).
--   2. Keyed by the stable agent_id (the directory-known id in agent_profiles.agent_id), NEVER a
--      pubkey (guardrail #1 — pubkeys rotate). UNIQUE(agent_id): one revocation per agent (PK).
--   3. signature = the agent's OWN K_local Ed25519 signature over the revocation (self-authorized —
--      SI-001). The directory verifies it against agent_profiles.k_local_pubkey before INSERT; the
--      column is retained so any node can re-verify the fact independently.
--   4. INSERT-only RLS: cello_service may INSERT (record a verified revocation) and SELECT (enforce
--      the soft refuse — DOD-REMOVE-3). NO UPDATE, NO DELETE — a tombstone is permanent.
--   5. Replicated: added to the cello_pub publication (infra/setup-replication.sh PUBLICATION_TABLES)
--      so the revocation fact is verifiable from every sovereign node (AC-002).
--
-- Idempotency: CREATE TABLE/INDEX use IF NOT EXISTS; policies are dropped-if-exists then recreated;
-- GRANT is idempotent. Running V32 twice on the same database is safe.

-- ─── agent_revocations table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_revocations (
  agent_id    TEXT         NOT NULL,
  epoch_id    TEXT,
  reason      TEXT,
  signature   BYTEA        NOT NULL,
  revoked_at  BIGINT       NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- UNIQUE(agent_id): one permanent revocation per agent (AC-004).
  CONSTRAINT agent_revocations_pkey PRIMARY KEY (agent_id)
);

-- Index on agent_id for the soft-refuse lookup (DOD-REMOVE-3). The PK already provides a unique
-- index, but the explicit index is named per AC-004 and is idempotent.
CREATE INDEX IF NOT EXISTS idx_agent_revocations_agent_id
  ON agent_revocations (agent_id);

-- ─── RLS: INSERT + SELECT only (append-only — no UPDATE, no DELETE) ───────────

ALTER TABLE agent_revocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS insert_only ON agent_revocations;
  DROP POLICY IF EXISTS select_all ON agent_revocations;
END $$;

-- INSERT: the directory service records a VERIFIED revocation (signature checked in app code first).
CREATE POLICY insert_only ON agent_revocations
  FOR INSERT TO cello_service WITH CHECK (true);

-- SELECT: the directory service reads revocations to refuse routing to a revoked agent (DOD-REMOVE-3)
-- and to serve verification queries (AC-002).
CREATE POLICY select_all ON agent_revocations
  FOR SELECT TO cello_service USING (true);

-- No UPDATE / DELETE policy and no UPDATE/DELETE grant — a revocation is a permanent tombstone.
GRANT INSERT, SELECT ON agent_revocations TO cello_service;
