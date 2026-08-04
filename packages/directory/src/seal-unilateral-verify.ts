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
    leaves.push({ kind, s2, structure1_cbor: w.structure1_cbor });
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
  }
  return { ok: true, leaves: raw as RelaySealData["leaves"] };
}

/** The only leaf domains a relay may assert on the wire. Mirrors LEAF_KINDS' value set. */
const SEAL_SUBMISSION_LEAF_KINDS: readonly string[] = Object.values(LEAF_KINDS);
