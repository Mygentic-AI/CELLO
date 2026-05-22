---
name: Development Pipeline and Local Iteration Strategy
type: discussion
date: 2026-05-16 07:53
topics: [infrastructure, testing, ci-cd, adapter-pattern, observability, local-development]
status: active
description: Decisions on how to maintain fast local iteration cycles as CELLO moves from hermetically sealed protocol code into external systems (M4+).
---

# Development Pipeline and Local Iteration Strategy

## The Core Problem

M0–M3 were hermetically sealed. The entire stack — directory node, relay node, two clients — ran in a single Vitest process. Test feedback was near-instant. Red-first TDD was practical.

M4 onward is categorically different. PostgreSQL with RLS, KMS envelope encryption, EFS, Lambda, and ECS Fargate are all external systems. The test feedback loop breaks because:

- Failures are ambiguous: is it code, an IAM permission, a schema migration, a connection pool timeout?
- "Real behavior" requires standing infrastructure
- Without deliberate design, every change becomes a 15-20 minute deploy cycle

The goal is to preserve the fast inner loop for as long as possible by putting every external dependency behind an interface with a local implementation.

---

## Decision: Adapter Pattern for All External Dependencies

Every external dependency gets an interface. The interface is defined by what the consumer needs, not by what the external system can do. Two implementations exist for each: a local stub for development and a real implementation for AWS deployment.

The interface boundary must be narrow. If the local implementation ever needs to simulate provider-specific behavior to make tests pass, the boundary is in the wrong place.

**Rule**: never add to an interface except in response to a specific failing test or a specific production behavior being implemented right now.

---

## Authentication

**Interface:**
```typescript
interface TokenValidator {
  validate(token: string): Promise<Principal>
}

type Principal =
  | { type: 'operator'; operatorId: string; roles: string[] }
  | { type: 'service'; serviceId: string; scope: string[] }
  | { type: 'scheduled_job'; jobId: string; ownerId: string }
```

**Local implementation**: accepts a hardcoded dev token, returns a fixed `Principal`. No network call, no auth provider dependency.

**Production implementation**: validates JWT against the chosen auth provider's JWKS endpoint.

**Key decisions:**
- Define the full principal taxonomy before choosing an auth provider. The provider mints tokens; the taxonomy is the real contract.
- Principal types for CELLO at minimum: operator (interactive), service-to-service (headless), scheduled job. Additional types added only when a specific story requires them.
- `AuthenticatedIdentity` struct is designed from actual token claims, not from what we wish the token contained. Inspect the real JWT before designing the interface.
- Fail fast at startup if required configuration is missing — never fail silently at runtime.

**Note from cello-agent**: token proliferation is real. Interactive sessions, headless background tasks, and scheduled jobs ended up with different token types for good reasons. Design the principal taxonomy upfront to avoid retrofitting.

---

## Secrets / KMS

**Interface:**
```typescript
interface KeyProvider {
  encrypt(plaintext: Uint8Array, keyId: string): Promise<Uint8Array>
  decrypt(ciphertext: Uint8Array, keyId: string): Promise<Uint8Array>
  rotate(keyId: string): Promise<void>
}
```

**Local implementation**: AES encryption with a hardcoded dev key from an env var. No Docker dependency, instant, deterministic. Tests the code that uses the result of a KMS call, not the KMS call itself.

**Production implementation**: AWS KMS. Dev and prod use separate KMS keys in the same AWS account. Key policy on the dev key allows dev credentials. Key policy on the prod key allows only the production ECS task role — dev credentials cannot touch it.

**Decision**: no LocalStack for KMS. LocalStack's key policy enforcement has known gaps. The in-process stub covers the inner loop; the real dev KMS key covers the residual AWS seam.

---

## Database / Migrations

**Decision**: real Postgres in a Docker container locally, not a mock. RLS append-only enforcement, pgaudit triggers, and hash chain constraints are database-level constructs. A mock database never catches a broken RLS policy.

```yaml
# docker-compose.yml
postgres:
  image: postgres:18.4
  environment:
    POSTGRES_DB: cello_dev
    POSTGRES_PASSWORD: dev
  ports:
    - "5432:5432"
```

**Migration discipline**: migrations are the single source of truth. The local Postgres container and RDS are brought to identical state by running the same migration files in the same order. Manual schema tweaks to make a test pass are a warning sign that migrations have drifted.

**Migration tool decision: Flyway (PostgreSQL) + custom lightweight runner (SQLite/SQLCipher).** Resolved in the M4 milestone outline.

