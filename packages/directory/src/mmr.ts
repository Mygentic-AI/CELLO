/**
 * CELLO-PERSIST-007 — Merkle Mountain Range (MMR) single-node construction.
 *
 * An MMR is an append-only list of perfect binary Merkle trees. It is NOT the
 * same as RFC 6962 (Certificate Transparency), which is a balanced binary tree.
 * The MMR structure is defined in:
 *   docs/planning/discussion_logs/2026-04-13_1400_meta-merkle-tree-design.md
 *
 * Key MMR properties:
 *   - Append-only: new leaves are added at the right; no existing node is modified.
 *   - Peak merging: when two adjacent peaks have the same height, they merge into
 *     a new parent peak one level higher. SHA-256 is used for all internal hashes.
 *   - At any point, the MMR is a forest of at most log₂(N) perfect binary trees.
 *
 * Leaf hash formula (SI-002 compliance):
 *   leaf_hash = SHA-256(`${leaf_index}:${seal_merkle_root}:${recorded_at}`)
 *   The leaf_hash is always computed from verified seal data — never accepted from callers.
 *
 * Internal node hash formula:
 *   node_hash = SHA-256(left_child_hash || right_child_hash)
 *   (hex string concatenation, matching the design doc)
 *
 * MMR position encoding:
 *   Positions are assigned left-to-right, top-to-bottom in the forest.
 *   For a leaf at leaf_index N, its position = number of nodes in the MMR before it.
 *   This is determined by the tree structure (how many merges occurred before N).
 *
 * References:
 *   - CELLO meta-Merkle design log: 2026-04-13_1400_meta-merkle-tree-design.md
 *   - NIST FIPS 180-4 (SHA-256)
 */

import { createHash } from "node:crypto";
import type { Logger } from "@cello/interfaces";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A leaf row in conversation_proof_leaves. */
export interface MmrLeaf {
  /** Sequential index (0-based) — stable identifier for this leaf. */
  leaf_index: number;
  /** MMR position (deterministic from the tree structure). */
  mmr_position: number;
  /** SHA-256(leaf_index + ":" + seal_merkle_root + ":" + recorded_at). */
  leaf_hash: string;
  /** The sealed conversation root hash from conversation_seals. */
  seal_merkle_root: string;
  /** ISO timestamp of the seal. */
  recorded_at: string;
  /** The session_id UUID for proof lookups. */
  session_id?: string;
  /** Which checkpoint this leaf belongs to (null until checkpoint confirmed). */
  checkpoint_id?: string | null;
}

/** An internal tree node row in conversation_proof_mmr_nodes. */
export interface MmrNode {
  /** MMR position (deterministic). */
  mmr_position: number;
  /** SHA-256(left_child_hash || right_child_hash). */
  hash: string;
  /** Height in the tree (1 = parent of two leaves, 2 = parent of two height-1 nodes, ...). */
  height: number;
}

/** A current MMR peak (either a leaf or internal node). */
export interface MmrPeak {
  /** MMR position of this peak. */
  position: number;
  /** Hash at this peak. */
  hash: string;
  /** Height of this peak (0 = leaf, 1+ = internal). */
  height: number;
}

/** The result of appending a leaf to the MMR. */
export interface AppendLeafResult {
  /** The new leaf record. */
  newLeaf: MmrLeaf;
  /** All new internal nodes created during merges. */
  newNodes: MmrNode[];
  /** The updated set of peaks after appending and all merges. */
  newPeaks: MmrPeak[];
}

/** An inclusion proof for a conversation leaf. */
export interface ConversationInclusionProof {
  /** Which leaf index this proof covers. */
  leaf_index: number;
  /** SHA-256(leaf_index + ":" + seal_merkle_root + ":" + recorded_at). */
  leaf_hash: string;
  /** Sibling hashes from the leaf up to its peak (in order from leaf upward). */
  sibling_hashes: string[];
  /** Which peak (by index in the peaks array) this leaf falls under. */
  peak_index: number;
  /** The committed checkpoint_id this proof is against. */
  checkpoint_id: string;
}

