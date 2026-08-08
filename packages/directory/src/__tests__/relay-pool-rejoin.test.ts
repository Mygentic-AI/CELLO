// A relay that is not in the manifest can never join the pool — and the pool only ever shrinks.
//
// WHAT THE OPERATOR SEES. After any relay roll, agents cannot start conversations at all: the
// directory refuses every session with `relay_unavailable` while the relays are up and listening.
// Restarting the directory is the only cure, and it was needed three times on 2026-08-08.
//
// WHY. Two mechanisms exist and neither can add a relay:
//
//   "I am here"      relay -> directory, authenticated with an Ed25519 self-signature. The
//                    directory writes it to `relay_registrations` and then, if the relay is not
//                    already listed in the manifest, throws RELAY_NOT_IN_MANIFEST and drops it.
//   "are you alive"  directory -> relay, every 30s. Only ever REMOVES: a relay that fails the
//                    threshold is dropped from the pool. Nothing puts it back.
//
// So the pool is monotonically decreasing, and the manifest — the only thing that can grow it — was
// authored by `sign-manifest.sh` in the AWS CloudFormation deploy path, which has not run since the
// GCP cutover. Live consequence: two relays are deployed and the manifest has only ever named one,
// so europe-west1 has never carried a single session.
//
// THE FIX UNDER TEST. Registration is already authenticated and already persisted — it is entitled
// to introduce a relay, not merely to patch one. An absent relay is ADDED; a present one keeps the
// old update-only behaviour, because that path carries an invariant worth preserving (see below).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeypair } from "@cello-protocol/crypto";
import { RelayPoolManager } from "../relay-pool-manager.js";

const RELAY_A = "a".repeat(64);
const RELAY_B = "b".repeat(64);
const PEER_B = "12D3KooWJXHpnWQhGk3jXBJYdXMmeLxEhRqzwZCYd1bxSUh4pg83";

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory stand-in for the node's manifest bucket. */
function makeStorage(initial: unknown) {
  let bytes = new TextEncoder().encode(JSON.stringify(initial));
  return {
    download: vi.fn(async () => bytes),
    upload: vi.fn(async (_name: string, data: Uint8Array) => {
      bytes = new Uint8Array(data);
    }),
    current: () => JSON.parse(new TextDecoder().decode(bytes)),
  };
}

function baseManifest() {
  return {
    version: 6,
    updatedAt: "2026-08-08T12:16:42.626Z",
    relays: [
      {
        relayId: RELAY_A,
        endpoint: "ws://34.139.119.165:4001",
        region: "us-east1",
        status: "active",
        healthCheckUrl: "http://34.139.119.165:4000/health",
        peerId: "12D3KooWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        multiaddrs: ["/ip4/34.139.119.165/tcp/4001/ws/p2p/12D3KooWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      },
    ],
    signedBy: "",
    signature: "",
  };
}

