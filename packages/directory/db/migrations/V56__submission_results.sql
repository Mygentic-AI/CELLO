-- M10B / DOD-END-INGRESS-1, `M10B-D25r2` — the RETURN PATH.
--
-- A submitter hands the directory a sealed submission and, today, learns nothing further. It may be
-- minted, refused by the subject, rejected by the scan, or found unattributable — and in every case
-- the issuing agent is told the same thing: nothing. That is the gap that keeps `DOD-END-INGRESS-1`
-- amber, and it is most acute for `op: refuse`, where the SUBJECT deliberately wrote a message back
-- to the issuer explaining why they would not stand behind the claim (`M10B-D4`). Dropping that
-- message is worse than never offering the verb.
--
-- ── THE DIRECTORY STILL CANNOT READ IT ────────────────────────────────────────────────────────────
-- `ciphertext` is sealed to the ISSUER's k_local key, exactly as `submission_queue` is sealed to the
-- portal's intake key. A refusal message is the subject's private words about somebody else's claim;
-- putting it in the clear here would hand the directory the one thing the sealed-submission path
-- exists to keep from it, on the return leg. The columns outside the seal are routing and outcome
-- only — no message, no payload, no PII.
--
-- ── PK CARRIES THE NODE (review F1) ───────────────────────────────────────────────────────────────
-- `(submission_id, accepting_node)`, not `submission_id` alone. Submissions are accepted per node and
-- this table REPLICATES, so a bare `submission_id` PK would make two nodes' rows for the same
-- submission collide on merge — one silently overwriting the other's outcome. Same shape as
-- `signal_records`.
CREATE TABLE IF NOT EXISTS submission_results (
  submission_id  TEXT        NOT NULL,
  accepting_node TEXT        NOT NULL,
  -- WHO MAY READ THIS. The issuer's k_local pubkey, taken from the AUTHENTICATED submission (the
  -- signature established it), never from a request field — reading it from anywhere else is the
  -- INV-ATTRIBUTION defect that lets one agent collect another's results.
  issuer_pubkey  TEXT        NOT NULL,
  -- What the portal decided: minted | rejected | refused | poison. Kept as text rather than an enum
  -- so a new outcome needs no migration (INV-ZERO-BUMP applies to this axis too).
  outcome        TEXT        NOT NULL,
  -- A short machine reason (`subject_not_registered`, `scan_refused`, …). NEVER free text from a
  -- submitter, and never the refusal message — that rides in the seal.
  reason         TEXT,
  -- Set only when the outcome was `minted`, so the issuer can name what their submission became.
  signal_hash    TEXT,
  -- The sealed reply, when there is one. NULL for outcomes that carry no message.
  ciphertext     BYTEA,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, accepting_node)
);

-- The issuer polls "what happened to what I submitted", oldest-first. Ordering by
-- (created_at, submission_id) is total and stable.
CREATE INDEX IF NOT EXISTS idx_submission_results_issuer
  ON submission_results (issuer_pubkey, created_at, submission_id);

-- ─── RLS + grants (match V51/V34/V33: permissive cello_service policy; app-level scoping) ──────────
-- Scoping to an issuer is done in the query, not the policy, matching every other directory table —
-- there is one shared service role and no per-tenant DB identity to bind a policy to.
ALTER TABLE submission_results ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'submission_results'
      AND policyname = 'submission_results_service'
  ) THEN
    EXECUTE 'CREATE POLICY submission_results_service ON submission_results FOR ALL TO cello_service USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- NO UPDATE GRANT. A result is written once and read many times: an outcome that can be rewritten is
-- an outcome the issuer cannot rely on, and the absence of the grant is what makes "first writer
-- wins" enforceable at the database rather than merely intended by `ON CONFLICT DO NOTHING`.
-- DELETE is granted for the sweep that retires results the issuer has already collected.
GRANT SELECT, INSERT, DELETE ON submission_results TO cello_service;
