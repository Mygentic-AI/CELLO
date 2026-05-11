/**
 * @cello/client — CELLO-CONNPOL-001
 * Connection policy engine tests.
 *
 * All tests are derived 1:1 from story ACs and SIs.
 * Run RED before implementation exists, then GREEN after.
 */

import { setupV3Tests, describe, it, expect } from "@claude-flow/testing";
setupV3Tests();
import {
  buildValidatedPackage,
  buildInvalidPackage,
  buildPackageWithExpiredEndorsement,
  buildPackageWithTargetMismatch,
  makeDirectoryContext,
} from "@cello/test-fixtures";
import {
  evaluateConnectionPackage,
  CLOSED_POLICY,
} from "../connection-policy.js";
import type {
  SignalRequirementPolicy,
  DirectoryContext,
} from "../connection-policy.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A fixed reference timestamp: 2026-05-10T00:00:00.000Z (Unix ms)
const NOW = 1_746_835_200_000;

// DirectoryContext with standard values
const CTX_NORMAL: DirectoryContext = makeDirectoryContext({
  registered_days_ago: 30,
  is_provisional: false,
  conversation_count: 10,
  clean_close_rate: 0.9,
});

const CTX_PROVISIONAL: DirectoryContext = makeDirectoryContext({
  registered_days_ago: 0,
  is_provisional: true,
  conversation_count: 0,
  clean_close_rate: 1.0,
});

// ─── AC-001: open deterministic + valid package → auto_accept ─────────────────

describe("AC-001: open deterministic + valid package", () => {
  it("returns auto_accept", () => {
    const pkg = buildValidatedPackage();
    const policy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result).toEqual({ verdict: "auto_accept" });
  });
});

// ─── AC-002: closed + valid 10-endorsement package → auto_reject: policy_closed

describe("AC-002: closed + valid 10-endorsement package", () => {
  it("returns auto_reject: policy_closed", () => {
    const pkg = buildValidatedPackage({ endorsements: 10 });
    const result = evaluateConnectionPackage(pkg, CLOSED_POLICY, CTX_NORMAL, NOW);
    expect(result).toEqual({ verdict: "auto_reject", reason: "policy_closed" });
  });
});

// ─── AC-003: selective deterministic min_count 2 + 3 valid endorsements → auto_accept

describe("AC-003: selective deterministic min_count 2 + 3 valid endorsements", () => {
  it("returns auto_accept", () => {
    const pkg = buildValidatedPackage({ endorsements: 3 });
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 2 } }],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result).toEqual({ verdict: "auto_accept" });
  });
});

// ─── AC-004: selective deterministic min_count 2 + 1 valid endorsement → auto_insufficient

describe("AC-004: selective deterministic min_count 2 + 1 valid endorsement", () => {
  it("returns auto_insufficient with provided: 1", () => {
    const pkg = buildValidatedPackage({ endorsements: 1 });
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 2 } }],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      expect(result.unmet_requirements).toHaveLength(1);
      expect(result.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        condition: { type: "min_count", count: 2 },
        provided: 1,
      });
    }
  });
});

// ─── AC-005: selective deterministic min_count 2 + 1 valid + 1 expired → auto_insufficient (provided: 1)

describe("AC-005: selective deterministic min_count 2 + 1 valid + 1 expired", () => {
  it("returns auto_insufficient with provided: 1 (expired does not count)", () => {
    // Build a package with 1 valid + 1 expired endorsement manually
    const validPkg = buildValidatedPackage({ endorsements: 1 });
    const expiredPkg = buildPackageWithExpiredEndorsement();
    const combinedPkg = {
      ...validPkg,
      endorsements: [...validPkg.endorsements, ...expiredPkg.endorsements],
    };
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 2 } }],
    };
    const result = evaluateConnectionPackage(combinedPkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      expect(result.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        provided: 1,
      });
    }
  });
});

// ─── AC-006: selective deterministic min_count 2 + 1 valid + 1 target_mismatch → auto_insufficient (provided: 1)

describe("AC-006: selective deterministic min_count 2 + 1 valid + 1 target_mismatch", () => {
  it("returns auto_insufficient with provided: 1 (target_mismatch does not count)", () => {
    const validPkg = buildValidatedPackage({ endorsements: 1 });
    const mismatchPkg = buildPackageWithTargetMismatch();
    const combinedPkg = {
      ...validPkg,
      endorsements: [...validPkg.endorsements, ...mismatchPkg.endorsements],
    };
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 2 } }],
    };
    const result = evaluateConnectionPackage(combinedPkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      expect(result.unmet_requirements[0]).toMatchObject({
        signal_type: "endorsement",
        provided: 1,
      });
    }
  });
});

// ─── AC-007: selective deterministic min_age_days 7 + exactly 7 days old → auto_accept (boundary-inclusive)

