/**
 * CELLO-DEPLOY-005 — Smoke test scenarios (AC-002)
 *
 * These 8 scenarios run against a live staging environment via its public ALB URL.
 * They are executed by the CodeBuild SmokeTestBuild project in the pipeline.
 *
 * The smoke test runner runs as a separate OS process from all ECS tasks.
 * It connects to the staging directory via HTTP/WebSocket over the ALB URL.
 * It has no direct database access (AC-002 process isolation constraint).
 *
 * Canonical tool names (AC-008, post-M4-round3):
 *   - cello_receive        — any-session receive (no session_id parameter)
 *   - cello_receive_session — session-locked receive (requires session_id parameter)
 * The pre-M4-round3 naming was updated; any reference to the old name silently fails.
 *
 * P — Pseudocode per scenario:
 *
 * Scenario 1 — Two agent sessions established:
 *   1. Start two agents (A and B) configured to connect to STAGING_DIRECTORY_URL
 *   2. A registers, B registers
 *   3. A requests connection to B
 *   4. B accepts via cello_await_connection_request + cello_accept_connection
 *   5. A initiates session; B awaits via cello_await_session
 *   6. Assert both session IDs are valid
 *
 * Scenario 2 — FROST ceremony completes for both agents:
 *   1. Setup same as Scenario 1
 *   2. Assert A and B have primary_pubkey set after registration
 *   3. Assert session assignment carries frost signature type
 *
 * Scenario 3 — Message exchange with Merkle verification:
 *   1. Scenario 1 setup + session established
 *   2. A sends message to B
 *   3. B calls cello_receive to retrieve message
 *   4. B calls cello_get_inclusion_proof to verify Merkle inclusion
 *   5. Assert proof valid
 *
 * Scenario 4 — Session seal with directory confirmation:
 *   1. Scenario 3 + message sent
 *   2. A calls cello_close_session
 *   3. A polls cello_list_sessions until session status is 'sealed'
 *   4. A calls cello_get_sealed_receipt
 *   5. Assert sealed_receipt contains sealed_root
 *
 * Scenario 5 — Relay failure simulation and reassignment:
 *   1. Two agents establish session
 *   2. Send one message
 *   3. Verify relay assignment exists
 *   Note: live relay failure simulation is deferred; structural assertion only
 *
 * Scenario 6 — Pre-seal reconciliation with one-sided delivery failure:
 *   1. A establishes session with B
 *   2. A sends message; B does NOT receive it (delivery failure simulation)
 *   3. A initiates seal; directory runs reconciliation
 *   4. Assert seal completes despite one-sided delivery failure
 *   Note: this scenario requires the delivery_grace_seconds timeout to elapse;
 *   in staging env this is tested at architecture level
 *
 * Scenario 7 — Concurrent connection fan-out (CONNREQ-003):
 *   1. A sends cello_request_connection to B and C concurrently (no await between)
 *   2. Both resolve with { result: 'established' }
 *   3. A sends second cello_request_connection to B while original in-flight
 *   4. Second request returns connection_request_in_flight
 *
 * Scenario 8 — Multi-session fan-in (SESSION-007):
 *   1. B opens two sessions with A from separate processes (S1 and S2)
 *   2. A is blocked in cello_receive on S1
 *   3. B seals S1
 *   4. A's blocked cello_receive returns session_sealed without A calling close
 *   5. A's next cello_receive returns B's message from S2
 *   6. other_sessions_pending hint present when S2 is waiting
 *
 * A — Architecture:
 *   These scenarios are structured as test descriptions used both:
 *   (a) by the CodeBuild smoke test buildspec (runs against live staging ALB)
 *   (b) as documentation/specification for what staging must support
 *
 *   The actual test execution is via the shell scripts in this directory's
 *   parent directory (packages/e2e-tests/src/smoke/), invoked by the buildspec.
 *
 *   The STAGING_DIRECTORY_URL environment variable is injected by CodePipeline
 *   at smoke test stage invocation time (read from cello-ecs-directory-{env}
 *   CloudFormation stack output AlbDnsName — never hardcoded).
 */

// ─── Scenario metadata for the CodeBuild runner ──────────────────────────────

export interface SmokeScenario {
  /** Scenario number (1–8) matching AC-002 specification */
  number: number;
  /** Human-readable name for pipeline.staging.smoke_test.failed reporting */
  name: string;
  /** AC-002 scenario description */
  description: string;
}

export const SMOKE_SCENARIOS: SmokeScenario[] = [
  {
    number: 1,
    name: "two_sessions_established",
    description: "Two agent sessions established via staging ALB",
  },
  {
    number: 2,
    name: "frost_ceremony_completes",
    description: "FROST ceremony completes for both agents",
  },
  {
    number: 3,
    name: "message_exchange_with_merkle",
    description: "Message exchange with Merkle verification",
  },
  {
    number: 4,
    name: "session_seal_with_directory",
    description: "Session seal with directory confirmation",
  },
  {
    number: 5,
    name: "relay_failure_and_reassignment",
    description: "Relay failure simulation and reassignment",
  },
  {
    number: 6,
    name: "preseal_reconciliation",
    description: "Pre-seal reconciliation with one-sided delivery failure",
  },
  {
    number: 7,
    name: "concurrent_connection_fanout",
    description: "Concurrent connection fan-out — CONNREQ-003",
  },
  {
    number: 8,
    name: "multi_session_fanin",
    description: "Multi-session fan-in — SESSION-007",
  },
];

// ─── Observability event names (AC-002 compliant) ────────────────────────────

export const SMOKE_EVENTS = {
  /** All 8 scenarios passed — pipeline.staging.smoke_test.passed */
  passed: "pipeline.staging.smoke_test.passed",
  /** One scenario failed — pipeline.staging.smoke_test.failed */
  failed: "pipeline.staging.smoke_test.failed",
} as const;
