/**
 * CELLO-M7-SESSION-004 — Seal certificate legibility derivation (directory unit)
 *
 * TDD Phase R. Covers the directory's pure derivation logic (buildSealLegibility):
 *   AC-001  receipt-not-assent fields present; no agreement-bearing field
 *   AC-002  per-party content_frontier_seq + last_authored_seq (asymmetric)
 *   AC-003  attestation_mode 'live' for the contemporaneous bilateral case
 *   AC-004  final_message.answered (malicious tail false / reply true)
 *   AC-007  all four interruption cases legible (parameterised). NOTE: the two
 *           cases the protocol can reach end-to-end (full-bilateral and
 *           present-party-sealed-tail, both attestations 'live') are ALSO exercised
 *           through the real processSeal path in m7-session-004-processseal.test.ts,
 *           honouring the AC's `integration` label. The override-only 'recovered'
 *           (Workstream C) and 'absent' (Workstream A) cases are unreachable through
 *           processSeal today (verifySealLeaves rejects a non-bilateral ctrl tail and
 *           no flow sets those modes yet), so they retain construction-based coverage
 *           here per this story's scope handoff — A/C reuse the same builder unchanged.
 *   SI-001  malicious tail is never represented as agreement
 *   SI-002  frontier equals the signed maximum, never an inflated asserted value
 *
 * ─── S (Specification) ──────────────────────────────────────────────────────
 * A seal attests RECEIPT + INTEGRITY + ORDERING — never assent. The certificate
 * publishes each party's content-frontier (max signed last_seen_seq across that
 * party's OWN leaves), a live/recovered/absent attestation marker, and whether
 * the final content message was answered by the counterparty.
 *
 * ─── Interpretation (stated explicitly; story flags this AC family as ambiguous)
 * `answered` excludes the trailing SEAL ceremony control leaves: a bilateral seal
 * always ends with the counterparty's SEAL ctrl leaf at a higher sequence than the
 * final content message, yet a malicious unanswered tail must read answered:false.
 *
 * Crypto refs: Ed25519 RFC 8032, CBOR canonical RFC 8949, SHA-256 FIPS 180-4.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair } from "@cello-protocol/crypto";
import { buildStructure2 } from "@cello-protocol/protocol-types";
import type { Structure2 } from "@cello-protocol/protocol-types";
import { buildSealLegibility, SEAL_RECEIPT_DISCLAIMER } from "../seal-legibility.js";
import { encodeSessionFrostSealed, decodeOutboundSignalingFrame } from "../directory-frames.js";
import type { RelaySealLeaf, SessionFrostSealed } from "../directory-types.js";

const ENC = new Encoder({ tagUint8Array: false });

type Kp = ReturnType<typeof generateKeypair>;

/**
 * Build a RelaySealLeaf with a real Structure 1 TBS signature and a Structure 2.
 * The prev_root chain is irrelevant to buildSealLegibility (which reads only the
 * sender pubkey, sequence number, kind, and signed last_seen_seq), so unit leaves
 * use a random prev_root.
 */
async function makeLeaf(
  key: Kp,
  kind: import("../directory-types.js").RelaySealLeafKind,
  seq: number,
  lastSeenSeq: number,
): Promise<RelaySealLeaf> {
  const pubkey = new Uint8Array(await key.getPublicKey());
  const contentHash = new Uint8Array(randomBytes(32));
  const sessionId = new Uint8Array(16);
  const ts = Date.now();
  // Structure 1 TBS: [protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
  const s1Tbs = ENC.encode([1, contentHash, pubkey, sessionId, lastSeenSeq, ts]) as Uint8Array;
  const s1Sig = new Uint8Array(await key.sign(s1Tbs));
  const s2Result = buildStructure2(seq, pubkey, contentHash, s1Sig, new Uint8Array(randomBytes(32)));
  if (!s2Result.ok) throw new Error("buildStructure2 failed");
  return { kind, s2: s2Result.structure2 as Structure2, structure1_cbor: s1Tbs };
}

