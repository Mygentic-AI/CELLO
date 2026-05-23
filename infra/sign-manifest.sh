#!/usr/bin/env bash
# sign-manifest.sh — Sign and upload the CELLO relay pool manifest (CELLO-RELAY-001).
#
# AC-010: Creates a new signed manifest in S3 with version=1 when no existing manifest is present.
# AC-011: Increments the version by exactly 1 from the current manifest on each invocation.
# AC-013: Validates that the signing key is non-empty before proceeding.
#
# Usage:
#   ./infra/sign-manifest.sh <environment> <region> <relay-definitions-json>
#
# Arguments:
#   environment           One of: dev, staging, production
#   region                AWS region (e.g. us-east-1)
#   relay-definitions-json  Path to a JSON file containing the relay entries array:
#                           [
#                             {
#                               "relayId": "<Ed25519 public key hex>",
#                               "endpoint": "wss://relay.example.com",
#                               "region": "us-east-1",
#                               "status": "active",
#                               "healthCheckUrl": "http://10.0.0.5:4000/health"
#                             }
#                           ]
#
# Signing key:
#   Read from AWS Secrets Manager at cello/{env}/directory/node-private-key.
#   The signing key must be non-empty (AC-013).
#
# Output (on success):
#   - Prints the manifest version and S3 key to stdout.
#   - Prints a rolling ECS service update command for the operator.
#
# The manifest S3 key is always: relay-manifest.json
# The bucket is: cello-relay-manifest-{env}-{region}
#
# Canonical JSON signing:
#   The signed payload is canonical JSON of { version, updatedAt, relays }
#   (sorted keys, no whitespace, UTF-8 encoded). This matches the verification
#   logic in RelayPoolManager.#verifyManifestSignature.
#
# Exit codes:
#   0 — success
#   1 — validation error, S3/Secrets Manager error, or signing key is empty

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGN_SCRIPT="${SCRIPT_DIR}/scripts/sign-ed25519.js"
DERIVE_PUBKEY_SCRIPT="${SCRIPT_DIR}/scripts/derive-pubkey.js"

# ── Argument parsing ─────────────────────────────────────────────────────────

ENVIRONMENT="${1:-}"
REGION="${2:-}"
RELAY_DEFS_FILE="${3:-}"

if [[ -z "${ENVIRONMENT}" || -z "${REGION}" || -z "${RELAY_DEFS_FILE}" ]]; then
  echo "Usage: $0 <environment> <region> <relay-definitions-json>" >&2
  echo "" >&2
  echo "  environment           dev | staging | production" >&2
  echo "  region                e.g. us-east-1, eu-central-1" >&2
  echo "  relay-definitions-json  path to JSON file containing relay entries array" >&2
  exit 1
fi

if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "staging" && "${ENVIRONMENT}" != "production" ]]; then
  echo "ERROR: environment must be one of: dev, staging, production" >&2
  exit 1
fi

if [[ ! -f "${RELAY_DEFS_FILE}" ]]; then
  echo "ERROR: relay-definitions-json file not found: ${RELAY_DEFS_FILE}" >&2
  exit 1
fi

if [[ ! -f "${SIGN_SCRIPT}" ]]; then
  echo "ERROR: sign-ed25519.js not found at: ${SIGN_SCRIPT}" >&2
  exit 1
fi

if [[ ! -f "${DERIVE_PUBKEY_SCRIPT}" ]]; then
  echo "ERROR: derive-pubkey.js not found at: ${DERIVE_PUBKEY_SCRIPT}" >&2
  exit 1
fi

MANIFEST_BUCKET="cello-relay-manifest-${ENVIRONMENT}-${REGION}"
MANIFEST_KEY="relay-manifest.json"
SECRETS_KEY="cello/${ENVIRONMENT}/directory/node-private-key"
ECS_CLUSTER="cello-${ENVIRONMENT}"
ECS_SERVICE="cello-directory-service"

echo ""
echo "CELLO Relay Pool Manifest Signing: ${ENVIRONMENT} / ${REGION}"
echo "═══════════════════════════════════════════════════════════════"

# ── Validate relay definitions JSON ─────────────────────────────────────────

echo "  Validating relay definitions..."
if ! python3 -c "import json, sys; data=json.load(open(sys.argv[1])); assert isinstance(data, list), 'must be a JSON array'" "${RELAY_DEFS_FILE}" 2>/dev/null; then
  if ! node -e "
    const data = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    if (!Array.isArray(data)) { process.stderr.write('ERROR: relay-definitions-json must be a JSON array\n'); process.exit(1); }
  " "${RELAY_DEFS_FILE}"; then
    echo "ERROR: relay-definitions-json must be a JSON array" >&2
    exit 1
  fi
fi
echo "  Relay definitions valid."

# ── Fetch signing key from Secrets Manager ────────────────────────────────────

echo "  Fetching signing key from Secrets Manager..."
SIGNING_KEY=$(aws secretsmanager get-secret-value \
  --secret-id "${SECRETS_KEY}" \
  --region "${REGION}" \
  --query "SecretString" \
  --output text 2>/dev/null || echo "")

