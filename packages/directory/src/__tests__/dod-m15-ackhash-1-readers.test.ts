/**
 * 020-ACKHASH — every server-side reader tolerates the v2 Structure 1, and NOTHING emits one.
 *
 * ─── What breaks without this, stated as the operator meets it ─────────────────────────────────
 *
 * `last_seen_seq` is a NUMBER. "I saw position 7" attests to a POSITION and never to CONTENT, so an
 * acknowledgement today says where the sender was, not what they read. `last_seen_hash` binds it to
 * the bytes. Adding it is a WIRE change, and a wire change shipped writer-first is an outage: a
 * client that appends a field has every message refused as `signature_invalid` by a relay that
 * predates it. `DOD-M15-SUBMIT-ID-1` recorded exactly that. So the readers ship first, alone.
 *
 * ─── The collision, which is why these tests are about the VERSION and not the length ──────────
 *
 * `SUBMIT-ID-1` already reserved index 6 for a sender-minted submission id and already widened the
 * relay to six-OR-seven fields. `last_seen_hash` lands at the same index. A seven-field array
 * therefore has two meanings, and both are bytes — so `arr.length` cannot separate them and
 * `arr[0]` must. The sharpest case is a v1 seven-array whose submission id happens to be 32 bytes:
 * indistinguishable from a v2 by every check except the version tag.
 *
 * The load-bearing tests here are the REFUSALS and the v1/7 regression. A tolerance test that only
 * walks the happy path stays green under the one mutation that would break the deployed fleet.
 */
import { describe, it, expect } from "vitest";
import { Encoder } from "cbor-x";
import { generateKeypair } from "@cello-protocol/crypto";
import { decodeStructure1Fields } from "../directory-node.js";
import { verifyLeafProvenance, SEAL_FINAL_ROOT_REASONS } from "../seal-final-root.js";
import { buildSealLegibility } from "../seal-legibility.js";
import { buildSeal, type Kp } from "./helpers/seal-fixture.js";

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

// ─── The directory ────────────────────────────────────────────────────────────

describe("020-ACKHASH: the directory's decodeStructure1Fields accepts seven fields at all", () => {
  it("v1 six-array: unchanged", () => {
    const f = decodeStructure1Fields(v1Six());
    expect(f).not.toBeNull();
    expect(f!.last_seen_seq).toBe(3);
    expect(f!.last_seen_hash).toBeUndefined();
  });

  it("a v1 seven-array now decodes — it was refused outright before this unit", () => {
    // The relay accepts and ORDERS a SUBMIT-ID leaf; the directory then could not verify it at seal
    // time, because `length !== 6` refused it. That gap closes here, ahead of any emitter.
    const f = decodeStructure1Fields(v1Seven(new Uint8Array(16).fill(0x5b)));
    expect(f).not.toBeNull();
    expect(f!.last_seen_hash).toBeUndefined();
  });

  it("v2 seven-array: the ack hash reads, and the fields at unchanged indices are unchanged", () => {
    const f = decodeStructure1Fields(v2Seven(LAST_SEEN_HASH));
    expect(f).not.toBeNull();
    expect(Buffer.from(f!.content_hash).toString("hex")).toBe(Buffer.from(CONTENT_HASH).toString("hex"));
    expect(Buffer.from(f!.session_id).toString("hex")).toBe(Buffer.from(SESSION_ID).toString("hex"));
    expect(f!.last_seen_seq).toBe(3);
    expect(Buffer.from(f!.last_seen_hash!).toString("hex")).toBe(Buffer.from(LAST_SEEN_HASH).toString("hex"));
  });

  it("refuses an unnamed shape, and a malformed ack hash", () => {
    expect(decodeStructure1Fields(s1(2, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP))).toBeNull();
    expect(decodeStructure1Fields(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP))).toBeNull();
    expect(decodeStructure1Fields(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, 9))).toBeNull();
    expect(decodeStructure1Fields(v2Seven(new Uint8Array(31)))).toBeNull();
  });
});

// ─── The two seal readers, through their real entry points ────────────────────

