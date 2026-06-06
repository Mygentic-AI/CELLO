-- V29__startup_state_restore.sql
-- CELLO-M6B-010: Directory startup state restoration
--
-- Purpose:
--   Close three in-memory state gaps in CelloDirectoryNode that cause data loss
--   on directory ECS task replacement:
--
--   1. active_connection_requests — new table for "Case B" pending connection requests:
--      connection requests delivered to target's stream but not yet accepted/rejected.
--      When the directory restarts, these requests are loaded back into
--      #pendingConnectionRequests so the target can still call cello_accept_connection.
--      SI-001: rows with expires_at <= NOW() are not loaded at startup.
--      TTL: 24 hours (matching pending_connection_requests queue TTL).
--
--   2. sessions.initiator_pubkey_hex / sessions.target_pubkey_hex — new columns on the
--      existing sessions table (from V18). These store the participant pubkeys so that
--      on startup, #sessionParticipants can be reconstructed for active sessions
--      (sessions not yet in seal_notarizations).
--
--      Note: sessions rows were already written by FEDERATION-001 for ownership tracking.
--      This migration adds participant columns used for PERSIST-015 unilateral seal
--      absent-party lookup after directory restart.
--
-- Design rules:
--   - active_connection_requests is a mutable delivery queue (not append-only, no chain_hash).
--     rows are inserted on delivery, deleted on accept/reject/expiry.
--   - sessions.initiator_pubkey_hex and target_pubkey_hex default to '' for rows created
--     before this migration (no historical participant data for pre-M6B-010 sessions).
--     These old sessions will not appear in loadActiveSessionParticipants results
--     because the empty-string check filters them.
--   - Both tables use CELLO_ENV=local (Docker Compose) and CELLO_ENV=dev/staging/production
--     (RDS) identically.
--
-- Idempotency: all statements use IF NOT EXISTS or ALTER TABLE ADD COLUMN IF NOT EXISTS.

-- ─── active_connection_requests ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active_connection_requests (
  connection_request_id  TEXT        PRIMARY KEY,
  sender_pubkey_hex      TEXT        NOT NULL,
  target_pubkey_hex      TEXT        NOT NULL,
  package_cbor           BYTEA       NOT NULL,
  disclosure_round       INT         NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at             TIMESTAMPTZ NOT NULL
);

-- Index for loading unexpired requests at startup
CREATE INDEX IF NOT EXISTS idx_active_conn_req_expires_at
  ON active_connection_requests (expires_at);

ALTER TABLE active_connection_requests ENABLE ROW LEVEL SECURITY;

-- INSERT: directory service inserts when connection is delivered to target's stream
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'active_connection_requests'
      AND policyname = 'active_conn_req_insert'
  ) THEN
    CREATE POLICY active_conn_req_insert ON active_connection_requests
      FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

-- SELECT: directory service reads on startup and for reconnect delivery
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'active_connection_requests'
      AND policyname = 'active_conn_req_select'
  ) THEN
    CREATE POLICY active_conn_req_select ON active_connection_requests
      FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

-- DELETE: directory service deletes on accept, reject, or expiry cleanup
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'active_connection_requests'
      AND policyname = 'active_conn_req_delete'
  ) THEN
    CREATE POLICY active_conn_req_delete ON active_connection_requests
      FOR DELETE TO cello_service USING (true);
  END IF;
END $$;

GRANT INSERT, SELECT, DELETE ON active_connection_requests TO cello_service;

-- ─── sessions: add participant pubkey columns ─────────────────────────────────

-- initiator_pubkey_hex: K_local pubkey of the session initiator (agent A)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions'
      AND column_name = 'initiator_pubkey_hex'
  ) THEN
    ALTER TABLE sessions ADD COLUMN initiator_pubkey_hex TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

-- target_pubkey_hex: K_local pubkey of the session target (agent B)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sessions'
      AND column_name = 'target_pubkey_hex'
  ) THEN
    ALTER TABLE sessions ADD COLUMN target_pubkey_hex TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

-- Index for loading active sessions with participant data at startup
CREATE INDEX IF NOT EXISTS idx_sessions_participants
  ON sessions (initiator_pubkey_hex, target_pubkey_hex)
  WHERE initiator_pubkey_hex <> '' AND target_pubkey_hex <> '';

-- CRIT-002: Grant UPDATE on sessions and add UPDATE RLS policy so that
-- writeSessionWithParticipants can issue UPDATE sessions SET initiator_pubkey_hex = $1,
-- target_pubkey_hex = $2 WHERE ... for sessions that already exist (e.g. rows created
-- by FEDERATION-001 writeSession before M6B-010 participant columns were added).
GRANT UPDATE ON sessions TO cello_service;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sessions'
      AND policyname = 'sessions_update'
  ) THEN
    CREATE POLICY sessions_update ON sessions
      FOR UPDATE TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;
