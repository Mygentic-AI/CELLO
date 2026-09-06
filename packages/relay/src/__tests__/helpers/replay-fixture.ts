/**
 * 031-RELAYREPLAY — build a REAL replayed conversation: signed leaves, a prior relay's ACK
 * receipts, and the counterparty's signed tip.
 *
 * ─── Why this is not `packages/e2e-tests/src/session-fixture.ts` ───────────────────────────────
 *
 * The standing rule is to extend that fixture and never write a new one, and the rule is right. It
 * cannot apply here, and the reason is the unit's own constraint rather than convenience: the spine
 * fixture drives REAL cello-client daemons, and no client emits a replay batch — that is unit 3.
 * There is nothing in the spine to extend until a client can produce one, so this builds the batch
 * a future client will send, at the relay's wire, which is the layer this unit ships.
 *
 * Everything below is genuine cryptography (M15: no mocks for crypto). The "prior relay" is a real
 * Ed25519 keypair signing real `buildRelayAckTbs` receipts; the counterparty is a real keypair
 * signing real Structure 1 bytes and a real tip attestation. A tampered batch is produced by
 * MUTATING a valid one, so each refusal test differs from the passing case in exactly one thing.
 */

import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { buildMerkleTree, merkleRoot, buildRelayAckTbs, generateKeypair } from "@cello-protocol/crypto";
import type { LeafInput } from "@cello-protocol/crypto";
import { encodeStructure2, SCAN_RESULT_SENTINEL, computeGenesisPrevRoot } from "@cello-protocol/protocol-types";
import { buildSessionTipTbs } from "@cello-protocol/interfaces";
import type { SealUnilateralLeaf, SessionTipAttestation } from "@cello-protocol/interfaces";
import { RELAY_LEAF_KINDS } from "../../relay-types.js";

const CBOR = new Encoder({ tagUint8Array: false });
export const MSG_LEAF_KIND = 0x00;
export const CTRL_LEAF_KIND = 0x02;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}
/** The sender pubkey a leaf committed to, read out of its Structure 2 (index 1). */
function senderOf(leaf: SealUnilateralLeaf): Uint8Array {
  return (CBOR.decode(leaf.structure2_cbor) as unknown[])[1] as Uint8Array;
}

type Kp = ReturnType<typeof generateKeypair>;

export interface ReplayBatch {
  leaves: SealUnilateralLeaf[];
  reported_root: Uint8Array;
  counterparty_tip: SessionTipAttestation;
  /** The chain's starting prev_root, so a test can re-derive the chain for a reordered array. */
  genesis: Uint8Array;
}

/** The content-hash root over the first `count` leaves — what a client's own SessionTree produces. */
export function contentRoot(leaves: SealUnilateralLeaf[], count: number): Uint8Array {
  const inputs: LeafInput[] = leaves.slice(0, count).map((l) => ({
    kind: "hash" as const,
    data: contentHashOf(l),
  }));
  return merkleRoot(buildMerkleTree(inputs));
}

/**
 * A leaf's content hash, remembered from when the fixture MINTED it — never decoded back out of
 * `structure2_cbor`.
 *
 * A test that recovers its expected value by running the encoder under test is the circularity
 * `seal-final-root.ts` was written to remove, reproduced one level down: it would agree with the
 * code whatever the code did.
 */
const CONTENT_HASHES = new WeakMap<SealUnilateralLeaf, Uint8Array>();
export function contentHashOf(leaf: SealUnilateralLeaf): Uint8Array {
  const h = CONTENT_HASHES.get(leaf);
  if (!h) throw new Error("leaf was not built by this fixture");
  return h;
}

/** The internal (Structure 2) root the relay keeps as `running_root`. */
export function structure2Root(leaves: SealUnilateralLeaf[], count: number): Uint8Array {
  const inputs: LeafInput[] = leaves.slice(0, count).map((l) => ({
    kind: RELAY_LEAF_KINDS[l.leaf_kind]!,
    data: l.structure2_cbor,
  }));
  return merkleRoot(buildMerkleTree(inputs));
}

