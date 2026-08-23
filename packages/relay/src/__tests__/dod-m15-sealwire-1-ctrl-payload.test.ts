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
import { encodeSealPayload } from "@cello-protocol/protocol-types";

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
    /**
     * A REAL payload, not a stand-in. This test used three arbitrary bytes until review H1 made the
     * decoder require the value to actually BE a seal payload — at which point the stand-in was
     * correctly refused, and the test that had been "green" turned out to have been asserting that
     * arbitrary bytes are accepted.
     */
    const payload = encodeSealPayload({
      session_id: new Uint8Array(16).fill(0x11),
      final_root: new Uint8Array(32).fill(0x33),
      close_timestamp: 1_700_000_000_000,
      attestation: "PENDING",
    });
    const parsed = decodeInboundFrame(submit(CTRL, payload));
    expect(parsed).not.toBeNull();
    // Compared as bytes, not as objects: CBOR round-trips a Uint8Array to a Buffer, and `toEqual`
    // treats those as different types while the bytes are identical.
    const carried = (parsed as { content_bytes?: Uint8Array }).content_bytes;
    expect(
      carried && Buffer.from(carried).equals(Buffer.from(payload)),
      "the whole point of this leg — without the bytes the directory cannot check the relay against a client signature",
    ).toBe(true);
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
    // A VALID payload on a msg leaf, so the refusal is unambiguously about the KIND. Junk bytes
    // would now be refused on content grounds too, and the test would pass for the wrong reason.
    const validPayload = encodeSealPayload({
      session_id: new Uint8Array(16).fill(0x11),
      final_root: new Uint8Array(32).fill(0x33),
      close_timestamp: 1_700_000_000_000,
      attestation: "PENDING",
    });
    expect(
      decodeInboundFrame(submit(MSG, validPayload)),
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
    const validPayload = encodeSealPayload({
      session_id: new Uint8Array(16).fill(0x11),
      final_root: new Uint8Array(32).fill(0x33),
      close_timestamp: 1_700_000_000_000,
      attestation: "PENDING",
    });
    expect(decodeInboundFrame(submit(0x04, validPayload))).toBeNull();
    expect(decodeInboundFrame(submit(0x05, validPayload)), "and reject leaves").toBeNull();
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

  it("★★ a REAL seal payload is accepted, and it is nowhere near the ceiling", () => {
    /**
     * ⚠️ REVIEW: nothing in this file tied the guard to the actual payload format. Every test used a
     * three-byte stand-in, so a payload-format change that pushed the real thing past the ceiling
     * would have broken every honest seal with no red test anywhere.
     *
     * Built from the protocol's own `encodeSealPayload` — the producer's function, not a local
     * imitation — and the headroom is asserted rather than assumed.
     */
    const real = encodeSealPayload({
      session_id: new Uint8Array(16).fill(0x11),
      final_root: new Uint8Array(32).fill(0x33),
      close_timestamp: 1_700_000_000_000,
      attestation: "PENDING",
    });
    const parsed = decodeInboundFrame(submit(CTRL, real));
    expect(parsed, "the real payload format must be accepted, or every honest seal breaks").not.toBeNull();
    expect(
      real.length,
      "and it must sit well under the ceiling, so a format change has room before it breaks seals",
    ).toBeLessThan(256);
  });

  it("★★ THE BYTES MUST BE A SEAL PAYLOAD FOR THIS SESSION — not merely small and on a ctrl leaf", () => {
    /**
     * ⚠️ REVIEW H1, AND IT IS THE DIFFERENCE BETWEEN THE SAFETY PROPERTY BEING TRUE AND BEING CLAIMED.
     *
     * The guard was: ctrl leaf, non-empty, ≤512 bytes. Nothing required the bytes to be a seal
     * payload — so a client could put 512 bytes of the operator's message into a ctrl leaf and this
     * relay would take them. The type doc said "the relay already knows all four fields, nothing is
     * disclosed"; the code enforced "at most 512 arbitrary bytes per close". Those are not the same
     * property, and the first one is the one anybody would quote.
     */
    expect(
      decodeInboundFrame(submit(CTRL, new Uint8Array(64).fill(0x41))),
      "arbitrary bytes on a ctrl leaf are still the operator's content — being small does not make them a seal payload",
    ).toBeNull();

    /**
     * And it must be a payload for THIS session. Binding at the wire also stops a valid payload from
     * another conversation being replayed here, three hops before the directory would notice.
     */
    const otherSession = encodeSealPayload({
      session_id: new Uint8Array(16).fill(0x99),
      final_root: new Uint8Array(32).fill(0x33),
      close_timestamp: 1_700_000_000_000,
      attestation: "PENDING",
    });
    expect(
      decodeInboundFrame(submit(CTRL, otherSession)),
      "a well-formed payload naming a DIFFERENT session is a replay, not a seal for this one",
    ).toBeNull();
  });

  it("★ oversized bytes are refused — and this CANNOT distinguish the ceiling from the payload check", () => {
    /**
     * ⚠️ MEASURED, AND THE HONEST ANSWER IS THAT THIS TEST DOES NOT PIN THE CEILING.
     *
     * A mutant raising `MAX_CTRL_PAYLOAD_BYTES` from 512 to 4096 SURVIVES this file. Once the bytes
     * must decode as a seal payload (H1), anything oversized is refused on content grounds anyway,
     * so no input separates "the ceiling caught it" from "the decode caught it" — and a real payload
     * is 69 bytes, so the boundary is unreachable from the legitimate side too.
     *
     * The ceiling is kept for the one job the decode cannot do: it bounds the work done BEFORE
     * `decodeSealPayload` runs, so a client cannot make the relay CBOR-parse a multi-megabyte buffer
     * per submit. That is an ordering property of the two checks, not a behaviour any input reveals.
     *
     * Recorded as a surviving mutant rather than dressed up as coverage — the alternative is a
     * future reader trusting this name and believing the bound is pinned when it is not.
     */
    expect(decodeInboundFrame(submit(CTRL, new Uint8Array(4096).fill(0x41))), "oversized is refused").toBeNull();
    expect(decodeInboundFrame(submit(CTRL, new Uint8Array(513).fill(0x41))), "and just over the bound too").toBeNull();
  });

});
