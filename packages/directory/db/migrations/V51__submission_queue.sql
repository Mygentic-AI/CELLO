-- V51 — M10B / DOD-END-QUEUE-1: the sealed submission queue (M10B-D2).
--
-- WHAT THIS IS. The client-supplied arm of the trust-signal pipe. Bob's daemon signs an endorsement
-- with his agent key, SEALS it to the portal's intake key, and drops it here. The portal drains,
-- opens the seal, verifies the signature, derives issuer_pubkey FROM that signature, scans, and mints
-- through the UNCHANGED chokepoint. This table is a mailbox the directory cannot read.
--
-- THE ABSENCES ARE THE DESIGN. Five columns. No agent_id, no submitter, no subject, no signal_kind,
-- no type, no plaintext, no reason column. Compare pickup_queue, which carries agent_id because
-- delivery must be ADDRESSED — a submission is not addressed, it is COLLECTED by a single consumer
-- (the portal) that can poll every node, so it needs no addressee. That difference is what makes
-- DOD-END-DISCOVER-1's "a directory operator cannot infer who endorsed whom" achievable here rather
-- than aspirational. A schema test asserts this column set EXACTLY (not an absence list — an absence
-- list passes trivially against a column called `meta` holding the same data).
--
-- NO submitting_agent_id, deliberately. Persisting it would hand a directory operator "Bob submitted
-- five endorsements" — not to whom, but still the metadata shape DOD-END-DISCOVER-1 is written
-- against. Flood protection runs at the authenticated signaling handler off the live connection
-- identity (the /cello/signaling/1.0.0 challenge-response yields a verified authedPubkeyHex), never
-- off a persisted column. Accepted cost: a node restart resets flood counters. That is tolerable
-- because it is not the real limit — DOD-END-QUOTA-1 at the portal is, and it is per-account and
-- durable.
--
-- NOT REPLICATED (M10B-D21). This table is deliberately absent from cello_pub, the same posture as
-- V40__pre_auth_nonce_bindings. Three reasons:
--   1. A replicated queue lets the portal drain the same row from node B while its ack to node A is
--      still in flight — double-drain, hence double-mint and double quota consumption.
--   2. Fewer copies of a sealed secret: replication would put Bob's blob on all three nodes.
--   3. It is a mailbox, not consortium state. Replicating it would be the directory composing
--      something (INV-DIR-DUMB).
-- Accepted loss: a submission on a permanently dead node. Recoverable by re-submitting; the thing
-- that must never be lost is the NOTARIZED record, and signal_records IS replicated.
-- Consequence for the portal drain: draining means "collect from ALL nodes", not "try until one
-- succeeds". A drain built on FailoverDirectoryClient#tryEach silently collects from one node and
-- reports success.
--
-- submission_id IS THE PK, and it is sha256 of the SIGNED submission body (M10B-D20). Content-derived,
-- so a daemon retry to a different node produces the SAME id and the portal mints once — which is what
-- makes retry-on-node-failure safe rather than a duplication mechanism. A legitimate re-issue after a
-- refusal differs, because issued_at is inside the signed body.
--   CAVEAT, and it is load-bearing: this id is CALLER-SUPPLIED and the directory CANNOT verify it —
--   it cannot open the seal. So the PORTAL derives submission_id from the opened body and treats this
--   column as a routing hint only, discarding any row whose id disagrees. Exactly-once is a PORTAL
--   property (a processed-submissions record keyed on the derived id); this queue promises only
--   at-least-once. Even a perfect queue cannot cover the portal crashing between mint and ack.
--
-- intake_key_id (M10B-D11): which portal intake key the blob is sealed to, so key rotation does not
-- strand queued submissions — the portal retains a rotated-out private key until no undrained row
-- references it. Retention is driven by THIS COLUMN, not by a timer.

CREATE TABLE IF NOT EXISTS submission_queue (
  submission_id  TEXT        PRIMARY KEY,
  intake_key_id  TEXT        NOT NULL,
  ciphertext     BYTEA       NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The drain reads oldest-first across the whole table (one consumer, no per-agent scoping — there is
-- no agent column by design). Ordering by (created_at, submission_id) is total and stable.
CREATE INDEX IF NOT EXISTS idx_submission_queue_drain
  ON submission_queue (created_at, submission_id);

-- ─── RLS + grants (match V34/V33: permissive cello_service policy; app-level scoping) ──────────────
-- There is no per-tenant scoping to enforce here: the table holds no tenant identifier at all, which
-- is the point. RLS stays permissive for the shared cello_service role, matching every other
-- directory table.
ALTER TABLE submission_queue ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'submission_queue'
      AND policyname = 'submission_queue_service'
  ) THEN
    EXECUTE 'CREATE POLICY submission_queue_service ON submission_queue FOR ALL TO cello_service USING (true) WITH CHECK (true)';
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON submission_queue TO cello_service;
