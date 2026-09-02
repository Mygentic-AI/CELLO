/**
 * THE DIRECTORY VERIFIES WHAT THE CLIENT SIGNED ABOUT ITS OWN TRANSCRIPT —
 * `DOD-M15-SEALWIRE-1` bullets 3 and 4.
 *
 * ─── Why bullets 3 and 4 are one unit ──────────────────────────────────────────────────────────
 *
 * Bullet 4 says the directory's root check is circular, and it is: it rebuilds a root from the leaf
 * array the relay supplied, using the same code, and compares it to the root that same relay
 * supplied. It validates ARITHMETIC, not the relay. **A relay that drops or reorders a leaf and
 * reports the matching root passes it every time.**
 *
 * That check cannot be fixed on its own — there is nothing else in `RelaySealData` that the relay did
 * not put there. What breaks the circle is bullet 3: the SEAL leaf's `final_root`, which is the
 * CLIENT's own statement about its own transcript, and which is committed inside a **client
 * signature**. Compare the relay's leaf array against that and the relay is finally being checked by
 * something it does not control.
 *
 * ─── Why it needs a wire change, and what exactly is missing ───────────────────────────────────
 *
 * `final_root` does not survive the trip. The client computes:
 *
 *     seal_payload = CBOR([session_id, final_root, close_timestamp, "PENDING"])
 *     content_hash = SHA-256(0x02 ‖ seal_payload)
 *
 * and submits only `content_hash` to the relay. The payload is a **SHA-256 pre-image that is never
 * transmitted**, so no amount of downstream cleverness recovers `final_root` — which is why the
 * long-standing deferral comment on this check was not merely unfinished but *structurally
 * impossible as written*. The fix is to carry the payload bytes.
 *
 * ─── What makes this NON-circular, stated precisely ────────────────────────────────────────────
 *
 * ⚠️ THIS PARAGRAPH USED TO SAY *"`content_hash` lives inside Structure 1, and Structure 1 is signed
 * by the sending client"* — and then compare against **`s2.content_hash`**, which is the RELAY's
 * envelope field. Review caught it. Structure 2 is assembled by the relay and it can put anything in
 * there; the signed value is the one inside `structure1_cbor`. The two are proven equal by the
 * CALLER, in both existing verification loops, and this module said nothing about needing that. A
 * comment asserting a safety property the code does not have is how defects survive review here, and
 * this was one.
 *
 * As it stands now:
 *
 *   1. The payload is hashed and compared against the content hash decoded from **`structure1_cbor`**
 *      — the bytes the client's Ed25519 signature covers. Not the relay's copy.
 *   2. `s1.content_hash` and `s2.content_hash` are ALSO required to agree, so a relay that rewrites
 *      its envelope is refused here rather than silently believed.
 *   3. `final_root` from that payload is therefore the client's signed claim.
 *   4. Comparing it to a root rebuilt from the relay's leaf array checks the RELAY against the CLIENT.
 *
 * 🚨 **PRECONDITION THE CALLER MUST STILL MEET, and this module cannot check it.** Steps 1–2 prove
 * the payload matches what `structure1_cbor` says. They do NOT prove `structure1_cbor` was signed by
 * a session participant — that is `verify(s2.sender_pubkey, structure1_cbor, s2.sender_signature)`
 * plus a participant check, and both live in the caller (`directory-node.ts`, the unilateral and
 * bilateral verification loops). **Call this only from a path that has already done both.** Without
 * them a relay can mint a ctrl leaf with a key it holds, and every comparison below becomes the relay
 * checking itself.
 *
 * ─── ⚠️ WHICH root `final_root` commits to, because it is NOT the certified root ───────────────
 *
 * The certified root is built over **every** leaf, ctrl leaves included. `final_root` is not:
 *
 *   - the client reads its tree root *before* appending its own SEAL leaf
 *     (`getSessionTreeRootHex()`, then `encodeSealPayload`); and
 *   - neither party appends the *counterparty's* SEAL ctrl leaf to its local tree — the inbound
 *     handler routes a counterparty ctrl leaf to the auto-acknowledge path and never to an append.
 *
 * So each side's `final_root` is the root over the **non-ctrl** leaves, and both sides should
 * produce the *same* value. That gives a second, free check: if the two SEAL leaves disagree about
 * `final_root`, the two participants disagree about their own conversation, which is precisely the
 * divergence this milestone exists to surface.
 *
 * ─── Receiver-first, and what ABSENT means ─────────────────────────────────────────────────────
 *
 * `content_bytes` is optional, and absent means *"a relay that has not deployed this yet"* — the
 * verdict is `not_carried`, and the caller keeps today's behaviour. It must never mean "verified":
 * this is the same ABSENT-vs-NAMED discrimination Decision #15 spends a wire field on, applied one
 * layer up. The relay tolerates and then carries the new shape before anything depends on it.
 */

