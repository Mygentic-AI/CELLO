---
name: Persistence Layer Design
type: discussion
date: 2026-04-11 17:00
topics: [persistence, schema, trust-data, social-verifications, track-record, pseudonym, SQLCipher, PostgreSQL, client-storage, backup, federation, conversation-records, device-attestations, connection-records, key-management, append-only]
description: Complete persistence layer design for client and directory nodes — two-hash social verifications, track record pseudonym with live directory query, conversation record split, client storage options with key provider abstraction, backup strategy, and node-side integrity model.
---

# Persistence Layer Design

## The organizing principle: the connection package drives the schema

The cleanest way to derive what gets stored is to ask: what does Alice send Bob when requesting to connect? For every item Alice sends, the directory holds the corresponding hash. For non-repudiation items (conversation trees), both parties hold local copies.

| What Alice sends Bob | Directory holds | Client holds |
|---|---|---|
| Social verification blobs | `data_hash` + `account_id_hash` per item | The raw blobs and account IDs |
| Endorsement records | `endorsement_hash` per record | The signed records |
| Attestations | `attestation_hash` per record | The signed records |
| Bio | `bio_hash` | The bio text |
| Device attestation proofs | `device_id_hash` + `attestation_hash` | The attestation blobs |
| Pseudonym binding | Signs the `agent_id ↔ pseudonym` binding | The binding proof |
| Bond / stake info | The stake records | References |

The directory is a hash ledger and verification authority. The client is the data custodian. These roles do not overlap.

**One exception — track record:** The directory holds the actual data (conversation counts and outcomes), keyed by pseudonym. Alice presents the binding (`agent_id → pseudonym`); Bob queries the directory live. This is the reverse of all other data — the direction of trust is inverted.

The reason: track record data is not provided by Alice — it is computed by the directory as a side effect of its core function. Every time a conversation seals, the directory records it. It does not need Alice to report what happened; it observed it directly. If Alice held the data and the directory held only a hash, she could self-report selectively — presenting a hash from a favorable past state while hiding recent flagged conversations. Because the directory computed the data itself, self-reporting is not possible. Alice's only contribution is the pseudonym binding — the key that lets Bob look up what the directory already knows.

---

## The identity hierarchy

```
Agent (public_key)
├── Identity (static-ish)
│   ├── social_verifications[]       two hashes per item — see below
│   ├── device_attestations[]        two hashes per item — see below
│   └── bio_hash
│
├── Track Record (grows with usage)
│   └── pseudonym binding            agent_id ↔ pseudonym Y, directory-signed
│       (directory holds the actual data keyed by pseudonym)
│
├── Connection Endorsements
│   └── endorsement_hash[]           hashes of received endorsement records
│
├── Attestations
│   └── attestation_hash[]           hashes of received attestation records
│
├── Conversations
│   └── conversation_records[]       Seals + Participation (split — see below)
│
└── Financial (not day-one)
    ├── bonds[]
    └── payment_methods[]
```

---

## Social verifications — the two-hash pattern

Each social verification produces two hashes serving distinct purposes:

```
account_id_hash:  SHA-256(platform_account_identifier)   — which account
data_hash:        SHA-256(verified_data_blob)             — what was verified
```

### Why two hashes

The separation allows Alice to prove her attributes without revealing her identity. Alice can present the data blob and its hash — "I have a LinkedIn account that is 8 years old with 4,000 followers" — without revealing which LinkedIn account it is. Bob verifies the data is authentic without learning Alice's identity.

If Bob's policy requires identity proof, Alice can additionally present the account identifier and its hash. That reveal is her choice, not a protocol default.

Two distinct trust modes:

| Mode | What Alice sends | What Bob learns |
|---|---|---|
| Attribute proof | data blob + `data_hash` | Verified attributes, no identity |
| Identity proof | account URL + `account_id_hash` + data blob + `data_hash` | Attributes + which specific account |