- **Directory (PostgreSQL)**: Flyway Community Edition. SQL-first, versioned files (`V{n}__{description}.sql`) tracked in `flyway_schema_history`. RLS policies and pgaudit triggers are written as plain SQL. `node-flywaydb` npm package integrates into the pnpm workspace. `flyway migrate` runs in CodeBuild before the new ECS image is deployed. Free community edition covers all required features.
- **Client (SQLite/SQLCipher)**: a lightweight custom migration runner. Flyway Community does not support SQLite. The runner reads versioned `.sql` files from `packages/client/db/migrations/` in `V{n}__{description}.sql` order, applies each in a transaction, and tracks applied versions in a `schema_migrations` table (`version TEXT PRIMARY KEY, applied_at TIMESTAMP`). No external tooling dependency.

---

## Seed Data

Two distinct problems requiring different solutions:

**Test isolation**: transaction rollback. Each test runs inside a transaction that rolls back at completion. Nothing written to disk. Near-instant. Supports hundreds of tests per second. This is the standard Postgres test pattern.

**Development seeding**: a committed seed SQL file — a `pg_dump` snapshot of a known good state. Running it wipes and restores in seconds. When a new scenario is needed, set it up manually once, dump it, commit the file. The seed file lives in version control alongside migrations.

**Minimum seed scenarios before M4**: registered operator, unregistered operator, active session, sealed session.

---

## Observability

**Interface:**
```typescript
interface Logger {
  info(event: string, context: Record<string, unknown>): void
  warn(event: string, context: Record<string, unknown>): void
  error(event: string, error: Error, context: Record<string, unknown>): void
}
```

**Local implementation**: structured JSON to stdout, pretty-printed for readability (pino-pretty or jq).

**Production implementation**: same structured JSON to CloudWatch — which is what CloudWatch expects.

**Structured logging is mandatory from day one.** Not `console.log("session started for " + userId)`. Instead:
```typescript
logger.info("session.started", { userId, sessionId, principalType })
```

**Correlation IDs are mandatory for all async multi-process flows.** CELLO has async flows involving client, directory, and relay in sequence. Every log line in a flow must carry a shared `correlationId` minted at flow initiation and threaded through every subsequent call. Without this, debugging a FROST ceremony failure means correlating three separate streams of unconnected log lines.

**Event taxonomy** must be established before M4 stories are written. Event names are constants, not strings scattered through the codebase. Naming convention: `domain.noun.verb` — e.g., `session.started`, `frost.dkg.round1.complete`, `connection.request.received`.

**Observability is a garden, not a setup task.** It requires continuous weeding:
- Every story's acceptance criteria must include observability requirements: named events for each significant state transition, correlation ID threading, error paths with sufficient diagnostic context, alerting thresholds for new failure modes.
- `/cello-story` must prompt for observability ACs.
- `/cello-review` must verify that implementation log events match story-specified events, use consistent taxonomy, and carry required context fields.
- `/cello-sprint` must load the Logger interface and current event taxonomy as mandatory context before any story agent begins.
- A periodic taxonomy audit at each milestone close standardizes naming before it drifts.

