/**
 * M12 DOD-AE-APPEND-1/MUTABLE-1 — AeSyncService lifecycle wiring into CelloDirectoryNode.
 *
 * The wiring commit had no coverage of its own (it passed the revert test vacuously). These pin the
 * three claims that only the wiring layer can make:
 *  - the AE protocol is registered iff aeSync opts are present;
 *  - the service's own peerId comes from the LIVE transport, never from config (a configured value
 *    could lie about this node's dial identity, and the peer channel-binds against it);
 *  - a node asked for AE without a logger FAILS LOUD — AE carries kill-switch propagation and its
 *    §6 events are the only operational signal, so silently disabling it is the worst outcome.
 *
 * Driven through a fake CelloNode: this is lifecycle/registration, not protocol (proven in
 * ae-channel.test.ts) and not libp2p (DOD-AE-LOCAL-E2E-1).
 */

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { CelloDirectoryNode } from "../directory-node.js";
import { AE_PROTOCOL_ID } from "../ae-channel.js";
import type { AeStoreView, TierARecord, TierBRecord } from "../anti-entropy-engine.js";
import { computeTableDigest } from "../set-reconciliation.js";
import { tierBTableDigest } from "../ae-round.js";

const LIVE_PEER_ID = "12D3KooWLiveTransportIdentity";

/** A store that advertises nothing — the dial loop is not what these tests exercise. */
const emptyStore: AeStoreView = {
  tierATables: () => [],
  tierBTables: () => [],
  tierARecordHashes: () => [],
  tierATableDigest: () => computeTableDigest([]),
  tierBTableDigest: () => tierBTableDigest(new Map()),
  tierBVersions: () => new Map(),
  serveTierA: (): TierARecord[] => [],
  serveTierB: (): TierBRecord[] => [],
  applyTierA: () => 0,
  applyTierB: () => 0,
};

const manifest = {
  version: 2,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2027-01-01T00:00:00Z",
  nodes: [],
  signatures: [],
};

function fakeNode() {
  const handled: string[] = [];
  return {
    handled,
    node: {
      handle: async (protocolId: string) => { handled.push(protocolId); },
      getPeerId: () => LIVE_PEER_ID,
      dial: async () => ({ peerId: "unused" }),
      newStream: async () => { throw new Error("not dialed in these tests"); },
      start: async () => {},
      stop: async () => {},
      listenAddresses: () => [],
      getProtocols: () => [],
      getConnections: () => [],
      hasDirectConnectionTo: () => false,
      onPeerConnect: () => {},
      onPeerDisconnect: () => {},
    },
  };
}

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** Minimal opts for a node that can start() — AE is the only thing under test. */
function baseOpts(node: unknown, logger: unknown) {
  return {
    node,
    logger,
    keyProvider: { getPublicKey: () => new Uint8Array(32), sign: async () => new Uint8Array(64) },
    relay: {} as never,
    relayEndpoint: { peer_id: "relay", multiaddrs: [] },
    store: {} as never,
    shareStore: {} as never,
  } as unknown as ConstructorParameters<typeof CelloDirectoryNode>[0];
}

const aeIdentity = { nodeId: "aws-use1", sign: (tbs: Uint8Array) => ed25519.sign(tbs, new Uint8Array(32).fill(7)) };

describe("AE lifecycle wiring in CelloDirectoryNode", () => {
  it("registers /cello/anti-entropy/1.0.0 when aeSync opts are present", async () => {
    const { node, handled } = fakeNode();
    const dir = new CelloDirectoryNode({
      ...baseOpts(node, noopLogger),
      aeSync: { identity: aeIdentity, store: emptyStore, manifest: () => manifest },
    } as never);
    await dir.start();
    expect(handled).toContain(AE_PROTOCOL_ID);
    dir.stopAeSync();
  });

  it("does NOT register the AE protocol when aeSync is absent (pre-M12 behavior)", async () => {
    const { node, handled } = fakeNode();
    const dir = new CelloDirectoryNode(baseOpts(node, noopLogger));
    await dir.start();
    expect(handled).not.toContain(AE_PROTOCOL_ID);
  });

  it("dials with the LIVE transport peerId, ignoring a peerId smuggled through config", async () => {
    // The claim that matters for channel binding: the peer verifies our TBS-bound peerId against
    // the manifest, so a configured (lying or stale) value must never reach the wire. Observed
    // end-to-end by decoding the ae_hello frame the service actually sends.
    const sent: Uint8Array[] = [];
    const { node } = fakeNode();
    node.newStream = async () => ({
      send(bytes: Uint8Array | { subarray(): Uint8Array }) {
        sent.push(bytes instanceof Uint8Array ? bytes : bytes.subarray());
      },
      async *[Symbol.asyncIterator]() { /* peer never answers — we only need our first frame */ },
      close: async () => {},
      abort: () => {},
    }) as never;

    const peered = {
      ...manifest,
      nodes: [{ nodeId: "gcp-usc1", pubkey: "bb".repeat(32), region: "r", provider: "gcp", endpoint: "https://b.example", role: "validator", peerId: "12D3KooWPeer" }],
    };
    const dir = new CelloDirectoryNode({
      ...baseOpts(node, noopLogger),
      aeSync: {
        // Deliberately smuggle a WRONG peerId through config; the wiring must overwrite it.
        // (The option type is Omit<…,"peerId">, so this is only reachable by casting — the
        // compile-time guard is the first line of defense and this is the runtime proof.)
        identity: { ...aeIdentity, peerId: "12D3KooWLiesAboutItsIdentity" },
        store: emptyStore,
        manifest: () => peered,
        intervalMs: 50,
      },
    } as never);
    await dir.start();
    await new Promise((r) => setTimeout(r, 250)); // let one dial-loop tick fire
    dir.stopAeSync();

    expect(sent.length).toBeGreaterThan(0);
    // it-length-prefixed wraps the CBOR; the peer_id string is legible in the frame bytes either way.
    const wire = Buffer.concat(sent.map((b) => Buffer.from(b))).toString("utf8");
    expect(wire).toContain(LIVE_PEER_ID);
    expect(wire).not.toContain("12D3KooWLiesAboutItsIdentity");
  });

  it("FAILS LOUD when aeSync is requested without a logger (never silently un-synced)", () => {
    const { node } = fakeNode();
    expect(() => new CelloDirectoryNode({
      ...baseOpts(node, undefined),
      aeSync: { identity: aeIdentity, store: emptyStore, manifest: () => manifest },
    } as never)).toThrow(/aeSync requires a logger/i);
  });
});
