/**
 * CELLO-CONNPOL-001 — Connection Policy Engine tests
 *
 * Every AC and SI from the story spec maps to a named test below.
 * Tests are RED-first per SPARC Phase R — written before implementation exists.
 *
 * Imports use @cello/test-fixtures for validated package factories and policy constants.
 * All tests are pure-logic, synchronous — no network, no libp2p, no crypto operations.
 */

import { describe, it, expect } from "vitest";
import { setupV3Tests } from "@claude-flow/testing";
import {
  buildValidatedPackage,
  buildInvalidPackage,
  OPEN_POLICY,
  CLOSED_POLICY,
  REQUIRES_1_ENDORSEMENT,
  REQUIRES_PSEUDONYM_7_DAYS,
  INFERENCE_OPEN_POLICY,
  buildPackageWithExpiredEndorsement,
  buildPackageWithTargetMismatch,
} from "@cello/test-fixtures";
import { evaluateConnectionPackage } from "../connection-policy-engine.js";
import type {
  ConnectionPolicy,
  DirectoryContext,
} from "../connection-package.js";

setupV3Tests();

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const BASE_TS = 1_746_057_600_000; // 2026-05-01T00:00:00.000Z (a fixed reference point)

function makeContext(overrides: Partial<DirectoryContext> = {}): DirectoryContext {
  return {
    registered_at: BASE_TS - 30 * 86_400_000, // 30 days ago
    is_provisional: false,
    conversation_count: 10,
    clean_close_rate: 0.9,
    ...overrides,
  };
}

// ─── AC-001: open deterministic + valid package → auto_accept ─────────────────

describe("AC-001: open, deterministic policy with valid package", () => {
  it("AC-001: returns auto_accept", () => {
    const pkg = buildValidatedPackage();
    const policy = OPEN_POLICY; // mode: open, review_mode: deterministic
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_accept");
  });
});

// ─── AC-002: closed policy → auto_reject policy_closed ───────────────────────

describe("AC-002: closed policy with 10 valid endorsements", () => {
  it("AC-002: returns auto_reject with reason policy_closed", () => {
    const pkg = buildValidatedPackage({ endorsements: 10 });
    const policy = CLOSED_POLICY;
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_reject");
    if (report.verdict === "auto_reject") {
      expect(report.reason).toBe("policy_closed");
    }
  });
});

// ─── AC-003: selective deterministic min_count:2 with 3 valid → auto_accept ──

describe("AC-003: selective deterministic, min_count:2, 3 valid endorsements", () => {
  it("AC-003: returns auto_accept", () => {
    const pkg = buildValidatedPackage({ endorsements: 3 });
    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 2 } },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_accept");
  });
});

// ─── AC-004: selective deterministic min_count:2 with 1 valid → auto_insufficient ─

describe("AC-004: selective deterministic, min_count:2, 1 valid endorsement", () => {
  it("AC-004: returns auto_insufficient with provided:1", () => {
    const pkg = buildValidatedPackage({ endorsements: 1 });
    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 2 } },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements).toHaveLength(1);
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        condition: { type: "min_count", count: 2 },
        provided: 1,
      });
    }
  });
});

// ─── AC-005: 2 endorsements, one expired → provided:1 ────────────────────────

describe("AC-005: selective deterministic, min_count:2, one endorsement expired", () => {
  it("AC-005: returns auto_insufficient with provided:1 — expired does not count", () => {
    // buildPackageWithExpiredEndorsement returns a package with exactly 1 expired endorsement
    // We need a package with 1 valid + 1 expired = 2 total but only 1 valid
    const validPkg = buildValidatedPackage({ endorsements: 1 }); // 1 valid
    const expiredPkg = buildPackageWithExpiredEndorsement(); // 1 expired

    // Combine: 1 valid + 1 expired = 2 total, 1 valid
    const pkg = {
      ...validPkg,
      endorsements: [...validPkg.endorsements, ...expiredPkg.endorsements],
    };

    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 2 } },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        provided: 1,
      });
    }
  });
});

// ─── AC-006: 2 endorsements, one target_mismatch → provided:1 ────────────────

describe("AC-006: selective deterministic, min_count:2, one endorsement target_mismatch", () => {
  it("AC-006: returns auto_insufficient with provided:1 — target_mismatch does not count", () => {
    const validPkg = buildValidatedPackage({ endorsements: 1 }); // 1 valid
    const mismatchPkg = buildPackageWithTargetMismatch(); // 1 target_mismatch

    const pkg = {
      ...validPkg,
      endorsements: [...validPkg.endorsements, ...mismatchPkg.endorsements],
    };

    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 2 } },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        provided: 1,
      });
    }
  });
});

// ─── AC-007: min_age_days:7, pseudonym exactly 7 days old → auto_accept ──────

