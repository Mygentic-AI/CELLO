-- V54 — M10B / DOD-END-REVOKE-2 (review F4): supersession must consult EFFECTIVE status.
--
-- ⚠️ WHY THIS IS A NEW MIGRATION AND NOT AN EDIT TO V53. V53 is APPLIED — it reached all three
-- regions through the pipeline while this change was still local. Flyway checksums the entire file,
-- so editing it produces a checksum mismatch on every node; `docker-entrypoint.sh` runs
-- `flyway migrate` under `set -e`, which means the entrypoint aborts BEFORE `exec node` and the
-- directory CRASH-LOOPS IN ALL THREE REGIONS AT ONCE. That is the FEDERATION-002 shape the M5
-- retrospective exists for, and this migration is the correction: V53 stays byte-identical to what
-- was deployed, and the behavior change lands here.
--
-- THE DEFECT (pre-existing since V46, surfaced by the REVOKE-2 review).
-- V46's supersession guard is `s.status <> 'revoked'`, commented "a REVOKED replacement supersedes
-- nothing". It has been INERT since revocation became a tombstone: the tombstone carries the
-- 'revoked' status while the real notarization row is deliberately left 'active', so the guard only
-- fires for a direct `UPDATE … SET status='revoked'` that no writer performs.
--
-- Measured consequence, on live Postgres: Bob endorses (v1), re-endorses (v2 supersedes v1), then
-- WITHDRAWS v2 → v2 `revoked`, v1 `superseded`. **Both unpresentable, with nothing saying so.** A
-- withdrawal silently destroys the endorsement it replaced — in one of the two mechanisms M10B
-- exists to add.
--
-- REJECTED: "ignore a successor that has any tombstone". That is a RESURRECTION ATTACK — an
-- unauthorised tombstone on the successor would bring its predecessor back, letting a write nobody
-- authorised change what a third party can present. The successor has to be judged by the SAME
-- authority rules as the record itself, which the CASE cannot self-reference.
--
-- SO: revoked-ness is computed ONCE in a CTE and the supersession branch consults it. No recursion,
-- one definition of authority, and the successor is judged exactly as the record is.
--
-- MEASURED, all four shapes (the standing rule from Entries 11/15):
--   successor withdrawn by its own issuer → predecessor returns to `active`   ← the fix
--   successor tombstoned by an IMPOSTOR   → predecessor stays `superseded`    ← no resurrection
--   ordinary supersession                 → unchanged
--   revoked AND superseded                → `revoked` (ordering preserved)
--
-- The columns V53 added are untouched; this migration replaces the VIEW only.

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
