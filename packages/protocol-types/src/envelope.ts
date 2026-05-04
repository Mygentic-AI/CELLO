/**
 * @cello/protocol-types — CELLO-MSG-001 (v0) + CELLO-MSG-003 (v1)
 * Envelope construction, validation, serialization, and deserialization.
 *
 * ──── v0 Pseudocode (CELLO-MSG-001) ────
 *
 * buildEnvelope(content, keyProvider, timestamp):
 *   1. Reject if content.length > MAX_CONTENT_BYTES (1,048,576)  → content_too_large
 *   2. Compute content_hash = msgLeafHash(content)               [FIPS 180-4: SHA-256(0x00||content)]
 *   3. Fetch sender_pubkey = await keyProvider.getPublicKey()
 *   4. Build TBS positional array: [0, content_hash, sender_pubkey, timestamp]
 *      — timestamp encoded as BigInt so cbor-x emits uint64, not float64
 *   5. tbs_bytes = encodeTBS([0, content_hash, sender_pubkey, BigInt(timestamp)])
 *      [RFC 8949 §4.2.1: canonical CBOR, Encoder({tagUint8Array:false})]
 *   6. sender_signature = await keyProvider.sign(tbs_bytes)      [RFC 8032: Ed25519]
 *   7. Return envelope with all six fields populated
 *
 * validateEnvelope(envelope):
 *   1. Check protocol_version === 0                              → unsupported_version
 *   2. Check presence + exact byte lengths of all typed fields:
 *        sender_pubkey: 32 bytes                                 → missing_field / invalid_field
 *        content_hash:  32 bytes                                 → missing_field / invalid_field
 *        sender_signature: 64 bytes                             → missing_field / invalid_field
 *   3. Check timestamp >= 0                                      → invalid_field
 *   4. Check content.length <= MAX_CONTENT_BYTES                 → content_too_large
 *   5. Recompute expected_hash = msgLeafHash(content)
 *      Compare byte-by-byte to content_hash                     → content_hash_mismatch (BEFORE sig check)
 *   6. Rebuild TBS bytes (same as step 5 in build)
 *   7. verify(sender_pubkey, tbs_bytes, sender_signature)        → invalid_field('sender_signature')
 *   8. Return ok: true
 *
 * ──── v1 Pseudocode (CELLO-MSG-003) ────
 *
 * buildEnvelopeV1(content, keyProvider, timestamp, session_id, last_seen_seq):
 *   1. Reject if content.length > MAX_CONTENT_BYTES              → content_too_large
 *      [no hash/sig computed before this check — AC-009]
 *   2. Compute content_hash = msgLeafHash(content)               [FIPS 180-4: SHA-256(0x00||content)]
 *      Caller-supplied hashes ignored — SI-001
 *   3. Fetch sender_pubkey = await keyProvider.getPublicKey()
 *   4. Build Structure 1 (TBS) positional 6-element array:
 *      [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 *      — protocol_version=1 (CBOR uint)
 *      — content_hash: 32-byte CBOR bstr (SHA-256(0x00||content))
 *      — sender_pubkey: 32-byte CBOR bstr (Ed25519 public key, RFC 8032)
 *      — session_id: 16-byte CBOR bstr
 *      — last_seen_seq: CBOR uint (non-negative integer)
 *      — timestamp: CBOR uint (Unix ms; BigInt when > 0xFFFFFFFF for minimal encoding
 *        per RFC 8949 §4.2.1)
 *   5. tbs_bytes = CBOR_ENC.encode(tbs_array)
 *      [RFC 8949 §4.2.1: canonical CBOR, Encoder({tagUint8Array:false})]
 *   6. sender_signature = await keyProvider.sign(tbs_bytes)      [RFC 8032: Ed25519]
 *   7. Return MessageEnvelopeV1 with all eight fields populated
 *
 * validateEnvelopeV1(envelope):
 *   1. Check protocol_version === 1                              → unsupported_version (AC-003, AC-004)
 *      Hard-reject: no v0 fallback, no negotiation (M1 drops v0)
 *   2. Field presence + byte-length checks:
 *        sender_pubkey: 32 bytes                                 → missing_field / invalid_field
 *        content_hash:  32 bytes                                 → missing_field / invalid_field
 *        session_id:    16 bytes                                 → missing_field / invalid_field
 *        sender_signature: 64 bytes                             → missing_field / invalid_field
 *   3. Check last_seen_seq >= 0, integer                         → invalid_field
 *   4. Check timestamp >= 0, integer                             → invalid_field
 *   5. Check content.length <= MAX_CONTENT_BYTES                 → content_too_large
 *   6. Recompute expected_hash = msgLeafHash(content)
 *      Compare byte-by-byte to content_hash                     → content_hash_mismatch (BEFORE sig check)
 *   7. Rebuild Structure 1 TBS bytes (same as step 5 in build)
 *   8. verify(sender_pubkey, tbs_bytes, sender_signature)        → invalid_field('sender_signature')
 *   9. Return ok: true
 *
 * extractStructure1(envelope: MessageEnvelopeV1) → Uint8Array:
 *   1. Build positional 6-element array from envelope fields
 *   2. Return CBOR_ENC.encode([1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp])
 *      This is the exact bytes the relay uses to build Structure 2 (MERKLE-002)
 *
 * References:
 *   RFC 8949 §4.2.1 — Core Deterministic Encoding Requirements
 *   RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA)
 *   FIPS 180-4 — SHA-256 (used by msgLeafHash for content_hash computation)
 */

