-- CELLO-PERSIST-017 — Add correlation_id to conversation_seal_staging
--
-- The SealNotarization handler writes the seal-ceremony correlationId into this column
-- so the MMR checkpoint job can thread it through mmr.session.checkpointed events.
--
-- If the column is absent, the checkpoint job logs without a correlationId — which is
-- a blocking observability gap. This migration makes the gap impossible.
--
-- Design:
--   - Nullable: existing staging rows that predate this migration have no correlationId.
--   - Written by the directory's processSeal handler (or appendSeal caller) at seal time.
--   - Read by confirmCheckpoint when emitting mmr.session.checkpointed per-session.

ALTER TABLE conversation_seal_staging
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;
