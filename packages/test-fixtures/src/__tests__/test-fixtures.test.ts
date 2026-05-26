/**
 * CELLO-TESTFIX-001 — @cello-protocol/test-fixtures tests
 *
 * Every AC from the story maps to a named test below.
 * Tests are written RED-first per SPARC Phase R.
 */

import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import {
  FakeMlDsaKeyProvider,
  FakeMultiVerifier,
  buildValidatedPackage,
  buildPackageWithExpiredEndorsement,
  buildPackageWithTargetMismatch,
  buildInvalidPackage,
  makeDirectoryContext,
  writeTrustStore,
  readTrustStore,
  OPEN_POLICY,
  CLOSED_POLICY,
  REQUIRES_1_ENDORSEMENT,
  REQUIRES_PSEUDONYM_7_DAYS,
  INFERENCE_OPEN_POLICY,
} from "../index.js";
import type { ConnectionPolicy } from "@cello-protocol/protocol-types";

setupV3Tests();

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(async () => { await scope.run(async () => {}); });

// ─── AC-001: FakeMlDsaKeyProvider determinism and byte lengths ────────────────

describe("AC-001: FakeMlDsaKeyProvider — determinism and byte lengths", () => {
  it("two instances with same seed produce identical pubkeys and signatures", async () => {
    const seed = new Uint8Array(32).fill(0x42);
    const p1 = new FakeMlDsaKeyProvider(seed);
    const p2 = new FakeMlDsaKeyProvider(seed);
    const msg = new Uint8Array([1, 2, 3]);

    const pk1 = await p1.getPublicKey();
    const pk2 = await p2.getPublicKey();
    const sig1 = await p1.sign(msg);
    const sig2 = await p2.sign(msg);

    expect(pk1).toEqual(pk2);
    expect(sig1).toEqual(sig2);
    expect(pk1.byteLength).toBe(1312);
    expect(sig1.byteLength).toBe(2420);
  });
});

// ─── AC-002: FakeMultiVerifier matches provider ────────────────────────────────

describe("AC-002: FakeMultiVerifier — verify matching and non-matching pubkeys", () => {
  it("verifier returns true for matching pubkey, false for different seed", async () => {
    const seedA = new Uint8Array(32).fill(0xaa);
    const seedB = new Uint8Array(32).fill(0xbb);
    const providerA = new FakeMlDsaKeyProvider(seedA);
    const providerB = new FakeMlDsaKeyProvider(seedB);
    const pubkeyA = await providerA.getPublicKey();
    const pubkeyB = await providerB.getPublicKey();

    const multi = new FakeMultiVerifier();
    multi.register(providerA, pubkeyA);

    const verifier = multi.asVerifier();
    const msg = new Uint8Array([9, 8, 7]);
    const sigA = await providerA.sign(msg);

    expect(verifier(pubkeyA, msg, sigA)).toBe(true);
    expect(verifier(pubkeyB, msg, sigA)).toBe(false);
  });
});

// ─── AC-003: buildValidatedPackage with options ───────────────────────────────

describe("AC-003: buildValidatedPackage — respects options", () => {
  it("returns valid: true with correct endorsement count, label, and attestation", () => {
    const result = buildValidatedPackage({
      endorsements: 3,
      pseudonymLabel: "alice",
      attestationType: "capability",
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.endorsements).toHaveLength(3);
    expect(result.endorsements.every((e) => e.validation_status === "valid")).toBe(true);
    expect(result.pseudonym_binding.pseudonym_label).toBe("alice");
    expect(result.attestations).toHaveLength(1);
    expect(result.attestations[0].attestation_type).toBe("capability");
  });
});

// ─── AC-004: buildPackageWithExpiredEndorsement ───────────────────────────────

describe("AC-004: buildPackageWithExpiredEndorsement", () => {
  it("returns valid: true with one expired endorsement", () => {
    const result = buildPackageWithExpiredEndorsement();

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.endorsements).toHaveLength(1);
    expect(result.endorsements[0].validation_status).toBe("expired");
  });
});

// ─── AC-005: buildPackageWithTargetMismatch ───────────────────────────────────

describe("AC-005: buildPackageWithTargetMismatch", () => {
  it("returns valid: true with one target_mismatch endorsement", () => {
    const result = buildPackageWithTargetMismatch();

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.endorsements).toHaveLength(1);
    expect(result.endorsements[0].validation_status).toBe("target_mismatch");
  });
});

// ─── AC-006: buildInvalidPackage ─────────────────────────────────────────────

describe("AC-006: buildInvalidPackage", () => {
  it("returns valid: false with reason pseudonym_binding_invalid", () => {
    const result = buildInvalidPackage();

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toBe("pseudonym_binding_invalid");
  });
});

// ─── AC-007: makeDirectoryContext ─────────────────────────────────────────────

