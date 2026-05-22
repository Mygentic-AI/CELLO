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
 *   KMS_KEY_ARN                        — required for CELLO_ENV=dev/staging/production; KMS key ARN
 *   HEALTH_PORT                        — HTTP health check port (default: 443)
 */
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { FileKeyProvider } from "@cello/crypto";
import { createDirectoryNode } from "../directory-node.js";
import { NetworkRelayAdapter } from "../network-relay-adapter.js";
import { StdoutLogger, LocalEnvelopeKeyProvider, LocalClientStore, InMemoryRelayWal, LocalJobScheduler, LocalAuditLogShipper } from "@cello/interfaces/stubs";
import type { AuditLogShipper } from "@cello/interfaces";
// S3AuditLogShipper is imported dynamically below to avoid loading @aws-sdk/client-s3
// in CELLO_ENV=local subprocesses where it causes tsx/esm resolution noise.
import { InMemoryShareStore } from "../share-store.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { EncryptedPgShareStore } from "../encrypted-share-store.js";
import { PersistentShareStore } from "../persistent-share-store.js";
import { MmrStore } from "../mmr-store.js";
import { MmrCheckpointService } from "../mmr-checkpoint-service.js";
import { AnalyticsJob } from "../analytics-job.js";
import { PendingConnectionRequestTtlSweep } from "../pending-connection-request-ttl-sweep.js";
import { createHealthServer } from "../health-server.js";
import { logServiceStarted, logServiceStopped, logServiceCrashed, logSecretsUnavailable } from "../service-lifecycle.js";

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
const relayAddr = process.env["CELLO_RELAY_MULTIADDR"];
const awsRegion = process.env["AWS_REGION"] ?? "us-east-1";
const nodeId = process.env["NODE_ID"] ?? (env === "local" ? "local" : awsRegion);
const healthPort = parseInt(process.env["HEALTH_PORT"] ?? "443", 10);
const startedAt = Date.now();

if (!relayAddr) {
  logger.error("adapter.config.missing", { missingKey: "CELLO_RELAY_MULTIADDR", env });
  process.exit(1);
}

if (!env) {
  logger.error("adapter.config.missing", { missingKey: "CELLO_ENV", env: "(unset)" });
  process.exit(1);
}

if (env !== "local" && env !== "dev" && env !== "staging" && env !== "production") {
  logger.error("adapter.config.missing", { missingKey: "CELLO_ENV", env, reason: "unrecognised value" });
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
  // dev/staging/production: S3AuditLogShipper (SECOPS-001)
  const auditBucket = requireEnv("CELLO_AUDIT_BUCKET");
  const awsRegion = process.env["AWS_REGION"] ?? "us-east-1";
  const { S3AuditLogShipper } = await import("../adapters/s3-audit-log-shipper.js");
  const s = new S3AuditLogShipper(auditBucket, logger, undefined, { region: awsRegion });
  logger.info("adapter.initialised", { adapterName: "AuditLogShipper", implementation: "S3AuditLogShipper", env, bucket: auditBucket, region: awsRegion });
  return s;
})();

// ─── Adapter instantiation ────────────────────────────────────────────────

let pgPool: pg.Pool | undefined;

