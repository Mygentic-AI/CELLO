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
import { createDirectoryNode, ClientDelegatedSigner } from "../directory-node.js";
import { NetworkRelayAdapter } from "../network-relay-adapter.js";
import { StdoutLogger, LocalEnvelopeKeyProvider, LocalClientStore, InMemoryRelayWal, LocalJobScheduler, LocalAuditLogShipper, InMemoryNotificationQueue, DevTokenValidator } from "@cello-protocol/interfaces/stubs";
import type { AuditLogShipper, NotificationQueue, TokenValidator } from "@cello-protocol/interfaces";
// S3AuditLogShipper is imported dynamically below to avoid loading @aws-sdk/client-s3
// in CELLO_ENV=local subprocesses where it causes tsx/esm resolution noise.
import { createInternalApiServer } from "../internal-api-server.js";
import { PgTokenValidator } from "../adapters/pg-token-validator.js";
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
import { PgNotificationQueue } from "../adapters/pg-notification-queue.js";
import { RelayPoolManager } from "../relay-pool-manager.js";
import { CheckpointCoordinator } from "../checkpoint-coordinator.js";
import { Libp2pCheckpointTransport } from "../adapters/libp2p-checkpoint-transport.js";
import { InMemoryCheckpointTransport } from "@cello-protocol/interfaces/stubs";
import type { ICheckpointTransport, CloudStorageProvider } from "@cello-protocol/interfaces";
import { LocalCloudStorageProvider } from "@cello-protocol/interfaces/stubs";

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
const relayAddr = process.env["CELLO_RELAY_MULTIADDR"];
const awsRegion = process.env["AWS_REGION"] ?? "us-east-1";
const nodeId = process.env["NODE_ID"] ?? (env === "local" ? "local" : awsRegion);
// AC-007 (REPOSPLIT-001): health server moved to port 9090 so port 8080 is free for
// the libp2p WS listener. ALB target group health check updated to port 9090.
const healthPort = parseInt(process.env["HEALTH_PORT"] ?? "9090", 10);
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
    await s.loadProfiles();
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
    // RDS uses AWS-managed certs (self-signed chain). Node's pg v8+ treats sslmode=require
    // as verify-full. Use no-verify: traffic is encrypted; cert chain is AWS-internal on VPC.
    databaseUrl = `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.dbname}?sslmode=no-verify`;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logSecretsUnavailable(logger, { nodeId, region: awsRegion, reason });
    process.exit(1);
  }
  pgPool = new pg.Pool({ connectionString: databaseUrl });
  const s = new PgDirectoryStore(pgPool, logger, nodeId, awsRegion);
  await s.loadProfiles();
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
  } catch (err) {
    // flyway_schema_history doesn't exist or cello_service lacks SELECT — log the actual error
    logger.error("migration.version.query.failed", { reason: String(err), env });
    appliedVersion = 0;
  }

  if (appliedVersion < expectedVersion) {
    logger.error("migration.out.of.date", { currentVersion: appliedVersion, requiredVersion: expectedVersion, env });
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

  // dev/staging/production: S3-backed manifest (required)
  const manifestBucket = requireEnv("RELAY_MANIFEST_BUCKET");
  const signerPubkeyHex = requireEnv("RELAY_MANIFEST_SIGNER_PUBKEY");
  const { S3CloudStorageProvider } = await import("../adapters/s3-cloud-storage-provider.js");
  storage = new S3CloudStorageProvider(manifestBucket, awsRegion);
  logger.info("adapter.initialised", { adapterName: "RelayPoolManager", implementation: "S3CloudStorageProvider", env, bucket: manifestBucket, region: awsRegion });

  const mgr = new RelayPoolManager({ storage, signerPublicKeyHex: signerPubkeyHex, logger });
  try {
    await mgr.loadManifest();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("manifest not found")) {
      // FEDERATION-E2E-001: secondary regions may not have a manifest yet.
      // Fall back to CELLO_RELAY_MULTIADDR — the relay pool manager is non-operational.
      logger.info("relay.manifest.not_found", { env, reason: "no manifest published yet, using CELLO_RELAY_MULTIADDR fallback" });
      mgr.stop();
      return undefined;
    }
    // Corrupt, invalid signature, or persistent network error is still fatal
    logger.error("relay.manifest.load.failed", { reason: msg, attempt: 5, env });
    process.exit(1);
  }

  // M6B-008: start manifest poll loop
  // This code only runs when env !== "local" (checked at line 494),
  // so the poll loop is automatically disabled in local mode.
  const rawPollInterval = process.env["RELAY_MANIFEST_POLL_INTERVAL_MS"];
  const pollIntervalMs = rawPollInterval ? parseInt(rawPollInterval, 10) : 120_000;
  if (isNaN(pollIntervalMs) || pollIntervalMs < 1_000) {
    logger.error("adapter.config.missing", {
      missingKey: "RELAY_MANIFEST_POLL_INTERVAL_MS",
      value: rawPollInterval,
      reason: "must be a positive integer >= 1000",
    });
    process.exit(1);
  }
  mgr.startPolling(pollIntervalMs);

  return mgr;
})();

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

let result: Awaited<ReturnType<typeof createDirectoryNode>>;
try {
  // AC-007 (REPOSPLIT-001): include the WS listen address so the directory
  // is reachable from outside the VPC through the ALB on port 80/ws.
  const listenAddresses = wsListenAddr
    ? [listenAddr, wsListenAddr]
    : [listenAddr];

  result = await createDirectoryNode({
    keyProvider: kp,
    listenAddresses,
    relay: networkRelay,
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: [relayAddr] },
    store,
    shareStore,
    transportPrivateKey,
    mmrStore,
    notificationQueue,
    relayPoolManager,
    checkpointTransport,
    tokenValidator,
    pgPool: pgPool ?? undefined,
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

let bootstrapMultiaddr: string | undefined;
if (directoryHostname) {
  // Production: construct /dns4/<hostname>/tcp/80/ws/p2p/<peerId>
  bootstrapMultiaddr = `/dns4/${directoryHostname}/tcp/80/ws/p2p/${directoryPeerId}`;
} else {
  // Fallback: use the actual WS listen address from the node (fires when
  // CELLO_DIRECTORY_HOSTNAME is unset and no WS listen address is available
  // from the node — e.g. local dev or integration tests).
  // Replace 0.0.0.0 with 127.0.0.1 so the address is routable for local clients.
  const wsAddr = result.node.listenAddresses().find((a) => a.includes("/ws"));
  if (wsAddr) {
    const routeableAddr = wsAddr.replace("0.0.0.0", "127.0.0.1");
    bootstrapMultiaddr = routeableAddr.includes("/p2p/") ? routeableAddr : `${routeableAddr}/p2p/${directoryPeerId}`;
  }
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
  region: awsRegion,
  environment: env,
  schemaVersion,
});

// ─── Shutdown handlers ──────────────────────────────────────────────────────

const shutdown = () => {
  const uptimeMs = Date.now() - startedAt;
  logServiceStopped(logger, { nodeId, region: awsRegion, environment: env, uptimeMs });

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
    region: awsRegion,
    reason: err.message,
    consecutiveFailures,
  });
  process.exit(1);
});
