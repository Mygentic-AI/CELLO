-- CELLO-PERSIST-020 — change connection_requests.request_id from UUID to TEXT
--
-- directory-node.ts generates request_id as Buffer.from(randomBytes(16)).toString("hex")
-- which produces a 32-character lowercase hex string — NOT a UUID.
--
-- V2 defined request_id as UUID NOT NULL UNIQUE. This migration converts the column
-- to TEXT to match the actual format generated at runtime. The UNIQUE constraint is
-- preserved. The change is backward-compatible: existing UUID-format values stored
-- as text are valid hex strings (UUID hex without hyphens).
--
-- This also fixes the SI-001 validation query in PgDirectoryStore.createConnection()
-- which previously cast $1 to ::uuid — that cast will throw with a 32-char hex string.
-- After this migration, the column is TEXT and no cast is needed.
--
-- References: PERSIST-020, directory-node.ts line 1180

ALTER TABLE connection_requests
  ALTER COLUMN request_id TYPE TEXT USING request_id::text;