### Deduplication

The `account_id_hash` also enforces the one-account-per-agent rule. The directory rejects a registration if the `account_id_hash` is already held by an active binding. The owner must sign a release before the account can transfer to a different agent.

This pattern applies identically to all social signals: LinkedIn, GitHub, Twitter/X, phone, and any future verifiable claim.

### Verification flow

1. Agent authenticates via OAuth / social sign-on to prove account ownership
2. CELLO verifies the account, creates the structured data blob
3. CELLO hashes: `data_hash = SHA-256(blob)`, `account_id_hash = SHA-256(account_identifier)`
4. CELLO stores both hashes in the directory. Returns blob + both hashes to client. Discards all content.
5. Client stores the blob and both hashes. CELLO never holds the data again.

The directory cannot reconstruct the data from a hash. The client holds the only copy of the actual content.

---

## Device attestations — same two-hash pattern

Device attestations follow the same structure:

```
device_id_hash:     SHA-256(device_unique_identifier)   — which device (deduplication)
attestation_hash:   SHA-256(attestation_blob)            — proof of attestation
```

Supported types:
- **WebAuthn / FIDO2** — hardware-bound credential; works on any device with a compatible authenticator
- **TPM (Trusted Platform Module)** — embedded chip on modern laptops and desktops; keys non-extractable; signing operations happen inside the chip
- **Play Integrity (Android)** — proves the agent runs on a real, unmodified Android device, signed by Google
- **App Attest (iOS)** — Apple's equivalent; proves genuine app on real Apple hardware

### The deployment insight

The device being attested is not the device running the agent. An agent running on a VPS links the owner's phone and laptop to the account. The attestation says "a real human who owns these specific physical devices controls this account" — regardless of where the agent is deployed. An attacker running 1,000 Sybil accounts on VPSes would need 1,000 real phones and 1,000 real laptops to match this coverage.

Same deduplication and release rules as social verifications: one active binding per device, owner must release before transfer.

---

## Track record — the pseudonym model

### The pseudonym

```
pseudonym = SHA-256(agent_id + salt)
salt      = HKDF(private_key, "track-record-salt", agent_id)
```

The salt is derived from the private key — never stored independently, always recomputable from the master key.

The directory holds track record data keyed by pseudonym. It can compute: "pseudonym Y has 500 conversations, 490 clean, 10 flagged." It cannot attribute those records to any real agent without the binding.

**Stats computation:** The directory counts participation table rows for a given pseudonym and joins against the seals table for outcomes. No salt required. The directory operates entirely on the pseudonym value.

**Salt usage:** The salt is only needed to prove the binding — that pseudonym Y belongs to agent alice_id. Once proved, the directory co-signs the binding. The salt never leaves the Alice→directory channel.

### The binding

Alice presents a minimal signed proof to Bob:

```
{
  agent_id:            alice_id,
  pseudonym:           Y,
  directory_signature: signs(agent_id || pseudonym)
}
```

This is a permanent proof — it does not expire and carries no stats. The directory co-signed it to prevent Alice from claiming someone else's pseudonym.

Bob queries the directory live with pseudonym Y to get current stats. Alice cannot present stale data because she is not presenting the data at all — the directory is the source.

### The gap check

If the directory's participation table shows more conversations for pseudonym Y than were present at the last binding issue, Bob sees the discrepancy. He cannot see the outcomes of those unreported conversations — but he knows unverified recent activity exists. His connection policy can weight this accordingly.

### What Bob receives

| Source | Content |
|---|---|
| From Alice | Pseudonym Y + binding proof (directory-signed) |
| From directory | Live conversation count, **unique counterparties**, clean/flagged split, last activity date bucket |

Neither party alone provides the complete picture. Alice cannot fabricate the stats; the directory cannot attribute them without the binding Alice provides.

---

## Conversation records

