/**
 * @cello/test-fixtures — CELLO-TESTFIX-001
 *
 * Shared test-only infrastructure for @cello packages.
 * This package MUST NOT appear in `dependencies` or `peerDependencies` of any
 * production package — only in `devDependencies`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { createHash, createHmac, randomBytes } from "node:crypto";
import type {
  MlDsaKeyProvider,
  MlDsaVerifier,
  PseudonymBinding,
  Endorsement,
  Attestation,
  ValidatedEndorsement,
  ValidatedAttestation,
  PackageValidationResult,
  ConnectionPolicy,
} from "@cello/protocol-types";
import {
  ML_DSA_PUBKEY_BYTES,
  ML_DSA_SIGNATURE_BYTES,
} from "@cello/protocol-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function padToLength(src: Uint8Array, targetLen: number): Uint8Array {
  const out = new Uint8Array(targetLen);
  for (let i = 0; i < targetLen; i++) out[i] = src[i % src.length];
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function makeTestKey(label: string, len: number): Uint8Array {
  const hash = createHash("sha256").update(label).digest();
  return padToLength(hash, len);
}

// ─── FakeMlDsaKeyProvider ─────────────────────────────────────────────────────

/**
 * Deterministic fake ML-DSA-44 key provider for structural tests.
 *
 * sign(msg)      = HMAC-SHA256(seed, msg) padded to ML_DSA_SIGNATURE_BYTES (2420)
 * getPublicKey() = SHA-256(seed) padded to ML_DSA_PUBKEY_BYTES (1312)
 *
 * NOT cryptographically secure — tests only.
 */
export class FakeMlDsaKeyProvider implements MlDsaKeyProvider {
  readonly #seed: Uint8Array;

  constructor(seed?: Uint8Array) {
    this.#seed = seed ?? randomBytes(32);
  }