# AC-013: validate that the signing key is non-empty
if [[ -z "${SIGNING_KEY}" || "${SIGNING_KEY}" == "PLACEHOLDER_POPULATE_VIA_CLI" || "${SIGNING_KEY}" == "None" ]]; then
  echo "Signing key is empty — populate cello/${ENVIRONMENT}/directory/node-private-key in Secrets Manager before signing the manifest" >&2
  exit 1
fi

# Validate it looks like a 64-character hex string
if ! echo "${SIGNING_KEY}" | grep -qE '^[0-9a-fA-F]{64}$'; then
  echo "ERROR: signing key does not look like a valid 32-byte hex private key" >&2
  exit 1
fi
echo "  Signing key retrieved."

# ── Derive public key (signedBy field) ────────────────────────────────────────

# Derive the public key from the private key to construct the signedBy field.
# Uses derive-pubkey.js which resolves @noble/curves via createRequire (ESM-safe).
SIGNING_PUBLIC_KEY_HEX=$(node "${DERIVE_PUBKEY_SCRIPT}" "${SIGNING_KEY}" 2>/dev/null || echo "")

if [[ -z "${SIGNING_PUBLIC_KEY_HEX}" ]]; then
  echo "ERROR: failed to derive public key from signing key" >&2
  exit 1
fi

# ── Determine current version ────────────────────────────────────────────────

echo "  Checking current manifest version in S3..."
CURRENT_VERSION=0

CURRENT_MANIFEST_JSON=$(aws s3 cp \
  "s3://${MANIFEST_BUCKET}/${MANIFEST_KEY}" - \
  --region "${REGION}" 2>/dev/null || echo "")

if [[ -n "${CURRENT_MANIFEST_JSON}" ]]; then
  CURRENT_VERSION=$(echo "${CURRENT_MANIFEST_JSON}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version', 0))" 2>/dev/null || \
    node -e "const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(String(d.version ?? 0))" <<< "${CURRENT_MANIFEST_JSON}" 2>/dev/null || \
    echo "0")
  echo "  Current manifest version: ${CURRENT_VERSION}"
else
  echo "  No existing manifest — starting at version 1."
fi

# HIGH-3: Guard against unparseable existing manifest — refuse to reset version
if [[ -n "${CURRENT_MANIFEST_JSON}" ]] && [[ -z "${CURRENT_VERSION}" || "${CURRENT_VERSION}" == "0" ]]; then
  echo "ERROR: existing manifest in S3 could not be parsed — refusing to reset version" >&2
  exit 1
fi

NEW_VERSION=$((CURRENT_VERSION + 1))
UPDATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "  New manifest version: ${NEW_VERSION}"

# ── Build relay entries from definitions file ─────────────────────────────────

RELAYS_JSON=$(cat "${RELAY_DEFS_FILE}")

# ── Build canonical JSON payload for signing ─────────────────────────────────
#
# Canonical JSON: sorted keys, no whitespace, UTF-8 per RELAY-001 signing rules.
# Sorted keys order: "relays", "updatedAt", "version" (alphabetical)
#
# This matches the RelayPoolManager canonicalJson implementation exactly.

CANONICAL_JSON=$(node -e "
const relays = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
const body = { version: Number(process.argv[2]), updatedAt: process.argv[3], relays };
const sorted = Object.fromEntries(Object.keys(body).sort().map(k => [k, body[k]]));
process.stdout.write(JSON.stringify(sorted));
" -- "${RELAY_DEFS_FILE}" "${NEW_VERSION}" "${UPDATED_AT}")

# ── Sign the canonical JSON ───────────────────────────────────────────────────

echo "  Signing manifest..."
SIGNATURE=$(node "${SIGN_SCRIPT}" "${SIGNING_KEY}" "${CANONICAL_JSON}")

if [[ -z "${SIGNATURE}" ]]; then
  echo "ERROR: signing failed — empty signature returned" >&2
  exit 1
fi

# ── Build the full manifest JSON ──────────────────────────────────────────────

MANIFEST_JSON=$(node -e "
const relays = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
const manifest = {
  version: Number(process.argv[2]),
  signedBy: process.argv[3],
  signature: process.argv[4],
  updatedAt: process.argv[5],
  relays,
};
process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
" -- "${RELAY_DEFS_FILE}" "${NEW_VERSION}" "${SIGNING_PUBLIC_KEY_HEX}" "${SIGNATURE}" "${UPDATED_AT}")

# ── Upload to S3 ─────────────────────────────────────────────────────────────

echo "  Uploading manifest to S3..."
echo "${MANIFEST_JSON}" | aws s3 cp - \
  "s3://${MANIFEST_BUCKET}/${MANIFEST_KEY}" \
  --region "${REGION}" \
  --content-type "application/json"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Manifest signed and uploaded:"
echo "    Version: ${NEW_VERSION}"
echo "    S3 key:  s3://${MANIFEST_BUCKET}/${MANIFEST_KEY}"
echo "    Relays:  $(echo "${RELAYS_JSON}" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")"
echo ""
echo "  To trigger directory reload (rolling ECS update):"
echo "    aws ecs update-service \\"
echo "      --cluster ${ECS_CLUSTER} \\"
echo "      --service ${ECS_SERVICE} \\"
echo "      --force-new-deployment \\"
echo "      --region ${REGION}"
echo ""
