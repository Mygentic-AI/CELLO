-- V44 — primary_holder: per-node record of which daemon currently holds Primary status for an
-- agent. M8C-DOD-PRIMARY-1, per the design log docs/planning/user-stories/m8c/M8C-PRIMARY-DESIGN.md
-- (Decision 4, revised across 3 passes: adversarial security review, a code-level correction to
-- the real client-coordinated-per-node pattern, and a release-attestation crypto fix reusing the
-- existing FROST ceremony).
--
-- NOT a cross-node consensus table — CELLO has no cross-node RPC/consensus anywhere (confirmed by
-- reading the DKG coordination code directly, not assumed). This follows the SAME shape as DKG's
-- own quorum-registration pattern: the CLIENT (the daemon becoming Primary) dials each of T-of-N
-- directory nodes holding the agent's FROST shares directly, and EACH node independently verifies
-- the claim (including a real FROST partial-signature-ceremony release proof from the old Primary,
-- context CONTEXT_PRIMARY_RELEASE) and writes its OWN local row here. "Exactly one Primary" is
-- enforced by FROST's own T-of-N threshold math (an old daemon_id that has been superseded at T
-- nodes cannot gather T signers for a real ceremony), not by any row in this table alone — this
-- table is what each node consults locally when deciding whether to let a given daemon_id
-- participate in an agent's ceremony.
--
-- Structurally mirrors agent_presence (V33): one mutable row per agent, no chain_hash (this is
-- high-churn coordination state, not an append-only trust record), sovereign-write-owned (each
-- node writes only what it is directly told by the daemon dialing it).

CREATE TABLE primary_holder (
  k_local_pubkey    TEXT PRIMARY KEY,                 -- the agent's stable Ed25519 identity
  holding_daemon_id TEXT NOT NULL,                     -- fresh per-device UUID minted at pairing time
  last_attested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),-- refreshed on each heartbeat from the holder
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- cello_service gets full DML (INSERT for the first attestation, UPDATE on transfer/heartbeat,
-- SELECT for the ceremony-gate read). RLS enabled; idempotent policy creation, matching V33/V43.
ALTER TABLE primary_holder ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'primary_holder'
      AND policyname = 'primary_holder_service'
  ) THEN
    CREATE POLICY primary_holder_service ON primary_holder
      TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT INSERT, SELECT, UPDATE, DELETE ON primary_holder TO cello_service;

-- Ceremony-gate read path: given (k_local_pubkey, daemon_id), is this daemon_id the current
-- holder? Index supports that exact lookup in addition to the primary key's own equality lookup
-- on k_local_pubkey (a covering index makes the daemon_id comparison an index-only check).
CREATE INDEX primary_holder_daemon_id_idx ON primary_holder(k_local_pubkey, holding_daemon_id);
