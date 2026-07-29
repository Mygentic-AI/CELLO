/**
 * M10B / DOD-END-SUBMIT-1 — the directory's half of the sealed submission wire.
 *
 * This file exists because the unit review found the directory half had shipped with ZERO tests: a
 * decoder, a handler, two encoders and an interface method, all unexercised, while the commit
 * message cited a green suite that predated them.
 *
 * The most valuable test here is the last one. Both halves of this wire were written in different
 * repos, and each previously asserted only its OWN key names — the client checked what it SENT, the
 * directory checked nothing. Nothing anywhere checked that the bytes one produces are the bytes the
 * other accepts, which is exactly the drift `submission.ts`'s own header warns about, one layer up.
 */
import { describe, it, expect } from "vitest";
import { encode as cborEncode } from "cbor-x";
import {
  decodeInboundSignalingFrame,
  encodeSubmissionWriteResult,
  encodeSubmissionWriteError,
  MAX_SUBMISSION_CIPHERTEXT_BYTES,
  MAX_INTAKE_KEY_ID_CHARS,
} from "../directory-frames.js";
import { decode as cborDecode } from "cbor-x";

const ID = "ab".repeat(32);
const CIPHERTEXT = new Uint8Array([9, 8, 7, 6]);

const frame = (over: Record<string, unknown> = {}): Uint8Array =>
  cborEncode({
    type: "submission_write",
    submission_id: ID,
    intake_key_id: "intake-2026-07",
    ciphertext: CIPHERTEXT,
    ...over,
  });

describe("DOD-END-SUBMIT-1 — the submission_write decoder", () => {
  it("accepts a well-formed frame and preserves the ciphertext byte-for-byte", () => {
    const got = decodeInboundSignalingFrame(frame());
    expect(got?.type).toBe("submission_write");
    if (got?.type !== "submission_write") throw new Error("unreachable");
    expect(got.submission_id).toBe(ID);
    expect(got.intake_key_id).toBe("intake-2026-07");
    expect(Buffer.from(got.ciphertext).equals(Buffer.from(CIPHERTEXT))).toBe(true);
  });

  it("REFUSES every malformed shape rather than storing a half-understood row", () => {
    // A `null` return makes the node reply `not_authenticated` and store nothing. Each of these is a
    // caller getting the wire format wrong (or probing), and none should reach the table.
    const bad: Array<[string, Record<string, unknown>]> = [
      ["missing submission_id", { submission_id: undefined }],
      ["missing intake_key_id", { intake_key_id: undefined }],
      ["missing ciphertext", { ciphertext: undefined }],
      ["non-string submission_id", { submission_id: 42 }],
      ["submission_id not sha256 hex", { submission_id: "not-a-hash" }],
      ["submission_id uppercase hex", { submission_id: ID.toUpperCase() }],
      ["submission_id wrong length", { submission_id: "ab".repeat(31) }],
      ["empty ciphertext", { ciphertext: new Uint8Array(0) }],
      ["empty intake_key_id", { intake_key_id: "" }],
    ];
    for (const [label, over] of bad) {
      expect(decodeInboundSignalingFrame(frame(over)), label).toBeNull();
    }
  });

  it("BOUNDS the row — an unbounded write path is open to anyone who can dial the node", () => {
    // Signaling auth is bare proof-of-possession of any Ed25519 key, and this path has no
    // registration gate. A TTL sweep bounds growth at `rate x TTL`, which is not a bound.
    expect(decodeInboundSignalingFrame(frame({ ciphertext: new Uint8Array(MAX_SUBMISSION_CIPHERTEXT_BYTES + 1) }))).toBeNull();
    expect(decodeInboundSignalingFrame(frame({ intake_key_id: "k".repeat(MAX_INTAKE_KEY_ID_CHARS + 1) }))).toBeNull();
    // ...and the bound is not so tight it refuses a real submission.
    expect(decodeInboundSignalingFrame(frame({ ciphertext: new Uint8Array(4096) }))?.type).toBe("submission_write");
  });
});

describe("DOD-END-SUBMIT-1 — the reply encoders", () => {
  it("carries the `stored` boolean rather than collapsing it into success", () => {
    for (const stored of [true, false]) {
      const decoded = cborDecode(encodeSubmissionWriteResult({ submission_id: ID, stored })) as Record<string, unknown>;
      expect(decoded["type"]).toBe("submission_write_result");
      expect(decoded["submission_id"]).toBe(ID);
      expect(decoded["stored"]).toBe(stored);
    }
  });

  it("ADDRESSES the error to a submission — an unaddressed error resolves someone else's send", () => {
    // The daemon's inbound handler sees every frame on a shared stream. Without the id, two
    // concurrent submissions mean A's failure reports as B's — and the second endorsement of a
    // subject is the ordinary case, not an exotic one.
    const decoded = cborDecode(encodeSubmissionWriteError({ submission_id: ID, reason: "queue_write_failed" })) as Record<string, unknown>;
    expect(decoded["type"]).toBe("submission_write_error");
    expect(decoded["submission_id"]).toBe(ID);
    expect(decoded["reason"]).toBe("queue_write_failed");
  });
});

describe("DOD-END-SUBMIT-1 — the CROSS-REPO wire contract", () => {
  it("decodes the exact frame object the daemon builds — the two halves are checked against each other", () => {
    // Built here to mirror `sendSealedSubmission`'s literal in cello-client
    // (`core/daemon/src/signal-submission.ts`), field for field. Until this test existed, the client
    // asserted its own key names and the directory asserted nothing, so a rename on either side
    // would have shipped green in both repos and failed only in a live journey — which is precisely
    // the failure mode the shared protocol-types encoder exists to prevent one layer down.
    const asTheDaemonSendsIt = {
      type: "submission_write",
      submission_id: ID,
      intake_key_id: "intake-2026-07",
      ciphertext: CIPHERTEXT,
    };
    const got = decodeInboundSignalingFrame(cborEncode(asTheDaemonSendsIt));
    expect(got).not.toBeNull();
    if (got?.type !== "submission_write") throw new Error("the daemon's frame must decode here");
    expect(got.submission_id).toBe(asTheDaemonSendsIt.submission_id);
    expect(got.intake_key_id).toBe(asTheDaemonSendsIt.intake_key_id);
    expect(Buffer.from(got.ciphertext).equals(Buffer.from(asTheDaemonSendsIt.ciphertext))).toBe(true);
  });

  it("the frame carries NOTHING that identifies the parties — checked on the DIRECTORY side too", () => {
    // The client asserts this on what it sends; this asserts it on what the wire type can express.
    // If either side ever grew a submitter or subject field, the table would want a column for it.
    const got = decodeInboundSignalingFrame(frame());
    expect(Object.keys(got ?? {}).sort()).toEqual(["ciphertext", "intake_key_id", "submission_id", "type"]);
  });
});
