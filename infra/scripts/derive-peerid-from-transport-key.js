#!/usr/bin/env node
/**
 * derive-peerid-from-transport-key.js — Derive libp2p Peer ID from a transport key hex.
 *
 * Reads a 32-byte Ed25519 seed (64-char hex) from stdin and prints the libp2p
 * Peer ID (base58btc, starting with 12D3KooW) to stdout.
 *
 * The derivation matches what @cello-protocol/transport does at runtime:
 *   1. Ed25519 public key from seed (RFC 8032)
 *   2. Protobuf-encode as libp2p public key: {Type: Ed25519=1, Data: pubkey}
 *   3. Identity multihash (0x00) of the protobuf bytes
 *   4. Base58btc encode (no multibase prefix)
 *
 * Used by infra/deploy.sh to populate SSM /cello/{env}/relay/peer-id when the
 * parameter doesn't already exist, so the node registry has stable peer IDs
 * for relay DNS multiaddrs.
 *
 * Usage:
 *   printf '%s' "<transportKeyHex>" | node infra/scripts/derive-peerid-from-transport-key.js
 *
 * The key is NEVER passed as a CLI argument to prevent exposure via ps(1),
 * shell history, or /proc/[pid]/cmdline (SI-001).
 *
 * Output:
 *   Peer ID string (e.g. 12D3KooWAbCdEf...) to stdout
 *   Exits 0 on success, non-zero on error.
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

// Resolve @noble/curves from pnpm node_modules (handles workspace symlinks).
// Find the package in the pnpm store by scanning for @noble+curves@* directories.
const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
let curvesDir;
try {
  const entries = readdirSync(pnpmDir);
  const match = entries.find(e => e.startsWith("@noble+curves@"));
  if (match) {
    curvesDir = join(pnpmDir, match, "node_modules", "@noble", "curves");
  }
} catch {
  // Fall back to standard resolution below
}

if (!curvesDir) {
  process.stderr.write("ERROR: Cannot find @noble/curves in node_modules/.pnpm/\n");
  process.stderr.write("Run 'pnpm install' from the repository root.\n");
  process.exit(1);
}

const { ed25519 } = await import(join(curvesDir, "ed25519.js"));

// Base58btc alphabet (same as Bitcoin)
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btcEncode(bytes) {
  // Count leading zeros
  let zeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeros++;

  // Convert to base58
  const result = [];
  let num = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  while (num > 0n) {
    const remainder = num % 58n;
    num = num / 58n;
    result.unshift(BASE58_ALPHABET[Number(remainder)]);
  }

  // Add leading '1's for each leading zero byte
  for (let i = 0; i < zeros; i++) {
    result.unshift("1");
  }

  return result.join("");
}

// Read transport key from stdin
const transportKeyHex = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
  process.stdin.on("error", reject);
});

if (!transportKeyHex) {
  process.stderr.write("Usage: printf '%s' <transportKeyHex> | node derive-peerid-from-transport-key.js\n");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(transportKeyHex)) {
  process.stderr.write("ERROR: transportKeyHex must be a 64-character hex string (32 bytes)\n");
  process.exit(1);
}

try {
  // 1. Derive Ed25519 public key from seed (RFC 8032)
  const seed = Buffer.from(transportKeyHex, "hex");
  const publicKey = ed25519.getPublicKey(seed);

  // 2. Protobuf-encode as libp2p public key
  // Protobuf schema: message PublicKey { KeyType Type = 1; bytes Data = 2; }
  // KeyType.Ed25519 = 1
  // Field 1 (Type), varint: tag=0x08, value=0x01
  // Field 2 (Data), length-delimited: tag=0x12, length=0x20 (32 bytes), data=pubkey
  const protobuf = Buffer.concat([
    Buffer.from([0x08, 0x01, 0x12, 0x20]),
    Buffer.from(publicKey),
  ]);

  // 3. Identity multihash: code=0x00, length=<varint of protobuf length>, data=protobuf
  // For Ed25519 keys (36 bytes protobuf), the identity multihash is used directly.
  const multihashBytes = Buffer.concat([
    Buffer.from([0x00, protobuf.length]),
    protobuf,
  ]);

  // 4. Base58btc encode (no multibase prefix — libp2p PeerId.toString() strips the 'z' prefix)
  const peerId = base58btcEncode(multihashBytes);

  process.stdout.write(peerId + "\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
