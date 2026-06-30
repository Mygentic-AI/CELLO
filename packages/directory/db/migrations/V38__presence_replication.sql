-- V38 — Presence replication (DOD-PRESENCE-1).
-- Adds agent_presence + directory_nodes to cello_pub for cross-node visibility.
--
-- agent_presence already has a TEXT PK (k_local_pubkey) — REPLICA IDENTITY DEFAULT (PK) is correct.
-- directory_nodes has a BIGSERIAL PK (id) which collides cross-node; the natural key is node_id (UNIQUE).
-- Set REPLICA IDENTITY to the node_id unique index so UPDATE replication sends the correct old-key tuple.
--
-- Also grants UPDATE on directory_nodes to cello_service (V17 only granted INSERT+SELECT, but the V33
-- heartbeat UPDATEs last_heartbeat_at — this was a latent permissions gap).

-- 1. Grant UPDATE on directory_nodes (the heartbeat + the owning_node_id tracking).
GRANT UPDATE ON directory_nodes TO cello_service;

-- 2. Set REPLICA IDENTITY for UPDATE replication.
-- agent_presence: DEFAULT (PK = k_local_pubkey) is already correct for mutable/upsert.
ALTER TABLE agent_presence REPLICA IDENTITY DEFAULT;
-- directory_nodes: use the node_id unique index (avoids BIGSERIAL id collisions cross-node).
ALTER TABLE directory_nodes REPLICA IDENTITY USING INDEX directory_nodes_node_id_key;
