/**
 * THE RELAY IS FINALLY CHECKED BY SOMETHING IT DOES NOT CONTROL —
 * `DOD-M15-SEALWIRE-1` bullets 3 and 4.
 *
 * ─── The defect, as an operator would meet it ──────────────────────────────────────────────────
 *
 * 1. Two agents hold a conversation. Every message becomes a leaf the relay orders.
 * 2. They close it. Each signs a SEAL leaf committing to the root of its own transcript.
 * 3. The relay hands the directory a leaf array and a root.
 * 4. The directory rebuilds a root **from that same array, with the same code**, and compares it to
 *    the root **the same relay supplied**.
 *
 * Step 4 validates arithmetic. A relay that drops a message and reports the matching root passes it
 * every single time, and the certificate the two agents keep is then a signed statement about a
 * conversation neither of them had.
 *
 * ─── Why the fix had to be a wire change ───────────────────────────────────────────────────────
 *
 * The value that breaks the circle already exists: `final_root`, the client's own signed claim about
 * its own transcript. It just never arrives. The client submits only
 * `SHA-256(0x02 ‖ seal_payload)` to the relay, so `final_root` survives solely inside a pre-image
 * that is never transmitted — which is why the deferral comment sitting on this check for two
 * milestones was not merely unfinished but impossible to satisfy as written.
 *
 * ─── The one property everything rests on ──────────────────────────────────────────────────────
 *
 * The payload must be BOUND to the client's signature before a single field of it is believed. That
 * is what `SHA-256(0x02 ‖ payload) == s2.content_hash` does: `content_hash` sits inside Structure 1,
 * which the client signs. Skip that step and the payload is just one more thing the relay handed
 * over — the circularity reappears wearing a different name.
 *
 * ⚠️ Every test below constructs its leaves and its expected roots by hand, from the protocol's own
 * `encodeSealPayload`, **never** from the module under test's helpers. A test that computes its
 * expected value with the code it is checking is the same circularity one level down.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { Encoder as CborEncoder } from "cbor-x";
const CBOR = new CborEncoder({ tagUint8Array: false });
import { buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { encodeSealPayload } from "@cello-protocol/protocol-types";
import {
  verifySealFinalRoots,
  SEAL_FINAL_ROOT_REASONS,
  SEAL_FINAL_ROOT_GUIDANCE,
  type SealFinalRootReason,
} from "../seal-final-root.js";
import type { RelaySealLeaf } from "../directory-types.js";
import type { Structure2 } from "@cello-protocol/protocol-types";

const SESSION_ID = new Uint8Array(16).fill(0x7c);
const OTHER_SESSION = new Uint8Array(16).fill(0x3a);

/** Independently derived — the client's own rule, written out rather than imported. */
function ctrlHash(payload: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(new Uint8Array([0x02])).update(payload).digest());
}

function s2(contentHash: Uint8Array, seq: number): Structure2 {
  return {
    sequence_number: seq,
    content_hash: contentHash,
    prev_root: new Uint8Array(32),
    sender_pubkey: new Uint8Array(32).fill(0xaa),
    sender_signature: new Uint8Array(64).fill(0xbb),
    relay_id: "relay",
    relay_signature: new Uint8Array(64).fill(0xcc),
    relay_timestamp: 1,
  } as unknown as Structure2;
}

/**
 * A real Structure 1 TBS: `[version, content_hash, sender_pubkey, session_id, last_seen_seq, ts]`.
 * Built here rather than stubbed, because the module now decodes it — a placeholder byte would make
 * every leaf fail as malformed and every assertion below vacuous.
 */
function s1(contentHash: Uint8Array): Uint8Array {
  return new Uint8Array(CBOR.encode([1, contentHash, new Uint8Array(32).fill(0xaa), SESSION_ID, 0, 1]));
}

function msgLeaf(fill: number, seq: number): RelaySealLeaf {
  const h = new Uint8Array(32).fill(fill);
  return { kind: "msg", s2: s2(h, seq), structure1_cbor: s1(h) };
}

/** Expected root — built here from the message hashes directly, not via the module. */
function expectedRoot(msgFills: number[]): Uint8Array {
  return merkleRoot(buildMerkleTree(msgFills.map((f) => ({ kind: "hash" as const, data: new Uint8Array(32).fill(f) }))));
}

