#!/bin/bash
# =============================================================================
# INFRA-001: Register GitHub push webhook on Mygentic-AI/CELLO
#
# Fetches the shared webhook secret from Secrets Manager and registers a push
# webhook on the CELLO repo pointing at the existing github-webhook-receiver
# Lambda Function URL. All push events on any branch are delivered; the
# receiver Lambda discards non-push events and forwards push events to the
# github-events EventBridge bus, where the pipeline-filter Lambda picks them up.
#
# Prerequisites:
#   - gh CLI authenticated (gh auth status)
#   - AWS CLI with access to Secrets Manager in eu-west-1
#   - 26-cello-package-pipelines.sh complete
#   - 27-update-pipeline-filter.sh complete
#
# Usage:
#   AWS_PROFILE=mygentic ./infra/28-register-github-webhook.sh
# =============================================================================

set -euo pipefail

REGION="eu-west-1"
GITHUB_REPO="Mygentic-AI/CELLO"

# The Lambda Function URL for github-webhook-receiver (eu-west-1).
WEBHOOK_URL="https://wbyyoaixwsxgpfws6rhgs2avji0peohw.lambda-url.eu-west-1.on.aws/"

# Retrieve the shared GitHub webhook secret from Secrets Manager.
# This is the same secret the receiver Lambda validates against.
echo "Retrieving webhook secret from Secrets Manager..."
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id GitHubWebhookSecret \
  --region "$REGION" \
  --query 'SecretString' \
  --output text)

if [ -z "$WEBHOOK_SECRET" ]; then
  echo "ERROR: Could not retrieve GitHubWebhookSecret from Secrets Manager"
  exit 1
fi

echo "Registering push webhook on $GITHUB_REPO..."
gh api "repos/${GITHUB_REPO}/hooks" \
  --method POST \
  --field name=web \
  --field "config[url]=${WEBHOOK_URL}" \
  --field "config[content_type]=json" \
  --field "config[secret]=${WEBHOOK_SECRET}" \
  --field "config[insecure_ssl]=0" \
  --field "events[]=push" \
  --field active=true \
  --jq '{id: .id, url: .config.url, events: .events, active: .active}'

echo ""
echo "=== COMPLETE ==="
echo "Webhook registered on $GITHUB_REPO."
echo "Push events will be HMAC-verified and forwarded to the github-events EventBridge bus."
echo "The cello-pipeline-filter Lambda will trigger the appropriate @cello/* pipelines."
