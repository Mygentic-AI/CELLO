-- V61: natural keys for conversation_participation and conversation_attestations, so the seal's
-- CHILDREN can replicate.
--
-- ─── The gap this closes, and why it is different from V59/V60 ──────────────────────────────────
-- Those two were columns excluded from a hashed set. This is a pair of tables that were never
-- considered at all. `ae-table-encoders.ts` says so in its own words, and deliberately lists them
-- apart from the tables that were weighed and excluded:
--
--   "They are listed separately from the block above on purpose. Everything there was weighed and
--    excluded; these two were never considered."
--
-- The consequence is already written down beside it: `recordConversationSeal` writes the seal header
-- and BOTH children in ONE transaction, but only the header is registered for anti-entropy. So a
-- node that receives a seal by replication gets the header and learns neither who took part nor what
-- was attested — and `analytics-job` derives `pseudonym_stats` and `graph_edges` from exactly those
-- two tables, so the track-record surface differs per node with nothing reporting it.
--
-- Confirmed live 2026-08-07 rather than inferred: gcp-use1 held 22 rows in each table and gcp-usc1
-- held 38. Same consortium, same conversations.
--
-- ─── Why a migration is needed at all ───────────────────────────────────────────────────────────
-- Both tables are already append-only (INSERT + SELECT grants, UPDATE/DELETE revoked), so they are
-- Tier-A-shaped. What they lack is a NATURAL KEY: the primary key is a BIGSERIAL `id`, which differs
-- per node for the same fact and must never cross the wire. Tier-A apply is
-- `INSERT … ON CONFLICT (naturalKey) DO NOTHING`, and that requires a real unique constraint to
-- conflict against.
--
-- SAFE TO ADD, CHECKED FIRST: a UNIQUE constraint on a table that already contains duplicates fails
-- the migration, and a failed migration crash-loops the directory at startup. Both candidate keys
-- were verified duplicate-free on every live node before this was written. The constraint is what
-- makes "one participation per party per conversation" a rule rather than a convention.

-- One row per party per conversation.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_participation_natural_key'
  ) THEN
    ALTER TABLE conversation_participation
      ADD CONSTRAINT conversation_participation_natural_key
      UNIQUE (conversation_id, party_pseudonym);
  END IF;
END $$;

-- One attestation per participant per conversation. The CHECK on `attestation` admits PENDING and
-- DELIVERED, which reads like a state machine — but UPDATE is revoked on this table, so a change of
-- state cannot be an UPDATE and the pair stays unique. If a transition ever needs to be recorded, it
-- has to arrive as a new fact with its own key, not by rewriting this row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_attestations_natural_key'
  ) THEN
    ALTER TABLE conversation_attestations
      ADD CONSTRAINT conversation_attestations_natural_key
      UNIQUE (conversation_id, participant_pseudonym);
  END IF;
END $$;
