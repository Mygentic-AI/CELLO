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
  /** A SEAL leaf signed by a key that is not a participant in this session. */
  SENDER_NOT_PARTICIPANT: "seal_sender_not_participant",
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
    "No SEAL payload arrived, so this seal was certified WITHOUT checking the participants' own signed root — the behaviour of every release before this check existed. Three different things produce this and they are not distinguishable from here: the client did not send the payload, the relay did not forward it, or a relay STRIPPED it (the field is relay-supplied, so absence disables this check for whoever it was meant to catch). Expected while clients and relays are still rolling out. After the roll, check the CLIENT build first — it is the producer — then the relay serving this session; if both are current, treat a persistent absence as tampering rather than skew.",
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
  [SEAL_FINAL_ROOT_REASONS.SENDER_NOT_PARTICIPANT]:
    "A SEAL leaf was signed by a key belonging to neither participant. Nobody outside a conversation can close it, so this leaf was injected by whoever assembled the leaf set — the relay is the only party on that path. Treat it as relay tampering and do not certify.",
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
function decodeStructure1ContentHash(cbor: Uint8Array): Uint8Array | null {
  let arr: unknown;
  try {
    arr = cborDecode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== 6) return null;
  const ch = arr[1];
  const bytes = ch instanceof Uint8Array ? ch : Buffer.isBuffer(ch) ? new Uint8Array(ch as Buffer) : null;
  return bytes !== null && bytes.length === 32 ? bytes : null;
}

function bufEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Verify every carried SEAL payload against the leaf set the relay supplied.
 *
 * @param leaves    the relay's leaf array, in canonical order
 * @param sessionId the session being sealed, for the replay check
 */
export function verifySealFinalRoots(
  leaves: readonly RelaySealLeaf[],
  sessionId: Uint8Array,
  participants?: readonly Uint8Array[],
): SealFinalRootVerdict {
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
     * THE PARTICIPANT HALF OF THE PRECONDITION, ENFORCED HERE WHEN THE CALLER CAN SUPPLY IT.
     *
     * Optional because the module cannot invent the roster — but when it is given, a ctrl leaf from
     * a key that is not one of the two participants is refused here rather than trusted to have been
     * caught upstream. That is half of the 🚨 block above turned into code; the signature half
     * genuinely cannot move into this module.
     */
    if (participants !== undefined
        && !participants.some((p) => bufEqual(p, leaf.s2.sender_pubkey))) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.SENDER_NOT_PARTICIPANT,
        detail: `${who}: a SEAL leaf signed by a key that is not a participant in this session`,
      };
    }

    /**
     * ⚠️ AGAINST THE SIGNED HASH, NOT THE RELAY'S COPY — pass 1, F1.
     *
     * `structure1_cbor` is the exact byte string the client's signature covers, so its `content_hash`
     * is the client's. `s2.content_hash` is the relay's envelope field, equal to it only because the
     * caller's loops prove so. Binding against the relay's copy made this module's central claim true
     * by someone else's diligence.
     */
    const s1 = decodeStructure1ContentHash(leaf.structure1_cbor);
    if (s1 === null) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED,
        detail: `${who}: structure1_cbor is not decodable, so there is no signed hash to bind against`,
      };
    }
    // A relay that rewrites its envelope is refused HERE rather than trusted to have been caught.
    if (!bufEqual(s1, leaf.s2.content_hash)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND,
        detail: `${who}: the relay's envelope content_hash disagrees with the one the client signed`,
      };
    }
    if (!bufEqual(sealContentHash(bytes), s1)) {
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
