/**
 * CELLO-NODE-004: AC-007 — Full session flow over /cello/directory-relay/1.0.0
 *
 * Verifies that directory and relay can operate as separate in-process libp2p nodes
 * connected only via /cello/directory-relay/1.0.0 (NetworkRelayAdapter), with no
 * in-process wiring (no shared RelayAdapter object reference).
 *
 * AC-007: session establishes, both agents communicate, session seals — all without
 *         any in-process wiring between directory and relay.
 *
 * M3: connection must be established before session initiation (SESSION-006 gate).
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
import { clearTestShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createSessionFixture } from "../session-fixture.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

// ─── AC-007 ───────────────────────────────────────────────────────────────────

describe("CELLO-NODE-004: AC-007 — full session flow over /cello/directory-relay/1.0.0", () => {
  let scope: TestScope;
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => {
    clearTestShares();
    return scope.run(async () => {});
  });

  it("session establishes, agents communicate, session seals — directory and relay communicate only via network protocol", async () => {
    const fix = await createSessionFixture({
      networkRelay: true,
      withMcp: true,
      register: true,
      policyB: { mode: "open", review_mode: "deterministic", requirements: [] },
    });
    scope.addCleanup(fix.stopAll);

    // ── Step 1: Establish a connection A→B (M3 gate requirement) ──────────────
    const connResult = parseResult(
      await fix.agentA.mcp!.callTool({
        name: "cello_request_connection",
        arguments: { target_pubkey: fix.agentB.pubkeyHex },
      }),
    ) as Record<string, unknown>;
    expect(connResult.result).toBe("accepted");

    // Wait for B to register the connection locally before A initiates the session
    await waitFor(
      () => fix.agentB.client.listConnections().length > 0,
      { timeout: 5_000, interval: 50 },
    );

    // ── Step 2: B awaits a session in the background ───────────────────────────
    const bSessionPromise = fix.agentB.mcp!.callTool({
      name: "cello_await_session",
      arguments: { timeout_ms: 20_000 },
    });

    // ── Step 3: A initiates session with B ────────────────────────────────────
    // This triggers: directory calls NetworkRelayAdapter.recordAssignment → relay stores session
    const initiateResult = await fix.agentA.mcp!.callTool({
      name: "cello_initiate_session",
      arguments: { target_pubkey: fix.agentB.pubkeyHex },
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
    const sendResult = await fix.agentA.mcp!.callTool({
      name: "cello_send",
      arguments: { session_id: sessionId, content: "hello via network relay protocol" },
    });
    const sent = parseResult(sendResult) as { delivered: boolean };
    expect(sent.delivered).toBe(true);

    // B receives the message
    const receiveResult = await fix.agentB.mcp!.callTool({
      name: "cello_receive_session",
      arguments: { session_id: sessionId, timeout_ms: 5000 },
    });
    const received = parseResult(receiveResult) as { type: string };
    expect(received.type).toBe("message");

    // Both A and B close concurrently — bilateral SEAL ctrl leaves submitted
    // This triggers: relay detects bilateral SEAL → calls directory.processSeal
    //   → directory verifies → NetworkRelayAdapter.confirmSeal → relay destroys session
    //   → both clients receive session_sealed notification
    const [closeA, closeB] = await Promise.all([
      fix.agentA.mcp!.callTool({ name: "cello_close_session", arguments: { session_id: sessionId } }),
      fix.agentB.mcp!.callTool({ name: "cello_close_session", arguments: { session_id: sessionId } }),
    ]);

    const closedA = parseResult(closeA) as { status: string };
    const closedB = parseResult(closeB) as { status: string };
    expect(closedA.status).toBe("sealed");
    expect(closedB.status).toBe("sealed");
  }, 60_000);
});
