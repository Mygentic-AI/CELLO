/**
 * CELLO-MCP-001 — M0 MCP Tool Surface tests (RETIRED)
 *
 * ADAPTER-002 removed the M0 tool set (cello_connect_peer, cello_list_peers,
 * peer-keyed cello_send/cello_receive) and replaced it with the M1 session-aware
 * surface. These tests are skipped to preserve historical context.
 *
 * M1 e2e coverage lives in mcp-002.test.ts.
 * Adapter-layer unit coverage lives in adapter-001.test.ts and adapter-002.test.ts.
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
import { createSingleIdentityServer as createMcpServer } from "@cello/adapter-claude-code";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

setupV3Tests();

// ─── helpers ─────────────────────────────────────────────────────────────────

interface McpPair {
  mcpClientA: Client;
  mcpClientB: Client;
  // Direct access to underlying CelloClients for waitFor polling
  celloClientA: ReturnType<typeof createClient>;
  celloClientB: ReturnType<typeof createClient>;
  listenAddrB: string;
  ownPubkeyA: string;
  ownPubkeyB: string;
  cleanup: () => Promise<void>;
}

async function makeMcpPair(): Promise<McpPair> {
  const kpA = generateKeypair();
  const kpB = generateKeypair();

  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });

  await nodeA.start();
  await nodeB.start();

  const clientA = createClient(nodeA, kpA);
  const clientB = createClient(nodeB, kpB);

  await clientA.registerHandler();
  await clientB.registerHandler();

  const serverA = createMcpServer(nodeA, clientA, kpA);
  const serverB = createMcpServer(nodeB, clientB, kpB);

  const [serverTransportA, clientTransportA] = InMemoryTransport.createLinkedPair();
  const [serverTransportB, clientTransportB] = InMemoryTransport.createLinkedPair();

  await serverA.connect(serverTransportA);
  await serverB.connect(serverTransportB);

  const mcpClientA = new Client({ name: "test-a", version: "0.0.1" });
  const mcpClientB = new Client({ name: "test-b", version: "0.0.1" });

  await mcpClientA.connect(clientTransportA);
  await mcpClientB.connect(clientTransportB);

  const listenAddrB = nodeB.listenAddresses()[0]!;
  const ownPubkeyA = Buffer.from(await kpA.getPublicKey()).toString("hex");
  const ownPubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");

  const cleanup = async () => {
    try { await mcpClientA.close(); } catch {}
    try { await mcpClientB.close(); } catch {}
    try { await serverA.close(); } catch {}
    try { await serverB.close(); } catch {}
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
  };

  return { mcpClientA, mcpClientB, celloClientA: clientA, celloClientB: clientB, listenAddrB, ownPubkeyA, ownPubkeyB, cleanup };
}

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

// ─── scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-001: cello_connect_peer returns connected:true, peer_pubkey ───────────

describe.skip("AC-001: cello_connect_peer succeeds, returns connected:true and peer_pubkey", () => {
  it("AC-001: A connects to B via multiaddr → connected:true, peer_pubkey is 64-char hex", async () => {
    const { mcpClientA, listenAddrB, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClientA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };

    expect(result.connected).toBe(true);
    expect(result.peer_pubkey).toMatch(/^[0-9a-f]{64}$/);
  }, 15_000);
});

// ─── AC-002: send + receive round-trip ────────────────────────────────────────

describe.skip("AC-002: cello_send + cello_receive round-trip", () => {
  it("AC-002: A sends 'hello', B receives it with correct sender_pubkey and content_hash", async () => {
    const { mcpClientA, mcpClientB, listenAddrB, ownPubkeyA, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    const connectResult = parseResult(
      await mcpClientA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectResult.connected).toBe(true);
    const peerPubkeyB = connectResult.peer_pubkey;

    const sendResult = parseResult(
      await mcpClientA.callTool({ name: "cello_send", arguments: { identity: "A", peer_pubkey: peerPubkeyB, content: "hello" } })
    ) as { delivered: boolean; content_hash: string };

    expect(sendResult.delivered).toBe(true);
    expect(sendResult.content_hash).toMatch(/^[0-9a-f]+$/);

    const receiveResult = parseResult(
      await mcpClientB.callTool({ name: "cello_receive", arguments: { identity: "A", timeout_ms: 5000 } })
    ) as { type: string; content: string; sender_pubkey: string; content_hash: string; timestamp: number };

    expect(receiveResult.type).toBe("message");
    expect(receiveResult.content).toBe("hello");
    expect(receiveResult.sender_pubkey).toBe(ownPubkeyA);
    expect(receiveResult.content_hash).toMatch(/^[0-9a-f]+$/);
    expect(receiveResult.timestamp).toBeGreaterThan(0);
  }, 15_000);
});

// ─── AC-003: cello_receive with no messages → timeout ────────────────────────

describe.skip("AC-003: cello_receive with empty queue → timeout", () => {
  it("AC-003: no messages in queue → {type: 'timeout'} after ~200ms", async () => {
    const { mcpClientA, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    const before = Date.now();
    const result = parseResult(
      await mcpClientA.callTool({ name: "cello_receive", arguments: { identity: "A", timeout_ms: 200 } })
    ) as { type: string };

    expect(result.type).toBe("timeout");
    expect(Date.now() - before).toBeGreaterThanOrEqual(180);
  }, 10_000);
});

// ─── AC-004: cello_send without connect → peer_not_connected, no dial ─────────

describe.skip("AC-004: cello_send without prior connect → peer_not_connected", () => {
  it("AC-004: unknown peer_pubkey → {delivered: false, reason: 'peer_not_connected'}", async () => {
    const { mcpClientA, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    const fakePubkey = Buffer.from(new Uint8Array(32).fill(0xab)).toString("hex");
    const result = parseResult(
      await mcpClientA.callTool({ name: "cello_send", arguments: { identity: "A", peer_pubkey: fakePubkey, content: "hi" } })
    ) as { delivered: boolean; reason: string };

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("peer_not_connected");
  }, 10_000);
});

// ─── AC-005: cello_status returns expected fields ─────────────────────────────

describe.skip("AC-005: cello_status returns transport_started, own_pubkey, listen_addresses, etc.", () => {
  it("AC-005: all required fields present and valid", async () => {
    const { mcpClientA, ownPubkeyA, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClientA.callTool({ name: "cello_status", arguments: { identity: "A", identity: "A" } })
    ) as {
      transport_started: boolean;
      own_pubkey: string;
      listen_addresses: string[];
      connected_peer_count: number;
      uptime_seconds: number;
    };

    expect(result.transport_started).toBe(true);
    expect(result.own_pubkey).toBe(ownPubkeyA);
    expect(result.listen_addresses.length).toBeGreaterThan(0);
    expect(result.connected_peer_count).toBeGreaterThanOrEqual(0);
    expect(result.uptime_seconds).toBeGreaterThanOrEqual(0);
  }, 10_000);
});

// ─── AC-006: factory produces identical wiring under InMemoryTransport ─────────

describe.skip("AC-006: createMcpServer is transport-agnostic (same tool set and wiring)", () => {
  it("AC-006: two instances have identical tool names, descriptions, and input schemas", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    scope.addCleanup(async () => { try { await nodeA.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeB.stop(); } catch {} });

    const clientA = createClient(nodeA, kpA);
    const clientB = createClient(nodeB, kpB);
    await clientA.registerHandler();
    await clientB.registerHandler();

    const serverA = createMcpServer(nodeA, clientA, kpA);
    const serverB = createMcpServer(nodeB, clientB, kpB);

    const [stA, ctA] = InMemoryTransport.createLinkedPair();
    const [stB, ctB] = InMemoryTransport.createLinkedPair();
    await serverA.connect(stA);
    await serverB.connect(stB);

    const mcpA = new Client({ name: "test-a", version: "0.0.1" });
    const mcpB = new Client({ name: "test-b", version: "0.0.1" });
    await mcpA.connect(ctA);
    await mcpB.connect(ctB);
    scope.addCleanup(async () => { try { await mcpA.close(); } catch {}; try { await mcpB.close(); } catch {} });
    scope.addCleanup(async () => { try { await serverA.close(); } catch {}; try { await serverB.close(); } catch {} });

    const sortByName = (tools: Tool[]) =>
      [...tools].sort((a, b) => a.name.localeCompare(b.name));

    const toolsA = sortByName((await mcpA.listTools()).tools);
    const toolsB = sortByName((await mcpB.listTools()).tools);

    // Same tool count and names
    expect(toolsA.map((t) => t.name)).toEqual([
      "cello_connect_peer",
      "cello_list_peers",
      "cello_receive",
      "cello_send",
      "cello_status",
    ]);

    // Structural equality: descriptions and input schemas must match between instances
    expect(toolsA.map((t) => t.description)).toEqual(toolsB.map((t) => t.description));
    expect(toolsA.map((t) => t.inputSchema)).toEqual(toolsB.map((t) => t.inputSchema));
  }, 15_000);
});

// ─── AC-007: bidirectional messaging ─────────────────────────────────────────

describe.skip("AC-007: A sends 5 to B, B sends 3 to A, all arrive with correct attribution", () => {
  it("AC-007: bidirectional drain — A has 3 from B, B has 5 from A", async () => {
    const { mcpClientA, mcpClientB, celloClientA, celloClientB, listenAddrB, ownPubkeyA, ownPubkeyB, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    // Connect A→B and B→A
    const connectAB = parseResult(
      await mcpClientA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectAB.connected).toBe(true);
    const peerPubkeyB = connectAB.peer_pubkey;

    // B needs A's listen address to connect back
    const statusA = parseResult(
      await mcpClientA.callTool({ name: "cello_status", arguments: { identity: "A", identity: "A" } })
    ) as { listen_addresses: string[] };
    const listenAddrA = statusA.listen_addresses[0]!;

    const connectBA = parseResult(
      await mcpClientB.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: listenAddrA } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectBA.connected).toBe(true);
    const peerPubkeyA = connectBA.peer_pubkey;

    // A sends 5 to B
    for (let i = 0; i < 5; i++) {
      const r = parseResult(
        await mcpClientA.callTool({ name: "cello_send", arguments: { identity: "A", peer_pubkey: peerPubkeyB, content: `a-to-b-${i}` } })
      ) as { delivered: boolean };
      expect(r.delivered).toBe(true);
    }

    // B sends 3 to A
    for (let i = 0; i < 3; i++) {
      const r = parseResult(
        await mcpClientB.callTool({ name: "cello_send", arguments: { identity: "A", peer_pubkey: peerPubkeyA, content: `b-to-a-${i}` } })
      ) as { delivered: boolean };
      expect(r.delivered).toBe(true);
    }

    // Wait for all 5 to land in B's queue before draining
    await waitFor(
      () => celloClientB.peekAll().filter((e) => e.senderPubkeyHex === ownPubkeyA).length >= 5,
      { timeout: 10_000 }
    );

    // Drain B's queue — expect 5 from A
    const bMessages: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = parseResult(
        await mcpClientB.callTool({ name: "cello_receive", arguments: { identity: "A", timeout_ms: 5000 } })
      ) as { type: string; content: string; sender_pubkey: string };
      expect(r.type).toBe("message");
      expect(r.sender_pubkey).toBe(ownPubkeyA);
      bMessages.push(r.content);
    }
    expect(bMessages.sort()).toEqual(["a-to-b-0", "a-to-b-1", "a-to-b-2", "a-to-b-3", "a-to-b-4"]);

    // Wait for all 3 to land in A's queue before draining
    await waitFor(
      () => celloClientA.peekAll().filter((e) => e.senderPubkeyHex === ownPubkeyB).length >= 3,
      { timeout: 10_000 }
    );

    // Drain A's queue — expect 3 from B
    const aMessages: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = parseResult(
        await mcpClientA.callTool({ name: "cello_receive", arguments: { identity: "A", timeout_ms: 5000 } })
      ) as { type: string; content: string; sender_pubkey: string };
      expect(r.type).toBe("message");
      expect(r.sender_pubkey).toBe(ownPubkeyB);
      aMessages.push(r.content);
    }
    expect(aMessages.sort()).toEqual(["b-to-a-0", "b-to-a-1", "b-to-a-2"]);
  }, 30_000);
});

// ─── AC-008: cello_list_peers ─────────────────────────────────────────────────

describe.skip("AC-008: cello_list_peers returns connected peers", () => {
  it("AC-008: after connecting to B and C, A lists 2 peers", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const kpC = generateKeypair();

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeC = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });

    await nodeA.start(); await nodeB.start(); await nodeC.start();
    scope.addCleanup(async () => { try { await nodeA.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeB.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeC.stop(); } catch {} });

    const clientA = createClient(nodeA, kpA);
    const clientB = createClient(nodeB, kpB);
    const clientC = createClient(nodeC, kpC);
    await clientA.registerHandler();
    await clientB.registerHandler();
    await clientC.registerHandler();

    const serverA = createMcpServer(nodeA, clientA, kpA);
    const [stA, ctA] = InMemoryTransport.createLinkedPair();
    await serverA.connect(stA);
    const mcpA = new Client({ name: "test-a", version: "0.0.1" });
    await mcpA.connect(ctA);
    scope.addCleanup(async () => { try { await mcpA.close(); } catch {} });
    scope.addCleanup(async () => { try { await serverA.close(); } catch {} });

    await mcpA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: nodeB.listenAddresses()[0]! } });
    await mcpA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: nodeC.listenAddresses()[0]! } });

    const result = parseResult(
      await mcpA.callTool({ name: "cello_list_peers", arguments: { identity: "A", identity: "A" } })
    ) as Array<{ peer_pubkey: string; multiaddrs: string[]; connected: boolean }>;

    expect(result.length).toBe(2);
    expect(result.every((p) => p.connected)).toBe(true);
    expect(result.every((p) => /^[0-9a-f]{64}$/.test(p.peer_pubkey))).toBe(true);
  }, 20_000);
});

// ─── AC-009: transport_not_started guard on operational tools ─────────────────

describe.skip("AC-009: tools return transport_not_started before transport is started", () => {
  it("AC-009: cello_send, cello_connect_peer, cello_receive, cello_list_peers return transport_not_started; cello_status responds normally", async () => {
    const kp = generateKeypair();
    // createNode without start() — transport is not started
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const client = createClient(node, kp);
    const server = createMcpServer(node, client, kp);

    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const fakePubkey = Buffer.from(new Uint8Array(32).fill(0x01)).toString("hex");

    for (const [name, args] of [
      ["cello_connect_peer", { multiaddr: "/ip4/127.0.0.1/tcp/0" }],
      ["cello_send", { peer_pubkey: fakePubkey, content: "hi" }],
      ["cello_receive", { timeout_ms: 100 }],
      ["cello_list_peers", {}],
    ] as const) {
      const r = parseResult(
        await mcpClient.callTool({ name, arguments: args })
      ) as { error?: { reason: string } };
      expect(r.error?.reason).toBe("transport_not_started");
    }

    // cello_status must still respond (transport_started: false, but no error)
    const statusResult = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: { identity: "A", identity: "A" } })
    ) as { transport_started: boolean };
    expect(statusResult.transport_started).toBe(false);
    expect((statusResult as Record<string, unknown>).error).toBeUndefined();
  }, 10_000);
});

// ─── AC-010: content_too_large ────────────────────────────────────────────────

describe.skip("AC-010: content whose UTF-8 encoding exceeds 1 MiB → content_too_large", () => {
  it("AC-010: 1 MiB + 1 byte content → {delivered: false, reason: 'content_too_large', content_hash: null}", async () => {
    const { mcpClientA, listenAddrB, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    const connectResult = parseResult(
      await mcpClientA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectResult.connected).toBe(true);

    // 1 MiB + 1 byte ASCII string
    const oversized = "x".repeat(1_048_577);
    const result = parseResult(
      await mcpClientA.callTool({ name: "cello_send", arguments: { identity: "A", peer_pubkey: connectResult.peer_pubkey, content: oversized } })
    ) as { delivered: boolean; reason: string; content_hash: unknown };

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("content_too_large");
    expect(result.content_hash).toBeNull();
  }, 15_000);
});

// ─── AC-011: peer_pubkey round-trip (connect output → send input) ─────────────

describe.skip("AC-011: peer_pubkey from cello_connect_peer is directly usable in cello_send", () => {
  it("AC-011: exact peer_pubkey string from connect output passed to send — no case-folding needed", async () => {
    const { mcpClientA, listenAddrB, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    const connectResult = parseResult(
      await mcpClientA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };

    // Must be lowercase hex, no 0x prefix
    expect(connectResult.peer_pubkey).toMatch(/^[0-9a-f]{64}$/);

    const sendResult = parseResult(
      await mcpClientA.callTool({
        name: "cello_send",
        arguments: { identity: "A", peer_pubkey: connectResult.peer_pubkey, content: "round-trip" },
      })
    ) as { delivered: boolean };

    expect(sendResult.delivered).toBe(true);
  }, 15_000);
});

// ─── AC-012: filtered receive does not consume non-matching messages ───────────

describe.skip("AC-012: filtered cello_receive does not consume messages from other senders", () => {
  it("AC-012: filter for B while C's message is queued → timeout; C's message survives for subsequent receive", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const kpC = generateKeypair();

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeC = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });

    await nodeA.start(); await nodeB.start(); await nodeC.start();
    scope.addCleanup(async () => { try { await nodeA.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeB.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeC.stop(); } catch {} });

    const clientA = createClient(nodeA, kpA);
    const clientB = createClient(nodeB, kpB);
    const clientC = createClient(nodeC, kpC);
    await clientA.registerHandler();
    await clientB.registerHandler();
    await clientC.registerHandler();

    const serverA = createMcpServer(nodeA, clientA, kpA);
    const [stA, ctA] = InMemoryTransport.createLinkedPair();
    await serverA.connect(stA);
    const mcpA = new Client({ name: "test-a", version: "0.0.1" });
    await mcpA.connect(ctA);
    scope.addCleanup(async () => { try { await mcpA.close(); } catch {} });
    scope.addCleanup(async () => { try { await serverA.close(); } catch {} });

    // C connects to A and sends a message
    const serverC = createMcpServer(nodeC, clientC, kpC);
    const [stC, ctC] = InMemoryTransport.createLinkedPair();
    await serverC.connect(stC);
    const mcpC = new Client({ name: "test-c", version: "0.0.1" });
    await mcpC.connect(ctC);
    scope.addCleanup(async () => { try { await mcpC.close(); } catch {} });
    scope.addCleanup(async () => { try { await serverC.close(); } catch {} });

    // C dials A and sends
    const connectCA = parseResult(
      await mcpC.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: nodeA.listenAddresses()[0]! } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectCA.connected).toBe(true);

    // Also set up A's registry so it can receive from C
    // C's peer_pubkey in the registry is the transport key — but incoming envelopes use K_local
    // We need to register C's K_local pubkey in A's client so peekAll surfaced from sender_pubkey matches
    // The MCP receive is by sender_pubkey (K_local hex), not by the transport peer_pubkey
    const ownPubkeyC = Buffer.from(await kpC.getPublicKey()).toString("hex");

    const sendResult = parseResult(
      await mcpC.callTool({ name: "cello_send", arguments: { identity: "A", peer_pubkey: connectCA.peer_pubkey, content: "from-C" } })
    ) as { delivered: boolean };
    expect(sendResult.delivered).toBe(true);

    // Wait for A to receive C's message
    await waitFor(() => clientA.peekAll().some((e) => e.senderPubkeyHex === ownPubkeyC), { timeout: 5000 });

    // B's K_local pubkey — B never sent anything, so filtering for it should time out
    const ownPubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");

    // Filtered receive for B's pubkey → timeout (B sent nothing)
    const timeoutResult = parseResult(
      await mcpA.callTool({ name: "cello_receive", arguments: { identity: "A", peer_pubkey: ownPubkeyB, timeout_ms: 200 } })
    ) as { type: string };
    expect(timeoutResult.type).toBe("timeout");

    // C's message must still be in the queue
    const cMessage = parseResult(
      await mcpA.callTool({ name: "cello_receive", arguments: { identity: "A", peer_pubkey: ownPubkeyC, timeout_ms: 1000 } })
    ) as { type: string; content: string };
    expect(cMessage.type).toBe("message");
    expect(cMessage.content).toBe("from-C");
  }, 20_000);
});

// ─── SI-001: no private key material in tool responses ────────────────────────

describe.skip("SI-001: no K_local private key material in any tool response", () => {
  it("SI-001: own_pubkey equals the public key (not the private key); no extra fields", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const client = createClient(node, kp);
    await client.registerHandler();
    const server = createMcpServer(node, client, kp);

    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const expectedPublicKey = Buffer.from(await kp.getPublicKey()).toString("hex");

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: { identity: "A", identity: "A" } })
    ) as Record<string, unknown>;

    // own_pubkey must equal the public key exactly
    expect(result.own_pubkey).toBe(expectedPublicKey);

    // No private key material: no unexpected top-level keys
    const keys = Object.keys(result);
    expect(keys).not.toContain("private_key");
    expect(keys).not.toContain("secret");
    expect(keys).not.toContain("seed");
    expect(keys.sort()).toEqual(
      ["connected_peer_count", "listen_addresses", "own_pubkey", "transport_started", "uptime_seconds"]
    );
  }, 10_000);
});

// ─── SI-002: cello_receive only delivers MSG-002-verified envelopes ───────────

describe.skip("SI-002: cello_receive never surfaces messages with invalid signatures", () => {
  it("SI-002: tampered-signature envelope injected via sendRaw does not appear in cello_receive; valid envelope does", async () => {
    const { mcpClientA, mcpClientB, celloClientA, celloClientB, listenAddrB, ownPubkeyA, cleanup } = await makeMcpPair();
    scope.addCleanup(cleanup);

    // Connect A → B
    const connectResult = parseResult(
      await mcpClientA.callTool({ name: "cello_connect_peer", arguments: { identity: "A", multiaddr: listenAddrB } })
    ) as { connected: boolean; peer_pubkey: string };
    expect(connectResult.connected).toBe(true);

    // Inject a tampered envelope via sendRaw — B's MSG-002 validation should reject it
    const { buildEnvelope, serializeEnvelope } = await import("@cello/protocol-types");
    const { randomBytes } = await import("node:crypto");

    const buildResult = await buildEnvelope(new TextEncoder().encode("tampered"), generateKeypair(), Date.now());
    if (!buildResult.ok) throw new Error("build failed");
    const badEnvelope = { ...buildResult.envelope, sender_signature: new Uint8Array(randomBytes(64)) };
    const badBytes = serializeEnvelope(badEnvelope);

    // sendRaw is accessible via the CelloClient factory's extended type
    await (celloClientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<unknown>;
    }).sendRaw(connectResult.peer_pubkey, badBytes);

    // Send a valid message immediately after — to confirm B's queue only has the valid one
    const sendResult = parseResult(
      await mcpClientA.callTool({
        name: "cello_send",
        arguments: { identity: "A", peer_pubkey: connectResult.peer_pubkey, content: "valid" },
      })
    ) as { delivered: boolean };
    expect(sendResult.delivered).toBe(true);

    // Wait for the valid message to land
    await waitFor(() => celloClientB.peekAll().some((e) => e.senderPubkeyHex === ownPubkeyA), { timeout: 5000 });

    // Drain — must get exactly "valid", never "tampered"
    const receiveResult = parseResult(
      await mcpClientB.callTool({ name: "cello_receive", arguments: { identity: "A", timeout_ms: 1000 } })
    ) as { type: string; content?: string };

    expect(receiveResult.type).toBe("message");
    expect(receiveResult.content).toBe("valid");

    // Queue must now be empty — tampered envelope was rejected by MSG-002
    const emptyResult = parseResult(
      await mcpClientB.callTool({ name: "cello_receive", arguments: { identity: "A", timeout_ms: 200 } })
    ) as { type: string };
    expect(emptyResult.type).toBe("timeout");
  }, 15_000);
});
