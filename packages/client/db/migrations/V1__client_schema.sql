-- V1__client_schema.sql
-- CELLO-PERSIST-009: Initial client-side encrypted database schema.
--
-- Tables:
--   client_store — opaque key/value blob store (implements ClientStore interface)
--
-- Note: schema_migrations is NOT created here. The migration runner bootstraps
-- that table itself before executing any migration files, so it must not appear
-- inside a migration transaction.
--
-- All data at rest is protected by SQLCipher (AES-256-CBC with PBKDF2 key derivation).
-- The db_key is never stored here — it is derived at runtime from identity_key via HKDF.

-- Opaque key/value store backing the ClientStore interface.
-- key:   stable string identifier (session keys, trust data, key material, etc.)
-- value: raw bytes (BLOB)
CREATE TABLE IF NOT EXISTS client_store (
    key        TEXT    NOT NULL PRIMARY KEY,
    value      BLOB    NOT NULL,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
