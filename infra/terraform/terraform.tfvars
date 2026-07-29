# The live CELLO topology on GCP. Committed on purpose: this file IS the answer to
# "what exists", and a topology kept only in someone's shell history is not IaC.

environment = "dev"

# Immutable commit-SHA tag built by Cloud Build. Never a moving tag — see infra/cloudbuild/*.yaml.
directory_image_tag = "m12-d0a29902"

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
