#!/usr/bin/env node
/**
 * CELLO Directory composition root (CELLO-NODE-004 / PERSIST-001)
 *
 * Adapter selection is driven by CELLO_ENV:
 *   local  — Docker Compose Postgres + all local stubs (no AWS)
 *   dev    — RDS + KMS + CloudWatch + EventBridge (real AWS, dev key)
 *
 * The process exits with code 1 and logs adapter.config.missing if any
 * required configuration key is absent. It never starts with a silently
 * misconfigured adapter.
 *
 * Environment variables:
 *   CELLO_ENV                          — required: local | dev | staging | production
 *   DATABASE_URL                       — required for CELLO_ENV=local
 *   DEV_ENVELOPE_KEY                   — required for CELLO_ENV=local (64-char hex)
 *   CELLO_DIRECTORY_KEY_FILE           — path to persisted directory signing keypair
 *   CELLO_DIRECTORY_TRANSPORT_KEY_FILE — path to persisted libp2p transport key
 *   CELLO_DIRECTORY_LISTEN_ADDR        — libp2p listen address (default: /ip4/0.0.0.0/tcp/4000)
 *   CELLO_RELAY_MULTIADDR              — relay multiaddr (required)
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
import { StdoutLogger, LocalEnvelopeKeyProvider, LocalClientStore, InMemoryRelayWal, LocalJobScheduler } from "@cello/interfaces/stubs";
import { InMemoryShareStore } from "../share-store.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";

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

// ─── Adapter instantiation ────────────────────────────────────────────────

let pgPool: pg.Pool | undefined;

const store = (() => {
  if (env === "local") {
    const databaseUrl = requireEnv("DATABASE_URL");
    pgPool = new pg.Pool({ connectionString: databaseUrl });
    const s = new PgDirectoryStore(pgPool);
    logger.info("adapter.initialised", { adapterName: "PgDirectoryStore", implementation: "PgDirectoryStore", env });
    return s;
  }
  // dev/staging/production: RdsDirectoryStore (not yet implemented — will replace in PERSIST-003+)
  logger.error("adapter.init.failed", { adapterName: "DirectoryStore", reason: `CELLO_ENV=${env} not yet supported` });
  process.exit(1);
})();

// ─── AC-010: Schema version guard ────────────────────────────────────────────
// Query flyway_schema_history and refuse to start if migrations haven't been applied.
if (env === "local" && pgPool) {
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

// envelopeKeyProvider/clientStore/relayWal/jobScheduler are instantiated here and
// will be wired into createDirectoryNode in PERSIST-003+.
const envelopeKeyProvider = (() => {
  if (env === "local") {
    const devKey = requireEnv("DEV_ENVELOPE_KEY");
    const p = new LocalEnvelopeKeyProvider(devKey);
    logger.info("adapter.initialised", { adapterName: "EnvelopeKeyProvider", implementation: "LocalEnvelopeKeyProvider", env });
    return p;
  }
  // dev+: KmsEnvelopeKeyProvider (PERSIST-005)
  logger.error("adapter.init.failed", { adapterName: "EnvelopeKeyProvider", reason: `CELLO_ENV=${env} not yet supported` });
  process.exit(1);
})();
void envelopeKeyProvider; // wired in PERSIST-005

void new LocalClientStore(); // wired in PERSIST-003+
logger.info("adapter.initialised", { adapterName: "ClientStore", implementation: "LocalClientStore", env });

void new InMemoryRelayWal(); // wired in PERSIST-003+
logger.info("adapter.initialised", { adapterName: "RelayWal", implementation: "InMemoryRelayWal", env });

void new LocalJobScheduler(); // wired in PERSIST-003+
logger.info("adapter.initialised", { adapterName: "JobScheduler", implementation: "LocalJobScheduler", env });

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

const shareStore = new InMemoryShareStore();

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

const shutdown = () => {
  result.stop()
    .then(() => pgPool?.end())
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("adapter.init.failed", { adapterName: "shutdown", reason: msg });
    })
    .finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
