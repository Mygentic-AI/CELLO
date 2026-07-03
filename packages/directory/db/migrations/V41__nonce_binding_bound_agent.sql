-- V41__nonce_binding_bound_agent.sql — M8B-PREAUTH-CAP security fix.
--
-- Rename pre_auth_nonce_bindings.bound_epoch -> bound_agent.
--
-- Single-use for a pre-auth capability must bind the nonce to the AGENT (its round-1 K_local pubkey),
-- NOT to the client-supplied DKG epoch. The epoch is attacker-controlled on the wire, so binding to it
-- let one capability register TWO different agents under one reused epoch string (a code review caught
-- this). V40 shipped the column as bound_epoch and was already applied to a database; per the M5 rule
-- "never modify an applied migration," the rename is a NEW migration rather than an edit to V40.
--
-- Safe on data: the table is empty and unused up to this point — the capability gate that writes it
-- ships in the same release. RENAME COLUMN preserves the PK, RLS policies, and grants.

ALTER TABLE pre_auth_nonce_bindings RENAME COLUMN bound_epoch TO bound_agent;