**What belongs in the event taxonomy seed (before M4):**
- `operator.registered`, `operator.registration.failed`
- `session.started`, `session.sealed`, `session.closed`
- `frost.dkg.initiated`, `frost.dkg.round1.complete`, `frost.dkg.round2.complete`, `frost.dkg.failed`
- `connection.request.received`, `connection.request.accepted`, `connection.request.declined`
- `key.encrypted`, `key.decrypted`, `key.rotation.initiated`
- `migration.applied`, `migration.failed`
- `adapter.write.failed` — context fields: `{ adapterName, reason }`; fired when a fire-and-forget write (e.g. `PgDirectoryStore#fire`) rejects; the write is not retried and the caller is not notified
- `relay.ack.sign.failed` — level: error; context fields: `{ seq, sessionId, err }`; fired when the relay's ACK signing key provider throws during `hash_submit_ack` generation; the relay falls back to issuing an unsigned ACK so the submission is not rejected; added in PERSIST-012
- `adapter.config.missing` — level: error; context fields: `{ adapter, missingVar }`; fired at startup when a required environment variable for an adapter is absent; the process exits with code 1; used consistently across all composition root entrypoints
- `analytics.job.started` — level: info; context fields: `{ runId, triggeredBy }`; fired at the start of every analytics job run; `triggeredBy` is `"scheduler"` for EventBridge-triggered runs and `"cli"` for manual invocations; added in PERSIST-008
- `analytics.job.completed` — level: info; context fields: `{ runId, durationMs, pseudonymCount, edgeCount }`; fired on successful run completion; added in PERSIST-008
- `analytics.job.failed` — level: error; context fields: `{ runId, reason, phase }`; fired when any phase fails; the write transaction is rolled back before this event fires; added in PERSIST-008
- `analytics.job.stale` — level: warn; context fields: `{ lastSuccessfulRunAt }`; fired by `checkStale()` when no successful run has been recorded in over 24 hours; added in PERSIST-008
- `schema.completeness.verified` — level: info; context fields: `{ tableCount, migrationCount }`; correlationId: false; **test-output event only** — emitted by the schema completeness test runner when all referenced tables are confirmed present in migrations and database; does not fire through the production Logger interface; added in PERSIST-016
- `schema.completeness.failed` — level: error; context fields: `{ missingTables, checkedTableCount }`; correlationId: false; **test-output event only** — emitted by the schema completeness test runner when one or more referenced tables are missing from migrations or database; does not fire through the production Logger interface; added in PERSIST-016
- `adapter.initialised` — level: info; context fields: `{ adapterName, implementation?, env, triggeredBy? }`; fired by the directory composition root once per adapter after successful instantiation; `adapterName` is the canonical adapter name (e.g. `"PgDirectoryStore"`, `"EnvelopeKeyProvider"`, `"JobScheduler"`); `implementation` is the concrete class name when multiple implementations exist; `triggeredBy` is present for job handlers to indicate how they are triggered (e.g. `"scheduler"`); correlationId: false (fires at startup, no session context); added in PERSIST-001
- `adapter.init.failed` — level: error; context fields: `{ adapterName, reason }`; fired by the directory composition root when an adapter fails to initialise; the process exits 1 after logging this event; correlationId: false; added in PERSIST-001
- `adapter.config.missing` — level: error; context fields: `{ missingKey, env, reason? }`; fired by the directory composition root when a required environment variable is absent; the process exits 1 after logging; correlationId: false; added in PERSIST-001
- `mmr.checkpoint.pending` — level: info; context fields: `{ sessionId, sealedRoot, stagedAt, correlationId }`; fired inside `MmrStore.appendSeal()` when a seal is successfully staged in `conversation_seal_staging` but no MMR checkpoint has yet committed the session's sealed_root; carries the seal-ceremony correlationId; added in PERSIST-017
- `mmr.session.checkpointed` — level: info; context fields: `{ sessionId, checkpointId, leafIndex, peakHash, correlationId }`; fired per-session when the MMR checkpoint run commits that session's staged_root; distinct from `mmr.checkpoint.confirmed` (PERSIST-007) which fires once per checkpoint at the checkpoint level with aggregate fields `{ checkpointId, leafCount, peakHash, stagedSealCount }`; added in PERSIST-017
- `mmr.checkpoint.overdue` — level: warn; context fields: `{ sessionId, stagedAt, maxStagingAgeMs }`; fired by the overdue detector when a staged sealed_root has been pending longer than `max_staging_age`; triggers a forced checkpoint flush; correlationId not threaded (fires from scheduler context); added in PERSIST-017
- `mmr.checkpoint.correlationId.missing` — level: warn; context fields: `{ sessionId, checkpointId }`; fired by `MmrStore.confirmCheckpoint()` when a staging row has a null `correlation_id` column — indicates legacy or corrupt staging data; the checkpoint continues but the `mmr.session.checkpointed` event for that session will carry a null correlationId; added in PERSIST-017
- `mmr.checkpoint.recovery.started` — level: info; context fields: `{ checkpointId, env }`; fired by the directory composition root at startup when an incomplete (orphaned) checkpoint is detected and re-execution begins; paired with `mmr.checkpoint.recovery.completed`; added in PERSIST-017
- `mmr.checkpoint.recovery.completed` — level: info; context fields: `{ checkpointId, env }`; fired by the directory composition root at startup when an incomplete checkpoint has been successfully re-executed via `MmrStore.confirmCheckpoint()` (idempotent); added in PERSIST-017
- `mmr.staging.failed` — level: warn; context fields: `{ sessionId, reason }`; fired when the fire-and-forget `appendSeal()` call in the seal path rejects; the session remains sealed (the FROST ceremony succeeded), but the MMR staging entry was not written — the sealed_root will not appear in any future checkpoint until the session is re-staged; added in PERSIST-017
- `session.sealed.received` — level: info; context fields: `{ sessionId, sealedRoot, closeTimestamp, checkpointStatus, correlationId }`; fired by the client inside `#enqueueSessionSealedEvent` when a `session_sealed` directory frame is verified and enqueued as a lifecycle event for `cello_receive` / `cello_receive_any`; correlationId is the sessionIdHex (unique per session lifecycle); added in SESSION-007
- `session.receive.pending_hint` — level: info; context fields: `{ currentSessionId, pendingSessionCount, correlationId }`; fired by `receiveMessageAsync` and `receiveAnyMessageAsync` when the returned message has `otherSessionsPending` non-empty; signals to the on-call engineer that the agent has additional queued messages on other sessions; added in SESSION-007
- `pipeline.webhook.received` — level: info; context fields: `{ repository, branch, commitSha, changedFileCount }`; correlationId: false; fired by `github-webhook-receiver` Lambda when a GitHub push webhook is verified and forwarded to EventBridge; added in DEPLOY-004
- `pipeline.webhook.rejected` — level: warn; context fields: `{ reason, sourceIp }`; correlationId: false; fired by `github-webhook-receiver` Lambda when HMAC verification fails or signature header is absent; reason is `"missing_signature"` or `"invalid_signature"`; added in DEPLOY-004
- `pipeline.webhook.secret_fetch_failed` — level: error; context fields: `{ reason }`; correlationId: false; fired by `github-webhook-receiver` Lambda when Secrets Manager call fails; Lambda returns 500; added in DEPLOY-004
- `pipeline.webhook.forward_failed` — level: error; context fields: `{ reason }`; correlationId: false; fired by `github-webhook-receiver` Lambda when the EventBridge `put_events` call fails after successful HMAC verification; Lambda returns 500; added in DEPLOY-004
- `pipeline.triggered` — level: info; context fields: `{ pipeline, commitSha, matchedPath, executionId }`; correlationId: false; fired by `cello-pipeline-filter` Lambda for each CodePipeline successfully started; added in DEPLOY-004
- `pipeline.trigger.failed` — level: error; context fields: `{ pipeline, reason }`; correlationId: false; fired by `cello-pipeline-filter` Lambda when `start_pipeline_execution` fails for a specific pipeline; the Lambda continues attempting other matched pipelines (DB-002); added in DEPLOY-004
- `pipeline.filter.no_match` — level: info; context fields: `{ changedFileCount }`; correlationId: false; fired by `cello-pipeline-filter` Lambda when no changed path matches any mapping — push is silently ignored; added in DEPLOY-004
- `pipeline.filter.mappings_load_failed` — level: error; context fields: `{ reason }`; correlationId: false; fired by `cello-pipeline-filter` Lambda when `pipeline-mappings.json` cannot be opened or parsed; Lambda returns 500; added in DEPLOY-004
- `audit.shipper.retry.error` — level: error; context fields: `{ error }`; fired by `S3AuditLogShipper#scheduleRetry` when an unexpected error escapes the `#retryFlush` promise chain; guards the background retry loop from silently dying on unhandled rejections; added in SECOPS-001; package: directory
- `audit.ship.failed` — level: error; context fields: `{ error }`; fired by `LocalAuditLogShipper.ship()` when the local file write rejects (e.g. path does not exist); the entry is placed in the retry queue before this event fires; added in PERSIST-006/SECOPS-001; package: interfaces/stubs
- `audit.ship.retry.exhausted` — level: error; context fields: `{ attempt, error }`; fired by `LocalAuditLogShipper.flush()` when a retry queue entry fails to write after `maxRetries` attempts; the entry is discarded after this event; added in PERSIST-006/SECOPS-001; package: interfaces/stubs

