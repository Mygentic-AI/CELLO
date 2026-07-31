#!/usr/bin/env node
/**
 * sign-gcp-consortium-manifest.mjs — build and sign the GCP consortium manifest
 * (M12 DOD-MANIFEST-GCP-1).
 *
 * The consortium manifest is the signed roster of directory nodes. Both sides of the protocol
 * depend on it: a directory derives its DKG quorum and threshold from it (so a tampered manifest
 * would steer which nodes hold shares and what T is), and a client bundles it so a cold-boot daemon
 * knows every directory and can fail over to a reachable one. The officer signature is what makes
 * either safe.
 *
 * The GCP counterpart of sign-consortium-manifest.mjs, which reads AWS SSM and Secrets Manager.
 * This one reads GCP Secret Manager and a FRESH officer key: M12-D4 requires the GCP and AWS
 * systems run in parallel with zero shared runtime state, and a shared officer key would mean a
 * manifest signed for one consortium verifies against the other.
 *
 * Node identities come from gcp-node-identities.sh, which derives them from the same Secret Manager
 * seeds the nodes themselves use — verified byte-identical to what each node logs for itself at
 * boot. Nothing here is hand-entered.
 *
 * Every node is role `validator`: replicas hold no shares and take no part in a ceremony, and this
 * consortium has none (M12-P4 leaves that capability dormant at launch).
 *
 * The officer SEED is read from Secret Manager and never passed as an argument or printed.
 *
 * Usage:  node infra/scripts/sign-gcp-consortium-manifest.mjs [--out <path>]
 *
 * Crypto reference: RFC 8032 (Ed25519). Canonical body: every field except `signatures`, object
 * keys sorted lexicographically at every level, no whitespace, UTF-8 — matching verifyManifest.
 */

import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function resolveNoble(root) {
  const candidates = [
    join(root, "packages", "directory", "node_modules", "@noble", "curves", "package.json"),
    join(root, "demo", "node_modules", "@noble", "curves", "package.json"),
    join(root, "packages", "relay", "node_modules", "@noble", "curves", "package.json"),
    join(root, "node_modules", "@noble", "curves", "package.json"),
  ];
  for (const c of candidates) if (existsSync(c)) return createRequire(c);
  throw new Error("@noble/curves not found in:\n  " + candidates.join("\n  "));
}
const require = resolveNoble(repoRoot);
const { ed25519 } = await import(require.resolve("@noble/curves/ed25519.js"));

const PROJECT = process.env["CELLO_GCP_PROJECT"] ?? "cello-infra";
const outIdx = process.argv.indexOf("--out");
const outPath = outIdx !== -1 ? process.argv[outIdx + 1] : null;

/** Canonical body: exclude `signatures`, sort keys recursively, no whitespace. */
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

// ── Inputs ───────────────────────────────────────────────────────────────────────────────────

const nodes = JSON.parse(
  execFileSync("bash", [join(__dirname, "gcp-node-identities.sh"), "--json"], { encoding: "utf8" }),
);
if (nodes.length === 0) throw new Error("no directory nodes found — check terraform.tfvars");

for (const n of nodes) {
  if (!/^[0-9a-f]{64}$/i.test(n.pubkey)) throw new Error(`${n.nodeId}: pubkey is not 32-byte hex`);
  if (!n.address) throw new Error(`${n.nodeId}: no static address — has terraform applied?`);
}
// A duplicate nodeId would put two manifest entries under one FROST identifier (DOD-INV-NODEID).
const ids = new Set(nodes.map((n) => n.nodeId));
if (ids.size !== nodes.length) throw new Error("duplicate nodeId in the roster");
// Two nodes sharing a signing key would let one host answer as two members of the quorum.
const keys = new Set(nodes.map((n) => n.pubkey.toLowerCase()));
if (keys.size !== nodes.length) throw new Error("two nodes share a signing pubkey — refusing to sign");

const officerSeedHex = execFileSync(
  "gcloud",
  ["secrets", "versions", "access", "latest", "--secret", "cello-consortium-officer-key-0", "--project", PROJECT],
  { encoding: "utf8" },
).trim();
if (!/^[0-9a-f]{64}$/i.test(officerSeedHex)) throw new Error("officer seed is not 64-hex");
const officerSeed = Buffer.from(officerSeedHex, "hex");
const officerPub = Buffer.from(ed25519.getPublicKey(officerSeed)).toString("hex");

