#!/bin/bash
# =============================================================================
# INFRA-001: CELLO package CI pipelines (ACs 001–005)
#
# Creates 8 CodeBuild + CodePipeline pairs — one per @cello/* package.
# Each pipeline triggers on main branch pushes that touch packages/<name>/**
# or root config files (tsconfig.base.json, pnpm-workspace.yaml, package.json).
# Triggering is handled by the cello-pipeline-filter Lambda (see 27-update-filter.sh).
#
# Prerequisites:
#   - SCAFFOLD-001 complete (buildspec.yml exists in each packages/<name>/)
#   - github-cello-main CodeStar connection AVAILABLE (OAuth handshake done in console)
#   - cello-codebuild-role and cello-codepipeline-role exist (from existing infra)
#   - cello-pipeline-filter-lambda-role exists (from existing infra)
#   - S3 bucket cello-codepipeline-artifacts-eu-west-1 exists (from existing infra)
#
# ⚠️  MANUAL PREREQUISITE: The CodeStar connection "github-cello-main" must be created
# and authorized before running this script:
#   1. AWS Console → CodePipeline → Settings → Connections → Create connection
#   2. Provider: GitHub → Name: github-cello-main
#   3. Complete the OAuth flow
#   4. Copy the resulting ARN into GITHUB_CONNECTION_ARN below (or export it first)
#
# Usage:
#   AWS_PROFILE=mygentic ./infra/26-cello-package-pipelines.sh
# =============================================================================

set -euo pipefail

REGION="eu-west-1"
AWS_ACCOUNT_ID="257394457473"
GITHUB_REPO="Mygentic-AI/CELLO"
GITHUB_BRANCH="main"
ARTIFACTS_BUCKET="cello-codepipeline-artifacts-eu-west-1"
CODEBUILD_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/cello-codebuild-role"
CODEPIPELINE_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/cello-codepipeline-role"
FILTER_LAMBDA_ROLE="cello-pipeline-filter-lambda-role"

# CodeBuild image: standard:7.0 ships Node.js 24 (x86_64).
# The user story specifies aws/codebuild/standard:7.0 + BUILD_GENERAL1_SMALL.
CODEBUILD_IMAGE="aws/codebuild/standard:7.0"
COMPUTE_TYPE="BUILD_GENERAL1_SMALL"
ENVIRONMENT_TYPE="LINUX_CONTAINER"

# ── Resolve CodeStar connection ───────────────────────────────────────────────
# Look for a connection named "github-cello-main" first (new connection for this repo).
# Fall back to "github-cello-staging" only if the main connection does not exist,
# since that connection is for the cello-agent repo (different repo, but same account).
GITHUB_CONNECTION_ARN=$(aws codestar-connections list-connections \
  --region "$REGION" \
  --query 'Connections[?ConnectionName==`github-cello-main`].ConnectionArn' \
  --output text 2>/dev/null || true)

if [ -z "$GITHUB_CONNECTION_ARN" ]; then
  echo "ERROR: CodeStar connection 'github-cello-main' not found or not AVAILABLE."
  echo ""
  echo "Create it manually:"
  echo "  1. AWS Console → CodePipeline → Settings → Connections → Create connection"
  echo "  2. Provider: GitHub  Name: github-cello-main"
  echo "  3. Complete the OAuth flow"
  echo "  4. Re-run this script"
  exit 1
fi

CONNECTION_STATUS=$(aws codestar-connections get-connection \
  --connection-arn "$GITHUB_CONNECTION_ARN" \
  --region "$REGION" \
  --query 'Connection.ConnectionStatus' \
  --output text 2>/dev/null || echo "UNKNOWN")

if [ "$CONNECTION_STATUS" != "AVAILABLE" ]; then
  echo "ERROR: Connection '$GITHUB_CONNECTION_ARN' is $CONNECTION_STATUS (must be AVAILABLE)."
  echo "Complete the OAuth handshake in the AWS Console and re-run."
  exit 1
fi

echo "Using CodeStar connection: $GITHUB_CONNECTION_ARN"

# ── Package list ─────────────────────────────────────────────────────────────
# Format: "package-dir pipeline-suffix"
PACKAGES=(
  "crypto            cello-crypto-pipeline"
  "protocol-types    cello-protocol-types-pipeline"
  "transport         cello-transport-pipeline"
  "client            cello-client-pipeline"
  "adapter-claude-code cello-adapter-claude-code-pipeline"
  "directory         cello-directory-pipeline"
  "relay             cello-relay-pipeline"
  "e2e-tests         cello-e2e-tests-pipeline"
)

NEW_CODEBUILD_ARNS=()
NEW_PIPELINE_ARNS=()

