/**
 * CELLO-M7-SESSION-003 — Relay: session-path liveness authority
 *
 * Specification (SPARC Phase S):
 *
 * AC-001 Integration: the relay tracks per-recipient session-path liveness keyed
 *   by recipient pubkey (the same key as the delivery queue). When B connects
 *   (authenticates its standing relay stream) the relay records 'alive' and emits
 *   session.liveness.changed at INFO; when B's connection closes the relay records
 *   'gone' and emits session.liveness.changed at WARN. Both carry
 *   counterpartyPubkey and transportPath:'relay', observedBy:'relay'. Verified
 *   over real in-process libp2p nodes through a real relay stream — no stub that
 *   bypasses the peer-event wiring.
 *
 * AC-002 Integration: a session_liveness_query over a real relay stream returns a
 *   session_liveness_response with liveness 'alive' while B is connected, 'gone'
 *   after B disconnects, and 'unknown' for a never-tracked recipient. The relay
 *   never fabricates 'gone' from a missing entry. L7-guard: travels over a real
 *   stream, not an internal method call.
 *
 * AC-003 Integration: after B is marked 'gone', a reconnect flips B back to
 *   'alive' — 'gone' is not sticky across a genuine reconnect.
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
import { createHash, randomBytes } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import type { Logger } from "@cello-protocol/interfaces";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
import { InMemoryRelayStore } from "../relay-store.js";
import type { SessionAssignment } from "../relay-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

interface LogEntry { level: string; event: string; ctx: Record<string, unknown> }

function makeCapturingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const mk = (level: string) => (event: string, ctx?: Record<string, unknown>) =>
    entries.push({ level, event, ctx: ctx ?? {} });
  return {
    entries,
    logger: { debug: mk("debug"), info: mk("info"), warn: mk("warn"), error: mk("error") },
  };
}

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readFrame(): Promise<Uint8Array> {
    const { value, done } = await this.#iter.next();
    if (done || value === undefined) throw new Error("stream ended without yielding a frame");
    const v = value as unknown;
    if (v instanceof Uint8Array) return v;
    if (typeof (v as { slice?: () => Uint8Array }).slice === "function") {
      return (v as { slice(): Uint8Array }).slice();
    }
    return new Uint8Array(v as ArrayBuffer);
  }
  async readDecoded(): Promise<Record<string, unknown>> {
    return decode(await this.readFrame()) as Record<string, unknown>;
  }
  async readDecodedWithTimeout(ms: number): Promise<Record<string, unknown>> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`readDecodedWithTimeout: no frame in ${ms}ms`)), ms),
    );
    return Promise.race([this.readDecoded(), timeout]);
  }
  /**
   * Read decoded frames until one of the given type arrives, skipping unrelated
   * control frames (e.g. session_interrupted, which the relay also emits to the
   * remaining participant when a peer drops — SESSION-001).
   */
  async readUntilType(type: string, ms: number): Promise<Record<string, unknown>> {
    const deadline = Date.now() + ms;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`readUntilType: no '${type}' frame in ${ms}ms`);
      const frame = await this.readDecodedWithTimeout(remaining);
      if (frame["type"] === type) return frame;
    }
  }
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

async function performAuth(reader: StreamReader, stream: Stream, kp: ReturnType<typeof generateKeypair>): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = challenge["nonce"] instanceof Uint8Array
    ? challenge["nonce"]
    : new Uint8Array(challenge["nonce"] as ArrayBuffer);
  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from("CELLO-RELAY-AUTH-v1", "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));
  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") throw new Error(`relay_auth_failed: ${String(ack["reason"])}`);
  expect(ack["type"]).toBe("relay_auth_ok");
}

async function makeAssignment(sessionId: Uint8Array, pubA: Uint8Array, pubB: Uint8Array, dirKp: ReturnType<typeof generateKeypair>): Promise<SessionAssignment> {
  const session_timestamp = Date.now();
  const tbs = CBOR_ENC.encode([sessionId, pubA, pubB, session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp]) as Uint8Array;
  const directory_signature = await dirKp.sign(tbs);
  return { session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp, directory_signature };
}

async function makeFixture() {
  const dirKp = generateKeypair();
  const dirPubkey = await dirKp.getPublicKey();
  const store = new InMemoryRelayStore();
  const cap = makeCapturingLogger();
  const { relay, node, stop } = await createRelayNode({ directoryPubkey: dirPubkey, store, logger: cap.logger });
  const addrs = node.listenAddresses();
  expect(addrs.length).toBeGreaterThan(0);
  return { relayAddr: addrs[0]!, relay, relayNode: node, relayStop: stop, dirKp, store, entries: cap.entries };
}

async function makeClient(relayAddr: string) {
  const kp = generateKeypair();
  const pubkey = await kp.getPublicKey();
  const node = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await node.start();
  await node.dial(relayAddr);
  return { kp, pubkey, node };
}

async function openStream(clientNode: Awaited<ReturnType<typeof createNode>>, relayPeerId: string) {
  const stream = await clientNode.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  return { stream, reader: new StreamReader(stream) };
}

async function waitUntil(fn: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitUntil: condition not met in time");
}

