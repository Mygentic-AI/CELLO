/**
 * RFC 6962 Merkle Tree Primitives
 *
 * PSEUDOCODE (Phase P)
 * ====================
 * References:
 *   RFC 6962 §2.1   — Merkle Hash Trees: construction
 *   RFC 6962 §2.1.1 — Merkle Audit Paths (inclusion proofs)
 *   FIPS 180-4      — SHA-256 specification
 *
 * --- build(leaves: Uint8Array[]) ---
 *   if leaves is empty:
 *     return SHA-256("")  // RFC 6962 §2.1: D[0] = {}
 *   level := [leafHash(l) for l in leaves]  // SHA-256(0x00 || l)
 *   while level.length > 1:
 *     next := []
 *     for i in 0..level.length step 2:
 *       if i+1 < level.length:
 *         next.push(nodeHash(level[i], level[i+1]))  // SHA-256(0x01 || left || right)
 *       else:
 *         next.push(level[i])   // promote odd node — RFC 6962 §2.1: left-balanced
 *     level := next
 *   return level[0]  // root
 *
 * --- inclusionProof(tree, index) ---
 *   // RFC 6962 §2.1.1: PATH(m, D[n]) = [] if n=1
 *   //   otherwise siblings from leaf level up to root
 *   level := tree.levelHashes[0]  // leaf hashes
 *   proof := []
 *   idx := index
 *   while level.length > 1:
 *     sibling := idx XOR 1  // flips last bit: 0→1 (right sibling), 1→0 (left sibling)
 *     if sibling < level.length:
 *       proof.push(level[sibling])
 *     // else: odd node was promoted — no sibling hash in proof
 *     next := ... (pair-and-promote)
 *     idx := idx >> 1
 *     level := next
 *   return proof
 *
 * --- verify(leafHash, index, treeSize, proof, expectedRoot) ---
 *   if treeSize == 0 or index >= treeSize: return false
 *   if treeSize == 1 and proof.empty: return leafHash == expectedRoot
 *   cur := leafHash
 *   idx := index; sz := treeSize; pi := 0
 *   while sz > 1:
 *     if idx is last at this level AND idx is even (promoted, no sibling):
 *       // cur carries up unchanged
 *     else:
 *       if pi >= proof.length: return false
 *       if proof[pi].length != 32: return false  // AC-008: 31-byte sibling
 *       if idx is odd: cur := nodeHash(proof[pi], cur)   // sibling is on the left
 *       else:          cur := nodeHash(cur, proof[pi])   // sibling is on the right
 *       pi++
 *     idx := idx >> 1
 *     sz := ceil(sz / 2)
 *   if pi != proof.length: return false  // wrong proof length (extra elements)
 *   return cur == expectedRoot
 *
 * --- edge cases ---
 *   index >= treeSize → false, no throw
 *   wrong proof length → false, no throw
 *   31-byte sibling hash → false, no throw
 *   empty tree → SHA-256("") per RFC 6962 §2.1
 *
 * --- second-preimage protection (SI-001) ---
 *   Leaves are hashed as SHA-256(0x00 || data) — the 0x00 prefix ensures a crafted
 *   leaf payload that begins with 0x01 cannot collide with an internal nodeHash,
 *   because nodeHash uses 0x01 prefix on the already-hashed children, not the raw data.
 */

import { msgLeafHash, ctrlLeafHash, nodeHash, hash } from "./hashing.js";

/**
 * Internal representation of a built Merkle tree.
 * Stores all level hashes from leaf level (index 0) to root level (last index).
 * Root is levelHashes[levelHashes.length - 1][0].
 */
export interface MerkleTree {
  /** The number of leaves in this tree. */
  readonly size: number;
  /**
   * All levels of the tree.
   * levelHashes[0] = leaf hashes (SHA-256(prefix || data) for each leaf)
   * levelHashes[k] = hashes at level k (pairs merged with nodeHash, odd promoted)
   * levelHashes[levelHashes.length - 1] = [root]
   *
   * Empty tree: levelHashes = [] and root is SHA-256("").
   */
  readonly levelHashes: readonly (readonly Uint8Array[])[];
}

/**
 * A leaf input with an explicit kind for domain separation.
 * - "msg":  hashed as SHA-256(0x00 || data) — message leaves
 * - "ctrl": hashed as SHA-256(0x02 || data) — control leaves (SEAL, etc.)
 * - "hash": data is already a 32-byte leaf hash; used directly (no prefix applied)
 */
export type LeafInput =
  | { kind: "msg"; data: Uint8Array }
  | { kind: "ctrl"; data: Uint8Array }
  | { kind: "hash"; data: Uint8Array };

/**
 * Build a left-balanced Merkle tree from an ordered list of leaf inputs.
 *
 * Per RFC 6962 §2.1:
 *   - "msg"  leaves: SHA-256(0x00 || data) using msgLeafHash from hashing.ts
 *   - "ctrl" leaves: SHA-256(0x02 || data) using ctrlLeafHash from hashing.ts
 *   - "hash" leaves: data used as-is (caller pre-computed the leaf hash)
 *   - Internal nodes: SHA-256(0x01 || left || right) using nodeHash from hashing.ts
 *   - Odd nodes at each level are promoted unchanged (not duplicated)
 *   - Empty tree root = SHA-256("") (SHA-256 of empty byte string)
 *
 * @param leaves - Leaf inputs with explicit kind for correct prefix application.
 * @returns MerkleTree with all level hashes stored for O(log n) proof generation.
 */