import { Encoder } from "cbor-x";
import { decode as cborDecode } from "cbor-x";
import { msgLeafHash, verify } from "@cello/crypto";
import type { KeyProvider } from "@cello/crypto";
import type {
  MessageEnvelope,
  MessageEnvelopeV1,
  BuildResult,
  BuildResultV1,
  ValidateResult,
  ValidateResultV1,
  DeserializeResult,
  DeserializeResultV1,
} from "./types.js";

/** Maximum allowed content size: 1 MiB (AC-009, AC-010, AC-011). */
export const MAX_CONTENT_BYTES = 1_048_576;

/**
 * Canonical CBOR encoder per RFC 8949 §4.2.1.
 * tagUint8Array: false — encode Uint8Array as CBOR byte strings (major type 2),
 * not as typed-array tags (tag 64). This is the standard wire representation.
 */
const CBOR_ENC = new Encoder({ tagUint8Array: false });

/**
 * Encode the TBS positional array as canonical CBOR.
 *
 * TBS layout: [protocol_version, content_hash, sender_pubkey, timestamp]
 * - protocol_version: CBOR uint (0)
 * - content_hash: CBOR byte string (32 bytes)
 * - sender_pubkey: CBOR byte string (32 bytes)
 * - timestamp: CBOR uint64 (BigInt to force integer encoding, not float64)
 *
 * RFC 8949 §4.2.1: integers use the shortest encoding; byte strings are verbatim.
 * Using BigInt(timestamp) ensures cbor-x emits 0x1b (8-byte uint64) not 0xfb (float64).
 */
function encodeTBS(
  protocolVersion: number,
  contentHash: Uint8Array,
  senderPubkey: Uint8Array,
  timestamp: number
): Uint8Array {
  // RFC 8949 §4.2.1: integers must use the shortest encoding.
  // cbor-x encodes JS numbers ≤ 0xFFFFFFFF as 4-byte uint (minimal) but numbers
  // above that threshold as float64 (0xfb…) — not canonical. BigInt always emits
  // 8-byte uint64 regardless of value — non-minimal for small values.
  // Solution: use BigInt only when the value exceeds uint32 range, ensuring
  // shortest encoding across all valid Unix millisecond timestamps.
  const tsEncoded = timestamp > 0xFFFFFFFF ? BigInt(timestamp) : timestamp;
  const tbs = [protocolVersion, contentHash, senderPubkey, tsEncoded];
  return CBOR_ENC.encode(tbs);
}

/**
 * Build a signed MessageEnvelope.
 *
 * SI-001: content_hash is ALWAYS recomputed; any caller-supplied value is ignored.
 * AC-010: content > 1 MiB → content_too_large, no hash or signature computed.
 *
 * @param content - Raw message bytes
 * @param keyProvider - Signing key abstraction (K_local)
 * @param timestamp - Unix milliseconds (non-negative)
 */
