/**
 * CELLO-E2E-001 — Same-machine proxy for two-agent signed message exchange
 *
 * Covers AC-002 through AC-007 using in-process libp2p nodes.
 * Uses real Noise-encrypted TCP connections on loopback.
 *
 * Exclusions (require two physical machines on different networks):
 *   AC-001 — real network boundary verification
 *   AC-008 — DCuTR / circuit relay path recording
 *
 * AC-003 proxy: "Claude Code wakes up automatically" is validated here as
 * "notifications/claude/channel fires on the MCP wire with correct params."
 * The --channels runtime behaviour itself requires a live Claude Code session.
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  waitFor,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { createClient } from "@cello/client";
import { createMcpServer, pushChannelNotification } from "@cello/adapter-claude-code";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

setupV3Tests();

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

interface E2EPair {
  mcpA: Client;
  mcpB: Client;
  clientA: ReturnType<typeof createClient>;
  clientB: ReturnType<typeof createClient>;
  ownPubkeyA: string;
  ownPubkeyB: string;
  listenAddrA: string;
  listenAddrB: string;
  notificationsA: Notification[];
  notificationsB: Notification[];
  cleanup: () => Promise<void>;
}

async function makeE2EPair(): Promise<E2EPair> {
  const kpA = generateKeypair();
  const kpB = generateKeypair();

  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await nodeA.start();
  await nodeB.start();

  const notificationsA: Notification[] = [];
  const notificationsB: Notification[] = [];

  // Late-bound server references — same pattern as cello-mcp.ts
  let serverA: McpServer | undefined;
  let serverB: McpServer | undefined;

  const clientA = createClient(nodeA, kpA, {
    onMessageQueued: (from) => { if (serverA) void pushChannelNotification(serverA, from); },
  });
  const clientB = createClient(nodeB, kpB, {
    onMessageQueued: (from) => { if (serverB) void pushChannelNotification(serverB, from); },
  });

  // createMcpServer is synchronous — serverA/serverB are set before any messages can arrive
  serverA = createMcpServer(nodeA, clientA, kpA);
  serverB = createMcpServer(nodeB, clientB, kpB);

  await clientA.registerHandler();
  await clientB.registerHandler();

  const [stA, ctA] = InMemoryTransport.createLinkedPair();
  const [stB, ctB] = InMemoryTransport.createLinkedPair();
  await serverA.connect(stA);
  await serverB.connect(stB);

  const mcpA = new Client({ name: "agent-a", version: "0.0.1" });
  const mcpB = new Client({ name: "agent-b", version: "0.0.1" });

  // Must register before connect so no notifications are missed during handshake
  (mcpA as unknown as { fallbackNotificationHandler: (n: Notification) => void })
    .fallbackNotificationHandler = (n) => { notificationsA.push(n); };
  (mcpB as unknown as { fallbackNotificationHandler: (n: Notification) => void })
    .fallbackNotificationHandler = (n) => { notificationsB.push(n); };

  await mcpA.connect(ctA);
  await mcpB.connect(ctB);

  const ownPubkeyA = Buffer.from(await kpA.getPublicKey()).toString("hex");
  const ownPubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");
  const listenAddrA = nodeA.listenAddresses()[0]!;
  const listenAddrB = nodeB.listenAddresses()[0]!;

  const cleanup = async () => {
    try { await mcpA.close(); } catch {}
    try { await mcpB.close(); } catch {}
    try { await serverA!.close(); } catch {}
    try { await serverB!.close(); } catch {}
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
  };

  return {
    mcpA, mcpB, clientA, clientB,
    ownPubkeyA, ownPubkeyB,
    listenAddrA, listenAddrB,
    notificationsA, notificationsB,
    cleanup,
  };
}

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-002 + AC-003 + AC-004 ─────────────────────────────────────────────────

describe("AC-002 + AC-003 + AC-004: send delivers; channel notification fires on B; B receives correct message", () => {
  it("AC-002+003+004: delivered:true with content_hash; notifications/claude/channel on B's MCP wire; B receive returns correct content and sender", async () => {
    const { mcpA, mcpB, ownPubkeyA, listenAddrB, notificationsB, cleanup } = await makeE2EPair();
    scope.addCleanup(cleanup);

    // A connects to B
    const connectResult = parseResult(
      await mcpA.callTool({ name: "cello_connect_peer", arguments: { multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectResult.connected).toBe(true);

    // AC-002: A sends "hello from A"
    const sendResult = parseResult(
      await mcpA.callTool({
        name: "cello_send",
        arguments: { peer_pubkey: connectResult.peer_pubkey, content: "hello from A" },
      })
    ) as { delivered: boolean; content_hash: string };
    expect(sendResult.delivered).toBe(true);
    expect(sendResult.content_hash).toMatch(/^[0-9a-f]+$/);

    // AC-003 (proxy): notifications/claude/channel fires on B's MCP wire
    await waitFor(
      () => notificationsB.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 5000 }
    );
    const notif = notificationsB.find((n) => n.method === "notifications/claude/channel")!;
    const params = notif.params as Record<string, unknown>;
    expect(params.type).toBe("cello_message");
    expect(params.from).toBe(ownPubkeyA);
    expect(params.content).toBeUndefined(); // no message content in notification

    // AC-004: B calls cello_receive → correct content, sender, and hash
    const receiveResult = parseResult(
      await mcpB.callTool({ name: "cello_receive", arguments: { timeout_ms: 5000 } })
    ) as { type: string; content: string; sender_pubkey: string; content_hash: string };
    expect(receiveResult.type).toBe("message");
    expect(receiveResult.content).toBe("hello from A");
    expect(receiveResult.sender_pubkey).toBe(ownPubkeyA);
    expect(receiveResult.content_hash).toBe(sendResult.content_hash);
  }, 20_000);
});

// ─── AC-005 ───────────────────────────────────────────────────────────────────

describe("AC-005: B replies; A's channel notification fires; A receives reply", () => {
  it("AC-005: full A→B→A signed exchange; notifications on both sides; both receives return correct content", async () => {
    const {
      mcpA, mcpB,
      ownPubkeyA, ownPubkeyB,
      listenAddrA, listenAddrB,
      notificationsA, notificationsB,
      cleanup,
    } = await makeE2EPair();
    scope.addCleanup(cleanup);

    // A connects to B; B connects to A (for the reply)
    const connectAB = parseResult(
      await mcpA.callTool({ name: "cello_connect_peer", arguments: { multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectAB.connected).toBe(true);

    const connectBA = parseResult(
      await mcpB.callTool({ name: "cello_connect_peer", arguments: { multiaddr: listenAddrA } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectBA.connected).toBe(true);

    // A sends "hello from A"
    const aSend = parseResult(
      await mcpA.callTool({
        name: "cello_send",
        arguments: { peer_pubkey: connectAB.peer_pubkey, content: "hello from A" },
      })
    ) as { delivered: boolean };
    expect(aSend.delivered).toBe(true);

    // B's notification fires
    await waitFor(
      () => notificationsB.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 5000 }
    );

    // B receives
    const bReceive = parseResult(
      await mcpB.callTool({ name: "cello_receive", arguments: { timeout_ms: 5000 } })
    ) as { type: string; content: string; sender_pubkey: string };
    expect(bReceive.type).toBe("message");
    expect(bReceive.content).toBe("hello from A");
    expect(bReceive.sender_pubkey).toBe(ownPubkeyA);

    // B replies "hello from B"
    const bSend = parseResult(
      await mcpB.callTool({
        name: "cello_send",
        arguments: { peer_pubkey: connectBA.peer_pubkey, content: "hello from B" },
      })
    ) as { delivered: boolean };
    expect(bSend.delivered).toBe(true);

    // A's notification fires
    await waitFor(
      () => notificationsA.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 5000 }
    );
    const aNotif = notificationsA.find((n) => n.method === "notifications/claude/channel")!;
    expect((aNotif.params as Record<string, unknown>).from).toBe(ownPubkeyB);

    // A receives
    const aReceive = parseResult(
      await mcpA.callTool({ name: "cello_receive", arguments: { timeout_ms: 5000 } })
    ) as { type: string; content: string; sender_pubkey: string };
    expect(aReceive.type).toBe("message");
    expect(aReceive.content).toBe("hello from B");
    expect(aReceive.sender_pubkey).toBe(ownPubkeyB);
  }, 25_000);
});

// ─── AC-006 ───────────────────────────────────────────────────────────────────

describe("AC-006: byte-flipped envelope is silently rejected; no notification; cello_receive times out", () => {
  it("AC-006: tampered content causes content_hash mismatch → B rejects; no notifications/claude/channel; B receive → timeout", async () => {
    const { mcpA, mcpB, clientA, notificationsB, listenAddrB, cleanup } = await makeE2EPair();
    scope.addCleanup(cleanup);

    const connectResult = parseResult(
      await mcpA.callTool({ name: "cello_connect_peer", arguments: { multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectResult.connected).toBe(true);

    // Build a valid envelope and flip a byte in content — causes content_hash mismatch on B
    const { buildEnvelope, serializeEnvelope } = await import("@cello/protocol-types");
    const buildResult = await buildEnvelope(
      new TextEncoder().encode("original"),
      generateKeypair(),
      Date.now()
    );
    if (!buildResult.ok) throw new Error("buildEnvelope failed in test setup");

    const tamperedContent = new Uint8Array(buildResult.envelope.content);
    tamperedContent[0] ^= 0xff;
    const tamperedEnvelope = { ...buildResult.envelope, content: tamperedContent };
    const tamperedBytes = serializeEnvelope(tamperedEnvelope);

    await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<unknown>;
    }).sendRaw(connectResult.peer_pubkey, tamperedBytes);

    // Allow time for B's inbound handler to process the frame and reject it
    await new Promise<void>((resolve) => setTimeout(resolve, 400));

    // No channel notification must have fired for the tampered envelope
    const channelNotifs = notificationsB.filter((n) => n.method === "notifications/claude/channel");
    expect(channelNotifs).toHaveLength(0);

    // B's receive must time out — tampered envelope was never enqueued
    const receiveResult = parseResult(
      await mcpB.callTool({ name: "cello_receive", arguments: { timeout_ms: 500 } })
    ) as { type: string };
    expect(receiveResult.type).toBe("timeout");
  }, 15_000);
});

// ─── AC-007 ───────────────────────────────────────────────────────────────────

describe("AC-007: cello_status cross-check — connected_peer_count:1; own_pubkey matches sender_pubkey", () => {
  it("AC-007: both statuses show 1 connection; B's received sender_pubkey equals A's own_pubkey", async () => {
    const { mcpA, mcpB, ownPubkeyA, ownPubkeyB, listenAddrB, cleanup } = await makeE2EPair();
    scope.addCleanup(cleanup);

    // A connects to B only — one connection in libp2p from A's side and one from B's side
    const connectResult = parseResult(
      await mcpA.callTool({ name: "cello_connect_peer", arguments: { multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectResult.connected).toBe(true);

    // A sends to B
    await mcpA.callTool({
      name: "cello_send",
      arguments: { peer_pubkey: connectResult.peer_pubkey, content: "hello from A" },
    });

    // B receives (waits for delivery)
    const bReceive = parseResult(
      await mcpB.callTool({ name: "cello_receive", arguments: { timeout_ms: 5000 } })
    ) as { type: string; content: string; sender_pubkey: string };
    expect(bReceive.type).toBe("message");

    // AC-007: status on A
    const statusA = parseResult(
      await mcpA.callTool({ name: "cello_status", arguments: {} })
    ) as { transport_started: boolean; own_pubkey: string; connected_peer_count: number };
    expect(statusA.transport_started).toBe(true);
    expect(statusA.own_pubkey).toBe(ownPubkeyA);
    expect(statusA.connected_peer_count).toBe(1);

    // AC-007: status on B
    const statusB = parseResult(
      await mcpB.callTool({ name: "cello_status", arguments: {} })
    ) as { transport_started: boolean; own_pubkey: string; connected_peer_count: number };
    expect(statusB.transport_started).toBe(true);
    expect(statusB.own_pubkey).toBe(ownPubkeyB);
    expect(statusB.connected_peer_count).toBe(1);

    // Pubkey cross-match: B's received sender_pubkey equals A's own_pubkey
    expect(bReceive.sender_pubkey).toBe(statusA.own_pubkey);
  }, 20_000);
});
