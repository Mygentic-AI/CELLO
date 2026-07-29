-- V52 — M10B / DOD-END-DELIVER-1 (M10B-D23): re-key pickup_queue's pending uniqueness to
-- (agent_id, signal_kind, signal_hash).
--
-- ══ THE DEFECT THIS FIXES: THE SECOND ENDORSEMENT OF A SUBJECT IS SILENTLY DESTROYED ══════════════
-- V37 enforces ONE pending pickup per (agent_id, signal_kind), and `enqueuePickup` upserts against it
-- with DO UPDATE. Two different people endorse Alice while her daemon is offline: both deliveries are
-- (alice_agent, 'endorsement'), so the second OVERWRITES the first. No error. The write API reports
-- success. The first endorsement is simply gone.
--
-- Journey case (a2) — "subject offline at mint" — exists precisely to prove a subject who is offline
-- loses nothing, and it is the exact scenario that triggers this.
--
-- ══ WHY V37 WAS RIGHT AND IS NOW WRONG ═══════════════════════════════════════════════════════════
-- V37's cardinality was a faithful model of M10's data: every M10 signal is genuinely one-per-kind
-- (one phone, one email, a track_record that supersedes its predecessor), and it mirrored
-- identity_tree_entries' PK (agent_id, signal_kind) so "the queue and the anchor agree on cardinality".
-- Endorsements are inherently MANY-per-kind — that is what a min_count floor counts. An invariant that
-- modelled the data correctly became silent data loss when the data changed.
--
-- ══ BOTH OF V37'S RATIONALES ARE DISCHARGED — CHECKED, NOT ASSUMED ═══════════════════════════════
-- 1. THE POISON PILL IS STRUCTURALLY IMPOSSIBLE NOW. V37 feared a stale row that "hashes to the
--    SUPERSEDED identity-tree anchor and re-fires hash_mismatch forever". That needs a SEPARATE anchor
--    to disagree with, and there isn't one: V48 DROPPED identity_tree_entries outright, no live code
--    references it, and the daemon's surviving hash_mismatch compares a delivered envelope against the
--    claimed hash carried on its OWN pickup row (trust-signal-store.ts). A mismatch therefore means the
--    row disagrees with itself — corruption or tampering, never staleness. The poison pill was a
--    property of the JOIN, and M10 removed the JOIN. V37 outlived its reason by one migration.
-- 2. THE READ-COMMITTED RACE STAYS CLOSED. V37 also existed because two concurrent same-(agent,kind)
--    enqueues could BOTH survive at READ COMMITTED (neither sees the other's uncommitted INSERT),
--    silently re-arming the poison pill. Under the new key, two concurrent enqueues of the SAME content
--    still collide on the unique index and one takes the DO UPDATE. Only DIFFERENT content survives
--    alongside — which is now the required behaviour rather than the bug.
--
-- ══ WHAT IS LOST, STATED RATHER THAN GLOSSED ═════════════════════════════════════════════════════
-- Supersession loses its pickup-row REPLACEMENT: a re-minted phone signal now leaves its predecessor's
-- pending row instead of overwriting it, so a daemon may receive both. That is safe — the wallet is
-- content-addressed (duplicate delivery is a no-op), both envelopes verify, and supersession is already
-- carried correctly by three other mechanisms: supersedes_hash inside the envelope,
-- signal_records_effective marking the predecessor superseded, and the daemon's own cascade on receipt
-- (all proven green by M10's j-track-record journey). The pickup row's replacement was a second, weaker
-- copy of that job — and it is the copy that silently drops data.
--
-- ══ ZERO-BUMP ════════════════════════════════════════════════════════════════════════════════════
-- The new key is (agent_id, signal_kind, signal_hash) — signal_hash is CONTENT, not type. The
-- cardinality change applies to every signal family uniformly; no branch on 'endorsement' appears
-- anywhere. Rejected alternative: give endorsements a per-submission signal_kind ("endorsement:<hash>")
-- to dodge the migration entirely — it smuggles content into a kind field, breaks that field's meaning
-- for every other consumer, and is a blocking INV-ZEROBUMP violation.
--
-- ══ REPLICATION SAFETY ═══════════════════════════════════════════════════════════════════════════
-- pickup_queue is in cello_pub. This migration only REPLACES a partial unique index — it adds no
-- column, changes no PK, and touches no row. A WIDER uniqueness constraint can never reject a row the
-- narrower one accepted, so a subscriber applying rows during a rolling deploy cannot start failing
-- because of this change. (The reverse — narrowing — would be the dangerous direction.)
--
-- Idempotent, and ordered so there is no window where NEITHER constraint holds: create the new index
-- first, then drop the old one.

-- Collapse any duplicates the old index could not have permitted but a partially-migrated node might
-- hold, keeping the newest per (agent_id, signal_kind, signal_hash). No-op in practice — the queue is
-- ephemeral — but the index creation would fail otherwise, and failing here is worse than being sure.
DELETE FROM pickup_queue p
 USING pickup_queue q
 WHERE p.acked_at IS NULL
   AND q.acked_at IS NULL
   AND p.agent_id = q.agent_id
   AND p.signal_kind IS NOT DISTINCT FROM q.signal_kind
   AND p.signal_hash IS NOT DISTINCT FROM q.signal_hash
   AND p.id < q.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pickup_queue_one_pending_per_hash
  ON pickup_queue (agent_id, signal_kind, signal_hash) WHERE acked_at IS NULL;

DROP INDEX IF EXISTS idx_pickup_queue_one_pending_per_kind;
