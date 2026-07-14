/**
 * DOD-NAT-REACHABILITY-1 (Phase 2, directory half) — relay endpoints ride
 * signaling_auth_ok.
 *
 * A NAT'd agent's standing receiver must take a circuit-relay reservation
 * BEFORE any session exists (it must be reachable for the first inbound
 * request to arrive at all). The per-session relay assignment arrives too late,
 * and a fresh agent has no persisted endpoints — so the directory hands its
 * healthy relay pool to every agent at signaling-auth time, over the same
 * authenticated channel that carries session_assignment frames.
 *
 * Pinned here:
 *  D1 — with a RelayPoolManager, signaling_auth_ok carries relay_endpoints
 *       (peer_id + multiaddrs per AVAILABLE relay).
 *  D2 — draining relays are excluded (same policy as pickRelay).
 *  D3 — with only the legacy hardcoded relayEndpoint, that endpoint is carried.
 *  D4 — a pool with zero available relays omits the field (no silent fallback).
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
import { createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import { RelayPoolManager, type RelayManifestEntry, type RelayPoolManifest } from "../relay-pool-manager.js";
import type { CloudStorageProvider, Logger } from "@cello-protocol/interfaces";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

// ─── Wire helpers (same shapes as peer-info-announce.test.ts) ─────────────────

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

async function readFrame(iter: AsyncIterator<unknown>): Promise<Record<string, unknown>> {
  const result = await iter.next();
  if (result.done) throw new Error("stream closed");
  const v = result.value as Uint8Array | { slice(): Uint8Array };
  const bytes = v instanceof Uint8Array ? v : v.slice();
  return decode(bytes) as Record<string, unknown>;
}

/** Authenticate over the signaling stream; return the RAW decoded auth_ok frame. */
async function authAndGetAck(
  dirNode: Awaited<ReturnType<typeof createDirectoryNode>>,
  scope: ReturnType<typeof createTestScope>,
): Promise<Record<string, unknown>> {
  const clientKey = generateKeypair();
  const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await clientNode.start();
  scope.addCleanup(() => clientNode.stop());

  await clientNode.dial(dirNode.node.listenAddresses()[0]);
  const stream = await clientNode.newStream(dirNode.node.getPeerId(), SIGNALING_PROTOCOL_ID);
  const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

  const challenge = await readFrame(iter);
  if (challenge["type"] !== "signaling_auth_challenge") throw new Error("expected auth challenge");
  const nonce = challenge["nonce"] as Uint8Array;

  const pubkey = await clientKey.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await clientKey.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey: new Uint8Array(pubkey), signature: new Uint8Array(signature) }) as Uint8Array);

  const ack = await readFrame(iter);
  if (ack["type"] !== "signaling_auth_ok") throw new Error(`expected signaling_auth_ok, got ${String(ack["type"])}`);
  return ack;
}

/** Minimal RelayAdapter stub (required constructor option; unused by the auth path). */
function makeRelayStub(): RelayAdapter {
  return {
    recordAssignment(_assignment: RelaySessionAssignment) { return { ok: true as const }; },
    discardSession(_sessionId: Uint8Array) {},
    submitForSeal(_sessionId: Uint8Array) { return { ok: false as const, reason: "session_not_found" }; },
    confirmSeal(_sessionId: Uint8Array) {},
    rejectSeal(_sessionId: Uint8Array, _reason: string) {},
  };
}

// ─── Relay pool construction ──────────────────────────────────────────────────

function makeInMemoryStorage(entries?: Record<string, Uint8Array>): CloudStorageProvider {
  const store = new Map<string, Uint8Array>(Object.entries(entries ?? {}));
  return {
    async upload(key: string, data: Uint8Array) { store.set(key, data); },
    async download(key: string) { return store.get(key); },
  };
}

function canonicalJson(obj: Record<string, unknown>): Uint8Array {
  const sorted = Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  return new TextEncoder().encode(JSON.stringify(sorted));
}

