-- V46 — signal_records + authorized_issuers: the directory's notary ledger and the chokepoint's key
-- set. M10 / DOD-STORE-DIR-1.
-- Spec-of-record: docs/planning/user-stories/m10/M10-TRUST-SIGNAL-STORAGE-AND-CREATION.md §3, §14.1.
-- Determination: docs/planning/user-stories/m10/M10-PORTAL-ARCH-DETERMINATION.md §3.
--
-- ── What this table is, and what it deliberately is NOT ─────────────────────────────────────────
-- The directory is a DUMB NOTARY (DOD-INV-DIR-DUMB). It stores the HASH of a trust signal plus the
-- minimum metadata needed to answer two mechanical questions at presentation time:
--
--   1. Does this hash exist here?
--   2. Is it still good — i.e. not revoked and not superseded?
--
-- EXPIRY IS NOT ONE OF THEM. `expires_at` lives inside the envelope (hashed), and the VERIFIER
-- evaluates it against the clock. The directory neither stores nor interprets it: nothing has to run
-- for a signal to expire (spec §14.2), and a directory that computed expiry would be evaluating
-- content. Do not look for an expiry column here; there isn't one, and that is the design.
--
-- It stores NO envelope plaintext, NO payload, NO PII. The content lives only with the holder, in
-- their encrypted wallet, disclosed selectively at introduction. A directory that held the content
-- could read every operator's phone number and email domain; one that holds only hashes cannot, even
-- if fully compromised. The convenient payload column is absent and must stay absent — a test asserts
-- the column set EXACTLY, so any new column goes red and has to be justified.
--
-- ── type IS AN OPAQUE STRING. THIS IS THE ZERO-BUMP INVARIANT (DOD-INV-ZERO-BUMP) ───────────────
-- There is deliberately NO CHECK constraint on `type`, no enum, and no index predicated on a type
-- VALUE. M10's whole architectural claim is that a NEW SIGNAL TYPE requires no code change and no
-- deploy anywhere except the portal — proven by the zero-bump canary, which takes a type this
-- directory has never seen from nothing to live while the directory's git tree stays clean. A
-- `CHECK (type IN (...))` here would silently defeat it: the day the portal invents a type, this
-- table would reject it, and the failure would surface three hops away as a mint error.
--
-- The KIND fields (`subject_kind`, `issuer_kind`, `status`) ARE constrained — they are protocol-level
-- enumerations fixed by the spec, and adding a signal type touches none of them. `type` is the only
-- open axis. That asymmetry is the rule, not an excuse for an unconstrained schema.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠️ MULTI-MASTER SAFETY. READ THIS BEFORE CHANGING THE PRIMARY KEY. ─────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The three sovereign nodes replicate in a FULL MESH: each runs TWO independent subscriptions, one
-- per peer (infra/setup-replication.sh — "2 per node = 6 total"). Every node is a writer. That makes
-- this an at-least-once, multi-master system, and the schema has to survive it.
--
-- THE OBVIOUS SCHEMA — `signal_hash TEXT PRIMARY KEY` — WEDGES FEDERATION. Measured, not theorised:
-- a subscriber's apply worker DOES enforce PRIMARY KEY / UNIQUE constraints. Two nodes that
-- independently insert the same hash each replicate an INSERT the other cannot apply:
--
--     SET session_replication_role = replica;   -- what the apply worker runs as
--     INSERT ... (duplicate hash)  ->  ERROR: duplicate key value violates unique constraint
--
-- The apply worker then errors, retries forever, and THE ENTIRE SUBSCRIPTION STOPS — all 20 published
-- tables, not just this one. Seals, profiles, presence and registrations stop federating too.
--
-- And it is reachable through the DESIGNED path, not an exotic one: the portal reaches the directory
-- through an ordered FAILOVER LIST (M10-D11). Submit hash H to us-east-1; the row lands; the response
-- is lost; the portal dutifully fails over and re-submits to eu-central-1, which has not yet received
-- H and so inserts its own row. Both replicate. Federation stops. A timeout — the most ordinary event
-- in a distributed system — takes down replication for the entire directory.
--
-- SO THE PRIMARY KEY IS (signal_hash, accepting_node)  [M10-D20].
-- Two nodes may each notarize the same signal; those rows CANNOT collide, so no INSERT can ever be
-- unapplicable. This is safe precisely because the record is CONTENT-ADDRESSED: every hashed field
-- (subject, issuer, type, supersedes_hash) is derived from the envelope, so two rows sharing a
-- signal_hash necessarily agree on all of them. They differ only in provenance (which node accepted
-- it, when, under which scanner). Reads therefore DEDUPE BY HASH — see the view below.
--
-- ── ⚠️ AND WHY A STATUS `UPDATE` IS NOT ENOUGH ────────────────────────────────────────────────
-- Same mesh, same lack of cross-stream ordering. A revoke or supersede that arrives at a node BEFORE
-- the row it targets finds no matching row: the apply worker SKIPS it. No error, no retry — the
-- status change is gone on that node, permanently, and that node serves a dead signal as live
-- forever. An UPDATE cannot deliver the DoD's "status changes replicate" clause on its own.
--
-- Both status transitions are therefore ALSO expressible as an INSERT, which cannot be lost the way
-- an UPDATE can (a row either arrives or is absent; an absent row cannot be mistakenly served):
--   * SUPERSESSION rides on the NEW record's own INSERT, via `supersedes_hash` — a HASHED envelope
--     field, so it is authenticated and it arrives with the row that asserts it.
--   * REVOCATION at a node that lacks the row inserts a TOMBSTONE row (status='revoked') rather than
--     updating zero rows. `revoked` is monotonic and any node's revocation counts, so this converges.
--
-- READS DERIVE, and never trust one row's `status` alone. Use `signal_records_effective`.
--
-- No FOREIGN KEY on supersedes_hash. (Not for the reason you might expect: an FK would NOT wedge
-- replication — the apply worker runs with session_replication_role = replica, in which the internal
-- RI triggers do not fire, so Postgres does not enforce FKs on the subscriber. Measured. The reason
-- is simpler: with a composite PK there is no single-row target to point at, and referential
-- tidiness is worth nothing next to a rule the write path already enforces.)

