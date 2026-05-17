---
name: M4 — Persistence Foundation
type: design
date: 2026-05-17
topics: [milestone, M4, persistence, PostgreSQL, SQLCipher, hash-chain, KMS, MMR, relay-WAL, analytics, pgaudit, integration-testing, infrastructure]
status: active
description: Post-completion write-up for M4. What was built, what was proved, the bugs found when integration tests first ran against real Postgres, and the lessons to apply to M5.
---

# M4 — Persistence Foundation

**Completed:** 2026-05-17 (all 15 stories merged, 232 directory tests passing, full workspace 962 tests green)  
**Stories:** PERSIST-001 through PERSIST-015, with PERSIST-E2E-001 deferred to milestone close gate  
**Test counts at M4 story completion:** 232 directory tests (19 test files), 962 workspace tests

> **Note on PERSIST-E2E-001.** The end-to-end smoke test story — two OS processes, relay crash+recovery, gap-fill reconciliation, unilateral seal — is not yet executed. It is the milestone close gate. Every component has been built and tested in isolation; the multi-process integration has not yet been run live. M4 is not closed until PERSIST-E2E-001 passes.

---

## What M4 Set Out to Prove

M3 proved that strangers can negotiate access and establish FROST-signed sessions. M4 proves that those sessions are tamper-evident and durable. The data must survive process restarts, relay crashes, and one-sided delivery failures without losing cryptographic integrity.

At the end of M4:
- The directory persists all protocol entities with a SHA-256 hash chain that makes any tampering or deletion detectable
- K_server_X shares are encrypted at rest via KMS envelope encryption — no share is ever stored in plaintext
- All access and INSERTs are logged via pgaudit; logs are append-only and shipped to external storage
- The relay maintains a per-session WAL for crash recovery
- The client stores conversation records in an encrypted local database (SQLCipher) with cloud backup
- Pre-seal reconciliation handles relay failures and one-sided delivery failures
- An MMR (Merkle Mountain Range) accumulates sealed conversation roots into a global append-only proof ledger

---

## What Was Built

### Packages shipped

| Package | What M4 adds |
|---|---|
| `@cello/interfaces` | `DirectoryStore`, `ClientStore`, `RelayWal`, `EnvelopeKeyProvider`, `Logger`, `JobScheduler`, `CloudStorageProvider`, `AuditLogShipper` — all six M4 interfaces with local stubs and composition root (PERSIST-001) |
| `@cello/directory` | Docker Compose + Flyway migrations for local Postgres (PERSIST-002); append-only schema with RLS making UPDATE/DELETE impossible (PERSIST-003); SHA-256 hash chain on every INSERT (PERSIST-004); KMS envelope encryption for K_server_X shares via `EnvelopeKeyProvider` (PERSIST-005); pgaudit logging via `AuditLogShipper` to S3 / local file sink (PERSIST-006); MMR single-node construction — proof leaves, MMR nodes, seal staging, checkpoint confirmation (PERSIST-007); analytics cron job via `JobScheduler` — per-pseudonym stats, graph edges, graph analysis (PERSIST-008) |
| `@cello/client` | SQLCipher local database with HKDF-derived `db_key` (PERSIST-009); `SigningKeyProvider` abstraction — pluggable Ed25519 backend with OS Keychain and encrypted file fallback (PERSIST-010); encrypted cloud backup with HKDF-derived `backup_key` (PERSIST-011); agent hash queue + signed relay ACKs as cryptographic receipts (PERSIST-012) |
| `@cello/relay` | Per-session WAL for crash recovery — append-only file, reconstructs Merkle state on restart, destroyed after seal (PERSIST-013); gap-fill reconciliation — directory detects tree mismatch, behind party requests missing leaves, retry succeeds (PERSIST-014); unilateral seal — after timeout A seals unilaterally, B receives notification on reconnect (PERSIST-015) |
| `@cello/crypto` | `buildRelayAckTbs` — canonical TBS function for relay hash-submit ACKs, shared by relay (signer) and client (verifier) to prevent divergence; cross-path contract test |

### Migrations shipped