  async getPublicKey(): Promise<Uint8Array> {
    const hash = createHash("sha256").update(this.#seed).digest();
    return padToLength(hash, ML_DSA_PUBKEY_BYTES);
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const mac = createHmac("sha256", this.#seed).update(message).digest();
    return padToLength(mac, ML_DSA_SIGNATURE_BYTES);
  }

  getSeed(): Uint8Array {
    return this.#seed;
  }
}

// ─── FakeMultiVerifier ────────────────────────────────────────────────────────

/**
 * Verifier that supports multiple registered FakeMlDsaKeyProvider instances.
 * Maps pubkey hex → seed for multi-endorser structural tests.
 */
export class FakeMultiVerifier {
  readonly #map: Map<string, Uint8Array> = new Map();

  register(provider: FakeMlDsaKeyProvider, pubkey: Uint8Array): void {
    this.#map.set(Buffer.from(pubkey).toString("hex"), provider.getSeed());
  }

  asVerifier(): MlDsaVerifier {
    return (publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean => {
      const hex = Buffer.from(publicKey).toString("hex");
      const seed = this.#map.get(hex);
      if (!seed) return false;

      const expectedPubkey = padToLength(createHash("sha256").update(seed).digest(), ML_DSA_PUBKEY_BYTES);
      if (!bytesEqual(publicKey, expectedPubkey)) return false;

      const expectedSig = padToLength(createHmac("sha256", seed).update(message).digest(), ML_DSA_SIGNATURE_BYTES);
      return bytesEqual(signature, expectedSig);
    };
  }
}

// ─── PackageValidationResult factories ────────────────────────────────────────

interface BuildValidatedPackageOpts {
  endorsements?: number;
  pseudonymLabel?: string;
  attestationType?: string;
  createdAt?: number;
}

function makeStubPseudonymBinding(label: string, createdAt: number): PseudonymBinding {
  return {
    pseudonym_label: label,
    k_local_pubkey: makeTestKey("klocal", 32),
    primary_pubkey: makeTestKey("primary", 64),
    ml_dsa_pubkey: makeTestKey("ml-dsa-pubkey", ML_DSA_PUBKEY_BYTES),
    created_at: createdAt,
    ml_dsa_signature: makeTestKey("binding-sig", ML_DSA_SIGNATURE_BYTES),
  };
}

function makeStubEndorsement(status: "valid" | "expired" | "target_mismatch"): ValidatedEndorsement {
  const now = 1_746_057_600_000;
  return {
    endorser_pubkey: makeTestKey("endorser-ed25519", 32),
    endorser_ml_dsa_pubkey: makeTestKey("endorser-ml-dsa", ML_DSA_PUBKEY_BYTES),
    target_pubkey: makeTestKey("klocal", 32),
    endorsement_type: "peer_trust",
    created_at: now,
    expires_at: now + 86_400_000,
    endorser_ml_dsa_signature: makeTestKey("endorsement-sig", ML_DSA_SIGNATURE_BYTES),
    validation_status: status,
  };
}

function makeStubAttestation(type: string): ValidatedAttestation {
  const now = 1_746_057_600_000;
  return {
    attester_pubkey: makeTestKey("attester-ed25519", 32),
    attester_ml_dsa_pubkey: makeTestKey("attester-ml-dsa", ML_DSA_PUBKEY_BYTES),
    attestation_type: type,
    attestation_data: makeTestKey("attest-data", 32),
    created_at: now,
    expires_at: now + 86_400_000,
    attester_ml_dsa_signature: makeTestKey("attestation-sig", ML_DSA_SIGNATURE_BYTES),
    validation_status: "valid",
  };
}

export function buildValidatedPackage(opts: BuildValidatedPackageOpts = {}): Extract<PackageValidationResult, { valid: true }> {
  const label = opts.pseudonymLabel ?? "test-agent";
  const createdAt = opts.createdAt ?? 1_746_057_600_000;
  const endorsementCount = opts.endorsements ?? 1;

  const endorsements: ValidatedEndorsement[] = Array.from({ length: endorsementCount }, () =>
    makeStubEndorsement("valid")
  );
  const attestations: ValidatedAttestation[] = opts.attestationType
    ? [makeStubAttestation(opts.attestationType)]
    : [];

  return {
    valid: true,
    pseudonym_binding: makeStubPseudonymBinding(label, createdAt),
    endorsements,
    attestations,
  };
}

export function buildPackageWithExpiredEndorsement(): Extract<PackageValidationResult, { valid: true }> {
  return {
    valid: true,
    pseudonym_binding: makeStubPseudonymBinding("test-agent", 1_746_057_600_000),
    endorsements: [makeStubEndorsement("expired")],
    attestations: [],
  };
}

export function buildPackageWithTargetMismatch(): Extract<PackageValidationResult, { valid: true }> {
  return {
    valid: true,
    pseudonym_binding: makeStubPseudonymBinding("test-agent", 1_746_057_600_000),
    endorsements: [makeStubEndorsement("target_mismatch")],
    attestations: [],
  };
}

export function buildInvalidPackage(): Extract<PackageValidationResult, { valid: false }> {
  return { valid: false, reason: "pseudonym_binding_invalid" };
}

// ─── DirectoryContext ─────────────────────────────────────────────────────────

export interface DirectoryContext {
  registered_at: number;
  is_provisional: boolean;
  conversation_count: number;
  clean_close_rate: number;
}

export function makeDirectoryContext(opts: {
  registered_days_ago?: number;
  is_provisional?: boolean;
  conversation_count?: number;
  clean_close_rate?: number;
} = {}): DirectoryContext {
  const days = opts.registered_days_ago ?? 30;
  return {
    registered_at: Date.now() - days * 86_400_000,
    is_provisional: opts.is_provisional ?? false,
    conversation_count: opts.conversation_count ?? 10,
    clean_close_rate: opts.clean_close_rate ?? 0.9,
  };
}

// ─── TrustStore helpers ───────────────────────────────────────────────────────

export interface TrustStore {
  endorsements_received: Endorsement[];
  attestations_received: Attestation[];
  endorsements_issued: Endorsement[];
}

export async function writeTrustStore(path: string, store: TrustStore): Promise<void> {
  const json = JSON.stringify(store, (_key, value) =>
    value instanceof Uint8Array ? Array.from(value) : value
  );
  await writeFile(path, json, { mode: 0o600 });
}

function reviveUint8Arrays(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(reviveUint8Arrays);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      // Uint8Array fields are serialized as number[]; check field name suffix
      if (k.endsWith("_pubkey") || k.endsWith("_signature") || k.endsWith("_data")) {
        result[k] = Array.isArray(v) ? new Uint8Array(v as number[]) : v;
      } else {
        result[k] = reviveUint8Arrays(v);
      }
    }
    return result;
  }
  return obj;
}

export async function readTrustStore(path: string): Promise<TrustStore> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { endorsements_received: [], attestations_received: [], endorsements_issued: [] };
    }
    throw err;
  }
  return reviveUint8Arrays(JSON.parse(raw)) as TrustStore;
}

// ─── Named policy constants ───────────────────────────────────────────────────

export const OPEN_POLICY: ConnectionPolicy = {
  mode: "open",
  review_mode: "deterministic",
  requirements: [],
};

export const CLOSED_POLICY: ConnectionPolicy = {
  mode: "closed",
  review_mode: "deterministic",
  requirements: [],
};

export const REQUIRES_1_ENDORSEMENT: ConnectionPolicy = {
  mode: "selective",
  review_mode: "deterministic",
  requirements: [{ signal: "endorsement_count", min_count: 1 }],
};

export const REQUIRES_PSEUDONYM_7_DAYS: ConnectionPolicy = {
  mode: "selective",
  review_mode: "deterministic",
  requirements: [{ signal: "pseudonym_age", min_age_days: 7 }],
};

export const INFERENCE_OPEN_POLICY: ConnectionPolicy = {
  mode: "open",
  review_mode: "inference",
  requirements: [],
};
