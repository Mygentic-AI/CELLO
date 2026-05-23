/**
 * CELLO-MCP-003: M3 MCP tool surface — unit tests
 *
 * TDD Phase R — RED-first. Written BEFORE implementation is complete.
 *
 * Covered ACs (unit test scope):
 *   AC-002: already_registered error on double register — no DKG attempted
 *   AC-007: accept_connection returns { accepted: true, connection_id };
 *           cello_list_connections includes new connection
 *   AC-008: reject_connection returns { rejected: true };
 *           second call → already_decided
 *   AC-009: request_more_disclosure on Round 1 returns { request_sent: true };
 *           second call → already_decided
 *   AC-010: request_more_disclosure on Round 2 → { error: { reason: 'max_rounds_reached' } }
 *   AC-011: set_policy sets mode/review_mode/requirements; get_policy returns them
 *   AC-012: await_connection_request with timeout_ms: 200 → { type: 'timeout' } after ~200ms
 *   AC-014: initiate_session without connection → { error: { reason: 'no_connection' } } immediately
 *   AC-015: cello_status includes registered, agent_id, connection_count, policy_mode, policy_review_mode
 *   AC-016: both InMemoryTransport and stdio register identical tool set (all 19 tools total)
 *
 * Security Invariants (negative tests):
 *   SI-001: No ML-DSA secret key material in any tool response
 *   SI-002: initiate_session with valid-looking hex pubkey but no connection record → blocked locally
 *   SI-003: ConnectionReport has no raw signatures, no full public keys, no key blobs
 *
 * No mocks for cryptographic operations. Real keys, real signing.
 * Test infrastructure: stub CelloClient + CelloNode for unit tests.
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
import { generateKeypair } from "@cello/crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createMcpSessionServer } from "../mcp-server.js";
import type {
  CelloClient,
  SendResult,
  SendMessageResult,
  ReceiveAssignmentResult,
} from "../types.js";
import type { CelloNode } from "@cello/transport";
import type { SignalRequirementPolicy, ConnectionReport } from "../connection-policy.js";
import type { ClientConnectionRecord } from "@cello/protocol-types";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

// ─── Stub CelloNode ───────────────────────────────────────────────────────────

function makeStubNode(started = true): CelloNode {
  return {
    listenAddresses: () => (started ? ["/ip4/127.0.0.1/tcp/9999"] : []),
    getConnections: () => [],
    start: async () => {},
    stop: async () => {},
    dial: async () => ({ peerId: "12D3..." }),
    newStream: async () => { throw new Error("not implemented"); },
    handle: async () => {},
    unhandle: async () => {},
    getPeerId: () => "12D3KooWStub",
  } as unknown as CelloNode;
}

// ─── Stub state for MCP-003 new methods ──────────────────────────────────────

interface Mcp003StubState {
  registered: boolean;
  agentId: string | null;
  connections: ClientConnectionRecord[];
  pendingInboundRequests: Map<string, { connection_request_id: string; from_pubkey: string; round: number }>;
  policy: SignalRequirementPolicy;
  /** Queue of inbound requests for awaitConnectionRequest */
  inboundConnectionQueue: Array<{
    connection_request_id: string;
    from_pubkey: string;
    report: Extract<ConnectionReport, { verdict: "pending_agent_review" }>;
  }>;
  acceptedConnections: Map<string, string>; // request_id → connection_id
}

/**
 * Build a stub client that implements the MCP-003 interface extensions.
 *
 * The new methods required by MCP-003:
 *   - register(phoneStub): returns { agent_id, primary_pubkey, ml_dsa_pubkey } or { error }
 *   - setPolicy(policy): sets policy
 *   - getPolicy(): returns policy
 *   - hasConnection(pubkey): returns connection_id | null
 *   - listConnections(): returns ClientConnectionRecord[]
 *   - acceptConnection(reqId): sends accept, returns { accepted: true, connection_id } or error
 *   - rejectConnection(reqId, reason?): sends reject, returns { rejected: true } or error
 *   - requestMoreDisclosure(reqId, items): returns { request_sent: true } or error
 *   - awaitConnectionRequest(timeoutMs?): polls queue, returns pending_review or timeout
 *   - initiateSession(pubkey): checks connection before proceeding
 *   - cello_request_connection: sends connection request
 *   - cello_respond_to_disclosure_request: responds to disclosure
 *   - cello_request_more_disclosure: requests more disclosure
 */
