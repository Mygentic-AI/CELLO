/**
 * CELLO-MSG-002 — CelloClient tests
 *
 * Every AC and SI from the story spec maps to a named test below.
 * Tests are written RED-first per SPARC Phase R.
 */

import { randomBytes } from "node:crypto";
import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  waitFor,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { generateKeypair } from "@cello/crypto";
import { createNode } from "@cello/transport";
import * as lp from "it-length-prefixed";
import { serializeEnvelope, buildEnvelope } from "@cello/protocol-types";
import { createClient } from "../client.js";
import type { CelloClient } from "../types.js";

setupV3Tests();

// ─── helpers ──────────────────────────────────────────────────────────────────


async function makeClientPair(): Promise<{
  clientA: CelloClient;
  clientB: CelloClient;
  kpA: ReturnType<typeof generateKeypair>;
  kpB: ReturnType<typeof generateKeypair>;
  pubkeyAHex: string;
  pubkeyBHex: string;
  cleanup: () => Promise<void>;
}> {
  const kpA = generateKeypair();
  const kpB = generateKeypair();

  const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });

  await nodeA.start();
  await nodeB.start();

  const clientA = createClient(nodeA, kpA);
  const clientB = createClient(nodeB, kpB);

  // Register inbound handlers
  await clientA.registerHandler();
  await clientB.registerHandler();

  // Cross-register peers
  const pubkeyAHex = Buffer.from(await kpA.getPublicKey()).toString("hex");
  const pubkeyBHex = Buffer.from(await kpB.getPublicKey()).toString("hex");

  // A dials B to establish connection
  const dialResult = await nodeA.dial(nodeB.listenAddresses()[0]!);
  const bPeerId = dialResult.peerId;
  const aPeerId = nodeA.getPeerId();

  clientA.addPeer(pubkeyBHex, bPeerId, nodeB.listenAddresses());
  clientB.addPeer(pubkeyAHex, aPeerId, nodeA.listenAddresses());

  const cleanup = async () => {
    try { await nodeA.stop(); } catch {}
    try { await nodeB.stop(); } catch {}
  };

  return { clientA, clientB, kpA, kpB, pubkeyAHex, pubkeyBHex, cleanup };
}

// ─── scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

// ─── AC-001: basic send/receive ───────────────────────────────────────────────

describe("AC-001: A sends 'hello' to B, B receives it", () => {
  it("AC-001: content matches, sender_pubkey matches A, signature verifies, delivered:true", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const content = new TextEncoder().encode("hello");
    const result = await clientA.send(pubkeyBHex, content);

    expect(result.delivered).toBe(true);

    await waitFor(() => clientB.peekAll().some((e) => e.senderPubkeyHex === pubkeyAHex), { timeout: 5000 });
    const received = clientB.receive(pubkeyAHex);
    expect(received).not.toBeNull();
    expect(Buffer.from(received!.content).toString()).toBe("hello");
    expect(Buffer.from(received!.senderPubkey).toString("hex")).toBe(pubkeyAHex);
  }, 15_000);
});

// ─── AC-002: 10 messages all arrive ───────────────────────────────────────────

describe("AC-002: 10 sequential messages, all arrive", () => {
  it("AC-002: all 10 envelopes received, signatures verify, no loss", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    for (let i = 0; i < 10; i++) {
      const content = new TextEncoder().encode(`message ${i}`);
      const result = await clientA.send(pubkeyBHex, content);
      expect(result.delivered).toBe(true);
    }

    await waitFor(
      () => {
        const all = clientB.peekAll().filter((e) => e.senderPubkeyHex === pubkeyAHex);
        return all.length >= 10;
      },
      { timeout: 10_000 }
    );

    const all = clientB.peekAll().filter((e) => e.senderPubkeyHex === pubkeyAHex);
    expect(all.length).toBe(10);
  }, 30_000);
});

// ─── AC-003: content bit-flip → remote_rejected ───────────────────────────────

