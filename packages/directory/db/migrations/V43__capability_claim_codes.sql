-- V43: capability_claim_codes — #2b short claim-code + redeem
--
-- Registration hands the operator a short, typeable claim-code (CELLO-<hex>) instead of the ~570-char
-- pre-auth capability blob. The directory stores {code -> capability} here at issuance; the agent redeems
-- the code over a signaling frame (redeem_claim_code) to retrieve the self-verifying capability, which
-- still does the real work at DKG. NATURAL TEXT primary key (no BIGSERIAL) so it replicates cleanly
-- across sovereign nodes (the 2026-07-05 counter-collision fix only concerns BIGSERIAL ids) and the agent
-- can redeem against whichever directory it is connected to. Additive: the capability-blob path is
-- unchanged; this only adds a parallel short-code delivery.

CREATE TABLE IF NOT EXISTS capability_claim_codes (
  code         TEXT         PRIMARY KEY,
  capability   TEXT         NOT NULL,        -- the full base64url-encoded signed capability
  expires_at   TIMESTAMPTZ  NOT NULL,        -- mirrors the capability's expiry
  redeemed_at  TIMESTAMPTZ,                  -- set on first redeem (audit; the capability nonce is the single-use gate)
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE capability_claim_codes ENABLE ROW LEVEL SECURITY;

-- cello_service (the app role) may insert at issuance, select at redeem, and update redeemed_at.
-- Idempotent policy creation, matching the V17/V25/V42 style.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='capability_claim_codes' AND policyname='ccc_insert') THEN
    CREATE POLICY ccc_insert ON capability_claim_codes FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='capability_claim_codes' AND policyname='ccc_select') THEN
    CREATE POLICY ccc_select ON capability_claim_codes FOR SELECT TO cello_service USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='capability_claim_codes' AND policyname='ccc_update') THEN
    CREATE POLICY ccc_update ON capability_claim_codes FOR UPDATE TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT, SELECT, UPDATE ON capability_claim_codes TO cello_service;

-- Expiry sweep support (optional cleanup job; not load-bearing).
CREATE INDEX IF NOT EXISTS idx_ccc_expires_at ON capability_claim_codes (expires_at);
