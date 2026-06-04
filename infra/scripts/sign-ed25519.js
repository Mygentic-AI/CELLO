#!/usr/bin/env node
/**
 * sign-ed25519.js — Ed25519 signing utility for CELLO relay pool manifest (CELLO-RELAY-001).
 *
 * Reads the 32-byte hex private key from stdin and takes the UTF-8 message string
 * as the sole positional argument. The key is NEVER passed as a CLI argument to prevent
 * exposure via ps(1), shell history, or /proc/[pid]/cmdline (SI-001).
 *
 * Outputs the Ed25519 signature as a lowercase hex string to stdout.
 * Used by infra/sign-manifest.sh to sign the relay pool manifest.
 *
 * Deterministic: given the same private key and message, always produces the same signature.
 * Ed25519 is inherently deterministic per RFC 8032 §5.1 — no random nonce required.
 *
 * Usage:
 *   printf '%s' "<privateKeyHex>" | node infra/scripts/sign-ed25519.js <message>
 *
 * Arguments (stdin):
 *   privateKeyHex  32-byte Ed25519 private key seed as a 64-character lowercase hex string
 *
 * Arguments (positional):
 *   message        UTF-8 message string to sign
 *
 * Output:
 *   128-character lowercase hex string (64-byte signature) to stdout
 *   Exits 0 on success, non-zero on error.
 *
 * RFC 8032: Ed25519 signing algorithm (deterministic variant).
 * Uses @noble/curves/ed25519 — pure-JS, audited, same library used throughout CELLO.
 *
 * Example:
 *   printf '%s' "2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a" | \
 *   node infra/scripts/sign-ed25519.js \
 *     '{"version":1,"updatedAt":"2026-05-23T12:00:00Z","relays":[]}'
 */

// Resolve @noble/curves from packages/crypto which declares it as a dependency.
// The infra/scripts/ directory does not have its own package.json, so we must
// resolve the module from a package that depends on it.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Walk up from infra/scripts/ to repo root, then into packages/crypto/node_modules
const repoRoot = join(__dirname, "..", "..");
const require = createRequire(join(repoRoot, "packages", "crypto", "package.json"));

// Dynamic import using the resolved path so ESM honours it correctly
const curvesPath = require.resolve("@noble/curves/ed25519.js");
const { ed25519 } = await import(curvesPath);

// argv[2] is the message; private key is read from stdin (never a CLI arg — SI-001).
const [, , message] = process.argv;

if (!message) {
  process.stderr.write("Usage: printf '%s' <privateKeyHex> | node sign-ed25519.js <message>\n");
  process.exit(1);
}

// Read private key from stdin using event-based pattern (compatible with execFile input option)
const privateKeyHex = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
  process.stdin.on("error", reject);
});

if (!privateKeyHex) {
  process.stderr.write("ERROR: private key must be provided via stdin\n");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
  process.stderr.write("ERROR: privateKeyHex must be a 64-character hex string (32 bytes)\n");
  process.exit(1);
}

try {
  const privateKeyBytes = Buffer.from(privateKeyHex, "hex");
  const messageBytes = new TextEncoder().encode(message);

  // RFC 8032 §5.1: Ed25519 signing (deterministic — same inputs always produce same output)
  const signature = ed25519.sign(messageBytes, privateKeyBytes);

  process.stdout.write(Buffer.from(signature).toString("hex") + "\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