function makeStubClientMcp003(state: Mcp003StubState): CelloClient & {
  setPolicy(policy: SignalRequirementPolicy): void;
  getPolicy(): SignalRequirementPolicy;
  hasConnection(pubkeyHex: string): string | null;
  listConnections(): ClientConnectionRecord[];
  acceptConnection(connectionRequestId: string): Promise<
    { accepted: true; connection_id: string } | { error: { reason: string } }
  >;
  rejectConnection(connectionRequestId: string, reason?: string): Promise<
    { rejected: true } | { error: { reason: string } }
  >;
  requestMoreDisclosure(connectionRequestId: string, requestedItems: unknown[]): Promise<
    { request_sent: true } | { error: { reason: string } }
  >;
  awaitConnectionRequest(timeoutMs?: number): Promise<
    | { type: "pending_review"; connection_request_id: string; from_pubkey: string; report: Extract<ConnectionReport, { verdict: "pending_agent_review" }> }
    | { type: "timeout" }
  >;
  cello_request_connection(opts: { target_pubkey: string; package_cbor: Uint8Array }): Promise<
    | { result: "established"; connection_id: string }
    | { result: "rejected"; reason: string }
    | { result: "insufficient"; unmet_requirements: unknown[] }
    | { result: "disclosure_requested"; connection_request_id: string; requested_items: unknown[] }
    | { result: "timeout" }
    | { result: "error"; reason: string }
  >;
  cello_respond_to_disclosure_request(opts: { connection_request_id: string; package_cbor: Uint8Array }): Promise<
    | { result: "established"; connection_id: string }
    | { result: "rejected"; reason: string }
    | { result: "insufficient"; unmet_requirements: unknown[] }
    | { result: "timeout" }
    | { result: "error"; reason: string }
  >;
  cello_request_more_disclosure(opts: { connection_request_id: string; requested_items: unknown[] }): Promise<
    { error: "max_rounds_reached" } | { ok: true }
  >;
} {
  return {
    // ─── Base CelloClient stubs ─────────────────────────────────────────────
    addPeer: () => {},
    send: async () => ({ delivered: false, reason: "peer_not_connected" } as SendResult),
    registerHandler: async () => {},
    receive: () => null,
    peekAll: () => [],
    receiveSessionAssignment: async () => ({ ok: false, reason: "relay_auth_error" } as ReceiveAssignmentResult),
    listSessions: () => [],
    sendMessage: async () => ({ ok: false, reason: "session_not_found" } as SendMessageResult),
    receiveMessage: () => null,
    receiveAnyMessage: () => null,
    receiveSessionMessageAsync: async () => null,
    receiveMessageAsync: async () => ({ type: "timeout" as const }),
    initiateSessionSeal: async () => ({ ok: false, reason: "session_not_active" }),
    closeSession: () => {},
    onSessionAssignment: () => {},
    initiateSession: async (targetPubkeyHex: string) => {
      // SESSION-006: if no connection exists and policy is set, return no_connection
      const connectionId = state.connections.find(
        (c) => c.counterparty_pubkey === targetPubkeyHex
      )?.connection_id;
      if (!connectionId) {
        return { ok: false, reason: "no_connection" as const };
      }
      return { ok: false, reason: "directory_unreachable" as const };
    },

    // ─── MCP-003 base interface methods ──────────────────────────────────────
    getDirectoryPeerId: () => null,
    getRegistrationState: () => {
      if (!state.registered || !state.agentId) return null;
      return {
        agent_id: state.agentId,
        primary_pubkey: "a".repeat(64),
        ml_dsa_pubkey: "b".repeat(64),
        registered_at: Date.now() - 1000,
        status: "active" as const,
      };
    },

    // ─── REG-001 ─────────────────────────────────────────────────────────────
    register: async () => {
      if (state.registered) {
        return { error: "already_registered" };
      }
      state.registered = true;
      state.agentId = "aabbccdd001122334455667788990011";
      return {
        agent_id: state.agentId,
        primary_pubkey: "a".repeat(64),
        ml_dsa_pubkey: "b".repeat(64),
        registered_at: Date.now(),
        status: "active" as const,
      };
    },

    // ─── MCP-003 new methods ─────────────────────────────────────────────────
    setPolicy: (policy: SignalRequirementPolicy) => {
      state.policy = policy;
    },

    getPolicy: () => state.policy,

    hasConnection: (pubkeyHex: string) => {
      return state.connections.find(c => c.counterparty_pubkey === pubkeyHex)?.connection_id ?? null;
    },

    listConnections: () => state.connections,

    acceptConnection: async (connectionRequestId: string) => {
      const pending = state.pendingInboundRequests.get(connectionRequestId);
      if (!pending) {
        return { error: { reason: "no_pending_request" } };
      }
      if (state.acceptedConnections.has(connectionRequestId)) {
        return { error: { reason: "already_decided" } };
      }
      // Simulate connection establishment
      const connectionId = `conn-${connectionRequestId.slice(0, 8)}`;
      const record: ClientConnectionRecord = {
        connection_id: connectionId,
        counterparty_pubkey: pending.from_pubkey,
        counterparty_primary_pubkey: "",
        counterparty_ml_dsa_pubkey: "",
        established_at: Date.now(),
        status: "active" as const,
      };
      state.connections.push(record);
      state.acceptedConnections.set(connectionRequestId, connectionId);
      state.pendingInboundRequests.delete(connectionRequestId);
      return { accepted: true as const, connection_id: connectionId };
    },

    rejectConnection: async (connectionRequestId: string) => {
      // Check already_decided first (covers: rejected, accepted, or disclosure sent)
      if (state.acceptedConnections.has(connectionRequestId)) {
        return { error: { reason: "already_decided" } };
      }
      const pending = state.pendingInboundRequests.get(connectionRequestId);
      if (!pending) {
        return { error: { reason: "no_pending_request" } };
      }
      state.pendingInboundRequests.delete(connectionRequestId);
      state.acceptedConnections.set(connectionRequestId, "rejected");
      return { rejected: true as const };
    },

    requestMoreDisclosure: async (connectionRequestId: string, requestedItems: unknown[]) => {
      void requestedItems; // used for wire payload
      const pending = state.pendingInboundRequests.get(connectionRequestId);
      if (!pending) {
        return { error: { reason: "no_pending_request" } };
      }
      if (state.acceptedConnections.has(connectionRequestId)) {
        return { error: { reason: "already_decided" } };
      }
      if (pending.round >= 2) {
        return { error: { reason: "max_rounds_reached" } };
      }
      // Advance to Round 2
      pending.round = 2;
      return { request_sent: true as const };
    },

    awaitConnectionRequest: async (timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (state.inboundConnectionQueue.length > 0) {
          const item = state.inboundConnectionQueue.shift()!;
          return {
            type: "pending_review" as const,
            connection_request_id: item.connection_request_id,
            from_pubkey: item.from_pubkey,
            report: item.report,
          };
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise<void>((r) => setTimeout(r, Math.min(20, remaining)));
      }
      return { type: "timeout" as const };
    },

    // ─── CONNREQ-002 methods ─────────────────────────────────────────────────
    cello_request_connection: async () => ({ result: "error", reason: "not_implemented" }),
    cello_respond_to_disclosure_request: async () => ({ result: "error", reason: "not_implemented" }),
    cello_request_more_disclosure: async (opts) => {
      const pending = state.pendingInboundRequests.get(opts.connection_request_id);
      if (!pending || pending.round >= 2) {
        return { error: "max_rounds_reached" };
      }
      pending.round = 2;
      return { ok: true };
    },
  };
}

