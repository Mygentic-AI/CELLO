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
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { FileKeyProvider, generateKeypair } from "@cello/crypto";
import { createRelayNode } from "../index.js";

const keyPath = process.env["CELLO_RELAY_KEY_FILE"] ?? join(homedir(), ".cello", "relay-key");
const transportKeyPath = process.env["CELLO_RELAY_TRANSPORT_KEY_FILE"] ?? join(homedir(), ".cello", "relay-transport-key");
const listenAddr = process.env["CELLO_RELAY_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/4001";
const dirPubkeyHex = process.env["CELLO_DIRECTORY_PUBKEY"];

if (!dirPubkeyHex && process.env["NODE_ENV"] !== "test") {
  process.stderr.write("cello-relay: CELLO_DIRECTORY_PUBKEY is required\n");
  process.stderr.write("Example: CELLO_DIRECTORY_PUBKEY=<64-hex-chars> cello-relay\n");
  process.stderr.write("Set NODE_ENV=test to use a random ephemeral key (test mode only)\n");
  process.exit(1);
}

// Decode directory pubkey
let dirPubkey: Uint8Array;
if (dirPubkeyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(dirPubkeyHex)) {
    process.stderr.write("cello-relay: CELLO_DIRECTORY_PUBKEY must be a 64-char lowercase hex string (32-byte Ed25519 pubkey)\n");
    process.exit(1);
  }
  dirPubkey = new Uint8Array(Buffer.from(dirPubkeyHex, "hex"));
} else {
  // Test mode only: use a random ephemeral pubkey
  const ephemeralKp = generateKeypair();
  dirPubkey = await ephemeralKp.getPublicKey();
  process.stderr.write("cello-relay: WARNING: CELLO_DIRECTORY_PUBKEY not set; using ephemeral key (test mode only)\n");
}

// Load or generate relay signing keypair (FileKeyProvider format — same as directory)
let kp: FileKeyProvider;
try {
  kp = await FileKeyProvider.load(keyPath);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cello-relay: key file error: ${msg}\n`);
  process.exit(1);
}

const relayPubkey = await kp.getPublicKey();
process.stdout.write(`cello-relay pubkey: ${Buffer.from(relayPubkey).toString("hex")}\n`);

// Load or generate persisted transport key (ensures stable Peer ID across restarts)
let transportPrivateKey: Uint8Array;
try {
  transportPrivateKey = readFileSync(transportKeyPath);
} catch {
  transportPrivateKey = randomBytes(32);
  mkdirSync(join(homedir(), ".cello"), { recursive: true });
  writeFileSync(transportKeyPath, transportPrivateKey, { mode: 0o600 });
  process.stdout.write(`cello-relay: generated new transport key at ${transportKeyPath}\n`);
}

let relayResult: Awaited<ReturnType<typeof createRelayNode>>;
try {
  relayResult = await createRelayNode({
    listenAddresses: [listenAddr],
    directoryPubkey: dirPubkey,
    keyProvider: kp,
    transportPrivateKey,
  });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cello-relay: startup error: ${msg}\n`);
  process.exit(1);
}

for (const addr of relayResult.node.listenAddresses()) {
  process.stdout.write(`cello-relay listening on ${addr}\n`);
}
process.stdout.write(`cello-relay peer-id: ${relayResult.node.getPeerId()}\n`);

const shutdown = () => {
  relayResult.stop().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cello-relay: stop error: ${msg}\n`);
  }).finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