for entry in "${PACKAGES[@]}"; do
  PKG_DIR=$(echo "$entry" | awk '{print $1}')
  PIPELINE_NAME=$(echo "$entry" | awk '{print $2}')
  BUILD_PROJECT="cello-${PKG_DIR}-build"
  BUILDSPEC_PATH="packages/${PKG_DIR}/buildspec.yml"

  echo ""
  echo "=== $PKG_DIR ==="

  # ── 1. Create CodeBuild project ──────────────────────────────────────────
  if aws codebuild batch-get-projects --names "$BUILD_PROJECT" --region "$REGION" \
      --query "projects[0].name" --output text 2>/dev/null | grep -q "$BUILD_PROJECT"; then
    echo "  CodeBuild project $BUILD_PROJECT already exists — skipping"
  else
    cat > /tmp/codebuild-project.json << EOF
{
  "name": "${BUILD_PROJECT}",
  "source": {
    "type": "CODEPIPELINE",
    "buildspec": "${BUILDSPEC_PATH}"
  },
  "artifacts": {
    "type": "CODEPIPELINE"
  },
  "environment": {
    "type": "${ENVIRONMENT_TYPE}",
    "image": "${CODEBUILD_IMAGE}",
    "computeType": "${COMPUTE_TYPE}",
    "privilegedMode": false
  },
  "serviceRole": "${CODEBUILD_ROLE_ARN}",
  "tags": [
    {"key": "Project", "value": "cello"},
    {"key": "Story",   "value": "INFRA-001"}
  ]
}
EOF
    aws codebuild create-project \
      --cli-input-json file:///tmp/codebuild-project.json \
      --region "$REGION" \
      --query 'project.name' --output text
    echo "  Created CodeBuild project: $BUILD_PROJECT"
  fi

  NEW_CODEBUILD_ARNS+=("arn:aws:codebuild:${REGION}:${AWS_ACCOUNT_ID}:project/${BUILD_PROJECT}")

  # ── 2. Create CodePipeline ────────────────────────────────────────────────
  if aws codepipeline get-pipeline --name "$PIPELINE_NAME" --region "$REGION" \
      --query 'pipeline.name' --output text 2>/dev/null | grep -q "$PIPELINE_NAME"; then
    echo "  Pipeline $PIPELINE_NAME already exists — skipping"
  else
    cat > /tmp/pipeline.json << EOF
{
  "pipeline": {
    "name": "${PIPELINE_NAME}",
    "roleArn": "${CODEPIPELINE_ROLE_ARN}",
    "artifactStore": {
      "type": "S3",
      "location": "${ARTIFACTS_BUCKET}"
    },
    "stages": [
      {
        "name": "Source",
        "actions": [{
          "name": "SourceAction",
          "actionTypeId": {
            "category": "Source",
            "owner": "AWS",
            "provider": "CodeStarSourceConnection",
            "version": "1"
          },
          "configuration": {
            "ConnectionArn": "${GITHUB_CONNECTION_ARN}",
            "FullRepositoryId": "${GITHUB_REPO}",
            "BranchName": "${GITHUB_BRANCH}",
            "DetectChanges": "false"
          },
          "outputArtifacts": [{"name": "SourceOutput"}]
        }]
      },
      {
        "name": "Build",
        "actions": [{
          "name": "BuildAction",
          "actionTypeId": {
            "category": "Build",
            "owner": "AWS",
            "provider": "CodeBuild",
            "version": "1"
          },
          "configuration": {
            "ProjectName": "${BUILD_PROJECT}"
          },
          "inputArtifacts":  [{"name": "SourceOutput"}],
          "outputArtifacts": [{"name": "BuildOutput"}]
        }]
      }
    ]
  }
}
EOF
    aws codepipeline create-pipeline \
      --cli-input-json file:///tmp/pipeline.json \
      --region "$REGION" \
      --query 'pipeline.name' --output text
    echo "  Created pipeline: $PIPELINE_NAME"
  fi

  NEW_PIPELINE_ARNS+=("arn:aws:codepipeline:${REGION}:${AWS_ACCOUNT_ID}:${PIPELINE_NAME}")
done

# ── 3. Extend CodePipeline role: add the 8 new CodeBuild project ARNs ────────
echo ""
echo "=== Updating cello-codepipeline-role (CodeBuild permissions) ==="

CURRENT_CP_POLICY=$(aws iam get-role-policy \
  --role-name cello-codepipeline-role \
  --policy-name CodePipelinePermissions \
  --region "$REGION" \
  --query 'PolicyDocument' \
  --output json)

