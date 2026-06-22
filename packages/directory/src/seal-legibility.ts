/**
 * CELLO-M7-SESSION-004 — Seal certificate legibility derivation (directory)
 *
 * POSTMORTEM Part 3 (C-1 receipt-not-assent; C-2 acknowledgement frontier and the
 * tail; C-6 malicious-tail / legibility — all SETTLED). The directory derives the
 * legibility object at seal time from the leaves it already verifies in processSeal
 * (the signed Structure 1 last_seen_seq, the per-leaf sender pubkeys, and the
 * Structure 2 sequence numbers). It is carried on the SessionSealed wire frame and
 * persisted CLIENT-SIDE — the directory persists NOTHING new (no Flyway migration).
 *
 * The receipt-not-assent property is a constant: a signature over a hash chain can
 * prove exactly three things — these bytes existed, in this order, delivered to/from
 * me — and is cryptographically INCAPABLE of proving agreement.
 *
 * NOTE on cross-repo typing: the published @cello-protocol/protocol-types (^0.0.4)
 * does not yet carry the SealLegibility type (it ships in the SESSION-004 bump,
 * deferred to milestone close per COORDINATION batching). To keep the directory
 * gates green before that publish, the wire shape is mirrored locally here — the
 * same local-mirror pattern directory-types.ts uses for RelaySealData. After the
 * protocol-types dep bump (AC-013), this should import the canonical type.
 *
 * Crypto/encoding refs: CBOR canonical RFC 8949 §4.2.1; SHA-256 FIPS 180-4.
 */

import { decode as cborDecode } from "cbor-x";
import type {
  RelaySealLeaf,
  AttestationMode,
  SealLegibility,
  SealLegibilityParticipant,
  SealLegibilityFinalMessage,
} from "./directory-types.js";

export type { AttestationMode, SealLegibility } from "./directory-types.js";

/**
 * Canonical receipt-not-assent disclaimer. MUST stay byte-for-byte identical to
 * `SEAL_RECEIPT_DISCLAIMER` exported from @cello-protocol/protocol-types — mirrored
 * here only because the published type/constant predates this story's bump.
 */
export const SEAL_RECEIPT_DISCLAIMER =
  "This certificate attests faithful receipt, integrity, and ordering of the " +
  "transcript. No signature in this certificate implies agreement to, or assent " +
  "to, the contents of any message. Agreement is always a separate, explicit act " +
  "(its own signed reply). A sealed transcript is a receipt, never a record of agreement.";

/**
 * Decode the signed last_seen_seq from a Structure 1 TBS CBOR.
 * Structure 1 TBS = [protocol_version, content_hash, sender_pubkey, session_id,
 *                    last_seen_seq, timestamp]. last_seen_seq is index 4.
 * Returns null on malformed input (so a malformed leaf cannot inflate a frontier).
 */
function decodeSignedLastSeenSeq(cbor: Uint8Array): number | null {
  let arr: unknown;
  try {
    arr = cborDecode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length < 5) return null;
  const lss = arr[4];
  if (typeof lss === "number") return lss;
  if (typeof lss === "bigint") return Number(lss);
  return null;
}

/**
 * Identify the indices of the trailing SEAL ceremony control leaves, if present.
 * Per verifySealLeaves, a completed seal ends with two ctrl leaves from distinct
 * participants. Those two are the closing ceremony — NOT content replies — and must
 * be excluded from the `answered` determination (otherwise the counterparty's own
 * SEAL acknowledgement would falsely mark a malicious unanswered tail as answered).
 */
function sealCeremonyLeafIndices(leaves: RelaySealLeaf[]): Set<number> {
  const excluded = new Set<number>();
  if (leaves.length < 2) return excluded;
  const last = leaves[leaves.length - 1]!;
  const secondLast = leaves[leaves.length - 2]!;
  if (last.kind !== "ctrl" || secondLast.kind !== "ctrl") return excluded;
  const lastSender = Buffer.from(last.s2.sender_pubkey).toString("hex");
  const secondLastSender = Buffer.from(secondLast.s2.sender_pubkey).toString("hex");
  if (lastSender === secondLastSender) return excluded;
  excluded.add(leaves.length - 1);
  excluded.add(leaves.length - 2);
  return excluded;
}