describe("a registering relay can join the pool it is not yet in", () => {
  let kp: ReturnType<typeof generateKeypair>;
  let signerHex: string;

  beforeEach(async () => {
    kp = generateKeypair();
    signerHex = Buffer.from(await kp.getPublicKey()).toString("hex");
  });

  it("ADDS an authenticated relay that is absent, instead of refusing it", async () => {
    const storage = makeStorage(baseManifest());
    const mgr = new RelayPoolManager({
      storage: storage as never,
      signerPublicKeyHex: signerHex,
      logger: noopLogger as never,
    });

    const result = await mgr.reSignManifestForRelay({
      relayId: RELAY_B,
      healthCheckUrl: "http://34.77.112.231:4000/health",
      region: "europe-west1",
      multiaddr: `/ip4/34.77.112.231/tcp/4001/ws/p2p/${PEER_B}`,
      keyProvider: kp,
    });

    expect(result).toMatchObject({ updated: true });

    const written = storage.current();
    const added = written.relays.find((r: { relayId: string }) => r.relayId === RELAY_B);
    expect(added).toBeDefined();
    // An entry with no address is an entry the pool cannot dial — the add is worthless without it.
    expect(added.multiaddrs).toEqual([`/ip4/34.77.112.231/tcp/4001/ws/p2p/${PEER_B}`]);
    expect(added.peerId).toBe(PEER_B);
    expect(added.region).toBe("europe-west1");
    expect(added.status).toBe("active");
    // The relay already present must survive: this is an add, never a replace.
    expect(written.relays.find((r: { relayId: string }) => r.relayId === RELAY_A)).toBeDefined();
    expect(written.version).toBe(7);
  });

  it("lets a relay that fell out of the pool back in", async () => {
    // The outage shape: health checks drop a relay during a roll, and nothing re-adds it. Same code
    // path as the first test, but this is the case that actually bit — the relay IS deployed and
    // registered, and the pool still refuses to route to it.
    const manifest = baseManifest();
    manifest.relays = [];
    const storage = makeStorage(manifest);
    const mgr = new RelayPoolManager({
      storage: storage as never,
      signerPublicKeyHex: signerHex,
      logger: noopLogger as never,
    });

    await mgr.reSignManifestForRelay({
      relayId: RELAY_A,
      healthCheckUrl: "http://34.139.119.165:4000/health",
      region: "us-east1",
      multiaddr: "/ip4/34.139.119.165/tcp/4001/ws/p2p/12D3KooWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      keyProvider: kp,
    });

    expect(storage.current().relays).toHaveLength(1);
  });

  it("does NOT let registration rewrite the address of a relay already in the manifest", async () => {
    // SI-001. The multiaddr in a relay_register frame is the relay's own view of itself and has
    // historically been a container-local address; writing it over an established entry replaced a
    // stable address with an ephemeral one and broke every client that read the manifest afterwards.
    // Adding an absent relay is safe because there is nothing to overwrite — updating an existing
    // one is not, so the two cases must stay asymmetric. Do not "simplify" them into one.
    const storage = makeStorage(baseManifest());
    const mgr = new RelayPoolManager({
      storage: storage as never,
      signerPublicKeyHex: signerHex,
      logger: noopLogger as never,
    });

    await mgr.reSignManifestForRelay({
      relayId: RELAY_A,
      healthCheckUrl: "http://34.139.119.165:4000/health-CHANGED",
      region: "us-east1",
      multiaddr: "/ip4/10.0.0.7/tcp/4001/ws/p2p/12D3KooWattackerattackerattackerattackerattacker",
      keyProvider: kp,
    });

    const entry = storage.current().relays.find((r: { relayId: string }) => r.relayId === RELAY_A);
    expect(entry.healthCheckUrl).toBe("http://34.139.119.165:4000/health-CHANGED");
    expect(entry.multiaddrs).toEqual([
      "/ip4/34.139.119.165/tcp/4001/ws/p2p/12D3KooWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
    expect(entry.peerId).toBe("12D3KooWaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("DOES correct the region of a relay already listed", async () => {
    // Region is descriptive, not dialable, so refreshing it cannot break a connection — and leaving
    // it stale breaks region-aware selection silently. Every relay defaulted to "us-east-1" until
    // 2026-08-08, europe included, and without this path an existing entry keeps the wrong region
    // forever. Deliberately the opposite decision from the multiaddr immediately above.
    const storage = makeStorage(baseManifest());
    const mgr = new RelayPoolManager({
      storage: storage as never,
      signerPublicKeyHex: signerHex,
      logger: noopLogger as never,
    });

    await mgr.reSignManifestForRelay({
      relayId: RELAY_A,
      healthCheckUrl: "http://34.139.119.165:4000/health-v2",
      region: "europe-west1",
      keyProvider: kp,
    });

    const entry = storage.current().relays.find((r: { relayId: string }) => r.relayId === RELAY_A);
    expect(entry.region).toBe("europe-west1");
  });

  it("refuses to add a relay whose multiaddr carries no peer id", async () => {
    // Without a peer id the entry is undialable, and a silently-added dud is worse than a refusal:
    // the pool reports a relay it can never reach.
    const storage = makeStorage(baseManifest());
    const mgr = new RelayPoolManager({
      storage: storage as never,
      signerPublicKeyHex: signerHex,
      logger: noopLogger as never,
    });

    await expect(
      mgr.reSignManifestForRelay({
        relayId: RELAY_B,
        healthCheckUrl: "http://34.77.112.231:4000/health",
        region: "europe-west1",
        multiaddr: "/ip4/34.77.112.231/tcp/4001/ws",
        keyProvider: kp,
      }),
    ).rejects.toThrow(/MULTIADDR_MISSING_PEER_ID/);

    expect(storage.current().relays).toHaveLength(1);
  });

  it("still refuses to add when the registration carries no address at all", async () => {
    const storage = makeStorage(baseManifest());
    const mgr = new RelayPoolManager({
      storage: storage as never,
      signerPublicKeyHex: signerHex,
      logger: noopLogger as never,
    });

    await expect(
      mgr.reSignManifestForRelay({
        relayId: RELAY_B,
        healthCheckUrl: "http://34.77.112.231:4000/health",
        region: "europe-west1",
        keyProvider: kp,
      }),
    ).rejects.toThrow(/RELAY_NOT_IN_MANIFEST/);
  });
});