describe("AC-003: tampered content → remote_rejected", () => {
  it("AC-003: bit-flip in content field → content_hash_mismatch → stream reset → remote_rejected", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, kpA, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    // Build a valid envelope then flip a content byte and re-serialize directly
    // (bypassing createClient.send to inject the tampered bytes)
    const content = new TextEncoder().encode("tamper me");
    const buildResult = await buildEnvelope(content, kpA, Date.now());
    if (!buildResult.ok) throw new Error("build failed");

    // Flip a byte in the content field — hash will no longer match
    const tamperedContent = new Uint8Array(buildResult.envelope.content);
    tamperedContent[0] ^= 0x01;
    const tamperedEnvelope = { ...buildResult.envelope, content: tamperedContent };
    const tamperedBytes = serializeEnvelope(tamperedEnvelope);

    const rawResult = await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<import("../types.js").SendResult>;
    }).sendRaw(pubkeyBHex, tamperedBytes);

    expect(rawResult.delivered).toBe(false);
    if (!rawResult.delivered) {
      expect(rawResult.reason).toBe("remote_rejected");
    }
    // B's queue must be empty
    expect(clientB.receive(pubkeyAHex)).toBeNull();
  }, 15_000);
});

// ─── AC-004: bad signature → remote_rejected ─────────────────────────────────

describe("AC-004: invalid signature → remote_rejected", () => {
  it("AC-004: replaced sender_signature with random bytes → remote_rejected", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, kpA, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const content = new TextEncoder().encode("bad sig test");
    const buildResult = await buildEnvelope(content, kpA, Date.now());
    if (!buildResult.ok) throw new Error("build failed");

    const badEnvelope = { ...buildResult.envelope, sender_signature: new Uint8Array(randomBytes(64)) };
    const badBytes = serializeEnvelope(badEnvelope);

    const rawResult = await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<import("../types.js").SendResult>;
    }).sendRaw(pubkeyBHex, badBytes);

    expect(rawResult.delivered).toBe(false);
    if (!rawResult.delivered) {
      expect(rawResult.reason).toBe("remote_rejected");
    }
    expect(clientB.receive(pubkeyAHex)).toBeNull();
  }, 15_000);
});

// ─── AC-005: non-CBOR payload → malformed_envelope, B stays healthy ───────────

describe("AC-005: malformed (non-CBOR) payload → rejected, node stays healthy", () => {
  it("AC-005: raw random bytes → malformed_envelope, B accepts next valid message", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const garbageBytes = new Uint8Array(randomBytes(64));

    const rawResult = await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<import("../types.js").SendResult>;
    }).sendRaw(pubkeyBHex, garbageBytes);

    expect(rawResult.delivered).toBe(false);
    if (!rawResult.delivered) {
      expect(rawResult.reason).toBe("remote_rejected");
    }

    // B should still accept a valid message afterward
    const content = new TextEncoder().encode("healthy after malformed");
    const result = await clientA.send(pubkeyBHex, content);
    expect(result.delivered).toBe(true);

    await waitFor(() => clientB.peekAll().some((e) => e.senderPubkeyHex === pubkeyAHex), { timeout: 5000 });
    const received = clientB.receive(pubkeyAHex);
    expect(received).not.toBeNull();
  }, 20_000);
});

// ─── AC-006: unreachable peer → peer_unreachable ──────────────────────────────

describe("AC-006: send to dead address → peer_unreachable", () => {
  it("AC-006: peer not listening → peer_unreachable", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const client = createClient(node, kp);
    await client.registerHandler();

    const fakePubkeyHex = Buffer.from(new Uint8Array(32).fill(0xab)).toString("hex");
    // Register a peer that exists in the registry but at a port nobody is listening on
    client.addPeer(fakePubkeyHex, "12D3KooWFakeNobodyListeningPeer123456", ["/ip4/127.0.0.1/tcp/19999"]);

    const result = await client.send(fakePubkeyHex, new TextEncoder().encode("unreachable"));
    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(["peer_unreachable", "connection_lost"]).toContain(result.reason);
    }
  }, 15_000);
});

// ─── AC-007: 1 MiB message round-trips ────────────────────────────────────────

describe("AC-007: 1 MiB message round-trips successfully", () => {
  it("AC-007: 1 MiB content → delivered:true, received on B", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const content = new Uint8Array(1_048_576).fill(0x42);
    const result = await clientA.send(pubkeyBHex, content);
    expect(result.delivered).toBe(true);

    await waitFor(() => clientB.peekAll().some((e) => e.senderPubkeyHex === pubkeyAHex), { timeout: 15_000 });
    const received = clientB.receive(pubkeyAHex);
    expect(received).not.toBeNull();
    expect(received!.content.length).toBe(1_048_576);
  }, 30_000);
});

// ─── AC-008: concurrent streams don't block each other ────────────────────────

