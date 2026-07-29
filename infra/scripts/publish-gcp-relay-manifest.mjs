#!/usr/bin/env node
/**
 * publish-gcp-relay-manifest.mjs — build, sign and upload the relay pool manifest for every GCP
 * directory node (M12, on the path to DOD-E2E-GCP-1).
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────────────────────
 * A directory will not broker a session without a relay pool. With no manifest in its bucket every
 * node logs `relay.manifest.load.failed` → `relay.manifest.not_found`, then issues session
 * assignments carrying no `relay_endpoint`. The CLIENT requires that field
 * (session-assignment-parser: `if (!relayEndpoint) return null`), so it rejects the assignment with
 * `assignment_parse_failed` — while the directory logs `fullyEstablished: true`. A missing object in
 * a bucket surfaces as a client-side parse bug three hops away.
 *
 * ─── One manifest PER NODE, signed by that node's OWN key ────────────────────────────────────
 * `RELAY_MANIFEST_SIGNER_PUBKEY` is deliberately unset on these nodes, so `resolveRelayManifestSigner`
 * falls back to each node's own directory pubkey — each node verifies the manifest against ITSELF.
 * That is the sovereign-node property doing its job: no node accepts a relay roster because some
 * other node signed it. So this writes N manifests, each signed by a different key, into N buckets.
 * A single shared manifest CANNOT work here, and making one work would mean giving every node a
 * common signer — i.e. deleting the property on purpose.
 *
 * Node and relay SEEDS are read from Secret Manager and piped straight into the derivers; they are
 * never passed as arguments (SI-001 — argv is visible via ps(1) and /proc) and never printed.
 *
 * Usage:
 *   node infra/scripts/publish-gcp-relay-manifest.mjs [--dry-run] [--version N]
 *
 * Crypto reference: RFC 8032 (Ed25519). Signed payload = canonical JSON of
 * { version, updatedAt, relays } — sorted keys, no whitespace, UTF-8; `signedBy`/`signature`
 * EXCLUDED (relay-pool-manager.ts).
 */

import { createRequire } from "node:module";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function resolveNoble(root) {
  const candidates = [
    join(root, "packages", "directory", "node_modules", "@noble", "curves", "package.json"),
    join(root, "packages", "relay", "node_modules", "@noble", "curves", "package.json"),
    join(root, "node_modules", "@noble", "curves", "package.json"),
  ];
  for (const c of candidates) if (existsSync(c)) return createRequire(c);
  throw new Error("@noble/curves not found in:\n  " + candidates.join("\n  "));
}
const require = resolveNoble(repoRoot);
const { ed25519 } = await import(require.resolve("@noble/curves/ed25519.js"));

const PROJECT = process.env["CELLO_GCP_PROJECT"] ?? "cello-infra";
const DRY_RUN = process.argv.includes("--dry-run");
const verIdx = process.argv.indexOf("--version");
const VERSION = verIdx !== -1 ? Number(process.argv[verIdx + 1]) : 2;
if (!Number.isInteger(VERSION) || VERSION < 1) throw new Error("--version must be a positive integer");

/**
 * Canonical JSON — must match `buildCanonicalPayload` in relay-pool-manager.ts EXACTLY:
 * TOP-LEVEL KEYS ONLY are sorted (relays, updatedAt, version); relay entry fields keep the order
 * they appear in the stored JSON. A DEEP sort looks more "canonical" and is wrong — it produces a
 * different byte string, so every node rejects the manifest with signature_verification_failed.
 * That is not a soft failure: the directory treats a bad signature as fatal and exits 1, so a
 * wrongly-canonicalised manifest CRASH-LOOPS the fleet.
 *
 * Relay entry key order round-trips because JSON.parse preserves insertion order from the file.
 */
const canonical = (body) => {
  const sorted = Object.fromEntries(Object.keys(body).sort().map((k) => [k, body[k]]));
  return new TextEncoder().encode(JSON.stringify(sorted));
};

const gcloud = (args) => execFileSync("gcloud", [...args, "--project", PROJECT], { encoding: "utf8" }).trim();

/** Read a secret and pipe it straight into a deriver — the seed never lands in a variable. */
function derive(secret, deriver) {
  const seed = execFileSync("gcloud", ["secrets", "versions", "access", "latest", "--secret", secret, "--project", PROJECT], { encoding: "utf8" });
  return execFileSync("node", [join(__dirname, deriver)], { input: seed, encoding: "utf8" }).trim();
}

// ── The relay ────────────────────────────────────────────────────────────────────────────────

