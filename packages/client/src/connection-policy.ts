/**
 * @cello/client — CELLO-CONNPOL-001
 * Connection policy engine.
 *
 * Evaluates an incoming connection package against a SignalRequirementPolicy
 * and a DirectoryContext to produce a ConnectionReport.
 *
 * ──── Phase P: Pseudocode ────
 *
 * evaluateConnectionPackage(validatedPackage, policy, context, current_timestamp_ms):
 *
 *   1. If policy.mode === 'closed'
 *        return { verdict: 'auto_reject', reason: 'policy_closed' }
 *
 *   2. If context.is_provisional === true
 *        return { verdict: 'auto_reject', reason: 'is_provisional' }
 *
 *   3. If validatedPackage.valid === false
 *        return { verdict: 'auto_reject', reason: 'pseudonym_binding_invalid' }
 *
 *   4. If policy.mode === 'open' && policy.review_mode === 'deterministic'
 *        return { verdict: 'auto_accept' }
 *
 *   5. If policy.mode === 'open' && policy.review_mode === 'inference'
 *        return { verdict: 'pending_agent_review', ... zero unmet requirements ... }
 *
 *   6. For mode 'selective' | 'guarded' (identical in M3):
 *        evaluate each requirement → collect met[] and unmet[]
 *        if review_mode === 'deterministic':
 *          unmet.length === 0 → auto_accept
 *          unmet.length > 0  → auto_insufficient
 *        if review_mode === 'inference':
 *          → pending_agent_review (always, with met/unmet summary)
 *
 * Requirement evaluation (evaluateRequirement):
 *
 *   endorsement + min_count:
 *     count = endorsements.filter(e => e.validation_status === 'valid').length
 *     met iff count >= condition.count
 *     unmet: { signal_type: 'endorsement', condition, provided: count }
 *
 *   pseudonym_age + min_age_days:
 *     age = floor((current_timestamp_ms - pseudonym_binding.created_at) / 86_400_000)
 *     met iff age >= condition.days
 *     unmet: { signal_type: 'pseudonym_age', condition, provided_days: age }
 *
 *   registration_age + min_age_days:
 *     age = floor((current_timestamp_ms - context.registered_at) / 86_400_000)
 *     met iff age >= condition.days
 *     unmet: { signal_type: 'registration_age', condition, provided_days: age }
 *
 *   attestation + attestation_type:
 *     for each type in condition.required: check at least one valid attestation with that type
 *     missing_types = types where no valid attestation exists
 *     met iff missing_types.length === 0
 *     unmet: { signal_type: 'attestation', condition, missing_types }
 *
 *   any requirement with from_shared_contact condition:
 *     unsatisfiable in M3 → { signal_type, condition, unsupported_condition: true }
 *
 * References:
 *   CELLO-CONNPOL-001 story YAML
 */

import type {
  PackageValidationResult,
  ValidatedEndorsement,
  ValidatedAttestation,
  SignalCondition,
} from "@cello/protocol-types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Directory-appended context for the connection requester.
 * Identical in shape to DirectoryContext in @cello/protocol-types.
 * Re-exported here so callers import from a single location.
 */
export type { DirectoryContext } from "@cello/protocol-types";
import type { DirectoryContext } from "@cello/protocol-types";

/**
 * Signal requirement with a condition.
 * Uses the same wire types from @cello/protocol-types.
 */
export interface SignalRequirement {
  signal_type: "endorsement" | "attestation" | "pseudonym_age" | "registration_age";
  condition: SignalCondition;
}

/**
 * The engine's native policy type.
 *
 * Named SignalRequirementPolicy (distinct from ConnectionPolicy in protocol-types)
 * to serve as the engine's authoritative type. Same shape.
 */
export interface SignalRequirementPolicy {
  mode: "open" | "selective" | "guarded" | "closed";
  review_mode: "deterministic" | "inference";
  requirements: SignalRequirement[];
}

/**
 * An unmet requirement with context about what was provided.
 */
export type UnmetRequirement =
  | { signal_type: "endorsement"; condition: SignalCondition; provided: number }
  | { signal_type: "pseudonym_age"; condition: SignalCondition; provided_days: number }
  | { signal_type: "registration_age"; condition: SignalCondition; provided_days: number }
  | { signal_type: "attestation"; condition: SignalCondition; missing_types: string[] }
  | { signal_type: string; condition: SignalCondition; unsupported_condition: true };

/**
 * The result of evaluating a connection package against a policy.
 */
