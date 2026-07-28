#!/usr/bin/env node
/**
 * CELLO Directory composition root (CELLO-NODE-004 / PERSIST-001 / DEPLOY-002)
 *
 * Adapter selection is driven by CELLO_ENV:
 *   local      — Docker Compose Postgres + all local stubs (no AWS)
 *   dev        — RDS + KMS + CloudWatch + EventBridge (real AWS, dev key)
 *   staging    — same as dev, reduced instance sizes
 *   production — full production AWS services
 *
 * The process exits with code 1 and logs adapter.config.missing if any
 * required configuration key is absent. It never starts with a silently
 * misconfigured adapter.
 *
 * Environment variables:
 *   CELLO_ENV                          — required: local | dev | staging | production
 *   DATABASE_URL                       — required for CELLO_ENV=local
 *   DEV_ENVELOPE_KEY                   — required for CELLO_ENV=local (64-char hex)
 *   AUDIT_LOG_PATH                     — required for CELLO_ENV=local; path to pgaudit log sink
 *   CELLO_AUDIT_BUCKET                 — required for CELLO_ENV=dev/staging/production; S3 bucket name
 *   CELLO_DIRECTORY_KEY_FILE           — path to persisted directory signing keypair
 *   CELLO_DIRECTORY_TRANSPORT_KEY_FILE — path to persisted libp2p transport key
 *   CELLO_DIRECTORY_LISTEN_ADDR        — libp2p listen address (default: /ip4/0.0.0.0/tcp/4000)
 *   CELLO_RELAY_MULTIADDR              — relay multiaddr (required)
 *   AWS_REGION                         — required for CELLO_ENV=dev/staging/production (default: us-east-1)
 *   NODE_ID                            — node identifier (default: AWS_REGION or "local")
 *   RDS_CREDENTIALS_SECRET_ARN         — required for CELLO_ENV=dev/staging/production; Secrets Manager ARN
 *   NODE_PRIVATE_KEY                   — required for CELLO_ENV=dev/staging/production; Ed25519 key hex
 *   KMS_KEY_ARN                        — future: KmsEnvelopeKeyProvider (not yet enforced; LocalEnvelopeKeyProvider used as placeholder)
 *   HEALTH_PORT                        — HTTP health check port (default: 9090)
 *   RELAY_MANIFEST_BUCKET              — required for CELLO_ENV=dev/staging/production; S3 bucket for relay pool manifest
 *   RELAY_MANIFEST_SIGNER_PUBKEY       — required for CELLO_ENV=dev/staging/production; Ed25519 public key hex of manifest signing node
 *   RELAY_MANIFEST_LOCAL_DIR           — optional for CELLO_ENV=local; local directory for manifest storage (defaults to /tmp/cello-relay-manifest)
 */
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { FileKeyProvider, InMemoryKeyProvider } from "@cello-protocol/crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createDirectoryNode, ClientDelegatedSigner } from "../directory-node.js";
import { NetworkRelayAdapter } from "../network-relay-adapter.js";
import { StdoutLogger, LocalEnvelopeKeyProvider, LocalClientStore, InMemoryRelayWal, LocalJobScheduler, LocalAuditLogShipper, InMemoryNotificationQueue, DevTokenValidator, DevNonceBinder } from "@cello-protocol/interfaces/stubs";
import type { AuditLogShipper, NotificationQueue, TokenValidator, NonceBinder, DirectoryKeyProvider } from "@cello-protocol/interfaces";
// S3AuditLogShipper is imported dynamically below to avoid loading @aws-sdk/client-s3
// in CELLO_ENV=local subprocesses where it causes tsx/esm resolution noise.
import { createInternalApiServer } from "../internal-api-server.js";
import { reconcileNodeOffline } from "../agent-presence-repository.js";
import { PgTokenValidator } from "../adapters/pg-token-validator.js";
import { PgNonceBinder } from "../adapters/pg-nonce-binder.js";
import { InMemoryShareStore } from "../share-store.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { EncryptedPgShareStore } from "../encrypted-share-store.js";
import { PersistentShareStore } from "../persistent-share-store.js";
import { MmrStore } from "../mmr-store.js";
import { MmrCheckpointService } from "../mmr-checkpoint-service.js";
import { AnalyticsJob } from "../analytics-job.js";
import { PendingConnectionRequestTtlSweep } from "../pending-connection-request-ttl-sweep.js";
import { createHealthServer } from "../health-server.js";
import { getRegistryDocument } from "../signal-write.js";
import { logServiceStarted, logServiceStopped, logServiceCrashed, logSecretsUnavailable } from "../service-lifecycle.js";
import { PgNotificationQueue } from "../adapters/pg-notification-queue.js";
import { RelayPoolManager } from "../relay-pool-manager.js";
import { CheckpointCoordinator } from "../checkpoint-coordinator.js";
import { Libp2pCheckpointTransport } from "../adapters/libp2p-checkpoint-transport.js";
import { InMemoryCheckpointTransport } from "@cello-protocol/interfaces/stubs";
import { resolvePoolMax } from "../pg-pool-config.js";
import type { ICheckpointTransport, CloudStorageProvider } from "@cello-protocol/interfaces";
import { LocalCloudStorageProvider } from "@cello-protocol/interfaces/stubs";
import { FileDirectoryManifestStore } from "../file-directory-manifest-store.js";
import { PgAeStore } from "../pg-ae-store.js";
import { resolveRelayManifestSigner } from "../relay-manifest-signer.js";

const env = process.env["CELLO_ENV"];
const logger = new StdoutLogger();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    logger.error("adapter.config.missing", { missingKey: key, env });
    process.exit(1);
  }
  return val;
}

