/**
 * THE ONE SEAL-CHAIN VERIFIER — shared by the directory and the relay (`031-RELAYREPLAY`, Part 1).
 *
 * Every function here was MOVED, not copied:
 *   - `reconstructCarriedSealLeaves` + `LEAF_KINDS` ← `packages/directory/src/seal-unilateral-verify.ts`
 *   - `SEAL_FINAL_ROOT_REASONS`, `verifyLeafProvenance`, `decodeStructure1Signed` ← `.../seal-final-root.ts`
 *   - `decodeStructure1Fields` ← `.../directory-node.ts`
 *   - `verifySealLeafChain` + `verifySealCtrlLeaf` ← the two halves of `#verifyUnilateralChain`,
 *     a private method on `DirectoryNode` that read no `this` and was already pure.
 *
 * Each original site now imports from here and re-exports the name it used to define, so no
 * directory call site or test changed shape. There is exactly one definition of each.
 *
 * **Why extraction rather than a copy, stated where the next reader will be tempted.** M15 has paid
 * twice for a verifier maintained in two places — `017-TBS` (a duplicated assignment TBS builder)
 * and `020-ACKHASH` (a duplicated `encodeStructure1`, where deleting the copy exposed a live drift
 * between the canonical definition and the bytes actually signed, with no type error and a green
 * gate). A second copy of a SEAL verifier drifts the same way, and its failure mode is worse: one
 * witness accepts a chain the other would refuse, so the receipt depends on which relay was awake.
 */

import { decode as cborDecode } from "cbor-x";
import { verify, buildRelayAckTbs, buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import type { LeafInput } from "@cello-protocol/crypto";
import { SCAN_RESULT_SENTINEL, encodeStructure2 } from "@cello-protocol/protocol-types";
import type { Structure2 } from "@cello-protocol/protocol-types";
import type { SealUnilateralLeaf, RelaySealData, RelaySealLeaf } from "./seal-leaf-types.js";

// ─── Shared primitives ────────────────────────────────────────────────────────

function bufEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

const u8 = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : Buffer.isBuffer(v) ? new Uint8Array(v) : new Uint8Array());

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
export const LEAF_KINDS: Readonly<Record<number, "msg" | "ctrl" | "doc" | "reject">> = {
  0x00: "msg",
  0x02: "ctrl",
  0x04: "doc",
  0x05: "reject",
};

// ─── Structure 1 decoding ─────────────────────────────────────────────────────

export interface Structure1Fields {
  content_hash: Uint8Array;
  session_id: Uint8Array;
  last_seen_seq: number;
  timestamp: number | bigint;
  /** 020-ACKHASH: the acknowledged content, on a v2 claim only. Read, not yet checked. */
  last_seen_hash?: Uint8Array;
}

/**
 * Structure 1 TBS:
 *   v1: [1, content_hash(32), sender_pubkey(32), session_id(16), last_seen_seq, timestamp]
 *   v2: [2, …the same five…, last_seen_hash(32)]        ← 020-ACKHASH
 *
 * ⚠️ THIS REFUSED EVERY SEVEN-FIELD ARRAY UNTIL 020-ACKHASH, and that is the load-bearing change.
 * `DOD-M15-SUBMIT-ID-1` widened the RELAY to accept a seven-field claim carrying a submission id
 * but never widened the directory, so a leaf the relay accepts and orders could not be verified at
 * seal time here. Two shapes now land at index 6 and the VERSION is what tells them apart — a
 * length check cannot, because a submission id and an ack hash are both just bytes.
 *
 * Every index this function already read is unchanged, which is why the field was appended rather
 * than inserted: `content_hash` is still 1, `last_seen_seq` still 4, `timestamp` still 5.
 */