CREATE TABLE signal_records (
  -- The signal's identity: SHA-256 over the canonical CBOR envelope (DOD-CBOR-1).
  signal_hash     TEXT NOT NULL,

  -- WHICH NODE notarized this copy. Part of the PK — see the multi-master note above. Provenance,
  -- never authority: any node can serve any record.
  accepting_node  TEXT NOT NULL,

  -- WHO the signal is about. `account` signals (phone, email, social) are presentable by every agent
  -- under that account; `agent` signals (track record) by their subject alone (M10-D5). Both are
  -- HASHED into the envelope, so neither can change after minting without changing the hash.
  subject_kind    TEXT NOT NULL CHECK (subject_kind IN ('account', 'agent')),
  subject         TEXT NOT NULL,

  -- WHO attested it. Drives FRAMING at the consuming LLM (DOD-INV-FRAMING): `portal` is
  -- portal-attested; `agent` is quoted-untrusted ("Bob says:"). Hashed, so framing cannot be laundered
  -- by relabelling a record afterwards.
  --
  -- All THREE spec §3 values are admitted, including `directory`, even though nothing issues it at
  -- launch (§14.1: Class-3 track record is portal-computed, not directory-self-issued). A value the
  -- protocol has named costs nothing to admit now and a three-node migration to add later.
  issuer_kind     TEXT NOT NULL CHECK (issuer_kind IN ('portal', 'directory', 'agent')),
  issuer_pubkey   TEXT NOT NULL,

  -- OPAQUE. No CHECK. No enum. See the zero-bump note above before touching this line.
  type            TEXT NOT NULL,

  -- The record this one REPLACES, copied from the envelope's own HASHED `supersedes_hash`. An
  -- authenticated fact carried by this row's own INSERT — which is what lets supersession survive
  -- federation when an UPDATE would not.
  supersedes_hash TEXT,

  -- Lifecycle. NOT hashed — that is exactly why it is mutable, and why it lives here rather than in
  -- the envelope: revoking a signal must not change its hash, or the directory could never find the
  -- signal it just revoked.
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'superseded')),
  revoked_at      TIMESTAMPTZ,

  -- The scanner that cleared this content at birth (spec §14.1: "notarized ⇒ scanned-clean-at-birth",
  -- so the scanner version must be recoverable per record or that guarantee is unauditable later).
  --
  -- ⚠️ THIS IS THE SUBMITTER'S ASSERTION, NOT A DIRECTORY-VERIFIED FACT. The directory cannot see the
  -- payload and therefore cannot re-run the scan. It must travel INSIDE the signed request body
  -- (DOD-DIR-WRITE-1), or it is forgeable — and a forged scanner_version is a lie stored as evidence.
  scanner_version TEXT NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (signal_hash, accepting_node)
);

-- RLS. Idempotent policy creation, matching V33/V43/V44.
ALTER TABLE signal_records ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'signal_records'
      AND policyname = 'signal_records_service'
  ) THEN
    CREATE POLICY signal_records_service ON signal_records
      TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;

