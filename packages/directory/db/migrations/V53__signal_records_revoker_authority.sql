-- V53 — M10B / DOD-END-REVOKE-2: revocation AUTHORITY (M10B-D12r4, M10B-D28).
--
-- THE DEFECT (M10 DOD-REVOKE-1 review F6, deferred with "revisit with intake").
-- `revokeSignal` authorises on the generic `submitter` role and writes a tombstone that hardcodes
-- 'portal'/'(tombstone)', never reading the target. Harmless while every signal is portal-issued —
-- but the moment a person can issue an endorsement, ONE submitter key can tombstone ANYONE's
-- endorsement. Without this, D-19 (withdrawal) is nominal.
--
-- WHY THE FIX IS A READ-TIME JOIN AND NOT A WRITE-TIME CHECK. The tombstone INSERT is deliberately
-- BLIND — it never looks the target up — and that is load-bearing: it is the F3/F4 fix that lets a
-- revoke arriving BEFORE its record still converge under mesh replication. At write time the record
-- may not be at this node at all. So the authority decision moves into the view, where both rows are
-- present, and an unauthorised tombstone becomes INERT rather than rejected — which is what keeps
-- arrival order free.
--
-- ⚠️ THIS CHANGES A DOCUMENTED INVARIANT OF V46, AND THE STATEMENT BELONGS HERE.
-- V46's header says: "revoked — if ANY node's copy says revoked. Revocation is monotonic … this
-- converges regardless of arrival order." Under D-12r4 an UNAUTHORISED tombstone that lands first
-- reads `revoked` (branch 1, tombstone-only, fail-closed) and then reads `active` once the real
-- record replicates in — a revoked → active transition reachable through ordinary convergence with
-- no write. That is intended: the tombstone was never authorised, and branch 1 preserves today's
-- behavior only until there is a record to judge it against.
-- V46 IS NOT AMENDED. It is an APPLIED migration and Flyway checksums the whole file, comments
-- included; editing it would fail every node's Flyway run and crash-loop the ops-agent (M5
-- retrospective: "never modify an applied migration"). The migration that CHANGES the behavior is
-- the right place to document the change.
--
-- MEASURED, NOT ARGUED (the standing rule from Entries 11/15 — four earlier versions of this
-- expression were wrong and each read correctly in prose). Ten shapes, eighteen rows, run against
-- live Postgres inside V46's REAL view shape including its correlated-EXISTS supersession branch:
-- EXACTLY ONE changes, and it is the defect being fixed (revoker != issuer: revoked → active).
-- Each branch was then proven load-bearing by counterfactual:
--   supplement instead of replace → the fix is a NO-OP (h4 stays revoked)
--   drop the real-row-revoked branch → h7 regresses to active
--   ADD a "NULL revoker ⇒ revoked" branch → an agent record dies to ANY tombstone (the fix defeated)
--   revoke branches after supersession → h8 (revoked AND superseded) downgrades to superseded
--   branch 4 without 'directory'      → h10 becomes permanently UNREVOCABLE
--
-- SAFE TO DEPLOY AHEAD OF THE WRITE-SIDE CHANGE. Every record that exists today is portal-issued, so
-- branch 3's institutional escape carries every existing revocation unchanged — measured against the
-- live table (264 rows, zero agent-issued, zero tombstones), not assumed. The behavior
-- change is reachable only once something WRITES a revoker, which is the accompanying code change.

ALTER TABLE signal_records ADD COLUMN revoker_pubkey TEXT;

-- The pubkey the tombstone's inner authorization was signed BY. TEXT, not BYTEA, and that is forced:
-- `bytea[] && text[]` and `text[] && varchar[]` both error at CREATE VIEW time, and the overlap
-- operator below is the whole authority check.
COMMENT ON COLUMN signal_records.revoker_pubkey IS
  'M10B-D12r4: who authorised this tombstone (NULL for pre-M10B tombstones, which keep role-based semantics). Hex, lowercase.';

ALTER TABLE signal_records ADD COLUMN revoker_signature BYTEA;