async function pkHex(key: Kp): Promise<string> {
  return Buffer.from(await key.getPublicKey()).toString("hex");
}

describe("M7-SESSION-004 (directory): buildSealLegibility", () => {
  // ── AC-001: receipt-not-assent ────────────────────────────────────────────
  it("AC-001: emits attests='receipt', implies_assent=false, a disclaimer, and no agreement-bearing field", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(b, "msg", 2, 1),
      await makeLeaf(a, "ctrl", 3, 2),
      await makeLeaf(b, "ctrl", 4, 3),
    ];
    const leg = buildSealLegibility(leaves);

    expect(leg.attests).toBe("receipt");
    expect(leg.implies_assent).toBe(false);
    expect(typeof leg.disclaimer).toBe("string");
    expect(leg.disclaimer).toBe(SEAL_RECEIPT_DISCLAIMER);

    // No field anywhere can be parsed as agreement/consent/assent=true.
    const serialized = JSON.stringify(leg, (_k, v) =>
      v instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) ? "<bytes>" : v,
    ).toLowerCase();
    expect(serialized).not.toMatch(/"agreed"|"consent"|"assent":\s*true|"agreement":\s*true|"agrees":\s*true/);
    expect(serialized).toContain('"implies_assent":false');
  });

  // ── AC-002: per-party content-frontier + last_authored_seq ────────────────
  it("AC-002: derives asymmetric per-party content_frontier_seq and last_authored_seq from each party's own signed leaves", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    // A's signed leaves max last_seen_seq = 6; B's = 4. A authored up to seq 7, B up to seq 8.
    const leaves = [
      await makeLeaf(a, "msg", 5, 2),
      await makeLeaf(b, "msg", 6, 4),
      await makeLeaf(a, "msg", 7, 6),
      await makeLeaf(b, "ctrl", 8, 4),
      await makeLeaf(a, "ctrl", 9, 6),
    ];
    const leg = buildSealLegibility(leaves);
    const aHex = await pkHex(a);
    const bHex = await pkHex(b);
    const pA = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === aHex)!;
    const pB = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === bHex)!;

    expect(pA.content_frontier_seq).toBe(6);
    expect(pB.content_frontier_seq).toBe(4);
    expect(pA.last_authored_seq).toBe(9);
    expect(pB.last_authored_seq).toBe(8);
  });

  // ── AC-003: live-vs-recovered marker ──────────────────────────────────────
  it("AC-003: both participants are 'live' when each produced a contemporaneous SEAL ctrl leaf", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(b, "msg", 2, 1),
      await makeLeaf(a, "ctrl", 3, 2),
      await makeLeaf(b, "ctrl", 4, 2),
    ];
    const leg = buildSealLegibility(leaves);
    for (const p of leg.participants) {
      expect(p.attestation_mode).toBe("live");
      expect(["live", "recovered", "absent"]).toContain(p.attestation_mode);
    }
  });

  // ── AC-004 + SI-001: final-message-unanswered (malicious tail) ────────────
  it("AC-004/SI-001: malicious tail (A's final message, no B reply) reads answered=false, never as agreement", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const aHex = await pkHex(a);
    // Transcript: B msg seq1, A msg seq2 ("…you agreed to send me $1000"). No B leaf after.
    const leaves = [
      await makeLeaf(b, "msg", 1, 0),
      await makeLeaf(a, "msg", 2, 1),
    ];
    const leg = buildSealLegibility(leaves);
    expect(Buffer.from(leg.final_message.sender_pubkey).toString("hex")).toBe(aHex);
    expect(leg.final_message.seq).toBe(2);
    expect(leg.final_message.answered).toBe(false);
    expect(leg.implies_assent).toBe(false);
  });

  it("AC-004: contrasting case — a later leaf authored by B marks answered=true", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const aHex = await pkHex(a);
    // A's final content msg seq2, then B authors a later (ctrl/ack) leaf seq3.
    const leaves = [
      await makeLeaf(b, "msg", 1, 0),
      await makeLeaf(a, "msg", 2, 1),
      await makeLeaf(b, "ctrl", 3, 2),
    ];
    const leg = buildSealLegibility(leaves);
    expect(Buffer.from(leg.final_message.sender_pubkey).toString("hex")).toBe(aHex);
    expect(leg.final_message.answered).toBe(true);
  });

  it("AC-004: a full bilateral seal of a malicious tail still reads answered=false (trailing SEAL ctrl leaves excluded)", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const aHex = await pkHex(a);
    // A's malicious final content message (seq3), then BOTH seal: A ctrl seq4, B ctrl seq5.
    const leaves = [
      await makeLeaf(b, "msg", 1, 0),
      await makeLeaf(a, "msg", 2, 1),
      await makeLeaf(a, "msg", 3, 1), // A's malicious tail; B's frontier (last_seen 1) excludes it
      await makeLeaf(a, "ctrl", 4, 1),
      await makeLeaf(b, "ctrl", 5, 1),
    ];
    const leg = buildSealLegibility(leaves);
    expect(Buffer.from(leg.final_message.sender_pubkey).toString("hex")).toBe(aHex);
    expect(leg.final_message.seq).toBe(3);
    expect(leg.final_message.answered).toBe(false);
    // B's content_frontier (max signed last_seen_seq across B's leaves = 1) excludes A's tail (seq 3).
    const bHex = await pkHex(b);
    const pB = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === bHex)!;
    expect(pB.content_frontier_seq).toBeLessThan(3);
  });

  // ── SI-002: frontier equals signed maximum, never an inflated value ───────
  it("SI-002: content_frontier_seq equals the signed maximum even when a later leaf asserts a higher last_seen_seq it did not sign", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const aHex = await pkHex(a);
    // A's OWN signed leaves max last_seen_seq = 5. We do NOT let any A leaf sign 15.
    const leaves = [
      await makeLeaf(a, "msg", 1, 3),
      await makeLeaf(a, "msg", 2, 5),
      await makeLeaf(b, "msg", 3, 99), // B asserts a high value — must not affect A's frontier
      await makeLeaf(a, "ctrl", 4, 5),
      await makeLeaf(b, "ctrl", 5, 1),
    ];
    const leg = buildSealLegibility(leaves);
    const pA = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === aHex)!;
    expect(pA.content_frontier_seq).toBe(5); // never 15, never B's 99
  });

  // ── AC-007: all four interruption cases legible ───────────────────────────
  it("AC-007: full-bilateral — both frontiers reach the other's last message; both modes 'live'", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(b, "msg", 2, 1),
      await makeLeaf(a, "ctrl", 3, 2),
      await makeLeaf(b, "ctrl", 4, 3),
    ];
    const leg = buildSealLegibility(leaves);
    expect(leg.participants.every((p) => p.attestation_mode === "live")).toBe(true);
  });

  it("AC-007: present-party-sealed-tail — present party's frontier covers the absent party's last message", async () => {
    const present = generateKeypair();
    const tail = generateKeypair();
    const presentHex = await pkHex(present);
    // tail authored seq2; present signed last_seen_seq=2 (covers it) and sealed.
    const leaves = [
      await makeLeaf(present, "msg", 1, 0),
      await makeLeaf(tail, "msg", 2, 1),
      await makeLeaf(present, "ctrl", 3, 2),
      await makeLeaf(tail, "ctrl", 4, 2),
    ];
    const leg = buildSealLegibility(leaves);
    const pPresent = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === presentHex)!;
    expect(pPresent.content_frontier_seq).toBe(2);
  });

  it("AC-007: absent-party-recovered — returning party's mode is 'recovered' via override", async () => {
    const present = generateKeypair();
    const returning = generateKeypair();
    const returningHex = await pkHex(returning);
    const leaves = [
      await makeLeaf(present, "msg", 1, 0),
      await makeLeaf(returning, "msg", 2, 1),
      await makeLeaf(present, "ctrl", 3, 2),
      await makeLeaf(returning, "ctrl", 4, 2),
    ];
    const leg = buildSealLegibility(leaves, {
      attestationOverrides: new Map([[returningHex, "recovered"]]),
    });
    const pReturning = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === returningHex)!;
    expect(pReturning.attestation_mode).toBe("recovered");
  });

  it("AC-007: never-returned — counterparty produced no ack; its mode is 'absent' and frontier reflects only what it signed", async () => {
    const present = generateKeypair();
    const absent = generateKeypair();
    const absentHex = await pkHex(absent);
    // absent signed only up to last_seen_seq=1 and produced no SEAL ctrl leaf.
    const leaves = [
      await makeLeaf(absent, "msg", 1, 0),
      await makeLeaf(present, "msg", 2, 1),
      await makeLeaf(present, "msg", 3, 1),
      await makeLeaf(present, "ctrl", 4, 1),
    ];
    const leg = buildSealLegibility(leaves, {
      attestationOverrides: new Map([[absentHex, "absent"]]),
    });
    const pAbsent = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === absentHex)!;
    expect(pAbsent.attestation_mode).toBe("absent");
    expect(pAbsent.content_frontier_seq).toBe(0); // only signed last_seen_seq=0

    // Review finding #2: the PRESENT party produced a contemporaneous trailing SEAL
    // ctrl leaf in this ceremony and must read 'live' — not 'absent'. A single
    // trailing SEAL ctrl (the present party sealed while the counterparty never
    // returned) is still a contemporaneous acknowledgement.
    const presentHex = await pkHex(present);
    const pPresent = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === presentHex)!;
    expect(pPresent.attestation_mode).toBe("live");
  });

  // ── Finding #2: lone trailing SEAL ctrl ⇒ its author is 'live', not 'absent' ──
  it("derives 'live' for a participant whose lone trailing SEAL ctrl leaf was produced contemporaneously (no bilateral two-ctrl tail)", async () => {
    const present = generateKeypair();
    const absent = generateKeypair();
    const presentHex = await pkHex(present);
    // Transcript ends with a SINGLE trailing ctrl leaf authored by the present party.
    // No override is supplied for `present`, so its mode must derive to 'live' from the
    // trailing SEAL ctrl leaf alone (the never-returned / unilateral seal shape).
    const leaves = [
      await makeLeaf(absent, "msg", 1, 0),
      await makeLeaf(present, "msg", 2, 1),
      await makeLeaf(present, "msg", 3, 1),
      await makeLeaf(present, "ctrl", 4, 1),
    ];
    const leg = buildSealLegibility(leaves);
    const pPresent = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === presentHex)!;
    expect(pPresent.attestation_mode).toBe("live");
  });

  // ── Finding #2 guard: a non-trailing (mid-conversation) ctrl reply does NOT, on
  //    its own, make its author 'live', and is still treated as an answer. ───────
  it("a mid-conversation ctrl reply marks answered=true and does not double-count as a SEAL ack", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const aHex = await pkHex(a);
    // [b msg1, a msg2, b ctrl3] — b's ctrl3 is a reply (no bilateral two-ctrl tail).
    const leaves = [
      await makeLeaf(b, "msg", 1, 0),
      await makeLeaf(a, "msg", 2, 1),
      await makeLeaf(b, "ctrl", 3, 2),
    ];
    const leg = buildSealLegibility(leaves);
    expect(Buffer.from(leg.final_message.sender_pubkey).toString("hex")).toBe(aHex);
    expect(leg.final_message.answered).toBe(true);
  });

  // ── Finding #3: session_frost_sealed carries legibility across encode/decode ──
  it("session_frost_sealed round-trips the legibility certificate (deferred-completion path)", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(b, "msg", 2, 1),
      await makeLeaf(a, "ctrl", 3, 2),
      await makeLeaf(b, "ctrl", 4, 3),
    ];
    const legibility = buildSealLegibility(leaves);
    const frame: SessionFrostSealed = {
      type: "session_frost_sealed",
      session_id: new Uint8Array(16),
      sealed_root: new Uint8Array(32),
      frost_signature: new Uint8Array(64),
      signer_pubkey: new Uint8Array(await a.getPublicKey()),
      legibility,
    };
    const decoded = decodeOutboundSignalingFrame(encodeSessionFrostSealed(frame));
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe("session_frost_sealed");
    const leg = (decoded as SessionFrostSealed).legibility;
    expect(leg).toBeDefined();
    expect(leg!.attests).toBe("receipt");
    expect(leg!.implies_assent).toBe(false);
    expect(leg!.disclaimer).toBe(SEAL_RECEIPT_DISCLAIMER);
    expect(leg!.participants).toHaveLength(2);
  });

  it("session_frost_sealed without legibility decodes to an undefined legibility (backward compatible)", async () => {
    const a = generateKeypair();
    const frame: SessionFrostSealed = {
      type: "session_frost_sealed",
      session_id: new Uint8Array(16),
      sealed_root: new Uint8Array(32),
      frost_signature: new Uint8Array(64),
      signer_pubkey: new Uint8Array(await a.getPublicKey()),
    };
    const decoded = decodeOutboundSignalingFrame(encodeSessionFrostSealed(frame));
    expect(decoded).not.toBeNull();
    expect((decoded as SessionFrostSealed).legibility).toBeUndefined();
  });

  // ── Finding #5: directory disclaimer bytes are pinned (cross-repo drift guard) ─
  it("SEAL_RECEIPT_DISCLAIMER is byte-for-byte the canonical receipt-not-assent text", () => {
    // MUST stay identical to @cello-protocol/protocol-types SEAL_RECEIPT_DISCLAIMER.
    // Pinned here so an accidental edit to the directory's local mirror fails a test
    // (the canonical constant is imported once the protocol-types dep bump lands, AC-013).
    expect(SEAL_RECEIPT_DISCLAIMER).toBe(
      "This certificate attests faithful receipt, integrity, and ordering of the " +
        "transcript. No signature in this certificate implies agreement to, or assent " +
        "to, the contents of any message. Agreement is always a separate, explicit act " +
        "(its own signed reply). A sealed transcript is a receipt, never a record of agreement.",
    );
  });
});