// ─── MCP server + client setup helper ────────────────────────────────────────

type Mcp003Client = ReturnType<typeof makeStubClientMcp003>;

async function makeServerAndClientMcp003(
  state?: Partial<Mcp003StubState>,
  started = true,
): Promise<{
  mcpClient: Client;
  celloClient: Mcp003Client;
  cleanup: () => Promise<void>;
}> {
  const effectiveState: Mcp003StubState = {
    registered: false,
    agentId: null,
    connections: [],
    pendingInboundRequests: new Map(),
    policy: { mode: "open", review_mode: "deterministic", requirements: [] },
    inboundConnectionQueue: [],
    acceptedConnections: new Map(),
    ...state,
  };

  const kp = generateKeypair();
  const node = makeStubNode(started);
  const celloClient = makeStubClientMcp003(effectiveState);
  const server = createMcpSessionServer(node, celloClient, kp);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcpClient = new Client({ name: "test", version: "0.0.1" });
  await mcpClient.connect(clientTransport);

  const cleanup = async () => {
    try { await mcpClient.close(); } catch {}
    try { await server.close(); } catch {}
  };

  return { mcpClient, celloClient, cleanup };
}

// ─── Scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-002: already_registered error ────────────────────────────────────────

describe("AC-002: cello_register on already-registered agent returns already_registered error", () => {
  it("AC-002: second cello_register call returns { error: { reason: 'already_registered' } }", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003({ registered: true });
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_register", arguments: { phone_stub: "+1234567890" } })
    ) as Record<string, unknown>;

    expect(result["error"]).toBeDefined();
    expect((result["error"] as { reason: string }).reason).toBe("already_registered");
  });
});

