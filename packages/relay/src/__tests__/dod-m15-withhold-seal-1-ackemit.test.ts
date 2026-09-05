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
    const ok = await h.submit({ contentHash: first, lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesisOf(h), prevOwnHash: genesisOf(h) });
    expect(ok["type"], `the honest first submit must be witnessed: ${JSON.stringify(ok["reason"])}`).toBe("hash_submit_ack");
    expect(ok["sequence_number"]).toBe(1);

    // B now claims to have seen position 1 — and names content the relay never recorded there.
    const bad = await h.submitAsB({
      contentHash: new Uint8Array(randomBytes(32)),
      lastSeenSeq: 1,
      timestamp: Date.now(),
      lastSeenHash: new Uint8Array(32).fill(0xee),
      // B has not spoken yet, so their self link is the session genesis — correct, deliberately.
      // The ONLY thing wrong with this submit is the acknowledgement, which is what it tests.
      prevOwnHash: genesisOf(h),
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
    const next = await h.submit({ contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesisOf(h), prevOwnHash: first });
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
    await h.submit({ contentHash: first, lastSeenSeq: 0, timestamp: Date.now(), lastSeenHash: genesisOf(h), prevOwnHash: genesisOf(h) });

    const good = await h.submitAsB({
      contentHash: new Uint8Array(randomBytes(32)),
      lastSeenSeq: 1,
      timestamp: Date.now(),
      lastSeenHash: first,
      prevOwnHash: genesisOf(h),
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
      prevOwnHash: genesisOf(h),
    });
    expect(zeros["type"], "32 zero bytes is not this session's starting point").toBe("hash_submit_error");
    expect(zeros["reason"]).toBe("ack_hash_mismatch");

    const real = await h.submit({
      contentHash: new Uint8Array(randomBytes(32)), lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: genesisOf(h), prevOwnHash: genesisOf(h),
    });
    expect(real["type"], "and the genuine genesis IS accepted").toBe("hash_submit_ack");
  });

  it("★ A CLAIM WITH NO ACKNOWLEDGEMENT NO LONGER EXISTS — the tolerance that was here is deleted", async () => {
    /**
     * ⚠️ THIS TEST REPLACES TWO THAT PINNED TOLERANCES, AND THE REPLACEMENT IS THE POINT.
     *
     * One pinned that a v1 claim — carrying no acknowledgement at all — was still witnessed, on
     * §2c's rule that a relay tolerates a shape before any client emits it. The other pinned that
     * index 6 meant a submission id under one version and an ack hash under another, so a reader
     * branching on array length would conflate them and silently swallow a message.
     *
     * Both are void. `DOD-M15-SELFCHAIN-1` deleted every layout except one, so there is no v1 to
     * tolerate and index 6 has a single meaning. CELLO is alpha with no users and backward
     * compatibility is an anti-requirement, so the shapes went rather than the checks around them.
     *
     * What is pinned instead is that the deleted shapes stay deleted: a claim without both links
     * is refused, not witnessed. The relay decoder's own test file covers the arities; this asserts
     * the CONSEQUENCE at the wire — a submit carrying no acknowledgement does not get a position.
     */
    const h = await submitHarness(scope);
    // `submitHarness` cannot build a claim with a missing link — the type forbids it, which is the
    // first guard. This reaches past it to prove the relay refuses the shape rather than merely
    // that our rig will not produce it.
    const refused = await h.submitRaw([
      1, new Uint8Array(randomBytes(32)), h.pubA, h.sessionId, 0, Date.now(),
    ]);
    expect(refused["type"], "a claim with no acknowledgement and no self link is not a shape this relay has").toBe("hash_submit_error");
    expect(refused["reason"]).toBe("submit_malformed");
  });
});