const keyPath = process.env["CELLO_DIRECTORY_KEY_FILE"] ?? join(homedir(), ".cello", "directory-key");
const transportKeyPath = process.env["CELLO_DIRECTORY_TRANSPORT_KEY_FILE"] ?? join(homedir(), ".cello", "directory-transport-key");
const listenAddr = process.env["CELLO_DIRECTORY_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/4000";
// AC-007 (REPOSPLIT-001): WebSocket listen address for ALB path.
// Default: /ip4/0.0.0.0/tcp/8080/ws (port 8080 matches the ALB target group).
// Set CELLO_DIRECTORY_WS_LISTEN_ADDR="" to disable the WS listener.
const wsListenAddr = process.env["CELLO_DIRECTORY_WS_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/8080/ws";
// Finding 8 fix: validate CELLO_ENV before any env-dependent checks (relay addr, SSM, etc.)
// so an unrecognised value gets a clear error rather than a confusing AWS SDK error.
if (!env) {
  logger.error("adapter.config.missing", { missingKey: "CELLO_ENV", env: "(unset)" });
  process.exit(1);
}

if (env !== "local" && env !== "dev" && env !== "staging" && env !== "production") {
  logger.error("adapter.config.missing", { missingKey: "CELLO_ENV", env, reason: "unrecognised value" });
  process.exit(1);
}

// CELLO-M6B-019: CELLO_RELAY_MULTIADDR is only used for CELLO_ENV=local.
// For dev/staging/production, relay addressing comes from SSM node registry at startup.
const relayAddr = process.env["CELLO_RELAY_MULTIADDR"];
// AWS_REGION configures WHERE AWS SDK clients talk. It is not "where this node is", and reading it
// as such is what made a GCP node stamp us-east-1 on every log line and every directory_nodes row.
const awsRegion = process.env["AWS_REGION"] ?? "us-east-1";
// CELLO_REGION is the cloud-neutral answer. It falls back to AWS_REGION so existing AWS
// deployments are unchanged without touching their task definitions.
const nodeRegion = process.env["CELLO_REGION"] ?? process.env["AWS_REGION"] ?? (env === "local" ? "local" : "us-east-1");
// AC-007 (REPOSPLIT-001): health server moved to port 9090 so port 8080 is free for
// the libp2p WS listener. ALB target group health check updated to port 9090.
const healthPort = parseInt(process.env["HEALTH_PORT"] ?? "9090", 10);
const startedAt = Date.now();

// AC-010: CELLO_ENV=local requires CELLO_RELAY_MULTIADDR env var.
// dev/staging/production use SSM node registry (loaded later in "Relay setup" section).
if (env === "local" && !relayAddr) {
  logger.error("adapter.config.missing", { missingKey: "CELLO_RELAY_MULTIADDR", env });
  process.exit(1);
}

// ─── M12 DOD-ADAPTER-GCP-1: which cloud's adapters this node uses ─────────
// Covers the THREE families M12-D6 scopes: object storage, audit shipping, and the envelope key.
// NOT the RDS/Cloud SQL credential path — that is still AWS Secrets Manager and a GCP dev node
// cannot boot until DOD-NODE-DIR-GCP-1 wires Cloud SQL. Defaults to "aws" so every deployment keeps
// its current behavior with no env change; a GCP node sets CELLO_CLOUD=gcp. Validated fatally —
// a typo must not silently fall back to AWS adapters on a node with no AWS credentials, which
// would surface much later as opaque SDK timeouts.
// The raw value is read into a local first: DEPLOY-002 SI-002 forbids `process.env[...]` inside any
// logger call, because that shape is how a secret-bearing variable ends up in a log line. The rule is
// enforced on the syntax, not on which key it happens to be.
const cloudProviderRaw = process.env["CELLO_CLOUD"];
const cloudProvider = (cloudProviderRaw ?? "aws").toLowerCase();
if (cloudProvider !== "aws" && cloudProvider !== "gcp") {
  logger.error("adapter.config.invalid", {
    configKey: "CELLO_CLOUD",
    env,
    reason: `must be 'aws' or 'gcp'; got '${cloudProviderRaw}'`,
  });
  process.exit(1);
}

// NODE_ID is `<cloud>-<region>` (spec-of-record decision 7) and feeds Identifier.derive() — it IS
// the FROST participant identifier, not a label. Renaming it later is a decommission, so a node
// must never be born with a guessed one. The AWS default (bare region) is legacy back-compat for
// nodes already registered under it; any other cloud must state it, or refuse.
const nodeId = process.env["NODE_ID"] ?? (env === "local" ? "local" : cloudProvider === "aws" ? nodeRegion : "");
if (!nodeId) {
  logger.error("adapter.config.missing", {
    missingKey: "NODE_ID",
    env,
    cloud: cloudProvider,
    reason: "NODE_ID is the permanent FROST participant identifier and must be set explicitly as <cloud>-<region>; only the legacy AWS path may derive it from a region",
  });
  process.exit(1);
}

// ─── SECOPS-001: AuditLogShipper instantiation ───────────────────────────
// CELLO_ENV=local  → LocalAuditLogShipper (appends to AUDIT_LOG_PATH)
// CELLO_ENV=dev+   → S3AuditLogShipper (ships to CELLO_AUDIT_BUCKET in AWS_REGION)
//
// S3AuditLogShipper is imported dynamically so that @aws-sdk/client-s3 is never
// loaded in CELLO_ENV=local processes (avoids tsx/esm resolution issues in tests
// and keeps the local dev loop free of AWS SDK module load overhead).
//
// Must be instantiated before the database pool so that if required config is
// missing the process exits 1 with adapter.config.missing before any DB work.
const auditLogShipper: AuditLogShipper = await (async (): Promise<AuditLogShipper> => {
  if (env === "local") {
    const auditLogPath = requireEnv("AUDIT_LOG_PATH");
    const s = new LocalAuditLogShipper(auditLogPath, logger);
    logger.info("adapter.initialised", { adapterName: "AuditLogShipper", implementation: "LocalAuditLogShipper", env });
    return s;
  }
  // dev/staging/production: the cloud's object-store shipper (SECOPS-001).
  const auditBucket = requireEnv("CELLO_AUDIT_BUCKET");
  if (cloudProvider === "gcp") {
    // Lazy so the GCP SDK is never loaded on an AWS node (or in local mode) — M12-D5.
    const [{ GcsAuditLogShipper }, { Storage }] = await Promise.all([
      import("../adapters/gcs-audit-log-shipper.js"),
      import("@google-cloud/storage"),
    ]);
    const { IdempotencyStrategy } = await import("@google-cloud/storage");
    // RetryAlways: `File.save()` without preconditions sets maxRetries=0 AND mutates
    // `storage.retryOptions.autoRetry = false` on the SHARED client — so one upload would silently
    // disable retries for every later download on that instance. Opt in explicitly instead.
    const s = new GcsAuditLogShipper(auditBucket, logger, new Storage({ retryOptions: { idempotencyStrategy: IdempotencyStrategy.RetryAlways } }));
    logger.info("adapter.initialised", { adapterName: "AuditLogShipper", implementation: "GcsAuditLogShipper", env, bucket: auditBucket });
    return s;
  }
  const { S3AuditLogShipper } = await import("../adapters/s3-audit-log-shipper.js");
  const s = new S3AuditLogShipper(auditBucket, logger, undefined, { region: awsRegion });
  logger.info("adapter.initialised", { adapterName: "AuditLogShipper", implementation: "S3AuditLogShipper", env, bucket: auditBucket, region: awsRegion });
  return s;
})();

// ─── Adapter instantiation ────────────────────────────────────────────────

let pgPool: pg.Pool | undefined;

// CELLO-M6B-009 AC-001/AC-002/AC-003: PostgreSQL connection pool configuration.
// resolvePoolMax parses DIRECTORY_PG_POOL_MAX (default 50) and emits
// directory.pool.max.high WARN if the value exceeds 100.
const poolMax = resolvePoolMax(process.env, logger);

/**
 * Open the pool and load the profile cache, or die naming the cause.
 *
 * A pool is lazy: `new pg.Pool()` succeeds against a host that does not exist, so the first STATEMENT
 * is where an unreachable or misconfigured database surfaces. Every such failure must carry a CELLO
 * event — on a cloud VM an unhandled rejection is an unattributable crash in the serial console, and
 * this is the most likely first-boot failure against a freshly provisioned managed database.
 *
 * The connection string carries the password, so it is NEVER logged — only host, port and database
 * name, which are what an operator needs to tell "wrong host" from "wrong database" from "no route".
 */
/**
 * Postgres signals connection failures with SQLSTATE class 08, and node's socket layer with these
 * codes. Anything else from a query is the query's own fault, not the link's.
 */
function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return false;
  return code.startsWith("08") || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EHOSTUNREACH"].includes(code);
}

/**
 * Report an unreachable database and stop. The pool is closed first for a reason that is not
 * tidiness: StdoutLogger writes to stdout, which is ASYNCHRONOUS when stdout is a pipe — as it is
 * under Docker — so `process.exit` immediately after logging can discard the very line an operator
 * needs. Awaiting the pool teardown yields the event loop long enough for the write to drain.
 */
async function dieUnavailable(err: unknown, target: Record<string, string | undefined>): Promise<never> {
  logger.error("directory.db.unavailable", {
    ...target,
    nodeId,
    env,
    reason: err instanceof Error ? err.message : String(err),
  });
  await pgPool?.end().catch(() => { /* already broken; the cause is logged above */ });
  process.exit(1);
}

async function openStore(databaseUrl: string): Promise<PgDirectoryStore> {
  pgPool = new pg.Pool({ connectionString: databaseUrl, max: poolMax });
  let target: { host?: string; port?: string; database?: string } = {};
  try {
    const u = new URL(databaseUrl);
    target = { host: u.hostname, port: u.port || "5432", database: u.pathname.replace(/^\//, "") };
  } catch {
    // An unparsable URL is itself the fault; report what we can rather than masking the real error.
  }
  // 1. Connectivity. A pool is lazy, so this is the first statement that can prove the server is
  //    reachable and the database exists. Separating it from everything below is what lets the
  //    later failures name a SCHEMA cause instead of being reported as an outage.
  try {
    await pgPool.query("SELECT 1");
  } catch (err: unknown) {
    await dieUnavailable(err, target);
  }

  // 2. AC-010 schema version guard — BEFORE the first schema read. The store's profile cache selects
  //    from agent_profiles, so on an un-migrated database that read fails first and reports a
  //    missing relation, which is a symptom; "your migrations have not run" is the cause.
  //    Flyway runs in docker-entrypoint.sh ahead of this process; this is the safety net.
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
  const expectedVersion = readdirSync(migrationsDir).filter((f) => /^V\d+__.*\.sql$/.test(f)).length;
  let appliedVersion = 0;
  try {
    const result = await pgPool.query<{ max_rank: number | null }>(
      `SELECT MAX(installed_rank) AS max_rank FROM flyway_schema_history WHERE success = true`,
    );
    appliedVersion = result.rows[0]?.max_rank ?? 0;
  } catch (err) {
    // Two very different causes reach here. A connection-class failure (Postgres class 08, or a
    // socket error) means the server went away between the probe above and now — reporting that as
    // "migrations have not run" sends the operator to Flyway for a network problem.
    if (isConnectionError(err)) {
      await dieUnavailable(err, target);
    }
    // Otherwise: flyway_schema_history absent (never migrated) or cello_service lacks SELECT on it.
    logger.error("migration.version.query.failed", { reason: String(err), env });
    appliedVersion = 0;
  }
  if (appliedVersion < expectedVersion) {
    logger.error("migration.out.of.date", { currentVersion: appliedVersion, requiredVersion: expectedVersion, env });
    await pgPool.end();
    process.exit(1);
  }

  // 3. Schema is current — now the profile cache can be loaded.
  const s = new PgDirectoryStore(pgPool, logger, nodeId, nodeRegion);
  try {
    await s.loadProfiles();
  } catch (err: unknown) {
    await dieUnavailable(err, target);
  }
  logger.info("adapter.initialised", { adapterName: "PgDirectoryStore", implementation: "PgDirectoryStore", env, poolMax });
  return s;
}

const store = await (async () => {
  if (env === "local") {
    return openStore(requireEnv("DATABASE_URL"));
  }
  // M12 DOD-NODE-DIR-GCP-1: a GCP node's credentials come from Secret Manager, resolved by
  // docker-entrypoint.sh (see gcp-boot-env) so Flyway and this process share one fetch. By the
  // time we get here DATABASE_URL is either populated or the entrypoint already refused to start;
  // requireEnv makes that contract explicit rather than falling through to the AWS path, which
  // would fail much later as an opaque SDK timeout on a node holding no AWS credentials.
  if (cloudProvider === "gcp") {
    return openStore(requireEnv("DATABASE_URL"));
  }
  // dev/staging/production on AWS: PgDirectoryStore backed by RDS credentials from Secrets Manager
  const rdsSecretArn = requireEnv("RDS_CREDENTIALS_SECRET_ARN");
  let databaseUrl: string;
  try {
    // Dynamic import to avoid loading @aws-sdk in CELLO_ENV=local
    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const smClient = new SecretsManagerClient({ region: awsRegion });
    const resp = await smClient.send(new GetSecretValueCommand({ SecretId: rdsSecretArn }));
    if (!resp.SecretString) {
      throw new Error("SecretString is empty");
    }
    // RDS secret format: { username, password, host, port, dbname }
    const secret = JSON.parse(resp.SecretString) as {
      username: string; password: string; host: string; port: number; dbname: string;
    };
    // RDS uses AWS-managed certs (self-signed chain). Node's pg v8+ treats sslmode=require
    // as verify-full. Use no-verify: traffic is encrypted; cert chain is AWS-internal on VPC.
    databaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.dbname}?sslmode=no-verify`;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logSecretsUnavailable(logger, { nodeId, region: awsRegion, reason });
    process.exit(1);
  }
  return openStore(databaseUrl);
})();

// The AC-010 schema version guard runs inside openStore(), ahead of the first schema read —
// see step 2 there. It cannot live here: by this point the profile cache has already been loaded.

// ─── PERSIST-003: RLS startup check ─────────────────────────────────────────
// Verify that every append-only table has row-level security enabled.
// Logs db.rls.verified on success; logs db.rls.missing and exits 1 on any gap.
// This runs after the migration version guard so the tables are guaranteed to exist.
// DEPLOY-002: extended to all envs now that PgDirectoryStore is wired for dev/staging/production.
// Must match APPEND_ONLY_TABLES in src/__tests__/persist-003-rls.test.ts
if (pgPool) {
  const appendOnlyTables = [
    // agent_registrations removed — table dropped in V16; agent_profiles (V9) is the authoritative agent identity table
    "social_verifications", "social_verification_freshness_checks",
    "social_binding_releases", "device_bindings", "endorsements", "attestations",
    "bio_history", "pseudonym_bindings", "connection_requests", "conversation_seals",
    "conversation_attestations", "conversation_participation", "conversation_proof_leaves",
    "conversation_proof_mmr_nodes", "directory_checkpoints", "checkpoint_node_signatures",
    "arbitration_verdicts", "notification_events", "revocations", "tombstones",
    "social_proof_freezes", "anomaly_events", "recovery_contact_designations",
    "recovery_contact_members", "recovery_events", "recovery_vouches",
    "voucher_accountability_events", "voucher_lockouts", "trust_seeders", "seeder_vouches",
    "seeder_accountability_events", "seeder_lockouts", "key_rotation_log",
    "identity_migration_log", "agent_authorizations", "authorization_revocations",
    "authorization_violation_events", "contact_aliases", "contact_alias_retirements",
    "directory_listings", "group_rooms", "room_memberships",
  ] as const;

  const rlsResult = await pgPool.query<{ tablename: string; relrowsecurity: boolean }>(
    `SELECT c.relname AS tablename, c.relrowsecurity
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY($1)`,
    [appendOnlyTables as unknown as string[]],
  );

  const rlsMap = new Map(rlsResult.rows.map((r) => [r.tablename, r.relrowsecurity]));
  let rlsGap = false;

  for (const tableName of appendOnlyTables) {
    if (!rlsMap.get(tableName)) {
      logger.error("db.rls.missing", { tableName, env });
      rlsGap = true;
    }
  }

  if (rlsGap) {
    await pgPool.end();
    process.exit(1);
  }

  logger.info("db.rls.verified", { tableCount: appendOnlyTables.length, env });
}

// ─── PERSIST-017: MmrStore + MmrCheckpointService instantiation ─────────────
// mmrStore is hoisted so it can be passed to createDirectoryNode below.
// It is used for: startup recovery (DB-001), the mmr_checkpoint job handler,
// and appendSeal() calls inside CelloDirectoryNode's seal handlers.
let mmrStore: MmrStore | undefined;
let mmrCheckpointService: MmrCheckpointService | undefined;
if (pgPool) {
  mmrStore = new MmrStore(pgPool, logger);
  mmrCheckpointService = new MmrCheckpointService(mmrStore, pgPool, logger);
  logger.info("adapter.initialised", { adapterName: "MmrCheckpointService", implementation: "MmrCheckpointService", env });

  // DB-001: On startup, detect any partially-written checkpoints and re-run
  // confirmCheckpoint to complete them idempotently.
  const orphanedIds = await mmrStore.detectIncompleteCheckpoints(logger);
  await mmrCheckpointService.recoverOrphanedCheckpoints(orphanedIds);
}

// ─── PERSIST-005: EnvelopeKeyProvider + EncryptedPgShareStore ─────────────────
// EnvelopeKeyProvider encrypts K_server_X shares at rest before any DB INSERT.
// LocalEnvelopeKeyProvider uses AES-256-GCM with the key from DEV_ENVELOPE_KEY (CELLO_ENV=local).
// dev/staging/production: KMS_KEY_ARN provides the key ARN for KmsEnvelopeKeyProvider.
// For DEPLOY-002 we use LocalEnvelopeKeyProvider with DEV_ENVELOPE_KEY for dev/staging
// until the KmsEnvelopeKeyProvider is fully implemented in a follow-up story.
const envelopeKeyProvider = await (async (): Promise<import("@cello-protocol/interfaces").EnvelopeKeyProvider> => {
  if (env === "local") {
    const devKey = requireEnv("DEV_ENVELOPE_KEY");
    const p = new LocalEnvelopeKeyProvider(devKey, logger);
    logger.info("adapter.initialised", { adapterName: "EnvelopeKeyProvider", implementation: "LocalEnvelopeKeyProvider", env });
    return p;
  }
  // M12 DOD-ADAPTER-GCP-1: a GCP node wraps share material with Cloud KMS — the key never leaves
  // Google's HSM boundary. (AWS keeps the DEV_ENVELOPE_KEY placeholder until KMS_KEY_ARN is wired;
  // that is pre-existing debt on the AWS side, untouched here.)
  if (cloudProvider === "gcp") {
    const [{ KmsEnvelopeKeyProvider }, kms] = await Promise.all([
      import("../adapters/gcp-kms-envelope-key-provider.js"),
      import("@google-cloud/kms"),
    ]);
    const cfg = {
      projectId: requireEnv("CELLO_KMS_PROJECT"),
      locationId: requireEnv("CELLO_KMS_LOCATION"),
      keyRingId: requireEnv("CELLO_KMS_KEYRING"),
      cryptoKeyId: requireEnv("CELLO_KMS_KEY"),
    };
    const p = new KmsEnvelopeKeyProvider(cfg, new kms.KeyManagementServiceClient());
    logger.info("adapter.initialised", {
      adapterName: "EnvelopeKeyProvider", implementation: "KmsEnvelopeKeyProvider", env,
      project: cfg.projectId, location: cfg.locationId, keyRing: cfg.keyRingId, cryptoKey: cfg.cryptoKeyId,
    });
    return p;
  }
  // dev/staging/production on AWS: use DEV_ENVELOPE_KEY until KmsEnvelopeKeyProvider is wired
  const devKey = requireEnv("DEV_ENVELOPE_KEY");
  const p = new LocalEnvelopeKeyProvider(devKey, logger);
  logger.info("adapter.initialised", { adapterName: "EnvelopeKeyProvider", implementation: "LocalEnvelopeKeyProvider", env });
  return p;
})();

void new LocalClientStore(); // wired in PERSIST-003+
logger.info("adapter.initialised", { adapterName: "ClientStore", implementation: "LocalClientStore", env });

void new InMemoryRelayWal(); // wired in PERSIST-003+
logger.info("adapter.initialised", { adapterName: "RelayWal", implementation: "InMemoryRelayWal", env });

// ─── PERSIST-023: NotificationQueue instantiation ─────────────────────────────
// CELLO_ENV=local  → InMemoryNotificationQueue (M4 stub; notifications lost on restart)
// CELLO_ENV=dev+   → PgNotificationQueue (Postgres-backed; notifications survive restart)
//
// AC-007: CELLO_ENV=local MUST use InMemoryNotificationQueue (composition root assertion).
// AC-002: dev/staging/production use PgNotificationQueue so notifications survive restarts.
const notificationQueue: NotificationQueue = (() => {
  if (env === "local") {
    const q = new InMemoryNotificationQueue();
    logger.info("adapter.initialised", {
      adapterName: "NotificationQueue",
      implementation: "InMemoryNotificationQueue",
      env,
    });
    return q;
  }
  // dev/staging/production: PgNotificationQueue (PERSIST-023)
  // pgPool is guaranteed to be available for dev+ environments (see store instantiation above).
  if (!pgPool) {
    logger.error("adapter.config.missing", {
      missingKey: "DATABASE_URL",
      adapterName: "PgNotificationQueue",
      env,
    });
    process.exit(1);
  }
  const q = new PgNotificationQueue(pgPool, logger);
  logger.info("adapter.initialised", {
    adapterName: "NotificationQueue",
    implementation: "PgNotificationQueue",
    env,
  });
  return q;
})();

// ─── PERSIST-008: JobScheduler + AnalyticsJob wiring ─────────────────────────
// The scheduler dispatches "analytics" jobs on EventBridge (dev+) or in-process
// setTimeout (local). AnalyticsJob.run() is registered as the handler so both
// scheduler-triggered and CLI-triggered runs use identical logic.
const scheduler = new LocalJobScheduler();
logger.info("adapter.initialised", { adapterName: "JobScheduler", implementation: "LocalJobScheduler", env });

if (env === "local" && pgPool) {
  // Derive a cello_analytics read pool from DATABASE_URL (user swap — local only).
  const analyticsReadUrl = requireEnv("DATABASE_URL")
    .replace(/^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/, "$1://cello_analytics:cello_analytics_dev@");
  const analyticsReadPool = new pg.Pool({ connectionString: analyticsReadUrl });
  const analyticsJob = new AnalyticsJob(analyticsReadPool, pgPool, logger);

  scheduler.onJob("analytics", async (job) => {
    const { randomUUID } = await import("node:crypto");
    const runId = (job.payload as { runId?: string })?.runId ?? randomUUID();
    await analyticsJob.run(runId, "scheduler");
  });

  logger.info("adapter.initialised", { adapterName: "AnalyticsJob", triggeredBy: "scheduler", env });

  // ─── PERSIST-019: PendingConnectionRequestTtlSweep wiring ────────────────
  // Runs periodically to delete pending_connection_requests rows older than 24h.
  // Without this registration, expired requests accumulate in the queue forever.
  scheduler.onJob("pending_connection_requests_ttl", async (_job) => {
    await new PendingConnectionRequestTtlSweep(pgPool!, logger).run();
  });

  // Schedule the first TTL sweep run 5 minutes after startup.
  await scheduler.schedule("pending_connection_requests_ttl", Date.now() + 5 * 60 * 1000, { type: "pending_connection_requests_ttl" });

  logger.info("adapter.initialised", { adapterName: "PendingConnectionRequestTtlSweep", triggeredBy: "scheduler", env });

  // ─── PERSIST-017: mmr_checkpoint job handler ──────────────────────────────
  // Triggers MmrCheckpointService.runCheckpoint() for all staged seals.
  // Also checks for overdue staged seals and forces a flush.
  if (mmrCheckpointService) {
    scheduler.onJob("mmr_checkpoint", async () => {
      await mmrCheckpointService!.runCheckpoint();
      const overdueIds = await mmrCheckpointService!.checkOverdue();
      if (overdueIds.length > 0) {
        await mmrCheckpointService!.forceFlush(overdueIds);
      }
    });
    logger.info("adapter.initialised", { adapterName: "MmrCheckpointJob", triggeredBy: "scheduler", env });
  }
}

// ─── Key loading ──────────────────────────────────────────────────────────
// CELLO_ENV=local: load from key file (persisted across restarts)
// CELLO_ENV=dev/staging/production: load from NODE_PRIVATE_KEY env var (injected by ECS Secrets)

let kp: FileKeyProvider | InMemoryKeyProvider;
if (env === "local") {
  try {
    kp = await FileKeyProvider.load(keyPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("adapter.init.failed", { adapterName: "FileKeyProvider", reason: msg });
    process.exit(1);
  }
} else {
  // dev/staging/production: NODE_PRIVATE_KEY is injected by ECS Secrets (ValueFrom)
  const nodePrivateKeyHex = requireEnv("NODE_PRIVATE_KEY");
  try {
    const seed = Buffer.from(nodePrivateKeyHex, "hex");
    kp = new InMemoryKeyProvider(seed);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("adapter.init.failed", { adapterName: "InMemoryKeyProvider", reason: msg });
    process.exit(1);
  }
}

let transportPrivateKey: Uint8Array;
const transportKeyHex = process.env["CELLO_DIRECTORY_TRANSPORT_KEY_HEX"];
if (transportKeyHex && transportKeyHex !== "PLACEHOLDER_POPULATE_VIA_CLI") {
  // Production/dev/staging: transport key injected via Secrets Manager at ECS task launch.
  // This ensures the directory peer ID is stable across restarts and redeploys.
  transportPrivateKey = Buffer.from(transportKeyHex, "hex");
  logger.info("adapter.initialised", { adapterName: "TransportKey", implementation: "secrets_manager", env });
} else if (env !== "local") {
  // Non-local with missing/placeholder key — fail fast. Silently generating a random key
  // in ECS would produce an unstable peer ID, breaking all connected clients on every restart.
  logger.error("adapter.config.missing", { missingKey: "CELLO_DIRECTORY_TRANSPORT_KEY_HEX", env });
  process.exit(1);
} else {
  // Local: load from file or generate once and persist.
  try {
    transportPrivateKey = readFileSync(transportKeyPath);
  } catch {
    transportPrivateKey = randomBytes(32);
    mkdirSync(join(homedir(), ".cello"), { recursive: true });
    writeFileSync(transportKeyPath, transportPrivateKey, { mode: 0o600 });
    logger.info("adapter.initialised", { adapterName: "TransportKey", implementation: "generated", env });
  }
}

// ─── PERSIST-005: PersistentShareStore for K_server_X share persistence ───────
// Combines InMemoryShareStore (FROST ceremony operations) with EncryptedPgShareStore
// (encrypted PostgreSQL persistence). When shares are stored, they are:
//   1. Cached in memory for immediate FROST signing
//   2. Serialized to bytes and encrypted via EnvelopeKeyProvider
//   3. Persisted to agent_key_shares table
// If pgPool is unavailable (CELLO_ENV != local for M4), falls back to InMemoryShareStore only.
const shareStore = pgPool
  ? new PersistentShareStore(new EncryptedPgShareStore(pgPool, envelopeKeyProvider, logger), logger)
  : new InMemoryShareStore();

if (pgPool) {
  const { loaded, failed, failedIds } = await (shareStore as PersistentShareStore).loadShares();
  if (failed > 0) {
    logger.error("adapter.shares.load.fatal", { loaded, failed, failedIds, reason: "deserialization or decryption failure" });
    process.exit(1);
  }
  logger.info("adapter.initialised", { adapterName: "ShareStore", implementation: "PersistentShareStore", env, sharesLoaded: loaded });
} else {
  logger.info("adapter.initialised", { adapterName: "ShareStore", implementation: "InMemoryShareStore", env });
}

// ─── Relay setup (CELLO-M6B-019: SSM node registry) ─────────────────────────
// CELLO_ENV=local:                  Uses CELLO_RELAY_MULTIADDR env var (existing behavior)
// CELLO_ENV=dev/staging/production: Reads SSM node registry at startup
//
// Pseudocode:
//   if env === 'local':
//     parse relayAddr from env var
//     extract peerId from multiaddr
//     create NetworkRelayAdapter with that single address
//     log node.registry.loaded { source: 'env' }
//   else:
//     call GetParametersByPath(/cello/{env}/nodes/relay/)
//     parse JSON entries into NodeRegistryEntry[]
//     construct DNS multiaddrs
//     create NetworkRelayAdapter with first relay's multiaddr
//     pre-populate RelayPoolManager manifest entries
//     log node.registry.loaded { source: 'ssm' }

import { parseNodeRegistryEntries, buildBootstrapMultiaddr, type SsmParameter } from "../node-registry.js";

let relayPeerId: string = "";
let relayMultiaddrs: string[] = [];
let ssmRelayEntries: Array<{ relayId: string; peerId: string; multiaddr: string; hostname: string; region: string }> = [];

if (env === "local") {
  // AC-010: CELLO_ENV=local uses CELLO_RELAY_MULTIADDR env var
  const relayParts = relayAddr!.split("/");
  const p2pIndex = relayParts.findIndex((p) => p === "p2p");
  relayPeerId = p2pIndex !== -1 ? relayParts[p2pIndex + 1]! : "";

  if (!relayPeerId) {
    logger.error("adapter.config.missing", { missingKey: "CELLO_RELAY_MULTIADDR", env, reason: "must include /p2p/<peer-id>" });
    process.exit(1);
  }

  relayMultiaddrs = [relayAddr!];
  logger.info("node.registry.loaded", { relayCount: 1, directoryCount: 0, source: "env" });
} else if (cloudProvider === "gcp") {
  // M12-D6: a GCP node has NO Parameter-Store equivalent, and does not need one. Relay addressing
  // comes from the officer-signed relay manifest in GCS (RelayPoolManager, below) plus live
  // `relay_register` self-registration. Reaching for SSM here would fail on a node with no AWS
  // credentials and print AWS remediation advice for infrastructure that deliberately does not
  // exist — an error naming its exit point instead of its cause. This is a designed absence, so it
  // is logged as such and the boot continues.
  relayPeerId = "";
  relayMultiaddrs = [];
  logger.info("node.registry.skipped", {
    env,
    cloud: cloudProvider,
    reason: "no SSM node registry on GCP (M12-D6) — relay addressing comes from the signed relay manifest and relay_register",
  });
} else {
  // dev/staging/production on AWS: read SSM node registry
  // Dynamic import to avoid loading @aws-sdk in CELLO_ENV=local
  const { SSMClient, GetParametersByPathCommand } = await import("@aws-sdk/client-ssm");
  const ssmClient = new SSMClient({ region: awsRegion });

  const ssmPath = `/cello/${env}/nodes/`;
  const ssmParams: SsmParameter[] = [];
  // CRITICAL #2: track whether the SSM call itself threw (as opposed to returning 0 params).
  // When ssmThrew is false (SSM succeeded, possibly returning 0 params), we call
  // parseNodeRegistryEntries unconditionally so it can emit node.registry.empty with
  // actionable guidance when deploy.sh step 6.7 has not been run yet.
  let ssmThrew = false;

  try {
    let nextToken: string | undefined;
    do {
      const cmd = new GetParametersByPathCommand({
        Path: ssmPath,
        Recursive: true,
        NextToken: nextToken,
      });
      const resp = await ssmClient.send(cmd);
      if (resp.Parameters) {
        for (const p of resp.Parameters) {
          if (p.Name && p.Value) {
            ssmParams.push({ Name: p.Name, Value: p.Value });
          }
        }
      }
      nextToken = resp.NextToken;
    } while (nextToken);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    // SSM call failed entirely (auth error, network error, etc.) — emit the error event
    // directly here rather than delegating to parseNodeRegistryEntries, because we want
    // distinct guidance text for an AWS API failure vs. a successful but empty response.
    logger.error("node.registry.empty", {
      ssmPath,
      region: awsRegion,
      guidance: `Failed to read SSM node registry: ${reason}. Check IAM permissions and run deploy.sh.`,
    });
    relayPeerId = "";
    relayMultiaddrs = [];
    // Start but relay will be unavailable — DB-001 degraded behavior
    ssmThrew = true;
  }

  // CRITICAL #2 fix: call parseNodeRegistryEntries unconditionally when the SSM call
  // succeeded (even when it returned zero parameters). An empty successful response means
  // deploy.sh step 6.7 has not run yet — parseNodeRegistryEntries handles this case and
  // emits node.registry.empty with actionable guidance.
  // When ssmThrew is true, we already emitted node.registry.empty above — skip to avoid
  // double-emit and because ssmParams is empty by definition.
  if (!ssmThrew) {
    const registryResult = parseNodeRegistryEntries(ssmParams, ssmPath, awsRegion, logger);

    if (registryResult.relays.length > 0) {
      // Use the first relay as the primary dial target for NetworkRelayAdapter
      const primaryRelay = registryResult.relays[0]!;
      relayPeerId = primaryRelay.peerId;
      relayMultiaddrs = registryResult.relays.map(r => r.multiaddr);

      // Store for RelayPoolManager seeding below.
      // Finding 2 fix: use r.nodeId (Ed25519 pubkey hex) as relayId so it matches
      // the relayId sent in relay_register frames. r.nodeId is empty string for
      // older SSM entries that predate the nodeId field — fall back to hostname-derived
      // label only in that case (backward-compat).
      ssmRelayEntries = registryResult.relays.map(r => ({
        relayId: r.nodeId || r.hostname.split(".")[0]!, // nodeId = Ed25519 pubkey hex (matches relay_register)
        peerId: r.peerId,
        multiaddr: r.multiaddr,
        hostname: r.hostname,
        region: r.region,
      }));
    } else {
      // DB-001: No relay entries — start but relay_unavailable on every session request
      relayPeerId = "";
      relayMultiaddrs = [];
    }
  }
}

const networkRelay = new NetworkRelayAdapter({
  keyProvider: kp,
  relayPeerId,
  relayMultiaddrs,
  logger,
});

const dirPubkey = await kp.getPublicKey();
logger.info("adapter.initialised", { adapterName: "DirectoryNode", implementation: "CelloDirectoryNode", env, pubkey: Buffer.from(dirPubkey).toString("hex") });

// ─── CELLO-RELAY-001: RelayPoolManager instantiation ─────────────────────────
// CELLO_ENV=local  → LocalCloudStorageProvider (filesystem-backed, no AWS)
//                    Manifest must be manually placed at RELAY_MANIFEST_LOCAL_DIR/relay-manifest.json
//                    If no manifest file exists, RelayPoolManager is not wired (backward compat)
// CELLO_ENV=dev+   → S3CloudStorageProvider backed by cello-relay-manifest-{env}-{region}
//                    RELAY_MANIFEST_BUCKET and RELAY_MANIFEST_SIGNER_PUBKEY are required
//
// AC-002: If manifest signature verification fails, the process exits 1.
// The RelayPoolManager is optional; if absent, the hardcoded relayEndpoint is used.
let relayPoolManager: RelayPoolManager | undefined;
relayPoolManager = await (async (): Promise<RelayPoolManager | undefined> => {
  let storage: CloudStorageProvider;

  // M6B-008: validate poll interval early — fail fast before expensive operations
  if (env !== "local") {
    const rawPollInterval = process.env["RELAY_MANIFEST_POLL_INTERVAL_MS"];
    const pollIntervalMs = rawPollInterval ? parseInt(rawPollInterval, 10) : 120_000;
    if (isNaN(pollIntervalMs) || pollIntervalMs < 60_000) {
      logger.error("adapter.config.missing", {
        missingKey: "RELAY_MANIFEST_POLL_INTERVAL_MS",
        value: rawPollInterval,
        reason: "must be a positive integer >= 60000 (1 minute minimum)",
      });
      process.exit(1);
    }
  }

  if (env === "local") {
    const manifestDir = process.env["RELAY_MANIFEST_LOCAL_DIR"] ?? "/tmp/cello-relay-manifest";
    const signerPubkeyHex = process.env["RELAY_MANIFEST_SIGNER_PUBKEY"] ?? "";
    if (!signerPubkeyHex) {
      // No signer pubkey configured — skip relay pool manager in local mode (backward compat)
      logger.info("adapter.initialised", { adapterName: "RelayPoolManager", implementation: "skipped", reason: "RELAY_MANIFEST_SIGNER_PUBKEY not set", env });
      return undefined;
    }
    storage = new LocalCloudStorageProvider(manifestDir);
    logger.info("adapter.initialised", { adapterName: "RelayPoolManager", implementation: "LocalCloudStorageProvider", env, manifestDir });
    const mgr = new RelayPoolManager({ storage, signerPublicKeyHex: signerPubkeyHex, logger });
    try {
      await mgr.loadManifest();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // In local mode, manifest load failure is non-fatal — fall back to hardcoded relay
      logger.error("relay.manifest.load.failed", { reason: msg, attempt: 5, env });
      mgr.stop();
      return undefined;
    }
    return mgr;
  }

  // dev/staging/production: object-store-backed manifest (required)
  const manifestBucket = requireEnv("RELAY_MANIFEST_BUCKET");
  // The signer is this node's own key unless configured otherwise — see relay-manifest-signer for
  // why that derivation can only cause refusal, never acceptance.
  const signer = resolveRelayManifestSigner(
    process.env["RELAY_MANIFEST_SIGNER_PUBKEY"],
    Buffer.from(dirPubkey).toString("hex"),
    logger,
  );
  const signerPubkeyHex = signer.pubkeyHex;
  if (cloudProvider === "gcp") {
    const [{ GcsCloudStorageProvider }, { Storage }] = await Promise.all([
      import("../adapters/gcs-cloud-storage-provider.js"),
      import("@google-cloud/storage"),
    ]);
    const { IdempotencyStrategy } = await import("@google-cloud/storage");
    // RetryAlways — see the audit-shipper note: a default-mode save() turns off auto-retry on the
    // shared client, which would strip retries from the 120s manifest poll loop.
    storage = new GcsCloudStorageProvider(manifestBucket, new Storage({ retryOptions: { idempotencyStrategy: IdempotencyStrategy.RetryAlways } }));
    logger.info("adapter.initialised", { adapterName: "RelayPoolManager", implementation: "GcsCloudStorageProvider", env, bucket: manifestBucket });
  } else {
    const { S3CloudStorageProvider } = await import("../adapters/s3-cloud-storage-provider.js");
    storage = new S3CloudStorageProvider(manifestBucket, awsRegion);
    logger.info("adapter.initialised", { adapterName: "RelayPoolManager", implementation: "S3CloudStorageProvider", env, bucket: manifestBucket, region: awsRegion });
  }

  const mgr = new RelayPoolManager({ storage, signerPublicKeyHex: signerPubkeyHex, logger });
  try {
    await mgr.loadManifest();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("manifest not found")) {
      // FEDERATION-E2E-001: secondary regions may not have a manifest yet.
      // RelayPoolManager is non-operational; session assignments will use the
      // SSM-derived relay addresses from relayEndpoint directly.
      logger.info("relay.manifest.not_found", { env, reason: "no manifest published yet" });
      mgr.stop();
      return undefined;
    }
    // Corrupt, invalid signature, or persistent network error is still fatal
    logger.error("relay.manifest.load.failed", { reason: msg, attempt: 5, env });
    process.exit(1);
  }

  // M6B-008: start manifest poll loop
  // This code only runs when env !== "local" (checked earlier),
  // so the poll loop is automatically disabled in local mode.
  // Poll interval was already validated at function entry.
  const rawPollInterval = process.env["RELAY_MANIFEST_POLL_INTERVAL_MS"];
  const pollIntervalMs = rawPollInterval ? parseInt(rawPollInterval, 10) : 120_000;
  mgr.startPolling(pollIntervalMs);

  return mgr;
})();

// ─── CELLO-M6B-019: Pre-populate RelayPoolManager with SSM entries ───────────
// AC-004: pickRelay() works immediately after startup, before any relay_register.
// AC-006: relay_register only updates healthCheckUrl — multiaddrs/peerId from SSM are preserved.
if (relayPoolManager && ssmRelayEntries.length > 0) {
  relayPoolManager.seedRelayEntries(
    ssmRelayEntries.map(entry => ({
      relayId: entry.relayId,
      endpoint: `wss://${entry.hostname}`,
      region: entry.region,
      status: "active" as const,
      healthCheckUrl: "", // Populated by relay_register later (VPC health checks only)
      peerId: entry.peerId,
      multiaddrs: [entry.multiaddr],
    })),
  );
  logger.info("adapter.initialised", {
    adapterName: "RelayPoolManager",
    implementation: "ssm_seeded",
    env,
    relayCount: ssmRelayEntries.length,
  });
}

