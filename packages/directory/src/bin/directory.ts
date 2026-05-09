#!/usr/bin/env node
/**
 * CELLO Directory binary (CELLO-NODE-004)
 *
 * Environment variables:
 *   CELLO_DIRECTORY_KEY_FILE    — path to persisted directory signing keypair (default: ~/.cello/directory-key)
 *   CELLO_DIRECTORY_LISTEN_ADDR — libp2p listen address (default: /ip4/0.0.0.0/tcp/4000)
 *   CELLO_RELAY_MULTIADDR       — relay multiaddr (required)
 *                                  Format: /ip4/<host>/tcp/<port>/p2p/<peer-id>
 *                                  The directory connects to the relay at startup using NetworkRelayAdapter.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { FileKeyProvider } from "@cello/crypto";
import { createDirectoryNode } from "../directory-node.js";
import { NetworkRelayAdapter } from "../network-relay-adapter.js";
import { InMemoryDirectoryStore } from "../directory-store.js";
import { InMemoryShareStore } from "../share-store.js";

const keyPath = process.env["CELLO_DIRECTORY_KEY_FILE"] ?? join(homedir(), ".cello", "directory-key");
const listenAddr = process.env["CELLO_DIRECTORY_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/4000";
const relayAddr = process.env["CELLO_RELAY_MULTIADDR"];

if (!relayAddr) {
  process.stderr.write("cello-directory: CELLO_RELAY_MULTIADDR is required\n");
  process.stderr.write("Example: CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/<peer-id>\n");
  process.exit(1);
}

let kp: FileKeyProvider;
try {
  kp = await FileKeyProvider.load(keyPath);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cello-directory: key file error: ${msg}\n`);
  process.exit(1);
}

const store = new InMemoryDirectoryStore();
const shareStore = new InMemoryShareStore();

// Parse relay multiaddr to extract peer_id
const relayParts = relayAddr.split("/");
const p2pIndex = relayParts.findIndex((p) => p === "p2p");
const relayPeerId = p2pIndex !== -1 ? relayParts[p2pIndex + 1] : "";

if (!relayPeerId) {
  process.stderr.write("cello-directory: CELLO_RELAY_MULTIADDR must include /p2p/<peer-id>\n");
  process.exit(1);
}

// NetworkRelayAdapter: directory communicates with relay via /cello/directory-relay/1.0.0
// Signs each outbound frame with the directory's signing key.
const networkRelay = new NetworkRelayAdapter({
  keyProvider: kp,
  relayPeerId,
  relayMultiaddrs: [relayAddr],
});

const dirPubkey = await kp.getPublicKey();
process.stdout.write(`cello-directory pubkey: ${Buffer.from(dirPubkey).toString("hex")}\n`);

let result: Awaited<ReturnType<typeof createDirectoryNode>>;
try {
  result = await createDirectoryNode({
    keyProvider: kp,
    listenAddresses: [listenAddr],
    relay: networkRelay,
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: [relayAddr] },
    store,
    shareStore,
  });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cello-directory: startup error: ${msg}\n`);
  process.exit(1);
}

// Connect adapter after directory node is started
try {
  await networkRelay.connect(result.node);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  // Log but don't exit — relay may not be reachable yet; adapter will retry on each call
  process.stderr.write(`cello-directory: relay connection warning: ${msg}\n`);
}

for (const addr of result.node.listenAddresses()) {
  process.stdout.write(`cello-directory listening on ${addr}\n`);
}
process.stdout.write(`cello-directory peer-id: ${result.node.getPeerId()}\n`);

const shutdown = () => {
  result.stop().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cello-directory: stop error: ${msg}\n`);
  }).finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
