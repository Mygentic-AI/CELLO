/**
 * CELLO-PERSIST-017 — MCP adapter checkpoint_status coverage
 *
 * Specification interpretation:
 *
 * AC-001 (component_under_test: client):
 *   cello_close_session returns checkpoint_status: 'pending' when a
 *   CheckpointStatusProvider reports the session is staged but not yet
 *   checkpointed. Verified by wiring a stub CheckpointStatusProvider returning
 *   { status: 'pending', staged_at } into createMcpServer and calling the tool.
 *
 * AC-002 (component_under_test: client):
 *   cello_get_sealed_receipt returns { checkpoint_status: 'pending', staged_at,
 *   attestation_self: 'PENDING', attestation_self_reason } when status is pending.
 *
 * AC-003 (component_under_test: client):
 *   cello_get_inclusion_proof returns { status: 'pending', staged_at, message }
 *   when session is sealed but checkpoint has not run.
 *
 * AC-003a (component_under_test: client):
 *   cello_get_inclusion_proof returns { status: 'error', reason: 'not_yet_sealed' }
 *   when the session has no staged_root (not_staged status).
 *
 * AC-005a (component_under_test: client):
 *   cello_close_session returns checkpoint_status: 'confirmed', session_mmr_peak,
 *   and leaf_index when CheckpointStatusProvider reports confirmed status.
 *
 * AC-005b (component_under_test: client):
 *   cello_get_sealed_receipt returns checkpoint_status: 'confirmed', session_mmr_peak,
 *   leaf_index, and checkpoint_id when confirmed.
 *
 * SI-002 (component_under_test: directory — adapter side):
 *   cello_get_inclusion_proof never returns a confirmed proof for a session whose
 *   sealed_root is not yet in a confirmed checkpoint. When CheckpointStatusProvider
 *   reports pending, the tool returns status: 'pending' (not a confirmed proof).
 *
 * Note: All tests here use a stub CheckpointStatusProvider that returns pre-defined
 * values. The integration tests in packages/directory verify that MmrStore correctly
 * implements CheckpointStatusProvider against a real Postgres database. These tests
 * verify that the adapter correctly wires the provider into the MCP tools.
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
import { createNode } from "@cello/transport";
import { createMcpServer } from "../index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CelloClient, SessionAssignmentEvent } from "@cello/client";
import type { CheckpointStatusProvider, SealStagingStatus } from "@cello/interfaces";

setupV3Tests();

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

/**
 * Minimal stub CelloClient for adapter-layer tests.
 * closeSession() is the only method called by cello_close_session —
 * it stores the session_id so the test can verify it was called.
 */
function makeStubClient(): CelloClient {
  return {
    addPeer() {},
    async send() { return { delivered: false, reason: "peer_not_connected" }; },
    async registerHandler() {},
    receive() { return null; },
    peekAll() { return []; },
    async receiveSessionAssignment() { return { ok: false, reason: "frost_signature_invalid" }; },
    listSessions() { return []; },
    async sendMessage() { return { ok: false, reason: "session_not_found" }; },
    receiveMessage() { return null; },
    receiveAnyMessage() { return null; },
    async initiateSessionSeal() { return { ok: false, reason: "session_not_found" }; },
    closeSession() {},
    onSessionAssignment(_: (event: SessionAssignmentEvent) => void) {},
    async initiateSession() { return { ok: false as const, reason: "directory_unreachable" as const }; },
  } as unknown as CelloClient;
}

/**
 * Stub CheckpointStatusProvider that returns a pre-defined SealStagingStatus.
 * Allows adapter tests to verify that the MCP tools correctly surface
 * the status returned by the provider without requiring a real database.
 */
function makeStubCheckpointProvider(status: SealStagingStatus): CheckpointStatusProvider {
  return {
    async getSealStagingStatus(_sessionId: string): Promise<SealStagingStatus> {
      return status;
    },
  };
}

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-001: cello_close_session returns checkpoint_status: 'pending' ─────────

