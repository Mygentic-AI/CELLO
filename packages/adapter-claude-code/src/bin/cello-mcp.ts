#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FileKeyProvider, FrostThresholdSigner } from "@cello/crypto";
import { bootstrapKeyShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello/crypto/frost/stubs.js";
import { createNode } from "@cello/transport";
import { createClient } from "@cello/client";
import { createMcpServer } from "../server.js";
import { pushChannelNotification } from "../notifications.js";

const keyPathA = process.env["CELLO_KEY_FILE_A"] ?? join(homedir(), ".cello", "key");
const keyPathB = process.env["CELLO_KEY_FILE_B"] ?? join(homedir(), ".cello", "key-agent-b");
const listenAddrA = process.env["CELLO_LISTEN_ADDR_A"] ?? "/ip4/0.0.0.0/tcp/0";
const listenAddrB = process.env["CELLO_LISTEN_ADDR_B"] ?? "/ip4/0.0.0.0/tcp/0";
const directoryMultiaddr = process.env["CELLO_DIRECTORY_MULTIADDR"];

// Load both keys
let kpA: FileKeyProvider;
let kpB: FileKeyProvider;
try {
  kpA = await FileKeyProvider.load(keyPathA);
  kpB = await FileKeyProvider.load(keyPathB);
} catch (err: unknown) {
  const msg = typeof err === "object" && err !== null && "message" in err
    ? (err as { message: string }).message
    : String(err);
  process.stderr.write(`cello-mcp: key file error: ${msg}\n`);
  process.exit(1);
}

// Create two nodes (one per identity)
const nodeA = await createNode({ keyProvider: kpA, listenAddresses: [listenAddrA] });
const nodeB = await createNode({ keyProvider: kpB, listenAddresses: [listenAddrB] });

// CELLO-E2E-002: Bootstrap FROST key shares (test-only)
// In production (M3+), real DKG ceremony will replace this test-harness shortcut.
let thresholdSignerA: FrostThresholdSigner | undefined;
let primaryPubkeyA: Uint8Array | undefined;
let thresholdSignerB: FrostThresholdSigner | undefined;
let primaryPubkeyB: Uint8Array | undefined;
if (process.env.NODE_ENV === "test") {
  const ownPubkeyA = await kpA.getPublicKey();
  const stubsA = createInProcessStubs(3);
  const bootstrapResultA = await bootstrapKeyShares(ownPubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
  thresholdSignerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, ownPubkeyA);
  primaryPubkeyA = bootstrapResultA.primaryPubkey;

  const ownPubkeyB = await kpB.getPublicKey();
  const stubsB = createInProcessStubs(3);
  const bootstrapResultB = await bootstrapKeyShares(ownPubkeyB, { threshold: 2, participants: 3, directoryNodeStubs: stubsB });
  thresholdSignerB = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsB }, ownPubkeyB);
  primaryPubkeyB = bootstrapResultB.primaryPubkey;
}

// Parse directory endpoint from CELLO_DIRECTORY_MULTIADDR (if set)
let directoryEndpoint: { peer_id: string; multiaddrs: string[] } | undefined = undefined;
if (directoryMultiaddr) {
  const parts = directoryMultiaddr.split("/");
  const p2pIndex = parts.findIndex((p) => p === "p2p");
  const peerId = p2pIndex !== -1 ? parts[p2pIndex + 1] : null;
  if (peerId) {
    directoryEndpoint = { peer_id: peerId, multiaddrs: [directoryMultiaddr] };
  } else {
    process.stderr.write("cello-mcp: CELLO_DIRECTORY_MULTIADDR must include /p2p/<peer-id>\n");
  }
}

// Late-bound server reference — set after createMcpServer returns.
// The closure captures the box; notifications fired before server is assigned are dropped.
let mcpServer: McpServer | undefined;

// Create two clients (one per identity)
const clientA = createClient(nodeA, kpA, {
  thresholdSigner: thresholdSignerA,
  directoryEndpoint,
  onMessageQueued: (senderHex) => {
    if (mcpServer) void pushChannelNotification(mcpServer, senderHex);
  },
});

const clientB = createClient(nodeB, kpB, {
  thresholdSigner: thresholdSignerB,
  directoryEndpoint,
  onMessageQueued: (senderHex) => {
    if (mcpServer) void pushChannelNotification(mcpServer, senderHex);
  },
});

if (primaryPubkeyA) {
  clientA.setPrimaryPubkey(primaryPubkeyA);
}

if (primaryPubkeyB) {
  clientB.setPrimaryPubkey(primaryPubkeyB);
}

// Create server with both identities
const server = createMcpServer({
  A: { node: nodeA, client: clientA, keyProvider: kpA },
  B: { node: nodeB, client: clientB, keyProvider: kpB },
});
mcpServer = server;

// Transport must be live before inbound connections are accepted (node.start()).
await server.connect(new StdioServerTransport());
await clientA.registerHandler();
await clientB.registerHandler();
await nodeA.start();
await nodeB.start();
