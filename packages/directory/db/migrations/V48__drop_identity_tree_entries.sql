-- V48 — Drop identity_tree_entries (M8 legacy table, fully retired).
--
-- This table was the M8 write-seam anchor: the portal wrote a signal hash into
-- identity_tree_entries, then delivered the sealed ciphertext to pickup_queue. The
-- drain JOINed the two to pair hash + ciphertext. M10's architecture replaced this
-- with a self-contained delivery (pickup_queue.signal_hash, V47) anchored to
-- signal_records (V46). The table is empty (confirmed 2026-07-17) and no code path
-- produces new rows (the trust_signal_hash write arm was retired in M10-D18).

DROP TABLE IF EXISTS identity_tree_entries;
