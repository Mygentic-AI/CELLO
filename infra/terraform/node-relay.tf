# GCP relay nodes (DOD-NODE-RELAY-GCP-1).
#
# A relay brokers session traffic between agents. It is NOT a directory: it holds no consortium
# state, no database, no key shares and no threshold role, and DOD-INV-RELAY-EXTRACTABLE requires it
# stay that way — a standalone artifact an enterprise can run privately. So this file gives it
# env-only configuration and nothing that reaches into directory internals.
#
# Two things it does need that a directory does not:
#   a PERSISTENT DISK for the WAL. The relay journals in-flight session frames; losing that on an
#   instance replacement drops messages that agents believe were delivered. The boot disk is
#   auto-deleted, so the WAL gets its own disk that survives.
#   CELLO_DIRECTORY_PUBKEYS — the set of directory signing keys it will accept instructions from.
#   That is public data passed as configuration, which is what keeps the relay extractable: it
#   learns the consortium from its environment, never from a shared package.

variable "relay_nodes" {
  description = <<-EOT
    Relay nodes, keyed by REGION — same shape and same reasoning as directory_nodes. Relays do NOT
    enter the threshold, so unlike directories they may scale freely; one per region is simply the
    starting point.
  EOT
  type = map(object({
    node_id      = string
    zone         = string
    subnet_index = number
    machine_type = string
    hostname     = string
  }))
  default = {}
}

variable "relay_image_tag" {
  description = "Artifact Registry tag of the relay image. Immutable commit-SHA tag from Cloud Build."
  type        = string
  default     = ""
}

locals {
  # The relay accepts directory instructions signed by these keys. Derived from the SAME topology
  # that defines the directories, so a node added to the consortium cannot be forgotten here —
  # which is exactly how a relay ends up silently refusing a legitimate directory.
  #
  # Terraform cannot derive an Ed25519 public key from a seed, so the values come from
  # infra/scripts/gcp-node-identities.sh (verified byte-identical to what each node logs for
  # itself). Rotating a node key means re-running that script and re-applying.
  directory_pubkeys = join(",", [for region, node in var.directory_nodes : var.directory_node_pubkeys[node.node_id]])

  # DOD-SEAL-BROKER-1: pubkey=multiaddr for every directory, so the relay can call back to the one
  # that BROKERED a session instead of the single `relay_primary_directory` pinned below. That pin is
  # chosen at deploy time and bears no relation to who is talking — it may be the home directory of
  # one participant, or of neither, and every seal in the consortium went through it.
  #
  # Derived from the SAME topology as the pubkeys, so a node added to the consortium cannot be
  # forgotten here — the failure mode would be that node's sessions silently falling back to the pin.
  directory_endpoints = join(",", [
    for region, node in var.directory_nodes :
    "${var.directory_node_pubkeys[node.node_id]}=/ip4/${google_compute_address.node[region].address}/tcp/8080/ws/p2p/${var.directory_node_peer_ids[node.node_id]}"
  ])
}

variable "directory_node_pubkeys" {
  description = "node_id => Ed25519 signing pubkey (hex). PUBLIC data. Produced by infra/scripts/gcp-node-identities.sh; Terraform cannot derive these from the seeds it generates."
  type        = map(string)
  default     = {}
}

variable "directory_node_peer_ids" {
  description = "node_id => libp2p peer id. PUBLIC. Same source as the pubkeys; Terraform cannot derive a peer id from a transport seed."
  type        = map(string)
  default     = {}
}

variable "relay_primary_directory" {
  description = "node_id of the directory a relay registers with. The relay requires ONE directory pubkey (CELLO_DIRECTORY_PUBKEY) as its registration target, in addition to the full accept-set."
  type        = string
  default     = ""
}

resource "google_service_account" "relay_node" {
  for_each     = var.relay_nodes
  project      = var.project_id
  account_id   = "cello-relay-${each.value.node_id}"
  display_name = "CELLO relay node ${each.value.node_id}"
}

resource "google_project_iam_member" "relay_node" {
  for_each = { for p in flatten([
    for region, node in var.relay_nodes : [
      for role in ["roles/logging.logWriter", "roles/monitoring.metricWriter"] : {
        key = "${region}--${role}", region = region, role = role
      }
    ]
  ]) : p.key => p }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.relay_node[each.value.region].email}"
}

resource "google_artifact_registry_repository_iam_member" "relay_node_reader" {
  for_each   = var.relay_nodes
  project    = var.project_id
  location   = google_artifact_registry_repository.cello.location
  repository = google_artifact_registry_repository.cello.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.relay_node[each.key].email}"
}

