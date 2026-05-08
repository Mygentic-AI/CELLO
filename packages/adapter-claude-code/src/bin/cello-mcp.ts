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

const keyPath = process.env["CELLO_KEY_FILE"] ?? join(homedir(), ".cello", "key");
const listenAddr = process.env["CELLO_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/0";
const directoryMultiaddr = process.env["CELLO_DIRECTORY_MULTIADDR"];

let kp: FileKeyProvider;
try {
  kp = await FileKeyProvider.load(keyPath);
} catch (err: unknown) {
  const msg = typeof err === "object" && err !== null && "message" in err
    ? (err as { message: string }).message
    : String(err);
  process.stderr.write(`cello-mcp: key file error: ${msg}\n`);
  process.exit(1);
}

const node = await createNode({ keyProvider: kp, listenAddresses: [listenAddr] });

// CELLO-E2E-002: Bootstrap FROST key shares (test-only)
// In production (M3+), real DKG ceremony will replace this test-harness shortcut.
let thresholdSigner: FrostThresholdSigner | undefined;
let primaryPubkey: Uint8Array | undefined;
if (process.env.NODE_ENV === "test") {
  const ownPubkey = await kp.getPublicKey();
  const stubs = createInProcessStubs(3);
  const bootstrapResult = await bootstrapKeyShares(ownPubkey, { threshold: 2, participants: 3, directoryNodeStubs: stubs });
  thresholdSigner = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubs }, ownPubkey);
  primaryPubkey = bootstrapResult.primaryPubkey;
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

const client = createClient(node, kp, {
  thresholdSigner,
  directoryEndpoint,
  onMessageQueued: (senderHex) => {
    if (mcpServer) void pushChannelNotification(mcpServer, senderHex);
  },
});

if (primaryPubkey) {
  client.setPrimaryPubkey(primaryPubkey);
}

const server = createMcpServer(node, client, kp);
mcpServer = server;

// Transport must be live before inbound connections are accepted (node.start()).
await server.connect(new StdioServerTransport());
await client.registerHandler();
await node.start();
