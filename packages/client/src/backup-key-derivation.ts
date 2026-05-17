/**
 * backup-key-derivation.ts — HKDF derivation of the cloud backup encryption key.
 *
 * PERSIST-011: backup_key = HKDF-SHA256(ikm=identity_key, salt=none,
 *              info='backup-key' || agent_id, length=32)
 *
 * Security invariants (PERSIST-011 SI-001):
 *   - identity_key is passed in by the caller; it is NEVER stored here.
 *   - The returned backup_key is NEVER logged or persisted by this function.
 *   - This function has no side effects — pure transformation only.
 *
 * Key independence (AC-001):
 *   - backup_key and db_key use distinct info strings:
 *       db_key:     info = 'local-db-key\x00' + agentId
 *       backup_key: info = 'backup-key\x00' + agentId
 *   - For the same identity_key and agentId, backup_key != db_key.
 *   - Losing one key does not compromise the other.
 *
 * RFC reference: RFC 5869 (HKDF). Node.js implementation: crypto.hkdfSync.
 */

import { hkdfSync } from "node:crypto";

/**
 * Derive a 32-byte cloud backup encryption key from the agent's identity_key.
 *
 * @param identityKey - The agent's long-term root key (32 bytes). Never stored or logged.
 * @param agentId     - The stable agent identifier. Binds the key to a specific agent.
 * @returns           - A 32-byte Uint8Array suitable for use as an AES-256-GCM key.
 *
 * Security: The backup_key is deterministic — same inputs always produce the same output.
 * This is intentional: the client must re-derive the key on every backup/restore without
 * storing it, using only the identity_key (which is stored separately, protected
 * by the OS keychain or equivalent).
 *
 * The null-byte separator between the literal and agentId prevents prefix-collision
 * attacks where two different (literal, agentId) pairs produce the same concatenation.
 */
export function deriveBackupKey(identityKey: Uint8Array, agentId: string): Uint8Array {
  // info = 'backup-key' || NUL || agentId (UTF-8 encoded).
  // Distinct from db_key info string ('local-db-key\x00' + agentId) — same identity_key
  // cannot produce the same output for both keys.
  const infoStr = `backup-key\x00${agentId}`;
  const info = Buffer.from(infoStr, "utf8");

  // HKDF-SHA256: salt=none (empty Buffer), length=32 bytes
  // RFC 5869 §2.2: when salt is not provided, a string of HashLen zeros is used.
  const derived = hkdfSync("sha256", identityKey, Buffer.alloc(0), info, 32);

  return new Uint8Array(derived);
}
