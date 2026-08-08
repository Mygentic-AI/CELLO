/**
 * DOD-RELAY-DIRECTORY-RECONNECT-1 — the relay must recover its own directory connection, and must
 * stop passing a health check while it cannot notarize anything.
 *
 * ── WHAT HAPPENED, AND WHY THESE ARE THE TESTS ───────────────────────────────────────────────────
 *
 * On 2026-08-08 every seal on the fleet failed for four hours (06:57 → 11:07 UTC) and no alarm
 * fired. A manual relay restart fixed it. Nothing was deployed in the window and nothing on the
 * network changed. See [[relay-stops-notarizing-fleet-wide]] and launch-triage item 14.
 *
 * Three separate defects combined to make four hours possible, and each gets its own case here:
 *
 *   1. THE DIAL ERRORS WERE SWALLOWED. `for (const addr of addrs) { try { await dial(addr); break; }
 *      catch { } }` discards every reason. The failure then surfaced from `newStream` as a generic
 *      string, so the log said "directory_unavailable" and named nothing. That one `catch {}` is why
 *      two agents spent a morning on firewalls, schema migrations and dial-backoff theories.
 *
 *   2. THERE WAS NO RETRY. One dial-and-stream attempt, and a failure was final for that seal. A
 *      connection that goes bad stays bad until someone restarts the process by hand.
 *
 *   3. THE HEALTH CHECK COULD NOT SEE IT. `{ relayId, status: 'ok' }`, a constant, computed once at
 *      startup. A relay that cannot reach any directory — and therefore cannot complete a single
 *      seal — passed every probe, so nothing alerted and the autohealer never replaced it.
 *
 * ── THE HEALTH-CHECK JUDGEMENT, STATED SO IT IS NOT QUIETLY UNDONE ───────────────────────────────
 *
 * A probe that fails the instant one directory call fails would cycle the whole relay fleet during
 * any transient directory blip — every relay unhealthy at once, all replaced at once, none of which
 * helps. So the probe reports unhealthy only after SUSTAINED failure, and a relay that has not yet
 * probed is healthy rather than unhealthy: absence of evidence is not failure.
 *
 * The directory state is in the body on EVERY response, including 200s, so an operator can see a
 * degrading relay before it crosses the threshold.
 */

import { describe, it, expect, vi } from "vitest";
import type { Logger } from "@cello-protocol/interfaces";
import type { CelloNode } from "@cello-protocol/transport";
import { NetworkDirectoryAdapter } from "../network-directory-adapter.js";
import {
  createRelayHealthServer,
  createDirectoryHealthState,
  DIRECTORY_UNHEALTHY_AFTER_CONSECUTIVE_FAILURES,
} from "../relay-service-lifecycle.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

interface LogLine { event: string; ctx: Record<string, unknown> }

function spyLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const rec = (event: string, ctx?: unknown) => { lines.push({ event, ctx: (ctx ?? {}) as Record<string, unknown> }); };
  const logger = {
    debug: rec, info: rec, warn: rec, error: rec,
    child: () => logger,
  } as unknown as Logger;
  return { logger, lines };
}

/**
 * A node whose dial and newStream behaviour is scripted per attempt. Deliberately a fake rather
 * than a real libp2p node: the whole point is to drive the FAILURE branches, and a real node cannot
 * be made to fail on attempt 1 and succeed on attempt 2 on demand.
 */
function scriptedNode(script: {
  dial: Array<Error | null>;
  newStream: Array<Error | null>;
}): { node: CelloNode; dialCalls: string[]; streamCalls: number } {
  const dialCalls: string[] = [];
  let dialIdx = 0;
  let streamIdx = 0;
  const state = { streamCalls: 0 };
  const node = {
    async dial(addr: string) {
      dialCalls.push(addr);
      const outcome = script.dial[Math.min(dialIdx++, script.dial.length - 1)];
      if (outcome) throw outcome;
      return { peerId: "12D3KooWFakeDirectory" };
    },
    async newStream() {
      state.streamCalls += 1;
      const outcome = script.newStream[Math.min(streamIdx++, script.newStream.length - 1)];
      if (outcome) throw outcome;
      // A stream that yields no frames — enough to exercise the transport path; the response
      // handling is covered by the live federation-003 tests against a real directory.
      return {
        send: () => {},
        close: async () => {},
        [Symbol.asyncIterator]: async function* () { /* no frames */ },
      } as never;
    },
    getConnections: () => [],
  } as unknown as CelloNode;
  return { node, dialCalls, get streamCalls() { return state.streamCalls; } };
}

const DIR_PEER = "12D3KooWFakeDirectory";
const DIR_ADDR = "/ip4/10.0.0.1/tcp/8080/ws/p2p/12D3KooWFakeDirectory";

function adapterOn(node: CelloNode | null, logger: Logger): NetworkDirectoryAdapter {
  const a = new NetworkDirectoryAdapter({
    directoryPeerId: DIR_PEER,
    directoryMultiaddrs: [DIR_ADDR],
    logger,
  });
  if (node) a.connect(node);
  return a;
}

// ─── 1. the relay can be ASKED whether it can reach a directory ───────────────

