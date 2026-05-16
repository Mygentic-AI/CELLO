/**
 * db-key-derivation.ts — HKDF derivation of the local database encryption key.
 *
 * PERSIST-009: db_key = HKDF-SHA256(ikm=identity_key, salt=none, info='local-db-key' || agent_id, length=32)
 *
 * Security invariants (PERSIST-009 SI-002):
 *   - identity_key is passed in by the caller; it is NEVER stored here.
 *   - The returned db_key is NEVER logged or persisted by this function.
 *   - This function has no side effects — pure transformation only.
 *
 * RFC reference: RFC 5869 (HKDF). Node.js implementation: crypto.hkdfSync.
 */

import { hkdfSync } from "node:crypto";

/**
 * Derive a 32-byte database encryption key from the agent's identity_key.
 *
 * @param identityKey - The agent's long-term root key (32 bytes). Never stored or logged.
 * @param agentId     - The stable agent identifier. Binds the key to a specific agent.
 * @returns           - A 32-byte Uint8Array suitable for use as a SQLCipher PRAGMA key.
 *
 * Security: The db_key is deterministic — same inputs always produce the same output.
 * This is intentional: the client must re-derive the key on every startup without
 * storing it, using only the identity_key (which is stored separately, protected
 * by the OS keychain or equivalent).
 */
export function deriveDbKey(identityKey: Uint8Array, agentId: string): Uint8Array {
  // info = 'local-db-key' || NUL || agentId (UTF-8 encoded).
  // The null-byte separator prevents a theoretical prefix-collision where two
  // different (literal, agentId) pairs could produce the same concatenation.
  const infoStr = `local-db-key\x00${agentId}`;
  const info = Buffer.from(infoStr, "utf8");

  // HKDF-SHA256: salt=none (empty Buffer), length=32 bytes
  // RFC 5869 §2.2: when salt is not provided, a string of HashLen zeros is used.
  const derived = hkdfSync("sha256", identityKey, Buffer.alloc(0), info, 32);

  return new Uint8Array(derived);
}
