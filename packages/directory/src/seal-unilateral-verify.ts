/**
 * FED-OPTIONB-SEAL-001 — pure verification of the CLIENT-CARRIED unilateral-seal leaf chain (Option B).
 *
 * Under Option B the directory no longer dials the relay's getSealLeaves; the present (sealing) party CARRIES
 * the leaf chain. Those leaves are UNTRUSTED, so before the directory rebuilds + FROST-notarizes the root it
 * must verify the teeth that the relay's authoritative ordered log used to provide:
 *
 *   - per OWN-party leaf: the relay's signed receipt over buildRelayAckTbs(content_hash, seq, ts) verifies
 *     against the relay_id-derived pubkey. Structure1 (the sender-signed bytes) does NOT bind the relay's
 *     sequence_number or prev_root, so WITHOUT this a present party could reorder/renumber its own leaves and
 *     still pass every sender-signature check downstream. The receipt binds content_hash→seq.
 *   - CONTIGUITY: the carried sequences are exactly 1..N (a gap is an omitted leaf).
 *   - EVERY present-party leaf MUST carry a valid receipt; counterparty leaves carry none (the relay does not
 *     ack-sign a delivery to the recipient) and are pinned instead by their sender_signature (verified in the
 *     directory's #verifyUnilateralChain) + sequence contiguity against the receipt-pinned own leaves.
 *
 * Returns the reconstructed RelaySealLeaf[] for #verifyUnilateralChain (which then enforces
 * content-root==reported_root, sender sigs, the prev_root chain, the signed last_seen_seq causal order, and
 * exactly-one-ctrl-from-the-present-party). Decoding then re-encoding Structure2 is byte-faithful — the
 * canonical scan-result sentinel is rebuilt by encodeStructure2 — so the downstream merkle/chain checks hold.
 */
import { decode as cborDecode } from "cbor-x";
import { verify, buildRelayAckTbs } from "@cello-protocol/crypto";
import { SCAN_RESULT_SENTINEL } from "@cello-protocol/protocol-types";
import type { Structure2 } from "@cello-protocol/protocol-types";
import type { SealUnilateralLeaf, RelaySealData } from "./directory-types.js";

/**
 * Wire byte → leaf domain (DOD-DOC-LEAF-1). This site AUTHORIZES a seal, so an unlisted byte
 * is REFUSED, never coerced. The previous shape — anything-but-0x02 becomes "msg" — silently
 * relabeled a leaf at a trust boundary: the directory would rebuild the tree hashing that leaf
 * under the wrong domain and derive a root the sealing party never computed.
 *
 * 0x01 is absent by design: it is the RFC 6962 internal-node prefix (§2.1.3 tree-shape forgery).
 *
 * Deliberately the OPPOSITE policy from crypto's tolerant `opaque` kind, which exists so a pure
 * root RECOMPUTATION survives an unknown byte. Same byte, two sites, two correct answers —
 * authorization refuses what it cannot name; recomputation must not.
 */
const LEAF_KINDS: Readonly<Record<number, "msg" | "ctrl" | "doc" | "reject">> = {
  0x00: "msg",
  0x02: "ctrl",
  0x04: "doc",
  0x05: "reject",
};

const u8 = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : Buffer.isBuffer(v) ? new Uint8Array(v) : new Uint8Array());

export function reconstructCarriedSealLeaves(
  sealLeaves: SealUnilateralLeaf[] | undefined,
  presentHex: string,
): { ok: true; leaves: RelaySealData["leaves"] } | { ok: false; reason: string } {
  if (!sealLeaves || sealLeaves.length === 0) return { ok: false, reason: "unilateral_leaves_unavailable" };
  const leaves: RelaySealData["leaves"] = [];
  for (let i = 0; i < sealLeaves.length; i++) {
    const w = sealLeaves[i];
    let arr: unknown[];
    try {
      arr = cborDecode(w.structure2_cbor) as unknown[];
    } catch {
      return { ok: false, reason: "unilateral_leaf_malformed" };
    }
    if (!Array.isArray(arr) || arr.length !== 6) return { ok: false, reason: "unilateral_leaf_malformed" };
    const sequence_number = typeof arr[0] === "number" ? arr[0] : typeof arr[0] === "bigint" ? Number(arr[0]) : NaN;
    const sender_pubkey = u8(arr[1]);
    const content_hash = u8(arr[2]);
    const sender_signature = u8(arr[3]);
    const prev_root = u8(arr[5]);
    if (
      !Number.isInteger(sequence_number) ||
      sender_pubkey.length !== 32 ||
      content_hash.length !== 32 ||
      sender_signature.length !== 64 ||
      prev_root.length !== 32
    ) {
      return { ok: false, reason: "unilateral_leaf_malformed" };
    }
    // The wire seq must match the relay-signed Structure2 seq (no relabel of the carried envelope).
    if (sequence_number !== w.sequence_number) return { ok: false, reason: "unilateral_leaf_seq_mismatch" };
    // CONTIGUITY: leaves arrive ordered; the relay sequence is 1-based, so require exactly 1..N (no gap).
    if (sequence_number !== i + 1) return { ok: false, reason: "unilateral_chain_noncontiguous" };
    const s2: Structure2 = { sequence_number, sender_pubkey, content_hash, sender_signature, scan_result: SCAN_RESULT_SENTINEL, prev_root };
    // Present-party leaf → MUST carry a valid relay receipt (the seq-pinning teeth).
    if (Buffer.from(sender_pubkey).toString("hex") === presentHex) {
      if (!w.relay_id || w.relay_timestamp === undefined || !w.relay_signature) return { ok: false, reason: "unilateral_own_leaf_unwitnessed" };
      if (!/^[0-9a-fA-F]{64}$/.test(w.relay_id)) return { ok: false, reason: "unilateral_receipt_bad_relay_id" };
      const relayPubkey = new Uint8Array(Buffer.from(w.relay_id, "hex"));
      if (!verify(relayPubkey, buildRelayAckTbs(content_hash, sequence_number, w.relay_timestamp), w.relay_signature)) {
        return { ok: false, reason: "unilateral_receipt_invalid" };
      }
    }
    const kind = LEAF_KINDS[w.leaf_kind];
    if (!kind) return { ok: false, reason: "unilateral_leaf_kind_unknown" };
    // Carried through when present — dropping it here would make a relay that DOES send the payload
    // indistinguishable from one that does not, which is the absent-versus-verified collapse again.
    leaves.push({ kind, s2, structure1_cbor: w.structure1_cbor, ...(w.content_bytes ? { content_bytes: w.content_bytes } : {}) });
  }
  return { ok: true, leaves };
}

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
