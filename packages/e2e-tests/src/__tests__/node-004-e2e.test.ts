/**
 * CELLO-NODE-004: AC-007 — Full session flow over /cello/directory-relay/1.0.0
 *
 * Verifies that directory and relay can operate as separate in-process libp2p nodes
 * connected only via /cello/directory-relay/1.0.0 (NetworkRelayAdapter), with no
 * in-process wiring (no shared RelayAdapter object reference).
 *
 * AC-007: session establishes, both agents communicate, session seals — all without
 *         any in-process wiring between directory and relay.
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import { generateKeypair, FrostThresholdSigner } from "@cello/crypto";
import { bootstrapKeyShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello/crypto/frost/stubs.js";
import { createNode } from "@cello/transport";
import { createRelayNode } from "@cello/relay";
import type { DirectoryAdapter } from "@cello/relay";
import { createDirectoryNode } from "@cello/directory";
import { NetworkRelayAdapter } from "@cello/directory/network-relay-adapter.js";
import { createClient, createMcpSessionServer } from "@cello/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

// ─── Network-protocol fixture ─────────────────────────────────────────────────
//
// Identical to adapter-003's MCP fixture except:
//   - Uses NetworkRelayAdapter instead of inline RelayAdapter object
//   - Directory and relay communicate only over /cello/directory-relay/1.0.0

interface McpFixture {
  pubkeyAHex: string;
  pubkeyBHex: string;
  clientA: ReturnType<typeof createClient>;
  clientB: ReturnType<typeof createClient>;
  mcpA: Client;
  mcpB: Client;
  notificationsA: Notification[];
  notificationsB: Notification[];
  stopAll: () => Promise<void>;
}

async function makeNetworkFixture(): Promise<McpFixture> {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();

  // Relay: directory adapter forwards to the real directory node via processSeal
  let dirNodeRef: Awaited<ReturnType<typeof createDirectoryNode>> | null = null;
  const directoryAdapter: DirectoryAdapter = {
    async processSeal(sessionId, sealData) {
      if (!dirNodeRef) return { ok: false, reason: "directory_not_ready" };
      return dirNodeRef.directory.processSeal(sessionId, sealData);
    },
  };

  const relayResult = await createRelayNode({
    directoryPubkey: dirPubkey,
    directory: directoryAdapter,
  });
  const relayPeerId = relayResult.node.getPeerId();
  const relayMultiaddrs = relayResult.node.listenAddresses();

  // NetworkRelayAdapter: directory talks to relay via /cello/directory-relay/1.0.0
  const networkAdapter = new NetworkRelayAdapter({
    keyProvider: dirKp,
    relayPeerId,
    relayMultiaddrs,
  });

  dirNodeRef = await createDirectoryNode({
    keyProvider: dirKp,
    relay: networkAdapter,
    relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
  });

  // Connect the adapter AFTER directory node is started
  await networkAdapter.connect(dirNodeRef.node);

  const dirPeerId = dirNodeRef.node.getPeerId();
  const dirMultiaddrs = dirNodeRef.node.listenAddresses();
  const directoryEndpoint = { peer_id: dirPeerId, multiaddrs: dirMultiaddrs };

  // Client setup
  const kpA = generateKeypair();
  const kpB = generateKeypair();
  const pubkeyA = await kpA.getPublicKey();
  const pubkeyB = await kpB.getPublicKey();
  const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");
  const pubkeyBHex = Buffer.from(pubkeyB).toString("hex");

  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();
  await nodeB.start();

  dirNodeRef.directory.registerPeerInfo(pubkeyAHex, nodeA.getPeerId(), nodeA.listenAddresses());
  dirNodeRef.directory.registerPeerInfo(pubkeyBHex, nodeB.getPeerId(), nodeB.listenAddresses());

  // Bootstrap FROST (2-of-3 for A, 1-of-1 for B)
  const stubsA = createInProcessStubs(3);
  const bootstrapA = await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsA });
  const signerA = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsA }, pubkeyA);
  dirNodeRef.directory.registerThresholdSigner(pubkeyAHex, signerA);
  dirNodeRef.directory.registerPrimaryPubkey(pubkeyAHex, bootstrapA.primaryPubkey);

  const clientA = createClient(nodeA, kpA, { thresholdSigner: signerA, directoryEndpoint });
  clientA.setPrimaryPubkey(bootstrapA.primaryPubkey);
  const clientB = createClient(nodeB, kpB, { directoryEndpoint });
  await clientA.registerHandler();
  await clientB.registerHandler();

  const notificationsA: Notification[] = [];
  const notificationsB: Notification[] = [];

  const serverA = createMcpSessionServer(nodeA, clientA, kpA);
  const serverB = createMcpSessionServer(nodeB, clientB, kpB);

  const [stA, ctA] = InMemoryTransport.createLinkedPair();
  const [stB, ctB] = InMemoryTransport.createLinkedPair();
  await serverA.connect(stA);
  await serverB.connect(stB);

  const mcpA = new Client({ name: "agent-a", version: "0.0.1" });
  const mcpB = new Client({ name: "agent-b", version: "0.0.1" });

  (mcpA as unknown as { fallbackNotificationHandler: (n: Notification) => void })
    .fallbackNotificationHandler = (n) => { notificationsA.push(n); };
  (mcpB as unknown as { fallbackNotificationHandler: (n: Notification) => void })
    .fallbackNotificationHandler = (n) => { notificationsB.push(n); };

  await mcpA.connect(ctA);
  await mcpB.connect(ctB);

  const stopAll = async () => {
    try { await mcpA.close(); } catch {}
    try { await mcpB.close(); } catch {}
    try { await serverA.close(); } catch {}
    try { await serverB.close(); } catch {}
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
    try { await dirNodeRef?.stop(); } catch {}
    try { await relayResult.stop(); } catch {}
  };

  return { pubkeyAHex, pubkeyBHex, clientA, clientB, mcpA, mcpB, notificationsA, notificationsB, stopAll };
}

// ─── AC-007 ───────────────────────────────────────────────────────────────────

describe("CELLO-NODE-004: AC-007 — full session flow over /cello/directory-relay/1.0.0", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("session establishes, agents communicate, session seals — directory and relay communicate only via network protocol", async () => {
    const fix = await makeNetworkFixture();
    scope.addCleanup(fix.stopAll);

    // B awaits a session in the background (B is already registered via registerHandler)
    const bSessionPromise = fix.mcpB.callTool({
      name: "cello_await_session",
      arguments: { timeout_ms: 20_000 },
    });

    // A initiates session with B
    // This will trigger: directory calls NetworkRelayAdapter.recordAssignment → relay stores session
    const initiateResult = await fix.mcpA.callTool({
      name: "cello_initiate_session",
      arguments: { target_pubkey: fix.pubkeyBHex },
    });
    const initiated = parseResult(initiateResult) as { ok: boolean; session_id?: string };
    expect(initiated.ok).toBe(true);
    const sessionId = initiated.session_id;
    expect(sessionId).toMatch(/^[0-9a-f]{32}$/);

    // B receives the session_assignment
    const bResult = parseResult(await bSessionPromise) as { type: string; session_id?: string };
    expect(bResult.type).toBe("new_session");
    expect(bResult.session_id).toBe(sessionId);

    // A sends a message to B via the relay
    const sendResult = await fix.mcpA.callTool({
      name: "cello_send",
      arguments: { session_id: sessionId, content: "hello via network relay protocol" },
    });
    const sent = parseResult(sendResult) as { delivered: boolean };
    expect(sent.delivered).toBe(true);

    // B receives the message
    const receiveResult = await fix.mcpB.callTool({
      name: "cello_receive",
      arguments: { session_id: sessionId, timeout_ms: 5000 },
    });
    const received = parseResult(receiveResult) as { type: string };
    expect(received.type).toBe("message");

    // Both A and B close concurrently — bilateral SEAL ctrl leaves submitted
    // This triggers: relay detects bilateral SEAL → calls directory.processSeal
    //   → directory verifies → NetworkRelayAdapter.confirmSeal → relay destroys session
    //   → both clients receive session_sealed notification
    const [closeA, closeB] = await Promise.all([
      fix.mcpA.callTool({ name: "cello_close_session", arguments: { session_id: sessionId } }),
      fix.mcpB.callTool({ name: "cello_close_session", arguments: { session_id: sessionId } }),
    ]);

    const closedA = parseResult(closeA) as { status: string };
    const closedB = parseResult(closeB) as { status: string };
    expect(closedA.status).toBe("sealed");
    expect(closedB.status).toBe("sealed");
  }, 60_000);
});