describe("AC-007: selective deterministic min_age_days 7 + exactly 7 days old", () => {
  it("returns auto_accept (boundary-inclusive)", () => {
    const sevenDaysAgo = NOW - 7 * 86_400_000;
    const pkg = buildValidatedPackage({ createdAt: sevenDaysAgo });
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "pseudonym_age", condition: { type: "min_age_days", days: 7 } }],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result).toEqual({ verdict: "auto_accept" });
  });
});

// ─── AC-008: selective deterministic min_age_days 7 + exactly 6 days old → auto_insufficient (provided_days: 6)

describe("AC-008: selective deterministic min_age_days 7 + exactly 6 days old", () => {
  it("returns auto_insufficient with provided_days: 6", () => {
    const sixDaysAgo = NOW - 6 * 86_400_000;
    const pkg = buildValidatedPackage({ createdAt: sixDaysAgo });
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "pseudonym_age", condition: { type: "min_age_days", days: 7 } }],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      expect(result.unmet_requirements).toHaveLength(1);
      expect(result.unmet_requirements[0]).toMatchObject({
        signal_type: "pseudonym_age",
        condition: { type: "min_age_days", days: 7 },
        provided_days: 6,
      });
    }
  });
});

// ─── AC-009: invalid package (pseudonym_binding_invalid) + open deterministic → auto_reject

describe("AC-009: invalid package + open deterministic", () => {
  it("returns auto_reject: pseudonym_binding_invalid", () => {
    const pkg = buildInvalidPackage();
    const policy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result).toEqual({ verdict: "auto_reject", reason: "pseudonym_binding_invalid" });
  });
});

// ─── AC-010: valid package + is_provisional: true + open deterministic → auto_reject: is_provisional

describe("AC-010: valid package + is_provisional: true + open deterministic", () => {
  it("returns auto_reject: is_provisional", () => {
    const pkg = buildValidatedPackage();
    const policy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_PROVISIONAL, NOW);
    expect(result).toEqual({ verdict: "auto_reject", reason: "is_provisional" });
  });
});

// ─── AC-011: open inference + valid package → pending_agent_review

describe("AC-011: open inference + valid package", () => {
  it("returns pending_agent_review with correct policy_summary and package_summary", () => {
    const pkg = buildValidatedPackage({
      pseudonymLabel: "alice-agent",
      endorsements: 2,
      createdAt: NOW - 10 * 86_400_000, // 10 days ago
    });
    const policy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "inference",
      requirements: [],
    };
    const ctx: DirectoryContext = makeDirectoryContext({
      registered_days_ago: 5,
      is_provisional: false,
      conversation_count: 3,
      clean_close_rate: 0.8,
    });
    const result = evaluateConnectionPackage(pkg, policy, ctx, NOW);
    expect(result.verdict).toBe("pending_agent_review");
    if (result.verdict === "pending_agent_review") {
      expect(result.policy_summary.mode).toBe("open");
      expect(result.policy_summary.review_mode).toBe("inference");
      expect(result.policy_summary.requirements_met).toEqual([]);
      expect(result.policy_summary.requirements_unmet).toEqual([]);
      expect(result.package_summary.pseudonym_label).toBe("alice-agent");
      expect(result.package_summary.endorsement_count).toBe(2);
      expect(result.package_summary.pseudonym_age_days).toBe(10);
      expect(result.package_summary.is_provisional).toBe(false);
    }
  });
});

// ─── AC-012: selective inference min_count 2 + 1 valid endorsement → pending_agent_review with requirements_unmet

describe("AC-012: selective inference min_count 2 + 1 valid endorsement", () => {
  it("returns pending_agent_review with requirements_unmet", () => {
    const pkg = buildValidatedPackage({ endorsements: 1 });
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "inference",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 2 } }],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("pending_agent_review");
    if (result.verdict === "pending_agent_review") {
      expect(result.policy_summary.requirements_unmet).toHaveLength(1);
      expect(result.policy_summary.requirements_unmet[0]).toMatchObject({
        signal_type: "endorsement",
        provided: 1,
      });
    }
  });
});

// ─── AC-013: guarded deterministic min_count 1 + 1 valid endorsement → auto_accept

describe("AC-013: guarded deterministic min_count 1 + 1 valid endorsement", () => {
  it("returns auto_accept (guarded = selective in M3)", () => {
    const pkg = buildValidatedPackage({ endorsements: 1 });
    const policy: SignalRequirementPolicy = {
      mode: "guarded",
      review_mode: "deterministic",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 1 } }],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result).toEqual({ verdict: "auto_accept" });
  });
});

// ─── AC-014: selective deterministic from_shared_contact → auto_insufficient with unsupported_condition: true

describe("AC-014: selective deterministic from_shared_contact", () => {
  it("returns auto_insufficient with unsupported_condition: true (M6 only)", () => {
    const pkg = buildValidatedPackage({ endorsements: 3 });
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "from_shared_contact", min: 1 } },
      ],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      expect(result.unmet_requirements).toHaveLength(1);
      expect(result.unmet_requirements[0]).toMatchObject({
        unsupported_condition: true,
      });
    }
  });
});

