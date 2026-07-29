#!/usr/bin/env node
/**
 * sign-consortium-manifest.mjs — build + sign the CELLO consortium manifest (FINDING-4).
 *
 * The consortium manifest is the signed roster of sovereign directory nodes that the CLIENT bundles
 * (cello-client core/daemon/src/bundled-consortium-manifest.ts) so a cold-boot daemon knows every
 * directory and can fail over to a reachable one when its primary is down — the sovereign-node
 * REDUNDANCY invariant. The node `pubkey`s are also the trust anchor for step-6 directory identity
 * auth. This script regenerates that manifest reproducibly from live AWS state on node/officer key
 * rotation, so the bundled constant is never a hand-edited one-off.
 *
 * Reads (never takes key material on argv — SI-001):
 *   - Officer signing seed:  Secrets Manager  cello/{env}/consortium/officer-key-0  (32-byte hex)
 *   - Per-region node pubkey: SSM  /cello/{env}/directory/manifest-signer-pubkey   (per region)
 *   - Per-region hostname:    SSM  /cello/{env}/directory/hostname                 (per region)
 *   - Per-region PeerId:      SSM  /cello/{env}/directory/peer-id                  (per region)
 *
 * M12 §1a: every node entry carries `role` ("validator" — replicas are added by hand when one
 * exists) and `peerId` (promoted from unsigned SSM into the SIGNED manifest, so the officer
 * signature covers the dial identity end-to-end; the AE handshake channel-binds against it).
 *
 * Emits (stdout): the signed manifest JSON, the officer PUBLIC key, and a ready-to-paste TS block
 * for bundled-consortium-manifest.ts. Verifies its own signature before printing.
 *
 * Usage:  node infra/scripts/sign-consortium-manifest.mjs <env> [region,region,...] [version]
 *         (default regions: us-east-1,eu-central-1,ap-northeast-1; default version 2 — the
 *          role+peerId schema. Always bump past the currently-deployed version: both the client
 *          and the directory refuse rollbacks.)
 *
 * Crypto reference: RFC 8032 (Ed25519). Canonical body: all fields except `signatures`, object keys
 * sorted lexicographically at every level, no whitespace, UTF-8 — matches verifyManifest.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
// @noble/curves lives in whichever workspace package happens to have installed it. Hardcoding
// demo/node_modules made these scripts work only in a checkout where demo/ deps were installed —
// they threw MODULE_NOT_FOUND in any git worktree, which is where infra work actually happens.
// Try the known homes in order and fail naming all of them.
function resolveNoble(repoRoot) {
  const candidates = [
    join(repoRoot, "demo", "node_modules", "@noble", "curves", "package.json"),
    join(repoRoot, "packages", "directory", "node_modules", "@noble", "curves", "package.json"),
    join(repoRoot, "packages", "relay", "node_modules", "@noble", "curves", "package.json"),
    join(repoRoot, "node_modules", "@noble", "curves", "package.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return createRequire(c);
  }
  throw new Error(
    "@noble/curves not found. Looked in:\n  " + candidates.join("\n  ") +
    "\nRun `pnpm install` in this checkout.",
  );
}
const require = resolveNoble(repoRoot);
const { ed25519 } = await import(require.resolve("@noble/curves/ed25519.js"));

const env = process.argv[2] || "dev";
const regions = (process.argv[3] || "us-east-1,eu-central-1,ap-northeast-1").split(",").map((r) => r.trim());
const version = Number.parseInt(process.argv[4] || "2", 10);
if (!Number.isInteger(version) || version < 1) {
  console.error(`invalid manifest version '${process.argv[4]}'`);
  process.exit(1);
}

function aws(args) {
  return execFileSync("aws", args, { encoding: "utf8" }).trim();
}
function ssm(name, region) {
  return aws(["ssm", "get-parameter", "--name", name, "--region", region, "--query", "Parameter.Value", "--output", "text"]);
}
/**
 * An SSM lookup for a parameter that may legitimately not exist yet.
 *
 * `ssm()` cannot be used for this: `aws()` is execFileSync, which THROWS on a non-zero exit, and
 * `get-parameter` exits non-zero with ParameterNotFound. So an optional lookup written with `ssm()`
 * does not return empty — it crashes the whole signer, breaking manifest signing for every
 * environment that has not set the parameter.
 *
 * Only absence is swallowed. Any other failure (no credentials, wrong region, denied) must still
 * blow up: silently emitting a manifest because the operator's session expired would be the
 * fail-open direction on a signed document.
 */
function ssmOptional(name, region) {
  try {
    return ssm(name, region);
  } catch (err) {
    const text = `${err?.stderr ?? ""}${err?.message ?? ""}`;
    if (text.includes("ParameterNotFound")) return null;
    throw err;
  }
}
function subdomain(region) {
  return { "us-east-1": "directory-us1", "eu-central-1": "directory-eu1", "ap-northeast-1": "directory-ap1" }[region]
    ?? `directory-${region}`;
}

