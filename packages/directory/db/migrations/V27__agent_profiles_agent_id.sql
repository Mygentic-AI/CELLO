-- V27: Add agent_id column to agent_profiles
-- F-012: agent_id was generated at registration time but never persisted to DB.
-- On restart the directory lost all agent_ids, requiring a SHA-256 workaround in code.
-- This migration adds the column as nullable. Existing rows keep agent_id = NULL;
-- loadProfiles() derives a stable stand-in via SHA-256(k_local_pubkey) for null rows.
-- New registrations write agent_id via setProfile().
-- No UPDATE backfill — table lock violation per DB-001 (append-only contract).

ALTER TABLE agent_profiles ADD COLUMN agent_id TEXT;

-- Unique constraint allows NULL (existing rows) but enforces uniqueness on non-null values.
ALTER TABLE agent_profiles ADD CONSTRAINT agent_profiles_agent_id_unique UNIQUE (agent_id);

-- Index for fast lookup by agent_id
CREATE INDEX idx_agent_profiles_agent_id ON agent_profiles (agent_id);