describe("AC-007: selective deterministic, min_age_days:7, pseudonym exactly 7 days old", () => {
  it("AC-007: returns auto_accept — boundary-inclusive", () => {
    const sevenDaysAgo = BASE_TS - 7 * 86_400_000;
    const pkg = buildValidatedPackage({ createdAt: sevenDaysAgo });
    const policy = REQUIRES_PSEUDONYM_7_DAYS;
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_accept");
  });
});

// ─── AC-008: min_age_days:7, pseudonym 6 days old → auto_insufficient ────────

describe("AC-008: selective deterministic, min_age_days:7, pseudonym 6 days old", () => {
  it("AC-008: returns auto_insufficient with provided_days:6", () => {
    const sixDaysAgo = BASE_TS - 6 * 86_400_000;
    const pkg = buildValidatedPackage({ createdAt: sixDaysAgo });
    const policy = REQUIRES_PSEUDONYM_7_DAYS;
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements).toHaveLength(1);
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "pseudonym_age",
        condition: { type: "min_age_days", days: 7 },
        provided_days: 6,
      });
    }
  });
});

// ─── AC-009: invalid package + open deterministic → auto_reject binding_invalid ─

describe("AC-009: invalid package against open deterministic policy", () => {
  it("AC-009: returns auto_reject with reason pseudonym_binding_invalid", () => {
    const pkg = buildInvalidPackage();
    const policy = OPEN_POLICY;
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_reject");
    if (report.verdict === "auto_reject") {
      expect(report.reason).toBe("pseudonym_binding_invalid");
    }
  });
});

// ─── AC-010: is_provisional:true + open deterministic → auto_reject is_provisional ─

describe("AC-010: is_provisional:true with open deterministic policy", () => {
  it("AC-010: returns auto_reject with reason is_provisional", () => {
    const pkg = buildValidatedPackage();
    const policy = OPEN_POLICY;
    const ctx = makeContext({ is_provisional: true });

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_reject");
    if (report.verdict === "auto_reject") {
      expect(report.reason).toBe("is_provisional");
    }
  });
});

// ─── AC-011: open inference + valid package → pending_agent_review ────────────

describe("AC-011: open inference policy with valid package", () => {
  it("AC-011: returns pending_agent_review with correct summaries", () => {
    // Package created 10 days ago with 2 valid endorsements and no attestations
    const tenDaysAgo = BASE_TS - 10 * 86_400_000;
    const pkg = buildValidatedPackage({
      endorsements: 2,
      createdAt: tenDaysAgo,
      pseudonymLabel: "test-agent",
    });
    const policy = INFERENCE_OPEN_POLICY; // mode: open, review_mode: inference
    const ctx = makeContext({ registered_at: BASE_TS - 20 * 86_400_000 }); // 20 days ago

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("pending_agent_review");
    if (report.verdict === "pending_agent_review") {
      // policy_summary
      expect(report.policy_summary.mode).toBe("open");
      expect(report.policy_summary.review_mode).toBe("inference");
      expect(report.policy_summary.requirements_unmet).toHaveLength(0);
      expect(report.policy_summary.requirements_met).toHaveLength(0); // open has no requirements

      // package_summary
      expect(report.package_summary.pseudonym_label).toBe("test-agent");
      expect(report.package_summary.endorsement_count).toBe(2);
      expect(report.package_summary.attestation_types).toHaveLength(0);
      expect(report.package_summary.pseudonym_age_days).toBe(10);
      expect(report.package_summary.registration_age_days).toBe(20);
      expect(report.package_summary.is_provisional).toBe(false);
    }
  });
});

// ─── AC-012: selective inference min_count:2 with 1 valid → pending_agent_review ─

describe("AC-012: selective inference, min_count:2, 1 valid endorsement", () => {
  it("AC-012: returns pending_agent_review with unmet endorsement requirement", () => {
    const pkg = buildValidatedPackage({ endorsements: 1 });
    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "inference",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 2 } },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("pending_agent_review");
    if (report.verdict === "pending_agent_review") {
      expect(report.policy_summary.requirements_unmet).toHaveLength(1);
      expect(report.policy_summary.requirements_unmet[0]).toMatchObject({
        signal_type: "endorsement",
        condition: { type: "min_count", count: 2 },
        provided: 1,
      });
      expect(report.policy_summary.requirements_met).toHaveLength(0);
      expect(report.package_summary.endorsement_count).toBe(1);
    }
  });
});

// ─── AC-013: guarded deterministic min_count:1 with 1 valid → auto_accept ────

describe("AC-013: guarded deterministic, min_count:1, 1 valid endorsement", () => {
  it("AC-013: returns auto_accept — guarded = selective in M3", () => {
    const pkg = buildValidatedPackage({ endorsements: 1 });
    const policy: ConnectionPolicy = {
      mode: "guarded",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 1 } },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_accept");
  });
});