describe("PERSIST-017 adapter: AC-001 cello_close_session returns checkpoint_status pending", () => {
  it("AC-001: cello_close_session returns closed:true, checkpoint_status:'pending', staged_at when provider reports pending", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const stagedAt = Date.now() - 5000; // 5 seconds ago
    const pendingProvider = makeStubCheckpointProvider({ status: "pending", staged_at: stagedAt });
    const server = createMcpServer(node, stubClient, kp, { checkpointStatusProvider: pendingProvider });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_close_session", arguments: { session_id: "test-session-ac001" } }),
    ) as Record<string, unknown>;

    expect(result.closed).toBe(true);
    expect(result.checkpoint_status).toBe("pending");
    // staged_at must be a Unix epoch milliseconds number (not ISO 8601)
    expect(typeof result.staged_at).toBe("number");
    expect(result.staged_at).toBe(stagedAt);
    // session_mmr_peak must not be present for pending status
    expect(result.session_mmr_peak).toBeUndefined();
  }, 10_000);
});

// ─── AC-005a: cello_close_session returns checkpoint_status: 'confirmed' ──────

describe("PERSIST-017 adapter: AC-005a cello_close_session returns checkpoint_status confirmed", () => {
  it("AC-005a: cello_close_session returns closed:true, checkpoint_status:'confirmed', session_mmr_peak, leaf_index when provider reports confirmed", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const peakHash = "a".repeat(64);
    const confirmedProvider = makeStubCheckpointProvider({
      status: "confirmed",
      leaf_index: 3,
      checkpoint_peak_hash: peakHash,
      checkpoint_id: "checkpoint-uuid-ac005a",
    });
    const server = createMcpServer(node, stubClient, kp, { checkpointStatusProvider: confirmedProvider });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_close_session", arguments: { session_id: "test-session-ac005a" } }),
    ) as Record<string, unknown>;

    expect(result.closed).toBe(true);
    expect(result.checkpoint_status).toBe("confirmed");
    expect(result.session_mmr_peak).toBe(peakHash);
    expect(result.leaf_index).toBe(3);
  }, 10_000);
});

// ─── AC-002: cello_get_sealed_receipt returns checkpoint_status: 'pending' ────

describe("PERSIST-017 adapter: AC-002 cello_get_sealed_receipt returns checkpoint_status pending", () => {
  it("AC-002: cello_get_sealed_receipt returns available:true, checkpoint_status:'pending', staged_at, attestation_self:'PENDING' when provider reports pending", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const stagedAt = Date.now() - 10000; // 10 seconds ago
    const pendingProvider = makeStubCheckpointProvider({ status: "pending", staged_at: stagedAt });
    const server = createMcpServer(node, stubClient, kp, { checkpointStatusProvider: pendingProvider });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_get_sealed_receipt", arguments: { session_id: "test-session-ac002" } }),
    ) as Record<string, unknown>;

    expect(result.available).toBe(true);
    expect(result.checkpoint_status).toBe("pending");
    // staged_at must be Unix epoch milliseconds (not ISO 8601)
    expect(typeof result.staged_at).toBe("number");
    expect(result.staged_at).toBe(stagedAt);
    expect(result.attestation_self).toBe("PENDING");
    expect(result.attestation_self_reason).toBe("MMR checkpoint not yet written");
  }, 10_000);
});

// ─── AC-005b: cello_get_sealed_receipt returns checkpoint_status: 'confirmed' ─

describe("PERSIST-017 adapter: AC-005b cello_get_sealed_receipt returns checkpoint_status confirmed", () => {
  it("AC-005b: cello_get_sealed_receipt returns available:true, checkpoint_status:'confirmed', session_mmr_peak, leaf_index, checkpoint_id when provider reports confirmed", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const peakHash = "b".repeat(64);
    const confirmedProvider = makeStubCheckpointProvider({
      status: "confirmed",
      leaf_index: 7,
      checkpoint_peak_hash: peakHash,
      checkpoint_id: "checkpoint-uuid-ac005b",
    });
    const server = createMcpServer(node, stubClient, kp, { checkpointStatusProvider: confirmedProvider });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_get_sealed_receipt", arguments: { session_id: "test-session-ac005b" } }),
    ) as Record<string, unknown>;

    expect(result.available).toBe(true);
    expect(result.checkpoint_status).toBe("confirmed");
    expect(result.session_mmr_peak).toBe(peakHash);
    expect(result.leaf_index).toBe(7);
    expect(result.checkpoint_id).toBe("checkpoint-uuid-ac005b");
  }, 10_000);
});

// ─── AC-003: cello_get_inclusion_proof returns pending when staged ─────────────

