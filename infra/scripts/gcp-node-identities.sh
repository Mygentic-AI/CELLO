#!/usr/bin/env bash
# gcp-node-identities.sh — print the public identity of every GCP directory node.
#
# Two downstream consumers need exactly this, and neither can compute it:
#
#   DOD-MANIFEST-GCP-1   the consortium manifest lists each node's Ed25519 `pubkey`
#   DOD-NODE-RELAY-GCP-1 the relay's CELLO_DIRECTORY_PUBKEYS is the set it will accept
#
# Terraform generates the node key SEEDS but cannot derive Ed25519 public keys or libp2p peer
# ids, so this is the bridge — scripted rather than hand-copied, because a hand-copied pubkey is
# a trust anchor nobody can reproduce.
#
# Everything printed here is PUBLIC. The seeds are read from Secret Manager and piped straight
# into the derivers on stdin; they are never passed as arguments (SI-001 — argv is visible via
# ps(1), shell history and /proc/[pid]/cmdline) and never printed.
#
# Usage:
#   infra/scripts/gcp-node-identities.sh [--json]
#
# Node list comes from infra/terraform/terraform.tfvars, so it cannot drift from the topology.

set -euo pipefail

PROJECT="${CELLO_GCP_PROJECT:-cello-infra}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TFVARS="$REPO_ROOT/infra/terraform/terraform.tfvars"
JSON=false
[ "${1:-}" = "--json" ] && JSON=true

[ -f "$TFVARS" ] || { echo "missing $TFVARS — the topology is the source of the node list" >&2; exit 1; }

# node_id values, in the order they appear in the topology.
NODE_IDS=$(grep -oE 'node_id[[:space:]]*=[[:space:]]*"[^"]+"' "$TFVARS" | sed 's/.*"\(.*\)"/\1/')
[ -n "$NODE_IDS" ] || { echo "no node_id entries found in $TFVARS" >&2; exit 1; }

first=true
$JSON && printf '['

for node_id in $NODE_IDS; do
  # The seeds never touch a variable that could be echoed; each is piped directly to its deriver.
  pubkey=$(gcloud secrets versions access latest --secret "cello-${node_id}-node-key" \
             --project "$PROJECT" 2>/dev/null \
           | node "$REPO_ROOT/infra/scripts/derive-pubkey.js") \
    || { echo "could not derive the signing pubkey for ${node_id} — is cello-${node_id}-node-key present?" >&2; exit 1; }

  peerid=$(gcloud secrets versions access latest --secret "cello-${node_id}-transport-key" \
             --project "$PROJECT" 2>/dev/null \
           | node "$REPO_ROOT/infra/scripts/derive-peerid-from-transport-key.js") \
    || { echo "could not derive the peer id for ${node_id} — is cello-${node_id}-transport-key present?" >&2; exit 1; }

  ip=$(gcloud compute addresses describe "cello-${node_id}" \
         --region "$(grep -B4 "\"${node_id}\"" "$TFVARS" | grep -oE '^  [a-z0-9-]+ = \{' | tail -1 | awk '{print $1}')" \
         --project "$PROJECT" --format='value(address)' 2>/dev/null || echo "")

  if $JSON; then
    $first || printf ','
    printf '{"nodeId":"%s","pubkey":"%s","peerId":"%s","address":"%s"}' "$node_id" "$pubkey" "$peerid" "$ip"
  else
    printf '%-12s pubkey=%s peerId=%s address=%s\n' "$node_id" "$pubkey" "$peerid" "$ip"
  fi
  first=false
done

$JSON && printf ']\n'