export async function buildEnvelope(
  content: Uint8Array,
  keyProvider: KeyProvider,
  timestamp: number
): Promise<BuildResult> {
  // AC-010: reject oversized content before any crypto
  if (content.length > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      error: {
        reason: "content_too_large",
        message: `content length ${content.length} exceeds maximum ${MAX_CONTENT_BYTES} bytes`,
      },
    };
  }

  // SI-001: always recompute — never trust caller-supplied hash
  const content_hash = msgLeafHash(content);
  const sender_pubkey = await keyProvider.getPublicKey();

  // TBS: positional array [protocol_version, content_hash, sender_pubkey, timestamp]
  const tbsBytes = encodeTBS(0, content_hash, sender_pubkey, timestamp);

  // Ed25519 sign per RFC 8032
  const sender_signature = await keyProvider.sign(tbsBytes);

  return {
    ok: true,
    envelope: {
      protocol_version: 0,
      sender_pubkey,
      content,
      content_hash,
      timestamp,
      sender_signature,
    },
  };
}

/**
 * Validate a MessageEnvelope.
 *
 * Validation order (fail-fast):
 *   1. protocol_version check (AC-013, SI-004) — before any other check
 *   2. Field presence and byte-length checks (AC-003, AC-004)
 *   3. timestamp range check (AC-005)
 *   4. content size check (AC-011)
 *   5. content_hash recomputation and comparison (AC-012) — BEFORE signature check
 *   6. Signature verification (AC-002, AC-007, SI-003)
 */
export function validateEnvelope(envelope: MessageEnvelope): ValidateResult {
  // Step 1: version check — first so unknown versions are detectable without parsing (SI-004)
  if (envelope.protocol_version !== 0) {
    return {
      ok: false,
      error: {
        reason: "unsupported_version",
        message: `unsupported protocol_version: ${envelope.protocol_version}`,
      },
    };
  }

  // Step 2: field presence and size checks
  if (
    envelope.sender_pubkey === undefined ||
    envelope.sender_pubkey === null
  ) {
    return {
      ok: false,
      error: { reason: "missing_field", field: "sender_pubkey", message: "sender_pubkey is missing" },
    };
  }
  if (envelope.sender_pubkey.length !== 32) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "sender_pubkey",
        message: `sender_pubkey must be 32 bytes, got ${envelope.sender_pubkey.length}`,
      },
    };
  }

  if (
    envelope.content_hash === undefined ||
    envelope.content_hash === null
  ) {
    return {
      ok: false,
      error: { reason: "missing_field", field: "content_hash", message: "content_hash is missing" },
    };
  }
  if (envelope.content_hash.length !== 32) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "content_hash",
        message: `content_hash must be 32 bytes, got ${envelope.content_hash.length}`,
      },
    };
  }

  if (
    envelope.sender_signature === undefined ||
    envelope.sender_signature === null
  ) {
    return {
      ok: false,
      error: { reason: "missing_field", field: "sender_signature", message: "sender_signature is missing" },
    };
  }
  if (envelope.sender_signature.length !== 64) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "sender_signature",
        message: `sender_signature must be 64 bytes, got ${envelope.sender_signature.length}`,
      },
    };
  }

  // Step 3: timestamp range
  if (envelope.timestamp < 0 || !Number.isInteger(envelope.timestamp)) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "timestamp",
        message: `timestamp must be a non-negative integer, got ${envelope.timestamp}`,
      },
    };
  }

  // Step 4: content size
  if (envelope.content.length > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      error: {
        reason: "content_too_large",
        message: `content length ${envelope.content.length} exceeds maximum ${MAX_CONTENT_BYTES} bytes`,
      },
    };
  }

  // Step 5: content_hash recomputation — checked BEFORE signature (AC-012)
  const expectedHash = msgLeafHash(envelope.content);
  if (!bytesEqual(expectedHash, envelope.content_hash)) {
    return {
      ok: false,
      error: {
        reason: "content_hash_mismatch",
        message: "content_hash does not match SHA-256(0x00 || content)",
      },
    };
  }

  // Step 6: signature verification
  const tbsBytes = encodeTBS(
    envelope.protocol_version,
    envelope.content_hash,
    envelope.sender_pubkey,
    envelope.timestamp
  );
  if (!verify(envelope.sender_pubkey, tbsBytes, envelope.sender_signature)) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "sender_signature",
        message: "signature verification failed",
      },
    };
  }

  return { ok: true };
}

/**
 * Serialize a MessageEnvelope to canonical CBOR bytes (RFC 8949 §4.2.1).
 *
 * The envelope is encoded as a CBOR map with string keys.
 * timestamp uses minimal encoding per RFC 8949 §4.2.1 — see encodeTBS comment.
 */
