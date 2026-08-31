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
import { createRelayNode } from "../relay-node.js";

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

/**
 * DOD-M15-RELAYABUSE-1 — L2, closing the gap the header comment above LEFT AS PROSE.
 *
 * "Relayed connections are NOT capped at the default 2 min / 128 KiB" was asserted here and never
 * tested — exactly the "comment claims a property, nothing checks it" shape this milestone exists
 * to catch. `applyDefaultLimit: false` (no cap at all) is now `applyDefaultLimit: true` with a
 * CELLO-sized cap (`circuitDurationLimitMs` / `circuitDataLimitBytes`, both overridable). These
 * tests prove the override actually reaches libp2p's circuit-relay server and is ENFORCED — not
 * just accepted as a config value — using tiny overrides so the test stays fast.
 */
describe("DOD-M15-RELAYABUSE-1: relayed connections carry a REAL duration and byte cap", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  const ECHO_PROTOCOL = "/cello-test/echo/1.0.0";

  /** Stand up a relay via the PRODUCTION factory (createRelayNode), with the given circuit overrides. */
  async function makeRelay(opts: { circuitDurationLimitMs?: number; circuitDataLimitBytes?: bigint }) {
    const dirKp = generateKeypair();
    const { node, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      ...opts,
    });
    scope.addCleanup(stop);
    return node;
  }

  /** A's standing receiver: reserves with the relay and serves ECHO_PROTOCOL. */
  async function makeReceiver(relayAddr: string) {
    const node = await createNode({
      keyProvider: generateKeypair(),
      listenAddresses: ["/ip4/127.0.0.1/tcp/0", `${relayAddr}/p2p-circuit`],
      nodeType: "standing_receiver",
    });
    scope.addCleanup(async () => { try { await node.stop(); } catch { /* cleanup */ } });
    await node.start();
    await node.handle(ECHO_PROTOCOL, () => { /* swallow — this test only cares whether the LINK survives */ });
    const deadline = Date.now() + 30_000;
    let circuitAddr: string | undefined;
    while (Date.now() < deadline) {
      circuitAddr = node.listenAddresses().find((a: string) => a.includes("/p2p-circuit"));
      if (circuitAddr) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!circuitAddr) throw new Error("receiver never got a circuit reservation");
    return { node, circuitAddr };
  }

  /** B dials A THROUGH the relay's circuit (no hole-punch attempt — a direct circuit dial). */
  async function connectThroughCircuit(circuitAddr: string, receiverPeerId: string) {
    const node = await createNode({ keyProvider: generateKeypair(), listenAddresses: [] });
    scope.addCleanup(async () => { try { await node.stop(); } catch { /* cleanup */ } });
    await node.start();
    await node.dial(circuitAddr);
    const stream = await node.newStream(receiverPeerId, ECHO_PROTOCOL);
    return { node, stream };
  }

  /** Await a peer:disconnect for `peerId`, or resolve `false` on timeout. */
  function awaitDisconnect(node: Awaited<ReturnType<typeof createNode>>, peerId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      node.onPeerDisconnect((p: string) => {
        if (p === peerId) { clearTimeout(timer); resolve(true); }
      });
    });
  }

  it("L2a: a tiny circuitDurationLimitMs closes the relayed link once it elapses", async () => {
    const relay = await makeRelay({ circuitDurationLimitMs: 400 });
    const relayAddr = relay.listenAddresses().find((a) => a.includes("/p2p/"))!;
    const { circuitAddr } = await makeReceiver(relayAddr);
    const receiverPeerId = circuitAddr.split("/p2p/").pop()!;

    const { node: dialer } = await connectThroughCircuit(circuitAddr, receiverPeerId);

    // The link must be ALIVE well before the 400ms limit (this is the revert-test's teeth: without
    // the fix, `applyDefaultLimit: false` means it also survives long past it).
    const disconnectedEarly = await awaitDisconnect(dialer, receiverPeerId, 150);
    expect(disconnectedEarly).toBe(false);

    // And gone comfortably after the limit — the relay, not either endpoint, enforces this.
    const disconnectedLate = await awaitDisconnect(dialer, receiverPeerId, 3_000);
    expect(disconnectedLate).toBe(true);
  }, 20_000);

  it("L2b: a tiny circuitDataLimitBytes closes the relayed link once exceeded", async () => {
    const relay = await makeRelay({
      circuitDurationLimitMs: 60_000, // generous — this test is about BYTES, not time
      // 4 KiB: small enough to trip with one application-level send, large enough that the
      // multistream-select + protocol negotiation overhead of ESTABLISHING the circuit stream
      // (which counts against the same cap) doesn't exhaust it before the test payload is sent —
      // that overhead alone reset the stream at a 64-byte cap when this test was first written.
      circuitDataLimitBytes: 4096n,
    });
    const relayAddr = relay.listenAddresses().find((a) => a.includes("/p2p/"))!;
    const { circuitAddr } = await makeReceiver(relayAddr);
    const receiverPeerId = circuitAddr.split("/p2p/").pop()!;

    const { node: dialer, stream } = await connectThroughCircuit(circuitAddr, receiverPeerId);

    // Send well past the 4 KiB cap. The relay counts bytes crossing the circuit in EITHER
    // direction, so exceeding it from the dialer's side is sufficient to trip the limit — and it
    // does so immediately: the relay resets the stream inline rather than waiting for a next tick,
    // which is itself proof the limit is enforced, not merely configured.
    let sendThrew = false;
    try {
      stream.send(new Uint8Array(65_536).fill(1));
    } catch {
      sendThrew = true;
    }

    const disconnected = await awaitDisconnect(dialer, receiverPeerId, 5_000);
    expect(sendThrew || disconnected).toBe(true);
  }, 20_000);
});

