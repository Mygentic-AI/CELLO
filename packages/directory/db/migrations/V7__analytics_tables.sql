-- CELLO-PERSIST-008 — Analytics tables and cello_analytics role
--
-- Creates the three output tables for the analytics cron job:
--   pseudonym_stats          — per-pseudonym aggregate statistics (UPSERT)
--   conversation_graph_edges — pre-computed adjacency between pseudonym pairs (UPSERT)
--   graph_analysis_results   — clustering coefficient, community, conductance (UPSERT)
--   analytics_run_log        — records each run's completion time for stale detection (UPSERT)
--
-- These tables support UPSERT (INSERT ON CONFLICT DO UPDATE) and are NOT append-only.
-- They are derived views of the append-only protocol tables — they can be recomputed
-- from scratch at any time.
--
-- Security:
--   cello_analytics role — SELECT-only on all append-only protocol tables.
--   cello_analytics cannot INSERT, UPDATE, or DELETE any protocol table.
--   cello_analytics has INSERT, UPDATE, SELECT, DELETE on output tables only.
--   cello_service writes to output tables (AnalyticsJob uses separate read/write pools).
--
-- SI-002: cello_analytics is a separate role from cello_service — a compromised analytics
--   job cannot INSERT into protocol tables or read encrypted K_server_X shares.

-- ─── cello_analytics role ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cello_analytics') THEN
    CREATE ROLE cello_analytics LOGIN PASSWORD 'cello_analytics_dev'; -- dev-only; production role provisioned by IaC
  END IF;
END;
$$;

GRANT CONNECT ON DATABASE cello_dev TO cello_analytics;
GRANT USAGE ON SCHEMA public TO cello_analytics;

-- SI-001: Grant SELECT-only on all append-only protocol tables.
-- The analytics job reads from these tables to compute statistics.
-- NOTE: agent_registrations is dropped in V16__drop_agent_registrations.sql — agent_profiles (V9) is the authoritative agent identity table
GRANT SELECT ON agent_registrations TO cello_analytics;
GRANT SELECT ON connection_requests TO cello_analytics;
GRANT SELECT ON conversation_seals TO cello_analytics;
GRANT SELECT ON conversation_attestations TO cello_analytics;
GRANT SELECT ON conversation_participation TO cello_analytics;
GRANT SELECT ON notification_events TO cello_analytics;
GRANT SELECT ON conversation_proof_leaves TO cello_analytics;
GRANT SELECT ON conversation_proof_mmr_nodes TO cello_analytics;
GRANT SELECT ON directory_checkpoints TO cello_analytics;

-- ─── pseudonym_stats — per-pseudonym aggregate view ──────────────────────────
-- UPSERT target for the analytics job. NOT append-only.
-- Keyed by pseudonym (stable pseudonymous identity from conversation_participation).

CREATE TABLE IF NOT EXISTS pseudonym_stats (
  pseudonym                  TEXT        PRIMARY KEY,
  conversation_count         BIGINT      NOT NULL DEFAULT 0,
  unique_counterparty_count  BIGINT      NOT NULL DEFAULT 0,
  clean_count                BIGINT      NOT NULL DEFAULT 0,
  flagged_count              BIGINT      NOT NULL DEFAULT 0,
  last_activity              TIMESTAMPTZ,
  computed_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- cello_service writes analytics output
GRANT INSERT, SELECT, UPDATE, DELETE ON pseudonym_stats TO cello_service;

-- cello_analytics can read output (e.g. for debugging)
GRANT SELECT ON pseudonym_stats TO cello_analytics;

-- ─── conversation_graph_edges — adjacency between pseudonym pairs ─────────────
-- One row per unique (pseudonym_a, pseudonym_b) pair where pseudonym_a < pseudonym_b
-- (lexicographic canonical ordering to avoid duplicate edges for A-B vs B-A).
-- edge_weight = number of sealed conversations between the pair.

CREATE TABLE IF NOT EXISTS conversation_graph_edges (
  pseudonym_a   TEXT    NOT NULL,
  pseudonym_b   TEXT    NOT NULL,
  edge_weight   BIGINT  NOT NULL DEFAULT 1,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pseudonym_a, pseudonym_b),
  -- Enforce canonical ordering: pseudonym_a < pseudonym_b
  CONSTRAINT cgef_ordered CHECK (pseudonym_a < pseudonym_b)
);

CREATE INDEX IF NOT EXISTS idx_cge_pseudonym_a ON conversation_graph_edges (pseudonym_a);
CREATE INDEX IF NOT EXISTS idx_cge_pseudonym_b ON conversation_graph_edges (pseudonym_b);

GRANT INSERT, SELECT, UPDATE, DELETE ON conversation_graph_edges TO cello_service;
GRANT SELECT ON conversation_graph_edges TO cello_analytics;

-- ─── graph_analysis_results — per-pseudonym graph metrics ────────────────────
-- Clustering coefficient, community assignment, conductance score.
-- All fields must be non-NULL after a successful analytics run (AC-003).

CREATE TABLE IF NOT EXISTS graph_analysis_results (
  pseudonym               TEXT            PRIMARY KEY,
  clustering_coefficient  DOUBLE PRECISION NOT NULL DEFAULT 0,
  community_id            BIGINT          NOT NULL DEFAULT 0,
  conductance_score       DOUBLE PRECISION NOT NULL DEFAULT 0,
  computed_at             TIMESTAMPTZ     NOT NULL DEFAULT now()
);

GRANT INSERT, SELECT, UPDATE, DELETE ON graph_analysis_results TO cello_service;
GRANT SELECT ON graph_analysis_results TO cello_analytics;

-- ─── analytics_run_log — tracks successful run timestamps ────────────────────
-- Used by DB-002 stale detection: if no row has last_run_at within 24 hours,
-- analytics.job.stale is logged.

CREATE TABLE IF NOT EXISTS analytics_run_log (
  id          BIGSERIAL   PRIMARY KEY,
  run_id      UUID        NOT NULL UNIQUE,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pseudonym_count BIGINT  NOT NULL DEFAULT 0,
  edge_count      BIGINT  NOT NULL DEFAULT 0
);

GRANT INSERT, SELECT, UPDATE, DELETE ON analytics_run_log TO cello_service;
GRANT SELECT ON analytics_run_log TO cello_analytics;
GRANT USAGE ON SEQUENCE analytics_run_log_id_seq TO cello_service;
