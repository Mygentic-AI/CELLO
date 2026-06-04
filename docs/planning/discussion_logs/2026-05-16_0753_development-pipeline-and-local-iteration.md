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
- `analytics.job.started` — level: info; context fields: `{ runId, triggeredBy }`; fired at the start of every analytics job run; `triggeredBy` is `"scheduler"` for EventBridge-triggered runs and `"cli"` for manual invocations; added in PERSIST-008
- `analytics.job.completed` — level: info; context fields: `{ runId, durationMs, pseudonymCount, edgeCount }`; fired on successful run completion; added in PERSIST-008
- `analytics.job.failed` — level: error; context fields: `{ runId, reason, phase }`; fired when any phase fails; the write transaction is rolled back before this event fires; added in PERSIST-008
- `analytics.job.stale` — level: warn; context fields: `{ lastSuccessfulRunAt }`; fired by `checkStale()` when no successful run has been recorded in over 24 hours; added in PERSIST-008
- `schema.completeness.verified` — level: info; context fields: `{ tableCount, migrationCount }`; correlationId: false; **test-output event only** — emitted by the schema completeness test runner when all referenced tables are confirmed present in migrations and database; does not fire through the production Logger interface; added in PERSIST-016
- `schema.completeness.failed` — level: error; context fields: `{ missingTables, checkedTableCount }`; correlationId: false; **test-output event only** — emitted by the schema completeness test runner when one or more referenced tables are missing from migrations or database; does not fire through the production Logger interface; added in PERSIST-016
- `adapter.initialised` — level: info; context fields: `{ adapterName, implementation?, env, triggeredBy? }`; fired by the directory composition root once per adapter after successful instantiation; `adapterName` is the canonical adapter name (e.g. `"PgDirectoryStore"`, `"EnvelopeKeyProvider"`, `"JobScheduler"`); `implementation` is the concrete class name when multiple implementations exist; `triggeredBy` is present for job handlers to indicate how they are triggered (e.g. `"scheduler"`); correlationId: false (fires at startup, no session context); added in PERSIST-001
- `adapter.init.failed` — level: error; context fields: `{ adapterName, reason }`; fired by the directory composition root when an adapter fails to initialise; the process exits 1 after logging this event; correlationId: false; added in PERSIST-001
- `adapter.config.missing` — level: error; context fields: `{ missingKey, env, reason? }`; fired by the directory composition root when a required environment variable is absent; the process exits 1 after logging; correlationId: false; added in PERSIST-001
- `migration.out.of.date` — level: error; context fields: `{ currentVersion, requiredVersion, env }`; fired by the directory composition root at startup when `MAX(installed_rank)` from `flyway_schema_history` is less than the count of `V*.sql` migration files on disk; the process exits 1 after logging; `currentVersion` is the highest successfully-applied migration rank (0 if none); `requiredVersion` is the count of migration files expected; correlationId: false (fires at startup, before any request context); added in ACCOUNT-001
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
- `pipeline.staging.deployed` — level: info; context fields: `{ pipeline, commitSha, imageDigest, durationMs }`; correlationId: false; fired by `StagingDeployDirectoryBuild` and `StagingDeployRelayBuild` CodeBuild buildspecs when ECS `update-service` + `wait services-stable` completes successfully for the staging cluster; added in DEPLOY-005; package: infra (buildspec)
- `pipeline.staging.deploy.failed` — level: error; context fields: `{ pipeline, commitSha, reason }`; correlationId: false; fired by the staging deploy buildspecs when `ecs update-service` or `ecs wait services-stable` fails; causes CodeBuild to exit non-zero, halting the pipeline before the smoke test stage; added in DEPLOY-005; package: infra (buildspec)
- `pipeline.staging.smoke_test.passed` — level: info; context fields: `{ pipelineExecutionId, durationMs, scenariosRun }`; correlationId: false; fired by `packages/e2e-tests/src/smoke/run-smoke-tests.ts` when all smoke scenarios pass against the staging ALB; process exits 0; added in DEPLOY-005; package: e2e-tests
- `pipeline.staging.smoke_test.failed` — level: error; context fields: `{ pipelineExecutionId, failedScenario, reason }`; correlationId: false; fired by `packages/e2e-tests/src/smoke/run-smoke-tests.ts` when any smoke scenario fails or when `STAGING_DIRECTORY_URL` is absent; process exits 1, causing CodeBuild to fail the smoke test stage and block production deploy; added in DEPLOY-005; package: e2e-tests
- `pipeline.production.deployed` — level: info; context fields: `{ pipeline, region, commitSha, imageDigest, durationMs }`; correlationId: false; fired by `ProductionDeployBuild` CodeBuild buildspec when ECS `update-service` + `wait services-stable` completes successfully for a production region; one event fires per region per deploy; added in DEPLOY-005; package: infra (buildspec)
- `pipeline.production.deploy.failed` — level: error; context fields: `{ pipeline, region, commitSha, reason }`; correlationId: false; fired by the production deploy buildspec when `ecs update-service` or `ecs wait services-stable` fails; CodeBuild exits non-zero, stopping subsequent regions from deploying; added in DEPLOY-005; package: infra (buildspec)
- `smoke.runner.started` — level: info; context fields: `{ stagingUrl, pipelineExecutionId, scenarioCount }`; correlationId: false; fired at the start of the smoke test runner process before any scenarios run; emitted by `packages/e2e-tests/src/smoke/run-smoke-tests.ts`; added in DEPLOY-005; package: e2e-tests
- `smoke.scenario.passed` — level: info; context fields: `{ scenario, durationMs }`; correlationId: false; fired by the smoke test runner after each individual scenario completes without error; one event per passing scenario; emitted by `packages/e2e-tests/src/smoke/run-smoke-tests.ts`; added in DEPLOY-005; package: e2e-tests
- `audit.shipper.retry.error` — level: error; context fields: `{ error }`; fired by `S3AuditLogShipper#scheduleRetry` when an unexpected error escapes the `#retryFlush` promise chain; guards the background retry loop from silently dying on unhandled rejections; added in SECOPS-001; package: directory
- `audit.ship.failed` — level: error; context fields: `{ error }`; fired by `LocalAuditLogShipper.ship()` when the local file write rejects (e.g. path does not exist); the entry is placed in the retry queue before this event fires; added in PERSIST-006/SECOPS-001; package: interfaces/stubs
- `audit.ship.retry.exhausted` — level: error; context fields: `{ attempt, error }`; fired by `LocalAuditLogShipper.flush()` when a retry queue entry fails to write after `maxRetries` attempts; the entry is discarded after this event; added in PERSIST-006/SECOPS-001; package: interfaces/stubs
- `infra.replication.setup.started` — level: info; context fields: `{ environment, regions, nodeCount }`; correlationId: false; fired by `infra/setup-replication.sh` at the start of execution, after argument validation and production confirmation gate; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.publication_created` — level: info; context fields: `{ environment, region, tableCount }`; correlationId: false; fired once per region after CREATE PUBLICATION cello_pub succeeds on a node; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.subscription_created` — level: info; context fields: `{ environment, targetRegion, sourceRegion, slotName }`; correlationId: false; fired once per subscription after CREATE SUBSCRIPTION succeeds; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.slot_streaming` — level: info; context fields: `{ slotName, region, elapsedSeconds }`; correlationId: false; fired during polling when a replication slot is observed as active in pg_replication_slots; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.completed` — level: info; context fields: `{ environment, regions, slotCount, totalElapsedSeconds }`; correlationId: false; fired after all 6 replication slots are confirmed active; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.task_not_running` — level: error; context fields: `{ region, taskStatus }`; correlationId: false; fired to stderr when a Directory ECS task is not in RUNNING state; script exits 1 immediately after; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.slot_not_streaming` — level: error; context fields: `{ slotName, region, elapsedSeconds }`; correlationId: false; fired to stderr for each slot that did not reach active state within the 60-second polling window; script exits 1 after logging all non-streaming slots; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.credentials_mismatch` — level: error; context fields: `{ region, secretArn }`; correlationId: false; fired to stderr when a Secrets Manager secret exists for the region but the password cannot be read or parsed; script exits 1 after logging; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.ddl_failed` — level: error; context fields: `{ region, step, reason, slotName? }`; correlationId: false; fired to stderr when an ECS Exec call fails or psql reports an error during a DDL operation (create_user, create_publication, create_subscription); `step` identifies which DDL operation failed; `reason` is `ecs_exec_failed` or `psql_error`; `slotName` is present for subscription steps only; script exits 1 after logging; added in FEDERATION-001A; package: infra (bash script)
- `infra.replication.setup.rds_host_not_found` — level: error; context fields: `{ region }`; correlationId: false; fired to stderr when neither the ECS task environment variable `RDS_ENDPOINT` nor the CloudFormation stack output `RdsEndpoint` can supply the RDS hostname for a region; script exits 1 after logging; added in FEDERATION-001A; package: infra (bash script)
- `relay.shutdown.failed` — level: error; context fields: `{ reason }`; correlationId: false; fired by the relay binary shutdown handler when `relayResult.stop()` rejects; the process still exits 0 after logging (graceful drain failed, not a fatal crash); added in DEPLOY-003; package: relay
- `relay.startup.ephemeral-key` — level: warn; context fields: `{ reason }`; correlationId: false; fired by the relay binary when `CELLO_DIRECTORY_PUBKEY` is absent in test mode (`NODE_ENV=test`); uses a random ephemeral public key for the directory authentication check; never fires in non-test environments (would exit 1 instead); added in DEPLOY-003; package: relay
- `relay.service.started` — level: info; context fields: `{ relayId, region, environment }`; correlationId: false; fired when relay service starts and signing key is loaded successfully; added in DEPLOY-003; package: relay
- `relay.service.stopped` — level: info; context fields: `{ relayId, region, environment, uptimeMs }`; correlationId: false; fired on clean SIGTERM shutdown; added in DEPLOY-003; package: relay
- `relay.service.start.failed` — level: error; context fields: `{ reason, region }`; correlationId: false; NO relayId field (key may not be loaded when this fires); fired when relay fails to start (key load failure, config error, port conflict); added in DEPLOY-003; package: relay
- `relay.service.crashed` — level: error; context fields: `{ relayId, region, reason }`; correlationId: false; fired on unexpected process exit; added in DEPLOY-003; package: relay
- `federation.checkpoint.round.error` — level: error; context fields: `{ nodeId, reason }`; correlationId: false; fired by `CheckpointCoordinator.#onTimer()` when `runRound()` or `#checkGap()` throws an unhandled exception; the interval keeps running after this event; added in FEDERATION-002; package: directory
- `federation.checkpoint.signature.node_id_mismatch` — level: warn; context fields: `{ checkpointId, addressedPeer, claimedNodeId, correlationId }`; fired when a peer's response carries a `nodeId` different from the node the proposal was addressed to — indicates transport routing error or compromised transport; the response is discarded and does not count toward threshold; added in FEDERATION-002; package: directory
- `federation.checkpoint.signature.missing_pubkey` — level: warn; context fields: `{ checkpointId, signingNodeId, correlationId }`; fired when a peer's `CheckpointSignatureResponse` lacks the `publicKeyHex` field needed for coordinator-side Ed25519 verification; the response is discarded without counting toward threshold; added in FEDERATION-002; package: directory
- `federation.checkpoint.signature.invalid` — level: warn; context fields: `{ checkpointId, signingNodeId, correlationId }`; fired when `verify(pubKey, hashBytes, sigBytes)` returns false for a peer's signature — indicates the peer signed a different message or the signature is forged; the response is discarded and does not count toward threshold; added in FEDERATION-002; package: directory
- `relay.registered` — level: info; context fields: `{ relayId, region }`; correlationId: false; fired by the relay binary after a successful first-time registration with the directory service via `/cello/directory-relay/1.0.0`; added in FEDERATION-003; package: relay
- `relay.already.registered` — level: info; context fields: `{ relayId, region }`; correlationId: false; fired by the relay binary when the directory responds `relay_register_ok` to a registration the relay has already performed (idempotent re-registration — same key); added in FEDERATION-003; package: relay
- `relay.registration.conflict` — level: error; context fields: `{ relayId, reason }`; correlationId: false; fired by the relay binary when the directory rejects registration with `RELAY_IDENTITY_CONFLICT` — a different public key is already registered for this `relayId`; the relay exits with code 1 after logging; added in FEDERATION-003; package: relay
- `relay.registration.failed` — level: warn; context fields: `{ reason, attempt }`; correlationId: false; fired by the relay binary on each failed registration attempt before retry (backoff); if all attempts are exhausted the relay exits with code 1; added in FEDERATION-003; package: relay
- `relay.predecessor.unknown` — level: warn; context fields: `{ relayId }`; correlationId: false; fired by `CelloRelayNode.#processHashSubmitLocked` when a `hash_submit` carries `predecessor_relay_id` but the directory adapter cannot find the predecessor's public key, or when the ACK signature does not verify — the submission is rejected with `RELAY_PREDECESSOR_UNKNOWN` in both cases (SI-002: no fallback); added in FEDERATION-003; package: relay
- `relay.pubkey.lookup.failed` — level: warn; context fields: `{ relayId, reason }`; correlationId: false; fired by `CelloClient.getRelayPublicKey()` when the signaling stream to the directory fails or the directory responds with `relay_pubkey_error`; added in FEDERATION-003; package: client

