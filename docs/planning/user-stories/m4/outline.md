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

Implementation: a `JobScheduler`-driven approach with an `analytics:run` CLI entry point (`packages/directory/src/bin/analytics-run.ts`). The `AnalyticsJob` class is registered as the handler for `scheduler.onJob("analytics", ...)` in the directory composition root. The CLI entry is used for manual invocations and CI validation (`pnpm run analytics:run`). At M4 it runs on the single node via `LocalJobScheduler`. At M5 when federation is live, it runs on one node and results replicate via logical replication. No distributed coordination needed.

---

## Client — SQLCipher

### Encrypted Local Database

SQLCipher provides transparent AES-256 encryption of the local SQLite database file. The `db_key` is derived from the master key:

```
db_key = HKDF-SHA256(ikm=identity_key, salt=none, info="local-db-key" || NUL || agent_id, length=32)
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
backup_key = HKDF-SHA256(ikm=identity_key, salt=none, info="backup-key" || NUL || agent_id, length=32)
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
| `CloudStorageProvider` | Local file sink (writes to configured local directory) | S3 (implemented in PERSIST-011; production S3 wiring deferred to M5) |

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

Two tools — one per database engine:

**Directory (PostgreSQL): Flyway Community Edition.** SQL-first, versioned files (`V{n}__{description}.sql`) tracked in `flyway_schema_history`. RLS policies and pgaudit triggers are written as plain SQL with no DSL translation. `node-flywaydb` npm package integrates into the pnpm workspace. CI/CD: `flyway migrate` runs in CodeBuild before the new ECS image is deployed. Free community edition covers all required features.

**Client (SQLite/SQLCipher): lightweight custom migration runner.** Flyway Community does not support SQLite. The runner reads versioned `.sql` files from `packages/client/db/migrations/` in `V{n}__{description}.sql` order, applies each in a transaction, and tracks applied versions in a `schema_migrations` table (`version TEXT PRIMARY KEY, applied_at TIMESTAMP`). No external tooling dependency.

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
- `dev` — real AWS services, dev KMS key, isolated from production data

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

## Story Map

### E2E Story (written first)

| ID | Title |
|---|---|
| PERSIST-E2E-001 | M4 end-to-end: two agents complete a conversation, seal it, survive a relay crash mid-session, and reconcile a one-sided delivery failure. Unilateral seal path also exercised. |

### Infrastructure Setup

| ID | Title | Blocks |
|---|---|---|
| PERSIST-001 | `packages/interfaces/` bootstrap — define and export all M4 interfaces with local stubs | everything |
| PERSIST-002 | Docker Compose + Flyway migrations — Postgres container wired to migration files, full schema applied in order | directory, client, relay tracks |

### Directory Track

| ID | Title | Depends on |
|---|---|---|
| PERSIST-003 | Append-only schema with RLS — all core tables with RLS policies making UPDATE/DELETE impossible | PERSIST-002 |
| PERSIST-004 | Hash chain on INSERT — every INSERT extends SHA-256 chain; any gap or modification breaks it | PERSIST-003 |
| PERSIST-005 | KMS envelope encryption for K_server_X shares — `EnvelopeKeyProvider`, local AES stub | PERSIST-003 |
| PERSIST-006 | pgaudit logging — access and INSERTs logged via `AuditLogShipper` to S3 / local file sink | PERSIST-003 |
| PERSIST-007 | MMR single-node construction — proof leaves, MMR nodes, seal staging tables | PERSIST-003 |
| PERSIST-008 | Analytics cron job — per-pseudonym stats, graph edges, graph analysis via `JobScheduler` | PERSIST-007 |

### Client Track

| ID | Title | Depends on |
|---|---|---|
| PERSIST-009 | SQLCipher local database — `ClientStore` backed by SQLCipher; `db_key` HKDF-derived from identity key | PERSIST-001 |
| PERSIST-010 | `SigningKeyProvider` abstraction — pluggable Ed25519 backend; OS Keychain + encrypted file fallback | PERSIST-009 |
| PERSIST-011 | Encrypted cloud backup — `backup_key` HKDF-derived; cloud provider sees only ciphertext | PERSIST-009 |
| PERSIST-012 | Agent hash queue + signed relay ACKs — local queue persists across relay disconnections; ACK receipts stored | PERSIST-009 |

### Relay Track

| ID | Title | Depends on |
|---|---|---|
| PERSIST-013 | Relay WAL — per-session append-only WAL; crash+restart reconstructs Merkle state; WAL destroyed after seal | PERSIST-001 |
| PERSIST-014 | Gap-fill reconciliation (Case 1) — directory detects tree mismatch, behind party requests missing leaves, retry succeeds | PERSIST-013 |
| PERSIST-015 | Unilateral seal (Case 2) — after timeout A seals unilaterally; B receives notification on reconnect | PERSIST-013 |

### Post-Live-Session Stories (added 2026-05-18)

These stories were added after the first live M4 agent-to-agent session revealed four missing migrations and a gap in the MMR checkpoint visibility flow. See [[2026-05-18_0600_missing-table-investigations]] and [[agent-conversation-m4-2026-05-18-database-bugs-and-protocol-gaps]].

| ID | Title | Depends on |
|---|---|---|
| PERSIST-016 | Schema completeness test — CI gate that fails if any table referenced by PgDirectoryStore lacks a Flyway migration | PERSIST-001, PERSIST-002, PERSIST-003 |
| PERSIST-017 | MMR checkpoint visibility — `checkpoint_status` on `cello_close_session`; `cello_get_inclusion_proof` returns pending/eta | PERSIST-003, PERSIST-004, PERSIST-007, PERSIST-008, PERSIST-009 |
| PERSIST-018 | `seal_notarizations` migration — FROST threshold signature durably stored; `getNotarization()` returns real data | PERSIST-001, PERSIST-002, PERSIST-003, PERSIST-004, PERSIST-007 |
| PERSIST-019 | `notification_queue` + `pending_connection_requests` migrations — offline delivery queues; `drainNotifications()` and `dequeuePendingConnectionRequests()` return real data | PERSIST-001, PERSIST-002, PERSIST-003, PERSIST-008 |
| PERSIST-020 | `connections` migration — connection records survive directory restarts; `hasConnection()` returns real data | PERSIST-001, PERSIST-002, PERSIST-003, PERSIST-004 |
| PERSIST-021 | `PgDirectoryStore` adapter boundary audit — real-Postgres round-trip integration tests for all existing store methods; BIGINT column type map hardening | PERSIST-003, PERSIST-004, PERSIST-016 |

### Dependency Order

```
PERSIST-001 (interfaces)
  └── PERSIST-002 (docker + flyway)
        ├── PERSIST-003 (RLS schema)
        │     ├── PERSIST-004 (hash chain)
        │     ├── PERSIST-005 (KMS/EnvelopeKeyProvider)
        │     ├── PERSIST-006 (pgaudit)
        │     └── PERSIST-007 (MMR)
        │           └── PERSIST-008 (analytics cron)
        ├── PERSIST-009 (SQLCipher)          ← parallel with directory track
        │     ├── PERSIST-010 (SigningKeyProvider)
        │     ├── PERSIST-011 (cloud backup)
        │     └── PERSIST-012 (hash queue)
        └── PERSIST-013 (relay WAL)          ← parallel with directory + client tracks
              ├── PERSIST-014 (gap-fill reconciliation)
              └── PERSIST-015 (unilateral seal)