// Exported for 020-ACKHASH unit coverage: this refused EVERY seven-field claim before that unit, so
// the tolerance it gained is the thing most worth pinning. Pure function; no state.
export function decodeStructure1Fields(cbor: Uint8Array): Structure1Fields | null {
  let arr: unknown;
  try {
    arr = cborDecode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const [_pv, _ch, , _sid, _lss, _ts, _tail] = arr;
  const isV1 = _pv === 1 && (arr.length === 6 || arr.length === 7);
  const isV2 = _pv === 2 && arr.length === 7;
  // An unnamed (version, length) pair is REFUSED, never coerced into the nearest known layout —
  // this would otherwise be a signature verified over bytes whose meaning is not agreed.
  if (!isV1 && !isV2) return null;
  const chBytes = _ch instanceof Uint8Array ? _ch : Buffer.isBuffer(_ch) ? new Uint8Array(_ch as Buffer) : null;
  if (!chBytes || chBytes.length !== 32) return null;
  const sidBytes = _sid instanceof Uint8Array ? _sid : Buffer.isBuffer(_sid) ? new Uint8Array(_sid as Buffer) : null;
  if (!sidBytes || sidBytes.length !== 16) return null;
  if (typeof _lss !== "number") return null;
  if (typeof _ts !== "number" && typeof _ts !== "bigint") return null;
  let lastSeenHash: Uint8Array | undefined;
  if (isV2) {
    const b = _tail instanceof Uint8Array ? _tail : Buffer.isBuffer(_tail) ? new Uint8Array(_tail as Buffer) : null;
    // Exactly 32 — a SHA-256 root. Present-but-malformed is refused rather than dropped: a v2 whose
    // hash is unreadable is an acknowledgement nobody can check, and admitting it without the field
    // would make a corrupt ack indistinguishable from an honest v1 that never claimed one.
    if (!b || b.length !== 32) return null;
    lastSeenHash = b;
  }
  // A v1 seven-array's index 6 is a SUBMISSION ID (`DOD-M15-SUBMIT-ID-1`) and is deliberately not
  // read here — the directory has no use for it, and reading it as an ack hash is the confusion the
  // version tag exists to prevent.
  return {
    content_hash: chBytes,
    session_id: sidBytes,
    last_seen_seq: _lss,
    timestamp: _ts,
    ...(lastSeenHash ? { last_seen_hash: lastSeenHash } : {}),
  };
}

/**
 * The content hash the CLIENT SIGNED, decoded from `structure1_cbor`.
 *
 * Structure 1 TBS:
 *   v1: `[1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`
 *   v2: `[2, …the same five…, last_seen_hash]`          ← 020-ACKHASH
 *
 * — the exact byte string the sender's Ed25519 signature covers. Decoded here rather than taken
 * from `s2` so this module's central claim is enforced by this module (review F1). The two fields
 * read below sit at indices 1 and 3 in both layouts; the field was appended at 6 so they did not
 * move.
 *
 * A (version, length) pair this build cannot name is refused, never coerced into the nearest known
 * layout — the version tag is what separates a v1 seven-array's submission id from a v2's ack hash,
 * and they are both just bytes at index 6.
 *
 * Returns null rather than throwing: these bytes arrive off a wire, and a decode failure is a
 * refusal to report, never an exception escaping into a stream handler.
 */
export function decodeStructure1Signed(cbor: Uint8Array): { content_hash: Uint8Array; session_id: Uint8Array } | null {
  let arr: unknown;
  try {
    arr = cborDecode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const version = arr[0];
  const isV1 = version === 1 && (arr.length === 6 || arr.length === 7);
  const isV2 = version === 2 && arr.length === 7;
  if (!isV1 && !isV2) return null;
  const bytesAt = (i: number, len: number): Uint8Array | null => {
    const v = arr[i];
    const b = v instanceof Uint8Array ? v : Buffer.isBuffer(v) ? new Uint8Array(v as Buffer) : null;
    return b !== null && b.length === len ? b : null;
  };
  const content_hash = bytesAt(1, 32);
  const session_id = bytesAt(3, 16);
  return content_hash !== null && session_id !== null ? { content_hash, session_id } : null;
}

// ─── Refusal reasons ──────────────────────────────────────────────────────────

/**
 * Why a `final_root` verification did not conclude "verified".
 *
 * A CLOSED set with a total guidance map, for the reason `refusal-reasons.ts` records: a free-form
 * reason string let a new code slip past every test in its own guard file.
 *
 * ⚠️ The guidance map itself stays in `packages/directory/src/seal-final-root.ts`. It is typed
 * `Record<SealFinalRootReason, string>`, so `tsc` — not vigilance — is what keeps it total against
 * this union across the package boundary. Adding a reason here without guidance there is a build
 * error, which is the whole reason the two may live apart.
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

// ─── Carried-leaf reconstruction ──────────────────────────────────────────────

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
 *     ack-sign a delivery to the recipient) and are pinned instead by their sender_signature (verified in
 *     `verifySealLeafChain`) + sequence contiguity against the receipt-pinned own leaves.
 *
 * Returns the reconstructed RelaySealLeaf[] for `verifySealLeafChain` (which then enforces
 * content-root==reported_root, sender sigs, the prev_root chain, the signed last_seen_seq causal order, and —
 * via `verifySealCtrlLeaf`, on the seal path only — exactly-one-ctrl-from-the-present-party). Decoding then
 * re-encoding Structure2 is byte-faithful — the canonical scan-result sentinel is rebuilt by encodeStructure2
 * — so the downstream merkle/chain checks hold.
 *
 */
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

// ─── Provenance ───────────────────────────────────────────────────────────────

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

// ─── The chain itself ─────────────────────────────────────────────────────────

/**
 * SESSION-002: rebuild the Merkle root from the signed-leaf chain and verify it against the
 * reported root. Read-only; no state mutation.
 *
 * ⚠️ SPLIT FROM `#verifyUnilateralChain` BY `031-RELAYREPLAY`, AND THE SPLIT POINT IS THE WHOLE
 * REASON THERE ARE TWO FUNCTIONS. Clauses (a)–(d) plus provenance ask *"is this chain real?"* — a
 * question a relay inheriting a live conversation must ask too. The exactly-one-SEAL-ctrl-leaf
 * clause asks *"is this a closing ceremony?"*, which is true only on the seal path: a replayed
 * mid-conversation chain has no ctrl leaf and requiring one would refuse every honest handover.
 *
 * The split is a `&&`, not a weakening: the seal path still runs both, in this order, with the same
 * reason codes. It is expressed as two functions rather than one boolean parameter on purpose — a
 * flag that switches a check off is the shape M15 spends itself removing, and a caller that never
 * calls the second function is visible in a grep in a way `{ requireCtrl: false }` is not.
 */
export function verifySealLeafChain(
  leaves: RelaySealData["leaves"],
  reportedRoot: Uint8Array,
  sessionId: Uint8Array,
  roster: readonly [Uint8Array, Uint8Array],
): { ok: true; recomputedRoot: Uint8Array } | { ok: false; reason: string } {
  // (a) Rebuild the CLIENT-VERIFIABLE root and compare to the reported root. The client's
  // local SessionTree hashes each leaf as its content_hash (kind "hash"), NOT as
  // encodeStructure2(s2) — the latter is the relay/directory internal integrity root the
  // client cannot reproduce (it lacks the relay-assigned Structure 2 fields). So the root the
  // directory signs + the present party verifies is the content-hash root, rebuilt here from
  // each leaf's authenticated s2.content_hash. The encodeStructure2 chain below proves those
  // content_hashes are authentic + correctly ordered; this root is what the cert binds.
  const contentInputs: LeafInput[] = leaves.map((l) => ({ kind: "hash" as const, data: l.s2.content_hash }));
  const recomputedRoot = merkleRoot(buildMerkleTree(contentInputs));
  if (!bufEqual(recomputedRoot, reportedRoot)) {
    return { ok: false, reason: "unilateral_root_unverifiable" };
  }

  // (b–d) Per-leaf Structure 1 signature, prev_root chain, and causal-chain verification.
  let runningRoot = leaves.length > 0 ? leaves[0].s2.prev_root : new Uint8Array(32);
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (!verify(leaf.s2.sender_pubkey, leaf.structure1_cbor, leaf.s2.sender_signature)) {
      return { ok: false, reason: "unilateral_root_unverifiable" };
    }
    const s1Fields = decodeStructure1Fields(leaf.structure1_cbor);
    if (!s1Fields) return { ok: false, reason: "unilateral_root_unverifiable" };
    // Defense-in-depth: the sender-signed content_hash (Structure1) must match the relay-assigned
    // content_hash (Structure2). A compromised relay could deliver divergent values; the prev_root
    // chain catches this downstream but an explicit check fails FAST with a clear reason.
    if (!bufEqual(s1Fields.content_hash, leaf.s2.content_hash)) {
      return { ok: false, reason: "unilateral_content_hash_mismatch" };
    }
    if (!bufEqual(leaf.s2.prev_root, runningRoot)) {
      return { ok: false, reason: "unilateral_root_unverifiable" };
    }
    const senderHex = Buffer.from(leaf.s2.sender_pubkey).toString("hex");
    let effectiveSeen = 0;
    for (let j = 0; j < i; j++) {
      const otherHex = Buffer.from(leaves[j].s2.sender_pubkey).toString("hex");
      if (otherHex !== senderHex && leaves[j].s2.sequence_number > effectiveSeen) {
        effectiveSeen = leaves[j].s2.sequence_number;
      }
    }
    if (s1Fields.last_seen_seq > effectiveSeen) {
      return { ok: false, reason: "unilateral_root_unverifiable" };
    }
    const partialInputs: LeafInput[] = leaves.slice(0, i + 1).map((l) => ({ kind: l.kind, data: encodeStructure2(l.s2) }));
    runningRoot = merkleRoot(buildMerkleTree(partialInputs));
  }

  /**
   * EVERY LEAF BELONGS TO THIS PAIR AND THIS SESSION — `DOD-M15-LEAFPARTIES-1`.
   *
   * The same check the bilateral path runs, from the same module, because it is the same question.
   * The adversary differs: here the chain is CARRIED BY THE PRESENT PARTY, so the party assembling
   * the array is a participant rather than the relay. That does not weaken the case — a present
   * party can hold a genuinely-signed leaf from a third key it once talked to, or one of its own
   * from another conversation, and neither belongs in this receipt.
   *
   * ⚠️ PLACED AFTER THE LOOP ABOVE, AND THE POSITION IS THE PRECONDITION — the same one
   * `seal-final-root.ts`'s header states. Until `verify(s2.sender_pubkey, structure1_cbor,
   * s2.sender_signature)` has run for every leaf, `sender_pubkey` is a field the assembler filled
   * in, and asking whether it is a participant is asking the assembler about itself.
   *
   * The roster is not degraded on this path: `#processSealUnilateral` REFUSES outright when the
   * session participants are unknown, so both facts are anchored to the directory's own record.
   */
  const provenance = verifyLeafProvenance(leaves, sessionId, roster);
  if (!provenance.ok) return { ok: false, reason: provenance.reason };

  return { ok: true, recomputedRoot };
}

/**
 * (e) Exactly ONE SEAL control leaf (kind "ctrl"), from the present (submitting) party.
 *
 * The SEAL-path half of the old `#verifyUnilateralChain`. See `verifySealLeafChain`'s header for
 * why it is a separate function rather than a flag.
 */
export function verifySealCtrlLeaf(
  leaves: RelaySealData["leaves"],
  presentHex: string,
): { ok: true } | { ok: false; reason: string } {
  const ctrlLeaves = leaves.filter((l) => l.kind === "ctrl");
  if (ctrlLeaves.length !== 1) {
    return { ok: false, reason: "unilateral_seal_leaf_invalid" };
  }
  const sealLeafSender = Buffer.from(ctrlLeaves[0].s2.sender_pubkey).toString("hex");
  if (sealLeafSender !== presentHex) {
    return { ok: false, reason: "unilateral_seal_leaf_invalid" };
  }
  return { ok: true };
}