import { createHash } from "node:crypto";
import { decode as cborDecode } from "cbor-x";
import { buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { decodeSealPayload } from "@cello-protocol/protocol-types";
import type { RelaySealLeaf } from "./directory-types.js";

/** The ctrl leaf kind byte, and the domain separator inside the SEAL content hash. */
export const LEAF_KIND_CTRL = 0x02;

/**
 * Why a `final_root` verification did not conclude "verified".
 *
 * A CLOSED set with a total guidance map, for the reason `refusal-reasons.ts` records: a free-form
 * reason string let a new code slip past every test in its own guard file.
 */
export const SEAL_FINAL_ROOT_REASONS = {
  /** No SEAL leaf carried its payload. A relay that predates this change — today's behaviour. */
  NOT_CARRIED: "not_carried",
  /** The payload does not hash to the content_hash the client SIGNED. */
  PAYLOAD_UNBOUND: "seal_payload_unbound",
  /** The payload bytes are not a decodable SEAL payload. */
  PAYLOAD_MALFORMED: "seal_payload_malformed",
  /** The payload names a different session than the one being sealed. */
  SESSION_MISMATCH: "seal_payload_session_mismatch",
  /** The client's signed root disagrees with the leaves the relay supplied. */
  ROOT_DISAGREES: "seal_final_root_disagrees",
  /** The two participants signed DIFFERENT roots — they disagree about their own transcript. */
  PARTIES_DISAGREE: "seal_final_root_parties_disagree",
  /** ANY leaf signed by a key that is not a participant in this session. */
  SENDER_NOT_PARTICIPANT: "seal_sender_not_participant",
  /** A leaf whose OWN SIGNED bytes name a different session than the one being sealed. */
  LEAF_SESSION_MISMATCH: "seal_leaf_session_mismatch",
  /**
   * A BILATERAL seal where fewer than two participants carried a signed root —
   * `DOD-M15-SEALPARTIES-1`.
   *
   * Raised by the caller, not by `verifySealFinalRoots`, because it is a judgement about which SEAL
   * TYPE is being certified rather than about the leaves: `coverage: "one"` is a refusal on the
   * bilateral path and the expected outcome on the unilateral one, where the counterparty is gone by
   * definition. Both verdicts come from the same walk; only the bilateral caller treats one of them
   * as a fault.
   */
  APPROVAL_INCOMPLETE: "seal_approval_missing",
} as const;

export type SealFinalRootReason =
  (typeof SEAL_FINAL_ROOT_REASONS)[keyof typeof SEAL_FINAL_ROOT_REASONS];

/**
 * What an operator should DO about each. TOTAL over the union by construction, so a new reason
 * cannot be added without something actionable for the reader.
 */
export const SEAL_FINAL_ROOT_GUIDANCE: Record<SealFinalRootReason, string> = {
  /**
   * ⚠️ THIS GUIDANCE NAMED ONE MACHINE AND THERE ARE THREE PRODUCERS — review pass 1, F4.
   *
   * It said: *"if it persists after the roll, the relay node serving this session is on an old
   * build."* One observable, three ways to reach it, and the sentence offered one explanation:
   *
   *   1. the CLIENT did not send the payload. This was the real state of the world when that
   *      sentence was written — `submitLeaf` had no parameter for it, so no client on earth carried
   *      it, and every seal would have landed here blaming a relay that was doing nothing wrong.
   *   2. the RELAY did not forward it — the case the sentence described.
   *   3. a relay STRIPPED it. `content_bytes` is relay-supplied, so absence is the attacker's own
   *      off-switch: a relay that deletes a message leaf also drops both payloads and lands back in
   *      the pre-check behaviour. Proceeding is still right during the roll — refusing would break
   *      every seal in the federation — but the downgrade must be NAMED rather than dressed as
   *      version skew, and it is why this cannot stay tolerated indefinitely.
   */
  [SEAL_FINAL_ROOT_REASONS.NOT_CARRIED]:
    "No SEAL payload arrived, so no participant's own signed transcript root could be checked. This is the module's internal verdict, not a disposition — what happens next is the CALLER's: the bilateral path refuses (see `seal_approval_missing`, which is the sentence an operator should be reading), and the unilateral path expects exactly one payload and never reaches this. If you are reading this string, a new call site is printing a verdict it has not decided what to do about.",
  [SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND]:
    "A SEAL payload arrived that does NOT hash to the content the participant signed. The participant's signature cannot have covered these bytes, so someone between them and here altered or fabricated the payload — the relay is the only party on that path. Treat this as relay tampering, not a version mismatch.",
  [SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED]:
    "A SEAL payload arrived that is not a decodable SEAL payload. Most likely a relay on a build whose payload encoding differs from this node's; compare versions with the relay operator before suspecting anything worse.",
  [SEAL_FINAL_ROOT_REASONS.SESSION_MISMATCH]:
    "A SEAL payload names a different session than the one being sealed. A signature valid for one conversation is being presented for another, which is a replay rather than a version skew — refuse and keep the certificate unsigned.",
  [SEAL_FINAL_ROOT_REASONS.ROOT_DISAGREES]:
    "A participant signed a transcript root that does not match the leaves the relay supplied. The relay's leaf set is not the conversation the participant had — a dropped, added or reordered message. This is the exact failure the circular root check could never see; do not certify.",
  [SEAL_FINAL_ROOT_REASONS.PARTIES_DISAGREE]:
    "The two participants signed DIFFERENT transcript roots. They disagree about their own conversation, so no certificate can be honest about both — the relay may have shown them different message sets, or one side's local tree diverged (look for session.tree.position_behind_frontier on their daemon). Do not certify; the participants need to compare transcripts.",
  /**
   * ⚠️ THIS SAID "A SEAL LEAF", AND THE CHECK NOW COVERS EVERY LEAF — `DOD-M15-LEAFPARTIES-1`.
   *
   * The narrower wording described the narrower check, and the narrower check was the defect: a
   * MESSAGE leaf from a third key was never examined at all, so a certified receipt could contain a
   * voice that was not in the conversation.
   */
  [SEAL_FINAL_ROOT_REASONS.SENDER_NOT_PARTICIPANT]:
    "A leaf in this seal was signed by a key belonging to neither participant. Nobody outside a conversation can speak in it or close it, so this leaf was injected by whoever assembled the leaf set — on the bilateral path that is the relay, and on the unilateral path it is the party that carried the chain. Treat it as tampering by that party and do not certify; the participants' own transcripts are the record to compare against.",
  [SEAL_FINAL_ROOT_REASONS.LEAF_SESSION_MISMATCH]:
    "A leaf's OWN SIGNED bytes name a different session than the one being sealed. The signature is genuine and the sender may well be a participant — the sentence was simply said in another conversation and has been grafted into this one. Nothing legitimate produces this: a client signs each leaf with the session it is sending in. Treat it as a replay by whoever assembled the leaf set and do not certify.",
  /**
   * ⚠️ THE THREE PRODUCERS ARE NOT DISTINGUISHABLE FROM HERE, so the guidance names all three and
   * says which to check first. The old NOT_CARRIED text pointed at a rollout that no longer exists;
   * pointing an operator at build versions for what is now, by elimination, tampering or a
   * counterparty fault would be the wrong subsystem.
   */
  [SEAL_FINAL_ROOT_REASONS.APPROVAL_INCOMPLETE]:
    "A bilateral seal needs BOTH participants' own signed transcript root, and fewer than two arrived. Nothing was signed. Three things produce this: the counterparty's agent did not attach its signed root when it closed, the relay did not forward it, or a relay STRIPPED it — the field is relay-supplied, so its absence is the off-switch for exactly the party this check exists to catch. Check the counterparty's agent build first (it is the producer), then the relay serving this session. Do NOT force-abandon: that permanently forfeits the receipt. If the counterparty is genuinely gone rather than out of date, the solo seal is the path that still gets you a receipt.",
};

/**
 * ⚠️ `coverage` IS A DISCRIMINANT, NOT A STATISTIC — review F3.
 *
 * The success variant used to be `{ok: true, signedBy: number}`, and a session with one new client
 * and one old one produces exactly ONE carried payload. That returned `ok: true` with a `1` in a
 * field no caller read and no test asserted — so throughout the entire rollout window half of these
 * would have been "verified" against a single participant.
 *
 * That is the absent-versus-verified collapse this module's own header spends a paragraph
 * forbidding, reproduced one leaf down. A union forces the caller to say which it got.
 */
export type SealFinalRootVerdict =
  | { ok: true; coverage: "both"; verifiedRoot: Uint8Array }
  | { ok: true; coverage: "one"; verifiedRoot: Uint8Array; detail: string }
  | { ok: false; reason: SealFinalRootReason; detail: string };

/**
 * The root a SEAL leaf's `final_root` should equal: over the content hashes of every NON-ctrl leaf,
 * in the relay's canonical order.
 *
 * Kept separate and exported so a test can state the rule independently of the code that applies it
 * — a comparison that computes its expected value with the same private helper it is checking is the
 * circularity this whole unit exists to remove, reproduced one level down.
 */
export function rootOverNonCtrlLeaves(leaves: readonly RelaySealLeaf[]): Uint8Array {
  const inputs = leaves
    .filter((l) => l.kind !== "ctrl")
    .map((l) => ({ kind: "hash" as const, data: l.s2.content_hash }));
  return merkleRoot(buildMerkleTree(inputs));
}

/** SHA-256(0x02 ‖ payload) — the client's own derivation, reproduced exactly. */
export function sealContentHash(payload: Uint8Array): Uint8Array {
  return new Uint8Array(
    createHash("sha256").update(new Uint8Array([LEAF_KIND_CTRL])).update(payload).digest(),
  );
}

/**
 * The content hash the CLIENT SIGNED, decoded from `structure1_cbor`.
 *
 * Structure 1 TBS is `[protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq,
 * timestamp]` — the exact byte string the sender's Ed25519 signature covers. Decoded here rather
 * than taken from `s2` so this module's central claim is enforced by this module (review F1).
 *
 * Returns null rather than throwing: these bytes arrive off a wire, and a decode failure is a
 * refusal to report, never an exception escaping into a stream handler.
 */
function decodeStructure1Signed(cbor: Uint8Array): { content_hash: Uint8Array; session_id: Uint8Array } | null {
  let arr: unknown;
  try {
    arr = cborDecode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== 6) return null;
  const bytesAt = (i: number, len: number): Uint8Array | null => {
    const v = arr[i];
    const b = v instanceof Uint8Array ? v : Buffer.isBuffer(v) ? new Uint8Array(v as Buffer) : null;
    return b !== null && b.length === len ? b : null;
  };
  const content_hash = bytesAt(1, 32);
  const session_id = bytesAt(3, 16);
  return content_hash !== null && session_id !== null ? { content_hash, session_id } : null;
}

function bufEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

/**
 * EVERY LEAF BELONGS TO THIS PAIR AND TO THIS SESSION — `DOD-M15-LEAFPARTIES-1`.
 *
 * ─── What was checked before, and what was not ─────────────────────────────────────────────────
 *
 * Both callers verify `verify(s2.sender_pubkey, structure1_cbor, s2.sender_signature)` for every
 * leaf. That is **self-consistency**: the leaf names a key and the signature holds under that key.
 * It says nothing about whether the key is in the conversation. `verifySealLeaves` examines only the
 * closing ceremony pair, and the participant check below this used to sit behind
 * `if (leaf.kind !== "ctrl") continue` **and** behind `if (content_bytes === undefined) continue`.
 *
 * So a content leaf's sender was constrained in exactly one place in the whole system: the relay
 * refuses a `hash_submit` from a non-participant (`relay-node.ts`, `not_a_participant`). On the seal
 * path the relay is the party ASSEMBLING the array, and the bilateral entry point accepts
 * `seal_submission` from any dialer — so the only enforcement point was the party under suspicion.
 *
 * ⚠️ **What did catch it was arithmetic, and the attacker owned its off-switch.** An injected content
 * leaf changes `rootOverNonCtrlLeaves`, so a carried `final_root` stops matching → `ROOT_DISAGREES`.
 * But `content_bytes` is supplied by the same party, and omitting it yields `not_carried`, which the
 * caller deliberately tolerates during the rollout. A guard that the party it guards against can
 * switch off by sending less is not a guard. Hence: this check runs FIRST, over EVERY leaf, and it
 * does not read one relay-supplied optional field.
 *
 * ─── The two facts, and what each is anchored to ───────────────────────────────────────────────
 *
 *   1. **Membership** — the sender is one of the session's two participants. Anchored to the
 *      DIRECTORY's own session record (`#sessionParticipants`, written when the session was
 *      assigned), never to the roster derived from the array under suspicion. When that record is
 *      absent the caller falls back to the derived pair, and this check still refuses a THIRD
 *      distinct sender (three keys do not fit in a pair of two) while it cannot see a substitution —
 *      `DOD-M15-SEALROSTER-FEDERATED-1`.
 *   2. **Session** — the leaf's own signed bytes name the session being sealed. Structure 1's TBS is
 *      `[protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`, so
 *      the sender's Ed25519 signature (RFC 8032) already commits to which conversation the leaf was
 *      produced for. This is the stronger of the two: it is anchored to a signature the assembler
 *      cannot forge, so it holds even on the degraded-roster path.
 *
 * 🚨 **PRECONDITION, unchanged from the block above:** call this only after the per-leaf signature
 * loop. Without it `s2.sender_pubkey` is just a field the assembler filled in, and both facts become
 * the assembler agreeing with itself.
 *
 * `participants` is optional because this module cannot invent a roster; fact 2 is checked either
 * way. `RelaySealLeaf`s reach here only after their `structure1_cbor` has already decoded in the
 * caller, so a null decode is a defence rather than a live path — and it refuses, because a leaf
 * whose provenance cannot be read is exactly the case that must not pass.
 */
export function verifyLeafProvenance(
  leaves: readonly RelaySealLeaf[],
  sessionId: Uint8Array,
  participants: readonly [Uint8Array, Uint8Array] | null,
): { ok: true } | { ok: false; reason: SealFinalRootReason; detail: string } {
  const distinctSenders = new Set<string>();

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    const senderHex = Buffer.from(leaf.s2.sender_pubkey).toString("hex");
    const who = `leaf ${i} (${leaf.kind}, sender ${senderHex.slice(0, 16)}…)`;
    distinctSenders.add(senderHex);

    if (participants !== null && !participants.some((p) => bufEqual(p, leaf.s2.sender_pubkey))) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.SENDER_NOT_PARTICIPANT,
        detail: `${who}: signed by a key that is not a participant in this session`,
      };
    }

    const s1 = decodeStructure1Signed(leaf.structure1_cbor);
    if (s1 === null) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED,
        detail: `${who}: structure1_cbor is not decodable, so this leaf's own account of which session it belongs to cannot be read`,
      };
    }
    if (!bufEqual(s1.session_id, sessionId)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.LEAF_SESSION_MISMATCH,
        detail: `${who}: its signed bytes name session ${Buffer.from(s1.session_id).toString("hex").slice(0, 16)}…, not the one being sealed`,
      };
    }
  }

  /**
   * ⚠️ WITH NO ROSTER, COUNT — DO NOT ACCUSE — review H2.
   *
   * The first version fell back to the pair DERIVED from the leaf array (its first two distinct
   * senders) and ran the same per-leaf test against it. That refuses the right seals for the wrong
   * stated reason: on `[A, S, A, B]` the derived pair is `[A, S]`, so the intruder S is *in* the
   * roster and the refusal names **B — a real participant — as the key that does not belong**. The
   * verdict was right and the sentence the operator reads was a false accusation against the one
   * party who had done nothing.
   *
   * What this node actually knows without a session record is a COUNT: a session has two
   * participants, so three distinct signers means one of them does not belong — and which one is
   * genuinely not derivable from here. Say that, rather than picking a name.
   */
  if (participants === null && distinctSenders.size > 2) {
    return {
      ok: false,
      reason: SEAL_FINAL_ROOT_REASONS.SENDER_NOT_PARTICIPANT,
      detail: `the leaf array carries ${String(distinctSenders.size)} distinct signers and this node holds no session record for it, `
        + `so one of them does not belong and WHICH ONE CANNOT BE NAMED FROM HERE — every candidate roster is drawn from the same suspect array. `
        + `Ask the node that assigned this session who its two participants are.`,
    };
  }

  return { ok: true };
}

