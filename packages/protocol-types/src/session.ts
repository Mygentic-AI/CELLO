/**
 * CELLO-SESSION-002/MSG-004/SESSION-003/SESSION-004 — session.ts
 *
 * SessionAssignment: shared wire type used by directory (sender), client (receiver),
 * and relay (verifier). Lives here so client can import it without touching @cello/directory.
 *
 * SESSION-004 additions to SessionAssignment:
 *   signature_type: 'frost' | 'single'
 *     - 'frost': the directory_signature field carries the 64-byte combined FROST output
 *     - 'single': M1-era single-key directory signature (refused by M2 clients)
 *   signer_pubkey?: Uint8Array (32 bytes, present when signature_type === 'frost')
 *     - The initiator's primary_pubkey (group FROST key). Embedded so the counterparty
 *       can verify without a separate directory round-trip.
 *
 * FROST TBS for session establishment (RFC 9591, domain separation per CONTEXT.md):
 *   context: "cello-frost-session-establishment-v1"
 *   tbs: canonical CBOR([session_id, agent_A_pubkey, agent_B_pubkey, genesis_prev_root, timestamp])
 *   framing: <context>\0<tbs_cbor>
 *   Note: signer_pubkey is NOT in the TBS — it is derived from DKG and embedded in the frame.
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
 *
 * ─── Phase P: SESSION-004 Pseudocode ─────────────────────────────────────────
 *
 * SessionAssignment type changes (MEDIUM-6: discriminated union enforces signer_pubkey):
 *   // Use a discriminated union so TypeScript enforces signer_pubkey is present for 'frost'
 *   type SessionAssignmentFrost = { ...common fields..., signature_type: 'frost', signer_pubkey: Uint8Array }
 *   type SessionAssignmentSingle = { ...common fields..., signature_type: 'single' }
 *   type SessionAssignment = SessionAssignmentFrost | SessionAssignmentSingle
 *
 *   // Common fields (all existing SessionAssignment fields plus signature_type + signer_pubkey):
 *   session_id, participant_a, participant_b, relay_endpoint, directory_endpoint,
 *   session_timestamp, directory_pubkey, directory_signature
 *
 * buildSessionEstablishmentTbs(sessionId, pubA, pubB, genesisPrevRoot, timestamp):
 *   // HIGH-5: exported from protocol-types so both directory and client use identical CBOR encoding
 *   //         Any encoding drift would cause silent verification failures.
 *   // TBS = canonical CBOR([session_id, agent_A_pubkey, agent_B_pubkey, genesis_prev_root, timestamp])
 *   // Per CONTEXT.md: uses CBOR_ENC.encode() with tagUint8Array: false
 *   // timestamp is uint32 or BigInt depending on size (>0xffffffff → BigInt)
 *   return CBOR_ENC.encode([sessionId, pubA, pubB, genesisPrevRoot,
 *                           timestamp > 0xffffffff ? BigInt(timestamp) : timestamp])
 *
 * IMPORTANT-8: Existing test files that build SessionAssignment objects need updating to
 * include signature_type. Files affected (all M1 tests add signature_type: 'single'):
 *   - packages/client/src/__tests__/session.test.ts (makeDirectoryAssignment helper)
 *   - packages/client/src/__tests__/msg004.test.ts (makeDirectoryAssignment helper)
 *   - packages/client/src/__tests__/session003.test.ts (multiple construction sites)
 *   - packages/client/src/__tests__/session006.test.ts (makeDirectoryAssignment helper)
 *   - packages/e2e-tests/src/__tests__/mcp-002.test.ts (assignment construction)
 *   - packages/relay/src/__tests__/relay-node.test.ts (makeAssignment helper)
 *   - packages/relay/src/__tests__/relay-incremental.test.ts (makeAssignment helper)
 *   - packages/directory/src/directory-frames.ts (decodeOutboundSignalingFrame parser)
 *
 * IMPORTANT-9: ReceiveAssignmentResult in client/src/types.ts needs 'unsupported_signature_type'
 *   added to its reason union.
 *
 * ─── End Phase P Pseudocode ───────────────────────────────────────────────────
 */

