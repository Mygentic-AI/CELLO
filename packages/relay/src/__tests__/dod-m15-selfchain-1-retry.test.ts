/**
 * `DOD-M15-SELFCHAIN-1` — a retransmitted message does not consume a second position, and the key
 * that decides is SIGNED.
 *
 * ─── The defect, from the operator's chair ─────────────────────────────────────────────────────
 *
 * You send one message. The ack does not arrive — the stream stalls, the relay restarts, a circuit
 * drops. Your client re-sends the same message, as it should.
 *
 * If the relay treats the retransmission as a NEW submission it advances the sequence counter, adds
 * another leaf to its tree, and returns a different position. One message now occupies two
 * canonical positions. Retry again and it occupies three. **Measured in the field: one message
 * consumed 49 positions, and verified content was destroyed at teardown 20 times on one daemon in
 * one day.** Nothing looks wrong until the seal, where the two sides' trees disagree about how many
 * leaves the conversation had — and by then the conversation is over.
 *
 * A retry is invisible on its own because Structure 1 carries a TIMESTAMP: re-sending the same
 * message a moment later produces different bytes and a different signature.
 *
 * ─── What replaced the submission id, and why it is better rather than merely different ────────
 *
 * `DOD-M15-SUBMIT-ID-1` had the SENDER MINT an id: stable across retries of one send, fresh for a
 * new send. It shipped as relay tolerance and no client ever emitted one.
 *
 * The retry key is now `(prev_own_hash, content_hash)` — both inside the bytes the sender signed.
 *
 *   - a RETRANSMISSION has the same pair, because it is the same message: the chain does not
 *     advance until a send is acknowledged, so the predecessor is unchanged;
 *   - a NEW message has a different `prev_own_hash`, because it chains to the one before it.
 *
 * ⚠️ AND IT SURVIVES THE TRAP THE MINTED ID WAS FOR, WHICH IS THE TEST THAT MATTERS HERE.
 * `content_hash` alone cannot be the key: a sender may legitimately send identical content twice in
 * one conversation — two "ok"s are two messages, not a duplicate — and deduplicating on content
 * would silently swallow the second, a worse defect than the one being fixed. The PAIR separates
 * them, because the second "ok" chains to the first.
 *
 * The id was also a value the sender chose, unbound to anything, deciding whether their own message
 * got a fresh position. The pair is bound to the conversation by a signature.
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
import { createHash, randomBytes } from "node:crypto";
import { submitHarness, type SubmitHarness } from "./helpers/relay-submit-harness.js";

setupV3Tests();

/** The content hash of a message, derived the way a client derives it. */
const contentHashOf = (text: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(text, "utf8").digest());

