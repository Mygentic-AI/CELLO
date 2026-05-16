---
name: M4 — Persistence
milestone: M4
type: outline
date: 2026-05-14
status: active
topics: [persistence, database, SQLCipher, PostgreSQL, hash-chain, KMS, WAL, relay, client-storage, backup, pre-seal-reconciliation, MMR, analytics]
description: M4 delivers the persistence foundation — directory PostgreSQL schema with integrity guarantees, client SQLCipher storage, and relay crash-recovery WAL. Single-node only. Federation deferred to M5.
---

# M4 — Persistence

## What This Milestone Delivers

M4 is the persistence foundation. Every milestone from M5 onward writes into infrastructure built here. Nothing that follows is buildable until the directory has a correct, tamper-evident append-only store and the client has an encrypted local database.

At the end of M4:
- The directory persists all protocol entities with cryptographic integrity guarantees
- The client stores conversation records, trust data, and keys in an encrypted local database with cloud backup
- The relay has a crash-recovery mechanism for active sessions
- Pre-seal reconciliation works correctly under relay failure

## Scope Boundaries

**In scope:**
- Directory PostgreSQL schema — single node
- Client SQLCipher database
- Relay WAL for crash recovery
- Pre-seal reconciliation protocol
- Analytics cron job

**Explicitly out of scope:**
- Multi-node replication and federation → M5
- Checkpoint cross-signing across nodes → M5
- Financial schema (bonds, stakes, escrow) → post-M13
- Portal, registration, trust signals → M7
- Operational security infrastructure (CloudWatch, WAF, DDoS mitigation) → M5

---

## Directory — PostgreSQL (Single Node)

### Schema and Append-Only Enforcement

All core tables are physically incapable of UPDATE or DELETE. Enforced at the database level via PostgreSQL row-level security policies — not by application convention.

```sql
ALTER TABLE conversation_seals ENABLE ROW LEVEL SECURITY;
CREATE POLICY insert_only ON conversation_seals
  FOR INSERT TO cello_service WITH CHECK (true);
-- No UPDATE or DELETE policy = those operations are impossible for all roles
```

Every table in the full append-only list ships with RLS enforcement from the first INSERT. See [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] for the complete table inventory.

### Hash Chain on Every INSERT

Every INSERT into a protected table appends to a running hash chain:

```
chain_entry = SHA-256(record_contents || previous_chain_hash)
```

This is application-layer logic in the directory service — not a PostgreSQL trigger. The directory service fetches the previous chain hash, computes the new entry, and includes it in the INSERT. Any modification or deletion breaks the chain at that point. Federation nodes (M5) compare chain hashes during sync — divergence means tampering.

**This must be correct from the first INSERT.** A bug in the chain computation is a silent integrity failure that only surfaces later. There is no retrofit path.

### KMS Envelope Encryption for K_server_X Shares

K_server_X shares are per-agent and stored with envelope encryption:
- One AWS KMS master key per node (~$0.03/month)
- All K_server_X shares encrypted with the node's KMS master key
- KMS is not invoked per-agent-share — the master key encrypts the shares at rest; KMS is invoked at node startup to unwrap the master key into memory
- Storage: 32 bytes × number of agents — trivial

### pgaudit

All access and all INSERTs are logged via pgaudit. The audit log is append-only and shipped to external storage (S3). A compromised node cannot erase its own access history.

### MMR — Single-Node Construction

The Merkle Mountain Range accumulates sealed conversation roots into a global append-only proof ledger. Every conversation seal appends a leaf.

Tables:
- `conversation_proof_leaves` — one row per sealed conversation, append-only
- `conversation_proof_mmr_nodes` — internal tree nodes, append-only
- `conversation_seal_staging` — ephemeral, accumulates seals between checkpoints, cleared after each confirmed checkpoint

At M4, MMR construction runs on a single node. Checkpoint cross-signing across multiple nodes is deferred to M5 — it requires live communicating nodes.

### Analytics Cron Job

A scheduled batch job runs against the existing PostgreSQL tables and writes derived structures:

- Materialized view of per-pseudonym stats (conversation count, unique counterparties, clean/flagged, last activity)
- Conversation graph edge table (pre-computed adjacency between pseudonym pairs)
- Graph analysis results table (clustering coefficients, community assignments, conductance scores)

Implementation: a standard cron job against the local PostgreSQL instance. At M4 it runs on the single node. At M5 when federation is live, it runs on one node and results replicate via logical replication. No distributed coordination needed.

---

## Client — SQLCipher

### Encrypted Local Database

SQLCipher provides transparent AES-256 encryption of the local SQLite database file. The `db_key` is derived from the master key:

```
db_key = HKDF(identity_key, "local-db-key", agent_id)
```

