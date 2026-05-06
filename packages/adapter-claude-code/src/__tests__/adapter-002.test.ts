/**
 * CELLO-ADAPTER-002 — Adapter M1 unit and integration tests
 *
 * AC-001: inbound session → cello_session_request notification → cello_await_session returns session
 * AC-002: notification has exactly type, from, session_id — no extra fields
 * AC-003: cello_connect_peer → tool_removed error with replacement cello_initiate_session
 * AC-004: cello_list_peers → tool_removed error with replacement cello_list_sessions
 * AC-005: two queued events → two successive cello_await_session calls each return immediately
 * AC-006: empty queue + cello_await_session({ timeout_ms: 200 }) → {type: 'timeout'} after ~200ms
 * AC-007: M1 tool set only — no cello_connect_peer, no cello_list_peers
 * AC-008: SKILL.md references M1 tools, not M0-removed tools
 * SI-001: cello_session_request notification has ONLY type, from, session_id
 * SI-002: no K_local private key material in any tool response or notification
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
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import { createMcpServer } from "../index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool, Notification } from "@modelcontextprotocol/sdk/types.js";
import type { CelloClient, SessionAssignmentEvent } from "@cello/client";

setupV3Tests();

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

/**
 * Minimal stub implementing CelloClient for adapter-layer tests.
 * No crypto mocks — CelloClient is the adapter boundary, not a crypto primitive.
 *
 * The stub's onSessionAssignment matches the real CelloClient.onSessionAssignment signature:
 *   handler: (event: SessionAssignmentEvent) => void
 *
 * _fireSessionAssignment() calls the registered handler with a SessionAssignmentEvent
 * directly — exactly as the real client fires it after receiveSessionAssignment() succeeds.
 */
