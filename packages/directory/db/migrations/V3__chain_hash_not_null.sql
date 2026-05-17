-- CELLO-PERSIST-004 — Enforce NOT NULL on chain_hash columns.
--
-- V2 introduced chain_hash as nullable TEXT. After PERSIST-004, every INSERT
-- must compute and include a chain_hash — null values are a protocol violation.
-- This migration adds the NOT NULL constraint to all hash-chained tables.
--
-- Precondition: all existing rows must already have a non-null chain_hash.
-- If seed data exists without chain_hash, run the backfill script before this migration.

ALTER TABLE agent_registrations ALTER COLUMN chain_hash SET NOT NULL;
ALTER TABLE connection_requests ALTER COLUMN chain_hash SET NOT NULL;
ALTER TABLE conversation_seals ALTER COLUMN chain_hash SET NOT NULL;
ALTER TABLE conversation_attestations ALTER COLUMN chain_hash SET NOT NULL;
ALTER TABLE conversation_participation ALTER COLUMN chain_hash SET NOT NULL;
ALTER TABLE notification_events ALTER COLUMN chain_hash SET NOT NULL;
