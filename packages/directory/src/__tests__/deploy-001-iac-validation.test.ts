/**
 * CELLO-DEPLOY-001 — IaC Template Validation Tests
 *
 * Specification:
 *
 * AC-001: All 7 core stacks exist with correct naming convention.
 *   Verified by asserting all template files exist and parse as valid YAML.
 *
 * AC-002: VPC Peering template defines peering connection with proper routing.
 *   Verified by asserting the template has Route and SecurityGroupIngress resources
 *   with the correct ports (5432 and 4001 only).
 *
 * AC-003: VPC template defines Interface Endpoints (ECR, Secrets Manager, KMS, Logs)
 *   plus S3 Gateway Endpoint. No NAT Gateway resource exists.
 *
 * AC-004: Secrets template creates secrets with placeholder values only, not real keys.
 *
 * AC-005: Directory task role policy has exactly kms:Decrypt, kms:DescribeKey,
 *   secretsmanager:GetSecretValue, s3:PutObject. No kms:Encrypt, no s3:GetObject/Delete/List.
 *
 * AC-006: Relay task role has only secretsmanager:GetSecretValue on relay key path.
 *   No KMS, no S3, no directory secrets.
 *
 * AC-007: S3 template defines audit and manifest buckets with correct policies.
 *   Manifest bucket has versioning enabled.
 *
 * AC-008: CI/CD template defines webhook Lambda, pipeline-filter Lambda, EventBridge bus,
 *   and 8 CodePipelines.
 *
 * AC-009: Resource names are parameterised by Environment — no hardcoded env strings.
 *
 * SI-001: No actual secret values (API keys, passwords, private keys) in any template.
 *   Secrets use PLACEHOLDER_POPULATE_VIA_CLI or AWS-managed password generation.
 *
 * SI-002: KMS key policy references DirectoryTaskRoleArn parameter only —
 *   no cross-environment principal references.
 *
 * SI-003: CI/CD template uses us-east-1 naming (cello-codepipeline-artifacts-us-east-1)
 *   and has no reference to eu-west-1.
 *
 * SI-004: VPC Peering security group rules allow only ports 5432 and 4001.
 *   No wildcard port ranges for peer CIDR.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

// Path to CloudFormation templates — resolve from repo root
const CFN_DIR = resolve(import.meta.dirname, "../../../../infra/cloudformation");

function loadTemplate(name: string): Record<string, unknown> {
  const filePath = join(CFN_DIR, name);
  const content = readFileSync(filePath, "utf-8");
  return parseYaml(content) as Record<string, unknown>;
}

function loadTemplateRaw(name: string): string {
  const filePath = join(CFN_DIR, name);
  return readFileSync(filePath, "utf-8");
}

// ─── AC-001: All 7 core template files exist ──────────────────────────────────

describe("DEPLOY-001: AC-001 template files exist and parse", () => {
  const requiredTemplates = [
    "cello-vpc.yaml",
    "cello-rds.yaml",
    "cello-ecs-directory.yaml",
    "cello-ecs-relay.yaml",
    "cello-secrets.yaml",
    "cello-kms.yaml",
    "cello-s3.yaml",
  ];

  for (const template of requiredTemplates) {
    it(`${template} exists and is valid YAML`, () => {
      const filePath = join(CFN_DIR, template);
      expect(existsSync(filePath), `${template} should exist`).toBe(true);
      const parsed = loadTemplate(template);
      expect(parsed).toHaveProperty("AWSTemplateFormatVersion");
      expect(parsed).toHaveProperty("Resources");
    });
  }

  it("all templates accept Environment parameter", () => {
    for (const template of requiredTemplates) {
      const parsed = loadTemplate(template);
      const params = parsed["Parameters"] as Record<string, unknown>;
      expect(params, `${template} must have Parameters`).toBeDefined();
      expect(params["Environment"], `${template} must have Environment param`).toBeDefined();
    }
  });
});

// ─── AC-002: VPC Peering template ────────────────────────────────────────────

describe("DEPLOY-001: AC-002 VPC Peering template", () => {
  it("defines peering connection, route, and security group ingress", () => {
    const template = loadTemplate("cello-vpc-peering.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const peeringResources = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::EC2::VPCPeeringConnection"
    );
    expect(peeringResources.length).toBeGreaterThan(0);

    const routeResources = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::EC2::Route"
    );
    expect(routeResources.length).toBeGreaterThan(0);

    const ingressResources = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::EC2::SecurityGroupIngress"
    );
    expect(ingressResources.length).toBeGreaterThan(0);
  });
});

// ─── AC-003: VPC endpoints, no NAT Gateway ───────────────────────────────────

describe("DEPLOY-001: AC-003 VPC endpoints and no NAT Gateway", () => {
  it("defines required VPC Interface Endpoints", () => {
    const template = loadTemplate("cello-vpc.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const endpoints = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::EC2::VPCEndpoint"
    );

    const raw = loadTemplateRaw("cello-vpc.yaml");
    expect(raw).toContain("ecr.api");
    expect(raw).toContain("ecr.dkr");
    expect(raw).toContain("secretsmanager");
    expect(raw).toContain("kms");
    expect(raw).toContain("logs");
    expect(raw).toContain(".s3");

    // S3 should be Gateway type
    const s3Endpoint = endpoints.find(([name]) => name.toLowerCase().includes("s3"));
    expect(s3Endpoint).toBeDefined();
    const s3Props = s3Endpoint![1]["Properties"] as Record<string, unknown>;
    expect(s3Props["VpcEndpointType"]).toBe("Gateway");
  });

  it("has no NAT Gateway resource", () => {
    const template = loadTemplate("cello-vpc.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const natGateways = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::EC2::NatGateway"
    );
    expect(natGateways.length).toBe(0);
  });
});

// ─── AC-004: Secrets template uses placeholders ──────────────────────────────

describe("DEPLOY-001: AC-004 secrets use placeholder values", () => {
  it("secrets have PLACEHOLDER_POPULATE_VIA_CLI values", () => {
    const raw = loadTemplateRaw("cello-secrets.yaml");
    expect(raw).toContain("PLACEHOLDER_POPULATE_VIA_CLI");
  });

  it("defines all required secret paths", () => {
    const raw = loadTemplateRaw("cello-secrets.yaml");
    expect(raw).toContain("directory/rds-credentials");
    expect(raw).toContain("directory/rds-admin-credentials");
    expect(raw).toContain("directory/node-private-key");
    expect(raw).toContain("directory/kms-key-arn");
    expect(raw).toContain("relay/node-private-key");
  });
});

// ─── AC-005: Directory task role least-privilege ─────────────────────────────

// DEPLOY-001A: directory task role policy moved to cello-iam.yaml

describe("DEPLOY-001: AC-005 directory task role IAM policy", () => {
  it("has kms:Decrypt and kms:DescribeKey only (no Encrypt)", () => {
    // After DEPLOY-001A refactor: DirectoryTaskRole is in cello-iam.yaml
    const raw = loadTemplateRaw("cello-iam.yaml");
    expect(raw).toContain("kms:Decrypt");
    expect(raw).toContain("kms:DescribeKey");
    expect(raw).not.toContain("kms:Encrypt");
  });

  it("has secretsmanager:GetSecretValue on directory path", () => {
    // After DEPLOY-001A refactor: DirectoryTaskRole is in cello-iam.yaml
    const raw = loadTemplateRaw("cello-iam.yaml");
    expect(raw).toContain("secretsmanager:GetSecretValue");
    expect(raw).toContain("directory/*");
  });

  it("has s3:PutObject only (no GetObject, DeleteObject, ListBucket)", () => {
    // After DEPLOY-001A refactor: DirectoryTaskRole is in cello-iam.yaml
    const raw = loadTemplateRaw("cello-iam.yaml");
    expect(raw).toContain("s3:PutObject");
    expect(raw).not.toContain("s3:GetObject");
    expect(raw).not.toContain("s3:DeleteObject");
    expect(raw).not.toContain("s3:ListBucket");
  });
});

// ─── AC-006: Relay task role minimal permissions ─────────────────────────────
// DEPLOY-001A: roles are now defined in cello-iam.yaml (extracted from cello-ecs-relay.yaml)

describe("DEPLOY-001: AC-006 relay task role IAM policy", () => {
  it("has secretsmanager:GetSecretValue on relay key only", () => {
    // After DEPLOY-001A refactor: RelayTaskRole is in cello-iam.yaml
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const taskRole = resources["RelayTaskRole"];
    expect(taskRole).toBeDefined();

    const raw = JSON.stringify(taskRole);
    expect(raw).toContain("secretsmanager:GetSecretValue");
    expect(raw).toContain("relay/node-private-key");
  });

  it("has no KMS permissions", () => {
    // After DEPLOY-001A refactor: RelayTaskRole is in cello-iam.yaml
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;
    const taskRole = resources["RelayTaskRole"];
    const raw = JSON.stringify(taskRole);

    expect(raw).not.toContain("kms:");
  });

  it("has no S3 permissions", () => {
    // After DEPLOY-001A refactor: RelayTaskRole is in cello-iam.yaml
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;
    const taskRole = resources["RelayTaskRole"];
    const raw = JSON.stringify(taskRole);

    expect(raw).not.toContain("s3:");
  });

  it("has no directory secret access", () => {
    // After DEPLOY-001A refactor: RelayTaskRole is in cello-iam.yaml
    const template = loadTemplate("cello-iam.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;
    const taskRole = resources["RelayTaskRole"];
    const raw = JSON.stringify(taskRole);

    expect(raw).not.toContain("directory/");
  });
});

// ─── AC-007: S3 buckets ─────────────────────────────────────────────────────

describe("DEPLOY-001: AC-007 S3 buckets", () => {
  it("defines audit-logs and relay-manifest buckets", () => {
    const raw = loadTemplateRaw("cello-s3.yaml");
    expect(raw).toContain("cello-audit-logs-");
    expect(raw).toContain("cello-relay-manifest-");
  });

  it("manifest bucket has versioning enabled", () => {
    const template = loadTemplate("cello-s3.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const manifestBucket = resources["RelayManifestBucket"];
    expect(manifestBucket).toBeDefined();
    const props = manifestBucket["Properties"] as Record<string, unknown>;
    const versioning = props["VersioningConfiguration"] as Record<string, unknown>;
    expect(versioning["Status"]).toBe("Enabled");
  });

  it("audit bucket policy allows PutObject only from directory role", () => {
    const raw = loadTemplateRaw("cello-s3.yaml");
    expect(raw).toContain("s3:PutObject");
    expect(raw).toContain("DenyNonPutActions");
  });

  it("manifest bucket GetObject policy grants relay task role only — not directory", () => {
    const raw = loadTemplateRaw("cello-s3.yaml");
    expect(raw).toContain("AllowRelayGetObject");
    expect(raw).not.toContain("AllowDirectoryAndRelayGetObject");
  });
});

// ─── AC-008: CI/CD infrastructure ───────────────────────────────────────────

describe("DEPLOY-001: AC-008 CI/CD infrastructure", () => {
  it("defines webhook and pipeline-filter Lambda functions", () => {
    const raw = loadTemplateRaw("cello-cicd.yaml");
    expect(raw).toContain("github-webhook-receiver");
    expect(raw).toContain("pipeline-filter");
  });

  it("defines EventBridge bus", () => {
    const template = loadTemplate("cello-cicd.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const buses = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::Events::EventBus"
    );
    expect(buses.length).toBeGreaterThan(0);
  });

  it("defines 8 CodePipelines (one per package)", () => {
    const template = loadTemplate("cello-cicd.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const pipelines = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::CodePipeline::Pipeline"
    );
    expect(pipelines.length).toBe(8);
  });

  it("artifacts bucket name uses AWS::Region substitution", () => {
    const raw = loadTemplateRaw("cello-cicd.yaml");
    // Bucket name is derived from region at deploy time: cello-codepipeline-artifacts-{region}
    expect(raw).toContain("cello-codepipeline-artifacts-");
    expect(raw).toContain("AWS::Region");
  });
});

// ─── AC-009: Environment isolation ──────────────────────────────────────────

describe("DEPLOY-001: AC-009 environment isolation", () => {
  it("all core templates use Sub with Environment parameter for resource naming", () => {
    const templates = [
      "cello-vpc.yaml",
      "cello-rds.yaml",
      "cello-ecs-directory.yaml",
      "cello-ecs-relay.yaml",
      "cello-secrets.yaml",
      "cello-kms.yaml",
      "cello-s3.yaml",
    ];

    for (const name of templates) {
      const raw = loadTemplateRaw(name);
      expect(raw, `${name} should use \${Environment} substitution`).toContain("${Environment}");
    }
  });

  it("IAM policies use environment-scoped resource paths", () => {
    const raw = loadTemplateRaw("cello-ecs-directory.yaml");
    expect(raw).toContain("${Environment}/directory/");
  });
});

// ─── SI-001: No secret values in templates ──────────────────────────────────

describe("DEPLOY-001: SI-001 no secret values in templates", () => {
  it("secrets template uses only PLACEHOLDER values", () => {
    const template = loadTemplate("cello-secrets.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    for (const [name, resource] of Object.entries(resources)) {
      if ((resource["Type"] as string) === "AWS::SecretsManager::Secret") {
        const props = resource["Properties"] as Record<string, unknown>;
        const secretString = props["SecretString"] as string;
        expect(
          secretString,
          `${name} SecretString should be a placeholder`
        ).toContain("PLACEHOLDER_POPULATE_VIA_CLI");
      }
    }
  });

  it("no template file contains patterns resembling real private keys", () => {
    const templates = readdirSync(CFN_DIR).filter((f) => f.endsWith(".yaml"));

    for (const name of templates) {
      const raw = loadTemplateRaw(name);
      // A real Ed25519 private key would be 64 hex chars not part of a known pattern
      // We check that no line looks like it contains a standalone hex key
      const lines = raw.split("\n");
      for (const line of lines) {
        // Skip comment lines and known safe patterns
        if (line.trim().startsWith("#")) continue;
        // A private key line would have a hex string as the value
        const match = line.match(/:\s*["']?([0-9a-f]{64})["']?\s*$/i);
        if (match) {
          // If found, it must be 0-padded placeholder or template ref
          expect(match[1]).toMatch(/^0+$|PLACEHOLDER/);
        }
      }
    }
  });
});

// ─── SI-002: KMS key policy separation ──────────────────────────────────────
// DEPLOY-001A: DirectoryTaskRoleArn parameter removed from cello-kms.yaml.
// The key policy principal now uses !ImportValue from cello-iam.yaml.

describe("DEPLOY-001: SI-002 KMS key policy environment isolation", () => {
  it("KMS key policy references directory task role via ImportValue (not hardcoded)", () => {
    const template = loadTemplate("cello-kms.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;
    const key = resources["MasterKey"];
    expect(key).toBeDefined();

    const raw = JSON.stringify(key);
    // After DEPLOY-001A: uses ImportValue, not DirectoryTaskRoleArn parameter
    expect(raw).toContain("directory-task-role-arn");
    expect(raw).toContain("Fn::Sub");
    // Should NOT contain hardcoded environment-specific ARN strings
    expect(raw).not.toMatch(/"arn:aws:iam::\d+:role\/cello-dev/);
    expect(raw).not.toMatch(/"arn:aws:iam::\d+:role\/cello-production/);
  });
});

// ─── SI-003: CELLO CI/CD isolation from cello-agent ─────────────────────────

describe("DEPLOY-001: SI-003 CI/CD isolation from cello-agent in eu-west-1", () => {
  it("CI/CD template contains no eu-west-1 references", () => {
    const raw = loadTemplateRaw("cello-cicd.yaml");
    expect(raw).not.toContain("eu-west-1");
  });

  it("artifacts bucket name uses AWS::Region substitution", () => {
    const raw = loadTemplateRaw("cello-cicd.yaml");
    // Bucket name is cello-codepipeline-artifacts-{region} — derived at deploy time
    expect(raw).toContain("cello-codepipeline-artifacts-");
    expect(raw).toContain("AWS::Region");
  });

  it("IAM role names are CELLO-specific", () => {
    const raw = loadTemplateRaw("cello-cicd.yaml");
    expect(raw).toContain("cello-webhook-lambda-role");
    expect(raw).toContain("cello-pipeline-filter-lambda-role");
    expect(raw).toContain("cello-codebuild-role");
    expect(raw).toContain("cello-codepipeline-role");
  });
});

// ─── SI-004: VPC Peering ports restricted ───────────────────────────────────

describe("DEPLOY-001: SI-004 VPC Peering permits only ports 5432 and 4001", () => {
  it("security group ingress rules allow exactly port 5432 and 4001", () => {
    const template = loadTemplate("cello-vpc-peering.yaml");
    const resources = template["Resources"] as Record<string, Record<string, unknown>>;

    const ingressRules = Object.entries(resources).filter(
      ([, v]) => v["Type"] === "AWS::EC2::SecurityGroupIngress"
    );

    const ports = ingressRules.map(([, v]) => {
      const props = v["Properties"] as Record<string, unknown>;
      return props["FromPort"];
    });

    expect(ports).toContain(5432);
    expect(ports).toContain(4001);
    expect(ports.length).toBe(2);
  });

  it("no wildcard port ranges exist for peer CIDR", () => {
    const raw = loadTemplateRaw("cello-vpc-peering.yaml");
    expect(raw).not.toContain("FromPort: 0");
    expect(raw).not.toContain("ToPort: 65535");
    expect(raw).not.toContain("IpProtocol: -1");
  });
});