export interface BuildOpts {
  /**
   * Give BOTH parties a closing SEAL (`ctrl`) leaf at the end of the chain — the shape of a
   * conversation that was already over when its relay died. Review H4.
   */
  closeBothAtEnd?: boolean;
  /**
   * Give the counterparty two CONSECUTIVE leaves instead of strict alternation.
   *
   * Review H1: a run of two same-sender leaves is the shape that exposed the ordering gap, and the
   * strictly alternating fixture could never produce one. `effectiveSeen` is identical at both
   * positions, so the causal check is satisfied either way round — nothing but the senders' own
   * signed clocks distinguishes them.
   */
  counterpartyRunAt?: number;
  sessionId: Uint8Array;
  sessionTimestamp: number;
  /** The party that will SUBMIT the batch. Its leaves carry the prior relay's receipts. */
  submitter: Kp;
  /** The other party. Its leaves carry no receipt — that is by design, not an omission. */
  counterparty: Kp;
  /** The relay that witnessed the conversation before the handover. */
  priorRelay: Kp;
  /** How many leaves, alternating submitter → counterparty → … starting with the submitter. */
  leafCount: number;
}

/**
 * A valid batch: sequences exactly 1..N, every submitter leaf receipted by `priorRelay`, every leaf
 * signed by its sender over bytes naming this session, a `prev_root` chain that holds, and a tip
 * attestation from the counterparty covering all N.
 */