**Relay Registration** (FEDERATION-003)

- `relay.registered` — level: info; context fields: `{ relayId, region }`; correlationId: false; fired when a relay node successfully registers its Ed25519 public key with the directory at startup; emitted by `PgDirectoryStore.registerRelay()` after a new row is inserted into `relay_registrations`; added in FEDERATION-003; package: directory
- `relay.already.registered` — level: info; context fields: `{ relayId, region }`; correlationId: false; fired when a relay re-registers with the same key (idempotent restart) — the directory already has a matching row, so registration is a no-op; emitted by `PgDirectoryStore.registerRelay()` when `SELECT` returns a matching row; added in FEDERATION-003; package: directory
- `relay.registration.conflict` — level: error; context fields: `{ relayId, region }`; correlationId: false; fired when a relay attempts to register a `relayId` that is already registered with a DIFFERENT `public_key_hex` — indicates a key rotation attempt or a compromised identity; triggers the ops-critical alarm; `PgDirectoryStore.registerRelay()` throws `RELAY_IDENTITY_CONFLICT` after logging; added in FEDERATION-003; package: directory
- `relay.registration.failed` — level: warn; context fields: `{ reason, attempt }`; correlationId: false; fired by the relay binary when the directory is unreachable during startup registration; the relay retries on exponential backoff; the relay does NOT accept sessions until registration succeeds; added in FEDERATION-003; package: relay
- `relay.predecessor.unknown` — level: warn; context fields: `{ relayId, hashHex }`; correlationId: false; fired by `CelloRelayNode` when a hash re-submission carries a predecessor ACK whose `relayId` is not found in the directory, OR when the ACK signature fails verification — the relay rejects the re-submission with `RELAY_PREDECESSOR_UNKNOWN`; SI-002: no fallback to accepting unverified ACKs; added in FEDERATION-003; package: relay
- `relay.pubkey.lookup.failed` — level: warn; context fields: `{ relayId, reason }`; correlationId: false; fired by the client when the directory is unreachable while querying a relay's public key for ACK verification; ACK verification is deferred and the hash stays in the pending queue; added in FEDERATION-003; package: client
- `pending_notification.queued` — level: info; context fields: `{ notificationId, recipientAgentId, notificationType }`; correlationId: false; fired by `PgNotificationQueue.enqueue()` when a SEAL_UNILATERAL notification is written to `pending_notifications`; distinct from `notification.queued` (PERSIST-019, different table and field shape); added in PERSIST-023; package: directory
- `notification.delivered` — level: info; context fields: `{ notificationId, recipientAgentId, notificationType, deliveryLatencyMs }`; correlationId: false; fired by `PgNotificationQueue.acknowledge()` when a pending notification is delivered and acknowledged by the recipient; added in PERSIST-023; package: directory
- `notification.delivery.failed` — level: warn; context fields: `{ notificationId, recipientAgentId, reason }`; correlationId: false; fired by directory-node when stream send fails during `drainUndelivered` delivery to a reconnected agent; added in PERSIST-023; package: directory
- `pending_notification.enqueue.failed` — level: warn; context fields: `{ notificationId, recipientAgentId, reason }`; correlationId: false; fired by directory-node when `notificationQueue.enqueue()` rejects (DB persistence failure at write time); distinct from `notification.delivery.failed` (stream failure at delivery time); added in PERSIST-023; package: directory
- `account.created` — level: info; context fields: `{ accountId, correlationId }`; fired by `PgDirectoryStore.createAccount()` after the hash-chained INSERT into user_accounts commits successfully; `accountId` is the UUID of the new account; never includes phone_stub_hash or email_stub_hash (SI); added in ACCOUNT-001
- `account.phone_stub_hash.duplicate` — level: warn; context fields: `{ phoneStubHashPrefix, correlationId }`; fired by `PgDirectoryStore.createAccount()` on SQLSTATE 23505 unique constraint violation; `phoneStubHashPrefix` is the first 8 characters of the hash only (never the full hash); the caller's error is re-thrown after logging; added in ACCOUNT-001
- `account.agent.linked` — level: info; context fields: `{ accountId, agentId, correlationId }`; fired by `PgDirectoryStore.setProfile()` after the agent_profiles INSERT with a non-null account_id confirms success; `agentId` is the agent's k_local_pubkey; fires ONLY on the success branch — never before the INSERT attempt; added in ACCOUNT-001
- `account.agent.link.failed` — level: error; context fields: `{ accountId, agentId, reason, correlationId }`; fired by `PgDirectoryStore.setProfile()` when the agent_profiles INSERT fails with SQLSTATE 23503 (foreign key violation) because account_id does not exist in user_accounts; `agentId` is the agent's k_local_pubkey; `reason` is the DB error message; added in ACCOUNT-001
- `client.startup.prior.process.killed` — level: info (SIGTERM) / warn (SIGKILL); context fields: `{ priorPid, signal }`; correlationId: false; fired by the cello-mcp binary when a lock file exists with a valid PID, the process is running, and the startup code sends SIGTERM (default) or escalates to SIGKILL (after 5-second timeout); added in CELLO-M6B-001; package: adapter-claude-code
- `client.startup.lock.acquired` — level: info; context fields: `{ lockFilePath }`; correlationId: false; fired by `acquireLockFile()` after successfully writing the current process's PID to the lock file; `lockFilePath` is the absolute path to the lock file; signals that the cello-mcp process has exclusive ownership and can proceed with startup; added in CELLO-M6B-001; package: adapter-claude-code
- `client.startup.lock.released` — level: info; context fields: `{ pid }`; correlationId: false; fired by the cello-mcp binary shutdown handler when the lock file is removed successfully; idempotent (multiple calls to `releaseLockFile()` produce only one event); added in CELLO-M6B-001; package: adapter-claude-code
- `client.startup.lock.read.failed` — level: warn; context fields: `{ reason }`; correlationId: false; fired by `acquireLockFile()` when reading the existing lock file fails with an error other than ENOENT (e.g., permission denied); non-fatal — process continues with lock acquisition; added in CELLO-M6B-001; package: adapter-claude-code
- `client.startup.lock.eperm` — level: warn; context fields: `{ priorPid, reason }`; correlationId: false; fired by `acquireLockFile()` when checking a prior process (signal 0) fails with EPERM — indicates the process is owned by another user; treated as stale (SI-001 requirement); added in CELLO-M6B-001; package: adapter-claude-code
- `client.startup.lock.check.failed` — level: warn; context fields: `{ priorPid, reason }`; correlationId: false; fired by `acquireLockFile()` when checking a prior process (signal 0) fails with an unexpected error (not ESRCH or EPERM); treated as not running; added in CELLO-M6B-001; package: adapter-claude-code
- `client.startup.lock.write.failed` — level: warn; context fields: `{ reason }`; correlationId: false; fired by `acquireLockFile()` when writing the lock file fails; non-fatal — orphan detection is disabled but process continues; added in CELLO-M6B-001; package: adapter-claude-code
- `client.startup.prior.kill.failed` — level: warn; context fields: `{ priorPid, signal, reason }`; correlationId: false; fired by `acquireLockFile()` when killing a prior process fails (SIGTERM or SIGKILL); most likely a race condition where the process exited between check and kill; non-fatal; added in CELLO-M6B-001; package: adapter-claude-code
- `preauth.token.issued` — level: info; context fields: `{ tokenId, phoneStubHashPrefix, emailDomain, correlationId }`; fired by the internal API server after successfully inserting a token row; `phoneStubHashPrefix` is the first 8 hex characters of the hash only (never the full hash); correlationId is minted once per HTTP request; added in OPS-AGENT-001; package: directory
- `preauth.token.consumed` — level: info; context fields: `{ tokenId, agentId, correlationId }`; fired by the DKG Round 1 handler immediately after the atomic UPDATE sets consumed_at; `tokenId` is the database UUID; `agentId` is the agent's k_local_pubkey (truncated); correlationId is minted once per DKG flow; added in OPS-AGENT-001; package: directory
- `preauth.token.reuse.rejected` — level: warn; context fields: `{ tokenId, correlationId }`; fired when a token whose consumed_at is already set is presented in a DKG Round 1 frame; `tokenId` is the database UUID of the already-consumed row; added in OPS-AGENT-001; package: directory
- `preauth.token.expired` — level: warn; context fields: `{ tokenId, correlationId }`; fired when a token whose expires_at is in the past is presented in a DKG Round 1 frame; `tokenId` is the database UUID; added in OPS-AGENT-001; package: directory
- `preauth.token.missing` — level: warn; context fields: `{ remoteAgentId, correlationId }`; fired when the DKG Round 1 frame has no preAuthToken field or the field is empty; `remoteAgentId` is the agent's k_local_pubkey hex (truncated); added in OPS-AGENT-001; package: directory
- `preauth.token.not_found` — level: warn; context fields: `{ tokenPrefix, correlationId }`; fired when a token string is present in the frame but does not match any row in pre_authorization_tokens; `tokenPrefix` is the first 8 characters of the token (not the full token, to avoid logging sensitive values); distinct from `preauth.token.missing` (field present but DB lookup fails vs field absent); added in OPS-AGENT-001; package: directory
- `preauth.auth.failed` — level: warn; context fields: `{ remoteAddr, correlationId }`; fired by the internal API server when the x-cello-internal-api-key header is absent or does not match the configured key; `remoteAddr` is the caller's IP address; added in OPS-AGENT-001; package: directory
- `preauth.token.issue.failed` — level: error; context fields: `{ reason, correlationId }`; fired by the internal API server when token generation or the database INSERT fails after retries; `reason` is the error message; added in OPS-AGENT-001; package: directory
- `telegram.polling.started` — level: info; context fields: `{ botUsername }`; correlationId: false; fired by TelegramAdapter after a successful getMe response from the Telegram Bot API; botUsername is the bot's @-handle (never the token); added in OPS-AGENT-003; package: operations-agent
- `telegram.message.received` — level: debug; context fields: `{ fromId, messageLength, correlationId }`; message content is never logged — only length; correlationId is minted once per update; fired for each inbound text message from a Telegram user; added in OPS-AGENT-003; package: operations-agent
- `telegram.contact.verified` — level: info; context fields: `{ fromId, correlationId }`; fired when contact.user_id matches message.from.id (Telegram server-side verification of contact ownership); the resolved phone number is not logged (SI); added in OPS-AGENT-003; package: operations-agent
- `telegram.contact.mismatch` — level: warn; context fields: `{ fromId, contactUserId, correlationId }`; fired when contact.user_id does not match message.from.id (user shared someone else's contact); resolveIdentity returns phoneNumber=undefined; added in OPS-AGENT-003; package: operations-agent
- `telegram.poller.conflict` — level: error; context fields: `{ botUsername }`; correlationId: false; fired when getUpdates returns HTTP 409 Conflict — indicates another process instance is polling the same bot token; process exits with code 1 after logging; ECS restarts the task; added in OPS-AGENT-003; package: operations-agent
- `telegram.api.error` — level: warn; context fields: `{ method, errorCode, description, correlationId }`; fired when any Telegram Bot API call returns an error response or throws a network error; method is the API method name (getUpdates, sendMessage); errorCode is the HTTP status or errno code; added in OPS-AGENT-003; package: operations-agent
- `otp.delivery.sent` — level: info; context fields: `{ emailDomain, messageId, correlationId }`; fired by `SesOtpDeliveryProvider.sendOtp()` after SES returns a MessageId (acceptance, not inbox delivery); `emailDomain` is the domain portion of the recipient address only (full address never logged — SI-002); `messageId` is the SES MessageId string; added in OPS-AGENT-004; package: operations-agent
- `otp.delivery.retried` — level: info; context fields: `{ emailDomain, retryDelayMs, correlationId }`; fired by `SesOtpDeliveryProvider` after a ThrottlingException retry succeeds; `retryDelayMs` is 1000 (the fixed 1-second retry delay); fired only when the retry succeeds — not on retry failure (which emits `otp.delivery.failed` instead); added in OPS-AGENT-004; package: operations-agent
- `otp.delivery.failed` — level: error; context fields: `{ emailDomain, sesErrorType, correlationId }`; fired by `SesOtpDeliveryProvider` on hard bounce (`MessageRejected` → sesErrorType `'Bounce'`), retry exhaustion, or any other permanent SES failure; `sesErrorType` is the AWS SDK error name; full email address never included (SI-002); added in OPS-AGENT-004; package: operations-agent
- `ops_agent.started` — level: info; context fields: `{ version, region, migrationVersion }`; correlationId: false; fired by the composition root (`server.ts`) after all health checks pass and the RegistrationEngine has started; `version` is the npm package version; `region` is the AWS region from `AWS_DEFAULT_REGION`; `migrationVersion` is the highest Flyway migration version from `flyway_schema_history`; added in OPS-AGENT-005B; package: operations-agent
- `ops_agent.telegram.connected` — level: info; context fields: `{ botUsername }`; correlationId: false; fired by the composition root immediately after `ops_agent.started` when CELLO_ENV is not `local`; `botUsername` is the verified bot @-handle from the Telegram `getMe` response (not an env var); added in OPS-AGENT-005B; package: operations-agent
- `ops_agent.startup.failed` — level: error; context fields: `{ reason, component }`; correlationId: false; fired by the composition root when any startup check fails (missing config, health check failure, unhandled error in main()); `reason` is the human-readable failure description; `component` is the failing component name (e.g. `server`, `health-check`, `TelegramAdapter`); process exits with code 1 after logging; added in OPS-AGENT-005B; package: operations-agent
- `ops_agent.health_server.started` — level: info; context fields: `{ port }`; correlationId: false; fired by the composition root when the HTTP health check server begins listening; `port` is the listener port (8080); added in OPS-AGENT-005B; package: operations-agent
- `registration.preauth.request.failed` — level: error; context fields: `{ registrationId, httpStatus, correlationId }`; fired by the registration state machine (`state-machine.ts`) when `PreAuthorizationClient.requestToken()` throws; `registrationId` is the UUID of the in-flight registration record; `httpStatus` is 0 for network errors or the HTTP status code for server errors (from `PreAuthRequestError.httpStatus`); the record stays in EMAIL_CONFIRMED state so the user can retry; added in OPS-AGENT-005B; package: operations-agent
- `ops_agent.health_server.started` — level: info; context fields: `{ port }`; correlationId: false; fired by the composition root when the HTTP health check server begins listening; `port` is 8080; fired after `ops_agent.started`; added in OPS-AGENT-005B; package: operations-agent
- `ops_agent.shutting_down` — level: info; context fields: `{}`; correlationId: false; fired by the composition root's SIGTERM/SIGINT handler before stopping the engine, closing the health server, and draining the database pool; added in OPS-AGENT-005B; package: operations-agent
- `client.startup.progress` — level: info (ok) or warn (failed); context fields: `{ step, outcome, durationMs, reason? }`; correlationId: false; fired once per named startup step in cello-mcp after the step completes; `step` is one of `opening_database`, `fetching_directory_address`, `loading_agent_state`, `connecting_to_directory`, `ready`; `outcome` is `ok` or `failed`; `reason` is present when `outcome` is `failed`; emitted in addition to (not replacing) the human-readable stderr progress lines; added in M6-DX-001; package: adapter-claude-code
- `client.startup.multiaddr_parse.failed` — level: warn; context fields: `{ reason, multiaddr }`; correlationId: false; fired by cello-mcp when `CELLO_DIRECTORY_MULTIADDR` is set but lacks a `/p2p/<peer-id>` component; consequence: `setDirectoryEndpoint` is not called, `loadPersistedState()` reconstructs the FrostThresholdSigner with `directoryNodeStubs: undefined` — ceremonies will fail until the agent reconnects with a valid multiaddr; added in M6-DX-001; package: adapter-claude-code
- `client.bootstrap.fetch.failed` — level: warn; context fields: `{ directoryUrl, reason, durationMs }`; correlationId: false; fired when GET /bootstrap from the directory URL fails or times out during cello-mcp startup; the client continues without threshold signing (FROST bootstrap is skipped); added in M6-DX-001; package: adapter-claude-code
- `client.connection.request.stage.timeout` — level: warn; context fields: `{ stage, timeoutMs, targetPubkeyOrAgentId }`; correlationId: false; fired by `CelloClientImpl.cello_request_connection()` when a per-stage timeout fires; `stage` is one of `dial`, `send`, `wait`; `timeoutMs` is the configured timeout for that stage; `targetPubkeyOrAgentId` is the target's pubkey hex or agent_id; the MCP layer maps this to `directory_unreachable_timeout` (dial), `request_delivery_timeout` (send), or `target_response_timeout` (wait); added in M6-DX-001; package: client
- `client.directory.agent_lookup.failed` — level: warn; context fields: `{ agentId, endpoint, httpStatus, reason, durationMs }`; correlationId: false; fired by `mcp-server.ts` when GET /agent-lookup returns non-200 or a network error during agent_id resolution in `cello_request_connection` or `cello_initiate_session`; `httpStatus` is 0 for network errors; the tool returns `agent_not_found`; added in M6-DX-001; package: client
- `client.frost.share.loaded` — level: info; context fields: `{ agentPubkey, epochId, threshold, participants }`; correlationId: false; fired by `CelloClientImpl.loadPersistedState()` after `storeDkgResult()` and `FrostThresholdSigner` construction succeed; the signer's `directoryNodeStubs` are populated from `#directoryEndpoint` (non-undefined after AC-003 fix); signals that the agent can participate in FROST ceremonies without a new DKG run; added in PERSIST-024; directoryNodes fix in M6-DX-001; package: client
- `adapter.profiles.loaded` — level: info; context fields: `{ count }`; correlationId: false; fired by `PgDirectoryStore.loadProfiles()` at directory startup after reading all active `agent_profiles` rows into the in-memory `profilesByLocalKey` and `profilesByPrimaryKey` maps; `count` is the number of loaded profiles; ensures connection pre-checks succeed for agents registered before this directory instance started; added in F-011 hotfix; verified by M6-DX-001 AC-010; package: directory

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
