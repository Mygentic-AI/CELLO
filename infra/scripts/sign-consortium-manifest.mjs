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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
// Resolve @noble/curves the same way derive-pubkey.js does (via demo/ node_modules).
const require = createRequire(join(repoRoot, "demo", "node_modules", "@noble", "curves", "package.json"));
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

const manifest = {
  version,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2030-01-01T00:00:00Z",
  nodes,
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
