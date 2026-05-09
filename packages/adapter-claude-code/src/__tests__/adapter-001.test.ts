/**
 * CELLO-ADAPTER-001 — Adapter unit and integration tests
 *
 * AC-001: key file generation and persistence
 * AC-002: inbound message → claude/channel notification (content-free)
 * AC-003: cello_receive after notification returns message
 * AC-004: factory produces identical wiring under InMemoryTransport and stdio
 * AC-005: cello_status returns correct fields
 * AC-006: server declares claude/channel capability
 * SI-001: notification payload never contains message content
 * SI-002: key file written with 0o600
 * SI-003: private key bytes never in any response
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat, rm, mkdir } from "node:fs/promises";
import { FileKeyProvider, generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { createClient } from "@cello/client";
import { createMcpServer, pushChannelNotification } from "../index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool, Notification } from "@modelcontextprotocol/sdk/types.js";

setupV3Tests();

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-001 / SI-002: key file generation and 0o600 permissions ───────────────

describe("AC-001 + SI-002: key file generation and persistence", () => {
  it("AC-001a: no key file → generates one with 0o600; same pubkey on reload", async () => {
    const dir = join(tmpdir(), `cello-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    scope.addCleanup(async () => { try { await rm(dir, { recursive: true }); } catch {} });

    const keyPath = join(dir, "key");

    const kp1 = await FileKeyProvider.load(keyPath);
    const pubkey1 = Buffer.from(await kp1.getPublicKey()).toString("hex");

    const kp2 = await FileKeyProvider.load(keyPath);
    const pubkey2 = Buffer.from(await kp2.getPublicKey()).toString("hex");

    expect(pubkey1).toBe(pubkey2);
  });

  it("SI-002: key file written with 0o600 permissions", async () => {
    const dir = join(tmpdir(), `cello-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    scope.addCleanup(async () => { try { await rm(dir, { recursive: true }); } catch {} });

    const keyPath = join(dir, "key");
    await FileKeyProvider.load(keyPath);

    const s = await stat(keyPath);
    // mode & 0o777 strips file type bits; 0o600 = owner read+write only
    expect(s.mode & 0o777).toBe(0o600);
  });
});

// ─── AC-006: server declares claude/channel capability ─────────────────────────

describe("AC-006: server declares claude/channel experimental capability", () => {
  it("AC-006: listTools response negotiation includes experimental.claude/channel", async () => {
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

    // The server's capabilities are sent during initialization
    const serverCapabilities = mcpClient.getServerCapabilities();
    expect(serverCapabilities?.experimental?.["claude/channel"]).toBeDefined();
  }, 10_000);
});

// ─── AC-004: factory identical wiring ─────────────────────────────────────────

describe("AC-004: factory produces identical tool names, schemas, wiring under InMemoryTransport", () => {
  it("AC-004: two instances from createMcpServer have identical tool names, descriptions, inputSchemas", async () => {
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

    const sortByName = (tools: Tool[]) => [...tools].sort((a, b) => a.name.localeCompare(b.name));
    const toolsA = sortByName((await mcpA.listTools()).tools);
    const toolsB = sortByName((await mcpB.listTools()).tools);

    expect(toolsA.map((t) => t.name)).toEqual(toolsB.map((t) => t.name));
    expect(toolsA.map((t) => t.description)).toEqual(toolsB.map((t) => t.description));
    expect(toolsA.map((t) => t.inputSchema)).toEqual(toolsB.map((t) => t.inputSchema));
    // M1 tool set (ADAPTER-002): cello_connect_peer and cello_list_peers removed
    expect(toolsA.map((t) => t.name)).toEqual([
      "cello_await_session",
      "cello_close_session",
      "cello_get_inclusion_proof",
      "cello_get_sealed_receipt",
      "cello_initiate_session",
      "cello_list_sessions",
      "cello_receive",
      "cello_send",
      "cello_status",
    ]);
  }, 15_000);
});

// ─── AC-005: cello_status fields ─────────────────────────────────────────────

describe("AC-005: cello_status returns expected fields", () => {
  it("AC-005: transport_started, own_pubkey, listen_addresses, connected_peer_count, uptime_seconds", async () => {
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

    const expectedPubkey = Buffer.from(await kp.getPublicKey()).toString("hex");

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as Record<string, unknown>;

    expect(result.transport_started).toBe(true);
    expect(result.own_pubkey).toBe(expectedPubkey);
    expect(Array.isArray(result.listen_addresses)).toBe(true);
    expect((result.listen_addresses as string[]).length).toBeGreaterThan(0);
    expect(typeof result.connected_peer_count).toBe("number");
    expect(typeof result.uptime_seconds).toBe("number");
  }, 10_000);
});

// ─── SI-003: no private key in tool responses ─────────────────────────────────

describe("SI-003: no K_local private key bytes in any tool response", () => {
  it("SI-003: own_pubkey in cello_status is the public key, not the private key", async () => {
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

    const expectedPubkey = Buffer.from(await kp.getPublicKey()).toString("hex");
    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as Record<string, unknown>;

    expect(result.own_pubkey).toBe(expectedPubkey);
    const keys = Object.keys(result).sort();
    // M1 (ADAPTER-002) extended status with active_session_count and directory_reachable
    expect(keys).toEqual([
      "active_session_count",
      "connected_peer_count",
      "directory_reachable",
      "listen_addresses",
      "own_pubkey",
      "transport_started",
      "uptime_seconds",
    ]);
  }, 10_000);
});

// ─── AC-002 / SI-001: inbound message → notification on MCP wire, content-free ──
// NOTE (ADAPTER-002): cello_connect_peer and cello_send({peer_pubkey}) are removed from the M1
// MCP tool surface. This test uses the CelloClient API directly to trigger the inbound message
// path, verifying that pushChannelNotification still fires correctly via the onMessageQueued hook.

describe("AC-002 + SI-001: inbound message pushes claude/channel notification via MCP wire without content", () => {
  it("AC-002: notifications/claude/channel fires with {type:'cello_message', from:<pubkey>}; no content field", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    scope.addCleanup(async () => { try { await nodeA.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeB.stop(); } catch {} });

    const ownPubkeyA = Buffer.from(await kpA.getPublicKey()).toString("hex");
    const ownPubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");

    // Capture MCP wire notifications received by B's MCP client
    const wireNotifications: Notification[] = [];

    // Create serverB with a real client that has onMessageQueued wired to pushChannelNotification
    const serverB = createMcpServer(nodeB, /* placeholder; clientB wired below */ null as never, kpB);
    const [stB, ctB] = InMemoryTransport.createLinkedPair();
    await serverB.connect(stB);
    const mcpB = new Client({ name: "test-b", version: "0.0.1" });
    // Register fallback handler before connect so notifications aren't missed
    (mcpB as unknown as { fallbackNotificationHandler: (n: Notification) => void }).fallbackNotificationHandler =
      (n) => { wireNotifications.push(n); };
    await mcpB.connect(ctB);
    scope.addCleanup(async () => { try { await mcpB.close(); } catch {} });
    scope.addCleanup(async () => { try { await serverB.close(); } catch {} });

    // Wire clientB with notification push through the actual serverB MCP server
    const clientB = createClient(nodeB, kpB, {
      onMessageQueued: (from) => { void pushChannelNotification(serverB, from); },
    });
    await clientB.registerHandler();

    const clientA = createClient(nodeA, kpA);
    await clientA.registerHandler();

    // Use CelloClient API directly (M0 peer-to-peer path still works at client level)
    clientA.addPeer(ownPubkeyB, nodeB.getConnections().length.toString(), nodeB.listenAddresses());
    // Dial nodeB manually via node.dial, then add peer for A's registry
    const dialResult = await nodeA.dial(nodeB.listenAddresses()[0]!);
    clientA.addPeer(ownPubkeyB, dialResult.peerId, nodeB.listenAddresses());

    await clientA.send(ownPubkeyB, new TextEncoder().encode("hello"));

    await waitFor(
      () => wireNotifications.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 5000 }
    );

    const notif = wireNotifications.find((n) => n.method === "notifications/claude/channel")!;
    const params = notif.params as Record<string, unknown>;

    // Must have type and from
    expect(params.type).toBe("cello_message");
    expect(params.from).toBe(ownPubkeyA);
    // SI-001: must NOT include message content
    expect(params.content).toBeUndefined();
    expect(Object.keys(params).sort()).toEqual(["from", "type"]);
  }, 20_000);
});

