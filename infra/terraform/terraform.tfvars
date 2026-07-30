# The live CELLO topology on GCP. Committed on purpose: this file IS the answer to
# "what exists", and a topology kept only in someone's shell history is not IaC.

environment = "dev"

# Immutable commit-SHA tag built by Cloud Build. Never a moving tag — see infra/cloudbuild/*.yaml.
directory_image_tag = "fetch-33b26752"

# One node = one region = one independent deployment. The map key is the region, which makes two
# nodes in one region unrepresentable rather than merely discouraged.
#
# node_id is PERMANENT: it feeds Identifier.derive() and is the FROST participant identifier.
# `gcp-use1` is us-east1 (Moncks Corner, SC) — a different geography from the AWS node's us-east-1
# (N. Virginia), so a regional event does not take both.
directory_nodes = {
  us-east1 = {
    node_id      = "gcp-use1"
    zone         = "us-east1-b"
    subnet_index = 0
    machine_type = "e2-standard-2"
    db_tier      = "db-custom-1-3840"
    hostname     = "directory-gcp-use1.cello.mygentic.ai"
    # No TLS terminator in front of this node yet — it listens on 8080 itself.
    public_port      = 8080
    public_transport = "ws"
  }

  # Node 2. A different region is the whole point — one node = one region = one independent
  # deployment, so a regional event can never take two validators. us-central1 (Council Bluffs, IA)
  # shares no power grid, no network fabric and no failure domain with us-east1.
  us-central1 = {
    node_id          = "gcp-usc1"
    zone             = "us-central1-a"
    subnet_index     = 1
    machine_type     = "e2-standard-2"
    db_tier          = "db-custom-1-3840"
    hostname         = "directory-gcp-usc1.cello.mygentic.ai"
    public_port      = 8080
    public_transport = "ws"
  }

  # Node 3. Temporary Wave-1 member so the standalone GCP consortium is N=3 with T=majority=2
  # (spec-of-record decision 2); displaced or re-rolled as a replica when the AWS node joins in P3.
  # Another continent, because at N=3 the third node is what decides whether a US-wide event can
  # take the consortium below threshold.
  europe-west1 = {
    node_id          = "gcp-euw1"
    zone             = "europe-west1-b"
    subnet_index     = 2
    machine_type     = "e2-standard-2"
    db_tier          = "db-custom-1-3840"
    hostname         = "directory-gcp-euw1.cello.mygentic.ai"
    public_port      = 8080
    public_transport = "ws"
  }
}

# Directory node signing pubkeys — PUBLIC data, and the set a relay will accept instructions from.
# Terraform generates the key SEEDS but cannot derive Ed25519 public keys, so these come from
# infra/scripts/gcp-node-identities.sh. Verified byte-identical to what each node logs for itself
# at boot, which is the basis for trusting a manifest built from them. Re-run the script and
# re-apply if a node key is ever rotated.
directory_node_pubkeys = {
  gcp-use1 = "7969e22a7d95293ae343cb2667c2a4d7127aa8748478582fa637674c30e0113c"
  gcp-usc1 = "ef961384100bb087f36b68e3a270acb8f22fdf62c4cd5e517e423afb7f399002"
  gcp-euw1 = "9cb77b68a98f49056fef232f4d56eeb9b66b1a6646fe06b966ff570a82ca6c14"
}

# Relays do NOT enter the threshold, so they may scale freely — one is enough for Wave 1.
# us-east1 alongside gcp-use1 keeps the first live session's path short while the topology is
# being proven; additional relays are additional map entries.
# Same source as directory_node_pubkeys — infra/scripts/gcp-node-identities.sh.
directory_node_peer_ids = {
  gcp-use1 = "12D3KooWMH58hm8xpuwgwaNSvnvXBuc126jfuUMVbrGNcU2MeEAX"
  gcp-usc1 = "12D3KooWExQLMbvaioVqQCPkc1ZZgJ5kdoePymtMrg46ugMBs5zi"
  gcp-euw1 = "12D3KooWP52VSVrakyRdPyt23kAuhgp3FV6tiVRByfdyVvHAaEeJ"
}

# The relay registers with the directory in its own region — shortest path, and no cross-region
# dependency for the thing that makes sessions brokerable at all.
relay_primary_directory = "gcp-use1"

relay_image_tag = "broker2-80b5a2d8"

relay_nodes = {
  us-east1 = {
    node_id      = "gcp-relay-use1"
    zone         = "us-east1-b"
    subnet_index = 0
    machine_type = "e2-small"
    hostname     = "relay-gcp-use1.cello.mygentic.ai"
  }
}

# The officer public key the consortium manifest is verified against, and how many officer
# signatures it needs. NOT the FROST threshold — that is majority(validators) = 2 and the node
# derives it from the manifest.
consortium_root_keys = "e8300a2b9de7be6f6d629f778dc319715ad0010c0639f3a1564181d56d3eb104"
consortium_threshold = 1

# Pre-authorization issuer PUBLIC key. Setting this is what ENABLES capability checking on every
# directory — unset, a node does not perform a weaker check, it performs none and accepts
# registration from anyone who can reach it. ONE issuer for the consortium, because a client
# presents its capability to whichever directory it reaches.
# Derived from cello-consortium-preauth-issuer-key with infra/scripts/derive-pubkey.js.
preauth_issuer_pubkey = "4468292bbe38ab929e504a1d962abeebe4f02db0a380b4d7880eb4f4dbd56c07"
