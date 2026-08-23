/**
 * THE RELAY CARRIES THE SEAL PAYLOAD — AND ONLY FOR CTRL LEAVES.
 * `DOD-M15-SEALWIRE-1` bullets 3+4, the relay half.
 *
 * ─── What this is for ──────────────────────────────────────────────────────────────────────────
 *
 * The directory cannot check the relay against anything the relay did not supply. The one value that
 * breaks that circle is `final_root` — the client's own signed claim about its own transcript — and
 * it never arrives, because the client submits only `SHA-256(0x02 ‖ seal_payload)`. The payload
 * itself is a pre-image nobody transmits. The verifier for it is built and proven
 * (`seal-final-root.ts`); this is the leg that lets the bytes reach it.
 *
 * ─── ⚠️ THE COUNTERBALANCE, NAMED BEFORE THE CODE ──────────────────────────────────────────────
 *
 * **This adds a field that carries leaf CONTENT to the relay, and the relay is the one party this
 * protocol is built to keep content away from.** INV-3 is that a forwarding relay sees ciphertext.
 * Getting this wrong does not degrade a hash — it hands every message in every conversation to the
 * least trusted participant.
 *
 * It is safe for **ctrl leaves specifically**, and the reason is narrow: a SEAL payload is
 * `[session_id, final_root, close_timestamp, "PENDING"]`. Every one of those four is already known
 * to the relay — it assigned the session, it built the Merkle tree the root comes from, and it
 * stamped the leaf. Nothing new is disclosed.
 *
 * That reasoning does **not** extend one leaf kind further. A `msg` leaf's content is the operator's
 * plaintext, and a `doc` leaf's is their document. So the guard is not "validate the shape" — it is
 * **refuse the field outright on any leaf that is not ctrl**, and refuse it at the wire boundary
 * rather than downstream, so a buggy or malicious client cannot push plaintext into a relay's WAL
 * and have it noticed three layers later.
 *
 * A submit that carries content for a msg leaf is not a malformed frame to be tidied up. It is a
 * client trying to give the relay something the relay must never hold, and it is refused as such.
 */

import { describe, it, expect } from "vitest";
import { Encoder } from "cbor-x";
import { decodeInboundFrame } from "../relay-frames.js";

const CBOR = new Encoder({ tagUint8Array: false });

const CTRL = 0x02;
const MSG = 0x00;

function submit(leafKind: number, contentBytes?: unknown): Uint8Array {
  const frame: Record<string, unknown> = {
    type: "hash_submit",
    session_id: new Uint8Array(16).fill(0x11),
    leaf_kind: leafKind,
    structure1_cbor: new Uint8Array([1, 2, 3]),
    sender_signature: new Uint8Array(64).fill(0x22),
  };
  if (contentBytes !== undefined) frame["content_bytes"] = contentBytes;
  return new Uint8Array(CBOR.encode(frame));
}

describe("DOD-M15-SEALWIRE-1 relay half: the SEAL payload rides, and only on a ctrl leaf", () => {
  it("★ the ANCHOR — an ordinary submit with no payload still parses", () => {
    /**
     * Pinned first. Every refusal below is satisfied by a decoder that refuses everything, and a
     * guard that rejects the honest case is a wall. This also IS the receiver-first property: a
     * client that has not deployed the change must keep working unchanged.
     */
    const msg = decodeInboundFrame(submit(MSG));
    expect(msg, "a normal message submit must be unaffected").not.toBeNull();
    expect(msg!.type).toBe("hash_submit");

    const ctrl = decodeInboundFrame(submit(CTRL));
    expect(ctrl, "and a ctrl submit that carries nothing is a client on an older build, not an error").not.toBeNull();
  });

  it("★ a CTRL leaf may carry its payload, and it survives decoding as bytes", () => {
    const payload = new Uint8Array([0xa1, 0xb2, 0xc3]);
    const parsed = decodeInboundFrame(submit(CTRL, payload));
    expect(parsed).not.toBeNull();
    expect(
      (parsed as { content_bytes?: Uint8Array }).content_bytes,
      "the whole point of this leg — without the bytes the directory cannot check the relay against a client signature",
    ).toEqual(payload);
  });

  it("★★ A MSG LEAF CARRYING CONTENT IS REFUSED — this is the relay seeing plaintext", () => {
    /**
     * ⚠️ THE ASSERTION THIS FILE EXISTS FOR.
     *
     * A `msg` leaf's content is the operator's message. If this field were accepted for any kind but
     * ctrl, a client bug — or a client that wanted to — could hand the forwarding relay the plaintext
     * of every message in the conversation, and it would sit in the relay's WAL looking like a
     * protocol field.
     *
     * The refusal is at the WIRE BOUNDARY on purpose. Accepting here and filtering downstream means
     * the bytes have already been received, logged and possibly persisted before anyone objects.
     */
    expect(
      decodeInboundFrame(submit(MSG, new Uint8Array([1, 2, 3]))),
      "a relay must never receive message content — refuse the frame, do not quietly drop the field",
    ).toBeNull();
  });

  it("★★ a DOC leaf carrying content is refused for the same reason", () => {
    /**
     * The reasoning that makes ctrl safe — every field of a SEAL payload is already known to the
     * relay — stops dead at the next leaf kind. A doc leaf's content is the operator's document.
     * Asserted separately from `msg` because "it happens to be rejected" and "it is rejected for this
     * reason" are different properties, and a future kind allow-list must fail this test if it is
     * written loosely.
     */
    expect(decodeInboundFrame(submit(0x04, new Uint8Array([1, 2, 3])))).toBeNull();
    expect(decodeInboundFrame(submit(0x05, new Uint8Array([1, 2, 3]))), "and reject leaves").toBeNull();
  });

  it("★ a malformed payload on a ctrl leaf VOIDS the frame — never dropped to absent", () => {
    /**
     * The lesson from the directory side, applied here before it can happen twice. Dropping a
     * present-but-malformed value to absent makes a client that IS sending the payload
     * indistinguishable from one that is not — and downstream that surfaces as "the other side is on
     * an old build", sending the operator to compare versions with someone whose build is fine.
     */
    expect(decodeInboundFrame(submit(CTRL, "a1b2c3")), "hex-as-string is the encoding bug that happens").toBeNull();
    expect(decodeInboundFrame(submit(CTRL, { hex: "a1b2" }))).toBeNull();
    expect(decodeInboundFrame(submit(CTRL, 42))).toBeNull();
  });

  it("★ an oversized payload on a ctrl leaf is refused — the field is not a smuggling channel", () => {
    /**
     * A SEAL payload is four small fields; its CBOR is well under 128 bytes. Without a ceiling the
     * field is an arbitrary-length write into the relay's session state that costs a client nothing,
     * and the ctrl-only rule above stops being much of a limit — one ctrl leaf per close is still one
     * unbounded blob per close.
     *
     * The bound is deliberately generous relative to the real payload and tiny relative to a message.
     */
    expect(
      decodeInboundFrame(submit(CTRL, new Uint8Array(4096).fill(0x41))),
      "the payload has a known small shape; anything far beyond it is not a seal payload",
    ).toBeNull();
  });
});
