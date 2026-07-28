/**
 * M7-MANIFEST-002 — Directory-side manifest interface definitions.
 *
 * These interfaces allow the directory node to:
 * 1. Sign step-5 challenge responses with its per-node Ed25519 key.
 * 2. Serve the current consortium manifest in response to manifest_poll_request frames.
 *
 * Crypto reference: RFC 8032 (Ed25519).
 */

import type { ConsortiumManifest } from "@cello-protocol/protocol-types";

/**
 * Provides the directory node's unique identifier and signing capability.
 *
 * Each directory node has its own Ed25519 private key — never shared between nodes.
 * The nodeId matches the nodeId field in the ConsortiumManifest for this node.
 *
 * Production: SecretsManagerDirectoryKeyProvider reads from AWS Secrets Manager.
 * Tests: TestDirectoryKeyProvider — takes { nodeId, privateKeyHex } in constructor.
 */
export interface DirectoryKeyProvider {
  /** Returns the node's unique identifier string. */
  getNodeId(): string;
  /**
   * Sign tbsBytes with the node's Ed25519 private key (RFC 8032).
   * Returns a 64-byte signature as Uint8Array.
   */
  sign(tbsBytes: Uint8Array): Promise<Uint8Array>;
}

/**
 * Provides the consortium manifest in the directory's TWO distinct roles (M12-D8).
 *
 * These are not the same manifest question, and collapsing them breaks one invariant or the
 * other:
 *
 *  - **SERVE (transport)** — what the directory hands to polling clients
 *    (`manifest_poll_response`, the `/manifest` HTTP endpoint). The directory is deliberately a
 *    DUMB PIPE here: every client re-verifies independently (M7-MANIFEST-002 / DOD-AUTH-2), and
 *    that independence is a tested property — a rogue directory serving a forged manifest must be
 *    caught by the CLIENT, so the directory must not pre-filter it away. It also keeps officer
 *    ROTATION unblocked: a manifest signed by a new officer set must still reach clients whose
 *    anchor is newer than this node's.
 *  - **USE (verified)** — what the directory itself ACTS on: the anti-entropy trust anchor
 *    (pinned node pubkeys + peerIds, M12 §1b) and the DKG quorum/threshold derivation. Acting on
 *    an unverified manifest would let a tampered file steer ceremonies or peer identity.
 *
 * Production: FileDirectoryManifestStore reads the manifest JSON deployed alongside
 * the directory binary.
 * Tests: TestDirectoryManifestStore — takes a fixed ConsortiumManifest.
 */
export interface DirectoryManifestStore {
  /**
   * SERVE role: the manifest as deployed, for relay to clients. Never throws in production
   * (falls back to the last readable manifest). NOT verified — callers must not act on it.
   */
  getCurrentManifest(): ConsortiumManifest;
  /**
   * USE role: the manifest this node may ACT on — officer-threshold-verified, within its
   * validity window, distinct identities, never rolled back. Never throws in production (a
   * failed reload keeps the last VERIFIED manifest active, logging the cause).
   */
  getVerifiedManifest(): ConsortiumManifest;
}
