-- V17: directory_nodes table
-- Required by DEPLOY-001 AC-010
-- Tracks the set of directory nodes in the federation.
-- The sessions table and owning_node_id column are created by FEDERATION-001 (V18).

CREATE TABLE IF NOT EXISTS directory_nodes (
  id BIGSERIAL PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  endpoint TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: cello_service can INSERT and SELECT
ALTER TABLE directory_nodes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'directory_nodes' AND policyname = 'directory_nodes_select'
  ) THEN
    CREATE POLICY directory_nodes_select ON directory_nodes FOR SELECT TO cello_service USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'directory_nodes' AND policyname = 'directory_nodes_insert'
  ) THEN
    CREATE POLICY directory_nodes_insert ON directory_nodes FOR INSERT TO cello_service WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON directory_nodes TO cello_service;
GRANT USAGE, SELECT ON SEQUENCE directory_nodes_id_seq TO cello_service;