// ─── DOD-DOC-LEAF-1: document leaves must not disturb the ceremony derivation ──
//
// buildSealLegibility answers two questions by walking leaf kinds: who produced a
// contemporaneous SEAL acknowledgement ('live'), and was the final content message
// answered. Before documents, "not ctrl" meant "content", so every non-ceremony leaf
// was a candidate reply. Now 0x04/0x05 leaves ride the same tree and are neither.
//
// A document update is delivered MECHANICALLY by the peer's daemon with no agent
// involved (M14 §16.4). Letting one count as an answer would let a peer's daemon
// silently satisfy the malicious-unanswered-tail check on its operator's behalf —
// the exact property `answered` exists to expose. Only 'msg' leaves answer.
describe("DOD-DOC-LEAF-1: doc/reject leaves in the legibility derivation", () => {
  // The REACHABLE unilateral shape: A seals alone, B never returns, and B's daemon delivers a
  // document update afterwards. Both halves matter — B must not gain a 'live' marker it never
  // earned, and A must not LOSE the one it did. The second is the property at risk: a walk that
  // stops at the doc leaf finds no ceremony at all and downgrades A to 'absent'.
  it("a trailing doc leaf neither fakes an acknowledgement nor erases the real one", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(a, "ctrl", 2, 0),
      await makeLeaf(b, "doc", 3, 2),
    ];
    const leg = buildSealLegibility(leaves);
    const aHex = await pkHex(a);
    const bHex = await pkHex(b);
    const aParty = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === aHex);
    const bParty = leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === bHex);
    expect(aParty?.attestation_mode).toBe("live");   // A DID seal — the doc leaf must not hide it
    expect(bParty?.attestation_mode).toBe("absent"); // a doc leaf is not an acknowledgement
  });

  it("(characterization) a doc or reject leaf never becomes final_message — pre-existing kind !== msg filter", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(b, "doc", 2, 1),
      await makeLeaf(b, "reject", 3, 1),
      await makeLeaf(a, "ctrl", 4, 3),
      await makeLeaf(b, "ctrl", 5, 4),
    ];
    const leg = buildSealLegibility(leaves);
    const aHex = await pkHex(a);
    // The highest-sequence CONTENT leaf is A's at seq 1, despite two higher doc leaves.
    expect(Buffer.from(leg.final_message.sender_pubkey).toString("hex")).toBe(aHex);
    expect(leg.final_message.seq).toBe(1);
  });

  it("a peer's document leaf does NOT mark the malicious tail answered", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    // A sends the final content message; B replies with NOTHING but a mechanical
    // document update, then both seal. The tail is unanswered.
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(b, "doc", 2, 1),
      await makeLeaf(a, "ctrl", 3, 2),
      await makeLeaf(b, "ctrl", 4, 3),
    ];
    const leg = buildSealLegibility(leaves);
    expect(leg.final_message.answered).toBe(false);
  });

  it("contrast: a real content reply after the final message DOES answer it", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(b, "doc", 2, 1),
      await makeLeaf(b, "msg", 3, 1),
      await makeLeaf(a, "ctrl", 4, 3),
      await makeLeaf(b, "ctrl", 5, 4),
    ];
    const leg = buildSealLegibility(leaves);
    // final_message is now B's msg at seq 3 (the highest content leaf), authored by B.
    const bHex = await pkHex(b);
    expect(Buffer.from(leg.final_message.sender_pubkey).toString("hex")).toBe(bHex);
    expect(leg.final_message.seq).toBe(3);
    // A's ctrl leaf at seq 4 is excluded as ceremony, so B's own final message is unanswered —
    // the point being that the DOC leaf at seq 2 changes nothing either way.
    expect(leg.final_message.answered).toBe(false);
  });
});

