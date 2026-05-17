import { createHash } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";

const MSG_LEAF = 0x00;
const INTERNAL_NODE = 0x01;
const CTRL_LEAF = 0x02;

function prefixed(prefix: number, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + data.length);
  buf[0] = prefix;
  buf.set(data, 1);
  return buf;
}

export function hash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function msgLeafHash(data: Uint8Array): Uint8Array {
  return sha256(prefixed(MSG_LEAF, data));
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length !== 32 || right.length !== 32) {
    throw new Error(`nodeHash: expected 32-byte inputs, got left=${left.length} right=${right.length}`);
  }
  const buf = new Uint8Array(1 + left.length + right.length);
  buf[0] = INTERNAL_NODE;
  buf.set(left, 1);
  buf.set(right, 1 + left.length);
  return sha256(buf);
}

export function ctrlLeafHash(data: Uint8Array): Uint8Array {
  return sha256(prefixed(CTRL_LEAF, data));
}

/**
 * Build the to-be-signed bytes for a relay hash-submit ACK.
 *
 * TBS = SHA-256(hash_bytes || seq_BE4 || ts_BE8)
 *   hash_bytes: 32 raw bytes (the Structure 1 content_hash — NOT hex-encoded)
 *   seq_BE4:    sequence_number as 4-byte big-endian uint32
 *   ts_BE8:     timestamp as 8-byte big-endian uint64
 *
 * Both the relay (signer) and the client (verifier) must use this function so
 * they cannot diverge. RFC 8032 (Ed25519), FIPS 180-4 (SHA-256).
 */
export function buildRelayAckTbs(
  hashBytes: Uint8Array,
  sequenceNumber: number,
  timestamp: number,
): Uint8Array {
  const seqBuf = Buffer.allocUnsafe(4);
  seqBuf.writeUInt32BE(sequenceNumber >>> 0, 0);

  const tsBuf = Buffer.allocUnsafe(8);
  tsBuf.writeBigUInt64BE(BigInt(timestamp), 0);

  const preimage = Buffer.concat([Buffer.from(hashBytes), seqBuf, tsBuf]);
  return new Uint8Array(createHash("sha256").update(preimage).digest());
}