-- ⚠️ AUDIT EVIDENCE, NOT A DEFENSE — labelled as such deliberately (M10B-D28, third review F6).
-- Logical replication applies ROWS and never re-runs revokeSignal, so a peer node accepts whatever
-- revoker_pubkey the originating node wrote. Persisting the signature makes a forged tombstone
-- DETECTABLE IN PRINCIPLE — and prevents nothing, because the read path is a SQL view and a view
-- cannot verify Ed25519. The compromised-node case remains OPEN. Claiming a mitigation that
-- mitigates nothing is worse than naming the residual, so it is named: closing it needs a verifier
-- (a subscriber-side validation pass, or verify-on-read before serving a `revoked` verdict).
COMMENT ON COLUMN signal_records.revoker_signature IS
  'M10B-D28: the inner authorization signature. AUDIT EVIDENCE ONLY — nothing verifies it; a view cannot check Ed25519.';

DROP VIEW IF EXISTS signal_records_effective;

-- ── The authority decision is computed ONCE, in a CTE, and the supersession branch CONSULTS it ──
-- Why this is not just tidiness (review F4, pre-existing since V46): the old supersession guard was
-- `s.status <> 'revoked'` — "a REVOKED replacement supersedes nothing" — and it has been INERT since
-- revocation became a tombstone, because the real row's status stays 'active'. Measured: Bob
-- endorses (v1), re-endorses (v2 supersedes v1), then WITHDRAWS v2 → v2 `revoked`, v1 `superseded`.
-- BOTH endorsements unpresentable, nothing saying so, and the subject simply has nothing.
--
-- The naive repair — "ignore a successor that has any tombstone" — introduces a RESURRECTION ATTACK:
-- an unauthorised tombstone on v2 would bring v1 back from `superseded`. So the successor must be
-- judged by the SAME authority rules, which is what the CTE makes possible without recursion.
CREATE VIEW signal_records_effective AS
WITH revoked_state AS (
  SELECT
    r.signal_hash,
    CASE
      WHEN COUNT(*) FILTER (WHERE NOT r.is_tombstone) = 0 AND BOOL_OR(r.is_tombstone) THEN true
      WHEN BOOL_OR(r.status = 'revoked' AND NOT r.is_tombstone) THEN true
      WHEN BOOL_OR(r.is_tombstone)
           AND MIN(r.issuer_kind) FILTER (WHERE NOT r.is_tombstone) IN ('portal', 'directory') THEN true
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
  MIN(r.subject)         FILTER (WHERE NOT r.is_tombstone) AS subject,
  MIN(r.issuer_kind)     FILTER (WHERE NOT r.is_tombstone) AS issuer_kind,
  MIN(r.issuer_pubkey)   FILTER (WHERE NOT r.is_tombstone) AS issuer_pubkey,
  MIN(r.type)            FILTER (WHERE NOT r.is_tombstone) AS type,
  MIN(r.supersedes_hash) FILTER (WHERE NOT r.is_tombstone) AS supersedes_hash,
  MIN(r.created_at)      FILTER (WHERE NOT r.is_tombstone) AS first_notarized_at,
  ARRAY_AGG(DISTINCT r.accepting_node) FILTER (WHERE NOT r.is_tombstone) AS notarized_by,
  MAX(r.revoked_at)      AS revoked_at,
  CASE
    -- The four revoke branches now live in `revoked_state` above, evaluated identically for this
    -- record and for any successor claiming to supersede it. They still precede supersession: a
    -- record that is both revoked and superseded reads `revoked`, honoring V46's rule that revoked
    -- is the strongest statement (measured — with supersession first it downgrades).
    WHEN rs.is_revoked THEN 'revoked'

    -- SUPERSEDED only by a successor that is not itself effectively revoked. Consulting
    -- `revoked_state` rather than the successor's raw `status` is what makes this real: the raw
    -- check has been inert since revocation became a tombstone, and judging the successor by the
    -- same authority rules is what stops an unauthorised tombstone on the successor from
    -- resurrecting its predecessor.
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
