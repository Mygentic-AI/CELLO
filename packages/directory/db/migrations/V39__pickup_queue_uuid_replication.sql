-- V39 — pickup_queue: BIGSERIAL→UUID + owning_node_id + replication-ready (DOD-PICKUP-1).
--
-- BIGSERIAL collides cross-node (each node generates from its own sequence). UUID is globally
-- unique by construction. The existing V37 UNIQUE INDEX (idx_pickup_queue_one_pending_per_kind)
-- stays intact — it keys on (agent_id, signal_kind) WHERE acked_at IS NULL, not on id.
--
-- owning_node_id gates sweepUndeliverablePickups: a node only sweeps rows IT wrote. Without
-- this, a non-converged replica could delete a deliverable ciphertext and replicate that delete.
--
-- After this migration: pickup_queue can be added to cello_pub (setup-replication.sh).

-- 1. Add owning_node_id (NOT NULL for new rows; existing rows get a placeholder since all
--    current pickup_queue rows were written by the single us-east-1 node).
ALTER TABLE pickup_queue ADD COLUMN IF NOT EXISTS owning_node_id TEXT;
UPDATE pickup_queue SET owning_node_id = 'us-east-1-legacy' WHERE owning_node_id IS NULL;
ALTER TABLE pickup_queue ALTER COLUMN owning_node_id SET NOT NULL;

-- 2. Change the PK from BIGSERIAL to UUID.
--    - Add a uuid column (gen_random_uuid() for existing rows).
--    - Drop the old id column + sequence (the PK constraint drops with it).
--    - Rename uuid_id → id and set as PK.
ALTER TABLE pickup_queue ADD COLUMN uuid_id UUID DEFAULT gen_random_uuid();
UPDATE pickup_queue SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;
ALTER TABLE pickup_queue ALTER COLUMN uuid_id SET NOT NULL;
ALTER TABLE pickup_queue DROP CONSTRAINT pickup_queue_pkey;
ALTER TABLE pickup_queue DROP COLUMN id;
ALTER TABLE pickup_queue RENAME COLUMN uuid_id TO id;
ALTER TABLE pickup_queue ADD PRIMARY KEY (id);

-- 3. REPLICA IDENTITY DEFAULT (UUID PK) — correct for INSERT/DELETE replication.
ALTER TABLE pickup_queue REPLICA IDENTITY DEFAULT;

-- 4. Grant UPDATE (the ack path sets acked_at) — V34 only granted INSERT+SELECT+DELETE.
GRANT UPDATE ON pickup_queue TO cello_service;