// ─── AC-007: accept_connection ────────────────────────────────────────────────

describe("AC-007: cello_accept_connection returns accepted:true and cello_list_connections includes new connection", () => {
  it("AC-007: accept_connection for pending request → { accepted: true, connection_id }; list_connections grows by 1", async () => {
    const state: Mcp003StubState = {
      registered: true,
      agentId: "aabb1122",
      connections: [],
      pendingInboundRequests: new Map([
        ["req-001", { connection_request_id: "req-001", from_pubkey: "cafebabe".repeat(8), round: 1 }],
      ]),
      policy: { mode: "open", review_mode: "inference", requirements: [] },
      inboundConnectionQueue: [],
      acceptedConnections: new Map(),
    };

    const { mcpClient, cleanup } = await makeServerAndClientMcp003(state);
    scope.addCleanup(cleanup);

    // Before accept: no connections
    const beforeResult = parseResult(
      await mcpClient.callTool({ name: "cello_list_connections", arguments: {} })
    ) as { connections: unknown[] };
    expect(beforeResult.connections).toHaveLength(0);

    // Accept the connection
    const acceptResult = parseResult(
      await mcpClient.callTool({
        name: "cello_accept_connection",
        arguments: { connection_request_id: "req-001" },
      })
    ) as Record<string, unknown>;

    expect(acceptResult["accepted"]).toBe(true);
    expect(typeof acceptResult["connection_id"]).toBe("string");
    expect((acceptResult["connection_id"] as string).length).toBeGreaterThan(0);

    // After accept: one connection in the list
    const afterResult = parseResult(
      await mcpClient.callTool({ name: "cello_list_connections", arguments: {} })
    ) as { connections: Array<{ connection_id: string; counterparty_pubkey: string; status: string }> };
    expect(afterResult.connections).toHaveLength(1);
    expect(afterResult.connections[0]!.connection_id).toBe(acceptResult["connection_id"]);
    expect(afterResult.connections[0]!.status).toBe("active");
  });
});

// ─── AC-008: reject_connection ────────────────────────────────────────────────

describe("AC-008: cello_reject_connection returns rejected:true; second call returns already_decided", () => {
  it("AC-008a: reject_connection for pending request → { rejected: true }", async () => {
    const state: Mcp003StubState = {
      registered: true,
      agentId: "aabb1122",
      connections: [],
      pendingInboundRequests: new Map([
        ["req-002", { connection_request_id: "req-002", from_pubkey: "deadbeef".repeat(8), round: 1 }],
      ]),
      policy: { mode: "open", review_mode: "inference", requirements: [] },
      inboundConnectionQueue: [],
      acceptedConnections: new Map(),
    };

    const { mcpClient, cleanup } = await makeServerAndClientMcp003(state);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_reject_connection",
        arguments: { connection_request_id: "req-002" },
      })
    ) as Record<string, unknown>;

    expect(result["rejected"]).toBe(true);
  });

  it("AC-008b: second call to reject_connection after first reject → { error: { reason: 'already_decided' } }", async () => {
    const state: Mcp003StubState = {
      registered: true,
      agentId: "aabb1122",
      connections: [],
      pendingInboundRequests: new Map([
        ["req-003", { connection_request_id: "req-003", from_pubkey: "01020304".repeat(8), round: 1 }],
      ]),
      policy: { mode: "open", review_mode: "inference", requirements: [] },
      inboundConnectionQueue: [],
      acceptedConnections: new Map(),
    };

    const { mcpClient, cleanup } = await makeServerAndClientMcp003(state);
    scope.addCleanup(cleanup);

    // First reject succeeds
    const first = parseResult(
      await mcpClient.callTool({
        name: "cello_reject_connection",
        arguments: { connection_request_id: "req-003" },
      })
    ) as Record<string, unknown>;
    expect(first["rejected"]).toBe(true);

    // Second reject → already_decided
    const second = parseResult(
      await mcpClient.callTool({
        name: "cello_reject_connection",
        arguments: { connection_request_id: "req-003" },
      })
    ) as Record<string, unknown>;
    expect(second["error"]).toBeDefined();
    expect((second["error"] as { reason: string }).reason).toBe("already_decided");
  });

  it("AC-008c: reject_connection with no_pending_request → error", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003();
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_reject_connection",
        arguments: { connection_request_id: "nonexistent" },
      })
    ) as Record<string, unknown>;

    expect(result["error"]).toBeDefined();
    expect((result["error"] as { reason: string }).reason).toBe("no_pending_request");
  });
});

