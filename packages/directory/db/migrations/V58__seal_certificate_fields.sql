-- DOD-TERMINAL-STATE-DIVERGENCE-1 — the fields a client needs to VERIFY a seal it was never told about.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────────
-- `session_sealed` is PUSHED to each party over its authenticated directory signaling stream, and it
-- has no pull twin. If that stream is down when the directory pushes, the frame is simply lost: the
-- re-delivery queue (`notification_queue`) is per-node while clients roam across nodes, so a client
-- that reconnects elsewhere drains an empty queue and never learns. Measured on a live agent
-- 2026-08-05: three connections in one day, to three different nodes.
--
-- The session IS notarized and the counterparty holds a valid receipt; the missed party holds an
-- `interrupted` row and can never produce one. `cello_close_session` then answers
-- `session_already_sealed` and `cello_sealed_receipt` answers `not_sealed_yet` — both true, pointing
-- at each other, and the only exit an operator finds is a force-abandon that PERMANENTLY forfeits
-- their half of a receipt that exists on the other side.
--
-- ── WHY A NEW TABLE AND NOT COLUMNS ON `seal_notarizations` ───────────────────────────────────────
-- The three fields below are the ones missing from `seal_notarizations` (V12/V31), and the obvious
-- move is to ALTER that table. It is the wrong move, twice over:
--
--   1. HASH CHAIN. `seal_notarizations` is hash-chained. A new column is read back as its default on
--      every pre-existing row whose `chain_hash` was computed without it, so `verifyChain` breaks for
--      every historical notarization. This has already happened twice — `sessions` at V29 and
--      `seal_notarizations` itself at V31 — and both were resolved by EXCLUDING the column from the
--      chain, i.e. by not really adding it.
--   2. ANTI-ENTROPY, which is worse. The Tier-A record hash is built from the spec's
--      `immutableColumns`. These fields must replicate (the whole point is that ANY node can answer,
--      not just the one that adjudicated), so they would have to join that set — which changes the
--      record hash of every historical row, making all three nodes report divergence on data that
--      never changed. And during a node-by-node roll the old and new code disagree with each other
--      for the entire window.
--
-- A NEW table has no historical rows, so there is no chain to break, no record hash to change, and
-- no mixed-version disagreement while the fleet rolls. Same outcome, none of the hazard.
--
-- ── NOT HASH-CHAINED, DELIBERATELY ────────────────────────────────────────────────────────────────
-- Unlike `seal_notarizations` this table carries no `chain_hash`. Its integrity target is already
-- covered by something stronger: every field here is inside the TBS that the FROST signature signs,
-- and the CLIENT re-verifies that signature (`verifyBilateralSealCertificate`) before recording
-- anything. A directory that tampered with `legibility` or `leaf_count` produces a certificate that
-- fails verification on the client — a chain hash would add a directory-side check on data whose
-- truth the recipient already establishes independently. Chaining also has a specific failure mode in
-- the AE apply path (`conversation_seals.chain_hash` is NOT NULL with no default, so every apply
-- RAISED and the table never converged until it was fixed), and that risk buys nothing here.
--
-- ── NOT RETROACTIVE, AND THAT IS NOT FIXABLE ──────────────────────────────────────────────────────
-- Sessions sealed BEFORE this migration never had these values recorded — they were computed at seal
-- time and discarded. No row can be reconstructed for them, so a client stranded today stays
-- stranded. This prevents future occurrences only, and must not be described as repairing past ones.
CREATE TABLE IF NOT EXISTS seal_certificate_fields (
  -- Matches `seal_notarizations.session_id` (BYTEA, 16 bytes). Not a FK: the AE apply order across
  -- nodes is not guaranteed, and a FK would make this table's convergence depend on another's.
  session_id      BYTEA       NOT NULL,
  -- Discriminates a unilateral certificate from the bilateral one that supersedes it — the same
  -- axis as `seal_notarizations.seal_type`, and the reason that table's natural key is
  -- (session_id, seal_type) rather than session_id alone. Both can exist for one session.
  seal_type       TEXT        NOT NULL DEFAULT 'bilateral',
  -- The three fields the client needs and the directory currently throws away. All three are inside
  -- the signed TBS, which is why their absence makes a pulled certificate unverifiable rather than
  -- merely incomplete.
  --
  -- BIGINT, not INTEGER, and that is an anti-entropy requirement rather than a range one. This table
  -- replicates Tier-A, and `recordHash` REFUSES a JS `number` (2^53 aliasing) — it takes only
  -- string|boolean|null. `pg` returns INTEGER as a number and BIGINT as a string, so INTEGER here
  -- would fail the record hash the moment the row tried to replicate.
  leaf_count      BIGINT      NOT NULL,
  -- The initiator's primary (group) public key — the key the FROST signature verifies against.
  -- Hex-encoded at the AE SELECT like every other BYTEA (see the `bytea` list on the table spec).
  signer_pubkey   BYTEA       NOT NULL,
  -- TEXT, holding the JSON verbatim — NOT JSONB, and this one is a correctness requirement.
  --
  -- `legibility` is BOUND INTO THE SIGNED TBS: the client re-derives the hash over it and checks the
  -- FROST signature. JSONB does not preserve what it was given — it normalises whitespace, drops
  -- duplicate keys and REORDERS them. A round-trip through JSONB therefore returns bytes that differ
  -- from the bytes that were signed, and every pulled certificate would fail verification for a
  -- reason no log would name. TEXT stores exactly what the seal path serialised.
  --
  -- It also has to be a string for the AE record hash, for the same reason as leaf_count.
  legibility      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, seal_type)
);

-- The only read path: "give me the certificate fields for this session". The PK already serves it;
-- this index exists for the unqualified lookup that does not know the seal_type yet.
CREATE INDEX IF NOT EXISTS idx_seal_certificate_fields_session
  ON seal_certificate_fields (session_id);

-- ─── RLS + grants (match V56/V51/V34: permissive cello_service policy; app-level scoping) ─────────
-- The participant check lives in the request handler, not the policy — there is one shared service
-- role and no per-agent DB identity to bind a policy to, exactly as for every other table here.
ALTER TABLE seal_certificate_fields ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'seal_certificate_fields'
      AND policyname = 'seal_certificate_fields_service'
  ) THEN
    EXECUTE 'CREATE POLICY seal_certificate_fields_service ON seal_certificate_fields FOR ALL TO cello_service USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- NO UPDATE, NO DELETE. These fields describe a notarization that has already happened and been
-- signed; a row that can be rewritten is a certificate the client cannot rely on. Append-only is
-- enforced by the absent grant rather than by convention, and the AE apply uses ON CONFLICT DO
-- NOTHING so a re-delivered row is a no-op rather than a rewrite.
-- `cello_service` is the ONE role the node connects as — there is no separate node role, and
-- granting to an invented one fails the migration on every node at container start. `postgres` owns
-- the schema and runs Flyway; everything the running directory does, it does as `cello_service`.
GRANT SELECT, INSERT ON seal_certificate_fields TO cello_service;