// ─── FEDERATION-E2E-001: CheckpointTransport instantiation ───────────────────
// CELLO_ENV=local  → InMemoryCheckpointTransport (no peers, no signing)
// CELLO_ENV=dev+   → Libp2pCheckpointTransport backed by CHECKPOINT_PEER_ADDRS
//
// CHECKPOINT_PEER_ADDRS format: "nodeId1=libp2pPeerId1,nodeId2=libp2pPeerId2"
// Example: "eu-central-1=12D3KooW...,ap-northeast-1=12D3KooW..."
// The libp2p Peer IDs are the stable transport peer IDs of the peer directory nodes
// (derived from their persisted transport keys). Find them in infra/STATE.md under
// each region's directory node description or in CloudWatch logs at startup.
//
// In dev/staging/production, if CHECKPOINT_PEER_ADDRS is not set, CheckpointCoordinator
// is started with no peers — it can still run rounds but will not achieve threshold.

let checkpointTransport: ICheckpointTransport;
if (env === "local") {
  checkpointTransport = new InMemoryCheckpointTransport();
  logger.info("adapter.initialised", { adapterName: "CheckpointTransport", implementation: "InMemoryCheckpointTransport", env });
} else {
  // Parse CHECKPOINT_PEER_ADDRS: "eu-central-1=12D3KooW...,ap-northeast-1=12D3KooW..."
  const peerAddrsRaw = process.env["CHECKPOINT_PEER_ADDRS"] ?? "";
  const peers = new Map<string, string>();
  if (peerAddrsRaw) {
    for (const pair of peerAddrsRaw.split(",")) {
      const [nodeIdPart, libp2pPeerIdPart] = pair.split("=");
      if (nodeIdPart && libp2pPeerIdPart) {
        peers.set(nodeIdPart.trim(), libp2pPeerIdPart.trim());
      }
    }
  }
  // Transport is instantiated here but the libp2p node isn't started yet.
  // The transport receives the node reference after createDirectoryNode().
  // We use a placeholder and swap it in after node creation.
  checkpointTransport = new InMemoryCheckpointTransport(
    [...peers.keys()],
  );
  logger.info("adapter.initialised", {
    adapterName: "CheckpointTransport",
    implementation: "Libp2pCheckpointTransport",
    env,
    peerCount: peers.size,
  });
}

