-- CELLO-PERSIST-019 — notification_queue + pending_connection_requests
--
-- Both tables are ephemeral delivery queues — not audit records. Rows are consumed
-- (deleted) when drained. Neither requires a chain_hash column. Both require
-- INSERT, SELECT, and DELETE for cello_service. No UPDATE policy exists.
--
-- This migration follows the two-step pattern established by PERSIST-016 (V10):
--
--   Step 1: CREATE TABLE IF NOT EXISTS (id, created_at) — no-op if V10 stub already applied.
--   Step 2: ALTER TABLE ADD COLUMN IF NOT EXISTS <col> — idempotent for each data column.
--
-- V10 (PERSIST-016) created notification_queue and pending_connection_requests as minimal
-- stubs (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ) and explicitly documented:
--   "The PERSIST-018/019/020 migrations add the actual column definitions via
--    ALTER TABLE ... ADD COLUMN IF NOT EXISTS"
--
-- V10 also only granted INSERT + SELECT (no DELETE). This migration adds DELETE grants
-- and replaces the coarse V10 RLS policies with the authoritative fine-grained ones.
--
-- notification_queue:
--   Holds DirectoryNotifications (SessionAbandoned, SessionSealed, SessionSealRejected,
--   SealVerified, ConnectionEstablished) queued for offline agents. When an agent
--   reconnects, drainNotifications() SELECTs and DELETEs all rows for that agent in
--   a single atomic CTE (SI-001: no double delivery).
--
--   RLS SELECT policy (select_by_pubkey) uses current_setting('app.current_pubkey', true)
--   to enforce that an agent can only read notifications addressed to them (SI-003).
--
-- pending_connection_requests:
--   Holds connection requests from A to B when B is offline. TTL of 24 hours enforced
--   by application query filter and periodic TTL sweep (PendingConnectionRequestTtlSweep).
--
-- RLS pattern for mutable delivery queues:
--   - INSERT: allowed for cello_service unconditionally
--   - SELECT: filtered by app.current_pubkey for notification_queue (SI-003);
--             unrestricted for pending_connection_requests (directory reads on reconnect)
--   - DELETE: allowed for cello_service unconditionally on both tables
--   - NO UPDATE policy → permission denied on UPDATE for cello_service (AC-007)

-- ─── notification_queue ───────────────────────────────────────────────────────

-- Step 1: create stub if it does not exist (no-op when V10 is already applied)
CREATE TABLE IF NOT EXISTS notification_queue (
  id         BIGSERIAL    PRIMARY KEY,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Step 2: add data columns idempotently (no-op when already present)
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS pubkey_hex TEXT NOT NULL DEFAULT '';
ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS payload    JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Remove temporary defaults — all new rows must supply real values
ALTER TABLE notification_queue ALTER COLUMN pubkey_hex DROP DEFAULT;
ALTER TABLE notification_queue ALTER COLUMN payload    DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_notification_queue_pubkey ON notification_queue (pubkey_hex);

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- Ensure correct policy set: drop any stale policies from V10 or parallel worktree migrations,
-- then create the authoritative ones.
DO $$ BEGIN
  DROP POLICY IF EXISTS select_all ON notification_queue;
  DROP POLICY IF EXISTS delete_own ON notification_queue;
  DROP POLICY IF EXISTS insert_only ON notification_queue;
  DROP POLICY IF EXISTS select_by_pubkey ON notification_queue;
  DROP POLICY IF EXISTS delete_by_pubkey ON notification_queue;
END $$;

-- INSERT: directory service may enqueue for any agent
CREATE POLICY insert_only ON notification_queue
  FOR INSERT TO cello_service WITH CHECK (true);

-- SELECT: agent may only read their own notifications (SI-003)
-- app.current_pubkey is set by the caller before issuing the SELECT.
-- The 'true' safety flag means current_setting returns '' (not an error) if unset.
CREATE POLICY select_by_pubkey ON notification_queue
  FOR SELECT TO cello_service
  USING (pubkey_hex = current_setting('app.current_pubkey', true));

-- DELETE: directory service may delete (drain) notifications for any agent
CREATE POLICY delete_by_pubkey ON notification_queue
  FOR DELETE TO cello_service
  USING (true);

GRANT INSERT, SELECT, DELETE ON notification_queue TO cello_service;
DO $$ BEGIN
  GRANT USAGE ON SEQUENCE notification_queue_id_seq TO cello_service;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ─── pending_connection_requests ──────────────────────────────────────────────

-- Step 1: create stub if it does not exist (no-op when V10 is already applied)
CREATE TABLE IF NOT EXISTS pending_connection_requests (
  id         BIGSERIAL    PRIMARY KEY,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Step 2: add data columns idempotently (no-op when already present)
ALTER TABLE pending_connection_requests ADD COLUMN IF NOT EXISTS target_pubkey TEXT NOT NULL DEFAULT '';
ALTER TABLE pending_connection_requests ADD COLUMN IF NOT EXISTS payload       JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Remove temporary defaults — all new rows must supply real values
ALTER TABLE pending_connection_requests ALTER COLUMN target_pubkey DROP DEFAULT;
ALTER TABLE pending_connection_requests ALTER COLUMN payload       DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_pending_conn_req_target ON pending_connection_requests (target_pubkey);

ALTER TABLE pending_connection_requests ENABLE ROW LEVEL SECURITY;

-- Ensure correct policy set: drop any stale policies from V10 or parallel worktree migrations.
DO $$ BEGIN
  DROP POLICY IF EXISTS delete_own ON pending_connection_requests;
  DROP POLICY IF EXISTS insert_only ON pending_connection_requests;
  DROP POLICY IF EXISTS select_all ON pending_connection_requests;
  DROP POLICY IF EXISTS delete_all ON pending_connection_requests;
END $$;

-- INSERT: directory service queues a request for an offline target
CREATE POLICY insert_only ON pending_connection_requests
  FOR INSERT TO cello_service WITH CHECK (true);

-- SELECT: directory service reads all pending requests for a reconnecting target
CREATE POLICY select_all ON pending_connection_requests
  FOR SELECT TO cello_service USING (true);

-- DELETE: directory service deletes drained/expired requests
CREATE POLICY delete_all ON pending_connection_requests
  FOR DELETE TO cello_service USING (true);

GRANT INSERT, SELECT, DELETE ON pending_connection_requests TO cello_service;
DO $$ BEGIN
  GRANT USAGE ON SEQUENCE pending_connection_requests_id_seq TO cello_service;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