export function serializeEnvelope(envelope: MessageEnvelope): Uint8Array {
  const map = {
    protocol_version: envelope.protocol_version,
    sender_pubkey: envelope.sender_pubkey,
    content: envelope.content,
    content_hash: envelope.content_hash,
    timestamp: envelope.timestamp > 0xFFFFFFFF ? BigInt(envelope.timestamp) : envelope.timestamp,
    sender_signature: envelope.sender_signature,
  };
  return CBOR_ENC.encode(map);
}

/**
 * Deserialize a MessageEnvelope from CBOR bytes.
 *
 * Performs structural validation only (field presence, types, sizes).
 * Does NOT re-validate the signature or content_hash — call validateEnvelope for that.
 */
export function deserializeEnvelope(bytes: Uint8Array): DeserializeResult {
  let raw: unknown;
  try {
    raw = cborDecode(bytes);
  } catch (e) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "bytes",
        message: `CBOR decode failed: ${(e as Error).message}`,
      },
    };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "bytes",
        message: "decoded value is not a map",
      },
    };
  }

  const obj = raw as Record<string, unknown>;

  // protocol_version
  if (!("protocol_version" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "protocol_version", message: "protocol_version is missing" } };
  }
  const pv = obj["protocol_version"];
  if (typeof pv !== "number" || pv !== 0) {
    return { ok: false, error: { reason: "unsupported_version", message: `unsupported protocol_version: ${pv}` } };
  }

  // sender_pubkey
  if (!("sender_pubkey" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "sender_pubkey", message: "sender_pubkey is missing" } };
  }
  const spk = toUint8Array(obj["sender_pubkey"]);
  if (!spk || spk.length !== 32) {
    return { ok: false, error: { reason: "invalid_field", field: "sender_pubkey", message: `sender_pubkey must be 32 bytes` } };
  }

  // content
  if (!("content" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "content", message: "content is missing" } };
  }
  const content = toUint8Array(obj["content"]);
  if (!content) {
    return { ok: false, error: { reason: "invalid_field", field: "content", message: "content must be bytes" } };
  }

  // content_hash
  if (!("content_hash" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "content_hash", message: "content_hash is missing" } };
  }
  const ch = toUint8Array(obj["content_hash"]);
  if (!ch || ch.length !== 32) {
    return { ok: false, error: { reason: "invalid_field", field: "content_hash", message: `content_hash must be 32 bytes` } };
  }

  // timestamp
  if (!("timestamp" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "timestamp", message: "timestamp is missing" } };
  }
  const tsRaw = obj["timestamp"];
  const ts = typeof tsRaw === "bigint" ? Number(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
  if (!Number.isInteger(ts) || ts < 0 || ts > Number.MAX_SAFE_INTEGER) {
    return { ok: false, error: { reason: "invalid_field", field: "timestamp", message: `invalid timestamp: ${tsRaw}` } };
  }

  // sender_signature
  if (!("sender_signature" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "sender_signature", message: "sender_signature is missing" } };
  }
  const sig = toUint8Array(obj["sender_signature"]);
  if (!sig || sig.length !== 64) {
    return { ok: false, error: { reason: "invalid_field", field: "sender_signature", message: `sender_signature must be 64 bytes` } };
  }

  return {
    ok: true,
    envelope: {
      protocol_version: 0,
      sender_pubkey: spk,
      content,
      content_hash: ch,
      timestamp: ts,
      sender_signature: sig,
    },
  };
}

// ─── v1 functions (CELLO-MSG-003) ────────────────────────────────────────────

/**
 * Encode the v1 Structure 1 (TBS) positional 6-element array as canonical CBOR.
 *
 * Structure 1 layout: [protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 * - protocol_version: CBOR uint, always 1
 * - content_hash: CBOR byte string (32 bytes, SHA-256(0x00||content))
 * - sender_pubkey: CBOR byte string (32 bytes, Ed25519 public key per RFC 8032)
 * - session_id: CBOR byte string (16 bytes)
 * - last_seen_seq: CBOR uint (non-negative integer)
 * - timestamp: CBOR uint (Unix ms; BigInt for values > 0xFFFFFFFF per RFC 8949 §4.2.1 minimal encoding)
 *
 * RFC 8949 §4.2.1: integers must use shortest encoding. BigInt forces 8-byte uint64 for
 * timestamps above uint32 range (all valid Unix ms timestamps since ~Feb 2106).
 */
