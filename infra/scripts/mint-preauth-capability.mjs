#!/usr/bin/env node
/**
 * mint-preauth-capability.mjs — issue ONE pre-authorization capability for the GCP consortium.
 *
 * A capability is a signed permission slip authorizing exactly one agent registration
 * (M8B-PREAUTH-CAP). Every directory verifies it independently and statelessly against the pinned
 * issuer key — no database lookup, nothing secret replicated between sovereign nodes.
 *
 * Normally the portal issues these. The portal runs on AWS, which is hibernated, so this mints one
 * directly with the consortium issuer key. It is the SAME artifact over the SAME canonical bytes —
 * the point is to exercise the real registration path rather than a version with the capability
 * check turned off, which would produce a test that passes for the wrong reason.
 *
 * Single-use is NOT enforced by the signature (a signature is inherently replayable). The directory
 * enforces it by binding the capability's `nonce` to the DKG epoch: one nonce, one agent.
 *
 * The issuer SEED is read from Secret Manager and never passed as an argument or printed.
 *
 * Usage:
 *   node infra/scripts/mint-preauth-capability.mjs [--email-domain example.com] [--ttl-minutes 60]
 *
 * Output: the base64url capability blob on stdout — paste into `cello register`.
 *
 * Crypto reference: RFC 8032 (Ed25519).
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function resolveNoble(root) {
  const candidates = [
    join(root, "packages", "directory", "node_modules", "@noble", "curves", "package.json"),
    join(root, "demo", "node_modules", "@noble", "curves", "package.json"),
    join(root, "node_modules", "@noble", "curves", "package.json"),
  ];
  for (const c of candidates) if (existsSync(c)) return createRequire(c);
  throw new Error("@noble/curves not found in:\n  " + candidates.join("\n  "));
}
const require = resolveNoble(repoRoot);
const { ed25519 } = await import(require.resolve("@noble/curves/ed25519.js"));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const PROJECT = process.env["CELLO_GCP_PROJECT"] ?? "cello-infra";
const emailDomain = arg("email-domain", "mygentic.ai");
const ttlMinutes = Number(arg("ttl-minutes", "60"));
if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) throw new Error("--ttl-minutes must be a positive number");

/** Sorts object keys at every level — the canonical form the directory re-derives to verify. */
function sortedReplacer(_k, v) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const s = {};
    for (const k of Object.keys(v).sort()) s[k] = v[k];
    return s;
  }
  return v;
}
function canonicalBody(cap) {
  const body = {};
  for (const k of Object.keys(cap)) if (k !== "sig") body[k] = cap[k];
  return new TextEncoder().encode(JSON.stringify(body, sortedReplacer));
}

const seedHex = execFileSync(
  "gcloud",
  ["secrets", "versions", "access", "latest", "--secret", "cello-consortium-preauth-issuer-key", "--project", PROJECT],
  { encoding: "utf8" },
).trim();
if (!/^[0-9a-f]{64}$/i.test(seedHex)) throw new Error("issuer seed is not 64-hex");
const seed = Buffer.from(seedHex, "hex");
const issuerPub = Buffer.from(ed25519.getPublicKey(seed)).toString("hex");

const now = new Date();
const body = {
  // 16 bytes, 32 lowercase hex. NOT a secret — it is the replay identity the directory binds to
  // the DKG epoch to make the capability single-use.
  nonce: randomBytes(16).toString("hex"),
  // SI-001: the raw stub never appears anywhere, only its SHA-256. A random one per capability, so
  // each mint authorizes a distinct agent rather than colliding on a shared binding datum.
  phone_stub_hash: createHash("sha256").update(randomBytes(32)).digest("hex"),
  email_domain: emailDomain,
  issued_at: now.toISOString(),
  expires_at: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
};

const cap = { ...body, sig: Buffer.from(ed25519.sign(canonicalBody(body), seed)).toString("hex") };

// Fail closed: never emit a capability this process cannot itself verify.
if (!ed25519.verify(Buffer.from(cap.sig, "hex"), canonicalBody(cap), Buffer.from(issuerPub, "hex"))) {
  throw new Error("self-verification FAILED — refusing to emit");
}

console.log(Buffer.from(JSON.stringify(cap), "utf8").toString("base64url"));
console.error(`# issuer ${issuerPub}`);
console.error(`# nonce ${cap.nonce} — one capability, one agent`);
console.error(`# expires ${cap.expires_at}`);