SQLCipher is the recommended option. Operators may choose alternatives based on their deployment context and security requirements.

### Signing Key Provider Abstraction

The agent operates against a `SigningKeyProvider` interface with pluggable backends:

```typescript
interface SigningKeyProvider {
  getPublicKey(): Promise<PublicKey>
  sign(data: Bytes): Promise<Signature>
}
```

The private key never leaves the provider in most implementations — the provider performs signing internally and returns only the signature. Backends by deployment context: OS Keychain / Secure Enclave (macOS/Windows desktop), libsecret (Linux), Cloud secret manager via instance IAM role (cloud VM), Secrets + Vault Agent Injector (Kubernetes), TPM-sealed key (bare metal), Secure element (robot/appliance), Encrypted key file (VPS fallback).

**Naming note:** `SigningKeyProvider` is the client-side signing interface introduced in M0. It is distinct from `EnvelopeKeyProvider` (the KMS interface for encrypting K_server_X shares at rest, introduced in this milestone). See the Local Development Infrastructure section above.

### Encrypted Cloud Backup

The full client data store is encrypted with `backup_key` and uploaded to user-configured cloud storage:

```
backup_key = HKDF(identity_key, "backup-key", agent_id)
```

The cloud provider sees only ciphertext.

**Conversation Merkle trees are the only data that cannot be reconstructed from scratch.** Everything else is re-queryable from the directory or re-derivable from the identity key. If a client prunes its local tree or loses it without a backup, the agent loses the ability to substantiate any dispute about that conversation. This consequence must be surfaced explicitly to operators — not as a buried technical note but as a visible owner decision. See [[2026-05-14_1702_arbitration-mechanics-and-dispute-resolution|Arbitration Mechanics and Dispute Resolution]].

### Agent Hash Queue — First-Class Protocol Primitive

The client maintains a local queue of Structure 1 hashes pending relay submission. This is not an implementation detail — it is the primary robustness guarantee for relay failures.

When relay connectivity is interrupted, the P2P conversation continues and hashes accumulate in the queue. On relay recovery or reassignment, queued hashes are submitted in order. The relay sequences them, both trees catch up, and seal proceeds normally.

### Signed Relay ACK Storage

The relay ACK for each submitted hash is a signed cryptographic receipt:
```
relay_signature(SHA-256(hash_H || sequence_number || timestamp))
```

The client stores these receipts. They are the evidence if a relay later denies having sequenced a hash, and are required for re-submission to a new relay when the old relay's WAL is unavailable.

---

## Relay — WAL for Crash Recovery

Relay nodes are stateless by design. Per-session Merkle state is held in memory and destroyed after seal handoff. However, relay nodes maintain a per-session write-ahead log on local disk during active sessions.

**Purpose:** crash recovery only. If a relay crashes and restarts mid-session, it reconstructs in-memory Merkle state from the WAL rather than forcing agents to re-submit the full leaf sequence from the beginning.

**What the WAL is:** a simple append-only file per session. Each entry is one serialized Structure 2 leaf (~250 bytes). Not a database — no schema, no migrations, no query interface. Read sequentially on restart to reconstruct state.

**WAL lifetime:** written during the active session, destroyed after the directory confirms the seal. Never replicated. Never persisted beyond session end.

**Storage cost:** negligible. A multi-day high-volume session is a few megabytes.

The WAL is the relay's crash-recovery tool. The agent hash queue is what makes the protocol correct under relay failure. These are distinct mechanisms serving distinct failure modes.

---

## Protocol Correctness — Pre-Seal Reconciliation

Before the FROST ceremony can proceed, both parties must present the same final Merkle root to the directory. Pre-seal reconciliation handles the case where they don't.

### The Three Cases

**Case 1 — Both parties present, B is behind (one-sided delivery failure):**
The directory rejects the seal attempt with `SEAL_REJECTED_TREE_MISMATCH` and returns both parties' reported sequence numbers. The behind party knows immediately how far behind they are. They request missing leaves from the relay. The relay serves them from the WAL. The behind party verifies each leaf against the sender signature and the hash chain, advances their tree, and both parties retry the seal.

Gap-fill is always and only a tail operation. Everything up to the last agreed sequence number is locked in by the hash chain — the only possible divergence is undelivered leaves at the tail.

**Case 2 — B unreachable:**
A waits for the `delivery_grace_seconds` timeout (default 600s), then sends SEAL_UNILATERAL. The directory seals on A's copy. B's absence is recorded as `ABSENT` in `conversation_attestations`. When B reconnects, they receive the `SEAL_UNILATERAL` notification and verify A's sealed root against their local copy. Session closed is session closed — no reopening, no retroactive acknowledgment required.