function encodeTBSV1(
  contentHash: Uint8Array,
  senderPubkey: Uint8Array,
  sessionId: Uint8Array,
  lastSeenSeq: number,
  timestamp: number
): Uint8Array {
  const tsEncoded = timestamp > 0xFFFFFFFF ? BigInt(timestamp) : timestamp;
  const tbs = [1, contentHash, senderPubkey, sessionId, lastSeenSeq, tsEncoded];
  return CBOR_ENC.encode(tbs);
}

/**
 * Build a signed v1 MessageEnvelopeV1 (CELLO-MSG-003).
 *
 * SI-001: content_hash is ALWAYS recomputed from content; any caller-supplied value is ignored.
 * AC-009: content > 1 MiB → content_too_large, no hash or signature computed.
 *
 * @param content - Raw message bytes (up to 1 MiB)
 * @param keyProvider - Signing key abstraction (K_local)
 * @param timestamp - Unix milliseconds (non-negative)
 * @param session_id - 16-byte session identifier
 * @param last_seen_seq - Highest canonical seq number seen from relay (0 for first message)
 */
export async function buildEnvelopeV1(
  content: Uint8Array,
  keyProvider: KeyProvider,
  timestamp: number,
  session_id: Uint8Array,
  last_seen_seq: number
): Promise<BuildResultV1> {
  // session_id must be exactly 16 bytes — catch at build time, not just validation time
  if (session_id.length !== 16) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "session_id",
        message: `session_id must be 16 bytes, got ${session_id.length}`,
      },
    };
  }

  // AC-009: reject oversized content before any crypto
  if (content.length > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      error: {
        reason: "content_too_large",
        message: `content length ${content.length} exceeds maximum ${MAX_CONTENT_BYTES} bytes`,
      },
    };
  }

  // SI-001: always recompute — never trust caller-supplied hash
  const content_hash = msgLeafHash(content);
  const sender_pubkey = await keyProvider.getPublicKey();

  // Structure 1 (TBS): [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
  const tbsBytes = encodeTBSV1(content_hash, sender_pubkey, session_id, last_seen_seq, timestamp);

  // Ed25519 sign per RFC 8032
  const sender_signature = await keyProvider.sign(tbsBytes);

  return {
    ok: true,
    envelope: {
      protocol_version: 1,
      sender_pubkey,
      content,
      content_hash,
      session_id,
      last_seen_seq,
      timestamp,
      sender_signature,
    },
  };
}

/**
 * Validate a v1 MessageEnvelopeV1 (CELLO-MSG-003).
 *
 * Validation order (fail-fast):
 *   1. protocol_version === 1 check — hard-reject v0 and any other version (AC-003, AC-004)
 *   2. Field presence and byte-length checks
 *   3. last_seen_seq and timestamp range checks
 *   4. content size check
 *   5. content_hash recomputation (BEFORE signature check) (AC-006)
 *   6. Signature verification over Structure 1 TBS
 */
