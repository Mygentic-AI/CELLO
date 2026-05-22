#!/usr/bin/env bash
# CELLO — Generate Ed25519 node key pair and store in Secrets Manager.
#
# AC-008-key-generation-script (SECOPS-004):
#   Generates a new Ed25519 key pair for a CELLO node (directory or relay).
#   Stores the private key (hex) in Secrets Manager.
#   Prints the public key (hex) to stdout for the operator to record.
#
# Usage:
#   ./infra/scripts/generate-node-keys.sh <environment> <region> [--rotate]
#
#   environment  One of: dev, staging, production
#   region       AWS region (e.g. us-east-1, eu-central-1, ap-northeast-1)
#   --rotate     Overwrite an existing key pair (see WARNING below)
#
# Without --rotate:
#   If cello/{env}/directory/node-private-key already contains a non-placeholder
#   value, the script exits non-zero with:
#     "Key already exists — use --rotate flag to replace"
#   This prevents accidental key overwrites.
#
# With --rotate:
#   Overwrites the existing key pair with a new one.
#   WARNING: Rotating a directory node key requires distributing the new public key
#   to all peer nodes BEFORE the old ECS tasks are stopped. Rotating a relay node key
#   requires restarting the ECS task and registering the new relayId with the directory.
#   Read infra/runbooks/node-key-rotation.md before proceeding.
#
# Key generation method:
#   openssl genpkey -algorithm ed25519 produces a proper Ed25519 private key.
#   The 32-byte raw private key is extracted from the DER-encoded output.
#   Private key: last 32 bytes of the DER output (the raw seed bytes).
#   Public key:  derived via openssl pkey -pubout -outform DER, then last 32 bytes.
#
# Runs the script 6 times (3 directory + 3 relay, one per region) to populate
# all 6 node key pairs for a full 3-region deployment.
#
# Idempotency: safe to re-run with the same arguments. Without --rotate, the
# script skips secrets that already have a non-placeholder value.

set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────────

ENVIRONMENT="${1:-}"
REGION="${2:-}"
ROTATE=false

for arg in "$@"; do
  if [[ "${arg}" == "--rotate" ]]; then
    ROTATE=true
  fi
done

if [[ -z "${ENVIRONMENT}" || -z "${REGION}" ]]; then
  echo "Usage: $0 <environment> <region> [--rotate]" >&2
  echo "" >&2
  echo "  environment: dev | staging | production" >&2
  echo "  region:      e.g. us-east-1, eu-central-1, ap-northeast-1" >&2
  echo "" >&2
  echo "  --rotate     Overwrite existing key pairs (see WARNING in runbook)" >&2
  exit 1
fi

if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "staging" && "${ENVIRONMENT}" != "production" ]]; then
  echo "ERROR: environment must be one of: dev, staging, production" >&2
  exit 1
fi

echo ""
echo "CELLO Node Key Generation: ${ENVIRONMENT} / ${REGION}"
echo "═══════════════════════════════════════════════════════════════"

# ── Key generation functions ─────────────────────────────────────────────────

# generate_ed25519_private_key_hex
#   Uses openssl genpkey -algorithm ed25519 (RFC 8032 Ed25519).
#   Returns the 32-byte raw private key seed as a lowercase hex string.
#
# Pseudocode:
#   1. openssl genpkey -algorithm ed25519 → PEM-encoded private key
#   2. openssl pkey -outform DER → DER-encoded key (contains the 32-byte seed
#      in the last 32 bytes of the OCTET STRING value)
#   3. tail -c 32 → extract the raw 32-byte seed
#   4. xxd -p -c 64 → hex-encode to a 64-character lowercase hex string

generate_ed25519_private_key_hex() {
  openssl genpkey -algorithm ed25519 2>/dev/null \
    | openssl pkey -outform DER 2>/dev/null \
    | tail -c 32 \
    | xxd -p -c 64
}

# derive_ed25519_public_key_hex <private_key_hex>
#   Derives the Ed25519 public key from the 32-byte private key seed.
#   Returns the 32-byte public key as a lowercase hex string.
#
# Pseudocode:
#   1. Decode the 64-char hex private key → 32-byte binary seed
#   2. Build a temporary PEM file with the seed
#   3. openssl pkey -pubout -outform DER → DER-encoded public key
#   4. tail -c 32 → extract the raw 32-byte public key
#   5. xxd -p -c 64 → hex-encode

derive_ed25519_public_key_hex() {
  local private_key_hex="$1"
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf ${tmpdir}" EXIT

  # Decode hex to binary and wrap in a DER PKCS#8 envelope that openssl expects.
  # The DER structure for an Ed25519 private key is:
  #   SEQUENCE {
  #     INTEGER 0 (version)
  #     SEQUENCE { OID 1.3.101.112 }   -- Ed25519 OID
  #     OCTET STRING { OCTET STRING { <32-byte seed> } }
  #   }
  # The easiest approach: generate a fresh keypair, replace the seed bytes in-place.
  # Since we already have the PEM from generation, we use a simpler path:
  # re-derive the public key directly from the raw seed via a temporary key file.

  # Build a minimal PKCS#8 DER for the Ed25519 private key:
  # openssl requires the full PKCS8 structure. We construct it from the raw seed.
  # The DER hex for the PKCS#8 envelope of an Ed25519 key (32 bytes) is:
  #   302e020100300506032b657004220420 + <32 bytes of seed hex>
  # where:
  #   302e = SEQUENCE, length 46
  #   020100 = INTEGER 0 (version)
  #   3005 06 03 2b6570 = SEQUENCE { OID 1.3.101.112 }
  #   0422 0420 = OCTET STRING { OCTET STRING, length 32 }
  local pkcs8_header="302e020100300506032b657004220420"
  local full_der_hex="${pkcs8_header}${private_key_hex}"

  local der_file="${tmpdir}/privkey.der"
  printf '%s' "${full_der_hex}" | xxd -r -p > "${der_file}"

  # Derive public key
  openssl pkey -inform DER -in "${der_file}" -pubout -outform DER 2>/dev/null \
    | tail -c 32 \
    | xxd -p -c 64
}