describe("AC-001: relay tracks session-path liveness alive→gone with events", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("records 'alive' on connect (INFO) then 'gone' on disconnect (WARN), keyed by pubkey", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);
    const cB = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cB.node.stop().catch(() => {}); });

    const pubkeyHex = Buffer.from(cB.pubkey).toString("hex");
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rB, sB, cB.kp);

    // alive recorded + INFO event
    await waitUntil(() => fix.store.getRecipientLiveness(pubkeyHex).liveness === "alive", 3000);
    expect(fix.store.getRecipientLiveness(pubkeyHex).liveness).toBe("alive");
    const aliveEvt = fix.entries.find((e) => e.event === "session.liveness.changed" && e.ctx["liveness"] === "alive");
    expect(aliveEvt).toBeDefined();
    expect(aliveEvt!.level).toBe("info");
    expect(aliveEvt!.ctx["transportPath"]).toBe("relay");
    expect(aliveEvt!.ctx["observedBy"]).toBe("relay");
    expect(aliveEvt!.ctx["counterpartyPubkey"]).toBeDefined();

    // disconnect → gone + WARN event
    sB.abort(new Error("test_disconnect"));
    await waitUntil(() => fix.store.getRecipientLiveness(pubkeyHex).liveness === "gone", 3000);
    expect(fix.store.getRecipientLiveness(pubkeyHex).liveness).toBe("gone");
    const goneEvt = fix.entries.find((e) => e.event === "session.liveness.changed" && e.ctx["liveness"] === "gone");
    expect(goneEvt).toBeDefined();
    expect(goneEvt!.level).toBe("warn");
    expect(goneEvt!.ctx["observedBy"]).toBe("relay");
  });
});

describe("AC-002: session_liveness_query over a real relay stream", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("returns alive while B connected, gone after disconnect, unknown when untracked", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);
    const cA = await makeClient(fix.relayAddr);
    const cB = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cA.node.stop().catch(() => {}); });
    scope.addCleanup(async () => { await cB.node.stop().catch(() => {}); });

    const sessionId = new Uint8Array(randomBytes(16));
    fix.relay.recordAssignment(await makeAssignment(sessionId, cA.pubkey, cB.pubkey, fix.dirKp));

    const { stream: sA, reader: rA } = await openStream(cA.node, fix.relayNode.getPeerId());
    const { stream: sB, reader: rB } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rA, sA, cA.kp);
    await performAuth(rB, sB, cB.kp);

    const queryFor = (pub: Uint8Array) =>
      CBOR_ENC.encode({ type: "session_liveness_query", session_id: sessionId, counterparty_pubkey: pub }) as Uint8Array;

    // B alive
    await waitUntil(() => fix.store.getRecipientLiveness(Buffer.from(cB.pubkey).toString("hex")).liveness === "alive", 3000);
    sendFrame(sA, queryFor(cB.pubkey));
    const resp1 = await rA.readDecodedWithTimeout(3000);
    expect(resp1["type"]).toBe("session_liveness_response");
    expect(resp1["liveness"]).toBe("alive");
    expect(Buffer.from(resp1["session_id"] as Uint8Array)).toEqual(Buffer.from(sessionId));

    // unknown recipient (never tracked)
    sendFrame(sA, queryFor(new Uint8Array(32).fill(123)));
    const respU = await rA.readDecodedWithTimeout(3000);
    expect(respU["liveness"]).toBe("unknown");

    // B disconnects → gone
    sB.abort(new Error("test_disconnect"));
    await waitUntil(() => fix.store.getRecipientLiveness(Buffer.from(cB.pubkey).toString("hex")).liveness === "gone", 3000);
    sendFrame(sA, queryFor(cB.pubkey));
    // A may receive a session_interrupted control frame from B's drop first — skip to the response.
    const resp2 = await rA.readUntilType("session_liveness_response", 3000);
    expect(resp2["liveness"]).toBe("gone");

    sA.close().catch(() => {});
  });
});

describe("AC-003: 'gone' is not sticky across a genuine reconnect", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("flips B back to 'alive' on reconnect", async () => {
    const fix = await makeFixture();
    scope.addCleanup(fix.relayStop);
    const cB = await makeClient(fix.relayAddr);
    scope.addCleanup(async () => { await cB.node.stop().catch(() => {}); });

    const pubkeyHex = Buffer.from(cB.pubkey).toString("hex");
    const { stream: sB1, reader: rB1 } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rB1, sB1, cB.kp);
    await waitUntil(() => fix.store.getRecipientLiveness(pubkeyHex).liveness === "alive", 3000);

    sB1.abort(new Error("test_disconnect"));
    await waitUntil(() => fix.store.getRecipientLiveness(pubkeyHex).liveness === "gone", 3000);

    // reconnect on a fresh stream (same pubkey)
    const { stream: sB2, reader: rB2 } = await openStream(cB.node, fix.relayNode.getPeerId());
    await performAuth(rB2, sB2, cB.kp);
    await waitUntil(() => fix.store.getRecipientLiveness(pubkeyHex).liveness === "alive", 3000);
    expect(fix.store.getRecipientLiveness(pubkeyHex).liveness).toBe("alive");

    sB2.close().catch(() => {});
  });
});

describe("relay-store liveness unit semantics (AC-001/002/003 store layer)", () => {
  it("alive→gone→alive transitions and unknown for untracked", () => {
    const store = new InMemoryRelayStore();
    const pub = "ab".repeat(32);
    expect(store.getRecipientLiveness(pub).liveness).toBe("unknown");
    expect(store.recordRecipientAlive(pub).changed).toBe(true);
    expect(store.getRecipientLiveness(pub).liveness).toBe("alive");
    expect(store.recordRecipientAlive(pub).changed).toBe(false); // already alive
    expect(store.recordRecipientGone(pub).changed).toBe(true);
    expect(store.getRecipientLiveness(pub).liveness).toBe("gone");
    expect(store.recordRecipientAlive(pub).changed).toBe(true); // reconnect flip
    expect(store.getRecipientLiveness(pub).liveness).toBe("alive");
  });

  it("recordRecipientGone never fabricates an entry for an untracked recipient", () => {
    const store = new InMemoryRelayStore();
    const pub = "cd".repeat(32);
    expect(store.recordRecipientGone(pub).changed).toBe(false);
    expect(store.getRecipientLiveness(pub).liveness).toBe("unknown");
  });
});