const store = await (async () => {
  if (env === "local") {
    const databaseUrl = requireEnv("DATABASE_URL");
    pgPool = new pg.Pool({ connectionString: databaseUrl });
    const s = new PgDirectoryStore(pgPool, logger, nodeId, awsRegion);
    logger.info("adapter.initialised", { adapterName: "PgDirectoryStore", implementation: "PgDirectoryStore", env });
    return s;
  }
  // dev/staging/production: PgDirectoryStore backed by RDS credentials from Secrets Manager
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
    databaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.dbname}`;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logSecretsUnavailable(logger, { nodeId, region: awsRegion, reason });
    process.exit(1);
  }
  pgPool = new pg.Pool({ connectionString: databaseUrl });
  const s = new PgDirectoryStore(pgPool, logger, nodeId, awsRegion);
  logger.info("adapter.initialised", { adapterName: "PgDirectoryStore", implementation: "PgDirectoryStore", env });
  return s;
})();

// ─── AC-010: Schema version guard ────────────────────────────────────────────
// Query flyway_schema_history and refuse to start if migrations haven't been applied.
// For dev/staging/production, Flyway runs via docker-entrypoint.sh before this process starts,
// but we still verify as a safety net.
if (pgPool) {
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
  const migrationFiles = readdirSync(migrationsDir).filter((f) => /^V\d+__.*\.sql$/.test(f));
  const expectedVersion = migrationFiles.length;

  let appliedVersion = 0;
  try {
    const result = await pgPool.query<{ max_rank: number | null }>(
      `SELECT MAX(installed_rank) AS max_rank FROM flyway_schema_history WHERE success = true`,
    );
    appliedVersion = result.rows[0]?.max_rank ?? 0;
  } catch {
    // flyway_schema_history doesn't exist — migrations have never run
    appliedVersion = 0;
  }

  if (appliedVersion < expectedVersion) {
    logger.error("migration.out.of.date", { appliedVersion, expectedVersion, env });
    await pgPool.end();
    process.exit(1);
  }
}

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
const envelopeKeyProvider = (() => {
  if (env === "local") {
    const devKey = requireEnv("DEV_ENVELOPE_KEY");
    const p = new LocalEnvelopeKeyProvider(devKey, logger);
    logger.info("adapter.initialised", { adapterName: "EnvelopeKeyProvider", implementation: "LocalEnvelopeKeyProvider", env });
    return p;
  }
  // dev/staging/production: use DEV_ENVELOPE_KEY until KmsEnvelopeKeyProvider is wired
  const devKey = requireEnv("DEV_ENVELOPE_KEY");
  const p = new LocalEnvelopeKeyProvider(devKey, logger);
  logger.info("adapter.initialised", { adapterName: "EnvelopeKeyProvider", implementation: "LocalEnvelopeKeyProvider", env });
  return p;
})();

void new LocalClientStore(); // wired in PERSIST-003+
logger.info("adapter.initialised", { adapterName: "ClientStore", implementation: "LocalClientStore", env });

void new InMemoryRelayWal(); // wired in PERSIST-003+
logger.info("adapter.initialised", { adapterName: "RelayWal", implementation: "InMemoryRelayWal", env });

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

let kp: FileKeyProvider;
try {
  kp = await FileKeyProvider.load(keyPath);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error("adapter.init.failed", { adapterName: "FileKeyProvider", reason: msg });
  process.exit(1);
}

let transportPrivateKey: Uint8Array;
try {
  transportPrivateKey = readFileSync(transportKeyPath);
} catch {
  transportPrivateKey = randomBytes(32);
  mkdirSync(join(homedir(), ".cello"), { recursive: true });
  writeFileSync(transportKeyPath, transportPrivateKey, { mode: 0o600 });
  logger.info("adapter.initialised", { adapterName: "TransportKey", implementation: "generated", env });
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
  logger.info("adapter.initialised", { adapterName: "ShareStore", implementation: "PersistentShareStore", env });
} else {
  logger.info("adapter.initialised", { adapterName: "ShareStore", implementation: "InMemoryShareStore", env });
}

// ─── Relay setup ──────────────────────────────────────────────────────────

const relayParts = relayAddr.split("/");
const p2pIndex = relayParts.findIndex((p) => p === "p2p");
const relayPeerId = p2pIndex !== -1 ? relayParts[p2pIndex + 1] : "";

if (!relayPeerId) {
  logger.error("adapter.config.missing", { missingKey: "CELLO_RELAY_MULTIADDR", env, reason: "must include /p2p/<peer-id>" });
  process.exit(1);
}

const networkRelay = new NetworkRelayAdapter({
  keyProvider: kp,
  relayPeerId,
  relayMultiaddrs: [relayAddr],
});

const dirPubkey = await kp.getPublicKey();
logger.info("adapter.initialised", { adapterName: "DirectoryNode", implementation: "CelloDirectoryNode", env, pubkey: Buffer.from(dirPubkey).toString("hex") });

// ─── Node startup ─────────────────────────────────────────────────────────

let result: Awaited<ReturnType<typeof createDirectoryNode>>;
try {
  result = await createDirectoryNode({
    keyProvider: kp,
    listenAddresses: [listenAddr],
    relay: networkRelay,
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: [relayAddr] },
    store,
    shareStore,
    transportPrivateKey,
    mmrStore,
  });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error("adapter.init.failed", { adapterName: "CelloDirectoryNode", reason: msg });
  process.exit(1);
}

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

const healthServer = createHealthServer({ nodeId, schemaVersion, logger, port: healthPort });
healthServer.listen(healthPort, () => {
  logger.info("adapter.initialised", { adapterName: "HealthServer", implementation: "http", env, port: healthPort });
});

// ─── DEPLOY-002: directory.service.started ─────────────────────────────────────
logServiceStarted(logger, {
  nodeId,
  region: awsRegion,
  environment: env,
  schemaVersion,
});

// ─── Shutdown handlers ──────────────────────────────────────────────────────

const shutdown = () => {
  const uptimeMs = Date.now() - startedAt;
  logServiceStopped(logger, { nodeId, region: awsRegion, environment: env, uptimeMs });

  healthServer.close();
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
    region: awsRegion,
    reason: err.message,
    consecutiveFailures,
  });
  process.exit(1);
});