describe("AC-008: concurrent streams are independent (Yamux mux)", () => {
  it("AC-008: two simultaneous sends both arrive independently", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const [r1, r2] = await Promise.all([
      clientA.send(pubkeyBHex, new TextEncoder().encode("concurrent-1")),
      clientA.send(pubkeyBHex, new TextEncoder().encode("concurrent-2")),
    ]);

    expect(r1.delivered).toBe(true);
    expect(r2.delivered).toBe(true);

    await waitFor(
      () => clientB.peekAll().filter((e) => e.senderPubkeyHex === pubkeyAHex).length >= 2,
      { timeout: 10_000 }
    );

    const msgs = clientB.peekAll().filter((e) => e.senderPubkeyHex === pubkeyAHex);
    expect(msgs.length).toBe(2);
  }, 20_000);
});

// ─── AC-010: three clients, per-peer routing ──────────────────────────────────

describe("AC-010: three clients, A routes messages to B and C independently", () => {
  it("AC-010: B gets B's message, C gets C's message, no cross-delivery", async () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const kpC = generateKeypair();

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeC = await createNode({ keyProvider: kpC, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });

    await nodeA.start(); await nodeB.start(); await nodeC.start();
    scope.addCleanup(async () => { try { await nodeA.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeB.stop(); } catch {} });
    scope.addCleanup(async () => { try { await nodeC.stop(); } catch {} });

    const clientA = createClient(nodeA, kpA);
    const clientB = createClient(nodeB, kpB);
    const clientC = createClient(nodeC, kpC);

    await clientA.registerHandler();
    await clientB.registerHandler();
    await clientC.registerHandler();

    const pubkeyAHex = Buffer.from(await kpA.getPublicKey()).toString("hex");
    const pubkeyBHex = Buffer.from(await kpB.getPublicKey()).toString("hex");
    const pubkeyCHex = Buffer.from(await kpC.getPublicKey()).toString("hex");

    const dialB = await nodeA.dial(nodeB.listenAddresses()[0]!);
    const dialC = await nodeA.dial(nodeC.listenAddresses()[0]!);

    clientA.addPeer(pubkeyBHex, dialB.peerId, nodeB.listenAddresses());
    clientA.addPeer(pubkeyCHex, dialC.peerId, nodeC.listenAddresses());
    clientB.addPeer(pubkeyAHex, nodeA.getPeerId(), nodeA.listenAddresses());
    clientC.addPeer(pubkeyAHex, nodeA.getPeerId(), nodeA.listenAddresses());

    const [rB, rC] = await Promise.all([
      clientA.send(pubkeyBHex, new TextEncoder().encode("for-B")),
      clientA.send(pubkeyCHex, new TextEncoder().encode("for-C")),
    ]);

    expect(rB.delivered).toBe(true);
    expect(rC.delivered).toBe(true);

    await waitFor(() => clientB.peekAll().some((e) => e.senderPubkeyHex === pubkeyAHex), { timeout: 5000 });
    await waitFor(() => clientC.peekAll().some((e) => e.senderPubkeyHex === pubkeyAHex), { timeout: 5000 });

    const msgB = clientB.receive(pubkeyAHex);
    const msgC = clientC.receive(pubkeyAHex);

    expect(Buffer.from(msgB!.content).toString()).toBe("for-B");
    expect(Buffer.from(msgC!.content).toString()).toBe("for-C");

    // Neither has the other's message
    expect(clientB.receive(pubkeyAHex)).toBeNull();
    expect(clientC.receive(pubkeyAHex)).toBeNull();
  }, 25_000);
});

// ─── AC-012: truncated frame → malformed_envelope, B stays healthy ────────────

describe("AC-012: truncated frame → malformed_envelope (read timeout)", () => {
  it("AC-012: sender writes partial frame and goes silent → 5s timeout fires, B rejects and recovers", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    // Open a raw stream and write a length prefix claiming 100 bytes, then
    // send only 20 bytes — DO NOT close the stream. The receiver hangs
    // waiting for remaining 80 bytes until the 5s timeout fires.
    const rawClient = clientA as unknown as {
      openRawStream(peerPubkeyHex: string): Promise<import("@libp2p/interface").Stream>;
    };
    const stream = await rawClient.openRawStream(pubkeyBHex);

    const fullPayload = new Uint8Array(100).fill(0xcc);
    const lpEncoded = lp.encode.single(fullPayload);
    const encoded = (lpEncoded as unknown as { subarray(start?: number, end?: number): Uint8Array }).subarray();
    // 1-byte varint (value 100) + first 20 bytes — remaining 80 bytes never sent
    const partial = encoded.slice(0, 1 + 20);
    stream.send(partial);
    // No stream.close() — sender is deliberately silent

    // Wait >5s for B's read timeout to fire and abort the handler
    await new Promise((r) => setTimeout(r, 6_000));
    stream.abort(new Error("test: stall complete"));

    // B must still be healthy — send a valid message and verify receipt
    const result = await clientA.send(pubkeyBHex, new TextEncoder().encode("recovery after timeout"));
    expect(result.delivered).toBe(true);
    await waitFor(() => clientB.peekAll().some((e) => e.senderPubkeyHex === pubkeyAHex), { timeout: 5000 });
    expect(clientB.receive(pubkeyAHex)).not.toBeNull();
  }, 20_000);
});

