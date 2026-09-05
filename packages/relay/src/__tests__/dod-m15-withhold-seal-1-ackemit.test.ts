/**
 * 033-ACKEMIT / `DOD-M15-WITHHOLD-SEAL-1` (relay half) — the witness checks the acknowledgement.
 *
 * ─── What this stops, from the operator's chair ────────────────────────────────────────────────
 *
 * Somebody says something to you in a conversation and then wants the paper trail not to contain
 * it. They seal one message short. Every leaf validly signed, nothing false, only something
 * missing.
 *
 * ─── Why the relay is in this at all ───────────────────────────────────────────────────────────
 *
 * A sender signs `last_seen_seq`, which is a NUMBER — "I saw position 7" attests to a POSITION and
 * never to CONTENT. Until an emitter existed, the only thing binding a signed acknowledgement to a
 * message was this relay's own receipt over `content_hash ‖ seq ‖ timestamp`, which is exactly why
 * withholding a submit broke it: with no receipt, a signed acknowledgement is an unbacked number.
 *
 * The claim now carries the hash, and it arrives here for free. A `hash_submit` already carries
 * `structure1_cbor` verbatim — the identical signed claim minus the plaintext body — so the witness
 * enforces the chain live rather than on request, with **no new frame and no new wire field**.
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

describe("033-ACKEMIT: the relay refuses an acknowledgement its own record contradicts", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★ a WRONG last_seen_hash is REFUSED BY NAME — and no position is consumed", async () => {
    /**
     * The load-bearing relay test. Revert the comparison in `#handleHashSubmit` and this goes red.
     *
     * ⚠️ IT ASSERTS THE NAME AND THE CONSEQUENCE, NOT "it did not succeed". A refusal for
     * `signature_invalid` or `last_seen_seq_ahead` would also fail a bare `type !== ack` assertion
     * while proving nothing about this check, so the reason is named — and so is the thing the
     * operator would actually notice, which is that the refused leaf did not eat a sequence number.
     */
    const h = await submitHarness(scope);
    // A's first message lands at position 1, so the relay holds a real content hash there.
    const first = new Uint8Array(randomBytes(32));
    const ok = await h.submit({ contentHash: first, lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesisOf(h) });
    expect(ok["type"], `the honest first submit must be witnessed: ${JSON.stringify(ok["reason"])}`).toBe("hash_submit_ack");
    expect(ok["sequence_number"]).toBe(1);

    // B now claims to have seen position 1 — and names content the relay never recorded there.
    const bad = await h.submitAsB({
      contentHash: new Uint8Array(randomBytes(32)),
      lastSeenSeq: 1,
      timestamp: Date.now(),
      lastSeenHash: new Uint8Array(32).fill(0xee),
    });
    expect(bad["type"]).toBe("hash_submit_error");
    expect(bad["reason"]).toBe("ack_hash_mismatch");
    /**
     * NAMES WHAT WAS OBSERVED, NEVER AN INFERRED CONCLUSION (`DOD-M15-ERRSTRING-1`). The same
     * signal is what a genuine software fault on the sender's side looks like, and an error naming
     * a party the code did not check is this milestone's founding defect.
     */
    expect(bad["detail"]).toBe("the acknowledged hash does not match the message at that position");
    expect(String(bad["detail"])).not.toMatch(/malicious|attack|lying/i);

    // NO POSITION CONSUMED. A refusal that still advanced the counter would leave a hole in the
    // chain that the honest party's next submit could never close.
    const next = await h.submit({ contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesisOf(h) });
    expect(next["type"]).toBe("hash_submit_ack");
    expect(next["sequence_number"], "the refused submit must not have eaten position 2").toBe(2);
  });

  it("★ the CORRECT last_seen_hash is witnessed — the check is a comparison, not a blanket refusal", async () => {
    /**
     * The half that proves the test above measures the comparison. Same parties, same position,
     * same everything — only the hash is the one the relay actually holds.
     */
    const h = await submitHarness(scope);
    const first = new Uint8Array(randomBytes(32));
    await h.submit({ contentHash: first, lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesisOf(h) });

    const good = await h.submitAsB({
      contentHash: new Uint8Array(randomBytes(32)),
      lastSeenSeq: 1,
      timestamp: Date.now(),
      lastSeenHash: first,
    });
    expect(good["type"], `an honest acknowledgement must be witnessed: ${JSON.stringify(good["reason"])}`).toBe("hash_submit_ack");
    expect(good["sequence_number"]).toBe(2);
  });

  it("★ position 0 is checked against the session's GENESIS — not against 32 zero bytes", async () => {
    /**
     * `last_seen_hash` IS A VALUE, NEVER AN ABSENCE. The first message of a session has seen
     * nothing, and that case is the session's genesis prev_root — derived from both participant
     * keys, the session id and the session timestamp, which this relay already computed when it
     * recorded the session.
     *
     * ⚠️ THE ZEROS CASE IS ASSERTED EXPLICITLY, because it is the value a careless implementation
     * reaches for. A constant identical across every session is one an attacker can present for
     * ANY session, which would leave the position most exposed to a forged acknowledgement as the
     * only one nobody could check.
     */
    const h = await submitHarness(scope);
    const zeros = await h.submit({
      contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: new Uint8Array(32),
    });
    expect(zeros["type"], "32 zero bytes is not this session's starting point").toBe("hash_submit_error");
    expect(zeros["reason"]).toBe("ack_hash_mismatch");

    const real = await h.submit({
      contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: genesisOf(h),
    });
    expect(real["type"], "and the genuine genesis IS accepted").toBe("hash_submit_ack");
  });

  it("★ a v1 claim is still witnessed — the witness tolerates a shape before any client depends on it", async () => {
    /**
     * ⚠️ **DELIBERATE, AND IT IS NOT THE FAIL-OPEN IT RESEMBLES.**
     *
     * §2c's rule is that the relay tolerates a new shape BEFORE any client emits it, and the
     * inverse breaks every message in flight: a relay refusing v1 stops witnessing for every client
     * not yet carrying the emitter — including any nobody has upgraded.
     *
     * The *receiving daemon* is where a v1 claim is refused, because that side can afford to: it
     * refuses one message from one peer rather than the whole fleet's ordering. Enforcing here as
     * well is a later step, once nothing on the wire emits v1.
     *
     * This test pins that tolerance so the day someone tightens it, they do it on purpose.
     */
    const h = await submitHarness(scope);
    const v1 = await h.submit({ contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now() });
    expect(v1["type"]).toBe("hash_submit_ack");
  });

  it("★ INDEX 6 IS EXCLUSIVE: a v1 seven-array is still a submission id, and a v2 one is an ack hash", async () => {
    /**
     * Both meanings live at index 6, and `arr.length` cannot tell them apart — only `arr[0]` can.
     * A reader that branched on length would file a v2 claim's ack hash as a SUBMISSION ID, which
     * is the retransmission dedup key: two consecutive messages acknowledging the same last message
     * carry the same value, so the second would be answered from the first's ack, take its
     * sequence, and never be appended. That is silent message loss, not a refusal.
     *
     * So both shapes are exercised against the SAME relay, and the proof that they were not
     * conflated is the sequence numbers: a real submission-id retry is answered from the record and
     * consumes nothing, while two v2 claims carrying the same ack hash are two DIFFERENT messages
     * and each takes its own position.
     */
    const h = await submitHarness(scope);
    const subId = new Uint8Array(randomBytes(16));
    const content = new Uint8Array(randomBytes(32));

    const a1 = await h.submit({ contentHash: content, lastSeenSeq: 0, timestamp: Date.now(), submissionId: subId });
    const a2 = await h.submit({ contentHash: content, lastSeenSeq: 0, timestamp: Date.now() + 1, submissionId: subId });
    expect(a1["type"]).toBe("hash_submit_ack");
    expect(a2["sequence_number"], "a declared retry is answered from the record — v1 index 6 is a submission id").toBe(a1["sequence_number"]);

    const genesis = genesisOf(h);
    const b1 = await h.submitAsB({ contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesis });
    const b2 = await h.submitAsB({ contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now() + 1, lastSeenHash: genesis });
    expect(b1["type"]).toBe("hash_submit_ack");
    expect(
      b2["sequence_number"],
      "two v2 claims sharing an ack hash are two MESSAGES — reading index 6 as a submission id here would swallow the second",
    ).toBe((b1["sequence_number"] as number) + 1);
  });
});
