/**
 * @cello/protocol-types — CELLO-CONNPOL-001
 * Connection Policy Engine: evaluates a validated connection package against
 * a configured policy and returns a structured ConnectionReport.
 *
 * Pure logic — no network, no libp2p, no async operations.
 *
 * ──── Phase P: Pseudocode ────
 *
 * EVALUATION ORDER (critical — must be exactly this):
 *
 *   1. policy.mode === 'closed'
 *      → return { verdict: 'auto_reject', reason: 'policy_closed' }
 *      (no further checks — doesn't even look at context or package)
 *
 *   2. context.is_provisional === true
 *      → return { verdict: 'auto_reject', reason: 'is_provisional' }
 *      (applies to all non-closed modes — provisional agents cannot receive connections)
 *
 *   3. validatedPackage.valid === false
 *      → return { verdict: 'auto_reject', reason: 'pseudonym_binding_invalid' }
 *      (valid pseudonym binding is the minimum prerequisite for any non-rejected outcome)
 *
 *   4. Evaluate requirements (or shortcut for open + deterministic)
 *      4a. If mode === 'open' AND review_mode === 'deterministic':
 *          → return { verdict: 'auto_accept' }
 *          (open mode accepts everything; no requirements evaluated)
 *      4b. Evaluate each requirement against the package:
 *          - endorsement / min_count: count valid endorsements only
 *          - pseudonym_age / min_age_days: floor((ts - created_at) / 86400000) >= days
 *          - registration_age / min_age_days: floor((ts - registered_at) / 86400000) >= days
 *          - attestation / attestation_type: each required type has >= 1 valid attestation
 *          - any / from_shared_contact: always unsatisfiable in M3 → unsupported_condition: true
 *
 *   5. Based on review_mode:
 *      - 'deterministic':
 *          if unmet.length === 0 → { verdict: 'auto_accept' }
 *          else → { verdict: 'auto_insufficient', unmet_requirements: unmet }
 *      - 'inference':
 *          always → { verdict: 'pending_agent_review', policy_summary, package_summary }
 *          (even if all requirements met — agent decides)
 *
 * HOW review_mode CHANGES OUTPUT TYPE:
 *   - 'deterministic': binary outcome — auto_accept or auto_insufficient
 *     The engine decides on behalf of the agent with no agent involvement.
 *   - 'inference': always pending_agent_review with structured summaries.
 *     The agent reads the report via cello_await_connection_request and decides.
 *     M3 default is 'inference' — trust stores are empty, so auto-accept would
 *     admit everyone without judgment.
 *
 * CONDITION TYPE → PACKAGE FIELD MAPPING:
 *   endorsement / min_count   → validatedPackage.endorsements[*].validation_status === 'valid'
 *   pseudonym_age / min_age_days → validatedPackage.pseudonym_binding.created_at
 *   registration_age / min_age_days → context.registered_at
 *   attestation / attestation_type → validatedPackage.attestations[*] where validation_status === 'valid'
 *   any / from_shared_contact → not available in M3 (shared contact graph not built until M6)
 *
 * WHY from_shared_contact IS UNSATISFIABLE IN M3:
 *   The shared-contact graph requires both agents to have registered contacts in the
 *   directory and the directory to support graph queries. Neither is built until M6.
 *   In M3, this condition is treated as permanently unsatisfiable. Policies using it
 *   MUST be 'inference' mode in M3 (so the agent can override); in 'deterministic'
 *   mode they will always reject. This is intentional — M3 operators should not
 *   deploy deterministic from_shared_contact policies.
 *
 * package_summary IN pending_agent_review:
 *   Contains summary fields only — no raw signed blobs forwarded to the agent.
 *   The agent gets endorsement_count (valid only), attestation_types (valid only),
 *   age fields, and is_provisional. The agent does NOT receive raw endorsements,
 *   attestations, or the pseudonym_binding bytes.
 */

import type {
  PackageValidationResult,
  ConnectionPolicy,
  SignalRequirement,
  SignalCondition,
  DirectoryContext,
} from "./connection-package.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * An unmet requirement in a ConnectionReport.
 *
 * The `unsupported_condition` variant covers conditions the engine cannot
 * evaluate in M3 (e.g. from_shared_contact).
 */