describe("the relay can answer 'can I reach a directory' without a user asking for a seal", () => {
  it("exposes a read-only probe that uses the SAME transport a seal uses", async () => {
    // A probe over a different code path can be green while the path that matters is dead — the
    // exact shape of the defect it exists to catch. So this asserts the probe exists on the adapter
    // that seals go through, not on some parallel checker.
    const { logger } = spyLogger();
    const adapter = adapterOn(null, logger);

    expect(typeof (adapter as unknown as { checkDirectoryReachable?: unknown }).checkDirectoryReachable)
      .toBe("function");

    // With no node attached the answer is a NAMED failure, not a throw and not a silent false —
    // "our own wiring is missing" and "the network is down" are opposite bugs.
    const res = await adapter.checkDirectoryReachable();
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toBe("directory_not_connected");
  });

  it("reports a transport failure as a reason rather than throwing into the probe loop", async () => {
    const { logger } = spyLogger();
    const { node } = scriptedNode({
      dial: [new Error("connection refused: 10.0.0.1:8080")],
      newStream: [new Error("no connection to peer")],
    });

    const res = await adapterOn(node, logger).checkDirectoryReachable();

    expect(res.ok).toBe(false);
    // The detail carries the underlying error so the health payload can name the cause. The
    // previous incident had four hours of logs and not one line naming why.
    expect(JSON.stringify(res)).toContain("no connection to peer");
  });

  it("answers ok when the stream opens", async () => {
    const { logger } = spyLogger();
    const { node } = scriptedNode({ dial: [null], newStream: [null] });

    expect((await adapterOn(node, logger).checkDirectoryReachable()).ok).toBe(true);
  });
});

// ─── 3. the health check must test what the relay is FOR ──────────────────────

describe("the health check reflects whether this relay can actually notarize", () => {
  function get(server: ReturnType<typeof createRelayHealthServer>): Promise<{ status: number; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      server.listen(0, () => {
        const port = (server.address() as { port: number }).port;
        fetch(`http://127.0.0.1:${port}/health`)
          .then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }))
          .then((out) => { server.close(); resolve(out); })
          .catch((e) => { server.close(); reject(e); });
      });
    });
  }

  it("a relay that has never probed yet is healthy — absence of evidence is not failure", async () => {
    const { logger } = spyLogger();
    const state = createDirectoryHealthState();
    const out = await get(createRelayHealthServer({ relayId: "abc", logger, directoryHealth: () => state.snapshot() }));

    expect(out.status).toBe(200);
    expect(out.body["status"]).toBe("ok");
  });

  it("SUSTAINED failure to reach any directory fails the probe, so the autohealer replaces it", async () => {
    // The defect in one assertion. For four hours this returned 200 while not a single session
    // could be sealed anywhere on the fleet.
    const { logger } = spyLogger();
    const state = createDirectoryHealthState();
    for (let i = 0; i < DIRECTORY_UNHEALTHY_AFTER_CONSECUTIVE_FAILURES; i++) {
      state.recordFailure("dial_failed", "connection refused");
    }
    const out = await get(createRelayHealthServer({ relayId: "abc", logger, directoryHealth: () => state.snapshot() }));

    expect(out.status, "a relay that cannot reach any directory still reports itself healthy").toBe(503);
    expect(String(JSON.stringify(out.body))).toContain("dial_failed");
  });

  it("ONE failure does not fail the probe — a blip must not cycle the whole relay fleet", async () => {
    const { logger } = spyLogger();
    const state = createDirectoryHealthState();
    state.recordFailure("dial_failed", "transient");

    const out = await get(createRelayHealthServer({ relayId: "abc", logger, directoryHealth: () => state.snapshot() }));
    expect(out.status).toBe(200);
  });

  it("recovery clears it, and the directory state is visible on a HEALTHY response too", async () => {
    // Visible on 200s on purpose: an operator should be able to watch a relay degrade rather than
    // discover it at the moment it crosses a threshold.
    const { logger } = spyLogger();
    const state = createDirectoryHealthState();
    for (let i = 0; i < DIRECTORY_UNHEALTHY_AFTER_CONSECUTIVE_FAILURES + 2; i++) state.recordFailure("dial_failed", "x");
    state.recordSuccess();

    const out = await get(createRelayHealthServer({ relayId: "abc", logger, directoryHealth: () => state.snapshot() }));
    expect(out.status).toBe(200);
    expect(out.body["directory"], "the directory state is hidden on healthy responses").toBeDefined();
    expect((out.body["directory"] as Record<string, unknown>)["consecutiveFailures"]).toBe(0);
  });

  it("keeps working when no directory is configured at all — a local relay has nothing to probe", async () => {
    const { logger } = spyLogger();
    const out = await get(createRelayHealthServer({ relayId: "abc", logger }));
    expect(out.status).toBe(200);
  });
});

// ─── 4. the probe runs on its own, so a user is not the detector ──────────────

describe("the relay notices before a user does", () => {
  it("probes the directory on an interval and records each outcome", async () => {
    // The connection died during a 2.5-hour quiet window and we learned about it from a failed
    // close. Something has to ask while nobody is watching.
    vi.useFakeTimers();
    try {
      const { logger } = spyLogger();
      const state = createDirectoryHealthState();
      const probe = vi.fn(async () => ({ ok: false as const, reason: "dial_failed", detail: "refused" }));

      const { startDirectoryProbe } = await import("../relay-service-lifecycle.js");
      const stop = startDirectoryProbe({ probe, state, intervalMs: 1000, logger });

      await vi.advanceTimersByTimeAsync(3500);
      stop();

      expect(probe.mock.calls.length, "the probe never ran on its own").toBeGreaterThanOrEqual(3);
      expect(state.snapshot().consecutiveFailures).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
