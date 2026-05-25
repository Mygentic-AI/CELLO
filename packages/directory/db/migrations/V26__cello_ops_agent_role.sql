-- V26__cello_ops_agent_role.sql — Dedicated database role for the Operations Agent ECS task
--
-- Creates cello_ops_agent with scoped access to registration tables only (AC-007b, SI-002).
-- Introduced in OPS-AGENT-000 story-contract update (V25 already applied when this was added).
--
-- Design rationale (see schema_assessment.database_roles in CELLO-OPS-AGENT-000.yaml):
--
--   cello_ops_agent is the PostgreSQL role used by the Operations Agent ECS task container.
--   It must ONLY access the two tables the Operations Agent legitimately needs:
--     - registrations   (drive the state machine)
--     - pre_authorization_tokens (issue and consume tokens)
--
--   It must NEVER access:
--     - agent_profiles     (holds agent identities and public keys)
--     - sessions           (in-session state)
--     - conversation_chains, checkpoints, checkpoint_node_signatures (key-material-adjacent)
--     - any other table
--
--   No DELETE on any table — same append-only semantics as cello_service.
--   The password for cello_ops_agent is set by the rotation Lambda in OPS-AGENT-005A
--   using the secret cello/{env}/ops-agent/rds-credentials.
--
-- RLS policies:
--   The existing cello_service RLS policies do NOT carry over to cello_ops_agent.
--   Each table requires explicit policies for cello_ops_agent (SI-002).

-- Create the role idempotently (LOGIN for ECS task connection)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cello_ops_agent') THEN
    CREATE ROLE cello_ops_agent WITH LOGIN;
  END IF;
END $$;

-- ─── registrations: cello_ops_agent policies ──────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'registrations' AND policyname = 'insert_ops_agent'
  ) THEN
    CREATE POLICY insert_ops_agent ON registrations
      FOR INSERT TO cello_ops_agent WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'registrations' AND policyname = 'select_ops_agent'
  ) THEN
    CREATE POLICY select_ops_agent ON registrations
      FOR SELECT TO cello_ops_agent USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'registrations' AND policyname = 'update_ops_agent'
  ) THEN
    CREATE POLICY update_ops_agent ON registrations
      FOR UPDATE TO cello_ops_agent USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT, SELECT, UPDATE ON registrations TO cello_ops_agent;
-- Explicitly revoke DELETE to enforce append-only semantics (SI-002)
REVOKE DELETE ON registrations FROM cello_ops_agent;

-- ─── pre_authorization_tokens: cello_ops_agent policies ───────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_authorization_tokens' AND policyname = 'insert_ops_agent'
  ) THEN
    CREATE POLICY insert_ops_agent ON pre_authorization_tokens
      FOR INSERT TO cello_ops_agent WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_authorization_tokens' AND policyname = 'select_ops_agent'
  ) THEN
    CREATE POLICY select_ops_agent ON pre_authorization_tokens
      FOR SELECT TO cello_ops_agent USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pre_authorization_tokens' AND policyname = 'update_ops_agent'
  ) THEN
    CREATE POLICY update_ops_agent ON pre_authorization_tokens
      FOR UPDATE TO cello_ops_agent USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT INSERT, SELECT, UPDATE ON pre_authorization_tokens TO cello_ops_agent;
-- Explicitly revoke DELETE to enforce append-only semantics (SI-002)
REVOKE DELETE ON pre_authorization_tokens FROM cello_ops_agent;
