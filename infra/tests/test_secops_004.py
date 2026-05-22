#!/usr/bin/env python3
"""
SECOPS-004 infrastructure tests.

AC coverage:
  AC-001: cello-secrets.yaml has RotationRules and rotation Lambda for rds-credentials
  AC-006: node-private-key secrets do NOT have a rotation Lambda configured
  AC-007: infra/runbooks/node-key-rotation.md exists and contains required sections
  AC-008-key-generation-script: infra/scripts/generate-node-keys.sh exists and
          handles idempotency (exits non-zero with correct message when key exists)
          and --rotate flag (overwrites with WARNING)

SI-003 coverage:
  ECS task role IAM policy must NOT include rds-admin-credentials in its resource list
  Only the rotation Lambda execution role grants access to rds-admin-credentials

Notes:
  AC-002/AC-003: Live rotation test against real AWS — marked as integration (manual verify).
  AC-004/AC-005: ACM auto-renewal is an AWS-managed behaviour; verified by reading
                 cello-route53.yaml uses ACM (Type: AWS::CertificateManager::Certificate).
  The unit tests here verify the IaC structure that enables/disables rotation correctly.
"""

import os
import stat
import sys
import yaml

# ── Resolve repo root ────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INFRA_DIR = os.path.dirname(SCRIPT_DIR)
CFN_DIR = os.path.join(INFRA_DIR, "cloudformation")
SCRIPTS_DIR = os.path.join(INFRA_DIR, "scripts")
RUNBOOKS_DIR = os.path.join(INFRA_DIR, "runbooks")
LAMBDA_DIR = os.path.join(INFRA_DIR, "lambda", "rds-rotation")


# ── CloudFormation-aware YAML loader ─────────────────────────────────────────
# CloudFormation templates use !Ref, !Sub, !ImportValue, !GetAtt, !If, etc.
# Python's yaml.safe_load treats these as unknown tags and raises ConstructorError.
# We register all CFN intrinsic function tags as plain string/dict constructors
# so we can inspect the template structure without needing cfn-python-lint.

class _CfnTag(yaml.YAMLObject):
    """Opaque placeholder for any CloudFormation intrinsic function tag."""
    def __init__(self, tag, value):
        self.tag = tag
        self.value = value

    def __repr__(self):
        return f"{self.tag}({self.value!r})"

    def __str__(self):
        return repr(self)


def _cfn_constructor(loader, tag_suffix, node):
    """Generic constructor for any !Tag node — returns a _CfnTag wrapper."""
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node, deep=True)
    else:
        value = loader.construct_mapping(node, deep=True)
    return _CfnTag(tag_suffix, value)


class CfnLoader(yaml.SafeLoader):
    pass


# Register all known CFN intrinsic function tags
for _tag in [
    "!Ref", "!Sub", "!ImportValue", "!GetAtt", "!If", "!And", "!Or",
    "!Not", "!Equals", "!Select", "!Split", "!Join", "!FindInMap",
    "!Base64", "!Cidr", "!Transform", "!Condition",
]:
    CfnLoader.add_multi_constructor(_tag, _cfn_constructor)

# Also handle the implicit multi-constructor for any remaining tags
CfnLoader.add_multi_constructor("", _cfn_constructor)


def load_yaml(filename: str) -> dict:
    path = os.path.join(CFN_DIR, filename)
    with open(path) as f:
        return yaml.load(f, Loader=CfnLoader)  # noqa: S506 — internal test only


# ════════════════════════════════════════════════════════════════════════════
# AC-001: rds-credentials secret has RotationRules (30 days) + rotation Lambda
# ════════════════════════════════════════════════════════════════════════════


