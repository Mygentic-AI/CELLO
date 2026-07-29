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
--   revoke branches after supersession → h8 (revoked AND superseded) downgrades to superseded
--   branch 4 without 'directory'      → h10 becomes permanently UNREVOCABLE
--
-- SAFE TO DEPLOY AHEAD OF THE WRITE-SIDE CHANGE. Every tombstone that exists today has
-- revoker_pubkey NULL, so branch 2 catches it and it reads exactly as it does now. The behavior
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

CREATE VIEW signal_records_effective AS
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
    -- 1. TOMBSTONE-ONLY → revoked. Fail-closed, and it preserves today's behavior exactly: with no
    --    record to judge against, a tombstone stands. Converges deny → allow when the record
    --    replicates in, which is the safe direction for a late correction. Without this a
    --    tombstone-only hash would read `active` and the directory would confirm as LIVE a hash it
    --    has only ever seen a revocation for.
    WHEN COUNT(*) FILTER (WHERE NOT r.is_tombstone) = 0 AND BOOL_OR(r.is_tombstone) THEN 'revoked'

    -- 2. LEGACY TOMBSTONE (no recorded revoker) → revoked. It was written under the old role-based
    --    rule and had its authority checked THEN; it keeps its old semantics rather than being
    --    re-judged by a rule younger than it is. Unreachable for agent-issued records today — which
    --    is precisely why §5a says to handle it anyway: unreachable is a property of today's data,
    --    not of the code. Omit it and the migration SILENTLY UN-REVOKES every existing revocation.
    WHEN BOOL_OR(r.is_tombstone AND r.revoker_pubkey IS NULL) THEN 'revoked'

    -- 3. A REAL (non-tombstone) row carrying status='revoked' → revoked. No writer produces this
    --    today, but UPDATE is granted, 'revoked' is in the column CHECK, and signal-write.ts already
    --    does `UPDATE … SET status='superseded'`. Measured: without this branch, h7 regresses from
    --    revoked to active.
    WHEN BOOL_OR(r.status = 'revoked' AND NOT r.is_tombstone) THEN 'revoked'

    -- 4. INSTITUTIONAL issuers keep ROLE-BASED authority. The general rule, stated so the next
    --    issuer_kind is not another one-off: role-based for INSTITUTIONS (portal, directory), whose
    --    keys are rotating instruments and where the institution — not the key — is the issuer;
    --    exact-pubkey for AGENTS, where the key IS the identity. An UNRECOGNISED future issuer_kind
    --    falls through to the agent (stricter) side, never to this escape.
    --    'directory' is included deliberately: V46 admits it, nothing issues it yet, and omitting it
    --    makes directory-issued records permanently unrevocable on the first key rotation (measured).
    WHEN BOOL_OR(r.is_tombstone)
         AND MIN(r.issuer_kind) FILTER (WHERE NOT r.is_tombstone) IN ('portal', 'directory') THEN 'revoked'

    -- 5. AGENT issuers: EXACT-PUBKEY authority — the tombstone's revoker must be the record's issuer.
    --    Two aggregates combined by an operator, which is legal SQL; `BOOL_OR(x = MIN(y))` is a
    --    NESTED aggregate and is not. COALESCE is required and is not decoration: ARRAY_AGG … FILTER
    --    over zero matching rows returns NULL (not '{}'), NULL && anything is NULL, and a NULL WHEN
    --    falls through to ELSE 'active' — which is how an earlier version of this expression FAILED
    --    OPEN while reading correctly.
    WHEN COALESCE(
           ARRAY_AGG(r.revoker_pubkey) FILTER (WHERE r.is_tombstone)
           && ARRAY_AGG(r.issuer_pubkey) FILTER (WHERE NOT r.is_tombstone), false) THEN 'revoked'

    -- ── EVERY revoke branch precedes supersession. Not stylistic: a record that is both revoked and
    --    superseded must read `revoked`, honoring V46's rule that revoked is the strongest
    --    statement. Measured — with supersession first, h8 downgrades to `superseded`, and a
    --    withdrawn endorsement that happened to have a successor would quietly weaken.
    WHEN EXISTS (
      SELECT 1 FROM signal_records s
       WHERE s.supersedes_hash = r.signal_hash
         AND s.status <> 'revoked'          -- a REVOKED replacement supersedes nothing
    ) THEN 'superseded'
    WHEN BOOL_OR(r.status = 'superseded') THEN 'superseded'
    ELSE 'active'
  END AS effective_status
FROM signal_records r
GROUP BY r.signal_hash;

GRANT SELECT ON signal_records_effective TO cello_service;
