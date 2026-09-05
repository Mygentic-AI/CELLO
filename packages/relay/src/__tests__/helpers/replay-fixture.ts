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

type Kp = ReturnType<typeof generateKeypair>;

export interface ReplayBatch {
  leaves: SealUnilateralLeaf[];
  reported_root: Uint8Array;
  counterparty_tip: SessionTipAttestation;
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
  let prevRoot = computeGenesisPrevRoot(subPub, cpPub, opts.sessionId, opts.sessionTimestamp);

  for (let i = 0; i < opts.leafCount; i++) {
    const fromSubmitter = i % 2 === 0;
    const kp = fromSubmitter ? opts.submitter : opts.counterparty;
    const pub = fromSubmitter ? subPub : cpPub;
    const seq = i + 1;
    // The highest sequence this sender could legitimately have seen: the last leaf from the OTHER
    // party. Alternating, so it is simply the previous leaf's sequence (0 for the first).
    const lastSeenSeq = i === 0 ? 0 : i;
    const contentHash = new Uint8Array(randomBytes(32));
    const structure1_cbor = CBOR.encode([
      1, contentHash, pub, opts.sessionId, lastSeenSeq, opts.sessionTimestamp + seq,
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
    leaves.push(leaf);
    prevRoot = structure2Root(leaves, leaves.length);
  }

  const reported_root = contentRoot(leaves, leaves.length);
  return {
    leaves,
    reported_root,
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
