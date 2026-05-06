/**
 * CELLO-SESSION-002/MSG-004/SESSION-003 — session.ts
 *
 * SessionAssignment: shared wire type used by directory (sender), client (receiver),
 * and relay (verifier). Lives here so client can import it without touching @cello/directory.
 *
 * SealPayload: canonical CBOR of [session_id, final_root, close_timestamp, "PENDING"].
 * Per SESSION-003. content_hash = SHA-256(0x00 || SealPayload) per MERKLE-001.
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
import { Encoder, decode as cborDecode } from "cbor-x";

const CBOR_ENC = new Encoder({ tagUint8Array: false });

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
  directory_endpoint: RelayEndpointInfo; // SESSION-003: client dials directory for session_sealed events
  session_timestamp: number;        // Unix ms
  directory_pubkey: Uint8Array;     // 32-byte directory identity pubkey
  directory_signature: Uint8Array;  // 64-byte Ed25519 over canonical CBOR of assignment fields
}

// ─── SealPayload (SESSION-003) ────────────────────────────────────────────────

/**
 * SEAL control payload carried as the content_bytes of a ctrl leaf.
 * Canonical CBOR encoding: [session_id, final_root, close_timestamp, "PENDING"].
 * Per SESSION-003 behavior spec.
 */
export interface SealPayload {
  session_id: Uint8Array;   // 16 bytes — matches the session
  final_root: Uint8Array;   // 32-byte Merkle root at the time of SEAL signing
  close_timestamp: number;  // Unix ms
  attestation: "PENDING";   // M1 placeholder; M7 replaces with CLEAN/FLAGGED
}

/**
 * Encode a SealPayload as canonical CBOR: [session_id, final_root, close_timestamp, "PENDING"].
 * Per SESSION-003 behavior spec and RFC 8949 §4.2.1.
 */
export function encodeSealPayload(payload: SealPayload): Uint8Array {
  return CBOR_ENC.encode([
    payload.session_id,
    payload.final_root,
    payload.close_timestamp > 0xffffffff
      ? BigInt(payload.close_timestamp)
      : payload.close_timestamp,
    payload.attestation,
  ]) as Uint8Array;
}

/**
 * Decode a SEAL payload CBOR. Returns null on malformed input.
 */
export function decodeSealPayload(bytes: Uint8Array): SealPayload | null {
  let arr: unknown;
  try {
    arr = cborDecode(bytes);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== 4) return null;
  const [_sid, _root, _ts, _attest] = arr;
  const sid = _sid instanceof Uint8Array ? _sid : Buffer.isBuffer(_sid) ? new Uint8Array(_sid as Buffer) : null;
  const root = _root instanceof Uint8Array ? _root : Buffer.isBuffer(_root) ? new Uint8Array(_root as Buffer) : null;
  if (!sid || sid.length !== 16) return null;
  if (!root || root.length !== 32) return null;
  const ts = typeof _ts === "number" ? _ts : typeof _ts === "bigint" ? Number(_ts) : null;
  if (ts === null) return null;
  if (_attest !== "PENDING") return null;
  return { session_id: sid, final_root: root, close_timestamp: ts, attestation: "PENDING" };
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
