/**
 * FEDERATION-003 — Relay registration TBS (to-be-signed) serialization and signature verification.
 *
 * buildRelayRegistrationTbs produces the canonical byte representation for a relay
 * registration self-signature:
 *
 *   TBS = SHA-256(relay_id_bytes || public_key_hex_bytes || timestamp_BE8)
 *
 * where:
 *   relay_id_bytes:        UTF-8 encoding of the relay_id string
 *   public_key_hex_bytes:  UTF-8 encoding of the public_key_hex string
 *   timestamp_BE8:         Unix millisecond timestamp as 8-byte big-endian uint64
 *
 * SI-003: This TBS must be used by both the relay (which signs) and the directory
 * (which verifies). Keeping it in @cello/crypto ensures neither side can diverge.
 *
 * verifyRelayRegistrationSignature verifies that the signature was produced by the
 * private key corresponding to publicKeyHex, preventing an attacker from registering
 * a relay_id for a key they do not control.
 *
 * References: RFC 8032 (Ed25519), FIPS 180-4 (SHA-256).
 */

import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";

/**
 * Build the canonical TBS bytes for a relay registration self-signature.
 *
 * Pseudocode (SPARC Phase P):
 *   1. UTF-8 encode relay_id as relayIdBytes
 *   2. UTF-8 encode public_key_hex as pubKeyHexBytes
 *   3. Encode timestamp as 8-byte big-endian uint64 (BigInt, safe for Unix ms)
 *   4. Concatenate: relayIdBytes || pubKeyHexBytes || timestamp_BE8
 *   5. SHA-256(concatenation) — FIPS 180-4
 *   6. Return 32-byte digest as Uint8Array
 *
 * @param relayId - The relay identifier (hex encoding of the relay's Ed25519 public key)
 * @param publicKeyHex - 64-char hex string of the relay's Ed25519 public key
 * @param timestamp - Unix millisecond timestamp at registration time
 * @returns 32-byte SHA-256 digest — FIPS 180-4
 */
export function buildRelayRegistrationTbs(
  relayId: string,
  publicKeyHex: string,
  timestamp: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const relayIdBytes = encoder.encode(relayId);
  const pubKeyHexBytes = encoder.encode(publicKeyHex);

  const tsBuf = Buffer.allocUnsafe(8);
  tsBuf.writeBigUInt64BE(BigInt(timestamp), 0);

  const preimage = Buffer.concat([
    Buffer.from(relayIdBytes),
    Buffer.from(pubKeyHexBytes),
    tsBuf,
  ]);

  return new Uint8Array(createHash("sha256").update(preimage).digest());
}

/**
 * Verify a relay registration self-signature.
 *
 * SI-003: The relay signs the registration TBS with its Ed25519 private key.
 * The directory verifies against the public_key_hex submitted in the request.
 * Only a caller that controls the private key corresponding to public_key_hex
 * can produce a valid signature.
 *
 * Pseudocode:
 *   1. Decode publicKeyHex as 32 bytes
 *   2. Compute tbs = buildRelayRegistrationTbs(relayId, publicKeyHex, timestamp)
 *   3. Return ed25519.verify(signature, tbs, publicKeyBytes)
 *      — RFC 8032 §5.1.7 verify algorithm
 *
 * @param publicKeyHex - 64-char hex string of the relay's submitted Ed25519 public key
 * @param relayId - The relay identifier submitted in the registration request
 * @param publicKeyHexInTbs - The public_key_hex value used in the TBS (must match publicKeyHex)
 * @param timestamp - The Unix millisecond timestamp from the registration request
 * @param signature - 64-byte Ed25519 signature from the relay
 * @returns true if signature is valid, false otherwise
 */
export async function verifyRelayRegistrationSignature(
  publicKeyHex: string,
  relayId: string,
  publicKeyHexInTbs: string,
  timestamp: number,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const publicKeyBytes = Buffer.from(publicKeyHex, "hex");
    if (publicKeyBytes.length !== 32) return false;

    const tbs = buildRelayRegistrationTbs(relayId, publicKeyHexInTbs, timestamp);

    return ed25519.verify(signature, tbs, publicKeyBytes);
  } catch {
    return false;
  }
}
