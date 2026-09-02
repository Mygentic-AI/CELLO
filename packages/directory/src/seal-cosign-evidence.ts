/**
 * A CO-SIGNING DIRECTORY REACHES ITS OWN VERDICT — `DOD-M15-SEALPARTIES-1`, work item 2.
 *
 * ─── What a co-signer was being asked to do ────────────────────────────────────────────────────
 *
 * A seal is FROST-signed with the initiator's group key, whose shares live on the directory nodes.
 * The initiator's daemon coordinates: it asks each node for a nonce commitment, then for a partial
 * signature over `framedMsg` — `context ‖ 0x00 ‖ tbs`, opaque bytes.
 *
 * Every node but the one that ran the verification checked two things before signing: that it holds
 * a share for this agent and epoch, and that no ceremony for the same pair is in flight from another
 * peer. Then it signed whatever it was handed. That is cryptographic weight without judgement —
 * three signatures that all rest on one node's reading of the leaves, and a threshold whose whole
 * purpose is that no single node can produce a valid output alone.
 *
 * ─── What it can check for itself, and what it cannot ──────────────────────────────────────────
 *
 * Given the raw signed leaves it can rebuild, from scratch, the two values the TBS binds:
 *
 *   - the CERTIFIED ROOT — the Merkle root over each leaf's `content_hash`, read out of the bytes
 *     the sender's own Ed25519 signature covers (`structure1_cbor`), never out of a field somebody
 *     else filled in;
 *   - the LEAF COUNT.
 *
 * It also checks that every leaf is signed by the key it names, that every leaf's own signed bytes
 * name the session being sealed, and that no more than two distinct keys appear. Then it requires
 * the framed message to be EXACTLY the seal TBS over those reconstructed values. A leaf set that
 * does not produce the root in front of it gets no share of this node's key.
 *
 * And on a BILATERAL seal it re-derives **both participants' own signed transcript roots** from the
 * carried SEAL payloads and requires two of them, agreeing with each other and with the leaves shown
 * — the same arithmetic the verifying node runs, deliberately re-derived rather than trusted. Review
 * F2: without it, the unit's headline requirement still rested on that one node, and a directory
 * that skipped the check got its threshold signature anyway because the co-signers had nothing to
 * disagree with.
 *
 * ⚠️ **WHAT THIS DELIBERATELY DOES NOT CLAIM.** Two things are outside a co-signer's reach and
 * saying otherwise would be worse than not checking them:
 *
 *   1. **Membership.** With no session record for a session it did not broker — the normal federated
 *      case — this node cannot say WHICH two keys should be in the conversation, only that there are
 *      at most two. A substitution is invisible here (`DOD-M15-SEALROSTER-FEDERATED-1`), and so is a
 *      relay-minted ctrl leaf that copies the honest party's `final_root`.
 *   2. **The legibility tail's CONTENT.** The bilateral TBS carries a trailing 32-byte legibility
 *      hash, derived from relay-assigned sequence numbers this node never receives. Its presence is
 *      load-bearing (it is what distinguishes a bilateral seal from a solo one, above) but what it
 *      hashes rests on the verifying node alone.
 *
 * What the check does buy is the thing the unit is for: a directory that certifies a root over a
 * leaf set the participants never produced, or over one they did not both approve, cannot get a
 * threshold signature for it — the other holders rebuild both answers themselves and refuse.
 */

