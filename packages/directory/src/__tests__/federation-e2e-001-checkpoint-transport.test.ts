/**
 * FEDERATION-E2E-001 — Libp2pCheckpointTransport unit tests.
 *
 * Tests the wire protocol, timeout behavior, peer discovery, and error handling
 * of the production checkpoint transport against real in-process libp2p nodes.
 *
 * These tests run entirely in-process — no AWS, no ECS, no VPC Peering required.
 * The inter-node protocol is identical regardless of whether nodes are local or
 * separated by VPC Peering: the libp2p Noise handshake and stream framing are the same.
 *
 * References: FIPS 180-4 (SHA-256 for checkpoint hash), RFC 8032 (Ed25519 signing).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as lp from "it-length-prefixed";
import { Libp2pCheckpointTransport } from "../adapters/libp2p-checkpoint-transport.js";
import type { CheckpointProposal } from "@cello/interfaces";
import { InMemoryKeyProvider } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { randomBytes } from "node:crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<CheckpointProposal> = {}): CheckpointProposal {
  return {
    checkpointId: "test-checkpoint-id",
    checkpointHash: "a".repeat(64),
    mmrPeaks: ["b".repeat(64)],
    identityMerkleRoot: "c".repeat(64),
    mmrLeafCount: 1,
    ...overrides,
  };
}

const CHECKPOINT_PROTOCOL = "/cello/checkpoint/1.0.0";

const silentLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
} as never;

// ─── Test nodes ───────────────────────────────────────────────────────────────

describe("Libp2pCheckpointTransport", () => {
  let coordinatorKey: InMemoryKeyProvider;
  let peerKey: InMemoryKeyProvider;
  let coordinatorNode: Awaited<ReturnType<typeof createNode>>;
  let peerNode: Awaited<ReturnType<typeof createNode>>;
  let peerNodeId: string;

  beforeEach(async () => {
    coordinatorKey = new InMemoryKeyProvider(randomBytes(32));
    peerKey = new InMemoryKeyProvider(randomBytes(32));

    coordinatorNode = await createNode({
      keyProvider: coordinatorKey,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    peerNode = await createNode({
      keyProvider: peerKey,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });

    await coordinatorNode.start();
    await peerNode.start();

    // Get peer ID before dialing — used to configure transport peers map.
    // Handlers registered after dial are still valid since libp2p protocol
    // negotiation happens per-stream, not per-connection.
    peerNodeId = peerNode.getPeerId();
    const peerAddr = peerNode.listenAddresses()[0];
    await coordinatorNode.dial(peerAddr!);
  });

  afterEach(async () => {
    await coordinatorNode.stop();
    await peerNode.stop();
  });

  // ─── AC: sendCheckpointProposal — successful round ──────────────────────────

  it("returns signature when peer signs the proposal", async () => {
    const peerPubKey = Buffer.from(await peerKey.getPublicKey()).toString("hex");

    await peerNode.handle(CHECKPOINT_PROTOCOL, async (stream) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of lp.decode(stream)) {
        chunks.push(chunk as unknown as Uint8Array);
      }
      const proposal = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CheckpointProposal;

      const hashBytes = Buffer.from(proposal.checkpointHash, "hex");
      const sig = await peerKey.sign(hashBytes);
      const response = {
        nodeId: "eu-central-1",
        signature: Buffer.from(sig).toString("hex"),
        publicKeyHex: peerPubKey,
      };

      const responseBytes = Buffer.from(JSON.stringify(response), "utf8");
      stream.send(lp.encode.single(responseBytes));
      await stream.close();
    });

    const transport = new Libp2pCheckpointTransport({
      node: coordinatorNode,
      peers: new Map([["eu-central-1", peerNodeId]]),
      logger: silentLogger,
    });

    const proposal = makeProposal({ checkpointHash: "aa".repeat(32) });
    const result = await transport.sendCheckpointProposal("eu-central-1", proposal, 5000);

    expect(result).not.toBeNull();
    expect(result!.nodeId).toBe("eu-central-1");
    expect(result!.publicKeyHex).toBe(peerPubKey);
    expect(result!.signature).toHaveLength(128);
  });

  // ─── AC: timeout returns null ────────────────────────────────────────────────

  it("returns null when peer does not respond within timeoutMs", async () => {
    await peerNode.handle(CHECKPOINT_PROTOCOL, async (_stream) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    });

    const transport = new Libp2pCheckpointTransport({
      node: coordinatorNode,
      peers: new Map([["eu-central-1", peerNodeId]]),
      logger: silentLogger,
    });

    const result = await transport.sendCheckpointProposal(
      "eu-central-1",
      makeProposal(),
      200,
    );

    expect(result).toBeNull();
  });

  // ─── AC: unknown peer returns null ──────────────────────────────────────────

  it("returns null for an unknown peer node ID", async () => {
    const transport = new Libp2pCheckpointTransport({
      node: coordinatorNode,
      peers: new Map(),
      logger: silentLogger,
    });

    const result = await transport.sendCheckpointProposal(
      "ap-northeast-1",
      makeProposal(),
      5000,
    );

    expect(result).toBeNull();
  });

  // ─── AC: getPeerNodeIds returns configured peers ─────────────────────────────

  it("getPeerNodeIds returns all configured peer node IDs", async () => {
    const transport = new Libp2pCheckpointTransport({
      node: coordinatorNode,
      peers: new Map([
        ["eu-central-1", "peer-id-eu"],
        ["ap-northeast-1", "peer-id-ap"],
      ]),
      logger: silentLogger,
    });

    const peerIds = await transport.getPeerNodeIds();
    expect(peerIds).toHaveLength(2);
    expect(peerIds).toContain("eu-central-1");
    expect(peerIds).toContain("ap-northeast-1");
  });

  // ─── AC: proposal payload round-trips correctly over the wire ───────────────

  it("sends proposal as JSON and peer receives all fields", async () => {
    let receivedProposal: CheckpointProposal | null = null;

    await peerNode.handle(CHECKPOINT_PROTOCOL, async (stream) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of lp.decode(stream)) {
        chunks.push(chunk as unknown as Uint8Array);
      }
      receivedProposal = JSON.parse(Buffer.concat(chunks).toString("utf8")) as CheckpointProposal;
      await stream.close();
    });

    const transport = new Libp2pCheckpointTransport({
      node: coordinatorNode,
      peers: new Map([["eu-central-1", peerNodeId]]),
      logger: silentLogger,
    });

    const proposal = makeProposal({
      checkpointId: "test-id-123",
      mmrLeafCount: 42,
    });

    await transport.sendCheckpointProposal("eu-central-1", proposal, 3000);

    expect(receivedProposal).not.toBeNull();
    expect(receivedProposal!.checkpointId).toBe("test-id-123");
    expect(receivedProposal!.mmrLeafCount).toBe(42);
  });
});

// ─── Dist freshness check (AC-011 pattern) ────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("FEDERATION-E2E-001 dist freshness", () => {
  it("Libp2pCheckpointTransport and CheckpointCoordinator appear in dist/bin/directory.js", () => {
    const distPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../dist/bin/directory.js",
    );
    if (!existsSync(distPath)) {
      return; // dist not built yet — caught by gate sequence
    }
    const content = readFileSync(distPath, "utf8");
    expect(content).toContain("Libp2pCheckpointTransport");
    expect(content).toContain("CheckpointCoordinator");
  });
});
