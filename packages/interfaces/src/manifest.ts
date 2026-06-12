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
 * Provides the current consortium manifest for manifest_poll_response frames.
 *
 * Production: FileDirectoryManifestStore reads the manifest JSON deployed alongside
 * the directory binary.
 * Tests: TestDirectoryManifestStore — takes a fixed ConsortiumManifest.
 */
export interface DirectoryManifestStore {
  /** Returns the current consortium manifest. Never throws in production. */
  getCurrentManifest(): ConsortiumManifest;
}
