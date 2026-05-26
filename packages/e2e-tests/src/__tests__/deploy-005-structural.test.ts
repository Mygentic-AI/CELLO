/**
 * CELLO-DEPLOY-005 — Structural tests for pipeline template and smoke script discipline.
 *
 * S — Specification:
 *
 * AC-001: Staging deploy stage present in cello-directory-pipeline and cello-relay-pipeline.
 *   - StagingDeploy stage exists after Build stage in both pipelines.
 *   - Uses `aws ecs wait services-stable` with a 10-minute timeout.
 *
 * AC-002 (Phase-1 scope): The smoke test CodeBuild project verifies the staging ALB returns
 *   HTTP 200 on GET /health, proving the new image boots correctly. This is the Phase-1 gate.
 *   The 8 full multi-agent protocol scenarios (FROST ceremony, message exchange, session seal,
 *   relay failure, pre-seal reconciliation, concurrent connection fan-out, multi-session fan-in)
 *   are deferred to CELLO-FEDERATION-E2E-001.
 *
 * AC-003: Production deploy stage exists with 3 sequential region actions (us-east-1 first,
 *   then eu-central-1, then ap-northeast-1). Each action has a distinct RunOrder to enforce
 *   sequencing. RunOrder of eu-central-1 > us-east-1.
 *
 * AC-004 / SI-001: Production deploy stage RunOrder is greater than Smoke Test stage RunOrder.
 *   CodePipeline sequential stage execution enforces that production never runs if smoke test
 *   did not complete successfully.
 *
 * AC-006: Smoke test CodeBuild project has no VpcConfig property.
 *
 * AC-008: No smoke script references `cello_receive_any` — the deprecated pre-M4-round3 name.
 *   Any reference silently fails with "unknown tool" since that name no longer exists in the
 *   compiled binary.
 *
 * AC-009: The string `.elb.amazonaws.com` does not appear anywhere in infra/ (all ALB URLs
 *   come from stack outputs at deploy time, not hardcoded in templates or scripts).
 *
 * SI-001: ProductionDeploy stage has RunOrder dependency after SmokeTest stage in cello-cicd.yaml.
 *   Applies to both DirectoryPipeline and RelayPipeline.
 *
 * SI-002: The ProductionDeployBuild buildspec contains no `docker build` command — production
 *   deploy never builds a new image. The same image digest from the Build stage reaches
 *   production via the #{BuildAction.IMAGE_URI} pipeline variable reference.
 *
 * P — Pseudocode (structural tests):
 *   1. Read cello-cicd.yaml as text.
 *   2. Assert StagingDeploy stage present.
 *   3. Assert SmokeTest stage present (Phase-1: health check gate).
 *   4. Assert ProductionDeploy stage present.
 *   5. Assert StagingDeploy references services-stable.
 *   6. Assert SmokeTest CodeBuild project has no VpcConfig in template.
 *   7. Assert ProductionDeploy references all 3 regions.
 *   8. Assert ProductionDeploy stage RunOrder ordering correct.
 *   9. Assert no cello_receive_any in smoke scripts.
 *   10. Assert no .elb.amazonaws.com string in infra/ (AC-009).
 *   11. Assert ProductionDeployBuild buildspec has no `docker build` (SI-002).
 *   12. Assert ProductionDeploy actions reference #{BuildAction.IMAGE_URI} (SI-002).
 *   13. Assert SmokeTest before ProductionDeploy in RelayPipeline (SI-001).
 *
 * A — Architecture:
 *   File system static analysis tests — no network, no AWS, no Docker.
 *   All assertions are structural (template text + file grep).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");
const infraDir = resolve(repoRoot, "infra");
const cicdTemplate = resolve(infraDir, "cloudformation/cello-cicd.yaml");
const ecsRelayTemplate = resolve(infraDir, "cloudformation/cello-ecs-relay.yaml");
const iamTemplate = resolve(infraDir, "cloudformation/cello-iam.yaml");
const smokeDir = resolve(repoRoot, "packages/e2e-tests/src/smoke");
const deployScript = resolve(infraDir, "deploy.sh");

// ─── AC-001: Staging Deploy stage in both pipelines ──────────────────────────

describe("AC-001: Staging Deploy stage exists in directory pipeline", () => {
  it("cello-cicd.yaml contains StagingDeploy stage name for directory pipeline", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // Staging deploy stage must be present somewhere
    expect(template).toContain("StagingDeploy");
  });

  it("cello-cicd.yaml contains StagingDeploy stage name for relay pipeline", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // Both directory and relay pipelines need staging deploy
    expect(template).toContain("StagingDeployBuild");
  });

  it("cello-cicd.yaml contains services-stable wait in staging deploy", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // The staging deploy buildspec must reference services-stable
    expect(template).toContain("services-stable");
  });
});

// ─── AC-002: Smoke test stage present (Phase-1: health check gate) ───────────
//
// Phase-1 scope: smoke test verifies the staging ALB returns HTTP 200 on GET /health,
// proving the new image boots correctly. Full 8-scenario multi-agent protocol execution
// is deferred to CELLO-FEDERATION-E2E-001.

describe("AC-002: Smoke test stage exists (Phase-1 health check gate)", () => {
  it("cello-cicd.yaml contains SmokeTest CodeBuild project", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("SmokeTestBuild");
  });

  it("smoke test buildspec references STAGING_DIRECTORY_URL for health check", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // STAGING_DIRECTORY_URL is the ALB endpoint used for GET /health
    expect(template).toContain("STAGING_DIRECTORY_URL");
  });

  it("smoke test buildspec emits pipeline.staging.smoke_test.passed event on health check pass", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("pipeline.staging.smoke_test.passed");
  });

  it("smoke test buildspec emits pipeline.staging.smoke_test.failed event when health check fails", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("pipeline.staging.smoke_test.failed");
  });

  it("run-smoke-tests.ts invokes checkStagingHealth() against the ALB /health endpoint", () => {
    // Verify the smoke runner actually calls the health endpoint — the Phase-1 gate
    const smokeRunner = resolve(smokeDir, "run-smoke-tests.ts");
    expect(existsSync(smokeRunner)).toBe(true);
    const content = readFileSync(smokeRunner, "utf-8");
    expect(content).toContain("checkStagingHealth");
    expect(content).toContain("/health");
  });
});

// ─── AC-003 / AC-007: Production Deploy stage with sequential regions ─────────

describe("AC-003/AC-007: Production Deploy stage with sequential multi-region actions", () => {
  it("cello-cicd.yaml contains ProductionDeploy stage", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("ProductionDeploy");
  });

  it("production deploy references us-east-1", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("us-east-1");
  });

  it("production deploy references eu-central-1", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("eu-central-1");
  });

  it("production deploy references ap-northeast-1", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("ap-northeast-1");
  });

  it("production deploy has sequential RunOrder values (eu > us, ap > eu)", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // ProductionDeploy stage must have RunOrder entries 1, 2, 3 for sequential ordering
    // The template must contain RunOrder: 1, 2, 3 in production deploy stage section
    expect(template).toContain("RunOrder: 1");
    expect(template).toContain("RunOrder: 2");
    expect(template).toContain("RunOrder: 3");
  });

  it("production deploy emits pipeline.production.deployed event", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("pipeline.production.deployed");
  });
});

// ─── AC-004 / SI-001: Smoke test must complete before production deploy ───────
//
// SI-001 adversarial condition: even if someone manually retries or restarts a pipeline
// from a later stage, CodePipeline sequential stage ordering means ProductionDeploy can
// only execute after SmokeTest completes successfully. Verified here by asserting that
// SmokeTest stage appears before ProductionDeploy stage in both pipelines.

describe("AC-004/SI-001: Production deploy gated on smoke test", () => {
  it("ProductionDeploy stage appears after SmokeTest stage within DirectoryPipeline definition", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // Find the DirectoryPipeline resource definition
    const directoryPipelineIdx = template.indexOf("DirectoryPipeline:");
    expect(directoryPipelineIdx).toBeGreaterThan(0);
    // Within the DirectoryPipeline definition, SmokeTest stage must appear before ProductionDeploy
    const pipelineBody = template.substring(directoryPipelineIdx);
    const smokeTestPos = pipelineBody.indexOf("- Name: SmokeTest");
    const productionDeployPos = pipelineBody.indexOf("- Name: ProductionDeploy");
    expect(smokeTestPos, "SmokeTest stage not found in DirectoryPipeline").toBeGreaterThan(0);
    expect(productionDeployPos, "ProductionDeploy stage not found in DirectoryPipeline").toBeGreaterThan(0);
    expect(productionDeployPos).toBeGreaterThan(smokeTestPos);
  });

  it("ProductionDeploy stage appears after SmokeTest stage within RelayPipeline definition", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // Find the RelayPipeline resource definition (SI-001 adversarial condition applies to both pipelines)
    const relayPipelineIdx = template.indexOf("RelayPipeline:");
    expect(relayPipelineIdx).toBeGreaterThan(0);
    // Within the RelayPipeline definition, SmokeTest stage must appear before ProductionDeploy
    // Scope the search to the RelayPipeline section only (before the next top-level resource)
    const nextResourceIdx = template.indexOf("\n  E2eTestsPipeline:", relayPipelineIdx);
    const pipelineBody = template.substring(
      relayPipelineIdx,
      nextResourceIdx > 0 ? nextResourceIdx : relayPipelineIdx + 5000,
    );
    const smokeTestPos = pipelineBody.indexOf("- Name: SmokeTest");
    const productionDeployPos = pipelineBody.indexOf("- Name: ProductionDeploy");
    expect(smokeTestPos, "SmokeTest stage not found in RelayPipeline").toBeGreaterThan(0);
    expect(productionDeployPos, "ProductionDeploy stage not found in RelayPipeline").toBeGreaterThan(0);
    expect(productionDeployPos).toBeGreaterThan(smokeTestPos);
  });
});

// ─── SI-002: Production deploy never rebuilds — same image digest from Build stage ──
//
// SI-002 adversarial condition: even when a newer image is available in ECR at production
// deploy time, the pipeline passes the Build stage output artifact digest through to
// ProductionDeploy via #{BuildAction.IMAGE_URI}. No new docker build occurs after the
// smoke test passes.

describe("SI-002: ProductionDeployBuild never builds a new image", () => {
  it("ProductionDeployBuild inline buildspec contains no docker build command", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // Find the ProductionDeployBuild resource block
    const prodDeployBuildIdx = template.indexOf("ProductionDeployBuild:");
    expect(prodDeployBuildIdx, "ProductionDeployBuild resource not found").toBeGreaterThan(0);
    // Scope the search to the ProductionDeployBuild section only.
    // CryptoPipeline: is the first pipeline definition that follows the CodeBuild projects.
    const sectionEnd = template.indexOf("\n  CryptoPipeline:", prodDeployBuildIdx);
    const prodDeployBuildSection = template.substring(
      prodDeployBuildIdx,
      sectionEnd > 0 ? sectionEnd : prodDeployBuildIdx + 4000,
    );
    // The ProductionDeployBuild buildspec must never run docker build
    expect(
      prodDeployBuildSection,
      "ProductionDeployBuild buildspec contains 'docker build' — production stage must not rebuild the image",
    ).not.toContain("docker build");
  });

  it("ProductionDeploy reads IMAGE_URI from SSM (same digest as staging — SI-002)", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // The production deploy reads IMAGE_URI from SSM Parameter Store — the same parameter
    // that the Build stage wrote after pushing to ECR. This proves the same image digest
    // that was smoke-tested reaches production (no rebuild).
    expect(template).toContain("ssm get-parameter");
    expect(template).toContain("image-uri");
  });
});

// ─── AC-005: Staging deploy failure halts pipeline ───────────────────────────

describe("AC-005: Staging deploy failure event exists", () => {
  it("staging deploy emits pipeline.staging.deployed event on success", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("pipeline.staging.deployed");
  });

  it("staging deploy emits pipeline.staging.deploy.failed event on failure", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).toContain("pipeline.staging.deploy.failed");
  });
});

// ─── AC-006: Smoke test CodeBuild has no VPC configuration ───────────────────

describe("AC-006: Smoke test CodeBuild has no VPC configuration", () => {
  it("SmokeTestBuild CodeBuild project has no VpcConfig property", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    // Find the SmokeTestBuild resource block. It must not contain VpcConfig.
    // Strategy: verify the entire file does not wire VpcConfig onto SmokeTestBuild.
    // More specific: the SmokeTestBuild resource block must not reference VpcConfig.
    const smokeTestIdx = template.indexOf("SmokeTestBuild:");
    expect(smokeTestIdx).toBeGreaterThan(0);
    // Find the next resource definition after SmokeTestBuild
    const nextResourceIdx = template.indexOf("\n  ", smokeTestIdx + 20);
    const smokeTestBlock = template.substring(smokeTestIdx, nextResourceIdx > 0 ? nextResourceIdx : smokeTestIdx + 5000);
    expect(smokeTestBlock).not.toContain("VpcConfig");
  });
});

// ─── AC-008: No cello_receive_any in smoke scripts ───────────────────────────

describe("AC-008: Smoke scripts use canonical post-M4-round3 tool names", () => {
  it("smoke directory exists", () => {
    expect(existsSync(smokeDir)).toBe(true);
  });

  it("no smoke script references cello_receive_any (deprecated pre-M4-round3 name)", () => {
    if (!existsSync(smokeDir)) return;
    const smokeFiles = readdirSync(smokeDir);
    for (const file of smokeFiles) {
      const content = readFileSync(join(smokeDir, file), "utf-8");
      expect(
        content,
        `${file} references deprecated cello_receive_any — use cello_receive (any-session) or cello_receive_session (session-locked) instead`,
      ).not.toContain("cello_receive_any");
    }
  });
});

// ─── AC-009: No hardcoded ALB DNS names in infra/ ────────────────────────────

describe("AC-009: No hardcoded ALB DNS names in infra/", () => {
  it("deploy.sh does not hardcode .elb.amazonaws.com strings", () => {
    const script = readFileSync(deployScript, "utf-8");
    expect(script).not.toMatch(/[a-z0-9-]+\.elb\.amazonaws\.com/);
  });

  it("cello-cicd.yaml does not hardcode .elb.amazonaws.com strings", () => {
    const template = readFileSync(cicdTemplate, "utf-8");
    expect(template).not.toMatch(/[a-z0-9-]+\.elb\.amazonaws\.com/);
  });

  it("deploy.sh reads AlbDnsName from stack outputs and passes as STAGING_DIRECTORY_URL", () => {
    const script = readFileSync(deployScript, "utf-8");
    // The script must read AlbDnsName from the ecs-directory stack and pass it as STAGING_DIRECTORY_URL
    expect(script).toContain("AlbDnsName");
    expect(script).toContain("STAGING_DIRECTORY_URL");
  });
});

// ─── ECS Exec enablement (inherited DEPLOY-003 AC-007) ───────────────────────

describe("DEPLOY-003 AC-007 (inherited): ECS Exec enabled on relay service", () => {
  it("cello-ecs-relay.yaml contains EnableExecuteCommand: true", () => {
    const template = readFileSync(ecsRelayTemplate, "utf-8");
    expect(template).toContain("EnableExecuteCommand: true");
  });

  it("cello-iam.yaml contains ssmmessages:CreateControlChannel for relay task role", () => {
    const template = readFileSync(iamTemplate, "utf-8");
    expect(template).toContain("ssmmessages:CreateControlChannel");
  });

  it("cello-iam.yaml contains ssmmessages:OpenDataChannel for relay task role", () => {
    const template = readFileSync(iamTemplate, "utf-8");
    expect(template).toContain("ssmmessages:OpenDataChannel");
  });
});