-- No DELETE. A notary ledger is append-and-amend: a signal is revoked or superseded, never erased —
-- otherwise "this hash was never notarized here" and "this hash was notarized and then quietly
-- removed" become indistinguishable, and the record stops being evidence. (GRANT is checked BEFORE
-- RLS, so withholding the grant is decisive; the policy's USING (true) never gets a say.)
GRANT INSERT, SELECT, UPDATE ON signal_records TO cello_service;

-- "Which signals exist for this subject?" — supersession (find what a re-mint replaces) and the
-- holder-delivery path. On SUBJECT, never on type (an index predicated on a type VALUE is a per-type
-- construct — see above).
CREATE INDEX signal_records_subject_idx ON signal_records(subject_kind, subject, status);

-- Supports the derived-supersession lookup in the view: "does a record exist that supersedes THIS?"
CREATE INDEX signal_records_supersedes_idx ON signal_records(supersedes_hash)
  WHERE supersedes_hash IS NOT NULL;

-- ── THE AUTHORITATIVE READ. Every status check goes through this — never a bare `status` column. ──
--
-- One row per signal_hash (the copies agree on every hashed field — content-addressing guarantees
-- it), with a status DERIVED so that it is correct on a node that missed a replicated UPDATE:
--
--   * revoked  — if ANY node's copy says revoked. Revocation is monotonic and any node's revocation
--                counts; this converges regardless of arrival order, and it is the STRONGEST
--                statement, so it wins over supersession.
--   * superseded — if a record exists whose (hashed) supersedes_hash points at this one and is not
--                itself revoked. Derived from the SUPERSEDING ROW'S EXISTENCE, so it does not depend
--                on an UPDATE that may have been silently dropped.
--   * active   — otherwise.
--
-- Expiry is deliberately absent: it is the verifier's to evaluate (see the header).
CREATE VIEW signal_records_effective AS
SELECT
  r.signal_hash,
  MIN(r.subject_kind)    AS subject_kind,
  MIN(r.subject)         AS subject,
  MIN(r.issuer_kind)     AS issuer_kind,
  MIN(r.issuer_pubkey)   AS issuer_pubkey,
  MIN(r.type)            AS type,
  MIN(r.supersedes_hash) AS supersedes_hash,
  MIN(r.created_at)      AS first_notarized_at,
  ARRAY_AGG(DISTINCT r.accepting_node ORDER BY r.accepting_node) AS notarized_by,
  MAX(r.revoked_at)      AS revoked_at,
  CASE
    WHEN BOOL_OR(r.status = 'revoked') THEN 'revoked'
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

-- ── authorized_issuers — the chokepoint's key set (determination §3.2, spec §15.2.2) ────────────
--
-- INV-CHOKEPOINT: a hash enters this store ONLY via a signed submission from a key in this table.
-- Today's reality is the exact opposite (investigation §4): ONE static bearer key, non-constant-time
-- compared, over plaintext HTTP on a public ALB — and it is the SAME secret the ops-agent holds, so
-- any key-holder can write a trust-signal hash for any account. The chokepoint is NET-NEW.
--
-- THE SET IS DATA, NOT CODE. `issuer_kind: agent` intake (endorsements, post-v1) must land as NEW
-- ROWS plus a role — never an API change, and never a code branch asking "is this the portal?". The
-- write path authorizes on (role, status) alone.
CREATE TABLE authorized_issuers (
  pubkey     TEXT PRIMARY KEY,                                   -- hex Ed25519, lowercase
  role       TEXT NOT NULL CHECK (role IN ('submitter', 'registry')),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  label      TEXT,                                               -- e.g. 'portal-kms-us-east-1'
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

ALTER TABLE authorized_issuers ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'authorized_issuers'
      AND policyname = 'authorized_issuers_service'
  ) THEN
    CREATE POLICY authorized_issuers_service ON authorized_issuers
      TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;

-- SELECT ONLY for the service. The write path READS this set to authorize a submission; it must never
-- be able to ADD to the set it is checked against, or a compromised directory process could authorize
-- itself. Key enrollment/rotation is an operator action (migration or ops-agent), deliberately
-- outside the request path.
GRANT SELECT ON authorized_issuers TO cello_service;

-- No key is seeded. The portal's pubkey is environment-specific (M10-D6: the private key lives in AWS
-- KMS and the portal holds none), so a literal here would be wrong per environment — or, worse, a
-- placeholder that silently authorizes nothing while looking configured. DOD-DIR-WRITE-1 enrolls the
-- real pubkey from `kms:GetPublicKey`.
--
-- An EMPTY set means every submission is REFUSED. That is the correct failure: ABSENT IS NOT FINE, and
-- a directory with no authorized issuer must notarize nothing rather than fall open.
