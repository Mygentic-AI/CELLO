/**
 * 020-ACKHASH — the RELAY tolerates a v2 Structure 1, and the version is what decides index 6.
 *
 * `DOD-M15-SUBMIT-ID-1` already widened this decoder to six-OR-seven fields, reserving index 6 for
 * a sender-minted submission id, and shipped that tolerance ahead of any emitter. `last_seen_hash`
 * lands at the SAME index. So a seven-field array now has two meanings, both of them bytes, and
 * `arr.length` cannot separate them — `arr[0]` must.
 *
 * Until this unit the decoder accepted ANY numeric version and validated index 6 only as a
 * submission id. A 32-byte ack hash passes that validation, so a v2 claim would have been ingested
 * with its hash filed as a submission id — accepted, ordered, and silently wrong.
 *
 * The load-bearing cases here are the refusals and the v1 seven-array. A tolerance test that only
 * walks the happy path stays green under the exact mutation that breaks the deployed fleet.
 */
import { describe, it, expect } from "vitest";
import { Encoder } from "cbor-x";
import { decodeStructure1 } from "../relay-node.js";

const ENC = new Encoder({ tagUint8Array: false, useRecords: false });

const CONTENT_HASH = new Uint8Array(32).fill(0xcc);
const SENDER_PUBKEY = new Uint8Array(32).fill(0xdd);
const SESSION_ID = new Uint8Array(16).fill(0xee);
const LAST_SEEN_HASH = new Uint8Array(32).fill(0xa7);
const TIMESTAMP = 1_700_000_000_000;

/** A Structure 1 built field-by-field, so shapes our own encoder refuses to build can still be read. */
const s1 = (...fields: unknown[]): Uint8Array => ENC.encode(fields) as Uint8Array;

const v1Six = (): Uint8Array => s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP);
const v1Seven = (tail: unknown): Uint8Array => s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, tail);
const v2Seven = (tail: unknown): Uint8Array => s1(2, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, tail);

// ─── The relay ────────────────────────────────────────────────────────────────

describe("020-ACKHASH: the relay's decodeStructure1 branches on the version", () => {
  it("v1 six-array: unchanged — every field reads as it did before", () => {
    const f = decodeStructure1(v1Six());
    expect(f).not.toBeNull();
    expect(f!.protocol_version).toBe(1);
    expect(Buffer.from(f!.content_hash).toString("hex")).toBe(Buffer.from(CONTENT_HASH).toString("hex"));
    expect(Buffer.from(f!.session_id).toString("hex")).toBe(Buffer.from(SESSION_ID).toString("hex"));
    expect(f!.last_seen_seq).toBe(3);
    expect(f!.submission_id).toBeUndefined();
    expect(f!.last_seen_hash).toBeUndefined();
  });

  it("THE REGRESSION: a v1 seven-array still yields a SUBMISSION ID and no ack hash", () => {
    // This is the shape the deployed fleet tolerates. Reading its index 6 as an ack hash, or
    // refusing it outright, breaks every message in flight from a SUBMIT-ID client.
    const f = decodeStructure1(v1Seven(new Uint8Array(16).fill(0x5b)));
    expect(f).not.toBeNull();
    expect(f!.submission_id).toBeDefined();
    expect(f!.submission_id!.length).toBe(16);
    expect(f!.last_seen_hash).toBeUndefined();
  });

  it("a v1 seven-array whose index 6 is 32 bytes is STILL a submission id, not an ack hash", () => {
    // The collision at its sharpest: a width check on index 6 reads this as v2. Only arr[0] does not.
    const f = decodeStructure1(v1Seven(LAST_SEEN_HASH));
    expect(f).not.toBeNull();
    expect(f!.last_seen_hash).toBeUndefined();
    expect(f!.submission_id).toBeDefined();
  });

  it("v2 seven-array: the ack hash is read, and it is NOT filed as a submission id", () => {
    const f = decodeStructure1(v2Seven(LAST_SEEN_HASH));
    expect(f).not.toBeNull();
    expect(f!.protocol_version).toBe(2);
    expect(f!.last_seen_hash).toBeDefined();
    expect(Buffer.from(f!.last_seen_hash!).toString("hex")).toBe(Buffer.from(LAST_SEEN_HASH).toString("hex"));
    expect(f!.submission_id).toBeUndefined();
    // Every index a v1 reader already read is unchanged — the field was appended, not inserted.
    expect(f!.last_seen_seq).toBe(3);
    expect(Number(f!.timestamp)).toBe(TIMESTAMP);
  });

  it("refuses an unnamed shape rather than coercing it to the nearest known one", () => {
    // A v2 that OMITS the hash is the fail-open this layout exists to close: refused as an unknown
    // layout, never degraded to "v1 with a missing field".
    expect(decodeStructure1(s1(2, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP))).toBeNull();
    // An unknown version, at either length. This decoder previously accepted ANY numeric version.
    expect(decodeStructure1(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP))).toBeNull();
    expect(decodeStructure1(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH))).toBeNull();
    // An unknown length: `>= 6` would admit this.
    expect(decodeStructure1(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, 9))).toBeNull();
    expect(decodeStructure1(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3))).toBeNull();
  });

  it("a v2 ack hash that is not exactly 32 bytes is REFUSED, not dropped to undefined", () => {
    // Dropping it would let a sender downgrade to an unchecked acknowledgement by sending junk —
    // present-but-malformed taking a softer path than absent is the hole, one layer down.
    for (const bad of [new Uint8Array(31), new Uint8Array(33), new Uint8Array(0), 7, "beef", null]) {
      expect(decodeStructure1(v2Seven(bad))).toBeNull();
    }
  });
});