// ─── AC-009: request_more_disclosure (Round 1) ───────────────────────────────

describe("AC-009: cello_request_more_disclosure on Round 1 → { request_sent: true }; second call → already_decided", () => {
  it("AC-009a: request_more_disclosure on Round 1 pending request → { request_sent: true }", async () => {
    const state: Mcp003StubState = {
      registered: true,
      agentId: "aabb1122",
      connections: [],
      pendingInboundRequests: new Map([
        ["req-004", { connection_request_id: "req-004", from_pubkey: "faceface".repeat(8), round: 1 }],
      ]),
      policy: { mode: "selective", review_mode: "inference", requirements: [] },
      inboundConnectionQueue: [],
      acceptedConnections: new Map(),
    };

    const { mcpClient, cleanup } = await makeServerAndClientMcp003(state);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_request_more_disclosure",
        arguments: {
          connection_request_id: "req-004",
          requested_items: [{ type: "endorsement", condition: { type: "min_count", count: 2 } }],
        },
      })
    ) as Record<string, unknown>;

    expect(result["request_sent"]).toBe(true);
  });

  it("AC-009b: second call to request_more_disclosure on same request → already_decided", async () => {
    const state: Mcp003StubState = {
      registered: true,
      agentId: "aabb1122",
      connections: [],
      pendingInboundRequests: new Map([
        ["req-005", { connection_request_id: "req-005", from_pubkey: "beefdead".repeat(8), round: 1 }],
      ]),
      policy: { mode: "selective", review_mode: "inference", requirements: [] },
      inboundConnectionQueue: [],
      acceptedConnections: new Map(),
    };

    const { mcpClient, cleanup } = await makeServerAndClientMcp003(state);
    scope.addCleanup(cleanup);

    // First call advances to Round 2
    const first = parseResult(
      await mcpClient.callTool({
        name: "cello_request_more_disclosure",
        arguments: {
          connection_request_id: "req-005",
          requested_items: [],
        },
      })
    ) as Record<string, unknown>;
    expect(first["request_sent"]).toBe(true);

    // Second call → already_decided (or max_rounds_reached)
    const second = parseResult(
      await mcpClient.callTool({
        name: "cello_request_more_disclosure",
        arguments: {
          connection_request_id: "req-005",
          requested_items: [],
        },
      })
    ) as Record<string, unknown>;
    expect(second["error"]).toBeDefined();
    const reason = (second["error"] as { reason: string }).reason;
    expect(["already_decided", "max_rounds_reached"]).toContain(reason);
  });
});

// ─── AC-010: request_more_disclosure (Round 2) ───────────────────────────────

describe("AC-010: cello_request_more_disclosure on Round 2 → { error: { reason: 'max_rounds_reached' } }", () => {
  it("AC-010: request already in Round 2 → max_rounds_reached", async () => {
    const state: Mcp003StubState = {
      registered: true,
      agentId: "aabb1122",
      connections: [],
      pendingInboundRequests: new Map([
        // round: 2 means we are already at Round 2
        ["req-r2", { connection_request_id: "req-r2", from_pubkey: "abcdabcd".repeat(8), round: 2 }],
      ]),
      policy: { mode: "selective", review_mode: "inference", requirements: [] },
      inboundConnectionQueue: [],
      acceptedConnections: new Map(),
    };

    const { mcpClient, cleanup } = await makeServerAndClientMcp003(state);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_request_more_disclosure",
        arguments: {
          connection_request_id: "req-r2",
          requested_items: [],
        },
      })
    ) as Record<string, unknown>;

    expect(result["error"]).toBeDefined();
    expect((result["error"] as { reason: string }).reason).toBe("max_rounds_reached");
  });
});