function makeSignedPool(relays: RelayManifestEntry[]): RelayPoolManager {
  const priv = ed25519.utils.randomSecretKey();
  const pubHex = Buffer.from(ed25519.getPublicKey(priv)).toString("hex");
  const ts = new Date().toISOString();
  const body = { version: 1, updatedAt: ts, relays };
  const signature = ed25519.sign(canonicalJson(body as unknown as Record<string, unknown>), priv);
  const manifest: RelayPoolManifest = {
    version: 1,
    signedBy: "test-signer",
    signature: Buffer.from(signature).toString("hex"),
    updatedAt: ts,
    relays,
  };
  const storage = makeInMemoryStorage({
    "relay-manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
  });
  return new RelayPoolManager({
    storage,
    signerPublicKeyHex: pubHex,
    logger: silentLogger,
    pingIntervalMs: 999_999,
    failureThreshold: 3,
  });
}

const RELAY_A: RelayManifestEntry = {
  relayId: "aa".repeat(32),
  endpoint: "wss://relay-a.example.com",
  region: "us-east-1",
  status: "active",
  healthCheckUrl: "http://10.0.0.1:4000/health",
  peerId: "12D3KooWQYV9dGMFoRzNStwpXztXaBUjtPqi6aU76ZgUriHhKust",
  multiaddrs: ["/dns4/relay-a.example.com/tcp/4001"],
};
const RELAY_B: RelayManifestEntry = {
  relayId: "bb".repeat(32),
  endpoint: "wss://relay-b.example.com",
  region: "eu-central-1",
  status: "active",
  healthCheckUrl: "http://10.1.0.1:4000/health",
  peerId: "12D3KooWS46wUj6NYvoAsocxZnxth5EgYD2ZXCm7coMkXUWgS1j3",
  multiaddrs: ["/dns4/relay-b.example.com/tcp/4001"],
};
const RELAY_DRAINING: RelayManifestEntry = {
  relayId: "cc".repeat(32),
  endpoint: "wss://relay-c.example.com",
  region: "ap-northeast-1",
  status: "draining",
  healthCheckUrl: "http://10.2.0.1:4000/health",
  peerId: "12D3KooWGauH5ZxeKVxdV31YP1y9GpvgUg5FANAViYyNEcmsAbgJ",
  multiaddrs: ["/dns4/relay-c.example.com/tcp/4001"],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DOD-NAT-REACHABILITY-1: signaling_auth_ok carries the relay pool", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("D1+D2: available relays ride auth_ok; draining relays are excluded; pool beats the hardcoded endpoint", async () => {
    const pool = makeSignedPool([RELAY_A, RELAY_B, RELAY_DRAINING]);
    await pool.loadManifest();
    const dirKey = generateKeypair();
    const dirNode = await createDirectoryNode({ relay: makeRelayStub(),
      keyProvider: dirKey,
      relayPoolManager: pool,
      // relayEndpoint is a REQUIRED option (legacy); the pool must take precedence over it.
      relayEndpoint: { peer_id: "12D3KooWLegacyMustNotAppear", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
    });
    scope.addCleanup(dirNode.stop);

    const ack = await authAndGetAck(dirNode, scope);
    const endpoints = ack["relay_endpoints"] as Array<{ peer_id: string; multiaddrs: string[] }>;
    expect(Array.isArray(endpoints)).toBe(true);
    expect(endpoints.map((e) => e.peer_id).sort()).toEqual([RELAY_A.peerId, RELAY_B.peerId].sort());
    const byPeer = new Map(endpoints.map((e) => [e.peer_id, e.multiaddrs]));
    expect(byPeer.get(RELAY_A.peerId!)).toEqual(RELAY_A.multiaddrs);
    expect(byPeer.get(RELAY_B.peerId!)).toEqual(RELAY_B.multiaddrs);
  });

  it("D3: legacy hardcoded relayEndpoint is carried when no pool is configured", async () => {
    const dirKey = generateKeypair();
    const dirNode = await createDirectoryNode({ relay: makeRelayStub(),
      keyProvider: dirKey,
      relayEndpoint: { peer_id: RELAY_A.peerId!, multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
    });
    scope.addCleanup(dirNode.stop);

    const ack = await authAndGetAck(dirNode, scope);
    expect(ack["relay_endpoints"]).toEqual([{ peer_id: RELAY_A.peerId, multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] }]);
  });

  it("D4: a pool with ZERO available relays omits the field — no silent fallback to the legacy endpoint (mirrors pickRelay), old-client compatible bare frame", async () => {
    const pool = makeSignedPool([RELAY_DRAINING]);
    await pool.loadManifest();
    const dirKey = generateKeypair();
    const dirNode = await createDirectoryNode({ relay: makeRelayStub(),
      keyProvider: dirKey,
      relayPoolManager: pool,
      relayEndpoint: { peer_id: "12D3KooWLegacyMustNotAppear", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
    });
    scope.addCleanup(dirNode.stop);

    const ack = await authAndGetAck(dirNode, scope);
    expect("relay_endpoints" in ack).toBe(false);
  });
});

