/**
 * EVERY LEAF IN A SEALED CONVERSATION BELONGS TO THAT CONVERSATION'S TWO PARTICIPANTS —
 * `DOD-M15-LEAFPARTIES-1`.
 *
 * ─── The defect, as an operator would meet it ──────────────────────────────────────────────────
 *
 * 1. Two agents talk. Every message becomes a leaf.
 * 2. They close, and each signs a SEAL ctrl leaf.
 * 3. Whoever assembles the leaf array hands the directory one extra leaf — a message signed by a
 *    third key, or a real message this pair signed in a DIFFERENT conversation.
 * 4. The directory certifies it.
 *
 * The receipt then says *"here is what these two people said to each other"* and a third voice is
 * inside it, or a sentence from another room is.
 *
 * ─── What was already checked, and why it was not enough ───────────────────────────────────────
 *
 * The per-leaf loop verifies each leaf's signature **against the key the leaf itself names**, which
 * is self-consistency, not membership. `verifySealLeaves` examines only the closing ceremony pair.
 * `verifySealFinalRoots` skipped every non-ctrl leaf outright.
 *
 * One thing did catch an injected content leaf, and it was arithmetic rather than identity: an extra
 * leaf changes the root over the non-ctrl leaves, so the participants' signed `final_root` stops
 * matching. **That protection is incidental and the attacker holds its off-switch** — `content_bytes`
 * is supplied by the same party that assembles the leaves, and omitting it makes the verdict
 * `not_carried`, which the directory deliberately tolerates during the rollout. Every fixture below
 * therefore carries NO payload at all: that is the shape that certified.
 *
 * ⚠️ These tests drive the REAL `processSeal` and the REAL unilateral handler. A module-level
 * assertion would stay green if the call site stopped passing the roster.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
/**
 * The leaf forger, the unilateral carry, the capturing stream and the directory harness moved to
 * `helpers/seal-fixture.ts` when `DOD-M15-SEALPARTIES-1` needed the same machinery plus a carried
 * SEAL payload. One copy: two would be two places to keep in step with the wire, and the copy that
 * drifts is the one nobody runs.
 */
import {
  buildSeal,
  capturingStream,
  hex,
  registerRoster,
  runUnilateral,
  withDirectory,
  type LogEntry,
} from "./helpers/seal-fixture.js";

