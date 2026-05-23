-- V20: UNIQUE constraint on checkpoint_node_signatures (checkpoint_id, node_id)
-- SI-001 (FEDERATION-002): one signature per node per checkpoint — same node signing twice
-- does not count toward the 2-of-3 threshold.
--
-- Separated from V18 because V18 was already applied to dev when this constraint
-- was added by FEDERATION-002. Modifying an applied migration breaks Flyway checksum
-- validation — the fix is a new migration.
--
-- Idempotent: IF NOT EXISTS guard makes this safe to run against databases that
-- already have the constraint (e.g. if applied manually as a hotfix).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'checkpoint_node_signatures'
      AND constraint_name = 'checkpoint_node_signatures_checkpoint_node_unique'
  ) THEN
    ALTER TABLE checkpoint_node_signatures
      ADD CONSTRAINT checkpoint_node_signatures_checkpoint_node_unique
      UNIQUE (checkpoint_id, node_id);
  END IF;
END $$;