// ─── Review round 3: NEVER fabricate addressing ───────────────────────────────

describe("DOD-NAT-REACHABILITY-1: an unaddressable relay is DROPPED, never fabricated", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  /** A relay from the S3 manifest that has NOT been SSM-seeded: no peerId, no multiaddrs. */
  const RELAY_UNSEEDED: RelayManifestEntry = {
    relayId: "dd".repeat(32),
    endpoint: "wss://relay-unseeded.example.com",
    region: "us-west-2",
    status: "active",
    healthCheckUrl: "http://10.3.0.1:4000/health",
  };

  it("a relay with no peerId/multiaddrs is omitted — the old `?? [endpoint]` fallback shipped a wss:// URL as a multiaddr", async () => {
    // The client puts these straight into libp2p's LISTEN set. A wss:// URL is not a
    // multiaddr: node construction THROWS, every standing-receiver retry fails, and the
    // agent ends up with NO receiver — deaf to ALL inbound, including the direct path
    // that worked before this feature. A relay we cannot address is one we do not send.
    const pool = makeSignedPool([RELAY_A, RELAY_UNSEEDED]);
    await pool.loadManifest();
    const dirKey = generateKeypair();
    const dirNode = await createDirectoryNode({ relay: makeRelayStub(),
      keyProvider: dirKey,
      relayPoolManager: pool,
      relayEndpoint: { peer_id: "12D3KooWLegacyMustNotAppear", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
    });
    scope.addCleanup(dirNode.stop);

    const ack = await authAndGetAck(dirNode, scope);
    const endpoints = ack["relay_endpoints"] as Array<{ peer_id: string; multiaddrs: string[] }>;
    expect(endpoints).toEqual([{ peer_id: RELAY_A.peerId, multiaddrs: RELAY_A.multiaddrs }]);
    // The unseeded relay contributed NOTHING — no relayId-as-peer-id, no endpoint-as-multiaddr.
    const flat = JSON.stringify(endpoints);
    expect(flat).not.toContain(RELAY_UNSEEDED.relayId);
    expect(flat).not.toContain("wss://");
  });

  it("when EVERY available relay is unaddressable the field is omitted — not a list of garbage", async () => {
    const pool = makeSignedPool([RELAY_UNSEEDED]);
    await pool.loadManifest();
    const dirKey = generateKeypair();
    const dirNode = await createDirectoryNode({ relay: makeRelayStub(),
      keyProvider: dirKey,
      relayPoolManager: pool,
      relayEndpoint: { peer_id: "12D3KooWLegacyMustNotAppear", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
    });
    scope.addCleanup(dirNode.stop);

    const ack = await authAndGetAck(dirNode, scope);
    expect("relay_endpoints" in ack).toBe(false);
  });
});