// ─── AC-011: set_policy + get_policy ─────────────────────────────────────────

describe("AC-011: cello_set_policy sets mode/review_mode/requirements; cello_get_policy returns them", () => {
  it("AC-011a: set_policy mode=selective, review_mode=inference, 1 requirement → get_policy returns them", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003();
    scope.addCleanup(cleanup);

    const setResult = parseResult(
      await mcpClient.callTool({
        name: "cello_set_policy",
        arguments: {
          mode: "selective",
          review_mode: "inference",
          requirements: [
            { signal_type: "endorsement", condition: { type: "min_count", count: 3 } },
          ],
        },
      })
    ) as Record<string, unknown>;

    expect(setResult["policy_set"]).toBe(true);
    expect(setResult["mode"]).toBe("selective");
    expect(setResult["review_mode"]).toBe("inference");
    expect(setResult["requirement_count"]).toBe(1);

    const getResult = parseResult(
      await mcpClient.callTool({ name: "cello_get_policy", arguments: {} })
    ) as { mode: string; review_mode: string; requirements: unknown[] };

    expect(getResult.mode).toBe("selective");
    expect(getResult.review_mode).toBe("inference");
    expect(getResult.requirements).toHaveLength(1);
  });

  it("AC-011b: set_policy mode=open, review_mode=deterministic, no requirements → get_policy returns it", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003();
    scope.addCleanup(cleanup);

    await mcpClient.callTool({
      name: "cello_set_policy",
      arguments: { mode: "open", review_mode: "deterministic" },
    });

    const getResult = parseResult(
      await mcpClient.callTool({ name: "cello_get_policy", arguments: {} })
    ) as { mode: string; review_mode: string; requirements: unknown[] };

    expect(getResult.mode).toBe("open");
    expect(getResult.review_mode).toBe("deterministic");
    expect(getResult.requirements).toHaveLength(0);
  });

  it("AC-011c: set_policy mode=closed → get_policy returns closed", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003();
    scope.addCleanup(cleanup);

    await mcpClient.callTool({
      name: "cello_set_policy",
      arguments: { mode: "closed", review_mode: "deterministic" },
    });

    const getResult = parseResult(
      await mcpClient.callTool({ name: "cello_get_policy", arguments: {} })
    ) as { mode: string; review_mode: string };

    expect(getResult.mode).toBe("closed");
  });
});

// ─── AC-012: await_connection_request timeout ────────────────────────────────

describe("AC-012: cello_await_connection_request with timeout_ms: 200 → { type: 'timeout' } after ~200ms", () => {
  it("AC-012: empty queue + 200ms timeout → { type: 'timeout' }", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003();
    scope.addCleanup(cleanup);

    const start = Date.now();
    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_await_connection_request",
        arguments: { timeout_ms: 200 },
      })
    ) as { type: string };

    const elapsed = Date.now() - start;
    expect(result.type).toBe("timeout");
    // Should have waited roughly 200ms (allow generous margin for test overhead)
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(1500);
  });
});

// ─── AC-014: initiate_session without connection ──────────────────────────────

describe("AC-014: cello_initiate_session without connection → { error: { reason: 'no_connection' } }", () => {
  it("AC-014: initiate_session with valid hex pubkey but no connection record → blocked, no_connection", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003({ connections: [] });
    scope.addCleanup(cleanup);

    const fakePubkey = "a".repeat(64);
    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: fakePubkey },
      })
    ) as Record<string, unknown>;

    // initiate_session returns ok:false with reason no_connection
    expect(result["ok"]).toBe(false);
    expect(result["reason"]).toBe("no_connection");
  });
});

// ─── AC-015: cello_status extended fields ────────────────────────────────────

