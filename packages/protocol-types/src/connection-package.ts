/**
 * @cello/protocol-types — CELLO-CONNREQ-001
 * Connection package wire types, CBOR encoding/decoding, and validation.
 *
 * ──── Phase P: Pseudocode ────
 *
 * Connection package structure (CBOR map):
 *   {
 *     pseudonym_binding: PseudonymBinding,
 *     endorsements:      Endorsement[],
 *     attestations:      Attestation[],
 *   }
 *
 * PseudonymBinding construction:
 *   1. Validate pseudonym_label ≤ 64 UTF-8 bytes
 *   2. Fetch ml_dsa_pubkey from keyProvider.getPublicKey()
 *   3. Build TBS positional array:
 *      [pseudonym_label, k_local_pubkey, primary_pubkey, ml_dsa_pubkey, created_at]
 *      canonical CBOR per RFC 8949 §4.2.1 (Encoder({tagUint8Array: false}))
 *   4. ml_dsa_signature = await keyProvider.sign(TBS_bytes)  [ML-DSA, NIST FIPS 204]
 *   5. Return PseudonymBinding with all six fields
 *
 * PseudonymBinding verification:
 *   1. Rebuild TBS same as above (excluding ml_dsa_signature)
 *   2. mlDsaVerify(ml_dsa_pubkey, TBS_bytes, ml_dsa_signature) → boolean
 *
 * Endorsement TBS = canonical CBOR of all fields except endorser_ml_dsa_signature:
 *   [endorser_pubkey, endorser_ml_dsa_pubkey, target_pubkey, endorsement_type,
 *    created_at, expires_at]
 *
 * Attestation TBS = canonical CBOR of all fields except attester_ml_dsa_signature:
 *   [attester_pubkey, attester_ml_dsa_pubkey, attestation_type, attestation_data,
 *    created_at, expires_at]
 *
 * Validation logic:
 *   1. Verify pseudonym_binding signature → if invalid, return { valid: false, reason: 'pseudonym_binding_invalid' }
 *   2. Validate pseudonym_label byte length → if > 64, return { valid: false, reason: 'pseudonym_label_too_long' }
 *      NOTE: label length is checked at build time; but validation also checks in case
 *      a tampered package is passed directly to validateConnectionPackage.
 *   3. For each endorsement:
 *      a. Verify endorser_ml_dsa_signature → if invalid, mark 'signature_invalid'
 *      b. Else if expires_at <= current_timestamp_ms → mark 'expired'
 *      c. Else if target_pubkey ≠ sender_k_local_pubkey → mark 'target_mismatch'
 *      d. Else → mark 'valid'
 *   4. For each attestation:
 *      a. Verify attester_ml_dsa_signature → if invalid, mark 'signature_invalid'
 *      b. Else if expires_at <= current_timestamp_ms → mark 'expired'
 *      c. Else → mark 'valid'
 *   5. Return { valid: true, pseudonym_binding, endorsements: [...], attestations: [...] }
 *
 * IMPORTANT: Items 3 and 4 are per-item — a bad endorsement does NOT reject the package.
 *            Only a bad pseudonym_binding rejects the whole package.
 *
 * Canonical CBOR encoding (RFC 8949 §4.2.1):
 *   - All byte arrays as CBOR major-type-2 byte strings (tagUint8Array: false)
 *   - Integers use shortest encoding; BigInt for timestamps > 0xFFFFFFFF
 *   - Map keys are text strings in deterministic order (cbor-x preserves insertion order)
 *
 * References:
 *   RFC 8949 §4.2.1 — Core Deterministic Encoding Requirements
 *   NIST FIPS 204 — Module-Lattice-Based Digital Signature Standard (ML-DSA)
 */

import { Encoder } from "cbor-x";
import { decode as cborDecode } from "cbor-x";

/**
 * ML-DSA-44 key provider interface.
 *
 * Defined here (not imported from @cello/crypto) because protocol-types is a leaf
 * package that @cello/crypto will import from, not the reverse.
 *
 * The crypto package's InMemoryMlDsaKeyProvider and FileMlDsaKeyProvider will
 * implement this interface.
 *
 * Key sizes for ML-DSA-44 (NIST FIPS 204):
 *   - Public key:  1312 bytes
 *   - Signature:   2420 bytes
 */
