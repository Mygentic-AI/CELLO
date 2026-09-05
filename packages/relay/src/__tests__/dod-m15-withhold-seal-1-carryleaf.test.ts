/**
 * 034-CARRYLEAF / `DOD-M15-WITHHOLD-SEAL-1` (relay half) — a participant may witness what they
 * RECEIVED.
 *
 * ─── The attack this closes, from the operator's chair ─────────────────────────────────────────
 *
 * Somebody says something to you — an injection attempt, a wallet drain — and then wants the paper
 * trail not to contain it. They send it to you directly and never ask the relay to witness it. The
 * relay's account of the conversation genuinely ends one message earlier than yours does, so when
 * you seal, the receipt you get ends there too. **Every leaf validly signed, nothing false, the
 * last thing said simply absent.**
 *
 * ─── Why it worked, and it is one conjunct ─────────────────────────────────────────────────────
 *
 * `submitMessageHash` had exactly ONE production caller, on the send path — nothing ever witnessed
 * a message that was RECEIVED. And the relay enforced that: it required the leaf's signer to be the
 * submitting connection's own key, so only an author could witness their own leaf. An author who
 * declined simply removed themselves from the record.
 *
 * The relay was already in a position to close it. `witnessLeafSignature` verifies a leaf against
 * BOTH participants' keys, so the relay establishes who AUTHORED a leaf independently of who
 * DELIVERED it. **You hold their signature. You cannot forge it and they cannot disown it.** So you
 * hand it over, and the relay checks it exactly as it checks their own submissions.
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import { randomBytes } from "node:crypto";
import { computeGenesisPrevRoot } from "@cello-protocol/protocol-types";
import { submitHarness } from "./helpers/relay-submit-harness.js";

setupV3Tests();

/** The value a `last_seen_seq` of 0 acknowledges, derived exactly as both participants derive it. */
function genesisOf(h: { pubA: Uint8Array; pubB: Uint8Array; sessionId: Uint8Array; sessionTimestamp: number }): Uint8Array {
  return computeGenesisPrevRoot(h.pubA, h.pubB, h.sessionId, h.sessionTimestamp);
}

describe("034-CARRYLEAF: a withheld message can be witnessed by the party who received it", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★★ B witnesses a leaf A AUTHORED and never submitted — the withholding attack, closed", async () => {
    /**
     * The load-bearing test of the whole line. Restore the `senderPubkeyHex !== signerHex` conjunct
     * in `relay-node.ts` and this reddens with `sender_mismatch`.
     *
     * ⚠️ IT ASSERTS THE OUTCOME, NOT THAT SOMETHING WAS ACCEPTED. The point is not that the frame
     * was admitted — it is that the withheld message now OCCUPIES A CANONICAL POSITION, which is
     * the thing a truncated seal was exploiting the absence of. So the sequence number is named.
     */
    const h = await submitHarness(scope);
    const genesis = genesisOf(h);

    // A speaks once, honestly, so the conversation has a witnessed position 1.
    const first = await h.submit({ contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesis });
    expect(first["type"], `precondition — A's honest submit must be witnessed: ${JSON.stringify(first["reason"])}`).toBe("hash_submit_ack");

    // A now says something and WITHHOLDS it: the leaf is signed by A and never submitted by A.
    // B received it, holds A's signature over it, and hands it to the relay.
    const withheld = new Uint8Array(randomBytes(32));
    const rescued = await h.submitAsB({
      contentHash: withheld,
      lastSeenSeq: 0,
      timestamp: Date.now(),
      lastSeenHash: genesis,
      authorKp: h.clientA,
    });

    expect(
      rescued["type"],
      `B must be able to witness what B received: ${JSON.stringify(rescued["reason"])}`,
    ).toBe("hash_submit_ack");
    expect(
      rescued["sequence_number"],
      "and it must take a REAL canonical position — that is what a truncated seal was exploiting the absence of",
    ).toBe(2);
  });

  it("★ the leaf must still name its own signer — a counter-submit is not a licence to forge", async () => {
    /**
     * The relaxation is narrow and this is the half that proves it. `s1PubkeyHex === signerHex` is
     * still unconditional: a leaf whose named sender is not the key its signature verifies under is
     * refused, whoever submitted it.
     *
     * Here B signs the leaf with B's own key but the frame CLAIMS A wrote it — a forgery attempt
     * riding the new path. `makeS1` takes the pubkey from the signing key, so the mismatch is built
     * by signing as B while the harness names B... which is the honest self-submit. The forgery this
     * asserts against is the one the code can actually see: a signature by a key that is not a
     * participant at all.
     */
    const h = await submitHarness(scope);
    const { generateKeypair } = await import("@cello-protocol/crypto");
    const stranger = generateKeypair();

    const forged = await h.submitAsB({
      contentHash: new Uint8Array(randomBytes(32)),
      lastSeenSeq: 0,
      timestamp: Date.now(),
      lastSeenHash: genesisOf(h),
      authorKp: stranger,
    });
    expect(forged["type"]).toBe("hash_submit_error");
    expect(
      forged["reason"],
      "a leaf signed by nobody in this conversation is refused whoever hands it over",
    ).toBe("leaf_signed_by_neither_participant");
  });

  it("★★ a counter-submit may NOT replay a leaf the relay already holds", async () => {
    /**
     * ⚠️ **THE VECTOR THE RELAXATION WOULD OTHERWISE OPEN, and it is why this test exists at all.**
     *
     * Structure 1 binds the author, the content and the session — it does NOT bind a position. So
     * without this guard a participant could re-submit a message their counterparty legitimately
     * sent earlier and consume a SECOND canonical position with it: a duplicate the author really
     * did sign, at a place they never sent it, and cannot disown.
     *
     * The assertion is on the counter, not just the refusal: a refused submit that still advanced
     * the sequence would leave a hole the honest party could never close.
     */
    const h = await submitHarness(scope);
    const genesis = genesisOf(h);
    const content = new Uint8Array(randomBytes(32));

    const honest = await h.submit({ contentHash: content, lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesis });
    expect(honest["sequence_number"]).toBe(1);

    // B replays A's leaf — same author, same content, new timestamp so the bytes differ.
    const replay = await h.submitAsB({
      contentHash: content,
      lastSeenSeq: 0,
      timestamp: Date.now() + 1000,
      lastSeenHash: genesis,
      authorKp: h.clientA,
    });
    expect(replay["type"]).toBe("hash_submit_error");
    expect(replay["reason"]).toBe("counter_submit_duplicate");

    // NO POSITION CONSUMED.
    const next = await h.submit({ contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesis });
    expect(next["sequence_number"], "the refused replay must not have eaten position 2").toBe(2);
  });

  it("★ a SELF-submit of identical content is still two messages, not a duplicate", async () => {
    /**
     * The guard above must not leak into the author's own path. Sending the same words twice in one
     * conversation is two messages — deduplicating them there would silently swallow the second,
     * which is a worse defect than the one being fixed, and it is the trap `DOD-M15-SUBMIT-ID-1`
     * already recorded.
     */
    const h = await submitHarness(scope);
    const genesis = genesisOf(h);
    const content = new Uint8Array(randomBytes(32));

    const one = await h.submit({ contentHash: content, lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesis });
    const two = await h.submit({ contentHash: content, lastSeenSeq: 0, timestamp: Date.now() + 1, lastSeenHash: genesis });
    expect(one["sequence_number"]).toBe(1);
    expect(two["sequence_number"], "the author's own repeat is a second message and takes a second position").toBe(2);
  });
});