// A document update is delivered mechanically and can land AFTER both parties' SEAL
// ctrl leaves. The trailing-ctrl-run walk must see through it: a party who demonstrably
// produced a SEAL acknowledgement stays 'live', or an ordinary bilateral seal would be
// downgraded to 'absent' by an unrelated background delivery.
describe("DOD-DOC-LEAF-1: a trailing doc leaf must not erase a live attestation", () => {
  // The reachable bilateral shape is a doc leaf BETWEEN the two SEAL leaves: the relay flips a
  // session out of "active" only once both ctrl leaves exist, so that is the window in which a
  // document submit is still accepted. (A doc leaf strictly AFTER both ctrl leaves cannot occur —
  // the relay is already sealing — so it is not the case worth pinning.)
  it("both parties stay 'live' when a doc leaf sits between the two SEAL leaves", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(a, "ctrl", 2, 0),
      await makeLeaf(b, "doc", 3, 2),
      await makeLeaf(b, "ctrl", 4, 3),
    ];
    const leg = buildSealLegibility(leaves);
    expect(leg.participants.map((p) => p.attestation_mode)).toEqual(["live", "live"]);
  });

  it("a content message still ENDS the ceremony region — an earlier ctrl leaf is not the closing run", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    // B's ctrl leaf IS part of the closing run; A's, separated from it by a content message, is
    // not. Under a walk that merely stops at the doc leaf, nobody would be live; under one that
    // skips doc leaves but ignores the msg boundary, BOTH would be. Only the correct walk gives
    // exactly {B}.
    const leaves = [
      await makeLeaf(a, "ctrl", 1, 0),
      await makeLeaf(a, "msg", 2, 1),
      await makeLeaf(b, "doc", 3, 2),
      await makeLeaf(b, "ctrl", 4, 3),
    ];
    const leg = buildSealLegibility(leaves);
    const aHex = await pkHex(a);
    const bHex = await pkHex(b);
    const modeOf = (hex: string) =>
      leg.participants.find((p) => Buffer.from(p.pubkey).toString("hex") === hex)?.attestation_mode;
    expect(modeOf(bHex)).toBe("live");
    expect(modeOf(aHex)).toBe("absent");
  });
});