describe("020-ACKHASH: the seal readers behave identically on a v2 leaf set", () => {
  const sessionId = new Uint8Array(16).fill(0x42);

  async function pair(): Promise<[Kp, Kp, Uint8Array, Uint8Array]> {
    const a = generateKeypair();
    const b = generateKeypair();
    return [a, b, new Uint8Array(await a.getPublicKey()), new Uint8Array(await b.getPublicKey())];
  }

  it("verifyLeafProvenance accepts a v2 leaf set exactly as it accepts the v1 one", async () => {
    // seal-final-root reads content_hash (index 1) and session_id (index 3) out of the SIGNED bytes.
    // Both indices are unchanged in v2, so the verdict must be identical.
    const [a, b, pubA, pubB] = await pair();
    const specs = [
      { key: a, kind: "msg" as const },
      { key: b, kind: "msg" as const },
      { key: a, kind: "ctrl" as const, carries: true },
      { key: b, kind: "ctrl" as const, carries: true },
    ];
    const v1 = await buildSeal(specs, sessionId);
    const v2 = await buildSeal(specs.map((s) => ({ ...s, lastSeenHash: LAST_SEEN_HASH })), sessionId);

    expect(verifyLeafProvenance(v1.leaves, sessionId, [pubA, pubB])).toEqual({ ok: true });
    expect(verifyLeafProvenance(v2.leaves, sessionId, [pubA, pubB])).toEqual({ ok: true });
  });

  it("verifyLeafProvenance REFUSES a leaf whose Structure 1 layout it cannot name", async () => {
    // The revert test for the version branch: without it, an unnamed layout is coerced into the
    // nearest known one and this stays green.
    const [a, b, pubA, pubB] = await pair();
    const bad = await buildSeal(
      [
        { key: a, kind: "msg" as const },
        { key: b, kind: "msg" as const, protocolVersion: 3 },
        { key: a, kind: "ctrl" as const, carries: true },
        { key: b, kind: "ctrl" as const, carries: true },
      ],
      sessionId,
    );
    const verdict = verifyLeafProvenance(bad.leaves, sessionId, [pubA, pubB]);
    expect(verdict.ok).toBe(false);
    /**
     * NAME THE REASON — `ok === false` alone would be satisfied by a refusal for some unrelated
     * cause, which is not what this test claims to be about. The leaf is signed by a real
     * participant, so the only thing wrong with it is that its Structure 1 layout has no name here.
     *
     * ⚠️ AND THE REASON CODE IS MISLABELLED, WHICH IS WHY THE DETAIL IS ASSERTED TOO. `PAYLOAD_MALFORMED`
     * is documented as "the payload bytes are not a decodable SEAL payload" — but nothing here looked
     * at a SEAL payload; the STRUCTURE 1 failed to decode. The `detail` string says so correctly. This
     * is pre-existing (`seal-final-root.ts`, the `s1 === null` branch) and 020-ACKHASH only widens what
     * reaches it, so it is recorded under the order's *Newly discovered* rather than renamed here —
     * a new reason code ripples into SEAL_FINAL_ROOT_GUIDANCE and its consumers. Asserting the detail
     * means this test still fails if the branch stops being about Structure 1 at all.
     */
    if (verdict.ok) return;
    expect(verdict.reason).toBe(SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED);
    expect(verdict.detail).toContain("structure1_cbor is not decodable");
  });

  it("buildSealLegibility derives the SAME signed frontier from a v2 leaf as from a v1 one", async () => {
    // seal-legibility reads last_seen_seq at index 4. 020-ACKHASH appended at 6, so the read did not
    // move — and the derived content_frontier_seq must be byte-for-byte the same number.
    const [a, b] = await pair();
    const specs = [
      { key: a, kind: "msg" as const, lastSeenSeq: 0 },
      { key: b, kind: "msg" as const, lastSeenSeq: 1 },
      { key: a, kind: "ctrl" as const, carries: true, lastSeenSeq: 2 },
      { key: b, kind: "ctrl" as const, carries: true, lastSeenSeq: 3 },
    ];
    const v1 = buildSealLegibility((await buildSeal(specs, sessionId)).leaves);
    const v2 = buildSealLegibility(
      (await buildSeal(specs.map((s) => ({ ...s, lastSeenHash: LAST_SEEN_HASH })), sessionId)).leaves,
    );

    const frontiers = (l: typeof v1): number[] => l.participants.map((p) => p.content_frontier_seq);
    expect(frontiers(v2)).toEqual(frontiers(v1));
    // Named, not just "equal to itself": the frontier is the max SIGNED last_seen_seq per party.
    expect(frontiers(v1).sort((x, y) => x - y)).toEqual([2, 3]);
  });

  it("buildSealLegibility yields NO frontier from a leaf whose layout it cannot name", async () => {
    // A shape this build cannot interpret must not have a number lifted out of it and published as
    // a signed frontier — the fail-open the old `length < 5` check allowed.
    const [a, b] = await pair();
    const seal = await buildSeal(
      [
        { key: a, kind: "msg" as const, lastSeenSeq: 5, protocolVersion: 9 },
        { key: b, kind: "msg" as const, lastSeenSeq: 1 },
        { key: a, kind: "ctrl" as const, carries: true },
        { key: b, kind: "ctrl" as const, carries: true },
      ],
      sessionId,
    );
    const leg = buildSealLegibility(seal.leaves);
    const pubA = Buffer.from(await a.getPublicKey());
    const forA = leg.participants.find((p) => Buffer.from(p.pubkey).equals(pubA));
    expect(forA).toBeDefined();
    /**
     * NAME THE VALUE, not "it did not equal 5". A's two signed leaves are the v9 msg declaring
     * last_seen_seq 5 — refused, because this build cannot name that layout — and its ctrl leaf
     * declaring 0. So the honest frontier is exactly 0. `not.toBe(5)` would also pass for a decoder
     * that returned some other wrong number, or that skipped A entirely.
     */
    expect(forA!.content_frontier_seq).toBe(0);
  });
});