# ── Secret existence check ────────────────────────────────────────────────────

is_placeholder() {
  local value="$1"
  # A secret is a placeholder if it is empty, equals the literal string
  # "PLACEHOLDER_POPULATE_VIA_CLI", or is otherwise empty/null.
  [[ -z "${value}" || "${value}" == "PLACEHOLDER_POPULATE_VIA_CLI" || "${value}" == "None" ]]
}

get_current_secret_value() {
  local secret_id="$1"
  aws secretsmanager get-secret-value \
    --secret-id "${secret_id}" \
    --region "${REGION}" \
    --query "SecretString" \
    --output text 2>/dev/null || echo ""
}

# ── Generate and store a single node key pair ─────────────────────────────────
# generate_and_store <service> <role>
#   service: "directory" or "relay"
#   role: human-readable name for output

generate_and_store() {
  local service="$1"
  local role="$2"
  local secret_id="cello/${ENVIRONMENT}/${service}/node-private-key"

  echo ""
  echo "── ${role} node key (${service}) ────────────────────────────────────"

  # Check if key already exists
  local current_value
  current_value=$(get_current_secret_value "${secret_id}")

  if ! is_placeholder "${current_value}"; then
    if [[ "${ROTATE}" == "false" ]]; then
      echo "Key already exists — use --rotate flag to replace" >&2
      exit 1
    else
      echo ""
      echo "  WARNING: Overwriting existing key for ${secret_id}"
      echo "  WARNING: Before proceeding, ensure you have:"
      if [[ "${service}" == "directory" ]]; then
        echo "  WARNING:   1. Distributed the NEW public key to all peer directory nodes"
        echo "  WARNING:   2. Verified peers will accept the new key before the old tasks stop"
        echo "  WARNING:   3. Planned a rolling ECS task restart (stop old tasks only after"
        echo "  WARNING:      new tasks with the new key are healthy)"
      else
        echo "  WARNING:   1. Read infra/runbooks/node-key-rotation.md — relay procedure"
        echo "  WARNING:   2. Planned the ECS task restart (new relayId will be registered)"
        echo "  WARNING:   3. Verified the directory will accept the new relay registration"
      fi
      echo ""
    fi
  fi

  # Generate new Ed25519 key pair
  echo "  Generating Ed25519 key pair via openssl genpkey -algorithm ed25519..."
  local private_key_hex
  private_key_hex=$(generate_ed25519_private_key_hex)

  local public_key_hex
  public_key_hex=$(derive_ed25519_public_key_hex "${private_key_hex}")

  # Store private key in Secrets Manager
  aws secretsmanager put-secret-value \
    --secret-id "${secret_id}" \
    --secret-string "${private_key_hex}" \
    --region "${REGION}" >/dev/null

  echo "  Private key stored in Secrets Manager: ${secret_id}"
  echo ""
  echo "  Public key (hex) — record this for peer configuration:"
  echo "  ${public_key_hex}"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────

generate_and_store "directory" "Directory"
generate_and_store "relay" "Relay"

echo "═══════════════════════════════════════════════════════════════"
echo "  Key generation complete: ${ENVIRONMENT} / ${REGION}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
if [[ "${ROTATE}" == "true" ]]; then
  echo "  DIRECTORY KEY ROTATION:"
  echo "  1. Distribute the new directory public key to all peer nodes"
  echo "  2. Perform a rolling ECS task restart for the directory service:"
  echo "     aws ecs update-service --cluster cello-${ENVIRONMENT} \\"
  echo "       --service cello-directory-service --force-new-deployment \\"
  echo "       --region ${REGION}"
  echo "  3. Verify the new directory tasks start healthy"
  echo ""
  echo "  RELAY KEY ROTATION:"
  echo "  1. Restart the relay ECS task to pick up the new key:"
  echo "     aws ecs update-service --cluster cello-${ENVIRONMENT} \\"
  echo "       --service cello-relay-service --force-new-deployment \\"
  echo "       --region ${REGION}"
  echo "  2. Verify the new relay registers with the directory (new relayId)"
  echo "  3. See infra/runbooks/node-key-rotation.md for the full procedure"
else
  echo "  1. Run this script for each additional region:"
  echo "     ./infra/scripts/generate-node-keys.sh ${ENVIRONMENT} eu-central-1"
  echo "     ./infra/scripts/generate-node-keys.sh ${ENVIRONMENT} ap-northeast-1"
  echo "  2. Restart ECS tasks to pick up the new keys:"
  echo "     aws ecs update-service --cluster cello-${ENVIRONMENT} \\"
  echo "       --service cello-directory-service --force-new-deployment \\"
  echo "       --region ${REGION}"
fi
echo ""