import { createHash } from "node:crypto";
import { decode as cborDecode } from "cbor-x";
import { verify, buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { buildSealTbs, decodeSealPayload } from "@cello-protocol/protocol-types";

/** The FROST domain-separation context a conversation seal is signed under. */
export const SEAL_FROST_CONTEXT = "cello-frost-seal-v1";

/** The trailing legibility hash a BILATERAL seal TBS carries; a unilateral one carries none. */
const LEGIBILITY_HASH_BYTES = 32;

/**
 * Why a co-signer refused. Free-form reason strings let a new code slip past every test in its own
 * guard file (`refusal-reasons.ts` records the incident), so this is a closed set.
 */
export const SEAL_COSIGN_REASONS = {
  /** No leaves came with a SEAL sign request. Absence is not a pass — see the note below. */
  EVIDENCE_MISSING: "SEAL_EVIDENCE_MISSING",
  /** The leaves are not a decodable array of signed leaves. */
  EVIDENCE_MALFORMED: "SEAL_EVIDENCE_MALFORMED",
  /** A leaf's signature does not verify under the key the leaf names. */
  LEAF_SIGNATURE_INVALID: "SEAL_LEAF_SIGNATURE_INVALID",
  /** Leaves disagree about which session they belong to. */
  LEAF_SESSION_MISMATCH: "SEAL_LEAF_SESSION_MISMATCH",
  /** More than two distinct keys signed leaves in a two-party conversation. */
  THIRD_SIGNER: "SEAL_THIRD_SIGNER",
  /** The leaves do not produce the root and count the message asks this node to sign. */
  ROOT_UNSUPPORTED: "SEAL_ROOT_UNSUPPORTED",
  /** The message is not a seal TBS at all — a wrong context, or a shape this node cannot read. */
  NOT_A_SEAL_TBS: "SEAL_TBS_UNREADABLE",
  /**
   * A BILATERAL seal where fewer than two participants carried a signed transcript root, or where a
   * carried one does not describe the leaves presented.
   *
   * Review F2: without this a co-signer judged only the ROOT, so the unit's headline requirement —
   * both participants approve — still rested on the single verifying node, and the DoD line's claim
   * that the anchor "does not depend on directory behaviour at all" was false for that half.
   */
  APPROVAL_UNSUPPORTED: "SEAL_APPROVAL_UNSUPPORTED",
} as const;

export type SealCosignReason = (typeof SEAL_COSIGN_REASONS)[keyof typeof SEAL_COSIGN_REASONS];

/** What an operator should do about each refusal. Total over the union by construction. */
export const SEAL_COSIGN_GUIDANCE: Record<SealCosignReason, string> = {
  [SEAL_COSIGN_REASONS.EVIDENCE_MISSING]:
    "A seal signature was requested with no leaves attached, so this node was asked to sign a root it cannot check. Nothing was signed. The coordinating agent's build does not send the evidence yet — check its version; if it is current, treat a persistent absence as an attempt to get a signature without showing the record.",
  [SEAL_COSIGN_REASONS.EVIDENCE_MALFORMED]:
    "The leaves attached to a seal signature request are not readable as signed leaves. Compare builds with the coordinating agent before suspecting anything worse — an encoding difference produces exactly this.",
  [SEAL_COSIGN_REASONS.LEAF_SIGNATURE_INVALID]:
    "A leaf in the record presented for sealing does not verify under the key it names. It was altered or fabricated after the sender signed it. Nothing was signed; the session id and the leaf index are in the log.",
  [SEAL_COSIGN_REASONS.LEAF_SESSION_MISMATCH]:
    "The leaves presented for sealing do not all belong to the same conversation. A sentence said in another room has been grafted into this record. Nothing legitimate produces this — treat it as a replay by whoever assembled the leaf set.",
  [SEAL_COSIGN_REASONS.THIRD_SIGNER]:
    "More than two keys signed leaves in a two-party conversation, so at least one of them does not belong. Which one cannot be named from this node — it did not broker this session and holds no roster for it. Ask the node that assigned the session who its participants are.",
  [SEAL_COSIGN_REASONS.ROOT_UNSUPPORTED]:
    "The leaves presented do not produce the root this node was asked to sign. Whoever built the certificate is describing a different conversation, or this one with leaves added, dropped or reordered. This is the check that makes a threshold signature mean something; nothing was signed.",
  [SEAL_COSIGN_REASONS.APPROVAL_UNSUPPORTED]:
    "A two-party seal was presented for signature without both participants' own signed transcript root, or with one that does not describe the leaves shown. This node did not contribute its share. Either the verifying directory skipped the two-approval check, or the record it built is not the one the participants approved — both are faults on that node or on the relay feeding it, not on the agent coordinating this ceremony.",
  [SEAL_COSIGN_REASONS.NOT_A_SEAL_TBS]:
    "A signature was requested under the seal context over bytes that are not a seal TBS. Nothing was signed. Compare builds with the coordinating agent; a persistent mismatch after that is an attempt to borrow the seal context for something else.",
};

/** One leaf, as it travels with a sign request: the sender's signed bytes and its signature. */
export interface CosignLeaf {
  structure1_cbor: Uint8Array;
  sender_pubkey: Uint8Array;
  sender_signature: Uint8Array;
  /** The participant's SEAL payload, on a ctrl leaf that carried one. */
  content_bytes?: Uint8Array;
  /** Relay-supplied domain. Only ever narrows what this node will accept — see `SealFrontierLeaf`. */
  kind?: string;
}

export interface CosignVerdict {
  ok: boolean;
  reason?: SealCosignReason;
  detail?: string;
}

/** Does this framed message belong to the conversation-seal ceremony? */
export function isSealFramedMessage(framedMsg: Uint8Array): boolean {
  const sep = framedMsg.indexOf(0x00);
  if (sep <= 0) return false;
  return Buffer.from(framedMsg.subarray(0, sep)).toString("utf8") === SEAL_FROST_CONTEXT;
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  return null;
}

/**
 * Read the leaves off a wire frame. Shape only — every field is re-checked against a signature
 * below, so a permissive parse here cannot let anything through.
 */
export function parseCosignLeaves(raw: unknown): CosignLeaf[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CosignLeaf[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const s1 = toBytes(o["structure1_cbor"]);
    const pk = toBytes(o["sender_pubkey"]);
    const sig = toBytes(o["sender_signature"]);
    if (!s1 || !pk || !sig) return null;
    const cb = toBytes(o["content_bytes"]);
    const kind = typeof o["kind"] === "string" ? o["kind"] : undefined;
    out.push({
      structure1_cbor: s1,
      sender_pubkey: pk,
      sender_signature: sig,
      ...(cb ? { content_bytes: cb } : {}),
      ...(kind !== undefined ? { kind } : {}),
    });
  }
  return out;
}

/**
 * The content hash and session id a sender's own signature covers.
 *
 * Structure 1 TBS is `[protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq,
 * timestamp]`. Read from the SIGNED bytes rather than from any envelope field, so this module's
 * central claim is enforced by this module.
 */
function decodeSigned(cbor: Uint8Array): { contentHash: Uint8Array; sessionId: Uint8Array } | null {
  let arr: unknown;
  try {
    arr = cborDecode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== 6) return null;
  const contentHash = toBytes(arr[1]);
  const sessionId = toBytes(arr[3]);
  if (!contentHash || contentHash.length !== 32) return null;
  if (!sessionId || sessionId.length !== 16) return null;
  return { contentHash, sessionId };
}

function bufEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Decide, from the leaves alone, whether this node will lend its share to this seal.
 *
 * ⚠️ **THE MESSAGE IS RECONSTRUCTED, NOT PARSED.** It would be easier to CBOR-decode the TBS and
 * compare the root inside it, and it would be weaker: the TBS has a trailing legibility hash, so a
 * decoder has to be told where the CBOR ends, and a decoder that guesses is a decoder an attacker
 * can steer. Instead the expected `context ‖ 0x00 ‖ buildSealTbs(sessionId, root, count, timestamp)`
 * is built from values this node derived itself and required to be a PREFIX of what arrived, with a
 * remainder of exactly 0 or 32 bytes. There is nothing to steer: the bytes either match or they do
 * not.
 *
 * `closeTimestamp` is the one value that cannot be derived from the leaves — it is the verifying
 * node's clock reading — so it travels with the request and is bound by this comparison rather than
 * trusted: a wrong timestamp produces a message that is not a prefix and the request is refused.
 */
export function verifySealCosignEvidence(
  framedMsg: Uint8Array,
  rawLeaves: unknown,
  closeTimestamp: unknown,
): CosignVerdict {
  const sep = framedMsg.indexOf(0x00);
  if (sep <= 0 || Buffer.from(framedMsg.subarray(0, sep)).toString("utf8") !== SEAL_FROST_CONTEXT) {
    return { ok: false, reason: SEAL_COSIGN_REASONS.NOT_A_SEAL_TBS, detail: "the framed message does not carry the seal context" };
  }
  const ts = typeof closeTimestamp === "number"
    ? closeTimestamp
    : typeof closeTimestamp === "bigint"
      ? Number(closeTimestamp)
      : null;
  if (ts === null) {
    return { ok: false, reason: SEAL_COSIGN_REASONS.EVIDENCE_MISSING, detail: "no close timestamp accompanied the leaves" };
  }

  /**
   * ⚠️ AN EMPTY ARRAY IS ABSENCE, NOT MALFORMATION — fallback hunt, finding 4.
   *
   * The client sends `frontier_leaves` or nothing, and "nothing" arrives here as `[]` from a
   * coordinator whose frame carried none. Left to `parseCosignLeaves` that produced
   * `EVIDENCE_MALFORMED`, whose guidance says *"compare builds … before suspecting anything worse"* —
   * so the one case this module exists to catch was always filed as benign version skew, and
   * `EVIDENCE_MISSING` was unreachable from the real wire.
   */
  if (rawLeaves === undefined || rawLeaves === null || (Array.isArray(rawLeaves) && rawLeaves.length === 0)) {
    return { ok: false, reason: SEAL_COSIGN_REASONS.EVIDENCE_MISSING, detail: "no leaves accompanied a seal signature request" };
  }
  const leaves = parseCosignLeaves(rawLeaves);
  if (!leaves) {
    return { ok: false, reason: SEAL_COSIGN_REASONS.EVIDENCE_MALFORMED, detail: "the attached leaves are not an array of signed leaves" };
  }

  const senders = new Set<string>();
  const contentHashes: Uint8Array[] = [];
  let sessionId: Uint8Array | null = null;

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (!verify(leaf.sender_pubkey, leaf.structure1_cbor, leaf.sender_signature)) {
      return {
        ok: false,
        reason: SEAL_COSIGN_REASONS.LEAF_SIGNATURE_INVALID,
        detail: `leaf ${String(i)}: its signature does not verify under the key it names`,
      };
    }
    const signed = decodeSigned(leaf.structure1_cbor);
    if (!signed) {
      return {
        ok: false,
        reason: SEAL_COSIGN_REASONS.EVIDENCE_MALFORMED,
        detail: `leaf ${String(i)}: the signed bytes are not a readable Structure 1`,
      };
    }
    if (sessionId === null) sessionId = signed.sessionId;
    else if (!bufEqual(sessionId, signed.sessionId)) {
      return {
        ok: false,
        reason: SEAL_COSIGN_REASONS.LEAF_SESSION_MISMATCH,
        detail: `leaf ${String(i)}: its signed bytes name a different session than leaf 0`,
      };
    }
    senders.add(Buffer.from(leaf.sender_pubkey).toString("hex"));
    contentHashes.push(signed.contentHash);
  }

  if (sessionId === null) {
    return { ok: false, reason: SEAL_COSIGN_REASONS.EVIDENCE_MALFORMED, detail: "no leaves to read a session from" };
  }
  if (senders.size > 2) {
    return {
      ok: false,
      reason: SEAL_COSIGN_REASONS.THIRD_SIGNER,
      detail: `${String(senders.size)} distinct keys signed leaves in a two-party conversation, so at least one does not belong; which one is not derivable from this node`,
    };
  }

  const root = merkleRoot(buildMerkleTree(contentHashes.map((data) => ({ kind: "hash" as const, data }))));
  const expectedTbs = buildSealTbs(sessionId, root, leaves.length, ts);
  const expected = new Uint8Array(
    Buffer.concat([Buffer.from(SEAL_FROST_CONTEXT, "utf8"), Buffer.from([0x00]), Buffer.from(expectedTbs)]),
  );

  const remainder = framedMsg.length - expected.length;
  if (remainder !== 0 && remainder !== LEGIBILITY_HASH_BYTES) {
    return {
      ok: false,
      reason: SEAL_COSIGN_REASONS.ROOT_UNSUPPORTED,
      detail: `the message is ${String(framedMsg.length)} bytes; the leaves produce one of ${String(expected.length)} (plus an optional ${String(LEGIBILITY_HASH_BYTES)}-byte legibility hash)`,
    };
  }
  if (!bufEqual(framedMsg.subarray(0, expected.length), expected)) {
    return {
      ok: false,
      reason: SEAL_COSIGN_REASONS.ROOT_UNSUPPORTED,
      detail: `the ${String(leaves.length)} leaves presented produce root ${Buffer.from(root).toString("hex").slice(0, 16)}…, which is not what this signature would certify`,
    };
  }

  /**
   * 🚨 AND THE THING THE UNIT IS NAMED FOR: BOTH PARTICIPANTS APPROVED — review F2.
   *
   * Checking the root alone left the two-approval requirement resting on the single verifying node,
   * which is the condition this whole check exists to remove. A directory that skipped it still got
   * its threshold signature, because the co-signers had nothing to disagree with.
   *
   * ─── Which seals this applies to, and why the discriminator is safe ────────────────────────
   *
   * A BILATERAL TBS is bound to a legibility hash and a UNILATERAL one is not, so the 32-byte
   * remainder measured above says which kind of seal this is. That is a value the coordinator could
   * try to strip — and stripping it buys nothing: the message it would then get signed is not the
   * message the verifying directory built, so the combined signature fails that node's own check and
   * no certificate exists. It can produce a refusal, never a usable one-sided seal.
   *
   * On the SOLO path exactly one approval exists by design, because the counterparty is gone. This
   * check does not run there — nothing here may make a receipt harder for an honest party to obtain.
   */
  if (framedMsg.length - expected.length === LEGIBILITY_HASH_BYTES) {
    const approval = verifyBilateralApprovals(leaves, sessionId);
    if (!approval.ok) return approval;
  }
  return { ok: true };
}