export type UnmetRequirement =
  | { signal_type: "endorsement"; condition: SignalCondition; provided: number }
  | { signal_type: "pseudonym_age"; condition: SignalCondition; provided_days: number }
  | { signal_type: "registration_age"; condition: SignalCondition; provided_days: number }
  | { signal_type: "attestation"; condition: SignalCondition; missing_types: string[] }
  | { signal_type: string; condition: SignalCondition; unsupported_condition: true };

/**
 * Result of evaluating a connection package against a policy.
 *
 * - auto_accept: package satisfies all requirements; auto-approved.
 * - auto_reject: package rejected immediately; reason indicates why.
 * - auto_insufficient: package evaluated but failed to meet requirements.
 * - pending_agent_review: agent must decide; includes structured summaries.
 */
export type ConnectionReport =
  | { verdict: "auto_accept" }
  | {
      verdict: "auto_reject";
      reason: "policy_closed" | "pseudonym_binding_invalid" | "is_provisional";
    }
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

// ─── Default Policies ─────────────────────────────────────────────────────────

/**
 * Open policy with inference review mode.
 * Presents every valid package to the agent for a decision.
 * M3 default — safe starting point with empty trust stores.
 */
export const OPEN_POLICY: ConnectionPolicy = {
  mode: "open",
  review_mode: "inference",
  requirements: [],
};

/**
 * Closed policy. Auto-rejects all connection requests immediately.
 */
export const CLOSED_POLICY: ConnectionPolicy = {
  mode: "closed",
  review_mode: "deterministic",
  requirements: [],
};

/**
 * Selective policy requiring at least 1 valid endorsement, inference mode.
 * Agent sees the report and makes the final call.
 */
export const SELECTIVE_DEFAULT: ConnectionPolicy = {
  mode: "selective",
  review_mode: "inference",
  requirements: [
    { signal_type: "endorsement", condition: { type: "min_count", count: 1 } },
  ],
};

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Evaluate a validated connection package against a policy.
 *
 * Evaluation order (CRITICAL — must be exactly this):
 *   1. policy.mode === 'closed' → auto_reject (policy_closed)
 *   2. context.is_provisional   → auto_reject (is_provisional)
 *   3. package.valid === false  → auto_reject (pseudonym_binding_invalid)
 *   4. Evaluate requirements
 *   5. Route by review_mode → deterministic or inference outcome
 *
 * @param validatedPackage - Output of validateConnectionPackage (CONNREQ-001)
 * @param policy - The receiver's configured connection policy
 * @param context - Directory-provided context about the requester
 * @param current_timestamp_ms - Current Unix timestamp in milliseconds (for age calculations)
 */