describe("DOD-M15-LEAFPARTIES-1 (bilateral): every leaf is tied to the session's two participants", () => {
  it("★ the honest case still certifies — a guard that refuses the honest case is a wall", async () => {
    /**
     * ⚠️ BOTH CTRL LEAVES NOW CARRY THEIR PAYLOAD, and that is not a weakening of this test —
     * `DOD-M15-SEALPARTIES-1`. A bilateral seal requires both participants' own signed transcript
     * root, so a leaf array with none carried is no longer "the honest case"; it is the shape a
     * relay produces by dropping a field it supplies itself. Every REFUSAL fixture below still
     * carries nothing, because that is the shape that used to certify and is what those tests are
     * about — and each of them refuses on provenance, which runs before the approval check.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [
          { key: a, kind: "msg" }, { key: b, kind: "msg" },
          { key: a, kind: "ctrl", carries: true }, { key: b, kind: "ctrl", carries: true },
        ],
        sessionId,
      );
      expect((await directory.processSeal(sessionId, seal)).ok).toBe(true);
    });
  }, 20_000);

  it("★★ A MESSAGE FROM A THIRD KEY IS REFUSED — with NO payload carried, which is what certified", async () => {
    /**
     * ⚠️ THE TEST THIS UNIT EXISTS FOR.
     *
     * Every signature here is genuine, the chain is intact, the ceremony pair is two distinct
     * participants and closes the log. The only thing wrong is that leaf 2 belongs to nobody in this
     * conversation — and no SEAL payload is carried, so the arithmetic that would otherwise have
     * noticed is switched off by the same party that injected the leaf.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [
          { key: a, kind: "msg" },
          { key: stranger, kind: "msg" },   // ← a third voice inside the record
          { key: b, kind: "msg" },
          { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" },
        ],
        sessionId,
      );
      // The participants' own stream, so the frame they receive can be read — not just the return.
      const aStream = capturingStream();
      directory.attachStreamForTest(hex(new Uint8Array(await a.getPublicKey())), aStream.stream);

      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok, "a key outside the conversation must not appear under a certified root").toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_sender_not_participant");

      // The operator half: the refusal names its cause and says what to do about it.
      const refused = logs.filter((l) => l.event === "seal.final_root.refused");
      expect(refused, "a refusal nobody hears is indistinguishable from the seal never happening").toHaveLength(1);
      expect(refused[0]!.level).toBe("error");
      expect(refused[0]!.ctx["reason"]).toBe("seal_sender_not_participant");
      expect(String(refused[0]!.ctx["guidance"] ?? "").length).toBeGreaterThan(80);

      /**
       * ⚠️ THE FRAME, NOT ONLY THE RETURN — review H4.
       *
       * `session_seal_rejected` is what the two people in the conversation actually see, and its
       * reason is a CLOSED union that cannot carry `seal_sender_not_participant`. Telling them
       * `merkle_root_mismatch` would send them off to compare transcripts with each other over what
       * is really an injected leaf. Nothing asserted this, so reverting it stayed green.
       */
      const rejected = aStream.frames().find((f) => f["type"] === "session_seal_rejected");
      expect(rejected, "the participants must be told the seal was refused").toBeTruthy();
      expect(
        rejected!["reason"],
        "the two people in the conversation must not be told their roots disagree when a stranger's leaf was injected",
      ).toBe("seal_leaves_invalid");

      // And no certificate went out to anybody.
      expect(aStream.frames().some((f) => f["type"] === "session_sealed")).toBe(false);
    });
  }, 20_000);

  it("★★ A THIRD VOICE IS STILL CAUGHT WHEN THE ROSTER IS UNKNOWN — the federated fallback path", async () => {
    /**
     * The node that adjudicates a seal is frequently not the node that assigned the session
     * (`sessions` is per-node and is not replicated), so the roster falls back to the keys derived
     * from the leaf array itself. A third distinct sender still cannot fit in a pair of two, so the
     * ADDITION of a voice is caught even there. What that path still cannot see is a SUBSTITUTION —
     * tracked as `DOD-M15-SEALROSTER-FEDERATED-1`, and deliberately not claimed here.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      // No registerRoster — this node never assigned the session.
      const seal = await buildSeal(
        [{ key: a, kind: "msg" }, { key: stranger, kind: "msg" }, { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" }],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_sender_not_participant");
      expect(
        logs.some((l) => l.event === "seal.final_root.roster_unknown"),
        "the degraded roster must still be announced — the refusal does not make the degradation go away",
      ).toBe(true);

      /**
       * ⚠️ THE DETAIL, BECAUSE THE REASON CODE ALONE PASSED FOR THE WRONG REASON — review H2.
       *
       * With a roster derived from the suspect array the pair here is [A, S] — the intruder is INSIDE
       * it — so the refusal fired on B, a real participant, and told the operator B's key does not
       * belong. Same reason code, false accusation. Assert what the operator READS.
       */
      const detail = String(logs.find((l) => l.event === "seal.final_root.refused")?.ctx["detail"] ?? "");
      expect(detail, "with no session record the count is all this node knows").toContain("3 distinct signers");
      expect(detail).toContain("CANNOT BE NAMED FROM HERE");
      const bHex = hex(new Uint8Array(await b.getPublicKey()));
      expect(
        detail.includes(bHex.slice(0, 16)),
        "a participant must never be named as the intruder",
      ).toBe(false);
    });
  }, 20_000);

  it("★★ A REAL LEAF FROM A DIFFERENT SESSION IS REFUSED — the cross-session graft", async () => {
    /**
     * The near-miss, and the easier one to reach: every key here IS a participant, and the signature
     * on leaf 2 is genuine — it was simply produced for another conversation. Structure 1's signed
     * bytes name the session (`[version, content_hash, sender_pubkey, session_id, last_seen_seq,
     * timestamp]`), so the sender's own signature already says which room the sentence was said in.
     * Nothing read it.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      const otherSession = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [
          { key: a, kind: "msg" },
          { key: a, kind: "msg", signsSession: otherSession },  // ← A said this, in another room
          { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" },
        ],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok, "a signature valid for one conversation must not close another").toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_leaf_session_mismatch");
    });
  }, 20_000);

  it("★ a ctrl leaf from a third key is refused too — the ceremony half keeps its teeth", async () => {
    /**
     * The pre-existing `SENDER_NOT_PARTICIPANT` check only ran on a ctrl leaf that CARRIED a payload.
     * With none carried it never ran at all, so this case certified as well.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [{ key: a, kind: "msg" }, { key: a, kind: "ctrl" }, { key: stranger, kind: "ctrl" }],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_sender_not_participant");
    });
  }, 20_000);
});

describe("DOD-M15-LEAFPARTIES-1 (unilateral): the absent-party seal is bound to the same pair", () => {
  it("★ the honest unilateral carry still notarizes", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral([{ key: a, kind: "msg" }, { key: b, kind: "msg" }, { key: a, kind: "ctrl" }], a, b, logs);
    expect(
      logs.some((l) => l.event === "session.unilateral.verification.failed"),
      "an honest carry must not be refused",
    ).toBe(false);
    /**
     * ⚠️ ASSERT THE OUTCOME, NOT ITS SHADOW — review section 4. "No failure was logged" is satisfied
     * by any early return, including one that never reached the verification at all. The receipt
     * being written is the thing this test is named for.
     */
    expect(
      logs.some((l) => l.event === "session.unilateral.notarized"),
      "the honest carry must actually produce a notarized receipt",
    ).toBe(true);
  }, 20_000);

  it("★★ a third key's message in the carry is refused — no notarization", async () => {
    const logs: LogEntry[] = [];
    const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
    await runUnilateral(
      [{ key: a, kind: "msg" }, { key: stranger, kind: "msg" }, { key: b, kind: "msg" }, { key: a, kind: "ctrl" }],
      a, b, logs,
    );
    const failed = logs.filter((l) => l.event === "session.unilateral.verification.failed");
    expect(failed, "a carry containing a stranger's leaf must not be notarized").toHaveLength(1);
    expect(failed[0]!.ctx["reason"]).toBe("seal_sender_not_participant");
    expect(logs.some((l) => l.event === "session.unilateral.notarized")).toBe(false);
  }, 20_000);

  it("★★★ A STRANGER CANNOT UNILATERALLY SEAL SOMEONE ELSE'S SESSION", async () => {
    /**
     * ⚠️ REVIEW H1 — A SECURITY HOLE, AND THE TEST SEAM WAS HIDING IT.
     *
     * Nothing on this path checked that the SUBMITTER is in the session. An authenticated stranger S
     * sends `seal_unilateral` for A↔B's session carrying its own two leaves: `absentPartyHex` resolves
     * to A by its else-branch, every signature is S's own and genuine, exactly one ctrl leaf is
     * present and it IS from the submitter, and the reported root matches. The directory would sign a
     * receipt over A and B's session id naming S as a party to it.
     *
     * It could not be tested before, because `triggerSealUnilateralWithLeavesForTest` overwrote
     * `#sessionParticipants` with the submitter as initiator — making S a participant by construction.
     * The seam is non-destructive now, so `assignedTo` states who the session really belongs to.
     */
    const logs: LogEntry[] = [];
    const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
    // S submits for A↔B's session, carrying a chain made entirely of S's own valid leaves.
    await runUnilateral(
      [{ key: stranger, kind: "msg" }, { key: stranger, kind: "ctrl" }],
      stranger, a, logs, { assignedTo: [a, b] },
    );
    const failed = logs.filter((l) => l.event === "session.unilateral.verification.failed");
    expect(failed, "a key outside the session must not be able to close it").toHaveLength(1);
    expect(
      failed[0]!.ctx["reason"],
      "the truth is that the SUBMITTER is not in this session — naming a leaf would be one layer too deep",
    ).toBe("unilateral_not_a_participant");
    expect(logs.some((l) => l.event === "session.unilateral.notarized")).toBe(false);
  }, 20_000);

  it("★★ a leaf from another session in the carry is refused", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(
      [
        { key: a, kind: "msg" },
        { key: b, kind: "msg", signsSession: new Uint8Array(randomBytes(16)) },
        { key: a, kind: "ctrl" },
      ],
      a, b, logs,
    );
    const failed = logs.filter((l) => l.event === "session.unilateral.verification.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.ctx["reason"]).toBe("seal_leaf_session_mismatch");
  }, 20_000);
});
