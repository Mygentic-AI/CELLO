/**
 * DOD-M15-RELAYSLOTS-1 — the per-source bound, proven against a REAL relay and REAL clients.
 *
 * ─── The one assumption every other test in this unit takes on faith ──────────────────────────
 *
 * The per-source bound needs the reserving peer's IP address, and libp2p's
 * `denyInboundRelayReservation` hook is handed nothing but a peer id. So the gater looks the
 * address up in the relay's own connection list — which only works if libp2p has REGISTERED the
 * connection by the time it calls the hook.
 *
 * Nothing proved that. The unit tests drive the hook directly and populate the connection list
 * themselves, so they control an ordering that production does not: an implementation where the
 * address is never resolvable would leave the per-source bound completely inert — falling back to
 * the global bound for every peer on earth — and every one of those tests would still pass.
 *
 * Review called that gap blocking, and it is the right call: "I believe libp2p registers the
 * connection first" is reasoning, not measurement, and this is a security bound.
 *
 * ─── So this measures it ──────────────────────────────────────────────────────────────────────
 *
 * Real `createRelayNode`, real `createNode` clients taking real circuit reservations over real TCP,
 * all from 127.0.0.1 — one source. If the address resolves, the bound applies and occupancy stops
 * at the cap. If it does not, every client is admitted and occupancy runs past it. The cap is
 * lowered for the test so this costs a handful of nodes rather than seventeen.
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
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import { createRelayNode } from "../relay-node.js";
import { RelayConnectionGater } from "../relay-connection-gater.js";

setupV3Tests();

const PER_SOURCE = 3;

describe("DOD-M15-RELAYSLOTS-1: the per-source bound holds over the real wire", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★★★ real clients from ONE address cannot hold more than the per-source budget", async () => {
    const dirKp = generateKeypair();
    /**
     * The gater is constructed here rather than left to the factory purely so the test can read
     * `slotCount()` afterwards — it is the SAME class the relay builds for itself, with the caps
     * lowered. Nothing about the path under test is stubbed.
     */
    const gater = new RelayConnectionGater({
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      reservationGraceMs: 60_000,
      unprovenReservationsPerSource: PER_SOURCE,
    });
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      connectionGater: gater,
    });
    scope.addCleanup(stop);
    const relayAddr = relayNode.listenAddresses().find((a) => a.includes("/p2p/"))!;

    // PER_SOURCE + 2 standing receivers, each a real libp2p node asking this relay for a real
    // circuit reservation, all from 127.0.0.1. None authenticates — the flood shape.
    for (let i = 0; i < PER_SOURCE + 2; i++) {
      const node = await createNode({
        keyProvider: generateKeypair(),
        listenAddresses: ["/ip4/127.0.0.1/tcp/0", `${relayAddr}/p2p-circuit`],
        nodeType: "standing_receiver",
      });
      scope.addCleanup(async () => { try { await node.stop(); } catch { /* cleanup */ } });
      await node.start();
      // Give the reservation a chance to land before the next one asks, so this measures the bound
      // rather than a race between five simultaneous handshakes.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !node.listenAddresses().some((a) => a.includes("/p2p-circuit"))) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    expect(
      gater.slotCount(),
      "if libp2p had not registered the connection before calling the reservation hook, the source " +
        "address would be unreadable, the per-source bound would be inert, and all five of these " +
        "would be holding reservations. That is the failure every other test in this unit is blind to.",
    ).toBeLessThanOrEqual(PER_SOURCE);

    expect(
      gater.unreadableSourceCount(),
      "and it must be readable, not merely bounded by the global fallback — a non-zero count here " +
        "means the per-source bound was never consulted for those callers.",
    ).toBe(0);
  }, 60_000);
});
