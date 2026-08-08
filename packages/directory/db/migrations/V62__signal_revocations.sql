-- V62: signal_revocations — the revocation fact, in a form that replicates.
--
-- ─── The defect, which is worse than "revocation does not replicate" ────────────────────────────
-- A revocation is already written as a tombstone: `revokeSignal` INSERTs a signal_records row keyed
-- (signal_hash, 'revoke:' + node) with is_tombstone=true, status='revoked', and the revoker's pubkey
-- and signature.
--
-- That row has its own natural key, so anti-entropy DOES replicate it. But `applyTierA` inserts only
-- the spec's immutableColumns, and is_tombstone / status / revoker_pubkey / revoker_signature are
-- not among them. So on every peer the tombstone lands with is_tombstone defaulted to FALSE and
-- status defaulted to 'active'.
--
-- Two consequences, both bad, and the second is not a gap but active corruption:
--   1. The revocation has no effect there — signal_records_effective decides from is_tombstone and
--      the revoker columns, none of which arrived.
--   2. The row now counts as a REAL (non-tombstone) row in that view's aggregations, so its
--      placeholder descriptive values — issuer_pubkey '(tombstone)', type '(tombstone)' — pollute
--      the subject_kind / issuer_kind / type reported for that signal. Which is precisely what
--      is_tombstone exists to prevent.
--
-- ─── Why not just add the columns to the hashed set ─────────────────────────────────────────────
-- Because it changes the content address of every existing signal_records row, so all three nodes
-- would report divergence on data that never changed. Same trap V58 documents and sidesteps.
--
-- ─── The shape ─────────────────────────────────────────────────────────────────────────────────
-- A separate append-only table whose columns are all immutable, so Tier A carries it with no merge
-- rule — the same shape as V59/V60 and as agent_revocations before them. The existing tombstone row
-- stays exactly as it is: it is what the LOCAL node writes and what the authority check has always
-- read. This table is how the fact reaches the other two.
--
-- Keyed (signal_hash, revoker_pubkey): one revocation per revoker per signal. Two different
-- authorities revoking the same signal are two facts, not a conflict, and the exact-pubkey authority
-- check in the view needs to see each of them.

CREATE TABLE IF NOT EXISTS signal_revocations (
  signal_hash       TEXT         NOT NULL,
  -- WHO revoked. Branch 4 of the authority check compares this against the signal's issuer_pubkey,
  -- so it is the column the whole table exists to carry.
  revoker_pubkey    TEXT         NOT NULL,
  -- The signature over the revocation. Carried so any node can re-verify the fact independently
  -- rather than trusting the peer that sent it — the same reason agent_revocations keeps its
  -- signature.
  --
  -- BYTEA, matching signal_records.revoker_signature. Declaring it TEXT compiled, migrated, and then
  -- failed at the first real revocation with `invalid byte sequence for encoding UTF8: 0x00` —
  -- caught only by running the integration suite against a real Postgres, because every unit test
  -- stubs the pool. revoker_pubkey really is TEXT; the two columns differ and the pair reads as
  -- though it should not.
  revoker_signature BYTEA        NOT NULL,
  -- Per-node wall clock, deliberately NOT part of the replicated identity (see the spec).
  recorded_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT signal_revocations_pkey PRIMARY KEY (signal_hash, revoker_pubkey)
);

CREATE INDEX IF NOT EXISTS idx_signal_revocations_hash
  ON signal_revocations (signal_hash);

-- ─── backfill from the tombstones this node already holds ───────────────────────────────────────
-- Per node, from whatever it has. Each contributes the revocations it alone recorded and
-- anti-entropy unions them — the property that lets a split set heal with no coordination.
--
-- Tombstones written before V53 have no revoker columns. They are skipped, deliberately: a NULL
-- revoker is not authority, and V54 removed the "NULL revoker => revoked" branch precisely because
-- it handed an attacker a role-based escape on the records the authority check protects. Those
-- legacy revocations are still honoured by branch 3 (institutional issuers) from the local
-- tombstone, which this migration does not touch.
INSERT INTO signal_revocations (signal_hash, revoker_pubkey, revoker_signature)
  SELECT signal_hash, revoker_pubkey, revoker_signature
    FROM signal_records
   WHERE is_tombstone
     AND revoker_pubkey IS NOT NULL
     AND revoker_signature IS NOT NULL
ON CONFLICT (signal_hash, revoker_pubkey) DO NOTHING;

ALTER TABLE signal_revocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS insert_only ON signal_revocations;
  DROP POLICY IF EXISTS select_all ON signal_revocations;
END $$;

CREATE POLICY insert_only ON signal_revocations
  FOR INSERT TO cello_service WITH CHECK (true);

CREATE POLICY select_all ON signal_revocations
  FOR SELECT TO cello_service USING (true);

-- No UPDATE, no DELETE. A revocation is permanent — un-revoking is not an operation this system has.
GRANT INSERT, SELECT ON signal_revocations TO cello_service;

