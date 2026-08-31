/**
 * CELLO-M7-MSG-001 — relay content-park protocol (AC-006/AC-008 over real streams).
 *
 * Deposit → pull → confirm (delete-on-pickup) and notify-on-reconnect, exercised
 * over real in-process libp2p streams against a relay node constructed by
 * createRelayNode with a ContentStore wired through the composition root.
 *
 * I1 (review round 1): pull and confirm require a challenge-response auth proving
 * ownership of the recipient identity key. These tests perform the handshake; a
 * dedicated test asserts an UNAUTHENTICATED / wrong-key pull is rejected.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import type { Stream } from "@libp2p/interface";
import { generateKeypair } from "@cello-protocol/crypto";
import type { KeyProvider } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import { InMemoryContentStore } from "@cello-protocol/interfaces/stubs";
import type { Logger } from "@cello-protocol/interfaces";
import { createRelayNode } from "../relay-node.js";
import { FileContentStore } from "../adapters/file-content-store.js";
import { FileVouchedKeyStore } from "../adapters/file-vouched-keys.js";
import { CONTENT_PARK_PROTOCOL_ID, buildContentParkAuthMsg } from "../content-park.js";

const ENC = new Encoder({ tagUint8Array: false });

function captureLogger(): { logger: Logger; events: Array<{ name: string; ctx?: unknown }> } {
  const events: Array<{ name: string; ctx?: unknown }> = [];
  const logger: Logger = {
    debug: (name, ctx) => events.push({ name, ctx }),
    info: (name, ctx) => events.push({ name, ctx }),
    warn: (name, ctx) => events.push({ name, ctx }),
    error: (name, ctx) => events.push({ name, ctx }),
  };
  return { logger, events };
}

function toU8(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  const c = chunk as { subarray?: () => Uint8Array };
  return typeof c?.subarray === "function" ? c.subarray() : new Uint8Array(chunk as ArrayBufferLike);
}

/** A persistent length-prefixed frame reader over a single stream. */
function frameReader(stream: Stream): () => Promise<Record<string, unknown> | null> {
  const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  return async () => {
    const res = await iter.next();
    if (res.done || res.value === undefined) return null;
    return decode(toU8(res.value)) as Record<string, unknown>;
  };
}

function send(stream: Stream, frame: Record<string, unknown>): void {
  stream.send(lp.encode.single(ENC.encode(frame) as Uint8Array));
}

/**
 * DOD-M15-RELAYAUTH-1: pull/confirm now also require the caller be VOUCHED — named by at least
 * one directory-signed assignment the relay has recorded — on top of I1's existing proof of key
 * ownership. Records one in-process, mirroring what a real client_record_assignment produces.
 */
async function vouch(
  relay: Awaited<ReturnType<typeof createRelayNode>>["relay"],
  dirKp: KeyProvider,
  recipientPub: Uint8Array,
): Promise<void> {
  const sessionId = new Uint8Array(randomBytes(16));
  const otherPub = await generateKeypair().getPublicKey();
  const sessionTimestamp = Date.now();
  const ts = sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp;
  const tbs = ENC.encode([sessionId, recipientPub, otherPub, ts]) as Uint8Array;
  const directory_signature = await dirKp.sign(tbs);
  const result = relay.recordAssignment({
    session_id: sessionId,
    participant_a: recipientPub,
    participant_b: otherPub,
    session_timestamp: sessionTimestamp,
    directory_signature,
  });
  if (!result.ok) throw new Error(`test setup: vouch() failed to record assignment: ${result.reason}`);
}

/** Perform the content-park auth handshake on `stream` (after the initial request frame). */
async function authHandshake(
  stream: Stream,
  read: () => Promise<Record<string, unknown> | null>,
  kp: KeyProvider,
  recipientPub: Uint8Array,
): Promise<void> {
  const challenge = await read();
  if (!challenge || challenge["type"] !== "content_park_auth_challenge") {
    throw new Error(`expected content_park_auth_challenge, got ${String(challenge?.["type"])}`);
  }
  const nonce = toU8(challenge["nonce"]);
  const authMsg = buildContentParkAuthMsg(nonce, recipientPub);
  const signature = await kp.sign(authMsg);
  send(stream, { type: "content_park_auth_response", signature });
}