function sealLeaf(finalRoot: Uint8Array, seq: number, opts?: { sessionId?: Uint8Array; carry?: boolean; corruptPayload?: boolean }): RelaySealLeaf {
  const payload = encodeSealPayload({
    session_id: opts?.sessionId ?? SESSION_ID,
    final_root: finalRoot,
    close_timestamp: 1_700_000_000_000,
    attestation: "PENDING",
  });
  const leaf: RelaySealLeaf = {
    kind: "ctrl",
    s2: s2(ctrlHash(payload), seq),
    structure1_cbor: s1(ctrlHash(payload)),
  };
  if (opts?.carry !== false) {
    leaf.content_bytes = opts?.corruptPayload ? new Uint8Array([9, 9, 9]) : payload;
  }
  return leaf;
}

describe("DOD-M15-SEALWIRE-1 bullets 3+4: the certified root is checked against a CLIENT signature", () => {
  it("★ the honest case verifies — both participants signed the root the relay's leaves produce", () => {
    const root = expectedRoot([0x11, 0x22, 0x33]);
    const leaves: RelaySealLeaf[] = [
      msgLeaf(0x11, 1), msgLeaf(0x22, 2), msgLeaf(0x33, 3),
      sealLeaf(root, 4), sealLeaf(root, 5),
    ];
    const verdict = verifySealFinalRoots(leaves, SESSION_ID);
    expect(verdict.ok, "an honest seal must certify, or the check is a wall rather than a guard").toBe(true);
    expect(
      (verdict as { coverage?: string }).coverage,
      "both SEAL leaves must be verified — 'one' would mean half this seal rests on a single participant",
    ).toBe("both");
  });

  it("★★ A RELAY THAT DROPS A MESSAGE IS CAUGHT — the failure the circular check could never see", () => {
    /**
     * ⚠️ THE TEST THIS ENTIRE UNIT EXISTS FOR.
     *
     * The relay held three messages and hands over two. The old check rebuilds a root from the two
     * it was given, compares it to the root it was given for those two, and they agree perfectly —
     * because both come from the relay. It passes, and the participants receive a signed certificate
     * over a conversation that is missing a message.
     *
     * The participants signed the THREE-message root. That signature is the thing the relay cannot
     * produce, and the disagreement is now visible.
     */
    const honestRoot = expectedRoot([0x11, 0x22, 0x33]);
    const tampered: RelaySealLeaf[] = [
      msgLeaf(0x11, 1), /* 0x22 dropped by the relay */ msgLeaf(0x33, 3),
      sealLeaf(honestRoot, 4), sealLeaf(honestRoot, 5),
    ];
    const verdict = verifySealFinalRoots(tampered, SESSION_ID);
    expect(verdict.ok, "a dropped message must not certify — the receipt would describe a conversation nobody had").toBe(false);
    expect((verdict as { reason: string }).reason).toBe(SEAL_FINAL_ROOT_REASONS.ROOT_DISAGREES);
  });

  it("★★ A RELAY THAT REORDERS TWO MESSAGES IS CAUGHT — same leaf COUNT, so a count check misses it", () => {
    /**
     * The sharper half. A leaf-count comparison — the check that exists elsewhere in this system —
     * sees three leaves and three leaves and is satisfied. Order is part of what the participants
     * signed, and a reordered transcript changes what the conversation MEANT while changing nothing
     * a counter can see.
     */
    const honestRoot = expectedRoot([0x11, 0x22, 0x33]);
    const reordered: RelaySealLeaf[] = [
      msgLeaf(0x22, 1), msgLeaf(0x11, 2), msgLeaf(0x33, 3),
      sealLeaf(honestRoot, 4), sealLeaf(honestRoot, 5),
    ];
    const verdict = verifySealFinalRoots(reordered, SESSION_ID);
    expect(verdict.ok, "order is part of what was signed — same count, different conversation").toBe(false);
    expect((verdict as { reason: string }).reason).toBe(SEAL_FINAL_ROOT_REASONS.ROOT_DISAGREES);
  });

  it("★★ A FABRICATED PAYLOAD IS CAUGHT BEFORE ANY FIELD OF IT IS BELIEVED", () => {
    /**
     * ⚠️ THE PROPERTY EVERYTHING ELSE RESTS ON.
     *
     * A relay that wants the check to pass has one obvious move: supply a payload whose `final_root`
     * matches the leaves it is presenting. It cannot, because the payload must hash to the
     * `content_hash` the CLIENT signed — and altering that would require forging the client's
     * signature.
     *
     * Modelled exactly: a well-formed payload naming the tampered root, attached to a leaf whose
     * signed content_hash is still the honest one. If this passed, the whole unit would be the relay
     * checking itself with extra steps.
     */
    const tamperedRoot = expectedRoot([0x11, 0x33]);
    const honestRoot = expectedRoot([0x11, 0x22, 0x33]);
    const honest = sealLeaf(honestRoot, 4);
    const forged = encodeSealPayload({
      session_id: SESSION_ID, final_root: tamperedRoot, close_timestamp: 1_700_000_000_000, attestation: "PENDING",
    });
    const leaves: RelaySealLeaf[] = [
      msgLeaf(0x11, 1), msgLeaf(0x33, 3),
      // The signed content_hash is untouched; only the bytes the relay hands over are swapped.
      { ...honest, content_bytes: forged },
    ];
    const verdict = verifySealFinalRoots(leaves, SESSION_ID);
    expect(verdict.ok, "a payload the client's signature does not cover must never be believed").toBe(false);
    expect(
      (verdict as { reason: string }).reason,
      "and it must be named as TAMPERING, not as a root disagreement — the operator's next step is completely different",
    ).toBe(SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND);
  });

  it("★ a payload for a DIFFERENT session is refused — a valid signature replayed elsewhere", () => {
    const root = expectedRoot([0x11]);
    const leaves: RelaySealLeaf[] = [msgLeaf(0x11, 1), sealLeaf(root, 2, { sessionId: OTHER_SESSION })];
    const verdict = verifySealFinalRoots(leaves, SESSION_ID);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toBe(SEAL_FINAL_ROOT_REASONS.SESSION_MISMATCH);
  });

  it("★ the two participants disagreeing with EACH OTHER is its own verdict", () => {
    /**
     * Distinct from a relay fault, and the operator's move is different: nobody can write an honest
     * certificate over two different transcripts, and the participants have to compare their own.
     *
     * Reached by making each side's signed root internally consistent with a DIFFERENT leaf set —
     * the second one disagreeing with the relay's array too, which is why the root check fires
     * first. The parties-disagree verdict is the belt to that braces; both must exist, because a
     * relay showing two participants different message sets produces exactly this.
     */
    const rootA = expectedRoot([0x11, 0x22]);
    const rootB = expectedRoot([0x11, 0x99]);
    const leaves: RelaySealLeaf[] = [
      msgLeaf(0x11, 1), msgLeaf(0x22, 2),
      sealLeaf(rootA, 3), sealLeaf(rootB, 4),
    ];
    const verdict = verifySealFinalRoots(leaves, SESSION_ID);
    expect(verdict.ok, "two participants signing different roots cannot both be certified").toBe(false);
    /**
     * ⚠️ THIS ASSERTION USED TO ACCEPT EITHER VERDICT, AND THAT MADE IT HOLLOW. Review ran the revert
     * test on it: delete the `PARTIES_DISAGREE` branch entirely and it stayed green, because the
     * verdict it actually received was `ROOT_DISAGREES` — it named a branch it never reached and
     * could not detect the removal of. A hedged assertion is what an unsure author writes, and it
     * was mine.
     *
     * It is exact now, which is only possible because the comparisons were reordered: participants
     * against each other BEFORE the relay. That ordering is the finding, and this is what pins it.
     */
    expect(
      (verdict as { reason: string }).reason,
      "when the two participants disagree with EACH OTHER, blaming the relay sends the operator to audit a machine that is fine",
    ).toBe(SEAL_FINAL_ROOT_REASONS.PARTIES_DISAGREE);
    expect(
      String((verdict as { detail: string }).detail),
      "and the detail must say so in words, and name which sender, because the operator's next move is to compare transcripts",
    ).toMatch(/disagree with EACH OTHER|not a relay accusation/i);
  });

  it("★★ MIXED CARRY — one new client, one old — must NOT report as fully verified", () => {
    /**
     * Review F3, blocking. During the rollout a session can have one participant on a build that
     * carries its payload and one that does not, so exactly ONE signature is checkable. That returned
     * `ok: true` with the count in a field no caller read and no test asserted — meaning half of
     * every such seal would have been "verified" against a single participant, for the whole window.
     *
     * The same absent-versus-verified collapse this module's header spends a paragraph forbidding,
     * one leaf down. The verdict is a discriminated union now, so a caller cannot ignore it.
     */
    const root = expectedRoot([0x11, 0x22]);
    const leaves: RelaySealLeaf[] = [
      msgLeaf(0x11, 1), msgLeaf(0x22, 2),
      sealLeaf(root, 3),                       // new client: carries
      sealLeaf(root, 4, { carry: false }),     // old client: does not
    ];
    const verdict = verifySealFinalRoots(leaves, SESSION_ID);
    expect(verdict.ok, "one good signature is still worth having — this must not be a refusal").toBe(true);
    expect(
      (verdict as { coverage: string }).coverage,
      "but it must not claim BOTH participants were checked when only one was",
    ).toBe("one");
    expect(
      String((verdict as { detail: string }).detail),
      "and must say which half is unverified, in words a caller cannot silently drop",
    ).toMatch(/only half|the other did not carry/i);
  });

  it("★★ A RELAY THAT REWRITES ITS OWN ENVELOPE IS CAUGHT — the finding the first version could not see", () => {
    /**
     * ⚠️ REVIEW F1, AND IT CORRECTED THIS MODULE'S CENTRAL CLAIM.
     *
     * The binding check compared the payload against `s2.content_hash` — the RELAY's envelope field.
     * The header asserted it was "inside Structure 1, which the client signs", and that is true of
     * `structure1_cbor`'s copy, not of `s2`'s. The two are equal only because the CALLER's loops
     * prove it, and this module documented the guarantee as if it provided it.
     *
     * So: a relay supplies a payload AND rewrites its envelope hash to match. Under the old code
     * both come from the relay and agree perfectly — the circularity, back, wearing the name of the
     * check that was supposed to remove it. The client's signed `structure1_cbor` is untouched,
     * because forging that needs a signature the relay does not have.
     */
    const root = expectedRoot([0x11]);
    const honest = sealLeaf(root, 2);
    const forgedPayload = encodeSealPayload({
      session_id: SESSION_ID, final_root: expectedRoot([0x11]), close_timestamp: 999, attestation: "PENDING",
    });
    const rewritten: RelaySealLeaf = {
      ...honest,
      // The relay's envelope now agrees with the relay's payload; only the SIGNED copy dissents.
      s2: { ...honest.s2, content_hash: ctrlHash(forgedPayload) } as typeof honest.s2,
      content_bytes: forgedPayload,
    };
    const verdict = verifySealFinalRoots([msgLeaf(0x11, 1), rewritten], SESSION_ID);
    expect(
      verdict.ok,
      "a relay that rewrites both halves of its own envelope must not verify — that is the circle this unit exists to break",
    ).toBe(false);
    expect((verdict as { reason: string }).reason).toBe(SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND);
  });

  it("★ an OLD RELAY that carries nothing is `not_carried` — never a silent pass", () => {
    /**
     * Receiver-first. Absent must be distinguishable from verified, or the rollout window is a
     * period in which every seal reports as checked while nothing is checked — the exact ABSENT-vs-
     * NAMED collapse Decision #15 spends a wire field preventing.
     */
    const root = expectedRoot([0x11]);
    const leaves: RelaySealLeaf[] = [msgLeaf(0x11, 1), sealLeaf(root, 2, { carry: false })];
    const verdict = verifySealFinalRoots(leaves, SESSION_ID);
    expect(verdict.ok, "nothing was carried, so nothing was verified").toBe(false);
    expect((verdict as { reason: string }).reason).toBe(SEAL_FINAL_ROOT_REASONS.NOT_CARRIED);
  });

  it("★ a malformed payload that IS bound is reported as malformed, not as tampering", () => {
    /**
     * The two are different accusations. `PAYLOAD_UNBOUND` says the relay altered bytes the client
     * signed; `PAYLOAD_MALFORMED` says the bytes are authentic and this build cannot read them,
     * which is a version question. Conflating them sends an operator hunting an attacker over an
     * encoding change.
     */
    const junk = new Uint8Array([0xff, 0x00, 0xff]);
    const leaf: RelaySealLeaf = {
      kind: "ctrl",
      s2: s2(ctrlHash(junk), 2),   // genuinely bound: the SIGNED hash IS of these bytes
      structure1_cbor: s1(ctrlHash(junk)),
      content_bytes: junk,
    };
    const verdict = verifySealFinalRoots([msgLeaf(0x11, 1), leaf], SESSION_ID);
    expect(verdict.ok).toBe(false);
    expect((verdict as { reason: string }).reason).toBe(SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED);
  });

  it("★ every reason has guidance, and none of it is a restatement of the reason", () => {
    /**
     * The map is total by type, which the compiler enforces. What it cannot enforce is that the text
     * tells the reader what to DO — and a guidance string that merely renames the code is how a
     * closed reason set decays back into a bare error string.
     */
    for (const reason of Object.values(SEAL_FINAL_ROOT_REASONS) as SealFinalRootReason[]) {
      const guidance = SEAL_FINAL_ROOT_GUIDANCE[reason];
      expect(guidance, `${reason} must have guidance`).toBeTruthy();
      expect(guidance.length, `${reason}'s guidance must say more than the code does`).toBeGreaterThan(80);
      expect(
        guidance.toLowerCase(),
        `${reason}'s guidance must not just repeat the code back`,
      ).not.toBe(reason.replace(/_/g, " "));
    }
  });
});