export function evaluateConnectionPackage(
  validatedPackage: PackageValidationResult,
  policy: ConnectionPolicy,
  context: DirectoryContext,
  current_timestamp_ms: number
): ConnectionReport {
  // Step 1: closed mode → immediate rejection (does not examine package or context)
  if (policy.mode === "closed") {
    return { verdict: "auto_reject", reason: "policy_closed" };
  }

  // Step 2: provisional agents cannot receive connections
  if (context.is_provisional) {
    return { verdict: "auto_reject", reason: "is_provisional" };
  }

  // Step 3: invalid pseudonym binding → whole package rejected
  if (!validatedPackage.valid) {
    return { verdict: "auto_reject", reason: "pseudonym_binding_invalid" };
  }

  // From this point, validatedPackage.valid === true
  const pkg = validatedPackage;

  // Count valid endorsements once — used by both requirement evaluation and package_summary
  const validEndorsementCount = pkg.endorsements.filter(
    (e) => e.validation_status === "valid"
  ).length;

  // Collect valid attestation types once — used by both requirement evaluation and package_summary
  const validAttestationTypes = pkg.attestations
    .filter((a) => a.validation_status === "valid")
    .map((a) => a.attestation_type);

  // Compute age fields once
  const pseudonymAgeDays = Math.floor(
    (current_timestamp_ms - pkg.pseudonym_binding.created_at) / 86_400_000
  );
  const registrationAgeDays = Math.floor(
    (current_timestamp_ms - context.registered_at) / 86_400_000
  );

  // Step 4: open + deterministic → auto_accept (no requirements to evaluate)
  if (policy.mode === "open" && policy.review_mode === "deterministic") {
    return { verdict: "auto_accept" };
  }

  // Step 4: evaluate requirements
  const metRequirements: SignalRequirement[] = [];
  const unmetRequirements: UnmetRequirement[] = [];

  for (const req of policy.requirements) {
    const unmet = evaluateRequirement(
      req,
      validEndorsementCount,
      validAttestationTypes,
      pseudonymAgeDays,
      registrationAgeDays
    );
    if (unmet === null) {
      metRequirements.push(req);
    } else {
      unmetRequirements.push(unmet);
    }
  }

  // Step 5: route by review_mode
  if (policy.review_mode === "deterministic") {
    if (unmetRequirements.length === 0) {
      return { verdict: "auto_accept" };
    }
    return { verdict: "auto_insufficient", unmet_requirements: unmetRequirements };
  }

  // review_mode === 'inference' — always pending_agent_review
  // (NOTE: policy.mode === 'open' with inference is handled here too — falls through
  // from above because it doesn't hit the open+deterministic shortcut)
  return {
    verdict: "pending_agent_review",
    policy_summary: {
      mode: policy.mode,
      review_mode: "inference",
      requirements_met: metRequirements,
      requirements_unmet: unmetRequirements,
    },
    package_summary: {
      pseudonym_label: pkg.pseudonym_binding.pseudonym_label,
      endorsement_count: validEndorsementCount,
      attestation_types: validAttestationTypes,
      pseudonym_age_days: pseudonymAgeDays,
      registration_age_days: registrationAgeDays,
      is_provisional: context.is_provisional,
    },
  };
}

// ─── Requirement evaluator ────────────────────────────────────────────────────

/**
 * Evaluate a single signal requirement.
 *
 * Returns null if the requirement is satisfied (met).
 * Returns an UnmetRequirement if unsatisfied.
 */
function evaluateRequirement(
  req: SignalRequirement,
  validEndorsementCount: number,
  validAttestationTypes: string[],
  pseudonymAgeDays: number,
  registrationAgeDays: number
): UnmetRequirement | null {
  const { signal_type, condition } = req;

  // from_shared_contact: always unsatisfiable in M3
  if (condition.type === "from_shared_contact") {
    return { signal_type, condition, unsupported_condition: true };
  }

  switch (signal_type) {
    case "endorsement": {
      // Only min_count makes sense for endorsements
      if (condition.type !== "min_count") {
        // Unsupported condition type for this signal
        return { signal_type, condition, unsupported_condition: true };
      }
      const required = condition.count;
      if (validEndorsementCount >= required) {
        return null; // met
      }
      return { signal_type: "endorsement", condition, provided: validEndorsementCount };
    }

    case "pseudonym_age": {
      if (condition.type !== "min_age_days") {
        return { signal_type, condition, unsupported_condition: true };
      }
      const required = condition.days;
      if (pseudonymAgeDays >= required) {
        return null; // met
      }
      return { signal_type: "pseudonym_age", condition, provided_days: pseudonymAgeDays };
    }

    case "registration_age": {
      if (condition.type !== "min_age_days") {
        return { signal_type, condition, unsupported_condition: true };
      }
      const required = condition.days;
      if (registrationAgeDays >= required) {
        return null; // met
      }
      return {
        signal_type: "registration_age",
        condition,
        provided_days: registrationAgeDays,
      };
    }

    case "attestation": {
      if (condition.type !== "attestation_type") {
        return { signal_type, condition, unsupported_condition: true };
      }
      const requiredTypes = condition.required;
      const missingTypes = requiredTypes.filter(
        (t) => !validAttestationTypes.includes(t)
      );
      if (missingTypes.length === 0) {
        return null; // met
      }
      return { signal_type: "attestation", condition, missing_types: missingTypes };
    }

    default: {
      // Unknown signal_type — unsupported in M3
      return { signal_type, condition, unsupported_condition: true };
    }
  }
}