Conversation records are split into two tables to disassociate parties from outcomes. A breach of one table yields nothing actionable without the other.

**Table 1 — Conversation Seals** (outcomes, no party info)

```
conversation_id:   UUID (random — not derived from parties)
merkle_root:       final sealed hash
close_type:        MUTUAL_CLEAN | MUTUAL_FLAGGED | SEAL_UNILATERAL | ABANDONED
seal_date:         DATE — day granularity only, not exact time
```

**Table 2 — Conversation Participation** (parties, no outcomes)

```
conversation_id:   UUID
party_pseudonym:   SHA-256(agent_id + salt)  — same pseudonym used for track record
```

Two rows per conversation. The directory can count conversations per agent via participation rows. Correlating outcomes to specific parties requires joining both tables on `conversation_id` — which requires access to both.

**Why date bucket, not exact timestamp:** Exact timestamps are identifying even without party information. Day granularity is sufficient for track record purposes (recency, volume over time) while preventing precise timing correlation across records.

Both tables replicate to all federation nodes.

---

## Conversation graph analytics

The participation table is not just a record of who had conversations — it is a complete pseudonymous conversation graph. Nodes are pseudonyms; edges are shared conversations. This enables two tiers of analysis with no schema changes: the data is already there.

### Day-one: unique counterparties

Raw conversation count is gameable by a closed pair running up volume between themselves. The meaningful signal is unique counterparties — how many distinct pseudonyms a given pseudonym has exchanged conversations with. This is a simple aggregate query on the participation table:

```sql
SELECT COUNT(DISTINCT p2.party_pseudonym)
FROM conversation_participation p1
JOIN conversation_participation p2
  ON p1.conversation_id = p2.conversation_id
WHERE p1.party_pseudonym = Y
  AND p2.party_pseudonym != Y
```

1,000 conversations with 847 unique counterparties is a fundamentally different trust signal from 1,000 conversations with 3 unique counterparties. This is a day-one stat returned alongside raw counts in every stats response.

### Day-two: dispersion and trust farm detection

A trust farm may be invisible at the per-agent level — each member may have acceptable-looking unique counterparty counts. The farming pattern is visible only at the graph level: a cluster of pseudonyms that mostly talk to each other, with few external connections.

What this enables:

- **Clustering coefficient**: what fraction of a pseudonym's conversation partners also talk to each other? High value signals a closed loop.
- **Community detection** (Louvain or spectral clustering): identifies clusters with high internal edge density relative to external connections — a trust farm is a community that is almost entirely self-referential.
- **Conductance scoring**: ratio of edges leaving a cluster to edges within it. Low conductance signals an isolated community. This is the same metric in the Sybil floor design.

The cross-group analysis matters here: it is not enough to ask whether Alice has diverse conversations. Alice, Bob, Carol, and ten others may each individually look fine, while the cluster as a whole is a closed loop. The graph must be analysed as a whole, not agent by agent.

### Persistence requirements for graph analytics

The following structures are required to support analytics at scale without degrading connection-request query performance.

**Index on `party_pseudonym`**
Without this, every per-agent stats query is a full table scan of the participation table. Required day-one.

**Pre-computed stats** (materialized view, refreshed on a schedule)
```
pseudonym             — the subject
conversation_count    — total rows for this pseudonym
unique_counterparties — count of distinct peer pseudonyms
clean_count           — joined from seals table
flagged_count         — joined from seals table
last_activity_date    — max seal_date for this pseudonym
```
Served directly on stats queries — not computed on demand per request. Refreshed periodically as conversations accumulate. The source tables are append-only; the materialized view is derived and can be rebuilt from them at any time.

**Conversation graph edge table** (materialized, incrementally updated)
```
pseudonym_a        — first pseudonym in pair (canonical ordering)
pseudonym_b        — second pseudonym
conversation_count — how many conversations this pair has had
clean_count        — clean outcomes between this pair
flagged_count      — flagged outcomes between this pair
```
Pre-computes adjacency between pseudonym pairs. Without this, graph traversal requires scanning the full participation table for every neighbourhood query — O(N²) at scale. Required for day-two graph analysis.

