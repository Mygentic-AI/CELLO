/**
 * The server-side readers of Structure 1 — ONE LAYOUT, both chain links required.
 *
 * ─── What this file used to be, and why it changed ─────────────────────────────────────────────
 *
 * It was `020-ACKHASH`'s reader-tolerance suite: prove the directory accepts a v1 six-array, a v1
 * seven-array carrying a submission id, AND a v2 seven-array carrying an ack hash, so that a client
 * could later start emitting the new field without every message being refused by a relay that
 * predated it. Reader-before-writer, which is the right discipline when there are deployed clients.
 *
 * `035-SELFCHAIN` removed the reason for it. CELLO is alpha with no users, backward compatibility
 * is an anti-requirement (Andre, 2026-09-05), and every layout but one is deleted on both sides at
 * once. So the tolerance tests are gone — a tolerance that no longer exists is not coverage — and
 * what remains asserts the rule that replaced them:
 *
 *   `[3, content_hash(32), sender_pubkey(32), session_id(16), last_seen_seq, timestamp,
 *       last_seen_hash(32), prev_own_hash(32)]`
 *
 * ─── What is still load-bearing here ───────────────────────────────────────────────────────────
 *
 *   - An unnamed (version, length) pair is REFUSED, never coerced into the nearest known shape. A
 *     signature verified over bytes whose meaning is not agreed is worse than no signature.
 *   - A present-but-malformed link is refused, never dropped. A 31-byte hash is not "no hash".
 *   - The two seal readers reach the same verdicts through their real entry points, and neither
 *     lifts a number out of a leaf it could not read.
 *   - Both CBOR timestamp encodings decode. Production emits uint64; every older fixture emits
 *     float64; neither side reads the value, and "inert by inspection" is the wrong place to stand
 *     on a wire field.
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
const PREV_OWN_HASH = new Uint8Array(32).fill(0xb4);
const TIMESTAMP = 1_700_000_000_000;

/** A Structure 1 built field-by-field, so shapes our own encoder refuses to build can still be read. */
const s1 = (...fields: unknown[]): Uint8Array => ENC.encode(fields) as Uint8Array;

/** A well-formed claim in the one layout, with one field overridable per call. */
const good = (over: Partial<{ version: unknown; tail6: unknown; tail7: unknown }> = {}): Uint8Array =>
  s1(
    over.version ?? 3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP,
    over.tail6 ?? LAST_SEEN_HASH, over.tail7 ?? PREV_OWN_HASH,
  );

describe("the directory reads ONE Structure 1 layout, and refuses everything else", () => {
  it("★ the one layout decodes, and every field comes back at the index it was signed at", () => {
    const f = decodeStructure1Fields(good());
    expect(f).not.toBeNull();
    expect(Buffer.from(f!.content_hash).toString("hex")).toBe(Buffer.from(CONTENT_HASH).toString("hex"));
    expect(Buffer.from(f!.session_id).toString("hex")).toBe(Buffer.from(SESSION_ID).toString("hex"));
    expect(f!.last_seen_seq).toBe(3);
    /**
     * ASSERTED SEPARATELY, AND WITH DIFFERENT VALUES ON PURPOSE. The two links are both 32 bytes and
     * sit side by side, so a decoder that read them in the other order would return a perfectly
     * well-shaped result. Only distinct values can tell the two apart.
     */
    expect(Buffer.from(f!.last_seen_hash).toString("hex")).toBe(Buffer.from(LAST_SEEN_HASH).toString("hex"));
    expect(Buffer.from(f!.prev_own_hash).toString("hex")).toBe(Buffer.from(PREV_OWN_HASH).toString("hex"));
  });

  it("★★★ the DELETED layouts are refused — this is the revert test for the whole unit", () => {
    /**
     * Each of these was accepted before `035-SELFCHAIN` and must not be any more. They are listed
     * one per line rather than in a loop so a failure names which shape crept back.
     */
    // The six-field claim with no acknowledgement at all.
    expect(decodeStructure1Fields(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP))).toBeNull();
    // The v1 seven-array whose index 6 was a sender-minted submission id.
    expect(decodeStructure1Fields(s1(1, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, new Uint8Array(16).fill(0x5b)))).toBeNull();
    // The v2 seven-array carrying only the acknowledgement link.
    expect(decodeStructure1Fields(s1(2, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH))).toBeNull();
  });

  it("★★ an unnamed (version, length) pair is refused rather than coerced", () => {
    // Right arity, wrong tag: a future layout, or a peer that means something else by these bytes.
    expect(decodeStructure1Fields(good({ version: 4 }))).toBeNull();
    // Right tag, wrong arity: eight fields is the shape, and nine is not it.
    expect(decodeStructure1Fields(s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, TIMESTAMP, LAST_SEEN_HASH, PREV_OWN_HASH, 0))).toBeNull();
  });

  it("★★ a PRESENT-BUT-MALFORMED link is refused, never dropped — each one separately", () => {
    /**
     * The distinction that matters: dropping a bad link would make a corrupt claim look like an
     * honest one that never carried the field, which is exactly the confusion a required field
     * removes. Both positions are checked, because a reader that validated only one would pass
     * this test with half the guard deleted.
     */
    expect(decodeStructure1Fields(good({ tail6: new Uint8Array(31) })), "short ack link").toBeNull();
    expect(decodeStructure1Fields(good({ tail6: 9 })), "ack link is not bytes at all").toBeNull();
    expect(decodeStructure1Fields(good({ tail7: new Uint8Array(31) })), "short self link").toBeNull();
    expect(decodeStructure1Fields(good({ tail7: 9 })), "self link is not bytes at all").toBeNull();
  });
});

