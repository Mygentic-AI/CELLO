/**
 * CELLO-SESSION-002/MSG-004 — session.ts
 *
 * SessionAssignment: shared wire type used by directory (sender), client (receiver),
 * and relay (verifier). Lives here so client can import it without touching @cello/directory.
 *
 * computeGenesisPrevRoot: deterministic genesis prev_root for a two-party session.
 *
 * Formula (SI-004):
 *   SHA-256(min(A_pubkey, B_pubkey) || max(A_pubkey, B_pubkey) || session_id || timestamp_be8)
 *
 * Pubkeys are sorted bytewise-lexicographically (Buffer.compare).
 * timestamp_be8 is the session_timestamp encoded as an 8-byte big-endian unsigned integer
 * (milliseconds since Unix epoch). Raw byte concatenation — no CBOR at this boundary,
 * which would introduce width ambiguity on the timestamp encoding.
 *
 * Per FIPS 180-4 (SHA-256) and SESSION-002 SI-004.
 */

import { createHash } from "node:crypto";

// ─── SessionAssignment (shared wire type — SESSION-002) ───────────────────────

export interface ParticipantInfo {
  pubkey: Uint8Array;    // 32-byte K_local pubkey
  peer_id: string;       // libp2p Peer ID string
  multiaddrs: string[];  // dialing multiaddrs
}

export interface RelayEndpointInfo {
  peer_id: string;
  multiaddrs: string[];
}

/** Directory-signed session assignment delivered to both participants and the relay. */
export interface SessionAssignment {
  session_id: Uint8Array;           // 16 bytes, CSPRNG
  participant_a: ParticipantInfo;
  participant_b: ParticipantInfo;
  relay_endpoint: RelayEndpointInfo;
  session_timestamp: number;        // Unix ms
  directory_pubkey: Uint8Array;     // 32-byte directory identity pubkey
  directory_signature: Uint8Array;  // 64-byte Ed25519 over canonical CBOR of assignment fields
}

/**
 * Compute the genesis prev_root for a two-party CELLO session.
 *
 * @param pubkeyA - K_local pubkey of participant A (32 bytes)
 * @param pubkeyB - K_local pubkey of participant B (32 bytes)
 * @param sessionId - session_id from the directory (16 bytes)
 * @param sessionTimestampMs - session_timestamp in milliseconds since Unix epoch
 * @returns 32-byte genesis prev_root (SHA-256 output)
 */
export function computeGenesisPrevRoot(
  pubkeyA: Uint8Array,
  pubkeyB: Uint8Array,
  sessionId: Uint8Array,
  sessionTimestampMs: number | bigint,
): Uint8Array {
  const a = Buffer.from(pubkeyA);
  const b = Buffer.from(pubkeyB);

  const [min, max] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];

  const tsBe = Buffer.alloc(8);
  tsBe.writeBigUInt64BE(typeof sessionTimestampMs === "bigint" ? sessionTimestampMs : BigInt(sessionTimestampMs));

  return new Uint8Array(
    createHash("sha256")
      .update(min)
      .update(max)
      .update(sessionId)
      .update(tsBe)
      .digest()
  );
}