**Graph analysis results table** (written by async batch job, not on query path)
```
pseudonym              — the subject pseudonym
clustering_coefficient — 0.0–1.0
community_id           — cluster assignment
conductance_score      — 0.0–1.0 (lower = more isolated)
computed_at            — when this was last run
```
Graph algorithms run asynchronously and are not on the critical path for connection requests. Results are updated periodically as the conversation graph grows. This table is **not** append-only — it stores current computed state, not history.

The materialized view and edge table are derived data, not source of truth. They can be rebuilt from the protected append-only source tables at any time and do not require hash-chain integrity protection — their integrity is guaranteed by recomputability from the protected sources.

---

## Connection records

There is no separate connection record entity in CELLO. A connection event and a conversation are the same thing. Each interaction follows the lifecycle: connection request → accepted → session → termination. The conversation record is the connection record.

The relationship between two agents is implicit in their conversation history. No additional entity is needed at the protocol level.

**Client-side contact list (not a protocol primitive):**

Agents maintain a local contact list for their own use. This never goes to the directory.

```
contact_list[]  — client only
  peer_agent_id
  display_name         (local alias)
  policy_override      (custom acceptance policy for this agent)
  whitelist: bool
  blocked: bool
  first_seen: timestamp
```

**Rejected connection requests:**

Not stored as full records. The directory maintains rate-limiting counters — connection attempts rejected by a given target within a rolling window. This is a Layer 2 (node integrity) concern, not an identity record. Tracking rejection counts is the primary defense against connection-request flooding and DDoS.

---

## Client storage

### Local database — SQLCipher

SQLCipher provides transparent AES-256 encryption of the local SQLite database file. It protects against at-rest attacks: stolen device, backup extraction, cold forensics. It does not protect against runtime compromise — when the agent is running, the database is open and the key is in memory. No local encryption scheme can protect against a live process compromise.

The `db_key` is derived from the master key:
```
db_key = HKDF(private_key, "local-db-key", agent_id)
```

SQLCipher is the recommended option but not mandatory. Operators choose based on their deployment context and security requirements.

### Key provider abstraction

The agent operates against a key provider interface with pluggable backends. In most implementations the private key never leaves the provider — the provider performs signing internally and returns only the signature.

```typescript
interface KeyProvider {
  getPublicKey(): Promise<PublicKey>
  sign(data: Bytes): Promise<Signature>
}
```

Implementations by deployment context:

| Context | Backend | Notes |
|---|---|---|
| macOS / Windows desktop | OS Keychain / Secure Enclave | Hardware-backed on modern devices |
| Linux desktop | libsecret / GNOME Keyring | OS-managed |
| Cloud VM (AWS/GCP/Azure) | Cloud secret manager via instance IAM role | No credentials stored on disk |
| Kubernetes | Secrets + Vault Agent Injector | Injected at pod startup |
| Server / bare metal with TPM | TPM-sealed key | Hardware-bound, non-extractable |
| Robot / appliance | Secure element (ATECC608 or similar) | Purpose-built crypto chip, ~$1-2 per unit |
| VPS, no hardware security | Encrypted key file | Weakest option — operator accepts tradeoff |

CELLO does not mandate a specific backend. The security tier can be surfaced in the agent's trust profile — "hardware-bound key" is a different signal than "encrypted file" — but the protocol accommodates both.

### Backup

**The only mandatory backup is the identity key**, stored as a seed phrase (BIP-39) at agent creation. The identity key is the long-term root — it anchors the pseudonym and authorises signing key rotations. The signing key used for day-to-day operations is separate and can be rotated without affecting the backup requirement (see Key Rotation below).

All secondary secrets derive from the identity key:

