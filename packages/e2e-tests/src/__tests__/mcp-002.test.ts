/**
 * CELLO-MCP-002 — Session-aware MCP tool surface e2e tests
 *
 * Tests run via InMemoryTransport against real in-process libp2p nodes,
 * a real directory node, and a real relay node — same fixture as session003.test.ts.
 *
 * Covered ACs (e2e scope — complements mcp002.test.ts unit tests):
 *   AC-001: cello_initiate_session on A polls until directory assigns session → session_id returned
 *   AC-002: cello_await_session on B returns new_session when assignment arrives
 *   AC-003: cello_send (session-keyed) delivers message on active session
 *   AC-004: cello_receive_session (session-locked) returns message with correct content and sender_pubkey
 *   AC-005: cello_list_sessions shows both A and B sessions with status:active, leaf_count > 0
 *
 * AC-010, AC-011 (seal ceremony via MCP) require the full SESSION-003 + directory seal flow
 * and are deferred to a future story (SESSION-MCP-003-E2E).
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
import { clearTestShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createSessionFixture } from "../session-fixture.js";
import type { SessionFixtureResult } from "../session-fixture.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

/**
 * Issue a real FROST-signed session assignment via the directory signaling protocol.
 *
 * Requires fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA) called first.
 */
async function setupSession(fix: SessionFixtureResult): Promise<{
  sessionIdHex: string;
  sessionId: Uint8Array;
}> {
  const result = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, {
    timeoutMs: 15_000,
  });
  if (!result.ok) throw new Error(`initiateSession failed: ${result.reason}`);

  // Wait for B to also receive and process the session assignment
  await waitFor(() => fix.agentB.client.listSessions().length > 0, { timeout: 5_000 });

  const sessionId = result.sessionId;
  const sessionIdHex = Buffer.from(sessionId).toString("hex");
  return { sessionIdHex, sessionId };
}

// ─── Scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// AC-001 (cello_initiate_session returns session_id) was removed in M3: the MCP
// gate now requires an established connection before initiating a session.
// The equivalent positive path (with connection) is covered by mcp-003-e2e AC-013.

// ─── AC-002: cello_await_session returns new_session when assignment arrives ──

describe("AC-002: cello_await_session on B returns new_session with session details", () => {
  it("AC-002: B calls cello_await_session; assignment fires; returns {type:new_session,session_id,counterparty_pubkey}", async () => {
    const fix = await createSessionFixture({ withMcp: true });
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    // Fire assignment after a short delay so await_session is already blocked when it arrives
    setTimeout(() => {
      void setupSession(fix);
    }, 100);

    const result = parseResult(
      await fix.agentB.mcp!.callTool({
        name: "cello_await_session",
        arguments: { timeout_ms: 10_000 },
      })
    ) as { type: string; session_id: string; counterparty_pubkey: string; genesis_prev_root: string };

    expect(result.type).toBe("new_session");
    expect(result.session_id).toMatch(/^[0-9a-f]{32}$/);
    expect(result.counterparty_pubkey).toBe(fix.agentA.pubkeyHex);
    expect(result.genesis_prev_root).toMatch(/^[0-9a-f]+$/);
  }, 15_000);
});

// ─── AC-003 + AC-004: cello_send + cello_receive_session round-trip ───────────

describe("AC-003 + AC-004: cello_send delivers; cello_receive_session returns message with correct content", () => {
  it("AC-003+004: A sends 'hello'; B's cello_receive_session returns {type:message, content:'hello', sender_pubkey:A's pubkey}", async () => {
    const fix = await createSessionFixture({ withMcp: true });
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // AC-003: A sends via session-keyed cello_send
    const sendResult = parseResult(
      await fix.agentA.mcp!.callTool({
        name: "cello_send",
        arguments: { session_id: sessionIdHex, content: "hello" },
      })
    ) as { delivered: boolean; leaf_hash: string };

    expect(sendResult.delivered).toBe(true);
    expect(sendResult.leaf_hash).toMatch(/^[0-9a-f]{64}$/);

    // AC-004: B receives via session-locked cello_receive_session
    const recvResult = parseResult(
      await fix.agentB.mcp!.callTool({
        name: "cello_receive_session",
        arguments: { session_id: sessionIdHex, timeout_ms: 10_000 },
      })
    ) as { type: string; content: string; sender_pubkey: string; sequence_number: number; leaf_hash: string };

    expect(recvResult.type).toBe("message");
    expect(recvResult.content).toBe("hello");
    expect(recvResult.sender_pubkey).toBe(fix.agentA.pubkeyHex);
    expect(recvResult.leaf_hash).toMatch(/^[0-9a-f]{64}$/);
  }, 20_000);
});

