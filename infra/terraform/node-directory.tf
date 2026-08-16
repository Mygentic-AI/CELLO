# The directory node itself (DOD-NODE-DIR-GCP-1): MIG(size 1) + Container-Optimized OS.
#
# MIG(1) rather than a bare VM for the same reason ECS is used on AWS: auto-healing. A node that
# dies comes back without an operator. Size 1 and never more — a directory node is a stateful
# identity (its transport key IS its peer id, its NODE_ID IS its FROST participant identifier), so
# two instances of one node is not scaling, it is a split identity.
#
# Adding a region is adding one entry to var.directory_nodes. That is the region-expansion test
# (DOD-INV-IAC), and it is why every resource here is for_each'd rather than written out.

locals {
  # IAP's TCP-forwarding range. SSH is reachable ONLY through it — no port 22 from the internet,
  # ever, on any node.
  iap_range = "35.235.240.0/20"
}

# ── Static external IP ───────────────────────────────────────────────────────────────────────
# The node's address is published in the consortium manifest and pinned by clients, so it must
# survive an instance replacement. A MIG with an ephemeral IP would hand out a new address on every
# heal and silently strand every client that had the old one.
resource "google_compute_address" "node" {
  for_each = var.directory_nodes
  name     = "cello-${each.value.node_id}"
  project  = var.project_id
  region   = each.key

  # Clients pin this address through the consortium manifest. Releasing it strands every client
  # holding the old one, and GCP will not give the same address back.
  lifecycle {
    prevent_destroy = true
  }
}

# ── Firewall ─────────────────────────────────────────────────────────────────────────────────
# Two rules, deliberately separate so their audiences are legible.

# SSH via IAP only. This path has never been exercised (Entry 5 carry-forward) and the DoD line
# requires one live login as evidence.
# A PINNED internal address per directory, mirroring the relay's (node-relay.tf) and for the same
# reason it was needed there: a MIG instance replacement moves an ephemeral internal IP, and anything
# that recorded the old one silently points at nothing. The portal reaches the internal API over the
# VPC by this address, so an unpinned one would break the operator surface on every directory deploy —
# and it would break it quietly, since the public protocol ports would keep working.
resource "google_compute_address" "node_internal" {
  for_each     = var.directory_nodes
  name         = "cello-${each.value.node_id}-internal"
  project      = var.project_id
  region       = each.key
  subnetwork   = google_compute_subnetwork.regional[each.key].id
  address_type = "INTERNAL"
  purpose      = "GCE_ENDPOINT"

  lifecycle {
    prevent_destroy = true
  }
}

# The internal API (8081) — the portal's account-scoped seam, and the path the kill switch runs
# through. Reachable ONLY from inside the VPC: it is deliberately absent from the public rules below,
# and this opens it to the private ranges alone.
resource "google_compute_firewall" "node_internal_api" {
  name          = "cello-directory-allow-internal-api"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = [for r in local.region_subnets : r]
  target_tags   = ["cello-directory"]

  allow {
    protocol = "tcp"
    ports    = ["8081"]
  }
}

