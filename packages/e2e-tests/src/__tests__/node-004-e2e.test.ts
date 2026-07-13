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
 *
 * DOD-LEGACY-MCP-1 (2026-07-12): the legacy in-process MCP server was only the DRIVER
 * for this test — every assertion is on protocol state (NetworkRelayAdapter.recordAssignment
 * → relay session, message round-trip through the relay, NetworkRelayAdapter.confirmSeal →
 * `sealed` on both clients). The driver is now the live CelloClient API; the assertions are
 * preserved (and the message assertion is strengthened to check the decoded plaintext).
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
import { mlDsaKeygen } from "@cello-protocol/crypto";
import { clearTestShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import type { SessionAssignmentEvent } from "@cello-protocol/client";
import { createSessionFixture } from "../session-fixture.js";
import { buildMinimalPackageCbor } from "../package-cbor-helper.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

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
      register: true,
      policyB: { mode: "open", review_mode: "deterministic", requirements: [] },
    });
    scope.addCleanup(fix.stopAll);

    // ── Step 1: Establish a connection A→B (M3 gate requirement) ──────────────
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(
      fix.agentA.kp,
      mlDsaA,
      fix.agentA.primaryPubkey,
    );

    const connResult = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });
    expect(connResult.result).toBe("established");

    // Wait for B to register the connection locally before A initiates the session
    await waitFor(
      () => fix.agentB.client.listConnections().length > 0,
      { timeout: 5_000, interval: 50 },
    );

    // ── Step 2: B observes inbound session_assignment ─────────────────────────
    // Registered BEFORE A initiates, so the event cannot be missed.
    let bAssignment: SessionAssignmentEvent | null = null;
    fix.agentB.client.onSessionAssignment((event) => { bAssignment = event; });

    // ── Step 3: A initiates session with B ────────────────────────────────────
    // This triggers: directory calls NetworkRelayAdapter.recordAssignment → relay stores session
    const initiated = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, {
      timeoutMs: 20_000,
    });
    if (!initiated.ok) throw new Error(`initiateSession failed: ${initiated.reason}`);
    expect(initiated.ok).toBe(true);

    const sessionId = toHex(initiated.sessionId);
    expect(sessionId).toMatch(/^[0-9a-f]{32}$/);

    // B receives the session_assignment (pushed by the directory)
    await waitFor(() => bAssignment !== null, { timeout: 20_000, interval: 50 });
    expect((bAssignment as unknown as SessionAssignmentEvent).sessionIdHex).toBe(sessionId);

    // B's session record is active before A sends
    await waitFor(
      () => fix.agentB.client.listSessions()
        .find((s) => toHex(s.session_id) === sessionId)?.status === "active",
      { timeout: 10_000, interval: 100 },
    );

    // A sends a message to B via the relay
    const content = "hello via network relay protocol";
    const sent = await fix.agentA.client.sendMessage(
      sessionId,
      new TextEncoder().encode(content),
    );
    expect(sent.ok).toBe(true);

    // B receives the message — and it is the exact plaintext A sent
    const received = await fix.agentB.client.receiveSessionMessageAsync(sessionId, 5_000);
    expect(received).not.toBeNull();
    if (received === null) throw new Error("expected a message, got null");
    expect(received.type).toBe("message");
    if (received.type !== "message") throw new Error("expected type:message");
    expect(new TextDecoder().decode(received.content)).toBe(content);

    // Both A and B seal concurrently — bilateral SEAL ctrl leaves submitted
    // This triggers: relay detects bilateral SEAL → calls directory.processSeal
    //   → directory verifies → NetworkRelayAdapter.confirmSeal → relay destroys session
    //   → both clients receive session_sealed notification
    const [sealA, sealB] = await Promise.all([
      fix.agentA.client.initiateSessionSeal(sessionId),
      fix.agentB.client.initiateSessionSeal(sessionId),
    ]);
    expect(sealA.ok).toBe(true);
    expect(sealB.ok).toBe(true);

    // AC-007 assertion: NetworkRelayAdapter.confirmSeal round-tripped — both clients
    // observe the session as `sealed`.
    await waitFor(
      () => fix.agentA.client.listSessions()
        .find((s) => toHex(s.session_id) === sessionId)?.status === "sealed",
      { timeout: 30_000, interval: 100 },
    );
    await waitFor(
      () => fix.agentB.client.listSessions()
        .find((s) => toHex(s.session_id) === sessionId)?.status === "sealed",
      { timeout: 30_000, interval: 100 },
    );

    expect(
      fix.agentA.client.listSessions().find((s) => toHex(s.session_id) === sessionId)?.status,
    ).toBe("sealed");
    expect(
      fix.agentB.client.listSessions().find((s) => toHex(s.session_id) === sessionId)?.status,
    ).toBe("sealed");
  }, 90_000);
});
