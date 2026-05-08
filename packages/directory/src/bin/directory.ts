#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { FileKeyProvider } from "@cello/crypto";
import type { RelayAdapter } from "../directory-node.js";
import { createDirectoryNode } from "../directory-node.js";
import { InMemoryDirectoryStore } from "../directory-store.js";
import { InMemoryShareStore } from "../share-store.js";

const keyPath = process.env["CELLO_DIRECTORY_KEY_FILE"] ?? join(homedir(), ".cello", "directory-key");
const listenAddr = process.env["CELLO_DIRECTORY_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/4000";
const relayAddr = process.env["CELLO_RELAY_MULTIADDR"];

if (!relayAddr) {
  process.stderr.write("cello-directory: CELLO_RELAY_MULTIADDR is required\n");
  process.stderr.write("Example: CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/QmRelay...\n");
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

// Stub relay adapter — directory binary doesn't connect to relay directly.
// In production, relay and directory are separate processes. The relay adapter
// is only used in tests where both run in-process.
const stubRelay: RelayAdapter = {
  recordAssignment: () => ({ ok: false, reason: "relay_adapter_not_implemented_in_standalone_binary" }),
  discardSession: () => {},
  submitForSeal: () => ({ ok: false, reason: "relay_adapter_not_implemented_in_standalone_binary" }),
  confirmSeal: () => {},
  rejectSeal: () => {},
};

// Parse relay multiaddr to extract peer_id
const relayParts = relayAddr.split("/");
const p2pIndex = relayParts.findIndex((p) => p === "p2p");
const relayPeerId = p2pIndex !== -1 ? relayParts[p2pIndex + 1] : "";

if (!relayPeerId) {
  process.stderr.write("cello-directory: CELLO_RELAY_MULTIADDR must include /p2p/<peer-id>\n");
  process.exit(1);
}

let result: Awaited<ReturnType<typeof createDirectoryNode>>;
try {
  result = await createDirectoryNode({
    keyProvider: kp,
    listenAddresses: [listenAddr],
    relay: stubRelay,
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: [relayAddr] },
    store,
    shareStore,
  });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cello-directory: startup error: ${msg}\n`);
  process.exit(1);
}

for (const addr of result.node.listenAddresses()) {
  process.stdout.write(`cello-directory listening on ${addr}\n`);
}

const shutdown = () => {
  result.stop().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cello-directory: stop error: ${msg}\n`);
  }).finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
