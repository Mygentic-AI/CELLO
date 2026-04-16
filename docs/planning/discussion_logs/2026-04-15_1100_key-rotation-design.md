---
name: Key Rotation Design — Per-Agent K_server and Independent K_local/K_server Rotation
type: discussion
date: 2026-04-15 11:00
topics: [FROST, split-key, K_local, K_server, key-rotation, key-management, signing, session-management, compromise-canary, storage, envelope-encryption, proactive-secret-sharing, federation, threshold-signing]
description: Resolves Problem 9 (K_server rotation overlap window). Establishes that K_server is per-agent, stored as threshold shares with envelope encryption, and rotates independently from K_local. K_server rotation is a directory-only operation; K_local rotation is agent-controlled with directory nudges. The combination of session-level FROST and per-agent K_server eliminates the original catastrophic rotation scenario entirely.
---

# Key Rotation Design — Per-Agent K_server and Independent K_local/K_server Rotation

## Starting point

The prior design left K_server rotation as an open problem (Problem 9). The scope was already narrowed by the session-level FROST decision: FROST ceremonies only happen at session establishment and seal, not per message. This session resolves the remaining design work.

---

## K_server is per-agent, not shared

The first design question: is K_server a single directory key used for all agents, or a distinct key per agent?

**Model A (shared K_server):** The directory has one FROST key distributed as threshold shares across nodes. Every FROST ceremony for every agent uses the same key. Each node holds one K_server share total.

**Model B (per-agent K_server):** Each agent X has their own K_server_X, distributed as threshold shares across the directory nodes. Each node holds one share of K_server_X for every registered agent. Different K_server key material per agent.

**Decision: Model B.** This was the intended design from the beginning. It gives stronger security: even a compromised directory cannot forge agent X's FROST signatures without X's specific K_server_X shares. And per-agent keys enable independent per-agent rotation.

Model A was never seriously considered — it's documented here for clarity.

---

## Key storage: per-agent shares in database with envelope encryption

**The storage concern:** Model B means each directory node holds one K_server_X share per registered agent. At 1 million agents and 10 nodes, that is 10 million shares total, 1 million per node.

**Storage cost:** Each FROST share is a 32-byte Ed25519 scalar. 1 million shares per node = 32 MB. This is trivial.

**The cost concern:** Storing each share individually in AWS KMS ($1/key/month) would be $1M/month for 1 million agents. This is not the right tool.

**Solution: envelope encryption.** Each node has one master encryption key stored in KMS (~$0.03/month per node, regardless of agent count). All K_server_X shares on that node are encrypted with this master key and stored in an ordinary database. This is the standard pattern for secrets management at scale.

**The observation that clarifies this:** Whether you store 1 million encrypted shares (with one database master key) or derive keys from one K_master, the security of both models collapses to protecting one key per node. The number of secrets inside the encrypted database is operationally significant but not a security boundary. The database is secured by one key either way.

