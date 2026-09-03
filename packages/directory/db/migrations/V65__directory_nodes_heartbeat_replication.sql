-- V65 — directory_nodes.last_heartbeat_at becomes a TOTAL, replicable Tier-B merge input
-- (DOD-M15-HEARTBEAT-1).
--
-- WHY THIS EXISTS. `directory_nodes` is a Tier-A (append-only, content-addressed) anti-entropy
-- table carrying `node_id` + `region` only. Tier A hashes IMMUTABLE columns, so the mutable
-- `last_heartbeat_at` (V33) could never ride it — every node therefore read every OTHER node as
-- never-heartbeated. This migration is the schema half of giving the column a Tier-B mutable merge;
-- the merge itself is `directory-node-heartbeat-merge.ts` and the spec is `ae-mutable-version.ts`.
--
-- WHY NOT NULL, AND WHY IT IS THE LOAD-BEARING CHANGE. The Tier-B round hashes a row twice by two
-- different routes: the ADVERTISE path encodes the raw pg row, and the SERVE/APPLY path encodes
-- `rowToBody(row)`. A NULL travels those routes differently — raw NULL normalizes to `null`, while
-- `rowToBody`'s `String(null)` yields the literal `"null"` — so two nodes holding IDENTICAL state
-- would compute DIFFERENT version hashes, disagree forever, and pull each other every round without
-- ever converging. `agent_suspensions.origin_node` hit exactly this and is COALESCE'd at its SELECT
-- for the same reason. Making the column total removes the class rather than patching one query.
--
-- WHY epoch 0 IS THE RIGHT "NEVER". The read rule is a freshness comparison
-- (`last_heartbeat_at > now() - interval`), which epoch 0 fails exactly as NULL did — a node that
-- has never heartbeated still reads as not-fresh, the safe direction V33 chose. It also gives the
-- merge a total order with no three-valued logic: "never" simply loses to every real heartbeat.
--
-- NO SEPARATE updated_at COLUMN, DELIBERATELY. `agent_presence` carries both `last_seen_at` (the
-- displayed value) and `updated_at` (the LWW ordering key) because they are two different facts. A
-- heartbeat is ONE fact: the column IS the freshness signal and IS the merge input. A second column
-- that always equalled it would be a field with no consumer.

-- 1. Backfill: rows registered but never heartbeated (V17 INSERTs set no heartbeat).
UPDATE directory_nodes SET last_heartbeat_at = to_timestamp(0) WHERE last_heartbeat_at IS NULL;

-- 2. New rows default to "never heartbeated" rather than NULL. Both writers that create a row
--    supply no heartbeat: `insertDirectoryNode` (node registration) and the Tier-A anti-entropy
--    apply (node_id + region only). Without a DEFAULT, step 3 would reject both.
ALTER TABLE directory_nodes ALTER COLUMN last_heartbeat_at SET DEFAULT to_timestamp(0);

-- 3. The totality the Tier-B version hash depends on.
ALTER TABLE directory_nodes ALTER COLUMN last_heartbeat_at SET NOT NULL;

-- RLS: no new policy is needed and that is a measured statement, not an assumption.
-- directory_nodes already carries SELECT + INSERT policies for cello_service (V17) and an UPDATE
-- policy (V42). V42 exists because V38 GRANTed UPDATE without adding the matching POLICY, so the
-- heartbeat's own UPDATE was silently blocked at 0 rows — the identical trap this migration would
-- have walked into. The Tier-B apply path uses SELECT ... FOR UPDATE, UPDATE and INSERT, all three
-- of which are policied. It never DELETEs, which is the one command with no policy.