import { createHash } from "node:crypto";
import { Encoder, decode as cborDecode } from "cbor-x";

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── SessionAssignment (shared wire type — SESSION-002 / SESSION-004) ─────────

export interface ParticipantInfo {
  pubkey: Uint8Array;    // 32-byte K_local pubkey
  peer_id: string;       // libp2p Peer ID string
  multiaddrs: string[];  // dialing multiaddrs
}

export interface RelayEndpointInfo {
  peer_id: string;
  multiaddrs: string[];
}

/** Common fields shared by both SessionAssignment variants. */
interface SessionAssignmentCommon {
  session_id: Uint8Array;           // 16 bytes, CSPRNG
  participant_a: ParticipantInfo;
  participant_b: ParticipantInfo;
  relay_endpoint: RelayEndpointInfo;
  directory_endpoint: RelayEndpointInfo; // SESSION-003: client dials directory for session_sealed events
  session_timestamp: number;        // Unix ms
  directory_pubkey: Uint8Array;     // 32-byte directory identity pubkey
  directory_signature: Uint8Array;  // 64-byte threshold/single signature over TBS
}

/**
 * SESSION-004: FROST-signed assignment. `signer_pubkey` is the initiator's
 * group public key (primary_pubkey from DKG / trustedDealer commitments[0]).
 * Embedded so the counterparty can verify without a directory round-trip.
 */
export interface SessionAssignmentFrost extends SessionAssignmentCommon {
  signature_type: "frost";
  signer_pubkey: Uint8Array; // 32-byte FROST group public key — required for 'frost'
}

/**
 * M1-era single-key directory signature. Refused by M2+ clients.
 */
export interface SessionAssignmentSingle extends SessionAssignmentCommon {
  signature_type: "single";
  // signer_pubkey absent — M1 clients use directory_pubkey for verification
}

/**
 * Discriminated union. TypeScript enforces `signer_pubkey` is present only
 * when `signature_type === 'frost'`.
 *
 * SESSION-004: M2+ code should only handle 'frost'. M1 assignments with
 * 'single' are rejected with `unsupported_signature_type`.
 */
export type SessionAssignment = SessionAssignmentFrost | SessionAssignmentSingle;

// ─── Session establishment TBS builder (SESSION-004 / HIGH-5) ─────────────────

/**
 * Build the FROST to-be-signed bytes for session establishment.
 *
 * Exported from protocol-types so BOTH the directory (signer) and the client
 * (verifier) use identical canonical CBOR encoding. Any drift would silently
 * break verification.
 *
 * TBS = canonical CBOR([session_id, agent_A_pubkey, agent_B_pubkey, genesis_prev_root, timestamp])
 *
 * Per CONTEXT.md: tagUint8Array: false. Timestamp encoded as BigInt when > 0xffffffff.
 *
 * @param sessionId - 16-byte session identifier
 * @param pubA - 32-byte K_local pubkey of participant A
 * @param pubB - 32-byte K_local pubkey of participant B
 * @param genesisPrevRoot - 32-byte genesis prev_root (output of computeGenesisPrevRoot)
 * @param timestamp - session_timestamp in Unix milliseconds
 * @returns canonical CBOR bytes of the TBS array
 */
export function buildSessionEstablishmentTbs(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  genesisPrevRoot: Uint8Array,
  timestamp: number | bigint,
): Uint8Array {
  return CBOR_ENC.encode([
    sessionId,
    pubA,
    pubB,
    genesisPrevRoot,
    typeof timestamp === "bigint" || timestamp > 0xffffffff ? BigInt(timestamp) : timestamp,
  ]) as Uint8Array;
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