// ─── OPS-AGENT-001: TokenValidator + Internal API server ─────────────────────
// CELLO_ENV=local  → DevTokenValidator (accepts any 'DEV-' prefix token; no DB)
// CELLO_ENV=dev+   → PgTokenValidator (Postgres-backed, atomic consumption)
//
// INTERNAL_API_KEY is required in dev/staging/production.
// In local mode, if INTERNAL_API_KEY is set, the internal API server is started.
// If not set in local mode, internal API server is skipped (backward compat).
//
// OPS-AGENT-001 AC-001: POST /internal/pre-authorize is served by createInternalApiServer.
// OPS-AGENT-001 AC-006: TokenValidator is passed to createDirectoryNode so DKG Round 1
//                       consumes the token as the FIRST operation before any FROST crypto.

const tokenValidator: TokenValidator = (() => {
  if (env === "local") {
    const v = new DevTokenValidator();
    logger.info("adapter.initialised", { adapterName: "TokenValidator", implementation: "DevTokenValidator", env });
    return v;
  }
  // dev/staging/production: PgTokenValidator backed by pre_authorization_tokens table
  if (!pgPool) {
    logger.error("adapter.config.missing", {
      missingKey: "DATABASE_URL",
      adapterName: "PgTokenValidator",
      env,
    });
    process.exit(1);
  }
  const v = new PgTokenValidator(pgPool);
  logger.info("adapter.initialised", { adapterName: "TokenValidator", implementation: "PgTokenValidator", env });
  return v;
})();

