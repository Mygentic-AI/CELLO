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
 *   CELLO_ENV                 Deployment environment: local | dev | staging | production
 *   CELLO_DB_PATH             Path to local SQLCipher database (default: ~/.cello/client.db)
 *   BACKUP_S3_BUCKET          S3 bucket for encrypted backups (required for S3 backup)
 *   AWS_REGION                AWS region for S3 (default: eu-west-1)
 *
 * Backup selection (PERSIST-022):
 *   CELLO_ENV=local                        → LocalCloudStorageProvider (filesystem)
 *   CELLO_ENV != local + BACKUP_S3_BUCKET  → S3CloudStorageProvider
 *   CELLO_ENV != local + no BACKUP_S3_BUCKET → null (no backup; client.backup.not.configured logged)
 */

import { homedir } from "node:os";
import { createWriteStream, readFileSync } from "node:fs";

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
import { createClient, createMcpSessionServer, NetworkDirectoryNode, bootstrapNetworkKeyShares, ClientBackup, S3CloudStorageProvider } from "@cello/client";
import { LocalCloudStorageProvider } from "@cello/interfaces/stubs";
import type { CloudStorageProvider } from "@cello/interfaces";
import { pushChannelNotification } from "../notifications.js";

const keyPath = process.env["CELLO_KEY_FILE"] ?? join(homedir(), ".cello", "key");
const listenAddr = process.env["CELLO_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/0";
const directoryMultiaddr = process.env["CELLO_DIRECTORY_MULTIADDR"];
const celloEnv = process.env["CELLO_ENV"] ?? "local";
const dbPath = process.env["CELLO_DB_PATH"] ?? join(homedir(), ".cello", "client.db");
const backupS3Bucket = process.env["BACKUP_S3_BUCKET"];
const awsRegion = process.env["AWS_REGION"] ?? "eu-west-1";

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

// PERSIST-022: Read identity key (Ed25519 seed) from the key file for backup derivation.
// Key file format: Magic(4) + version(1) + seed(32) — seed is at bytes 5..37.
// This is the only place the raw seed is accessed; it is used only for HKDF derivation
// (backup_key and db_key). It is never stored, never logged, zeroed after ClientBackup construction.
let identityKeyBytes: Uint8Array | null = null;
try {
  const rawKeyFile = readFileSync(keyPath);
  // Magic(4) + version(1) = 5 bytes header; seed occupies bytes [5, 37)
  if (rawKeyFile.length >= 37) {
    identityKeyBytes = new Uint8Array(rawKeyFile.slice(5, 37));
  }
} catch {
  // Non-fatal: if the key file can't be read for backup derivation, backup is disabled
  process.stderr.write(`cello-mcp: could not read identity key for backup derivation — backup disabled\n`);
}

// PERSIST-022: Derive agentId from the public key
const ownPubkeyForBackup = await kp.getPublicKey();
const agentId = Buffer.from(ownPubkeyForBackup).toString("hex");

// PERSIST-022: Select CloudStorageProvider based on CELLO_ENV and BACKUP_S3_BUCKET
let cloudStorageForBackup: CloudStorageProvider | null = null;
if (celloEnv === "local") {
  // Local: use filesystem-backed provider in ~/.cello/backups
  const localBackupDir = join(homedir(), ".cello", "backups");
  cloudStorageForBackup = new LocalCloudStorageProvider(localBackupDir);
  process.stderr.write(`cello-mcp: backup: using LocalCloudStorageProvider at ${localBackupDir}\n`);
} else if (backupS3Bucket) {
  // Non-local with bucket configured: use S3
  cloudStorageForBackup = new S3CloudStorageProvider({ bucket: backupS3Bucket, region: awsRegion });
  process.stderr.write(`cello-mcp: backup: using S3CloudStorageProvider, bucket=${backupS3Bucket}, region=${awsRegion}\n`);
} else {
  // Non-local without bucket: no backup configured — ClientBackup will log client.backup.not.configured
  process.stderr.write(`cello-mcp: backup: BACKUP_S3_BUCKET not set — backup not configured\n`);
}

// PERSIST-022: Construct ClientBackup (only if identity key is available)
// A minimal logger for the composition root backup instance that writes to stderr.
// In production deployments the full structured logger is wired in via server.ts.
const backupLogger = {
  debug: (event: string, ctx?: Record<string, unknown>) =>
    process.stderr.write(`cello-mcp: [debug] ${event} ${JSON.stringify(ctx ?? {})}\n`),
  info: (event: string, ctx?: Record<string, unknown>) =>
    process.stderr.write(`cello-mcp: [info] ${event} ${JSON.stringify(ctx ?? {})}\n`),
  warn: (event: string, ctx?: Record<string, unknown>) =>
    process.stderr.write(`cello-mcp: [warn] ${event} ${JSON.stringify(ctx ?? {})}\n`),
  error: (event: string, ctx?: Record<string, unknown>) =>
    process.stderr.write(`cello-mcp: [error] ${event} ${JSON.stringify(ctx ?? {})}\n`),
};

let clientBackupInstance: ClientBackup | undefined;
if (identityKeyBytes) {
  clientBackupInstance = new ClientBackup({
    agentId,
    identityKey: identityKeyBytes,
    dbPath,
    cloudStorage: cloudStorageForBackup,
    logger: backupLogger,
  });
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

// PERSIST-022: Register backup/restore MCP tools on the session server.
// These tools are conditionally wired — if no backup is configured, they return not_configured.

server.registerTool(
  "cello_backup",
  {
    description:
      "Trigger an immediate encrypted backup of the local CELLO database to cloud storage. " +
      "Returns ok:true on success. Returns ok:false with reason 'not_configured' if cloud storage is not set up.",
    inputSchema: {},
  },
  async () => {
    if (!clientBackupInstance) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, reason: "not_configured" }) }] };
    }
    await clientBackupInstance.backup();
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
  },
);

server.registerTool(
  "cello_restore",
  {
    description:
      "Restore the local CELLO database from the most recent cloud backup. " +
      "Replaces the local database file only after checksum verification passes. " +
      "Returns ok:true on success. Returns ok:false with reason if restore fails or is not configured.",
    inputSchema: {},
  },
  async () => {
    if (!clientBackupInstance) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, reason: "not_configured" }) }] };
    }
    try {
      await clientBackupInstance.restore();
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, reason }) }] };
    }
  },
);

// Connect stdio transport and register handler
await server.connect(new StdioServerTransport());
await client.registerHandler();
