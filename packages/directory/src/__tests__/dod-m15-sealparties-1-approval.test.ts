/**
 * BOTH REAL PARTICIPANTS APPROVE BEFORE ANY SIGNATURE EXISTS — `DOD-M15-SEALPARTIES-1`.
 *
 * ─── What an operator lives through today ──────────────────────────────────────────────────────
 *
 * Two people's agents talk, both close, and a directory notarizes a receipt saying "this is what
 * was said." Only ONE of the two has any say in whether that receipt is accurate before it is
 * signed. The party who closes first re-derives the root from its own transcript and refuses to
 * co-sign if it disagrees — a real gate, before any signature exists. The other party runs the same
 * comparison only after `session_sealed` arrives, when the artifact is already durable and there is
 * nothing left to invalidate it. They can discover they were misrepresented. They cannot prevent it.
 *
 * ─── The approval already exists on the wire. It was OPTIONAL. ─────────────────────────────────
 *
 * Each party's SEAL ctrl leaf carries a signed `final_root` — its own statement about its own
 * transcript, made before any notarization signature exists. `verifySealFinalRoots` already checks
 * that the carried roots bind to what the client signed, agree with each other, and match the leaf
 * set. What it did NOT do is require both of them: a verdict of `not_carried` (nobody carried one)
 * or `coverage: "one"` (only the closing party did) both certified.
 *
 * And `content_bytes` is supplied by the party ASSEMBLING the leaves. So the check the counterparty
 * relies on was switchable off by exactly the party it guards against — send less, get certified.
 * These tests make a bilateral seal require both approvals, and every fixture here is the shape that
 * used to certify.
 *
 * ⚠️ They drive the REAL `processSeal` and the REAL unilateral handler. A module-level assertion
 * would stay green if the call site stopped enforcing the verdict.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
import {
  buildSeal,
  capturingStream,
  hex,
  registerRoster,
  runUnilateral,
  withDirectory,
  type LogEntry,
} from "./helpers/seal-fixture.js";

describe("DOD-M15-SEALPARTIES-1: a bilateral seal needs BOTH participants' approval", () => {
  /**
   * ⚠️ FIRST, BECAUSE A GUARD THAT REFUSES THE HONEST CASE IS A WALL.
   *
   * `[a msg, b msg, a ctrl, b ctrl]` with both ctrl leaves carrying their payload is what two
   * current clients closing a real conversation produce.
   */
  it("★ the honest case — both parties carried their signed root — still certifies", async () => {
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
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok, `an honest bilateral close must certify: ${JSON.stringify(result)}`).toBe(true);
      const verified = logs.filter((l) => l.event === "seal.final_root.verified");
      expect(verified).toHaveLength(1);
      expect(
        verified[0]!.ctx["coverage"],
        "both participants' signed roots were checked — that is what makes this a two-party approval",
      ).toBe("both");
    });
  }, 20_000);

  it("★★★ THE NON-CLOSING PARTY DID NOT APPROVE → REFUSED, and nothing was signed", async () => {
    /**
     * The party who closes FIRST authors the earlier ceremony ctrl leaf and is the seal initiator —
     * A here. B is the side that, until now, could only object after the fact. B's payload is
     * missing, which is what a relay produces by dropping one field it supplies itself.
     *
     * The assertion that matters is the second one: no `seal_verified` went to the initiator, so the
     * FROST ceremony never started and no signature over this root exists anywhere.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const aStream = capturingStream();
      const bStream = capturingStream();
      directory.attachStreamForTest(hex(new Uint8Array(await a.getPublicKey())), aStream.stream);
      directory.attachStreamForTest(hex(new Uint8Array(await b.getPublicKey())), bStream.stream);

      const seal = await buildSeal(
        [
          { key: a, kind: "msg" }, { key: b, kind: "msg" },
          { key: a, kind: "ctrl", carries: true },
          { key: b, kind: "ctrl" },               // ← B approved nothing
        ],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(
        result.ok,
        "one party's word is not two parties' agreement — certifying here is the whole defect",
      ).toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_approval_missing");

      expect(
        aStream.frames().some((f) => f["type"] === "seal_verified"),
        "the ceremony must not start: 'before any signature exists' is the clause, and seal_verified " +
          "is the frame that asks the initiator's key to sign",
      ).toBe(false);
      expect(aStream.frames().some((f) => f["type"] === "session_sealed")).toBe(false);
      expect(bStream.frames().some((f) => f["type"] === "session_sealed")).toBe(false);
    });
  }, 20_000);

  it("★★★ THE NON-CLOSING PARTY'S TRANSCRIPT DISAGREES → REFUSED, from the side that could not refuse before", async () => {
    /**
     * B closed on a different set of messages than the relay presented — the exact case B previously
     * discovered only after the receipt was durable. B's approval is genuine, signed, and states a
     * different root; the seal must not exist.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const aStream = capturingStream();
      directory.attachStreamForTest(hex(new Uint8Array(await a.getPublicKey())), aStream.stream);

      const seal = await buildSeal(
        [
          { key: a, kind: "msg" }, { key: b, kind: "msg" },
          { key: a, kind: "ctrl", carries: true },
          { key: b, kind: "ctrl", carries: true, finalRoot: new Uint8Array(randomBytes(32)) },
        ],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok, "the two parties do not agree about their own conversation").toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_final_root_parties_disagree");
      expect(
        aStream.frames().some((f) => f["type"] === "seal_verified"),
        "no signature is produced when a participant's own record disagrees",
      ).toBe(false);
    });
  }, 20_000);

  it("★★ NOBODY carried a payload → refused; the pre-check behaviour is gone", async () => {
    /**
     * This is the shape every bilateral seal had before the payload was carried, and the shape a
     * relay falls back to by simply sending less. Tolerating it left the guard optional for the one
     * party it exists to catch.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [{ key: a, kind: "msg" }, { key: b, kind: "msg" }, { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" }],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_approval_missing");
      expect(
        logs.some((l) => l.event === "seal.final_root.not_carried"),
        "the old tolerance logged an INFO and proceeded; that path must no longer exist",
      ).toBe(false);
    });
  }, 20_000);

  it("★★★ THE REFUSAL REACHES BOTH OPERATORS, with a cause each can act on", async () => {
    /**
     * A refusal nobody hears is indistinguishable from the seal never happening — and both people
     * are owed it, not just whoever closed first. `session_seal_rejected` used to be broadcast to
     * every authenticated stream on the node, which reaches the two participants and also everybody
     * else; it now goes to the pair, carrying which of them did not approve.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b, bystander] = [generateKeypair(), generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const aStream = capturingStream();
      const bStream = capturingStream();
      const otherStream = capturingStream();
      directory.attachStreamForTest(hex(new Uint8Array(await a.getPublicKey())), aStream.stream);
      directory.attachStreamForTest(hex(new Uint8Array(await b.getPublicKey())), bStream.stream);
      directory.attachStreamForTest(hex(new Uint8Array(await bystander.getPublicKey())), otherStream.stream);

      const seal = await buildSeal(
        [
          { key: a, kind: "msg" }, { key: b, kind: "msg" },
          { key: a, kind: "ctrl", carries: true }, { key: b, kind: "ctrl" },
        ],
        sessionId,
      );
      await directory.processSeal(sessionId, seal);

      for (const [who, s] of [["A (the closing party)", aStream], ["B (the non-closing party)", bStream]] as const) {
        const rejected = s.frames().find((f) => f["type"] === "session_seal_rejected");
        expect(rejected, `${who} must be told the seal did not happen`).toBeTruthy();
        expect(rejected!["reason"]).toBe("seal_approval_missing");
        expect(
          String(rejected!["detail"] ?? "").length,
          `${who} needs to know WHICH thing was wrong — a bare code is not an affordance`,
        ).toBeGreaterThan(20);
      }
      expect(
        otherStream.frames().some((f) => f["type"] === "session_seal_rejected"),
        "an unrelated agent authenticated on this node learns nothing about someone else's session",
      ).toBe(false);

      const refused = logs.filter((l) => l.event === "seal.final_root.refused");
      expect(refused, "the durable forensic record keeps its half — the response never replaces the log").toHaveLength(1);
      expect(String(refused[0]!.ctx["guidance"] ?? "").length).toBeGreaterThan(80);
    });
  }, 20_000);

  /**
   * ⚠️ THE TRAP THIS ORDER NAMES, AND THE ONE THAT WOULD EAT THE UNIT.
   *
   * Requiring the second party's approval hands an ABSENT party a veto it never had. A counterparty
   * who is offline, slow or hostile must not be able to destroy a receipt by never approving — the
   * change makes a seal harder to FORGE and must not make it harder to OBTAIN.
   *
   * The counterbalance is that the absent case never reaches the bilateral path at all: with no
   * second SEAL ctrl leaf there is no bilateral ceremony to refuse, and the honest party's close
   * escalates to the SOLO seal, which requires exactly one ctrl leaf by design. This asserts the
   * tightening did not leak across — `coverage: "one"` is a refusal on one path and the expected
   * answer on the other, and no clock was invented here to make that so.
   */
  it("★★★ AN HONEST PARTY DOES NOT LOSE ITS RECEIPT WHEN THE OTHER SIDE IS ABSENT — the solo path is untouched", async () => {
    const logs: LogEntry[] = [];
    const [present, absent] = [generateKeypair(), generateKeypair()];
    await runUnilateral(
      [{ key: present, kind: "msg" }, { key: absent, kind: "msg" }, { key: present, kind: "ctrl" }],
      present, absent, logs,
    );
    expect(
      logs.some((l) => l.event === "session.unilateral.notarized"),
      "the solo seal carries ONE participant's approval by definition — refusing it here would take " +
        "a receipt away from the one party who did nothing wrong",
    ).toBe(true);
    expect(
      logs.some((l) => l.event === "seal.final_root.refused"),
      "the bilateral approval requirement must not fire on a path where the counterparty is gone",
    ).toBe(false);
  }, 20_000);
});