// ─── The two seal readers, through their real entry points ────────────────────

describe("the seal readers, through their real entry points", () => {
  const sessionId = new Uint8Array(16).fill(0x42);

  async function pair(): Promise<[Kp, Kp, Uint8Array, Uint8Array]> {
    const a = generateKeypair();
    const b = generateKeypair();
    return [a, b, new Uint8Array(await a.getPublicKey()), new Uint8Array(await b.getPublicKey())];
  }

  it("verifyLeafProvenance accepts an honest leaf set — it reads indices the links did not move", async () => {
    // seal-final-root reads content_hash (index 1) and session_id (index 3) out of the SIGNED bytes.
    // Both links were APPENDED, so neither index moved, and the verdict must be unaffected by what
    // the links hold. Asserted with the default links and with a stated one, which is the whole
    // claim: this reader does not care.
    const [a, b, pubA, pubB] = await pair();
    const specs = [
      { key: a, kind: "msg" as const },
      { key: b, kind: "msg" as const },
      { key: a, kind: "ctrl" as const, carries: true },
      { key: b, kind: "ctrl" as const, carries: true },
    ];
    const plain = await buildSeal(specs, sessionId);
    const stated = await buildSeal(specs.map((s) => ({ ...s, lastSeenHash: LAST_SEEN_HASH })), sessionId);

    expect(verifyLeafProvenance(plain.leaves, sessionId, [pubA, pubB])).toEqual({ ok: true });
    expect(verifyLeafProvenance(stated.leaves, sessionId, [pubA, pubB])).toEqual({ ok: true });
  });

  it("verifyLeafProvenance REFUSES a leaf whose Structure 1 layout it cannot name", async () => {
    // The revert test for the version branch: without it, an unnamed layout is coerced into the
    // nearest known one and this stays green.
    const [a, b, pubA, pubB] = await pair();
    const bad = await buildSeal(
      [
        { key: a, kind: "msg" as const },
        { key: b, kind: "msg" as const, protocolVersion: 4 },
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

  it("buildSealLegibility derives the SAME signed frontier whatever the links hold", async () => {
    // seal-legibility reads last_seen_seq at index 4. Both links were APPENDED after it, so the read
    // did not move — and the derived content_frontier_seq must be the same number either way.
    const [a, b] = await pair();
    const specs = [
      { key: a, kind: "msg" as const, lastSeenSeq: 0 },
      { key: b, kind: "msg" as const, lastSeenSeq: 1 },
      { key: a, kind: "ctrl" as const, carries: true, lastSeenSeq: 2 },
      { key: b, kind: "ctrl" as const, carries: true, lastSeenSeq: 3 },
    ];
    const plain = buildSealLegibility((await buildSeal(specs, sessionId)).leaves);
    const stated = buildSealLegibility(
      (await buildSeal(specs.map((s) => ({ ...s, lastSeenHash: LAST_SEEN_HASH })), sessionId)).leaves,
    );

    const frontiers = (l: typeof plain): number[] => l.participants.map((p) => p.content_frontier_seq);
    expect(frontiers(stated)).toEqual(frontiers(plain));
    // Named, not just "equal to itself": the frontier is the max SIGNED last_seen_seq per party.
    expect(frontiers(plain).sort((x, y) => x - y)).toEqual([2, 3]);
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

describe("a uint64 timestamp decodes exactly as the legacy float64 one", () => {
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
    const asFloat = decodeStructure1Fields(good());
    const asUint = decodeStructure1Fields(
      s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, BigInt(TIMESTAMP), LAST_SEEN_HASH, PREV_OWN_HASH),
    );
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

  it("a uint64 timestamp does not disturb the two links that follow it", () => {
    // The links sit AFTER the timestamp, so a decoder that mis-sized a bigint would take the next
    // field with it. Both are read back and compared, which is what makes this more than a shape check.
    const f = decodeStructure1Fields(
      s1(3, CONTENT_HASH, SENDER_PUBKEY, SESSION_ID, 3, BigInt(TIMESTAMP), LAST_SEEN_HASH, PREV_OWN_HASH),
    );
    expect(f).not.toBeNull();
    expect(typeof f!.timestamp).toBe("bigint");
    expect(Buffer.from(f!.last_seen_hash).toString("hex")).toBe(Buffer.from(LAST_SEEN_HASH).toString("hex"));
    expect(Buffer.from(f!.prev_own_hash).toString("hex")).toBe(Buffer.from(PREV_OWN_HASH).toString("hex"));
  });
});