```
salt        = HKDF(identity_key, "track-record-salt", agent_id)
db_key      = HKDF(identity_key, "local-db-key", agent_id)
backup_key  = HKDF(identity_key, "backup-key", agent_id)
```

The full client data store is encrypted with `backup_key` and uploaded to user-configured cloud storage. The cloud provider sees only ciphertext.

Data recovery categories:

| Category | Recovery path |
|---|---|
| Track record stats | Query directory live with pseudonym — always available |
| Social verification blobs | Re-verify via OAuth; CELLO re-issues hashes |
| Salt / db_key | Re-derive from private key |
| Endorsement records | Re-request from endorsers (hash still in directory; re-sign is a new hash) |
| Attestations | Re-request from attestors |
| Conversation Merkle trees | From encrypted backup; or request from counterparties who hold copies |
| Private key | Seed phrase recovery (see account compromise log) |

Conversation Merkle trees are the only data that cannot be reconstructed from scratch — they must be in the encrypted backup or recovered from counterparties.

---

## Key rotation

### The problem: everything derives from the master key

If signing key and identity key are the same, rotating the key changes the salt, which changes the pseudonym, which orphans the entire track record. The agent can no longer claim their history under the new key.

### The fix: decouple identity key from signing key

Two distinct keys serve two distinct purposes:

```
identity_key  — long-term root; backed up as seed phrase; rarely if ever rotated
                derives: salt, pseudonym, db_key, backup_key
                authorises: signing key rotations

signing_key   — operational key; used for message signing, directory auth, FROST
                can be rotated independently on any schedule
```

The identity key is what the seed phrase backs up. The signing key is what agents use every day and may want to rotate for security hygiene. Separating them means signing key rotation is a routine operation with no impact on track record continuity.

This maps to the same pattern used in HD wallets (master seed → derived spending keys) and PKI (root CA → leaf certificates).

### Signing key rotation (routine)

1. Agent generates a new signing key
2. Signs the new key with the identity key: `identity_key.sign(new_signing_pubkey || timestamp)`
3. Submits the rotation to the directory
4. Directory records the rotation event, updates the active signing key
5. Pseudonym unchanged — track record unaffected
6. Old signing key is revoked

### Identity key rotation (exceptional — requires old key to be available)

1. Agent generates a new identity key
2. Signs the new identity key with the old: `old_identity_key.sign(new_identity_pubkey || timestamp)`
3. Directory records migration: `old_pseudonym → new_pseudonym`
4. Both pseudonyms remain queryable; the directory serves track record continuity across the transition
5. Old identity key is retired

This path is only available while the old key is still in the agent's possession. If the old key is lost or compromised, this is the account compromise scenario — full track record transfer may not be possible.

### FROST key share refresh (distinct from rotation)

FROST supports proactive secret sharing — periodically redistributing key shares across directory nodes without changing the public key. The public key, the agent_id, the pseudonym, and the track record are all unaffected. This is a clean background security operation that is invisible to the persistence layer. It should not be conflated with key rotation.

### Directory records for key rotation

Both rotation types require new append-only tables:

```
key_rotation_log              — signing key rotations
  agent_id
  old_signing_key_hash
  new_signing_key_hash
  authorised_by               — signature from identity_key
  rotated_at                  — timestamp

identity_migration_log        — identity key rotations
  old_identity_key_hash
  new_identity_key_hash
  old_pseudonym
  new_pseudonym
  authorised_by               — signature from old_identity_key
  migrated_at                 — timestamp
```

Both are append-only. The rotation log lets the directory validate that a signing key change was authorised by the identity key. The migration log lets the directory serve track record continuity queries across an identity key transition.

---

## Node-side persistence

### Database

PostgreSQL with row-level security. Standard, battle-tested, with native support for the append-only enforcement and replication required.

### Append-only enforcement

Core tables are physically incapable of UPDATE or DELETE — enforced at the database level via RLS policies, not by application convention:

