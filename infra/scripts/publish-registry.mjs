#!/usr/bin/env node
/**
 * publish-registry.mjs — generate (or load) the registry signer key, enrol it in
 * authorized_issuers, build + sign the type registry document, and publish it to
 * the directory via POST /internal/signal/registry-publish.
 *
 * The registry document is canonical JSON with an Ed25519 signature — exactly what
 * the daemon's registry poller (registry-poll.ts) expects. The OUTER submission to
 * the directory is CBOR-wrapped and signed with the same key (role `registry`).
 *
 * Usage:  node infra/scripts/publish-registry.mjs [dev] [--enrol] [--seed <hex>]
 *   --enrol   Also INSERT the pubkey into authorized_issuers (first-time setup)
 *   --seed    Use this 32-byte hex seed instead of generating / reading from SM
 *
 * Environment:
 *   DIRECTORY_URL  Override the directory ALB (default: http://directory-us1.cello.mygentic.ai)
 *
 * Reads: Secrets Manager cello/{env}/registry/signer-key (32-byte hex seed)
 * Writes: if --enrol, INSERTs into authorized_issuers on us-east-1 via ECS exec
 */

import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const require = createRequire(join(repoRoot, "demo", "node_modules", "@noble", "curves", "package.json"));
const { ed25519 } = await import(require.resolve("@noble/curves/ed25519.js"));

// ── Args ────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const env = args.find(a => !a.startsWith("-")) || "dev";
const doEnrol = args.includes("--enrol");
const seedIdx = args.indexOf("--seed");
let seedHex = seedIdx >= 0 ? args[seedIdx + 1] : null;

const DIRECTORY_URL = process.env.DIRECTORY_URL || "http://directory-us1.cello.mygentic.ai";
const REGION = "us-east-1";
const SECRET_NAME = `cello/${env}/registry/signer-key`;
const SIGNAL_REQUEST_DOMAIN = "CELLO-TSIG-REQ-v1";

function aws(cmdArgs) {
  return execFileSync("aws", cmdArgs, { encoding: "utf8", timeout: 30_000 }).trim();
}

// ── Step 1: Get or create the registry signer seed ──────────────────────────────
if (!seedHex) {
  try {
    seedHex = aws([
      "secretsmanager", "get-secret-value",
      "--secret-id", SECRET_NAME, "--region", REGION,
      "--query", "SecretString", "--output", "text",
    ]);
    console.log(`✓ Loaded registry signer seed from ${SECRET_NAME}`);
  } catch {
    seedHex = randomBytes(32).toString("hex");
    console.log(`  Generating new registry signer seed...`);
    aws([
      "secretsmanager", "create-secret",
      "--name", SECRET_NAME, "--region", REGION,
      "--secret-string", seedHex,
      "--description", "Ed25519 seed for the M10 type registry signer (role=registry in authorized_issuers)",
    ]);
    console.log(`✓ Created ${SECRET_NAME} in Secrets Manager`);
  }
}

const seedBytes = new Uint8Array(Buffer.from(seedHex, "hex"));
const pubkeyBytes = ed25519.getPublicKey(seedBytes);
const pubkeyHex = Buffer.from(pubkeyBytes).toString("hex");
console.log(`  Registry signer pubkey: ${pubkeyHex}`);

// ── Step 2 (optional): Enrol in authorized_issuers ──────────────────────────────
if (doEnrol) {
  console.log(`\n  Enrolling pubkey in authorized_issuers (role=registry)...`);
  const sql = `INSERT INTO authorized_issuers (pubkey, role, status, label) VALUES ('${pubkeyHex}', 'registry', 'active', 'registry-signer-${env}') ON CONFLICT (pubkey) DO UPDATE SET role='registry', status='active'`;

  // Get DB connection string
  const connString = aws([
    "secretsmanager", "get-secret-value",
    "--secret-id", `cello/${env}/directory/rds-credentials`, "--region", REGION,
    "--query", "SecretString", "--output", "text",
  ]);
  const creds = JSON.parse(connString);
  const pw = encodeURIComponent(creds.password);
  const dbUrl = `postgresql://${creds.username}:${pw}@${creds.host}:${creds.port}/${creds.dbname}?sslmode=no-verify`;

  // Get a running directory task
  const taskArn = aws([
    "ecs", "list-tasks", "--cluster", "cello-dev",
    "--service-name", "cello-directory-dev", "--region", REGION,
    "--query", "taskArns[0]", "--output", "text",
  ]);
  const taskId = taskArn.split("/").pop();

  const nodeCmd = `const pg=require('/app/node_modules/.pnpm/pg@8.18.0/node_modules/pg');const p=new pg.Pool({connectionString:'${dbUrl}'});p.query(\`${sql}\`).then(r=>{console.log(JSON.stringify({rowCount:r.rowCount}));p.end()}).catch(e=>{console.error(e.message);p.end();process.exit(1)})`;

  try {
    const out = execFileSync("aws", [
      "ecs", "execute-command",
      "--cluster", "cello-dev", "--task", taskId,
      "--container", "directory", "--interactive",
      "--region", REGION,
      "--command", `node -e "${nodeCmd}"`,
    ], { encoding: "utf8", timeout: 30_000 });
    console.log(`✓ Enrolled: ${out.trim()}`);
  } catch (err) {
    // ECS exec often prints noise but succeeds
    if (err.stdout && err.stdout.includes("rowCount")) {
      console.log(`✓ Enrolled: ${err.stdout.trim()}`);
    } else {
      console.error(`✗ Enrolment failed:`, err.message);
      process.exit(1);
    }
  }
}