UPDATED_CP_POLICY=$(ACCT="$AWS_ACCOUNT_ID" REGION="$REGION" python3 - << 'PYEOF'
import json, sys, os

acct   = os.environ["ACCT"]
region = os.environ["REGION"]
policy = json.load(sys.stdin)
new_projects = [
    f"arn:aws:codebuild:{region}:{acct}:project/cello-crypto-build",
    f"arn:aws:codebuild:{region}:{acct}:project/cello-protocol-types-build",
    f"arn:aws:codebuild:{region}:{acct}:project/cello-transport-build",
    f"arn:aws:codebuild:{region}:{acct}:project/cello-client-build",
    f"arn:aws:codebuild:{region}:{acct}:project/cello-adapter-claude-code-build",
    f"arn:aws:codebuild:{region}:{acct}:project/cello-directory-build",
    f"arn:aws:codebuild:{region}:{acct}:project/cello-relay-build",
    f"arn:aws:codebuild:{region}:{acct}:project/cello-e2e-tests-build",
]
found = False
for stmt in policy["Statement"]:
    actions = stmt.get("Action", [])
    # Normalise to list so membership test works whether Action is a string or list.
    if isinstance(actions, str):
        actions = [actions]
    if "codebuild:StartBuild" in actions:
        existing = stmt["Resource"] if isinstance(stmt["Resource"], list) else [stmt["Resource"]]
        stmt["Resource"] = list(set(existing + new_projects))
        found = True
        break
if not found:
    print("ERROR: codebuild:StartBuild statement not found in CodePipelinePermissions policy", file=sys.stderr)
    sys.exit(1)
print(json.dumps(policy))
PYEOF
)

aws iam put-role-policy \
  --role-name cello-codepipeline-role \
  --policy-name CodePipelinePermissions \
  --policy-document "$UPDATED_CP_POLICY" \
  --region "$REGION"
echo "  CodePipeline role updated"

# ── 4. Extend pipeline-filter Lambda role: add the 8 new pipeline ARNs ───────
echo ""
echo "=== Updating cello-pipeline-filter-lambda-role (StartPipelineExecution) ==="

CURRENT_FILTER_POLICY=$(aws iam get-role-policy \
  --role-name "$FILTER_LAMBDA_ROLE" \
  --policy-name CodePipelineStartExecution \
  --region "$REGION" \
  --query 'PolicyDocument' \
  --output json)

UPDATED_FILTER_POLICY=$(ACCT="$AWS_ACCOUNT_ID" REGION="$REGION" python3 - << 'PYEOF'
import json, sys, os

acct   = os.environ["ACCT"]
region = os.environ["REGION"]
policy = json.load(sys.stdin)
new_pipelines = [
    f"arn:aws:codepipeline:{region}:{acct}:cello-crypto-pipeline",
    f"arn:aws:codepipeline:{region}:{acct}:cello-protocol-types-pipeline",
    f"arn:aws:codepipeline:{region}:{acct}:cello-transport-pipeline",
    f"arn:aws:codepipeline:{region}:{acct}:cello-client-pipeline",
    f"arn:aws:codepipeline:{region}:{acct}:cello-adapter-claude-code-pipeline",
    f"arn:aws:codepipeline:{region}:{acct}:cello-directory-pipeline",
    f"arn:aws:codepipeline:{region}:{acct}:cello-relay-pipeline",
    f"arn:aws:codepipeline:{region}:{acct}:cello-e2e-tests-pipeline",
]
# Target only the StartPipelineExecution statement — guard against future
# additional statements in this policy getting pipeline ARNs appended incorrectly.
found = False
for stmt in policy["Statement"]:
    actions = stmt.get("Action", [])
    if isinstance(actions, str):
        actions = [actions]
    if "codepipeline:StartPipelineExecution" in actions:
        existing = stmt["Resource"] if isinstance(stmt["Resource"], list) else [stmt["Resource"]]
        stmt["Resource"] = list(set(existing + new_pipelines))
        found = True
        break
if not found:
    print("ERROR: codepipeline:StartPipelineExecution statement not found in CodePipelineStartExecution policy", file=sys.stderr)
    sys.exit(1)
print(json.dumps(policy))
PYEOF
)

aws iam put-role-policy \
  --role-name "$FILTER_LAMBDA_ROLE" \
  --policy-name CodePipelineStartExecution \
  --policy-document "$UPDATED_FILTER_POLICY" \
  --region "$REGION"
echo "  Filter Lambda role updated"

echo ""
echo "=== COMPLETE ==="
echo "8 CodeBuild projects and 8 CodePipelines created."
echo "Run infra/27-update-pipeline-filter.sh next to deploy the updated filter Lambda."
echo "Run infra/28-register-github-webhook.sh next to register the webhook on Mygentic-AI/CELLO."
