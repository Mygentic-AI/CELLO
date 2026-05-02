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