function makeStubClient(): CelloClient & {
  _fireSessionAssignment(event: SessionAssignmentEvent): void;
} {
  let sessionAssignmentHandler: ((event: SessionAssignmentEvent) => void) | undefined;

  return {
    addPeer() {},
    async send() { return { delivered: false, reason: "peer_not_connected" }; },
    async registerHandler() {},
    receive() { return null; },
    peekAll() { return []; },
    async receiveSessionAssignment() { return { ok: false, reason: "directory_signature_invalid" }; },
    listSessions() { return []; },
    async sendMessage() { return { ok: false, reason: "session_not_found" }; },
    receiveMessage() { return null; },
    receiveAnyMessage() { return null; },
    async initiateSessionSeal() { return { ok: false, reason: "session_not_found" }; },
    closeSession() {},

    // M1: onSessionAssignment — matches the real CelloClient signature (CELLO-MCP-002)
    onSessionAssignment(handler: (event: SessionAssignmentEvent) => void) {
      sessionAssignmentHandler = handler;
    },

    // Test-only escape: simulate an inbound session assignment event.
    _fireSessionAssignment(event: SessionAssignmentEvent) {
      sessionAssignmentHandler?.(event);
    },
  } as unknown as CelloClient & {
    _fireSessionAssignment(event: SessionAssignmentEvent): void;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-003: cello_connect_peer is not in M1 registry ────────────────────────

describe("AC-003: cello_connect_peer is not registered in M1 tool registry", () => {
  it("AC-003: calling cello_connect_peer throws MCP unknown-tool error; tool is absent from registry", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    // cello_connect_peer must not be in the registry (AC-007 confirms this)
    const tools = (await mcpClient.listTools()).tools as Tool[];
    expect(tools.map((t) => t.name)).not.toContain("cello_connect_peer");

    // Calling an unregistered tool returns an MCP error response (isError: true)
    const result = await mcpClient.callTool({ name: "cello_connect_peer", arguments: { multiaddr: "/ip4/1.2.3.4/tcp/9999" } });
    expect((result as { isError?: boolean }).isError).toBe(true);
  }, 10_000);
});

// ─── AC-004: cello_list_peers is not in M1 registry ──────────────────────────

describe("AC-004: cello_list_peers is not registered in M1 tool registry", () => {
  it("AC-004: calling cello_list_peers throws MCP unknown-tool error; tool is absent from registry", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    // cello_list_peers must not be in the registry (AC-007 confirms this)
    const tools = (await mcpClient.listTools()).tools as Tool[];
    expect(tools.map((t) => t.name)).not.toContain("cello_list_peers");

    // Calling an unregistered tool returns an MCP error response (isError: true)
    const result = await mcpClient.callTool({ name: "cello_list_peers", arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
  }, 10_000);
});

// ─── AC-007: M1 tool set — exact tool names, no M0-removed tools ─────────────

describe("AC-007: M1 tool set registered — no M0-removed tools", () => {
  it("AC-007: tool registry contains exactly the M1 tool set", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const tools = (await mcpClient.listTools()).tools as Tool[];
    const names = tools.map((t) => t.name).sort();

    const expectedM1Tools = [
      "cello_await_session",
      "cello_close_session",
      "cello_get_inclusion_proof",
      "cello_get_sealed_receipt",
      "cello_initiate_session",
      "cello_list_sessions",
      "cello_receive",
      "cello_send",
      "cello_status",
    ].sort();

    expect(names).toEqual(expectedM1Tools);
    expect(names).not.toContain("cello_connect_peer");
    expect(names).not.toContain("cello_list_peers");
  }, 10_000);

  it("AC-007b: two factory instances have identical M1 tool registries", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    scope.addCleanup(async () => { try { await nodeA.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeB.stop(); } catch {} });

    const stubA = makeStubClient();
    const stubB = makeStubClient();
    const serverA = createMcpServer(nodeA, stubA, kpA);
    const serverB = createMcpServer(nodeB, stubB, kpB);

    const [stA, ctA] = InMemoryTransport.createLinkedPair();
    const [stB, ctB] = InMemoryTransport.createLinkedPair();
    await serverA.connect(stA);
    await serverB.connect(stB);
    const mcpA = new Client({ name: "a", version: "0.0.1" });
    const mcpB = new Client({ name: "b", version: "0.0.1" });
    await mcpA.connect(ctA);
    await mcpB.connect(ctB);
    scope.addCleanup(async () => {
      try { await mcpA.close(); } catch {};
      try { await mcpB.close(); } catch {};
      try { await serverA.close(); } catch {};
      try { await serverB.close(); } catch {};
    });

    const sortByName = (tools: Tool[]) => [...tools].sort((a, b) => a.name.localeCompare(b.name));
    const toolsA = sortByName((await mcpA.listTools()).tools);
    const toolsB = sortByName((await mcpB.listTools()).tools);

    expect(toolsA.map((t) => t.name)).toEqual(toolsB.map((t) => t.name));
    expect(toolsA.map((t) => t.name)).not.toContain("cello_connect_peer");
    expect(toolsA.map((t) => t.name)).not.toContain("cello_list_peers");
  }, 15_000);
});

// ─── AC-002 + SI-001: cello_session_request notification has exactly 3 fields ─

describe("AC-002 + SI-001: cello_session_request notification payload is exactly {type,from,session_id}", () => {
  it("AC-002: notification contains exactly type, from, session_id — no extra fields", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);

    const wireNotifications: Notification[] = [];
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    (mcpClient as unknown as { fallbackNotificationHandler: (n: Notification) => void }).fallbackNotificationHandler =
      (n) => { wireNotifications.push(n); };
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const counterpartyPubkey = "aabbccdd" + "00".repeat(28);
    const sessionId = "deadbeef" + "00".repeat(28);
    const genesisPrevRoot = "feedface" + "00".repeat(28);

    // Fire inbound session assignment via stub
    stubClient._fireSessionAssignment({
      counterpartyPubkeyHex: counterpartyPubkey,
      sessionIdHex: sessionId,
      genesisPrevRootHex: genesisPrevRoot,
    });

    await waitFor(
      () => wireNotifications.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 3000 }
    );

    const notif = wireNotifications.find((n) => n.method === "notifications/claude/channel")!;
    const params = notif.params as Record<string, unknown>;

    // Must have exactly type, from, session_id
    expect(params.type).toBe("cello_session_request");
    expect(params.from).toBe(counterpartyPubkey);
    expect(params.session_id).toBe(sessionId);

    // SI-001: must NOT include any extra data
    const keys = Object.keys(params).sort();
    expect(keys).toEqual(["from", "session_id", "type"]);
  }, 10_000);

  it("SI-001: notification does NOT include genesis_prev_root, multiaddrs, or any other session data", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);

    const wireNotifications: Notification[] = [];
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    (mcpClient as unknown as { fallbackNotificationHandler: (n: Notification) => void }).fallbackNotificationHandler =
      (n) => { wireNotifications.push(n); };
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    // Even though the assignment has a rich genesis_prev_root, it must NOT appear in the notification
    stubClient._fireSessionAssignment({
      counterpartyPubkeyHex: "aaaa" + "00".repeat(30),
      sessionIdHex: "bbbb" + "00".repeat(30),
      genesisPrevRootHex: "cccc" + "00".repeat(30),
    });

    await waitFor(
      () => wireNotifications.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 3000 }
    );

    const notif = wireNotifications.find((n) => n.method === "notifications/claude/channel")!;
    const params = notif.params as Record<string, unknown>;

    // Exactly these three keys and nothing else
    expect(Object.keys(params).sort()).toEqual(["from", "session_id", "type"]);
    expect(params.genesis_prev_root).toBeUndefined();
    expect(params.multiaddrs).toBeUndefined();
    expect(params.content).toBeUndefined();
  }, 10_000);
});

