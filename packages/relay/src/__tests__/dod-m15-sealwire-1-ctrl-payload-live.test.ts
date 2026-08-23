/**
 * THE REFUSAL REACHES THE CLIENT, AND THE OPERATOR — `DOD-M15-SEALWIRE-1` bullets 3+4, relay leg,
 * review findings H2 and the hollow-test gap.
 *
 * ─── Why this is a LIVE test and its predecessor was not good enough ───────────────────────────
 *
 * The first version of this assertion read `relay-node.ts` as text and checked the log line existed.
 * Review revert-tested it and found the bypass: `const parsed = decodeInboundFrame(frameBytes);`
 * appears **twice** in that file — the auth phase and the dispatch — and every assertion was a
 * file-global substring search. Move the whole warn block up into the auth-phase refusal, leave the
 * dispatch bare, and the source test stays green while the security refusal goes silent again.
 *
 * Worse, the source scan could not assert the half the commit message actually rested on: **that the
 * client gets an answer.** That is a property of a running relay and nothing less will do.
 *
 * ─── What the operator lived through before H2 ─────────────────────────────────────────────────
 *
 * 1. A client submits a leaf carrying content the relay will not hold.
 * 2. The relay refuses — correctly — **by sending nothing at all.**
 * 3. The client races its acknowledgement against a ten-second timeout, loses, and reports
 *    `relay_submit_timeout`.
 * 4. It then resets the stream — **which every session that agent holds on this relay shares.** One
 *    refused frame drops every other conversation's transport.
 * 5. The operator reads a transport word for a deliberate policy decision taken on a different
 *    machine, under a different operator, whose own log line saying so they cannot see.
 * 6. And it does not self-correct: the next message re-sends the same frame.
 *
 * A typed terminal answer costs one frame. This test is the one that would have caught its absence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import type { Stream } from "@libp2p/interface";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import { encodeSealPayload } from "@cello-protocol/protocol-types";
import type { Logger } from "@cello-protocol/interfaces";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";

const CBOR = new Encoder({ tagUint8Array: false });
const SESSION_ID = new Uint8Array(16).fill(0x11);

interface Captured { level: string; event: string; ctx: Record<string, unknown> }

function capturingLogger(sink: Captured[]): Logger {
  const at = (level: string) => (event: string, ctx?: Record<string, unknown>) =>
    { sink.push({ level, event, ctx: ctx ?? {} }); };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") } as unknown as Logger;
}

class Reader {
  #iter: AsyncIterator<unknown>;
  constructor(stream: Stream) {
    this.#iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
  }
  async next(timeoutMs = 5_000): Promise<Record<string, unknown>> {
    const res = await Promise.race([
      this.#iter.next(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("frame_timeout")), timeoutMs)),
    ]);
    const v = (res as IteratorResult<unknown>).value as { subarray(): Uint8Array };
    return decode(v.subarray()) as Record<string, unknown>;
  }
}

function send(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

describe("DOD-M15-SEALWIRE-1 relay leg (live): a refused submit is answered, not left to time out", () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => { cleanups.length = 0; });
  afterEach(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* teardown */ } } });

  it("★★ a msg leaf carrying content gets a TYPED TERMINAL error back, and the operator gets a WARN", async () => {
    const events: Captured[] = [];
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      logger: capturingLogger(events),
    });
    cleanups.push(async () => { await stop(); });

    const clientKp = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    cleanups.push(async () => { await clientNode.stop(); });
    await clientNode.dial(relayNode.listenAddresses()[0]!);

    const stream = await clientNode.newStream(relayNode.getPeerId(), RELAY_PROTOCOL_ID);
    const reader = new Reader(stream);

    // ── Real auth. The refusal under test happens only on an AUTHENTICATED stream. ──
    const challenge = await reader.next();
    expect(challenge["type"], "precondition: the relay must challenge us").toBe("relay_auth_challenge");
    const nonce = challenge["nonce"] as Uint8Array;
    const pubkey = await clientKp.getPublicKey();
    const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
    const signature = await clientKp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
    send(stream, CBOR.encode({ type: "relay_auth_response", pubkey, signature }));
    const authOk = await reader.next();
    expect(authOk["type"], "precondition: genuinely authenticated, or this exercises the wrong branch").toBe("relay_auth_ok");

    events.length = 0;

    /**
     * A well-formed SEAL payload on a **msg** leaf. Valid payload on purpose: the refusal must be
     * unambiguously about the leaf KIND — junk bytes would now be refused on content grounds too,
     * and the test would pass for a reason other than the one it names.
     */
    send(stream, CBOR.encode({
      type: "hash_submit",
      session_id: SESSION_ID,
      leaf_kind: 0x00,
      structure1_cbor: new Uint8Array([1, 2, 3]),
      sender_signature: new Uint8Array(64).fill(0x22),
      content_bytes: encodeSealPayload({
        session_id: SESSION_ID,
        final_root: new Uint8Array(32).fill(0x33),
        close_timestamp: 1_700_000_000_000,
        attestation: "PENDING",
      }),
    }));

    /**
     * ⚠️ THE ASSERTION THE SOURCE SCAN COULD NOT MAKE. Before H2 this read nothing for five seconds
     * and the whole test would have failed on the timeout — which is exactly what the client
     * experiences, at ten seconds, followed by a stream reset across every session it holds here.
     */
    const reply = await reader.next();
    expect(
      reply["type"],
      "the client must be ANSWERED — silence here costs it ten seconds and every other session's stream on this relay",
    ).toBe("hash_submit_error");
    expect(
      reply["reason"],
      "and named for the cause: a policy refusal, not a transport failure on a machine that is working perfectly",
    ).toBe("content_not_permitted");
    expect(
      String(reply["detail"] ?? ""),
      "the detail must say which rule and which leaf kind, so the client author can fix it without guessing",
    ).toMatch(/ctrl leaves only|leaf_kind 0/i);

    // ── And the relay's own operator gets a record. Two audiences, both served. ──
    const refused = events.filter((e) => e.event === "relay.session.frame.refused");
    expect(refused.length, "the relay operator must be able to see a peer sending frames this build refuses").toBe(1);
    expect(refused[0]!.level, "not routine — every field on this frame is one this build has always known").toBe("warn");
    expect(
      refused[0]!.ctx["leafKind"],
      "and it must name the leaf kind, or 'a frame was refused' and 'a client tried to send us message content' look identical",
    ).toBe(0);
  }, 60_000);

  it("★★ THE REASON NAMES WHAT WENT WRONG — nine conditions must not share one label", async () => {
    /**
     * ⚠️ REVIEW PASS 2, BLOCKING 2. `!parsed` catches every decode failure of a submit, and I replied
     * `content_not_permitted` to all of them — including two where the message contradicted itself:
     *
     *   - a ctrl leaf whose payload named a DIFFERENT session (the case the previous pass's own fix
     *     was added to catch) was told *"content_bytes is admissible on ctrl leaves only (0x02); this
     *     frame declared leaf_kind 2"*. Leaf kind 2 IS ctrl. It named the one rule the author had
     *     obeyed and said nothing about the mismatch found;
     *   - a submit with a short signature and no content at all was reported as a content-policy
     *     violation, on a frame with no content in it.
     *
     * Both cases are driven here, because "the reason is right for the case I thought about" is what
     * the previous version already satisfied.
     */
    const events: Captured[] = [];
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      logger: capturingLogger(events),
    });
    cleanups.push(async () => { await stop(); });

    const clientKp = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    cleanups.push(async () => { await clientNode.stop(); });
    await clientNode.dial(relayNode.listenAddresses()[0]!);

    const stream = await clientNode.newStream(relayNode.getPeerId(), RELAY_PROTOCOL_ID);
    const reader = new Reader(stream);
    const challenge = await reader.next();
    const nonce = challenge["nonce"] as Uint8Array;
    const pubkey = await clientKp.getPublicKey();
    const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
    const signature = await clientKp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
    send(stream, CBOR.encode({ type: "relay_auth_response", pubkey, signature }));
    expect((await reader.next())["type"]).toBe("relay_auth_ok");

    // ── (a) A ctrl leaf whose payload names ANOTHER session. Content IS present. ──
    send(stream, CBOR.encode({
      type: "hash_submit",
      session_id: SESSION_ID,
      leaf_kind: 0x02,
      structure1_cbor: new Uint8Array([1, 2, 3]),
      sender_signature: new Uint8Array(64).fill(0x22),
      content_bytes: encodeSealPayload({
        session_id: new Uint8Array(16).fill(0x99),   // a different conversation
        final_root: new Uint8Array(32).fill(0x33),
        close_timestamp: 1_700_000_000_000,
        attestation: "PENDING",
      }),
    }));
    const replayReply = await reader.next();
    expect(replayReply["reason"], "content IS present, so this is a content refusal").toBe("content_not_permitted");
    expect(
      String(replayReply["detail"] ?? ""),
      "but the detail must NOT claim the leaf kind is wrong — it was ctrl, which is the one thing that was right",
    ).not.toMatch(/leaf_kind 2/);
    expect(
      String(replayReply["detail"] ?? ""),
      "it must name what was actually detected: the payload is not a seal payload for THIS session",
    ).toMatch(/THIS session|SEAL payload/i);

    // ── (b) A malformed submit carrying NO content at all. ──
    send(stream, CBOR.encode({
      type: "hash_submit",
      session_id: SESSION_ID,
      leaf_kind: 0x00,
      structure1_cbor: new Uint8Array([1, 2, 3]),
      sender_signature: new Uint8Array(8).fill(0x22),   // not 64 bytes
    }));
    const malformedReply = await reader.next();
    expect(
      malformedReply["reason"],
      "a frame with no content in it must never be told it violated a content policy",
    ).toBe("submit_malformed");
    expect(
      String(malformedReply["detail"] ?? ""),
      "and the detail must point at the fields that are actually checked",
    ).toMatch(/sender_signature|structure1_cbor/);
  }, 60_000);

  it("★ an ordinary submit is untouched — the guard must not have become a wall", async () => {
    /**
     * The anchor, and the receiver-first property in one. A client that has not deployed this change
     * must be entirely unaffected; if this failed, the previous test would be passing because the
     * relay rejects everything.
     */
    const events: Captured[] = [];
    const dirKp = generateKeypair();
    const { node: relayNode, stop } = await createRelayNode({
      directoryPubkey: await dirKp.getPublicKey(),
      logger: capturingLogger(events),
    });
    cleanups.push(async () => { await stop(); });

    const clientKp = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    cleanups.push(async () => { await clientNode.stop(); });
    await clientNode.dial(relayNode.listenAddresses()[0]!);

    const stream = await clientNode.newStream(relayNode.getPeerId(), RELAY_PROTOCOL_ID);
    const reader = new Reader(stream);
    const challenge = await reader.next();
    const nonce = challenge["nonce"] as Uint8Array;
    const pubkey = await clientKp.getPublicKey();
    const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
    const signature = await clientKp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
    send(stream, CBOR.encode({ type: "relay_auth_response", pubkey, signature }));
    expect((await reader.next())["type"]).toBe("relay_auth_ok");

    events.length = 0;
    // No `content_bytes` at all — a client on any older build.
    send(stream, CBOR.encode({
      type: "hash_submit",
      session_id: SESSION_ID,
      leaf_kind: 0x00,
      structure1_cbor: new Uint8Array([1, 2, 3]),
      sender_signature: new Uint8Array(64).fill(0x22),
    }));

    const reply = await reader.next();
    expect(
      reply["type"],
      "an ordinary submit must reach the handler and be answered on its own merits, not refused at the wire",
    ).toBe("hash_submit_error");
    expect(
      reply["reason"],
      "and for its OWN reason — an unknown session — never content_not_permitted",
    ).not.toBe("content_not_permitted");
    expect(
      events.filter((e) => e.event === "relay.session.frame.refused").length,
      "and it must not be logged as a refused frame at all",
    ).toBe(0);
  }, 60_000);
});