// ─── AC-005: cello_list_sessions shows session with status and leaf_count ─────

describe("AC-005: cello_list_sessions shows active session on both A and B", () => {
  it("AC-005: after send+receive, both A and B list sessions with status:active and leaf_count>0", async () => {
    const fix = await createSessionFixture({ withMcp: true });
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // Send a message so leaf_count > 0 on both sides
    await fix.agentA.mcp!.callTool({
      name: "cello_send",
      arguments: { session_id: sessionIdHex, content: "leaf-for-count" },
    });

    // Wait for B to receive and confirm the leaf landed
    await waitFor(
      () => fix.agentB.client.receiveMessage(sessionIdHex) !== null,
      { timeout: 10_000 }
    );

    // A's session list
    const listA = parseResult(
      await fix.agentA.mcp!.callTool({ name: "cello_list_sessions", arguments: {} })
    ) as Array<{ session_id: string; status: string; counterparty_pubkey: string; leaf_count: number }>;

    expect(listA).toHaveLength(1);
    expect(listA[0].session_id).toBe(sessionIdHex);
    expect(listA[0].status).toBe("active");
    expect(listA[0].counterparty_pubkey).toBe(fix.agentB.pubkeyHex);
    expect(listA[0].leaf_count).toBeGreaterThan(0);

    // B's session list
    const listB = parseResult(
      await fix.agentB.mcp!.callTool({ name: "cello_list_sessions", arguments: {} })
    ) as Array<{ session_id: string; status: string; counterparty_pubkey: string; leaf_count: number }>;

    expect(listB).toHaveLength(1);
    expect(listB[0].session_id).toBe(sessionIdHex);
    expect(listB[0].status).toBe("active");
    expect(listB[0].counterparty_pubkey).toBe(fix.agentA.pubkeyHex);
    expect(listB[0].leaf_count).toBeGreaterThan(0);
  }, 25_000);
});

// ─── AC-006 (SESSION-004): Post-FROST session message exchange = M1 behavior ──

describe("AC-006 (SESSION-004): Post-FROST session message exchange is identical to M1", () => {
  it("after FROST-established session, A sends message to B via dual-path; B receives with correct seq", async () => {
    const fix = await createSessionFixture({ withMcp: true });
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // A sends a message on the FROST-established session
    const sendResult = parseResult(
      await fix.agentA.mcp!.callTool({
        name: "cello_send",
        arguments: { session_id: sessionIdHex, content: "frost-session-message" },
      })
    ) as { delivered: boolean; leaf_hash: string };

    expect(sendResult.delivered).toBe(true);
    expect(sendResult.leaf_hash).toMatch(/^[0-9a-f]{64}$/);

    // B receives the message — identical behavior to M1 dual-path
    const recvResult = parseResult(
      await fix.agentB.mcp!.callTool({
        name: "cello_receive_session",
        arguments: { session_id: sessionIdHex, timeout_ms: 10_000 },
      })
    ) as { type: string; content: string; sender_pubkey: string; sequence_number: number; leaf_hash: string };

    expect(recvResult.type).toBe("message");
    expect(recvResult.content).toBe("frost-session-message");
    expect(recvResult.sender_pubkey).toBe(fix.agentA.pubkeyHex);
    // sequence_number must be >= 1 (relay-assigned, monotone)
    expect(recvResult.sequence_number).toBeGreaterThanOrEqual(1);
    expect(recvResult.leaf_hash).toMatch(/^[0-9a-f]{64}$/);

    // Verify leaf_hash from send and receive match (dual-path consistency)
    expect(recvResult.leaf_hash).toBe(sendResult.leaf_hash);
  }, 20_000);
});

// ─── AC-002 notification: cello_session_request fires on B ───────────────────

describe("AC-002 notification: cello_session_request channel notification fires on B when assignment arrives", () => {
  it("AC-002-notif: notifications/claude/channel fires with {type:cello_session_request, from:A_pubkey, session_id}", async () => {
    const fix = await createSessionFixture({ withMcp: true });
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    // Fire assignment while B is live
    await setupSession(fix);

    // Wait for B's notification
    await waitFor(
      () => fix.agentB.notifications!.some((n) => n.method === "notifications/claude/channel"),
      { timeout: 5000 }
    );

    const notif = fix.agentB.notifications!.find((n) => n.method === "notifications/claude/channel")!;
    const params = notif.params as Record<string, unknown>;

    expect(params.type).toBe("cello_session_request");
    expect(params.from).toBe(fix.agentA.pubkeyHex);
    expect(typeof params.session_id).toBe("string");
    // SI-001: exactly these three keys — no genesis_prev_root, no multiaddrs, no content
    expect(Object.keys(params).sort()).toEqual(["from", "session_id", "type"]);
  }, 15_000);
});
