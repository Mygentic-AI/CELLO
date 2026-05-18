#!/usr/bin/env node
/**
 * cello-mcp — single-identity CELLO MCP server
 *
 * One key file. One libp2p node. One client. One MCP server.
 * Two agents = two separate processes, each running this binary with their own CELLO_KEY_FILE.
 *
 * Environment variables:
 *   CELLO_KEY_FILE            Path to Ed25519 key file (default: ~/.cello/key)
 *   CELLO_LISTEN_ADDR         libp2p listen address (default: /ip4/0.0.0.0/tcp/0)
 *   CELLO_DIRECTORY_MULTIADDR Directory multiaddr (required for FROST sessions)
 *   NODE_ENV=test             Enables FROST bootstrap (production will use real DKG)
 */

import { homedir } from "node:os";
import { createWriteStream } from "node:fs";

// Tee stderr to a log file for diagnostics (especially [sigstream] instrumentation)
const stderrLog = createWriteStream("/tmp/cello-mcp-stderr.log", { flags: "a" });
const origWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
  stderrLog.write(chunk);
  return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
};
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FileKeyProvider, FrostThresholdSigner } from "@cello/crypto";
import { bootstrapKeyShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello/crypto/frost/stubs.js";
import { createNode } from "@cello/transport";
import { createClient, createMcpSessionServer, NetworkDirectoryNode, bootstrapNetworkKeyShares } from "@cello/client";
import { pushChannelNotification } from "../notifications.js";

const keyPath = process.env["CELLO_KEY_FILE"] ?? join(homedir(), ".cello", "key");
const listenAddr = process.env["CELLO_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/0";
const directoryMultiaddr = process.env["CELLO_DIRECTORY_MULTIADDR"];

// Load key
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

// Create and start single node
const node = await createNode({ keyProvider: kp, listenAddresses: [listenAddr] });
await node.start();

// Bootstrap FROST key shares (test-only shortcut)
// In production (M3+), real DKG ceremony replaces this.
let thresholdSigner: FrostThresholdSigner | undefined;
let primaryPubkey: Uint8Array | undefined;

process.stderr.write(`cello-mcp: NODE_ENV=${process.env.NODE_ENV ?? "(unset)"} CELLO_DIRECTORY_MULTIADDR=${directoryMultiaddr ?? "(unset)"}\n`);

if (process.env.NODE_ENV === "test") {
  const ownPubkey = await kp.getPublicKey();

  if (directoryMultiaddr && directoryEndpoint) {
    process.stderr.write(`cello-mcp: bootstrapping FROST via network directory...\n`);
    try {
      await node.dial(directoryEndpoint.multiaddrs[0]!);
      process.stderr.write(`cello-mcp: node dialed directory OK\n`);

      const networkNodes = [new NetworkDirectoryNode({
        id: `cello-test-node-0000`,
        node,
        directoryPeerId: directoryEndpoint.peer_id,
        directoryMultiaddrs: directoryEndpoint.multiaddrs,
      })];

      const bootstrap = await bootstrapNetworkKeyShares(ownPubkey, {
        threshold: 2,
        participants: 1,
        directoryNodes: networkNodes,
      });
      thresholdSigner = bootstrap.signer;
      primaryPubkey = bootstrap.primaryPubkey;
      process.stderr.write(`cello-mcp: FROST bootstrap OK, primaryPubkey=${Buffer.from(primaryPubkey).toString("hex").slice(0, 16)}...\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : JSON.stringify(err);
      process.stderr.write(`cello-mcp: FROST bootstrap FAILED: ${msg}\n`);
      process.stderr.write(`cello-mcp: falling back to in-process stubs\n`);
      // Fall back to in-process stubs so the server starts but without directory FROST
      const stubs = createInProcessStubs(3);
      const ownPubkeyFresh = await kp.getPublicKey();
      const bootstrapResult = await bootstrapKeyShares(ownPubkeyFresh, { threshold: 2, participants: 3, directoryNodeStubs: stubs });
      thresholdSigner = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubs }, ownPubkeyFresh);
      primaryPubkey = bootstrapResult.primaryPubkey;
    }
  } else {
    // Fallback: in-process stubs (no directory reachable)
    const stubs = createInProcessStubs(3);
    const ownPubkeyFresh = await kp.getPublicKey();
    const bootstrapResult = await bootstrapKeyShares(ownPubkeyFresh, { threshold: 2, participants: 3, directoryNodeStubs: stubs });
    thresholdSigner = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubs }, ownPubkeyFresh);
    primaryPubkey = bootstrapResult.primaryPubkey;
  }
}

// Late-bound server reference — set after createMcpServer returns.
// The closure captures the box; notifications fired before server is assigned are dropped.
let mcpServer: McpServer | undefined;

// Create single client
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

// Create server with single identity.
// PERSIST-017: checkpointStatusProvider is not available in the cello-mcp binary
// (the client binary has no access to the directory's MmrStore). The provider is
// wired in directory-facing deployments via the server.ts composition root.
// Passing undefined is a safe fallback — the tools return M1 stub responses.
const server = createMcpSessionServer(node, client, kp);
mcpServer = server;

// Connect stdio transport and register handler
await server.connect(new StdioServerTransport());
await client.registerHandler();
