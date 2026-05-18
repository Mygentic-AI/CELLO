-- CELLO-PERSIST-016 — Missing table stubs (CI gate for schema completeness)
--
-- These tables were referenced by PgDirectoryStore in M4 live session code but had
-- no corresponding Flyway migration, causing silent adapter.write.failed events at
-- runtime. Each table is added here as a minimal stub so the PERSIST-016 schema
-- completeness test passes and the CI gate is unblocked.
--
-- Full column definitions for each table are added in subsequent stories:
--   seal_notarizations          → PERSIST-018
--   notification_queue          → PERSIST-019
--   pending_connection_requests → PERSIST-019
--   connections                 → PERSIST-020
--
-- RLS pattern (same as all other append-only tables in this schema):
--   INSERT + SELECT for cello_service; no UPDATE or DELETE.
--
-- Note: These stubs intentionally omit columns other than the BIGSERIAL primary key
-- and created_at. The PERSIST-018/019/020 migrations add the actual column definitions
-- via ALTER TABLE ... ADD COLUMN IF NOT EXISTS, consistent with how V5 and V7 extended
-- the V2 stub tables.

-- ─── seal_notarizations ───────────────────────────────────────────────────────
-- Stores the FROST threshold co-signature for each sealed session.
-- Full columns: PERSIST-018
CREATE TABLE IF NOT EXISTS seal_notarizations (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seal_notarizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON seal_notarizations FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON seal_notarizations FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON seal_notarizations TO cello_service;
REVOKE UPDATE, DELETE ON seal_notarizations FROM cello_service;
GRANT USAGE ON SEQUENCE seal_notarizations_id_seq TO cello_service;

-- ─── notification_queue ───────────────────────────────────────────────────────
-- Offline delivery queue for directory notifications to agents.
-- Full columns: PERSIST-019
CREATE TABLE IF NOT EXISTS notification_queue (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON notification_queue FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON notification_queue FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON notification_queue TO cello_service;
REVOKE UPDATE, DELETE ON notification_queue FROM cello_service;
GRANT USAGE ON SEQUENCE notification_queue_id_seq TO cello_service;

-- ─── pending_connection_requests ──────────────────────────────────────────────
-- Queue of connection requests awaiting offline target agents.
-- Full columns: PERSIST-019
CREATE TABLE IF NOT EXISTS pending_connection_requests (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pending_connection_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON pending_connection_requests FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON pending_connection_requests FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON pending_connection_requests TO cello_service;
REVOKE UPDATE, DELETE ON pending_connection_requests FROM cello_service;
GRANT USAGE ON SEQUENCE pending_connection_requests_id_seq TO cello_service;

-- ─── connections ──────────────────────────────────────────────────────────────
-- Durable record of established connections between agents.
-- Full columns: PERSIST-020
CREATE TABLE IF NOT EXISTS connections (
  id         BIGSERIAL   PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON connections FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY select_all  ON connections FOR SELECT TO cello_service USING (true);
GRANT INSERT, SELECT ON connections TO cello_service;
REVOKE UPDATE, DELETE ON connections FROM cello_service;
GRANT USAGE ON SEQUENCE connections_id_seq TO cello_service;