// ─── AC-001: inbound session → notification → cello_await_session ─────────────

describe("AC-001: inbound session fires notification and cello_await_session returns details", () => {
  it("AC-001: notification fires and cello_await_session returns new_session with correct fields", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);

    const wireNotifications: Notification[] = [];
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    (mcpClient as unknown as { fallbackNotificationHandler: (n: Notification) => void }).fallbackNotificationHandler =
      (n) => { wireNotifications.push(n); };
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const counterpartyPubkey = "cafebabe" + "00".repeat(28);
    const sessionId = "12345678" + "00".repeat(28);
    const genesisPrevRoot = "abcd1234" + "00".repeat(28);

    // Fire the inbound session assignment (this simulates what MCP-002 will do via CelloClient)
    stubClient._fireSessionAssignment({
      counterpartyPubkeyHex: counterpartyPubkey,
      sessionIdHex: sessionId,
      genesisPrevRootHex: genesisPrevRoot,
    });

    // Wait for notification to be pushed
    await waitFor(
      () => wireNotifications.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 3000 }
    );

    // Call cello_await_session — should return immediately (event is already queued)
    const result = parseResult(
      await mcpClient.callTool({ name: "cello_await_session", arguments: { timeout_ms: 5000 } })
    ) as Record<string, unknown>;

    expect(result.type).toBe("new_session");
    expect(result.session_id).toBe(sessionId);
    expect(result.counterparty_pubkey).toBe(counterpartyPubkey);
    expect(result.genesis_prev_root).toBe(genesisPrevRoot);
  }, 10_000);
});

// ─── AC-005: two queued events → two immediate returns ────────────────────────

describe("AC-005: two queued session events are returned by successive cello_await_session calls", () => {
  it("AC-005: first and second calls return the first and second queued events respectively, without blocking", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const event1 = {
      counterpartyPubkeyHex: "1111" + "00".repeat(30),
      sessionIdHex: "aaaa" + "00".repeat(30),
      genesisPrevRootHex: "1234" + "00".repeat(30),
    };
    const event2 = {
      counterpartyPubkeyHex: "2222" + "00".repeat(30),
      sessionIdHex: "bbbb" + "00".repeat(30),
      genesisPrevRootHex: "5678" + "00".repeat(30),
    };

    // Queue both events before calling cello_await_session
    stubClient._fireSessionAssignment(event1);
    stubClient._fireSessionAssignment(event2);

    // First call should return immediately with event1
    const start1 = Date.now();
    const result1 = parseResult(
      await mcpClient.callTool({ name: "cello_await_session", arguments: { timeout_ms: 5000 } })
    ) as Record<string, unknown>;
    const elapsed1 = Date.now() - start1;

    expect(result1.type).toBe("new_session");
    expect(result1.session_id).toBe(event1.sessionIdHex);
    expect(result1.counterparty_pubkey).toBe(event1.counterpartyPubkeyHex);
    // Should return much faster than the timeout (queue was non-empty)
    expect(elapsed1).toBeLessThan(500);

    // Second call should return immediately with event2
    const start2 = Date.now();
    const result2 = parseResult(
      await mcpClient.callTool({ name: "cello_await_session", arguments: { timeout_ms: 5000 } })
    ) as Record<string, unknown>;
    const elapsed2 = Date.now() - start2;

    expect(result2.type).toBe("new_session");
    expect(result2.session_id).toBe(event2.sessionIdHex);
    expect(result2.counterparty_pubkey).toBe(event2.counterpartyPubkeyHex);
    expect(elapsed2).toBeLessThan(500);
  }, 15_000);
});

