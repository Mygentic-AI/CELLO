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
    const { node: relayNode, stop } = await createRelayNode({ directoryPubkey: dirPubkey, contentStore: store, logger });
    try {
      const relayAddr = relayNode.listenAddresses()[0]!;

      const recipientKp = generateKeypair();
      const recipientPub = await recipientKp.getPublicKey();
      const rHex = Buffer.from(recipientPub).toString("hex");
      const ciphertext = new Uint8Array(randomBytes(64));
      const plaintextLike = new Uint8Array([1, 2, 3]);
      const contentHash = new Uint8Array(createHash("sha256").update(Buffer.from(plaintextLike)).digest());
      const sessionId = new Uint8Array(randomBytes(16));

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
    const { node: relayNode, stop } = await createRelayNode({ directoryPubkey: await dirKp.getPublicKey(), contentStore: store, logger });
    try {
      const relayAddr = relayNode.listenAddresses()[0]!;
      const recipientKp = generateKeypair();
      const recipientPub = await recipientKp.getPublicKey();
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