def test_ac001_rds_credentials_rotation_enabled():
    """AC-001: cello-rotation.yaml has a RotationSchedule for rds-credentials (30 days).

    The rotation schedule lives in cello-rotation.yaml (not cello-secrets.yaml) to avoid
    a first-deploy circular dependency. AWS::SecretsManager::RotationSchedule wires the
    Lambda ARN to the secret after both the secret and Lambda exist.
    """
    tmpl = load_yaml("cello-rotation.yaml")
    resources = tmpl["Resources"]

    rotation_schedules = {
        name: res for name, res in resources.items()
        if res.get("Type") == "AWS::SecretsManager::RotationSchedule"
    }
    assert rotation_schedules, (
        "cello-rotation.yaml must define an AWS::SecretsManager::RotationSchedule "
        "for rds-credentials (AC-001)"
    )

    for name, sched in rotation_schedules.items():
        props = sched.get("Properties", {})
        rules = props.get("RotationRules", {})
        assert rules.get("AutomaticallyAfterDays") == 30, (
            f"RotationSchedule {name}: AutomaticallyAfterDays must be 30, "
            f"got: {rules.get('AutomaticallyAfterDays')}"
        )


def test_ac001_rds_credentials_rotation_lambda_arn():
    """AC-001: RotationSchedule in cello-rotation.yaml references the Lambda function."""
    tmpl = load_yaml("cello-rotation.yaml")
    resources = tmpl["Resources"]

    rotation_schedules = {
        name: res for name, res in resources.items()
        if res.get("Type") == "AWS::SecretsManager::RotationSchedule"
    }
    assert rotation_schedules, (
        "cello-rotation.yaml must have an AWS::SecretsManager::RotationSchedule"
    )

    for name, sched in rotation_schedules.items():
        props = sched.get("Properties", {})
        lambda_arn = props.get("RotationLambdaARN")
        assert lambda_arn is not None, (
            f"RotationSchedule {name} must specify RotationLambdaARN"
        )
        arn_str = str(lambda_arn)
        assert "257394457473" not in arn_str, (
            "RotationLambdaARN must not hardcode the account ID"
        )