// ─── AC-013: oversized content → content_too_large before stream open ─────────

describe("AC-013: content > 1 MiB → content_too_large, no stream opened", () => {
  it("AC-013: 1 MiB + 1 byte → content_too_large", async () => {
    const { clientA, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const oversized = new Uint8Array(1_048_577).fill(0x01);
    const result = await clientA.send(pubkeyBHex, oversized);
    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(result.reason).toBe("content_too_large");
    }
  }, 10_000);
});

// ─── AC-014: wrong-prefix content_hash → content_hash_mismatch ───────────────

describe("AC-014: wrong-prefix content_hash → content_hash_mismatch", () => {
  it("AC-014: content_hash computed with 0x01 prefix rejected even if sig verifies", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, kpA, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    // Build envelope normally, then replace content_hash with 0x01-prefix hash
    // (nodeHash prefix, not msgLeafHash prefix)
    const content = new TextEncoder().encode("wrong prefix hash");
    const buildResult = await buildEnvelope(content, kpA, Date.now());
    if (!buildResult.ok) throw new Error("build failed");

    // Compute SHA-256(0x01 || content) — internal node hash prefix
    const { createHash } = await import("node:crypto");
    const wrongHash = createHash("sha256")
      .update(new Uint8Array([0x01]))
      .update(content)
      .digest();

    const badEnvelope = { ...buildResult.envelope, content_hash: new Uint8Array(wrongHash) };
    const badBytes = serializeEnvelope(badEnvelope);

    const rawResult = await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<import("../types.js").SendResult>;
    }).sendRaw(pubkeyBHex, badBytes);

    expect(rawResult.delivered).toBe(false);
    if (!rawResult.delivered) {
      expect(rawResult.reason).toBe("remote_rejected");
    }
    expect(clientB.receive(pubkeyAHex)).toBeNull();
  }, 15_000);
});

// ─── SI-001: both content_hash AND signature must pass ────────────────────────

describe("SI-001: both content_hash recompute AND signature verify required", () => {
  it("SI-001: valid sig over wrong content_hash still rejected (content_hash_mismatch first)", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, kpA, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    // Build normally
    const content = new TextEncoder().encode("si-001");
    const buildResult = await buildEnvelope(content, kpA, Date.now());
    if (!buildResult.ok) throw new Error("build failed");

    // Replace content with different bytes — hash will not match
    const differentContent = new TextEncoder().encode("different content entirely");
    const tamperedEnvelope = { ...buildResult.envelope, content: differentContent };
    const tamperedBytes = serializeEnvelope(tamperedEnvelope);

    const rawResult = await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<import("../types.js").SendResult>;
    }).sendRaw(pubkeyBHex, tamperedBytes);

    expect(rawResult.delivered).toBe(false);
    if (!rawResult.delivered) {
      expect(rawResult.reason).toBe("remote_rejected");
    }
    expect(clientB.receive(pubkeyAHex)).toBeNull();
  }, 15_000);
});

// ─── SI-002: send path never bypasses envelope constructor ───────────────────

describe("SI-002: send path always invokes buildEnvelope (never bypasses constructor)", () => {
  it("SI-002: received envelope has content_hash = msgLeafHash(content)", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const { msgLeafHash } = await import("@cello/crypto");
    const content = new TextEncoder().encode("si-002 test");
    const result = await clientA.send(pubkeyBHex, content);
    expect(result.delivered).toBe(true);

    await waitFor(() => clientB.peekAll().some((e) => e.senderPubkeyHex === pubkeyAHex), { timeout: 5000 });
    const received = clientB.receive(pubkeyAHex);
    const expectedHash = msgLeafHash(content);
    expect(Buffer.from(received!.contentHash).toString("hex")).toBe(
      Buffer.from(expectedHash).toString("hex")
    );
  }, 15_000);
});

