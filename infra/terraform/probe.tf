# DOD-IAC-BASE-1 disposable probe — the node shape (MIG size 1 + COS + static IP + attached SA)
# proven up AND down entirely from code. Not a CELLO node: it runs no container. The real node
# units (DOD-NODE-*) replace the pinned-address template with a stateful-IP MIG policy.

resource "google_compute_address" "probe" {
  count   = var.disposable_probe ? 1 : 0
  name    = "cello-probe-ip"
  project = var.project_id
  region  = "us-east1"
}

resource "google_compute_firewall" "probe_ssh_iap" {
  count     = var.disposable_probe ? 1 : 0
  name      = "cello-probe-allow-iap-ssh"
  project   = var.project_id
  network   = google_compute_network.cello_vpc.id
  direction = "INGRESS"
  # IAP TCP-forwarding range only — the probe is never SSH-open to the internet.
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["cello-probe"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_instance_template" "probe" {
  count        = var.disposable_probe ? 1 : 0
  name_prefix  = "cello-probe-"
  project      = var.project_id
  region       = "us-east1"
  machine_type = "e2-small"
  tags         = ["cello-probe"]

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
    disk_size_gb = 10
  }

  network_interface {
    subnetwork = google_compute_subnetwork.regional["us-east1"].id
    # PROBE-ONLY PATTERN — do not copy. A template-pinned address deadlocks any surge-based
    # rolling replace (IP_IN_USE). Real nodes use a stateful-IP MIG policy (DOD-NODE-*).
    access_config {
      nat_ip = google_compute_address.probe[0].address
    }
  }

  service_account {
    # Deliberate reuse of the real directory-node SA (M12-D3): the probe exists to prove the
    # exact node shape, incl. the attached workload identity. Probe lifecycle is minutes.
    # The probe is hardcoded to us-east1 throughout this file, so it borrows that node's identity
    # specifically — service accounts became per-node once a shared one was shown to hand every
    # node the others' keys.
    email  = google_service_account.directory_node["us-east1"].email
    scopes = ["cloud-platform"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_instance_group_manager" "probe" {
  count              = var.disposable_probe ? 1 : 0
  name               = "cello-probe-mig"
  project            = var.project_id
  zone               = "us-east1-b"
  base_instance_name = "cello-probe"
  target_size        = 1

  version {
    instance_template = google_compute_instance_template.probe[0].id
  }

  # Never surge: a surged instance would fight the pinned address. Recreate-only, one at a time.
  update_policy {
    type                  = "OPPORTUNISTIC"
    minimal_action        = "REPLACE"
    max_surge_fixed       = 0
    max_unavailable_fixed = 1
  }
}