const RELAY_ID = "gcp-relay-use1";
const relayPubkey = derive(`cello-${RELAY_ID}-node-key`, "derive-pubkey.js");
const relayPeerId = derive(`cello-${RELAY_ID}-transport-key`, "derive-peerid-from-transport-key.js");
const relayPublicIp = gcloud(["compute", "addresses", "describe", `cello-${RELAY_ID}`, "--region", "us-east1", "--format=value(address)"]);
// The health check is VPC-INTERNAL: the directory pings the relay's PRIVATE ip (see
// cello-relay-allow-health-internal). The public address is firewalled to Google's probers only, so
// a public healthCheckUrl marks every relay unavailable and empties the pool.
const relayPrivateIp = gcloud([
  "compute", "instances", "list", "--filter", `name~^cello-${RELAY_ID}`,
  "--format=value(networkInterfaces[0].networkIP)",
]).split("\n")[0].trim();

if (!/^[0-9a-f]{64}$/i.test(relayPubkey)) throw new Error("relay pubkey is not 32-byte hex");
if (!relayPeerId.startsWith("12D3Koo")) throw new Error(`unexpected relay peer id: ${relayPeerId}`);
if (!relayPublicIp) throw new Error("relay has no static address — has terraform applied?");
if (!relayPrivateIp) throw new Error("relay instance not found / has no internal IP");

const relays = [
  {
    relayId: relayPubkey,
    // ws, not wss: there is no TLS terminator in front of these nodes yet. An endpoint that lies
    // is worse than one that is plain — a wss URL here fails the upgrade with no useful error.
    endpoint: `ws://${relayPublicIp}:4001`,
    region: "us-east1",
    status: "active",
    healthCheckUrl: `http://${relayPrivateIp}:4000/health`,
    peerId: relayPeerId,
    multiaddrs: [`/ip4/${relayPublicIp}/tcp/4001/ws/p2p/${relayPeerId}`],
  },
];

// ── Directory nodes ──────────────────────────────────────────────────────────────────────────

const nodes = JSON.parse(execFileSync("bash", [join(__dirname, "gcp-node-identities.sh"), "--json"], { encoding: "utf8" }));
if (nodes.length === 0) throw new Error("no directory nodes found — check terraform.tfvars");

const updatedAt = new Date().toISOString();
let published = 0;

for (const node of nodes) {
  const body = { version: VERSION, updatedAt, relays };
  const payload = canonical(body);

  // Sign with THIS node's key. Read + sign in a child process so the seed never enters this one.
  const sigHex = execFileSync(
    "node",
    ["-e", `
      const {execFileSync}=require('node:child_process');
      const seed=execFileSync('gcloud',['secrets','versions','access','latest','--secret',process.argv[1],'--project',process.argv[2]],{encoding:'utf8'}).trim();
      if(!/^[0-9a-f]{64}$/i.test(seed)) throw new Error('node seed is not 64-hex');
      const {ed25519}=require(process.argv[4]);
      const sig=ed25519.sign(Buffer.from(process.argv[3],'base64'),Buffer.from(seed,'hex'));
      process.stdout.write(Buffer.from(sig).toString('hex'));
    `, `cello-${node.nodeId}-node-key`, PROJECT, Buffer.from(payload).toString("base64"), require.resolve("@noble/curves/ed25519.js")],
    { encoding: "utf8" },
  ).trim();

  // Fail closed: never upload a manifest this process cannot itself verify against the key the
  // NODE will use (its own directory pubkey — resolveRelayManifestSigner's fallback).
  if (!ed25519.verify(Buffer.from(sigHex, "hex"), payload, Buffer.from(node.pubkey, "hex"))) {
    throw new Error(`${node.nodeId}: self-verification FAILED — refusing to upload`);
  }

  const manifest = { ...body, signedBy: node.nodeId, signature: sigHex };
  const bucket = `cello-relay-manifest-${node.nodeId}`;
  const json = JSON.stringify(manifest, null, 2);

  if (DRY_RUN) {
    console.error(`# [dry-run] ${bucket}/relay-manifest.json  signedBy=${node.nodeId} relays=${relays.length}`);
    continue;
  }

  const tmp = join(tmpdir(), `relay-manifest-${node.nodeId}.json`);
  writeFileSync(tmp, json + "\n");
  try {
    execFileSync("gcloud", ["storage", "cp", tmp, `gs://${bucket}/relay-manifest.json`, "--project", PROJECT], { stdio: "inherit" });
    published++;
    console.error(`# uploaded gs://${bucket}/relay-manifest.json (signedBy ${node.nodeId})`);
  } finally {
    unlinkSync(tmp);
  }
}

console.error(`# version ${VERSION}, ${relays.length} relay(s), ${DRY_RUN ? nodes.length + " previewed" : published + " published"}`);
console.error(`# relay ${RELAY_ID} peerId ${relayPeerId}`);
console.error(`# health ${relays[0].healthCheckUrl} (VPC-internal), dial ${relays[0].multiaddrs[0]}`);