// ─── The canonical timestamp encoding, which no server-side test had ever seen ─

describe("020-ACKHASH: a uint64 timestamp decodes exactly as the legacy float64 one", () => {
  /**
   * THIS IS THE ENCODING PRODUCTION NOW EMITS ON EVERY FRAME, AND NOTHING HERE HAD EVER DECODED ONE
   * — review F5.
   *
   * Deleting the daemon's duplicate `encodeStructure1` moved the wire timestamp from a CBOR float64
   * to a uint64: the local copy passed `Date.now()` straight through, while the published encoder
   * promotes anything above 2^32-1 to a BigInt, which is what the canonical vector has always
   * pinned. Both decoders accept `number | bigint` and neither reads the value, so the change is
   * inert — but "inert by inspection, untested" is the wrong place to stand on a wire change, and
   * every fixture in this repo still builds the float64 form.
   */
  it("the relay and directory read identical fields from both encodings", () => {
    const asFloat = decodeStructure1Fields(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP));
    const asUint = decodeStructure1Fields(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, BigInt(TIMESTAMP)));
    expect(asFloat).not.toBeNull();
    expect(asUint).not.toBeNull();
    // Name the encodings, so this test fails if either side stops being what it claims to be.
    expect(typeof asFloat!.timestamp).toBe("number");
    expect(typeof asUint!.timestamp).toBe("bigint");
    // Every field the directory actually consumes is identical across the two.
    expect(Buffer.from(asUint!.content_hash).toString("hex")).toBe(Buffer.from(asFloat!.content_hash).toString("hex"));
    expect(asUint!.last_seen_seq).toBe(asFloat!.last_seen_seq);
    expect(Number(asUint!.timestamp)).toBe(Number(asFloat!.timestamp));
  });

  it("a v2 claim carrying the canonical uint64 timestamp still yields its ack hash", () => {
    const f = decodeStructure1Fields(
      s1(2, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, BigInt(TIMESTAMP), LAST_SEEN_HASH),
    );
    expect(f).not.toBeNull();
    expect(typeof f!.timestamp).toBe("bigint");
    expect(Buffer.from(f!.last_seen_hash!).toString("hex")).toBe(Buffer.from(LAST_SEEN_HASH).toString("hex"));
  });
});