// ─── DOD-DOC-LEAF-1 (review F2): the ceremony exclusion must be doc-transparent too ──
//
// `answered` excludes the closing SEAL ctrl leaves, or a bilateral seal would always read
// answered (the counterparty's own SEAL leaf sits at a higher sequence than the final
// message). That exclusion used to be positional. With a document leaf trailing the
// ceremony, a positional lookup finds no pair, excludes nothing, and the counterparty's own
// SEAL leaf silently satisfies the check — reopening the malicious-tail hole that the
// exclusion exists to close.
//
// This is load-bearing beyond display: `answered` is folded into the FROST-signed seal TBS
// via bindLegibilityToTbs, so a wrong value is SIGNED and the client's independent re-derive
// diverges.
describe("DOD-DOC-LEAF-1: ceremony exclusion survives a trailing document leaf", () => {
  // NOTE ON REACHABILITY: an honest relay cannot append AFTER the second SEAL leaf — it is
  // already `sealing` and refuses further submits — so this shape only arises from a crafted
  // seal_submission on the unauthenticated relay-admin stream. verifySealLeaves now refuses it
  // outright (the ceremony must close the log); this pins buildSealLegibility's behaviour
  // independently, since it is a pure function that must stay correct for whatever it is handed.
  it("(crafted shape) a malicious tail stays answered=false when a doc leaf trails the ceremony", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    // A sends the final content message; BOTH seal; then B's daemon delivers a document
    // update. B never replied with content, so the tail is unanswered.
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(a, "ctrl", 2, 1),
      await makeLeaf(b, "ctrl", 3, 2),
      await makeLeaf(b, "doc", 4, 3),
    ];
    const leg = buildSealLegibility(leaves);
    expect(leg.final_message.answered).toBe(false);
  });

  it("the exclusion also holds with the doc leaf BETWEEN the two SEAL leaves", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(a, "msg", 1, 0),
      await makeLeaf(a, "ctrl", 2, 1),
      await makeLeaf(b, "doc", 3, 2),
      await makeLeaf(b, "ctrl", 4, 3),
    ];
    const leg = buildSealLegibility(leaves);
    expect(leg.final_message.answered).toBe(false);
    // And both parties still read 'live' — they both produced a SEAL acknowledgement.
    expect(leg.participants.map((p) => p.attestation_mode)).toEqual(["live", "live"]);
  });
});

