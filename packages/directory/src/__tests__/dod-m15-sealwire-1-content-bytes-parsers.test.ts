/**
 * A MALFORMED `content_bytes` IS REFUSED ON BOTH WIRE PATHS — `DOD-M15-SEALWIRE-1` bullets 3+4,
 * review pass 2, finding F-3.
 *
 * ─── Why this file exists at all ───────────────────────────────────────────────────────────────
 *
 * Pass 1 raised a blocking finding: `content_bytes` could not arrive on either path, and one of them
 * would have passed it through unvalidated into `createHash(...).update()`, **which throws on
 * anything that is not bytes** — an exception escaping into a stream handler.
 *
 * I fixed both parsers and shipped **no test at all**. Pass 2 ran the revert test on it: undo both
 * hunks and all 1145 directory tests stay green. A blocking finding closed with zero coverage is a
 * finding that will be re-opened by the next refactor.
 *
 * ─── The two paths disagreed, and the disagreement had an operator cost ────────────────────────
 *
 * `directory-frames.ts` took `toUint8Array` and spread the result, so a string or an object became
 * **absent** and the frame was accepted. Its sibling on the bilateral path refused the identical byte
 * as `seal_submission_content_bytes_malformed`. Same input, opposite answers.
 *
 * The silent-drop half is the worse one, and not because of the drop. Absent surfaces downstream as
 * `not_carried`, whose guidance reads *"the relay node serving this session is on an old build."* So
 * an operator whose relay is on the NEW build, sending the field, with an encoding bug in the
 * payload, is sent to compare versions with a relay that is not the problem. The exit-point label
 * standing in for the cause, one more time.
 *
 * The parser's own rule three lines above the site says it: *"Shape-validate strictly — a malformed
 * entry voids the whole carry… never silently drops a leaf."* Every sibling field obeys it.
 */

import { describe, it, expect } from "vitest";
import { Encoder } from "cbor-x";
import { decodeInboundSignalingFrame } from "../directory-frames.js";
import { validateSealSubmissionLeaves } from "../seal-unilateral-verify.js";
import { encodeSealPayload } from "@cello-protocol/protocol-types";

const CBOR = new Encoder({ tagUint8Array: false });

/** A `seal_unilateral` frame carrying one leaf, whose `content_bytes` the caller chooses. */
function unilateralFrame(contentBytes: unknown): Uint8Array {
  const leaf: Record<string, unknown> = {
    sequence_number: 1,
    leaf_kind: 0x02,
    structure2_cbor: new Uint8Array([1, 2, 3]),
    structure1_cbor: new Uint8Array([4, 5, 6]),
  };
  if (contentBytes !== undefined) leaf["content_bytes"] = contentBytes;
  return new Uint8Array(CBOR.encode({
    type: "seal_unilateral",
    session_id: new Uint8Array(16).fill(0x11),
    reported_root: new Uint8Array(32).fill(0x22),
    reported_seq: 1,
    seal_leaves: [leaf],
  }));
}