**Conclusion:** Per-agent stored shares with envelope encryption. Standard construction, independent per-agent rotation, GDPR-friendly (agent's shares can be deleted by row on tombstone).

### Why the linear derivation approach was rejected

A mathematically valid compact-storage alternative: K_server_X = K_master + H(agent_id_X), where each node computes derived_share_i(X) = master_share_i + H(agent_id_X). This preserves Shamir's polynomial structure because adding the same public scalar to all shares is a linear transformation.

Rejected for three reasons:
1. Non-standard construction — requires dedicated cryptographic review before it can be trusted
2. Couples all agents' rotation together — rotating K_master rotates K_server_X for every agent simultaneously, reintroducing the global rotation timing problem
3. Solves a storage problem that doesn't exist — per-agent stored shares cost 32 MB per node per million agents

---

## Database durability

**The concern:** A directory node's database could be corrupted, deleted, or otherwise lost. If K_server_X shares are gone, FROST ceremonies for affected agents cannot complete.

**Answer: proactive secret sharing (share refresh).** If a node loses its K_server_X share database, the remaining t-of-n nodes can collectively regenerate new shares for the lost node without ever assembling K_server_X. Each surviving node contributes a sub-share; the recovering node combines them into a valid new share of the same underlying secret. K_server_X is never assembled at any point.

This means node recovery is a defined protocol operation, not a disaster. The underlying key material is recoverable from the surviving threshold nodes.

Share refresh also serves a second purpose: periodic refresh of all shares across all nodes (even without any loss) invalidates any shares leaked through separate incidents over time. This is proactive security.

**Protection stack:**
- AWS KMS for node master key (envelope encryption)
- Encryption at rest on the database
- Backup replication (multi-region)
- Proactive share refresh as the cryptographic recovery backstop

---

## K_server rotation is a directory-only operation

**What K_server_X rotation protects against:** Leaked directory node shares. If some node's K_server_X shares are suspected of extraction, rotating K_server_X generates new shares and retires the old ones. The leaked shares become useless.

**What K_server_X rotation does NOT protect against:** A stolen K_local. The attacker still has the agent's key and can request FROST co-signing from the directory. K_server_X rotation changed the directory's internal key material but the attacker doesn't need that — they just need the directory to cooperate.

**Mechanism:** K_server_X rotation is entirely internal to the directory nodes. The agent is not involved. The agent receives a notification containing the new pubkey(K_server_X) and uses it at their next session boundary. No ceremony, no re-keying, no agent action required.

**Why the original catastrophic scenario is eliminated:** The original Problem 9 described global K_server rotation causing network-wide stale-pubkey confusion and false compromise canary fires. This cannot happen because:
- K_server_X is per-agent — rotating it changes one agent's pubkey, not all agents
- Messages don't use FROST — no per-message pubkey verification failures
- The canary fires when FROST session establishment fails, not when a pubkey is stale

---

## K_local rotation is an agent-controlled operation

**What K_local rotation protects against:** A stolen K_local. When the agent generates a new K_local_v2 and the directory retires K_local_v1, the attacker's stolen key becomes immediately useless. The directory refuses to co-sign any FROST ceremony presenting the old key.

**Mechanism:**
1. Directory sends the agent a `KEY_ROTATION_RECOMMENDED` notification — a strong nudge, not a command
2. Agent completes any active session (or seals it)
3. At the next session boundary, agent generates new K_local_v2
4. Agent registers K_local_v2 with the directory (authenticated via WebAuthn/phone OTP)
5. Directory retires K_local_v1 — no further FROST co-signing for the old key
6. A new K_server_X ceremony runs to produce shares paired with K_local_v2
7. Old K_server_X shares are retired

**Voluntary but nudged:** K_local rotation is the agent's choice. The directory does not force it. But the directory sends strong notifications recommending rotation on a schedule, and after anomalous activity (suspected compromise). The agent chooses the exact moment — at a session boundary, not mid-conversation.

**Timing is invisible:** Because rotation is per-agent and happens at session boundaries mixed into normal session activity, there is no observable global "rotation event" for an attacker to time an attack against.

---

## The two rotation operations are independent

| Operation | What it protects | Who controls it | Visibility to counterpart |
|---|---|---|---|
| K_server_X rotation | Leaked directory node shares | Directory | Agent receives new pubkey notification |
| K_local rotation | Stolen K_local | Agent (directory nudges) | Directory retires old pubkey |

K_server_X can rotate without the agent doing anything. K_local can rotate without K_server_X changing (though a new K_server_X ceremony runs as part of K_local rotation to pair with the new key). Neither rotation depends on the other.

---

## Resolution of Problem 9

The original problem had three hard components:

1. **In-flight signatures straddling K_server rotation** — Eliminated. Messages don't use FROST. Only session establishment proofs and conversation seals carry K_server signatures, and both are short-lived ceremonies.

2. **Global atomic pubkey publication** — Eliminated. K_server_X is per-agent. The directory notifies agent X of their new pubkey. No global coordination across all clients.

3. **False compromise canary fires on rotation** — Eliminated. The canary fires on failed FROST session establishment, not on stale pubkeys. Per-agent rotation changes one agent's pubkey; other agents are unaffected.

Remaining specification work (not hard design problems): the exact format of the K_server_X rotation notification, the grace period duration for sealing active sessions under old K_server_X, and the epoch identifier format for FROST ceremony outputs.

---

## Related Documents

- [[design-problems|Design Problems]] — Problem 9 (K_server rotation overlap window) resolved here; Problem 1 (fallback) severity previously reduced
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — session-level FROST is the prerequisite that reduced FROST to two ceremony points; this session builds on it
- [[cello-design|CELLO Design Document]] — K_server Protection and Home Node sections describe the FROST threshold architecture this rotation design builds on
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — session establishment and seal are the only two points where K_server rotation matters
- [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] — FROST threshold signing and the IThresholdSigner abstraction; K_server rotation uses the same FROST DKG infrastructure
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — K_server_X shares stored in the node database; initial_fallback_pubkey_hash is the K_local registration record
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — K_local rotation is closely related to the compromise recovery flow; tombstone triggers K_server_X invalidation
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — proactive share refresh operates across the same node infrastructure described there
- [[frontend|CELLO Frontend Requirements]] — K_local rotation prompt UI, K_LOCAL_DEGRADED_MODE banner, and whitelist/degraded-mode-list configuration panel sourced from this log
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — per-agent K_server_X rotation, proactive share refresh, and dual-meaning KEY_ROTATION_RECOMMENDED resolution are server-side infrastructure concerns specified here
- [[agent-client|CELLO Agent Client Requirements]] — Part 1 implements the two-key model (identity key vs. signing key), KeyProvider abstraction, K_local rotation flow, and seed phrase backup; Part 4 covers K_local rotation at session boundaries
