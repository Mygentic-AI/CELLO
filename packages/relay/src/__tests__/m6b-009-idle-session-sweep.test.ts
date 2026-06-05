/**
 * CELLO-M6B-009: Idle session sweep
 *
 * Tests:
 *   AC-006: Sessions idle > MAX_IDLE_MS with status 'active' are destroyed
 *   AC-007: Sessions idle < MAX_IDLE_MS are NOT destroyed
 *   AC-008: Already-sealed sessions are not present (destroySession was already called)
 *   AC-009: Each leaf submission updates lastActivityAt
 *   SI-001: Sweep never destroys a session mid-write (mutex-holding sessions have recent lastActivityAt)
 *
 * Implementation notes:
 *   startIdleSweep() runs an initial sweep immediately on startup (before the first
 *   scheduled interval). On a relay with no sessions this emits relay.session.sweep.complete
 *   with sweptCount: 0 / remainingCount: 0 immediately. This behavior is documented and
 *   tested explicitly below.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryRelayStore } from "../relay-store.js";
import { CelloRelayNode } from "../relay-node.js";
import { createNode } from "@cello-protocol/transport";
import { InMemoryKeyProvider } from "@cello-protocol/crypto";
import type { SessionAssignment } from "../relay-types.js";
import type { Logger } from "@cello-protocol/interfaces";

describe("CELLO-M6B-009: Idle session sweep", () => {
  let store: InMemoryRelayStore;
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    store = new InMemoryRelayStore();
    vi.clearAllMocks();
  });

  function makeAssignment(sessionIdHex: string): SessionAssignment {
    return {
      session_id: Buffer.from(sessionIdHex, "hex"),
      participant_a: Buffer.alloc(32, 0xaa),
      participant_b: Buffer.alloc(32, 0xbb),
      session_timestamp: Date.now(),
      directory_signature: Buffer.alloc(64),
    };
  }

  it("AC-009: recordSession sets lastActivityAt to Date.now()", () => {
    // AC-009: When a session is recorded, its lastActivityAt is set to approximately Date.now()

    const now = Date.now();
    const sessionIdHex = "a".repeat(32);
    const assignment = makeAssignment(sessionIdHex);
    const genesisRoot = Buffer.alloc(32);

    store.recordSession(assignment, genesisRoot);

    const state = store.getSession(sessionIdHex);
    expect(state).toBeDefined();
    expect(state!.lastActivityAt).toBeGreaterThanOrEqual(now);
    expect(state!.lastActivityAt).toBeLessThanOrEqual(Date.now());
  });

  it("AC-009: setSession updates lastActivityAt to Date.now()", async () => {
    // AC-009: When setSession() is called, the session's lastActivityAt is updated to Date.now()

    const sessionIdHex = "b".repeat(32);
    const assignment = makeAssignment(sessionIdHex);
    const genesisRoot = Buffer.alloc(32);

    store.recordSession(assignment, genesisRoot);

    const state = store.getSession(sessionIdHex)!;
    const oldActivityAt = state.lastActivityAt;

    // Wait 10ms to ensure timestamp changes
    const waitPromise = new Promise((resolve) => setTimeout(resolve, 10));
    await waitPromise;

    // Simulate leaf submission via setSession
    state.seq_counter = 1;
    store.setSession(sessionIdHex, state);

    const updatedState = store.getSession(sessionIdHex)!;
    expect(updatedState.lastActivityAt).toBeGreaterThan(oldActivityAt);
  });

  it("AC-006: idle sweep destroys sessions with lastActivityAt > MAX_IDLE_MS and status 'active'", () => {
    // AC-006: Sessions idle for 25 hours (> 24h threshold) are destroyed

    const sessionIdHex = "c".repeat(32);
    const assignment = makeAssignment(sessionIdHex);
    const genesisRoot = Buffer.alloc(32);

    store.recordSession(assignment, genesisRoot);

    // Simulate 25 hours ago via the test accessor.
    // setSession() always refreshes lastActivityAt to Date.now() — we cannot pass an
    // old timestamp through the public API. __setLastActivityAtForTest writes directly
    // into the Map, bypassing the timestamp refresh.
    store.__setLastActivityAtForTest(sessionIdHex, Date.now() - 25 * 60 * 60 * 1000);

    // Run sweep
    const maxIdleMs = 24 * 60 * 60 * 1000; // 24 hours
    const swept = store.sweepIdleSessions(maxIdleMs, logger);

    expect(swept).toBe(1);
    expect(store.getSession(sessionIdHex)).toBeUndefined();
    // AC-006 specifies idleDurationMs >= 90_000_000 (25 hours in ms).
    // Capture the actual call to assert the numeric lower bound.
    expect(logger.info).toHaveBeenCalledWith("relay.session.idle.swept", expect.objectContaining({
      sessionId: sessionIdHex,
      idleDurationMs: expect.any(Number),
    }));
    const sweptCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) => args[0] === "relay.session.idle.swept",
    );
    const idleDurationMs = (sweptCall![1] as { idleDurationMs: number }).idleDurationMs;
    expect(idleDurationMs).toBeGreaterThanOrEqual(90_000_000);
    expect(logger.info).toHaveBeenCalledWith("relay.session.sweep.complete", {
      sweptCount: 1,
      remainingCount: 0,
    });
  });

  it("AC-007: sweep does NOT destroy sessions with recent lastActivityAt", () => {
    // AC-007: Sessions idle for 1 hour (< 24h threshold) are NOT destroyed.
    //
    // setSession() always refreshes lastActivityAt to Date.now() — passing an old
    // timestamp through setSession() would test a 0-second-old session, not a
    // 1-hour-old one. __setLastActivityAtForTest bypasses the timestamp refresh.

    const sessionIdHex = "d".repeat(32);
    const assignment = makeAssignment(sessionIdHex);
    const genesisRoot = Buffer.alloc(32);

    store.recordSession(assignment, genesisRoot);

    // Simulate 1-hour-old lastActivityAt via the test accessor.
    store.__setLastActivityAtForTest(sessionIdHex, Date.now() - 1 * 60 * 60 * 1000);

    // Run sweep — 1 hour < 24 hour threshold, session must survive
    const maxIdleMs = 24 * 60 * 60 * 1000;
    const swept = store.sweepIdleSessions(maxIdleMs, logger);

    expect(swept).toBe(0);
    expect(store.getSession(sessionIdHex)).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith("relay.session.sweep.complete", {
      sweptCount: 0,
      remainingCount: 1,
    });
  });

  it("AC-008: already-sealed sessions are not present (destroySession was already called)", () => {
    // AC-008: Sessions that transitioned to 'sealed' status call destroySession
    // in confirmSeal — they are already removed from the store before the sweep runs

    const sessionIdHex = "e".repeat(32);
    const assignment = makeAssignment(sessionIdHex);
    const genesisRoot = Buffer.alloc(32);

    store.recordSession(assignment, genesisRoot);

    // Simulate seal path calling destroySession
    store.destroySession(sessionIdHex);

    // Verify session is gone
    expect(store.getSession(sessionIdHex)).toBeUndefined();

    // Run sweep — should not count this session
    const maxIdleMs = 24 * 60 * 60 * 1000;
    const swept = store.sweepIdleSessions(maxIdleMs, logger);

    expect(swept).toBe(0);
    expect(logger.info).toHaveBeenCalledWith("relay.session.sweep.complete", {
      sweptCount: 0,
      remainingCount: 0,
    });
  });

  it("AC-006: only 'active' sessions are swept — 'sealing' and 'seal_rejected' are not", () => {
    const sessionIdHex1 = "f".repeat(32);
    const sessionIdHex2 = "1".repeat(32);
    const sessionIdHex3 = "2".repeat(32);

    [sessionIdHex1, sessionIdHex2, sessionIdHex3].forEach((hex) => {
      const assignment = makeAssignment(hex);
      store.recordSession(assignment, Buffer.alloc(32));
    });

    // All idle for 25 hours — use test accessor to back-date lastActivityAt.
    // Status is set via setSession so the store stores the updated status; setSession
    // will also refresh lastActivityAt to now, which is why we call __setLastActivityAtForTest
    // afterwards for each session.
    const idleTimestamp = Date.now() - 25 * 60 * 60 * 1000;

    const state1 = store.getSession(sessionIdHex1)!;
    store.setSession(sessionIdHex1, { ...state1, status: "active" });
    store.__setLastActivityAtForTest(sessionIdHex1, idleTimestamp);

    const state2 = store.getSession(sessionIdHex2)!;
    store.setSession(sessionIdHex2, { ...state2, status: "sealing" });
    store.__setLastActivityAtForTest(sessionIdHex2, idleTimestamp);

    const state3 = store.getSession(sessionIdHex3)!;
    store.setSession(sessionIdHex3, { ...state3, status: "seal_rejected" });
    store.__setLastActivityAtForTest(sessionIdHex3, idleTimestamp);

    // Run sweep
    const maxIdleMs = 24 * 60 * 60 * 1000;
    const swept = store.sweepIdleSessions(maxIdleMs, logger);

    // Only the 'active' session should be swept
    expect(swept).toBe(1);
    expect(store.getSession(sessionIdHex1)).toBeUndefined();
    expect(store.getSession(sessionIdHex2)).toBeDefined(); // still present
    expect(store.getSession(sessionIdHex3)).toBeDefined(); // still present
  });

  it("SI-001: sweep does not destroy sessions with mutex held (recent lastActivityAt)", () => {
    // SI-001: A session currently processing a leaf submission has recent lastActivityAt
    // because setSession() was just called — it will not meet the idle threshold

    const sessionIdHex = "3".repeat(32);
    const assignment = makeAssignment(sessionIdHex);
    const genesisRoot = Buffer.alloc(32);

    store.recordSession(assignment, genesisRoot);

    // Simulate a session that had an old lastActivityAt but is now being actively written
    const state = store.getSession(sessionIdHex)!;
    state.lastActivityAt = Date.now() - 26 * 60 * 60 * 1000; // 26 hours ago
    store.setSession(sessionIdHex, state); // This updates lastActivityAt to now

    // Run sweep immediately
    const maxIdleMs = 24 * 60 * 60 * 1000;
    const swept = store.sweepIdleSessions(maxIdleMs, logger);

    // Session should NOT be swept because setSession refreshed lastActivityAt
    expect(swept).toBe(0);
    expect(store.getSession(sessionIdHex)).toBeDefined();
  });
});

describe("CELLO-M6B-009: startIdleSweep runs once immediately on startup", () => {
  it("relay.session.sweep.complete fires immediately when startIdleSweep() is called (before first interval)", async () => {
    // Implementation note: startIdleSweep() calls sweep() once immediately before
    // scheduling the recurring interval. On a fresh relay with no sessions this emits
    // relay.session.sweep.complete with sweptCount: 0 / remainingCount: 0 at startup.
    // This is documented behaviour — the immediate sweep catches sessions that were
    // active before the relay process started (e.g. on relay restart after a crash).

    const keyProvider = new InMemoryKeyProvider(Buffer.alloc(32, 0xcc));
    const node = await createNode({
      keyProvider,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
    });
    await node.start();

    const infoSpy = vi.fn();
    const testLogger: Logger = {
      debug: vi.fn(),
      info: infoSpy,
      warn: vi.fn(),
      error: vi.fn(),
    };

    const relay = new CelloRelayNode({
      node,
      directoryPubkey: Buffer.alloc(32, 0xdd),
      logger: testLogger,
    });
    await relay.start();

    // startIdleSweep with a very long interval so the interval never fires during the test
    relay.startIdleSweep(3_600_000, 24 * 60 * 60 * 1000);

    // The immediate sweep must have already fired synchronously
    expect(infoSpy).toHaveBeenCalledWith("relay.session.sweep.complete", {
      sweptCount: 0,
      remainingCount: 0,
    });

    relay.stopIdleSweep();
    await node.stop();
  });
});