describe("DOD-M15-SEALWIRE-1 bullets 3+4 (pass 2, F-3): content_bytes is shape-checked on BOTH paths", () => {
  it("★ the ANCHOR — a well-formed frame with real bytes still parses", () => {
    /**
     * Pinned before anything is asserted refused. Every "must be rejected" assertion below is
     * satisfied by a parser that rejects EVERYTHING, and a guard that refuses the honest case is a
     * wall rather than a check.
     */
    const parsed = decodeInboundSignalingFrame(unilateralFrame(new Uint8Array([9, 9, 9])));
    expect(parsed, "a relay that carries the payload correctly must be accepted").not.toBeNull();
    expect(parsed!.type).toBe("seal_unilateral");
  });

  it("★ ABSENT still parses — a relay that has not deployed this must keep working", () => {
    /**
     * Receiver-first depends on this. If omitting the field were a refusal, deploying the directory
     * ahead of the relays would break every seal instead of degrading to today's behaviour.
     */
    const parsed = decodeInboundSignalingFrame(unilateralFrame(undefined));
    expect(parsed, "absent is a relay on an older build, not a malformed frame").not.toBeNull();
    expect(parsed!.type).toBe("seal_unilateral");
  });

  it("★★ a STRING content_bytes VOIDS the frame — it must not be silently dropped to absent", () => {
    /**
     * The finding. Hex-as-string is the encoding bug that actually happens, and dropping it to absent
     * reports the result as a relay that has not deployed the feature — sending the operator to
     * compare build versions with a relay that is on the new build and sending the field.
     */
    expect(
      decodeInboundSignalingFrame(unilateralFrame("a1b2c3")),
      "a present-but-malformed field must void the carry, exactly as every sibling field does",
    ).toBeNull();
  });

  it("★ an OBJECT content_bytes voids the frame too — this is the one that reaches a hash", () => {
    /**
     * `createHash(...).update()` throws a TypeError on anything that is not bytes or a string. An
     * object here is the value that would escape into the stream handler once the verifier is wired.
     */
    expect(decodeInboundSignalingFrame(unilateralFrame({ hex: "a1b2" }))).toBeNull();
    expect(decodeInboundSignalingFrame(unilateralFrame(42))).toBeNull();
  });

  it("★★ THE RELAY'S OWN LEAF SHAPE IS ACCEPTED — the hop that now REFUSES rather than degrades", () => {
    /**
     * ⚠️ THE OTHER HALF OF A HOP NOTHING COVERED, and its failure mode changed when the relay
     * started sending the field.
     *
     * The relay proves the payload reaches `submitForSeal` and survives its own CBOR encoder
     * (`packages/relay/src/__tests__/relay-node.test.ts`). It cannot assert this side — the relay
     * does not depend on the directory and must not start to. So the shape it produces is asserted
     * here, against the validator that actually receives it.
     *
     * Why it matters more than it used to: until the relay carried the field, a shape mismatch here
     * was unreachable in production. It is live now, and it does not degrade — this validator refuses
     * the whole submission, the directory answers an error, and the relay treats any directory answer
     * as terminal. **A mismatch destroys the seal rather than producing `not_carried`.**
     *
     * `Buffer` on purpose: cbor-x decodes byte strings to `Buffer`, not `Uint8Array`, so a validator
     * that checked `instanceof Uint8Array` alone would refuse every honest relay frame. (`Buffer`
     * extends `Uint8Array`, so it passes — asserted rather than assumed, because that is the exact
     * shape a decoder hands over and the exact assumption that would have been wrong.)
     */
    const payload = encodeSealPayload({
      session_id: new Uint8Array(16).fill(0x11),
      final_root: new Uint8Array(32).fill(0x33),
      close_timestamp: 1_700_000_000_000,
      attestation: "PENDING",
    });
    const relayShaped = [
      { kind: "msg", s2: {}, structure1_cbor: Buffer.from([1, 2, 3]) },
      { kind: "ctrl", s2: {}, structure1_cbor: Buffer.from([4, 5, 6]), content_bytes: Buffer.from(payload) },
    ];
    const verdict = validateSealSubmissionLeaves(relayShaped);
    expect(
      verdict.ok,
      `a leaf set of exactly the shape the relay sends must be accepted: ${JSON.stringify(verdict)}`,
    ).toBe(true);
  });

  it("★★ the BILATERAL path refuses the same input, by name — the two must not disagree", () => {
    /**
     * The other half of F-3. `seal_submission` is accepted from any dialer and no relay receipt binds
     * it, so it is the likelier place for a bad value to arrive — and it was passing everything
     * except `kind` straight through as validated leaves.
     */
    const bad = validateSealSubmissionLeaves([{ kind: "ctrl", content_bytes: "a1b2c3" }]);
    expect(bad.ok, "the same byte that voids the unilateral frame must not pass here").toBe(false);
    expect((bad as { reason: string }).reason).toBe("seal_submission_content_bytes_malformed");

    const alsoBad = validateSealSubmissionLeaves([{ kind: "ctrl", content_bytes: { hex: "a1b2" } }]);
    expect(alsoBad.ok).toBe(false);

    // And both the honest shapes still pass.
    expect(validateSealSubmissionLeaves([{ kind: "ctrl", content_bytes: new Uint8Array([1]) }]).ok).toBe(true);
    expect(validateSealSubmissionLeaves([{ kind: "ctrl" }]).ok, "absent is not malformed").toBe(true);
  });
});