---

## Environment Wiring

**Decision: composition root pattern.** All adapters are instantiated in a single location at application startup — `server.ts` or equivalent. No magic, no framework. Environment selection is explicit and readable:

```typescript
const channel = process.env.CELLO_ENV === 'local'
  ? new CliAdapter()
  : new BaileysAdapter(config)
```

**Startup validation is mandatory.** If a required adapter is missing its configuration, the application fails immediately with a clear error. Never fail silently at runtime.

**Environment variable is never set manually.** It comes from IaC in AWS and from a committed `.env.example` locally. No undocumented environment state.

**Environment tiers:**

Phase 1 (now through ~M8): two tiers.
- `local` — Docker Compose, stub adapters, real Postgres container, no AWS dependency
- `dev` — real AWS account, real services, IaC-deployed, dev KMS key, isolated from prod data

Phase 2 (~M8 onward, approaching real users): three tiers.
- `local` — unchanged
- `dev` — unchanged; `dev` is a permanent tier name, not a placeholder
- `staging` — new tier, mirrors production topology at reduced instance sizes
- `production` — new, separate parameter set, production KMS key, production data

`dev` is the permanent name for the AWS-backed pre-staging environment. It was considered naming this tier `cloud` on the grounds that it is the only cloud tier in Phase 1, but that name was rejected: `cloud` is redundant with "VPC" and "AWS" in resource names, non-descriptive to anyone without historical context, and expensive to rename later — S3 bucket names, RDS instance identifiers, and KMS key aliases cannot be renamed in place. `dev` is accurate, unambiguous, and consistent with how it is already referenced (the KMS key is `cello-dev-master-key`, Secrets Manager paths use `cello/dev/...`).