// ─── M8B-PREAUTH-CAP: capability issuer pubkey + local nonce binder ───────────
// When CELLO_PREAUTH_ISSUER_PUBKEY is set, DKG Round 1 verifies a signed pre-auth capability against it
// (stateless) and binds the nonce LOCALLY (replaces the token validate/consume gate — see the design
// doc + V40). local → DevNonceBinder (in-memory); dev+ → PgNonceBinder over pre_auth_nonce_bindings.
const capabilityIssuerPubkey = process.env["CELLO_PREAUTH_ISSUER_PUBKEY"];
const nonceBinder: NonceBinder | undefined = capabilityIssuerPubkey
  ? (() => {
      if (env === "local") {
        logger.info("adapter.initialised", { adapterName: "NonceBinder", implementation: "DevNonceBinder", env });
        return new DevNonceBinder();
      }
      if (!pgPool) {
        logger.error("adapter.config.missing", { missingKey: "DATABASE_URL", adapterName: "PgNonceBinder", env });
        process.exit(1);
      }
      logger.info("adapter.initialised", { adapterName: "NonceBinder", implementation: "PgNonceBinder", env });
      return new PgNonceBinder(pgPool);
    })()
  : undefined;
if (capabilityIssuerPubkey) {
  logger.info("directory.auth.capability.enabled", { issuerPubkeyPrefix: capabilityIssuerPubkey.slice(0, 8) });
}