Post-live-session additions (all in directory track):
PERSIST-016 (schema completeness CI gate) → unblocks PERSIST-018, 019, 020, 021
PERSIST-017 (MMR checkpoint visibility) ← depends on PERSIST-003, 004, 007, 008, 009
PERSIST-018 (seal_notarizations) ← depends on PERSIST-016, 007
PERSIST-019 (notification_queue + pending_connection_requests) ← depends on PERSIST-016, 008
PERSIST-020 (connections) ← depends on PERSIST-016
PERSIST-021 (adapter boundary audit) ← depends on PERSIST-016; blocks PERSIST-E2E-001

PERSIST-E2E-001 requires all of 003–015 plus 016–021
```

Once PERSIST-001 and PERSIST-002 are done, the directory track, client track, and relay track are independent and can run as parallel agents.

---

## Related Documents

- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — complete schema reference; all directory tables defined here
- [[2026-05-14_1702_relay-session-mechanics-and-recovery|Relay Session Mechanics and Recovery]] — relay WAL design, agent hash queue as protocol primitive, pre-seal reconciliation
- [[2026-05-14_1702_arbitration-mechanics-and-dispute-resolution|Arbitration Mechanics and Dispute Resolution]] — client backup as non-repudiation obligation; pruning as dispute rights decision
- [[2026-05-14_1853_milestone-sequence-revision|Milestone Sequence Revision]] — sequencing decisions that place M4 here and defer federation to M5
- [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]] — adapter inventory, local development infrastructure, environment tiers, CI/CD pipeline
- [[2026-05-16_0900_m4-infrastructure-decisions|M4 Cloud Infrastructure Decisions]] — VPC topology, RDS access, IAM scoping, Secrets Manager naming convention, KMS, S3 audit bucket, IaC templates
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — PostgreSQL RLS, hash chain, KMS, pgaudit, federation (M5)
- [[agent-client|CELLO Agent Client Requirements]] — SQLCipher, key provider abstraction, backup, hash queue, signed relay ACK storage

---

## What Actually Happened — Implementation History (2026-05-18)

This section records what went wrong during M4 implementation and how it was resolved. The original outline was written before coding began and did not anticipate several class of problems that only surface against a real database.

### The live session that broke everything

All 21 component stories (PERSIST-001 through PERSIST-015) were implemented and passed Vitest. The first live multi-process agent-to-agent session was then run against Docker Compose + real Postgres. It failed immediately with four distinct errors:

1. **Four missing Flyway migrations.** `seal_notarizations`, `notification_queue`, `pending_connection_requests`, and `connections` were all referenced by `PgDirectoryStore` but had never had real schema migrations written. PERSIST-003's RLS schema migration (V2) included stub table definitions with only `id` and `created_at`, and the later component stories (PERSIST-013 through PERSIST-015) had added full column definitions to `PgDirectoryStore` methods without writing migrations for the new columns. The tables existed in the stub form but had none of the columns the code expected.

2. **BIGINT-as-string type coercion.** The `pg` driver returns `BIGINT` and `BIGSERIAL` columns as JavaScript strings, not numbers. The in-process tests used in-memory stubs that returned numbers natively, so this was invisible. The live session triggered `TypeError: expected number, got string` in multiple places across `pg-directory-store.ts`.

3. **MMR checkpoint visibility gap.** `cello_close_session` returned no `checkpoint_status` field. After a seal, the agent had no way to tell whether the inclusion proof was ready or still pending. This field was specified in the protocol but never wired through the MCP layer.

4. **`pending_connection_requests.request_id` type mismatch.** The column was declared `UUID` in the migration but the application stored a 32-character hex string (not a valid UUID). This caused a PostgreSQL type error on `createConnection()`.

### How each was fixed

**Missing migrations (PERSIST-016 through PERSIST-020):**

PERSIST-016 added a CI gate (`schema-completeness.test.ts`) that statically verifies every table referenced by `PgDirectoryStore` has a corresponding Flyway migration. This gate now runs on every PR and will catch future drift.

PERSIST-017 through PERSIST-020 added the missing migrations using a two-step Flyway pattern (required because V10 had already created stub tables):
```sql
-- Step 1: create stub if not exists
CREATE TABLE IF NOT EXISTS table_name (id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now());
-- Step 2: add each missing column
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS column_name TYPE;
```

PERSIST-020 also changed `connection_requests.request_id` from `UUID` to `TEXT` via a V14 migration, resolving the type mismatch.

**BIGINT type coercion (PERSIST-021):**

A `BIGINT_COLUMNS` map was added to `pg-directory-store.ts` that declares, per table, which columns are `BIGINT` or `BIGSERIAL`. A `deserializeRow()` function coerces only the declared columns via `parseInt()`, leaving all others as-is. A static analysis gate (AC-005 in PERSIST-021) parses all Flyway migration SQL files and compares their `BIGINT`/`BIGSERIAL` column declarations against the map — the test fails if any column is missing. An alternative of throwing a `TypeError` at runtime for any all-digit string was evaluated and rejected: the `/^\d+$/` regex fires on legitimate TEXT columns that happen to contain only digits (e.g., phone numbers, numeric IDs stored as TEXT). The static gate is the enforcement mechanism.

**MMR checkpoint visibility (PERSIST-017):**

`cello_close_session` was updated to return `checkpoint_status: "pending"` immediately after a seal, with a `staged_at` timestamp. `cello_get_inclusion_proof` was updated to return `checkpoint_status: "pending"` with an `eta` when the checkpoint has not yet been confirmed, or `checkpoint_status: "confirmed"` with the full proof when it has. `MmrCheckpointService.recoverOrphanedCheckpoints()` was added to recover seals that were staged but never checkpointed (e.g., after a directory restart).

### What the in-process tests missed

Every single one of these bugs was invisible to Vitest because all tests used `InMemoryDirectoryStore` rather than `PgDirectoryStore`. The stub returned correct types, had no schema, and had no concept of migration version. The tests passed green while the production path had never been exercised.

This is the exact failure mode the `/cello-story` skill warns against: *"Would this AC pass if the two participants were in different OS processes on different machines with no shared memory? If no, the AC is underspecified."*

The fix is structural: PERSIST-021 added real-Postgres round-trip integration tests for all `PgDirectoryStore` methods, using the actual Docker Compose database. The `describeIntegration()` guard skips when `CELLO_ENV !== 'local'` so CI that lacks a database doesn't break, but fails (not skips) when `CELLO_ENV=local` and the database is unreachable.

### Migration version conflicts resolved

During the merge sequence of PERSIST-016 through PERSIST-021, two version numbering conflicts arose:

- **Duplicate V11 — RESOLVED:** PERSIST-017 used `V11__staging_correlation_id.sql` and PERSIST-020 originally used `V11__connections_full_schema.sql`. The PERSIST-020 file was renumbered to `V15__connections_full_schema.sql` during the merge sequence. As of 2026-05-19 the migration directory has no version conflicts. The running database has all 15 versions applied cleanly. A fresh `flyway migrate` against a clean database completes without error. *Note: the 2026-05-19 agent-to-agent review session flagged this as a hard blocker for PERSIST-E2E-001 — that assessment was accurate at the time it was written; the rename had already occurred on disk.*

- **Duplicate V12:** PERSIST-018 and PERSIST-020 both initially used V12. Resolved by renumbering PERSIST-020's migration to V14 before merge.

### E2E test gap — scripts vs. protocol manual tests

PERSIST-E2E-001 has two categories of ACs:

**Scriptable (no agent conversation required):** WAL crash recovery (AC-002), WAL corruption fallback (DB-001), SQLCipher wrong-key rejection (AC-006 / SI-003), KMS failure blocks INSERT (SI-006), hash chain tamper detection (SI-005), pgaudit immutability (SI-007). These are covered by standalone scripts in `packages/e2e-tests/scripts/`.

**Requires live multi-process agent conversation:** AC-001 (10 messages persisted with correct chain), AC-003 (gap-fill reconciliation), AC-004/AC-005 (unilateral seal with process termination), AC-009/AC-009a (MMR inclusion proof, checkpoint_status pending window). These require running the protocol manually between two real agent processes and verifying outcomes in the database.

The scripts should be run first to clear the mechanical invariants before the protocol walkthrough begins.
