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
 * `content_hash` lives inside Structure 1, and Structure 1 is signed by the sending client. So:
 *
 *   1. `SHA-256(0x02 ‖ content_bytes) == s2.content_hash` binds the payload to that signature. A
 *      relay cannot fabricate or alter a payload without breaking a signature it cannot forge.
 *   2. `final_root` decoded from that payload is therefore the client's signed claim.
 *   3. Comparing it to a root rebuilt from the relay's leaf array checks the RELAY against the
 *      CLIENT.
 *
 * Step 1 is what the whole thing rests on. Without it this would be one more value the relay
 * supplied, compared against another value the relay supplied.
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
} as const;

export type SealFinalRootReason =
  (typeof SEAL_FINAL_ROOT_REASONS)[keyof typeof SEAL_FINAL_ROOT_REASONS];

/**
 * What an operator should DO about each. TOTAL over the union by construction, so a new reason
 * cannot be added without something actionable for the reader.
 */
export const SEAL_FINAL_ROOT_GUIDANCE: Record<SealFinalRootReason, string> = {
  [SEAL_FINAL_ROOT_REASONS.NOT_CARRIED]:
    "The relay did not carry the SEAL payload, so this seal was certified without checking the participants' own signed root — the behaviour of every release before this check existed. Expected while relays are still rolling out; if it persists after the roll, the relay node serving this session is on an old build.",
  [SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND]:
    "A SEAL payload arrived that does NOT hash to the content the participant signed. The participant's signature cannot have covered these bytes, so someone between them and here altered or fabricated the payload — the relay is the only party on that path. Treat this as relay tampering, not a version mismatch.",
  [SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED]:
    "A SEAL payload arrived that is not a decodable SEAL payload. Most likely a relay on a build whose payload encoding differs from this node's; compare versions with the relay operator before suspecting anything worse.",
  [SEAL_FINAL_ROOT_REASONS.SESSION_MISMATCH]:
    "A SEAL payload names a different session than the one being sealed. A signature valid for one conversation is being presented for another, which is a replay rather than a version skew — refuse and keep the certificate unsigned.",
  [SEAL_FINAL_ROOT_REASONS.ROOT_DISAGREES]:
    "A participant signed a transcript root that does not match the leaves the relay supplied. The relay's leaf set is not the conversation the participant had — a dropped, added or reordered message. This is the exact failure the circular root check could never see; do not certify.",
  [SEAL_FINAL_ROOT_REASONS.PARTIES_DISAGREE]:
    "The two participants signed DIFFERENT transcript roots. They disagree about their own conversation, so no certificate can be honest about both — the relay may have shown them different message sets. Do not certify; the participants need to compare transcripts.",
};

export type SealFinalRootVerdict =
  | { ok: true; verifiedRoot: Uint8Array; signedBy: number }
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
): SealFinalRootVerdict {
  const expected = rootOverNonCtrlLeaves(leaves);
  let signedBy = 0;
  let agreedRoot: Uint8Array | null = null;

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (leaf.kind !== "ctrl") continue;
    const bytes = leaf.content_bytes;
    // ABSENT is a relay that has not deployed this — NOT a pass. The caller distinguishes the two.
    if (bytes === undefined) continue;

    /**
     * ⚠️ THIS CHECK FIRST, ALWAYS. It is what makes everything below a statement about the CLIENT
     * rather than about the relay. Decode before binding and a relay could hand us any payload it
     * liked, and every subsequent comparison would be the relay checking itself.
     */
    if (!bufEqual(sealContentHash(bytes), leaf.s2.content_hash)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_UNBOUND,
        detail: `leaf ${i}: SHA-256(0x02 || payload) does not equal the signed content_hash`,
      };
    }

    const payload = decodeSealPayload(bytes);
    if (!payload) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED,
        detail: `leaf ${i}: payload is bound to the signature but is not a decodable SEAL payload`,
      };
    }
    if (!bufEqual(payload.session_id, sessionId)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.SESSION_MISMATCH,
        detail: `leaf ${i}: payload names a different session`,
      };
    }
    if (!bufEqual(payload.final_root, expected)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.ROOT_DISAGREES,
        detail: `leaf ${i}: participant signed a root over a different leaf set than the relay supplied`,
      };
    }
    // Both participants sign the same transcript, so their roots must agree with each other too.
    if (agreedRoot !== null && !bufEqual(agreedRoot, payload.final_root)) {
      return {
        ok: false,
        reason: SEAL_FINAL_ROOT_REASONS.PARTIES_DISAGREE,
        detail: `leaf ${i}: the two SEAL leaves carry different final_root values`,
      };
    }
    agreedRoot = payload.final_root;
    signedBy++;
  }

  if (signedBy === 0) {
    return {
      ok: false,
      reason: SEAL_FINAL_ROOT_REASONS.NOT_CARRIED,
      detail: "no SEAL leaf carried its payload",
    };
  }
  return { ok: true, verifiedRoot: expected, signedBy };
}
