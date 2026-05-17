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
  /** The ISO timestamp of the seal — needed by the verifier to recompute leaf_hash. */
  recorded_at: string;
  /** Sibling hashes from the leaf up to its peak (in order from leaf upward). */
  sibling_hashes: string[];
  /**
   * Direction bits: true = current node is right child at this level.
   * Encoded at proof construction time to avoid O(2^N) brute-force in walkToRoot.
   */
  is_right_sibling: boolean[];
  /** Which peak (by index in the peaks array) this leaf falls under. */
  peak_index: number;
  /**
   * All peak hashes at checkpoint time, left-to-right.
   * The verifier uses these to recompute the bagged peak hash:
   *   bagged = SHA-256(peaks[0] || peaks[1] || ... || peaks[N-1])
   * and compare against the stored checkpoint peak_hash.
   * This is the standard "bagging the peaks" MMR pattern.
   */
  peaks: string[];
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
 */
export function computeMmrPosition(leafIndex: number): number {
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
  const leafPosition = computeMmrPosition(leafIndex);

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

  // Walk from the leaf up to the peak, collecting sibling hashes and encoding direction bits.
  // Direction bits (is_right_sibling[i] = true means the current node is the right child at level i)
  // are encoded at construction time so verifyInclusionProof uses them deterministically,
  // avoiding O(2^N) brute-force branching.
  const isRightSibling: boolean[] = [];
  currentPos = leaf.mmr_position;
  currentHeight = 0;

  while (currentPos !== peak.position) {
    // Determine if current node is left or right child.
    // In an MMR:
    //   - A subtree of height h has 2^h leaves and (2^(h+1) - 1) total nodes.
    //   - subtreeSize = (2^(h+1) - 1) = total nodes in a perfect subtree of height h.
    //   - For height h: a right child at position P has its left sibling at P - subtreeSize.
    //     The parent is at P + 1.
    //   - For a left child at position P: its right sibling is at P + subtreeSize.
    //     The parent is at P + subtreeSize + 1 = P + 2*subtreeSize - 1 + 1... wait.
    //
    // Correct formula (height h means subtree covers 2^h leaves, 2^(h+1)-1 nodes):
    //   subtreeSize = (1 << (currentHeight + 1)) - 1  — total nodes in a subtree of height h
    //   For a right child at pos P: left sibling pos = P - subtreeSize (the entire left subtree)
    //     parent pos = P + 1
    //   For a left child at pos P: right sibling pos = P + subtreeSize
    //     parent pos = P + subtreeSize + 1
    //
    // However, for height 0 (leaves), subtreeSize = 1 (just the leaf itself).
    //   Right child at P: left sibling = P - 1, parent = P + 1. Correct.
    //   Left child at P: right sibling = P + 1, parent = P + 2. Correct.
    //
    // For height 1 (internal nodes covering 2 leaves, 3 total nodes):
    //   subtreeSize = 3
    //   Right child at P: left sibling = P - 3, parent = P + 1. Correct.
    //   Left child at P: right sibling = P + 3, parent = P + 4.
    //
    // But in our walk, at height h the "current node" is the current level's hash.
    // The subtreeSize at the current level is (1 << (currentHeight + 1)) - 1 BUT
    // we're considering the node as part of the parent's tree.
    // At height 0 (leaf): a subtree of a single leaf has 1 node. When computing
    // its sibling at height 0: subtreeSize = 1 (one leaf = one node).
    //
    // General rule: at currentHeight h, a node covers a subtree of (2^(h+1) - 1) nodes.
    // The formula for sibling:
    //   rightSiblingOffset = (1 << (currentHeight + 1)) - 1  (= 2*subtreeSize where subtreeSize = 2^h leaves... confusing)
    //
    // Simplest: subtreeNodeCount = (1 << (currentHeight + 1)) - 1
    //   isRight: left sibling at currentPos - subtreeNodeCount, parent at currentPos + 1
    //   isLeft:  right sibling at currentPos + subtreeNodeCount, parent at currentPos + subtreeNodeCount + 1
    const subtreeNodeCount = (1 << (currentHeight + 1)) - 1;
    const isRightChild = currentHeight === 0
      ? isRightChildLeaf(currentPos, leaves, nodes)
      : isRightChildNode(currentPos, currentHeight, nodeByPosition, subtreeNodeCount);

    if (isRightChild) {
      // Sibling is to the left: left sibling pos = currentPos - subtreeNodeCount
      // parent pos = currentPos + 1
      const leftSiblingPos = currentPos - subtreeNodeCount;
      const leftSiblingHash = nodeByPosition.get(leftSiblingPos);
      // Fix 3: both arrays must stay in sync — if sibling is missing, the proof is incomplete.
      if (!leftSiblingHash) {
        if (logger) {
          logger.warn("mmr.proof.unavailable", { sessionId: sessionId ?? null, leafIndex });
        }
        return PROOF_NOT_YET_AVAILABLE;
      }
      siblingHashes.push(leftSiblingHash);
      isRightSibling.push(true);
      // Move to parent
      currentPos = currentPos + 1;
    } else {
      // Sibling is to the right: right sibling pos = currentPos + subtreeNodeCount
      // parent pos = currentPos + subtreeNodeCount + 1
      const rightSiblingPos = currentPos + subtreeNodeCount;
      const rightSiblingHash = nodeByPosition.get(rightSiblingPos);
      // Fix 3: both arrays must stay in sync — if sibling is missing, the proof is incomplete.
      if (!rightSiblingHash) {
        if (logger) {
          logger.warn("mmr.proof.unavailable", { sessionId: sessionId ?? null, leafIndex });
        }
        return PROOF_NOT_YET_AVAILABLE;
      }
      siblingHashes.push(rightSiblingHash);
      isRightSibling.push(false);
      // Move to parent
      currentPos = currentPos + subtreeNodeCount + 1;
    }
    currentHeight++;
  }

  // Fix 6: explicit guard — a null checkpoint_id means the leaf is not yet committed.
  if (!leaf.checkpoint_id) {
    if (logger) {
      logger.warn("mmr.proof.unavailable", { sessionId: sessionId ?? null, leafIndex });
    }
    return PROOF_NOT_YET_AVAILABLE;
  }
  const checkpointId = leaf.checkpoint_id;

  return {
    leaf_index: leafIndex,
    leaf_hash: leaf.leaf_hash,
    recorded_at: leaf.recorded_at,
    sibling_hashes: siblingHashes,
    is_right_sibling: isRightSibling,
    peak_index: peakIndex,
    // Fix 1: carry the full list of individual peak hashes so the verifier can
    // bag them and compare against the stored checkpoint peak_hash.
    peaks: peaks.map((p) => p.hash),
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
 *
 * At height h, a node covers a subtree with subtreeNodeCount = (2^(h+1) - 1) nodes.
 * If this node is a right child, its left sibling is at pos - subtreeNodeCount.
 */
function isRightChildNode(
  pos: number,
  height: number,
  nodeByPosition: Map<number, string>,
  subtreeNodeCount: number,
): boolean {
  if (height <= 0) return false;
  // A right child at pos P has its left sibling at pos - subtreeNodeCount
  const leftSiblingPos = pos - subtreeNodeCount;
  return nodeByPosition.has(leftSiblingPos);
}

// ─── Proof verification ───────────────────────────────────────────────────────

/**
 * Verify a ConversationInclusionProof against known seal data and the checkpoint peak hash.
 *
 * The verification algorithm uses the standard "bagging the peaks" MMR pattern:
 * 1. Recompute leaf_hash from the agent's known data (seal_merkle_root + leaf_index + recorded_at).
 *    This verifies that proof.leaf_hash matches the independently-known seal data.
 *    proof.recorded_at supplies the timestamp needed to recompute the hash.
 * 2. Walk sibling hashes upward from the verified leaf_hash to the subtree root, using the
 *    direction bits in proof.is_right_sibling to determine hash ordering at each level.
 * 3. Verify that the computed subtree root matches proof.peaks[proof.peak_index].
 * 4. Bag the peaks: baggedHash = SHA-256(peaks[0] || peaks[1] || ... || peaks[N-1]).
 *    For a single-peak MMR, the stored peak_hash equals the single peak hash (no bagging done).
 * 5. Compare baggedHash to checkpointPeakHash.
 *
 * This two-step approach is required for correctness: comparing the subtree root directly
 * to the stored bagged peak hash would always fail for multi-peak MMRs.
 *
 * Returns true iff all steps pass.
 *
 * @param proof - The inclusion proof to verify (must include peaks, recorded_at, is_right_sibling)
 * @param sealMerkleRoot - The agent's known seal Merkle root for this conversation
 * @param checkpointPeakHash - The peak hash from a confirmed checkpoint (bagged if multi-peak)
 */
export function verifyInclusionProof(
  proof: ConversationInclusionProof,
  sealMerkleRoot: string,
  checkpointPeakHash: string,
): boolean {
  // Step 1: Recompute leaf_hash from known data and verify it matches the proof.
  // This ensures the proof is anchored to actual seal data, not an arbitrary hash.
  const expectedLeafHash = computeLeafHash(proof.leaf_index, sealMerkleRoot, proof.recorded_at);
  if (expectedLeafHash !== proof.leaf_hash) {
    return false;
  }

  // Step 2: Walk from verified leaf_hash up to the subtree root using encoded direction bits.
  // is_right_sibling[i] = true means the current node was the right child at level i,
  // so: parent_hash = SHA-256(sibling || current)
  // is_right_sibling[i] = false means the current node was the left child at level i,
  // so: parent_hash = SHA-256(current || sibling)
  const subtreeRoot = walkToSubtreeRoot(
    proof.sibling_hashes,
    proof.is_right_sibling,
    0,
    proof.leaf_hash,
  );
  if (subtreeRoot === null) return false;

  // Step 3: Verify the computed subtree root matches the expected peak for this leaf.
  if (proof.peaks.length === 0) return false;
  if (proof.peak_index < 0 || proof.peak_index >= proof.peaks.length) return false;
  if (subtreeRoot !== proof.peaks[proof.peak_index]) {
    return false;
  }

  // Step 4 + 5: Bag the peaks and compare to the stored checkpoint peak hash.
  // For a single-peak MMR, #computePeakHash returns the peak hash directly (no bagging).
  // For multi-peak, it returns SHA-256(peak0 || peak1 || ...).
  const baggedHash = bagPeakHashes(proof.peaks);
  return baggedHash === checkpointPeakHash;
}

/**
 * Bag a list of peak hashes into a single commitment.
 * Matches #computePeakHash in MmrStore — must stay in sync.
 *
 * Formula:
 *   1 peak:  return peaks[0] directly (no wrapping hash)
 *   N peaks: SHA-256(peaks[0] || peaks[1] || ... || peaks[N-1])
 */
function bagPeakHashes(peakHashes: string[]): string {
  if (peakHashes.length === 0) return "0".repeat(64);
  if (peakHashes.length === 1) return peakHashes[0]!;
  const hasher = createHash("sha256");
  for (const h of peakHashes) {
    hasher.update(h);
  }
  return hasher.digest("hex");
}

/**
 * Walk the sibling hashes upward from the leaf, computing the subtree root.
 *
 * Returns the computed subtree root hash, or null if the arrays are mismatched
 * (which should not occur after Fix 3 — computeInclusionProof guarantees they
 * are always pushed together).
 *
 * isRightSibling[i] = true means the current node was the right child at level i:
 *   parent_hash = SHA-256(sibling || current)
 * isRightSibling[i] = false means the current node was the left child:
 *   parent_hash = SHA-256(current || sibling)
 *
 * Direction bits are set at proof construction time (computeInclusionProof), making
 * this deterministic O(N) rather than O(2^N) brute-force.
 */
function walkToSubtreeRoot(
  siblings: string[],
  isRightSibling: boolean[],
  index: number,
  current: string,
): string | null {
  if (index === siblings.length) {
    return current;
  }

  // Fix 3: explicit check — both arrays must be defined at this index.
  const sibling = siblings[index];
  const isRight = isRightSibling[index];
  if (sibling === undefined || isRight === undefined) {
    return null;
  }

  // If current is the right child: parent = SHA-256(sibling || current)
  // If current is the left child:  parent = SHA-256(current || sibling)
  const parentHash = isRight
    ? computeNodeHash(sibling, current)
    : computeNodeHash(current, sibling);

  return walkToSubtreeRoot(siblings, isRightSibling, index + 1, parentHash);
}