| Version | Contents |
|---|---|
| V1 | Enable pgaudit extension |
| V2 | Full directory schema — all append-only tables with RLS |
| V3 | `chain_hash NOT NULL` enforcement on all hash-chained tables |
| V4 | `agent_key_shares` — encrypted K_server_X storage |
| V5 | MMR tables — full column definitions for `conversation_proof_leaves`, `conversation_proof_mmr_nodes`, `directory_checkpoints`, `conversation_seal_staging` |
| V6 | `conversation_proof_leaf_checkpoints` join table — leaf→checkpoint association without UPDATE on append-only leaf table |
| V7 | Analytics output tables — `pseudonym_stats`, `conversation_graph_edges`, `graph_analysis_results`, `analytics_run_log` |
| V8 | `cello_analytics` RLS SELECT policies — without these the analytics job read zero rows from all protocol tables |

---

## What Was Proved in Automated Tests

**Hash chain integrity (PERSIST-003, PERSIST-004)**
- RLS enforces INSERT-only on all core tables at the database level — not by application convention
- Hash chain on INSERT: `SHA-256(serialize(record_contents) || previous_chain_hash)` extends correctly for sequential and concurrent inserts
- Advisory lock (`pg_advisory_xact_lock`) serializes concurrent chain extensions — no fork in 5-concurrent-insert stress test
- Superuser UPDATE and DELETE detected as chain breaks; superuser row deletion detected as sequence gap
- `verifyChain()` scans the complete table and reports the exact break position

**KMS envelope encryption (PERSIST-005)**
- K_server_X shares stored as ciphertext via `LocalEnvelopeKeyProvider` (AES-256-GCM) locally, AWS KMS in production
- Plaintext share never written to the database; structural validation before storage
- Key rotation: new ciphertext produced under new key ID; old ciphertext coexists during transition window

**pgaudit logging (PERSIST-006)**
- `pgaudit.log=all` logs both read and write operations
- `AuditLogShipper.flush()` called on SIGTERM — no entries lost on graceful shutdown
- `LocalAuditLogShipper` appends JSON lines atomically; 10 concurrent `ship()` calls produce 10 non-interleaved lines

**MMR single-node construction (PERSIST-007)**
- Leaf append follows correct MMR position arithmetic; internal nodes merged on append
- Checkpoint confirmation: staging rows assigned to checkpoint, leaf→checkpoint join table populated, staging cleared atomically
- Inclusion proof returned for any sealed leaf; proof verifies independently using only the checkpoint peak hash — no further directory query needed
- 100-leaf chain verification on both `conversation_proof_leaves` and `conversation_proof_mmr_nodes` passes

**Analytics cron job (PERSIST-008)**
- Per-pseudonym stats (conversation count, unique counterparties, clean/flagged, last activity) match known inserted data
- Graph edges and graph analysis results computed correctly
- `JobScheduler.onJob("analytics", ...)` wired in directory composition root — scheduler-triggered and CLI-triggered runs use identical logic
- DB error mid-run rolls back partial writes; previous run data intact

**SQLCipher + client storage (PERSIST-009, PERSIST-010, PERSIST-011, PERSIST-012)**
- SQLCipher database opens with correct `db_key`; unreadable with wrong key
- `SigningKeyProvider` abstraction tested with OS Keychain and encrypted file backends
- Cloud backup encrypts with `backup_key` before upload; cloud provider sees only ciphertext
- Agent hash queue: FIFO ordering enforced; signed ACK verification uses real Ed25519 (no mocks); hash never removed without valid ACK; relay failover with prior ACKs

**Relay WAL + pre-seal reconciliation (PERSIST-013, PERSIST-014, PERSIST-015)**
- Relay crash mid-session: WAL reconstructs Merkle state; seal proceeds without agent re-submission
- Gap-fill: directory rejects seal with `SEAL_REJECTED_TREE_MISMATCH`; behind party requests missing leaves; tree advances; retry succeeds
- Unilateral seal: after timeout A seals on its copy; B receives notification on reconnect

---