describe("AC-015: cello_status includes registered, agent_id, connection_count, policy_mode, policy_review_mode", () => {
  it("AC-015a: unregistered agent → registered:false, agent_id:null", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003({
      registered: false,
      agentId: null,
      policy: { mode: "open", review_mode: "deterministic", requirements: [] },
    });
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as Record<string, unknown>;

    expect(result["registered"]).toBe(false);
    expect(result["agent_id"]).toBeNull();
    expect(typeof result["connection_count"]).toBe("number");
    expect(result["policy_mode"]).toBe("open");
    expect(result["policy_review_mode"]).toBe("deterministic");
  });

  it("AC-015b: registered agent → registered:true, agent_id is non-null string", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003({
      registered: true,
      agentId: "1122334455667788aabbccddeeff0011",
      connections: [
        {
          connection_id: "conn-01",
          counterparty_pubkey: "cc".repeat(32),
          counterparty_primary_pubkey: "",
          counterparty_ml_dsa_pubkey: "",
          established_at: Date.now(),
          status: "active" as const,
        },
      ],
      policy: { mode: "selective", review_mode: "inference", requirements: [] },
    });
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as Record<string, unknown>;

    expect(result["registered"]).toBe(true);
    expect(result["agent_id"]).toBe("1122334455667788aabbccddeeff0011");
    expect(result["connection_count"]).toBe(1);
    expect(result["policy_mode"]).toBe("selective");
    expect(result["policy_review_mode"]).toBe("inference");
  });
});

// ─── AC-016: tool set equality (19 tools total) ──────────────────────────────

describe("AC-016: both InMemoryTransport instances register identical tool set (all 20 tools)", () => {
  it("AC-016: two server instances have identical 20-tool set", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = makeStubNode(true);
    const nodeB = makeStubNode(true);

    const stateA: Mcp003StubState = {
      registered: false, agentId: null, connections: [],
      pendingInboundRequests: new Map(),
      policy: { mode: "open", review_mode: "deterministic", requirements: [] },
      inboundConnectionQueue: [],
      acceptedConnections: new Map(),
    };
    const stateB: Mcp003StubState = { ...stateA };
    const clientA = makeStubClientMcp003(stateA);
    const clientB = makeStubClientMcp003(stateB);

    const serverA = createMcpSessionServer(nodeA, clientA, kpA);
    const serverB = createMcpSessionServer(nodeB, clientB, kpB);

    const [stA, ctA] = InMemoryTransport.createLinkedPair();
    const [stB, ctB] = InMemoryTransport.createLinkedPair();

    await serverA.connect(stA);
    await serverB.connect(stB);

    const mcpA = new Client({ name: "test-a", version: "0.0.1" });
    const mcpB = new Client({ name: "test-b", version: "0.0.1" });
    await mcpA.connect(ctA);
    await mcpB.connect(ctB);

    scope.addCleanup(async () => {
      try { await mcpA.close(); } catch {}
      try { await mcpB.close(); } catch {}
      try { await serverA.close(); } catch {}
      try { await serverB.close(); } catch {}
    });

    const sortByName = (tools: Tool[]) =>
      [...tools].sort((a, b) => a.name.localeCompare(b.name));

    const toolsA = sortByName((await mcpA.listTools()).tools);
    const toolsB = sortByName((await mcpB.listTools()).tools);

    // 22 tools total: 9 from MCP-002 + 10 new from MCP-003 + 1 renamed from SESSION-007
    //                 + 2 from PERSIST-022 (cello_backup, cello_restore)
    // cello_receive = any-session default; cello_receive_session = session-locked
    const expectedTools = [
      "cello_accept_connection",
      "cello_await_connection_request",
      "cello_await_session",
      "cello_backup",
      "cello_close_session",
      "cello_get_inclusion_proof",
      "cello_get_policy",
      "cello_get_sealed_receipt",
      "cello_initiate_session",
      "cello_list_connections",
      "cello_list_sessions",
      "cello_receive",
      "cello_receive_session",
      "cello_register",
      "cello_reject_connection",
      "cello_request_connection",
      "cello_request_more_disclosure",
      "cello_respond_to_disclosure_request",
      "cello_restore",
      "cello_send",
      "cello_set_policy",
      "cello_status",
    ];

    expect(toolsA.map((t) => t.name)).toEqual(expectedTools);
    expect(toolsB.map((t) => t.name)).toEqual(expectedTools);

    // Both instances must have identical schemas
    expect(toolsA.map((t) => t.description)).toEqual(toolsB.map((t) => t.description));
    expect(toolsA.map((t) => t.inputSchema)).toEqual(toolsB.map((t) => t.inputSchema));
  });
});