export async function buildValidReplay(opts: BuildOpts): Promise<ReplayBatch> {
  const subPub = await opts.submitter.getPublicKey();
  const cpPub = await opts.counterparty.getPublicKey();
  const priorPubHex = Buffer.from(await opts.priorRelay.getPublicKey()).toString("hex");

  const leaves: SealUnilateralLeaf[] = [];
  const genesis = computeGenesisPrevRoot(subPub, cpPub, opts.sessionId, opts.sessionTimestamp);
  let prevRoot = genesis;
  /** Each party's own last content hash — what their NEXT leaf's self link must name. */
  const lastOwn = new Map<boolean, Uint8Array>();

  for (let i = 0; i < opts.leafCount; i++) {
    // Strict alternation, except that `counterpartyRunAt` makes THAT index the counterparty's too,
    // producing a run of two consecutive counterparty leaves. See `counterpartyRunAt`.
    const fromSubmitter = opts.counterpartyRunAt === i ? false : i % 2 === 0;
    const kp = fromSubmitter ? opts.submitter : opts.counterparty;
    const pub = fromSubmitter ? subPub : cpPub;
    const seq = i + 1;
    // The highest sequence this sender could legitimately have seen: the last leaf from the OTHER
    // party before this one. Computed rather than assumed, so a same-sender run stays legal.
    let lastSeenSeq = 0;
    for (let j = 0; j < i; j++) {
      const jFromSubmitter = opts.counterpartyRunAt === j ? false : j % 2 === 0;
      if (jFromSubmitter !== fromSubmitter) lastSeenSeq = j + 1;
    }
    const contentHash = new Uint8Array(randomBytes(32));
    /**
     * ⚠️ BOTH CHAIN LINKS, AND THE SELF LINK IS THE HONEST ONE — `DOD-M15-SELFCHAIN-1`.
     *
     * `last_seen_hash` names the last leaf from the OTHER party; `prev_own_hash` names this
     * sender's own previous leaf. Both fall back to the session genesis for a party that has not
     * received, or not spoken, yet — a value derived per session, never a shared constant.
     *
     * The builder computes the honest values so an ordinary batch verifies. A fixture that could
     * only produce a broken chain would make every "this is refused" test pass without measuring
     * the guard it names.
     */
    const structure1_cbor = CBOR.encode([
      3, contentHash, pub, opts.sessionId, lastSeenSeq, opts.sessionTimestamp + seq,
      lastSeenSeq > 0 ? contentHashOf(leaves[lastSeenSeq - 1]!) : genesis,
      lastOwn.get(fromSubmitter) ?? genesis,
    ]) as Uint8Array;
    const sender_signature = await kp.sign(structure1_cbor);
    const structure2_cbor = encodeStructure2({
      sequence_number: seq,
      sender_pubkey: pub,
      content_hash: contentHash,
      sender_signature,
      scan_result: SCAN_RESULT_SENTINEL,
      prev_root: prevRoot,
    });
    const leaf: SealUnilateralLeaf = {
      sequence_number: seq,
      leaf_kind: MSG_LEAF_KIND,
      structure2_cbor,
      structure1_cbor,
    };
    if (fromSubmitter) {
      const relay_timestamp = opts.sessionTimestamp + 1000 + seq;
      leaf.relay_id = priorPubHex;
      leaf.relay_timestamp = relay_timestamp;
      leaf.relay_signature = await opts.priorRelay.sign(buildRelayAckTbs(contentHash, seq, relay_timestamp));
    }
    CONTENT_HASHES.set(leaf, contentHash);
    lastOwn.set(fromSubmitter, contentHash);
    leaves.push(leaf);
    prevRoot = structure2Root(leaves, leaves.length);
  }

  /**
   * Two ctrl leaves, one per party, appended after the message leaves — a completed closing
   * ceremony inside the inherited chain. See `closeBothAtEnd`.
   */
  if (opts.closeBothAtEnd) {
    for (const fromSubmitter of [true, false]) {
      const kp = fromSubmitter ? opts.submitter : opts.counterparty;
      const pub = fromSubmitter ? subPub : cpPub;
      const seq = leaves.length + 1;
      let lastSeenSeq = 0;
      for (let j = 0; j < leaves.length; j++) {
        if (!bytesEqual(senderOf(leaves[j]!), pub)) lastSeenSeq = j + 1;
      }
      const contentHash = new Uint8Array(randomBytes(32));
      // Same rule as the message leaves above — see the note there.
      const structure1_cbor = CBOR.encode([
        3, contentHash, pub, opts.sessionId, lastSeenSeq, opts.sessionTimestamp + 500 + seq,
        lastSeenSeq > 0 ? contentHashOf(leaves[lastSeenSeq - 1]!) : genesis,
        lastOwn.get(fromSubmitter) ?? genesis,
      ]) as Uint8Array;
      const sender_signature = await kp.sign(structure1_cbor);
      const structure2_cbor = encodeStructure2({
        sequence_number: seq,
        sender_pubkey: pub,
        content_hash: contentHash,
        sender_signature,
        scan_result: SCAN_RESULT_SENTINEL,
        prev_root: prevRoot,
      });
      const leaf: SealUnilateralLeaf = { sequence_number: seq, leaf_kind: CTRL_LEAF_KIND, structure2_cbor, structure1_cbor };
      if (fromSubmitter) {
        const relay_timestamp = opts.sessionTimestamp + 2000 + seq;
        leaf.relay_id = priorPubHex;
        leaf.relay_timestamp = relay_timestamp;
        leaf.relay_signature = await opts.priorRelay.sign(buildRelayAckTbs(contentHash, seq, relay_timestamp));
      }
      CONTENT_HASHES.set(leaf, contentHash);
      lastOwn.set(fromSubmitter, contentHash);
      leaves.push(leaf);
      prevRoot = structure2Root(leaves, leaves.length);
    }
  }

  const reported_root = contentRoot(leaves, leaves.length);
  return {
    leaves,
    reported_root,
    genesis,
    counterparty_tip: await signTip(opts.counterparty, cpPub, opts.sessionId, leaves.length, reported_root),
  };
}

/** Sign a tip attestation. Separate so a test can attest to a length or a root of its choosing. */
export async function signTip(
  kp: Kp,
  pubkey: Uint8Array,
  sessionId: Uint8Array,
  lastSeq: number,
  root: Uint8Array,
): Promise<SessionTipAttestation> {
  return {
    pubkey,
    last_seq: lastSeq,
    root,
    signature: await kp.sign(buildSessionTipTbs(sessionId, lastSeq, root)),
  };
}

/** Re-stamp a leaf's committed Structure 2 with a different sequence number, keeping everything
 *  else — including the receipt, which was signed over the ORIGINAL position. This is exactly what
 *  a party renumbering its own history can do, because Structure 1 does not carry the sequence. */