export function validateEnvelopeV1(envelope: MessageEnvelopeV1): ValidateResultV1 {
  // Step 1: version gate — hard-reject any version != 1 (M1 drops v0; no negotiation)
  if (envelope.protocol_version !== 1) {
    return {
      ok: false,
      error: {
        reason: "unsupported_version",
        message: `unsupported protocol_version: ${envelope.protocol_version}`,
      },
    };
  }

  // Step 2a: sender_pubkey — 32 bytes
  if (envelope.sender_pubkey === undefined || envelope.sender_pubkey === null) {
    return {
      ok: false,
      error: { reason: "missing_field", field: "sender_pubkey", message: "sender_pubkey is missing" },
    };
  }
  if (envelope.sender_pubkey.length !== 32) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "sender_pubkey",
        message: `sender_pubkey must be 32 bytes, got ${envelope.sender_pubkey.length}`,
      },
    };
  }

  // Step 2b: content_hash — 32 bytes
  if (envelope.content_hash === undefined || envelope.content_hash === null) {
    return {
      ok: false,
      error: { reason: "missing_field", field: "content_hash", message: "content_hash is missing" },
    };
  }
  if (envelope.content_hash.length !== 32) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "content_hash",
        message: `content_hash must be 32 bytes, got ${envelope.content_hash.length}`,
      },
    };
  }

  // Step 2c: session_id — 16 bytes
  if (envelope.session_id === undefined || envelope.session_id === null) {
    return {
      ok: false,
      error: { reason: "missing_field", field: "session_id", message: "session_id is missing" },
    };
  }
  if (envelope.session_id.length !== 16) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "session_id",
        message: `session_id must be 16 bytes, got ${envelope.session_id.length}`,
      },
    };
  }

  // Step 2d: sender_signature — 64 bytes
  if (envelope.sender_signature === undefined || envelope.sender_signature === null) {
    return {
      ok: false,
      error: { reason: "missing_field", field: "sender_signature", message: "sender_signature is missing" },
    };
  }
  if (envelope.sender_signature.length !== 64) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "sender_signature",
        message: `sender_signature must be 64 bytes, got ${envelope.sender_signature.length}`,
      },
    };
  }

  // Step 3: last_seen_seq range
  if (!Number.isInteger(envelope.last_seen_seq) || envelope.last_seen_seq < 0) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "last_seen_seq",
        message: `last_seen_seq must be a non-negative integer, got ${envelope.last_seen_seq}`,
      },
    };
  }

  // Step 4: timestamp range
  if (!Number.isInteger(envelope.timestamp) || envelope.timestamp < 0) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "timestamp",
        message: `timestamp must be a non-negative integer, got ${envelope.timestamp}`,
      },
    };
  }

  // Step 5: content size
  if (envelope.content.length > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      error: {
        reason: "content_too_large",
        message: `content length ${envelope.content.length} exceeds maximum ${MAX_CONTENT_BYTES} bytes`,
      },
    };
  }

  // Step 6: content_hash recomputation — checked BEFORE signature (AC-006)
  const expectedHash = msgLeafHash(envelope.content);
  if (!bytesEqual(expectedHash, envelope.content_hash)) {
    return {
      ok: false,
      error: {
        reason: "content_hash_mismatch",
        message: "content_hash does not match SHA-256(0x00 || content)",
      },
    };
  }

  // Step 7: signature verification over Structure 1 TBS
  const tbsBytes = encodeTBSV1(
    envelope.content_hash,
    envelope.sender_pubkey,
    envelope.session_id,
    envelope.last_seen_seq,
    envelope.timestamp
  );
  if (!verify(envelope.sender_pubkey, tbsBytes, envelope.sender_signature)) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "sender_signature",
        message: "signature verification failed",
      },
    };
  }

  return { ok: true };
}

/**
 * Serialize a v1 MessageEnvelopeV1 to canonical CBOR bytes (RFC 8949 §4.2.1).
 *
 * The envelope is encoded as a CBOR map with string keys.
 * timestamp uses minimal encoding per RFC 8949 §4.2.1.
 */
export function serializeEnvelopeV1(envelope: MessageEnvelopeV1): Uint8Array {
  const map = {
    protocol_version: envelope.protocol_version,
    sender_pubkey: envelope.sender_pubkey,
    content: envelope.content,
    content_hash: envelope.content_hash,
    session_id: envelope.session_id,
    last_seen_seq: envelope.last_seen_seq,
    timestamp: envelope.timestamp > 0xFFFFFFFF ? BigInt(envelope.timestamp) : envelope.timestamp,
    sender_signature: envelope.sender_signature,
  };
  return CBOR_ENC.encode(map);
}

/**
 * Deserialize a v1 MessageEnvelopeV1 from CBOR bytes.
 *
 * Performs structural validation only (field presence, types, sizes).
 * Does NOT re-validate the signature or content_hash — call validateEnvelopeV1 for that.
 */