// Canonical body: exclude `signatures`, sort keys recursively, no whitespace (matches verifyManifest).
function sortedReplacer(_k, v) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const s = {};
    for (const k of Object.keys(v).sort()) s[k] = v[k];
    return s;
  }
  return v;
}
function canonicalBody(m) {
  const body = {};
  for (const k of Object.keys(m)) if (k !== "signatures") body[k] = m[k];
  return new TextEncoder().encode(JSON.stringify(body, sortedReplacer));
}

// Officer seed from Secrets Manager (single dev officer, threshold 1).
const officerSeedHex = aws([
  "secretsmanager", "get-secret-value",
  "--secret-id", `cello/${env}/consortium/officer-key-0`,
  "--region", "us-east-1", "--query", "SecretString", "--output", "text",
]);
if (!/^[0-9a-f]{64}$/i.test(officerSeedHex)) {
  console.error(`officer seed for ${env} is not 64-hex`);
  process.exit(1);
}
const officerSeed = Buffer.from(officerSeedHex, "hex");
const officerPub = Buffer.from(ed25519.getPublicKey(officerSeed)).toString("hex");

const nodes = regions.map((region) => {
  const pubkey = ssm("/cello/" + env + "/directory/manifest-signer-pubkey", region);
  const hostname = ssm("/cello/" + env + "/directory/hostname", region);
  // M12 §1a: the signed manifest pins the dial identity. A missing/garbage peer-id param must fail
  // the signing run, not emit a manifest the AE handshake can never channel-bind against.
  const peerId = ssm("/cello/" + env + "/directory/peer-id", region);
  if (!/^12D3Koo[1-9A-HJ-NP-Za-km-z]{20,}$/.test(peerId)) {
    console.error(`peer-id for ${region} ('${peerId}') is not a libp2p Ed25519 PeerId — refusing to sign`);
    process.exit(1);
  }
  return {
    nodeId: region,
    pubkey,
    region,
    provider: "aws",
    endpoint: `http://${hostname || subdomain(region) + ".cello.mygentic.ai"}`,
    role: "validator",
    peerId,
  };
});

// M10B-D11 — the PORTAL INTAKE KEY, read from SSM like every other cross-region fact here.
//
// Clients seal endorsement submissions to this key, and the daemon REFUSES to submit without it —
// it never falls back to sending unsealed, because an unsealed submission hands the directory every
// endorsement in the clear. So a manifest emitted without this makes the endorsement flow
// permanently-refusing rather than broken-looking, which is the safe direction but is invisible
// unless you know to look. It is OPTIONAL here on purpose: omitting the parameter is a legitimate
// state (the portal has not published a key yet), and emitting a placeholder would be worse — a
// substituted or bogus sealing key means submissions are sealed to something nobody can open, and
// they arrive at the portal as unattributable poison with no reply possible.
//
// Signature coverage is automatic: canonicalBody builds from Object.keys minus signatures, so a new
// top-level field is inside the officer signature with no format change, and manifests emitted
// before this still verify byte-for-byte.
const intakeKeyId = ssmOptional("/cello/" + env + "/portal/intake-key-id", regions[0]);
const intakeKeyPub = ssmOptional("/cello/" + env + "/portal/intake-key-pubkey", regions[0]);
if ((intakeKeyId && !intakeKeyPub) || (!intakeKeyId && intakeKeyPub)) {
  // Half-configured is never emitted: a key_id with no pubkey cannot seal, and a pubkey with no
  // key_id breaks the rotation retention that keeps queued submissions from being stranded.
  console.error("portal intake key is HALF-configured (need both intake-key-id and intake-key-pubkey) — refusing to emit");
  process.exit(1);
}
if (intakeKeyPub && !/^[0-9a-f]{64}$/.test(intakeKeyPub)) {
  console.error(`portal intake-key-pubkey must be 64 lowercase hex chars, got ${JSON.stringify(intakeKeyPub)} — refusing to emit`);
  process.exit(1);
}

const manifest = {
  version,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2030-01-01T00:00:00Z",
  nodes,
  // Spread-if-present, never an explicit undefined — that would appear in Object.keys and change the
  // signed body, so a manifest without a key would stop matching one emitted before this change.
  ...(intakeKeyId && intakeKeyPub ? { intake_key: { key_id: intakeKeyId, pubkey: intakeKeyPub } } : {}),
  signatures: [],
};
manifest.signatures = [{ officerIndex: 0, signature: Buffer.from(ed25519.sign(canonicalBody(manifest), officerSeed)).toString("hex") }];

// Self-verify before emitting (fail closed).
if (!ed25519.verify(Buffer.from(manifest.signatures[0].signature, "hex"), canonicalBody(manifest), Buffer.from(officerPub, "hex"))) {
  console.error("self-verification FAILED — refusing to emit");
  process.exit(1);
}

console.error(`# signed consortium manifest for env=${env}, ${nodes.length} nodes, officer pubkey ${officerPub}`);
console.log(JSON.stringify(manifest, null, 2));
console.error("\n# --- paste into cello-client core/daemon/src/bundled-consortium-manifest.ts ---");
console.error(`# BUNDLED_CONSORTIUM_ROOT_KEYS = ["${officerPub}"]  (threshold 1)`);