# ── Secrets: two, per the DoD line ───────────────────────────────────────────────────────────
# The relay's Ed25519 identity and its libp2p transport key. Per-relay and never copied, for the
# same reason as a directory's: a shared transport key means two relays with one peer id.
locals {
  relay_secret_names = ["node-key", "transport-key"]
  relay_secret_pairs = flatten([
    for region, node in var.relay_nodes : [
      for name in local.relay_secret_names : {
        key = "${node.node_id}--${name}", region = region, node_id = node.node_id, name = name
      }
    ]
  ])
}

resource "random_id" "relay_secret" {
  for_each    = { for p in local.relay_secret_pairs : p.key => p }
  byte_length = 32
}

resource "google_secret_manager_secret" "relay" {
  for_each  = { for p in local.relay_secret_pairs : p.key => p }
  project   = var.project_id
  secret_id = "cello-${each.value.node_id}-${each.value.name}"

  replication {
    user_managed {
      replicas {
        location = each.value.region
      }
    }
  }

  # The transport key IS the relay's peer id, which agents dial. A re-apply mints a different one.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret_version" "relay" {
  for_each    = { for p in local.relay_secret_pairs : p.key => p }
  secret      = google_secret_manager_secret.relay[each.key].id
  secret_data = random_id.relay_secret[each.key].hex
}

resource "google_secret_manager_secret_iam_member" "relay" {
  for_each  = { for p in local.relay_secret_pairs : p.key => p }
  project   = var.project_id
  secret_id = google_secret_manager_secret.relay[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.relay_node[each.value.region].email}"
}

# ── Network ──────────────────────────────────────────────────────────────────────────────────

# The relay's VPC-INTERNAL address, pinned.
#
# Directories health-check each relay over the VPC (the PUBLIC health port is firewalled to Google's
# probers only), so the manifest's healthCheckUrl must name an internal address. An EPHEMERAL one is
# a trap: a MIG instance replacement moves it (observed 10.10.0.14 -> 10.10.0.27), every directory's
# health check then fails, the relay pool empties, and every session returns `relay_unavailable`
# until someone re-runs the manifest publisher. Pinning it makes the published value un-stale-able.
resource "google_compute_address" "relay_internal" {
  for_each     = var.relay_nodes
  name         = "cello-${each.value.node_id}-internal"
  project      = var.project_id
  region       = each.key
  subnetwork   = google_compute_subnetwork.regional[each.key].id
  address_type = "INTERNAL"
  purpose      = "GCE_ENDPOINT"

  # Releasing it reintroduces exactly the drift this resource exists to prevent.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_address" "relay" {
  for_each = var.relay_nodes
  name     = "cello-${each.value.node_id}"
  project  = var.project_id
  region   = each.key

  # Agents dial this address through the signed relay manifest. Releasing it strands them.
  lifecycle {
    prevent_destroy = true
  }
}

# 4001 is the libp2p relay protocol; 4000 is health. Health is restricted to Google's probers, the
# protocol port is public — the relay authenticates its peers in the handshake, not by network.
resource "google_compute_firewall" "relay_protocol" {
  name          = "cello-relay-allow-protocol"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["cello-relay"]

  allow {
    protocol = "tcp"
    ports    = ["4001"]
  }
}

resource "google_compute_firewall" "relay_health" {
  name          = "cello-relay-allow-health-probes"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  target_tags   = ["cello-relay"]

  allow {
    protocol = "tcp"
    ports    = ["4000"]
  }
}

# The DIRECTORY health-checks each relay in its pool before assigning a session to it
# (RelayPoolManager#runHealthChecks → healthCheckUrl). That traffic is VPC-internal and comes from
# the directory subnets, NOT from Google's prober ranges — with only the prober rule above, every
# check times out, the relay is marked unavailable, and the directory brokers sessions with an
# EMPTY relay pool. Clients then reject the assignment (`assignment_parse_failed`), which reads as
# a client bug rather than a missing firewall rule.
#
# Ranges come from the subnets themselves so a new region cannot be forgotten here.
resource "google_compute_firewall" "relay_health_internal" {
  name          = "cello-relay-allow-health-internal"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = [for s in google_compute_subnetwork.regional : s.ip_cidr_range]
  target_tags   = ["cello-relay"]

  allow {
    protocol = "tcp"
    ports    = ["4000"]
  }
}