export type ConnectionReport =
  | { verdict: "auto_accept" }
  | { verdict: "auto_reject"; reason: "policy_closed" | "pseudonym_binding_invalid" | "is_provisional" }
  | { verdict: "auto_insufficient"; unmet_requirements: UnmetRequirement[] }
  | {
      verdict: "pending_agent_review";
      policy_summary: {
        mode: string;
        review_mode: "inference";
        requirements_met: SignalRequirement[];
        requirements_unmet: UnmetRequirement[];
      };
      package_summary: {
        pseudonym_label: string;
        endorsement_count: number;
        attestation_types: string[];
        pseudonym_age_days: number;
        registration_age_days: number;
        is_provisional: boolean;
      };
    };

// ─── Default policies ─────────────────────────────────────────────────────────

export const OPEN_POLICY: SignalRequirementPolicy = {
  mode: "open",
  review_mode: "inference",
  requirements: [],
};

export const SELECTIVE_DEFAULT: SignalRequirementPolicy = {
  mode: "selective",
  review_mode: "inference",
  requirements: [{ signal_type: "endorsement", condition: { type: "min_count", count: 1 } }],
};

export const CLOSED_POLICY: SignalRequirementPolicy = {
  mode: "closed",
  review_mode: "deterministic",
  requirements: [],
};

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Evaluate an incoming connection package against a policy and directory context.
 *
 * Evaluation order is hard-coded and non-negotiable:
 *   1. closed → auto_reject: policy_closed
 *   2. is_provisional → auto_reject: is_provisional
 *   3. package.valid === false → auto_reject: pseudonym_binding_invalid
 *   4. open + deterministic → auto_accept
 *   5. open + inference → pending_agent_review (zero requirements)
 *   6. selective/guarded: evaluate requirements, then:
 *      - deterministic + all met → auto_accept
 *      - deterministic + any unmet → auto_insufficient
 *      - inference → pending_agent_review (with met/unmet lists)
 */
export function evaluateConnectionPackage(
  validatedPackage: PackageValidationResult,
  policy: SignalRequirementPolicy,
  context: DirectoryContext,
  current_timestamp_ms: number
): ConnectionReport {
  // Step 1: closed mode — reject before any other check
  if (policy.mode === "closed") {
    return { verdict: "auto_reject", reason: "policy_closed" };
  }

  // Step 2: provisional agent — cannot receive connections
  if (context.is_provisional) {
    return { verdict: "auto_reject", reason: "is_provisional" };
  }

  // Step 3: invalid package — pseudonym binding failed
  if (!validatedPackage.valid) {
    return { verdict: "auto_reject", reason: "pseudonym_binding_invalid" };
  }

  // From here: validatedPackage is valid (valid: true branch)
  const pkg = validatedPackage;

  // Step 4: open + deterministic → auto_accept
  if (policy.mode === "open" && policy.review_mode === "deterministic") {
    return { verdict: "auto_accept" };
  }

  // Step 5: open + inference → pending_agent_review with zero requirements
  if (policy.mode === "open" && policy.review_mode === "inference") {
    return {
      verdict: "pending_agent_review",
      policy_summary: {
        mode: policy.mode,
        review_mode: "inference",
        requirements_met: [],
        requirements_unmet: [],
      },
      package_summary: buildPackageSummary(pkg, context, current_timestamp_ms),
    };
  }

  // Step 6: selective | guarded — evaluate requirements
  const metRequirements: SignalRequirement[] = [];
  const unmetRequirements: UnmetRequirement[] = [];

  for (const req of policy.requirements) {
    const result = evaluateRequirement(req, pkg, context, current_timestamp_ms);
    if (result === null) {
      metRequirements.push(req);
    } else {
      unmetRequirements.push(result);
    }
  }

  if (policy.review_mode === "deterministic") {
    if (unmetRequirements.length === 0) {
      return { verdict: "auto_accept" };
    }
    return { verdict: "auto_insufficient", unmet_requirements: unmetRequirements };
  }

  // review_mode === 'inference'
  return {
    verdict: "pending_agent_review",
    policy_summary: {
      mode: policy.mode,
      review_mode: "inference",
      requirements_met: metRequirements,
      requirements_unmet: unmetRequirements,
    },
    package_summary: buildPackageSummary(pkg, context, current_timestamp_ms),
  };
}

// ─── Requirement evaluation ───────────────────────────────────────────────────

/**
 * Evaluate a single requirement.
 *
 * Returns null if met, or an UnmetRequirement if not.
 */
