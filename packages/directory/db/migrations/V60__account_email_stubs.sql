-- V60: account_email_stubs — the email↔account binding as an APPEND-ONLY FACT.
--
-- Same defect and same shape as V59 (agent_account_links), one table along.
--
-- `user_accounts.email_stub_hash` is nullable and set after the row is created, so it is excluded
-- from USER_ACCOUNTS_SPEC's hashed set — Tier A carries `account_id` and `phone_stub_hash` and
-- nothing else. The exclusion is deliberate and correct FOR THAT TABLE: `user_accounts` is
-- hash-chained, and a column that is absent at INSERT and populated later would fork the chain.
-- The consequence is that the email hash has never replicated.
--
-- What that cost, measured 2026-08-07: the portal resolves sign-in by asking a directory for the
-- account matching SHA-256(lower(trim(email))). The hash existed on gcp-usc1 only. The portal asks
-- gcp-euw1 first, was told "no such account", and stopped — a 404 is a successful answer, not an
-- error, so there was nothing to fail over from. Sign-in was impossible for an operator whose email
-- had been verified through Telegram weeks earlier, and the `email` trust signal was silently
-- skipped for the same reason while `phone` minted beside it.
--
-- The portal now reads across all nodes, so this is no longer load-bearing for sign-in. It is still
-- the difference between sign-in working and sign-in working BY LUCK OF NODE ORDERING, and it
-- removes the reason the portal has to fan out at all.
--
-- ─── Why a table rather than adding the column to the hashed set ────────────────────────────────
-- Adding `email_stub_hash` to USER_ACCOUNTS_SPEC would change the content address of every existing
-- user_accounts row, so all three nodes would report divergence on data that never changed — the
-- same trap V58 documents and avoids. A separate append-only table replicates cleanly and touches
-- no existing hash.
--
-- KEYED BY THE STUB, not the account. The question asked at sign-in is "which account owns this
-- email hash?", and making the stub the primary key answers it with the PK index and makes the
-- one-email-one-account rule a constraint rather than a convention. An account with several
-- verified emails is representable — several rows pointing at one account_id — which the reverse
-- keying would have forbidden by accident.
--
-- NO PII. A stub is SHA-256 of the normalized address; the directory never holds the address itself
-- (project_no_pii_in_directory_hash_only). The portal holds the recoverable copy, KMS-encrypted.

CREATE TABLE IF NOT EXISTS account_email_stubs (
  email_stub_hash TEXT         NOT NULL,
  account_id      UUID         NOT NULL,
  linked_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT account_email_stubs_pkey PRIMARY KEY (email_stub_hash),
  CONSTRAINT account_email_stubs_account_fk
    FOREIGN KEY (account_id) REFERENCES user_accounts(account_id)
);

-- The reverse question — "what is this account's verified email hash?" — is asked when composing
-- the email trust signal.
CREATE INDEX IF NOT EXISTS idx_account_email_stubs_account
  ON account_email_stubs (account_id);

-- ─── backfill from the column, per node ─────────────────────────────────────────────────────────
-- Each node contributes what it alone holds; anti-entropy unions them. Nothing here requires the
-- nodes to agree first, which is the property that lets a split set heal without coordination.
INSERT INTO account_email_stubs (email_stub_hash, account_id)
  SELECT email_stub_hash, account_id
    FROM user_accounts
   WHERE email_stub_hash IS NOT NULL
ON CONFLICT (email_stub_hash) DO NOTHING;

-- ─── RLS: INSERT + SELECT only ──────────────────────────────────────────────────────────────────

ALTER TABLE account_email_stubs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS insert_only ON account_email_stubs;
  DROP POLICY IF EXISTS select_all ON account_email_stubs;
END $$;

CREATE POLICY insert_only ON account_email_stubs
  FOR INSERT TO cello_service WITH CHECK (true);

CREATE POLICY select_all ON account_email_stubs
  FOR SELECT TO cello_service USING (true);

-- No UPDATE, no DELETE. Re-verifying an address that already maps to this account is a no-op
-- (ON CONFLICT DO NOTHING); moving an address to a DIFFERENT account is not an update to be made
-- quietly here — it is an account takeover in one statement, and needs its own designed path.
GRANT INSERT, SELECT ON account_email_stubs TO cello_service;