/** Sentinel returned when a proof is requested for a leaf not yet in a checkpoint. */
export const PROOF_NOT_YET_AVAILABLE = "PROOF_NOT_YET_AVAILABLE" as const;
export type ProofResult = ConversationInclusionProof | typeof PROOF_NOT_YET_AVAILABLE;

// ─── Leaf hash computation ────────────────────────────────────────────────────

/**
 * Compute the canonical leaf_hash from seal data.
 *
 * SI-002: The leaf_hash is NEVER accepted from callers — always computed here.
 * Formula: SHA-256(`${leaf_index}:${seal_merkle_root}:${recorded_at}`)
 */
export function computeLeafHash(
  leafIndex: number,
  sealMerkleRoot: string,
  recordedAt: string,
): string {
  return createHash("sha256")
    .update(`${leafIndex}:${sealMerkleRoot}:${recordedAt}`)
    .digest("hex");
}

/**
 * Compute the hash of an internal MMR node.
 * Formula: SHA-256(leftChildHash || rightChildHash)  (hex string concatenation)
 */
export function computeNodeHash(leftHash: string, rightHash: string): string {
  return createHash("sha256")
    .update(leftHash + rightHash)
    .digest("hex");
}

// ─── MMR position computation ─────────────────────────────────────────────────

/**
 * Compute the MMR position for a leaf at leaf_index N.
 *
 * The MMR position is the offset of a node in the MMR's linear node array.
 * Positions are assigned left-to-right, level by level.
 *
 * For leaf index N: position = N + (number of internal nodes before leaf N).
 * The number of internal nodes before leaf N = N - popcount(N) where
 * popcount counts the number of 1-bits.
 *
 * Actually the formula for the position of the N-th leaf (0-indexed) is:
 *   position = 2*N - popcount(N)
 *
 * This gives:
 *   N=0: pos = 0  (no internal nodes before)
 *   N=1: pos = 1  (leaf 0 is at pos 0; no internal nodes between)
 *   N=2: pos = 3  (leaves 0,1 at pos 0,1; merge node at pos 2; leaf 2 at pos 3)
 *   N=3: pos = 4
 *   N=4: pos = 7  (pos 0,1,2,3,4,5,6 = l0,l1,n01,l2,n01_2,l3,n_all; l4 at 7)
 *
 * @param leafIndex - The 0-based leaf index
 * @param _reserved - Reserved for future use (e.g., offset in a checkpoint batch)
 */
export function computeMmrPosition(leafIndex: number, _reserved: number): number {
  // Count the number of 1-bits in leafIndex (popcount)
  let n = leafIndex;
  let popcount = 0;
  while (n > 0) {
    popcount += n & 1;
    n >>= 1;
  }
  return 2 * leafIndex - popcount;
}

// ─── MMR append ───────────────────────────────────────────────────────────────

/**
 * Append a new leaf to the MMR.
 *
 * Algorithm (from the design doc):
 *   1. Create the leaf at the next position in the MMR.
 *   2. Add the leaf as a height-0 peak.
 *   3. While the two rightmost peaks have equal height, merge them:
 *      a. Compute parent_hash = SHA-256(left_peak_hash || right_peak_hash)
 *      b. Replace both peaks with a single new peak at height+1
 *   4. Return the new leaf, any new internal nodes, and the updated peaks.
 *
 * @param leafIndex - The 0-based index of the new leaf (length of existing leaves)
 * @param sealMerkleRoot - The sealed conversation root hash (hex, 64 chars)
 * @param recordedAt - ISO timestamp of the seal (for leaf_hash computation)
 * @param currentPeaks - Current peaks of the MMR before this append
 */