// ── Step 3: Build the registry document (canonical JSON + inner Ed25519 signature) ──
const TYPES = {
  "webauthn_passkey": {
    class: 1,
    label: "Passkey (WebAuthn)",
    lifecycle: "persistent",
    default_ttl_days: null,
  },
  "github_account": {
    class: 2,
    label: "GitHub Account",
    lifecycle: "persistent",
    default_ttl_days: null,
  },
  "track_record": {
    class: 3,
    label: "Track Record",
    lifecycle: "rolling",
    default_ttl_days: 90,
  },
  "totp_authenticator": {
    class: 1,
    label: "TOTP Authenticator",
    lifecycle: "persistent",
    default_ttl_days: null,
  },
  "email_verified": {
    class: 2,
    label: "Email Verified",
    lifecycle: "persistent",
    default_ttl_days: null,
  },
  "phone_verified": {
    class: 2,
    label: "Phone Verified",
    lifecycle: "persistent",
    default_ttl_days: null,
  },
};

const version = 1;
const registryDoc = { version, types: TYPES };

// Canonical JSON: sorted keys at every level
function sortedReplacer(_key, value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) sorted[k] = value[k];
    return sorted;
  }
  return value;
}

const canonicalJson = JSON.stringify(registryDoc, sortedReplacer);
const bodyBytes = new TextEncoder().encode(canonicalJson);

// Inner signature: Ed25519 over the canonical body bytes
const innerSig = ed25519.sign(bodyBytes, seedBytes);
const innerSigHex = Buffer.from(innerSig).toString("hex");

// The served document includes the signature field
const servedDoc = { ...registryDoc, signature: innerSigHex };
const servedJson = JSON.stringify(servedDoc, sortedReplacer);
const documentBytes = new TextEncoder().encode(servedJson);

console.log(`\n  Registry document (version ${version}, ${Object.keys(TYPES).length} types):`);
console.log(`  Inner signature: ${innerSigHex.slice(0, 32)}...`);

// Verify our own inner signature before proceeding
const verifySelf = ed25519.verify(innerSig, bodyBytes, pubkeyBytes);
if (!verifySelf) {
  console.error("✗ Self-verification of inner signature FAILED");
  process.exit(1);
}
console.log(`✓ Inner signature self-verified`);

// ── Step 4: Build the OUTER CBOR submission ─────────────────────────────────────
const cborPath = join(repoRoot, "demo", "node_modules", "cbor-x", "dist", "node.cjs");
const cbor = await import(cborPath);
const encodeCbor = cbor.encode || cbor.default?.encode;
if (!encodeCbor) {
  console.error("✗ Could not load cbor-x encoder");
  process.exit(1);
}

const nowSec = Math.floor(Date.now() / 1000);
const outerBody = { v: 1, op: "registry-publish", document: documentBytes, version, issued_at: nowSec };
const outerCbor = Buffer.from(encodeCbor(outerBody));

// Outer signature: Ed25519 over (SIGNAL_REQUEST_DOMAIN || SHA256(cborBody))
const cborDigest = createHash("sha256").update(outerCbor).digest();
const tbs = Buffer.concat([Buffer.from(SIGNAL_REQUEST_DOMAIN, "utf8"), cborDigest]);
const outerSig = ed25519.sign(tbs, seedBytes);
const outerSigHex = Buffer.from(outerSig).toString("hex");

console.log(`  Outer CBOR body: ${outerCbor.length} bytes`);
console.log(`  Outer signature: ${outerSigHex.slice(0, 32)}...`);

// ── Step 5: POST to the directory ───────────────────────────────────────────────
const publishUrl = `${DIRECTORY_URL}/internal/signal/registry-publish`;
console.log(`\n  Publishing to ${publishUrl}...`);

const resp = await fetch(publishUrl, {
  method: "POST",
  headers: {
    "content-type": "application/cbor",
    "x-cello-signer-pubkey": pubkeyHex,
    "x-cello-signature": outerSigHex,
  },
  body: outerCbor,
});

const respBody = await resp.text();
if (!resp.ok) {
  console.error(`✗ Publish FAILED (${resp.status}): ${respBody}`);
  process.exit(1);
}
console.log(`✓ Publish OK: ${respBody}`);

// ── Step 6: Verify GET /registry returns it ─────────────────────────────────────
console.log(`\n  Verifying GET ${DIRECTORY_URL}/registry...`);
const getResp = await fetch(`${DIRECTORY_URL}/registry`);
if (!getResp.ok) {
  console.error(`✗ GET /registry failed (${getResp.status})`);
  process.exit(1);
}
const served = await getResp.text();
const parsed = JSON.parse(served);
if (parsed.version !== version) {
  console.error(`✗ Version mismatch: expected ${version}, got ${parsed.version}`);
  process.exit(1);
}
if (parsed.signature !== innerSigHex) {
  console.error(`✗ Signature mismatch`);
  process.exit(1);
}
console.log(`✓ GET /registry returns version=${parsed.version}, ${Object.keys(parsed.types).length} types`);
console.log(`✓ Registry published and verified end-to-end`);

// Print the pubkey for wiring into the daemon
console.log(`\n══════════════════════════════════════════════════════════════`);
console.log(`REGISTRY SIGNER PUBKEY (wire into daemon config):`);
console.log(`  ${pubkeyHex}`);
console.log(`══════════════════════════════════════════════════════════════`);