export interface MlDsaKeyProvider {
  /** Returns the 1312-byte ML-DSA-44 public key. */
  getPublicKey(): Promise<Uint8Array>;
  /** Signs the message; returns a 2420-byte ML-DSA-44 signature. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

// ─── Wire types ───────────────────────────────────────────────────────────────

/**
 * Pseudonym binding: anchors the agent's pseudonym label to their cryptographic identity.
 *
 * ML-DSA signature is over canonical CBOR of:
 *   [pseudonym_label, k_local_pubkey, primary_pubkey, ml_dsa_pubkey, created_at]
 * (positional array, same pattern as existing TBS arrays in this package)
 *
 * NIST FIPS 204 — ML-DSA-44
 */
export interface PseudonymBinding {
  /** Stable human-readable identity label; max 64 UTF-8 bytes. */
  pseudonym_label: string;
  /** 32-byte Ed25519 K_local public key of the agent. */
  k_local_pubkey: Uint8Array;
  /** FROST group public key of the agent (primary_pubkey from CONTEXT.md). */
  primary_pubkey: Uint8Array;
  /** 1312-byte ML-DSA-44 public key. */
  ml_dsa_pubkey: Uint8Array;
  /** Unix milliseconds when the binding was created. */
  created_at: number;
  /**
   * 2420-byte ML-DSA-44 signature over canonical CBOR of:
   * [pseudonym_label, k_local_pubkey, primary_pubkey, ml_dsa_pubkey, created_at]
   */
  ml_dsa_signature: Uint8Array;
}

/**
 * Endorsement: a third-party voucher for the agent.
 *
 * ML-DSA signature is over canonical CBOR of all fields except endorser_ml_dsa_signature.
 *
 * NIST FIPS 204 — ML-DSA-44
 */
export interface Endorsement {
  /** 32-byte Ed25519 public key of the endorser. */
  endorser_pubkey: Uint8Array;
  /** 1312-byte ML-DSA-44 public key of the endorser. */
  endorser_ml_dsa_pubkey: Uint8Array;
  /**
   * 32-byte Ed25519 public key this endorsement targets.
   * Must match the sender's k_local_pubkey for 'valid' status.
   */
  target_pubkey: Uint8Array;
  /** Endorsement type string (e.g. "peer_trust", "organizational"). */
  endorsement_type: string;
  /** Unix milliseconds when endorsement was created. */
  created_at: number;
  /** Unix milliseconds when endorsement expires. */
  expires_at: number;
  /**
   * 2420-byte ML-DSA-44 signature over canonical CBOR of:
   * [endorser_pubkey, endorser_ml_dsa_pubkey, target_pubkey, endorsement_type, created_at, expires_at]
   */
  endorser_ml_dsa_signature: Uint8Array;
}

/**
 * Attestation: a self-describing claim about the agent.
 *
 * ML-DSA signature is over canonical CBOR of all fields except attester_ml_dsa_signature.
 *
 * NIST FIPS 204 — ML-DSA-44
 */
export interface Attestation {
  /** 32-byte Ed25519 public key of the attester. */
  attester_pubkey: Uint8Array;
  /** 1312-byte ML-DSA-44 public key of the attester. */
  attester_ml_dsa_pubkey: Uint8Array;
  /** Attestation type string (e.g. "capability", "audit_log"). */
  attestation_type: string;
  /** Opaque attestation payload bytes. */
  attestation_data: Uint8Array;
  /** Unix milliseconds when attestation was created. */
  created_at: number;
  /** Unix milliseconds when attestation expires. */
  expires_at: number;
  /**
   * 2420-byte ML-DSA-44 signature over canonical CBOR of:
   * [attester_pubkey, attester_ml_dsa_pubkey, attestation_type, attestation_data, created_at, expires_at]
   */
  attester_ml_dsa_signature: Uint8Array;
}

/**
 * Full connection package presented during a connection request.
 * Each agent decides how many endorsements/attestations to include; receivers
 * cannot infer how many items were withheld.
 */
export interface ConnectionPackage {
  pseudonym_binding: PseudonymBinding;
  endorsements: Endorsement[];
  attestations: Attestation[];
}

// ─── Validation result types ──────────────────────────────────────────────────

/** Per-endorsement validation status. */
export type EndorsementValidationStatus =
  | "valid"
  | "expired"
  | "signature_invalid"
  | "target_mismatch";

/** Per-attestation validation status. */
export type AttestationValidationStatus =
  | "valid"
  | "expired"
  | "signature_invalid";

/** Endorsement annotated with its validation result. */
export interface ValidatedEndorsement extends Endorsement {
  validation_status: EndorsementValidationStatus;
}

/** Attestation annotated with its validation result. */
export interface ValidatedAttestation extends Attestation {
  validation_status: AttestationValidationStatus;
}

/** Result of validating a full connection package. */
export type PackageValidationResult =
  | {
      valid: true;
      pseudonym_binding: PseudonymBinding;
      endorsements: ValidatedEndorsement[];
      attestations: ValidatedAttestation[];
    }
  | {
      valid: false;
      reason: "pseudonym_binding_invalid" | "pseudonym_label_too_long";
    };

// ─── Connection policy ────────────────────────────────────────────────────────

/** A single signal requirement that must be satisfied by an incoming package. */
export type SignalRequirement =
  | { signal: "endorsement_count"; min_count: number }
  | { signal: "attestation_type"; type: string }
  | { signal: "pseudonym_age"; min_age_days: number }
  | { signal: "registration_age"; min_age_days: number };

/**
 * Policy governing how the agent evaluates incoming connection requests.
 *
 * mode:
 *   'open'     — accept all packages that pass structural validation (requirements ignored)
 *   'closed'   — reject all packages
 *   'selective' — accept only packages that satisfy all requirements
 *
 * review_mode:
 *   'deterministic' — engine evaluates automatically; no agent involvement
 *   'inference'     — engine produces a ConnectionReport; agent makes the final decision
 */
export interface ConnectionPolicy {
  mode: "open" | "closed" | "selective";
  review_mode: "deterministic" | "inference";
  requirements: SignalRequirement[];
  whitelist?: string[]; // pseudonym_label fast-path — auto-accept before engine runs
}

// ─── Build-time error ─────────────────────────────────────────────────────────

export type BuildPseudonymBindingResult =
  | { ok: true; binding: PseudonymBinding }
  | { ok: false; reason: "pseudonym_label_too_long" };

// ─── CBOR encoder ─────────────────────────────────────────────────────────────

/**
 * Canonical CBOR encoder per RFC 8949 §4.2.1.
 * tagUint8Array: false — encode Uint8Array as CBOR byte strings (major type 2).
 */
const CBOR_ENC = new Encoder({ tagUint8Array: false });

/** Maximum pseudonym_label size in UTF-8 bytes (AC-007, AC-008). */
export const MAX_PSEUDONYM_LABEL_BYTES = 64;

/** Expected ML-DSA-44 public key size in bytes (NIST FIPS 204). */
export const ML_DSA_PUBKEY_BYTES = 1312;

/** Expected ML-DSA-44 signature size in bytes (NIST FIPS 204). */
export const ML_DSA_SIGNATURE_BYTES = 2420;

// ─── TBS (to-be-signed) encoders ─────────────────────────────────────────────

/**
 * Build the to-be-signed bytes for a PseudonymBinding.
 *
 * TBS: canonical CBOR of positional array:
 *   [pseudonym_label, k_local_pubkey, primary_pubkey, ml_dsa_pubkey, created_at]
 *
 * RFC 8949 §4.2.1 — shortest integer encoding; BigInt for timestamps > 0xFFFFFFFF.
 */
function buildPseudonymBindingTbs(
  pseudonym_label: string,
  k_local_pubkey: Uint8Array,
  primary_pubkey: Uint8Array,
  ml_dsa_pubkey: Uint8Array,
  created_at: number
): Uint8Array {
  const tsEncoded = created_at > 0xffffffff ? BigInt(created_at) : created_at;
  return CBOR_ENC.encode([
    pseudonym_label,
    k_local_pubkey,
    primary_pubkey,
    ml_dsa_pubkey,
    tsEncoded,
  ]);
}

/**
 * Build the to-be-signed bytes for an Endorsement.
 *
 * TBS: canonical CBOR of positional array (all fields except endorser_ml_dsa_signature):
 *   [endorser_pubkey, endorser_ml_dsa_pubkey, target_pubkey, endorsement_type, created_at, expires_at]
 *
 * RFC 8949 §4.2.1 — shortest integer encoding.
 */
function buildEndorsementTbs(e: Omit<Endorsement, "endorser_ml_dsa_signature">): Uint8Array {
  const createdEncoded = e.created_at > 0xffffffff ? BigInt(e.created_at) : e.created_at;
  const expiresEncoded = e.expires_at > 0xffffffff ? BigInt(e.expires_at) : e.expires_at;
  return CBOR_ENC.encode([
    e.endorser_pubkey,
    e.endorser_ml_dsa_pubkey,
    e.target_pubkey,
    e.endorsement_type,
    createdEncoded,
    expiresEncoded,
  ]);
}

/**
 * Build the to-be-signed bytes for an Attestation.
 *
 * TBS: canonical CBOR of positional array (all fields except attester_ml_dsa_signature):
 *   [attester_pubkey, attester_ml_dsa_pubkey, attestation_type, attestation_data, created_at, expires_at]
 *
 * RFC 8949 §4.2.1 — shortest integer encoding.
 */
function buildAttestationTbs(a: Omit<Attestation, "attester_ml_dsa_signature">): Uint8Array {
  const createdEncoded = a.created_at > 0xffffffff ? BigInt(a.created_at) : a.created_at;
  const expiresEncoded = a.expires_at > 0xffffffff ? BigInt(a.expires_at) : a.expires_at;
  return CBOR_ENC.encode([
    a.attester_pubkey,
    a.attester_ml_dsa_pubkey,
    a.attestation_type,
    a.attestation_data,
    createdEncoded,
    expiresEncoded,
  ]);
}

// ─── ML-DSA verify helper ─────────────────────────────────────────────────────

/**
 * Verify an ML-DSA-44 signature.
 *
 * This function is a thin wrapper that enables real ML-DSA verification once
 * a native binding is available. Currently delegates to the provided verifier
 * function — this indirection is necessary because protocol-types cannot import
 * @cello/crypto (direction of the dependency would be inverted).
 *
 * Callers that need verification MUST supply a verifier. The default throws to
 * prevent silent acceptance if the caller forgets to wire one in.
 *
 * For tests, pass the real node-oqs verify function directly.
 */
export type MlDsaVerifier = (
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
) => boolean;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a PseudonymBinding by signing with the MlDsaKeyProvider.
 *
 * SI-003 enforcement: callers supply a provider, not raw signature bytes.
 * The type signature makes it impossible to inject a pre-computed signature.
 *
 * @param params - Binding fields (pseudonym_label, keys, created_at)
 * @param mlDsaKeyProvider - ML-DSA key provider (private key never leaves the provider)
 */
export async function buildPseudonymBinding(
  params: {
    pseudonym_label: string;
    k_local_pubkey: Uint8Array;
    primary_pubkey: Uint8Array;
    ml_dsa_pubkey: Uint8Array;
    created_at: number;
  },
  mlDsaKeyProvider: MlDsaKeyProvider
): Promise<BuildPseudonymBindingResult> {
  const labelBytes = new TextEncoder().encode(params.pseudonym_label);
  if (labelBytes.length > MAX_PSEUDONYM_LABEL_BYTES) {
    return { ok: false, reason: "pseudonym_label_too_long" };
  }

  const tbs = buildPseudonymBindingTbs(
    params.pseudonym_label,
    params.k_local_pubkey,
    params.primary_pubkey,
    params.ml_dsa_pubkey,
    params.created_at
  );

  const ml_dsa_signature = await mlDsaKeyProvider.sign(tbs);

  return {
    ok: true,
    binding: {
      pseudonym_label: params.pseudonym_label,
      k_local_pubkey: params.k_local_pubkey,
      primary_pubkey: params.primary_pubkey,
      ml_dsa_pubkey: params.ml_dsa_pubkey,
      created_at: params.created_at,
      ml_dsa_signature,
    },
  };
}

/**
 * Verify a PseudonymBinding signature standalone.
 *
 * Exported so endorsement stripping tests (SI-002 pattern) can verify items
 * outside of a full package.
 */
export function verifyPseudonymBinding(
  binding: PseudonymBinding,
  mlDsaVerify: MlDsaVerifier
): boolean {
  const tbs = buildPseudonymBindingTbs(
    binding.pseudonym_label,
    binding.k_local_pubkey,
    binding.primary_pubkey,
    binding.ml_dsa_pubkey,
    binding.created_at
  );
  return mlDsaVerify(binding.ml_dsa_pubkey, tbs, binding.ml_dsa_signature);
}

/**
 * Verify an Endorsement signature standalone.
 *
 * SI-002: each item independently verifiable outside of a package.
 */
export function verifyEndorsement(
  endorsement: Endorsement,
  mlDsaVerify: MlDsaVerifier
): boolean {
  const tbs = buildEndorsementTbs(endorsement);
  return mlDsaVerify(
    endorsement.endorser_ml_dsa_pubkey,
    tbs,
    endorsement.endorser_ml_dsa_signature
  );
}

/**
 * Verify an Attestation signature standalone.
 *
 * SI-002: each item independently verifiable outside of a package.
 */
export function verifyAttestation(
  attestation: Attestation,
  mlDsaVerify: MlDsaVerifier
): boolean {
  const tbs = buildAttestationTbs(attestation);
  return mlDsaVerify(
    attestation.attester_ml_dsa_pubkey,
    tbs,
    attestation.attester_ml_dsa_signature
  );
}

/**
 * Validate a ConnectionPackage.
 *
 * Validation rules:
 *   - Invalid pseudonym binding → whole package rejected, reason: 'pseudonym_binding_invalid'
 *   - Label > 64 UTF-8 bytes → whole package rejected, reason: 'pseudonym_label_too_long'
 *   - Per-endorsement: signature_invalid | expired | target_mismatch | valid
 *   - Per-attestation: signature_invalid | expired | valid
 *
 * SI-001: invalid pseudonym binding always rejects the package,
 *         regardless of endorsement/attestation validity.
 *
 * @param pkg - The connection package to validate
 * @param sender_k_local_pubkey - Sender's K_local pubkey (for endorsement target check)
 * @param current_timestamp_ms - Current time (for expiry checks)
 * @param mlDsaVerify - ML-DSA verify function (injected to avoid circular deps)
 */
export function validateConnectionPackage(
  pkg: ConnectionPackage,
  sender_k_local_pubkey: Uint8Array,
  current_timestamp_ms: number,
  mlDsaVerify: MlDsaVerifier
): PackageValidationResult {
  // Check label byte length (validate even if building was bypassed)
  const labelBytes = new TextEncoder().encode(pkg.pseudonym_binding.pseudonym_label);
  if (labelBytes.length > MAX_PSEUDONYM_LABEL_BYTES) {
    return { valid: false, reason: "pseudonym_label_too_long" };
  }

  // SI-001: pseudonym binding must pass — checked before items
  const bindingOk = verifyPseudonymBinding(pkg.pseudonym_binding, mlDsaVerify);
  if (!bindingOk) {
    return { valid: false, reason: "pseudonym_binding_invalid" };
  }

  // Per-endorsement validation (annotate, do not reject)
  const validatedEndorsements: ValidatedEndorsement[] = pkg.endorsements.map((e) => {
    const sigOk = verifyEndorsement(e, mlDsaVerify);
    if (!sigOk) {
      return { ...e, validation_status: "signature_invalid" as const };
    }
    if (e.expires_at <= current_timestamp_ms) {
      return { ...e, validation_status: "expired" as const };
    }
    if (!bytesEqual(e.target_pubkey, sender_k_local_pubkey)) {
      return { ...e, validation_status: "target_mismatch" as const };
    }
    return { ...e, validation_status: "valid" as const };
  });

  // Per-attestation validation (annotate, do not reject)
  const validatedAttestations: ValidatedAttestation[] = pkg.attestations.map((a) => {
    const sigOk = verifyAttestation(a, mlDsaVerify);
    if (!sigOk) {
      return { ...a, validation_status: "signature_invalid" as const };
    }
    if (a.expires_at <= current_timestamp_ms) {
      return { ...a, validation_status: "expired" as const };
    }
    return { ...a, validation_status: "valid" as const };
  });

  return {
    valid: true,
    pseudonym_binding: pkg.pseudonym_binding,
    endorsements: validatedEndorsements,
    attestations: validatedAttestations,
  };
}

// ─── CBOR encode/decode ───────────────────────────────────────────────────────

/**
 * Encode a ConnectionPackage to canonical CBOR bytes.
 *
 * Wire format: CBOR map with keys: pseudonym_binding, endorsements, attestations.
 * Each PseudonymBinding/Endorsement/Attestation is also a CBOR map.
 * Timestamps use minimal encoding per RFC 8949 §4.2.1.
 */
export function encodeConnectionPackage(pkg: ConnectionPackage): Uint8Array {
  return CBOR_ENC.encode({
    pseudonym_binding: encodePseudonymBindingMap(pkg.pseudonym_binding),
    endorsements: pkg.endorsements.map(encodeEndorsementMap),
    attestations: pkg.attestations.map(encodeAttestationMap),
  });
}

function encodeTimestamp(ts: number): number | bigint {
  return ts > 0xffffffff ? BigInt(ts) : ts;
}

function encodePseudonymBindingMap(b: PseudonymBinding): Record<string, unknown> {
  return {
    pseudonym_label: b.pseudonym_label,
    k_local_pubkey: b.k_local_pubkey,
    primary_pubkey: b.primary_pubkey,
    ml_dsa_pubkey: b.ml_dsa_pubkey,
    created_at: encodeTimestamp(b.created_at),
    ml_dsa_signature: b.ml_dsa_signature,
  };
}

function encodeEndorsementMap(e: Endorsement): Record<string, unknown> {
  return {
    endorser_pubkey: e.endorser_pubkey,
    endorser_ml_dsa_pubkey: e.endorser_ml_dsa_pubkey,
    target_pubkey: e.target_pubkey,
    endorsement_type: e.endorsement_type,
    created_at: encodeTimestamp(e.created_at),
    expires_at: encodeTimestamp(e.expires_at),
    endorser_ml_dsa_signature: e.endorser_ml_dsa_signature,
  };
}

function encodeAttestationMap(a: Attestation): Record<string, unknown> {
  return {
    attester_pubkey: a.attester_pubkey,
    attester_ml_dsa_pubkey: a.attester_ml_dsa_pubkey,
    attestation_type: a.attestation_type,
    attestation_data: a.attestation_data,
    created_at: encodeTimestamp(a.created_at),
    expires_at: encodeTimestamp(a.expires_at),
    attester_ml_dsa_signature: a.attester_ml_dsa_signature,
  };
}

/**
 * Decode a ConnectionPackage from CBOR bytes.
 *
 * Performs structural validation (field presence, types, sizes).
 * Does NOT verify signatures — call validateConnectionPackage for that.
 *
 * @throws Error if the bytes cannot be decoded or are structurally invalid.
 */
export function decodeConnectionPackage(bytes: Uint8Array): ConnectionPackage {
  const raw = cborDecode(bytes) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("decodeConnectionPackage: expected a CBOR map at top level");
  }