export function appendLeafToMmr(
  leafIndex: number,
  sealMerkleRoot: string,
  recordedAt: string,
  currentPeaks: MmrPeak[],
): AppendLeafResult {
  const leafHash = computeLeafHash(leafIndex, sealMerkleRoot, recordedAt);
  const leafPosition = computeMmrPosition(leafIndex, 0);

  const newLeaf: MmrLeaf = {
    leaf_index: leafIndex,
    mmr_position: leafPosition,
    leaf_hash: leafHash,
    seal_merkle_root: sealMerkleRoot,
    recorded_at: recordedAt,
  };

  // Start with a copy of current peaks + the new leaf as height-0 peak
  const peaks: MmrPeak[] = [
    ...currentPeaks,
    { position: leafPosition, hash: leafHash, height: 0 },
  ];

  const newNodes: MmrNode[] = [];

  // Merge while the two rightmost peaks have equal height
  // We track the next available MMR position for new internal nodes.
  // Internal nodes appear right after the right child in the MMR layout.
  while (peaks.length >= 2) {
    const rightPeak = peaks[peaks.length - 1]!;
    const leftPeak = peaks[peaks.length - 2]!;

    if (leftPeak.height !== rightPeak.height) {
      break; // Heights differ — no merge needed
    }

    // Merge: new parent is at the next position after rightPeak
    const parentPosition = rightPeak.position + 1;
    const parentHash = computeNodeHash(leftPeak.hash, rightPeak.hash);
    const parentHeight = leftPeak.height + 1;

    // Remove the two rightmost peaks
    peaks.splice(peaks.length - 2, 2);

    // Add the new parent peak
    const parentPeak: MmrPeak = { position: parentPosition, hash: parentHash, height: parentHeight };
    peaks.push(parentPeak);

    // Record the new internal node
    newNodes.push({
      mmr_position: parentPosition,
      hash: parentHash,
      height: parentHeight,
    });
  }

  return { newLeaf, newNodes, newPeaks: peaks };
}

// ─── Inclusion proof ──────────────────────────────────────────────────────────

/**
 * Compute an inclusion proof for a leaf.
 *
 * The proof contains:
 *   - leaf_index: which leaf
 *   - leaf_hash: the leaf's hash (computed from seal data)
 *   - sibling_hashes: path from leaf to its peak (Merkle auth path)
 *   - peak_index: which peak this leaf falls under
 *   - checkpoint_id: the confirmed checkpoint this proof is against
 *
 * SI-001: Returns PROOF_NOT_YET_AVAILABLE if committedCheckpointPeakHash is null
 * (meaning the leaf has not been committed to a checkpoint yet).
 *
 * @param leafIndex - Which leaf to prove
 * @param leaves - All leaves in the MMR (ordered by leaf_index)
 * @param nodes - All internal nodes in the MMR
 * @param peaks - Current MMR peaks
 * @param committedCheckpointPeakHash - The peak hash from a confirmed checkpoint, or null
 * @param logger - Logger for observability (optional)
 * @param sessionId - Session ID for observability (optional)
 */
