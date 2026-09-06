/**
 * `DOD-M15-SELFCHAIN-1` — THE DIRECTORY REFUSES A REORDERED CONVERSATION AT SEAL TIME.
 *
 * ─── The attack, and why the relay alone does not close it ─────────────────────────────────────
 *
 * When one party sends two messages in a row, both acknowledge the SAME message from the other
 * side — nothing arrived in between — so their acknowledgements are identical. Position cannot tell
 * them apart either: the relay assigns it AFTER the sender signs, so a sender can never sign their
 * own position, and the receipt that pins it goes to the SENDER. Whoever later carries a
 * conversation to a new witness therefore holds no receipt for the counterparty's messages and can
 * reorder any run of them.
 *
 * What that bought is worse than a reordering. Swap two of your counterparty's consecutive
 * messages, replay, and the chain verifies — but their honest tip attestation now disagrees, so the
 * witness reads a DIVERGENCE and marks their conversation permanently unsealable. A fabricated
 * contradiction, from one frame, against a party that did nothing.
 *
 * `prev_own_hash` closes it exactly, because it is inside the author's own signed bytes: swap two
 * and the later one's link points at something now behind it, and the signature cannot be re-made
 * without the author's key.
 *
 * ─── What this file adds ───────────────────────────────────────────────────────────────────────
 *
 * The relay checks this on every submit. The directory has to check it AGAIN at seal time, because
 * a seal can be assembled from leaves this directory never watched arrive — a carried chain, or a
 * handover from another witness. Nothing here named the check, so it could have been deleted with
 * the whole directory suite green.
 *
 * It also pins the REASON reaching the operator. Four of the chain reasons are deliberately
 * collapsed into `unilateral_root_unverifiable` on the seal path, and this one must not be: every
 * other reason describes something a client should re-derive or re-send, and there is nothing to
 * re-send about a conversation whose order is in dispute.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { generateKeypair, buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { verifySealLeafChain, SEAL_CHAIN_REASONS, DIRECTORY_COLLAPSED_CHAIN_REASONS } from "@cello-protocol/interfaces";
import { buildSeal, type Kp } from "./helpers/seal-fixture.js";

const contentRoot = (leaves: { s2: { content_hash: Uint8Array } }[]): Uint8Array =>
  merkleRoot(buildMerkleTree(leaves.map((l) => ({ kind: "hash" as const, data: l.s2.content_hash }))));

describe("DOD-M15-SELFCHAIN-1: the directory checks the self link at seal time", () => {
  const sessionId = new Uint8Array(randomBytes(16));

  async function pair(): Promise<[Kp, Kp, [Uint8Array, Uint8Array]]> {
    const a = generateKeypair();
    const b = generateKeypair();
    return [a, b, [new Uint8Array(await a.getPublicKey()), new Uint8Array(await b.getPublicKey())]];
  }

  it("★ an honest conversation with a same-sender RUN verifies — the guard is not a wall", async () => {
    /**
     * THE CONTROL, and it has to come first. One party sending twice in a row is completely
     * ordinary, and a guard that refused it would break the product while satisfying every
     * "this is refused" test below.
     */
    const [a, b, roster] = await pair();
    const seal = await buildSeal(
      [
        { key: a, kind: "msg" },
        { key: b, kind: "msg" },
        { key: b, kind: "msg" },          // ← the run: B speaks twice
        { key: a, kind: "ctrl", carries: true },
        { key: b, kind: "ctrl", carries: true },
      ],
      sessionId,
    );
    expect(
      verifySealLeafChain(seal.leaves, contentRoot(seal.leaves), sessionId, roster),
      "an ordinary conversation must seal",
    ).toMatchObject({ ok: true });
  });

  it("★★★ a leaf that does NOT link to its own author's previous leaf is refused BY NAME", async () => {
    /**
     * THE LOAD-BEARING TEST. Delete the self-link comparison and this goes red.
     *
     * Everything else about the batch is perfect: every signature verifies, every leaf belongs to
     * this session and these two parties, the prev_root chain holds, and the reported root is the
     * root over exactly these content hashes. The ONLY thing wrong is that B's second leaf names a
     * predecessor of its own that is not B's first leaf.
     *
     * That is what a swap looks like after the batch has been re-chained — which a real attacker
     * does, because `prev_root` lives in Structure 2 and the submitter assembles all of it.
     */
    const [a, b, roster] = await pair();
    const seal = await buildSeal(
      [
        { key: a, kind: "msg" },
        { key: b, kind: "msg" },
        // B's SECOND leaf, linking to something that is not B's first.
        { key: b, kind: "msg", prevOwnHash: new Uint8Array(randomBytes(32)) },
        { key: a, kind: "ctrl", carries: true },
        { key: b, kind: "ctrl", carries: true },
      ],
      sessionId,
    );
    const verdict = verifySealLeafChain(seal.leaves, contentRoot(seal.leaves), sessionId, roster);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    /**
     * NAME THE CLAUSE THAT FIRED. `ok === false` alone would be satisfied by a refusal for some
     * unrelated cause — and this batch is specifically built so that no other clause CAN fire,
     * which is the property that makes this test measure the guard rather than its neighbours.
     */
    expect(verdict.reason).toBe(SEAL_CHAIN_REASONS.SELF_CHAIN_BREAK);
  });

  it("★★ a sender's FIRST leaf in the batch is not judged — the array can begin mid-conversation", async () => {
    /**
     * NOT A GAP, and worth pinning so nobody "fixes" it. A carried chain can start partway through
     * a conversation, so the value a sender's first leaf here links to is a message outside the
     * array and cannot be looked up. Refusing there would refuse every legitimate partial carry.
     *
     * A swap still cannot survive: exchange a sender's first two leaves and the one that lands
     * second carries a link to the one now ahead of it, which IS checked — that is the test above.
     */
    const [a, b, roster] = await pair();
    const seal = await buildSeal(
      [
        // Both parties' first leaves name a predecessor from before this array began.
        { key: a, kind: "msg", prevOwnHash: new Uint8Array(randomBytes(32)) },
        { key: b, kind: "msg", prevOwnHash: new Uint8Array(randomBytes(32)) },
        { key: a, kind: "ctrl", carries: true },
        { key: b, kind: "ctrl", carries: true },
      ],
      sessionId,
    );
    expect(
      verifySealLeafChain(seal.leaves, contentRoot(seal.leaves), sessionId, roster),
      "a partial carry is a normal shape and must still seal",
    ).toMatchObject({ ok: true });
  });

  it("★★★ the reason is NOT collapsed into 'the root could not be verified'", async () => {
    /**
     * The seal path answers `unilateral_root_unverifiable` for four chain reasons, deliberately and
     * with that debt recorded. This one must not join them.
     *
     * Every collapsed reason describes something a client should re-derive or re-send. This one
     * describes a conversation whose ORDER is in dispute — there is nothing to re-send, and telling
     * the operator the root could not be verified sends them to check a computation when what they
     * need to do is compare transcripts with their counterparty out of band. That is error
     * substitution on the strongest evidence this protocol produces.
     */
    expect(
      DIRECTORY_COLLAPSED_CHAIN_REASONS.has(SEAL_CHAIN_REASONS.SELF_CHAIN_BREAK),
      "a broken order must reach the operator by its own name",
    ).toBe(false);
    // And the four that ARE collapsed still are — this is not a licence to stop collapsing them.
    expect(DIRECTORY_COLLAPSED_CHAIN_REASONS.has(SEAL_CHAIN_REASONS.ROOT_MISMATCH)).toBe(true);
    expect(DIRECTORY_COLLAPSED_CHAIN_REASONS.has(SEAL_CHAIN_REASONS.PREV_ROOT_BREAK)).toBe(true);
    expect(DIRECTORY_COLLAPSED_CHAIN_REASONS.has(SEAL_CHAIN_REASONS.CAUSAL_ORDER_VIOLATION)).toBe(true);
    expect(DIRECTORY_COLLAPSED_CHAIN_REASONS.has(SEAL_CHAIN_REASONS.SENDER_SIGNATURE_INVALID)).toBe(true);
  });
});
