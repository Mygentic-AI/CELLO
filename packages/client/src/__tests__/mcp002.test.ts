/**
 * CELLO-MCP-002: Session-aware MCP server — unit tests
 *
 * TDD Phase R — RED-first. Written before implementation is complete.
 *
 * Covered ACs (unit test scope):
 *   AC-007: unsealed session → cello_get_sealed_receipt and cello_get_inclusion_proof
 *           both return { error: { reason: 'session_not_sealed', session_id } }
 *   AC-008: sealed session, leaf_index out of range → 'leaf_index_out_of_range'
 *   AC-009: factory + two InMemoryTransport instances have identical M1 tool set and schemas
 *   SI-001: seal_rejected session → get_sealed_receipt and get_inclusion_proof return session_not_sealed
 *   SI-002: no K_local private key material in any tool response
 *   SI-003: cello_get_inclusion_proof — reconstructed root equals sealed_root in response
 *
 * Covered ACs (fixture test scope):
 *   AC-006: RFC 6962 cross-implementation vector — MERKLE-001 verifyInclusion agrees
 *           with the pre-committed fixture in rfc6962-external-verify.json
 *
 * E2E ACs (AC-001 through AC-005, AC-010, AC-011) are covered in
 * packages/e2e-tests/src/__tests__/mcp-002.test.ts.
 *
 * No mocks for cryptographic operations. Real keys, real trees, real signing.
 * Test infrastructure: mock CelloClient + CelloNode stubs for unit tests.
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
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeypair, buildMerkleTree, merkleRoot, verifyInclusion } from "@cello/crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createMcpSessionServer } from "../mcp-server.js";
import type { CelloClient, SessionRecord, SendResult, SendMessageResult, ReceiveAssignmentResult, SessionAssignmentEvent } from "../types.js";
import type { CelloNode } from "@cello/transport";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function fromHex(s: string): Uint8Array {
  return Buffer.from(s, "hex");
}

// Build a deterministic 7-leaf tree (5 msg + 2 ctrl) with known data.
// Matches the fixture in rfc6962-external-verify.json.
function buildFixtureLeaves(): Array<{ kind: "msg" | "ctrl"; s2_cbor: Uint8Array }> {
  return [
    { kind: "msg",  s2_cbor: new Uint8Array(32).fill(0x01) },
    { kind: "msg",  s2_cbor: new Uint8Array(32).fill(0x02) },
    { kind: "msg",  s2_cbor: new Uint8Array(32).fill(0x03) },
    { kind: "msg",  s2_cbor: new Uint8Array(32).fill(0x04) },
    { kind: "msg",  s2_cbor: new Uint8Array(32).fill(0x05) },
    { kind: "ctrl", s2_cbor: new Uint8Array(32).fill(0x10) },
    { kind: "ctrl", s2_cbor: new Uint8Array(32).fill(0x11) },
  ];
}

// Build a deterministic sealed_root for the fixture leaves.
function buildFixtureSealedRoot(): Uint8Array {
  const leaves = buildFixtureLeaves();
  const inputs = leaves.map((l) => ({ kind: l.kind, data: l.s2_cbor }));
  const tree = buildMerkleTree(inputs);
  return merkleRoot(tree);
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

// ─── Stub CelloClient ─────────────────────────────────────────────────────────

interface StubClientOptions {
  sessions?: SessionRecord[];
  onSessionAssignmentHandler?: (handler: (event: SessionAssignmentEvent) => void) => void;
}

function makeStubClient(opts: StubClientOptions = {}): CelloClient {
  const { sessions = [] } = opts;

  const stub: CelloClient = {
    addPeer: () => {},
    send: async () => ({ delivered: false, reason: "peer_not_connected" } as SendResult),
    registerHandler: async () => {},
    receive: () => null,
    peekAll: () => [],
    receiveSessionAssignment: async () => ({ ok: false, reason: "relay_auth_error" } as ReceiveAssignmentResult),
    listSessions: () => sessions,
    sendMessage: async () => ({ ok: false, reason: "session_not_found" } as SendMessageResult),
    receiveMessage: () => null,
    receiveAnyMessage: () => null,
    initiateSessionSeal: async () => ({ ok: false, reason: "session_not_active" }),
    closeSession: () => {},
    onSessionAssignment: (handler) => {
      opts.onSessionAssignmentHandler?.(handler);
    },
    initiateSession: async () => ({ ok: false, reason: "directory_unreachable" as const }),
    register: async () => ({ error: "not_implemented" }),
    // ─── MCP-003 additions ─────────────────────────────────────────────────
    getRegistrationState: () => null,
    getDirectoryPeerId: () => null,
    setPolicy: () => {},
    getPolicy: () => ({ mode: "open" as const, review_mode: "deterministic" as const, requirements: [] }),
    hasConnection: () => null,
    listConnections: () => [],
    acceptConnection: async () => ({ error: { reason: "no_pending_request" as const } }),
    rejectConnection: async () => ({ error: { reason: "no_pending_request" as const } }),
    requestMoreDisclosure: async () => ({ error: { reason: "no_pending_request" as const } }),
    awaitConnectionRequest: async () => ({ type: "timeout" as const }),
  };
  return stub;
}

// Build a minimal sealed SessionRecord.
function makeSealedSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const sessionId = new Uint8Array(32).fill(0xaa);
  const counterpartyPubkey = new Uint8Array(32).fill(0xbb);
  const genesisRoot = new Uint8Array(32).fill(0xcc);
  const leaves = buildFixtureLeaves();
  const sealedRoot = buildFixtureSealedRoot();

  return {
    session_id: sessionId,
    counterparty_pubkey: counterpartyPubkey,
    counterparty_peer_id: "12D3KooWCounterparty",
    counterparty_multiaddrs: ["/ip4/127.0.0.1/tcp/10000"],
    relay_endpoint: { peer_id: "12D3KooWRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/10001"] },
    directory_endpoint: { peer_id: "12D3KooWDir", multiaddrs: ["/ip4/127.0.0.1/tcp/10002"] },
    directory_pubkey: new Uint8Array(32).fill(0xdd),
    genesis_prev_root: genesisRoot,
    last_seen_seq: 5,
    last_sent_seq: 5,
    status: "sealed",
    sealed_root: sealedRoot,
    directory_signature: new Uint8Array(64).fill(0xee),
    close_timestamp: Date.now(),
    local_tree_leaves: leaves,
    next_expected_seq: 8,
    desynchronized: false,
    ...overrides,
  };
}

// Build a minimal active (unsealed) SessionRecord.
function makeActiveSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return makeSealedSession({
    status: "active",
    sealed_root: undefined,
    directory_signature: undefined,
    close_timestamp: undefined,
    ...overrides,
  });
}

// Build a seal_rejected SessionRecord.
function makeRejectedSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return makeSealedSession({
    status: "seal_rejected",
    sealed_root: undefined,
    directory_signature: undefined,
    ...overrides,
  });
}

// ─── MCP client setup helper ──────────────────────────────────────────────────

async function makeServerAndClient(
  sessions: SessionRecord[] = [],
  started = true,
): Promise<{
  mcpClient: Client;
  cleanup: () => Promise<void>;
}> {
  const kp = generateKeypair();
  const node = makeStubNode(started);
  const celloClient = makeStubClient({ sessions });
  const server = createMcpSessionServer(node, celloClient, kp);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcpClient = new Client({ name: "test", version: "0.0.1" });
  await mcpClient.connect(clientTransport);

  const cleanup = async () => {
    try { await mcpClient.close(); } catch {}
    try { await server.close(); } catch {}
  };

  return { mcpClient, cleanup };
}

// ─── Scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-006: RFC 6962 cross-implementation fixture ───────────────────────────

describe("AC-006: RFC 6962 cross-implementation fixture", () => {
  it("AC-006: MERKLE-001 verifyInclusion agrees with the pre-committed rfc6962-external-verify.json fixture", async () => {
    // Load the committed fixture from disk — cross-validates the inline constants below
    // against the JSON file so they cannot drift independently.
    const fixturePath = join(__dirname, "../../../../packages/e2e-tests/test/vectors/rfc6962-external-verify.json");
    const fixtureJson = JSON.parse(await readFile(fixturePath, "utf-8")) as {
      sealed_root: string;
      leaf_hash: string;
      leaf_index: number;
      tree_size: number;
      proof: string[];
      expected: boolean;
    };

    const leafHashBytes = fromHex(fixtureJson.leaf_hash);
    const sealedRootBytes = fromHex(fixtureJson.sealed_root);
    const proofBytes = fixtureJson.proof.map(fromHex);

    const result = verifyInclusion(
      leafHashBytes,
      fixtureJson.leaf_index,
      fixtureJson.tree_size,
      proofBytes,
      sealedRootBytes,
    );

    expect(result).toBe(fixtureJson.expected);

    // Also verify the fixture's leaf_hash and sealed_root match what MERKLE-001 computes
    // from the same fixture leaves (msg leaf at index 3 with data 0x04 * 32 bytes).
    // This confirms the JSON file and local computation agree on the same tree.
    const leaves = buildFixtureLeaves();
    const inputs = leaves.map((l) => ({ kind: l.kind, data: l.s2_cbor }));
    const tree = buildMerkleTree(inputs);
    const expectedLeafHash = tree.levelHashes[0][fixtureJson.leaf_index];
    expect(toHex(expectedLeafHash)).toBe(fixtureJson.leaf_hash);

    const expectedRoot = merkleRoot(tree);
    expect(toHex(expectedRoot)).toBe(fixtureJson.sealed_root);
  });
});

// ─── AC-007: unsealed session → not_sealed errors ────────────────────────────

describe("AC-007: active session → cello_get_sealed_receipt and cello_get_inclusion_proof return session_not_sealed", () => {
  it("AC-007: cello_get_sealed_receipt on active session → session_not_sealed", async () => {
    const session = makeActiveSession();
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_sealed_receipt",
        arguments: { session_id: sessionIdHex },
      })
    ) as { error: { reason: string; session_id: string } };

    expect(result.error.reason).toBe("session_not_sealed");
    expect(result.error.session_id).toBe(sessionIdHex);
  });

  it("AC-007: cello_get_inclusion_proof on active session → session_not_sealed", async () => {
    const session = makeActiveSession();
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: sessionIdHex, leaf_index: 0 },
      })
    ) as { error: { reason: string } };

    expect(result.error.reason).toBe("session_not_sealed");
  });
});

// ─── AC-008: leaf_index out of range ─────────────────────────────────────────

describe("AC-008: sealed session, leaf_index out of range → leaf_index_out_of_range", () => {
  it("AC-008: leaf_index == tree_size (7) on 7-leaf sealed session → leaf_index_out_of_range", async () => {
    const session = makeSealedSession();
    const sessionIdHex = toHex(session.session_id);
    const treeSize = session.local_tree_leaves.length; // 7
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: sessionIdHex, leaf_index: treeSize },
      })
    ) as { error: { reason: string; leaf_index: number; tree_size: number } };

    expect(result.error.reason).toBe("leaf_index_out_of_range");
    expect(result.error.leaf_index).toBe(treeSize);
    expect(result.error.tree_size).toBe(treeSize);
  });
});

// ─── AC-009: factory structural equality ─────────────────────────────────────

describe("AC-009: createMcpSessionServer registers identical M1 tool set under both transports", () => {
  it("AC-009: two InMemoryTransport instances have identical tool names, descriptions, and input schemas", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const nodeA = makeStubNode(true);
    const nodeB = makeStubNode(true);
    const clientA = makeStubClient();
    const clientB = makeStubClient();

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

    // MCP-003: 9 original tools + 10 new tools = 19 total
    const expectedTools = [
      "cello_accept_connection",
      "cello_await_connection_request",
      "cello_await_session",
      "cello_close_session",
      "cello_get_inclusion_proof",
      "cello_get_policy",
      "cello_get_sealed_receipt",
      "cello_initiate_session",
      "cello_list_connections",
      "cello_list_sessions",
      "cello_receive",
      "cello_register",
      "cello_reject_connection",
      "cello_request_connection",
      "cello_request_more_disclosure",
      "cello_respond_to_disclosure_request",
      "cello_send",
      "cello_set_policy",
      "cello_status",
    ];

    expect(toolsA.map((t) => t.name)).toEqual(expectedTools);
    expect(toolsB.map((t) => t.name)).toEqual(expectedTools);

    // Structural equality: descriptions and input schemas must match between instances
    expect(toolsA.map((t) => t.description)).toEqual(toolsB.map((t) => t.description));
    expect(toolsA.map((t) => t.inputSchema)).toEqual(toolsB.map((t) => t.inputSchema));
  });
});

// ─── SI-001: seal_rejected → not_sealed for receipt and proof ────────────────

describe("SI-001: seal_rejected session → cello_get_sealed_receipt and cello_get_inclusion_proof return session_not_sealed", () => {
  it("SI-001: cello_get_sealed_receipt on seal_rejected session → session_not_sealed (no sealed_root emitted)", async () => {
    const session = makeRejectedSession();
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_sealed_receipt",
        arguments: { session_id: sessionIdHex },
      })
    ) as Record<string, unknown>;

    // Must return error, not a receipt
    expect(result["error"]).toBeDefined();
    expect((result["error"] as { reason: string }).reason).toBe("session_not_sealed");
    // Must not contain sealed_root
    expect(result["sealed_root"]).toBeUndefined();
  });

  it("SI-001: cello_get_inclusion_proof on seal_rejected session → session_not_sealed (no proof emitted)", async () => {
    const session = makeRejectedSession();
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: sessionIdHex, leaf_index: 0 },
      })
    ) as Record<string, unknown>;

    expect(result["error"]).toBeDefined();
    expect((result["error"] as { reason: string }).reason).toBe("session_not_sealed");
    // Must not contain proof or sealed_root
    expect(result["proof"]).toBeUndefined();
    expect(result["sealed_root"]).toBeUndefined();
  });
});

// ─── SI-002: no private key material in any tool response ────────────────────

describe("SI-002: no K_local private key material in any tool response", () => {
  it("SI-002: cello_status response contains only expected public fields", async () => {
    const kp = generateKeypair();
    const node = makeStubNode(true);
    const celloClient = makeStubClient();
    const server = createMcpSessionServer(node, celloClient, kp);

    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => {
      try { await mcpClient.close(); } catch {}
      try { await server.close(); } catch {}
    });

    const expectedPublicKey = toHex(await kp.getPublicKey());

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as Record<string, unknown>;

    // own_pubkey must equal the public key exactly
    expect(result["own_pubkey"]).toBe(expectedPublicKey);

    // No private key material: no unexpected top-level keys
    const keys = Object.keys(result).sort();
    expect(keys).not.toContain("private_key");
    expect(keys).not.toContain("secret");
    expect(keys).not.toContain("seed");
    // MCP-003 extends cello_status with registration/connection/policy fields
    expect(keys).toEqual([
      "active_session_count",
      "agent_id",
      "connected_peer_count",
      "connection_count",
      "directory_reachable",
      "listen_addresses",
      "own_pubkey",
      "policy_mode",
      "policy_review_mode",
      "registered",
      "transport_started",
      "uptime_seconds",
    ]);
  });

  it("SI-002: cello_get_sealed_receipt error response contains no key material", async () => {
    // session_not_found path — no session at all
    const { mcpClient, cleanup } = await makeServerAndClient([]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_sealed_receipt",
        arguments: { session_id: "a".repeat(64) },
      })
    ) as Record<string, unknown>;

    // Must be an error, not a data response
    expect(result["error"]).toBeDefined();
    // No key material in error
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("private");
    expect(resultStr).not.toContain("secret");
    expect(resultStr).not.toContain("seed");
  });
});

// ─── SI-003: inclusion proof self-consistency ─────────────────────────────────

describe("SI-003: cello_get_inclusion_proof — reconstructed root equals sealed_root in response", () => {
  it("SI-003: proof for leaf_index=3 in 7-leaf tree — verifyInclusion against returned sealed_root returns true", async () => {
    const session = makeSealedSession();
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: sessionIdHex, leaf_index: 3 },
      })
    ) as {
      leaf_hash: string;
      leaf_index: number;
      tree_size: number;
      proof: string[];
      sealed_root: string;
    };

    expect(result.leaf_index).toBe(3);
    expect(result.tree_size).toBe(7);
    expect(result.proof).toHaveLength(3); // 7-leaf tree needs 3 sibling hashes

    // SI-003: reconstructed root must equal the returned sealed_root
    const leafHashBytes = fromHex(result.leaf_hash);
    const proofBytes = result.proof.map(fromHex);
    const sealedRootBytes = fromHex(result.sealed_root);

    const valid = verifyInclusion(
      leafHashBytes,
      result.leaf_index,
      result.tree_size,
      proofBytes,
      sealedRootBytes,
    );
    expect(valid).toBe(true);

    // Also verify the returned sealed_root matches the expected fixture value
    const expectedRoot = buildFixtureSealedRoot();
    expect(result.sealed_root).toBe(toHex(expectedRoot));
  });

  it("SI-003: all valid leaf indices 0..6 produce proofs that verify against the same sealed_root", async () => {
    const session = makeSealedSession();
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const expectedRoot = toHex(buildFixtureSealedRoot());

    for (let i = 0; i < 7; i++) {
      const result = parseResult(
        await mcpClient.callTool({
          name: "cello_get_inclusion_proof",
          arguments: { session_id: sessionIdHex, leaf_index: i },
        })
      ) as {
        leaf_hash: string;
        leaf_index: number;
        tree_size: number;
        proof: string[];
        sealed_root: string;
      };

      expect(result.sealed_root).toBe(expectedRoot);

      const valid = verifyInclusion(
        fromHex(result.leaf_hash),
        result.leaf_index,
        result.tree_size,
        result.proof.map(fromHex),
        fromHex(result.sealed_root),
      );
      expect(valid).toBe(true);
    }
  });
});

// ─── Additional unit coverage ─────────────────────────────────────────────────

describe("cello_status: active_session_count and directory_reachable fields", () => {
  it("returns active_session_count=0 and directory_reachable=false when no sessions", async () => {
    const { mcpClient, cleanup } = await makeServerAndClient([]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as { active_session_count: number; directory_reachable: boolean };

    expect(result.active_session_count).toBe(0);
    expect(result.directory_reachable).toBe(false);
  });

  it("returns active_session_count=1 when one active session exists", async () => {
    const session = makeActiveSession();
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_status", arguments: {} })
    ) as { active_session_count: number; directory_reachable: boolean };

    expect(result.active_session_count).toBe(1);
    // Active session has directory_endpoint.peer_id set → reachable
    expect(result.directory_reachable).toBe(true);
  });
});

describe("cello_list_sessions: returns session list with leaf_count", () => {
  it("returns empty array when no sessions", async () => {
    const { mcpClient, cleanup } = await makeServerAndClient([]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_list_sessions", arguments: {} })
    ) as unknown[];

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("returns one session with correct fields and leaf_count=7 for sealed session", async () => {
    const session = makeSealedSession();
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_list_sessions", arguments: {} })
    ) as Array<{
      session_id: string;
      counterparty_pubkey: string;
      status: string;
      leaf_count: number;
      last_seen_seq: number;
    }>;

    expect(result).toHaveLength(1);
    const s = result[0];
    expect(s.session_id).toBe(toHex(session.session_id));
    expect(s.counterparty_pubkey).toBe(toHex(session.counterparty_pubkey));
    expect(s.status).toBe("sealed");
    expect(s.leaf_count).toBe(7);
    expect(s.last_seen_seq).toBe(5);
  });
});

describe("cello_get_sealed_receipt: sealed session returns full receipt", () => {
  it("returns full receipt with PENDING attestation fields for sealed session", async () => {
    const kp = generateKeypair();
    const node = makeStubNode(true);
    const session = makeSealedSession();
    const sessionIdHex = toHex(session.session_id);
    const celloClient = makeStubClient({ sessions: [session] });
    const server = createMcpSessionServer(node, celloClient, kp);

    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => {
      try { await mcpClient.close(); } catch {}
      try { await server.close(); } catch {}
    });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_sealed_receipt",
        arguments: { session_id: sessionIdHex },
      })
    ) as {
      session_id: string;
      sealed_root: string;
      participants: string[];
      close_timestamp: number;
      attestation_self: string;
      attestation_counterparty: string;
      leaf_count: number;
      directory_signature: string;
    };

    expect(result.session_id).toBe(sessionIdHex);
    expect(result.sealed_root).toBe(toHex(session.sealed_root!));
    expect(result.participants).toHaveLength(2);
    expect(result.attestation_self).toBe("PENDING");
    expect(result.attestation_counterparty).toBe("PENDING");
    expect(result.leaf_count).toBe(7);
    expect(result.directory_signature).toBe(toHex(session.directory_signature!));
    // Participants must be lowercase hex, no 0x prefix
    expect(result.participants[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(result.participants[1]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cello_get_sealed_receipt: session_not_found for unknown session", () => {
  it("returns session_not_found for unknown session_id", async () => {
    const { mcpClient, cleanup } = await makeServerAndClient([]);
    scope.addCleanup(cleanup);

    const unknownId = "b".repeat(64);
    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_sealed_receipt",
        arguments: { session_id: unknownId },
      })
    ) as { error: { reason: string; session_id: string } };

    expect(result.error.reason).toBe("session_not_found");
    expect(result.error.session_id).toBe(unknownId);
  });
});

describe("cello_await_session: timeout when no inbound sessions", () => {
  it("returns {type: 'timeout'} when inbound queue is empty and timeout expires", async () => {
    const { mcpClient, cleanup } = await makeServerAndClient([]);
    scope.addCleanup(cleanup);

    const before = Date.now();
    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_await_session",
        arguments: { timeout_ms: 200 },
      })
    ) as { type: string };

    expect(result.type).toBe("timeout");
    expect(Date.now() - before).toBeGreaterThanOrEqual(180);
  });
});

describe("cello_receive: timeout when no messages", () => {
  it("returns {type: 'timeout'} when no messages and timeout expires", async () => {
    const session = makeActiveSession();
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_receive",
        arguments: { session_id: sessionIdHex, timeout_ms: 200 },
      })
    ) as { type: string };

    expect(result.type).toBe("timeout");
  });
});

// ─── SI-003 adversarial: local tree root ≠ directory sealed_root ──────────────

describe("SI-003 adversarial: local tree root inconsistent with directory sealed_root → local_tree_inconsistent error", () => {
  it("SI-003: session with sealed_root that does not match local tree root → local_tree_inconsistent error, no proof emitted", async () => {
    // Create a sealed session where sealed_root is deliberately wrong (all 0xff bytes).
    // The local tree root computed from the leaves will differ from this value,
    // so cello_get_inclusion_proof must detect the inconsistency and return an error.
    const wrongSealedRoot = new Uint8Array(32).fill(0xff);
    const session = makeSealedSession({ sealed_root: wrongSealedRoot });
    const sessionIdHex = toHex(session.session_id);
    const { mcpClient, cleanup } = await makeServerAndClient([session]);
    scope.addCleanup(cleanup);

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: sessionIdHex, leaf_index: 0 },
      })
    ) as Record<string, unknown>;

    // Must return an error, not a proof
    expect(result["error"]).toBeDefined();
    const err = result["error"] as { reason: string; session_id: string; local_root: string; directory_root: string };
    expect(err.reason).toBe("local_tree_inconsistent");
    expect(err.session_id).toBe(sessionIdHex);
    // Must not include proof or sealed_root at top level
    expect(result["proof"]).toBeUndefined();
    expect(result["sealed_root"]).toBeUndefined();
  });
});
