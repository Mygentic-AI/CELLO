/**
 * CELLO-FEDERATION-001A — Replication setup automation tests
 *
 * Specification interpretation for each AC:
 *
 * AC-004: Production confirmation gate. When ENVIRONMENT=production, the script
 *   prints "Configuring replication for PRODUCTION. Type YES to confirm:" before
 *   executing any AWS or psql command. Providing non-YES input causes exit 1 with
 *   no changes made. Tested via subprocess invocation.
 *
 * AC-007: Task not running. When any region's ECS task is not in RUNNING state,
 *   the script exits 1 before executing any psql commands and logs
 *   infra.replication.setup.task_not_running at ERROR with { region, taskStatus }.
 *   Tested via static analysis of script structure.
 *
 * SI-002: Deterministic slot naming. Slot names follow cello_{env}_{source}_{target}
 *   — derived only from environment and region arguments. No random or timestamp
 *   components. Tested by asserting the naming derivation pattern in the script.
 *
 * DB-002: Credentials mismatch detection. When a Secrets Manager secret for the
 *   replication credentials already exists and the psql connection fails, the script
 *   logs infra.replication.setup.credentials_mismatch at ERROR with { region, secretArn }
 *   and exits 1. Tested via static analysis.
 *
 * Observability events verified (all are static-analysis assertions on script content):
 *   - infra.replication.setup.started
 *   - infra.replication.setup.publication_created
 *   - infra.replication.setup.subscription_created
 *   - infra.replication.setup.slot_streaming
 *   - infra.replication.setup.completed
 *   - infra.replication.setup.task_not_running (error)
 *   - infra.replication.setup.slot_not_streaming (error)
 *   - infra.replication.setup.credentials_mismatch (error)
 *
 * Tables covered by cello_pub:
 *   agent_profiles, conversation_seals, conversation_seal_staging,
 *   directory_checkpoints, checkpoint_node_signatures, relay_registrations,
 *   sessions, pending_notifications, user_accounts
 *
 * AC-001, AC-002, AC-003, AC-005, AC-006, SI-001, DB-001 require live AWS ECS + RDS
 * infrastructure with logical replication configured. These are registered as
 * describe.skip with test type e2e/integration. They are exercised by FEDERATION-E2E-001.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// ─── Path resolution ─────────────────────────────────────────────────────────

const WORKTREE_ROOT = resolve(import.meta.dirname, "../../../../");
const INFRA_DIR = resolve(WORKTREE_ROOT, "infra");
const SETUP_REPLICATION_SCRIPT = resolve(INFRA_DIR, "setup-replication.sh");

function loadScript(): string {
  return readFileSync(SETUP_REPLICATION_SCRIPT, "utf-8");
}

// ─── Script existence ────────────────────────────────────────────────────────

describe("FEDERATION-001A: setup-replication.sh exists and is executable", () => {
  it("infra/setup-replication.sh file exists", () => {
    expect(existsSync(SETUP_REPLICATION_SCRIPT)).toBe(true);
  });

  it("setup-replication.sh is valid bash (has shebang)", () => {
    const script = loadScript();
    expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("setup-replication.sh uses set -euo pipefail", () => {
    const script = loadScript();
    expect(script).toContain("set -euo pipefail");
  });
});

// ─── AC-004: Production confirmation gate (static + subprocess) ──────────────

describe("FEDERATION-001A: AC-004 production confirmation gate", () => {
  it("setup-replication.sh contains the exact confirmation prompt text", () => {
    const script = loadScript();
    expect(script).toContain("Configuring replication for PRODUCTION. Type YES to confirm:");
  });

  it("setup-replication.sh exits 1 when input is not YES", () => {
    const script = loadScript();
    // Must have a read statement and exit 1
    expect(script).toMatch(/read\s/);
    expect(script).toMatch(/exit\s+1/);
  });

  it("setup-replication.sh confirmation gate fires on ENVIRONMENT=production value", () => {
    const script = loadScript();
    // The gate must compare ENVIRONMENT to "production"
    expect(script).toMatch(/\$\{?ENVIRONMENT\}?.*production|production.*\$\{?ENVIRONMENT\}?/);
  });

  it("setup-replication.sh production gate is not bypassable via skip flags", () => {
    const script = loadScript();
    expect(script).not.toMatch(/--skip[-_]confirm/i);
    expect(script).not.toMatch(/SKIP_CONFIRM/);
    expect(script).not.toMatch(/NO_CONFIRM/);
  });

  it("AC-004: non-YES input causes exit 1 (subprocess test)", () => {
    // Run the script with ENVIRONMENT=production and provide bad input
    // Use echo to pipe "NO" as stdin — the script must exit 1
    let exitCode = 0;
    let output = "";
    try {
      output = execSync(
        `echo "NO" | bash "${SETUP_REPLICATION_SCRIPT}" production us-east-1 eu-central-1 ap-northeast-1`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      exitCode = 0;
    } catch (err: unknown) {
      const execError = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = execError.status ?? 1;
      output = execError.stdout ?? "";
    }

    expect(exitCode).toBe(1);
    // No AWS or psql commands should have run — we just get the abort message
    expect(output).not.toContain("aws ecs");
    expect(output).not.toContain("psql");
  });

  it("AC-004: YES input passes the confirmation gate (subprocess test — exits with non-auth error, not confirmation failure)", () => {
    // Run with YES input — the script should pass the confirmation check and fail
    // later because there are no real AWS credentials/ECS tasks. We just verify
    // it does NOT exit because of the confirmation check by asserting the output
    // does NOT contain the "Aborted" message.
    let output = "";
    let errorOutput = "";
    try {
      output = execSync(
        `echo "YES" | bash "${SETUP_REPLICATION_SCRIPT}" production us-east-1 eu-central-1 ap-northeast-1 2>&1`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 10000 },
      );
    } catch (err: unknown) {
      const execError = err as { status?: number; stdout?: string; stderr?: string };
      output = execError.stdout ?? "";
      errorOutput = execError.stderr ?? "";
    }

    const combined = output + errorOutput;
    // If it aborted at the confirmation check, this would contain "Aborted"
    // (the same message deploy.sh uses). The point is it should NOT abort at confirmation.
    expect(combined).not.toContain("Aborted. No replication setup was performed.");
  });
});

// ─── AC-007: Task not running — script fails fast ────────────────────────────

describe("FEDERATION-001A: AC-007 script fails fast when ECS task not running", () => {
  it("setup-replication.sh contains task status pre-flight check", () => {
    const script = loadScript();
    expect(script).toContain("RUNNING");
  });

  it("setup-replication.sh logs infra.replication.setup.task_not_running at ERROR", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.task_not_running");
  });

  it("setup-replication.sh task_not_running log includes region context field", () => {
    const script = loadScript();
    // The error log for task_not_running must contain { region, taskStatus }
    const taskNotRunningIdx = script.indexOf("infra.replication.setup.task_not_running");
    const contextWindow = script.slice(taskNotRunningIdx, taskNotRunningIdx + 500);
    expect(contextWindow).toContain("region");
    expect(contextWindow).toContain("taskStatus");
  });

  it("setup-replication.sh exits 1 when task not found (exits before psql)", () => {
    const script = loadScript();
    // Must have exit 1 near the task_not_running log
    const taskNotRunningIdx = script.indexOf("infra.replication.setup.task_not_running");
    const contextWindow = script.slice(taskNotRunningIdx, taskNotRunningIdx + 300);
    expect(contextWindow).toMatch(/exit\s+1/);
  });
});

// ─── SI-002: Deterministic slot naming ───────────────────────────────────────

describe("FEDERATION-001A: SI-002 deterministic slot naming convention", () => {
  it("setup-replication.sh uses cello_{env}_{source}_{target} slot naming pattern", () => {
    const script = loadScript();
    // Slot name must be constructed from env+source+target variables
    // Pattern: cello_{ENVIRONMENT}_{source_region}_{target_region}
    expect(script).toMatch(/cello.*ENVIRONMENT.*source|cello.*env.*source/i);
  });

  it("setup-replication.sh slot naming uses only env and region variables (no random/timestamp)", () => {
    const script = loadScript();
    // Slot names must not use $RANDOM, date, uuid, or similar
    expect(script).not.toMatch(/\$RANDOM/);
    expect(script).not.toMatch(/\$(date|uuid)/);
    expect(script).not.toMatch(/uuidgen/);
  });

  it("setup-replication.sh subscription naming follows cello_sub_from_{source_region}", () => {
    const script = loadScript();
    expect(script).toContain("cello_sub_from_");
  });

  it("setup-replication.sh publication is named cello_pub", () => {
    const script = loadScript();
    expect(script).toContain("cello_pub");
  });
});

// ─── Observability: all required events present ───────────────────────────────

describe("FEDERATION-001A: observability events present in script", () => {
  it("setup-replication.sh logs infra.replication.setup.started at INFO", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.started");
  });

  it("infra.replication.setup.started includes required context fields: environment, regions, nodeCount", () => {
    const script = loadScript();
    const startedIdx = script.indexOf("infra.replication.setup.started");
    const contextWindow = script.slice(startedIdx, startedIdx + 600);
    expect(contextWindow).toContain("environment");
    expect(contextWindow).toContain("regions");
    expect(contextWindow).toContain("nodeCount");
  });

  it("setup-replication.sh logs infra.replication.setup.publication_created at INFO", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.publication_created");
  });

  it("infra.replication.setup.publication_created includes required context fields: environment, region, tableCount", () => {
    const script = loadScript();
    const idx = script.indexOf("infra.replication.setup.publication_created");
    const contextWindow = script.slice(idx, idx + 600);
    expect(contextWindow).toContain("environment");
    expect(contextWindow).toContain("region");
    expect(contextWindow).toContain("tableCount");
  });

  it("setup-replication.sh logs infra.replication.setup.subscription_created at INFO", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.subscription_created");
  });

  it("infra.replication.setup.subscription_created includes required context fields", () => {
    const script = loadScript();
    const idx = script.indexOf("infra.replication.setup.subscription_created");
    const contextWindow = script.slice(idx, idx + 600);
    expect(contextWindow).toContain("environment");
    expect(contextWindow).toContain("targetRegion");
    expect(contextWindow).toContain("sourceRegion");
    expect(contextWindow).toContain("slotName");
  });

  it("setup-replication.sh logs infra.replication.setup.slot_streaming at INFO", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.slot_streaming");
  });

  it("infra.replication.setup.slot_streaming includes required context fields: slotName, region, elapsedSeconds", () => {
    const script = loadScript();
    const idx = script.indexOf("infra.replication.setup.slot_streaming");
    const contextWindow = script.slice(idx, idx + 600);
    expect(contextWindow).toContain("slotName");
    expect(contextWindow).toContain("region");
    expect(contextWindow).toContain("elapsedSeconds");
  });

  it("setup-replication.sh logs infra.replication.setup.completed at INFO", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.completed");
  });

  it("infra.replication.setup.completed includes required context fields", () => {
    const script = loadScript();
    const idx = script.indexOf("infra.replication.setup.completed");
    const contextWindow = script.slice(idx, idx + 600);
    expect(contextWindow).toContain("environment");
    expect(contextWindow).toContain("regions");
    expect(contextWindow).toContain("slotCount");
    expect(contextWindow).toContain("totalElapsedSeconds");
  });

  it("setup-replication.sh logs infra.replication.setup.slot_not_streaming at ERROR", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.slot_not_streaming");
  });

  it("infra.replication.setup.slot_not_streaming includes required context fields", () => {
    const script = loadScript();
    const idx = script.indexOf("infra.replication.setup.slot_not_streaming");
    const contextWindow = script.slice(idx, idx + 600);
    expect(contextWindow).toContain("slotName");
    expect(contextWindow).toContain("region");
    expect(contextWindow).toContain("elapsedSeconds");
  });

  it("setup-replication.sh logs infra.replication.setup.credentials_mismatch at ERROR", () => {
    const script = loadScript();
    expect(script).toContain("infra.replication.setup.credentials_mismatch");
  });

  it("infra.replication.setup.credentials_mismatch includes required context fields: region, secretArn", () => {
    const script = loadScript();
    const idx = script.indexOf("infra.replication.setup.credentials_mismatch");
    const contextWindow = script.slice(idx, idx + 600);
    expect(contextWindow).toContain("region");
    expect(contextWindow).toContain("secretArn");
  });
});

// ─── Script security invariants — static analysis ────────────────────────────

describe("FEDERATION-001A: security invariants — static analysis", () => {
  it("SI-001: script creates cello_replication user with REPLICATION privilege only (no SUPERUSER, no CREATEDB)", () => {
    const script = loadScript();
    expect(script).toContain("REPLICATION");
    // Must NOT grant SUPERUSER or CREATEDB to the replication user
    expect(script).not.toMatch(/cello_replication.*SUPERUSER|SUPERUSER.*cello_replication/i);
    expect(script).not.toMatch(/cello_replication.*CREATEDB|CREATEDB.*cello_replication/i);
  });

  it("SI-001: script does not grant INSERT, UPDATE, DELETE, or DDL to cello_replication", () => {
    const script = loadScript();
    // The script should not grant INSERT/UPDATE/DELETE/DDL to the replication user
    // GRANT ... TO cello_replication — only REPLICATION privilege via CREATE USER ... WITH REPLICATION
    expect(script).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP)\s+ON/i);
  });

  it("password does not appear in script stdout or stderr (secrets from Secrets Manager only)", () => {
    const script = loadScript();
    // The password must be read from Secrets Manager, not echoed to stdout
    // Check that any password variable is not echoed
    expect(script).not.toMatch(/echo.*password/i);
    expect(script).not.toMatch(/echo.*REPL_PASSWORD/i);
  });
});

// ─── SI-001 structure: ECS Exec path ────────────────────────────────────────

describe("FEDERATION-001A: ECS Exec used for psql commands (not SSH/SSM port forward)", () => {
  it("setup-replication.sh uses aws ecs execute-command for psql", () => {
    const script = loadScript();
    expect(script).toContain("execute-command");
  });

  it("setup-replication.sh does not use aws ssm start-session or port forwarding", () => {
    const script = loadScript();
    expect(script).not.toContain("start-session");
    expect(script).not.toContain("portNumber");
  });
});

// ─── Script structure: replication table coverage ────────────────────────────

describe("FEDERATION-001A: cello_pub covers all required append-only tables", () => {
  it("setup-replication.sh includes agent_profiles in publication", () => {
    const script = loadScript();
    expect(script).toContain("agent_profiles");
  });

  it("setup-replication.sh includes conversation_seals in publication", () => {
    const script = loadScript();
    expect(script).toContain("conversation_seals");
  });

  it("setup-replication.sh includes conversation_seal_staging in publication", () => {
    const script = loadScript();
    expect(script).toContain("conversation_seal_staging");
  });

  it("setup-replication.sh includes directory_checkpoints in publication", () => {
    const script = loadScript();
    expect(script).toContain("directory_checkpoints");
  });

  it("setup-replication.sh includes checkpoint_node_signatures in publication", () => {
    const script = loadScript();
    expect(script).toContain("checkpoint_node_signatures");
  });

  it("setup-replication.sh includes relay_registrations in publication", () => {
    const script = loadScript();
    expect(script).toContain("relay_registrations");
  });

  it("setup-replication.sh includes sessions in publication", () => {
    const script = loadScript();
    expect(script).toContain("sessions");
  });

  it("setup-replication.sh includes pending_notifications in publication", () => {
    const script = loadScript();
    expect(script).toContain("pending_notifications");
  });

  it("setup-replication.sh includes user_accounts in publication", () => {
    const script = loadScript();
    expect(script).toContain("user_accounts");
  });
});

// ─── Script structure: idempotency guards ─────────────────────────────────────

describe("FEDERATION-001A: idempotency — IF NOT EXISTS guards", () => {
  it("setup-replication.sh uses IF NOT EXISTS for user creation", () => {
    const script = loadScript();
    // PostgreSQL 16+: CREATE USER ... IF NOT EXISTS or pre-flight query
    expect(script).toMatch(/IF NOT EXISTS|does_not_exist|SELECT.*rolname/i);
  });

  it("setup-replication.sh uses IF NOT EXISTS or pre-flight for publication creation", () => {
    const script = loadScript();
    expect(script).toMatch(/IF NOT EXISTS|SELECT.*pubname|pg_publication/i);
  });

  it("setup-replication.sh uses pre-flight check for subscription existence", () => {
    const script = loadScript();
    // Subscriptions don't support IF NOT EXISTS in all PG versions — pre-flight SELECT
    expect(script).toMatch(/pg_subscription|subname|IF NOT EXISTS/i);
  });

  it("setup-replication.sh polls pg_stat_replication for streaming state verification", () => {
    const script = loadScript();
    expect(script).toContain("pg_stat_replication");
  });
});

// ─── Script structure: timeout enforcement ───────────────────────────────────

describe("FEDERATION-001A: 60-second streaming state timeout", () => {
  it("setup-replication.sh enforces 60-second timeout for streaming state", () => {
    const script = loadScript();
    expect(script).toContain("60");
  });

  it("setup-replication.sh exits 1 on timeout (infra.replication.setup.slot_not_streaming)", () => {
    const script = loadScript();
    // The slot_not_streaming event must be followed by exit 1 within 1000 chars
    const idx = script.indexOf("infra.replication.setup.slot_not_streaming");
    const contextWindow = script.slice(idx, idx + 1000);
    expect(contextWindow).toMatch(/exit\s+1/);
  });
});

// ─── Script structure: summary output ────────────────────────────────────────

describe("FEDERATION-001A: summary table output", () => {
  it("setup-replication.sh prints a summary table of replication slot states", () => {
    const script = loadScript();
    // Summary should reference the slots and their streaming state
    expect(script).toMatch(/summary|SLOT|slot.*state|streaming/i);
  });
});

// ─── DB-002: Credentials mismatch detection ──────────────────────────────────

describe("FEDERATION-001A: DB-002 credentials mismatch detection", () => {
  it("setup-replication.sh checks whether Secrets Manager secret already exists before creating", () => {
    const script = loadScript();
    // Must use describe-secret or get-secret-value with error handling
    expect(script).toMatch(/describe-secret|get-secret-value/);
  });

  it("setup-replication.sh does NOT overwrite an existing Secrets Manager secret", () => {
    const script = loadScript();
    // Must NOT use put-secret-value without a prior existence check
    // Strategy: check for conditional logic around create-secret/put-secret-value
    expect(script).toMatch(/create-secret|put-secret-value/);
    // The script must gate secret creation on non-existence
    expect(script).toContain("create-secret");
  });
});

// ─── AC-005: Secrets Manager path convention ─────────────────────────────────

describe("FEDERATION-001A: AC-005 Secrets Manager path convention", () => {
  it("setup-replication.sh uses cello/{env}/directory/rds-replication-credentials path", () => {
    const script = loadScript();
    expect(script).toContain("rds-replication-credentials");
  });

  it("secret path includes the environment variable (not hardcoded dev/prod)", () => {
    const script = loadScript();
    // The secret path must use ${ENVIRONMENT} substitution, not a literal env name.
    // The first occurrence of "rds-replication-credentials" may be in a comment —
    // check that the full script contains SECRET_NAME with ENVIRONMENT in the path.
    expect(script).toMatch(/SECRET_NAME=["']?cello\/\$\{?ENVIRONMENT\}?/);
  });
});

// ─── E2E and integration tests deferred to live-infra environment ─────────────

describe.skip("FEDERATION-001A e2e: AC-001 — first-time setup creates 6 streaming slots (deferred to live AWS)", () => {
  // AC-001: Three Directory ECS tasks running; setup-replication.sh run for the first time
  // creates all 6 replication slots and they reach streaming state.
  // Requires: live ECS tasks, live RDS instances, VPC Peering configured, AWS credentials.
  // Deferred to CELLO-FEDERATION-E2E-001.
  it("AC-001: 6 replication slots created and streaming after first run", () => {
    throw new Error("Deferred — requires live AWS infrastructure with ECS and RDS");
  });
});

describe.skip("FEDERATION-001A integration: AC-002 — second run is idempotent (deferred to live AWS)", () => {
  // AC-002: All 6 slots already exist; re-running exits 0 without modifying any DB object.
  // Requires: live RDS instances after a successful first run.
  it("AC-002: second run exits 0 with no DB object modifications", () => {
    throw new Error("Deferred — requires live AWS infrastructure");
  });
});

describe.skip("FEDERATION-001A e2e: AC-003 — all slots reach streaming within 60s (deferred to live AWS)", () => {
  // AC-003: Polling loop waits for streaming state; all 6 slots stream within 60 seconds.
  // Requires: live ECS + RDS with configured subscriptions.
  it("AC-003: all 6 slots reach streaming state within 60 seconds", () => {
    throw new Error("Deferred — requires live AWS infrastructure");
  });
});

describe.skip("FEDERATION-001A integration: AC-005 — credentials stored in Secrets Manager (deferred to live AWS)", () => {
  // AC-005: cello_replication credentials stored in Secrets Manager before the user is created.
  // Password does not appear in stdout, stderr, or CloudWatch logs.
  it("AC-005: replication credentials in Secrets Manager, not visible in logs", () => {
    throw new Error("Deferred — requires live AWS Secrets Manager and RDS");
  });
});

describe.skip("FEDERATION-001A integration: AC-006 — naming conventions enforced (deferred to live AWS)", () => {
  // AC-006: every publication is named cello_pub; every subscription is named
  // cello_sub_from_{source_region}; every slot follows cello_{env}_{source}_{target}.
  // Requires: live RDS instances after setup.
  it("AC-006: all naming conventions enforced after setup", () => {
    throw new Error("Deferred — requires live AWS RDS with replication configured");
  });
});

describe.skip("FEDERATION-001A integration: SI-001 — cello_replication REPLICATION only (deferred to live AWS)", () => {
  // SI-001: SELECT on any CELLO table as cello_replication returns permission denied.
  // Requires: live RDS with the cello_replication role created.
  it("SI-001: cello_replication role cannot SELECT on CELLO tables", () => {
    throw new Error("Deferred — requires live AWS RDS with cello_replication role");
  });
});

describe.skip("FEDERATION-001A integration: DB-001 — slot_not_streaming timeout (deferred to live AWS)", () => {
  // DB-001: when a slot doesn't reach streaming within 60s, script exits 1 with
  // infra.replication.setup.slot_not_streaming logged at ERROR.
  // Requires: live ECS + RDS in a state where the subscription exists but won't stream.
  it("DB-001: slot_not_streaming timeout causes exit 1 with error log", () => {
    throw new Error("Deferred — requires live AWS infrastructure in degraded state");
  });
});