function evaluateRequirement(
  req: SignalRequirement,
  pkg: Extract<PackageValidationResult, { valid: true }>,
  context: DirectoryContext,
  current_timestamp_ms: number
): UnmetRequirement | null {
  const { condition } = req;

  // from_shared_contact is M6-only — always unsatisfiable in M3
  if (condition.type === "from_shared_contact") {
    return { signal_type: req.signal_type, condition, unsupported_condition: true };
  }

  switch (req.signal_type) {
    case "endorsement":
      return evaluateEndorsementRequirement(condition, pkg.endorsements);

    case "pseudonym_age":
      return evaluatePseudonymAgeRequirement(condition, pkg.pseudonym_binding.created_at, current_timestamp_ms);

    case "registration_age":
      return evaluateRegistrationAgeRequirement(condition, context.registered_at, current_timestamp_ms);

    case "attestation":
      return evaluateAttestationRequirement(condition, pkg.attestations);

    default:
      // Unknown signal_type — treat as unsupported
      return { signal_type: req.signal_type, condition, unsupported_condition: true };
  }
}

function evaluateEndorsementRequirement(
  condition: SignalCondition,
  endorsements: ValidatedEndorsement[]
): UnmetRequirement | null {
  if (condition.type === "min_count") {
    const validCount = endorsements.filter((e) => e.validation_status === "valid").length;
    if (validCount >= condition.count) {
      return null;
    }
    return { signal_type: "endorsement", condition, provided: validCount };
  }
  // Unrecognized condition for endorsement — unsupported
  return { signal_type: "endorsement", condition, unsupported_condition: true };
}

function evaluatePseudonymAgeRequirement(
  condition: SignalCondition,
  created_at: number,
  current_timestamp_ms: number
): UnmetRequirement | null {
  if (condition.type === "min_age_days") {
    const ageDays = Math.floor((current_timestamp_ms - created_at) / 86_400_000);
    if (ageDays >= condition.days) {
      return null;
    }
    return { signal_type: "pseudonym_age", condition, provided_days: ageDays };
  }
  return { signal_type: "pseudonym_age", condition, unsupported_condition: true };
}

function evaluateRegistrationAgeRequirement(
  condition: SignalCondition,
  registered_at: number,
  current_timestamp_ms: number
): UnmetRequirement | null {
  if (condition.type === "min_age_days") {
    const ageDays = Math.floor((current_timestamp_ms - registered_at) / 86_400_000);
    if (ageDays >= condition.days) {
      return null;
    }
    return { signal_type: "registration_age", condition, provided_days: ageDays };
  }
  return { signal_type: "registration_age", condition, unsupported_condition: true };
}

function evaluateAttestationRequirement(
  condition: SignalCondition,
  attestations: ValidatedAttestation[]
): UnmetRequirement | null {
  if (condition.type === "attestation_type") {
    const validAttestationTypes = new Set(
      attestations
        .filter((a) => a.validation_status === "valid")
        .map((a) => a.attestation_type)
    );
    const missingTypes = condition.required.filter((t) => !validAttestationTypes.has(t));
    if (missingTypes.length === 0) {
      return null;
    }
    return { signal_type: "attestation", condition, missing_types: missingTypes };
  }
  return { signal_type: "attestation", condition, unsupported_condition: true };
}

// ─── Package summary builder ──────────────────────────────────────────────────

function buildPackageSummary(
  pkg: Extract<PackageValidationResult, { valid: true }>,
  context: DirectoryContext,
  current_timestamp_ms: number
): {
  pseudonym_label: string;
  endorsement_count: number;
  attestation_types: string[];
  pseudonym_age_days: number;
  registration_age_days: number;
  is_provisional: boolean;
} {
  const pseudonymAgeDays = Math.floor(
    (current_timestamp_ms - pkg.pseudonym_binding.created_at) / 86_400_000
  );
  const registrationAgeDays = Math.floor(
    (current_timestamp_ms - context.registered_at) / 86_400_000
  );
  const validEndorsementCount = pkg.endorsements.filter(
    (e) => e.validation_status === "valid"
  ).length;
  const validAttestationTypes = [
    ...new Set(
      pkg.attestations
        .filter((a) => a.validation_status === "valid")
        .map((a) => a.attestation_type)
    ),
  ];

  return {
    pseudonym_label: pkg.pseudonym_binding.pseudonym_label,
    endorsement_count: validEndorsementCount,
    attestation_types: validAttestationTypes,
    pseudonym_age_days: pseudonymAgeDays,
    registration_age_days: registrationAgeDays,
    is_provisional: context.is_provisional,
  };
}