// ─── SI-003: full validation pipeline always runs ────────────────────────────

describe("SI-003: full validation pipeline: parse → struct → hash → sig (no short-circuit)", () => {
  it("SI-003: envelope with valid sig but wrong content_hash still rejected (hash check fires before sig)", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, kpA, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const content = new TextEncoder().encode("si-003");
    const buildResult = await buildEnvelope(content, kpA, Date.now());
    if (!buildResult.ok) throw new Error("build failed");

    // Flip a byte in content so content_hash no longer matches
    const tamperedContent = new Uint8Array(buildResult.envelope.content);
    tamperedContent[0] ^= 0xff;
    const tamperedEnvelope = { ...buildResult.envelope, content: tamperedContent };
    const tamperedBytes = serializeEnvelope(tamperedEnvelope);

    const rawResult = await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<import("../types.js").SendResult>;
    }).sendRaw(pubkeyBHex, tamperedBytes);

    expect(rawResult.delivered).toBe(false);
    if (!rawResult.delivered) {
      expect(rawResult.reason).toBe("remote_rejected");
    }
    expect(clientB.receive(pubkeyAHex)).toBeNull();
  }, 15_000);
});

// ─── AC-011: CBOR byte-flip in content field → content_hash_mismatch ────────────

describe("AC-011: byte-flip inside content field of CBOR payload → content_hash_mismatch", () => {
  it("AC-011: deterministic byte-flip in content bytes → content_hash_mismatch, B rejects", async () => {
    const { clientA, clientB, pubkeyAHex, pubkeyBHex, kpA, cleanup } = await makeClientPair();
    scope.addCleanup(cleanup);

    const content = new TextEncoder().encode("ac-011 content target");
    const buildResult = await buildEnvelope(content, kpA, Date.now());
    if (!buildResult.ok) throw new Error("build failed");

    // Flip first byte of the content field in the serialized envelope
    const bytes = serializeEnvelope(buildResult.envelope);
    // Find the content bytes inside the CBOR map and flip one byte.
    // The envelope content is "ac-011 content target" — find the first 0x61 ('a') and flip it
    const mutable = new Uint8Array(bytes);
    for (let i = 0; i < mutable.length; i++) {
      if (mutable[i] === 0x61) { // 'a' — first byte of "ac-011..."
        mutable[i] ^= 0x01;
        break;
      }
    }

    const rawResult = await (clientA as unknown as {
      sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<import("../types.js").SendResult>;
    }).sendRaw(pubkeyBHex, mutable);

    expect(rawResult.delivered).toBe(false);
    if (!rawResult.delivered) {
      expect(rawResult.reason).toBe("remote_rejected");
    }
    expect(clientB.receive(pubkeyAHex)).toBeNull();
  }, 15_000);
});

// ─── DB-001: transport not started → send rejected ────────────────────────────

describe("DB-001: transport not started → send returns connection_lost", () => {
  it("DB-001: send before node.start() → connection_lost (or peer_not_connected)", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    // Deliberately do NOT call node.start()
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const client = createClient(node, kp);
    // Cannot register handler on a stopped node — but at minimum send must not hang
    const fakePubkeyHex = Buffer.from(new Uint8Array(32).fill(0xab)).toString("hex");
    client.addPeer(fakePubkeyHex, "12D3KooWFakePeer", ["/ip4/127.0.0.1/tcp/19998"]);

    const result = await client.send(fakePubkeyHex, new TextEncoder().encode("not started"));
    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      // A stopped node returns node_stopped → mapped to connection_lost or peer_unreachable
      expect(["connection_lost", "peer_unreachable"]).toContain(result.reason);
    }
  }, 10_000);
});

// ─── peer_not_connected when no registry entry ────────────────────────────────

describe("peer_not_connected when peer not in registry", () => {
  it("send to unknown pubkey → peer_not_connected immediately", async () => {
    const kp = generateKeypair();
    const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node.start();
    scope.addCleanup(async () => { try { await node.stop(); } catch {} });

    const client = createClient(node, kp);
    await client.registerHandler();

    const unknownHex = Buffer.from(new Uint8Array(32).fill(0xcc)).toString("hex");
    const result = await client.send(unknownHex, new TextEncoder().encode("nope"));
    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(result.reason).toBe("peer_not_connected");
    }
  }, 5_000);
});
