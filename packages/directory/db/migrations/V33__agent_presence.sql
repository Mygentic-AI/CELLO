-- V33 — agent_presence (mutable, edge-triggered, sovereign-owned) + per-node liveness heartbeat.
-- CELLO-M8-PRESENCE-001.
--
-- Online presence today lives only in each node's in-memory #streams map (not persisted, not
-- replicated, no query API). The hosted portal reads only REPLICATED directory state, so presence
-- must be persisted. This is HIGH-CHURN mutable state → a mutable upsert table (one row per agent),
-- NOT an append-only / chain-hashed record. Writes are edge-triggered (connect/disconnect only).
--
-- Sovereign write-ownership (load-bearing, [[project_sovereign_nodes]]): a node writes presence
-- ONLY for agents connected to IT, recording its own node_id in owning_node_id — the same pattern
-- as sessions.owning_node_id. Cross-node writes are prevented in application code (the node only
-- upserts for agents in its own #streams); RLS stays permissive for the shared cello_service role,
-- matching every other directory table.

-- Keyed by k_local_pubkey — the agent's stable Ed25519 identity. It is what the #streams auth
-- hook holds directly (the authenticated signaling pubkey) and is UNIQUE NOT NULL on
-- agent_profiles (agent_profiles.agent_id can be NULL/derived), so it joins cleanly to
-- agent_profiles for the account-scoped read with NO lookup on the hot connect/disconnect path.
CREATE TABLE agent_presence (
  k_local_pubkey  TEXT PRIMARY KEY,                 -- one MUTABLE row per agent (no chain_hash)
  owning_node_id  TEXT NOT NULL,                    -- the node that owns this agent's connection
  online          BOOLEAN NOT NULL DEFAULT false,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_presence_owning_node_id_idx ON agent_presence(owning_node_id);

-- cello_service gets full DML on this mutable table (INSERT for the first transition, UPDATE for
-- subsequent ones, SELECT for the read path). RLS enabled; idempotent policy creation.
ALTER TABLE agent_presence ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_presence'
      AND policyname = 'agent_presence_service'
  ) THEN
    CREATE POLICY agent_presence_service ON agent_presence
      TO cello_service USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT INSERT, SELECT, UPDATE, DELETE ON agent_presence TO cello_service;

-- Per-node liveness heartbeat — the node-liveness guard for the presence read rule. A node
-- refreshes last_heartbeat_at on a coarse cadence (~30-60s, one tiny write per node). The read
-- rule (READ-001) treats an agent as online ONLY IF its presence row is online AND the OWNING
-- node's last_heartbeat_at is fresh — so a crashed node's stale 'online' rows age out to
-- last-seen (the edge-triggered offline write never fired). Nullable: a node that has never
-- heartbeat reads as not-fresh (deny → last-seen), the safe direction.
ALTER TABLE directory_nodes ADD COLUMN last_heartbeat_at TIMESTAMPTZ;