  const obj = raw as Record<string, unknown>;

  const pseudonym_binding = decodePseudonymBindingMap(
    requireField(obj, "pseudonym_binding", "decodeConnectionPackage")
  );

  const endorsementsRaw = requireField(obj, "endorsements", "decodeConnectionPackage");
  if (!Array.isArray(endorsementsRaw)) {
    throw new Error("decodeConnectionPackage: endorsements must be a CBOR array");
  }
  const endorsements = endorsementsRaw.map((e, i) =>
    decodeEndorsementMap(e, `endorsements[${i}]`)
  );

  const attestationsRaw = requireField(obj, "attestations", "decodeConnectionPackage");
  if (!Array.isArray(attestationsRaw)) {
    throw new Error("decodeConnectionPackage: attestations must be a CBOR array");
  }
  const attestations = attestationsRaw.map((a, i) =>
    decodeAttestationMap(a, `attestations[${i}]`)
  );

  return { pseudonym_binding, endorsements, attestations };
}

// ─── Internal decode helpers ──────────────────────────────────────────────────

function requireField(obj: Record<string, unknown>, key: string, ctx: string): unknown {
  if (!(key in obj)) throw new Error(`${ctx}: missing required field '${key}'`);
  return obj[key];
}

function requireBytes(obj: Record<string, unknown>, key: string, ctx: string): Uint8Array {
  const v = requireField(obj, key, ctx);
  const b = toUint8Array(v);
  if (!b) throw new Error(`${ctx}: field '${key}' must be bytes, got ${typeof v}`);
  return b;
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = requireField(obj, key, ctx);
  if (typeof v !== "string") throw new Error(`${ctx}: field '${key}' must be a string`);
  return v;
}