// ─── The canonical timestamp encoding, which no relay test had ever seen ──────

describe("020-ACKHASH: a uint64 timestamp decodes exactly as the legacy float64 one", () => {
  /**
   * THIS IS THE ENCODING PRODUCTION NOW EMITS ON EVERY FRAME, AND THIS DECODER HAD NEVER SEEN ONE —
   * review F5.
   *
   * Deleting the daemon's duplicate `encodeStructure1` moved the wire timestamp from a CBOR float64
   * to a uint64: the local copy passed `Date.now()` straight through, while the published encoder
   * promotes anything above 2^32-1 to a BigInt, which is what the canonical vector has always
   * pinned. This decoder's guard is `number | bigint` and nothing reads the value, so the change is
   * inert — but every fixture in this repo still builds the float64 form, so without this the shape
   * the relay now receives on 100% of frames appears in no test at all.
   */
  it("reads identical fields from both encodings", () => {
    const asFloat = decodeStructure1(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP));
    const asUint = decodeStructure1(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, BigInt(TIMESTAMP)));
    expect(asFloat).not.toBeNull();
    expect(asUint).not.toBeNull();
    // Name the encodings, so this fails if either stops being what it claims to be.
    expect(typeof asFloat!.timestamp).toBe("number");
    expect(typeof asUint!.timestamp).toBe("bigint");
    expect(Buffer.from(asUint!.content_hash).toString("hex")).toBe(Buffer.from(asFloat!.content_hash).toString("hex"));
    expect(asUint!.last_seen_seq).toBe(asFloat!.last_seen_seq);
    expect(Number(asUint!.timestamp)).toBe(Number(asFloat!.timestamp));
  });

  it("a v1 seven-array with a uint64 timestamp still yields its submission id", () => {
    // The regression case and the new encoding together — this is exactly what a SUBMIT-ID client
    // running the post-020 encoder puts on the wire.
    const f = decodeStructure1(
      s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, BigInt(TIMESTAMP), new Uint8Array(16).fill(0x5b)),
    );
    expect(f).not.toBeNull();
    expect(typeof f!.timestamp).toBe("bigint");
    expect(f!.submission_id).toBeDefined();
    expect(f!.last_seen_hash).toBeUndefined();
  });
});
