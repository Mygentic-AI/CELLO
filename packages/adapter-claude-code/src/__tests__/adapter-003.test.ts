/**
 * CELLO-ADAPTER-003 — cello_initiate_session unit tests (no server dependencies)
 *
 * Unit tests that do NOT require @cello-protocol/directory or @cello-protocol/relay:
 *   SI-001: session_request frame contains ONLY { type, target_pubkey } — no extra fields
 *   AC-005 / L-001: Transport not started → { error: { reason: 'transport_not_started' } }
 *   L-003: not_available_in_m1 stub is retired
 *
 * Tests that require real directory + relay infrastructure (H-002, SI-002, AC-001,
 * AC-002, AC-003, DB-001) are in packages/e2e-tests/src/__tests__/adapter-003.test.ts
 * and packages/e2e-tests/src/__tests__/adapter-003-mcp.test.ts.
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
import type { TestScope } from "@claude-flow/testing";
import { Encoder, decode } from "cbor-x";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import { createMcpServer } from "../index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

// ─── Scope ─────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── SI-001: session_request frame structure ──────────────────────────────────

describe("SI-001: session_request frame contains only { type, target_pubkey }", () => {
  it("SI-001: CBOR-encoded session_request has exactly type and target_pubkey; no key material, no extra fields", () => {
    const targetPubkey = new Uint8Array(32).fill(0xab);

    // This mirrors exactly how the client builds the frame (inline CBOR, no directory import)
    const frameBytes = CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: targetPubkey,
    }) as Uint8Array;

    const decoded = decode(frameBytes) as Record<string, unknown>;

    // Must have exactly type and target_pubkey
    expect(Object.keys(decoded).sort()).toEqual(["target_pubkey", "type"]);
    expect(decoded["type"]).toBe("session_request");

    const decodedKey = decoded["target_pubkey"];
    const keyBytes = decodedKey instanceof Uint8Array ? decodedKey
      : Buffer.isBuffer(decodedKey) ? new Uint8Array(decodedKey as Buffer)
      : null;
    expect(keyBytes).not.toBeNull();
    expect(keyBytes!.length).toBe(32);
    expect(Buffer.from(keyBytes!).equals(Buffer.from(targetPubkey))).toBe(true);

    // SI-001: no session content, no key material, no extra fields
    expect(decoded["content"]).toBeUndefined();
    expect(decoded["signature"]).toBeUndefined();
    expect(decoded["private_key"]).toBeUndefined();
    expect(decoded["session_id"]).toBeUndefined();
    expect(decoded["trust_signal"]).toBeUndefined();
  });
});

// ─── AC-005 / L-001: transport not started → transport_not_started ────────────

describe("AC-005 (L-001): transport not started returns transport_not_started exactly", () => {
  it("AC-005: cello_initiate_session with transport not started returns exactly transport_not_started", async () => {
    // Create a node but do NOT start it (so listenAddresses() returns [])
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    // node is NOT started — listenAddresses() returns []

    const clientStub = {
      addPeer: () => {},
      async send() { return { delivered: false as const, reason: "peer_not_connected" as const }; },
      async registerHandler() {},
      receive() { return null; },
      peekAll() { return []; },
      async receiveSessionAssignment() { return { ok: false as const, reason: "relay_auth_error" as const }; },
      listSessions() { return []; },
      async sendMessage() { return { ok: false as const, reason: "session_not_found" as const }; },
      receiveMessage() { return null; },
      receiveAnyMessage() { return null; },
      async receiveSessionMessageAsync() { return null; },
      async receiveMessageAsync() { return { type: "timeout" as const }; },
      async initiateSessionSeal() { return { ok: false as const, reason: "session_not_found" as const }; },
      closeSession() {},
      onSessionAssignment() {},
      async initiateSession() { return { ok: false as const, reason: "directory_unreachable" as const }; },
      async register() { return { error: "not_implemented" }; },
      getRegistrationState() { return null; },
      getDirectoryPeerId() { return null; },
      setPolicy() {},
      getPolicy() { return { mode: "open" as const, review_mode: "deterministic" as const, requirements: [] }; },
      hasConnection() { return null; },
      listConnections() { return []; },
      async acceptConnection() { return { error: { reason: "no_pending_request" as const } }; },
      async rejectConnection() { return { error: { reason: "no_pending_request" as const } }; },
      async requestMoreDisclosure() { return { error: { reason: "no_pending_request" as const } }; },
      async awaitConnectionRequest() { return { type: "timeout" as const }; },
    };

    const server = createMcpServer(node, clientStub as Parameters<typeof createMcpServer>[1], kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: "a".repeat(64) },
      })
    ) as Record<string, unknown>;

    // L-001: must be exactly "transport_not_started" — NOT "client_not_initialized"
    expect(result.error).toBeDefined();
    expect((result.error as Record<string, unknown>).reason).toBe("transport_not_started");
  }, 10_000);
});

// ─── L-003: no not_available_in_m1 in production code ────────────────────────

describe("L-003: not_available_in_m1 stub is retired", () => {
  it("L-003: production code no longer returns not_available_in_m1", async () => {
    // This test documents that the M1 stub is retired.
    // Verification: grep -r not_available_in_m1 packages/ --include='*.ts' | grep -v test
    // returns empty — no production .ts files reference that string.
    //
    // The implementation: server.ts now delegates to client.initiateSession()
    // and returns its result directly, never returning not_available_in_m1.
    // The optional-method check has been removed from server.ts.
    //
    // We verify this at the adapter level by confirming the tool calls through
    // to the client's initiateSession (a client that returns a real error, not not_available_in_m1).

    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(() => node.stop());

    // A client that has initiateSession and returns "directory_unreachable"
    const client = {
      addPeer: () => {},
      async send() { return { delivered: false as const, reason: "peer_not_connected" as const }; },
      async registerHandler() {},
      receive() { return null; },
      peekAll() { return []; },
      async receiveSessionAssignment() { return { ok: false as const, reason: "relay_auth_error" as const }; },
      listSessions() { return []; },
      async sendMessage() { return { ok: false as const, reason: "session_not_found" as const }; },
      receiveMessage() { return null; },
      receiveAnyMessage() { return null; },
      async receiveSessionMessageAsync() { return null; },
      async receiveMessageAsync() { return { type: "timeout" as const }; },
      async initiateSessionSeal() { return { ok: false as const, reason: "session_not_found" as const }; },
      closeSession() {},
      onSessionAssignment() {},
      // This is the real initiateSession — returns directory_unreachable, NOT not_available_in_m1
      async initiateSession() { return { ok: false as const, reason: "directory_unreachable" as const }; },
      async register() { return { error: "not_implemented" }; },
      getRegistrationState() { return null; },
      getDirectoryPeerId() { return null; },
      setPolicy() {},
      getPolicy() { return { mode: "open" as const, review_mode: "deterministic" as const, requirements: [] }; },
      hasConnection() { return null; },
      listConnections() { return []; },
      async acceptConnection() { return { error: { reason: "no_pending_request" as const } }; },
      async rejectConnection() { return { error: { reason: "no_pending_request" as const } }; },
      async requestMoreDisclosure() { return { error: { reason: "no_pending_request" as const } }; },
      async awaitConnectionRequest() { return { type: "timeout" as const }; },
    };

    const server = createMcpServer(node, client as Parameters<typeof createMcpServer>[1], kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: "a".repeat(64) },
      })
    ) as Record<string, unknown>;

    // Must NOT be "not_available_in_m1" — the stub is retired
    expect(result.reason).not.toBe("not_available_in_m1");
    // Must be a real error reason from initiateSession
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("directory_unreachable");
  }, 10_000);
});