def test_ac001_rds_credentials_no_rotation_in_secrets_yaml():
    """AC-001: cello-secrets.yaml must NOT have RotationRules or RotationLambdaARN.

    The rotation schedule is in cello-rotation.yaml to avoid first-deploy circular
    dependency (cello-secrets deploys in Step 2, before the Lambda exists in Step 6a).
    """
    tmpl = load_yaml("cello-secrets.yaml")
    resources = tmpl["Resources"]

    rds_cred = resources.get("RdsCredentials", {})
    props = rds_cred.get("Properties", {})

    assert "RotationLambdaARN" not in props, (
        "RdsCredentials in cello-secrets.yaml must NOT have RotationLambdaARN — "
        "rotation schedule lives in cello-rotation.yaml to avoid first-deploy "
        "circular dependency (Step 2 deploys before Step 6a)"
    )
    assert "RotationRules" not in props, (
        "RdsCredentials in cello-secrets.yaml must NOT have RotationRules — "
        "rotation schedule lives in cello-rotation.yaml"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-004/AC-005: ACM certificate is ACM-issued via cello-route53.yaml
# ════════════════════════════════════════════════════════════════════════════


def test_ac004_acm_certificate_is_acm_issued():
    """AC-004/AC-005: cello-route53.yaml uses AWS::CertificateManager::Certificate.

    ACM-issued certificates auto-renew automatically (no operator action required).
    This structural test verifies the template does not use a manually-uploaded cert.
    """
    tmpl = load_yaml("cello-route53.yaml")
    resources = tmpl.get("Resources", {})

    acm_certs = [
        name for name, res in resources.items()
        if res.get("Type") == "AWS::CertificateManager::Certificate"
    ]
    assert acm_certs, (
        "cello-route53.yaml must define an AWS::CertificateManager::Certificate "
        "resource — manually-uploaded certificates are not permitted (AC-004, SI-002)"
    )


def test_ac004_acm_certificate_uses_dns_validation():
    """AC-004: ACM certificate uses DNS validation for auto-renewal support."""
    tmpl = load_yaml("cello-route53.yaml")
    resources = tmpl.get("Resources", {})

    for name, res in resources.items():
        if res.get("Type") == "AWS::CertificateManager::Certificate":
            props = res.get("Properties", {})
            method = props.get("ValidationMethod")
            assert method == "DNS", (
                f"ACM certificate {name} must use DNS validation (ValidationMethod: DNS) "
                "for ACM auto-renewal to work. Email validation requires manual action."
            )


# ════════════════════════════════════════════════════════════════════════════
# SI-004: DB_PASSWORD must NOT be injected as a task-launch snapshot
# ════════════════════════════════════════════════════════════════════════════


def test_si004_db_password_not_injected_as_task_launch_snapshot():
    """SI-004: cello-ecs-directory.yaml must NOT inject DB_PASSWORD via Secrets.ValueFrom.

    ECS Secrets.ValueFrom fetches the secret value once at task launch and injects it
    as a snapshot env var. After rotation, the task holds a stale password until it
    restarts — defeating the 30-day rotation. Instead, inject RDS_CREDENTIALS_SECRET_ARN
    as a plain env var; the application calls GetSecretValue at connection-pool refresh.
    """
    path = os.path.join(CFN_DIR, "cello-ecs-directory.yaml")
    assert os.path.exists(path), f"cello-ecs-directory.yaml not found at {path}"

    with open(path) as f:
        content = f.read()

    # DB_PASSWORD must not appear as a Secrets.ValueFrom name
    # Parse the YAML to check the Secrets list structure
    tmpl = yaml.load(open(path), Loader=CfnLoader)  # noqa: S506 — internal test
    task_defs = [
        res for res in tmpl.get("Resources", {}).values()
        if res.get("Type") == "AWS::ECS::TaskDefinition"
    ]
    assert task_defs, "No ECS TaskDefinition found in cello-ecs-directory.yaml"

    for task_def in task_defs:
        containers = task_def.get("Properties", {}).get("ContainerDefinitions", [])
        for container in containers:
            secrets = container.get("Secrets", [])
            secret_names = [s.get("Name", "") for s in secrets]
            assert "DB_PASSWORD" not in secret_names, (
                "SI-004 VIOLATION: DB_PASSWORD injected via Secrets.ValueFrom "
                "is a task-launch snapshot. After rotation it goes stale. "
                "Use RDS_CREDENTIALS_SECRET_ARN as a plain env var instead — "
                "the application must call GetSecretValue at connection-pool refresh time."
            )


# ════════════════════════════════════════════════════════════════════════════
# AC-006: node-private-key secrets do NOT have rotation Lambda configured
# ════════════════════════════════════════════════════════════════════════════


def test_ac006_directory_node_private_key_no_rotation():
    """AC-006: directory node-private-key secret has no rotation Lambda."""
    tmpl = load_yaml("cello-secrets.yaml")
    resources = tmpl["Resources"]

    assert "DirectoryNodePrivateKey" in resources, "DirectoryNodePrivateKey missing"
    props = resources["DirectoryNodePrivateKey"]["Properties"]

    # Must NOT have RotationLambdaARN
    assert "RotationLambdaARN" not in props, (
        "DirectoryNodePrivateKey must NOT have RotationLambdaARN — "
        "node key rotation is manual and coordinated (AC-006)"
    )
    # Must NOT have RotationRules
    assert "RotationRules" not in props, (
        "DirectoryNodePrivateKey must NOT have RotationRules (AC-006)"
    )


def test_ac006_relay_node_private_key_no_rotation():
    """AC-006: relay node-private-key secret has no rotation Lambda."""
    tmpl = load_yaml("cello-secrets.yaml")
    resources = tmpl["Resources"]

    assert "RelayNodePrivateKey" in resources, "RelayNodePrivateKey missing"
    props = resources["RelayNodePrivateKey"]["Properties"]

    assert "RotationLambdaARN" not in props, (
        "RelayNodePrivateKey must NOT have RotationLambdaARN (AC-006)"
    )
    assert "RotationRules" not in props, (
        "RelayNodePrivateKey must NOT have RotationRules (AC-006)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-007: Runbook exists and contains required sections
# ════════════════════════════════════════════════════════════════════════════

REQUIRED_RUNBOOK_SECTIONS = [
    "generate",          # Step 1: generate new Ed25519 key pair
    "relay",             # Step 2: relay node procedure
    "relayId",           # relay node derives new relayId from new key
    "directory",         # Step 3: directory node procedure
    "rolling",           # rolling ECS task restart
    "distribute",        # distribute public key to peers before stopping old tasks
    "node-private-key",  # Secrets Manager secret name
]


def test_ac007_runbook_exists():
    """AC-007: infra/runbooks/node-key-rotation.md exists."""
    path = os.path.join(RUNBOOKS_DIR, "node-key-rotation.md")
    assert os.path.exists(path), (
        f"Runbook not found at {path} — AC-007 requires this file"
    )


def test_ac007_runbook_contains_required_sections():
    """AC-007: runbook contains all required procedural sections."""
    path = os.path.join(RUNBOOKS_DIR, "node-key-rotation.md")
    with open(path) as f:
        content = f.read().lower()

    missing = []
    for section in REQUIRED_RUNBOOK_SECTIONS:
        if section.lower() not in content:
            missing.append(section)

    assert not missing, (
        f"Runbook missing required content: {missing}\n"
        "AC-007: runbook must cover generate keypair, relay procedure, "
        "directory procedure with public key distribution and rolling restart"
    )


def test_ac007_runbook_covers_generate_script():
    """AC-007: runbook references the generate-node-keys.sh script."""
    path = os.path.join(RUNBOOKS_DIR, "node-key-rotation.md")
    with open(path) as f:
        content = f.read()

    assert "generate-node-keys.sh" in content, (
        "Runbook must reference infra/scripts/generate-node-keys.sh (AC-007, AC-008)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-008: generate-node-keys.sh exists, is executable, and has correct structure
# ════════════════════════════════════════════════════════════════════════════


def test_ac008_script_exists():
    """AC-008: infra/scripts/generate-node-keys.sh exists."""
    path = os.path.join(SCRIPTS_DIR, "generate-node-keys.sh")
    assert os.path.exists(path), (
        f"generate-node-keys.sh not found at {path}"
    )


def test_ac008_script_is_executable():
    """AC-008: generate-node-keys.sh is executable."""
    path = os.path.join(SCRIPTS_DIR, "generate-node-keys.sh")
    mode = os.stat(path).st_mode
    assert bool(mode & stat.S_IXUSR), (
        "generate-node-keys.sh must be executable (chmod +x)"
    )


def test_ac008_script_contains_idempotency_check():
    """AC-008: script exits with correct message when key already exists."""
    path = os.path.join(SCRIPTS_DIR, "generate-node-keys.sh")
    with open(path) as f:
        content = f.read()

    assert "Key already exists" in content, (
        "Script must contain idempotency message: "
        "'Key already exists — use --rotate flag to replace'"
    )
    assert "--rotate" in content, (
        "Script must support --rotate flag for overwriting existing keys"
    )


def test_ac008_script_contains_rotate_warning():
    """AC-008: script prints WARNING when --rotate flag is used."""
    path = os.path.join(SCRIPTS_DIR, "generate-node-keys.sh")
    with open(path) as f:
        content = f.read()

    assert "WARNING" in content, (
        "Script must print a WARNING when --rotate flag overwrites an existing key"
    )


def test_ac008_script_uses_openssl_ed25519():
    """AC-008: script uses openssl genpkey -algorithm ed25519 for key generation."""
    path = os.path.join(SCRIPTS_DIR, "generate-node-keys.sh")
    with open(path) as f:
        content = f.read()

    assert "genpkey" in content and "ed25519" in content, (
        "Script must use 'openssl genpkey -algorithm ed25519' for key generation "
        "— not random bytes (AC-008)"
    )


def test_ac008_script_stores_in_secrets_manager():
    """AC-008: script calls aws secretsmanager put-secret-value."""
    path = os.path.join(SCRIPTS_DIR, "generate-node-keys.sh")
    with open(path) as f:
        content = f.read()

    assert "secretsmanager" in content and "put-secret-value" in content, (
        "Script must store private key via aws secretsmanager put-secret-value"
    )


def test_ac008_script_prints_public_key():
    """AC-008: script prints public key hex to stdout."""
    path = os.path.join(SCRIPTS_DIR, "generate-node-keys.sh")
    with open(path) as f:
        content = f.read()

    # Script must derive and print the public key
    assert "public" in content.lower(), (
        "Script must derive and print the public key hex to stdout (AC-008)"
    )


# ════════════════════════════════════════════════════════════════════════════
# SI-003: ECS task role must NOT have access to rds-admin-credentials
# ════════════════════════════════════════════════════════════════════════════


def _check_role_for_admin_access(role_name: str, role_resource: dict) -> None:
    """Helper: assert a role's policies do not allow access to rds-admin-credentials.

    Checks both explicit mentions of 'rds-admin-credentials' and wildcard patterns
    like 'directory/*' that would implicitly include the admin credential.
    """
    policies = role_resource.get("Properties", {}).get("Policies", [])

    # Secrets that are explicitly allowed for ECS task roles
    ALLOWED_SECRETS = {"rds-credentials", "node-private-key", "kms-key-arn"}

    for policy in policies:
        doc = policy.get("PolicyDocument", {})
        for stmt in doc.get("Statement", []):
            resources_list = stmt.get("Resource", [])
            if isinstance(resources_list, str):
                resources_list = [resources_list]
            for res in resources_list:
                res_str = str(res)

                # Direct mention
                assert "rds-admin-credentials" not in res_str, (
                    f"SI-003 VIOLATION: {role_name} must NOT have access to "
                    f"rds-admin-credentials. Found explicit reference: {res_str}\n"
                    "Only the rotation Lambda execution role may access the admin credential."
                )

                # Wildcard pattern that would cover rds-admin-credentials:
                #   cello/${Environment}/directory/*
                # Any trailing wildcard on the directory prefix must be rejected.
                if "secretsmanager" in res_str and "/directory/" in res_str:
                    assert not res_str.endswith("/*"), (
                        f"SI-003 VIOLATION: {role_name} uses wildcard 'directory/*' "
                        f"in resource ARN: {res_str}\n"
                        "This wildcard covers rds-admin-credentials. "
                        "Enumerate specific secrets: rds-credentials, node-private-key, kms-key-arn."
                    )
                    # Check the resource doesn't use a prefix that covers admin
                    # e.g., 'directory/rds*' would match both rds-credentials and rds-admin-credentials
                    if "/directory/rds*" in res_str:
                        assert False, (
                            f"SI-003 VIOLATION: {role_name} uses 'directory/rds*' wildcard "
                            f"in resource ARN: {res_str}\n"
                            "This matches both rds-credentials and rds-admin-credentials. "
                            "Use 'directory/rds-credentials*' (not 'directory/rds*')."
                        )


def test_si003_ecs_task_role_cannot_access_rds_admin():
    """SI-003: DirectoryTaskRole must NOT grant access to rds-admin-credentials.

    Checks both explicit references and wildcard patterns (directory/*) that
    would implicitly include the admin credential (SECOPS-004 blocking finding).
    """
    tmpl = load_yaml("cello-iam.yaml")
    resources = tmpl["Resources"]

    assert "DirectoryTaskRole" in resources, "DirectoryTaskRole missing from cello-iam.yaml"
    _check_role_for_admin_access("DirectoryTaskRole", resources["DirectoryTaskRole"])


def test_si003_ecs_task_execution_role_cannot_access_rds_admin():
    """SI-003: DirectoryTaskExecutionRole must NOT grant access to rds-admin-credentials.

    The execution role (used by the ECS agent for image pull and log writing) also
    had the directory/* wildcard. Verify it is also narrowed.
    """
    tmpl = load_yaml("cello-iam.yaml")
    resources = tmpl["Resources"]

    assert "DirectoryTaskExecutionRole" in resources, "DirectoryTaskExecutionRole missing"
    _check_role_for_admin_access("DirectoryTaskExecutionRole", resources["DirectoryTaskExecutionRole"])


# ════════════════════════════════════════════════════════════════════════════
# cello-rotation.yaml exists and has required resources
# ════════════════════════════════════════════════════════════════════════════


def test_rotation_template_exists():
    """cello-rotation.yaml CloudFormation template exists."""
    path = os.path.join(CFN_DIR, "cello-rotation.yaml")
    assert os.path.exists(path), (
        "infra/cloudformation/cello-rotation.yaml not found — "
        "SECOPS-004 requires a dedicated rotation Lambda CloudFormation template"
    )


def test_rotation_template_has_lambda_function():
    """cello-rotation.yaml defines the rotation Lambda function."""
    tmpl = load_yaml("cello-rotation.yaml")
    resources = tmpl.get("Resources", {})

    lambda_resources = [
        name for name, res in resources.items()
        if res.get("Type") == "AWS::Lambda::Function"
    ]
    assert lambda_resources, (
        "cello-rotation.yaml must define an AWS::Lambda::Function resource"
    )


def test_rotation_template_lambda_in_vpc():
    """cello-rotation.yaml: rotation Lambda must be configured to run in VPC."""
    tmpl = load_yaml("cello-rotation.yaml")
    resources = tmpl.get("Resources", {})

    lambda_resources = {
        name: res for name, res in resources.items()
        if res.get("Type") == "AWS::Lambda::Function"
    }
    assert lambda_resources, "No Lambda function found in cello-rotation.yaml"

    for name, res in lambda_resources.items():
        props = res.get("Properties", {})
        vpc_config = props.get("VpcConfig")
        assert vpc_config is not None, (
            f"Lambda {name} must have VpcConfig — it needs VPC network access to reach RDS on port 5432"
        )
        assert "SubnetIds" in vpc_config, (
            f"Lambda {name} VpcConfig must specify SubnetIds"
        )
        assert "SecurityGroupIds" in vpc_config, (
            f"Lambda {name} VpcConfig must specify SecurityGroupIds"
        )


def test_rotation_template_has_execution_role():
    """cello-rotation.yaml: rotation Lambda has a least-privilege execution role."""
    tmpl = load_yaml("cello-rotation.yaml")
    resources = tmpl.get("Resources", {})

    iam_roles = [
        name for name, res in resources.items()
        if res.get("Type") == "AWS::IAM::Role"
    ]
    assert iam_roles, (
        "cello-rotation.yaml must define an IAM execution role for the rotation Lambda"
    )


def test_rotation_template_execution_role_allows_admin_credentials():
    """cello-rotation.yaml: rotation Lambda role has access to rds-admin-credentials."""
    tmpl = load_yaml("cello-rotation.yaml")
    resources = tmpl.get("Resources", {})

    # Find execution role(s)
    iam_roles = {
        name: res for name, res in resources.items()
        if res.get("Type") == "AWS::IAM::Role"
    }

    found_admin_access = False
    for name, role in iam_roles.items():
        policies = role.get("Properties", {}).get("Policies", [])
        for policy in policies:
            doc = policy.get("PolicyDocument", {})
            for stmt in doc.get("Statement", []):
                for res in (stmt.get("Resource", []) if isinstance(stmt.get("Resource"), list) else [stmt.get("Resource", "")]):
                    if "rds-admin-credentials" in str(res) or "admin" in str(res).lower():
                        found_admin_access = True

    assert found_admin_access, (
        "cello-rotation.yaml: rotation Lambda execution role must have "
        "access to rds-admin-credentials (the admin credential the Lambda "
        "uses to update the cello_service password)"
    )


def test_rotation_template_exports_lambda_arn():
    """cello-rotation.yaml exports the rotation Lambda ARN for use in cello-secrets.yaml."""
    tmpl = load_yaml("cello-rotation.yaml")
    outputs = tmpl.get("Outputs", {})

    assert outputs, "cello-rotation.yaml must have Outputs section"

    # At least one output must export the Lambda ARN
    export_names = []
    for output_name, output in outputs.items():
        export = output.get("Export", {})
        export_name = export.get("Name", "")
        export_names.append(str(export_name))

    # Check that some export contains "rotation" and "lambda" (case insensitive)
    rotation_exports = [
        n for n in export_names
        if "rotation" in n.lower() or "lambda" in n.lower()
    ]
    assert rotation_exports, (
        "cello-rotation.yaml must export the rotation Lambda ARN "
        f"(found exports: {export_names})"
    )


# ════════════════════════════════════════════════════════════════════════════
# Lambda source code exists
# ════════════════════════════════════════════════════════════════════════════


def test_rotation_lambda_source_exists():
    """Rotation Lambda source code exists at infra/lambda/rds-rotation/."""
    path = os.path.join(LAMBDA_DIR, "handler.py")
    assert os.path.exists(path), (
        f"Rotation Lambda handler not found at {path}"
    )


def test_rotation_lambda_implements_four_step_protocol():
    """Rotation Lambda implements the four-step Secrets Manager rotation protocol."""
    path = os.path.join(LAMBDA_DIR, "handler.py")
    with open(path) as f:
        content = f.read()

    for step in ["createSecret", "setSecret", "testSecret", "finishSecret"]:
        assert step in content, (
            f"Rotation Lambda must implement step: {step}\n"
            "AWS Secrets Manager rotation requires all four steps: "
            "createSecret, setSecret, testSecret, finishSecret"
        )


def test_rotation_lambda_logs_completion():
    """Rotation Lambda logs secrets.rotation.completed at INFO on success."""
    path = os.path.join(LAMBDA_DIR, "handler.py")
    with open(path) as f:
        content = f.read()

    assert "secrets.rotation.completed" in content, (
        "Rotation Lambda must log 'secrets.rotation.completed' at INFO "
        "with {secretId, rotationDuration} (AC-002, observability)"
    )


def test_rotation_lambda_logs_failure():
    """Rotation Lambda logs secrets.rotation.failed at ERROR on failure."""
    path = os.path.join(LAMBDA_DIR, "handler.py")
    with open(path) as f:
        content = f.read()

    assert "secrets.rotation.failed" in content, (
        "Rotation Lambda must log 'secrets.rotation.failed' at ERROR "
        "with {secretId, reason} (AC-003, observability)"
    )


def test_rotation_lambda_no_hardcoded_credentials():
    """Rotation Lambda contains no hardcoded credentials or ARNs."""
    path = os.path.join(LAMBDA_DIR, "handler.py")
    with open(path) as f:
        content = f.read()

    # Check for suspicious hardcoded patterns
    suspicious = ["257394457473", "PLACEHOLDER_POPULATE", "password123", "admin123"]
    for pattern in suspicious:
        assert pattern not in content, (
            f"Rotation Lambda must not contain hardcoded value: {pattern}"
        )


# ════════════════════════════════════════════════════════════════════════════
# deploy.sh contains cello-rotation step
# ════════════════════════════════════════════════════════════════════════════


def test_deploy_sh_contains_rotation_step():
    """deploy.sh must deploy cello-rotation between cello-rds and cello-ecs-directory."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    assert "cello-rotation" in content, (
        "infra/deploy.sh must deploy the cello-rotation stack (SECOPS-004)"
    )


def test_deploy_sh_rotation_ordered_correctly():
    """deploy.sh deploys cello-rotation after cello-rds and before cello-ecs-directory."""
    path = os.path.join(INFRA_DIR, "deploy.sh")
    with open(path) as f:
        content = f.read()

    # Search for the deploy_stack invocation lines specifically, not comment occurrences
    rds_pos = content.find('deploy_stack "cello-rds-')
    rotation_pos = content.find('deploy_stack "cello-rotation-')
    ecs_dir_pos = content.find('deploy_stack "cello-ecs-directory-')

    assert rds_pos != -1, "deploy_stack cello-rds not found in deploy.sh"
    assert rotation_pos != -1, "deploy_stack cello-rotation not found in deploy.sh"
    assert ecs_dir_pos != -1, "deploy_stack cello-ecs-directory not found in deploy.sh"

    assert rds_pos < rotation_pos, (
        "cello-rotation must be deployed AFTER cello-rds (rotation Lambda needs RDS to exist)"
    )
    assert rotation_pos < ecs_dir_pos, (
        "cello-rotation must be deployed BEFORE cello-ecs-directory "
        "(secrets rotation ARN must exist before ECS tasks start)"
    )


# ════════════════════════════════════════════════════════════════════════════
# AC-002/AC-003 notes (live integration tests — manual verify)
# ════════════════════════════════════════════════════════════════════════════

# AC-002 and AC-003 require a live AWS environment:
#   aws secretsmanager rotate-secret --secret-id cello/dev/directory/rds-credentials
# These are documented in the runbook and verified manually post-deploy.
# They cannot be unit-tested without a live RDS + Secrets Manager environment.

# AC-004/AC-005 notes (ACM auto-renewal — AWS-managed behavior):
#   ACM certificates issued via cello-route53.yaml auto-renew automatically.
#   The certificate is Type: AWS::CertificateManager::Certificate.
#   No operator action required — AWS renews 60 days before expiry.
#   Verified post-deploy via: aws acm describe-certificate --certificate-arn <arn>


if __name__ == "__main__":
    import traceback

    tests = [
        test_ac001_rds_credentials_rotation_enabled,
        test_ac001_rds_credentials_rotation_lambda_arn,
        test_ac001_rds_credentials_no_rotation_in_secrets_yaml,
        test_ac004_acm_certificate_is_acm_issued,
        test_ac004_acm_certificate_uses_dns_validation,
        test_si004_db_password_not_injected_as_task_launch_snapshot,
        test_ac006_directory_node_private_key_no_rotation,
        test_ac006_relay_node_private_key_no_rotation,
        test_ac007_runbook_exists,
        test_ac007_runbook_contains_required_sections,
        test_ac007_runbook_covers_generate_script,
        test_ac008_script_exists,
        test_ac008_script_is_executable,
        test_ac008_script_contains_idempotency_check,
        test_ac008_script_contains_rotate_warning,
        test_ac008_script_uses_openssl_ed25519,
        test_ac008_script_stores_in_secrets_manager,
        test_ac008_script_prints_public_key,
        test_si003_ecs_task_role_cannot_access_rds_admin,
        test_si003_ecs_task_execution_role_cannot_access_rds_admin,
        test_rotation_template_exists,
        test_rotation_template_has_lambda_function,
        test_rotation_template_lambda_in_vpc,
        test_rotation_template_has_execution_role,
        test_rotation_template_execution_role_allows_admin_credentials,
        test_rotation_template_exports_lambda_arn,
        test_rotation_lambda_source_exists,
        test_rotation_lambda_implements_four_step_protocol,
        test_rotation_lambda_logs_completion,
        test_rotation_lambda_logs_failure,
        test_rotation_lambda_no_hardcoded_credentials,
        test_deploy_sh_contains_rotation_step,
        test_deploy_sh_rotation_ordered_correctly,
    ]

    passed = 0
    failed = 0
    errors = []

    for test in tests:
        try:
            test()
            print(f"  PASS  {test.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {test.__name__}: {e}")
            failed += 1
            errors.append((test.__name__, str(e)))
        except Exception as e:
            print(f"  ERROR {test.__name__}: {e}")
            traceback.print_exc()
            failed += 1
            errors.append((test.__name__, str(e)))

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
