/**
 * J-AUTH self-contained consortium-manifest generator (M7 DOD-AUTH-1/2).
 *
 * The published @cello-protocol/crypto@0.0.7 that this package resolves predates the
 * manifest test fixtures (makeTestManifest / TEST_* are only in the cello-client
 * workspace source). The live daemon BINARY the harness spawns IS built from that
 * workspace and so has the real verifyManifest + FileManifestProvider — but the
 * harness itself cannot import the fixtures. Rather than push/publish a new crypto
 * (forbidden here), this module reproduces the fixture logic byte-for-byte using
 * @noble/curves directly:
 *
 *   - canonicalManifestBody — identical to core/crypto/src/manifest.ts: drop
 *     `signatures`, sort object keys lexicographically at every level, JSON.stringify
 *     with no whitespace, UTF-8 encode. This MUST match the daemon's verifier exactly
 *     or every signature fails.
 *   - makeSignedManifest — identical to makeTestManifest: officers 0,1,2 sign the
 *     canonical body (threshold 3), deterministic seeds 0x01..0x05.
 *   - the directory node keypair — the same deterministic values the crypto fixture
 *     exports as TEST_DIRECTORY_NODE_KEYPAIR.
 *
 * The harness is the single source of truth for BOTH the manifest signatures AND the
 * root keys it hands the daemon (CELLO_CONSORTIUM_ROOT_KEYS), so it is internally
 * consistent regardless of the published crypto version.
 *
 * Crypto reference: RFC 8032 (Ed25519).
 */
import { ed25519 } from "@noble/curves/ed25519.js";

export interface ConsortiumNodeEntry {
  nodeId: string;
  pubkey: string;
  region: string;
  provider: "aws" | "gcp" | "azure";
  endpoint: string;
}

export interface SignedManifest {
  version: number;
  not_before: string;
  expires: string;
  nodes: ConsortiumNodeEntry[];
  signatures: { officerIndex: number; signature: string }[];
}

export interface MakeManifestOpts {
  version?: number;
  notBefore?: string;
  expires?: string;
}

// Deterministic officer seeds — identical to core/crypto manifest-test-fixture.ts.
const OFFICER_SEEDS: readonly Uint8Array[] = [
  new Uint8Array(32).fill(0x01),
  new Uint8Array(32).fill(0x02),
  new Uint8Array(32).fill(0x03),
  new Uint8Array(32).fill(0x04),
  new Uint8Array(32).fill(0x05),
];

/** Officer ROOT public keys (hex) — what the daemon verifies the manifest against. */
export const CONSORTIUM_ROOT_KEYS: readonly string[] = OFFICER_SEEDS.map((s) =>
  Buffer.from(ed25519.getPublicKey(s)).toString("hex"),
);
export const CONSORTIUM_THRESHOLD = 3;

// Directory per-node signing keypair — identical to TEST_DIRECTORY_NODE_KEYPAIR.
export const DIRECTORY_NODE_PRIVATE_KEY_HEX =
  "707a125efaed6d467e8cac1758b3a87af260a5b9c7a6f0d6a74d364c1d5dacd9";
export const DIRECTORY_NODE_PUBLIC_KEY_HEX =
  "b93092dd6bf675c00a895abc05503dfd1214a170a2d945d97bab81fd5cfe6a1b";

/**
 * JSON.stringify replacer that sorts object keys lexicographically at every level.
 * Arrays preserve their order. Byte-identical to core/crypto/src/manifest.ts.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/** Canonical signing bytes for a manifest body — must match the daemon's verifier. */
function canonicalBody(manifest: Omit<SignedManifest, "signatures">): Uint8Array {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(manifest)) {
    if (key !== "signatures") body[key] = (manifest as Record<string, unknown>)[key];
  }
  return new TextEncoder().encode(JSON.stringify(body, sortedReplacer));
}

/**
 * Produce a threshold-signed consortium manifest (officers 0,1,2 — threshold 3).
 * Defaults give a manifest valid for all of 2026; override `expires` (a past ISO
 * timestamp) for the expiry case, or `version` for the rollback case.
 */
export function makeSignedManifest(nodes: ConsortiumNodeEntry[], opts?: MakeManifestOpts): SignedManifest {
  const base = {
    version: opts?.version ?? 1,
    not_before: opts?.notBefore ?? "2026-01-01T00:00:00Z",
    expires: opts?.expires ?? "2027-01-01T00:00:00Z",
    nodes,
  };
  const body = canonicalBody(base);
  const signatures = [0, 1, 2].map((idx) => ({
    officerIndex: idx,
    signature: Buffer.from(ed25519.sign(body, OFFICER_SEEDS[idx]!)).toString("hex"),
  }));
  return { ...base, signatures };
}