resource "google_compute_firewall" "node_ssh_iap" {
  name          = "cello-directory-allow-iap-ssh"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = [local.iap_range]
  target_tags   = ["cello-directory"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# The protocol listeners. Open to the internet on purpose: libp2p is Noise-encrypted and
# manifest-pinned, so the transport authenticates its peers itself. That is precisely what lets
# directories reconcile across clouds with no VPN and no peering (DOD-INV-NO-VPN) — the security
# boundary is the handshake, not the network.
#
# The health port (9090) is NOT here. It is unauthenticated and reports internal state; it is
# reachable only from the VM itself and from a MIG health check, which arrives on Google's own
# prober ranges rather than through this rule.
resource "google_compute_firewall" "node_protocol" {
  name          = "cello-directory-allow-protocol"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["cello-directory"]

  allow {
    protocol = "tcp"
    ports    = ["4000", "8080"]
  }
}

# The node's HTTP port. Public, and it has to be: a client bootstraps by fetching
# GET {endpoint}/bootstrap to learn the directory's multiaddr and peer id, and 8080 is the libp2p
# WS listener, which answers plain HTTP with 400. Without this the client resolves ZERO nodes from
# a perfectly valid manifest.
#
# On AWS the ALB does path-selective routing — /bootstrap, /manifest and /registry are public rules
# onto this same port, /health is only a target-group probe. GCP has no load balancer here, so the
# port is exposed whole. What that adds over AWS is /health, which returns nodeId and schemaVersion:
# both already public, since nodeId is in the signed manifest. Google's prober ranges are covered by
# 0.0.0.0/0 and no longer need their own rule.
#
# Restoring path-selective exposure is part of putting a TLS terminator in front of these nodes
# (owed — see the ws-not-wss note in GCP-STATE).
resource "google_compute_firewall" "node_http" {
  name          = "cello-directory-allow-http"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["cello-directory"]

  allow {
    protocol = "tcp"
    ports    = ["9090"]
  }
}

# ── The instance ─────────────────────────────────────────────────────────────────────────────

resource "google_compute_instance_template" "directory" {
  for_each     = var.directory_nodes
  name_prefix  = "cello-${each.value.node_id}-"
  project      = var.project_id
  region       = each.key
  machine_type = each.value.machine_type
  tags         = ["cello-directory"]

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
    disk_size_gb = 30
    disk_type    = "pd-balanced"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.regional[each.key].id
    network_ip = google_compute_address.node_internal[each.key].address
    access_config {
      nat_ip = google_compute_address.node[each.key].address
    }
  }

  service_account {
    email  = google_service_account.directory_node[each.key].email
    scopes = ["cloud-platform"]
  }

  metadata = {
    # cloud-init, not the konlet `gce-container-declaration`: konlet runs exactly one container and
    # takes its environment from metadata. This node needs a second unit (the backup timer), and
    # its secrets must NOT sit in metadata, which is readable by anything holding
    # compute.instances.get. See the SECRETS note in secrets.tf.
    user-data = templatefile("${path.module}/templates/directory-cloud-init.yaml", {
      image                 = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cello.repository_id}/directory:${var.directory_image_tag}"
      registry_host         = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev"
      node_id               = each.value.node_id
      region                = each.key
      environment           = var.environment
      project_id            = var.project_id
      audit_bucket          = google_storage_bucket.node_audit[each.key].name
      relay_bucket          = google_storage_bucket.relay_manifest[each.key].name
      backup_bucket         = google_storage_bucket.node_backups[each.key].name
      kms_location          = each.key
      kms_keyring           = google_kms_key_ring.node[each.key].name
      kms_key               = google_kms_crypto_key.envelope[each.key].name
      gsm_db                = "${google_secret_manager_secret.db_credentials[each.key].id}/versions/latest"
      gsm_db_app            = "${google_secret_manager_secret.db_app_credentials[each.key].id}/versions/latest"
      gsm_node_key          = "${google_secret_manager_secret.node["${each.value.node_id}--node-key"].id}/versions/latest"
      gsm_transport         = "${google_secret_manager_secret.node["${each.value.node_id}--transport-key"].id}/versions/latest"
      gsm_internal          = "${google_secret_manager_secret.node["${each.value.node_id}--internal-api-key"].id}/versions/latest"
      gsm_preauth           = "${google_secret_manager_secret.consortium_preauth_issuer.id}/versions/latest"
      preauth_issuer_pubkey = var.preauth_issuer_pubkey
      consortium_root_keys  = var.consortium_root_keys
      consortium_threshold  = var.consortium_threshold
      heap_mb               = each.value.heap_mb
      # Terraform's indent() does NOT indent the FIRST line, so the template supplies that one's
      # leading spaces and indent() supplies the rest. Getting this wrong put the manifest's opening
      # brace at column 0, which broke the YAML block scalar — and a cloud-config that fails to
      # parse writes NOTHING, so the node came up with no units at all rather than with a bad
      # manifest. Trailing newline trimmed for the same reason.
      consortium_manifest_indented = indent(6, trimspace(file("${path.module}/../manifests/gcp-consortium-manifest.json")))
      hostname                     = each.value.hostname
      public_addr                  = google_compute_address.node[each.key].address
      public_port                  = each.value.public_port
      public_transport             = each.value.public_transport
      backup_dbname                = google_sql_database.cello[each.key].name
    })
    google-logging-enabled = "true"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_health_check" "directory" {
  name               = "cello-directory-health"
  project            = var.project_id
  check_interval_sec = 30
  timeout_sec        = 10
  healthy_threshold  = 2
  # Three consecutive misses before a heal. A directory restart drops every open session, so the
  # threshold is deliberately slower to fire than a stateless service's would be.
  unhealthy_threshold = 3

  http_health_check {
    port         = 9090
    request_path = "/health"
  }
}

resource "google_compute_instance_group_manager" "directory" {
  for_each           = var.directory_nodes
  name               = "cello-${each.value.node_id}"
  project            = var.project_id
  zone               = each.value.zone
  base_instance_name = "cello-${each.value.node_id}"
  target_size        = 1

  version {
    instance_template = google_compute_instance_template.directory[each.key].id
  }

  # PROACTIVE, not OPPORTUNISTIC. Under OPPORTUNISTIC a new instance template does not replace the
  # running instance, so bumping directory_image_tag produced a clean `terraform apply` while the
  # node went on running the previous image — and its cloud-init had the OLD tag baked into
  # ExecStartPre, so it would pull that tag forever. State and reality disagreed with no signal,
  # which is the same "which code is live" question the immutable-tag rule exists to answer.
  #
  # Never surge: a surged instance would fight the pinned static IP (IP_IN_USE), and two instances
  # of one node is a split identity regardless. Replace in place, one at a time.
  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    max_surge_fixed       = 0
    max_unavailable_fixed = 1
  }

  auto_healing_policies {
    health_check = google_compute_health_check.directory.id
    # The container pulls an image, resolves secrets, runs Flyway and then boots. Healing before
    # that finishes would produce a permanent restart loop that looks like a crash.
    initial_delay_sec = 300
  }
}

output "directory_node_addresses" {
  description = "Public address of each directory node — goes into the consortium manifest."
  value       = { for k, v in var.directory_nodes : v.node_id => google_compute_address.node[k].address }
}

output "directory_node_sql_endpoints" {
  description = "PSC address of each node's Cloud SQL instance. Reachable ONLY from that node's subnet."
  value       = { for k, v in var.directory_nodes : v.node_id => google_compute_address.sql_psc[k].address }
}

# The addresses the portal dials for the internal API. Emitted because a value that must be copied
# into another service's config should come from state, not from someone reading the console.
output "directory_node_internal_addresses" {
  value       = { for k, n in var.directory_nodes : n.node_id => google_compute_address.node_internal[k].address }
  description = "Pinned internal IPs of the directory nodes — the VPC-only path to their internal API (8081)."
}