**Case 3 — Both parties agree:**
Seal proceeds immediately. No reconciliation needed.

### What Cannot Happen

A party cannot claim a resubmitted leaf is false — if they're behind, they don't have an alternative version of something they haven't received. There is nothing to dispute. The leaves either verify against the sender signature and hash chain or they don't.

---

## Local Development Infrastructure

M4 is the first milestone where external systems are load-bearing. The adapter pattern is mandatory — every external dependency gets an interface with a local stub implementation so the inner development loop does not require cloud infrastructure.

### Interfaces Required Before M4 Stories Are Written

All of the following live in `packages/interfaces/`. Local stubs live in `packages/interfaces/stubs/`. See [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]] for the full adapter inventory and design decisions.

| Interface | Local Stub | Production Implementation |
|-----------|------------|--------------------------|
| `DirectoryStore` | Real Postgres via Docker Compose | RDS PostgreSQL |
| `ClientStore` | Local unencrypted SQLite | SQLCipher |
| `RelayWal` | In-memory WAL | Append-only file on disk |
| `EnvelopeKeyProvider` | In-process AES with dev key from env var | AWS KMS |
| `Logger` | stdout structured JSON (pino-pretty) | CloudWatch structured JSON |
| `JobScheduler` | Local cron or manual trigger | EventBridge Scheduler |

**Naming note:** `EnvelopeKeyProvider` is the KMS interface for encrypting K_server_X shares at rest. It is distinct from `SigningKeyProvider` (the client-side interface for Ed25519 signing operations, introduced in M0). These must not share a name.

### Docker Compose

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: cello_dev
      POSTGRES_PASSWORD: dev
    ports:
      - "5432:5432"
```

The local Postgres container is brought to the correct schema state by running the same migration files in the same order as production. Manual schema tweaks to make tests pass are a warning sign that migrations have drifted.

### Migration Tool

**Decision: Flyway.** SQL-first, versioned files (`V1__description.sql`) tracked in `flyway_schema_history`. RLS policies and pgaudit triggers are written as plain SQL with no DSL translation. `node-flywaydb` npm package integrates into the pnpm workspace. CI/CD: `flyway migrate` runs in CodeBuild before the new ECS image is deployed. Free community edition covers all required features.

### Seed Data

Four baseline scenarios committed as a seed SQL file before M4 coding begins:
1. Registered operator, no active sessions
2. Unregistered operator
3. Active session (mid-conversation)
4. Sealed session

Tests use transaction rollback — never the seed data. The seed file is for manual development iteration.

### Environment Wiring

All adapters are instantiated via the composition root in `server.ts`. Selection is driven by `CELLO_ENV`:
- `local` — Docker Compose, all local stubs
- `cloud` — real AWS services, dev KMS key, isolated from production data

The application fails at startup with a clear error if any required adapter configuration is missing.

---

## Milestone Close Gate

Standard SPARC gate sequence plus:

1. Single-node directory running with full schema, RLS enforcement, hash chain verified on every INSERT
2. Client SQLCipher database with correct key derivation, key provider abstraction, cloud backup
3. Relay WAL: crash a relay mid-session, restart it, verify it reconstructs state and seal completes correctly
4. Pre-seal reconciliation: simulate one-sided delivery failure, verify gap-fill resolves and seal proceeds
5. SEAL_UNILATERAL: simulate B going offline, verify A can seal unilaterally after timeout, verify B receives notification on reconnect

All five scenarios as live multi-process smoke tests — not in-process Vitest.

---

## Dependencies

- M3 complete (connection flow, FROST ceremonies, registration stubs)
- No dependency on M5 — single-node PostgreSQL on a developer machine or a single AWS RDS instance is sufficient for M4 development and testing

---

## Related Documents

- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — complete schema reference; all directory tables defined here
- [[2026-05-14_1702_relay-session-mechanics-and-recovery|Relay Session Mechanics and Recovery]] — relay WAL design, agent hash queue as protocol primitive, pre-seal reconciliation
- [[2026-05-14_1702_arbitration-mechanics-and-dispute-resolution|Arbitration Mechanics and Dispute Resolution]] — client backup as non-repudiation obligation; pruning as dispute rights decision
- [[2026-05-14_1853_milestone-sequence-revision|Milestone Sequence Revision]] — sequencing decisions that place M4 here and defer federation to M5
- [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]] — adapter inventory, local development infrastructure, environment tiers, CI/CD pipeline
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — PostgreSQL RLS, hash chain, KMS, pgaudit, federation (M5)
- [[agent-client|CELLO Agent Client Requirements]] — SQLCipher, key provider abstraction, backup, hash queue, signed relay ACK storage