// ─── DOD-DOC-LEAF-1 (review pass 2, F-D): duplicate SEAL leaves ──────────────
//
// The relay triggers adjudication only once the ctrl leaves come from DISTINCT senders, so a
// party that retries its SEAL leaves a duplicate in the log with nothing to remove it. A ctrl
// leaf is never a content reply, so every ceremony ctrl leaf must be excluded from `answered` —
// excluding only the matched PAIR lets the duplicate satisfy the check and mark a malicious
// unanswered tail as answered. That value is FROST-signed via bindLegibilityToTbs.
describe("DOD-DOC-LEAF-1: duplicate SEAL leaves do not answer a malicious tail", () => {
  it("a retried SEAL from the same party is excluded too", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    // B sends the final content message; A seals TWICE (a retry); B then seals. Nobody replied
    // to B's message with content, so the tail is unanswered.
    const leaves = [
      await makeLeaf(b, "msg", 5, 4),
      await makeLeaf(a, "ctrl", 6, 5),
      await makeLeaf(a, "ctrl", 7, 5),
      await makeLeaf(b, "ctrl", 8, 7),
    ];
    const leg = buildSealLegibility(leaves);
    const bHex = await pkHex(b);
    expect(Buffer.from(leg.final_message.sender_pubkey).toString("hex")).toBe(bHex);
    expect(leg.final_message.answered).toBe(false);
  });

  it("AC-004's lone trailing ctrl STILL answers — no bilateral ceremony exists to exclude", async () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const leaves = [
      await makeLeaf(b, "msg", 1, 0),
      await makeLeaf(a, "msg", 2, 1),
      await makeLeaf(b, "ctrl", 3, 2),
    ];
    const leg = buildSealLegibility(leaves);
    expect(leg.final_message.answered).toBe(true);
  });
});
