#!/usr/bin/env node
/**
 * CELLO Relay binary (CELLO-NODE-004)
 *
 * Environment variables:
 *   CELLO_RELAY_KEY_FILE              — path to persisted relay signing keypair (default: ~/.cello/relay-key)
 *                                        Uses the same FileKeyProvider format as the directory.
 *   CELLO_RELAY_TRANSPORT_KEY_FILE    — path to persisted libp2p transport key (default: ~/.cello/relay-transport-key)
 *   CELLO_RELAY_LISTEN_ADDR           — libp2p listen address (default: /ip4/0.0.0.0/tcp/4001)
 *   CELLO_DIRECTORY_PUBKEY            — hex-encoded Ed25519 directory public key (required)
 *                                        The relay authenticates directory admin frames against this key.
 *                                        In NODE_ENV=test, a random ephemeral key is used if absent.
 *   CELLO_DIRECTORY_MULTIADDR         — directory multiaddr for seal_submission callbacks (optional)
 *                                        Format: /ip4/<host>/tcp/<port>/p2p/<peer-id>
 *                                        If set, relay dials directory when bilateral SEAL is detected.
 *   CELLO_ENV                         — deployment environment: local | dev | staging | production
 *                                        Controls adapter selection. Default: local.
 *   WAL_DIR                           — directory for per-session WAL files (required for CELLO_ENV=dev/production)
 *                                        PERSIST-013: FileSessionWal writes one {sessionId}.wal per active session.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { FileKeyProvider, generateKeypair } from "@cello/crypto";
import { StdoutLogger } from "@cello/interfaces/stubs";
import { createRelayNode } from "../index.js";
import { NetworkDirectoryAdapter } from "../network-directory-adapter.js";
import { FileSessionWal, InMemorySessionWal } from "../adapters/file-session-wal.js";

const keyPath = process.env["CELLO_RELAY_KEY_FILE"] ?? join(homedir(), ".cello", "relay-key");
const directoryMultiaddr = process.env["CELLO_DIRECTORY_MULTIADDR"];
const transportKeyPath = process.env["CELLO_RELAY_TRANSPORT_KEY_FILE"] ?? join(homedir(), ".cello", "relay-transport-key");
const listenAddr = process.env["CELLO_RELAY_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/4001";
const dirPubkeyHex = process.env["CELLO_DIRECTORY_PUBKEY"];
const celloEnv = process.env["CELLO_ENV"] ?? "local";
const walDir = process.env["WAL_DIR"] ?? "";

// M-001: use StdoutLogger so all WAL observability events (including relay.wal.write.failed
// which is an ops-critical alarm) are emitted as structured JSON lines, not silently dropped.
const logger = new StdoutLogger();

// PERSIST-013 (AC-005): validate WAL_DIR at startup — exits 1 if missing in dev/production.
// M-002: emit adapter.config.missing as a structured log event, not unstructured stderr.
if (!FileSessionWal.validateConfig(celloEnv, walDir)) {
  logger.error("adapter.config.missing", { missingKey: "WAL_DIR", env: celloEnv });
  process.exit(1);
}

// PERSIST-013: select WAL adapter based on CELLO_ENV.
// CELLO_ENV=local → InMemorySessionWal (no file I/O, crash recovery not available).
// CELLO_ENV=dev/staging/production → FileSessionWal with WAL_DIR from env.
// TODO(PERSIST-014): pass sessionWal to createRelayNode once relay-node.ts integrates WAL on hash_submit.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sessionWal = celloEnv === "local"
  ? new InMemorySessionWal({ logger })
  : new FileSessionWal({ walDir, logger });

if (!dirPubkeyHex && process.env["NODE_ENV"] !== "test") {
  logger.error("relay.startup.failed", {
    reason: "CELLO_DIRECTORY_PUBKEY is required",
    hint: "Set CELLO_DIRECTORY_PUBKEY to a 64-char lowercase hex string (32-byte Ed25519 pubkey)",
    testHint: "Set NODE_ENV=test to use a random ephemeral key (test mode only)",
  });
  process.exit(1);
}

// Decode directory pubkey
let dirPubkey: Uint8Array;
if (dirPubkeyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(dirPubkeyHex)) {
    logger.error("relay.startup.failed", {
      reason: "CELLO_DIRECTORY_PUBKEY must be a 64-char lowercase hex string (32-byte Ed25519 pubkey)",
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

// Load or generate relay signing keypair (FileKeyProvider format — same as directory)
let kp: FileKeyProvider;
try {
  kp = await FileKeyProvider.load(keyPath);
} catch (err: unknown) {
  const reason = err instanceof Error ? err.message : String(err);
  logger.error("relay.startup.failed", { reason: `key file error: ${reason}`, keyPath });
  process.exit(1);
}

const relayPubkey = await kp.getPublicKey();
logger.info("relay.startup.pubkey", { pubkey: Buffer.from(relayPubkey).toString("hex") });

// Load or generate persisted transport key (ensures stable Peer ID across restarts)
let transportPrivateKey: Uint8Array;
try {
  transportPrivateKey = readFileSync(transportKeyPath);
} catch {
  transportPrivateKey = randomBytes(32);
  mkdirSync(join(homedir(), ".cello"), { recursive: true });
  writeFileSync(transportKeyPath, transportPrivateKey, { mode: 0o600 });
  logger.info("relay.startup.transport-key.generated", { transportKeyPath });
}

// Wire NetworkDirectoryAdapter if CELLO_DIRECTORY_MULTIADDR is set
let directoryAdapter: NetworkDirectoryAdapter | undefined;
if (directoryMultiaddr) {
  const parts = directoryMultiaddr.split("/");
  const p2pIndex = parts.findIndex((p) => p === "p2p");
  const dirPeerId = p2pIndex !== -1 ? parts[p2pIndex + 1] : null;
  if (!dirPeerId) {
    logger.error("relay.startup.failed", {
      reason: "CELLO_DIRECTORY_MULTIADDR must include /p2p/<peer-id>",
      directoryMultiaddr,
    });
    process.exit(1);
  }
  directoryAdapter = new NetworkDirectoryAdapter({
    directoryPeerId: dirPeerId,
    directoryMultiaddrs: [directoryMultiaddr],
  });
  logger.info("relay.startup.directory-adapter", { directoryMultiaddr });
}

let relayResult: Awaited<ReturnType<typeof createRelayNode>>;
try {
  relayResult = await createRelayNode({
    listenAddresses: [listenAddr],
    directoryPubkey: dirPubkey,
    keyProvider: kp,
    transportPrivateKey,
    directory: directoryAdapter,
  });
} catch (err: unknown) {
  const reason = err instanceof Error ? err.message : String(err);
  logger.error("relay.startup.failed", { reason });
  process.exit(1);
}

// Wire node into adapter after relay starts
if (directoryAdapter) {
  directoryAdapter.connect(relayResult.node);
}

for (const addr of relayResult.node.listenAddresses()) {
  logger.info("relay.started.listening", { addr: String(addr) });
}
logger.info("relay.started", { peerId: relayResult.node.getPeerId() });

const shutdown = () => {
  relayResult.stop().catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("relay.shutdown.failed", { reason });
  }).finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