## Bugs Found When Integration Tests First Ran Against Real Postgres

M0–M3 were hermetically sealed — the full protocol stack ran in a single Vitest process. M4 was the first milestone where tests touched a real Postgres instance. The gap between "unit tests green" and "integration tests green" was substantial. Every bug below was a real production defect, not a test workaround.

### 1. Duplicate V4 migration filenames

**Symptom:** Flyway rejected the migration set on a clean database.  
**Root cause:** Both `V4__agent_key_shares.sql` (PERSIST-005, KMS) and `V4__mmr_tables.sql` (PERSIST-007, MMR) were assigned version 4. The renumbering bug happened because the two stories were implemented by independent agents without a shared migration version counter.  
**Fix:** Renumbered MMR tables → V5, checkpoint association → V6, analytics tables → V7.  
**M5 lesson:** Migration version numbers must be allocated centrally before implementation begins, not assigned independently per story.

### 2. `ADD CONSTRAINT IF NOT EXISTS` is invalid PostgreSQL syntax

**Symptom:** V5 migration failed on a fresh database.  
**Root cause:** PostgreSQL does not support `IF NOT EXISTS` on `ADD CONSTRAINT`. The agent implementing PERSIST-007 used MySQL-style syntax.  
**Fix:** Replaced with `DO $$ BEGIN IF NOT EXISTS ... END $$` guards.  
**M5 lesson:** Review every migration for PostgreSQL syntax compatibility. A `psql` dry run on a fresh schema before committing catches this class of error immediately.

### 3. `${leaf_index}` in a SQL comment interpreted as a Flyway placeholder

**Symptom:** V5 migration failed with "No value provided for placeholder: ${leaf_index}".  
**Root cause:** A comment in the SQL file used JavaScript template literal syntax `${...}`. Flyway treats `${}` as a variable placeholder regardless of context.  
**Fix:** Rewrote the comment to avoid `${}` syntax.  
**M5 lesson:** Never use `${...}` in SQL comments in Flyway-managed files. Use `%(...)` or plain prose.

### 4. `cello_analytics` had GRANT SELECT but no RLS SELECT policy

**Symptom:** The analytics job ran without error but produced zero output — all aggregations returned empty.  
**Root cause:** V2 migrations set up RLS on all core tables with policies only for `cello_service`. The analytics role was granted `SELECT` in V7, but PostgreSQL RLS denies all rows for roles without an explicit policy even if a GRANT exists. The analytics job silently read zero rows from every protocol table.  
**Fix:** Added V8 migration with `CREATE POLICY analytics_select ON <table> FOR SELECT TO cello_analytics USING (true)` for all five tables the analytics job reads.  
**M5 lesson:** When adding a new database role, test it with `SET ROLE new_role; SELECT COUNT(*) FROM each_table` before writing any application code that uses it. Zero rows without an error is the RLS failure mode.

### 5. pg driver returns BIGINT as JavaScript string, not number

**Symptom:** Hash chain verification (`verifyChain`) always returned `valid: false` on real Postgres, even for freshly inserted chains.  
**Root cause:** The pg node driver returns BIGINT/BIGSERIAL columns as JavaScript strings to avoid 53-bit integer precision loss. Application code inserts `leaf_index: 0` (a number); `SELECT *` returns `leaf_index: "0"` (a string). `JSON.stringify({leaf_index: 0})` ≠ `JSON.stringify({leaf_index: "0"})`. The chain hash computed at INSERT didn't match the hash recomputed at verification.  
**Fix:** Added BIGINT normalization to `serializeRecord()`: string values matching `/^-?\d+$/` are coerced to numbers before serialization, matching insert-time representation.  
**M5 lesson:** Every `pg.Pool` query that reads back columns used in application logic needs an explicit type expectation. Integration tests that touch the real DB must verify round-trip type fidelity, not just that a row was written and found.

### 6. DATE columns affected by local timezone offset, breaking hash chains

