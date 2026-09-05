/**
 * `seal_submission` leaf validation — the RELAY-dialed half of the directory's seal intake.
 *
 * ⚠️ ITS SIBLING MOVED. `reconstructCarriedSealLeaves` and `LEAF_KINDS` used to live here and now
 * live in `@cello-protocol/interfaces` (`seal-chain-verify.ts`), because `031-RELAYREPLAY` gives a
 * relay the same job: verify a chain of `SealUnilateralLeaf` it did not witness. One definition,
 * two readers. `reconstructCarriedSealLeaves` is re-exported below so this module's existing
 * importers and tests are unchanged.
 *
 * What stayed is directory-only: `seal_submission` arrives on /cello/directory-relay/1.0.0 from a
 * relay, never from a client carrying its own chain, and no relay verifies it.
 */
import { LEAF_KINDS, reconstructCarriedSealLeaves } from "@cello-protocol/interfaces";
import type { RelaySealData } from "@cello-protocol/interfaces";

export { reconstructCarriedSealLeaves };

/**
 * Validate the `leaves` array of a `seal_submission` frame before it reaches Merkle
 * reconstruction (DOD-DOC-LEAF-1).
 *
 * `seal_submission` arrives on /cello/directory-relay/1.0.0, which authenticates only
 * `relay_register` — so the frame is accepted from any dialer, and unlike the unilateral carry
 * no relay receipt binds it. Every other field of a leaf is covered by a signature the directory
 * verifies downstream; `kind` is not, and it selects the HASH DOMAIN. Two consequences make
 * validating it here load-bearing rather than defensive:
 *
 *   - `LeafInput` includes `kind: "hash"`, which uses the leaf's data AS the leaf hash with no
 *     domain prefix. Accepting it off the wire would bypass domain separation entirely.
 *   - buildMerkleTree THROWS on an unrecognized kind (crypto ≥ 0.0.39; it silently coerced to
 *     the message domain before). Unvalidated, that throw escapes into the stream handler.
 *
 * One bad leaf voids the whole submission — a dropped leaf would be an undetected omission.
 */
/**
 * Ceiling on a carried SEAL payload, mirroring the relay's. A real `encodeSealPayload` output is 69
 * bytes; this is generous against that and tiny against a message.
 */
const MAX_CTRL_PAYLOAD_BYTES = 512;

export function validateSealSubmissionLeaves(
  raw: unknown,
): { ok: true; leaves: RelaySealData["leaves"] } | { ok: false; reason: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, reason: "seal_submission_leaves_malformed" };
  }
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, reason: "seal_submission_leaves_malformed" };
    }
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !SEAL_SUBMISSION_LEAF_KINDS.includes(kind)) {
      return { ok: false, reason: "seal_submission_leaf_kind_unknown" };
    }
    /**
     * ⚠️ `content_bytes` IS SHAPE-CHECKED HERE FOR THE SAME REASON `kind` IS — `DOD-M15-SEALWIRE-1`
     * bullets 3+4, review F4.
     *
     * This frame is accepted from any dialer and no relay receipt binds it, and this function passed
     * everything except `kind` straight through as `RelaySealData["leaves"]`. The new field is fed to
     * `createHash(...).update(payload)`, which **throws a TypeError on anything that is not bytes** —
     * so a plain object here escapes into the stream handler. That is the precise escape this
     * function's own header describes for `kind`, one field along.
     */
    const cb = (entry as { content_bytes?: unknown }).content_bytes;
    if (cb !== undefined) {
      if (!(cb instanceof Uint8Array) && !Buffer.isBuffer(cb)) {
        return { ok: false, reason: "seal_submission_content_bytes_malformed" };
      }
      /**
       * ⚠️ CTRL ONLY, ON THIS SIDE OF THE HOP TOO — review H5.
       *
       * The relay refuses `content_bytes` on a msg or doc leaf at its own wire, because that is the
       * operator's plaintext. This validator accepted it on ANY kind, at any length, on a frame its
       * own header describes as *"accepted from any dialer"* with *"no relay receipt"* binding it —
       * so the stricter of the two sides was the one that had a receipt, and the open one was the
       * one that did not. Against the standing rule that the directory holds no PII and is hash-only
       * by design, the guard belongs on both.
       *
       * ⚠️ NOT THE IDENTICAL RULE, AND SAYING "same rule on both sides" WAS AN OVERSTATEMENT. The
       * relay requires the bytes to decode as a SEAL payload for THAT session; this admits any ≤512
       * bytes on a ctrl leaf. That leaves no equivalent hole — `seal-final-root.ts` decodes the
       * payload and binds it against the hash the client SIGNED, with a named `SESSION_MISMATCH`
       * verdict, which is a stronger basis than the relay's — but it is enforced one layer later, and
       * the sentence should say which property lives where rather than implying symmetry.
       */
      if (kind !== "ctrl") {
        return { ok: false, reason: "seal_submission_content_bytes_not_permitted" };
      }
      if ((cb as Uint8Array).length === 0 || (cb as Uint8Array).length > MAX_CTRL_PAYLOAD_BYTES) {
        return { ok: false, reason: "seal_submission_content_bytes_malformed" };
      }
    }
  }
  return { ok: true, leaves: raw as RelaySealData["leaves"] };
}

/** The only leaf domains a relay may assert on the wire. Mirrors LEAF_KINDS' value set. */
const SEAL_SUBMISSION_LEAF_KINDS: readonly string[] = Object.values(LEAF_KINDS);
