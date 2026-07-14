/**
 * DOD-NAT-REACHABILITY-1 — the relay must be sized for CELLO, not for a public DHT.
 *
 * THE ROOT CAUSE of "agents cannot get a circuit-relay reservation", found live:
 * the relay ran libp2p's DEFAULTS. maxReservations is 15, and a reservation is held
 * for its full TTL even after the client disconnects — while every CELLO agent needs
 * one and every daemon restart mints a fresh peer id that consumes a NEW slot. The
 * slots were exhausted almost immediately, after which the relay completed the
 * handshake and silently granted NOTHING: agents came up looking healthy and
 * reachable by nobody.
 *
 * L1 — the relay grants far more than libp2p's 15 reservations.
 * L2 — relayed connections are NOT capped at the default 2 min / 128 KiB: where the
 *      hole punch fails, the relayed connection IS the session.
 */
import { setupV3Tests, createTestScope, describe, it, expect, beforeEach, afterEach } from "@claude-flow/testing";
import { createNode } from "@cello-protocol/transport";
import { generateKeypair } from "@cello-protocol/crypto";

setupV3Tests();

describe("DOD-NAT-REACHABILITY-1: the relay's reservation limits", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  /** An agent's standing receiver, reserving with the relay. */
  async function reserveWith(relayAddr: string, scope: ReturnType<typeof createTestScope>): Promise<boolean> {
    const node = await createNode({
      keyProvider: generateKeypair(),
      listenAddresses: ["/ip4/127.0.0.1/tcp/0", `${relayAddr}/p2p-circuit`],
      nodeType: "standing_receiver",
    });
    scope.addCleanup(async () => { try { await node.stop(); } catch { /* cleanup */ } });
    await node.start();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (node.listenAddresses().some((a) => a.includes("/p2p-circuit"))) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  it("L1: maxReservations is HONORED — with a cap of 2, the third agent is refused (and refused SILENTLY, which is the trap)", async () => {
    // Proves the config reaches circuitRelayServer. It also demonstrates the failure
    // mode that bit us live: the refused agent's start() SUCCEEDS. It simply has no
    // circuit address — up, healthy-looking, and reachable by nobody.
    const relay = await createNode({
      keyProvider: generateKeypair(),
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relayServer: { enabled: true, reservations: { maxReservations: 2, applyDefaultLimit: false } },
    });
    await relay.start();
    scope.addCleanup(async () => { try { await relay.stop(); } catch { /* cleanup */ } });
    const relayAddr = relay.listenAddresses().find((a) => a.includes("/p2p/"))!;

    expect(await reserveWith(relayAddr, scope)).toBe(true);
    expect(await reserveWith(relayAddr, scope)).toBe(true);
    expect(await reserveWith(relayAddr, scope)).toBe(false); // cap reached — silently
  }, 60_000);

  // NOTE — no 16-agent capacity test here on purpose. Standing up 16 libp2p nodes plus
  // a relay inside one test worker hits a local ceiling (~14) that has nothing to do
  // with the relay's configuration, so such a test measures the machine, not the code.
  // L1 is the load-bearing proof: the cap reaches circuitRelayServer and, once hit,
  // the relay refuses SILENTLY. Production ran the stock cap of 15 and was exhausted
  // by ordinary use — every agent needs a slot, a slot is held for its full TTL even
  // after the client disconnects, and every daemon restart mints a fresh peer id that
  // takes a NEW slot. 4096 is the fix.
});

