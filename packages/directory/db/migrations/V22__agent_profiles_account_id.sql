-- V22: Add account_id FK column to agent_profiles
-- Required by CELLO-ACCOUNT-001
--
-- Design decisions:
--   1. account_id is nullable — pre-M6 agents have no account. NULL means "not yet linked".
--   2. FK references user_accounts.account_id — the DB enforces referential integrity;
--      application code cannot insert a fabricated account_id (SI-002).
--   3. Idempotent: ADD COLUMN IF NOT EXISTS (idempotency guard).
--      Adding the FK constraint is also guarded to avoid duplicate constraint error on re-run.
--
-- Running V22 twice on the same database is safe.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_profiles' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE agent_profiles ADD COLUMN account_id UUID;
  END IF;
END $$;

-- Add FK constraint separately so the idempotency guard covers it independently.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'agent_profiles'
      AND constraint_name = 'agent_profiles_account_id_fkey'
  ) THEN
    ALTER TABLE agent_profiles
      ADD CONSTRAINT agent_profiles_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES user_accounts(account_id);
  END IF;
END $$;