```typescript
type Environment = 'local' | 'dev' | 'staging' | 'production'
```

---

## Interfaces in Well-Known Locations

All shared interfaces live in `packages/interfaces/` (or equivalent well-known path). `/cello-sprint` points at these files as required reading before any story agent begins. Agents do not rediscover or reinvent interface contracts independently.

The repo structure should be reviewed before M4 to establish this convention.

---

## CI/CD Pipeline

**Stack**: AWS CodePipeline V2, CodeBuild, CodeDeploy, EventBridge, Lambda. All on AWS credits.

**Pipeline shape:**
```
GitHub push to main
  → github-webhook-receiver Lambda (us-east-1)
      verifies HMAC signature → puts payload on EventBridge github-events bus
  → EventBridge rule triggers cello-pipeline-filter Lambda (us-east-1)
      inspects commit.modified/added/removed paths
      triggers matching CodePipeline(s) via start_pipeline_execution
  → CodePipeline → CodeBuild (us-east-1)
      lint, typecheck, test
      apply migrations
      deploy (lambda update-function-code or ecs update-service)
      run smoke test
  → SNS notification: pass or fail
```

**Path filtering**: use the Lambda router pattern (cello-pipeline-filter) rather than CodePipeline V2 native path filtering via CodeConnections. Native path filtering was attempted on cello-agent and failed due to coarse glob behavior and tooling that lagged the API. The Lambda router is proven, behavior is deterministic, and we own the logic completely.

**Enhancement over cello-agent**: make folder-to-pipeline mappings data-driven — a JSON config file in the repo read by the Lambda at invocation time. Adding a new package updates the config file, not the Lambda.

**Shared dependency handling**: if `packages/crypto` or `packages/protocol-types` changes, all downstream pipelines trigger. Model this as an `"all"` sentinel in the mappings config.

**IaC discipline**: everything that exists in AWS exists in IaC. The console is a scratchpad. Any emergency fix applied via console is backported to IaC before closing the laptop. One template per service, environment passed as a parameter — `cello-local`, `cello-dev`, `cello-staging`, `cello-production` are instantiations of the same template with different values. Two diverging templates means two sources of truth that will drift.

**Rollback**: fix forward for a single developer. Rollback machinery adds complexity that isn't warranted yet.

**Database migrations — ECS startup, not CodeBuild.** The directory ECS task runs `flyway migrate` as its entrypoint before starting the directory service process. If migrations fail, the task fails its health check and ECS keeps the previous task revision running — clean rollback with no manual intervention. This was chosen over VPC-attached CodeBuild because VPC-attached CodeBuild loses default internet access and requires a NAT Gateway for outbound traffic (`pnpm install`, ECR pushes). No NAT Gateway is needed for M5 — VPC Interface Endpoints cover all AWS service access from private subnets (ECR, Secrets Manager, KMS, CloudWatch Logs); S3 Gateway Endpoint (free) covers S3 access. CodeBuild runs outside the VPC with standard internet access.

**Inter-node networking — VPC Peering, not public ALBs.** All traffic between directory nodes (RDS logical replication AND checkpoint cross-signing) travels over VPC Peering. Three peering connections are established at M5 (one per node pair). Public ALBs carry only agent→directory traffic. Chosen over routing checkpoint traffic over public ALB endpoints because: (a) private traffic never leaves the AWS backbone — no public attack surface for inter-node trust operations; (b) VPC Peering is fully managed with zero operational overhead once configured. **Evaluate Transit Gateway at 6+ nodes** — peering connections grow quadratically and Transit Gateway is the correct upgrade path.

