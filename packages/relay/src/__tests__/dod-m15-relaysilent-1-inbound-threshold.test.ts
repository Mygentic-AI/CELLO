/**
 * DOD-M15-RELAYSILENT-1 — the relay stops refusing legitimate clients five at a time.
 *
 * **What the operator lived through.** A conversation ends, the daemon rebuilds the listening post
 * that holds the agent's slot on the relay, and from that moment the agent cannot reach that relay
 * at all — parked mail cannot be deposited, waiting mail cannot be drained, and nothing announces
 * it. Measured cause, quoted from the relay with libp2p's own debug logging on:
 *
 *     connection from /ip4/127.0.0.1/tcp/64907 refused - inboundConnectionThreshold
 *     exceeded by host 127.0.0.1                                                    (×6)
 *
 * libp2p@3.3.2 rate-limits INBOUND connections at `points: 5, duration: 1` — five per second per
 * source IP — and `upgrader.js` calls `acceptIncomingConnection` BEFORE the connection gater,
 * before Noise, before `connection:open`. So the refusal happens beneath every layer CELLO logs:
 * the relay is not going quiet, it is structurally unable to say it refused you.
 *
 * **Measured in the failing second: 11 inbound attempts from one host, 5 admitted, 6 refused —
 * while 4 connections were open against a ceiling of 300.** The per-second IP rate was the only
 * binding constraint, at 1.3% of capacity.
 *
 * **Why raising it is not a security regression** — Andre ruled 2026-09-05. The control is keyed on
 * SOURCE IP, so an attacker with a handful of addresses pays nothing and one who dials steadily at
 * five per second pays nothing either; it costs an honest operator behind a NAT their relay. That is
 * a guard that is optional for the party it guards against. The controls that actually bound relay
 * abuse are untouched and were nowhere near binding: `maxConnections` (300, observed peak 4), the
 * per-agent reservation slot cap (4096, measured never to have fired), reservation authentication,
 * and `DOD-M15-RELAYABUSE-1`'s limiter.
 *
 * **This is the tuning pass `DOD-M15-IDLE-CONNS-1` asked for in writing** — *"pin what runs today,
 * make it visible, and let `getConnectionLimits()` supply the number a later tuning pass needs."*
 */
import { describe, it, expect, afterEach } from "vitest";
import { generateKeypair } from "@cello-protocol/crypto";
import type { CelloNode } from "@cello-protocol/transport";
import { createRelayNode, RELAY_INBOUND_CONNECTION_THRESHOLD } from "../relay-node.js";

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (stops.length > 0) await stops.pop()!().catch(() => {});
});

async function startRelay(): Promise<CelloNode> {
  const dirKp = generateKeypair();
  const { node, stop } = await createRelayNode({
    directoryPubkey: await dirKp.getPublicKey(),
    listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
  });
  stops.push(stop);
  return node;
}

describe("DOD-M15-RELAYSILENT-1: the relay's inbound connection budget", () => {
  it("the RUNNING relay reports the raised threshold — not libp2p's default", async () => {
    const node = await startRelay();
    // Read off the live node, not off the constant: a constant nothing passes to `createNode` is a
    // number with no reader, and that is precisely how this defect existed for weeks.
    expect(node.getConnectionLimits().inboundConnectionThreshold).toBe(RELAY_INBOUND_CONNECTION_THRESHOLD);
  }, 30_000);

  it("the threshold is 256 and sits BELOW maxConnections, so the connection ceiling stays the real limit", async () => {
    const node = await startRelay();
    const limits = node.getConnectionLimits();
    expect(RELAY_INBOUND_CONNECTION_THRESHOLD).toBe(256);
    /**
     * The ordering is the whole argument for the number, not decoration. A per-second IP rate ABOVE
     * `maxConnections` would make the rate limiter unreachable and leave the relay with one control
     * where it should have two. Below it, `maxConnections` binds first and the rate limiter stays a
     * real backstop against a single host opening connections faster than the ceiling can prune.
     */
    expect(limits.inboundConnectionThreshold).toBeLessThan(limits.maxConnections);
  }, 30_000);

  /**
   * ⚠️ **A PRESERVATION GUARD, NOT COVERAGE — it passes on the tree before this unit too.** Named so
   * that a passing test beside a fix is not read as proof of the fix. It exists because
   * `resolveConnectionLimits` is easy to "simplify" into an override that returns only what it was
   * given, which silently re-inherits libp2p's defaults for the other three — this unit's own
   * defect, reintroduced by its fix.
   */
  it("A GUARD (passes pre-fix): the other three declared limits are UNCHANGED — this unit tuned one number, not four", async () => {
    const node = await startRelay();
    const limits = node.getConnectionLimits();
    // `resolveConnectionLimits` spreads the declared block first, so an override naming one key
    // keeps the other three. Asserted because the alternative — an override that returned only what
    // it was given — silently re-inherits libp2p's defaults for the rest, which is this unit's own
    // defect reintroduced by its fix.
    expect(limits.maxConnections).toBe(300);
    expect(limits.maxIncomingPendingConnections).toBe(10);
    expect(limits.inboundUpgradeTimeout).toBe(10_000);
  }, 30_000);

  it("the relay ANNOUNCES its inbound budget at startup — the number nobody could see", async () => {
    /**
     * ⚠️ **libp2p GIVES CELLO NO WAY TO OBSERVE A REFUSAL.** `acceptIncomingConnection` emits no
     * event, increments a metrics counter and writes a `debug` line, and it runs before the
     * connection gater — so there is no hook at any layer this project controls. An operator whose
     * relay was turning agents away saw nothing in the relay log, nothing in `cello_status`, and
     * nothing on the client beyond `ECONNRESET`.
     *
     * Logging the CEILING is the honest partial answer: it does not report refusals, and it does
     * not pretend to. It makes the number that caused them readable, so the next person who sees
     * connections dying at a relay has somewhere to start. Reading the metrics counter is the real
     * fix and is recorded as still owed.
     */
    const events: Array<{ event: string; ctx: Record<string, unknown> }> = [];
    const logger = {
      debug: () => {}, warn: () => {}, error: () => {},
      info: (event: string, ctx?: Record<string, unknown>) => { events.push({ event, ctx: ctx ?? {} }); },
    };
    const dirKp = generateKeypair();
    const { stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      logger: logger as never,
    });
    stops.push(stop);

    const line = events.find((e) => e.event === "relay.config.connection_limits");
    expect(line, "the relay says what its connection budget is").toBeDefined();
    expect(line!.ctx["inboundConnectionThreshold"]).toBe(256);
    expect(line!.ctx["maxConnections"]).toBe(300);
    // The line has to say what it CANNOT tell you, or it reads as a refusal counter.
    expect(String(line!.ctx["impact"])).toContain("refus");
  }, 30_000);
});