// M8B-PREAUTH-CAP: issuer SIGNING key for /internal/pre-authorize (used on the node the ops-agent calls
// — us1 in practice; harmless elsewhere). One issuer identity, same key across regions (NOT a per-region
// transport key); its public half is CELLO_PREAUTH_ISSUER_PUBKEY, pinned above for verification.
const issuerKeySeedHex = process.env["CELLO_PREAUTH_ISSUER_KEY_HEX"];
const issuerKeyProvider = issuerKeySeedHex
  ? new InMemoryKeyProvider(Uint8Array.from(Buffer.from(issuerKeySeedHex, "hex")))
  : undefined;

// Internal API server: POST /internal/pre-authorize
// Required env: INTERNAL_API_KEY (any non-empty string used as the bearer key)
// Local: optional (skip if INTERNAL_API_KEY not set; backward compat for existing tests)
// Dev/staging/production: required
const internalApiKey = process.env["INTERNAL_API_KEY"];
const internalApiPort = parseInt(process.env["INTERNAL_API_PORT"] ?? "8081", 10);

if (!internalApiKey && env !== "local") {
  logger.error("adapter.config.missing", { missingKey: "INTERNAL_API_KEY", env });
  process.exit(1);
}

if (internalApiKey && pgPool) {
  const internalApiServer = createInternalApiServer({
    pool: pgPool,
    internalApiKey,
    logger,
    owningNodeId: nodeId,
    issuerKeyProvider,
  });
  internalApiServer.listen(internalApiPort, () => {
    logger.info("adapter.initialised", {
      adapterName: "InternalApiServer",
      implementation: "http",
      env,
      port: internalApiPort,
    });
  });
}

// ─── Node startup ─────────────────────────────────────────────────────────

// M7 J-AUTH (DOD-AUTH-1 / MANIFEST-002 step 5): when this node's per-node Ed25519
// signing key is configured, sign the step-5 challenge so authenticating clients can
// verify the directory's identity against the consortium manifest (step 6). The seed
// is the 32-byte Ed25519 private key (64 hex); its public key must be the `pubkey` for
// this `nodeId` in the manifest the client trusts. When unset, the directory sends
// signaling_auth_ok without MANIFEST-002 fields (M6 backward-compat).
const nodeKeyHex = process.env["CELLO_DIRECTORY_NODE_KEY_HEX"];
let directoryKeyProvider: DirectoryKeyProvider | undefined;
if (nodeKeyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(nodeKeyHex)) {
    logger.error("directory.node_key.invalid", { nodeId, reason: "expected 64-hex Ed25519 seed" });
    process.exit(1);
  }
  const nodeSeed = Buffer.from(nodeKeyHex, "hex");
  directoryKeyProvider = {
    getNodeId: () => nodeId,
    sign: (tbsBytes: Uint8Array): Promise<Uint8Array> => Promise.resolve(ed25519.sign(tbsBytes, nodeSeed)),
  };
  logger.info("directory.node_key.configured", { nodeId });
}

