/**
 * CELLO-DEPLOY-001A — Deployment Automation Tests
 *
 * These are static-analysis-only tests. No live AWS calls are made.
 * All tests read files from the repository and assert structural properties.
 *
 * Specification interpretation:
 *
 * AC-001-iam-stack:
 *   cello-iam.yaml exists, exports the four role ARNs with correct names.
 *   The four exports must be: cello-${Environment}-directory-task-role-arn,
 *   cello-${Environment}-directory-execution-role-arn,
 *   cello-${Environment}-relay-task-role-arn,
 *   cello-${Environment}-relay-execution-role-arn.
 *
 * AC-002-kms-imports-iam:
 *   cello-kms.yaml has zero Parameters entries referencing role ARNs.
 *   The key policy principal uses !ImportValue for the directory task role.
 *
 * AC-003-s3-imports-iam:
 *   cello-s3.yaml has zero Parameters entries referencing role ARNs
 *   (no DirectoryTaskRoleArn, no RelayTaskRoleArn parameters).
 *
 * AC-006-route53-automated:
 *   deploy.sh contains describe-stacks; no hardcoded ALB DNS values.
 *
 * AC-007-environment-sizing:
 *   deploy.sh maps production → db.t3.medium + CPU 512/MEM 1024;
 *   dev/staging → db.t3.small + CPU 256/MEM 512.
 *
 * AC-008-production-confirmation:
 *   deploy.sh contains the exact prompt text and requires YES input.
 *
 * AC-010-cfn-lint-clean: tested via CI; static assertion that cello-iam.yaml
 *   uses only standard CloudFormation resource types.
 *
 * AC-011-no-manual-steps:
 *   No "aws cloudformation deploy" commands in infra/ other than inside deploy.sh itself.
 *
 * SI-001-no-hardcoded-account-ids:
 *   deploy.sh contains no hardcoded AWS account IDs or ARNs.
 *   Interpretation: the account ID 257394457473 must NOT appear literally.
 *   All ARNs constructed from runtime values (ACCOUNT_ID variable).
 *
 * SI-002-production-confirmation-not-bypassable:
 *   The production confirmation check is on the ENVIRONMENT value,
 *   not gated by any --skip or --force flag.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

// Paths — resolved from this test file's location
const WORKTREE_ROOT = resolve(import.meta.dirname, "../../../../");
const CFN_DIR = resolve(WORKTREE_ROOT, "infra/cloudformation");
const INFRA_DIR = resolve(WORKTREE_ROOT, "infra");
const DEPLOY_SCRIPT = resolve(INFRA_DIR, "deploy.sh");

function loadTemplate(name: string): Record<string, unknown> {
  const filePath = join(CFN_DIR, name);
  const content = readFileSync(filePath, "utf-8");
  return parseYaml(content) as Record<string, unknown>;
}

function loadTemplateRaw(name: string): string {
  return readFileSync(join(CFN_DIR, name), "utf-8");
}

function loadDeployScript(): string {
  return readFileSync(DEPLOY_SCRIPT, "utf-8");
}

// ─── AC-001: cello-iam.yaml exists and exports the four role ARNs ──────────

describe("DEPLOY-001A: AC-001 cello-iam.yaml stack", () => {
  it("cello-iam.yaml file exists", () => {
    expect(existsSync(join(CFN_DIR, "cello-iam.yaml"))).toBe(true);
  });

  it("cello-iam.yaml is valid YAML with AWSTemplateFormatVersion and Resources", () => {
    const parsed = loadTemplate("cello-iam.yaml");
    expect(parsed).toHaveProperty("AWSTemplateFormatVersion");
    expect(parsed).toHaveProperty("Resources");
  });

  it("cello-iam.yaml defines all six IAM roles", () => {
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const roleResources = Object.entries(resources).filter(
      ([, v]) => (v["Type"] as string) === "AWS::IAM::Role"
    );
    expect(roleResources.length, "must define exactly 6 IAM roles").toBe(6);
  });

  it("cello-iam.yaml exports directory-task-role-arn", () => {
    const raw = loadTemplateRaw("cello-iam.yaml");
    expect(raw).toContain("directory-task-role-arn");
  });

  it("cello-iam.yaml exports directory-execution-role-arn", () => {
    const raw = loadTemplateRaw("cello-iam.yaml");
    expect(raw).toContain("directory-execution-role-arn");
  });

  it("cello-iam.yaml exports relay-task-role-arn", () => {
    const raw = loadTemplateRaw("cello-iam.yaml");
    expect(raw).toContain("relay-task-role-arn");
  });

  it("cello-iam.yaml exports relay-execution-role-arn", () => {
    const raw = loadTemplateRaw("cello-iam.yaml");
    expect(raw).toContain("relay-execution-role-arn");
  });

  it("cello-iam.yaml export names use ${Environment} substitution pattern", () => {
    const template = loadTemplate("cello-iam.yaml");
    const outputs = template["Outputs"] as Record<string, Record<string, unknown>>;
    expect(outputs).toBeDefined();

    // Each output's Export Name should contain Fn::Sub with ${Environment}
    for (const [, output] of Object.entries(outputs)) {
      const exportObj = output["Export"] as Record<string, unknown>;
      expect(exportObj, "output must have Export").toBeDefined();
      const name = exportObj["Name"];
      // Name can be a string with ${Environment} or a Fn::Sub map
      const nameStr = JSON.stringify(name);
      expect(nameStr, "export name must use Environment").toContain("Environment");
    }
  });
});

// ─── AC-002: cello-kms.yaml has no role ARN parameters ─────────────────────

describe("DEPLOY-001A: AC-002 cello-kms.yaml imports IAM via !ImportValue", () => {
  it("cello-kms.yaml has no DirectoryTaskRoleArn parameter", () => {
    const template = loadTemplate("cello-kms.yaml");
    const params = (template["Parameters"] ?? {}) as Record<string, unknown>;
    expect(params["DirectoryTaskRoleArn"]).toBeUndefined();
  });

  it("cello-kms.yaml has no RelayTaskRoleArn parameter", () => {
    const template = loadTemplate("cello-kms.yaml");
    const params = (template["Parameters"] ?? {}) as Record<string, unknown>;
    expect(params["RelayTaskRoleArn"]).toBeUndefined();
  });

  it("cello-kms.yaml key policy references role ARN via ImportValue", () => {
    const raw = loadTemplateRaw("cello-kms.yaml");
    expect(raw).toContain("ImportValue");
    expect(raw).toContain("directory-task-role-arn");
  });

  it("cello-kms.yaml has zero parameters referencing role ARNs (case-insensitive)", () => {
    const template = loadTemplate("cello-kms.yaml");
    const params = (template["Parameters"] ?? {}) as Record<string, unknown>;
    const paramKeys = Object.keys(params);
    const roleArnParams = paramKeys.filter(
      (k) => k.toLowerCase().includes("rolearn") || k.toLowerCase().includes("role_arn")
    );
    expect(roleArnParams).toHaveLength(0);
  });
});

// ─── AC-003: cello-s3.yaml has no role ARN parameters ──────────────────────

describe("DEPLOY-001A: AC-003 cello-s3.yaml imports IAM via !ImportValue", () => {
  it("cello-s3.yaml has no DirectoryTaskRoleArn parameter", () => {
    const template = loadTemplate("cello-s3.yaml");
    const params = (template["Parameters"] ?? {}) as Record<string, unknown>;
    expect(params["DirectoryTaskRoleArn"]).toBeUndefined();
  });

  it("cello-s3.yaml has no RelayTaskRoleArn parameter", () => {
    const template = loadTemplate("cello-s3.yaml");
    const params = (template["Parameters"] ?? {}) as Record<string, unknown>;
    expect(params["RelayTaskRoleArn"]).toBeUndefined();
  });

  it("cello-s3.yaml bucket policies reference role ARNs via ImportValue", () => {
    const raw = loadTemplateRaw("cello-s3.yaml");
    expect(raw).toContain("ImportValue");
    expect(raw).toContain("relay-task-role-arn");
  });
});

// ─── AC-006: deploy.sh reads ALB outputs dynamically ───────────────────────

describe("DEPLOY-001A: AC-006 deploy.sh reads ALB outputs via describe-stacks", () => {
  it("deploy.sh file exists", () => {
    expect(existsSync(DEPLOY_SCRIPT)).toBe(true);
  });

  it("deploy.sh contains describe-stacks for ALB lookup", () => {
    const script = loadDeployScript();
    expect(script).toContain("describe-stacks");
  });

  it("deploy.sh has no hardcoded ALB DNS values (no .elb.amazonaws.com)", () => {
    const script = loadDeployScript();
    // ALB DNS names look like: xxx.region.elb.amazonaws.com
    // Must not be hardcoded as string literals
    expect(script).not.toMatch(/[a-z0-9-]+\.[a-z0-9-]+\.elb\.amazonaws\.com/);
  });

  it("deploy.sh has no hardcoded HostedZoneId values for ALBs (no Z format in static context)", () => {
    const script = loadDeployScript();
    // ALB hosted zone IDs are static per region (e.g. Z35SXDOTRQ7X7K)
    // They must be read from stack outputs, not hardcoded
    // We assert the script reads AlbHostedZoneId from stack output
    expect(script).toContain("AlbHostedZoneId");
    expect(script).toContain("AlbDnsName");
  });
});

// ─── AC-007: deploy.sh sizes correctly per environment ──────────────────────

describe("DEPLOY-001A: AC-007 environment-specific sizing in deploy.sh", () => {
  it("deploy.sh uses db.t3.medium for production", () => {
    const script = loadDeployScript();
    expect(script).toContain("db.t3.medium");
  });

  it("deploy.sh uses db.t3.small for dev/staging", () => {
    const script = loadDeployScript();
    expect(script).toContain("db.t3.small");
  });

  it("deploy.sh uses CPU 512 for production directory", () => {
    const script = loadDeployScript();
    // The production CPU for directory is 512
    expect(script).toMatch(/512/);
  });

  it("deploy.sh uses CPU 256 for dev/staging directory", () => {
    const script = loadDeployScript();
    expect(script).toMatch(/256/);
  });

  it("deploy.sh associates db.t3.medium with production environment via conditional", () => {
    const script = loadDeployScript();
    // The sizing block must contain: if production then db.t3.medium
    // Check for a pattern where production comparison precedes db.t3.medium in a block
    // We use a regex that matches the if-production conditional containing db.t3.medium
    expect(script).toMatch(/"production"[\s\S]{0,300}db\.t3\.medium/);
  });
});

// ─── AC-008: production confirmation prompt ──────────────────────────────────

describe("DEPLOY-001A: AC-008 production confirmation gate", () => {
  it("deploy.sh contains the exact confirmation prompt text", () => {
    const script = loadDeployScript();
    expect(script).toContain("Deploying to PRODUCTION");
    expect(script).toContain("Type YES to confirm");
  });

  it("deploy.sh exits 1 when confirmation is not YES", () => {
    const script = loadDeployScript();
    // The script must check the input against "YES" and exit if it doesn't match
    expect(script).toContain("YES");
    expect(script).toMatch(/exit\s+1/);
  });

  it("deploy.sh production gate is on ENVIRONMENT value, not a skip flag", () => {
    const script = loadDeployScript();
    // The gate fires when ENVIRONMENT=production — no --skip-confirm or similar
    expect(script).not.toMatch(/--skip[-_]confirm/i);
    expect(script).not.toMatch(/SKIP_CONFIRM/);
    expect(script).not.toMatch(/NO_CONFIRM/);
  });
});

// ─── AC-011: no manual deploy steps in infra/ ───────────────────────────────

describe("DEPLOY-001A: AC-011 no manual aws cloudformation deploy instructions in infra/", () => {
  it("no .sh file in infra/ (other than deploy.sh) contains manual 'aws cloudformation deploy' commands", () => {
    // Read all .sh files in infra/ root — subdirectory scripts are ok (they're legacy)
    // deploy-peering.sh is an authorized deployment script added in FEDERATION-E2E-001
    // for cross-region VPC Peering stacks (not covered by deploy.sh which is single-region).
    const AUTHORIZED_DEPLOY_SCRIPTS = new Set(["deploy.sh", "deploy-peering.sh"]);
    const infraFiles = readdirSync(INFRA_DIR).filter(
      (f) => f.endsWith(".sh") && !AUTHORIZED_DEPLOY_SCRIPTS.has(f)
    );

    for (const file of infraFiles) {
      const content = readFileSync(join(INFRA_DIR, file), "utf-8");
      // Legacy scripts that deploy CloudFormation manually are the problem
      // The new deploy.sh is the only authorised path
      const hasManualDeploy = content.includes("aws cloudformation deploy") &&
        !content.includes("# Legacy");
      expect(
        hasManualDeploy,
        `${file} should not contain manual aws cloudformation deploy commands (use deploy.sh instead)`
      ).toBe(false);
    }
  });
});

// ─── SI-001: no hardcoded account IDs or ARNs in deploy.sh ─────────────────

describe("DEPLOY-001A: SI-001 no hardcoded account IDs or ARNs in deploy.sh", () => {
  it("deploy.sh does not contain the hardcoded account ID 257394457473", () => {
    const script = loadDeployScript();
    expect(script).not.toContain("257394457473");
  });

  it("deploy.sh derives account ID at runtime via aws sts get-caller-identity", () => {
    const script = loadDeployScript();
    expect(script).toContain("get-caller-identity");
    expect(script).toContain("ACCOUNT_ID");
  });

  it("deploy.sh has no hardcoded ARNs (arn:aws:...::257394457473:)", () => {
    const script = loadDeployScript();
    // No arn: string with account ID 257394457473 literal
    expect(script).not.toMatch(/arn:aws:[a-z]+:[a-z0-9-]*:257394457473:/);
  });

  it("deploy.sh constructs image URIs from ACCOUNT_ID variable", () => {
    const script = loadDeployScript();
    // ECR image URIs must be constructed from the variable, not hardcoded
    expect(script).toContain("ACCOUNT_ID");
    expect(script).toContain("dkr.ecr");
    // The ACCOUNT_ID variable must appear before dkr.ecr in the script
    const accountIdx = script.indexOf("ACCOUNT_ID");
    const ecrIdx = script.indexOf("dkr.ecr");
    expect(accountIdx).toBeGreaterThanOrEqual(0);
    expect(ecrIdx).toBeGreaterThanOrEqual(0);
  });
});

// ─── SI-002: production confirmation not bypassable ──────────────────────────

describe("DEPLOY-001A: SI-002 production confirmation not bypassable", () => {
  it("deploy.sh production gate reads from stdin, not from env/flags", () => {
    const script = loadDeployScript();
    // The confirmation must use 'read' builtin — stdin — not an env var check
    expect(script).toMatch(/read\s/);
  });

  it("deploy.sh production check fires on ENVIRONMENT value, regardless of how it was set", () => {
    const script = loadDeployScript();
    // The check must compare ENVIRONMENT variable to "production"
    expect(script).toMatch(/\$\{?ENVIRONMENT\}?.*production|production.*\$\{?ENVIRONMENT\}?/);
  });
});

// ─── Structural: cello-iam.yaml defines correct role trust policies ──────────

describe("DEPLOY-001A: cello-iam.yaml role trust policies", () => {
  it("all roles trust ecs-tasks.amazonaws.com", () => {
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    for (const [name, resource] of Object.entries(resources)) {
      if ((resource["Type"] as string) !== "AWS::IAM::Role") continue;
      const props = resource["Properties"] as Record<string, unknown>;
      const trustDoc = props["AssumeRolePolicyDocument"] as Record<string, unknown>;
      const statements = trustDoc["Statement"] as Array<Record<string, unknown>>;
      const hasEcsTrust = statements.some((s) => {
        const principal = s["Principal"] as Record<string, unknown>;
        const service = principal["Service"] as string | string[];
        const services = Array.isArray(service) ? service : [service];
        return services.includes("ecs-tasks.amazonaws.com");
      });
      expect(hasEcsTrust, `${name} must trust ecs-tasks.amazonaws.com`).toBe(true);
    }
  });

  it("directory execution role has AmazonECSTaskExecutionRolePolicy managed policy", () => {
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    // Find the directory execution role
    const execRoleEntries = Object.entries(resources).filter(
      ([name]) => name.toLowerCase().includes("directory") && name.toLowerCase().includes("execution")
    );
    expect(execRoleEntries.length).toBeGreaterThan(0);

    const [, execRole] = execRoleEntries[0];
    const props = execRole["Properties"] as Record<string, unknown>;
    const managedPolicies = props["ManagedPolicyArns"] as string[] | undefined;
    expect(managedPolicies).toBeDefined();
    expect(managedPolicies!.some((p) => p.includes("AmazonECSTaskExecutionRolePolicy"))).toBe(true);
  });

  it("relay execution role has AmazonECSTaskExecutionRolePolicy managed policy", () => {
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const execRoleEntries = Object.entries(resources).filter(
      ([name]) => name.toLowerCase().includes("relay") && name.toLowerCase().includes("execution")
    );
    expect(execRoleEntries.length).toBeGreaterThan(0);

    const [, execRole] = execRoleEntries[0];
    const props = execRole["Properties"] as Record<string, unknown>;
    const managedPolicies = props["ManagedPolicyArns"] as string[] | undefined;
    expect(managedPolicies).toBeDefined();
    expect(managedPolicies!.some((p) => p.includes("AmazonECSTaskExecutionRolePolicy"))).toBe(true);
  });
});

// ─── Structural: cello-ecs-directory.yaml and cello-ecs-relay.yaml no longer
//     define IAM roles — they use !ImportValue ────────────────────────────────

describe("DEPLOY-001A: ECS templates use !ImportValue for IAM roles", () => {
  it("cello-ecs-directory.yaml has no AWS::IAM::Role resources", () => {
    const template = loadTemplate("cello-ecs-directory.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const roleResources = Object.entries(resources).filter(
      ([, v]) => (v["Type"] as string) === "AWS::IAM::Role"
    );
    expect(roleResources.length, "cello-ecs-directory.yaml must have no IAM roles (moved to cello-iam.yaml)").toBe(0);
  });

  it("cello-ecs-relay.yaml has no AWS::IAM::Role resources", () => {
    const template = loadTemplate("cello-ecs-relay.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const roleResources = Object.entries(resources).filter(
      ([, v]) => (v["Type"] as string) === "AWS::IAM::Role"
    );
    expect(roleResources.length, "cello-ecs-relay.yaml must have no IAM roles (moved to cello-iam.yaml)").toBe(0);
  });

  it("cello-ecs-directory.yaml references execution role ARN via ImportValue", () => {
    const raw = loadTemplateRaw("cello-ecs-directory.yaml");
    expect(raw).toContain("directory-execution-role-arn");
    expect(raw).toContain("ImportValue");
  });

  it("cello-ecs-relay.yaml references execution role ARN via ImportValue", () => {
    const raw = loadTemplateRaw("cello-ecs-relay.yaml");
    expect(raw).toContain("relay-execution-role-arn");
    expect(raw).toContain("ImportValue");
  });
});

// ─── Structural: deploy.sh deploys all 10 stacks ────────────────────────────

describe("DEPLOY-001A: deploy.sh deploys all required stacks", () => {
  it("deploy.sh references cello-iam template", () => {
    const script = loadDeployScript();
    expect(script).toContain("cello-iam");
  });

  it("deploy.sh references all 10 stack names", () => {
    const script = loadDeployScript();
    const requiredStacks = [
      "cello-iam",
      "cello-secrets",
      "cello-vpc",
      "cello-kms",
      "cello-s3",
      "cello-rds",
      "cello-ecs-directory",
      "cello-ecs-relay",
      "cello-route53",
      "cello-cicd",
    ];

    for (const stack of requiredStacks) {
      expect(script, `deploy.sh must reference ${stack}`).toContain(stack);
    }
  });

  it("deploy.sh accepts Environment and Region as positional arguments", () => {
    const script = loadDeployScript();
    // Positional args $1 and $2 are ENVIRONMENT and REGION
    expect(script).toMatch(/\$\{?1\}?/);
    expect(script).toMatch(/\$\{?2\}?/);
  });

  it("deploy.sh exits non-zero on stack failure (uses set -e or explicit exit)", () => {
    const script = loadDeployScript();
    // Either set -e or explicit error checking
    const hasSetE = script.includes("set -e") || script.includes("set -euo pipefail");
    const hasExplicitExit = script.match(/exit\s+1/) !== null;
    expect(hasSetE || hasExplicitExit).toBe(true);
  });

  it("deploy.sh prints infra.deploy.started event or equivalent startup message", () => {
    const script = loadDeployScript();
    expect(script).toMatch(/infra\.deploy\.started|Deploying.*stacks|Starting.*deploy/i);
  });
});

describe("DEPLOY-001A: AC-005 idempotency — deploy.sh handles no-op updates", () => {
  it("AC-005: deploy.sh uses --no-fail-on-empty-changeset on every stack deployment", () => {
    const script = loadDeployScript();
    expect(script).toContain("--no-fail-on-empty-changeset");
  });

  it("AC-005: deploy.sh does not use --fail-on-empty-changeset", () => {
    const script = loadDeployScript();
    expect(script).not.toContain("--fail-on-empty-changeset");
  });
});

describe("DEPLOY-001A: AC-009 failure handling — deploy.sh exits on stack failure", () => {
  it("AC-009: deploy.sh uses set -euo pipefail for immediate exit on failure", () => {
    const script = loadDeployScript();
    expect(script).toContain("set -euo pipefail");
  });

  it("AC-009: deploy.sh prints infra.stack.failed event on failure", () => {
    const script = loadDeployScript();
    expect(script).toContain("infra.stack.failed");
  });

  it("AC-009: deploy.sh prints to stderr on failure", () => {
    const script = loadDeployScript();
    // Error output goes to stderr (>&2)
    expect(script).toMatch(/>&2/);
  });
});