describe("035-SELFCHAIN: a retransmission is answered from the record, and a repeat is not", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("the SAME message sent twice gets the SAME position — one message, one place in the record", async () => {
    const h: SubmitHarness = await submitHarness(scope);
    const content = contentHashOf("the only message");

    const first = await h.submit({
      contentHash: content, lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(first["type"], JSON.stringify(first)).toBe("hash_submit_ack");

    /**
     * The retry: same content, same predecessor, a LATER timestamp. Different signed bytes and a
     * different signature — which is exactly why the relay could not recognise it before.
     */
    const retry = await h.submit({
      contentHash: content, lastSeenSeq: 0, timestamp: Date.now() + 1_000,
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(retry["type"]).toBe("hash_submit_ack");
    expect(retry["sequence_number"], "a retransmission must not consume a second position")
      .toBe(first["sequence_number"]);
  });

  it("⚠️ TWO IDENTICAL MESSAGES IN A ROW ARE TWO MESSAGES — the trap that rules out keying on content", async () => {
    /**
     * A sender may legitimately say the same thing twice. Keying the dedup on `content_hash` alone
     * would swallow the second one, which destroys a message the operator sent — a worse defect
     * than the duplicate positions this whole mechanism exists to prevent.
     *
     * The pair separates them because the second chains to the first: same content, different
     * predecessor.
     */
    const h: SubmitHarness = await submitHarness(scope);
    const ok = contentHashOf("ok");

    const first = await h.submit({
      contentHash: ok, lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(first["type"], JSON.stringify(first)).toBe("hash_submit_ack");

    const second = await h.submit({
      contentHash: ok, lastSeenSeq: 0, timestamp: Date.now() + 1,
      lastSeenHash: h.genesis,
      // The DIFFERENCE: this one follows the first, so its predecessor is the first's content.
      prevOwnHash: ok,
    });
    expect(second["type"], JSON.stringify(second)).toBe("hash_submit_ack");
    expect(second["sequence_number"], "the second 'ok' is a second message and gets its own position")
      .toBe((first["sequence_number"] as number) + 1);
  });

  it("the key is SENDER-SCOPED — one party's message cannot be answered from the other's record", async () => {
    /**
     * Both parties start from the same session genesis, so at the first message their predecessors
     * are IDENTICAL. If the key were not scoped to the sender, B's first message would collide with
     * A's whenever the two sent the same content — and B would be handed A's position.
     */
    const h: SubmitHarness = await submitHarness(scope);
    const same = contentHashOf("hello");

    const fromA = await h.submit({
      contentHash: same, lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(fromA["type"], JSON.stringify(fromA)).toBe("hash_submit_ack");

    const fromB = await h.submitAsB({
      contentHash: same, lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(fromB["type"], JSON.stringify(fromB)).toBe("hash_submit_ack");
    expect(fromB["sequence_number"], "B's message is B's, not a replay of A's ack")
      .not.toBe(fromA["sequence_number"]);
  });

  it("a retry AFTER the conversation moved on still gets its original position", async () => {
    /**
     * The client advances its chain only when a send is acknowledged, so a message whose ack was
     * lost keeps the same predecessor however long the wait. This is the case the field defect
     * actually produced: a stalled stream, a later retry, and a second position for one message.
     */
    const h: SubmitHarness = await submitHarness(scope);
    const one = contentHashOf("one");
    const two = contentHashOf("two");

    const first = await h.submit({
      contentHash: one, lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(first["type"], JSON.stringify(first)).toBe("hash_submit_ack");

    const second = await h.submit({
      contentHash: two, lastSeenSeq: 0, timestamp: Date.now() + 1,
      lastSeenHash: h.genesis, prevOwnHash: one,
    });
    expect(second["type"], JSON.stringify(second)).toBe("hash_submit_ack");

    // Now retry the FIRST one, exactly as a client whose first ack never arrived would.
    const retryOfFirst = await h.submit({
      contentHash: one, lastSeenSeq: 0, timestamp: Date.now() + 2,
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(retryOfFirst["type"]).toBe("hash_submit_ack");
    expect(retryOfFirst["sequence_number"]).toBe(first["sequence_number"]);
  });

  it("a message whose predecessor is WRONG is refused — the retry key cannot be used to jump the chain", async () => {
    /**
     * The dedup and the chain check are the same field, so this is the one test that proves the key
     * cannot be abused: a sender cannot invent a predecessor to get a fresh position, because an
     * invented predecessor is a broken chain and the relay refuses it by name.
     */
    const h: SubmitHarness = await submitHarness(scope);
    const first = await h.submit({
      contentHash: contentHashOf("a"), lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(first["type"], JSON.stringify(first)).toBe("hash_submit_ack");

    const invented = await h.submit({
      contentHash: contentHashOf("b"), lastSeenSeq: 0, timestamp: Date.now() + 1,
      lastSeenHash: h.genesis,
      prevOwnHash: new Uint8Array(randomBytes(32)),
    });
    expect(invented["type"]).toBe("hash_submit_error");
    expect(invented["reason"]).toBe("self_chain_mismatch");
  });

  it("★★★ a broken chain ESCALATES — the counterparty is told and the relay stops witnessing", async () => {
    /**
     * ─── THE THREE HALVES OF AN ESCALATION, ASSERTED TOGETHER ──────────────────────────────────
     *
     * The order asks for four things when tampering is detected: refuse it, tell BOTH parties, name
     * a next step, and freeze. Refusing alone is not an escalation — the next submit would be judged
     * on its own, and a party whose chain is genuinely being rewritten could keep feeding leaves
     * into a record this relay had already caught out.
     *
     * This is the revert test for the other two. They were both absent: the alert existed and no
     * test named it, so `#emitSelfChainAlert` could have been deleted with the suite green; and the
     * session stayed `active` after a refusal, so nothing stopped the conversation.
     */
    const h: SubmitHarness = await submitHarness(scope);
    const first = await h.submit({
      contentHash: contentHashOf("a"), lastSeenSeq: 0, timestamp: Date.now(),
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(first["type"], JSON.stringify(first)).toBe("hash_submit_ack");
    // Nothing has gone wrong yet, so nobody has been warned about anything.
    expect(await h.pushToB("session_witness_alert", 200), "no accusation before there is anything to accuse").toBeNull();
    expect(h.sessionState()?.status, "and the session is ordinary").toBe("active");

    const broken = await h.submit({
      contentHash: contentHashOf("b"), lastSeenSeq: 0, timestamp: Date.now() + 1,
      lastSeenHash: h.genesis,
      prevOwnHash: new Uint8Array(randomBytes(32)),
    });

    // 1. REFUSED, by name, to the sender — on the response they are already waiting for.
    expect(broken["type"]).toBe("hash_submit_error");
    expect(broken["reason"]).toBe("self_chain_mismatch");
    // 2. A NEXT STEP, and it is the out-of-band one. There is nothing to re-send here — which is
    //    why the refusal must not read like a transient failure the client should retry through.
    expect(String(broken["detail"]), "the refusal must say what to do about it").toMatch(/out of band/i);
    expect(String(broken["detail"]), "and that this relay is done with the session").toMatch(/will not witness/i);

    // 3. THE OTHER PARTY IS TOLD, by the WITNESS — an accusation routed through the accused is not
    //    evidence, which is the argument the whole witness-alert mechanism rests on.
    //
    //    Read off B's live stream rather than the store: an alert to a CONNECTED participant is
    //    pushed straight to them and never reaches the held queue, so a test that only checked the
    //    store would pass with the alert deleted.
    const alert = await h.pushToB("session_witness_alert");
    expect(alert, "the counterparty would otherwise never know their record was being rewritten")
      .not.toBeNull();
    expect(alert!["type"]).toBe("session_witness_alert");
    expect(alert!["reason"]).toBe("self_chain_broken");
    // …and the SUBMITTER gets no alert about themselves: they are told through the refusal.
    expect(h.alertsFor(h.pubA), "an alert to the party the observation is about is not evidence")
      .toHaveLength(0);

    // 4. AND THE RELAY STOPS WITNESSING. Same disposition as a replay divergence, for the same
    //    reason: a seal built on a conversation whose order is in dispute is a receipt for an order
    //    nobody agrees on.
    const state = h.sessionState();
    expect(state?.status, "a conversation whose order is in dispute must not keep being witnessed")
      .toBe("diverged");
    expect(state?.awaiting_replay).toBe(false);
    expect(
      String(state?.diverged_reason),
      "the record must say what was OBSERVED — a client whose own chain went out of step after a restart produces this too",
    ).toMatch(/does not match this relay's record/);
  });

  it("★★★ NEITHER PARTY can reorder the other's run — the clause, from both sides", async () => {
    /**
     * ─── THE HEADLINE PROPERTY, ASSERTED IN BOTH DIRECTIONS ────────────────────────────────────
     *
     * The order says the sequence of a conversation must never be in dispute. Every other test here
     * drives ONE sender, and a guard keyed on the wrong party — or on "the submitter" rather than
     * "each author" — would pass all of them. This drives both.
     *
     * The shape is a real run: A speaks, then B speaks TWICE. B's two messages acknowledge the same
     * message from A, because nothing arrived in between, so nothing but the self link tells them
     * apart. Presenting B's second message as though it were B's first is exactly the swap the
     * carrying party could perform, and it is refused whichever party attempts it.
     */
    const h: SubmitHarness = await submitHarness(scope);
    const now = Date.now();

    // A speaks. Their first message links to the session's starting point on both fields.
    const a1 = await h.submit({
      contentHash: contentHashOf("a1"), lastSeenSeq: 0, timestamp: now,
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(a1["type"], JSON.stringify(a1)).toBe("hash_submit_ack");

    // B replies. B has not spoken, so B's self link is the starting point too — NOT A's message.
    const b1 = await h.submitAsB({
      contentHash: contentHashOf("b1"), lastSeenSeq: 1, timestamp: now + 1,
      lastSeenHash: contentHashOf("a1"), prevOwnHash: h.genesis,
    });
    expect(b1["type"], JSON.stringify(b1)).toBe("hash_submit_ack");

    /**
     * B'S SECOND MESSAGE, PRESENTED AS THOUGH IT WERE B'S FIRST — the swap, from B's side.
     *
     * Its acknowledgement is identical to B's real first message (nothing arrived in between), so
     * every positional and causal check is satisfied. Only the self link is wrong.
     */
    const swapped = await h.submitAsB({
      contentHash: contentHashOf("b2"), lastSeenSeq: 1, timestamp: now + 2,
      lastSeenHash: contentHashOf("a1"), prevOwnHash: h.genesis,
    });
    expect(swapped["type"], "B cannot present a later message as an earlier one").toBe("hash_submit_error");
    expect(swapped["reason"]).toBe("self_chain_mismatch");
  });

  it("★★★ …and A cannot either — the same swap from the OTHER side", async () => {
    /**
     * The mirror. A guard that read the chain of whichever party happens to be the submitter, or
     * that only ever tracked one key, would pass the test above and fail here.
     */
    const h: SubmitHarness = await submitHarness(scope);
    const now = Date.now();

    const a1 = await h.submit({
      contentHash: contentHashOf("a1"), lastSeenSeq: 0, timestamp: now,
      lastSeenHash: h.genesis, prevOwnHash: h.genesis,
    });
    expect(a1["type"], JSON.stringify(a1)).toBe("hash_submit_ack");

    // A speaks AGAIN, honestly: linking to A's own first message. This must be accepted — the run
    // itself is legitimate, and a guard that refused it would be a wall.
    const a2 = await h.submit({
      contentHash: contentHashOf("a2"), lastSeenSeq: 0, timestamp: now + 1,
      lastSeenHash: h.genesis, prevOwnHash: contentHashOf("a1"),
    });
    expect(a2["type"], "one party speaking twice in a row is ordinary").toBe("hash_submit_ack");
  });
});