// M7-MANIFEST-002 / DOD-AUTH-2 / M12 §1b: when a consortium manifest is deployed beside the
// directory, serve it to clients that poll (manifest_poll_request → manifest_poll_response)
// AND — M12 — verify it at load: the manifest is the anti-entropy channel's trust anchor
// (pinned node pubkeys + peerIds), so the directory itself must refuse an unsigned/tampered/
// duplicated/rolled-back manifest. The officer trust anchor is pinned via env (same names as
// the client daemon): CELLO_CONSORTIUM_ROOT_KEYS (comma-separated hex) +
// CELLO_CONSORTIUM_THRESHOLD. A manifest path WITHOUT the anchor is a fail-loud
// misconfiguration — there is no unverified fallback (§1c: fail closed, always).
const consortiumManifestPath = process.env["CELLO_DIRECTORY_CONSORTIUM_MANIFEST"];
// M12: AE dial-loop period. Validated HERE, once, and fatally — an unparseable or tiny value
// would reach setInterval as NaN/0, which clamps to ~1ms: a silent busy loop that re-reads and
// re-verifies the manifest from disk on every tick (and, once peerIds exist, a dial storm against
// peer nodes) with no log output at all. Fail loud at boot instead, matching the env-config
// pattern above. Unset → the service default (60s).
const aeIntervalRaw = process.env["CELLO_AE_INTERVAL_MS"];
let aeIntervalMs: number | undefined;
if (aeIntervalRaw !== undefined && aeIntervalRaw !== "") {
  const parsed = Number(aeIntervalRaw);
  // The ceiling is NOT cosmetic: Node coerces any setInterval delay above 2^31-1 to **1 ms**, so a
  // plausible-looking "30 days" (2592000000) would produce the exact ~1ms busy loop this guard
  // exists to prevent — re-reading + re-verifying the manifest every tick and, once peerIds are
  // pinned, a dial storm against every peer. Bound both ends.
  const MAX_INTERVAL_MS = 2_147_483_647; // Node's setInterval ceiling (2^31-1)
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > MAX_INTERVAL_MS) {
    logger.error("adapter.config.invalid", {
      configKey: "CELLO_AE_INTERVAL_MS",
      env,
      reason: `must be an integer between 1000 and ${MAX_INTERVAL_MS} (ms); got '${aeIntervalRaw}'. Outside that range setInterval clamps to ~1ms — a silent busy loop.`,
    });
    process.exit(1);
  }
  aeIntervalMs = parsed;
}