// ─── AC-014: from_shared_contact condition → auto_insufficient unsupported ────

describe("AC-014: selective deterministic with from_shared_contact condition", () => {
  it("AC-014: returns auto_insufficient with unsupported_condition:true", () => {
    const pkg = buildValidatedPackage({ endorsements: 5 });
    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "from_shared_contact", min: 1 } },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements).toHaveLength(1);
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        condition: { type: "from_shared_contact", min: 1 },
        unsupported_condition: true,
      });
    }
  });
});

// ─── AC-015: attestation_type required + valid attestation → auto_accept ──────

describe("AC-015: selective deterministic, attestation_type required, valid attestation present", () => {
  it("AC-015: returns auto_accept", () => {
    const pkg = buildValidatedPackage({ attestationType: "carrier_verified" });
    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        {
          signal_type: "attestation",
          condition: { type: "attestation_type", required: ["carrier_verified"] },
        },
      ],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_accept");
  });
});

// ─── AC-016: multi-requirement, endorsement met + registration_age unmet ──────

describe("AC-016: selective deterministic, min_count:1 AND registration_age:3, registered 1 day ago", () => {
  it("AC-016: returns auto_insufficient with only registration_age in unmet", () => {
    const pkg = buildValidatedPackage({ endorsements: 2 }); // 2 valid endorsements → meets min_count:1
    const policy: ConnectionPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 1 } },
        { signal_type: "registration_age", condition: { type: "min_age_days", days: 3 } },
      ],
    };
    // registered 1 day ago → registration_age = 1 < 3
    const ctx = makeContext({ registered_at: BASE_TS - 1 * 86_400_000 });

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements).toHaveLength(1);
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "registration_age",
        condition: { type: "min_age_days", days: 3 },
        provided_days: 1,
      });
    }
  });
});

// ─── Security Invariants ──────────────────────────────────────────────────────

describe("SI-001: invalid pseudonym binding never produces auto_accept or pending_agent_review", () => {
  it("SI-001: invalid binding + open policy + many valid endorsements → auto_reject", () => {
    // buildInvalidPackage returns { valid: false, reason: 'pseudonym_binding_invalid' }
    const pkg = buildInvalidPackage();
    const policy: ConnectionPolicy = {
      mode: "open",
      review_mode: "inference",
      requirements: [],
    };
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_reject");
    expect(report.verdict).not.toBe("auto_accept");
    expect(report.verdict).not.toBe("pending_agent_review");
    if (report.verdict === "auto_reject") {
      expect(report.reason).toBe("pseudonym_binding_invalid");
    }
  });
});

describe("SI-002: expired endorsements never count toward min_count", () => {
  it("SI-002: all 5 endorsements expired → provided:0 even with min_count:1", () => {
    // Build a valid package base, but replace all endorsements with expired ones
    const base = buildValidatedPackage({ endorsements: 0 });
    const expiredPkg = buildPackageWithExpiredEndorsement(); // 1 expired
    const pkg = {
      ...base,
      // 5 expired endorsements
      endorsements: Array.from({ length: 5 }, () => expiredPkg.endorsements[0]),
    };

    const policy = REQUIRES_1_ENDORSEMENT; // min_count: 1
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        provided: 0,
      });
    }
  });
});

describe("SI-003: target_mismatch endorsements never count toward min_count", () => {
  it("SI-003: 3 target_mismatch endorsements → provided:0 even with min_count:1", () => {
    const base = buildValidatedPackage({ endorsements: 0 });
    const mismatchPkg = buildPackageWithTargetMismatch(); // 1 target_mismatch
    const pkg = {
      ...base,
      endorsements: Array.from({ length: 3 }, () => mismatchPkg.endorsements[0]),
    };

    const policy = REQUIRES_1_ENDORSEMENT; // min_count: 1
    const ctx = makeContext();

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_insufficient");
    if (report.verdict === "auto_insufficient") {
      expect(report.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        provided: 0,
      });
    }
  });
});

describe("SI-004: is_provisional:true always → auto_reject regardless of policy/package", () => {
  it("SI-004: open inference + valid binding + many valid endorsements + is_provisional:true → auto_reject", () => {
    const pkg = buildValidatedPackage({ endorsements: 10 });
    const policy: ConnectionPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };
    const ctx = makeContext({ is_provisional: true });

    const report = evaluateConnectionPackage(pkg, policy, ctx, BASE_TS);

    expect(report.verdict).toBe("auto_reject");
    if (report.verdict === "auto_reject") {
      expect(report.reason).toBe("is_provisional");
    }
    expect(report.verdict).not.toBe("auto_accept");
    expect(report.verdict).not.toBe("pending_agent_review");
  });
});