// The PORTAL INTAKE KEY (M10B / DOD-END-INGRESS-1). A submitting daemon seals its trust-signal
// submission to this public key so the DIRECTORY cannot read the contents; with no intake key the
// client refuses with `intake_key_absent` rather than sending in the clear.
//
// It belongs in the manifest, not beside it: the manifest is what a cold-boot daemon has before it
// can reach any directory, and "your first submission fails until you have polled" is
// indistinguishable from the feature being broken. Being inside the signed body is also what stops
// an intake key being swapped for one an eavesdropper holds.
//
// Only the PUBLIC half is emitted. The secret is `<key_id>:<64-hex seed>`; the seed is derived from
// and never printed. This is deliberately the same key the AWS deployment used — clients already
// trust manifests naming it, and a fresh one would invalidate them.
const intakeSecret = execFileSync(
  "gcloud",
  ["secrets", "versions", "access", "latest", "--secret", "cello-portal-intake-key-0", "--project", PROJECT],
  { encoding: "utf8" },
).trim();
const [intakeKeyId, intakeSeedHex] = intakeSecret.split(":");
if (!intakeKeyId || !/^[0-9a-f]{64}$/i.test(intakeSeedHex ?? "")) {
  throw new Error("portal intake secret is not '<key_id>:<64-hex seed>'");
}
const intakePub = Buffer.from(ed25519.getPublicKey(Buffer.from(intakeSeedHex, "hex"))).toString("hex");

// ── Build ────────────────────────────────────────────────────────────────────────────────────

const manifest = {
  // 2, matching the shape that carries `intake_key`. Version 1 was this roster without it, which a
  // client accepts and then refuses every trust-signal submission against.
  version: 2,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2030-01-01T00:00:00Z",
  nodes: nodes.map((n) => ({
    nodeId: n.nodeId,
    pubkey: n.pubkey,
    region: n.nodeId.replace(/^gcp-/, ""),
    provider: "gcp",
    // The HTTP port (9090), NOT the libp2p WS port (8080). `endpoint` is the base a client GETs
    // /bootstrap from to learn the multiaddr and peer id; 8080 speaks the WS upgrade and answers
    // plain HTTP with 400, which resolves as zero reachable nodes from a valid manifest.
    // http, not https: no TLS terminator in front of these nodes yet, and an endpoint that lies is
    // worse than one that is plain.
    endpoint: `http://${n.address}:9090`,
    peerId: n.peerId,
    // The libp2p dial address, stated rather than inferred. `endpoint` is the HTTP base for
    // /bootstrap; on a node with no load balancer that is a DIFFERENT listener from the WebSocket
    // upgrade, so anything deriving a dial address from `endpoint` reaches the HTTP server and
    // fails — which is exactly how anti-entropy broke when the endpoint moved to 9090 for
    // /bootstrap. Two consumers, two ports, so the manifest carries both.
    multiaddr: `/ip4/${n.address}/tcp/8080/ws`,
    role: "validator",
  })),
  intake_key: { key_id: intakeKeyId, pubkey: intakePub },
  signatures: [],
};

manifest.signatures = [
  { officerIndex: 0, signature: Buffer.from(ed25519.sign(canonicalBody(manifest), officerSeed)).toString("hex") },
];

// Fail closed: never emit a manifest this process cannot itself verify.
if (!ed25519.verify(Buffer.from(manifest.signatures[0].signature, "hex"), canonicalBody(manifest), Buffer.from(officerPub, "hex"))) {
  throw new Error("self-verification FAILED — refusing to emit");
}

const json = JSON.stringify(manifest, null, 2);
if (outPath) {
  writeFileSync(outPath, json + "\n");
  console.error(`wrote ${outPath}`);
} else {
  console.log(json);
}

console.error(`# ${nodes.length} validators, officer pubkey ${officerPub}, threshold 1`);
console.error(`# CELLO_CONSORTIUM_ROOT_KEYS=${officerPub}`);
console.error(`# T = majority(validators) = ${Math.floor(nodes.length / 2) + 1}`);