describe("AC-007: makeDirectoryContext — registered_at and is_provisional", () => {
  it("returns correct registered_at and is_provisional: false", () => {
    const before = Date.now();
    const ctx = makeDirectoryContext({ registered_days_ago: 30, is_provisional: false });
    const after = Date.now();

    const expected = before - 30 * 86_400_000;
    expect(ctx.registered_at).toBeGreaterThanOrEqual(expected - 5000);
    expect(ctx.registered_at).toBeLessThanOrEqual(after - 30 * 86_400_000 + 5000);
    expect(ctx.is_provisional).toBe(false);
  });

  it("defaults conversation_count: 10 and clean_close_rate: 0.9", () => {
    const ctx = makeDirectoryContext({});
    expect(ctx.conversation_count).toBe(10);
    expect(ctx.clean_close_rate).toBe(0.9);
  });
});

// ─── AC-008: writeTrustStore / readTrustStore round-trip ─────────────────────

describe("AC-008: writeTrustStore / readTrustStore round-trip", () => {
  it("empty store round-trips without data loss", async () => {
    const path = join(tmpdir(), `cello-test-store-empty-${Date.now()}.json`);
    scope.addCleanup(() => unlink(path).catch(() => {}));

    const store = { endorsements_received: [], attestations_received: [], endorsements_issued: [] };
    await writeTrustStore(path, store);
    expect(await readTrustStore(path)).toEqual(store);
  });

  it("Endorsement Uint8Array fields round-trip without data loss", async () => {
    const path = join(tmpdir(), `cello-test-store-endorsement-${Date.now()}.json`);
    scope.addCleanup(() => unlink(path).catch(() => {}));

    const validPackage = buildValidatedPackage({ endorsements: 1 });
    const endorsement = validPackage.endorsements[0];
    const store = {
      endorsements_received: [endorsement],
      attestations_received: [],
      endorsements_issued: [],
    };

    await writeTrustStore(path, store);
    const read = await readTrustStore(path);

    expect(read.endorsements_received).toHaveLength(1);
    const e = read.endorsements_received[0];
    expect(e.endorser_pubkey).toBeInstanceOf(Uint8Array);
    expect(e.endorser_ml_dsa_pubkey).toBeInstanceOf(Uint8Array);
    expect(e.target_pubkey).toBeInstanceOf(Uint8Array);
    expect(e.endorser_ml_dsa_signature).toBeInstanceOf(Uint8Array);
    expect(e.endorser_pubkey).toEqual(endorsement.endorser_pubkey);
    expect(e.endorser_ml_dsa_pubkey).toEqual(endorsement.endorser_ml_dsa_pubkey);
    expect(e.endorser_ml_dsa_signature).toEqual(endorsement.endorser_ml_dsa_signature);
  });
});

// ─── AC-009: readTrustStore — missing file returns empty store ─────────────────

describe("AC-009: readTrustStore — absent file returns empty store", () => {
  it("returns empty store without throwing", async () => {
    const path = join(tmpdir(), `cello-nonexistent-${Date.now()}.json`);
    const result = await readTrustStore(path);

    expect(result).toEqual({
      endorsements_received: [],
      attestations_received: [],
      endorsements_issued: [],
    });
  });
});

// ─── AC-010: Named policy constants ──────────────────────────────────────────

describe("AC-010: named policy constants satisfy ConnectionPolicy type", () => {
  it("OPEN_POLICY has mode: open and review_mode: deterministic", () => {
    const p: ConnectionPolicy = OPEN_POLICY;
    expect(p.mode).toBe("open");
    expect(p.review_mode).toBe("deterministic");
    expect(p.requirements).toEqual([]);
  });

  it("CLOSED_POLICY has mode: closed", () => {
    const p: ConnectionPolicy = CLOSED_POLICY;
    expect(p.mode).toBe("closed");
  });

  it("INFERENCE_OPEN_POLICY has review_mode: inference", () => {
    const p: ConnectionPolicy = INFERENCE_OPEN_POLICY;
    expect(p.review_mode).toBe("inference");
  });

  it("REQUIRES_1_ENDORSEMENT has exactly one requirement with min_count: 1", () => {
    const p: ConnectionPolicy = REQUIRES_1_ENDORSEMENT;
    expect(p.requirements).toHaveLength(1);
    expect(p.requirements[0]).toMatchObject({
      signal_type: "endorsement",
      condition: { type: "min_count", count: 1 },
    });
  });

  it("REQUIRES_PSEUDONYM_7_DAYS has exactly one requirement with min_age_days: 7", () => {
    const p: ConnectionPolicy = REQUIRES_PSEUDONYM_7_DAYS;
    expect(p.requirements).toHaveLength(1);
    expect(p.requirements[0]).toMatchObject({
      signal_type: "pseudonym_age",
      condition: { type: "min_age_days", days: 7 },
    });
  });
});
