-- V36 — LEVER-001 burn: a PERMANENT, replicated burn flag on agent_suspensions.
-- CELLO-M8-LEVER-001 (DOD-LEVER-2, DOD-INV-6). Follows V34 (agent_suspensions) / V35.
--
-- Pause (V34) is reversible: paused can flip true↔false. BURN is permanent — capability dies,
-- accountability survives. `burned` records the permanent tombstone: once true, the agent can NEVER
-- sign again and the flag CANNOT be cleared (un-pause is rejected). agent_suspensions is in cello_pub,
-- so the burn flag REPLICATES to every sovereign node, which each honors independently (the honest-node
-- T-of-N model — never "one node withholds"). The agent_profiles binding (agent_id ↔ key ↔ account) is
-- left UNTOUCHED, so the identity stays resolvable forever (accountability survives — SI-002).
--
-- Coordinated server-side SHARE DESTRUCTION (each node deleting its own K_server_X share) is the
-- separated heavier part of the story; this migration is the contained flag/honor-check/replication part.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE agent_suspensions ADD COLUMN IF NOT EXISTS burned BOOLEAN NOT NULL DEFAULT false;
