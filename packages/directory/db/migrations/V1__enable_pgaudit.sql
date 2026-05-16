-- Enable pgaudit extension for audit logging (PERSIST-002 AC-009).
-- pgaudit is loaded via shared_preload_libraries in docker-compose.yml;
-- this extension registration makes audit functions available in SQL.
CREATE EXTENSION IF NOT EXISTS pgaudit;