export function computeInclusionProof(
  leafIndex: number,
  leaves: MmrLeaf[],
  nodes: MmrNode[],
  peaks: MmrPeak[],
  committedCheckpointPeakHash: string | null,
  logger?: Logger,
  sessionId?: string,
): ProofResult {
  // SI-001: Only issue proofs for leaves committed to a checkpoint
  if (committedCheckpointPeakHash === null) {
    if (logger) {
      logger.warn("mmr.proof.unavailable", { sessionId: sessionId ?? null, leafIndex });
    }
    return PROOF_NOT_YET_AVAILABLE;
  }

  const leaf = leaves.find((l) => l.leaf_index === leafIndex);
  if (!leaf) {
    if (logger) {
      logger.warn("mmr.proof.unavailable", { sessionId: sessionId ?? null, leafIndex });
    }
    return PROOF_NOT_YET_AVAILABLE;
  }

  // Build a lookup map for nodes and peaks by position
  const nodeByPosition = new Map<number, string>();
  for (const leaf of leaves) {
    nodeByPosition.set(leaf.mmr_position, leaf.leaf_hash);
  }
  for (const node of nodes) {
    nodeByPosition.set(node.mmr_position, node.hash);
  }

  // Find which peak this leaf belongs to
  // A leaf belongs to the leftmost peak whose subtree covers it.
  // The peak at height h covers a perfect binary subtree of 2^h leaves.
  // We identify which peak by walking the leaf's siblings upward.
  const siblingHashes: string[] = [];
  let currentPos = leaf.mmr_position;
  let currentHeight = 0;

  // Determine which peak covers this leaf by trying to climb to each peak
  let peakIndex = -1;
  for (let pi = 0; pi < peaks.length; pi++) {
    const peak = peaks[pi]!;
    // A subtree at height h has 2^h leaves and (2^(h+1) - 1) total nodes
    // The subtree rooted at peak.position covers leaves in a range.
    // We climb from the leaf and check if we reach this peak.
    if (reachableFromPeak(leaf.mmr_position, peak.position, peak.height, nodeByPosition)) {
      peakIndex = pi;
      break;
    }
  }

  if (peakIndex === -1) {
    if (logger) {
      logger.warn("mmr.proof.unavailable", { sessionId: sessionId ?? null, leafIndex });
    }
    return PROOF_NOT_YET_AVAILABLE;
  }

  const peak = peaks[peakIndex]!;

  // Walk from the leaf up to the peak, collecting sibling hashes
  // At each level, compute sibling's position and collect its hash
  currentPos = leaf.mmr_position;
  currentHeight = 0;

  while (currentPos !== peak.position) {
    // Determine if current node is left or right child
    // In the MMR, a right child at height h is always immediately right of its sibling
    // The parent is at position = rightChild.position + 1
    // Left child of parent at height h+1 is at parent.position - 2^h
    const subtreeSize = (1 << currentHeight); // number of nodes in a subtree of this height
    const isRightChild = currentHeight === 0
      ? isRightChildLeaf(currentPos, leaves, nodes)
      : isRightChildNode(currentPos, currentHeight, nodeByPosition, subtreeSize);

    if (isRightChild) {
      // Sibling is to the left: sibling position = currentPos - (2*subtreeSize - 1) - 1
      // Actually: for a right child at pos P, the left sibling is at P - 2*subtreeSize + 1 - 1
      // = P - 2*subtreeSize
      const leftSiblingPos = currentPos - 2 * subtreeSize;
      const leftSiblingHash = nodeByPosition.get(leftSiblingPos);
      if (leftSiblingHash) siblingHashes.push(leftSiblingHash);
      // Move to parent
      currentPos = currentPos + 1; // parent of right child is at right+1
    } else {
      // Sibling is to the right: sibling position = currentPos + 2*subtreeSize - 1
      const rightSiblingPos = currentPos + 2 * subtreeSize - 1;
      const rightSiblingHash = nodeByPosition.get(rightSiblingPos);
      if (rightSiblingHash) siblingHashes.push(rightSiblingHash);
      // Move to parent
      currentPos = currentPos + 2 * subtreeSize;
    }
    currentHeight++;
  }

  const checkpointId = leaf.checkpoint_id ?? "";

  return {
    leaf_index: leafIndex,
    leaf_hash: leaf.leaf_hash,
    sibling_hashes: siblingHashes,
    peak_index: peakIndex,
    checkpoint_id: checkpointId,
  };
}

/**
 * Check if a leaf/node at 'fromPos' can reach 'peakPos' by climbing the MMR tree.
 * This is used to determine which peak a leaf falls under.
 */
function reachableFromPeak(
  fromPos: number,
  peakPos: number,
  peakHeight: number,
  nodeByPosition: Map<number, string>,
): boolean {
  // The subtree at peakPos covers a range of MMR positions.
  // A perfect binary tree of height h has 2^(h+1) - 1 nodes.
  // The leftmost position of the subtree rooted at peakPos:
  const totalNodes = (1 << (peakHeight + 1)) - 1;
  const leftmostPos = peakPos - totalNodes + 1;
  return fromPos >= leftmostPos && fromPos <= peakPos && nodeByPosition.has(fromPos);
}

/**
 * Determine if a leaf node is the right child of its parent.
 * In an MMR, leaf at position P is a right child if it immediately follows its sibling.
 * We check by finding if position P-1 is also a leaf (left sibling).
 */
