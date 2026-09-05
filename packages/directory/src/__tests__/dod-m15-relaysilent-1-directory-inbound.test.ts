/**
 * DOD-M15-RELAYSILENT-1 review HIGH-1 — **THE DIRECTORY WAS RUNNING AT FIVE TOO.**
 *
 * The relay's inherited `inboundConnectionThreshold: 5` — five inbound connections per SOURCE IP
 * per second — broke the advertised messaging journey, measured on the live spine. `createDirectoryNode`
 * passed no `connectionLimits` either, so every directory node inherited the identical default, and
 * the argument for raising it applies here verbatim: every client dials ALL THREE directories during
 * registration and again at session setup, and agents behind one office NAT, one home router or one
 * cloud egress IP share a single source address.
 *
 * The failure mode is the same and just as invisible. libp2p refuses in `acceptIncomingConnection`,
 * which runs BEFORE the connection gater, before Noise, before `connection:open`, and emits no event
 * — so a registration or session-setup failure caused by it appears in no directory log at all.
 *
 * This asserts the value reaches the RUNNING node, not that a constant equals itself: the mutation
 * that matters is a transport which accepts `connectionLimits`, reports it back, and stops
 * forwarding it to libp2p.
 */
import { describe, it, expect, afterEach } from "vitest";
import { generateKeypair } from "@cello-protocol/crypto";
import { createDirectoryNode, DIRECTORY_INBOUND_CONNECTION_THRESHOLD } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";

/** The directory constructor requires a relay; this node never brokers anything, so a stub is honest. */
const stubRelay: RelayAdapter = {
  async recordAssignment() { return { ok: true as const }; },
  async discardSession() {},
  async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
  async confirmSeal() {},
  async rejectSeal() {},
};

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (stops.length > 0) await stops.pop()!().catch(() => {});
});

describe("DOD-M15-RELAYSILENT-1: the directory's inbound connection budget", () => {
  it("the RUNNING directory node reports the raised threshold, not libp2p's default of five", async () => {
    const { node, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      store: new InMemoryDirectoryStore(),
      relay: stubRelay,
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
    });
    stops.push(stop);

    const limits = node.getConnectionLimits();
    expect(limits.inboundConnectionThreshold).toBe(DIRECTORY_INBOUND_CONNECTION_THRESHOLD);
    expect(limits.inboundConnectionThreshold).toBeGreaterThan(5);
    // The other three keep the values DOD-M15-IDLE-CONNS-1 authored — `resolveConnectionLimits`
    // spreads the declared block first, and an override that returned only what it was given would
    // silently re-inherit libp2p's defaults for the rest.
    expect(limits.maxConnections).toBe(300);
    expect(limits.maxIncomingPendingConnections).toBe(10);
    expect(limits.inboundUpgradeTimeout).toBe(10_000);
  }, 30_000);
});
