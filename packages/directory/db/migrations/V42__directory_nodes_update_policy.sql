-- V42: directory_nodes UPDATE RLS policy (cross-node presence fix)
--
-- The per-node liveness heartbeat (refreshNodeHeartbeat, PRESENCE-001 / READ-001) keeps
-- directory_nodes.last_heartbeat_at fresh; the read rule treats an agent as online only if its
-- owning node's heartbeat is fresh. V17 created only SELECT + INSERT policies for cello_service, and
-- V38 GRANTed UPDATE but never added an UPDATE *policy* — so under row-level security the heartbeat's
-- UPDATE path was silently blocked (0 rows). last_heartbeat_at was therefore never refreshed, the
-- freshness JOIN aged EVERY agent to dark/offline, and cross-node discovery always returned "offline".
--
-- This adds the missing UPDATE policy so the heartbeat upsert (V42-era refreshNodeHeartbeat:
-- INSERT ... ON CONFLICT (node_id) DO UPDATE SET last_heartbeat_at) can keep the node's own row fresh.
-- Idempotent (IF NOT EXISTS), matching the V17 policy-creation style.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'directory_nodes' AND policyname = 'directory_nodes_update'
  ) THEN
    CREATE POLICY directory_nodes_update ON directory_nodes
      FOR UPDATE TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;
