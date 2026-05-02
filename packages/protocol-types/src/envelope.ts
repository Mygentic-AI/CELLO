/**
 * @cello/protocol-types — CELLO-MSG-001
 * Envelope construction, validation, serialization, and deserialization.
 *
 * Pseudocode for buildEnvelope(content, keyProvider, timestamp):
 *   1. Reject if content.length > MAX_CONTENT_BYTES (1,048,576)  → content_too_large
 *   2. Compute content_hash = msgLeafHash(content)               [RFC 8032: SHA-256(0x00||content)]
 *   3. Fetch sender_pubkey = await keyProvider.getPublicKey()
 *   4. Build TBS positional array: [0, content_hash, sender_pubkey, timestamp]
 *      — timestamp encoded as BigInt so cbor-x emits uint64, not float64
 *   5. tbs_bytes = encodeTBS([0, content_hash, sender_pubkey, BigInt(timestamp)])
 *      [RFC 8949 §4.2.1: canonical CBOR, Encoder({tagUint8Array:false})]
 *   6. sender_signature = await keyProvider.sign(tbs_bytes)
 *   7. Return envelope with all six fields populated
 *
 * Pseudocode for validateEnvelope(envelope):
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
 * Pseudocode for serializeEnvelope(envelope) → Uint8Array:
 *   1. Build CBOR map: { protocol_version, sender_pubkey, content, content_hash, timestamp, sender_signature }
 *      — timestamp as BigInt for canonical uint64 encoding
 *      — Encoder({tagUint8Array: false}) for bare byte strings
 *   2. Return encoded bytes as Uint8Array
 *
 * Pseudocode for deserializeEnvelope(bytes) → DeserializeResult:
 *   1. CBOR-decode bytes
 *   2. Extract and type-check each field
 *   3. Return { ok: true, envelope } or { ok: false, error }
 *
 * References:
 *   RFC 8949 §4.2.1 — Core Deterministic Encoding Requirements
 *   RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA)
 */

import { Encoder } from "cbor-x";
import { decode as cborDecode } from "cbor-x";
import { msgLeafHash, verify } from "@cello/crypto";
import type { KeyProvider } from "@cello/crypto";
import type {
  MessageEnvelope,
  BuildResult,
  ValidateResult,
  DeserializeResult,
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