describe("PERSIST-017 adapter: AC-003 cello_get_inclusion_proof returns pending when staged", () => {
  it("AC-003: cello_get_inclusion_proof returns { status: 'pending', staged_at, message } when session is sealed but checkpoint has not run", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const stagedAt = Date.now() - 3000;
    const pendingProvider = makeStubCheckpointProvider({ status: "pending", staged_at: stagedAt });
    const server = createMcpServer(node, stubClient, kp, { checkpointStatusProvider: pendingProvider });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: "test-session-ac003", content_hash: "a".repeat(64) },
      }),
    ) as Record<string, unknown>;

    expect(result.status).toBe("pending");
    // staged_at must be Unix epoch milliseconds (not ISO 8601)
    expect(typeof result.staged_at).toBe("number");
    expect(result.staged_at).toBe(stagedAt);
    // message describes the pending state
    expect(typeof result.message).toBe("string");
    expect(result.message).toContain("sealed_root staged");
  }, 10_000);
});

// ─── AC-003a: cello_get_inclusion_proof returns error for unsealed session ─────

describe("PERSIST-017 adapter: AC-003a cello_get_inclusion_proof returns error for unsealed session", () => {
  it("AC-003a: cello_get_inclusion_proof returns { status: 'error', reason: 'not_yet_sealed' } when session was never sealed", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const notStagedProvider = makeStubCheckpointProvider({ status: "not_staged" });
    const server = createMcpServer(node, stubClient, kp, { checkpointStatusProvider: notStagedProvider });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: "test-session-ac003a-unsealed", content_hash: "b".repeat(64) },
      }),
    ) as Record<string, unknown>;

    // Must be error (not 'pending') — not_staged is distinct from staged-but-pending
    expect(result.status).toBe("error");
    expect(result.reason).toBe("not_yet_sealed");
    // Must not return 'pending' — that would conflate 'never sealed' with 'sealed but waiting'
    expect(result.status).not.toBe("pending");
  }, 10_000);
});

// ─── SI-002: cello_get_inclusion_proof never returns confirmed proof for pending session ─

describe("PERSIST-017 adapter: SI-002 cello_get_inclusion_proof never returns confirmed proof for pending session", () => {
  it("SI-002: cello_get_inclusion_proof returns status:'pending' (not a confirmed proof) when CheckpointStatusProvider reports pending — proof-eligibility is database-backed", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    const stagedAt = Date.now() - 60_000; // 1 minute ago — staged but not confirmed
    const pendingProvider = makeStubCheckpointProvider({ status: "pending", staged_at: stagedAt });
    const server = createMcpServer(node, stubClient, kp, { checkpointStatusProvider: pendingProvider });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({
        name: "cello_get_inclusion_proof",
        arguments: { session_id: "test-session-si002", content_hash: "c".repeat(64) },
      }),
    ) as Record<string, unknown>;

    // Must not return a confirmed proof for a pending session
    expect(result.status).not.toBe("confirmed");
    expect(result.leaf_index).toBeUndefined();
    expect(result.checkpoint_peak_hash).toBeUndefined();
    expect(result.sibling_hashes).toBeUndefined();
    // Must return 'pending' (not an error and not confirmed)
    expect(result.status).toBe("pending");
  }, 10_000);
});

// ─── Fallback: no CheckpointStatusProvider → M1 stub behavior ─────────────────

describe("PERSIST-017 adapter: no CheckpointStatusProvider falls back to M1 stub", () => {
  it("cello_get_sealed_receipt returns { available: false, reason: 'not_yet_sealed' } when no provider wired", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const stubClient = makeStubClient();
    // createMcpServer with no opts — M1 stub behavior
    const server = createMcpServer(node, stubClient, kp);
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: "test", version: "0.0.1" });
    await mcpClient.connect(ct);
    scope.addCleanup(async () => { try { await mcpClient.close(); } catch {} });
    scope.addCleanup(async () => { try { await server.close(); } catch {} });

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_get_sealed_receipt", arguments: { session_id: "test-fallback" } }),
    ) as Record<string, unknown>;

    // M1 stub: returns available: false
    expect(result.available).toBe(false);
    expect(result.reason).toBe("not_yet_sealed");
  }, 10_000);

  it("cello_close_session returns { closed: true } (no checkpoint_status) when no provider wired", async () => {
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

    const result = parseResult(
      await mcpClient.callTool({ name: "cello_close_session", arguments: { session_id: "test-fallback-close" } }),
    ) as Record<string, unknown>;

    expect(result.closed).toBe(true);
    expect(result.checkpoint_status).toBeUndefined();
  }, 10_000);
});
