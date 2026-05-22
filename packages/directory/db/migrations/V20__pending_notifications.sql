-- V20: pending_notifications table — SEAL_UNILATERAL notification queue
-- Required by CELLO-PERSIST-023
--
-- Design decisions:
--   1. pending_notifications is an ephemeral delivery queue for SEAL_UNILATERAL notifications.
--      Rows are written when the absent party is offline and deleted on acknowledgement.
--      This follows the "append-only, deleted on acknowledgement" model from PERSIST-015.
--   2. notification_id is UUID (not BIGSERIAL) — the caller mints the UUID so it can be
--      referenced in observability events before the INSERT completes.
--   3. No delivered_at column: rows are deleted on acknowledgement, not retained.
--      This is intentional — see PERSIST-023 AC-001 and SI-001.
--   4. No UPDATE policy: cello_service has INSERT, SELECT, DELETE only.
--      There is no UPDATE use case for this table — delivery is delete-on-acknowledge.
--
-- Idempotency: CREATE TABLE uses IF NOT EXISTS; CREATE INDEX uses IF NOT EXISTS;
-- GRANT statements are idempotent by design. Running V20 twice on the same database
-- is safe and produces no error.
--
-- AC-008-idempotency: verified by applying V20 twice in integration tests.

-- ─── pending_notifications table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pending_notifications (
  notification_id    UUID         NOT NULL,
  recipient_agent_id TEXT         NOT NULL,
  notification_type  TEXT         NOT NULL,
  payload            JSONB        NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pending_notifications_pkey PRIMARY KEY (notification_id)
);

-- Index on recipient_agent_id for efficient drainUndelivered queries (AC-001)
CREATE INDEX IF NOT EXISTS idx_pending_notifications_recipient
  ON pending_notifications (recipient_agent_id);

-- Enable RLS — cello_service has INSERT, SELECT, DELETE (no UPDATE)
ALTER TABLE pending_notifications ENABLE ROW LEVEL SECURITY;

-- Drop any stale policies before creating the authoritative ones (idempotent)
DO $$ BEGIN
  DROP POLICY IF EXISTS insert_only ON pending_notifications;
  DROP POLICY IF EXISTS select_all ON pending_notifications;
  DROP POLICY IF EXISTS delete_all ON pending_notifications;
  DROP POLICY IF EXISTS select_by_recipient ON pending_notifications;
  DROP POLICY IF EXISTS delete_by_recipient ON pending_notifications;
END $$;

-- INSERT: directory service may enqueue for any absent agent
CREATE POLICY insert_only ON pending_notifications
  FOR INSERT TO cello_service WITH CHECK (true);

-- SELECT: directory service reads all pending rows for a reconnecting agent
CREATE POLICY select_all ON pending_notifications
  FOR SELECT TO cello_service USING (true);

-- DELETE: directory service deletes acknowledged rows
CREATE POLICY delete_all ON pending_notifications
  FOR DELETE TO cello_service USING (true);

-- Grant privileges — GRANT is idempotent by design in PostgreSQL
GRANT INSERT, SELECT, DELETE ON pending_notifications TO cello_service;
