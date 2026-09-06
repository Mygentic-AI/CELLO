-- V65: agent_profiles.key_binding — 038-KEYBIND.
--
-- ─── What this column holds, and why a directory stores something it cannot read ───────────────
-- A 64-byte Ed25519 signature (hex) by the agent's OWN K_local over (k_local_pubkey,
-- primary_pubkey), taken from `dkg_complete` at the tail of registration.
--
-- An agent has two keypairs. K_local is the 64-hex identity its operator hands around; the FROST
-- group keypair comes out of the DKG and its private half never exists anywhere, only shares.
-- Nothing linked them. So a responder receiving its first session assignment verified the
-- assignment's threshold signature against `signer_pubkey` — a field of the same document — and
-- then recorded that key as the counterparty's identity forever. The signature always verified. It
-- established nothing about who signed, which meant a directory naming any group key it liked was
-- indistinguishable from an honest one.
--
-- ─── THE DIRECTORY IS THE CARRIER, NEVER THE AUTHORITY ────────────────────────────────────────
-- This node stores the value and serves it on every session assignment. It CANNOT produce one: the
-- signer is K_local, which no directory holds. It cannot swap one either — the signed bytes name
-- the identity the binding belongs to, so a binding lifted onto another agent fails.
--
-- The only thing a hostile directory can do is WITHHOLD it, and both clients refuse a session
-- assignment that arrives without one. That is the deliberate shape: substituting a DIRECTORY
-- signature here would turn "unverifiable" into "a directory says so", and one dishonest directory
-- would still get through.
--
-- ─── Nullable, and what a NULL means operationally ────────────────────────────────────────────
-- A migration cannot mint a signature — only the daemon holding the seed can. So rows written
-- before this column exists read back NULL, and the client for such an agent has not sent one.
--
-- THIS NODE STILL BROKERS THE SESSION, and logs `session.key_binding.unavailable` naming which
-- side is unbound. It does NOT refuse: a directory cannot verify a binding, so a refusal here
-- would put the decision in the one party that cannot make it. Both CLIENTS refuse the assignment
-- instead — by name, with the remedy — which is the enforcement point that can actually check a
-- signature. The operator re-registers, the daemon mints the binding from key material it already
-- has (no second DKG — key refresh preserves the group key), and the row is written with it.
--
-- Registration itself is where the fail-closed sits: `decodeInboundSignalingFrame` REJECTS a
-- `dkg_complete` that carries no `key_binding`, so no new profile can be written without one. The
-- nullability below exists only for rows that predate this migration.
--
-- ─── Hash chain: NOT AFFECTED, and that is checked rather than assumed ────────────────────────
-- `agent_profiles` is not in HASH_CHAINED_TABLES (hash-chain.ts) and setProfile writes a plain
-- INSERT with no chain_hash, so the V29/V64 "new column breaks verifyChain for every prior row"
-- pattern does not apply here. Nothing is added to any exclusion set.
--
-- Its integrity does not need the chain in any case: the value is self-authenticating. A tampered
-- binding is a signature that fails verification on the client, which is a stronger guarantee than
-- tamper-evidence at rest.
--
-- ─── Anti-entropy: the column IS replicated (ae-table-encoders.ts) ────────────────────────────
-- Added to AGENT_PROFILES_SPEC.immutableColumns. It is set once at registration and never UPDATEd,
-- which is the bar that list requires. A node that learns a profile by replication and NOT by
-- serving the registration must be able to serve the binding, or a session brokered by that node
-- is refused by both clients for a reason neither operator can act on — the same failure shape as
-- the NULL agent_id that made the kill switch silently pass on replicated profiles.
--
-- Additive, nullable, no backfill.

ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS key_binding TEXT;

COMMENT ON COLUMN agent_profiles.key_binding IS
  '038-KEYBIND: hex 64-byte Ed25519 signature by the agent''s own K_local over '
  '(k_local_pubkey, primary_pubkey). The directory stores and serves it and can neither forge nor '
  'swap it — the signer is a key no directory holds, which is why this node never verifies it. '
  'NULL means the agent registered before the proof existed: sessions for it are still brokered '
  'here and REFUSED BY BOTH CLIENTS, which are the only parties that can check the signature.';