**Symptom:** Hash chain verification passed on CI (UTC) but failed locally (UTC+2). The `seal_date` DATE column stored `"2026-01-01"` came back as `2025-12-31T22:00:00Z` — midnight local time expressed in UTC.  
**Root cause:** The pg driver converts DATE columns to JavaScript Date objects using the local timezone. In a UTC+2 environment, `"2026-01-01"` becomes `new Date("2026-01-01T00:00:00+02:00")` which serializes to `"2025-12-31T22:00:00.000Z"`. The insert-time serialization used `"2026-01-01"` (the string). Mismatch.  
**Fix:** Added `configurePgTypes()` — a shared utility that sets `pg.types.setTypeParser` for DATE/TIMESTAMP/TIMESTAMPTZ to return raw strings. Called from `PgDirectoryStore` and `AnalyticsJob` constructors (not at module import time — see bug 8).  
**M5 lesson:** Never rely on implicit Date conversion from the pg driver. Always configure type parsers explicitly for date columns. Integration tests must be run in a non-UTC timezone during development to catch this class of bug early. CI running in UTC is not sufficient.

### 7. Nullable columns absent at INSERT time appeared in SELECT, breaking hash chains

**Symptom:** Chain verification failed specifically for `conversation_seals` (with `close_reason_code`) and `notification_events` (with `sender_pseudonym`).  
**Root cause:** `serializeRecord()` was called with only the columns present in the application's INSERT record. `SELECT *` for verification returned all columns including nullable ones set to NULL. `{"close_reason_code": null}` is not the same JSON as `{}`. The serialization at INSERT time and at verify time diverged.  
**Fix:** Added `TABLE_EXTRA_EXCLUDED` — a per-table map of nullable optional columns that are NOT set at initial INSERT time (they're set later or are always NULL at creation). Examples: `close_reason_code` in `conversation_seals`, `sender_pseudonym` in `notification_events`, `conversation_id` in `connection_requests` (set after connection is accepted), `checkpoint_id` in `conversation_proof_leaves` (set via join table after checkpoint confirmation).  
**M5 lesson:** Every table with nullable columns that can be populated after initial INSERT needs an entry in `TABLE_EXTRA_EXCLUDED`. This must be documented in each story that adds such a column. The story acceptance criteria should include: "chain verification passes before and after the nullable column is populated."

### 8. `pg.types.setTypeParser` called at module import time contaminated other test files

**Symptom:** After the DATE type parser fix, `PERSIST-003` RLS tests and `PERSIST-004` hash chain unit tests began failing when run in the same test suite as `PERSIST-008` analytics tests.  
**Root cause:** `pg.types.setTypeParser` is a global mutation on the `pg` module. Initially, the call was placed at module-level in `analytics-job.ts` and `pg-directory-store.ts`. In Vitest with a single worker process (forks pool, maxForks=1), all test files share the same Node.js module registry. When `persist-008` tests imported `analytics-job.ts`, the type parser was set globally — affecting all pg connections in all subsequent test files.  
**Fix (two parts):** (1) Moved `configurePgTypes()` to a dedicated utility called from class constructors, not module scope. (2) Switched the directory's vitest config from `threads` pool to `forks` pool (`maxForks: 1`) — each test file now runs in its own child process with true isolation. This also resolved the separate problem of `beforeEach` cleanup hooks bleeding across test files.  
**M5 lesson:** Any global side effect (type parsers, environment variables, module-level state) set in production code must be called explicitly from constructors or explicit setup functions, never on import. For M5, which involves real AWS infrastructure adapters, this pattern is critical — an `S3Client` constructor should not mutate global state that affects other tests.

### 9. Vitest `beforeEach`/`afterEach` inside `describe()` bleeds across files in threads pool

**Symptom:** `TRUNCATE conversation_seals CASCADE` in `PERSIST-004`'s `beforeEach` was running before `PERSIST-003` tests, wiping rows that the RLS tests had just inserted.  
**Root cause:** Vitest's threads pool with `maxThreads=1` runs all test files in a single worker process. In this configuration, lifecycle hooks registered inside `describe()` blocks are visible to other test files loaded in the same process — they are not properly scoped. This is a Vitest behavior, not a bug per se.  
**Fix:** Switched to forks pool (`pool: "forks"`, `maxForks: 1` in `vitest.config.ts`). Each file runs in a separate child process. Hook bleed is impossible; peak memory stays at ~4.5GB (one fork at a time, safe for the 8GB Docker constraint).  
**M5 lesson:** Any project that has integration tests with shared database state MUST use `pool: "forks"` with `maxForks: 1` to prevent hook bleed. Document this in the vitest config comment. Tests that need a clean database at the start of their suite should use `beforeAll` inside the suite's `describe()`, not top-level `beforeEach`.

### 10. `conversation_proof_leaf_checkpoints` join table was necessary to avoid UPDATE on append-only leaf table

**Symptom:** Discovered during PERSIST-007 code review — the initial implementation set `checkpoint_id` directly on `conversation_proof_leaves` via UPDATE, but `cello_service` has INSERT+SELECT only (no UPDATE) on append-only tables.  
**Root cause:** The design called for leaf→checkpoint association but the schema didn't provide a way to do it without UPDATE.  
**Fix:** Added `conversation_proof_leaf_checkpoints` join table (INSERT+SELECT only) as a separate V6 migration. Checkpoint association is recorded by inserting into the join table, never by updating the leaf row.  
**M5 lesson:** Any association between two append-only entities requires a dedicated join table, not a foreign key column on either entity. Review all schema relationships where one side is append-only before writing the migration.

### 11. PERSIST-003 tests predated PERSIST-004's `chain_hash NOT NULL` constraint

**Symptom:** PERSIST-003 RLS tests failed with `null value in column "chain_hash" violates not-null constraint`.  
**Root cause:** PERSIST-003 (RLS, append-only schema) was written and tested before PERSIST-004 added `chain_hash NOT NULL` to `conversation_seals`. The test INSERT statements didn't include `chain_hash`. This wasn't caught earlier because unit tests used in-memory stores that don't enforce schema constraints.  
**Fix:** Added `chain_hash = '0'.repeat(64)` to all RLS test INSERTs. The value is irrelevant to what the RLS test verifies; it satisfies the constraint.  
**M5 lesson:** When a story adds a NOT NULL constraint to an existing table, audit all existing tests that INSERT into that table and add the required field. In the current agent-driven development model, each story is implemented in isolation — the implementing agent will not automatically know about constraints added by another story. This must be a checklist item in the SPARC completion gate.

### 12. `buildRelayAckTbs` was independently implemented in relay and client

**Symptom:** Found by the independent code reviewer as a HIGH finding. If the relay's TBS construction and the client's TBS construction ever diverged, ACK verification would silently fail and hashes would accumulate in the pending queue forever — no error, just stuck.  
**Root cause:** PERSIST-012 was implemented with the relay signing over raw `content_hash` bytes and the client verifying over hex-decoded bytes. Both produced the same TBS in the initial implementation, but there was no single canonical function — two independent inline implementations.  
**Fix:** Moved `buildRelayAckTbs` to `@cello/crypto`. Both relay (signer) and client (verifier) import from there. Added cross-path contract test proving relay sign (raw bytes) → client verify (hex-decoded bytes) → same TBS → signature passes.  
**M5 lesson:** Any cryptographic primitive used by two different processes in the same protocol MUST live in `@cello/crypto`. Never independently implement the same algorithm in two packages.

---

## Key Design Decisions Made During M4

**Adapter pattern enforced for all external dependencies.** Every external system (Postgres, KMS, S3, EventBridge) is behind an interface in `packages/interfaces/` with a local stub. Application code never calls AWS directly. This made the inner development loop fast — unit tests run without any infrastructure. The decision paid off: the entire M4 feature set was testable with just Docker Compose.

**Flyway-at-ECS-startup, not in CodeBuild.** The directory ECS task runs `flyway migrate` as its entrypoint before starting the directory service process. If migrations fail, the task fails its health check and ECS keeps the previous revision running — clean rollback with no manual intervention. This was explicitly preferred over a VPC-attached CodeBuild migration step that would require a NAT Gateway for outbound traffic.

**conversation_seal_staging is the only non-append-only table.** Every protocol table is INSERT+SELECT only. The staging table is intentionally mutable — rows have their `checkpoint_id` stamped on checkpoint initiation (UPDATE) then deleted after confirmation (DELETE). This is documented explicitly in the V5 migration comment. Any future developer reading the schema will find the reason.

**`EnvelopeKeyProvider` vs `SigningKeyProvider` naming.** These two interfaces look superficially similar but are entirely different: `EnvelopeKeyProvider` encrypts K_server_X shares at rest via KMS (directory-side, introduced M4). `SigningKeyProvider` is the client-side Ed25519 signing interface (introduced M0). Confusing them is both a type error and a security error — they are defined in separate files with explicit naming warnings in the CLAUDE.md.

**`configurePgTypes()` called from constructors, not module scope.** The pg driver's type parser registry is global. Setting it on module import makes the side effect implicit and order-dependent. The M4 pattern: `configurePgTypes()` is called from `PgDirectoryStore` and `AnalyticsJob` constructors. It's idempotent (no-op on second call). This makes the dependency explicit and avoids test contamination.

**Vitest forks pool for integration tests.** Tests that touch a shared database require process-level isolation. Vitest's threads pool with a single thread does not provide this — lifecycle hooks bleed. The forks pool (`maxForks: 1`) gives each test file its own child process while keeping peak memory within the 8GB Docker constraint.

---

## What the Live Smoke Test Will Prove (PERSIST-E2E-001)

PERSIST-E2E-001 is not yet executed. It requires five separate OS processes — directory, relay, Agent A, Agent B, and a verifier process — all running simultaneously with no shared memory.

The scenarios:
1. Hash chain verified across 10 messages on a real Postgres instance
2. Relay crash + SIGKILL mid-session + WAL reconstruction on restart — seal proceeds without agent re-submission
3. Gap-fill: A sends 10 leaves, B receives 8, directory returns `SEAL_REJECTED_TREE_MISMATCH`, B requests leaves 9–10 from relay WAL, trees converge, seal succeeds
4. Unilateral seal: B goes offline, `delivery_grace_seconds` elapses, A seals unilaterally, B receives notification on reconnect
5. MMR inclusion proof: B requests proof for sealed conversation, verifies inclusion independently using only the checkpoint peak hash

All five scenarios have implementation backing. The open question is whether the infrastructure wiring (Flyway startup, KMS unwrap at startup, `configurePgTypes()` on real RDS, relay WAL file path) is correct end-to-end. That's what the smoke test answers.

---

## What Remains Open

**PERSIST-E2E-001 — multi-process smoke test.** The milestone close gate. Not yet run.

**AC-007 in PERSIST-E2E-001 — `migration.applied` and `migration.failed` Flyway events.** Flyway doesn't natively emit structured log events. The directory process would need to parse Flyway output and emit these as Logger events. This is not yet implemented; the E2E AC may need to be scoped to checking that migrations were applied (via `flyway_schema_history` query) rather than log event parsing.

**KMS production wiring.** `LocalEnvelopeKeyProvider` (AES-256-GCM with a dev key) is used in all tests. The AWS KMS production implementation is stubbed. It needs to be wired before `CELLO_ENV=dev` startup is possible.

**S3 production wiring for `AuditLogShipper` and `CloudStorageProvider`.** Local file sink implementations tested. S3 implementations exist in the codebase but are not yet exercised against real AWS.

**Analytics graph analysis at scale.** The conductance and clustering coefficient computation in `AnalyticsJob` is O(P × E) where P is pseudonym count and E is edge count. Acceptable at current (near-zero) scale. Performance cliff at tens of thousands of pseudonyms. No circuit-breaker or execution time limit is in place.

**`analytics_run_log` grows unboundedly.** The table accumulates one row per analytics job run. `checkStale()` reads the most recent row correctly. No pruning or archiving strategy is defined.

---

## What M5 Builds On — And What Lessons to Apply

M5 takes the M4 single-node foundation and makes it a real network: 3-node RDS federation with logical replication, ECS hosting, CI/CD pipeline, and operational security infrastructure.

Every M4 lesson translates directly to M5.

### Migration discipline
M5 adds logical replication subscription setup, VPC peering, ECS task definitions, and S3 bucket policies — all as IaC and migrations. The V4 collision cannot repeat: migration version numbers must be assigned from a shared counter at story-write time, not chosen independently at implementation time. The sprint agent must check the highest existing version number before writing a new migration.

### RLS for every new role
M5 adds no new database roles (the `cello_analytics` gap was closed by V8 in M4), but it adds cross-node replication users and potentially an IAM-authenticated RDS connection. Every role that reads from a table needs both a GRANT and an RLS policy. The V8 lesson must become a checklist item in the story template: "After creating GRANT, verify: `SET ROLE new_role; SELECT COUNT(*) FROM table;` returns > 0."

### Type safety at the AWS boundary
M5 connects to real AWS services: RDS, KMS, S3, CloudWatch, ECS, EventBridge. The M4 pg driver BIGINT-as-string lesson generalizes: AWS SDK responses have their own type coercion surprises. Every adapter implementation must include a round-trip type test that sends a known value and reads it back, verifying the type matches what the application code expects.

### Date/time handling in a multi-region deployment
M5 runs directory nodes in us-east-1, eu-central-1, and ap-northeast-1. The M4 timezone lesson is amplified: times stored in Tokyo (JST, UTC+9) and read in Frankfurt (CET, UTC+1) will produce different JavaScript Date objects unless the pg driver's DATE parser returns raw strings. `configurePgTypes()` must be called on every database connection in every node, in every region. This should be enforced by a startup check that queries a known DATE value and verifies the string form.

### No global state in production adapters
The M4 `configurePgTypes()` module-scope pollution problem generalizes to M5's AWS adapter implementations. `S3CloudStorageProvider`, `KmsEnvelopeKeyProvider`, and `CloudWatchLogger` must configure their clients in constructors, not at module import time. Each adapter must be instantiable in a test without side effects on the module registry.

### Integration tests need real infrastructure from the start
The M4 pattern of "unit tests with stubs pass, integration tests against real Postgres reveal 12 bugs" is the correct workflow — but the bugs were found late (at CELLO_ENV=local run time, not at story implementation time). For M5, every story that adds an ECS task definition, RDS parameter group, or S3 bucket policy should include an integration test that runs against a real `dev` environment resource, not just a local stub. The `CELLO_ENV=dev` environment exists precisely for this.

### Migration idempotency is non-negotiable
Every V5–V8 migration required idempotency fixes after the first `flyway migrate` run against an existing database. M5's migrations (VPC peering configuration, subscription setup, replication slot creation) will encounter the same problem — existing resources from prior runs. Every `CREATE` in a migration must be `CREATE IF NOT EXISTS`; every `ALTER` must check for existence first using `DO $$ IF NOT EXISTS ... END $$`.

### The close gate is not "unit tests green"
M3's milestone close gate required a live two-process smoke test. M4 added the requirement that it be five processes with relay crash recovery. M5's close gate must include: all three federation nodes running and replicating to each other, a seal completed on node A visible on nodes B and C, and a cross-node inclusion proof verification. Vitest passing is necessary but not sufficient.

---

## Related Documents
- [[CELLO-PERSIST-E2E-001]] — M4 close gate story
- [[2026-04-11_1700_persistence-layer-design]] — complete schema reference
- [[2026-05-14_1702_relay-session-mechanics-and-recovery]] — relay WAL design, pre-seal reconciliation
- [[2026-05-16_0753_development-pipeline-and-local-iteration]] — adapter inventory, local development infrastructure, canonical event taxonomy
- [[2026-05-16_0900_m4-infrastructure-decisions]] — VPC topology, RDS, KMS, S3, IaC templates
- [[M3-connection-policy-and-registration]] — M3 write-up
- [[server-infrastructure]] — CELLO Server Infrastructure Requirements
- [[agent-client]] — CELLO Agent Client Requirements
- [[CONTEXT]] — canonical glossary