/**
 * Identify the participants (by hex pubkey) who authored a leaf in the contiguous
 * trailing run of SEAL ceremony control leaves. buildSealLegibility is only invoked
 * AFTER the seal is verified (processSeal), so the closing run of ctrl leaves IS the
 * seal ceremony — each author in it produced a contemporaneous SEAL acknowledgement
 * and is therefore 'live'.
 *
 * Review finding #2 (CELLO-M7-SESSION-004): the previous implementation only treated
 * the BILATERAL two-ctrl tail as the ceremony, so a participant who sealed while the
 * counterparty never returned (a lone trailing SEAL ctrl leaf — the never-returned /
 * unilateral shape) was mislabelled 'absent'. The contiguous trailing run captures
 * both the bilateral two-ctrl case and the lone-ctrl case.
 *
 * NOTE: this set is distinct from `sealCeremonyLeafIndices` (the matched bilateral
 * pair used for the `answered` determination). A single trailing ctrl leaf is a SEAL
 * ack for the live-marker purpose, but for `answered` a lone trailing ctrl authored
 * by the counterparty of the final message must still count as a reply (AC-004
 * contrasting case) — the two questions intentionally use different leaf sets.
 */
function trailingSealCtrlAuthors(leaves: RelaySealLeaf[]): Set<string> {
  // INVARIANT (review finding, low): the protocol defines exactly ONE control-leaf kind —
  // the SEAL ceremony leaf (LEAF_KIND_CTRL = 0x02). There is no other ctrl-leaf type, so every
  // leaf with kind 'ctrl' in a verified seal IS a SEAL ceremony leaf and its author DID produce a
  // contemporaneous SEAL acknowledgement ⇒ 'live'. If a future protocol adds a distinct ctrl-leaf
  // kind, this walk must discriminate on that kind (verifySealLeaves would also need updating);
  // until then the contiguous trailing ctrl run is exactly the closing ceremony.
  const authors = new Set<string>();
  for (let i = leaves.length - 1; i >= 0; i--) {
    if (leaves[i]!.kind !== "ctrl") break;
    authors.add(Buffer.from(leaves[i]!.s2.sender_pubkey).toString("hex"));
  }
  return authors;
}

/**
 * Build the legibility object for a verified seal leaf set.
 *
 * Derivation (story behavior triggers):
 *   - content_frontier_seq[P] = max signed last_seen_seq across leaves P SIGNED.
 *     Derived ONLY from leaves whose signature P produced — never a self-asserted
 *     value (SI-002). Clamped to the signed maximum by construction.
 *   - last_authored_seq[P] = max s2.sequence_number across leaves P authored.
 *   - final_message = the highest-sequence content (kind 'msg', non-control) leaf.
 *   - answered = there exists a leaf authored by a DIFFERENT participant than
 *     final_message.sender with sequence_number strictly greater than
 *     final_message.seq, EXCLUDING the trailing SEAL ceremony control leaves.
 *   - attestation_mode = 'live' for a participant who produced a contemporaneous
 *     SEAL ctrl leaf in this ceremony, unless overridden (A/C populate
 *     'absent'/'recovered'). Always present; exactly one of the three values.
 *
 * INTERPRETATION (story is ambiguous; stated explicitly): a SEAL control leaf is
 * the closing ceremony, not a content reply, so it is excluded from the `answered`
 * existence check. This is the only reading consistent with BOTH the malicious-tail
 * intent (a bilateral seal always ends with the counterparty's SEAL ctrl leaf at a
 * higher sequence, yet must read `answered: false`) and the AC-004 contrasting case.
 *
 * @param leaves verified seal leaf set (RelaySealLeaf[]) from processSeal
 * @param opts.attestationOverrides per-participant (hex pubkey) mode overrides for
 *        the 'absent' (Workstream A) and 'recovered' (Workstream C) cases.
 */