export function deserializeEnvelopeV1(bytes: Uint8Array): DeserializeResultV1 {
  let raw: unknown;
  try {
    raw = cborDecode(bytes);
  } catch (e) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "bytes",
        message: `CBOR decode failed: ${(e as Error).message}`,
      },
    };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: "bytes",
        message: "decoded value is not a map",
      },
    };
  }

  const obj = raw as Record<string, unknown>;

  // protocol_version — must be exactly 1
  if (!("protocol_version" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "protocol_version", message: "protocol_version is missing" } };
  }
  const pv = obj["protocol_version"];
  if (typeof pv !== "number" || pv !== 1) {
    return { ok: false, error: { reason: "unsupported_version", message: `unsupported protocol_version: ${pv}` } };
  }

  // sender_pubkey — 32 bytes
  if (!("sender_pubkey" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "sender_pubkey", message: "sender_pubkey is missing" } };
  }
  const spk = toUint8Array(obj["sender_pubkey"]);
  if (!spk || spk.length !== 32) {
    return { ok: false, error: { reason: "invalid_field", field: "sender_pubkey", message: "sender_pubkey must be 32 bytes" } };
  }

  // content
  if (!("content" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "content", message: "content is missing" } };
  }
  const content = toUint8Array(obj["content"]);
  if (!content) {
    return { ok: false, error: { reason: "invalid_field", field: "content", message: "content must be bytes" } };
  }

  // content_hash — 32 bytes
  if (!("content_hash" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "content_hash", message: "content_hash is missing" } };
  }
  const ch = toUint8Array(obj["content_hash"]);
  if (!ch || ch.length !== 32) {
    return { ok: false, error: { reason: "invalid_field", field: "content_hash", message: "content_hash must be 32 bytes" } };
  }

  // session_id — 16 bytes
  if (!("session_id" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "session_id", message: "session_id is missing" } };
  }
  const sid = toUint8Array(obj["session_id"]);
  if (!sid || sid.length !== 16) {
    return { ok: false, error: { reason: "invalid_field", field: "session_id", message: "session_id must be 16 bytes" } };
  }

  // last_seen_seq — non-negative integer
  if (!("last_seen_seq" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "last_seen_seq", message: "last_seen_seq is missing" } };
  }
  const lssRaw = obj["last_seen_seq"];
  const lss = typeof lssRaw === "bigint" ? Number(lssRaw) : (typeof lssRaw === "number" ? lssRaw : NaN);
  if (!Number.isInteger(lss) || lss < 0 || lss > Number.MAX_SAFE_INTEGER) {
    return { ok: false, error: { reason: "invalid_field", field: "last_seen_seq", message: `invalid last_seen_seq: ${lssRaw}` } };
  }

  // timestamp — non-negative integer
  if (!("timestamp" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "timestamp", message: "timestamp is missing" } };
  }
  const tsRaw = obj["timestamp"];
  const ts = typeof tsRaw === "bigint" ? Number(tsRaw) : (typeof tsRaw === "number" ? tsRaw : NaN);
  if (!Number.isInteger(ts) || ts < 0 || ts > Number.MAX_SAFE_INTEGER) {
    return { ok: false, error: { reason: "invalid_field", field: "timestamp", message: `invalid timestamp: ${tsRaw}` } };
  }

  // sender_signature — 64 bytes
  if (!("sender_signature" in obj)) {
    return { ok: false, error: { reason: "missing_field", field: "sender_signature", message: "sender_signature is missing" } };
  }
  const sig = toUint8Array(obj["sender_signature"]);
  if (!sig || sig.length !== 64) {
    return { ok: false, error: { reason: "invalid_field", field: "sender_signature", message: "sender_signature must be 64 bytes" } };
  }

  return {
    ok: true,
    envelope: {
      protocol_version: 1,
      sender_pubkey: spk,
      content,
      content_hash: ch,
      session_id: sid,
      last_seen_seq: lss,
      timestamp: ts,
      sender_signature: sig,
    },
  };
}

/**
 * Extract Structure 1 from a v1 envelope — returns the canonical CBOR bytes that were signed.
 *
 * Structure 1: canonical_CBOR([1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp])
 *
 * This is the exact bytes the relay uses to build Structure 2 (CELLO-MERKLE-002).
 * Per RFC 8949 §4.2.1 canonical CBOR and RFC 8032 Ed25519.
 */
export function extractStructure1(envelope: MessageEnvelopeV1): Uint8Array {
  return encodeTBSV1(
    envelope.content_hash,
    envelope.sender_pubkey,
    envelope.session_id,
    envelope.last_seen_seq,
    envelope.timestamp
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Constant-time byte comparison.
 * Note: for HMAC verification, use a real constant-time compare.
 * For hash comparison this is sufficient since timing leaks only reveal
 * content we already possess.
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Coerce a CBOR-decoded value to Uint8Array.
 * cbor-x with tagUint8Array:false returns Buffer (a Node.js Buffer is a Uint8Array subclass).
 */
function toUint8Array(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}