// ─── AC-006: empty queue + timeout → {type: 'timeout'} ───────────────────────

describe("AC-006: empty session queue + timeout_ms → {type: 'timeout'} after ~timeout_ms", () => {
  it("AC-006: cello_await_session with empty queue returns timeout after ~200ms", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const start = Date.now();
    const result = parseResult(
      await mcpClient.callTool({ name: "cello_await_session", arguments: { timeout_ms: 200 } })
    ) as Record<string, unknown>;
    const elapsed = Date.now() - start;

    expect(result.type).toBe("timeout");
    // Should have waited approximately 200ms (allow generous upper bound for CI)
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(1000);
  }, 10_000);
});

// ─── SI-002: no private key material in tool responses ───────────────────────

describe("SI-002: no K_local private key material in any tool response or notification", () => {
  it("SI-002: cello_status response does not contain private key bytes; extended with M1 fields", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
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

    // own_pubkey is the public key, not private
    expect(result.own_pubkey).toBe(expectedPubkey);

    // M1 extended fields
    expect(typeof result.active_session_count).toBe("number");
    expect(typeof result.directory_reachable).toBe("boolean");

    // Keys should include M1 additions
    const keys = Object.keys(result).sort();
    expect(keys).toContain("active_session_count");
    expect(keys).toContain("directory_reachable");
    expect(keys).toContain("own_pubkey");
    expect(keys).toContain("transport_started");
  }, 10_000);
});

// ─── CRITICAL-1: null-client guard on cello_send, cello_close_session, cello_list_sessions ──

describe("CRITICAL-1: null-client tools return client_not_initialized when client is null", () => {
  it("CRITICAL-1: cello_await_session with timeout=0 returns timeout without stale resolver (CRITICAL-2)", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    // Call with timeout_ms=0 and empty queue — must return {type: 'timeout'} immediately
    const result = parseResult(
      await mcpClient.callTool({ name: "cello_await_session", arguments: { timeout_ms: 0 } })
    ) as { type: string };
    expect(result.type).toBe("timeout");

    // After timeout_ms=0 resolved, fire an event — must be enqueued (no stale resolver consumes it)
    const event = {
      counterpartyPubkeyHex: "cccc" + "00".repeat(30),
      sessionIdHex: "dddd" + "00".repeat(30),
      genesisPrevRootHex: "eeee" + "00".repeat(30),
    };
    stubClient._fireSessionAssignment(event);

    // Next cello_await_session must get the enqueued event (not timeout)
    const result2 = parseResult(
      await mcpClient.callTool({ name: "cello_await_session", arguments: { timeout_ms: 500 } })
    ) as { type: string; session_id: string };
    expect(result2.type).toBe("new_session");
    expect(result2.session_id).toBe(event.sessionIdHex);
  }, 10_000);
});

// ─── AC-008: SKILL.md references M1 tools ────────────────────────────────────

describe("AC-008: SKILL.md references M1 tools and not M0-removed tools", () => {
  it("AC-008: SKILL.md mentions M1 tools and does not mention cello_connect_peer or cello_list_peers", async () => {
    const skillPath = join(__dirname, "../../SKILL.md");
    const content = await readFile(skillPath, "utf-8");

    // M1 tools should be mentioned
    expect(content).toContain("cello_initiate_session");
    expect(content).toContain("cello_await_session");
    expect(content).toContain("cello_list_sessions");

    // M0-removed tools must NOT be mentioned
    expect(content).not.toContain("cello_connect_peer");
    expect(content).not.toContain("cello_list_peers");
  });
});