export function buildMerkleTree(leaves: LeafInput[]): MerkleTree {
  if (leaves.length === 0) {
    return { size: 0, levelHashes: [] };
  }

  const levels: Uint8Array[][] = [];
  let current: Uint8Array[] = leaves.map((l) => {
    if (l.kind === "ctrl") return ctrlLeafHash(l.data);
    if (l.kind === "hash") return l.data;
    return msgLeafHash(l.data);
  });
  levels.push(current);

  while (current.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(nodeHash(current[i], current[i + 1]));
      } else {
        // Promote the odd node unchanged (RFC 6962 §2.1 — left-balanced)
        next.push(current[i]);
      }
    }
    levels.push(next);
    current = next;
  }

  return { size: leaves.length, levelHashes: levels };
}

/**
 * Return the Merkle root of a built tree.
 *
 * Per RFC 6962 §2.1:
 *   - Empty tree → SHA-256("") (SHA-256 of empty byte string)
 *   - Otherwise → the single hash at the top level of levelHashes
 *
 * @param tree - A MerkleTree returned by buildMerkleTree.
 * @returns 32-byte root hash.
 */
export function merkleRoot(tree: MerkleTree): Uint8Array {
  if (tree.size === 0) {
    return hash(new Uint8Array(0));
  }
  const top = tree.levelHashes[tree.levelHashes.length - 1];
  return top[0];
}

/**
 * Produce an RFC 6962 §2.1.1 inclusion proof for leaf at index.
 *
 * The proof is an ordered list of sibling hashes from the leaf level to the root.
 * For each level, the sibling of the current node is included. Promoted (odd, last)
 * nodes have no sibling at their level, so no hash is added.
 *
 * @param tree   - A MerkleTree returned by buildMerkleTree.
 * @param index  - Zero-based index of the target leaf.
 * @returns      Array of 32-byte sibling hashes (may be empty for a single-leaf tree).
 * @throws       If index is out of range.
 */
export function inclusionProof(tree: MerkleTree, index: number): Uint8Array[] {
  if (tree.size === 0 || index >= tree.size) {
    throw new RangeError(
      `inclusionProof: index ${index} out of range for tree of size ${tree.size}`
    );
  }

  const proof: Uint8Array[] = [];
  let idx = index;

  for (let level = 0; level < tree.levelHashes.length - 1; level++) {
    const row = tree.levelHashes[level];
    // Sibling index: XOR with 1 flips last bit (0→1 right sibling, 1→0 left sibling)
    const siblingIdx = idx ^ 1;
    if (siblingIdx < row.length) {
      proof.push(row[siblingIdx]);
    }
    // If no sibling exists, this node is promoted (odd last node) — nothing added
    idx = idx >> 1;
  }

  return proof;
}

/**
 * Verify an RFC 6962 §2.1.1 inclusion proof.
 *
 * Reconstructs the root by traversing the proof from leaf to root and compares
 * byte-for-byte to expectedRoot. Returns false (never throws) for all invalid inputs:
 *   - index out of range
 *   - wrong proof length
 *   - any sibling hash not exactly 32 bytes
 *   - reconstructed root doesn't match expectedRoot
 *
 * @param leafHash     - Pre-computed leaf hash (SHA-256(0x00 || data)).
 * @param index        - Zero-based index of the leaf in the tree.
 * @param treeSize     - Total number of leaves in the tree.
 * @param proof        - Ordered sibling hashes from inclusionProof.
 * @param expectedRoot - The expected 32-byte Merkle root.
 * @returns true iff the proof is valid for the given leaf and root.
 */
export function verifyInclusion(
  leafHash: Uint8Array,
  index: number,
  treeSize: number,
  proof: Uint8Array[],
  expectedRoot: Uint8Array
): boolean {
  // AC-008: malformed leafHash — must be exactly 32 bytes
  if (leafHash.length !== 32) return false;

  // AC-008: index out of range
  if (treeSize === 0 || index >= treeSize) return false;

  // Single-leaf tree: root IS the leaf hash, proof must be empty
  if (treeSize === 1) {
    if (proof.length !== 0) return false;
    return constantTimeEqual(leafHash, expectedRoot);
  }

  // Validate all sibling hashes up front (AC-008: 31-byte sibling)
  for (const sibling of proof) {
    if (sibling.length !== 32) return false;
  }

  let cur: Uint8Array = leafHash;
  let idx = index;
  let sz = treeSize;
  let proofIdx = 0;

  while (sz > 1) {
    const isLastAndOdd = idx === sz - 1 && idx % 2 === 0;

    if (isLastAndOdd) {
      // This node is promoted (odd last node at this level) — no sibling consumed
    } else {
      // Expect a sibling from the proof
      if (proofIdx >= proof.length) return false;
      const sibling = proof[proofIdx++];

      if (idx % 2 === 1) {
        // Current node is right child — sibling is to the left
        cur = nodeHash(sibling, cur);
      } else {
        // Current node is left child — sibling is to the right
        cur = nodeHash(cur, sibling);
      }
    }

    idx = idx >> 1;
    sz = Math.ceil(sz / 2);
  }

  // AC-008: wrong proof length (extra elements remaining)
  if (proofIdx !== proof.length) return false;

  return constantTimeEqual(cur, expectedRoot);
}

/**
 * Constant-time byte array comparison to prevent timing side-channels.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
