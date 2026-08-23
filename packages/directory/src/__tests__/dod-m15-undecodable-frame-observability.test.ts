/**
 * A FRAME THIS BUILD CANNOT DECODE MUST LEAVE A TRACE — `DOD-M15-SEALWIRE-1` bullet 7, review pass 2
 * finding A.
 *
 * ─── Why this test exists, and it is not the reason you would guess ────────────────────────────
 *
 * Pass 1 found that the signaling dispatch dropped unrecognised frames with no log at all. I added a
 * debug line to the dispatch chain's terminal `else`. **Pass 2 found that a frame type this build
 * has DELETED can never reach that branch.**
 *
 * `decodeInboundSignalingFrame` returns `null` for any type it does not know, and the loop handles
 * that *before* the chain runs — the peer is answered `not_authenticated` and the directory says
 * nothing. The terminal `else` only ever sees frames that decode cleanly and have no dispatch case,
 * which a deleted type by definition is not.
 *
 * Right file, right method, reachable branch, and unreachable for its own reason. **No test could
 * have caught it, because no test asserted the event at all** — which is the whole lesson: a new log
 * line has to be watched firing on the case that motivated it, not merely read at its call site.
 *
 * ─── What the operator loses without it ────────────────────────────────────────────────────────
 *
 * `not_authenticated` on an already-authenticated stream is genuinely ambiguous, and the client's own
 * code says so: it has THREE producers — a peer that has not deployed this frame kind, a peer that
 * HAS (so it is our bug), and a frame that really did arrive before auth completed. The operator ends
 * up at `submission_unsupported_by_node`, reached by a timeout and a guess, because the directory
 * never said which of the three it was. One debug line on this side is the whole difference.
 *
 * ─── Why DEBUG and not WARN ────────────────────────────────────────────────────────────────────
 *
 * During a federation roll this fires on healthy peers speaking a frame kind a not-yet-updated node
 * does not know. A warning there would train operators to filter the channel, and the one time it
 * meant something they would not see it either.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import type { Logger } from "@cello-protocol/interfaces";
import { Encoder, decode } from "cbor-x";
import { createHash } from "node:crypto";
import * as lp from "it-length-prefixed";

const CBOR_ENC = new Encoder({ tagUint8Array: false });
// The directory's own auth domain. Duplicated because it is not exported — a mismatch here would
// make the test fail at auth rather than at the thing under test, so it is asserted, not assumed.
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

interface Captured { level: string; event: string; ctx: Record<string, unknown> }

function capturingLogger(sink: Captured[]): Logger {
  const at = (level: string) => (event: string, ctx?: Record<string, unknown>) =>
    { sink.push({ level, event, ctx: ctx ?? {} }); };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") } as unknown as Logger;
}

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

function send(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

/** Reads length-prefixed CBOR frames off a stream. */
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

describe("DOD-M15-SEALWIRE-1 bullet 7 (pass 2, finding A): an undecodable frame is not silent", () => {
  const cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => { cleanups.length = 0; });
  afterEach(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* teardown */ } } });

  it("★ a frame type the directory cannot decode is LOGGED, and the log names the type", async () => {
    const events: Captured[] = [];
    const dirKeyProvider = generateKeypair();
    const { node: dirNode, stop } = await createDirectoryNode({
      keyProvider: dirKeyProvider,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: [] },
      store: new InMemoryDirectoryStore(),
      logger: capturingLogger(events),
    });
    cleanups.push(async () => { await stop(); });

    const clientKeyProvider = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKeyProvider, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    cleanups.push(async () => { await clientNode.stop(); });

    // ── Authenticate for real. The whole point is what happens on an AUTHENTICATED stream. ──
    const addrs = dirNode.listenAddresses();
    if (addrs.length > 0) { try { await clientNode.dial(addrs[0]!); } catch { /* already connected */ } }
    const stream = await clientNode.newStream(dirNode.getPeerId(), SIGNALING_PROTOCOL_ID);
    const reader = new Reader(stream);

    const challenge = await reader.next();
    expect(challenge["type"], "precondition: the directory must challenge us").toBe("signaling_auth_challenge");
    // The auth binding is domain || nonce || pubkey, hashed — same derivation the production client
    // performs. Signing the bare nonce authenticates nothing about which directory or which key.
    const nonce = challenge["nonce"] as Uint8Array;
    const pubkey = await clientKeyProvider.getPublicKey();
    const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
    const signature = await clientKeyProvider.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
    send(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));
    const authOk = await reader.next();
    expect(authOk["type"], "precondition: we must be genuinely authenticated, or this tests the wrong branch").toBe("signaling_auth_ok");

    events.length = 0; // only what the undecodable frame produces

    /**
     * A frame shaped exactly like a deleted protocol's: valid CBOR, a `type` string, and a type this
     * build has never heard of. `seal_attempt` itself would do — this is what one looks like now —
     * but a distinct name keeps the deletion guard from tripping on this file.
     */
    send(stream, CBOR_ENC.encode({
      type: "a_protocol_this_build_has_dropped",
      session_id: new Uint8Array(16),
    }));

    const reply = await reader.next();
    expect(
      reply["type"],
      "the reply itself is unchanged — this is about what THIS side records, not what the peer receives",
    ).toBe("not_authenticated");

    const logged = events.filter((e) => e.event === "directory.signaling.frame.undecodable");
    expect(
      logged.length,
      "an undecodable frame on an AUTHENTICATED stream must leave a trace — without one it is indistinguishable from a peer sending nothing",
    ).toBe(1);
    expect(
      logged[0]!.ctx["rawType"],
      "and it must name the type, or the operator cannot tell WHICH feature their peer is speaking that this node is not",
    ).toBe("a_protocol_this_build_has_dropped");
    expect(
      logged[0]!.level,
      "debug, not warn: during a roll this fires on healthy peers, and a warning there teaches operators to filter the channel",
    ).toBe("debug");
    expect(
      String(logged[0]!.ctx["impact"]),
      "it must say what the counterparty was told, because not_authenticated on an authed stream is what makes this ambiguous at all",
    ).toMatch(/not_authenticated/);
  }, 60_000);
});
