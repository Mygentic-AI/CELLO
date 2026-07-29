-- V55 — the directory stops storing the EDGE. It holds hashes; it is not a graph.
--
-- WHAT COMES OUT: `subject` — WHO a signal is about.
--
-- WHAT STAYS, AND WHY IT IS NOT A HALF-MEASURE. `issuer_pubkey` remains, and dropping `subject`
-- alone is sufficient to destroy the edge: a graph needs both ends, and without the subject a node
-- operator sees only "this key issued an endorsement", never about whom. The pairing — the thing
-- that made the endorsement graph readable off a replicated table — is gone.
--
-- `issuer_pubkey` is held back deliberately rather than overlooked. `DOD-END-REVOKE-2` requires
-- "exact-`issuer_pubkey` auth for `issuer_kind: agent`", and that check — the M10 F6 fix landed in
-- V53/V54 — compares a tombstone's `revoker_pubkey` against this column. Dropping it would silently
-- revert that fix and return the directory to "any submitter key can tombstone anyone's
-- endorsement". Whether the issuer identity should ALSO leave, with revoke authority moving entirely
-- to the portal (which `M10B-D12r3` already names as primary enforcement), is a real decision with a
-- real cost, and it is not one to make as a side effect of a column drop. It is journaled as an open
-- question rather than settled here.
--
-- THE PRINCIPLE. Everything a signal asserts — both parties included — is in the plaintext envelope.
-- That envelope is hashed; the HASH goes to the directory; the PLAINTEXT goes to the daemon. Anyone
-- who wants to know who endorsed whom checks the envelope they were shown against the notarized
-- hash. The directory does not need a queryable record of the relationship to make that work, and
-- holding one means every node operator can read the whole endorsement graph off a replicated table
-- with a single SELECT.
--
-- WHY THE COLUMNS EXISTED AT ALL, since this is the part that makes the removal safe rather than
-- brave. Exactly one consumer used them: `/internal/active-signals/<accountId>`, a convenience read
-- for the PORTAL — "what signals does this account have?" — which forces the directory to store the
-- edge so it can answer on someone else's behalf. The portal composes the plaintext and mints the
-- signal, so it already knows the type, the subject and the account. It now records that itself
-- (`minted_signals`) and asks the directory only `/internal/signals/active-among`: of THESE hashes,
-- which are live? That question needs nothing but the hash.
--
-- The notary path never used them. `signal-present.ts` — the check that runs when a counterparty
-- presents a signal — is `SELECT signal_hash … WHERE signal_hash = ANY($1) AND effective_status =
-- 'active'`. Hash in, hash out. Verification is unaffected by this migration.
--
-- WHAT THIS COSTS, STATED PLAINLY: the read-time revoke-authority check in V54 compared a
-- tombstone's `revoker_pubkey` against the record's `issuer_pubkey`. Without that column the
-- directory can no longer judge authority, so enforcement moves entirely to the portal — which
-- `M10B-D12r3` already names as primary ("primary enforcement is the portal verifying Bob's inner
-- authorization before it signs"); the directory's check was explicitly defense-in-depth against a
-- compromised or second submitter key. That defense is given up here, deliberately, in exchange for
-- not holding the graph. `revoker_pubkey` is kept: it is the tombstone's own authorization, not a
-- statement about a third party, and it is what makes a revocation auditable after the fact.
--
-- `subject_kind` and `type` STAY. Neither names a party — they are shape and category, they carry no
-- relationship, and `supersedes_hash` chains need `type` to remain meaningful. The edge is the pair
-- of identities, and that is what leaves.

-- THE VIEW GOES FIRST. It projects both columns and uses `issuer_pubkey` in its authority branch, so
-- Postgres refuses the DROP COLUMN while it exists ("cannot drop column subject … view
-- signal_records_effective depends on it"). Dropping the view first is also safer than
-- DROP ... CASCADE, which would silently take any other dependent object with it.
DROP VIEW IF EXISTS signal_records_effective;

ALTER TABLE signal_records DROP COLUMN subject;

CREATE VIEW signal_records_effective AS
WITH revoked_state AS (
  SELECT
    r.signal_hash,
    CASE
      -- 1. TOMBSTONE-ONLY → revoked. Fail-closed: with no record to judge against, a tombstone
      --    stands, and it converges deny → allow when the record replicates in.
      WHEN COUNT(*) FILTER (WHERE NOT r.is_tombstone) = 0 AND BOOL_OR(r.is_tombstone) THEN true
      -- 2. A real (non-tombstone) row carrying status='revoked'.
      WHEN BOOL_OR(r.status = 'revoked' AND NOT r.is_tombstone) THEN true
      -- ⚠️ THERE IS DELIBERATELY NO "NULL REVOKER => REVOKED" BRANCH. V54 removed it because a
      --    missing revoker is not a property of AGE — nothing distinguishes a pre-V53 tombstone from
      --    one written a minute ago with the fields omitted — so it handed every attacker a
      --    role-based escape on exactly the records the authority check protects. Branch 3 below
      --    already carries every institutional legacy revocation, which is all that exists.
      --    I re-introduced it while writing this migration and the regression test caught it.
      -- 3. INSTITUTIONAL issuers keep ROLE-BASED authority — their keys are rotating instruments.
      WHEN BOOL_OR(r.is_tombstone)
           AND MIN(r.issuer_kind) FILTER (WHERE NOT r.is_tombstone) IN ('portal', 'directory') THEN true
      -- 4. AGENT issuers: EXACT-PUBKEY authority. This is DOD-END-REVOKE-2's requirement and the M10
      --    F6 fix; it is why `issuer_pubkey` stays. COALESCE is load-bearing — ARRAY_AGG…FILTER over
      --    zero rows is NULL, and a NULL WHEN falls through to ELSE, which is how an earlier version
      --    of this expression failed OPEN.
      WHEN COALESCE(
             ARRAY_AGG(r.revoker_pubkey) FILTER (WHERE r.is_tombstone)
             && ARRAY_AGG(r.issuer_pubkey) FILTER (WHERE NOT r.is_tombstone), false) THEN true
      ELSE false
    END AS is_revoked
  FROM signal_records r
  GROUP BY r.signal_hash
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
