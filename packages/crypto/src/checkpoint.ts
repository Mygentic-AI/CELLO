/**
 * FEDERATION-002 — Canonical checkpoint TBS (to-be-signed) serialization.
 *
 * buildCheckpointTbs produces the canonical byte representation for the checkpoint hash:
 *   SHA-256(mmr_peaks_serialized || identity_merkle_root || checkpoint_id)
 *
 * where mmr_peaks_serialized is a canonical JSON array of hex-encoded peak hashes
 * ordered by MMR position ascending — e.g. '["aabb...","ccdd..."]' with no
 * whitespace and no object keys, UTF-8 encoded.
 *
 * This function MUST live in @cello-protocol/crypto so both:
 *   - the coordinator (which computes the hash to broadcast)
 *   - the non-coordinator (which independently recomputes to verify)
 * import the same serialization. AC-010-canonical-tbs: no inline serialization
 * of mmr_peaks exists in packages/directory.
 *
 * References: FIPS 180-4 (SHA-256), RFC 8032 (Ed25519).
 */

import { createHash } from "node:crypto";

/**
 * Produce the canonical TBS bytes for a checkpoint hash.
 *
 * Pseudocode:
 *   1. Serialize mmr_peaks as a compact JSON array: JSON.stringify(mmrPeaks)
 *      mmrPeaks must be an array of hex strings ordered by MMR position ascending.
 *      JSON.stringify produces no whitespace: '["aabb...","ccdd..."]' — FIPS 180-4.
 *   2. Encode mmr_peaks_serialized as UTF-8 bytes.
 *   3. Encode identity_merkle_root as UTF-8 bytes.
 *   4. Encode checkpoint_id as UTF-8 bytes.
 *   5. Concatenate: mmr_peaks_serialized_bytes || identity_merkle_root_bytes || checkpoint_id_bytes
 *   6. Compute SHA-256(concatenation) — FIPS 180-4.
 *   7. Return the 32-byte digest as a Uint8Array.
 *
 * @param mmrPeaks - Hex-encoded peak hashes ordered by MMR position ascending.
 *                   Example: ["aabb...", "ccdd..."] for a 3-leaf MMR with 2 peaks.
 * @param identityMerkleRoot - Hex-encoded identity Merkle root (32 bytes as hex).
 * @param checkpointId - UUID string for this checkpoint (as issued by the coordinator).
 * @returns 32-byte SHA-256 digest — FIPS 180-4.
 */
export function buildCheckpointTbs(
  mmrPeaks: readonly string[],
  identityMerkleRoot: string,
  checkpointId: string,
): Uint8Array {
  // Step 1+2: canonical JSON serialization of the peak array — no whitespace (FIPS 180-4 §6.2)
  const mmrPeaksSerialized = JSON.stringify(mmrPeaks);

  // Steps 3-5: UTF-8 encode and concatenate components
  const encoder = new TextEncoder();
  const peakBytes = encoder.encode(mmrPeaksSerialized);
  const identityBytes = encoder.encode(identityMerkleRoot);
  const checkpointBytes = encoder.encode(checkpointId);

  // Step 6: SHA-256(mmr_peaks_serialized || identity_merkle_root || checkpoint_id)
  const combined = Buffer.concat([
    Buffer.from(peakBytes),
    Buffer.from(identityBytes),
    Buffer.from(checkpointBytes),
  ]);

  return new Uint8Array(createHash("sha256").update(combined).digest());
}

/**
 * Compute the hex-encoded checkpoint hash from canonical TBS.
 *
 * Convenience wrapper around buildCheckpointTbs that returns a hex string
 * (matching the `checkpoint_hash` column type in directory_checkpoints).
 *
 * @param mmrPeaks - Hex-encoded peak hashes ordered by MMR position ascending.
 * @param identityMerkleRoot - Hex-encoded identity Merkle root.
 * @param checkpointId - UUID string for this checkpoint.
 * @returns 64-character lowercase hex string (32-byte SHA-256 digest).
 */
export function computeCheckpointHash(
  mmrPeaks: readonly string[],
  identityMerkleRoot: string,
  checkpointId: string,
): string {
  return Buffer.from(buildCheckpointTbs(mmrPeaks, identityMerkleRoot, checkpointId)).toString("hex");
}
