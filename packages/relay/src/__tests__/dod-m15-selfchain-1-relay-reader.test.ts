/**
 * `DOD-M15-SELFCHAIN-1` — the relay reads ONE Structure 1 layout, with BOTH chain links required.
 *
 * ─── What replaced what ────────────────────────────────────────────────────────────────────────
 *
 * This file replaces `dod-m15-ackhash-1-relay-reader.test.ts`, which existed to pin that the
 * VERSION and not the array length decided the meaning of index 6. There were three layouts and
 * index 6 had two possible meanings, so that distinction was load-bearing.
 *
 * There is now one layout and index 6 has one meaning, so the distinction is gone along with the
 * layouts. CELLO is alpha with no users and backward compatibility is an anti-requirement
 * (Andre, 2026-09-05), so the tolerances were deleted rather than carried:
 *
 *   - the six-field claim with no acknowledgement;
 *   - the seven-field claim carrying `last_seen_hash`;
 *   - the seven-field claim whose index 6 was a sender-minted submission id — relay tolerance for a
 *     client that never shipped.
 *
 * The tests that pinned those tolerances are deleted with them. What is kept, and extended, is the
 * half that still means something: every shape that is NOT the one layout must be refused.
 *
 * ─── The refusals are the load-bearing half ────────────────────────────────────────────────────
 *
 * A decoder test that only walks the happy path stays green under the mutation that matters —
 * widening the arity check, or dropping a link's width check so a malformed hash reads as absent.
 */
import { describe, it, expect } from "vitest";
import { Encoder } from "cbor-x";
import { decodeStructure1 } from "../relay-node.js";

const ENC = new Encoder({ tagUint8Array: false, useRecords: false });

const CONTENT_HASH = new Uint8Array(32).fill(0xcc);
const SENDER_PUBKEY = new Uint8Array(32).fill(0xdd);
const SESSION_ID = new Uint8Array(16).fill(0xee);
const LAST_SEEN_HASH = new Uint8Array(32).fill(0xa7);
const PREV_OWN_HASH = new Uint8Array(32).fill(0xb4);
const TIMESTAMP = 1_700_000_000_000;

/** A Structure 1 built field-by-field, so shapes our own encoder refuses to build can still be read. */
const s1 = (...fields: unknown[]): Uint8Array => ENC.encode(fields) as Uint8Array;

const good = (): Uint8Array =>
  s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH);

describe("the relay reads one layout, and both chain links are required", () => {
  it("reads every field of the one layout", () => {
    const f = decodeStructure1(good());
    expect(f).not.toBeNull();
    expect(f!.protocol_version).toBe(3);
    expect(Buffer.from(f!.content_hash).toString("hex")).toBe("cc".repeat(32));
    expect(Buffer.from(f!.sender_pubkey).toString("hex")).toBe("dd".repeat(32));
    expect(Buffer.from(f!.session_id).toString("hex")).toBe("ee".repeat(16));
    expect(f!.last_seen_seq).toBe(3);
    expect(Buffer.from(f!.last_seen_hash).toString("hex")).toBe("a7".repeat(32));
    expect(Buffer.from(f!.prev_own_hash).toString("hex")).toBe("b4".repeat(32));
  });

  it("keeps the two links apart — the counterparty link and the self link are different fields", () => {
    // Two 32-byte hashes side by side is where a reader transposes them and every other test still
    // passes. Distinct fill bytes are what make a transposition visible at all.
    const f = decodeStructure1(good());
    expect(Buffer.from(f!.last_seen_hash).toString("hex"))
      .not.toBe(Buffer.from(f!.prev_own_hash).toString("hex"));
  });

  it("REFUSES every arity that is not eight — including the three layouts that were deleted", () => {
    const shapes: Array<[string, Uint8Array]> = [
      ["six-field, no acknowledgement", s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP)],
      ["seven-field ack-hash claim", s1(2, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH)],
      ["seven-field submission-id claim", s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, new Uint8Array(16).fill(0x5b))],
      ["nine fields", s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH, 1)],
      ["empty array", s1()],
    ];
    for (const [what, bytes] of shapes) {
      expect(decodeStructure1(bytes), what).toBeNull();
    }
  });

  it("REFUSES eight fields under any other domain tag — arity alone is never enough", () => {
    for (const tag of [0, 1, 2, 4, "3", null, undefined]) {
      const bytes = s1(tag, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH);
      expect(decodeStructure1(bytes), `tag ${String(tag)}`).toBeNull();
    }
  });

  it("REFUSES a wrong-width link — present-but-malformed is never dropped to absent", () => {
    /**
     * The fail-open this guards: if a malformed hash read as "no hash", a sender could downgrade to
     * an unchecked claim by sending junk in the field. Both links, independently, because a reader
     * that validated them in one place would leave one of them open.
     */
    for (const bad of [new Uint8Array(31), new Uint8Array(33), new Uint8Array(0)]) {
      expect(decodeStructure1(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, bad, PREV_OWN_HASH)), "ack link").toBeNull();
      expect(decodeStructure1(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, bad)), "self link").toBeNull();
    }
  });

  it("REFUSES a link that is not bytes at all", () => {
    expect(decodeStructure1(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, 7, PREV_OWN_HASH))).toBeNull();
    expect(decodeStructure1(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, "b4"))).toBeNull();
  });

  it("REFUSES malformed fields at indices 1-5, and never throws on any of them", () => {
    const cases: Array<[string, Uint8Array]> = [
      ["short content hash", s1(3, new Uint8Array(31), SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH)],
      ["short sender pubkey", s1(3, CONTENT_HASH, new Uint8Array(31), SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH)],
      ["wrong-width session id", s1(3, CONTENT_HASH, SENDER_PUBKEY, new Uint8Array(15), 3, TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH)],
      ["non-numeric last_seen_seq", s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, "3", TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH)],
      ["non-numeric timestamp", s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, "now", LAST_SEEN_HASH, PREV_OWN_HASH)],
    ];
    for (const [what, bytes] of cases) {
      expect(decodeStructure1(bytes), what).toBeNull();
    }
  });

  it("REFUSES non-CBOR and non-array input by returning null, never by throwing", () => {
    // These bytes arrive off a wire. A throw here escapes into the stream handler and takes down
    // every session on the connection.
    expect(decodeStructure1(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeNull();
    expect(decodeStructure1(ENC.encode({ version: 3 }) as Uint8Array)).toBeNull();
    expect(decodeStructure1(new Uint8Array(0))).toBeNull();
  });

  it("accepts a bigint timestamp and a plain number alike", () => {
    const asBigint = decodeStructure1(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, BigInt(TIMESTAMP), LAST_SEEN_HASH, PREV_OWN_HASH));
    expect(asBigint).not.toBeNull();
    expect(decodeStructure1(good())).not.toBeNull();
  });
});