```sql
ALTER TABLE conversation_seals ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_seals
  FOR INSERT TO cello_service WITH CHECK (true);
-- No UPDATE or DELETE policy = those operations are impossible for all roles
```

**Append-only tables:** `agent_registrations`, `social_verifications`, `device_bindings`, `endorsements`, `attestations`, `conversation_seals`, `conversation_participation`, `revocations`, `tombstones`, `key_rotation_log`, `identity_migration_log`

**State transition tables** (new rows only — history is never overwritten): `agent_status_history`, `device_binding_releases`, `bond_status_history`

### Hash chain integrity

Every INSERT into a protected table appends to a running hash chain:

```
chain_entry = SHA-256(record_contents || previous_chain_hash)
```

Any modification or deletion breaks the chain at that point. Federation nodes compare chain hashes during sync — divergence means tampering. An attacker who compromises one node cannot cover their tracks; the chain break is visible to all other nodes.

### Federation and integrity guarantees

All tables replicate to all federation nodes via PostgreSQL logical replication. Federation is the primary defense against integrity attacks:

| Attack | Defense |
|---|---|
| Alter a hash on one node | Hash chain breaks; detected at next federation sync |
| Delete a record from one node | Other nodes hold the record; sync flags divergence |
| Wipe a node entirely | Federation rebuilds from other nodes; hash chain proves expected state |
| Inject a false record via replication | Can insert, cannot hide — chain entry is permanent and visible |

A single compromised node is self-revealing. The confidentiality value of a breached node is zero — it holds hashes. The integrity threat is real — the hash chain and federation together protect against it.

### Analytics infrastructure

The append-only source tables support derived structures that are not themselves append-only:

- `conversation_participation` requires an index on `party_pseudonym` (day-one requirement — without it every stats query is a full table scan)
- A materialized view of pre-computed per-pseudonym stats (conversation count, unique counterparties, clean/flagged, last activity) is refreshed on a schedule and served on stats queries
- A conversation graph edge table (pre-computed adjacency between pseudonym pairs) is required for day-two graph analysis — deriving it on demand from raw participation rows is O(N²) at scale
- A graph analysis results table holds the output of async batch jobs (clustering coefficients, community assignments, conductance scores) and is updated periodically

These derived structures can be rebuilt from the protected source tables at any time. They do not require hash-chain protection. Their integrity is guaranteed by recomputability.

### Audit logging

All access and all INSERTs are logged via `pgaudit`. The audit log is append-only and shipped to external storage — a compromised node cannot erase its own access history.

---

## Open items

- **Financial schema** — bonds, connection stakes, payment method references. Not day-one, but needs a skeleton before staking infrastructure is designed.
- **Conversation tree retention** — how long clients hold full Merkle trees; whether there is a retention policy; what happens to non-repudiation guarantees after pruning.

---

## Related Documents

- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — established hash-everything-store-nothing; this log extends that pattern into a complete persistence schema
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — endorsement and attestation hash schema; the two-hash social verification pattern follows the same oracle flow established there
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — conversation Merkle trees, CLOSE/CLOSE-ACK, and the non-repudiation model that conversation records here are designed to support
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — the three-phase node deployment and primary/backup replication that the node-side persistence design here builds on
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — the one-account-per-social-identifier and one-account-per-device rules are the schema-level Sybil floor; the conversation graph edge table and graph analysis results table here are the persistence infrastructure for the conductance scoring and closed-loop detection designed there
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — key recovery via seed phrase; the backup strategy here depends on the recovery mechanism designed there
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — the four trust signal classes (identity proofs, network graph, track record, economic stake) that this persistence schema implements
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — the transport layer; the persistent bidirectional WebSocket is what makes the live directory query (pseudonym → track record stats) possible at connection time
- [[design-problems|Design Problems]] — financial schema and conversation tree retention are candidates for addition to the open problems list