let directoryManifestStore: FileDirectoryManifestStore | undefined;
if (consortiumManifestPath) {
  const rootKeysRaw = process.env["CELLO_CONSORTIUM_ROOT_KEYS"] ?? "";
  const rootKeys = rootKeysRaw.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
  const threshold = Number.parseInt(process.env["CELLO_CONSORTIUM_THRESHOLD"] ?? "", 10);
  if (rootKeys.length === 0 || Number.isNaN(threshold) || threshold < 1) {
    logger.error("adapter.config.missing", {
      missingKey: "CELLO_CONSORTIUM_ROOT_KEYS / CELLO_CONSORTIUM_THRESHOLD",
      env,
      reason: "CELLO_DIRECTORY_CONSORTIUM_MANIFEST is set, so the officer trust anchor is required (M12 §1b — the directory verifies its manifest; no unverified fallback)",
    });
    process.exit(1);
  }
  try {
    directoryManifestStore = new FileDirectoryManifestStore(consortiumManifestPath, logger, { rootKeys, threshold });
  } catch (err: unknown) {
    logger.error("directory.manifest.store.load.failed", {
      path: consortiumManifestPath,
      reason: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

let result: Awaited<ReturnType<typeof createDirectoryNode>>;
try {
  // AC-007 (REPOSPLIT-001): include the WS listen address so the directory
  // is reachable from outside the VPC through the ALB on port 80/ws.
  const listenAddresses = wsListenAddr
    ? [listenAddr, wsListenAddr]
    : [listenAddr];

  result = await createDirectoryNode({
    keyProvider: kp,
    // Cross-node presence fix: pass the REGION node id ("us-east-1", = awsRegion) so #recordPresence
    // records owning_node_id as the region (manifest-resolvable by clients + matches directory_nodes)
    // rather than defaulting to the libp2p peer id. Without this, discovery/presence read every agent
    // as dark/offline (the freshness JOIN on directory_nodes.node_id never matches a peer id).
    //
    // BLAST RADIUS (this repoints frostHandler.nodeId, not just presence — verified safe, region IS
    // the intended value everywhere; the peer-id default was the latent bug):
    //   • agent_presence.owning_node_id + the heartbeat's directory_nodes row (the fix's target)
    //   • sessions.owning_node_id (writeSessionWithParticipants) — region matches the manifest, more correct
    //   • the checkpoint commit-response nodeId label (was WRONGLY the peer id; the CheckpointCoordinator
    //     + MANIFEST-002 signing already used the region — this aligns them)
    //   • the FROST participant identifier is derived ONCE at DKG time and PERSISTED in the share; signing
    //     reads it from the stored share, never re-derives from nodeId → NO migration trap for existing agents.
    // (IaC sets NODE_ID = AWS::Region, unique per region — so nodeId is always a valid manifest node id.)
    nodeId,
    listenAddresses,
    relay: networkRelay,
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    store,
    shareStore,
    transportPrivateKey,
    mmrStore,
    notificationQueue,
    relayPoolManager,
    checkpointTransport,
    tokenValidator,
    capabilityIssuerPubkey,
    nonceBinder,
    directoryKeyProvider,
    directoryManifestStore,
    // M12 DOD-AE-APPEND-1/MUTABLE-1: anti-entropy sync. Enabled whenever the three trust legs
    // exist: the VERIFIED manifest (§1b store — the trust anchor AND the enablement switch: a
    // pre-M12 manifest has no peerIds, so the dial loop no-ops and inbound handshakes fail closed
    // until the manifest rotation lands), the node signing key, and the pg store. No env flag —
    // the signed manifest controls the rollout.
    aeSync: directoryManifestStore && directoryKeyProvider && pgPool
      ? {
          identity: { nodeId, sign: (tbs: Uint8Array) => directoryKeyProvider.sign(tbs) },
          store: new PgAeStore(pgPool),
          manifest: () => directoryManifestStore.getVerifiedManifest(),
          intervalMs: aeIntervalMs,
        }
      : undefined,
    pgPool: pgPool ?? undefined,
    // Deployment tunable: the delivery-grace window before a unilateral seal is
    // accepted (default 600s in CelloDirectoryNode). Lets test/dev shrink it.
    deliveryGraceSeconds: process.env.CELLO_DELIVERY_GRACE_SECONDS
      ? Number(process.env.CELLO_DELIVERY_GRACE_SECONDS)
      : undefined,
    logger,
  });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error("adapter.init.failed", { adapterName: "CelloDirectoryNode", reason: msg });
  process.exit(1);
}

// Restore ClientDelegatedSigners for all profiles loaded from DB at startup.
// Without this, agents that registered before this directory instance started
// cannot initiate sessions (frost_signer_not_configured).
if (store instanceof PgDirectoryStore) {
  const loadedProfiles = store.getAllLoadedProfiles();
  for (const profile of loadedProfiles) {
    const primaryPubkeyBytes = Buffer.from(profile.primary_pubkey, "hex");
    const delegatedSigner = new ClientDelegatedSigner(profile.k_local_pubkey, new Uint8Array(primaryPubkeyBytes));
    // The signer starts with #streams = null. The directory calls setStreams with
    // the live streams map when the agent authenticates on the signaling channel
    // (directory-node.ts auth handler). Until then, ceremony calls return
    // DIRECTORY_BELOW_THRESHOLD — correct behavior for an offline agent.
    result.directory.registerDelegatedSigner(profile.k_local_pubkey, delegatedSigner);
    result.directory.registerThresholdSigner(profile.k_local_pubkey, delegatedSigner);
    result.directory.registerPrimaryPubkey(profile.k_local_pubkey, new Uint8Array(primaryPubkeyBytes));
  }
  if (loadedProfiles.length > 0) {
    logger.info("adapter.signers.restored", { count: loadedProfiles.length });
  }
  // M6B-010 AC-004: log adapter.state.loaded for profile state category (step 1 of startup sequence).
  logger.info("adapter.state.loaded", { stateType: "agent_profiles", count: loadedProfiles.length });
}

// M6B-010: Restore in-memory state from Postgres after startup.
//
// Option B sequencing (per story YAML): these calls happen after createDirectoryNode()
// returns. Stream handlers are already registered at this point, so there is a small
// race window (milliseconds between handler registration and ECS health check passing).
// This is documented and accepted — the window is far shorter than the time for an agent
// to reconnect after an ECS task replacement.
//
// Three maps are restored:
//   (1) #pendingConnectionRequests ← active_connection_requests (unexpired rows)
//       Enables target agents to call cello_accept_connection for requests delivered
//       before the restart (AC-001 / SI-001).
//   (2) #sessionParticipants ← sessions table (unsealed sessions with participant data)
//       Enables PERSIST-015 unilateral seal absent-party lookup after restart (AC-003).
//   (3) #sessionLastActivity ← sessions.created_at as genesis timestamp
//       Prevents grace period from resetting to zero on restart (AC-002).
if (store instanceof PgDirectoryStore) {
  try {
    const activeRequests = await store.loadActiveConnectionRequests();
    result.directory.restorePendingConnectionRequests(activeRequests);
  } catch (err: unknown) {
    logger.error("adapter.state.load.failed", {
      stateType: "pending_connection_requests",
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const activeSessions = await store.loadActiveSessionParticipants();
    result.directory.restoreSessionParticipants(activeSessions);
    result.directory.restoreSessionLastActivity(activeSessions);
  } catch (err: unknown) {
    logger.error("adapter.state.load.failed", {
      stateType: "session_participants_and_last_activity",
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  // PRESENCE-001: startup reconciliation — this node boots with an empty #streams, so any of its
  // own agent_presence rows still marked online are stale (a crash skipped the edge-triggered
  // offline write). Mark them offline now; they re-mark online as agents reconnect.
  if (pgPool) {
    try {
      const reconciledCount = await reconcileNodeOffline(pgPool, nodeId);
      logger.info("directory.presence.startup.reconciled", { nodeId, reconciledCount });
    } catch (err: unknown) {
      logger.error("directory.presence.startup.reconcile.failed", {
        nodeId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// FEDERATION-E2E-001: swap InMemoryCheckpointTransport placeholder with
// Libp2pCheckpointTransport now that the libp2p node is started and has
// a Peer ID. The transport needs the live node reference for stream dialing.
if (env !== "local") {
  const peerAddrsRaw = process.env["CHECKPOINT_PEER_ADDRS"] ?? "";
  const peers = new Map<string, string>();
  if (peerAddrsRaw) {
    for (const pair of peerAddrsRaw.split(",")) {
      const [nodeIdPart, libp2pPeerIdPart] = pair.split("=");
      if (nodeIdPart && libp2pPeerIdPart) {
        peers.set(nodeIdPart.trim(), libp2pPeerIdPart.trim());
      }
    }
  }
  checkpointTransport = new Libp2pCheckpointTransport({
    node: result.node,
    peers,
    logger,
  });
}

// ─── FEDERATION-E2E-001: CheckpointCoordinator instantiation ────────────────
const checkpointCoordinator = new CheckpointCoordinator(
  store,
  mmrStore!,
  checkpointTransport,
  kp,
  logger,
  {
    nodeId,
    checkpointIntervalMs: 10 * 60 * 1000,
    roundTimeoutMs: 30_000,
    checkpointGapAlarmMinutes: 30,
    requiredThreshold: 2,
  },
);
checkpointCoordinator.start();
logger.info("adapter.initialised", {
  adapterName: "CheckpointCoordinator",
  implementation: env === "local" ? "InMemoryCheckpointTransport" : "Libp2pCheckpointTransport",
  env,
  nodeId,
});

try {
  await networkRelay.connect(result.node);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  // Log but don't exit — relay may not be reachable yet; adapter will retry on each call
  logger.error("adapter.init.failed", { adapterName: "NetworkRelayAdapter", reason: msg });
}

for (const addr of result.node.listenAddresses()) {
  logger.info("adapter.initialised", { adapterName: "ListenAddr", implementation: addr.toString(), env });
}

// ─── DEPLOY-002: Health check HTTP server ─────────────────────────────────────
// The ALB target group sends GET /health to verify the task is alive.
// schemaVersion is derived from the migration count (same as the version guard above).
const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
const schemaVersion = readdirSync(migrationsDir).filter((f) => /^V\d+__.*\.sql$/.test(f)).length;

// ─── Bootstrap endpoint: auto-discover directory multiaddr ────────────────────
// CELLO_DIRECTORY_HOSTNAME is the publicly-routable hostname (e.g. the ALB DNS name or
// Route53 record). In production this is set in the ECS task definition so the bootstrap
// endpoint returns the correct multiaddr for external clients.
// When not set, we fall back to the actual WS listen address from the libp2p node
// (useful for local dev / integration tests where the real listener address is known).
const directoryHostname = process.env["CELLO_DIRECTORY_HOSTNAME"];
const directoryPeerId = result.node.getPeerId();

// DOD-MULTIADDR-1: the advertised bootstrap multiaddr is configuration, not a hardcoded
// /tcp/80/ws template. Defaults (port 80, transport ws) reproduce the pre-M12 AWS string
// exactly; a GCP node behind TLS sets CELLO_DIRECTORY_PUBLIC_PORT=443 /_TRANSPORT=wss, or
// CELLO_DIRECTORY_BOOTSTRAP_MULTIADDR for a verbatim override.
const bootstrapMultiaddr = buildBootstrapMultiaddr({
  peerId: directoryPeerId,
  explicit: process.env["CELLO_DIRECTORY_BOOTSTRAP_MULTIADDR"],
  hostname: directoryHostname,
  port: process.env["CELLO_DIRECTORY_PUBLIC_PORT"],
  transport: process.env["CELLO_DIRECTORY_PUBLIC_TRANSPORT"],
  fallbackWsAddr: result.node.listenAddresses().find((a) => a.includes("/ws")),
});

// DOD-REGISTRY-1: cache the registry document for the sync health server resolver.
// Loaded at startup and refreshed by the internal API on each publish (the internal
// API POSTs to /internal/signal/registry-publish which writes to DB; here we just
// poll-on-demand with a 60s TTL so we don't add a coupling between the two servers).
let registryCache: { document: Buffer; version: number } | null = null;
let registryCacheAge = 0;
const REGISTRY_CACHE_TTL_MS = 60_000;
if (pgPool) {
  getRegistryDocument(pgPool).then((doc) => { registryCache = doc; registryCacheAge = Date.now(); }).catch(() => {});
}

const healthServer = createHealthServer({
  nodeId,
  schemaVersion,
  logger,
  port: healthPort,
  multiaddr: bootstrapMultiaddr,
  peerId: directoryPeerId,
  // AC-007a (DX-001): resolver for GET /agent-lookup?agent_id=<32hex>
  getKLocalPubkeyByAgentId: (agentId: string): string | undefined => {
    const profile = store.getProfileByAgentId(agentId);
    return profile?.k_local_pubkey;
  },
  // CELLO-M7-CONN-001 (DOD-CONN-3): serve the consortium manifest over unauthenticated
  // HTTP so the daemon polls it without an agent identity (the keystone is gone). The
  // store never throws from getCurrentManifest(); an unset store → null → 503.
  // M12-D8: this is the SERVE role — clients re-verify independently, and pre-filtering here would
  // block officer rotation and hide a rogue directory from the client-side check that catches it.
  getCurrentManifest: () => directoryManifestStore?.getCurrentManifest() ?? null,
  // DOD-REGISTRY-1: serve the type registry (same model as /manifest — public, signed).
  getRegistryDocument: () => {
    if (pgPool && Date.now() - registryCacheAge > REGISTRY_CACHE_TTL_MS) {
      getRegistryDocument(pgPool).then((doc) => { registryCache = doc; registryCacheAge = Date.now(); }).catch(() => {});
    }
    return registryCache;
  },
});
healthServer.listen(healthPort, () => {
  logger.info("adapter.initialised", { adapterName: "HealthServer", implementation: "http", env, port: healthPort });
  if (bootstrapMultiaddr) {
    logger.info("adapter.initialised", { adapterName: "BootstrapEndpoint", multiaddr: bootstrapMultiaddr, peerId: directoryPeerId });
  }
});

// ─── DEPLOY-002: directory.service.started ─────────────────────────────────────
logServiceStarted(logger, {
  nodeId,
  region: nodeRegion,
  environment: env,
  schemaVersion,
});

// ─── Shutdown handlers ──────────────────────────────────────────────────────

const shutdown = () => {
  const uptimeMs = Date.now() - startedAt;
  logServiceStopped(logger, { nodeId, region: nodeRegion, environment: env, uptimeMs });

  healthServer.close();
  checkpointCoordinator.stop();
  // M6B-008: stop manifest poll loop and health check timer
  if (relayPoolManager) {
    relayPoolManager.stopPolling();
    relayPoolManager.stop();
  }
  result.stop()
    .then(() => pgPool?.end())
    .then(() => auditLogShipper.flush())
    // audit.shipper.flushed is emitted by the adapter itself — do not log it again here
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("adapter.init.failed", { adapterName: "shutdown", reason: msg });
    })
    .finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ─── DEPLOY-002: uncaught exception → directory.service.crashed ─────────────
let consecutiveFailures = 0;
process.on("uncaughtException", (err) => {
  consecutiveFailures++;
  logServiceCrashed(logger, {
    nodeId,
    region: nodeRegion,
    reason: err.message,
    consecutiveFailures,
  });
  process.exit(1);
});
