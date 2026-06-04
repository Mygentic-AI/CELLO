#!/usr/bin/env node
/**
 * CELLO Relay binary — composition root (CELLO-NODE-004 / DEPLOY-003)
 *
 * Adapter selection is driven by CELLO_ENV:
 *   local      — FileKeyProvider from CELLO_RELAY_KEY_FILE (no AWS)
 *   dev        — InMemoryKeyProvider from NODE_PRIVATE_KEY env var (injected by ECS Secrets)
 *   staging    — same as dev
 *   production — same as dev
 *
 * The process exits with code 1 and logs relay.service.start.failed if any
 * required configuration key is absent. It never starts with an empty signing key.
 *
 * Environment variables:
 *   CELLO_ENV                         — required: local | dev | staging | production
 *   CELLO_RELAY_KEY_FILE              — path to persisted relay signing keypair (CELLO_ENV=local only)
 *                                        Default: ~/.cello/relay-key
 *   NODE_PRIVATE_KEY                  — 64-char hex Ed25519 seed (CELLO_ENV=dev/staging/production)
 *                                        Injected by ECS task definition Secrets field (ValueFrom Secrets Manager)
 *   CELLO_RELAY_TRANSPORT_KEY_FILE    — path to persisted libp2p transport key (default: ~/.cello/relay-transport-key)
 *   CELLO_RELAY_LISTEN_ADDR           — libp2p listen address (default: /ip4/0.0.0.0/tcp/4001)
 *   CELLO_RELAY_HEALTH_PORT           — HTTP health check port (default: 4000)
 *   CELLO_DIRECTORY_PUBKEY            — hex-encoded Ed25519 directory public key (required)
 *                                        The relay authenticates directory admin frames against this key.
 *                                        In NODE_ENV=test, a random ephemeral key is used if absent.
 *   CELLO_DIRECTORY_MULTIADDR         — directory multiaddr for seal_submission callbacks (optional)
 *                                        Format: /ip4/<host>/tcp/<port>/p2p/<peer-id>
 *   AWS_REGION                        — AWS region for observability events (default: us-east-1)
 *   WAL_DIR                           — directory for per-session WAL files (required for CELLO_ENV=dev/production)
 *                                        PERSIST-013: FileSessionWal writes one {sessionId}.wal per active session.
 *
 * SI-001: the relay private key MUST NEVER be logged, written to disk (after initial load),
 * or included in any error message. logRelayServiceStartFailed does not accept a relayId
 * parameter precisely to prevent this error class.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { FileKeyProvider, InMemoryKeyProvider, generateKeypair } from "@cello-protocol/crypto";
import { StdoutLogger } from "@cello-protocol/interfaces/stubs";
import { createRelayNode } from "../index.js";
import { NetworkDirectoryAdapter } from "../network-directory-adapter.js";
import { FileSessionWal, InMemorySessionWal } from "../adapters/file-session-wal.js";
import {
  logRelayServiceStarted,
  logRelayServiceStopped,
  logRelayServiceStartFailed,
  logRelayServiceCrashed,
  createRelayHealthServer,
} from "../relay-service-lifecycle.js";

const celloEnv = process.env["CELLO_ENV"] ?? "local";
const awsRegion = process.env["AWS_REGION"] ?? "us-east-1";
const walDir = process.env["WAL_DIR"] ?? "";
const keyPath = process.env["CELLO_RELAY_KEY_FILE"] ?? join(homedir(), ".cello", "relay-key");
const directoryMultiaddr = process.env["CELLO_DIRECTORY_MULTIADDR"];
const transportKeyPath = process.env["CELLO_RELAY_TRANSPORT_KEY_FILE"] ?? join(homedir(), ".cello", "relay-transport-key");
const listenAddr = process.env["CELLO_RELAY_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/4001";
const wsListenAddr = process.env["CELLO_RELAY_WS_LISTEN_ADDR"] ?? "";
const healthPort = parseInt(process.env["CELLO_RELAY_HEALTH_PORT"] ?? "4000", 10);
const dirPubkeyHex = process.env["CELLO_DIRECTORY_PUBKEY"];
const startedAt = Date.now();

// Logger is injected, never imported directly. StdoutLogger emits structured JSON lines.
const logger = new StdoutLogger();

// ─── Environment validation ────────────────────────────────────────────────────

if (!celloEnv) {
  logRelayServiceStartFailed(logger, { reason: "CELLO_ENV is required", region: awsRegion });
  process.exit(1);
}

if (celloEnv !== "local" && celloEnv !== "dev" && celloEnv !== "staging" && celloEnv !== "production") {
  logRelayServiceStartFailed(logger, { reason: `CELLO_ENV has unrecognised value: ${celloEnv}`, region: awsRegion });
  process.exit(1);
}

// PERSIST-013 (AC-005): validate WAL_DIR at startup — exits 1 if missing in dev/production.
if (!FileSessionWal.validateConfig(celloEnv, walDir)) {
  logRelayServiceStartFailed(logger, { reason: "WAL_DIR is required for CELLO_ENV=dev/staging/production", region: awsRegion });
  process.exit(1);
}

// PERSIST-013: select WAL adapter based on CELLO_ENV.
// CELLO_ENV=local → InMemorySessionWal (no file I/O, crash recovery not available).
// CELLO_ENV=dev/staging/production → FileSessionWal with WAL_DIR from env.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sessionWal = celloEnv === "local"
  ? new InMemorySessionWal({ logger })
  : new FileSessionWal({ walDir, logger });

// ─── Directory pubkey validation ───────────────────────────────────────────────

if (!dirPubkeyHex && process.env["NODE_ENV"] !== "test") {
  logRelayServiceStartFailed(logger, {
    reason: "CELLO_DIRECTORY_PUBKEY is required",
    region: awsRegion,
  });
  process.exit(1);
}

// Decode directory pubkey
let dirPubkey: Uint8Array;
if (dirPubkeyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(dirPubkeyHex)) {
    logRelayServiceStartFailed(logger, {
      reason: "CELLO_DIRECTORY_PUBKEY must be a 64-char lowercase hex string (32-byte Ed25519 pubkey)",
      region: awsRegion,
    });
    process.exit(1);
  }
  dirPubkey = new Uint8Array(Buffer.from(dirPubkeyHex, "hex"));
} else {
  // Test mode only: use a random ephemeral pubkey
  const ephemeralKp = generateKeypair();
  dirPubkey = await ephemeralKp.getPublicKey();
  logger.warn("relay.startup.ephemeral-key", {
    reason: "CELLO_DIRECTORY_PUBKEY not set; using ephemeral key (test mode only)",
  });
}

// ─── Signing key loading ────────────────────────────────────────────────────────
//
// CELLO_ENV=local: load from key file (persisted across restarts)
// CELLO_ENV=dev/staging/production: load from NODE_PRIVATE_KEY env var
//   (injected by ECS task definition Secrets field — value comes from Secrets Manager
//    cello/{env}/relay/node-private-key — never touches disk inside the container)
//
// SI-001: the private key seed MUST NEVER appear in any log event.
// The logRelayServiceStartFailed function intentionally has no relayId parameter.

let kp: FileKeyProvider | InMemoryKeyProvider;
if (celloEnv === "local") {
  try {
    kp = await FileKeyProvider.load(keyPath);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logRelayServiceStartFailed(logger, { reason: `key file error: ${reason}`, region: awsRegion });
    process.exit(1);
  }
} else {
  // dev/staging/production: NODE_PRIVATE_KEY is injected by ECS Secrets (ValueFrom)
  // The value is a 64-char hex string (32-byte Ed25519 seed)
  const nodePrivateKeyHex = process.env["NODE_PRIVATE_KEY"];
  if (!nodePrivateKeyHex) {
    logRelayServiceStartFailed(logger, { reason: "NODE_PRIVATE_KEY is required for CELLO_ENV=dev/staging/production", region: awsRegion });
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(nodePrivateKeyHex)) {
    logRelayServiceStartFailed(logger, {
      reason: "NODE_PRIVATE_KEY must be a 64-char hex string (32-byte Ed25519 seed)",
      region: awsRegion,
    });
    process.exit(1);
  }
  try {
    const seed = Buffer.from(nodePrivateKeyHex, "hex");
    kp = new InMemoryKeyProvider(seed);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    logRelayServiceStartFailed(logger, { reason: `key init error: ${reason}`, region: awsRegion });
    process.exit(1);
  }
}

// Derive relayId = hex of Ed25519 public key. This is stable across restarts
// for dev/staging/production (same seed → same pubkey). AC-002: the relayId
// matches the public key derived from node-private-key loaded from Secrets Manager.
const relayPubkey = await kp.getPublicKey();
const relayId = Buffer.from(relayPubkey).toString("hex");

// ─── Transport key ─────────────────────────────────────────────────────────────
// Load or generate persisted transport key (ensures stable Peer ID across restarts)

let transportPrivateKey: Uint8Array;
const transportKeyHex = process.env["CELLO_RELAY_TRANSPORT_KEY_HEX"];
if (transportKeyHex && transportKeyHex !== "PLACEHOLDER_POPULATE_VIA_CLI") {
  // Production/dev/staging: transport key injected via Secrets Manager at ECS task launch.
  // This ensures the relay peer ID is stable across restarts and redeploys.
  transportPrivateKey = Buffer.from(transportKeyHex, "hex");
  logger.info("adapter.initialised", { adapterName: "TransportKey", implementation: "secrets_manager", env: celloEnv });
} else if (celloEnv !== "local") {
  // Non-local with missing/placeholder key — fail fast. Silently generating a random key
  // in ECS would produce an unstable peer ID, breaking all connected clients on every restart.
  logRelayServiceStartFailed(logger, { reason: "CELLO_RELAY_TRANSPORT_KEY_HEX is required for non-local environments", region: awsRegion });
  process.exit(1);
} else {
  // Local: load from file or generate once and persist.
  try {
    transportPrivateKey = readFileSync(transportKeyPath);
  } catch {
    transportPrivateKey = randomBytes(32);
    mkdirSync(join(homedir(), ".cello"), { recursive: true });
    writeFileSync(transportKeyPath, transportPrivateKey, { mode: 0o600 });
    logger.info("adapter.initialised", { adapterName: "TransportKey", implementation: "generated", env: celloEnv });
  }
}

// ─── Directory adapter ─────────────────────────────────────────────────────────

let directoryAdapter: NetworkDirectoryAdapter | undefined;
if (directoryMultiaddr) {
  const parts = directoryMultiaddr.split("/");
  const p2pIndex = parts.findIndex((p) => p === "p2p");
  const dirPeerId = p2pIndex !== -1 ? parts[p2pIndex + 1] : null;
  if (!dirPeerId) {
    logRelayServiceStartFailed(logger, {
      reason: "CELLO_DIRECTORY_MULTIADDR must include /p2p/<peer-id>",
      region: awsRegion,
    });
    process.exit(1);
  }
  directoryAdapter = new NetworkDirectoryAdapter({
    directoryPeerId: dirPeerId,
    directoryMultiaddrs: [directoryMultiaddr],
  });
  logger.info("adapter.initialised", { adapterName: "NetworkDirectoryAdapter", directoryMultiaddr, env: celloEnv });
}

// ─── Relay node startup ────────────────────────────────────────────────────────

let relayResult: Awaited<ReturnType<typeof createRelayNode>>;
try {
  relayResult = await createRelayNode({
    listenAddresses: wsListenAddr ? [listenAddr, wsListenAddr] : [listenAddr],
    directoryPubkey: dirPubkey,
    keyProvider: kp,
    transportPrivateKey,
    directory: directoryAdapter,
    ackSigningKeyProvider: kp,
    relayId,
    logger,
  });
} catch (err: unknown) {
  const reason = err instanceof Error ? err.message : String(err);
  // SI-001: do not include relayId when startup fails after key was loaded
  // (the relay is not running yet so relayId is not a useful identifier to ops)
  logRelayServiceStartFailed(logger, { reason, region: awsRegion });
  process.exit(1);
}

// Wire node into adapter after relay starts
if (directoryAdapter) {
  directoryAdapter.connect(relayResult.node);
}

// ─── FEDERATION-003: Relay registration with directory (AC-002, DB-001) ─────────
// The relay MUST register before accepting sessions — an unregistered relay cannot
// issue verifiable ACKs (AC-002). If the directory is unreachable, retry on exponential
// backoff (DB-001). relay.registration.failed is logged at WARN on each failed attempt.
// relay.registered or relay.already.registered is logged at INFO on success.
if (directoryAdapter) {
  const MAX_ATTEMPTS = 10;
  const BASE_DELAY_MS = 500;

  let registered = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const regResult = await directoryAdapter.registerWithDirectory({
      relayId,
      publicKeyHex: relayId, // relayId = hex(pubkey) by convention
      region: awsRegion,
      keyProvider: kp,
    });

    if (regResult.ok) {
      if (regResult.alreadyRegistered) {
        logger.info("relay.already.registered", { relayId, region: awsRegion });
      } else {
        logger.info("relay.registered", { relayId, region: awsRegion });
      }
      registered = true;
      break;
    }

    // RELAY_IDENTITY_CONFLICT is unrecoverable — a different key was registered
    // for this relayId. The relay cannot proceed with this key.
    if (regResult.reason.includes("RELAY_IDENTITY_CONFLICT")) {
      logRelayServiceStartFailed(logger, {
        reason: `relay registration rejected: ${regResult.reason}`,
        region: awsRegion,
      });
      process.exit(1);
    }

    // DB-001: directory temporarily unreachable — log and backoff
    logger.warn("relay.registration.failed", { reason: regResult.reason, attempt });
    if (attempt < MAX_ATTEMPTS) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise<void>((r) => setTimeout(r, Math.min(delayMs, 30_000)));
    }
  }

  if (!registered) {
    logRelayServiceStartFailed(logger, {
      reason: "relay registration failed after maximum retry attempts",
      region: awsRegion,
    });
    process.exit(1);
  }
}

for (const addr of relayResult.node.listenAddresses()) {
  logger.info("adapter.initialised", { adapterName: "ListenAddr", implementation: String(addr), env: celloEnv });
}

// ─── DEPLOY-003: Health check HTTP server (AC-007) ─────────────────────────────
// GET /health on port 4000 returns { relayId, status: 'ok' }.
// Port 4000 is VPC-internal only — not exposed via ALB.
// The directory's relay pool health checks (INFRA-009) use this endpoint.

const healthServer = createRelayHealthServer({ relayId, logger });
healthServer.listen(healthPort, () => {
  logger.info("adapter.initialised", { adapterName: "RelayHealthServer", port: healthPort, env: celloEnv });
});

// ─── DEPLOY-003: relay.service.started (AC-002) ────────────────────────────────

logRelayServiceStarted(logger, {
  relayId,
  region: awsRegion,
  environment: celloEnv,
});

// ─── CELLO-M6B-009: Idle session sweep ─────────────────────────────────────────

const sweepIntervalMs = 3_600_000; // 1 hour
const parsedIdleMs = parseInt(process.env["RELAY_SESSION_MAX_IDLE_MS"] ?? "86400000", 10);
// Guard against NaN (empty string, non-numeric value): fall back to 24 h default.
// NaN propagates silently through arithmetic — `cutoff = Date.now() - NaN` is NaN,
// and `lastActivityAt < NaN` is always false (IEEE 754), so no session would ever be swept.
const maxIdleMs = Number.isFinite(parsedIdleMs) && parsedIdleMs > 0 ? parsedIdleMs : 86_400_000;
relayResult.relay.startIdleSweep(sweepIntervalMs, maxIdleMs);

// ─── Shutdown handlers ──────────────────────────────────────────────────────────

const shutdown = () => {
  const uptimeMs = Date.now() - startedAt;
  logRelayServiceStopped(logger, { relayId, region: awsRegion, environment: celloEnv, uptimeMs });

  // CELLO-M6B-009: stop idle session sweep
  relayResult.relay.stopIdleSweep();

  healthServer.close();
  relayResult.stop()
    .catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("relay.shutdown.failed", { reason });
    })
    .finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ─── DEPLOY-003: uncaught exception → relay.service.crashed ────────────────────

process.on("uncaughtException", (err) => {
  logRelayServiceCrashed(logger, {
    relayId,
    region: awsRegion,
    reason: err.message,
  });
  process.exit(1);
});
