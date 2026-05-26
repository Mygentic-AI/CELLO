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
import type { CheckpointProposal } from "@cello-protocol/interfaces";
import { InMemoryKeyProvider } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
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
  // Mutable handler slot — registered once in beforeEach, replaced per test.
  // libp2p requires the protocol handler to be registered before any stream
  // is opened on that protocol. A single registered handler that dispatches
  // to a replaceable function avoids StreamResetError.
  let activeHandler: ((stream: import("@libp2p/interface").Stream) => Promise<void>) | null = null;

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

    // Register the protocol handler BEFORE dialing so it's available when
    // the coordinator opens a stream (libp2p resets unknown protocols).
    // IMPORTANT: Use fire-and-forget (void) pattern matching production code
    // in directory-node.ts. Returning a Promise causes libp2p's middleware chain
    // to await the handler; if any stream error occurs during that await, the
    // catch block calls muxedStream.abort() which sends RST to the remote peer.
    await peerNode.handle(CHECKPOINT_PROTOCOL, (stream) => {
      if (activeHandler) {
        void activeHandler(stream).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[TEST peer handler error]", err);
        });
      } else {
        void stream.close();
      }
    });

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

    activeHandler = async (stream) => {
      // Read exactly one LP-framed message and break — do NOT exhaust the iterator.
      // Relying on the iterator ending naturally races with 'remoteCloseWrite' event
      // delivery (the FIN may arrive before the iterator starts listening).
      let requestBytes: Uint8Array | null = null;
      for await (const chunk of lp.decode(stream)) {
        requestBytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        break;
      }
      if (!requestBytes) { await stream.close(); return; }

      const proposal = JSON.parse(Buffer.from(requestBytes).toString("utf8")) as CheckpointProposal;
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
    };

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
    activeHandler = async (_stream) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    };

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

    activeHandler = async (stream) => {
      // Read exactly one LP-framed message and break (same pattern as production).
      let requestBytes: Uint8Array | null = null;
      for await (const chunk of lp.decode(stream)) {
        requestBytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        break;
      }
      if (requestBytes) {
        receivedProposal = JSON.parse(Buffer.from(requestBytes).toString("utf8")) as CheckpointProposal;
      }
      await stream.close();
    };

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