// ─── AC-015: selective deterministic attestation_type carrier_verified + matching valid attestation → auto_accept

describe("AC-015: selective deterministic attestation_type carrier_verified + matching valid attestation", () => {
  it("returns auto_accept", () => {
    const pkg = buildValidatedPackage({ attestationType: "carrier_verified" });
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        {
          signal_type: "attestation",
          condition: { type: "attestation_type", required: ["carrier_verified"] },
        },
      ],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result).toEqual({ verdict: "auto_accept" });
  });
});

// ─── AC-016: selective deterministic min_count 1 AND registration_age 3 days + 2 valid endorsements + 1 day registered

describe("AC-016: selective deterministic min_count 1 AND registration_age 3 days", () => {
  it("returns auto_insufficient with registration_age entry only (endorsement requirement met)", () => {
    const pkg = buildValidatedPackage({ endorsements: 2 });
    // 1 day registered relative to NOW → fails registration_age 3 days requirement
    const ctx: DirectoryContext = {
      registered_at: NOW - 1 * 86_400_000,
      is_provisional: false,
      conversation_count: 0,
      clean_close_rate: 1.0,
    };
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [
        { signal_type: "endorsement", condition: { type: "min_count", count: 1 } },
        { signal_type: "registration_age", condition: { type: "min_age_days", days: 3 } },
      ],
    };
    const result = evaluateConnectionPackage(pkg, policy, ctx, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      // Only registration_age should be unmet
      expect(result.unmet_requirements).toHaveLength(1);
      expect(result.unmet_requirements[0]).toMatchObject({
        signal_type: "registration_age",
        condition: { type: "min_age_days", days: 3 },
        provided_days: 1,
      });
    }
  });
});

// ─── SI-001: open policy + invalid package → never auto_accept ────────────────

describe("SI-001: open policy + invalid package", () => {
  it("never returns auto_accept when package is invalid", () => {
    const pkg = buildInvalidPackage();
    const policy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).not.toBe("auto_accept");
    expect(result).toEqual({ verdict: "auto_reject", reason: "pseudonym_binding_invalid" });
  });
});

// ─── SI-002: selective min_count 2 + 2 endorsements (1 valid, 1 expired) → expired does not count

describe("SI-002: expired endorsement does not count toward min_count", () => {
  it("1 valid + 1 expired → provided: 1, not 2", () => {
    const validPkg = buildValidatedPackage({ endorsements: 1 });
    const expiredPkg = buildPackageWithExpiredEndorsement();
    const combinedPkg = {
      ...validPkg,
      endorsements: [...validPkg.endorsements, ...expiredPkg.endorsements],
    };
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 2 } }],
    };
    const result = evaluateConnectionPackage(combinedPkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      const endorsementReq = result.unmet_requirements.find(
        (r) => r.signal_type === "endorsement"
      );
      expect(endorsementReq).toBeDefined();
      if (endorsementReq && "provided" in endorsementReq) {
        expect(endorsementReq.provided).toBe(1);
      }
    }
  });
});

// ─── SI-003: selective min_count 2 + 2 endorsements (1 valid, 1 target_mismatch) → target_mismatch does not count

describe("SI-003: target_mismatch endorsement does not count toward min_count", () => {
  it("1 valid + 1 target_mismatch → provided: 1, not 2", () => {
    const validPkg = buildValidatedPackage({ endorsements: 1 });
    const mismatchPkg = buildPackageWithTargetMismatch();
    const combinedPkg = {
      ...validPkg,
      endorsements: [...validPkg.endorsements, ...mismatchPkg.endorsements],
    };
    const policy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 2 } }],
    };
    const result = evaluateConnectionPackage(combinedPkg, policy, CTX_NORMAL, NOW);
    expect(result.verdict).toBe("auto_insufficient");
    if (result.verdict === "auto_insufficient") {
      const endorsementReq = result.unmet_requirements.find(
        (r) => r.signal_type === "endorsement"
      );
      expect(endorsementReq).toBeDefined();
      if (endorsementReq && "provided" in endorsementReq) {
        expect(endorsementReq.provided).toBe(1);
      }
    }
  });
});

// ─── SI-004: open deterministic + valid package + is_provisional: true → auto_reject: is_provisional

describe("SI-004: open deterministic + valid package + is_provisional: true", () => {
  it("returns auto_reject: is_provisional (never auto_accept)", () => {
    const pkg = buildValidatedPackage({ endorsements: 5 });
    const policy: SignalRequirementPolicy = {
      mode: "open",
      review_mode: "deterministic",
      requirements: [],
    };
    const result = evaluateConnectionPackage(pkg, policy, CTX_PROVISIONAL, NOW);
    expect(result.verdict).not.toBe("auto_accept");
    expect(result).toEqual({ verdict: "auto_reject", reason: "is_provisional" });
  });
});