function requireTimestamp(obj: Record<string, unknown>, key: string, ctx: string): number {
  const v = requireField(obj, key, ctx);
  const n = typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${ctx}: field '${key}' must be a non-negative integer, got ${v}`);
  }
  return n;
}

function decodePseudonymBindingMap(raw: unknown): PseudonymBinding {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("decodePseudonymBindingMap: expected a CBOR map");
  }
  const obj = raw as Record<string, unknown>;
  const ctx = "PseudonymBinding";
  return {
    pseudonym_label: requireString(obj, "pseudonym_label", ctx),
    k_local_pubkey: requireBytes(obj, "k_local_pubkey", ctx),
    primary_pubkey: requireBytes(obj, "primary_pubkey", ctx),
    ml_dsa_pubkey: requireBytes(obj, "ml_dsa_pubkey", ctx),
    created_at: requireTimestamp(obj, "created_at", ctx),
    ml_dsa_signature: requireBytes(obj, "ml_dsa_signature", ctx),
  };
}

function decodeEndorsementMap(raw: unknown, ctx: string): Endorsement {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`decodeEndorsementMap[${ctx}]: expected a CBOR map`);
  }
  const obj = raw as Record<string, unknown>;
  return {
    endorser_pubkey: requireBytes(obj, "endorser_pubkey", ctx),
    endorser_ml_dsa_pubkey: requireBytes(obj, "endorser_ml_dsa_pubkey", ctx),
    target_pubkey: requireBytes(obj, "target_pubkey", ctx),
    endorsement_type: requireString(obj, "endorsement_type", ctx),
    created_at: requireTimestamp(obj, "created_at", ctx),
    expires_at: requireTimestamp(obj, "expires_at", ctx),
    endorser_ml_dsa_signature: requireBytes(obj, "endorser_ml_dsa_signature", ctx),
  };
}

function decodeAttestationMap(raw: unknown, ctx: string): Attestation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`decodeAttestationMap[${ctx}]: expected a CBOR map`);
  }
  const obj = raw as Record<string, unknown>;
  return {
    attester_pubkey: requireBytes(obj, "attester_pubkey", ctx),
    attester_ml_dsa_pubkey: requireBytes(obj, "attester_ml_dsa_pubkey", ctx),
    attestation_type: requireString(obj, "attestation_type", ctx),
    attestation_data: requireBytes(obj, "attestation_data", ctx),
    created_at: requireTimestamp(obj, "created_at", ctx),
    expires_at: requireTimestamp(obj, "expires_at", ctx),
    attester_ml_dsa_signature: requireBytes(obj, "attester_ml_dsa_signature", ctx),
  };
}

// ─── Internal utility ─────────────────────────────────────────────────────────

/**
 * Constant-time byte comparison.
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Coerce a CBOR-decoded value to Uint8Array.
 * cbor-x with tagUint8Array:false returns Buffer (a Node.js Buffer is a Uint8Array subclass).
 */
function toUint8Array(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}