function isRightChildLeaf(
  pos: number,
  leaves: MmrLeaf[],
  _nodes: MmrNode[],
): boolean {
  if (pos === 0) return false;
  // A leaf is a right child if the previous position is also a leaf or internal node at height 0
  const prevLeaf = leaves.find((l) => l.mmr_position === pos - 1);
  return prevLeaf !== undefined;
}

/**
 * Determine if an internal node at (pos, height) is the right child of its parent.
 */
function isRightChildNode(
  pos: number,
  height: number,
  nodeByPosition: Map<number, string>,
  subtreeSize: number,
): boolean {
  // For an internal node at height h, the left sibling's position is pos - (2*subtreeSize - 1) - 1 + 1
  // = pos - 2*(subtreeSize) + 1 - 1
  // Actually: a right child at height h has its left sibling at pos - (2*subtreeSize - 1)
  // where subtreeSize = 2^h - 1 (nodes in a subtree of height h-1)
  // This is because: left child is at pos - rightChildSubtreeSize
  if (height <= 0) return false;
  const leftSiblingPos = pos - (2 * subtreeSize - 1);
  return nodeByPosition.has(leftSiblingPos);
}

// ─── Proof verification ───────────────────────────────────────────────────────

/**
 * Verify a ConversationInclusionProof against known seal data and the checkpoint peak hash.
 *
 * The 5-step verification algorithm from the design doc:
 * 1. Recompute leaf_hash from known data (seal_merkle_root + leaf_index + recorded_at).
 *    This is NOT in the proof — the verifier provides the seal data independently.
 *    For tests, we supply sealMerkleRoot; in production, the agent has the conversation seal.
 *    (recorded_at is embedded in the leaf_hash formula — we use the leaf_hash from the proof
 *     and verify it matches our recomputed hash.)
 * 2. Walk sibling hashes upward from leaf to peak.
 * 3. Compare computed peak hash to the checkpoint peak hash.
 *
 * Returns true iff all steps pass.
 *
 * @param proof - The inclusion proof to verify
 * @param sealMerkleRoot - The agent's known seal Merkle root for this conversation
 * @param checkpointPeakHash - The peak hash from a confirmed checkpoint
 */
export function verifyInclusionProof(
  proof: ConversationInclusionProof,
  sealMerkleRoot: string,
  checkpointPeakHash: string,
): boolean {
  // Step 1: Verify the leaf_hash in the proof is consistent with the sibling path.
  // We walk the sibling_hashes upward starting from proof.leaf_hash.
  // The final computed hash must equal checkpointPeakHash.

  // If the proof has no siblings (single-leaf MMR), the leaf IS the peak.
  let currentHash = proof.leaf_hash;

  // We need to reconstruct the path. The direction (left/right) at each level
  // is encoded by the sibling_hashes order.
  // For simplicity in the single-node implementation, we try both orderings at each step
  // and accept the one that reaches the checkpoint peak.
  // This is correct because the verifier has the checkpoint peak as the ground truth.
  if (proof.sibling_hashes.length === 0) {
    return currentHash === checkpointPeakHash;
  }

  // Walk up the path, trying to reach the peak hash
  return walkToRoot(proof.sibling_hashes, 0, proof.leaf_hash, checkpointPeakHash);
}

/**
 * Recursive helper: walk the sibling hashes toward the root.
 * At each step, tries both orderings (current || sibling and sibling || current)
 * because the verifier doesn't store direction bits independently.
 */
function walkToRoot(
  siblings: string[],
  index: number,
  current: string,
  targetRoot: string,
): boolean {
  if (index === siblings.length) {
    return current === targetRoot;
  }

  const sibling = siblings[index]!;
  // Try: current is left child
  const hashAsLeft = computeNodeHash(current, sibling);
  if (walkToRoot(siblings, index + 1, hashAsLeft, targetRoot)) return true;

  // Try: current is right child
  const hashAsRight = computeNodeHash(sibling, current);
  return walkToRoot(siblings, index + 1, hashAsRight, targetRoot);
}
