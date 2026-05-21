-- V17: directory_nodes table and sessions table with owning_node_id
-- Required by DEPLOY-001 AC-010 and FEDERATION-001 AC-001
-- directory_nodes tracks the set of directory nodes in the federation
-- sessions.owning_node_id identifies the sole writer for that session's hash chain
-- sessions.session_id is UUID per FEDERATION-001 AC-001 specification

CREATE TABLE IF NOT EXISTS directory_nodes (
  id BIGSERIAL PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  endpoint TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions table: each session is assigned to exactly one owning node.
-- Columns per FEDERATION-001 AC-001: session_id UUID, owning_node_id TEXT, created_at TIMESTAMPTZ.
-- The owning node is the sole writer for that session's hash chain entries.
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE,
  owning_node_id TEXT NOT NULL REFERENCES directory_nodes(node_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_owning_node ON sessions(owning_node_id);

-- RLS policies: cello_service can INSERT and SELECT on both tables
ALTER TABLE directory_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Allow cello_service full read access
CREATE POLICY directory_nodes_select ON directory_nodes
  FOR SELECT TO cello_service USING (true);
CREATE POLICY sessions_select ON sessions
  FOR SELECT TO cello_service USING (true);

-- Allow cello_service insert access
CREATE POLICY directory_nodes_insert ON directory_nodes
  FOR INSERT TO cello_service WITH CHECK (true);
CREATE POLICY sessions_insert ON sessions
  FOR INSERT TO cello_service WITH CHECK (true);

-- Table-level grants for cello_service (required alongside RLS policies)
GRANT SELECT, INSERT ON directory_nodes TO cello_service;
GRANT SELECT, INSERT ON sessions TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE directory_nodes_id_seq TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE sessions_id_seq TO cello_service;