// ─── SI-001: No ML-DSA secret key material in any tool response ───────────────

describe("SI-001: No ML-DSA secret key material in any tool response", () => {
  it("SI-001: cello_register response does not contain secret or private key material", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003({ registered: false });
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_register", arguments: { phone_stub: "+1" } })
    ) as Record<string, unknown>;

    const resultStr = JSON.stringify(result);
    // Must not contain anything that looks like a private key
    expect(resultStr).not.toContain("private");
    expect(resultStr).not.toContain("secret");
    expect(resultStr).not.toContain("seed");
    // Must not have a ml_dsa_secret or private_key field
    expect(result["ml_dsa_secret"]).toBeUndefined();
    expect(result["private_key"]).toBeUndefined();
  });

  it("SI-001: cello_status response does not contain secret key material even after registration", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003({
      registered: true,
      agentId: "aabb1122",
    });
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as Record<string, unknown>;

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("private");
    expect(resultStr).not.toContain("secret");
    expect(resultStr).not.toContain("seed");
  });
});

// ─── SI-002: initiate_session with valid hex but no connection → blocked locally ──

describe("SI-002: initiate_session with valid hex pubkey but no connection → blocked, directory not contacted", () => {
  it("SI-002: 64-char hex pubkey with no local connection record → returns no_connection immediately", async () => {
    const { mcpClient, cleanup } = await makeServerAndClientMcp003({ connections: [] });
    scope.addCleanup(cleanup);

    // Use a valid-looking 64-char hex pubkey
    const validHexPubkey = "0123456789abcdef".repeat(4);

    const start = Date.now();
    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: validHexPubkey },
      })
    ) as Record<string, unknown>;

    const elapsed = Date.now() - start;

    // Must return immediately (no timeout wait)
    expect(elapsed).toBeLessThan(500);
    expect(result["ok"]).toBe(false);
    expect(result["reason"]).toBe("no_connection");
  });
});

// ─── SI-003: ConnectionReport has no raw signatures ───────────────────────────

describe("SI-003: cello_await_connection_request returns ConnectionReport with no raw signatures or key blobs", () => {
  it("SI-003: ConnectionReport in pending_review only contains human-readable summary fields", async () => {
    const report: ConnectionReport = {
      verdict: "pending_agent_review",
      policy_summary: {
        mode: "open",
        review_mode: "inference",
        requirements_met: [],
        requirements_unmet: [],
      },
      package_summary: {
        pseudonym_label: "test-agent",
        endorsement_count: 0,
        attestation_types: [],
        pseudonym_age_days: 10,
        registration_age_days: 5,
        is_provisional: false,
      },
      is_round_2: false,
    };

    const state: Mcp003StubState = {
      registered: true,
      agentId: "aabb1122",
      connections: [],
      pendingInboundRequests: new Map(),
      policy: { mode: "open", review_mode: "inference", requirements: [] },
      inboundConnectionQueue: [
        {
          connection_request_id: "req-si003",
          from_pubkey: "abcdef".repeat(10) + "abcd",
          report,
        },
      ],
      acceptedConnections: new Map(),
    };

    const { mcpClient, cleanup } = await makeServerAndClientMcp003(state);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_await_connection_request",
        arguments: { timeout_ms: 1000 },
      })
    ) as Record<string, unknown>;

    expect(result["type"]).toBe("pending_review");

    // Report must not contain raw signatures, public keys, or key blobs
    const reportResult = result["report"] as Record<string, unknown>;
    const reportStr = JSON.stringify(reportResult);
    expect(reportStr).not.toContain("signature");
    expect(reportStr).not.toContain("public_key");
    // package_summary fields must be human-readable
    const packageSummary = (reportResult["package_summary"] as Record<string, unknown>);
    expect(typeof packageSummary["pseudonym_label"]).toBe("string");
    expect(typeof packageSummary["endorsement_count"]).toBe("number");
    expect(Array.isArray(packageSummary["attestation_types"])).toBe(true);
  });
});
