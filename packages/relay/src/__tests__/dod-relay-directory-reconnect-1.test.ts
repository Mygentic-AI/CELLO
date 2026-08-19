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
 * ── THE HEALTH ENDPOINT MUST NEVER FAIL FOR THIS, AND THAT IS THE WHOLE POINT ────────────────────
 *
 * The first version of this fix returned 503 once the relay could not reach a directory. That was
 * WRONG, and dangerously so. `/health` on port 4000 is not an alerting channel — it is what the
 * DIRECTORIES poll to decide relay POOL MEMBERSHIP, and `defaultPingFn` in relay-pool-manager.ts
 * treats any non-2xx as a failure (`res.ok` false → `HTTP ${status}`). Enough consecutive failures
 * and the relay is dropped from the signed manifest.
 *
 * That inverts the blast radius of the very incident this item exists for. On 2026-08-08 the relay
 * could not reach a directory, so conversations could not be SEALED. Had a 503 shipped, the
 * directories would have dropped every relay from the pool at once — because the cause is shared,
 * so all relays fail together — and then no session could be STARTED at all. A degraded relay would
 * have been converted into no relay. It is the same shape as the outage found the same day, where
 * relays published a public health URL behind a VPC-only port, every check failed, the pool emptied,
 * and every session request was refused with `relay_unavailable`.
 *
 * So: a relay that can still carry sessions stays IN the pool and keeps answering 200, even when it
 * cannot notarize. Being unable to seal must raise an alarm, not withdraw capacity. The directory
 * state rides in the BODY of every response, and the transition is logged at ERROR
 * (`relay.directory.connection.lost`) — those are the alerting surface, not the status code.
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
  /**
   * DOD-M12-CONN-EVICT-1. Omit to get a node that HAS `hangUp` (the shipped shape); pass
   * `omitHangUp: true` to model a relay still running a transport from before it existed, which
   * must report that absence rather than silently keeping the broken behaviour.
   */
  omitHangUp?: boolean;
  /** Make eviction itself fail, to prove the repair continues rather than dying on its own fixer. */
  hangUpError?: Error;
  /** Override what libp2p reports as registered, to drive the socket-status and multi-connection paths. */
  registeredConnections?: Array<{ peerId: string; encryption: string; status: string }>;
}): {
  node: CelloNode;
  dialCalls: string[];
  streamCalls: number;
  /** Ordered trace of the calls that matter to the repair, so ORDER can be asserted, not just counts. */
  trace: string[];
  firePeerConnect: (p: string) => void;
  firePeerDisconnect: (p: string) => void;
} {
  const dialCalls: string[] = [];
  const trace: string[] = [];
  const peerConnectHandlers: Array<(p: string) => void> = [];
  const peerDisconnectHandlers: Array<(p: string) => void> = [];
  let dialIdx = 0;
  let streamIdx = 0;
  const state = { streamCalls: 0 };
  const node = {
    async dial(addr: string) {
      dialCalls.push(addr);
      trace.push("dial");
      const outcome = script.dial[Math.min(dialIdx++, script.dial.length - 1)];
      if (outcome) throw outcome;
      return { peerId: "12D3KooWFakeDirectory" };
    },
    // Real nodes always have these — they are on the CelloNode interface. The fixture lacked them,
    // which made it a double that could not have stood in for the thing it doubles. They CAPTURE
    // the handler rather than discarding it, so the lifecycle logging can actually be driven: with
    // no-op stubs, deleting the whole observation block failed zero tests.
    onPeerConnect(h: (p: string) => void) { peerConnectHandlers.push(h); },
    onPeerDisconnect(h: (p: string) => void) { peerDisconnectHandlers.push(h); },
    ...(script.omitHangUp === true ? {} : {
      async hangUp(_p: string) {
        trace.push("hangUp");
        if (script.hangUpError) throw script.hangUpError;
      },
    }),
    async newStream() {
      state.streamCalls += 1;
      trace.push("newStream");
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
    // A REGISTERED connection, because that is the state the failure is defined by: still in
    // libp2p's registry with a live socket, which is why dial() hands it back. Returning [] here
    // made every socket-status assertion vacuous.
    getConnections: () => (script.registeredConnections ?? [
      { peerId: "12D3KooWFakeDirectory", encryption: "noise", status: "open" },
    ]),
  } as unknown as CelloNode;
  return {
    node, dialCalls, trace,
    get streamCalls() { return state.streamCalls; },
    /** Fire the libp2p peer lifecycle handlers the adapter registered on connect(). */
    firePeerConnect: (p: string) => peerConnectHandlers.forEach((h) => h(p)),
    firePeerDisconnect: (p: string) => peerDisconnectHandlers.forEach((h) => h(p)),
  };
}

/** The exact libp2p error the live failures carried, shape included — `isConnectionLost` reads `.reason`. */
function muxerClosed(): Error {
  return Object.assign(
    new Error('The connection muxer is "closed" and not "open"'),
    { reason: "connection_lost" },
  );
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

  it("NEVER returns a non-2xx, no matter how broken the directory link is", async () => {
    // THE REGRESSION GUARD, and the reason this file exists in its current form. Any non-2xx here
    // is read by relay-pool-manager's defaultPingFn as a failed health check, and enough of those
    // drop this relay from the signed pool manifest. A relay that cannot SEAL can still CARRY
    // sessions; withdrawing it turns "conversations cannot be sealed" into "conversations cannot be
    // started", fleet-wide, because every relay fails on the same shared cause at the same moment.
    const { logger } = spyLogger();
    const state = createDirectoryHealthState();
    for (let i = 0; i < DIRECTORY_UNHEALTHY_AFTER_CONSECUTIVE_FAILURES * 10; i++) {
      state.recordFailure("dial_failed", "connection refused");
    }
    const out = await get(createRelayHealthServer({ relayId: "abc", logger, directoryHealth: () => state.snapshot() }));

    expect(out.status, "a degraded relay was dropped from the pool instead of merely reported").toBe(200);
  });

  it("SAYS it is degraded in the body, so the condition is visible without withdrawing capacity", async () => {
    const { logger } = spyLogger();
    const state = createDirectoryHealthState();
    for (let i = 0; i < DIRECTORY_UNHEALTHY_AFTER_CONSECUTIVE_FAILURES; i++) {
      state.recordFailure("dial_failed", "connection refused");
    }
    const out = await get(createRelayHealthServer({ relayId: "abc", logger, directoryHealth: () => state.snapshot() }));

    // The status code is for the pool. The body is for the operator.
    expect(out.body["status"]).toBe("degraded");
    const dir = out.body["directory"] as Record<string, unknown>;
    expect(dir["reachable"]).toBe(false);
    expect(String(JSON.stringify(dir))).toContain("dial_failed");
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

// ─── DOD-M12-CONN-EVICT-1: the repair must be able to repair ──────────────────

/**
 * The 2026-08-08 fix above added a redial. On 2026-08-18/19 it ran on all 38 refused seals and
 * repaired none of them, because a redial alone CANNOT repair this failure:
 *
 *   `libp2p.dial()` returns an EXISTING connection whenever one is registered for the peer and its
 *   socket status reads `open`. `findExistingConnection` filters on `con.status` and never inspects
 *   the muxer. So when the muxer dies under a live socket, the dial resolves from the registry and
 *   hands the same dead object back, and the retry fails on the identical check that just failed.
 *
 * Restarting the relay was the only thing that ever cleared it — a restart being the only thing
 * that empties the connection manager. These cases pin the eviction that makes the dial reach the
 * network instead.
 */
describe("DOD-M12-CONN-EVICT-1: a stale directory connection is evicted before the redial", () => {
  it("evicts BEFORE dialling — order is the whole fix, not the call count", async () => {
    const { logger } = spyLogger();
    // Stream fails once with the real muxer error, then succeeds: the shape of a repair that works.
    const { node, trace } = scriptedNode({ dial: [null], newStream: [muxerClosed(), null] });
    const adapter = adapterOn(node, logger);

    await adapter.checkDirectoryReachable();

    // dial (opportunistic, before the first attempt) → newStream fails → hangUp → dial → newStream.
    // If `hangUp` came AFTER the second dial it would evict the connection just established, and if
    // it never ran the second dial would return the corpse. Only this order repairs anything.
    const evictIdx = trace.indexOf("hangUp");
    expect(evictIdx).toBeGreaterThan(-1);
    expect(trace.slice(evictIdx)).toEqual(["hangUp", "dial", "newStream"]);
  });

  it("does not evict on the happy path — a healthy connection is never torn down", async () => {
    const { logger } = spyLogger();
    const { node, trace } = scriptedNode({ dial: [null], newStream: [null] });
    const adapter = adapterOn(node, logger);

    await adapter.checkDirectoryReachable();

    // Eviction is a repair, not a policy. Hanging up a working directory link on every call would
    // turn one cached connection into a reconnect per seal, and cost the latency the cache exists
    // to save.
    expect(trace).not.toContain("hangUp");
  });

  it("reports the REGISTERED socket statuses, not an empty list, alongside the muxer failure", async () => {
    const { logger, lines } = spyLogger();
    const { node } = scriptedNode({ dial: [null], newStream: [muxerClosed(), null] });
    const adapter = adapterOn(node, logger);

    await adapter.checkDirectoryReachable();

    const stale = lines.find((l) => l.event === "relay.directory.connection.stale");
    expect(stale).toBeDefined();
    // Asserting the VALUE, not the key. Against an empty connection list this field is `[]` and a
    // `toHaveProperty` check passes for an implementation that hardcodes it and never reads
    // `status` at all — the field this unit exists for, tested vacuously.
    expect(stale!.ctx["socketStatusBefore"]).toEqual(["open"]);
    expect(stale!.ctx["connectionsBefore"]).toBe(1);
  });

  it("reports `unreported` — never an invented 'open' — when the transport predates the status field", async () => {
    const { logger, lines } = spyLogger();
    const { node } = scriptedNode({
      dial: [null],
      newStream: [muxerClosed(), null],
      // What EVERY deployed relay returns today: @cello-protocol/transport without `status`.
      registeredConnections: [{ peerId: "12D3KooWFakeDirectory", encryption: "noise" } as never],
    });
    const adapter = adapterOn(node, logger);

    await adapter.checkDirectoryReachable();

    const stale = lines.find((l) => l.event === "relay.directory.connection.stale");
    expect(stale!.ctx["socketStatusBefore"]).toEqual(["unreported"]);
  });

  it("names an eviction that destroyed a SECOND connection, so an aborted verdict is attributable", async () => {
    const { logger, lines } = spyLogger();
    // hangUp is peer-scoped: libp2p closes every connection registered for the peer. The directory
    // dials this relay independently, so a second inbound connection can exist under the same peer
    // id and be carrying a seal verdict when we evict.
    const { node } = scriptedNode({
      dial: [null],
      newStream: [muxerClosed(), null],
      registeredConnections: [
        { peerId: "12D3KooWFakeDirectory", encryption: "noise", status: "open" },
        { peerId: "12D3KooWFakeDirectory", encryption: "noise", status: "open" },
      ],
    });
    const adapter = adapterOn(node, logger);

    await adapter.checkDirectoryReachable();

    const multi = lines.find((l) => l.event === "relay.directory.evict.multiple");
    expect(multi).toBeDefined();
    expect(multi!.ctx["connectionsDestroyed"]).toBe(2);
  });

  it("still repairs when eviction itself fails, rather than dying on its own fixer", async () => {
    const { logger, lines } = spyLogger();
    const { node } = scriptedNode({
      dial: [null],
      newStream: [muxerClosed(), null],
      hangUpError: new Error("hangUp exploded"),
    });
    const adapter = adapterOn(node, logger);

    const res = await adapter.checkDirectoryReachable();

    // The caller is repairing something already unusable. Throwing here would replace a recoverable
    // stale handle with a hard failure of the repair, and the dial that follows may still work.
    expect(res.ok).toBe(true);
    expect(lines.some((l) => l.event === "relay.directory.evict.failed")).toBe(true);
  });

  it("SAYS SO LOUDLY when the transport is too old to evict, instead of pretending it repaired", async () => {
    const { logger, lines } = spyLogger();
    // A relay built before @cello-protocol/transport shipped hangUp. This repo floats on `latest`,
    // so that relay exists until the promotion lands and a roll happens.
    const { node, trace } = scriptedNode({
      dial: [null], newStream: [muxerClosed(), muxerClosed()], omitHangUp: true,
    });
    const adapter = adapterOn(node, logger);

    await adapter.checkDirectoryReachable();

    expect(trace).not.toContain("hangUp");
    // ABSENT IS NOT FINE. Without this the relay keeps exactly the behaviour this unit removes and
    // its logs are indistinguishable from a fixed one — the failure mode that let the 2026-08-08
    // fix look complete for eleven days.
    const unavailable = lines.find((l) => l.event === "relay.directory.evict.unavailable");
    expect(unavailable).toBeDefined();
    expect(String(unavailable!.ctx["impact"])).toContain("hangUp");
  });

  it("names eviction in the outcome, so a repeat failure is not re-diagnosed as a stale handle", async () => {
    const { logger, lines } = spyLogger();
    const { node } = scriptedNode({ dial: [null], newStream: [muxerClosed(), muxerClosed()] });
    const adapter = adapterOn(node, logger);

    await adapter.checkDirectoryReachable();

    const outcome = lines.find((l) => l.event === "relay.directory.redial.outcome");
    expect(outcome).toBeDefined();
    expect(outcome!.ctx["recovered"]).toBe(false);
    expect(outcome!.ctx["eviction"]).toBe("evicted");
    // Having evicted and redialled and still failed, the cause is NOT on this side. Saying so is
    // what stops the next investigation repeating this one.
    expect(String(outcome!.ctx["reading"])).toContain("not a stale handle");
  });
});

// ─── DOD-M12-CONN-OBSERVE-1 clause (b): the connection lifecycle lines ────────
//
// These had NO test at all in the first pass: every node double registered the handlers as no-ops
// that never invoked them, so deleting the whole observation block — the directory-peer filter, the
// duration arithmetic, the impact string — failed nothing. That is how a warning claiming "seals
// are refused" survived on an event that fires for the benign case and cannot fire for the failure
// this tier is about.
describe("DOD-M12-CONN-OBSERVE-1 (b): directory connection lifecycle is logged, and honestly", () => {
  it("logs open and close for a DIRECTORY peer", async () => {
    const { logger, lines } = spyLogger();
    const { node, firePeerConnect, firePeerDisconnect } = scriptedNode({ dial: [null], newStream: [null] });
    adapterOn(node, logger);

    firePeerConnect(DIR_PEER);
    firePeerDisconnect(DIR_PEER);

    expect(lines.some((l) => l.event === "relay.directory.connection.opened")).toBe(true);
    expect(lines.some((l) => l.event === "relay.directory.connection.closed")).toBe(true);
  });

  it("ignores CLIENT peers — every agent using this relay would otherwise bury the directory lines", async () => {
    const { logger, lines } = spyLogger();
    const { node, firePeerConnect, firePeerDisconnect } = scriptedNode({ dial: [null], newStream: [null] });
    adapterOn(node, logger);

    firePeerConnect("12D3KooWSomeRandomAgent");
    firePeerDisconnect("12D3KooWSomeRandomAgent");

    expect(lines.some((l) => l.event.startsWith("relay.directory.connection."))).toBe(false);
  });

  it("measures heldForMs from the OPEN, not from the last probe", async () => {
    const { logger, lines } = spyLogger();
    const { node, firePeerConnect, firePeerDisconnect } = scriptedNode({ dial: [null], newStream: [null] });
    const adapter = adapterOn(node, logger);

    firePeerConnect(DIR_PEER);
    // A successful probe in between. Deriving the duration from the probe's own bookkeeping made
    // this number "time since the last 30-second probe" — a value with a 30-second ceiling wearing
    // a name that claims to be the connection's lifetime.
    await adapter.checkDirectoryReachable();
    firePeerDisconnect(DIR_PEER);

    const closed = lines.find((l) => l.event === "relay.directory.connection.closed");
    expect(closed).toBeDefined();
    expect(closed!.ctx).toHaveProperty("heldForMs");
  });

  it("does NOT claim seals are refused — this event cannot fire for the failure that refuses them", async () => {
    const { logger, lines } = spyLogger();
    const { node, firePeerConnect, firePeerDisconnect } = scriptedNode({ dial: [null], newStream: [null] });
    adapterOn(node, logger);

    firePeerConnect(DIR_PEER);
    firePeerDisconnect(DIR_PEER);

    const closed = lines.find((l) => l.event === "relay.directory.connection.closed");
    // libp2p dispatches peer:disconnect only AFTER removing the connection from its registry, so a
    // link that reaches this handler is one the next dial genuinely rebuilds. The dead-muxer failure
    // keeps the connection registered and emits no event at all. A warning here would fire on the
    // benign case and stay silent on the real one — the precise inversion this assertion pins.
    expect(JSON.stringify(closed!.ctx)).not.toContain("are refused");
    expect(String(closed!.ctx["note"])).toContain("emits no event");
  });
});

// ─── DOD-M12-CONN-EVICT-1 clause (c): the SEAL path, not just the probe ───────
//
// Clause (c) says the probe path and the seal path share the code so a repair proven by one is
// proven for the other. That was true structurally — both go through #openDirectoryStream — and
// pinned by nothing: every eviction case drove checkDirectoryReachable(). A later refactor that
// inlined a newStream into processSeal would break the claim with every test still green.
describe("DOD-M12-CONN-EVICT-1 (c): a seal submission evicts too, not only the probe", () => {
  it("evicts before redialling on processSeal", async () => {
    const { logger } = spyLogger();
    const { node, trace } = scriptedNode({ dial: [null], newStream: [muxerClosed(), null] });
    const adapter = adapterOn(node, logger);

    await adapter.processSeal(new Uint8Array(32).fill(9), {
      leaves: [], merkle_root: new Uint8Array(32), seq_count: 0,
    } as never);

    const evictIdx = trace.indexOf("hangUp");
    expect(evictIdx).toBeGreaterThan(-1);
    expect(trace.slice(evictIdx, evictIdx + 3)).toEqual(["hangUp", "dial", "newStream"]);
  });
});

// ─── DOD-M12-CONN-MUXER-OBSERVE-1: the death gets a timestamp ────────────────
//
// A muxer dying under a live socket emits NO libp2p event — the connection stays registered, so
// peer:disconnect never fires. Every observation of this failure has therefore been made minutes or
// hours after the fact, when something tried to use the link. The 30-second probe is the only place
// that can catch it, and it now samples the muxer state and logs the TRANSITION.
describe("DOD-M12-CONN-MUXER-OBSERVE-1: the probe reports a muxer death when it happens", () => {
  function nodeWithMuxer(states: Array<string | undefined>) {
    let i = 0;
    const { node } = scriptedNode({ dial: [null], newStream: [null] });
    (node as unknown as { getConnections: () => unknown }).getConnections = () => {
      const m = states[Math.min(i++, states.length - 1)];
      return [{ peerId: DIR_PEER, encryption: "noise", status: "open", ...(m === undefined ? {} : { muxerStatus: m }) }];
    };
    return node;
  }

  it("logs the death at ERROR on the open -> closed transition, not the state", async () => {
    const { logger, lines } = spyLogger();
    // Two healthy samples establish the baseline, then the muxer dies.
    const adapter = adapterOn(nodeWithMuxer(["open", "open", "closed", "closed"]), logger);

    await adapter.checkDirectoryReachable();  // baseline
    await adapter.checkDirectoryReachable();  // still healthy — must NOT log
    expect(lines.some((l) => l.event === "relay.directory.muxer.died")).toBe(false);

    await adapter.checkDirectoryReachable();  // died
    const died = lines.find((l) => l.event === "relay.directory.muxer.died");
    expect(died).toBeDefined();
    expect(died!.ctx["muxerStatuses"]).toEqual(["closed"]);
    // The socket reading open beside a dead muxer is the signature — it is what makes a plain
    // redial a no-op, and it is the pair that was invisible before this field existed.
    expect(died!.ctx["socketStatuses"]).toEqual(["open"]);

    await adapter.checkDirectoryReachable();  // still dead — transitions only, no second line
    expect(lines.filter((l) => l.event === "relay.directory.muxer.died").length).toBe(1);
  });

  it("says nothing when the transport cannot report a muxer state", async () => {
    const { logger, lines } = spyLogger();
    // An older @cello-protocol/transport omits the field entirely. Unknown must not read as broken,
    // or every relay on an old build raises a false death every 30 seconds.
    const adapter = adapterOn(nodeWithMuxer([undefined, undefined, undefined]), logger);

    await adapter.checkDirectoryReachable();
    await adapter.checkDirectoryReachable();
    await adapter.checkDirectoryReachable();

    expect(lines.some((l) => l.event === "relay.directory.muxer.died")).toBe(false);
    expect(lines.some((l) => l.event === "relay.directory.muxer.recovered")).toBe(false);
  });

  it("logs the recovery too, so a flapping link is visible as flapping", async () => {
    const { logger, lines } = spyLogger();
    const adapter = adapterOn(nodeWithMuxer(["open", "closed", "open"]), logger);

    await adapter.checkDirectoryReachable();
    await adapter.checkDirectoryReachable();
    await adapter.checkDirectoryReachable();

    expect(lines.some((l) => l.event === "relay.directory.muxer.died")).toBe(true);
    expect(lines.some((l) => l.event === "relay.directory.muxer.recovered")).toBe(true);
  });
});
