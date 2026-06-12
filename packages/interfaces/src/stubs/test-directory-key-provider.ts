/**
 * M7-MANIFEST-002 — TestDirectoryKeyProvider stub.
 *
 * In-memory Ed25519 key provider for directory node tests.
 * Takes { nodeId, privateKeyHex } in constructor.
 * Used to inject a deterministic per-node signing key into CelloDirectoryNode
 * during tests so that step-5 signatures can be generated and verified.
 *
 * Crypto reference: RFC 8032 (Ed25519).
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import type { DirectoryKeyProvider } from "../manifest.js";

/**
 * TestDirectoryKeyProvider — deterministic per-node Ed25519 signing key.
 *
 * NOT shared between node instances in tests — each node gets its own seed.
 */
export class TestDirectoryKeyProvider implements DirectoryKeyProvider {
  readonly #nodeId: string;
  readonly #privateKeyBytes: Uint8Array;

  constructor(opts: { nodeId: string; privateKeyHex: string }) {
    this.#nodeId = opts.nodeId;
    if (opts.privateKeyHex.length !== 64) {
      throw new Error(
        `TestDirectoryKeyProvider: privateKeyHex must be 64 chars (32 bytes), got ${opts.privateKeyHex.length}`,
      );
    }
    this.#privateKeyBytes = hexToBytes(opts.privateKeyHex);
  }

  getNodeId(): string {
    return this.#nodeId;
  }

  /**
   * Sign tbsBytes with the Ed25519 private key (RFC 8032).
   * Returns 64-byte Uint8Array.
   */
  async sign(tbsBytes: Uint8Array): Promise<Uint8Array> {
    return ed25519.sign(tbsBytes, this.#privateKeyBytes);
  }

  /** Returns the corresponding Ed25519 public key (32 bytes) as hex. */
  getPublicKeyHex(): string {
    return Buffer.from(ed25519.getPublicKey(this.#privateKeyBytes)).toString("hex");
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