-- ─── the view now consults BOTH sources ─────────────────────────────────────────────────────────
--
-- Every branch below is the V54/V55 logic unchanged in meaning. The ONLY change is where "is there a
-- tombstone" and "who revoked" come from: previously the local signal_records tombstone alone, now
-- the UNION of that and the replicated fact. A node that never saw the tombstone but received the
-- fact now reaches the same verdict as the node that recorded it.
--
-- ⚠️ THE FAIL-OPEN DIRECTION IS THE ONE THAT MATTERS. A missed revocation leaves a withdrawn signal
-- reading as live; a spurious one only hides a signal that can be re-minted. Two earlier versions of
-- this expression failed open (V53's NULL-revoker branch, and an ARRAY_AGG over zero rows returning
-- NULL and falling through to ELSE). Both are preserved against below — the COALESCE is load-bearing
-- for exactly that reason, and there is still deliberately NO "NULL revoker => revoked" branch.
CREATE OR REPLACE VIEW signal_records_effective AS
WITH tomb AS (
  -- Union, not either/or: a node may hold the local tombstone, the replicated fact, or both. DISTINCT
  -- via UNION so a hash with both does not double-count in the arrays below.
  SELECT signal_hash, revoker_pubkey FROM signal_revocations
  UNION
  SELECT signal_hash, revoker_pubkey FROM signal_records WHERE is_tombstone
),
agg AS (
  SELECT
    r.signal_hash,
    COUNT(*) FILTER (WHERE NOT r.is_tombstone)                          AS real_rows,
    BOOL_OR(r.status = 'revoked' AND NOT r.is_tombstone)                AS real_revoked,
    MIN(r.issuer_kind) FILTER (WHERE NOT r.is_tombstone)                AS real_issuer_kind,
    ARRAY_AGG(r.issuer_pubkey) FILTER (WHERE NOT r.is_tombstone)        AS real_issuer_pubkeys
  FROM signal_records r
  GROUP BY r.signal_hash
),
revoked_state AS (
  SELECT
    a.signal_hash,
    CASE
      -- 1. TOMBSTONE-ONLY → revoked. Fail-closed: with no record to judge against, a tombstone
      --    stands, and it converges deny → allow when the record replicates in.
      WHEN a.real_rows = 0
           AND EXISTS (SELECT 1 FROM tomb t WHERE t.signal_hash = a.signal_hash) THEN true
      -- 2. A real (non-tombstone) row carrying status='revoked'.
      WHEN a.real_revoked THEN true
      -- ⚠️ THERE IS DELIBERATELY NO "NULL REVOKER => REVOKED" BRANCH. V54 removed it because a
      --    missing revoker is not a property of AGE — nothing distinguishes a pre-V53 tombstone from
      --    one written a minute ago with the fields omitted — so it handed every attacker a
      --    role-based escape on exactly the records the authority check protects.
      -- 3. INSTITUTIONAL issuers keep ROLE-BASED authority — their keys are rotating instruments.
      WHEN EXISTS (SELECT 1 FROM tomb t WHERE t.signal_hash = a.signal_hash)
           AND a.real_issuer_kind IN ('portal', 'directory') THEN true
      -- 4. AGENT issuers: EXACT-PUBKEY authority (DOD-END-REVOKE-2, M10 F6). COALESCE is load-bearing
      --    — ARRAY_AGG over zero rows is NULL, a NULL WHEN falls through to ELSE, and that is how an
      --    earlier version of this expression failed OPEN.
      WHEN COALESCE(
             (SELECT ARRAY_AGG(t.revoker_pubkey) FROM tomb t WHERE t.signal_hash = a.signal_hash)
             && a.real_issuer_pubkeys, false) THEN true
      ELSE false
    END AS is_revoked
  FROM agg a
)
SELECT
  r.signal_hash,
  MIN(r.subject_kind)    FILTER (WHERE NOT r.is_tombstone) AS subject_kind,
  MIN(r.issuer_kind)     FILTER (WHERE NOT r.is_tombstone) AS issuer_kind,
  MIN(r.issuer_pubkey)   FILTER (WHERE NOT r.is_tombstone) AS issuer_pubkey,
  MIN(r.type)            FILTER (WHERE NOT r.is_tombstone) AS type,
  MIN(r.supersedes_hash) FILTER (WHERE NOT r.is_tombstone) AS supersedes_hash,
  MIN(r.created_at)      FILTER (WHERE NOT r.is_tombstone) AS first_notarized_at,
  ARRAY_AGG(DISTINCT r.accepting_node) FILTER (WHERE NOT r.is_tombstone) AS notarized_by,
  MAX(r.revoked_at)      AS revoked_at,
  CASE
    WHEN rs.is_revoked THEN 'revoked'
    -- Superseded only by a successor that is not itself effectively revoked — judged by the SAME
    -- rules, which is what stops an unauthorised tombstone on a successor from resurrecting its
    -- predecessor (V54, review F4).
    WHEN EXISTS (
      SELECT 1 FROM signal_records s
        JOIN revoked_state srs ON srs.signal_hash = s.signal_hash
       WHERE s.supersedes_hash = r.signal_hash
         AND NOT srs.is_revoked
    ) THEN 'superseded'
    WHEN BOOL_OR(r.status = 'superseded') THEN 'superseded'
    ELSE 'active'
  END AS effective_status
FROM signal_records r
JOIN revoked_state rs ON rs.signal_hash = r.signal_hash
GROUP BY r.signal_hash, rs.is_revoked;

GRANT SELECT ON signal_records_effective TO cello_service;