export function restampSequence(leaf: SealUnilateralLeaf, newSeq: number): SealUnilateralLeaf {
  const contentHash = contentHashOf(leaf);
  const s1 = CBOR.decode(leaf.structure1_cbor) as unknown[];
  const restamped: SealUnilateralLeaf = {
    ...leaf,
    sequence_number: newSeq,
    structure2_cbor: encodeStructure2({
      sequence_number: newSeq,
      sender_pubkey: s1[2] as Uint8Array,
      content_hash: contentHash,
      sender_signature: (CBOR.decode(leaf.structure2_cbor) as unknown[])[3] as Uint8Array,
      scan_result: SCAN_RESULT_SENTINEL,
      prev_root: (CBOR.decode(leaf.structure2_cbor) as unknown[])[5] as Uint8Array,
    }),
  };
  CONTENT_HASHES.set(restamped, contentHash);
  return restamped;
}

/**
 * Swap two ADJACENT leaves from the SAME sender, re-stamping their sequence numbers so the array
 * still reads 1..N — review H1.
 *
 * Every check above the tip attestation still passes on the result, which is the point: Structure 1
 * carries no sequence, `effectiveSeen` is identical at both positions, and neither leaf has a relay
 * receipt (they are the counterparty's). Only the senders' own signed timestamps run backwards.
 */
export function swapAdjacent(leaves: SealUnilateralLeaf[], i: number, genesis: Uint8Array): SealUnilateralLeaf[] {
  const out = [...leaves];
  out[i] = restampSequence(leaves[i + 1]!, i + 1);
  out[i + 1] = restampSequence(leaves[i]!, i + 2);
  return rechainPrevRoots(out, genesis);
}

/**
 * Recompute every leaf's `prev_root` for the order it is now in.
 *
 * ⚠️ THIS IS WHAT MAKES THE ATTACK FAITHFUL, AND THE FIRST VERSION OF THE TEST WITHOUT IT WAS
 * MEASURING THE WRONG GUARD. A naive swap breaks the `prev_root` chain and is refused as
 * `seal_chain_prev_root_break` — which reads like the chain caught the reordering. It did not: the
 * `prev_root` chain lives in Structure 2, which is entirely assembled by the party sending the
 * batch, so a real attacker simply recomputes it and the break never appears.
 *
 * Sender pubkey, content hash, sender signature and sequence number are preserved, so every
 * signature still verifies — the only thing that changes is the field the attacker owns.
 */
export function rechainPrevRoots(leaves: SealUnilateralLeaf[], genesis: Uint8Array): SealUnilateralLeaf[] {
  const out: SealUnilateralLeaf[] = [];
  let prevRoot = genesis;
  for (const leaf of leaves) {
    const contentHash = contentHashOf(leaf);
    const s2 = CBOR.decode(leaf.structure2_cbor) as unknown[];
    const rebuilt: SealUnilateralLeaf = {
      ...leaf,
      structure2_cbor: encodeStructure2({
        sequence_number: leaf.sequence_number,
        sender_pubkey: s2[1] as Uint8Array,
        content_hash: contentHash,
        sender_signature: s2[3] as Uint8Array,
        scan_result: SCAN_RESULT_SENTINEL,
        prev_root: prevRoot,
      }),
    };
    CONTENT_HASHES.set(rebuilt, contentHash);
    out.push(rebuilt);
    prevRoot = structure2Root(out, out.length);
  }
  return out;
}

/** Replace a leaf's sender signature with one from another key, leaving `sender_pubkey` alone —
 *  a forged leaf that still claims a real participant wrote it. */
export async function forgeSenderSignature(leaf: SealUnilateralLeaf, forger: Kp): Promise<SealUnilateralLeaf> {
  const contentHash = contentHashOf(leaf);
  const s2 = CBOR.decode(leaf.structure2_cbor) as unknown[];
  const forged: SealUnilateralLeaf = {
    ...leaf,
    structure2_cbor: encodeStructure2({
      sequence_number: leaf.sequence_number,
      sender_pubkey: s2[1] as Uint8Array,
      content_hash: contentHash,
      sender_signature: await forger.sign(leaf.structure1_cbor),
      scan_result: SCAN_RESULT_SENTINEL,
      prev_root: s2[5] as Uint8Array,
    }),
  };
  CONTENT_HASHES.set(forged, contentHash);
  return forged;
}
