#!/usr/bin/env node
/**
 * derive-pubkey.js — Derive Ed25519 public key from a private key hex (CELLO-RELAY-001).
 *
 * Takes a 32-byte hex private key as argv[1] and prints the public key hex to stdout.
 * Used by infra/sign-manifest.sh to derive the signedBy field.
 *
 * Usage:
 *   node infra/scripts/derive-pubkey.js <privateKeyHex>
 *
 * Arguments:
 *   privateKeyHex  32-byte Ed25519 private key seed as a 64-character lowercase hex string
 *
 * Output:
 *   64-character lowercase hex string (32-byte public key) to stdout
 *   Exits 0 on success, non-zero on error.
 *
 * RFC 8032: Ed25519 public key derivation.
 * Uses @noble/curves/ed25519 — pure-JS, audited, same library used throughout CELLO.
 */

// Resolve @noble/curves from packages/crypto which declares it as a dependency.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const require = createRequire(join(repoRoot, "packages", "crypto", "package.json"));

const curvesPath = require.resolve("@noble/curves/ed25519.js");
const { ed25519 } = await import(curvesPath);

const [, , privateKeyHex] = process.argv;

if (!privateKeyHex) {
  process.stderr.write("Usage: node derive-pubkey.js <privateKeyHex>\n");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
  process.stderr.write("ERROR: privateKeyHex must be a 64-character hex string (32 bytes)\n");
  process.exit(1);
}

try {
  const privateKeyBytes = Buffer.from(privateKeyHex, "hex");
  const publicKey = ed25519.getPublicKey(privateKeyBytes);
  process.stdout.write(Buffer.from(publicKey).toString("hex") + "\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