describe("relay content-park protocol (MSG-001)", () => {
  it("deposit → pull → confirm round-trips over real streams and delete-on-pickup removes the entry", async () => {
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const { relay, node: relayNode, stop } = await createRelayNode({ directoryPubkey: dirPubkey, contentStore: store, logger });
    try {
      const relayAddr = relayNode.listenAddresses()[0]!;

      const recipientKp = generateKeypair();
      const recipientPub = await recipientKp.getPublicKey();
      const rHex = Buffer.from(recipientPub).toString("hex");
      const ciphertext = new Uint8Array(randomBytes(64));
      const plaintextLike = new Uint8Array([1, 2, 3]);
      const contentHash = new Uint8Array(createHash("sha256").update(Buffer.from(plaintextLike)).digest());
      const sessionId = new Uint8Array(randomBytes(16));
      // DOD-M15-RELAYAUTH-1: pull/confirm now also require the recipient be a vouched participant.
      await vouch(relay, dirKp, recipientPub);

      // Sender deposits encrypted content (deposit is open by design).
      const senderNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await senderNode.start();
      await senderNode.dial(relayAddr);
      const depositStream = await senderNode.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const depositRead = frameReader(depositStream);
      send(depositStream, {
        type: "content_park_deposit",
        recipient_pubkey: recipientPub,
        content_hash: contentHash,
        session_id: sessionId,
        ciphertext,
      });
      const depositAck = await depositRead();
      expect(depositAck?.["type"]).toBe("content_park_deposit_ack");
      expect(depositAck?.["ok"]).toBe(true);
      expect(await store.hasContent(rHex)).toBe(true);

      // Recipient pulls (with auth handshake).
      const recipientNode = await createNode({ keyProvider: recipientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await recipientNode.start();
      await recipientNode.dial(relayAddr);
      const pullStream = await recipientNode.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const pullRead = frameReader(pullStream);
      send(pullStream, { type: "content_park_pull_request", recipient_pubkey: recipientPub });
      await authHandshake(pullStream, pullRead, recipientKp, recipientPub);
      const countFrame = await pullRead();
      const entryFrame = await pullRead();
      expect(countFrame?.["type"]).toBe("content_park_pull_count");
      expect(countFrame?.["count"]).toBe(1);
      expect(entryFrame?.["found"]).toBe(true);
      // SI-001: the relay served ciphertext, byte-identical to what was deposited.
      expect(Buffer.from(toU8(entryFrame!["ciphertext"]))).toEqual(Buffer.from(ciphertext));

      // Recipient confirms pickup (delete-on-pickup, with auth handshake).
      const confirmStream = await recipientNode.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const confirmRead = frameReader(confirmStream);
      send(confirmStream, { type: "content_park_confirm", recipient_pubkey: recipientPub, content_hash: contentHash });
      await authHandshake(confirmStream, confirmRead, recipientKp, recipientPub);
      const confirmAck = await confirmRead();
      expect(confirmAck?.["type"]).toBe("content_park_confirm_ack");
      expect(confirmAck?.["ok"]).toBe(true);
      expect(await store.hasContent(rHex)).toBe(false);

      await senderNode.stop();
      await recipientNode.stop();
    } finally {
      await stop();
    }
  }, 30_000);

  it("pull on an empty recipient returns found:false (recovery → never parked)", async () => {
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    const dirKp = generateKeypair();
    const { relay, node: relayNode, stop } = await createRelayNode({ directoryPubkey: await dirKp.getPublicKey(), contentStore: store, logger });
    try {
      const relayAddr = relayNode.listenAddresses()[0]!;
      const recipientKp = generateKeypair();
      const recipientPub = await recipientKp.getPublicKey();
      // DOD-M15-RELAYAUTH-1: pull now also requires the recipient be a vouched participant.
      await vouch(relay, dirKp, recipientPub);
      const node = await createNode({ keyProvider: recipientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await node.start();
      await node.dial(relayAddr);
      const s = await node.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const read = frameReader(s);
      send(s, { type: "content_park_pull_request", recipient_pubkey: recipientPub });
      await authHandshake(s, read, recipientKp, recipientPub);
      const countFrame = await read();
      const entryFrame = await read();
      expect(countFrame?.["type"]).toBe("content_park_pull_count");
      expect(entryFrame?.["found"]).toBe(false);
      await node.stop();
    } finally {
      await stop();
    }
  }, 30_000);

  it("DOD-M15-RELAYAUTH-1: pull is REFUSED for a key that owns itself but was never vouched by an assignment", async () => {
    /**
     * The gap this order closes: I1 already proves the caller OWNS `recipientPubkey`. That is a
     * different claim from "this key is a real relay participant" — a bare, never-registered
     * keypair could otherwise still collect mail addressed to itself. No `vouch()` call here,
     * deliberately — the recipient below proves ownership perfectly and must still be refused.
     */
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({ directoryPubkey: await dirKp.getPublicKey(), contentStore: store, logger });
    try {
      const relayAddr = relayNode.listenAddresses()[0]!;
      const recipientKp = generateKeypair();
      const recipientPub = await recipientKp.getPublicKey();
      const rHex = Buffer.from(recipientPub).toString("hex");
      const contentHash = new Uint8Array(createHash("sha256").update(Buffer.from([7])).digest());
      await store.deposit({
        recipientPubkey: recipientPub,
        contentHash,
        sessionId: new Uint8Array(randomBytes(16)),
        ciphertext: new Uint8Array(randomBytes(48)),
        depositedAt: Date.now(),
      });

      const node = await createNode({ keyProvider: recipientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await node.start();
      await node.dial(relayAddr);
      const pullStream = await node.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const pullRead = frameReader(pullStream);
      send(pullStream, { type: "content_park_pull_request", recipient_pubkey: recipientPub });
      await authHandshake(pullStream, pullRead, recipientKp, recipientPub); // proves ownership — legitimately
      const pullVerdict = await pullRead();
      expect(pullVerdict?.["type"]).toBe("content_park_pull_refused");
      expect(pullVerdict?.["reason"]).toBe("not_a_participant");
      // The entry survives — refused, not served and not deleted.
      expect(await store.hasContent(rHex)).toBe(true);

      const confirmStream = await node.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const confirmRead = frameReader(confirmStream);
      send(confirmStream, { type: "content_park_confirm", recipient_pubkey: recipientPub, content_hash: contentHash });
      await authHandshake(confirmStream, confirmRead, recipientKp, recipientPub);
      const confirmVerdict = await confirmRead();
      expect(confirmVerdict?.["type"]).toBe("content_park_confirm_ack");
      expect(confirmVerdict?.["ok"]).toBe(false);
      expect(confirmVerdict?.["reason"]).toBe("not_a_participant");
      expect(await store.hasContent(rHex), "confirm must not delete-on-pickup for an unvouched caller").toBe(true);

      await node.stop();
    } finally {
      await stop();
    }
  }, 30_000);

  it("★★★ review H2: parked mail is STILL COLLECTABLE after the relay restarts", async () => {
    /**
     * The flip side of the refusal above, and the more expensive one. Vouching lived only in the
     * relay process; the content store lives on disk. So: park mail for an agent, roll the relay —
     * a deploy, a MIG roll, a crash — and on reconnect the agent is TOLD content is waiting and
     * then REFUSED when it asks for it, because the vouched set came up empty and a client does not
     * re-present its assignment on reconnect. The mail sat there uncollectable until some unrelated
     * new session happened to be brokered on that same relay.
     *
     * A refusal that breaks availability is worse than the leniency it replaced, so this asserts
     * the whole round trip across a REAL restart: two relay processes, one WAL_DIR, nothing carried
     * over in memory. Both stores must be file-backed for the test to mean anything — an in-memory
     * content store would lose the mail too and the pull would return `found:false` for the wrong
     * reason, passing a test that proves nothing.
     */
    const { logger } = captureLogger();
    const walDir = await mkdtemp(join(tmpdir(), "cello-vouched-"));
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const recipientKp = generateKeypair();
    const recipientPub = await recipientKp.getPublicKey();
    const rHex = Buffer.from(recipientPub).toString("hex");
    const ciphertext = new Uint8Array(randomBytes(64));
    const contentHash = new Uint8Array(createHash("sha256").update(Buffer.from([9, 9, 9])).digest());

    try {
      // ── Relay process #1: the session exists, and mail is parked for the recipient. ──
      const store1 = new FileContentStore({ walDir, logger });
      const first = await createRelayNode({
        directoryPubkey: dirPubkey,
        contentStore: store1,
        vouchedKeyStore: new FileVouchedKeyStore({ walDir, logger }),
        logger,
      });
      await vouch(first.relay, dirKp, recipientPub);
      const senderNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await senderNode.start();
      await senderNode.dial(first.node.listenAddresses()[0]!);
      const depositStream = await senderNode.newStream(first.node.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const depositRead = frameReader(depositStream);
      send(depositStream, {
        type: "content_park_deposit",
        recipient_pubkey: recipientPub,
        content_hash: contentHash,
        session_id: new Uint8Array(randomBytes(16)),
        ciphertext,
      });
      expect((await depositRead())?.["ok"], "precondition: the sender is told the mail was accepted").toBe(true);
      await senderNode.stop();
      await first.stop();

      // ── The roll. Nothing survives but WAL_DIR. ──
      const store2 = new FileContentStore({ walDir, logger });
      const second = await createRelayNode({
        directoryPubkey: dirPubkey,
        contentStore: store2,
        vouchedKeyStore: new FileVouchedKeyStore({ walDir, logger }),
        logger,
      });
      try {
        expect(await store2.hasContent(rHex), "precondition: the mail itself survived the restart").toBe(true);

        const recipientNode = await createNode({ keyProvider: recipientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
        await recipientNode.start();
        await recipientNode.dial(second.node.listenAddresses()[0]!);
        const pullStream = await recipientNode.newStream(second.node.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
        const pullRead = frameReader(pullStream);
        send(pullStream, { type: "content_park_pull_request", recipient_pubkey: recipientPub });
        await authHandshake(pullStream, pullRead, recipientKp, recipientPub);

        // THE ASSERTION: the recipient collects its mail, on a relay that has never met it.
        const countFrame = await pullRead();
        expect(
          countFrame?.["type"],
          "the recipient must be able to collect mail parked before the restart. A refusal here is " +
            "the outage this fix exists to prevent: the relay tells the agent content is waiting and " +
            "then refuses to hand it over, and the message is stranded until an unrelated new session " +
            "happens to be brokered on this same relay.",
        ).toBe("content_park_pull_count");
        expect(countFrame?.["count"]).toBe(1);
        const entryFrame = await pullRead();
        expect(entryFrame?.["found"]).toBe(true);
        expect(Buffer.from(toU8(entryFrame!["ciphertext"]))).toEqual(Buffer.from(ciphertext));

        await recipientNode.stop();
      } finally {
        await second.stop();
      }
    } finally {
      await rm(walDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("I1: an unauthenticated/wrong-key pull is rejected — no metadata is served", async () => {
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({ directoryPubkey: await dirKp.getPublicKey(), contentStore: store, logger });
    try {
      const relayAddr = relayNode.listenAddresses()[0]!;

      const recipientKp = generateKeypair();
      const recipientPub = await recipientKp.getPublicKey();
      const rHex = Buffer.from(recipientPub).toString("hex");
      await store.deposit({
        recipientPubkey: recipientPub,
        contentHash: new Uint8Array(createHash("sha256").update(Buffer.from([9])).digest()),
        sessionId: new Uint8Array(randomBytes(16)),
        ciphertext: new Uint8Array(randomBytes(48)),
        depositedAt: Date.now(),
      });

      // Attacker holds a DIFFERENT key but claims to be the recipient.
      const attackerKp = generateKeypair();
      const node = await createNode({ keyProvider: attackerKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await node.start();
      await node.dial(relayAddr);
      const s = await node.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
      const read = frameReader(s);
      send(s, { type: "content_park_pull_request", recipient_pubkey: recipientPub });
      // Sign the challenge with the WRONG key → relay must reject.
      const challenge = await read();
      expect(challenge?.["type"]).toBe("content_park_auth_challenge");
      const nonce = toU8(challenge!["nonce"]);
      const badSig = await attackerKp.sign(buildContentParkAuthMsg(nonce, recipientPub));
      send(s, { type: "content_park_auth_response", signature: badSig });
      // The relay closes the stream without serving any pull_response.
      const next = await read();
      expect(next).toBeNull();
      // The parked entry survives — the attacker could not delete or read it.
      expect(await store.hasContent(rHex)).toBe(true);
      await node.stop();
    } finally {
      await stop();
    }
  }, 30_000);
});

describe("DOD-M15-RELAYABUSE-1 — the rate limit is WIRED, driven through the real handler", () => {
  /**
   * ⚠️ THIS TEST EXISTS BECAUSE THE UNIT SHIPPED WITHOUT IT AND REVIEW SAID SO PLAINLY.
   *
   * The limiter had six unit tests and **not one of them survived the revert test**: they all
   * construct `DepositRateLimiter` directly and never load `content-park.ts`. Two independent
   * one-line reverts each left all 260 relay tests green —
   *
   *   1. deleting the `if (!limit.allowed)` block, and
   *   2. reverting `(stream, remotePeerId) => …` back to `(stream) => …` in `start()`.
   *
   * The second is the expensive one: `check(undefined)` then takes the deliberate allow-through
   * branch, the limiter becomes a **total no-op**, and every test still passes. A unit that can be
   * silently disabled by a one-word edit, with the gate reporting green, is not protected by its
   * tests — it is accompanied by them.
   *
   * This drives a real in-process libp2p peer against a real relay node, so it pins BOTH halves.
   */
  it("★★★ a peer past its limit is REFUSED over the wire — and a DIFFERENT peer is not", async () => {
    const { logger } = captureLogger();
    const store = new InMemoryContentStore({ logger });
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    // Two per minute, so the loop is short. This is why the config is injectable.
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: dirPubkey,
      contentStore: store,
      logger,
      depositRateLimit: { maxPerWindow: 2, windowMs: 60_000 },
    });
    try {
      const relayAddr = relayNode.listenAddresses()[0]!;
      const recipientPub = await generateKeypair().getPublicKey();
      const sessionId = new Uint8Array(randomBytes(16));

      async function deposit(node: Awaited<ReturnType<typeof createNode>>, tag: number): Promise<Record<string, unknown> | null> {
        const stream = await node.newStream(relayNode.getPeerId(), CONTENT_PARK_PROTOCOL_ID);
        const read = frameReader(stream);
        send(stream, {
          type: "content_park_deposit",
          recipient_pubkey: recipientPub,
          content_hash: new Uint8Array(createHash("sha256").update(Buffer.from([tag])).digest()),
          session_id: sessionId,
          ciphertext: new Uint8Array(randomBytes(32)),
        });
        return await read();
      }

      const peerA = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await peerA.start();
      await peerA.dial(relayAddr);

      expect((await deposit(peerA, 1))?.["ok"], "first is within the limit").toBe(true);
      expect((await deposit(peerA, 2))?.["ok"], "second is at the limit").toBe(true);

      const refused = await deposit(peerA, 3);
      expect(
        refused?.["ok"],
        "the third from this peer must be REFUSED. If this is true, either the limiter is not called " +
          "or the authenticated peer id is not reaching it — the two reverts this test exists to catch.",
      ).toBe(false);
      expect(refused?.["reason"], "and the depositor must be told WHY").toBe("rate_limited");
      expect(
        Number(refused?.["retry_after_ms"] ?? 0),
        "and WHEN to come back — the relay knows the number, and a refusal without it leaves the " +
          "client waiting on an unrelated reconnect for a condition that clears in a minute",
      ).toBeGreaterThan(0);

      /**
       * ⚠️ THE PROPERTY THAT MAKES THIS SAFE TO SHIP AT ALL: a second peer, over its own connection
       * and therefore its own authenticated peer id, is unaffected. A global limiter would let one
       * attacker deny parking to every honest sender — an abuse control becoming the outage it was
       * meant to prevent.
       */
      const peerB = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await peerB.start();
      await peerB.dial(relayAddr);
      expect(
        (await deposit(peerB, 4))?.["ok"],
        "a different peer must be unaffected by peer A's flood",
      ).toBe(true);

      await peerA.stop();
      await peerB.stop();
    } finally {
      await stop();
    }
  }, 60_000);
});
