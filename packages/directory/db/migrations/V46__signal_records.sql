-- V46 — signal_records: the directory's notary ledger for trust signals. M10 / DOD-STORE-DIR-1.
-- Spec-of-record: docs/planning/user-stories/m10/M10-TRUST-SIGNAL-STORAGE-AND-CREATION.md §3, §14.1.
--
-- ── What this table is, and what it deliberately is NOT ─────────────────────────────────────────
-- The directory is a DUMB NOTARY (DOD-INV-DIR-DUMB). It stores the HASH of a trust signal and the
-- minimum metadata needed to answer two mechanical questions at presentation time:
--
--   1. Does this hash exist here?
--   2. Is it still good (active — not revoked, not superseded, not expired)?
--
-- It stores NO envelope plaintext, NO payload, and NO PII. The signal's content lives only with the
-- holder (the subject's own daemon, in its encrypted wallet) and is disclosed by them, selectively,
-- at introduction. A directory that held the content could read every operator's phone number and
-- email domain; one that holds only hashes cannot, even if it is fully compromised. That is why the
-- payload column that "would be so convenient" is absent, and must stay absent.
--
-- ── type IS AN OPAQUE STRING. THIS IS THE ZERO-BUMP INVARIANT (DOD-INV-ZERO-BUMP) ───────────────
-- There is deliberately NO CHECK constraint on `type`, no enum, and no index predicated on a type
-- VALUE. The whole architectural claim of M10 is that a NEW SIGNAL TYPE requires no code change and
-- no deploy anywhere except the portal — proven by the zero-bump canary, which takes a type this
-- directory has never seen from nothing to live end-to-end while the directory's git tree stays
-- clean. A `CHECK (type IN (...))` here would silently defeat that: the day the portal invents a
-- type, this table would reject it, and the failure would surface three hops away as a mint error.
-- If you are about to add a type constraint here, you are about to break the milestone's thesis.
--
-- ── Sovereign-node replication (spec §14.1) ────────────────────────────────────────────────────
-- A signal is submitted to ONE node and federates to the others over the existing logical
-- replication path (added to PUBLICATION_TABLES in infra/setup-replication.sh). BOTH the record and
-- its later STATUS CHANGES (revoked / superseded) replicate — a revocation that reached only the
-- accepting node would leave the other two nodes cheerfully vouching for a dead signal, which is
-- the precise failure a federated notary must not have. `accepting_node` records which node first
-- took the submission (provenance for debugging, never authority: any node can serve any record).

CREATE TABLE signal_records (
  -- The signal's identity: SHA-256 over the canonical CBOR envelope (DOD-CBOR-1). Content-addressed,
  -- so re-submitting the same signal is idempotent by construction rather than by a dedup rule.
  signal_hash     TEXT PRIMARY KEY,

  -- WHO the signal is about. `account` signals (phone, email, social) are presentable by every agent
  -- under that account; `agent` signals (track record) by their subject alone (M10-D5). Both values
  -- are HASHED into the envelope, so neither can be changed after minting without changing the hash.
  subject_kind    TEXT NOT NULL CHECK (subject_kind IN ('account', 'agent')),
  subject         TEXT NOT NULL,

  -- WHO attested it. Drives FRAMING at the consuming LLM (DOD-INV-FRAMING): `portal` is
  -- portal-attested; `agent` is quoted-untrusted ("Bob says:"). Hashed, so framing cannot be
  -- laundered by relabelling a record after the fact. `agent` is post-v1 (endorsements), but the
  -- column admits it now so the write path is seam-ready and no migration is needed to turn it on.
  issuer_kind     TEXT NOT NULL CHECK (issuer_kind IN ('portal', 'agent')),
  issuer_pubkey   TEXT NOT NULL,

  -- OPAQUE. No CHECK. No enum. See the zero-bump note above before touching this line.
  type            TEXT NOT NULL,

  -- Lifecycle. NOT hashed — that is exactly why it is mutable, and why it lives here rather than in
  -- the envelope: revoking a signal must not change its hash, or the directory could never find the
  -- signal it just revoked. Expiry is NOT a status: it is `expires_at` in the envelope and is
  -- evaluated by the verifier against the clock, never written here (spec §14.2 — expiry is
  -- automatic, not an event, so nothing has to run for a signal to expire).
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'superseded')),
  superseded_by   TEXT REFERENCES signal_records(signal_hash),
  revoked_at      TIMESTAMPTZ,

  -- Provenance, never authority. Which node first accepted the submission, and which version of the
  -- content scanner cleared it at birth (spec §14.1 — "notarized implies scanned-clean-at-birth", so
  -- the scanner version must be recoverable per record or that guarantee is unauditable later).
  accepting_node  TEXT NOT NULL,
  scanner_version TEXT NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
-- removed" become indistinguishable, and the record stops being evidence.
GRANT INSERT, SELECT, UPDATE ON signal_records TO cello_service;

-- The presentation-time read (dumb check 1 + 2) is by signal_hash — served by the primary key.
--
-- This index serves the OTHER read: "which signals exist for this subject?", used by supersession
-- (find the active record a re-mint replaces) and by the holder-delivery path. It is on SUBJECT, not
-- on type — indexing a type VALUE would be a per-type construct and is forbidden (see above).
CREATE INDEX signal_records_subject_idx ON signal_records(subject_kind, subject, status);