**Smoke test definition per milestone**: minimum for M4 — migrations applied cleanly, app starts, basic authenticated request succeeds, KMS encrypt/decrypt roundtrip works.

---

## The Residual Cloud Seam

Some behaviors cannot be emulated locally regardless of tooling quality: real IAM policy evaluation, Lambda cold start timing under real network conditions, RDS failover behavior, ECS task networking. These require a real AWS environment to test.

The `dev` environment is the designated place to test the seam. It uses real AWS services, real IAM, real KMS dev key — but is completely isolated from production data. Fast to deploy to via `lambda update-function-code` (30 seconds) rather than full SAM redeployments (15-20 minutes).

The SAM/CloudFormation full redeploy is for infrastructure changes. Code changes use targeted update commands.

---

## Adapter Inventory

Every external dependency gets an interface with two implementations: a local stub and a real production implementation. The interface is defined by what the consumer needs, not by what the external system can do.

Interfaces needed before M4 stories are written go into `packages/interfaces/` immediately. Later interfaces are added just-in-time as their milestone approaches.

| Interface | Real Implementation | Local Stub | Milestone |
|-----------|-------------------|------------|-----------|
| `TokenValidator` | Auth provider JWKS validation | Hardcoded dev token → fixed Principal | M4 |
| `KeyProvider` | AWS KMS | In-process AES with dev key from env var | M4 |
| `DirectoryStore` | RDS PostgreSQL | Local Postgres container | M4 |
| `ClientStore` | SQLCipher | Local unencrypted SQLite | M4 |
| `RelayWal` | Crash-recovery WAL | In-memory WAL | M4 |
| `Logger` | CloudWatch structured JSON | stdout structured JSON (pino-pretty) | M4 |
| `JobScheduler` | EventBridge Scheduler | Local cron or manual trigger | M4 (analytics cron) |
| `MessagingChannel` — WhatsApp | Baileys persistent WebSocket | CLI stdin/stdout | M6 |
| `MessagingChannel` — Telegram | Telegraf or Grammy | CLI stdin/stdout | M6 |
| `MessagingChannel` — WeChat | WeChat Official Account API (deferred) | CLI stdin/stdout | Deferred |
| `OtpDeliveryProvider` | Email via SES or similar | Prints OTP to console | M6 |
| `SecurityAlertProvider` | Routes to operator's messaging channel | Logs locally | M6 |
| `TrustSignalProofProvider` | Passport.js OAuth per provider | Hardcoded proof stub | M7 |
| `TrustAuditorAgent` | Browser harness read-only agent | Hardcoded TrustSignalData stub | M7 |
| `SearchIndex` | BM25 + vector search (OpenSearch or similar) | In-memory stub | M8 |
| `AuditLogShipper` | pgaudit shipped to S3 | Local file sink | M4 (implemented in PERSIST-006) |
| `CloudStorageProvider` | S3 | Local file sink (writes to configured local directory) | M4 (implemented in PERSIST-011) |
| `PaymentProvider` | Micropayment mechanism TBD | Stub | M13 |

**Notes:**
- `MessagingChannel` is a single interface with implementations per provider. The CLI adapter serves all three channels locally — it reads from stdin and writes to stdout, channel-agnostic.
- `OtpDeliveryProvider` is separate from `MessagingChannel` because OTP delivery may use email rather than the messaging channel.
- `WeChat` interface must be accommodated in `MessagingChannel` from the start even though the implementation is deferred — the interface cannot be designed around only two channels.
- `PaymentProvider` interface design is deferred until M9 commerce design session.

---

## Artifacts Required Before M4

1. `packages/interfaces/` established with `Logger`, `TokenValidator`, `KeyProvider`, `MessagingChannel`, `DirectoryStore`, `ClientStore`, `RelayWal`, `JobScheduler`
2. Local and production implementations for M4-required interfaces
3. Docker Compose file with Postgres container
4. Seed SQL file covering four baseline scenarios
5. Event taxonomy seed (15-20 named events)
6. `/cello-story` updated to require observability ACs
7. `/cello-review` updated to verify observability implementation
8. `/cello-sprint` updated to load interfaces and event taxonomy as mandatory context
9. Migration tool decision made
10. IaC template for `dev` environment with parameter sets
11. cello-pipeline-filter Lambda updated with data-driven mappings config