export function buildSealLegibility(
  leaves: RelaySealLeaf[],
  opts?: { attestationOverrides?: Map<string, AttestationMode> },
): SealLegibility {
  const overrides = opts?.attestationOverrides;
  const sealIndices = sealCeremonyLeafIndices(leaves);
  // Authors of the contiguous trailing SEAL ceremony ctrl run ⇒ 'live'. Distinct from
  // `sealIndices` (the matched bilateral pair used only for the `answered` check).
  const producedSealCtrl = trailingSealCtrlAuthors(leaves);

  // Participants in first-seen order of authored leaves.
  const order: string[] = [];
  const frontier = new Map<string, number>();
  const lastAuthored = new Map<string, number>();
  const pubkeyByHex = new Map<string, Uint8Array>();

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    const senderHex = Buffer.from(leaf.s2.sender_pubkey).toString("hex");
    if (!pubkeyByHex.has(senderHex)) {
      pubkeyByHex.set(senderHex, new Uint8Array(leaf.s2.sender_pubkey));
      order.push(senderHex);
    }

    // content_frontier_seq: max signed last_seen_seq across this sender's OWN leaves.
    const signedLss = decodeSignedLastSeenSeq(leaf.structure1_cbor);
    if (signedLss !== null) {
      const cur = frontier.get(senderHex) ?? 0;
      if (signedLss > cur) frontier.set(senderHex, signedLss);
    }

    // last_authored_seq: max s2.sequence_number authored by this sender.
    const seq = leaf.s2.sequence_number;
    const curAuthored = lastAuthored.get(senderHex) ?? 0;
    if (seq > curAuthored) lastAuthored.set(senderHex, seq);
  }

  const participants: SealLegibilityParticipant[] = order.map((hex) => {
    const overridden = overrides?.get(hex);
    const mode: AttestationMode =
      overridden ?? (producedSealCtrl.has(hex) ? "live" : "absent");
    return {
      pubkey: pubkeyByHex.get(hex)!,
      content_frontier_seq: frontier.get(hex) ?? 0,
      last_authored_seq: lastAuthored.get(hex) ?? 0,
      attestation_mode: mode,
    };
  });

  // final_message: highest-sequence content (non-control) leaf.
  let finalIdx = -1;
  let finalSeq = -1;
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (leaf.kind !== "msg") continue;
    if (leaf.s2.sequence_number > finalSeq) {
      finalSeq = leaf.s2.sequence_number;
      finalIdx = i;
    }
  }

  let finalMessage: SealLegibilityFinalMessage;
  if (finalIdx === -1) {
    // No content leaves at all (e.g. a pure-control transcript). Fall back to the
    // highest-sequence leaf overall so the field is always populated and honest.
    let idx = 0;
    let seq = -1;
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i]!.s2.sequence_number > seq) { seq = leaves[i]!.s2.sequence_number; idx = i; }
    }
    const leaf = leaves[idx]!;
    finalMessage = {
      sender_pubkey: new Uint8Array(leaf.s2.sender_pubkey),
      seq: leaf.s2.sequence_number,
      answered: false,
    };
  } else {
    const finalLeaf = leaves[finalIdx]!;
    const finalSenderHex = Buffer.from(finalLeaf.s2.sender_pubkey).toString("hex");
    let answered = false;
    for (let i = 0; i < leaves.length; i++) {
      if (sealIndices.has(i)) continue; // exclude the closing ceremony leaves
      const leaf = leaves[i]!;
      const senderHex = Buffer.from(leaf.s2.sender_pubkey).toString("hex");
      if (senderHex !== finalSenderHex && leaf.s2.sequence_number > finalSeq) {
        answered = true;
        break;
      }
    }
    finalMessage = {
      sender_pubkey: new Uint8Array(finalLeaf.s2.sender_pubkey),
      seq: finalSeq,
      answered,
    };
  }

  return {
    attests: "receipt",
    implies_assent: false,
    disclaimer: SEAL_RECEIPT_DISCLAIMER,
    participants,
    final_message: finalMessage,
  };
}