/**
 * Both participants' own signed transcript roots, checked against the leaves in front of this node.
 *
 * The same arithmetic `verifySealFinalRoots` runs on the verifying node — deliberately the same, so
 * the two cannot reach different answers about the same bytes, and deliberately re-derived here
 * rather than taken on trust, so this node's verdict is its own.
 *
 * Last carried leaf per sender wins, exactly as the verifying node resolves it: a party may retry
 * its SEAL, and a superseded one is not evidence against anybody.
 */
function verifyBilateralApprovals(leaves: readonly CosignLeaf[], sessionId: Uint8Array): CosignVerdict {
  const nonCtrl: Array<{ kind: "hash"; data: Uint8Array }> = [];
  for (const leaf of leaves) {
    if (leaf.kind === "ctrl") continue;
    const signed = decodeSigned(leaf.structure1_cbor);
    if (!signed) continue; // unreachable: every leaf decoded in the caller's loop
    nonCtrl.push({ kind: "hash", data: signed.contentHash });
  }
  const expectedApprovalRoot = merkleRoot(buildMerkleTree(nonCtrl));

  const bySender = new Map<string, Uint8Array>();
  for (const leaf of leaves) {
    if (leaf.kind !== "ctrl" || !leaf.content_bytes) continue;
    const signed = decodeSigned(leaf.structure1_cbor);
    if (!signed) continue;
    // The payload must hash to the content the participant SIGNED — never to a relay envelope field.
    if (!bufEqual(sealContentHash(leaf.content_bytes), signed.contentHash)) {
      return {
        ok: false,
        reason: SEAL_COSIGN_REASONS.APPROVAL_UNSUPPORTED,
        detail: "a SEAL payload does not hash to the content its participant signed, so that signature never covered it",
      };
    }
    const payload = decodeSealPayload(leaf.content_bytes);
    if (!payload || !bufEqual(payload.session_id, sessionId)) {
      return {
        ok: false,
        reason: SEAL_COSIGN_REASONS.APPROVAL_UNSUPPORTED,
        detail: "a SEAL payload is unreadable or names a different conversation",
      };
    }
    bySender.set(Buffer.from(leaf.sender_pubkey).toString("hex"), payload.final_root);
  }

  if (bySender.size < 2) {
    return {
      ok: false,
      reason: SEAL_COSIGN_REASONS.APPROVAL_UNSUPPORTED,
      detail: `a two-party seal carried ${String(bySender.size)} participant approval(s); both are required before any signature exists`,
    };
  }
  for (const [senderHex, approvedRoot] of bySender) {
    if (!bufEqual(approvedRoot, expectedApprovalRoot)) {
      return {
        ok: false,
        reason: SEAL_COSIGN_REASONS.APPROVAL_UNSUPPORTED,
        detail: `participant ${senderHex.slice(0, 16)}… approved a different transcript than the leaves presented here describe`,
      };
    }
  }
  return { ok: true };
}

/** SHA-256(0x02 ‖ payload) — the participant's own SEAL content-hash derivation, reproduced exactly. */
function sealContentHash(payload: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(new Uint8Array([LEAF_KIND_CTRL])).update(payload).digest());
}

/** The ctrl leaf kind byte, and the domain separator inside the SEAL content hash. */
const LEAF_KIND_CTRL = 0x02;

/** SHA-256 of the leaf set, for correlating a refusal with the request that produced it. */
export function cosignEvidenceDigest(framedMsg: Uint8Array): string {
  return createHash("sha256").update(framedMsg).digest("hex").slice(0, 16);
}