resource "google_compute_firewall" "relay_ssh_iap" {
  name          = "cello-relay-allow-iap-ssh"
  project       = var.project_id
  network       = google_compute_network.cello_vpc.id
  direction     = "INGRESS"
  source_ranges = [local.iap_range]
  target_tags   = ["cello-relay"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# ── The WAL disk ─────────────────────────────────────────────────────────────────────────────
# Separate from the boot disk, which is auto_delete. The relay journals in-flight session frames
# here; losing it on an instance replacement drops messages agents believe were delivered.
resource "google_compute_disk" "relay_wal" {
  for_each = var.relay_nodes
  name     = "cello-${each.value.node_id}-wal"
  project  = var.project_id
  zone     = each.value.zone
  type     = "pd-balanced"
  size     = 20

  lifecycle {
    prevent_destroy = true
  }
}

# ── The instance ─────────────────────────────────────────────────────────────────────────────

resource "google_compute_instance_template" "relay" {
  for_each     = var.relay_nodes
  name_prefix  = "cello-${each.value.node_id}-"
  project      = var.project_id
  region       = each.key
  machine_type = each.value.machine_type
  tags         = ["cello-relay"]

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
    disk_size_gb = 20
    disk_type    = "pd-balanced"
  }

  disk {
    source      = google_compute_disk.relay_wal[each.key].name
    auto_delete = false
    boot        = false
    device_name = "cello-wal"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.regional[each.key].id
    network_ip = google_compute_address.relay_internal[each.key].address
    access_config {
      nat_ip = google_compute_address.relay[each.key].address
    }
  }

  service_account {
    email  = google_service_account.relay_node[each.key].email
    scopes = ["cloud-platform"]
  }

  metadata = {
    user-data = templatefile("${path.module}/templates/relay-cloud-init.yaml", {
      image             = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.cello.repository_id}/relay:${var.relay_image_tag}"
      registry_host     = "${google_artifact_registry_repository.cello.location}-docker.pkg.dev"
      node_id           = each.value.node_id
      environment       = var.environment
      region            = each.key
      public_addr       = google_compute_address.relay[each.key].address
      peer_id_hint      = each.value.node_id
      gsm_node_key      = "${google_secret_manager_secret.relay["${each.value.node_id}--node-key"].id}/versions/latest"
      gsm_transport     = "${google_secret_manager_secret.relay["${each.value.node_id}--transport-key"].id}/versions/latest"
      directory_pubkeys   = local.directory_pubkeys
      directory_endpoints = local.directory_endpoints
      # The relay REQUIRES a single directory as its registration target, separate from the set it
      # accepts instructions from. Registering is how the relay pool gets populated at all — until
      # it happens every directory reports relay.manifest.not_found and brokers no sessions.
      primary_directory_pubkey    = var.directory_node_pubkeys[var.relay_primary_directory]
      primary_directory_multiaddr = "/ip4/${google_compute_address.node[[for r, n in var.directory_nodes : r if n.node_id == var.relay_primary_directory][0]].address}/tcp/8080/ws/p2p/${var.directory_node_peer_ids[var.relay_primary_directory]}"
    })
    google-logging-enabled = "true"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_health_check" "relay" {
  name                = "cello-relay-health"
  project             = var.project_id
  check_interval_sec  = 30
  timeout_sec         = 10
  healthy_threshold   = 2
  unhealthy_threshold = 3

  http_health_check {
    port         = 4000
    request_path = "/health"
  }
}

resource "google_compute_instance_group_manager" "relay" {
  for_each           = var.relay_nodes
  name               = "cello-${each.value.node_id}"
  project            = var.project_id
  zone               = each.value.zone
  base_instance_name = "cello-${each.value.node_id}"
  target_size        = 1

  version {
    instance_template = google_compute_instance_template.relay[each.key].id
  }

  # Same reasoning as a directory: a surged instance fights the pinned IP, and the WAL disk can
  # only be attached read-write to one instance at a time.
  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    max_surge_fixed       = 0
    max_unavailable_fixed = 1
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.relay.id
    initial_delay_sec = 300
  }
}

output "relay_node_addresses" {
  description = "Public address of each relay — goes into the signed relay pool manifest."
  value       = { for k, v in var.relay_nodes : v.node_id => google_compute_address.relay[k].address }
}

output "relay_node_internal_addresses" {
  description = "Pinned VPC-internal address of each relay — the healthCheckUrl the directories probe."
  value       = { for k, v in var.relay_nodes : v.node_id => google_compute_address.relay_internal[k].address }
}