/**
 * Verify every carried SEAL payload against the leaf set the relay supplied — and, first, that every
 * leaf belongs to this pair and this session (`verifyLeafProvenance`).
 *
 * @param leaves    the relay's leaf array, in canonical order
 * @param sessionId the session being sealed, for the replay check
 */
export function verifySealFinalRoots(
  leaves: readonly RelaySealLeaf[],
  sessionId: Uint8Array,
  participants: readonly [Uint8Array, Uint8Array] | null,
): SealFinalRootVerdict {
  /**
   * FIRST, AND OVER EVERY LEAF — `DOD-M15-LEAFPARTIES-1`.
   *
   * Ahead of the carried-payload walk below on purpose: that walk `continue`s past anything the
   * assembler chose not to carry, so a check living inside it is optional for the assembler. This one
   * reads only bytes that are under a sender's signature.
   */
  const provenance = verifyLeafProvenance(leaves, sessionId, participants);
  if (!provenance.ok) return provenance;

  const expected = rootOverNonCtrlLeaves(leaves);

  /**
   * ⚠️ KEYED ON SENDER, NOT COUNTED — review pass 2, F-1 and F-2, which are one defect wearing two
   * names: the loop used to iterate every ctrl leaf and increment a counter.
   *
   * **F-1, the false "both".** A party may retry its SEAL, and `seal-legibility.ts` documents that a
   * duplicate from one party can sit in the log unremoved. `[ctrlA, ctrlA′, ctrlB-uncarried]` then
   * counted TWO carried payloads and reported `coverage: "both"` — the very "half of this seal rests
   * on one participant" the union was introduced to prevent, restored by an ordinary retry, and
   * trivially forgeable by a relay duplicating a leaf (which costs it nothing and forges nothing).
   *
   * **F-2, the retry accused as tampering.** A stale first SEAL commits to the root before a late
   * in-flight message; the retry commits to the root after it. Walking leaves in order hit the STALE
   * one first, found it disagreed with the relay's set, and answered *"the relay's leaf set is not
   * the conversation the participant had."* The relay was right and the leaf was simply superseded.
   *
   * So: **last carried leaf per sender wins**, exactly as `findSealCeremonyPair` already resolves the
   * ceremony pair. A superseded SEAL is not evidence against anybody.
   */
  const bySender = new Map<string, { root: Uint8Array; index: number }>();

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (leaf.kind !== "ctrl") continue;
    const bytes = leaf.content_bytes;
    // ABSENT is a relay that has not deployed this — NOT a pass. The verdict below distinguishes them.
    if (bytes === undefined) continue;
    const senderHex = Buffer.from(leaf.s2.sender_pubkey).toString("hex");
    const who = `leaf ${i} (sender ${senderHex.slice(0, 16)}…)`;

    /**
     * ⚠️ THE PARTICIPANT CHECK USED TO LIVE HERE AND HAS MOVED TO `verifyLeafProvenance` — one check,
     * not two. Keeping a copy inside this loop would leave two places to keep correct while the
     * inner one could only ever see a ctrl leaf that carried a payload — the narrow case that made
     * `DOD-M15-LEAFPARTIES-1` possible. The 🚨 precondition block above still applies unchanged.
     */

    /**
     * ⚠️ AGAINST THE SIGNED HASH, NOT THE RELAY'S COPY — pass 1, F1.
     *
     * `structure1_cbor` is the exact byte string the client's signature covers, so its `content_hash`
     * is the client's. `s2.content_hash` is the relay's envelope field, equal to it only because the
     * caller's loops prove so. Binding against the relay's copy made this module's central claim true
     * by someone else's diligence.
     */
    const s1 = decodeStructure1Signed(leaf.structure1_cbor);
    if (s1 === null) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED,
        detail: `${who}: structure1_cbor is not decodable, so there is no signed hash to bind against`,
      };
    }
    // A relay that rewrites its envelope is refused HERE rather than trusted to have been caught.
    if (!bufEqual(s1.content_hash, leaf.s2.content_hash)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND,
        detail: `${who}: the relay's envelope content_hash disagrees with the one the client signed`,
      };
    }
    if (!bufEqual(sealContentHash(bytes), s1.content_hash)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND,
        detail: `${who}: SHA-256(0x02 || payload) does not equal the content_hash the client SIGNED`,
      };
    }

    const payload = decodeSealPayload(bytes);
    if (!payload) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED,
        detail: `${who}: payload is bound to the signature but is not a decodable SEAL payload`,
      };
    }
    if (!bufEqual(payload.session_id, sessionId)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.SESSION_MISMATCH,
        detail: `${who}: payload names a different session`,
      };
    }
    // Last carried leaf per sender wins — a retry supersedes its own earlier SEAL.
    bySender.set(senderHex, { root: payload.final_root, index: i });
  }

  if (bySender.size === 0) {
    /**
     * Review F5: this is also what a leaf set with NO ctrl leaf at all produces, which is a malformed
     * carry rather than a version skew. Both existing callers validate ctrl-leaf presence before they
     * would reach here, so the two cannot currently be confused — said out loud because that is a
     * property of the callers, not of this function, and it stops being true if it is called earlier.
     */
    return {
      ok: false,
      reason: SEAL_FINAL_ROOT_REASONS.NOT_CARRIED,
      detail: "no SEAL leaf carried its payload",
    };
  }

  /**
   * ⚠️ COLLECT FIRST, COMPARE AFTER — review F-4, and it is what makes both verdicts reachable WITH
   * their evidence.
   *
   * Comparing inside the loop meant the corroboration clause on `ROOT_DISAGREES` — *"the other
   * participant signed the SAME root"* — could never print: a genuine relay fault returns on the
   * FIRST carried leaf, when nothing else has been seen yet. The operator got the accusation without
   * the one fact that makes it safe to act on.
   */
  const entries = [...bySender.entries()];
  const first = entries[0]![1];
  for (const [senderHex, e] of entries.slice(1)) {
    if (!bufEqual(e.root, first.root)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PARTIES_DISAGREE,
        detail: `leaf ${e.index} (sender ${senderHex.slice(0, 16)}…): the participants signed DIFFERENT final_root values, so they disagree with EACH OTHER about their own transcript — this is not a relay accusation`,
      };
    }
  }

  if (!bufEqual(first.root, expected)) {
    return {
      ok: false,
      reason: SEAL_FINAL_ROOT_REASONS.ROOT_DISAGREES,
      detail: `leaf ${first.index}: signed a root over a different leaf set than the relay supplied`
        + (entries.length > 1
          ? `; all ${entries.length} participants signed the SAME root, so they agree and the relay's leaf set is the outlier`
          : "; only one participant's payload was carried, so this is one signature against the relay's set"),
    };
  }

  return bySender.size >= 2
    ? { ok: true, coverage: "both", verifiedRoot: expected }
    : {
        ok: true,
        coverage: "one",
        verifiedRoot: expected,
        /**
         * ⚠️ NEUTRAL WORDING — review F-5. This said *"the other did not carry its payload"*, which
         * names a rollout skew. On the UNILATERAL path exactly one ctrl leaf is required by design,
         * so every unilateral seal lands here and the counterparty was ABSENT, not out of date.
         * Pointing that operator at build versions would be the wrong subsystem for the one seal type
         * whose entire premise is that the other side is gone.
         */
        detail: "only one participant's signed root was checked — the other's payload was not carried. On a unilateral seal that is expected (the counterparty was absent); on a bilateral one it means their build does not carry the payload yet.",
      };
}