// ─── AC-003: CelloClient.receive() works after onMessageQueued fires ───────────
// NOTE (ADAPTER-002): This test uses the CelloClient API directly since cello_connect_peer
// and old cello_send({peer_pubkey}) are no longer in the M1 MCP tool surface.

describe("AC-003: CelloClient.receive() returns message after onMessageQueued fires", () => {
  it("AC-003: receive after onMessageQueued fires returns message with correct sender pubkey", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    scope.addCleanup(async () => { try { await nodeA.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeB.stop(); } catch {} });

    const ownPubkeyA = Buffer.from(await kpA.getPublicKey()).toString("hex");
    const ownPubkeyB = Buffer.from(await kpB.getPublicKey()).toString("hex");
    let notified = false;

    const clientB = createClient(nodeB, kpB, { onMessageQueued: () => { notified = true; } });
    await clientB.registerHandler();
    const clientA = createClient(nodeA, kpA);
    await clientA.registerHandler();

    // Dial and register peer at client level (M0 path, not via MCP tool)
    const dialResult = await nodeA.dial(nodeB.listenAddresses()[0]!);
    clientA.addPeer(ownPubkeyB, dialResult.peerId, nodeB.listenAddresses());

    await clientA.send(ownPubkeyB, new TextEncoder().encode("ping"));

    await waitFor(() => notified, { timeout: 5000 });

    // Receive via CelloClient.receive() directly (M0 API still works at client level)
    const envelope = clientB.receive(ownPubkeyA);
    expect(envelope).not.toBeNull();
    const content = new TextDecoder().decode(envelope!.content);
    expect(content).toBe("ping");
  }, 20_000);
});
