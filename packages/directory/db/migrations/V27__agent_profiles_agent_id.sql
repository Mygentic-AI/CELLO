-- V27: Add agent_id column to agent_profiles
-- F-012: agent_id was generated at registration time but never persisted to DB.
-- On restart the directory lost all agent_ids, requiring a SHA-256 workaround.
-- This migration adds the column and backfills existing rows with SHA-256(k_local_pubkey)
-- as a stable stand-in (matches the workaround already in loadProfiles()).

ALTER TABLE agent_profiles ADD COLUMN agent_id TEXT;

-- Backfill existing rows. substr(..., 1, 32) truncates to 32 chars, matching the
-- format used by newly registered agents (randomBytes(16).toString("hex") = 32 chars).
-- Uses built-in sha256() + encode() — no pgcrypto extension required.
-- NOTE: k_local_pubkey::bytea converts the hex TEXT string to its UTF-8 bytes,
-- NOT the decoded binary key. This matches the TypeScript fallback in loadProfiles()
-- which does createHash("sha256").update(k_local_pubkey, "utf8"). Both hash the
-- hex string bytes — not the raw key bytes. Consistent by design.
UPDATE agent_profiles SET agent_id = substr(encode(sha256(k_local_pubkey::bytea), 'hex'), 1, 32);

-- Make non-nullable and unique now that all rows have a value
ALTER TABLE agent_profiles ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE agent_profiles ADD CONSTRAINT agent_profiles_agent_id_unique UNIQUE (agent_id);

-- Index for fast lookup by agent_id
CREATE INDEX idx_agent_profiles_agent_id ON agent_profiles (agent_id);
